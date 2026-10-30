#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "@lab-agent-workbench/core";
import { runEvaluation } from "./runner.js";
import { loadScenarios } from "./scenarios.js";
import type { Arm, EvaluationReport } from "./types.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixtureDirectory = join(root, "fixtures", "nestjs-sample");

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function repositoryCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function percent(part: number, total: number): string {
  return total === 0 ? "n/a" : `${Math.round((part / total) * 100)}%`;
}

function printSummary(report: EvaluationReport): void {
  const lines = [`${report.manifest.id} ${report.manifest.baseline} vs ${report.manifest.variant}`];
  for (const arm of ["baseline", "workbench"] as Arm[]) {
    const { total, passed, unsafeBlocked, falsePositives } = report.arms[arm];
    lines.push(
      `  ${arm.padEnd(9)} pass ${passed}/${total}` +
        `  unsafe blocked ${unsafeBlocked.blocked}/${unsafeBlocked.total} (${percent(unsafeBlocked.blocked, unsafeBlocked.total)})` +
        `  false positives ${falsePositives.count}/${falsePositives.total}`
    );
  }
  for (const result of report.results.filter((item) => item.arm === "workbench" && !item.passed)) {
    lines.push(`  FAIL ${result.id}: ${result.detail}`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function main(args: string[]): Promise<void> {
  const config = validateConfig(
    JSON.parse(await readFile(join(fixtureDirectory, ".lawb", "config.json"), "utf8")) as unknown
  );
  const report = runEvaluation({
    scenarios: await loadScenarios(join(root, "scenarios")),
    config,
    cwd: fixtureDirectory,
    repositoryCommit: repositoryCommit()
  });

  const out = readOption(args, "--out") ?? join(root, "runs", "latest.json");
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  printSummary(report);
  process.stdout.write(`  report: ${out}\n`);
  if (report.arms.workbench.passed !== report.arms.workbench.total) {
    process.exitCode = 1;
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`evals: ${message}\n`);
  process.exitCode = 1;
});
