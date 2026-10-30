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

test("allows non-destructive shell commands", () => {
  assert.deepEqual(evaluateCommand("npm test", config), { allowed: true });
  assert.deepEqual(evaluateCommand("rm ./single-file.txt", config), { allowed: true });
});

test("fails closed when a write tool has no path", () => {
  const decision = evaluateToolCall({ toolName: "write", input: {} }, cwd, config);
  assert.equal(decision.allowed, false);
});
