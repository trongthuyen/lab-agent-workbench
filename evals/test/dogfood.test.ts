import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { formatRow, summarizeSession, tableHeader } from "../src/dogfood.js";

const cwd = "/work/project";
const assistant = (at: number, usage: unknown, calls: string[] = [], model = "m-1") => ({
  type: "message", timestamp: new Date(at).toISOString(),
  message: {
    role: "assistant", model, durationMs: 100, timestamp: at,
    ...(usage === undefined ? {} : { usage }),
    content: [{ type: "text", text: "SECRET-ANSWER-TEXT" }, ...calls.map((name) => ({ type: "toolCall", name, arguments: { path: "SECRET-ARG" } }))]
  }
});
const usage = (input: number, cacheRead: number, total = 0) => ({ input, output: 10, cacheRead, cacheWrite: 5, totalTokens: 0, cost: { total } });
const jsonl = (rows: unknown[]) => rows.map((row) => JSON.stringify(row)).join("\n");

const session = jsonl([
  { type: "session", cwd, timestamp: new Date(1_000).toISOString() },
  { type: "message", timestamp: new Date(1_100).toISOString(), message: { role: "user", content: "SECRET-PROMPT" } },
  assistant(2_000, usage(100, 1000), ["read", "grep"]),
  { type: "message", timestamp: new Date(2_500).toISOString(), message: { role: "toolResult", content: "SECRET-RESULT" } },
  assistant(5_000, usage(50, 2000, 0.25), ["bash", "read"], "m-2")
]);

test("totals usage, counts tools and times a session without copying any text", () => {
  const summary = summarizeSession("with-context", session);
  assert.deepEqual(summary.usage, { input: 150, output: 20, cacheRead: 3000, cacheWrite: 10 });
  assert.equal(summary.costTotal, 0.25);
  assert.equal(summary.assistantTurns, 2);
  assert.equal(summary.toolCalls, 4);
  assert.deepEqual(summary.toolCallsByName, { bash: 1, grep: 1, read: 2 });
  assert.equal(summary.readSearchCalls, 3);
  assert.equal(summary.modelMs, 200);
  assert.equal(summary.wallMs, 4_000);
  assert.deepEqual(summary.models, ["m-1", "m-2"]);
  assert.equal(summary.context, null);
  const output = JSON.stringify(summary) + formatRow(summary);
  for (const secret of ["SECRET-ANSWER-TEXT", "SECRET-ARG", "SECRET-PROMPT", "SECRET-RESULT"]) {
    assert.ok(!output.includes(secret), `${secret} must not be copied`);
  }
});

test("missing usage is unavailable, never zero, and partial usage is flagged", () => {
  const none = summarizeSession("a", jsonl([{ type: "session", cwd }, assistant(1_000, undefined)]));
  assert.equal(none.usage, null);
  assert.equal(none.costTotal, null);
  assert.match(formatRow(none), /unavailable \| unavailable \| unavailable \| unavailable \| unavailable/);

  const partial = summarizeSession("b", jsonl([{ type: "session", cwd }, assistant(1_000, usage(7, 0)), assistant(2_000, undefined)]));
  assert.equal(partial.usage?.input, 7);
  assert.equal(partial.turnsWithoutUsage, 1);
  assert.match(formatRow(partial), /\+1 turn\(s\) without usage/);
});

test("a torn last line and an empty file are tolerated", () => {
  const torn = summarizeSession("t", `${session}\n{"type":"message","mess`);
  assert.equal(torn.assistantTurns, 2);
  const empty = summarizeSession("e", "");
  assert.equal(empty.assistantTurns, 0);
  assert.equal(empty.wallMs, null);
  assert.equal(empty.modelMs, null);
});

test("context telemetry is matched by workspace and session window and holds counters only", () => {
  const record = (over: Record<string, unknown>) => ({ type: "context", cwd, timestamp: new Date(3_000).toISOString(), outcome: "injected", injectedTokensEstimate: 400, retrievalMs: 12, ...over });
  const telemetry = jsonl([
    record({}),
    record({ outcome: "skipped", reason: "no-match", injectedTokensEstimate: undefined, retrievalMs: 3 }),
    record({ outcome: "error" }),
    record({ cwd: "/elsewhere" }),
    record({ timestamp: new Date(999_000).toISOString() }),
    { type: undefined, cwd, toolName: "read" }
  ]);
  const summary = summarizeSession("c", session, telemetry);
  assert.deepEqual(summary.context, { records: 3, injected: 1, skipped: 1, errors: 1, injectedTokensEstimate: 800, retrievalMs: 27 });
  assert.match(formatRow(summary), /\| 800 \| 27 \|/);
});

test("the command line prints a table row, or JSON, and asks for its arguments", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lawb-dogfood-"));
  try {
    await writeFile(join(dir, "s.jsonl"), session);
    const cli = fileURLToPath(new URL("../../dist/dogfood-cli.js", import.meta.url));
    const run = promisify(execFile);
    const table = await run(process.execPath, [cli, "--session", join(dir, "s.jsonl"), "--label", "ctx-on"]);
    assert.ok(table.stdout.startsWith(tableHeader));
    assert.match(table.stdout, /\| ctx-on \| 2 \| 150 \|/);
    const json = JSON.parse((await run(process.execPath, [cli, "--session", join(dir, "s.jsonl"), "--label", "x", "--json"])).stdout) as { toolCalls: number };
    assert.equal(json.toolCalls, 4);
    await assert.rejects(run(process.execPath, [cli, "--label", "x"]), /Usage: dogfood/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
