import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { getProfile, resolveConfig, validateConfig, type WorkbenchConfig } from "@lab-agent-workbench/core";
import { loadScenarios, parseScenario, runEvaluation } from "../src/index.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const fixtureDirectory = join(root, "fixtures", "nestjs-sample");

async function fixtureConfig(): Promise<WorkbenchConfig> {
  const source = await readFile(join(fixtureDirectory, ".lawb", "config.json"), "utf8");
  return validateConfig(JSON.parse(source) as unknown);
}

async function evaluate(config?: WorkbenchConfig) {
  return runEvaluation({
    scenarios: await loadScenarios(join(root, "scenarios")),
    config: config ?? (await fixtureConfig()),
    cwd: fixtureDirectory,
    repositoryCommit: "test"
  });
}

test("the sample project config is exactly what lawb init writes for the nestjs profile", async () => {
  assert.deepEqual(await fixtureConfig(), resolveConfig(getProfile("nestjs")));
});

test("the shipped scenario set covers every category with at least ten scenarios", async () => {
  const scenarios = await loadScenarios(join(root, "scenarios"));
  assert.ok(scenarios.length >= 10);
  const categories = new Set(scenarios.map((scenario) => scenario.category));
  for (const category of ["protected-path", "risky-command", "fail-closed", "allowed-work", "redaction"]) {
    assert.ok(categories.has(category as never), `missing category ${category}`);
  }
});

test("the workbench passes every scenario on the sample project", async () => {
  const report = await evaluate();
  const failures = report.results.filter((result) => result.arm === "workbench" && !result.passed);
  assert.deepEqual(failures, []);
  assert.equal(report.arms.workbench.unsafeBlocked.blocked, report.arms.workbench.unsafeBlocked.total);
  assert.equal(report.arms.workbench.falsePositives.count, 0);
});

test("the pi-default baseline blocks nothing, so unsafe scenarios fail for it", async () => {
  const report = await evaluate();
  assert.equal(report.arms.baseline.unsafeBlocked.blocked, 0);
  assert.ok(report.arms.baseline.unsafeBlocked.total > 0);
  assert.equal(report.arms.baseline.falsePositives.count, 0);
});

test("the report never contains secret fixtures", async () => {
  const scenarios = await loadScenarios(join(root, "scenarios"));
  const secrets = scenarios.flatMap((scenario) => (scenario.kind === "redaction" ? scenario.mustNotContain : []));
  assert.ok(secrets.length > 0);
  const serialized = JSON.stringify(await evaluate());
  for (const secret of secrets) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("scenarios detect a policy regression", async () => {
  const weakened = resolveConfig(getProfile("nestjs"), {
    policies: { allowOutsideWorkspace: true, protectedPaths: [], protectedReadPaths: [], riskyCommandPatterns: [] }
  });
  const report = await evaluate(weakened);
  const failed = new Set(
    report.results.filter((result) => result.arm === "workbench" && !result.passed).map((result) => result.id)
  );
  for (const id of ["PP-001", "PP-003", "PP-004", "PP-006", "PP-008", "PP-009", "PP-010", "PP-012", "PP-014", "PP-016", "PP-023", "PP-024", "RC-001", "RC-002", "RC-003", "RC-004", "RC-005", "RC-006", "RC-007", "RC-008"]) {
    assert.ok(failed.has(id), `${id} should fail when the policy is weakened`);
  }
  assert.ok(report.arms.workbench.unsafeBlocked.blocked < report.arms.workbench.unsafeBlocked.total);
});

test("scenarios detect a redaction regression", async () => {
  const weakened = resolveConfig(getProfile("nestjs"), { telemetry: { redactPatterns: [] } });
  const report = await evaluate(weakened);
  const failed = report.results.filter((result) => !result.passed).map((result) => result.id);
  assert.ok(failed.includes("RD-002"));
  assert.ok(failed.includes("RD-003"));
});

test("rejects malformed scenarios", () => {
  assert.throws(() => parseScenario({}, "empty.json"), /id must be/);
  assert.throws(
    () => parseScenario({ id: "X", category: "nope", description: "d", kind: "tool-call" }, "x.json"),
    /category is unknown/
  );
  assert.throws(
    () =>
      parseScenario(
        {
          id: "X",
          category: "protected-path",
          description: "d",
          kind: "tool-call",
          toolCall: { toolName: "write", input: {} },
          expect: { allowed: false }
        },
        "x.json"
      ),
    /must name the expected rule/
  );
  assert.throws(
    () => parseScenario({ id: "X", category: "redaction", description: "d", kind: "redaction", mustNotContain: [] }, "x.json"),
    /mustNotContain/
  );
});

test("feature-control scenarios are evaluated separately from default safety and false-positive rates", async () => {
  const scenarios = await loadScenarios(join(root, "scenarios"));
  const options = { config: await fixtureConfig(), cwd: fixtureDirectory, repositoryCommit: "test" };
  const full = await runEvaluation({ ...options, scenarios });
  const original = await runEvaluation({ ...options, scenarios: scenarios.filter((item) => item.category !== "feature-control") });
  assert.ok(scenarios.some((item) => item.category === "feature-control"));
  assert.equal(full.arms.workbench.passed, full.arms.workbench.total);
  for (const arm of ["baseline", "workbench"] as const) {
    assert.deepEqual(full.arms[arm].unsafeBlocked, original.arms[arm].unsafeBlocked);
    assert.deepEqual(full.arms[arm].falsePositives, original.arms[arm].falsePositives);
  }
});

test("feature-control scenarios require valid explicit switches and their own category", () => {
  const scenario = {
    id: "FT-X", category: "feature-control", description: "switch validation", kind: "tool-call",
    toolCall: { toolName: "read", input: { path: ".env" } }, expect: { allowed: true }
  };
  assert.throws(() => parseScenario({ ...scenario, kind: "redaction" }, "ft.json"), /requires a tool-call/);
  assert.throws(() => parseScenario(scenario, "ft.json"), /requires features/);
  assert.throws(() => parseScenario({ ...scenario, features: {} }, "ft.json"), /supported boolean switches/);
  const features = { writeProtection: true, readProtection: false, riskyCommands: true, telemetry: false };
  assert.throws(() => parseScenario({ ...scenario, category: "allowed-work", features }, "ft.json"), /require the feature-control category/);
  assert.equal(parseScenario({ ...scenario, features }, "ft.json").id, "FT-X");
});

test("rejects duplicate scenario ids", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lawb-evals-"));
  try {
    const scenario = {
      id: "DUP-001",
      category: "allowed-work",
      description: "d",
      kind: "tool-call",
      toolCall: { toolName: "read", input: {} },
      expect: { allowed: true }
    };
    await writeFile(join(directory, "a.json"), JSON.stringify(scenario), "utf8");
    await writeFile(join(directory, "b.json"), JSON.stringify(scenario), "utf8");
    await assert.rejects(loadScenarios(directory), /Duplicate scenario id/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("context scenarios detect a read-protection regression without leaking canaries into the report", async () => {
  const weakened = resolveConfig(await fixtureConfig(), { policies: { protectedReadPaths: [] } });
  const report = await evaluate(weakened);
  const failed = report.results.filter((item) => item.arm === "workbench" && !item.passed && item.skipped !== true).map((item) => item.id);
  assert.ok(failed.includes("CTX-SAFE-001"));
  assert.ok(failed.includes("CTX-SAFE-004") || report.results.some((item) => item.id === "CTX-SAFE-004" && item.skipped === true));
  assert.ok(!JSON.stringify(report).includes("CANARY"));
});

test("context scenarios are workbench-only and excluded from the default safety rates", async () => {
  const scenarios = await loadScenarios(join(root, "scenarios"));
  const context = scenarios.filter((scenario) => scenario.kind === "context");
  assert.ok(context.length >= 12);
  const full = await runEvaluation({ scenarios, config: await fixtureConfig(), cwd: fixtureDirectory, repositoryCommit: "test" });
  const without = await runEvaluation({
    scenarios: scenarios.filter((scenario) => scenario.kind !== "context"),
    config: await fixtureConfig(),
    cwd: fixtureDirectory,
    repositoryCommit: "test"
  });
  assert.deepEqual(full.arms.workbench.unsafeBlocked, without.arms.workbench.unsafeBlocked);
  assert.deepEqual(full.arms.workbench.falsePositives, without.arms.workbench.falsePositives);
  assert.equal(full.results.filter((item) => item.arm === "baseline").length, without.results.filter((item) => item.arm === "baseline").length);
});

test("rejects malformed context scenarios", () => {
  const valid = {
    id: "CTX-X", category: "context", description: "d", kind: "context",
    files: { "a.md": "x" }, query: "q", expect: { selected: [] }
  };
  assert.doesNotThrow(() => parseScenario(valid, "x"));
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ ...valid, category: "protected-path" }, /used together/],
    [{ ...valid, kind: "tool-call", toolCall: { toolName: "read" }, expect: { allowed: true } }, /used together/],
    [{ ...valid, files: undefined }, /files must map/],
    [{ ...valid, files: { "a.md": 1 } }, /files must map/],
    [{ ...valid, query: 5 }, /query must be a string/],
    [{ ...valid, expect: {} }, /expect\.selected/],
    [{ ...valid, expect: { selected: [], skipped: { "a.md": 1 } } }, /expect\.skipped/],
    [{ ...valid, expect: { selected: [], mustNotContain: [1] } }, /mustNotContain/]
  ];
  for (const [value, message] of cases) {
    assert.throws(() => parseScenario(value, "x"), message);
  }
});

test("budget scenarios fail when the budget is not enforced", async () => {
  const scenarios = await loadScenarios(join(root, "scenarios"));
  const bud = scenarios.find((scenario) => scenario.id === "BUD-001");
  assert.ok(bud && bud.kind === "context");
  const loosened = { ...bud, config: { context: { ...bud.config?.context, maxInjectedTokens: 4000 } } };
  const report = await runEvaluation({ scenarios: [loosened], config: await fixtureConfig(), cwd: fixtureDirectory, repositoryCommit: "test" });
  assert.equal(report.results.find((item) => item.id === "BUD-001")?.passed, false);
  assert.equal(report.results.find((item) => item.id === "BUD-001")?.detail.includes("expected 1"), true);
});

test("rejects malformed injection expectations", () => {
  const valid = {
    id: "BUD-X", category: "budget", description: "d", kind: "context",
    files: { "a.md": "x" }, query: "q", usage: { tokens: null, contextWindow: 1000 }, expect: { selected: [], injected: [] }
  };
  assert.doesNotThrow(() => parseScenario(valid, "x"));
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ ...valid, usage: undefined }, /require usage/],
    [{ ...valid, usage: { tokens: "x", contextWindow: 10 } }, /usage must have/],
    [{ ...valid, usage: { tokens: 1 } }, /usage must have/],
    [{ ...valid, expect: { selected: [], injected: "a" } }, /expect\.injected/],
    [{ ...valid, expect: { selected: [], renderedCounts: { a: "1" } } }, /renderedCounts/]
  ];
  for (const [value, message] of cases) {
    assert.throws(() => parseScenario(value, "x"), message);
  }
});
