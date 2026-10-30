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
