import { isAbsolute, relative, resolve, sep } from "node:path";
import type { PolicyDecision, ToolCallLike, WorkbenchConfig } from "./types.js";

function normalizeRelativePath(path: string): string {
  return path.split(sep).join("/").replace(/^\.\//, "");
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    // eslint-disable-next-line no-control-regex -- NUL is the intentional placeholder for "**"
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

export function evaluatePath(
  inputPath: string,
  cwd: string,
  config: WorkbenchConfig
): PolicyDecision {
  const absolutePath = resolve(cwd, inputPath);
  const relativePath = relative(cwd, absolutePath);
  const outside = relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);

  if (outside && !config.policies.allowOutsideWorkspace) {
    return {
      allowed: false,
      reason: `Path is outside the workspace: ${inputPath}`,
      rule: "outside-workspace"
    };
  }

  const normalized = normalizeRelativePath(relativePath || ".");
  const protectedPattern = config.policies.protectedPaths.find((pattern) =>
    globToRegExp(normalizeRelativePath(pattern)).test(normalized)
  );
  if (protectedPattern) {
    return {
      allowed: false,
      reason: `Path matches protected pattern ${protectedPattern}: ${inputPath}`,
      rule: "protected-path"
    };
  }

  return { allowed: true };
}

export function evaluateCommand(command: string, config: WorkbenchConfig): PolicyDecision {
  for (const pattern of config.policies.riskyCommandPatterns) {
    const caseInsensitive = pattern.startsWith("(?i)");
    const expression = new RegExp(caseInsensitive ? pattern.slice(4) : pattern, caseInsensitive ? "iu" : "u");
    if (expression.test(command)) {
      return {
        allowed: false,
        reason: `Command matches risky pattern: ${pattern}`,
        rule: "risky-command"
      };
    }
  }
  return { allowed: true };
}

function readStringField(input: unknown, field: string): string | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return undefined;
  }
  const value = (input as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

export function evaluateToolCall(
  event: ToolCallLike,
  cwd: string,
  config: WorkbenchConfig
): PolicyDecision {
  if (["write", "edit"].includes(event.toolName)) {
    const path = readStringField(event.input, "path");
    return path
      ? evaluatePath(path, cwd, config)
      : { allowed: false, reason: `${event.toolName} call has no path`, rule: "protected-path" };
  }

  if (["bash", "powershell"].includes(event.toolName)) {
    const command = readStringField(event.input, "command");
    return command
      ? evaluateCommand(command, config)
      : { allowed: false, reason: `${event.toolName} call has no command`, rule: "risky-command" };
  }

  return { allowed: true };
}
