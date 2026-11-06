import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager, type ExtensionCommandContext, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { defaultFeatureStates, resolveConfig, type FeatureStates } from "@lab-agent-workbench/core";
import { createLabAgentWorkbench, defaultTelemetryPath } from "../src/index.js";
import { featureStateEntry } from "../src/feature-controls.js";

type Hook = (event: Record<string, unknown>, ctx: ExtensionCommandContext) => Promise<unknown>;

async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), "lawb-controls-"));
  const project = join(root, "project");
  const home = join(root, "home");
  await mkdir(project);
  await mkdir(home);
  const hooks = new Map<string, Hook>();
  const commands = new Map<string, { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }>();
  const controls = {
    selection: undefined as FeatureStates | undefined,
    branch: [] as SessionEntry[],
    saved: [] as SessionEntry[],
    confirm: true,
    confirmations: 0,
    menuOpened: 0,
    idle: true,
    saveFails: false,
    saveFailsAfterAppend: false,
    nativeSession: undefined as SessionManager | undefined,
    notifications: [] as { message: string; type: string }[],
    status: ""
  };
  const ctx = {
    cwd: project,
    mode: "tui",
    hasUI: true,
    isIdle: () => controls.idle,
    getContextUsage: () => undefined,
    signal: undefined,
    sessionManager: { getBranch: () => controls.nativeSession?.getBranch() ?? controls.branch },
    ui: {
      custom: async () => { controls.menuOpened += 1; return controls.selection; },
      confirm: async () => { controls.confirmations += 1; return controls.confirm; },
      notify: (message: string, type: string) => controls.notifications.push({ message, type }),
      setStatus: (_key: string, text: string) => { controls.status = text; }
    }
  } as unknown as ExtensionCommandContext;
  createLabAgentWorkbench({ homeDirectory: home })({
    on: (name: string, hook: Hook) => hooks.set(name, hook),
    registerCommand: (name: string, command: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }) => commands.set(name, command),
    appendEntry: (customType: string, data: unknown) => {
      if (controls.saveFails) throw new Error("fixture storage failure");
      const entry: SessionEntry = { type: "custom", customType, data, id: String(controls.saved.length), parentId: null, timestamp: new Date().toISOString() };
      controls.nativeSession?.appendCustomEntry(customType, data);
      controls.saved.push(entry);
      controls.branch.push(entry);
      if (controls.saveFailsAfterAppend) throw new Error("fixture write failure after in-memory append");
    }
  } as never);
  const emit = (name: string, event: Record<string, unknown> = {}) => {
    const hook = hooks.get(name);
    assert.ok(hook, `missing ${name}`);
    return hook(event, ctx);
  };
  const command = () => {
    const handler = commands.get("lawb")?.handler;
    assert.ok(handler);
    return handler("", ctx);
  };
  const call = (toolName: string, input: unknown) => emit("tool_call", { toolName, input });
  return { root, project, home, ctx, controls, emit, command, call, cleanup: () => rm(root, { recursive: true, force: true }) };
}

const defaults = () => defaultFeatureStates(resolveConfig());
const off = (): FeatureStates => ({ writeProtection: false, readProtection: false, riskyCommands: false, telemetry: false, contextInjection: false });

test("/lawb applies session switches only after confirming guardrail disable, and restores rules when enabled", async () => {
  const box = await sandbox();
  try {
    await box.emit("session_start");
    assert.match(box.controls.status, /4\/4/);
    assert.notEqual(await box.call("write", { path: ".env" }), undefined);
    box.controls.selection = { ...defaults(), writeProtection: false };
    await box.command();
    assert.equal(box.controls.confirmations, 1);
    assert.equal(box.controls.saved.length, 1);
    assert.match(box.controls.status, /WARNING/);
    assert.equal(await box.call("write", { path: ".env" }), undefined);
    assert.equal(await box.call("write", { path: "../outside.txt" }), undefined);
    assert.notEqual(await box.call("read", { path: ".env" }), undefined);
    assert.notEqual(await box.call("bash", { command: "git reset --hard" }), undefined);
    box.controls.selection = defaults();
    await box.command();
    assert.equal(box.controls.confirmations, 1);
    assert.notEqual(await box.call("write", { path: ".env" }), undefined);
    await assert.rejects(stat(join(box.project, ".lawb")), { code: "ENOENT" });
  } finally { await box.cleanup(); }
});

test("cancel, no changes, and rejected confirmation leave config and session storage untouched", async () => {
  const box = await sandbox();
  try {
    await box.command();
    box.controls.selection = defaults();
    await box.command();
    box.controls.selection = off();
    box.controls.confirm = false;
    await box.command();
    assert.equal(box.controls.saved.length, 0);
    assert.notEqual(await box.call("read", { path: ".env" }), undefined);
  } finally { await box.cleanup(); }
});

test("telemetry can be disabled independently and re-enabled without recording tool results", async () => {
  const box = await sandbox();
  try {
    box.controls.selection = { ...defaults(), telemetry: false };
    await box.command();
    assert.equal(box.controls.confirmations, 0);
    const tool = async () => {
      await box.emit("tool_execution_start", { toolCallId: "a", args: { command: "API_KEY=fixture-secret npm test" } });
      await box.emit("tool_execution_end", { toolCallId: "a", toolName: "bash", result: "SECRET_RESULT_CANARY", durationMs: 1, isError: false });
    };
    await tool();
    await assert.rejects(stat(defaultTelemetryPath(box.home)), { code: "ENOENT" });
    box.controls.selection = defaults();
    await box.command();
    await tool();
    const logged = await readFile(defaultTelemetryPath(box.home), "utf8");
    assert.equal(logged.includes("fixture-secret"), false);
    assert.equal(logged.includes("SECRET_RESULT_CANARY"), false);
    assert.match(logged, /REDACTED/);
  } finally { await box.cleanup(); }
});

test("reload/resume/fork restore only the active branch and new/tree reset to project defaults", async () => {
  const box = await sandbox();
  try {
    box.controls.selection = off();
    await box.command();
    const branch = [...box.controls.branch];
    for (const reason of ["reload", "resume", "fork"]) {
      await box.emit("session_shutdown");
      box.controls.branch = [...branch];
      await box.emit("session_start", { reason });
      assert.equal(await box.call("read", { path: ".env" }), undefined);
      assert.match(box.controls.status, /guards off/);
    }
    box.controls.branch = [];
    await box.emit("session_tree");
    assert.notEqual(await box.call("read", { path: ".env" }), undefined);
    box.controls.branch = [...branch];
    await box.emit("session_tree");
    assert.equal(await box.call("read", { path: ".env" }), undefined);
    box.controls.branch = [];
    await box.emit("session_start", { reason: "new" });
    assert.notEqual(await box.call("read", { path: ".env" }), undefined);
  } finally { await box.cleanup(); }
});

test("feature choices survive a real Pi SessionManager save/open and follow its active tree branch", async () => {
  const box = await sandbox();
  try {
    const native = SessionManager.create(box.project, join(box.root, "sessions"));
    box.controls.nativeSession = native;
    const beforeSwitches = native.appendMessage({ role: "user", content: "fixture task", timestamp: Date.now() });
    box.controls.selection = off();
    await box.command();
    const file = native.getSessionFile();
    assert.ok(file);
    assert.match(await readFile(file, "utf8"), /lawb-features/);
    await box.emit("session_shutdown");
    box.controls.nativeSession = SessionManager.open(file);
    await box.emit("session_start", { reason: "resume" });
    assert.equal(await box.call("read", { path: ".env" }), undefined);
    box.controls.nativeSession.branch(beforeSwitches);
    await box.emit("session_tree");
    assert.notEqual(await box.call("read", { path: ".env" }), undefined);
  } finally { await box.cleanup(); }
});

test("a failed save after in-memory append cannot activate the draft on reload", async () => {
  const box = await sandbox();
  try {
    box.controls.selection = off();
    box.controls.saveFailsAfterAppend = true;
    await box.command();
    assert.notEqual(await box.call("read", { path: ".env" }), undefined);
    await box.emit("session_start", { reason: "reload" });
    assert.notEqual(await box.call("read", { path: ".env" }), undefined);
  } finally { await box.cleanup(); }
});

test("other workspaces and invalid newest state cannot inherit disabled guardrails", async () => {
  const box = await sandbox();
  try {
    box.controls.selection = off();
    await box.command();
    const saved = [...box.controls.branch];
    const other = join(box.root, "other");
    await mkdir(other);
    box.ctx.cwd = other;
    await box.emit("session_start");
    assert.notEqual(await box.call("read", { path: ".env" }), undefined);
    box.ctx.cwd = box.project;
    for (const data of [
      { version: 3, cwd: box.project, features: off() },
      { version: 2, cwd: box.project, features: { writeProtection: false, readProtection: false, riskyCommands: false, telemetry: false } },
      { version: 1, cwd: box.project, features: { ...off(), typo: false } }
    ]) {
      box.controls.branch = [...saved, { type: "custom", customType: featureStateEntry, data, id: "bad", parentId: null, timestamp: "" }];
      await box.emit("session_tree");
      assert.notEqual(await box.call("read", { path: ".env" }), undefined);
      assert.match(box.controls.notifications.at(-1)?.message ?? "", /Invalid LAWb/);
    }
  } finally { await box.cleanup(); }
});

test("invalid config stays fail-closed even with all switches off, and reload clears failed config cache", async () => {
  const box = await sandbox();
  try {
    box.controls.selection = off();
    await box.command();
    await mkdir(join(box.project, ".lawb"));
    await writeFile(join(box.project, ".lawb/config.json"), "not json");
    await assert.rejects(box.emit("session_start", { reason: "reload" }), SyntaxError);
    await assert.rejects(box.call("bash", { command: "ls" }), SyntaxError);
    await writeFile(join(box.project, ".lawb/config.json"), JSON.stringify(resolveConfig()));
    await box.emit("session_start", { reason: "reload" });
    assert.equal(await box.call("bash", { command: "ls" }), undefined);
    assert.notEqual(await box.call("read", {}), undefined);
  } finally { await box.cleanup(); }
});

test("an agent becoming active during confirmation prevents applying draft changes", async () => {
  const box = await sandbox();
  try {
    box.controls.selection = off();
    box.ctx.ui.confirm = async () => { box.controls.idle = false; return true; };
    await box.command();
    assert.equal(box.controls.saved.length, 0);
    assert.notEqual(await box.call("read", { path: ".env" }), undefined);
    assert.match(box.controls.notifications.at(-1)?.message ?? "", /became active/);
  } finally { await box.cleanup(); }
});

test("non-TUI modes, busy agent, malformed selection and failed persistence do not change features", async () => {
  const box = await sandbox();
  try {
    box.controls.selection = off();
    for (const mode of ["print", "json", "rpc"] as const) {
      box.ctx.mode = mode;
      await box.command();
    }
    box.ctx.mode = "tui";
    box.controls.idle = false;
    await box.command();
    assert.equal(box.controls.menuOpened, 0);
    box.controls.idle = true;
    box.controls.selection = { ...off(), telemetry: "false" } as unknown as FeatureStates;
    await box.command();
    box.controls.selection = off();
    box.controls.saveFails = true;
    await box.command();
    assert.equal(box.controls.saved.length, 0);
    assert.notEqual(await box.call("read", { path: ".env" }), undefined);
  } finally { await box.cleanup(); }
});

async function withDocs(box: Awaited<ReturnType<typeof sandbox>>, projectEnabled: boolean): Promise<void> {
  await mkdir(join(box.project, "docs"), { recursive: true });
  await writeFile(join(box.project, "docs", "auth.md"), "# Authentication\n\nTokens expire after fifteen minutes.\n");
  await writeFile(join(box.project, "docs", "other.md"), "# Other\n\nunrelated\n");
  await mkdir(join(box.project, ".lawb"), { recursive: true });
  await writeFile(join(box.project, ".lawb", "config.json"),
    JSON.stringify(resolveConfig({ context: { enabled: projectEnabled, sources: ["**/*.md"] } })));
}

const prompt = (box: Awaited<ReturnType<typeof sandbox>>) => box.emit("before_agent_start", {
  type: "before_agent_start", messageType: "user", prompt: "how do authentication tokens expire", systemPromptOptions: { contextFiles: [] }
});
const request = async (box: Awaited<ReturnType<typeof sandbox>>) => {
  const result = await box.emit("context", { type: "context", messages: [{ role: "user", content: "q" }] }) as
    { messages?: { customType?: string }[] } | undefined;
  return (result?.messages ?? []).filter((message) => message.customType === "lawb-context").length;
};

test("the context switch turns injection on for a session even when the project leaves it off, without a confirmation", async () => {
  const box = await sandbox();
  try {
    await withDocs(box, false);
    await box.emit("session_start");
    await prompt(box);
    assert.equal(await request(box), 0);
    assert.doesNotMatch(box.controls.status, /context/);

    box.controls.selection = { ...defaults(), contextInjection: true };
    await box.command();
    assert.equal(box.controls.confirmations, 0, "context injection is not a guardrail");
    assert.equal(box.controls.saved.length, 1);
    const saved = box.controls.saved[0] as unknown as { data: { version: number; features: FeatureStates } };
    assert.equal(saved.data.version, 2);
    assert.equal(saved.data.features.contextInjection, true);
    assert.match(box.controls.status, /4\/4 \| context/);
    assert.match(box.controls.notifications.at(-1)?.message ?? "", /sends excerpts/);
    await prompt(box);
    assert.equal(await request(box), 1);

    // Reload keeps it; a new session goes back to the project default.
    await box.emit("session_shutdown");
    await box.emit("session_start", { reason: "reload" });
    await prompt(box);
    assert.equal(await request(box), 1);
    box.controls.branch = [];
    await box.emit("session_start", { reason: "new" });
    await prompt(box);
    assert.equal(await request(box), 0);
    const projectConfig = JSON.parse(await readFile(join(box.project, ".lawb", "config.json"), "utf8")) as { context: { enabled: boolean } };
    assert.equal(projectConfig.context.enabled, false, "project config is untouched");
  } finally { await box.cleanup(); }
});

test("turning the switch off stops injection immediately, even for a selection already prepared", async () => {
  const box = await sandbox();
  try {
    await withDocs(box, true);
    await box.emit("session_start");
    await prompt(box);
    assert.equal(await request(box), 1);
    box.controls.selection = { ...defaults(), contextInjection: false };
    await box.command();
    assert.equal(await request(box), 0);
    await prompt(box);
    assert.equal(await request(box), 0);
    assert.doesNotMatch(box.controls.status, /context/);
  } finally { await box.cleanup(); }
});

test("a version 1 entry keeps its guardrail choices and takes context injection from the project", async () => {
  for (const projectEnabled of [true, false]) {
    const box = await sandbox();
    try {
      await withDocs(box, projectEnabled);
      box.controls.branch = [{
        type: "custom", customType: featureStateEntry, id: "old", parentId: null, timestamp: "",
        data: { version: 1, cwd: box.project, features: { writeProtection: true, readProtection: false, riskyCommands: true, telemetry: true } }
      }];
      await box.emit("session_start", { reason: "resume" });
      assert.equal(await box.call("read", { path: ".env" }), undefined, "the saved read-protection choice is kept");
      assert.notEqual(await box.call("write", { path: ".env" }), undefined);
      await prompt(box);
      assert.equal(await request(box), projectEnabled ? 1 : 0);
      assert.equal(box.controls.notifications.some((n) => /Invalid LAWb/.test(n.message)), false);
    } finally { await box.cleanup(); }
  }
});

test("context choices survive a real Pi SessionManager save/open and follow its active tree branch", async () => {
  const box = await sandbox();
  try {
    await withDocs(box, false);
    const native = SessionManager.create(box.project, join(box.root, "sessions"));
    box.controls.nativeSession = native;
    const before = native.appendMessage({ role: "user", content: "fixture task", timestamp: Date.now() });
    box.controls.selection = { ...defaults(), contextInjection: true };
    await box.command();
    const file = native.getSessionFile();
    assert.ok(file);
    await box.emit("session_shutdown");
    box.controls.nativeSession = SessionManager.open(file);
    await box.emit("session_start", { reason: "resume" });
    await prompt(box);
    assert.equal(await request(box), 1);
    box.controls.nativeSession.branch(before);
    await box.emit("session_tree");
    await prompt(box);
    assert.equal(await request(box), 0);
  } finally { await box.cleanup(); }
});

test("turning secret read protection off for the session does not widen what context injection may read", async () => {
  const box = await sandbox();
  try {
    await withDocs(box, true);
    await writeFile(join(box.project, "docs", ".env.md"), "# Env\n\nCANARY-ENV tokens authentication\n");
    box.controls.selection = { ...defaults(), readProtection: false, contextInjection: true };
    await box.command();
    assert.equal(await box.call("read", { path: ".env" }), undefined, "the tool-call guard really is off");
    let injected = "";
    await prompt(box);
    const result = await box.emit("context", { type: "context", messages: [{ role: "user", content: "q" }] }) as
      { messages?: { customType?: string; content?: string }[] } | undefined;
    injected = (result?.messages ?? []).find((message) => message.customType === "lawb-context")?.content ?? "";
    assert.match(injected, /docs\/auth\.md/);
    assert.equal(injected.includes("CANARY-ENV"), false);
  } finally { await box.cleanup(); }
});
