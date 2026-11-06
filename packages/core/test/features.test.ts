import assert from "node:assert/strict";
import test from "node:test";
import {
  migrateLegacyFeatureStates,
  defaultFeatureStates, disabledGuardrails, evaluateToolCall, resolveConfig, resolveFeatureConfig, validateFeatureStates
} from "../src/index.js";

const call = (config: ReturnType<typeof resolveConfig>, toolName: string, input: unknown) =>
  evaluateToolCall({ toolName, input }, process.cwd(), config);

test("feature switches default to existing config behavior and preserve configured telemetry", () => {
  const config = resolveConfig({ telemetry: { enabled: false } });
  const states = defaultFeatureStates(config);
  assert.deepEqual(states, {
    writeProtection: true, readProtection: true, riskyCommands: true, telemetry: false, contextInjection: false
  });
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
    writeProtection: false, readProtection: false, riskyCommands: false, telemetry: false, contextInjection: false
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

test("context injection follows the project by default and the session switch overrides it either way", () => {
  const enabled = resolveConfig({ context: { enabled: true } });
  assert.equal(defaultFeatureStates(enabled).contextInjection, true);
  assert.equal(defaultFeatureStates(resolveConfig()).contextInjection, false);

  const base = resolveConfig();
  const on = resolveFeatureConfig(base, { ...defaultFeatureStates(base), contextInjection: true });
  assert.equal(on.context.enabled, true);
  assert.deepEqual({ ...on, context: base.context }, base, "only context.enabled changes");
  const off = resolveFeatureConfig(enabled, { ...defaultFeatureStates(enabled), contextInjection: false });
  assert.equal(off.context.enabled, false);
  assert.deepEqual(off.context.sources, enabled.context.sources, "limits and sources are untouched");
  assert.deepEqual(resolveFeatureConfig(enabled, defaultFeatureStates(enabled)), enabled);
});

test("context injection is not a guardrail, so turning it off is never a warning", () => {
  const config = resolveConfig({ context: { enabled: true } });
  assert.deepEqual(disabledGuardrails({ ...defaultFeatureStates(config), contextInjection: false }), []);
});

test("version 1 feature state keeps its four choices and takes context injection from the project", () => {
  const legacy = { writeProtection: false, readProtection: true, riskyCommands: true, telemetry: false };
  const projectOff = migrateLegacyFeatureStates(legacy, defaultFeatureStates(resolveConfig()));
  assert.deepEqual(projectOff, { ...legacy, contextInjection: false });
  const projectOn = migrateLegacyFeatureStates(legacy, defaultFeatureStates(resolveConfig({ context: { enabled: true } })));
  assert.equal(projectOn.contextInjection, true);
  const defaults = defaultFeatureStates(resolveConfig());
  for (const invalid of [null, [], {}, { ...legacy, contextInjection: true }, { ...legacy, telemetry: 1 }, { ...legacy, extra: true }]) {
    assert.throws(() => migrateLegacyFeatureStates(invalid, defaults), /Feature state/);
  }
  // The current format is strict: exactly five boolean switches.
  assert.throws(() => validateFeatureStates(legacy), /Feature state/);
});
