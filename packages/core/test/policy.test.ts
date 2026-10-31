import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCommand, evaluatePath, evaluateToolCall, resolveConfig } from "../src/index.js";

const config = resolveConfig();
const cwd = process.platform === "win32" ? "C:\\work\\project" : "/work/project";

test("blocks writes to protected files", () => {
  assert.equal(evaluatePath(".env", cwd, config).allowed, false);
  assert.equal(evaluatePath(".git/config", cwd, config).allowed, false);
});

test("allows ordinary source paths", () => {
  assert.deepEqual(evaluatePath("src/main.ts", cwd, config), { allowed: true });
});

test("protects env files and .git at every directory depth", () => {
  for (const path of [".env", "./.env", ".env.local", "apps/api/.env", "backend/.env.production", "a/b/c/.env.local", ".git/config"]) {
    assert.equal(evaluatePath(path, cwd, config).rule, "protected-path", path);
  }
  for (const path of ["src/env.ts", ".envrc", "docs/.environment-notes.md", "src/.github/workflows/ci.yml"]) {
    assert.deepEqual(evaluatePath(path, cwd, config), { allowed: true }, path);
  }
});

test("example and sample env files are not protected, but their variants and real env files are", () => {
  for (const path of [".env.example", ".env.sample", ".env-example", ".env-sample", "apps/api/.env.example", "backend/.env.sample"]) {
    assert.deepEqual(evaluatePath(path, cwd, config), { allowed: true }, path);
  }
  for (const path of [".env", ".env.local", "apps/api/.env", ".env.example.bak", ".env.sample.local"]) {
    assert.equal(evaluatePath(path, cwd, config).rule, "protected-path", path);
  }
  assert.deepEqual(
    evaluateToolCall({ toolName: "bash", input: { command: "sed -i s/a/b/ .env.example" } }, cwd, config),
    { allowed: true }
  );
  assert.equal(
    evaluateToolCall({ toolName: "bash", input: { command: "cp .env.example .env" } }, cwd, config).rule,
    "protected-path"
  );
});

test("a negated pattern only re-allows paths matched by earlier patterns", () => {
  const custom = resolveConfig({ policies: { protectedPaths: ["!keys/public.pem", "keys/**", "!keys/public.pem"] } });
  assert.equal(evaluatePath("keys/private.pem", cwd, custom).allowed, false);
  assert.equal(evaluatePath("keys/public.pem", cwd, custom).allowed, true);
  const negatedFirst = resolveConfig({ policies: { protectedPaths: ["!keys/public.pem", "keys/**"] } });
  assert.equal(evaluatePath("keys/public.pem", cwd, negatedFirst).allowed, false);
});

test("a leading ** segment matches zero directories while * stays within one segment", () => {
  const custom = resolveConfig({ policies: { protectedPaths: ["**/secrets.json", "config/*.key", "keys/**"] } });
  assert.equal(evaluatePath("secrets.json", cwd, custom).allowed, false);
  assert.equal(evaluatePath("a/b/secrets.json", cwd, custom).allowed, false);
  assert.equal(evaluatePath("config/prod.key", cwd, custom).allowed, false);
  assert.equal(evaluatePath("config/nested/prod.key", cwd, custom).allowed, true);
  assert.equal(evaluatePath("keys/a/b.pem", cwd, custom).allowed, false);
});

test("blocks paths outside the workspace", () => {
  assert.equal(evaluatePath("../secret.txt", cwd, config).rule, "outside-workspace");
});

test("blocks risky shell commands", () => {
  assert.equal(evaluateCommand("git reset --hard HEAD", config).rule, "risky-command");
  assert.equal(evaluateCommand("rm -rf ./dist", config).rule, "risky-command");
  assert.equal(evaluateCommand("rm -fr ./dist", config).rule, "risky-command");
  assert.equal(evaluateCommand("rm --recursive --force ./dist", config).rule, "risky-command");
  assert.equal(evaluateCommand("remove-item ./dist -force -recurse", config).rule, "risky-command");
});

test("blocks git clean whenever force is among its flags", () => {
  for (const command of ["git clean -f", "git clean -df", "git clean -fd", "git clean -fdx", "git clean -n -f", "git clean --force -d"]) {
    assert.equal(evaluateCommand(command, config).rule, "risky-command", command);
  }
  assert.deepEqual(evaluateCommand("git clean -n", config), { allowed: true });
  assert.deepEqual(evaluateCommand("git clean -dn", config), { allowed: true });
});

test("blocks the read and grep tools on protected files only", () => {
  const blocked = (toolName: string, input: unknown) => evaluateToolCall({ toolName, input }, cwd, config).rule;
  for (const path of [".env", "./.env", "apps/api/.env", ".env.local", cwd + "/.env", "../other-project/.env"]) {
    assert.equal(blocked("read", { path }), "protected-path", path);
  }
  assert.equal(blocked("grep", { pattern: "PASSWORD", path: ".env" }), "protected-path");
  assert.equal(blocked("grep", { pattern: "PASSWORD", glob: ".env" }), "protected-path");

  for (const path of [".env.example", "apps/api/.env.sample", "src/main.ts", "/usr/share/doc/readme.txt"]) {
    assert.equal(blocked("read", { path }), undefined, path);
  }
  assert.equal(blocked("grep", { pattern: "x", path: "src", glob: "*.ts" }), undefined);
  assert.equal(blocked("grep", { pattern: "x" }), undefined);
});

test("the read tool fails closed without a path", () => {
  assert.equal(evaluateToolCall({ toolName: "read", input: {} }, cwd, config).allowed, false);
  assert.equal(evaluateToolCall({ toolName: "read", input: { path: 7 } }, cwd, config).allowed, false);
});

test("blocks shell commands that modify protected files", () => {
  for (const command of [
    "sed -i 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=x/' .env",
    "sed -i.bak s/a/b/ apps/api/.env",
    "echo POSTGRES_PASSWORD=x >> .env",
    "echo x>.env",
    "cat template | tee backend/.env.local",
    "cp .env.example .env",
    "mv .env .env.bak",
    "rm apps/api/.env",
    "python3 -c \"open('.env','w').write('x')\"",
    "perl -pi -e 's/a/b/' .env",
    "Set-Content -Path .env -Value x",
    "rm .git/config"
  ]) {
    assert.equal(evaluateToolCall({ toolName: "bash", input: { command } }, cwd, config).rule, "protected-path", command);
  }
  assert.equal(
    evaluateToolCall({ toolName: "powershell", input: { command: "Set-Content .env x" } }, cwd, config).rule,
    "protected-path"
  );
});

test("blocks shell commands that read protected files", () => {
  for (const command of [
    "cat .env",
    "head -n 3 apps/api/.env",
    "grep POSTGRES_PASSWORD .env",
    "source .env && npm start",
    "set -a; . ./.env; set +a",
    "base64 < .env",
    "Get-Content .env",
    "type backend\\.env.local",
    "cat \\.env"
  ]) {
    assert.equal(evaluateToolCall({ toolName: "bash", input: { command } }, cwd, config).rule, "protected-path", command);
  }
});

test("reading .git is allowed while modifying it is not", () => {
  for (const command of ["cat .git/config", "head -n 2 .git/HEAD", "ls .git"]) {
    assert.deepEqual(evaluateToolCall({ toolName: "bash", input: { command } }, cwd, config), { allowed: true }, command);
  }
  assert.deepEqual(evaluateToolCall({ toolName: "read", input: { path: ".git/HEAD" } }, cwd, config), { allowed: true });
  assert.equal(evaluateToolCall({ toolName: "write", input: { path: ".git/HEAD", content: "x" } }, cwd, config).rule, "protected-path");
  assert.equal(evaluateToolCall({ toolName: "bash", input: { command: "echo x > .git/HEAD" } }, cwd, config).rule, "protected-path");
});

test("echo and printf arguments are text, but their redirect targets are still checked", () => {
  for (const command of [
    "echo .env >> .gitignore",
    "echo '.env' >> .gitignore",
    "printf '.env\\n.env.local\\n' >> .gitignore",
    "echo \"cat .env\" > notes.txt",
    "echo .env"
  ]) {
    assert.deepEqual(evaluateToolCall({ toolName: "bash", input: { command } }, cwd, config), { allowed: true }, command);
  }
  for (const command of [
    "echo POSTGRES_PASSWORD=x > .env",
    "echo x >> apps/api/.env",
    "printf x | tee .env",
    "echo done && cat .env",
    "echo x; head .env"
  ]) {
    assert.equal(evaluateToolCall({ toolName: "bash", input: { command } }, cwd, config).rule, "protected-path", command);
  }
});

test("allows shell commands that do not reference protected files", () => {
  for (const command of [
    "cat .env.example",
    "cp .env.example docs/env-sample.txt",
    "ls -la apps/api",
    "git status",
    "npm test 2>&1",
    "echo ok > build.log",
    "sed -i 's/a/b/' src/tasks.service.ts",
    "cp src/a.ts src/b.ts",
    "grep -n POSTGRES src/config.ts"
  ]) {
    assert.deepEqual(evaluateToolCall({ toolName: "bash", input: { command } }, cwd, config), { allowed: true }, command);
  }
});

test("blocks recursive deletion on Windows, including PowerShell aliases and abbreviated parameters", () => {
  for (const command of [
    "rd /s /q build",
    "RMDIR /S /Q build",
    "del /s /q *.js",
    "erase /s old",
    "Remove-Item -Recurse -Force .\\dist",
    "rm -Recurse -Force dist",
    "ri -r -fo dist",
    "Remove-Item dist -fo -rec",
    "del -Force -Recurse dist"
  ]) {
    assert.equal(evaluateCommand(command, config).rule, "risky-command", command);
  }
});

test("allows Windows deletions that are neither recursive nor forced together", () => {
  for (const command of [
    "del old.js",
    "del /q old.js",
    "rd emptydir",
    "Remove-Item dist\\old.js",
    "Remove-Item -Recurse -Filter *.tmp cache",
    "Remove-Item -Force old.js",
    "echo hello /s world"
  ]) {
    assert.deepEqual(evaluateCommand(command, config), { allowed: true }, command);
  }
});

test("allows non-destructive shell commands", () => {
  assert.deepEqual(evaluateCommand("npm test", config), { allowed: true });
  assert.deepEqual(evaluateCommand("rm ./single-file.txt", config), { allowed: true });
});

test("fails closed when a write tool has no path", () => {
  const decision = evaluateToolCall({ toolName: "write", input: {} }, cwd, config);
  assert.equal(decision.allowed, false);
});
