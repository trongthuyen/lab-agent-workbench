import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  evaluateToolCall,
  redact,
  resolveConfig,
  resolveFeatureConfig,
  injectionBudget,
  packContext,
  renderContext,
  retrievalConfig,
  retrieveContext,
  type WorkbenchConfig
} from "@lab-agent-workbench/core";
import type {
  Arm,
  ArmSummary,
  ContextScenario,
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

/** Runs `action` in a throwaway directory holding the scenario's files, or in `cwd` when it has none. */
function withScenarioFiles<T>(scenario: ToolCallScenario, cwd: string, action: (directory: string) => T): T {
  if (scenario.files === undefined) {
    return action(cwd);
  }
  const directory = mkdtempSync(join(tmpdir(), "lawb-eval-"));
  try {
    for (const [path, content] of Object.entries(scenario.files)) {
      mkdirSync(dirname(join(directory, path)), { recursive: true });
      writeFileSync(join(directory, path), content, "utf8");
    }
    return action(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runWorkbenchToolCall(
  scenario: ToolCallScenario,
  cwd: string,
  config: WorkbenchConfig
): ScenarioResult {
  const effectiveConfig = scenario.features ? resolveFeatureConfig(config, scenario.features) : config;
  const decision = withScenarioFiles(scenario, cwd, (directory) => evaluateToolCall(scenario.toolCall, directory, effectiveConfig));
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

function writeFiles(directory: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), content, "utf8");
  }
}

/** Local retrieval on a throwaway workspace; compares what was selected, skipped and leaked. */
async function runWorkbenchContext(scenario: ContextScenario, config: WorkbenchConfig): Promise<ScenarioResult> {
  const base = { id: scenario.id, arm: "workbench" as const, category: scenario.category };
  const root = mkdtempSync(join(tmpdir(), "lawb-eval-ctx-"));
  const outside = mkdtempSync(join(tmpdir(), "lawb-eval-out-"));
  try {
    writeFiles(root, scenario.files);
    writeFiles(outside, scenario.outsideFiles ?? {});
    for (const [link, target] of Object.entries(scenario.symlinks ?? {})) {
      const absoluteTarget = target.startsWith("outside:")
        ? join(outside, target.slice("outside:".length))
        : isAbsolute(target) ? target : resolve(root, dirname(link), target);
      mkdirSync(dirname(join(root, link)), { recursive: true });
      try {
        symlinkSync(absoluteTarget, join(root, link), target.endsWith("/") ? "junction" : "file");
      } catch {
        return { ...base, passed: false, skipped: true, detail: "skipped: symlinks cannot be created on this platform" };
      }
    }

    const project = scenario.config ? resolveConfig(config, scenario.config) : config;
    const session = scenario.features ? resolveFeatureConfig(project, scenario.features) : project;
    const effective = retrievalConfig(session, project);
    const result = await retrieveContext({ root, query: scenario.query, config: effective });
    const selected = result.selected.map((chunk) => chunk.path);
    const problems: string[] = [];
    if (JSON.stringify(selected) !== JSON.stringify(scenario.expect.selected)) {
      problems.push(`selected ${selected.length} chunk(s), expected ${scenario.expect.selected.length} with the expected sources`);
    }
    if (scenario.expect.contextEnabled !== undefined && session.context.enabled !== scenario.expect.contextEnabled) {
      problems.push(`effective context.enabled was ${session.context.enabled}, expected ${scenario.expect.contextEnabled}`);
    }
    const skipped = new Map(result.skipped.map((entry) => [entry.path, entry.reason]));
    for (const [path, reason] of Object.entries(scenario.expect.skipped ?? {})) {
      if (skipped.get(path) !== reason) problems.push(`a source was not skipped as ${reason}`);
    }
    let output = JSON.stringify(result);
    if (scenario.usage) {
      const budget = injectionBudget(effective, scenario.usage);
      const packed = budget.skipReason
        ? { chunks: [], text: "" }
        : packContext(result.selected, budget.tokens, effective.context.maxInjectedBytes);
      const injected = packed.chunks.map((chunk) => chunk.path);
      output += packed.text;
      if (scenario.expect.injected && JSON.stringify(injected) !== JSON.stringify(scenario.expect.injected)) {
        problems.push(`injected ${injected.length} chunk(s), expected ${scenario.expect.injected.length} with the expected sources`);
      }
      if ((scenario.expect.skipReason ?? undefined) !== (budget.skipReason ?? undefined) &&
          (scenario.expect.skipReason !== undefined || budget.skipReason !== undefined)) {
        problems.push(`injection skip reason was ${budget.skipReason ?? "none"}, expected ${scenario.expect.skipReason ?? "none"}`);
      }
      const rendered = packed.text === "" ? "" : renderContext(packed.chunks);
      for (const [text, count] of Object.entries(scenario.expect.renderedCounts ?? {})) {
        if (rendered.split(text).length - 1 !== count) problems.push("a rendered substring count did not match");
      }
    }
    const leaked = (scenario.expect.mustNotContain ?? []).filter((text) => output.includes(text)).length;
    if (leaked > 0) problems.push(`${leaked} canary string(s) reached the retrieval result`);
    return {
      ...base,
      passed: problems.length === 0,
      detail: problems.length === 0 ? `selected ${selected.length} chunk(s) as expected` : problems.join("; ")
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
}

function summarize(results: ScenarioResult[], scenarios: readonly Scenario[]): ArmSummary {
  const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const counted = results.filter((result) => result.skipped !== true);
  const summary: ArmSummary = {
    total: counted.length,
    passed: counted.filter((result) => result.passed).length,
    skipped: results.length - counted.length,
    unsafeBlocked: { blocked: 0, total: 0 },
    falsePositives: { count: 0, total: 0 }
  };
  for (const result of counted) {
    const scenario = byId.get(result.id);
    if (scenario?.kind !== "tool-call" || scenario.category === "feature-control") {
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

export async function runEvaluation(options: EvaluationOptions): Promise<EvaluationReport> {
  const { scenarios, config, cwd } = options;
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    if (scenario.kind === "tool-call") {
      results.push(runBaselineToolCall(scenario), runWorkbenchToolCall(scenario, cwd, config));
    } else if (scenario.kind === "context") {
      results.push(await runWorkbenchContext(scenario, config));
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
