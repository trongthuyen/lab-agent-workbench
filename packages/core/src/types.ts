export interface WorkbenchConfig {
  version: 1;
  profile: string;
  policies: {
    allowOutsideWorkspace: boolean;
    protectedPaths: string[];
    protectedReadPaths: string[];
    riskyCommandPatterns: string[];
  };
  telemetry: {
    enabled: boolean;
    path: string;
    redactPatterns: string[];
  };
  qualityGates: {
    commands: string[];
  };
  context: ContextConfig;
}

/**
 * Project-knowledge retrieval and compaction settings (Phase 2). Everything is off by default; the
 * contract is defined first so later work cannot change the meaning of existing keys.
 */
export interface ContextConfig {
  /** Master switch. When false no retrieval, injection or structured compaction happens. */
  enabled: boolean;
  /** Workspace-relative glob patterns of files that may be retrieved. Never auto-scans source code. */
  sources: string[];
  /** Upper bound of estimated tokens Workbench adds to one request. */
  maxInjectedTokens: number;
  /** Hard UTF-8 byte cap for the injected text, independent of the token estimate. */
  maxInjectedBytes: number;
  maxChunks: number;
  maxChunkTokens: number;
  /** Files larger than this are skipped, not truncated. */
  maxFileBytes: number;
  /** Scan limits per user turn. */
  maxFilesScanned: number;
  maxBytesScanned: number;
  compaction: {
    /** `native` leaves compaction to Pi; `structured` is opt-in and experimental. */
    strategy: "native" | "structured";
  };
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

export type ConfigLayer = DeepPartial<WorkbenchConfig>;

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
  rule?: "outside-workspace" | "protected-path" | "risky-command";
}

export interface ToolCallLike {
  toolName: string;
  input: unknown;
}
