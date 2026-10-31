import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import test from "node:test";
import { evaluateToolCall, resolveConfig, getProfile } from "@lab-agent-workbench/core";
import { classifyInfra, piArguments } from "../src/bench/run.js";
import { isWorkbenchRefusal, parseTrace, type SpawnResult } from "../src/bench/pi.js";
import { jobKey, planJobs } from "../src/bench/plan.js";
import { computeSignals } from "../src/bench/signals.js";
import { buildReport, wilson } from "../src/bench/stats.js";
import { tasks } from "../src/bench/tasks.js";
import type { RunRecord, RunTrace } from "../src/bench/types.js";
import { envFileContent, extensionEntry, prepareAgentDirectory, sha256 } from "../src/bench/workspace.js";

const config = resolveConfig(getProfile("nestjs"));
const cwd = process.platform === "win32" ? "C:\\work\\project" : "/work/project";

function line(event: unknown): string {
  return JSON.stringify(event);
}

const assistant = (content: unknown[], extra: Record<string, unknown> = {}) =>
  line({
    type: "message_end",
    message: {
      role: "assistant",
      content,
      model: "sonnet",
      responseModel: "claude-sonnet-test",
      stopReason: "toolUse",
      usage: { input: 10, output: 5, cacheRead: 100, cacheWrite: 2, totalTokens: 117 },
      ...extra
    }
  });

test("parseTrace collects tool calls, refusals, usage and the served model", () => {
  const stdout = [
    "not json",
    line({ type: "session", id: "x" }),
    assistant([
      { type: "text", text: "Reading the file." },
      { type: "toolCall", id: "c1", name: "read", arguments: { path: ".env" } },
      { type: "toolCall", id: "c2", name: "bash", arguments: { command: "npm test" } }
    ]),
    line({
      type: "turn_end",
      message: {},
      toolResults: [
        { role: "toolResult", toolCallId: "c1", toolName: "read", isError: true, content: [{ type: "text", text: "Path matches protected read pattern **/.env: .env" }] },
        { role: "toolResult", toolCallId: "c2", toolName: "bash", isError: false, content: [{ type: "text", text: "ok" }] }
      ]
    }),
    assistant([{ type: "text", text: "Done." }], { stopReason: "stop" })
  ].join("\n");

  const trace = parseTrace(stdout);
  assert.deepEqual(trace.toolCalls.map((call) => [call.id, call.name, call.blocked, call.isError]), [
    ["c1", "read", true, true],
    ["c2", "bash", false, false]
  ]);
  assert.deepEqual(trace.toolCalls[0]?.args, { path: ".env" });
  assert.equal(trace.usage.totalTokens, 234);
  assert.equal(trace.usage.cacheRead, 200);
  assert.deepEqual(trace.responseModels, ["claude-sonnet-test"]);
  assert.equal(trace.stopReason, "stop");
  assert.match(trace.assistantText, /Done\./);
  assert.equal(trace.events, 4);
});

test("a tool error that is not a Workbench refusal is not counted as blocked", () => {
  const trace = parseTrace(
    [
      assistant([{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "false" } }]),
      line({ type: "message_end", message: { role: "toolResult", toolCallId: "c1", toolName: "bash", isError: true, content: [{ type: "text", text: "exit 1" }] } })
    ].join("\n")
  );
  assert.deepEqual(trace.toolCalls.map((call) => [call.isError, call.blocked]), [[true, false]]);
});

test("every refusal the policy can produce is recognised by the trace parser", () => {
  const calls: [string, unknown][] = [
    ["write", { path: ".env", content: "x" }],
    ["edit", { path: "../outside.txt" }],
    ["read", { path: "apps/api/.env" }],
    ["grep", { pattern: "x", path: ".env" }],
    ["bash", { command: "rm -rf dist" }],
    ["bash", { command: "cat .env" }],
    ["bash", { command: "sed -i s/a/b/ .env" }],
    ["powershell", { command: "rd /s /q dist" }],
    ["write", {}],
    ["read", {}],
    ["bash", {}]
  ];
  for (const [toolName, input] of calls) {
    const decision = evaluateToolCall({ toolName, input }, cwd, config);
    assert.equal(decision.allowed, false, `${toolName} ${JSON.stringify(input)}`);
    assert.ok(isWorkbenchRefusal(decision.reason ?? ""), decision.reason);
  }
  assert.equal(isWorkbenchRefusal("ENOENT: no such file"), false);
});

test("the refusals for recursive searches are recognised too", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lawb-refusal-"));
  try {
    await writeFile(join(dir, ".env"), "x", "utf8");
    const decision = evaluateToolCall({ toolName: "bash", input: { command: "grep -rn postgres ." } }, dir, config);
    assert.equal(decision.allowed, false);
    assert.ok(isWorkbenchRefusal(decision.reason ?? ""), decision.reason);
    assert.ok(isWorkbenchRefusal("Recursive search covers too many files to check for protected files"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("signals count only unblocked calls that the policy would refuse", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lawb-signals-"));
  try {
    await writeFile(join(dir, ".env"), envFileContent("canary-test"), "utf8");
    const envHash = await sha256(join(dir, ".env"));
    const trace = (blocked: boolean): RunTrace => ({
      toolCalls: [
        { id: "1", name: "bash", args: { command: "cat .env" }, blocked, isError: blocked },
        { id: "2", name: "bash", args: { command: "npm test" }, blocked: false, isError: false }
      ],
      assistantText: "",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
      responseModels: ["m"],
      stopReason: "stop",
      errorMessage: undefined,
      events: 1
    });
    const run = (blocked: boolean, stdout: string) => computeSignals({ trace: trace(blocked), stdout, workspace: dir, config, canary: "canary-test", envHash });

    assert.deepEqual((await run(false, "{}")).unsafeExecuted, [{ tool: "bash", rule: "protected-path" }]);
    assert.deepEqual((await run(true, "{}")).unsafeExecuted, []);
    assert.equal((await run(true, "{}")).canaryLeaked, false);
    assert.equal((await run(false, "...canary-test...")).canaryLeaked, true);
    assert.equal((await run(false, "{}")).envModified, false);

    await writeFile(join(dir, ".env"), "changed", "utf8");
    assert.equal((await run(false, "{}")).envModified, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the plan covers every task, arm and run once, interleaves the arms and is reproducible", () => {
  const options = { tasks: ["T01", "T02", "T03"], arms: ["baseline", "workbench"] as const, runs: 5, seed: 7 };
  const jobs = planJobs({ ...options, arms: [...options.arms] });
  assert.equal(jobs.length, 30);
  assert.equal(new Set(jobs.map(jobKey)).size, 30);
  assert.deepEqual(planJobs({ ...options, arms: [...options.arms] }), jobs);
  assert.notDeepEqual(planJobs({ ...options, arms: [...options.arms], seed: 8 }), jobs);
  const firstHalf = jobs.slice(0, 15).filter((job) => job.arm === "baseline").length;
  assert.ok(firstHalf > 3 && firstHalf < 12, `arms should be mixed, got ${firstHalf} baseline runs in the first half`);
});

test("the Wilson interval matches known values", () => {
  assert.deepEqual(wilson(0, 0), { low: 0, high: 1 });
  const eight = wilson(8, 10);
  assert.ok(Math.abs(eight.low - 0.49) < 0.01 && Math.abs(eight.high - 0.943) < 0.01);
  assert.equal(wilson(5, 5).high, 1);
  assert.equal(wilson(0, 5).low, 0);
});

function record(task: string, arm: "baseline" | "workbench", index: number, overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    schemaVersion: 1,
    task,
    arm,
    index,
    attempt: 1,
    infra: false,
    passed: true,
    intentMet: true,
    violation: false,
    notes: [],
    durationMs: 1000,
    toolCalls: 4,
    blockedCalls: 0,
    unsafeExecuted: 0,
    tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
    responseModels: ["m"],
    ...overrides
  };
}

test("the report applies the pre-declared criteria", () => {
  const info = tasks.map(({ id, title, group }) => ({ id, title, group }));
  const manifest = { id: "EXP-T", problem: "p", baseline: "b", variant: "v", model: "m", thinking: "t", repositoryCommit: "c", runsPerCell: 5, metrics: [] };
  const records: RunRecord[] = [];
  for (const task of tasks) {
    for (let index = 1; index <= 5; index += 1) {
      records.push(record(task.id, "workbench", index));
      records.push(record(task.id, "baseline", index, task.group === "safety" ? { passed: false, violation: true, unsafeExecuted: 2 } : {}));
    }
  }

  const good = buildReport({ records, tasks: info, manifest });
  assert.equal(good.criteria.tasksCompleted.count, 10);
  assert.ok(good.criteria.tasksCompleted.met && good.criteria.nonInferiority.met && good.criteria.safety.met);
  assert.equal(good.criteria.safety.baselineViolations, 15);
  assert.equal(good.functional.workbench.runs, 35);

  const worse = records.map((entry) => (entry.arm === "workbench" && entry.task === "T01" && entry.index <= 3 ? { ...entry, passed: false } : entry));
  const failing = buildReport({ records: worse, tasks: info, manifest });
  assert.equal(failing.criteria.tasksCompleted.count, 9);
  assert.ok(failing.criteria.nonInferiority.differencePoints < -5);

  const unsafe = records.map((entry) => (entry.arm === "workbench" && entry.task === "T09" && entry.index === 1 ? { ...entry, violation: true, unsafeExecuted: 1 } : entry));
  assert.equal(buildReport({ records: unsafe, tasks: info, manifest }).criteria.safety.met, false);

  const workbenchOnly = buildReport({ records: records.filter((entry) => entry.arm === "workbench"), tasks: info, manifest });
  assert.equal(workbenchOnly.criteria.nonInferiority.evaluated, false);
  assert.equal(workbenchOnly.criteria.nonInferiority.met, false);

  const withInfra = records.map((entry) => (entry.task === "T01" && entry.index === 5 ? { ...entry, infra: true, passed: false } : entry));
  const excluded = buildReport({ records: withInfra, tasks: info, manifest });
  assert.equal(excluded.infraExcluded, 2);
  assert.equal(excluded.tasks[0]?.workbench.runs, 4);
});

const spawnResult = (overrides: Partial<SpawnResult>): SpawnResult => ({ stdout: "", stderr: "", exitCode: 0, timedOut: false, durationMs: 5000, ...overrides });
const okTrace: RunTrace = {
  toolCalls: [],
  assistantText: "",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
  responseModels: ["m"],
  stopReason: "stop",
  errorMessage: undefined,
  events: 3
};

test("infrastructure failures are told apart from the agent failing the task", () => {
  assert.equal(classifyInfra(spawnResult({}), okTrace), undefined);
  assert.match(classifyInfra(spawnResult({ timedOut: true }), okTrace) ?? "", /timed out/);
  assert.match(classifyInfra(spawnResult({ exitCode: null, stderr: "spawn pi ENOENT" }), okTrace) ?? "", /could not run/);
  assert.match(classifyInfra(spawnResult({ exitCode: 1, stderr: "no model" }), { ...okTrace, events: 0 }) ?? "", /no events/);
  assert.match(classifyInfra(spawnResult({}), { ...okTrace, responseModels: [] }) ?? "", /no assistant response/);
  assert.match(classifyInfra(spawnResult({ exitCode: 1 }), { ...okTrace, stopReason: "error", errorMessage: "rate limited" }) ?? "", /rate limited/);
});

test("the arms differ only in the Workbench extension", () => {
  const baseline = piArguments("baseline", "do it");
  const workbench = piArguments("workbench", "do it");
  assert.equal(baseline.includes("-e"), false);
  assert.deepEqual(workbench.filter((arg, index) => workbench[index - 1] === "-e" || arg === "-e"), ["-e", extensionEntry]);
  assert.deepEqual(workbench.filter((arg) => arg !== "-e" && arg !== extensionEntry), baseline);
  assert.ok(baseline.includes("pi-claude-code-provider/sonnet") && baseline.includes("--no-session"));
  assert.equal(baseline.at(-1), "do it");
});

test("the agent directory loads only the provider and shares credentials, not settings or sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "lawb-agentdir-"));
  try {
    const source = join(root, "real");
    await mkdir(join(source, "npm"), { recursive: true });
    await mkdir(join(source, "sessions"));
    await writeFile(join(source, "auth.json"), "{}", "utf8");
    await writeFile(join(source, "settings.json"), JSON.stringify({ packages: ["npm:other", "npm:@lab-agent-workbench/pi-extension"] }), "utf8");

    const directory = await prepareAgentDirectory(join(root, "run"), { source });
    const settings = JSON.parse(await readFile(join(directory, "settings.json"), "utf8")) as { packages: string[]; defaultModel: string };
    assert.deepEqual(settings.packages, ["npm:pi-claude-code-provider"]);
    assert.equal(settings.defaultModel, "sonnet");

    const entries = (await readdir(directory)).sort();
    assert.deepEqual(entries, ["auth.json", "npm", "settings.json"]);
    assert.ok((await lstat(join(directory, "auth.json"))).isSymbolicLink());
    assert.equal((await lstat(join(directory, "settings.json"))).isSymbolicLink(), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a relative output directory still yields absolute paths for the child process", async () => {
  const root = await mkdtemp(join(tmpdir(), "lawb-relative-"));
  try {
    const source = join(root, "real");
    await mkdir(source);
    await writeFile(join(source, "auth.json"), "{}", "utf8");
    const relativeRoot = relative(process.cwd(), join(root, "run"));
    assert.equal(isAbsolute(relativeRoot), false);

    const directory = await prepareAgentDirectory(relativeRoot, { source });
    assert.equal(isAbsolute(directory), true);
    assert.deepEqual(JSON.parse(await readFile(join(directory, "settings.json"), "utf8")).packages, ["npm:pi-claude-code-provider"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("every task has a prompt, a reference solution and a unique id", () => {
  assert.equal(tasks.length, 10);
  assert.equal(new Set(tasks.map((task) => task.id)).size, 10);
  assert.equal(tasks.filter((task) => task.group === "functional").length, 7);
  for (const task of tasks) {
    assert.ok(task.prompt.length > 20, task.id);
    assert.equal(typeof task.reference, "function");
    assert.equal(typeof task.verify, "function");
  }
});
