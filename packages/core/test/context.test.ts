import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { chunkFile, discoverSources, queryTerms, resolveConfig, retrieveContext, type ConfigLayer } from "../src/index.js";

const cfg = (layer: ConfigLayer = {}) => resolveConfig({ context: { enabled: true, sources: ["**/*.md"] } }, layer);

async function workspace(files: Record<string, string | Buffer>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lawb-context-"));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

async function withWorkspace(files: Record<string, string | Buffer>, run: (root: string) => Promise<void>): Promise<void> {
  const root = await workspace(files);
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const paths = (selected: { path: string }[]) => selected.map((chunk) => chunk.path);

test("query terms drop stopwords, split camelCase and de-duplicate", () => {
  assert.deepEqual(queryTerms("How does the UserService handle user_login?"), ["user", "service", "handle", "login"]);
  assert.deepEqual(queryTerms("the of and"), []);
});

test("ranks the matching document first and cites exact line ranges", async () => {
  await withWorkspace({
    "docs/auth.md": "# Authentication\n\nTokens expire after fifteen minutes.\nRefresh tokens rotate.\n",
    "docs/billing.md": "# Billing\n\nInvoices are generated monthly.\n",
    "docs/misc.md": "# Misc\n\nNothing relevant here.\n"
  }, async (root) => {
    const result = await retrieveContext({ root, query: "authentication tokens", config: cfg() });
    assert.deepEqual(paths(result.selected), ["docs/auth.md"]);
    assert.equal(result.selected[0]?.startLine, 1);
    assert.equal(result.selected[0]?.endLine, 4);
    assert.match(result.selected[0]?.hash ?? "", /^[0-9a-f]{16}$/);
  });
});

test("no match, or only stopwords, selects nothing instead of filling the quota", async () => {
  await withWorkspace({ "docs/a.md": "# Alpha\n\nSome text.\n", "docs/b.md": "# Beta\n\nOther text.\n" }, async (root) => {
    assert.deepEqual((await retrieveContext({ root, query: "kubernetes", config: cfg() })).selected, []);
    const stop = await retrieveContext({ root, query: "the and of", config: cfg() });
    assert.deepEqual(stop.selected, []);
    assert.equal(stop.queryTerms, 0);
  });
});

test("equal scores are ordered by path and then position, identically on every run", async () => {
  const files: Record<string, string> = Object.fromEntries(
    ["d", "b", "c", "a"].map((name) => [`docs/${name}.md`, `# Notes\n\nwidget ${name}${name}\n`])
  );
  files["docs/other.md"] = "# Other\n\nunrelated text\n";
  await withWorkspace(files, async (root) => {
    const config = cfg({ context: { maxChunks: 10 } });
    const first = await retrieveContext({ root, query: "widget", config });
    const second = await retrieveContext({ root, query: "widget", config });
    assert.deepEqual(paths(first.selected), ["docs/a.md", "docs/b.md", "docs/c.md", "docs/d.md"]);
    assert.deepEqual(first.selected.map((c) => c.hash), second.selected.map((c) => c.hash));
  });
});

test("identical chunks in different files are de-duplicated and the later one is reported", async () => {
  const files: Record<string, string> = Object.fromEntries(
    ["b", "a"].map((name) => [`docs/${name}.md`, "# Notes\n\nwidget gadget\n"])
  );
  files["docs/other.md"] = "# Other\n\nunrelated text\n";
  await withWorkspace(files, async (root) => {
    const result = await retrieveContext({ root, query: "widget", config: cfg() });
    assert.deepEqual(paths(result.selected), ["docs/a.md"]);
    assert.deepEqual(result.rejected.map((c) => [c.path, c.reason]), [["docs/b.md", "duplicate"]]);
  });
});

test("distinct documents beyond maxChunks are reported as over-limit", async () => {
  const files = Object.fromEntries(["a", "b", "c"].map((name) => [`docs/${name}.md`, `# Widget ${name}\n\nwidget ${name} body\n`]));
  await withWorkspace(files, async (root) => {
    const result = await retrieveContext({ root, query: "widget", config: cfg({ context: { maxChunks: 2 } }) });
    assert.equal(result.selected.length, 2);
    assert.deepEqual(result.rejected.map((c) => c.reason), ["over-limit"]);
  });
});

test("weak matches stay below the threshold", async () => {
  await withWorkspace({
    "docs/a.md": "# One\n\nfoo bar baz\n",
    "docs/b.md": "# Two\n\nfoo qux\n",
    "docs/c.md": "# Three\n\nfoo quux\n"
  }, async (root) => {
    // "foo" is in every chunk, so it carries almost no weight and must not select anything alone.
    const result = await retrieveContext({ root, query: "foo", config: cfg() });
    assert.deepEqual(result.selected, []);
    assert.ok(result.rejected.every((entry) => entry.reason === "below-threshold"));
  });
});

test("chunks respect maxChunkTokens, never split fenced headings, and keep line numbers", () => {
  const long = Array.from({ length: 40 }, (_, i) => `line ${i} ${"word ".repeat(10)}`).join("\n");
  const file = { path: "docs/long.md", text: `# Title\n\n${long}\n\n\`\`\`\n# not a heading\n\`\`\`\n`, bytes: 1, sourceIndex: 0 };
  const config = cfg({ context: { maxChunkTokens: 100, maxInjectedTokens: 400 } });
  const chunks = chunkFile(file, config);
  assert.ok(chunks.length > 3);
  assert.ok(chunks.every((chunk) => chunk.tokens <= 100));
  assert.ok(chunks.every((chunk) => chunk.startLine <= chunk.endLine));
  assert.equal(chunks.filter((chunk) => chunk.heading === "not a heading").length, 0);
});

test("a single line longer than the chunk limit is cut and still bounded", () => {
  const file = { path: "docs/x.md", text: `# T\n\n${"x".repeat(5000)}\n`, bytes: 1, sourceIndex: 0 };
  const chunks = chunkFile(file, cfg({ context: { maxChunkTokens: 50, maxInjectedTokens: 400 } }));
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((chunk) => chunk.tokens <= 50));
});

test("secret-looking values are redacted in chunk text, and the hash describes the redacted text", async () => {
  await withWorkspace({ "docs/ops.md": "# Deploy runbook\n\nSet password = hunter2secret before deploy runbook.\n" }, async (root) => {
    const result = await retrieveContext({ root, query: "deploy runbook", config: cfg() });
    assert.equal(result.selected.length, 1);
    const text = result.selected[0]?.text ?? "";
    assert.ok(!text.includes("hunter2secret"));
    assert.match(text, /\[REDACTED\]/);
  });
});

test("protected read paths are never read and canaries never reach the result", async () => {
  await withWorkspace({
    "docs/.env.md": "# Env\n\nCANARY-ENV-SECRET deploy\n",
    "docs/private/keys.md": "# Keys\n\nCANARY-PRIVATE deploy\n",
    "docs/public.md": "# Deploy\n\ndeploy steps\n"
  }, async (root) => {
    const config = cfg({ policies: { protectedReadPaths: ["**/.env", "**/.env.*", "docs/private/**"] } });
    const result = await retrieveContext({ root, query: "deploy", config });
    assert.deepEqual(paths(result.selected), ["docs/public.md"]);
    assert.deepEqual(result.skipped.map((entry) => [entry.path, entry.reason]).sort(), [
      ["docs/.env.md", "protected"], ["docs/private/keys.md", "protected"]
    ]);
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes("CANARY"));
  });
});

test("internal exclusions apply whatever context.sources says, in any letter case", async () => {
  await withWorkspace({
    "node_modules/pkg/README.md": "# Pkg\n\nCANARY widget\n",
    "Node_Modules/Other/README.md": "# Other\n\nCANARY widget\n",
    ".git/notes.md": "# Git\n\nCANARY widget\n",
    ".lawb/runs/notes.md": "# Run\n\nCANARY widget\n",
    "dist/out.md": "# Dist\n\nCANARY widget\n",
    "docs/telemetry.jsonl": "CANARY widget\n",
    "docs/ok.md": "# Widget\n\nwidget docs\n"
  }, async (root) => {
    const config = cfg({ context: { sources: ["**/*", "**/*.md", "node_modules/**", ".git/**", ".lawb/**"] } });
    const scan = await discoverSources({ root, config });
    assert.deepEqual(scan.files.map((file) => file.path), ["docs/ok.md"]);
    const result = await retrieveContext({ root, query: "widget", config });
    assert.ok(!JSON.stringify(result).includes("CANARY"));
  });
});

test("size, scan, binary and encoding limits skip files instead of truncating them", async () => {
  await withWorkspace({
    "docs/a.md": "# A\n\nalpha\n",
    "docs/big.md": `# Big\n\n${"x ".repeat(2000)}\n`,
    "docs/bin.md": Buffer.from([0x23, 0x20, 0x00, 0x41]),
    "docs/latin1.md": Buffer.from([0x23, 0x20, 0xe9, 0xff, 0xfe]),
    "docs/z.md": "# Z\n\nzeta\n"
  }, async (root) => {
    const scan = await discoverSources({ root, config: cfg({ context: { maxFileBytes: 1024 } }) });
    const reasons = Object.fromEntries(scan.skipped.map((entry) => [entry.path, entry.reason]));
    assert.deepEqual(reasons, { "docs/big.md": "too-large", "docs/bin.md": "binary", "docs/latin1.md": "binary" });
    assert.deepEqual(scan.files.map((file) => file.path), ["docs/a.md", "docs/z.md"]);

    const limited = await discoverSources({ root, config: cfg({ context: { maxFilesScanned: 1 } }) });
    assert.equal(limited.files.length, 1);
    assert.equal(limited.truncated, true);
    assert.ok(limited.skipped.some((entry) => entry.reason === "scan-limit"));

    const bytes = await discoverSources({ root, config: cfg({ context: { maxBytesScanned: 15, maxFileBytes: 15 } }) });
    assert.equal(bytes.truncated, true);
    assert.ok(bytes.bytesRead <= 15);
  });
});

test("an aborted signal stops the scan", async () => {
  await withWorkspace({ "docs/a.md": "# A\n\nalpha\n" }, async (root) => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(retrieveContext({ root, query: "alpha", config: cfg(), signal: controller.signal }), { name: "AbortError" });
  });
});

async function tryLink(target: string, path: string, type?: "dir" | "junction" | "file"): Promise<boolean> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await symlink(target, path, type);
    return true;
  } catch {
    return false;
  }
}

test("symlinks never lead outside the workspace or around a protected file", async (t) => {
  const outside = await workspace({ "secret.md": "# Secret\n\nCANARY-OUTSIDE widget\n", "dir/inner.md": "# Inner\n\nCANARY-DIR widget\n" });
  const root = await workspace({
    "docs/real.md": "# Widget\n\nwidget docs\n",
    "docs/.env.md": "# Env\n\nCANARY-ALIAS widget\n",
    "docs/inside.md": "# Inside\n\ninside widget alias target\n"
  });
  try {
    const links = {
      file: await tryLink(join(outside, "secret.md"), join(root, "docs", "escape.md"), "file"),
      dir: await tryLink(join(outside, "dir"), join(root, "docs", "linked"), "junction"),
      alias: await tryLink(join(root, "docs", ".env.md"), join(root, "docs", "alias.md"), "file"),
      inside: await tryLink(join(root, "docs", "inside.md"), join(root, "docs", "inside-link.md"), "file")
    };
    if (!Object.values(links).some(Boolean)) {
      t.skip("symlinks cannot be created on this platform");
      return;
    }
    const result = await retrieveContext({ root, query: "widget", config: cfg() });
    assert.ok(!JSON.stringify(result).includes("CANARY"));
    const reasons = Object.fromEntries(result.skipped.map((entry) => [entry.path, entry.reason]));
    if (links.file) assert.equal(reasons["docs/escape.md"], "outside-workspace");
    if (links.dir) assert.equal(reasons["docs/linked"], "symlink");
    if (links.alias) assert.equal(reasons["docs/alias.md"], "protected");
    if (links.inside) assert.ok((await discoverSources({ root, config: cfg() })).files.some((file) => file.path === "docs/inside-link.md"));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
