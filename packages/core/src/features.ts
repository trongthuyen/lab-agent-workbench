import { resolveConfig } from "./config.js";
import type { WorkbenchConfig } from "./types.js";

/** Runtime capabilities only: CLI quality gates and evaluation are explicit commands, not hooks. */
export const featureCatalog = [
  {
    id: "writeProtection",
    label: "Write protection",
    description: "Block edits to protected paths and writes outside the workspace.",
    guardrail: true
  },
  {
    id: "readProtection",
    label: "Secret read protection",
    description: "Block known protected-file reads, including covered shell searches.",
    guardrail: true
  },
  {
    id: "riskyCommands",
    label: "Risky command blocking",
    description: "Refuse configured destructive shell and PowerShell commands.",
    guardrail: true
  },
  {
    id: "telemetry",
    label: "Redacted telemetry",
    description: "Record redacted tool arguments and timing; never tool results.",
    guardrail: false
  }
] as const;

export type FeatureId = (typeof featureCatalog)[number]["id"];
export type FeatureStates = Record<FeatureId, boolean>;

/** The switches control whether configured rules run; they do not invent missing rules. */
export function defaultFeatureStates(config: WorkbenchConfig): FeatureStates {
  return { writeProtection: true, readProtection: true, riskyCommands: true, telemetry: config.telemetry.enabled };
}

export function validateFeatureStates(value: unknown): FeatureStates {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Feature state must be an object");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== featureCatalog.length ||
      featureCatalog.some(({ id }) => !Object.hasOwn(record, id) || typeof record[id] !== "boolean")) {
    throw new Error("Feature state must contain exactly the supported boolean switches");
  }
  return { ...record } as FeatureStates;
}

/** Resolve a session layer without mutating or erasing the project's original rule lists. */
export function resolveFeatureConfig(config: WorkbenchConfig, state: FeatureStates): WorkbenchConfig {
  const flags = validateFeatureStates(state);
  return resolveConfig(config, {
    policies: {
      ...(!flags.writeProtection ? { allowOutsideWorkspace: true, protectedPaths: [] } : {}),
      ...(!flags.readProtection ? { protectedReadPaths: [] } : {}),
      ...(!flags.riskyCommands ? { riskyCommandPatterns: [] } : {})
    },
    telemetry: { enabled: flags.telemetry }
  });
}

export function disabledGuardrails(state: FeatureStates): string[] {
  return featureCatalog.filter((feature) => feature.guardrail && !state[feature.id]).map((feature) => feature.label);
}
