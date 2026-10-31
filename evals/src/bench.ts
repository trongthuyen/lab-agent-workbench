#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveConfig, type ConfigLayer } from "@lab-agent-workbench/core";
import { jobKey, planJobs } from "./bench/plan.js";
import { model, runJob, thinking, type RunOptions } from "./bench/run.js";
import { buildReport, renderMarkdown } from "./bench/stats.js";
import { tasks } from "./bench/tasks.js";
import type { Arm, RunRecord } from "./bench/types.js";
import { validateTask } from "./bench/validate.js";
import { evalsRoot, extensionEntry, fixtureDirectory } from "./bench/workspace.js";

const usage = `Usage:
  bench run      [--runs 5] [--tasks T01,T02] [--arms baseline,workbench] [--concurrency 1]
                 [--timeout-minutes 15] [--attempts 2] [--seed 1] [--out <dir>] [--id EXP-002] [--reports <dir>]
                 [--keep] [--dry-run]
  bench validate [--tasks T01,T02]
  bench report   [--out <dir>] [--id EXP-002] [--reports <dir>]
`;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function numberOption(args: string[], name: string, fallback: number): number {
  const raw = option(args, name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function listOption(args: string[], name: string, all: readonly string[]): string[] {
  const raw = option(args, name);
  if (raw === undefined) {
    return [...all];
  }
  const wanted = raw.split(",").map((item) => item.trim());
  const unknown = wanted.filter((item) => !all.includes(item));
  if (unknown.length > 0) {
    throw new Error(`${name}: unknown value(s) ${unknown.join(", ")}`);
  }
  return wanted;
}

function repositoryCommit(): string {
  try {
    const run = (...args: string[]) => execFileSync("git", args, { cwd: evalsRoot, encoding: "utf8" }).trim();
    return `${run("rev-parse", "--short", "HEAD")}${run("status", "--porcelain", "--untracked-files=no") === "" ? "" : "+uncommitted"}`;
  } catch {
    return "unknown";
  }
}

async function loadRecords(outDirectory: string): Promise<RunRecord[]> {
  const directory = join(outDirectory, "results");
  if (!existsSync(directory)) {
    return [];
  }
  const records: RunRecord[] = [];
  for (const file of (await readdir(directory)).filter((name) => name.endsWith(".json")).sort()) {
    records.push(JSON.parse(await readFile(join(directory, file), "utf8")) as RunRecord);
  }
  return records;
}

async function writeReport(outDirectory: string, reportDirectory: string, id: string): Promise<void> {
  const records = await loadRecords(outDirectory);
  if (records.length === 0) {
    throw new Error(`No results in ${join(outDirectory, "results")}`);
  }
  const observedModels = [...new Set(records.flatMap((record) => record.responseModels))].sort();
  const report = buildReport({
    records,
    tasks: tasks.map(({ id, title, group }) => ({ id, title, group })),
    manifest: {
      id,
      problem: "task-success-and-safety-with-a-live-agent",
      baseline: "pi-default",
      variant: "workbench-nestjs-policy-v1",
      model: `${model}${observedModels.length > 0 ? ` (served by ${observedModels.join(", ")})` : ""}`,
      thinking,
      repositoryCommit: repositoryCommit(),
      runsPerCell: Math.max(...records.map((record) => record.index)),
      metrics: ["task_success_rate", "violations", "blocked_calls", "tool_calls", "tokens", "duration"]
    }
  });
  await mkdir(reportDirectory, { recursive: true });
  await writeFile(join(reportDirectory, `${id}.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(join(reportDirectory, `${id}.md`), renderMarkdown(report), "utf8");

  const { criteria, functional } = report;
  process.stdout.write(
    [
      `Functional tasks: pi-default ${functional.baseline.passed}/${functional.baseline.runs}, Workbench ${functional.workbench.passed}/${functional.workbench.runs}`,
      `Tasks completed by Workbench: ${criteria.tasksCompleted.count}/${criteria.tasksCompleted.total} (needs ${criteria.tasksCompleted.required})`,
      `No-drop criterion: ${criteria.nonInferiority.evaluated ? `${criteria.nonInferiority.met ? "met" : "NOT met"} (${criteria.nonInferiority.differencePoints.toFixed(1)} points)` : "not evaluated (one arm has no runs)"}`,
      `Safety: ${criteria.safety.met ? "met" : "NOT met"} (Workbench violations ${criteria.safety.workbenchViolations}, pi-default ${criteria.safety.baselineViolations})`,
      `Report: ${join(reportDirectory, `${id}.md`)}`,
      ""
    ].join("\n")
  );
}

async function runCommand(args: string[]): Promise<void> {
  const outDirectory = resolve(option(args, "--out") ?? join(evalsRoot, "runs", "bench"));
  const runs = numberOption(args, "--runs", 5);
  const arms = listOption(args, "--arms", ["baseline", "workbench"]) as Arm[];
  const taskIds = listOption(args, "--tasks", tasks.map((task) => task.id));
  const concurrency = numberOption(args, "--concurrency", 1);
  const options: RunOptions = {
    outDirectory,
    timeoutMs: numberOption(args, "--timeout-minutes", 15) * 60_000,
    maxAttempts: numberOption(args, "--attempts", 2),
    keepWorkspaces: args.includes("--keep"),
    config: resolveConfig(JSON.parse(await readFile(join(fixtureDirectory, ".lawb", "config.json"), "utf8")) as ConfigLayer)
  };

  const done = new Set((await loadRecords(outDirectory)).filter((record) => !record.infra).map((record) => jobKey(record)));
  const planned = planJobs({ tasks: taskIds, arms, runs, seed: numberOption(args, "--seed", 1) });
  const pending = planned.filter((job) => !done.has(jobKey(job)));
  process.stdout.write(`${planned.length} runs planned, ${planned.length - pending.length} already done, ${pending.length} to run (concurrency ${concurrency}).\n`);
  if (args.includes("--dry-run") || pending.length === 0) {
    return;
  }
  if (!existsSync(extensionEntry)) {
    throw new Error(`Build the extension first (npm run build): ${extensionEntry} is missing`);
  }

  let started = 0;
  let finished = 0;
  let finishedValid = 0;
  let consecutiveInfra = 0;
  let abort: string | undefined;
  const startedAt = Date.now();

  const worker = async (): Promise<void> => {
    while (abort === undefined) {
      const job = pending[started];
      if (!job) {
        return;
      }
      started += 1;
      const outcome = await runJob(job, options);
      finished += 1;
      const { record } = outcome;
      if (record.infra) {
        consecutiveInfra += 1;
        if (finishedValid === 0 || consecutiveInfra >= 5) {
          abort = `Stopping: ${record.task} ${record.arm} #${record.index} failed for infrastructure reasons after ${record.attempt} attempt(s): ${outcome.diagnostic}`;
        }
      } else {
        consecutiveInfra = 0;
        finishedValid += 1;
      }
      const elapsedMinutes = (Date.now() - startedAt) / 60_000;
      const remaining = Math.round((elapsedMinutes / finished) * (pending.length - finished));
      const status = record.infra ? `INFRA ${outcome.diagnostic.slice(0, 80)}` : record.passed ? "pass" : "FAIL";
      process.stdout.write(
        `[${finished}/${pending.length}] ${record.task} ${record.arm} #${record.index} ${status} ${Math.round(record.durationMs / 1000)}s tools=${record.toolCalls} blocked=${record.blockedCalls}${record.violation ? " VIOLATION" : ""} (about ${remaining} min left)\n`
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, () => worker()));

  if (abort !== undefined) {
    throw new Error(abort);
  }
  await writeReport(outDirectory, resolve(option(args, "--reports") ?? join(evalsRoot, "reports")), option(args, "--id") ?? "EXP-002");
}

async function validateCommand(args: string[]): Promise<void> {
  const wanted = listOption(args, "--tasks", tasks.map((task) => task.id));
  let failed = 0;
  for (const task of tasks.filter((candidate) => wanted.includes(candidate.id))) {
    for (const check of await validateTask(task)) {
      failed += check.ok ? 0 : 1;
      process.stdout.write(`${check.ok ? "ok  " : "FAIL"} ${check.task} ${check.name}: ${check.detail}\n`);
    }
  }
  if (failed > 0) {
    throw new Error(`${failed} validation check(s) failed`);
  }
  process.stdout.write("All verifiers behave as intended.\n");
}

async function main(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  if (command === "run") {
    return runCommand(rest);
  }
  if (command === "validate") {
    return validateCommand(rest);
  }
  if (command === "report") {
    return writeReport(
      option(rest, "--out") ?? join(evalsRoot, "runs", "bench"),
      option(rest, "--reports") ?? join(evalsRoot, "reports"),
      option(rest, "--id") ?? "EXP-002"
    );
  }
  process.stdout.write(usage);
  if (command !== undefined && command !== "--help") {
    throw new Error(`Unknown command: ${command}`);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`bench: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
