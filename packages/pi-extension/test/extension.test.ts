import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getProfile, resolveConfig } from "@lab-agent-workbench/core";
import { createLabAgentWorkbench, defaultTelemetryPath } from "../src/index.js";

type Handler = (event: Record<string, unknown>, ctx: { cwd: string }) => Promise<unknown>;

interface Sandbox {
  home: string;
  project: string;
  handlers: Record<string, Handler>;
  cleanup: () => Promise<void>;
}

async function sandbox(): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), "lawb-ext-"));
  const home = join(root, "home");
  const project = join(root, "project");
  await mkdir(home);
  await mkdir(project);
  const handlers: Record<string, Handler> = {};
  createLabAgentWorkbench({ homeDirectory: home })({
    on: (name: string, handler: Handler) => {
      handlers[name] = handler;
    },
    registerCommand: () => {}
  } as never);
  return { home, project, handlers, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function runTool(
  box: Sandbox,
  cwd: string,
  toolName: string,
  args: Record<string, unknown>,
  id = "call-1"
): Promise<void> {
  const ctx = { cwd };
  await box.handlers.tool_execution_start?.({ toolCallId: id, args }, ctx);
  await box.handlers.tool_execution_end?.({ toolCallId: id, toolName, durationMs: 3, isError: false }, ctx);
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

async function records(path: string): Promise<Record<string, unknown>[]> {
  return (await readFile(path, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("a project without .lawb/config.json logs to ~/.lawb and leaves the project untouched", async () => {
  const box = await sandbox();
  try {
    await runTool(box, box.project, "bash", { command: "API_KEY=fixture-secret-1 npm test" });

    const [record] = await records(defaultTelemetryPath(box.home));
    assert.equal(record?.cwd, box.project);
    assert.equal(record?.toolName, "bash");
    assert.deepEqual(record?.args, { command: "[REDACTED] npm test" });
    assert.equal(await exists(join(box.project, ".lawb")), false);
  } finally {
    await box.cleanup();
  }
});

test("uninitialized projects share one home log and are told apart by cwd", async () => {
  const box = await sandbox();
  try {
    const other = join(box.home, "..", "other-project");
    await mkdir(other);
    await runTool(box, box.project, "read", { path: "src/a.ts" }, "a");
    await runTool(box, other, "read", { path: "src/b.ts" }, "b");

    const logged = await records(defaultTelemetryPath(box.home));
    assert.deepEqual(logged.map((record) => record.cwd), [box.project, other]);
  } finally {
    await box.cleanup();
  }
});

test("an initialized project keeps logging inside its own .lawb", async () => {
  const box = await sandbox();
  try {
    await mkdir(join(box.project, ".lawb"));
    await writeFile(
      join(box.project, ".lawb", "config.json"),
      JSON.stringify(resolveConfig(getProfile("nestjs"))),
      "utf8"
    );
    await runTool(box, box.project, "bash", { command: "npm test" });

    assert.equal((await records(join(box.project, ".lawb", "runs", "telemetry.jsonl"))).length, 1);
    assert.equal(await exists(join(box.home, ".lawb")), false);
  } finally {
    await box.cleanup();
  }
});

test("telemetry disabled in the project config writes nothing anywhere", async () => {
  const box = await sandbox();
  try {
    await mkdir(join(box.project, ".lawb"));
    await writeFile(
      join(box.project, ".lawb", "config.json"),
      JSON.stringify(resolveConfig(getProfile("nestjs"), { telemetry: { enabled: false } })),
      "utf8"
    );
    await runTool(box, box.project, "bash", { command: "npm test" });

    assert.equal(await exists(join(box.project, ".lawb", "runs")), false);
    assert.equal(await exists(join(box.home, ".lawb")), false);
  } finally {
    await box.cleanup();
  }
});

test("an initialized project cannot send telemetry outside its workspace", async () => {
  const box = await sandbox();
  try {
    await mkdir(join(box.project, ".lawb"));
    await writeFile(
      join(box.project, ".lawb", "config.json"),
      JSON.stringify(resolveConfig(getProfile("nestjs"), { telemetry: { path: "../elsewhere.jsonl" } })),
      "utf8"
    );
    await assert.rejects(runTool(box, box.project, "bash", { command: "npm test" }), /inside the workspace/);
  } finally {
    await box.cleanup();
  }
});

test("the default policy applies without a project config", async () => {
  const box = await sandbox();
  try {
    const call = (toolName: string, input: Record<string, unknown>) =>
      box.handlers.tool_call?.({ toolName, input }, { cwd: box.project });

    assert.deepEqual(await call("read", { path: ".env" }), {
      block: true,
      reason: "Path matches protected read pattern **/.env: .env"
    });
    assert.equal(await call("read", { path: "src/main.ts" }), undefined);
  } finally {
    await box.cleanup();
  }
});

test("an invalid project config fails closed instead of falling back to defaults", async () => {
  const box = await sandbox();
  try {
    await mkdir(join(box.project, ".lawb"));
    await writeFile(join(box.project, ".lawb", "config.json"), '{ "token": "fixture-config-canary", not json', "utf8");
    await assert.rejects(
      box.handlers.tool_call?.({ toolName: "bash", input: { command: "ls" } }, { cwd: box.project }) ?? Promise.resolve(),
      (error: unknown) => {
        assert.ok(error instanceof SyntaxError);
        assert.equal(error.message.includes("fixture-config-canary"), false);
        return true;
      }
    );
  } finally {
    await box.cleanup();
  }
});
