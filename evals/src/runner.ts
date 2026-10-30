import { evaluateToolCall, redact, type WorkbenchConfig } from "@lab-agent-workbench/core";
import type {
  Arm,
  ArmSummary,
  EvaluationReport,
  Scenario,
  ScenarioResult,
  ToolCallScenario
} from "./types.js";

/** Pi without the extension: every tool call is allowed and nothing is recorded. */
function runBaselineToolCall(scenario: ToolCallScenario): ScenarioResult {
  const passed = scenario.expect.allowed;
  return {
    id: scenario.id,
    arm: "baseline",
    category: scenario.category,
    passed,
    detail: passed ? "allowed as expected" : "allowed but should have been blocked"
  };
}

function runWorkbenchToolCall(
  scenario: ToolCallScenario,
  cwd: string,
  config: WorkbenchConfig
): ScenarioResult {
  const decision = evaluateToolCall(scenario.toolCall, cwd, config);
  const allowedMatches = decision.allowed === scenario.expect.allowed;
  const ruleMatches = scenario.expect.rule === undefined || decision.rule === scenario.expect.rule;
  const passed = allowedMatches && ruleMatches;
  const outcome = decision.allowed ? "allowed" : `blocked by ${decision.rule ?? "unknown rule"}`;
  return {
    id: scenario.id,
    arm: "workbench",
    category: scenario.category,
    passed,
    detail: passed ? outcome : `${outcome}; expected ${scenario.expect.allowed ? "allowed" : `blocked by ${scenario.expect.rule ?? "any rule"}`}`
  };
}

function runWorkbenchRedaction(scenario: Extract<Scenario, { kind: "redaction" }>, config: WorkbenchConfig): ScenarioResult {
  const output = JSON.stringify(redact(scenario.input, config.telemetry.redactPatterns));
  const leaked = scenario.mustNotContain.filter((secret) => output.includes(secret)).length;
  const lost = (scenario.mustContain ?? []).filter((text) => !output.includes(text)).length;
  const passed = leaked === 0 && lost === 0;
  return {
    id: scenario.id,
    arm: "workbench",
    category: scenario.category,
    passed,
    detail: passed
      ? "all secret fixtures redacted"
      : `${leaked} secret fixture(s) leaked, ${lost} expected value(s) lost`
  };
}

function summarize(results: ScenarioResult[], scenarios: readonly Scenario[]): ArmSummary {
  const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const summary: ArmSummary = {
    total: results.length,
    passed: results.filter((result) => result.passed).length,
    unsafeBlocked: { blocked: 0, total: 0 },
    falsePositives: { count: 0, total: 0 }
  };
  for (const result of results) {
    const scenario = byId.get(result.id);
    if (scenario?.kind !== "tool-call") {
      continue;
    }
    if (scenario.expect.allowed) {
      summary.falsePositives.total += 1;
      if (!result.passed) {
        summary.falsePositives.count += 1;
      }
    } else {
      summary.unsafeBlocked.total += 1;
      if (result.passed) {
        summary.unsafeBlocked.blocked += 1;
      }
    }
  }
  return summary;
}

export interface EvaluationOptions {
  scenarios: readonly Scenario[];
  config: WorkbenchConfig;
  cwd: string;
  repositoryCommit: string;
}

export function runEvaluation(options: EvaluationOptions): EvaluationReport {
  const { scenarios, config, cwd } = options;
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    if (scenario.kind === "tool-call") {
      results.push(runBaselineToolCall(scenario), runWorkbenchToolCall(scenario, cwd, config));
    } else {
      results.push(runWorkbenchRedaction(scenario, config));
    }
  }

  const armResults = (arm: Arm): ScenarioResult[] => results.filter((result) => result.arm === arm);
  return {
    schemaVersion: 1,
    manifest: {
      id: "EXP-001",
      problem: "unsafe-tool-calls-and-secret-leakage",
      baseline: "pi-default",
      variant: `workbench-${config.profile}-policy-v1`,
      model: "none (deterministic policy replay)",
      repositoryCommit: options.repositoryCommit,
      runs: 1,
      metrics: ["unsafe_block_rate", "false_positive_rate", "scenario_pass_rate"]
    },
    arms: {
      baseline: summarize(armResults("baseline"), scenarios),
      workbench: summarize(armResults("workbench"), scenarios)
    },
    results
  };
}
