/**
 * Summarizes one Pi session (plus the Workbench telemetry log) into the counters DOGFOOD-001 compares.
 * It reads usage, timing and tool names only; message text, tool arguments and results are never copied out.
 */

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface DogfoodSummary {
  label: string;
  cwd: string | null;
  models: string[];
  assistantTurns: number;
  /** Assistant messages that carried no usage. When above 0 the token totals are incomplete. */
  turnsWithoutUsage: number;
  /** Null when no assistant message reported usage; never coerced to 0. */
  usage: UsageTotals | null;
  /** Null unless the provider reported a positive cost. */
  costTotal: number | null;
  toolCalls: number;
  toolCallsByName: Record<string, number>;
  /** read + grep + find + ls: the calls retrieval is meant to reduce. */
  readSearchCalls: number;
  modelMs: number | null;
  wallMs: number | null;
  context: {
    records: number;
    injected: number;
    skipped: number;
    errors: number;
    injectedTokensEstimate: number;
    retrievalMs: number;
  } | null;
}

const readSearchTools = new Set(["read", "grep", "find", "ls"]);

function parseLines(text: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value === "object" && value !== null && !Array.isArray(value)) rows.push(value as Record<string, unknown>);
    } catch { /* A torn last line from a live session is skipped. */ }
  }
  return rows;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

function toMillis(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

export function summarizeSession(label: string, sessionText: string, telemetryText?: string): DogfoodSummary {
  const rows = parseLines(sessionText);
  const header = rows.find((row) => row.type === "session");
  const cwd = typeof header?.cwd === "string" ? header.cwd : null;

  const models = new Set<string>();
  const byName: Record<string, number> = {};
  const usage: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let turns = 0;
  let withoutUsage = 0;
  let reported = 0;
  let cost = 0;
  let modelMs = 0;
  let sawDuration = false;
  let first: number | undefined;
  let last: number | undefined;

  for (const row of rows) {
    const stamp = toMillis(row.timestamp);
    if (stamp !== undefined) {
      first = first === undefined ? stamp : Math.min(first, stamp);
      last = last === undefined ? stamp : Math.max(last, stamp);
    }
    const message = row.type === "message" && isRecord(row.message) ? row.message : undefined;
    if (message?.role !== "assistant") continue;
    turns += 1;
    if (typeof message.model === "string") models.add(message.model);
    const duration = num(message.durationMs);
    if (duration !== undefined) {
      modelMs += duration;
      sawDuration = true;
    }
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (isRecord(part) && part.type === "toolCall" && typeof part.name === "string") {
          byName[part.name] = (byName[part.name] ?? 0) + 1;
        }
      }
    }
    if (!isRecord(message.usage)) {
      withoutUsage += 1;
      continue;
    }
    reported += 1;
    usage.input += num(message.usage.input) ?? 0;
    usage.output += num(message.usage.output) ?? 0;
    usage.cacheRead += num(message.usage.cacheRead) ?? 0;
    usage.cacheWrite += num(message.usage.cacheWrite) ?? 0;
    if (isRecord(message.usage.cost)) cost += num(message.usage.cost.total) ?? 0;
  }

  let context: DogfoodSummary["context"] = null;
  if (telemetryText !== undefined) {
    context = { records: 0, injected: 0, skipped: 0, errors: 0, injectedTokensEstimate: 0, retrievalMs: 0 };
    for (const row of parseLines(telemetryText)) {
      if (row.type !== "context") continue;
      if (cwd !== null && row.cwd !== cwd) continue;
      const at = toMillis(row.timestamp);
      if (first !== undefined && last !== undefined && at !== undefined && (at < first - 1000 || at > last + 1000)) continue;
      context.records += 1;
      if (row.outcome === "injected") context.injected += 1;
      else if (row.outcome === "error") context.errors += 1;
      else context.skipped += 1;
      context.injectedTokensEstimate += num(row.injectedTokensEstimate) ?? 0;
      context.retrievalMs += num(row.retrievalMs) ?? 0;
    }
  }

  return {
    label,
    cwd,
    models: [...models].sort(),
    assistantTurns: turns,
    turnsWithoutUsage: withoutUsage,
    usage: reported > 0 ? usage : null,
    costTotal: cost > 0 ? cost : null,
    toolCalls: Object.values(byName).reduce((sum, count) => sum + count, 0),
    toolCallsByName: Object.fromEntries(Object.entries(byName).sort(([a], [b]) => (a < b ? -1 : 1))),
    readSearchCalls: Object.entries(byName).filter(([name]) => readSearchTools.has(name)).reduce((sum, [, count]) => sum + count, 0),
    modelMs: sawDuration ? modelMs : null,
    wallMs: first !== undefined && last !== undefined ? last - first : null,
    context
  };
}

const cell = (value: number | null | undefined): string => (value === null || value === undefined ? "unavailable" : String(value));

export const tableHeader = [
  "| Run | Turns | Input | Output | cacheRead | cacheWrite | Cost | Tool calls | Read/search | Model ms | Wall ms | Injected tok (est.) | Retrieval ms | Models |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|"
].join("\n");

/** One markdown row. Incomplete usage is flagged in the row rather than silently summed. */
export function formatRow(summary: DogfoodSummary): string {
  const incomplete = summary.turnsWithoutUsage > 0 ? ` (+${summary.turnsWithoutUsage} turn(s) without usage)` : "";
  const injected = summary.context ? String(summary.context.injectedTokensEstimate) : "n/a";
  const retrieval = summary.context ? String(summary.context.retrievalMs) : "n/a";
  return `| ${summary.label} | ${summary.assistantTurns}${incomplete} | ${cell(summary.usage?.input)} | ${cell(summary.usage?.output)} | ` +
    `${cell(summary.usage?.cacheRead)} | ${cell(summary.usage?.cacheWrite)} | ${cell(summary.costTotal)} | ${summary.toolCalls} | ` +
    `${summary.readSearchCalls} | ${cell(summary.modelMs)} | ${cell(summary.wallMs)} | ${injected} | ${retrieval} | ${summary.models.join(", ") || "unavailable"} |`;
}
