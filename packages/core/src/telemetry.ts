import { compilePattern } from "./config.js";

const sensitiveKey = /api[_-]?key|authorization|cookie|password|secret|token/i;

export function redact(value: unknown, patterns: readonly string[]): unknown {
  if (typeof value === "string") {
    return patterns.reduce(
      (current, pattern) => current.replace(compilePattern(pattern), "[REDACTED]"),
      value
    );
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, patterns));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sensitiveKey.test(key) ? "[REDACTED]" : redact(item, patterns)
      ])
    );
  }
  return value;
}
