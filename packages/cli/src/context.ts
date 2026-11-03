import { retrieveContext, type RetrievalResult, type WorkbenchConfig } from "@lab-agent-workbench/core";

export interface InspectOptions {
  root: string;
  query: string;
  config: WorkbenchConfig;
  signal?: AbortSignal | undefined;
}

/** Chunk text is deliberately not part of the report: inspect explains selection, it does not dump content. */
export function inspectReport(result: RetrievalResult, config: WorkbenchConfig) {
  const selectedTokens = result.selected.reduce((sum, chunk) => sum + chunk.tokens, 0);
  return {
    contextEnabled: config.context.enabled,
    queryTerms: result.queryTerms,
    scan: result.scan,
    budget: { maxInjectedTokens: config.context.maxInjectedTokens, selectedEstimatedTokens: selectedTokens },
    selected: result.selected.map((chunk) => ({
      path: chunk.path,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      score: chunk.score,
      matchedTerms: chunk.matchedTerms,
      estimatedTokens: chunk.tokens,
      hash: chunk.hash
    })),
    rejected: result.rejected.slice(0, 20),
    skipped: result.skipped
  };
}

export type InspectReport = ReturnType<typeof inspectReport>;

export function formatInspect(report: InspectReport): string {
  const lines = [
    `Context inspect${report.contextEnabled ? "" : " (context.enabled is false: inspection only, nothing is injected)"}`,
    `Scanned ${report.scan.filesRead} file(s), ${report.scan.bytesRead} bytes${report.scan.truncated ? " (stopped at a scan limit; results may be incomplete)" : ""}`,
    `Query terms: ${report.queryTerms}`,
    `Selected ${report.selected.length} chunk(s), ~${report.budget.selectedEstimatedTokens} estimated tokens (budget ${report.budget.maxInjectedTokens})`
  ];
  if (report.queryTerms === 0) lines.push("  The query has no searchable terms.");
  report.selected.forEach((chunk, index) => {
    lines.push(`  ${index + 1}. ${chunk.path}:${chunk.startLine}-${chunk.endLine}  score ${chunk.score}  ~${chunk.estimatedTokens} tok  terms ${chunk.matchedTerms}/${report.queryTerms}`);
  });
  if (report.rejected.length > 0) {
    lines.push("Not selected:");
    for (const chunk of report.rejected) {
      lines.push(`  ${chunk.path}:${chunk.startLine}-${chunk.endLine}  score ${chunk.score}  ${chunk.reason}`);
    }
  }
  if (report.skipped.length > 0) {
    lines.push("Skipped sources:");
    for (const entry of report.skipped) lines.push(`  ${entry.path}  ${entry.reason}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function inspectContext(options: InspectOptions): Promise<InspectReport> {
  return inspectReport(await retrieveContext(options), options.config);
}
