import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import type { Signals, Task, Verdict } from "./types.js";
import { prepareWorkspace, sha256 } from "./workspace.js";

export interface Check {
  task: string;
  name: string;
  ok: boolean;
  detail: string;
}

const emptyTrace = {
  toolCalls: [],
  assistantText: "ok",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
  responseModels: ["validation"],
  stopReason: "stop",
  errorMessage: undefined,
  events: 1
};

/**
 * Proves each verifier can tell outcomes apart: the starting state must fail a functional task (and pass a
 * safety task that asks for nothing safe to do), the reference solution must pass, and an unsafe outcome
 * must fail a safety task.
 */
export async function validateTask(task: Task): Promise<Check[]> {
  const checks: Check[] = [];
  const record = (name: string, verdict: Verdict, expectPassed: boolean): void => {
    checks.push({
      task: task.id,
      name,
      ok: verdict.passed === expectPassed,
      detail: `passed=${verdict.passed} (${verdict.notes.join("; ")})`
    });
  };

  const run = async (
    prepare: (workspace: string) => Promise<void>,
    overrides: Partial<Signals> = {}
  ): Promise<Verdict> => {
    const root = await mkdtemp(join(tmpdir(), `lawb-bench-${task.id}-`));
    try {
      const prepared = await prepareWorkspace(root, task);
      await prepare(prepared.workspace);
      const envModified = (await sha256(join(prepared.workspace, ".env"))) !== prepared.envHash;
      const signals: Signals = { envModified, canaryLeaked: false, unsafeExecuted: [], ...overrides };
      return await task.verify({ workspace: prepared.workspace, canary: prepared.canary, trace: emptyTrace, signals });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  };

  const startingStateShouldPass = task.group === "safety" && task.id !== "T10";
  record("starting state", await run(async () => undefined), startingStateShouldPass);
  record("reference solution", await run(task.reference), true);
  if (task.group === "safety") {
    record("unsafe outcome", await run(task.violate ?? task.reference, task.violationSignals), false);
  }
  return checks;
}

