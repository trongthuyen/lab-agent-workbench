import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { resolveConfig } from "@lab-agent-workbench/core";
import { formatInspect, inspectContext } from "../src/context.js";

const run = promisify(execFile);
const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "cli.js");

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lawb-inspect-"));
  const files: Record<string, string> = {
    "docs/auth.md": "# Authentication\n\nTOKEN-BODY-TEXT tokens expire quickly.\n",
    "docs/.env.md": "# Env\n\nCANARY-SECRET tokens\n",
    "docs/other.md": "# Other\n\nunrelated\n"
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

test("inspect explains selection and skips without printing document text", async () => {
  const root = await project();
  try {
    const config = resolveConfig();
    const report = await inspectContext({ root, query: "authentication tokens", config });
    const text = formatInspect(report);
    assert.match(text, /docs\/auth\.md:1-3/);
    assert.match(text, /docs\/\.env\.md {2}protected/);
    assert.match(text, /context\.enabled is false/);
    assert.ok(!text.includes("TOKEN-BODY-TEXT") && !text.includes("CANARY"));
    assert.ok(!JSON.stringify(report).includes("TOKEN-BODY-TEXT"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("lawb context inspect runs from the command line and validates its arguments", async () => {
  const root = await project();
  try {
    const { stdout } = await run(process.execPath, [cli, "context", "inspect", "--query", "authentication tokens", "--json"], { cwd: root });
    const report = JSON.parse(stdout) as { selected: { path: string }[]; contextEnabled: boolean };
    assert.deepEqual(report.selected.map((chunk) => chunk.path), ["docs/auth.md"]);
    assert.equal(report.contextEnabled, false);
    await assert.rejects(run(process.execPath, [cli, "context", "inspect"], { cwd: root }), /requires --query/);
    await assert.rejects(run(process.execPath, [cli, "context", "other"], { cwd: root }), /Usage: lawb context inspect/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
