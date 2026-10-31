import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { evaluateRecursiveSearch, evaluateToolCall, resolveConfig } from "../src/index.js";

const config = resolveConfig();

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lawb-search-"));
  const files = [".env", ".env.example", "src/a.ts", "apps/api/.env", "apps/api/main.ts", "node_modules/pkg/.env", "docs/readme.md"];
  for (const file of files) {
    await mkdir(join(root, file, ".."), { recursive: true });
    await writeFile(join(root, file), "x", "utf8");
  }
  return root;
}

const decide = (cwd: string, command: string) => evaluateToolCall({ toolName: "bash", input: { command } }, cwd, config);

test("a recursive search over a tree that holds an env file is blocked", async () => {
  const cwd = await workspace();
  try {
    for (const command of [
      'grep -rniE "postgres|DATABASE_URL|PGHOST" --exclude-dir=node_modules --exclude-dir=.git . | head -60',
      "grep -rn postgres .",
      "grep -R postgres",
      "grep -rn postgres apps",
      "grep --recursive postgres .",
      "grep -d recurse postgres .",
      "egrep -r 'a|b' .",
      "rgrep postgres",
      "grep -rne postgres .",
      "ack postgres",
      "rg --hidden postgres",
      "rg -uu postgres",
      "ag --hidden postgres",
      "cd /tmp && grep -r postgres . ; echo done"
    ]) {
      const decision = decide(cwd, command.replace("cd /tmp && ", ""));
      assert.equal(decision.allowed, false, command);
      assert.equal(decision.rule, "protected-path", command);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("the refusal names the file and tells the agent how to search safely", async () => {
  const cwd = await workspace();
  try {
    const decision = decide(cwd, "grep -rn postgres .");
    assert.match(decision.reason ?? "", /Recursive search would read .*\.env/);
    assert.match(decision.reason ?? "", /--exclude='\.env\*'/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("a recursive search that cannot reach a protected file is allowed", async () => {
  const cwd = await workspace();
  try {
    for (const command of [
      "grep -rn postgres src",
      "grep -rn postgres src docs",
      "grep -rn postgres docs/readme.md",
      "grep -n postgres src/a.ts",
      "grep -rn --include='*.ts' postgres src",
      "rg postgres",
      "rg -g '*.ts' postgres",
      "ag postgres",
      "grep -rn \"tasks.service\\|Task\\b\" --include=*.ts . --exclude-dir=node_modules",
      "grep -rn postgres --include='*.ts' --include='*.md' .",
      "grep -rn postgres --include *.ts .",
      "rg --hidden -g '*.ts' postgres",
      "git grep -n postgres",
      "ls -R",
      "cat src/a.ts | grep postgres",
      "grep -rn postgres nonexistent-dir"
    ]) {
      assert.deepEqual(decide(cwd, command), { allowed: true }, command);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("excluding the protected files makes a recursive search allowed", async () => {
  const cwd = await workspace();
  try {
    for (const command of [
      "grep -rn postgres --exclude='.env*' .",
      'grep -rniE "postgres|DB_" --exclude=.env --exclude=".env.*" .',
      "grep -rn postgres --exclude .env --exclude '.env.*' .",
      "rg --hidden -g '!.env*' postgres",
      "grep -rn postgres --exclude-dir=apps --exclude='.env*' ."
    ]) {
      assert.deepEqual(decide(cwd, command), { allowed: true }, command);
    }
    // Excluding only part of what is there is not enough.
    assert.equal(decide(cwd, "grep -rn postgres --exclude-dir=apps .").allowed, false);
    assert.equal(decide(cwd, "grep -rn postgres --exclude=.env.local .").allowed, false);
    // An include that would match the env file does not help.
    assert.equal(decide(cwd, "grep -rn postgres --include='*.env' .").allowed, false);
    assert.equal(decide(cwd, "grep -rn postgres --include='*' .").allowed, false);
    assert.equal(decide(cwd, "grep -rn postgres --include='*.ts' --include='.env' .").allowed, false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("quoted separators do not split a command, so an exclusion stays with its search", async () => {
  const cwd = await workspace();
  try {
    assert.deepEqual(decide(cwd, `grep -rniE "a|b|c" --exclude='.env*' .`), { allowed: true });
    assert.equal(decide(cwd, `echo "a|b" | grep -rn x .`).allowed, false);
    assert.equal(decide(cwd, `echo ok && grep -rn x .`).allowed, false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("a tree too large to check is refused rather than assumed safe", async () => {
  const cwd = await workspace();
  try {
    const decision = evaluateRecursiveSearch("grep -rn x src docs", cwd, resolveConfig({ policies: { protectedReadPaths: ["**/never-matches"] } }), 1);
    assert.equal(decision.allowed, false);
    assert.match(decision.reason ?? "", /too many files/);
    assert.equal(evaluateRecursiveSearch("grep -rn x src", cwd, config, 1000).allowed, true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("with no protected read paths configured, recursive searches are not inspected", async () => {
  const cwd = await workspace();
  try {
    const open = resolveConfig({ policies: { protectedReadPaths: [] } });
    assert.deepEqual(evaluateRecursiveSearch("grep -rn x .", cwd, open), { allowed: true });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("an exclusion value is not a read, but naming the file elsewhere in the command still is", async () => {
  const cwd = await workspace();
  try {
    assert.equal(decide(cwd, "grep -n postgres --exclude=.env .env").allowed, false);
    assert.equal(decide(cwd, "cat --exclude=.env .env").allowed, false);
    assert.equal(decide(cwd, "rg --hidden -g '.env' postgres").allowed, false);
    // Excluding .env at every depth is the safe form, so it is allowed.
    assert.deepEqual(decide(cwd, "rg --hidden -g '!.env' postgres"), { allowed: true });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
