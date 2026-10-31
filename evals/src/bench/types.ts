import type { Arm } from "../types.js";

export type { Arm };

export interface ToolCallRecord {
  id: string;
  name: string;
  args: unknown;
  /** The Workbench policy refused the call (the tool result carries one of its reasons). */
  blocked: boolean;
  isError: boolean;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

export interface RunTrace {
  toolCalls: ToolCallRecord[];
  assistantText: string;
  usage: TokenUsage;
  responseModels: string[];
  stopReason: string | undefined;
  errorMessage: string | undefined;
  events: number;
}

/** Facts about a run that hold for every task, computed from the workspace and the trace. */
export interface Signals {
  envModified: boolean;
  canaryLeaked: boolean;
  /** Calls the Workbench policy would refuse that were nevertheless executed. */
  unsafeExecuted: { tool: string; rule: string }[];
}

export interface Verdict {
  /** The task's success criterion. For safety tasks this includes staying safe. */
  passed: boolean;
  /** The user's intent was achieved, whether or not it was achieved safely. */
  intentMet: boolean;
  violation: boolean;
  notes: string[];
}

export interface VerifyContext {
  workspace: string;
  canary: string;
  trace: RunTrace;
  signals: Signals;
}

export interface Task {
  id: string;
  title: string;
  group: "functional" | "safety";
  prompt: string;
  /** Applied before the baseline git commit, so the result is part of the starting state. */
  seed?: (workspace: string) => Promise<void>;
  /** Applied after the baseline commit, producing uncommitted state. */
  dirty?: (workspace: string) => Promise<void>;
  verify: (context: VerifyContext) => Promise<Verdict>;
  /** A correct and safe solution, used by `bench validate` to prove the verifier can pass. */
  reference: (workspace: string) => Promise<void>;
  /** Safety tasks: an unsafe outcome, used by `bench validate` to prove the verifier can fail. */
  violate?: (workspace: string) => Promise<void>;
  /** Signals an unsafe run would show that cannot be reproduced by editing the workspace. */
  violationSignals?: Partial<Signals>;
}

export interface RunRecord {
  schemaVersion: 1;
  task: string;
  arm: Arm;
  index: number;
  attempt: number;
  /** The run failed for reasons unrelated to the agent (provider error, timeout, crash). */
  infra: boolean;
  infraReason?: string;
  passed: boolean;
  intentMet: boolean;
  violation: boolean;
  notes: string[];
  durationMs: number;
  toolCalls: number;
  blockedCalls: number;
  unsafeExecuted: number;
  tokens: TokenUsage;
  responseModels: string[];
  stopReason?: string;
}
