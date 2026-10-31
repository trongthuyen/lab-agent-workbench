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
