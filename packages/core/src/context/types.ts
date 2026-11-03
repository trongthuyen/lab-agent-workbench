export type SkipReason =
  | "outside-workspace"
  | "protected"
  | "symlink"
  | "too-large"
  | "binary"
  | "unreadable"
  | "scan-limit";

export interface SkippedSource {
  /** Workspace-relative, forward-slash path. Symlink targets are never reported. */
  path: string;
  reason: SkipReason;
}

export interface SourceFile {
  path: string;
  text: string;
  bytes: number;
  /** Index of the first `context.sources` glob that matched; lower is higher priority. */
  sourceIndex: number;
}

export interface SourceScan {
  files: SourceFile[];
  skipped: SkippedSource[];
  /** True when a scan limit stopped the walk early, so the file list may be incomplete. */
  truncated: boolean;
  bytesRead: number;
}

export interface Chunk {
  path: string;
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
  heading: string;
  /** Redacted text; the hash and token estimate describe exactly this text. */
  text: string;
  hash: string;
  tokens: number;
  sourceIndex: number;
}

export interface SelectedChunk extends Chunk {
  score: number;
  matchedTerms: number;
}

export type RejectReason = "below-threshold" | "duplicate" | "over-limit";

export interface RejectedChunk {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  tokens: number;
  reason: RejectReason;
}

export interface RetrievalResult {
  queryTerms: number;
  selected: SelectedChunk[];
  rejected: RejectedChunk[];
  skipped: SkippedSource[];
  scan: { filesRead: number; bytesRead: number; truncated: boolean };
}
