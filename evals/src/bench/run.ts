import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkbenchConfig } from "@lab-agent-workbench/core";
import { parseTrace, spawnCollect, type SpawnResult } from "./pi.js";
import { computeSignals } from "./signals.js";
import { taskById } from "./tasks.js";
import type { RunRecord, RunTrace } from "./types.js";
import type { Job } from "./plan.js";
import { jobKey } from "./plan.js";
import { extensionEntry, prepareAgentDirectory, prepareWorkspace } from "./workspace.js";

export const model = "pi-claude-code-provider/sonnet";
export const thinking = "medium";

export interface RunOptions {
  outDirectory: string;
  timeoutMs: number;
  maxAttempts: number;
  keepWorkspaces: boolean;
  config: WorkbenchConfig;
}

const tail = (text: string, length = 400): string => text.trim().slice(-length);

/** Returns a reason when the run failed for reasons unrelated to the agent, so it is retried and excluded. */
export function classifyInfra(result: SpawnResult, trace: RunTrace): string | undefined {
  if (result.timedOut) {
    return `timed out after ${Math.round(result.durationMs / 1000)}s`;
  }
  if (result.exitCode === null) {
    return `pi could not run: ${tail(result.stderr)}`;
  }
  if (trace.events === 0) {
    return `pi produced no events (exit ${result.exitCode}): ${tail(result.stderr)}`;
  }
  if (trace.responseModels.length === 0) {
    return `no assistant response (exit ${result.exitCode}): ${tail(result.stderr)}`;
  }
  if (trace.stopReason === "error" || trace.stopReason === "aborted") {
    return `provider ${trace.stopReason}: ${trace.errorMessage ?? "no message"}`;
  }
  return undefined;
}

export function piArguments(arm: Job["arm"], prompt: string): string[] {
  return [
    "-p",
    "--mode",
    "json",
    "--no-session",
    "--no-context-files",
    "--no-skills",
    "--no-prompt-templates",
    "--model",
    model,
    "--thinking",
    thinking,
    ...(arm === "workbench" ? ["-e", extensionEntry] : []),
    "--",
    prompt
  ];
}

export interface AttemptResult {
  record: RunRecord;
  transcript: string;
  diagnostic: string;
}

export async function runAttempt(job: Job, attempt: number, options: RunOptions): Promise<AttemptResult> {
  const task = taskById(job.task);
  const root = join(options.outDirectory, "work", `${jobKey(job)}-a${attempt}`);
  const prepared = await prepareWorkspace(root, task);
  const agentDirectory = await prepareAgentDirectory(root);

  const result = await spawnCollect({
    command: "pi",
    args: piArguments(job.arm, task.prompt),
    cwd: prepared.workspace,
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: agentDirectory,
      PI_SKIP_VERSION_CHECK: "1",
      PI_TELEMETRY: "0"
    },
    timeoutMs: options.timeoutMs
  });

  const trace = parseTrace(result.stdout);
  const infraReason = classifyInfra(result, trace);
  const base = {
    schemaVersion: 1 as const,
    task: job.task,
    arm: job.arm,
    index: job.index,
    attempt,
    durationMs: result.durationMs,
    toolCalls: trace.toolCalls.length,
    blockedCalls: trace.toolCalls.filter((call) => call.blocked).length,
    tokens: trace.usage,
    responseModels: trace.responseModels,
    ...(trace.stopReason === undefined ? {} : { stopReason: trace.stopReason })
  };

  let record: RunRecord;
  if (infraReason !== undefined) {
    record = {
      ...base,
      infra: true,
      infraReason,
      passed: false,
      intentMet: false,
      violation: false,
      notes: [],
      unsafeExecuted: 0
    };
  } else {
    const signals = await computeSignals({
      trace,
      stdout: result.stdout,
      workspace: prepared.workspace,
      config: options.config,
      canary: prepared.canary,
      envHash: prepared.envHash
    });
    const verdict = await task.verify({ workspace: prepared.workspace, canary: prepared.canary, trace, signals });
    record = {
      ...base,
      infra: false,
      passed: verdict.passed,
      intentMet: verdict.intentMet,
      violation: verdict.violation,
      notes: verdict.notes,
      unsafeExecuted: signals.unsafeExecuted.length
    };
  }

  if (!options.keepWorkspaces) {
    await rm(root, { recursive: true, force: true });
  }
  return { record, transcript: result.stdout, diagnostic: infraReason ?? "" };
}

/** Runs a job, retrying infrastructure failures, and stores the final record and transcript. */
export async function runJob(job: Job, options: RunOptions): Promise<AttemptResult> {
  let last: AttemptResult | undefined;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    last = await runAttempt(job, attempt, options);
    if (!last.record.infra) {
      break;
    }
  }
  if (!last) {
    throw new Error("maxAttempts must be at least 1");
  }

  await mkdir(join(options.outDirectory, "results"), { recursive: true });
  await mkdir(join(options.outDirectory, "transcripts"), { recursive: true });
  await writeFile(join(options.outDirectory, "results", `${jobKey(job)}.json`), `${JSON.stringify(last.record, null, 2)}\n`, "utf8");
  await writeFile(join(options.outDirectory, "transcripts", `${jobKey(job)}.jsonl`), last.transcript, "utf8");
  return last;
}
