import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  evaluateToolCall,
  redact,
  resolveConfig,
  validateConfig,
  type WorkbenchConfig
} from "@lab-agent-workbench/core";

interface PendingCall {
  args: unknown;
  startedAt: string;
}

async function loadConfig(cwd: string): Promise<WorkbenchConfig> {
  try {
    const source = await readFile(resolve(cwd, ".lawb", "config.json"), "utf8");
    return validateConfig(JSON.parse(source) as unknown);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      return resolveConfig();
    }
    throw error;
  }
}

function resolveTelemetryPath(cwd: string, configuredPath: string): string {
  const outputPath = resolve(cwd, configuredPath);
  const relativePath = relative(cwd, outputPath);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`Telemetry path must remain inside the workspace: ${configuredPath}`);
  }
  return outputPath;
}

export default function labAgentWorkbench(pi: ExtensionAPI): void {
  const pending = new Map<string, PendingCall>();
  const configs = new Map<string, Promise<WorkbenchConfig>>();
  const configFor = (cwd: string): Promise<WorkbenchConfig> => {
    let config = configs.get(cwd);
    if (!config) {
      config = loadConfig(cwd);
      configs.set(cwd, config);
    }
    return config;
  };

  pi.on("tool_call", async (event, ctx) => {
    const config = await configFor(ctx.cwd);
    const decision = evaluateToolCall(
      { toolName: event.toolName, input: event.input },
      ctx.cwd,
      config
    );
    if (!decision.allowed) {
      return { block: true, reason: decision.reason ?? "Blocked by Lab Agent Workbench policy" };
    }
    return undefined;
  });

  pi.on("tool_execution_start", async (event, ctx) => {
    const config = await configFor(ctx.cwd);
    if (!config.telemetry.enabled) {
      return;
    }
    pending.set(event.toolCallId, {
      args: redact(event.args, config.telemetry.redactPatterns),
      startedAt: new Date().toISOString()
    });
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    const config = await configFor(ctx.cwd);
    if (!config.telemetry.enabled) {
      return;
    }

    const call = pending.get(event.toolCallId);
    pending.delete(event.toolCallId);
    const outputPath = resolveTelemetryPath(ctx.cwd, config.telemetry.path);
    const record = {
      schemaVersion: 1,
      toolCallId: event.toolCallId,
      parentToolCallId: event.parentToolCallId,
      toolName: event.toolName,
      args: call?.args ?? "[UNAVAILABLE]",
      startedAt: call?.startedAt,
      endedAt: new Date().toISOString(),
      durationMs: event.durationMs,
      isError: event.isError
    };

    await mkdir(dirname(outputPath), { recursive: true });
    await appendFile(outputPath, `${JSON.stringify(record)}\n`, "utf8");
  });
}
