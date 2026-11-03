import assert from "node:assert/strict";
import test from "node:test";
import { defaultConfig, resolveConfig, validateConfig } from "../src/index.js";

test("later config layers merge objects and replace arrays", () => {
  const config = resolveConfig(
    { profile: "nestjs", telemetry: { enabled: false } },
    { qualityGates: { commands: ["npm test"] } }
  );

  assert.equal(config.profile, "nestjs");
  assert.equal(config.telemetry.enabled, false);
  assert.equal(config.telemetry.path, defaultConfig.telemetry.path);
  assert.deepEqual(config.qualityGates.commands, ["npm test"]);
});

test("unknown keys fail validation", () => {
  assert.throws(
    () => validateConfig({ ...defaultConfig, unexpected: true }),
    /Unknown configuration key/
  );
});

test("invalid regular expressions fail validation", () => {
  assert.throws(
    () => resolveConfig({ policies: { riskyCommandPatterns: ["["] } }),
    /not a valid regular expression/
  );
});

test("a config written before protectedReadPaths existed resolves against the defaults", () => {
  const policies: Record<string, unknown> = { ...defaultConfig.policies };
  delete policies.protectedReadPaths;
  const legacy = { ...defaultConfig, profile: "nestjs", policies };
  assert.throws(() => validateConfig(legacy), /protectedReadPaths must be an array of strings/);

  const resolved = resolveConfig(legacy as never);
  assert.equal(resolved.profile, "nestjs");
  assert.deepEqual(resolved.policies.protectedReadPaths, defaultConfig.policies.protectedReadPaths);
});

test("context is off by default and its defaults come from the base layer", () => {
  const config = resolveConfig();
  assert.equal(config.context.enabled, false);
  assert.equal(config.context.compaction.strategy, "native");
  assert.deepEqual(resolveConfig({ context: { enabled: true } }).context.sources, defaultConfig.context.sources);
  assert.equal(resolveConfig({ context: { enabled: true } }).context.maxInjectedTokens, 4000);
});

test("context keys are validated and fail closed", () => {
  const bad: [unknown, RegExp][] = [
    [{ context: { surprise: 1 } }, /Unknown configuration key: context\.surprise/],
    [{ context: { enabled: "yes" } }, /context\.enabled must be a boolean/],
    [{ context: { maxChunks: 0 } }, /context\.maxChunks must be a positive integer/],
    [{ context: { maxChunks: 1.5 } }, /positive integer/],
    [{ context: { maxInjectedTokens: Number.NaN } }, /positive integer/],
    [{ context: { maxInjectedTokens: 100, maxChunkTokens: 200 } }, /maxChunkTokens must not exceed/],
    [{ context: { maxFileBytes: 4096, maxBytesScanned: 1024 } }, /maxFileBytes must not exceed/],
    [{ context: { compaction: { strategy: "smart" } } }, /strategy must be/],
    [{ context: { compaction: { other: 1 } } }, /Unknown configuration key: context\.compaction\.other/],
    [{ context: { sources: [""] } }, /workspace-relative/],
    [{ context: { sources: ["/etc/**"] } }, /workspace-relative/],
    [{ context: { sources: ["C:\\secrets\\*.md"] } }, /workspace-relative/],
    [{ context: { sources: ["docs/../../secrets/*.md"] } }, /workspace-relative/],
    [{ context: { sources: ["!docs/private.md"] } }, /workspace-relative/],
    [{ context: { sources: "docs/**" } }, /array of strings/]
  ];
  for (const [layer, message] of bad) {
    assert.throws(() => resolveConfig(layer as never), message, JSON.stringify(layer));
  }
});
