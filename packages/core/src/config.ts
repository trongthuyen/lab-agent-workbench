import { getProfile, profiles } from "./profiles.js";
import type { ConfigLayer, WorkbenchConfig } from "./types.js";

export const defaultConfig: WorkbenchConfig = {
  version: 1,
  profile: "base",
  policies: {
    allowOutsideWorkspace: false,
    protectedPaths: [
      ".git",
      ".git/**",
      "**/.env",
      "**/.env.*",
      "!**/.env-example",
      "!**/.env.example",
      "!**/.env-sample",
      "!**/.env.sample"
    ],
    protectedReadPaths: [
      "**/.env",
      "**/.env.*",
      "!**/.env-example",
      "!**/.env.example",
      "!**/.env-sample",
      "!**/.env.sample"
    ],
    riskyCommandPatterns: [
      "\\brm\\b[^\\n]*(?:-[A-Za-z]*r[A-Za-z]*f[A-Za-z]*|-[A-Za-z]*f[A-Za-z]*r[A-Za-z]*|(?:-r|--recursive)[^\\n]*(?:-f|--force)|(?:-f|--force)[^\\n]*(?:-r|--recursive))",
      "\\bgit\\s+reset\\s+--hard\\b",
      "\\bgit\\s+clean\\b[^\\n]*\\s(?:-[A-Za-z]*f[A-Za-z]*|--force)\\b",
      "(?i)\\b(?:rm|ri|rd|rmdir|del|erase|Remove-Item)\\b[^\\n]*(?:-r\\w*[^\\n]*-fo\\w*|-fo\\w*[^\\n]*-r\\w*)",
      "(?i)\\b(?:rd|rmdir|del|erase)\\b[^\\n]*\\s/s\\b"
    ]
  },
  telemetry: {
    enabled: true,
    path: ".lawb/runs/telemetry.jsonl",
    redactPatterns: [
      "(?i)(api[_-]?key|token|password|secret)\\s*[=:]\\s*[^\\s,;]+",
      "(?i)bearer\\s+[a-z0-9._~+/-]+"
    ]
  },
  qualityGates: {
    commands: []
  },
  context: {
    enabled: false,
    sources: ["README.md", "docs/**/*.md"],
    maxInjectedTokens: 4000,
    maxInjectedBytes: 16384,
    maxChunks: 5,
    maxChunkTokens: 800,
    maxFileBytes: 262144,
    maxFilesScanned: 200,
    maxBytesScanned: 2097152,
    compaction: { strategy: "native" }
  }
};

const allowedKeys = {
  root: new Set(["version", "profile", "policies", "telemetry", "qualityGates", "context"]),
  policies: new Set(["allowOutsideWorkspace", "protectedPaths", "protectedReadPaths", "riskyCommandPatterns"]),
  telemetry: new Set(["enabled", "path", "redactPatterns"]),
  qualityGates: new Set(["commands"]),
  context: new Set([
    "enabled", "sources", "maxInjectedTokens", "maxInjectedBytes", "maxChunks", "maxChunkTokens",
    "maxFileBytes", "maxFilesScanned", "maxBytesScanned", "compaction"
  ]),
  compaction: new Set(["strategy"])
};
const contextLimits = [
  "maxInjectedTokens", "maxInjectedBytes", "maxChunks", "maxChunkTokens",
  "maxFileBytes", "maxFilesScanned", "maxBytesScanned"
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKnownKeys(
  value: Record<string, unknown>,
  keys: ReadonlySet<string>,
  path: string
): void {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) {
      throw new Error(`Unknown configuration key: ${path}${key}`);
    }
  }
}

function assertStringArray(value: unknown, path: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${path} must be an array of strings`);
  }
}

export function validateConfig(value: unknown): WorkbenchConfig {
  if (!isRecord(value)) {
    throw new Error("Configuration must be an object");
  }

  assertKnownKeys(value, allowedKeys.root, "");
  if (value.version !== 1) {
    throw new Error("version must be 1");
  }
  if (typeof value.profile !== "string" || value.profile.trim() === "") {
    throw new Error("profile must be a non-empty string");
  }

  if (!isRecord(value.policies)) {
    throw new Error("policies must be an object");
  }
  assertKnownKeys(value.policies, allowedKeys.policies, "policies.");
  if (typeof value.policies.allowOutsideWorkspace !== "boolean") {
    throw new Error("policies.allowOutsideWorkspace must be a boolean");
  }
  assertStringArray(value.policies.protectedPaths, "policies.protectedPaths");
  assertStringArray(value.policies.protectedReadPaths, "policies.protectedReadPaths");
  assertStringArray(value.policies.riskyCommandPatterns, "policies.riskyCommandPatterns");

  if (!isRecord(value.telemetry)) {
    throw new Error("telemetry must be an object");
  }
  assertKnownKeys(value.telemetry, allowedKeys.telemetry, "telemetry.");
  if (typeof value.telemetry.enabled !== "boolean") {
    throw new Error("telemetry.enabled must be a boolean");
  }
  if (typeof value.telemetry.path !== "string" || value.telemetry.path.trim() === "") {
    throw new Error("telemetry.path must be a non-empty string");
  }
  assertStringArray(value.telemetry.redactPatterns, "telemetry.redactPatterns");

  if (!isRecord(value.qualityGates)) {
    throw new Error("qualityGates must be an object");
  }
  assertKnownKeys(value.qualityGates, allowedKeys.qualityGates, "qualityGates.");
  assertStringArray(value.qualityGates.commands, "qualityGates.commands");

  validateContext(value.context);

  for (const [index, pattern] of value.policies.riskyCommandPatterns.entries()) {
    assertValidPattern(pattern, `policies.riskyCommandPatterns[${index}]`);
  }
  for (const [index, pattern] of value.telemetry.redactPatterns.entries()) {
    assertValidPattern(pattern, `telemetry.redactPatterns[${index}]`);
  }

  return value as unknown as WorkbenchConfig;
}

function validateContext(value: unknown): void {
  if (!isRecord(value)) {
    throw new Error("context must be an object");
  }
  assertKnownKeys(value, allowedKeys.context, "context.");
  if (typeof value.enabled !== "boolean") {
    throw new Error("context.enabled must be a boolean");
  }
  assertStringArray(value.sources, "context.sources");
  for (const [index, source] of value.sources.entries()) {
    // Contract-level check only; the reader still canonicalizes paths before opening anything.
    const segments = source.split(/[\\/]/);
    if (source.trim() === "" || source.startsWith("!") || /^(?:[A-Za-z]:|[\\/])/.test(source) || segments.includes("..")) {
      throw new Error(`context.sources[${index}] must be a workspace-relative glob without ".." or negation`);
    }
  }
  for (const key of contextLimits) {
    const limit = value[key];
    if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1) {
      throw new Error(`context.${key} must be a positive integer`);
    }
  }
  const limits = value as Record<(typeof contextLimits)[number], number>;
  if (limits.maxChunkTokens > limits.maxInjectedTokens) {
    throw new Error("context.maxChunkTokens must not exceed context.maxInjectedTokens");
  }
  if (limits.maxFileBytes > limits.maxBytesScanned) {
    throw new Error("context.maxFileBytes must not exceed context.maxBytesScanned");
  }
  if (!isRecord(value.compaction)) {
    throw new Error("context.compaction must be an object");
  }
  assertKnownKeys(value.compaction, allowedKeys.compaction, "context.compaction.");
  if (value.compaction.strategy !== "native" && value.compaction.strategy !== "structured") {
    throw new Error('context.compaction.strategy must be "native" or "structured"');
  }
}

function assertValidPattern(pattern: string, path: string): void {
  try {
    compilePattern(pattern);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${path} is not a valid regular expression: ${message}`);
  }
}

export function compilePattern(pattern: string): RegExp {
  if (pattern.startsWith("(?i)")) {
    return new RegExp(pattern.slice(4), "giu");
  }
  return new RegExp(pattern, "gu");
}

function mergeObjects(base: unknown, override: unknown): unknown {
  if (!isRecord(base) || !isRecord(override)) {
    return structuredClone(override);
  }

  const result: Record<string, unknown> = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) {
      continue;
    }
    result[key] = isRecord(value) && isRecord(result[key])
      ? mergeObjects(result[key], value)
      : structuredClone(value);
  }
  return result;
}

/** Objects merge recursively; scalars and arrays are replaced by the later layer. */
export function resolveConfig(...layers: ConfigLayer[]): WorkbenchConfig {
  const merged = layers.reduce<unknown>(
    (current, layer) => mergeObjects(current, layer),
    defaultConfig
  );
  return validateConfig(merged);
}

/**
 * Applies Base → Technology Profile → Project Override for one project file. The profile layer is the
 * one the file names. An unknown profile name adds no layer: such files were accepted before profiles
 * were applied at load time, and rejecting them here would break existing projects.
 */
export function resolveProjectConfig(projectLayer: ConfigLayer): WorkbenchConfig {
  const name = isRecord(projectLayer) ? projectLayer.profile : undefined;
  const profileLayer = typeof name === "string" && Object.hasOwn(profiles, name) ? getProfile(name) : {};
  return resolveConfig(profileLayer, projectLayer);
}
