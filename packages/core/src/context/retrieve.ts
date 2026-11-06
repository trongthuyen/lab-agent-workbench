import { createHash } from "node:crypto";
import { redact } from "../telemetry.js";
import type { WorkbenchConfig } from "../types.js";
import { discoverSources } from "./access.js";
import { estimateTokens } from "./budget.js";
import type { Chunk, RejectedChunk, RetrievalResult, SelectedChunk, SourceFile } from "./types.js";

/** Starting values that have not been tuned or measured. */
export const minScore = 1;
export const minTermCoverage = 0.5;

const stopwords = new Set([
  "the", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "be", "with", "this", "that",
  "it", "as", "at", "by", "from", "how", "what", "do", "does", "can", "should"
]);

/** Lowercased word tokens; camelCase is split, and `_`/`-` already separate words. */
export function tokenize(text: string): string[] {
  const words = text.replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.filter((word) => word.length >= 2);
}

export function queryTerms(query: string): string[] {
  return [...new Set(tokenize(query).filter((word) => !stopwords.has(word)))];
}

interface Line {
  number: number;
  text: string;
}

const headingLine = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/u;
const fenceLine = /^\s{0,3}(?:```|~~~)/u;

function sections(lines: Line[]): { heading: string; lines: Line[] }[] {
  const result: { heading: string; lines: Line[] }[] = [];
  let current = { heading: "", lines: [] as Line[] };
  let fenced = false;
  for (const line of lines) {
    if (fenceLine.test(line.text)) fenced = !fenced;
    const heading = fenced ? null : headingLine.exec(line.text);
    if (heading) {
      result.push(current);
      current = { heading: heading[1] ?? "", lines: [] };
    }
    current.lines.push(line);
  }
  result.push(current);
  return result;
}

const textOf = (lines: readonly Line[]): string => lines.map((line) => line.text).join("\n");

/** Splits lines so every piece fits `maxTokens`: by blank-line blocks, then lines, then characters. */
function fit(lines: Line[], maxTokens: number): Line[][] {
  if (estimateTokens(textOf(lines)) <= maxTokens) return [lines];
  const blocks: Line[][] = [];
  let block: Line[] = [];
  for (const line of lines) {
    if (line.text.trim() === "" && block.length > 0) {
      blocks.push(block);
      block = [];
    }
    block.push(line);
  }
  if (block.length > 0) blocks.push(block);

  const pieces: Line[][] = [];
  let open: Line[] = [];
  const flush = (): void => {
    if (open.length > 0) pieces.push(open);
    open = [];
  };
  const maxChars = maxTokens * 4;
  for (const candidate of blocks) {
    if (open.length > 0 && estimateTokens(textOf([...open, ...candidate])) > maxTokens) flush();
    if (estimateTokens(textOf(candidate)) <= maxTokens) {
      open.push(...candidate);
      continue;
    }
    flush();
    for (const line of candidate) {
      if (open.length > 0 && estimateTokens(textOf([...open, line])) > maxTokens) flush();
      if (estimateTokens(line.text) <= maxTokens) {
        open.push(line);
        continue;
      }
      flush();
      // A single over-long line is cut by characters; every piece keeps the line number.
      for (let offset = 0; offset < line.text.length; offset += maxChars) {
        pieces.push([{ number: line.number, text: line.text.slice(offset, offset + maxChars) }]);
      }
    }
  }
  flush();
  return pieces;
}

export function chunkFile(file: SourceFile, config: WorkbenchConfig): Chunk[] {
  const lines = file.text.split(/\r?\n/).map((text, index) => ({ number: index + 1, text }));
  const chunks: Chunk[] = [];
  for (const section of sections(lines)) {
    for (const piece of fit(section.lines, config.context.maxChunkTokens)) {
      let first = 0;
      let last = piece.length - 1;
      while (first <= last && piece[first]?.text.trim() === "") first += 1;
      while (last >= first && piece[last]?.text.trim() === "") last -= 1;
      const kept = piece.slice(first, last + 1);
      const start = kept[0];
      const end = kept.at(-1);
      if (!start || !end) continue;
      const text = String(redact(textOf(kept), config.telemetry.redactPatterns));
      chunks.push({
        path: file.path,
        startLine: start.number,
        endLine: end.number,
        heading: section.heading,
        text,
        hash: createHash("sha256").update(text).digest("hex").slice(0, 16),
        tokens: estimateTokens(text),
        sourceIndex: file.sourceIndex
      });
    }
  }
  return chunks;
}

interface Scored {
  chunk: Chunk;
  score: number;
  matchedTerms: number;
}

const round = (value: number): number => Math.round(value * 10000) / 10000;

function score(chunks: readonly Chunk[], terms: readonly string[], sources: number): Scored[] {
  const bodies = chunks.map((chunk) => {
    const counts = new Map<string, number>();
    for (const word of tokenize(chunk.text)) counts.set(word, (counts.get(word) ?? 0) + 1);
    return {
      counts,
      heading: new Set(tokenize(chunk.heading)),
      path: new Set(tokenize(chunk.path.replace(/\.[^./]+$/, "")))
    };
  });
  const documentFrequency = new Map(terms.map((term) => [
    term,
    bodies.filter((body) => body.counts.has(term) || body.heading.has(term) || body.path.has(term)).length
  ]));

  return chunks.map((chunk, index) => {
    const body = bodies[index];
    let total = 0;
    let matched = 0;
    for (const term of terms) {
      const frequency = body?.counts.get(term) ?? 0;
      const inHeading = body?.heading.has(term) ?? false;
      const inPath = body?.path.has(term) ?? false;
      if (frequency === 0 && !inHeading && !inPath) continue;
      matched += 1;
      const idf = Math.log(1 + chunks.length / (1 + (documentFrequency.get(term) ?? 0)));
      total += idf * (1 + Math.log(1 + frequency)) + (inHeading ? 3 * idf : 0) + (inPath ? 2 * idf : 0);
    }
    // Earlier `context.sources` globs rank higher; the bonus only breaks near-ties.
    const priority = total > 0 && sources > 1 ? 0.25 / (1 + chunk.sourceIndex) : 0;
    return { chunk, score: round(total + priority), matchedTerms: matched };
  });
}

export interface RetrieveOptions {
  root: string;
  query: string;
  config: WorkbenchConfig;
  signal?: AbortSignal | undefined;
  /** Lowercase workspace-relative paths that must not be retrieved (already in the prompt). */
  exclude?: ReadonlySet<string> | undefined;
}

/** discover → permission checks → bounded reads → chunk → lexical rank → dedupe. Deterministic; no model calls. */
export async function retrieveContext(options: RetrieveOptions): Promise<RetrievalResult> {
  const { config, signal } = options;
  const terms = queryTerms(options.query);
  const scan = await discoverSources({ root: options.root, config, signal, exclude: options.exclude });
  const result: RetrievalResult = {
    queryTerms: terms.length,
    selected: [],
    rejected: [],
    skipped: scan.skipped,
    scan: { filesRead: scan.files.length, bytesRead: scan.bytesRead, truncated: scan.truncated }
  };
  if (terms.length === 0) return result;

  signal?.throwIfAborted();
  const chunks = scan.files.flatMap((file) => chunkFile(file, config));
  const required = Math.max(1, Math.ceil(terms.length * minTermCoverage));
  const ranked = score(chunks, terms, config.context.sources.length)
    .filter((entry) => entry.matchedTerms > 0)
    .sort((a, b) =>
      b.score - a.score ||
      (a.chunk.path < b.chunk.path ? -1 : a.chunk.path > b.chunk.path ? 1 : 0) ||
      a.chunk.startLine - b.chunk.startLine);

  const seen = new Set<string>();
  const reject = (entry: Scored, reason: RejectedChunk["reason"]): void => {
    result.rejected.push({
      path: entry.chunk.path,
      startLine: entry.chunk.startLine,
      endLine: entry.chunk.endLine,
      score: entry.score,
      tokens: entry.chunk.tokens,
      reason
    });
  };
  for (const entry of ranked) {
    if (entry.score < minScore || entry.matchedTerms < required) reject(entry, "below-threshold");
    else if (seen.has(entry.chunk.hash)) reject(entry, "duplicate");
    else if (result.selected.length >= config.context.maxChunks) reject(entry, "over-limit");
    else {
      seen.add(entry.chunk.hash);
      result.selected.push({ ...entry.chunk, score: entry.score, matchedTerms: entry.matchedTerms } satisfies SelectedChunk);
    }
  }
  return result;
}
