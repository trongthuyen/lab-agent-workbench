import type { ConfigLayer, FeatureStates } from "@lab-agent-workbench/core";

export type Arm = "baseline" | "workbench";

interface ScenarioBase {
  id: string;
  category:
    | "protected-path" | "risky-command" | "fail-closed" | "allowed-work" | "redaction" | "feature-control"
    | "context" | "context-safety" | "budget";
  description: string;
}

/** Replays one tool call against the policy and compares the decision with the expectation. */
export interface ToolCallScenario extends ScenarioBase {
  kind: "tool-call";
  toolCall: { toolName: string; input: unknown };
  expect: { allowed: boolean; rule?: string };
  /** Explicit user-selected session switches; feature-control scenarios are not safety-rate samples. */
  features?: FeatureStates;
  /** Files to create in a throwaway directory used as the working directory for this scenario. */
  files?: Record<string, string>;
}

/** Redacts `input` the way telemetry does and checks that no secret fixture survives. */
export interface RedactionScenario extends ScenarioBase {
  kind: "redaction";
  input: unknown;
  mustNotContain: string[];
  mustContain?: string[];
}

/**
 * Runs local context retrieval on a throwaway workspace. No model is involved, and the report never
 * echoes file contents, queries or canaries.
 */
export interface ContextScenario extends ScenarioBase {
  kind: "context";
  files: Record<string, string>;
  /** Files created in a second directory outside the workspace, for symlink escape cases. */
  outsideFiles?: Record<string, string>;
  /** Link path → target. A target of `outside:<path>` points into `outsideFiles`; otherwise it is workspace-relative. */
  symlinks?: Record<string, string>;
  /** Layered over the project config (typically `context` limits and `policies`). */
  config?: ConfigLayer;
  query: string;
  /** Pi's reported context usage; selects the injection stage (budget, packing, frame). `tokens: null` is unknown. */
  usage?: { tokens: number | null; contextWindow: number };
  expect: {
    /** Paths of the selected chunks, in rank order. */
    selected: string[];
    /** Path → skip reason that must be reported. */
    skipped?: Record<string, string>;
    /** Strings that must appear nowhere in the selected text or the serialized retrieval result. */
    mustNotContain?: string[];
    /** Injection stage (needs `usage`): paths of the chunks that fit the budget, in order. */
    injected?: string[];
    /** Injection stage: the reason injection was skipped entirely. */
    skipReason?: string;
    /** Injection stage: exact occurrence counts of substrings in the rendered block. */
    renderedCounts?: Record<string, number>;
  };
}

export type Scenario = ToolCallScenario | RedactionScenario | ContextScenario;

export interface ScenarioResult {
  id: string;
  arm: Arm;
  category: Scenario["category"];
  passed: boolean;
  /** Never echoes scenario inputs, so secret fixtures cannot reach a report. */
  detail: string;
  /** The scenario could not run here (e.g. symlinks unavailable); it is reported, not counted as passed. */
  skipped?: boolean;
}

export interface ArmSummary {
  total: number;
  passed: number;
  /** Scenarios that could not run on this platform; excluded from total and passed. */
  skipped: number;
  unsafeBlocked: { blocked: number; total: number };
  falsePositives: { count: number; total: number };
}

export interface EvaluationReport {
  schemaVersion: 1;
  manifest: {
    id: string;
    problem: string;
    baseline: string;
    variant: string;
    model: string;
    repositoryCommit: string;
    runs: number;
    metrics: string[];
  };
  arms: Record<Arm, ArmSummary>;
  results: ScenarioResult[];
}
