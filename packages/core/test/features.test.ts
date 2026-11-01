import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultFeatureStates, disabledGuardrails, evaluateToolCall, resolveConfig, resolveFeatureConfig, validateFeatureStates
} from "../src/index.js";

const call = (config: ReturnType<typeof resolveConfig>, toolName: string, input: unknown) =>
  evaluateToolCall({ toolName, input }, process.cwd(), config);

test("feature switches default to existing config behavior and preserve configured telemetry", () => {
  const config = resolveConfig({ telemetry: { enabled: false } });
  const states = defaultFeatureStates(config);
  assert.deepEqual(states, { writeProtection: true, readProtection: true, riskyCommands: true, telemetry: false });
  assert.deepEqual(resolveFeatureConfig(config, states), config);
  assert.deepEqual(disabledGuardrails(states), []);
});

test("switches act independently and re-enabling restores original project rules", () => {
  const config = resolveConfig({ policies: { protectedPaths: ["keep.txt"], riskyCommandPatterns: ["never-run"] } });
  const state = defaultFeatureStates(config);
  const off = resolveFeatureConfig(config, { ...state, writeProtection: false });
  assert.equal(call(off, "write", { path: "keep.txt" }).allowed, true);
  assert.equal(call(off, "write", { path: "../outside.txt" }).allowed, true);
  assert.equal(call(off, "read", { path: ".env" }).allowed, false);
  assert.equal(call(off, "bash", { command: "never-run" }).allowed, false);
  assert.equal(call(resolveFeatureConfig(config, { ...state, readProtection: false }), "read", { path: ".env" }).allowed, true);
  assert.equal(call(resolveFeatureConfig(config, { ...state, riskyCommands: false }), "bash", { command: "never-run" }).allowed, true);
  assert.deepEqual(config.policies.protectedPaths, ["keep.txt"]);
  assert.deepEqual(resolveFeatureConfig(config, state), config);
});

test("turning all guardrails off still fails closed on missing or invalid tool arguments", () => {
  const config = resolveFeatureConfig(resolveConfig(), {
    writeProtection: false, readProtection: false, riskyCommands: false, telemetry: false
  });
  for (const tool of ["write", "edit", "read", "bash", "powershell"]) {
    assert.equal(call(config, tool, {}).allowed, false);
    assert.equal(call(config, tool, { path: 42, command: null }).allowed, false);
  }
});

test("feature state rejects unknown, missing and non-boolean keys", () => {
  const valid = defaultFeatureStates(resolveConfig());
  for (const invalid of [null, [], {}, { ...valid, unknown: true }, { ...valid, telemetry: "false" }]) {
    assert.throws(() => validateFeatureStates(invalid), /Feature state/);
  }
  const parsed = validateFeatureStates(valid);
  parsed.writeProtection = false;
  assert.equal(valid.writeProtection, true);
});
