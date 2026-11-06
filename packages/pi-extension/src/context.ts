import { relative, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  contextMessageType,
  injectionBudget,
  packContext,
  retrieveContext,
  retrievalConfig,
  revalidateChunks,
  type PackedContext,
  type WorkbenchConfig
} from "@lab-agent-workbench/core";

/** Only the start of a very long prompt is used as the query. Unmeasured starting value. */
export const maxQueryChars = 4000;
const pressureWarnPercent = 80;
const pressureResetPercent = 60;

/** Metadata and counters only: never the query, paths, snippets, summaries or tool results. */
export interface ContextTelemetryRecord {
  schemaVersion: 1;
  type: "context";
  timestamp: string;
  cwd: string;
  outcome: "injected" | "skipped" | "error";
  reason?: "context-pressure" | "no-match" | "retrieval-failed" | "budget";
  queryTerms?: number;
  filesRead?: number;
  bytesRead?: number;
  scanTruncated?: boolean;
  skippedSources?: number;
  selectedChunks?: number;
  injectedChunks?: number;
  injectedTokensEstimate?: number;
  injectedBytes?: number;
  budgetTokens?: number;
  /** null when Pi reports usage as unknown; never coerced to 0. */
  contextTokens?: number | null;
  contextWindow?: number;
  retrievalMs?: number;
}

export type EmitTelemetry = (cwd: string, config: WorkbenchConfig, record: ContextTelemetryRecord) => Promise<void>;

interface Turn {
  config: WorkbenchConfig;
  packed: PackedContext;
  budgetTokens: number;
}

/**
 * Retrieves once per user prompt (`before_agent_start`) and adds one transient message to each request of that
 * turn (`context`). The message is never written to the session, so it cannot accumulate across turns, and a
 * request never holds more than one.
 */
export function registerContextInjection(
  pi: ExtensionAPI,
  configFor: (cwd: string) => Promise<WorkbenchConfig>,
  projectConfigFor: (cwd: string) => Promise<WorkbenchConfig>,
  emit: EmitTelemetry
): { clear: () => void } {
  const turns = new Map<string, Turn>();
  let failureNotified = false;
  let pressureNotified = false;
  const keyFor = (cwd: string) => resolve(cwd);

  const record = async (cwd: string, config: WorkbenchConfig, body: Omit<ContextTelemetryRecord, "schemaVersion" | "type" | "timestamp" | "cwd">) => {
    try {
      await emit(cwd, config, { schemaVersion: 1, type: "context", timestamp: new Date().toISOString(), cwd, ...body });
    } catch { /* Telemetry must never break a turn. */ }
  };

  const notifyPressure = (ctx: ExtensionContext, percent: number | null | undefined) => {
    if (percent === null || percent === undefined) return;
    if (percent < pressureResetPercent) pressureNotified = false;
    if (percent >= pressureWarnPercent && !pressureNotified && ctx.hasUI) {
      pressureNotified = true;
      ctx.ui.notify(`Context window is about ${Math.round(percent)}% full. LAWb injects less as it fills; Pi compacts automatically.`, "warning");
    }
  };

  pi.on("before_agent_start", async (event, ctx) => {
    const key = keyFor(ctx.cwd);
    turns.delete(key);
    if (event.messageType !== "user") return undefined;

    let config: WorkbenchConfig;
    try {
      config = retrievalConfig(await configFor(ctx.cwd), await projectConfigFor(ctx.cwd));
    } catch {
      return undefined; // Invalid config already fails closed at the tool boundary.
    }
    if (!config.context.enabled) return undefined;

    const startedAt = performance.now();
    const usage = ctx.getContextUsage();
    notifyPressure(ctx, usage?.percent);
    const usageFields = usage ? { contextTokens: usage.tokens, contextWindow: usage.contextWindow } : {};
    const budget = injectionBudget(config, usage);
    if (budget.skipReason) {
      await record(ctx.cwd, config, { outcome: "skipped", reason: budget.skipReason, budgetTokens: 0, ...usageFields });
      return undefined;
    }

    try {
      // Files Pi already loaded into the system prompt (AGENTS.md and friends) are not repeated.
      const exclude = new Set(event.systemPromptOptions.contextFiles.map((file) =>
        relative(ctx.cwd, resolve(ctx.cwd, file.path)).split(sep).join("/").toLowerCase()));
      const result = await retrieveContext({
        root: ctx.cwd,
        query: event.prompt.slice(0, maxQueryChars),
        config,
        signal: ctx.signal,
        exclude
      });
      const packed = packContext(result.selected, budget.tokens, config.context.maxInjectedBytes);
      const common = {
        queryTerms: result.queryTerms,
        filesRead: result.scan.filesRead,
        bytesRead: result.scan.bytesRead,
        scanTruncated: result.scan.truncated,
        skippedSources: result.skipped.length,
        selectedChunks: result.selected.length,
        budgetTokens: budget.tokens,
        retrievalMs: Math.round(performance.now() - startedAt),
        ...usageFields
      };
      if (packed.chunks.length === 0) {
        await record(ctx.cwd, config, {
          outcome: "skipped",
          reason: result.selected.length === 0 ? "no-match" : "budget",
          ...common
        });
        return undefined;
      }
      turns.set(key, { config, packed, budgetTokens: budget.tokens });
      await record(ctx.cwd, config, {
        outcome: "injected",
        injectedChunks: packed.chunks.length,
        injectedTokensEstimate: packed.tokens,
        injectedBytes: packed.bytes,
        ...common
      });
    } catch {
      // Retrieval problems drop the extra context; they never fall back to an unprotected reader.
      await record(ctx.cwd, config, { outcome: "error", reason: "retrieval-failed", budgetTokens: budget.tokens, ...usageFields });
      if (ctx.hasUI && !failureNotified) {
        failureNotified = true;
        ctx.ui.notify("LAWb context retrieval failed; continuing without it.", "warning");
      }
    }
    return undefined;
  });

  pi.on("context", async (event, ctx) => {
    // Only Workbench's own message is ever removed or replaced.
    const kept = event.messages.filter((message) =>
      !(message.role === "custom" && message.customType === contextMessageType));
    const removed = kept.length !== event.messages.length;
    const unchanged = () => (removed ? { messages: kept } : undefined);

    const turn = turns.get(keyFor(ctx.cwd));
    if (!turn) return unchanged();
    try {
      // A switch turned off in /lawb applies at once, even to a selection already prepared.
      if (!(await configFor(ctx.cwd)).context.enabled) return unchanged();
    } catch {
      return unchanged();
    }

    let block = turn.packed;
    try {
      const { fresh, stale } = await revalidateChunks({
        root: ctx.cwd,
        chunks: turn.packed.chunks,
        config: turn.config,
        signal: ctx.signal
      });
      if (stale > 0) block = packContext(fresh, turn.budgetTokens, turn.config.context.maxInjectedBytes);
    } catch {
      return unchanged(); // Cannot confirm the sources are still permitted and current: omit them.
    }
    if (block.text === "") return unchanged();

    const index = kept.map((message) => message.role).lastIndexOf("user");
    if (index === -1) return unchanged();
    const injected = {
      role: "custom",
      customType: contextMessageType,
      content: block.text,
      display: false,
      timestamp: Date.now()
    } as unknown as (typeof kept)[number];
    return { messages: [...kept.slice(0, index), injected, ...kept.slice(index)] };
  });

  return {
    clear: () => {
      turns.clear();
      failureNotified = false;
      pressureNotified = false;
    }
  };
}
