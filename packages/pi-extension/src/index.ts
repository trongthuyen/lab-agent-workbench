import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  evaluateToolCall,
  redact,
  resolveConfig,
  type ConfigLayer,
  type WorkbenchConfig
} from "@lab-agent-workbench/core";

interface PendingCall {
  args: unknown;
  startedAt: string;
}

interface LoadedConfig {
  config: WorkbenchConfig;
  /** True when the project has no .lawb/config.json and the built-in defaults apply. */
  defaulted: boolean;
}

export interface ExtensionOptions {
  /** Where telemetry goes when a project has no config. Defaults to the user's home directory. */
  homeDirectory?: string;
}

async function loadConfig(cwd: string): Promise<LoadedConfig> {
  try {
    const source = await readFile(resolve(cwd, ".lawb", "config.json"), "utf8");
    return { config: resolveConfig(JSON.parse(source) as ConfigLayer), defaulted: false };
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      return { config: resolveConfig(), defaulted: true };
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

/** Projects that were never initialized share one log so no .lawb directory appears in them. */
export function defaultTelemetryPath(homeDirectory: string): string {
  return join(homeDirectory, ".lawb", "runs", "telemetry.jsonl");
}

export function createLabAgentWorkbench(options: ExtensionOptions = {}): (pi: ExtensionAPI) => void {
  return (pi) => {
    const home = options.homeDirectory ?? homedir();
    const pending = new Map<string, PendingCall>();
    const configs = new Map<string, Promise<LoadedConfig>>();
    const configFor = (cwd: string): Promise<LoadedConfig> => {
      let loaded = configs.get(cwd);
      if (!loaded) {
        loaded = loadConfig(cwd);
        configs.set(cwd, loaded);
      }
      return loaded;
    };

    pi.on("tool_call", async (event, ctx) => {
      const { config } = await configFor(ctx.cwd);
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
      const { config } = await configFor(ctx.cwd);
      if (!config.telemetry.enabled) {
        return;
      }
      pending.set(event.toolCallId, {
        args: redact(event.args, config.telemetry.redactPatterns),
        startedAt: new Date().toISOString()
      });
    });

    pi.on("tool_execution_end", async (event, ctx) => {
      const { config, defaulted } = await configFor(ctx.cwd);
      if (!config.telemetry.enabled) {
        return;
      }

      const call = pending.get(event.toolCallId);
      pending.delete(event.toolCallId);
      const outputPath = defaulted
        ? defaultTelemetryPath(home)
        : resolveTelemetryPath(ctx.cwd, config.telemetry.path);
      const record = {
        schemaVersion: 1,
        cwd: ctx.cwd,
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
  };
}

export default createLabAgentWorkbench();
