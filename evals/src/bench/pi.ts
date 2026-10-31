import { spawn } from "node:child_process";
import type { RunTrace, ToolCallRecord } from "./types.js";

/** Text the Workbench policy puts in a refusal. Matched against error tool results. */
const refusalMarkers = [
  "Path matches protected",
  "Command matches risky pattern",
  "Command references a path matching protected",
  "Command modifies a path matching protected",
  "Path is outside the workspace",
  " call has no path",
  " call has no command"
];

export function isWorkbenchRefusal(text: string): boolean {
  return refusalMarkers.some((marker) => text.includes(marker));
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((item) => (isRecord(item) && item.type === "text" && typeof item.text === "string" ? item.text : ""))
    .join("\n");
}

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Reads the line-delimited events written by `pi --mode json`. Unknown lines are ignored. */
export function parseTrace(stdout: string): RunTrace {
  const calls = new Map<string, ToolCallRecord>();
  const trace: RunTrace = {
    toolCalls: [],
    assistantText: "",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    responseModels: [],
    stopReason: undefined,
    errorMessage: undefined,
    events: 0
  };

  const recordResult = (result: unknown): void => {
    if (!isRecord(result) || typeof result.toolCallId !== "string") {
      return;
    }
    const call = calls.get(result.toolCallId) ?? {
      id: result.toolCallId,
      name: typeof result.toolName === "string" ? result.toolName : "unknown",
      args: undefined,
      blocked: false,
      isError: false
    };
    call.isError = result.isError === true;
    call.blocked = call.isError && isWorkbenchRefusal(textOf(result.content));
    calls.set(call.id, call);
  };

  const recordMessage = (message: unknown): void => {
    if (!isRecord(message)) {
      return;
    }
    if (message.role === "toolResult") {
      recordResult(message);
      return;
    }
    if (message.role !== "assistant") {
      return;
    }

    const usage = isRecord(message.usage) ? message.usage : {};
    trace.usage.input += numberOf(usage.input);
    trace.usage.output += numberOf(usage.output);
    trace.usage.cacheRead += numberOf(usage.cacheRead);
    trace.usage.cacheWrite += numberOf(usage.cacheWrite);
    trace.usage.totalTokens += numberOf(usage.totalTokens);

    const model = typeof message.responseModel === "string" ? message.responseModel : message.model;
    if (typeof model === "string" && !trace.responseModels.includes(model)) {
      trace.responseModels.push(model);
    }
    trace.stopReason = typeof message.stopReason === "string" ? message.stopReason : trace.stopReason;
    trace.errorMessage = typeof message.errorMessage === "string" ? message.errorMessage : trace.errorMessage;

    for (const item of Array.isArray(message.content) ? message.content : []) {
      if (!isRecord(item)) {
        continue;
      }
      if (item.type === "text" && typeof item.text === "string") {
        trace.assistantText += `${item.text}\n`;
      } else if (item.type === "toolCall" && typeof item.id === "string") {
        const existing = calls.get(item.id);
        calls.set(item.id, {
          id: item.id,
          name: typeof item.name === "string" ? item.name : "unknown",
          args: item.arguments,
          blocked: existing?.blocked ?? false,
          isError: existing?.isError ?? false
        });
      }
    }
  };

  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) {
      continue;
    }
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(event)) {
      continue;
    }
    trace.events += 1;
    if (event.type === "message_end") {
      recordMessage(event.message);
    } else if (event.type === "turn_end") {
      for (const result of Array.isArray(event.toolResults) ? event.toolResults : []) {
        recordResult(result);
      }
    }
  }

  trace.toolCalls = [...calls.values()];
  return trace;
}

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
}

export interface SpawnOptions {
  command: string;
  args: readonly string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  shell?: boolean;
}

/** Runs a process, collecting output, and kills its whole group when the timeout expires. */
export function spawnCollect(options: SpawnOptions): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(options.command, [...options.args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: options.shell ?? false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid !== undefined && process.platform !== "win32") {
          process.kill(-child.pid, "SIGKILL");
        } else {
          child.kill("SIGKILL");
        }
      } catch {
        child.kill("SIGKILL");
      }
    }, options.timeoutMs);

    const finish = (exitCode: number | null): void => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode, timedOut, durationMs: Date.now() - startedAt });
    };
    child.on("error", (error) => {
      stderr += `${error.message}\n`;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}
