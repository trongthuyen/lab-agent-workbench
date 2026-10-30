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

test("allows non-destructive shell commands", () => {
  assert.deepEqual(evaluateCommand("npm test", config), { allowed: true });
  assert.deepEqual(evaluateCommand("rm ./single-file.txt", config), { allowed: true });
});

test("fails closed when a write tool has no path", () => {
  const decision = evaluateToolCall({ toolName: "write", input: {} }, cwd, config);
  assert.equal(decision.allowed, false);
});
