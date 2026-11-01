import type { FeatureStates } from "@lab-agent-workbench/core";

export type Arm = "baseline" | "workbench";

interface ScenarioBase {
  id: string;
  category: "protected-path" | "risky-command" | "fail-closed" | "allowed-work" | "redaction" | "feature-control";
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

export type Scenario = ToolCallScenario | RedactionScenario;

export interface ScenarioResult {
  id: string;
  arm: Arm;
  category: Scenario["category"];
  passed: boolean;
  /** Never echoes scenario inputs, so secret fixtures cannot reach a report. */
  detail: string;
}

export interface ArmSummary {
  total: number;
  passed: number;
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
