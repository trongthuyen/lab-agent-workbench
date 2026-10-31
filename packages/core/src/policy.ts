import { isAbsolute, relative, resolve, sep } from "node:path";
import type { PolicyDecision, ToolCallLike, WorkbenchConfig } from "./types.js";

function normalizeRelativePath(path: string): string {
  return path.split(sep).join("/").replace(/^\.\//, "");
}

// "*" stays inside one path segment, "**" crosses segments, and a "**" segment also matches zero directories.
function globToRegExp(glob: string): RegExp {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob.charAt(index);
    if (char !== "*") {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    } else if (glob.charAt(index + 1) !== "*") {
      source += "[^/]*";
    } else if (glob.charAt(index + 2) === "/") {
      source += "(?:.*/)?";
      index += 2;
    } else {
      source += ".*";
      index += 1;
    }
  }
  return new RegExp(`^${source}$`, "i");
}

// Patterns apply in order and the last match wins; a leading "!" re-allows paths matched earlier.
function findProtectedPattern(
  inputPath: string,
  cwd: string,
  patterns: readonly string[]
): string | undefined {
  const relativePath = relative(cwd, resolve(cwd, inputPath));
  const normalized = normalizeRelativePath(relativePath || ".");
  let protectedBy: string | undefined;
  for (const pattern of patterns) {
    const negated = pattern.startsWith("!");
    const glob = normalizeRelativePath(negated ? pattern.slice(1) : pattern);
    if (globToRegExp(glob).test(normalized)) {
      protectedBy = negated ? undefined : pattern;
    }
  }
  return protectedBy;
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

  const protectedPattern = findProtectedPattern(inputPath, cwd, config.policies.protectedPaths);
  if (protectedPattern) {
    return {
      allowed: false,
      reason: `Path matches protected pattern ${protectedPattern}: ${inputPath}`,
      rule: "protected-path"
    };
  }

  return { allowed: true };
}

/** Reads are not limited to the workspace, so only the protected read patterns apply. */
export function evaluateReadPath(
  inputPath: string,
  cwd: string,
  config: WorkbenchConfig
): PolicyDecision {
  const protectedPattern = findProtectedPattern(inputPath, cwd, config.policies.protectedReadPaths);
  return protectedPattern
    ? {
        allowed: false,
        reason: `Path matches protected read pattern ${protectedPattern}: ${inputPath}`,
        rule: "protected-path"
      }
    : { allowed: true };
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

const operandSeparators = /[\s"'`;|&<>()=,$]+/u;
const redirectTarget = /\d*>>?(?!&)\s*([^\s;|&<>()]+)/gu;

/** Commands and operators that modify files. */
const writeIndicators: readonly RegExp[] = [
  /\d*>(?!&)/u,
  /\b(?:tee|cp|mv|rm|ln|dd|truncate|shred|unlink|touch|install|rsync|chmod|chown)\b/u,
  /\b(?:sed|perl)\b[^\n]*\s-[A-Za-z]*i|--in-place/u,
  /\b(?:python3?|node|ruby|perl|php)\b[^\n]*\s-[ec]\b/u,
  /\b(?:Set-Content|Add-Content|Out-File|Clear-Content|Remove-Item|Copy-Item|Move-Item|New-Item)\b/iu
];

/** Programs whose arguments are text rather than file operands; only their redirect targets are paths. */
const textOnlyPrograms = new Set(["echo", "printf", "write-output", "write-host"]);

function programOf(simpleCommand: string): string {
  const word = simpleCommand
    .trim()
    .split(/\s+/u)
    .find((part) => part !== "" && !/^\w+=/u.test(part));
  return (word ?? "").replace(/["']/gu, "").split(/[\\/]/u).pop()?.toLowerCase() ?? "";
}

function operandsOf(simpleCommand: string): string[] {
  const targets = [...simpleCommand.matchAll(redirectTarget)].map((match) => match[1] ?? "");
  const tokens = textOnlyPrograms.has(programOf(simpleCommand))
    ? targets.map((target) => target.replace(/["'`]/gu, ""))
    : simpleCommand.split(operandSeparators);
  // Backslashes are Windows separators or shell escapes (cat \.env); read both as separators.
  return tokens.map((token) => token.replace(/\\/gu, "/")).filter((token) => token !== "" && !token.startsWith("-"));
}

/**
 * Blocks shell commands that read a protected read path, or that modify a protected path.
 * Commands are split into simple commands so that text arguments (echo .env >> .gitignore) are not
 * mistaken for files. This is a lexical heuristic, not a shell parser: variables, globs, command
 * substitution, heredocs and encoded scripts are not understood and may bypass or trip it.
 */
export function evaluateCommandPaths(
  command: string,
  cwd: string,
  config: WorkbenchConfig
): PolicyDecision {
  for (const simpleCommand of command.split(/&&|\|\||[;|\n]/u)) {
    const writes = writeIndicators.some((indicator) => indicator.test(simpleCommand));
    for (const operand of operandsOf(simpleCommand)) {
      const readPattern = findProtectedPattern(operand, cwd, config.policies.protectedReadPaths);
      if (readPattern) {
        return {
          allowed: false,
          reason: `Command references a path matching protected read pattern ${readPattern}: ${operand}`,
          rule: "protected-path"
        };
      }
      const writePattern = writes ? findProtectedPattern(operand, cwd, config.policies.protectedPaths) : undefined;
      if (writePattern) {
        return {
          allowed: false,
          reason: `Command modifies a path matching protected pattern ${writePattern}: ${operand}`,
          rule: "protected-path"
        };
      }
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

  if (event.toolName === "read") {
    const path = readStringField(event.input, "path");
    return path
      ? evaluateReadPath(path, cwd, config)
      : { allowed: false, reason: "read call has no path", rule: "protected-path" };
  }

  if (event.toolName === "grep") {
    for (const field of ["path", "glob"]) {
      const value = readStringField(event.input, field);
      const decision = value ? evaluateReadPath(value, cwd, config) : { allowed: true };
      if (!decision.allowed) {
        return decision;
      }
    }
    return { allowed: true };
  }

  if (["bash", "powershell"].includes(event.toolName)) {
    const command = readStringField(event.input, "command");
    if (!command) {
      return { allowed: false, reason: `${event.toolName} call has no command`, rule: "risky-command" };
    }
    const risky = evaluateCommand(command, config);
    return risky.allowed ? evaluateCommandPaths(command, cwd, config) : risky;
  }

  return { allowed: true };
}
