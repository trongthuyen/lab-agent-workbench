import assert from "node:assert/strict";
import test from "node:test";
import { redact, resolveConfig } from "../src/index.js";

test("redacts sensitive keys and matching string content", () => {
  const config = resolveConfig();
  const value = redact(
    {
      token: "abc123",
      command: "API_KEY=secret-value npm test",
      nested: { password: "hunter2", safe: "visible" }
    },
    config.telemetry.redactPatterns
  );

  assert.deepEqual(value, {
    token: "[REDACTED]",
    command: "[REDACTED] npm test",
    nested: { password: "[REDACTED]", safe: "visible" }
  });
});
