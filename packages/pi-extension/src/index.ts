import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerContextInjection, type ContextTelemetryRecord } from "./context.js";
import { registerFeatureControls } from "./feature-controls.js";
import {
  evaluateToolCall,
  loadProjectConfig,
  redact,
  type LoadedConfig,
  type WorkbenchConfig
} from "@lab-agent-workbench/core";

interface PendingCall {
  args: unknown;
  startedAt: string;
}

export interface ExtensionOptions {
  /** Where telemetry goes when a project has no config. Defaults to the user's home directory. */
  homeDirectory?: string;
}

async function loadConfig(cwd: string): Promise<LoadedConfig> {
  try {
    return await loadProjectConfig(cwd);
  } catch (error) {
    // Pi can report hook errors to the terminal/model. Never echo JSON snippets or arbitrary keys.
    if (error instanceof SyntaxError) {
      throw new SyntaxError("Invalid JSON in .lawb/config.json; fix the file and /reload.");
    }
    throw new Error("Cannot load .lawb/config.json; check its configuration and permissions, then /reload.");
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
    const loadedConfigFor = (cwd: string): Promise<LoadedConfig> => {
      let loaded = configs.get(cwd);
      if (!loaded) {
        loaded = loadConfig(cwd);
        configs.set(cwd, loaded);
      }
      return loaded;
    };

    let clearContext = () => {};
    const configFor = registerFeatureControls(
      pi,
      async (cwd) => (await loadedConfigFor(cwd)).config,
      () => { configs.clear(); pending.clear(); clearContext(); }
    );

    const appendTelemetry = async (cwd: string, config: WorkbenchConfig, record: object): Promise<void> => {
      const { defaulted } = await loadedConfigFor(cwd);
      const outputPath = defaulted
        ? defaultTelemetryPath(home)
        : resolveTelemetryPath(cwd, config.telemetry.path);
      await mkdir(dirname(outputPath), { recursive: true });
      await appendFile(outputPath, `${JSON.stringify(record)}\n`, "utf8");
    };
    clearContext = registerContextInjection(
      pi,
      configFor,
      async (cwd, config, record: ContextTelemetryRecord) => {
        if (config.telemetry.enabled) await appendTelemetry(cwd, config, record);
      }
    ).clear;

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
        pending.delete(event.toolCallId);
        return;
      }

      const call = pending.get(event.toolCallId);
      pending.delete(event.toolCallId);
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

      await appendTelemetry(ctx.cwd, config, record);
    });
  };
}

export default createLabAgentWorkbench();
