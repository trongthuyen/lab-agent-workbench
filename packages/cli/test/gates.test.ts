import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runQualityGates, type GateRunner } from "../src/index.js";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const pass = 'node -e "process.exit(0)"';
const fail = 'node -e "process.exit(3)"';

function scripted(codes: Record<string, number | null>, seen: string[] = []): GateRunner {
  return async (command) => {
    seen.push(command);
    return command in codes ? (codes[command] ?? null) : 0;
  };
}

test("runs every gate in order and reports each result", async () => {
  const seen: string[] = [];
  const results = await runQualityGates({
    cwd: ".",
    commands: ["lint", "typecheck", "test"],
    runner: scripted({}, seen)
  });
  assert.deepEqual(seen, ["lint", "typecheck", "test"]);
  assert.deepEqual(results.map((result) => result.passed), [true, true, true]);
});

test("keeps going after a failure by default and stops with bail", async () => {
  const codes = { typecheck: 2 };
  const all = await runQualityGates({ cwd: ".", commands: ["lint", "typecheck", "test"], runner: scripted(codes) });
  assert.deepEqual(all.map((result) => [result.command, result.passed]), [["lint", true], ["typecheck", false], ["test", true]]);

  const seen: string[] = [];
  const bailed = await runQualityGates({
    cwd: ".",
    commands: ["lint", "typecheck", "test"],
    bail: true,
    runner: scripted(codes, seen)
  });
  assert.deepEqual(seen, ["lint", "typecheck"]);
  assert.equal(bailed.at(-1)?.exitCode, 2);
});

test("a gate killed by a signal counts as failed", async () => {
  const [result] = await runQualityGates({ cwd: ".", commands: ["lint"], runner: scripted({ lint: null }) });
  assert.equal(result?.passed, false);
  assert.equal(result?.exitCode, null);
});

test("real commands run in the given directory and report their exit code", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "lawb-gates-"));
  try {
    await writeFile(join(cwd, "marker.txt"), "x", "utf8");
    const results = await runQualityGates({
      cwd,
      commands: ['node -e "process.exit(require(\'fs\').existsSync(\'marker.txt\') ? 0 : 1)"', fail]
    });
    assert.deepEqual(results.map((result) => result.exitCode), [0, 3]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

async function project(commands: string[] | undefined): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "lawb-gates-"));
  if (commands) {
    await mkdir(join(cwd, ".lawb"));
    await writeFile(join(cwd, ".lawb", "config.json"), JSON.stringify({ qualityGates: { commands } }), "utf8");
  }
  return cwd;
}

function lawb(cwd: string, ...args: string[]) {
  return spawnSync(process.execPath, [cli, "gates", ...args], { cwd, encoding: "utf8" });
}

test("lawb gates prints the commands, runs them and exits 0 when all pass", async () => {
  const cwd = await project([pass, pass]);
  try {
    const result = lawb(cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Running 2 quality gate\(s\)/);
    assert.match(result.stdout, /PASS/);
    assert.match(result.stdout, /Quality gates passed/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("lawb gates exits 1 when a gate fails and lists it", async () => {
  const cwd = await project([fail, pass]);
  try {
    const result = lawb(cwd);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL/);
    assert.match(result.stdout, /Quality gates failed: 1 of 2/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("lawb gates --bail skips the gates after the first failure", async () => {
  const cwd = await project([fail, pass]);
  try {
    const result = lawb(cwd, "--bail");
    assert.equal(result.status, 1);
    assert.match(result.stdout, /Quality gates failed: 1 of 1/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("lawb gates fails when no gates are configured or there is no config", async () => {
  const empty = await project([]);
  const missing = await project(undefined);
  try {
    assert.equal(lawb(empty).status, 1);
    assert.match(lawb(empty).stderr, /No quality gates configured/);
    assert.equal(lawb(missing).status, 1);
    assert.match(lawb(missing).stderr, /lawb init/);
  } finally {
    await rm(empty, { recursive: true, force: true });
    await rm(missing, { recursive: true, force: true });
  }
});
