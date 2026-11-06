import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { resolveConfig, type ConfigLayer } from "@lab-agent-workbench/core";
import { createLabAgentWorkbench } from "../src/index.js";

type Message = { role: string; customType?: string; content?: unknown };
type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<{ messages?: Message[] } | undefined>;

interface Box {
  project: string;
  handlers: Record<string, Handler>;
  notices: { message: string; type: string }[];
  usage: { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
  signal: AbortSignal | undefined;
  ctx: () => Record<string, unknown>;
  start: (prompt: string, contextFiles?: { path: string }[]) => Promise<unknown>;
  request: (messages: Message[]) => Promise<Message[] | undefined>;
  telemetry: () => Promise<Record<string, unknown>[]>;
  cleanup: () => Promise<void>;
}

const docs: Record<string, string> = {
  "docs/auth.md": "# Authentication\n\nTokens expire after fifteen minutes. CANARY-DOC-TEXT\n",
  "docs/billing.md": "# Billing\n\nInvoices are monthly.\n",
  "docs/other.md": "# Other\n\nunrelated\n"
};

async function sandbox(layer: ConfigLayer | null = { context: { enabled: true, sources: ["**/*.md"] } }): Promise<Box> {
  const root = await mkdtemp(join(tmpdir(), "lawb-ctx-ext-"));
  const project = join(root, "project");
  const home = join(root, "home");
  await mkdir(project);
  await mkdir(home);
  for (const [path, content] of Object.entries(docs)) {
    await mkdir(dirname(join(project, path)), { recursive: true });
    await writeFile(join(project, path), content);
  }
  if (layer) {
    await mkdir(join(project, ".lawb"));
    await writeFile(join(project, ".lawb", "config.json"), JSON.stringify(resolveConfig(layer)));
  }
  const handlers: Record<string, Handler> = {};
  createLabAgentWorkbench({ homeDirectory: home })({
    on: (name: string, handler: Handler) => { handlers[name] = handler; },
    registerCommand: () => {}
  } as never);
  const box: Box = {
    project,
    handlers,
    notices: [],
    usage: { tokens: 1000, contextWindow: 100_000, percent: 1 },
    signal: undefined,
    ctx: () => ({
      cwd: project,
      hasUI: true,
      signal: box.signal,
      getContextUsage: () => box.usage,
      ui: { notify: (message: string, type: string) => box.notices.push({ message, type }), setStatus() {} }
    }),
    start: (prompt, contextFiles = []) => handlers.before_agent_start!(
      { type: "before_agent_start", messageType: "user", prompt, systemPromptOptions: { contextFiles } }, box.ctx()),
    request: async (messages) => (await handlers.context!({ type: "context", messages }, box.ctx()))?.messages,
    telemetry: async () => {
      const text = await readFile(join(project, ".lawb", "runs", "telemetry.jsonl"), "utf8").catch(() => "");
      return text.trim() === "" ? [] : text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    },
    cleanup: () => rm(root, { recursive: true, force: true })
  };
  return box;
}

const user = (text: string): Message => ({ role: "user", content: text });
const injected = (messages: Message[] | undefined) => (messages ?? []).filter((m) => m.customType === "lawb-context");
const text = (message: Message | undefined) => String(message?.content);

test("with context disabled (the default) nothing is retrieved, injected or logged", async () => {
  const box = await sandbox({});
  try {
    assert.equal(await box.start("how do authentication tokens expire"), undefined);
    assert.equal(await box.request([user("hi")]), undefined);
    assert.deepEqual(await box.telemetry(), []);
  } finally { await box.cleanup(); }
});

test("one transient message is placed before the latest user message and is never duplicated", async () => {
  const box = await sandbox();
  try {
    await box.start("how do authentication tokens expire");
    const history: Message[] = [user("earlier"), { role: "assistant" }, user("how do authentication tokens expire")];
    const first = await box.request(history);
    assert.equal(injected(first).length, 1);
    assert.equal(first?.at(-2)?.customType, "lawb-context");
    assert.equal(first?.at(-1)?.role, "user");
    assert.match(text(first?.at(-2)), /trust="untrusted"/);
    assert.match(text(first?.at(-2)), /docs\/auth\.md:1-3/);

    // The next LLM call of the same turn (after a tool ran) still has exactly one, identical block.
    const loop = [...history, { role: "assistant" }, { role: "toolResult" }];
    const second = await box.request(loop);
    assert.equal(injected(second).length, 1);
    assert.equal(text(injected(second)[0]), text(injected(first)[0]));

    // A stale Workbench message already in the request is replaced, not stacked.
    const stacked = await box.request([user("earlier"), { role: "custom", customType: "lawb-context", content: "OLD" }, user("x")]);
    assert.equal(injected(stacked).length, 1);
    assert.ok(!text(injected(stacked)[0]).includes("OLD"));
  } finally { await box.cleanup(); }
});

test("the next prompt starts clean: no carry-over, and a stale message is removed", async () => {
  const box = await sandbox();
  try {
    await box.start("how do authentication tokens expire");
    assert.equal(injected(await box.request([user("q")])).length, 1);

    await box.start("kubernetes ingress"); // no match
    const request = await box.request([user("q"), { role: "custom", customType: "lawb-context", content: "OLD" }, user("kubernetes")]);
    assert.equal(injected(request).length, 0);
    assert.deepEqual(request?.map((m) => m.role), ["user", "user"]);
  } finally { await box.cleanup(); }
});

test("other extensions' messages are left exactly as they were", async () => {
  const box = await sandbox();
  try {
    await box.start("how do authentication tokens expire");
    const other: Message = { role: "custom", customType: "someone-else", content: "keep me" };
    const result = await box.request([other, user("q"), other]);
    assert.deepEqual(result?.filter((m) => m !== undefined && m.customType !== "lawb-context"), [other, user("q"), other]);
    assert.equal(result?.indexOf(other), 0);
  } finally { await box.cleanup(); }
});

test("no match injects nothing and records why; telemetry holds counters but no content", async () => {
  const box = await sandbox();
  try {
    await box.start("kubernetes ingress SECRET-QUERY-CANARY");
    assert.equal(await box.request([user("q")]), undefined);
    await box.start("how do authentication tokens expire");
    await box.request([user("q")]);

    const rows = await box.telemetry();
    assert.deepEqual(rows.map((row) => [row.outcome, row.reason]), [["skipped", "no-match"], ["injected", undefined]]);
    const injectedRow = rows[1]!;
    assert.equal(injectedRow.type, "context");
    assert.equal(injectedRow.injectedChunks, 1);
    assert.ok(Number(injectedRow.injectedTokensEstimate) > 0 && Number(injectedRow.injectedBytes) > 0);
    assert.equal(injectedRow.contextTokens, 1000);
    assert.equal(typeof injectedRow.retrievalMs, "number");
    const raw = JSON.stringify(rows);
    for (const secret of ["SECRET-QUERY-CANARY", "CANARY-DOC-TEXT", "auth.md", "Tokens expire", "authentication"]) {
      assert.ok(!raw.includes(secret), `telemetry must not contain ${secret}`);
    }
  } finally { await box.cleanup(); }
});

test("a source edited or removed during the turn is dropped instead of injected stale", async () => {
  const box = await sandbox();
  try {
    await box.start("how do authentication tokens expire");
    assert.equal(injected(await box.request([user("q")])).length, 1);
    await writeFile(join(box.project, "docs/auth.md"), "# Authentication\n\nTokens now expire after an hour.\n");
    assert.equal(injected(await box.request([user("q")])).length, 0);
  } finally { await box.cleanup(); }
});

test("files Pi already put in the system prompt are not repeated", async () => {
  const box = await sandbox();
  try {
    await box.start("how do authentication tokens expire", [{ path: join(box.project, "docs", "auth.md") }]);
    assert.equal(await box.request([user("q")]), undefined);
  } finally { await box.cleanup(); }
});

test("context pressure shrinks or skips injection; unknown usage is not treated as zero", async () => {
  const box = await sandbox();
  try {
    box.usage = { tokens: 99_500, contextWindow: 100_000, percent: 99.5 };
    await box.start("how do authentication tokens expire");
    assert.equal(await box.request([user("q")]), undefined);
    assert.equal((await box.telemetry()).at(-1)?.reason, "context-pressure");
    assert.equal(box.notices.filter((n) => n.type === "warning").length, 1);
    await box.start("how do authentication tokens expire");
    assert.equal(box.notices.length, 1, "the pressure warning is shown once");

    box.usage = { tokens: null, contextWindow: 8000, percent: null };
    await box.start("how do authentication tokens expire");
    assert.equal(injected(await box.request([user("q")])).length, 1);
    const row = (await box.telemetry()).at(-1);
    assert.equal(row?.contextTokens, null);
    assert.equal(row?.budgetTokens, 800);

    box.usage = undefined;
    await box.start("how do authentication tokens expire");
    assert.equal(injected(await box.request([user("q")])).length, 1);
  } finally { await box.cleanup(); }
});

test("a retrieval failure drops the extra context, tells the user once and never throws", async () => {
  const box = await sandbox();
  try {
    box.signal = AbortSignal.abort();
    await box.start("how do authentication tokens expire");
    await box.start("how do authentication tokens expire");
    assert.equal(await box.request([user("q")]), undefined);
    assert.equal((await box.telemetry()).at(-1)?.outcome, "error");
    assert.equal(box.notices.filter((n) => /retrieval failed/.test(n.message)).length, 1);
  } finally { await box.cleanup(); }
});

test("only user prompts trigger retrieval, and broken project config never throws from the hooks", async () => {
  const box = await sandbox();
  try {
    await box.handlers.before_agent_start!(
      { type: "before_agent_start", messageType: "custom", message: {}, systemPromptOptions: { contextFiles: [] } }, box.ctx());
    assert.equal(await box.request([user("q")]), undefined);

    await writeFile(join(box.project, ".lawb", "config.json"), "{ not json");
    const broken = await sandbox({});
    await writeFile(join(broken.project, ".lawb", "config.json"), "{ not json");
    try {
      assert.equal(await broken.start("how do authentication tokens expire"), undefined);
      assert.equal(await broken.request([user("q")]), undefined);
    } finally { await broken.cleanup(); }
  } finally { await box.cleanup(); }
});

test("a session transition clears the pending selection", async () => {
  const box = await sandbox();
  try {
    await box.start("how do authentication tokens expire");
    await box.handlers.session_shutdown!({ type: "session_shutdown" }, box.ctx());
    assert.equal(await box.request([user("q")]), undefined);
  } finally { await box.cleanup(); }
});
