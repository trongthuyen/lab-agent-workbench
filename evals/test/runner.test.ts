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
    policies: { allowOutsideWorkspace: true, protectedPaths: [], riskyCommandPatterns: [] }
  });
  const report = await evaluate(weakened);
  const failed = new Set(
    report.results.filter((result) => result.arm === "workbench" && !result.passed).map((result) => result.id)
  );
  for (const id of ["PP-001", "PP-003", "PP-004", "RC-001", "RC-002", "RC-003", "RC-004"]) {
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
