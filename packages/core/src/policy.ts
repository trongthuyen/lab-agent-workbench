import { readdirSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
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

// Splits a command into words the way a shell would for quoting, without expanding anything.
function shellWords(command: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: string | undefined;
  let started = false;
  for (const char of command.trim()) {
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/u.test(char)) {
      if (started || current !== "") {
        words.push(current);
        current = "";
        started = false;
      }
    } else {
      current += char;
      started = true;
    }
  }
  if (started || current !== "") {
    words.push(current);
  }
  return words;
}

const valueShortFlags = new Set(["e", "f", "m", "A", "B", "C", "d", "D", "g", "t", "T", "j", "M"]);
const valueLongFlags = new Set([
  "regexp", "file", "max-count", "context", "after-context", "before-context", "include", "exclude",
  "exclude-from", "exclude-dir", "glob", "iglob", "type", "type-not", "max-depth", "ignore-dir",
  "ignore", "directories", "devices", "label", "threads", "max-columns"
]);
const grepPrograms = new Set(["grep", "egrep", "fgrep", "rgrep"]);
const searchPrograms = new Set([...grepPrograms, "rg", "ag", "ack"]);

interface SearchCommand {
  recursive: boolean;
  /** Whether dotfiles such as .env are searched. grep and ack search them; rg and ag skip them by default. */
  includesHidden: boolean;
  paths: string[];
  /** When present, only files matching one of these globs are searched. */
  includes: string[];
  excludes: string[];
  excludeDirectories: string[];
}

function parseSearch(simpleCommand: string): SearchCommand | undefined {
  const words = shellWords(simpleCommand);
  const start = words.findIndex((word) => !/^\w+=/u.test(word));
  const program = basename((words[start] ?? "").replace(/\\/gu, "/")).toLowerCase();
  if (!searchPrograms.has(program)) {
    return undefined;
  }

  let recursive = program !== "grep" && program !== "egrep" && program !== "fgrep";
  let hiddenFlag = false;
  let hasExplicitPattern = false;
  const positionals: string[] = [];
  const includes: string[] = [];
  const excludes: string[] = [];
  const excludeDirectories: string[] = [];

  const addGlob = (value: string): void => {
    if (value.startsWith("!")) {
      excludes.push(value.slice(1));
    } else {
      includes.push(value);
    }
  };

  for (let index = start + 1; index < words.length; index += 1) {
    const word = words[index] ?? "";
    if (word === "--") {
      positionals.push(...words.slice(index + 1));
      break;
    }
    if (word.startsWith("--")) {
      const [name = "", inline] = word.slice(2).split(/=(.*)/su);
      const takesValue = valueLongFlags.has(name);
      const value = inline ?? (takesValue ? words[index + 1] : undefined);
      if (takesValue && inline === undefined) {
        index += 1;
      }
      if (name === "recursive" || name === "dereference-recursive" || (name === "directories" && value === "recurse")) {
        recursive = true;
      } else if (name === "hidden" || name.startsWith("no-ignore")) {
        hiddenFlag = true;
      } else if (name === "regexp" || name === "file") {
        hasExplicitPattern = true;
      } else if (name === "include" && value) {
        includes.push(value);
      } else if (name === "exclude" && value) {
        excludes.push(value);
      } else if ((name === "exclude-dir" || name === "ignore-dir") && value) {
        excludeDirectories.push(value);
      } else if ((name === "glob" || name === "iglob") && value) {
        addGlob(value);
      } else if (name === "ignore" && value) {
        excludes.push(value);
      }
    } else if (/^-[A-Za-z.]+/u.test(word)) {
      const letters = word.slice(1);
      if (/^u+$/u.test(letters) || letters === ".") {
        hiddenFlag = true;
      }
      const valueAt = [...letters].findIndex((letter) => valueShortFlags.has(letter));
      if (/^[A-Za-z]+$/u.test(letters) && /[rR]/u.test(letters) && grepPrograms.has(program)) {
        recursive = true;
      }
      if (valueAt !== -1) {
        const letter = letters.charAt(valueAt);
        const attached = letters.slice(valueAt + 1);
        const value = attached !== "" ? attached : words[index + 1];
        if (attached === "") {
          index += 1;
        }
        if (letter === "e" || letter === "f") {
          hasExplicitPattern = true;
        } else if (letter === "g" && value) {
          addGlob(value);
        } else if (letter === "d" && value === "recurse") {
          recursive = true;
        }
      }
    } else {
      positionals.push(word);
    }
  }

  const paths = hasExplicitPattern ? positionals : positionals.slice(1);
  const includesHidden = program === "rg" || program === "ag" ? hiddenFlag : true;
  return { recursive, includesHidden, paths, includes, excludes, excludeDirectories };
}

/**
 * Blocks a recursive search whose directory tree contains a protected read path, because a search that
 * prints matching lines would print the secret. The tree is walked on disk, so a search over a directory
 * without such files is allowed. Matching is lexical: shell expansion is not understood.
 */
export function evaluateRecursiveSearch(
  simpleCommand: string,
  cwd: string,
  config: WorkbenchConfig,
  entryLimit = 100_000
): PolicyDecision {
  const patterns = config.policies.protectedReadPaths;
  const search = patterns.length === 0 ? undefined : parseSearch(simpleCommand);
  if (!search?.recursive || !search.includesHidden) {
    return { allowed: true };
  }

  const roots: string[] = [];
  for (const path of search.paths) {
    const target = resolve(cwd, path.replace(/\\/gu, "/"));
    try {
      if (statSync(target).isDirectory()) {
        roots.push(target);
      }
    } catch {
      // Not a path that exists (a glob or a typo): nothing to walk.
    }
  }
  if (search.paths.length === 0) {
    roots.push(cwd);
  }

  const included = search.includes.map((glob) => globToRegExp(glob));
  const excludedFile = search.excludes.map((glob) => globToRegExp(glob));
  const excludedDirectory = search.excludeDirectories.map((glob) => globToRegExp(glob));
  let budget = entryLimit;
  const stack = [...roots];
  while (stack.length > 0) {
    const directory = stack.pop() ?? "";
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      budget -= 1;
      if (budget < 0) {
        return {
          allowed: false,
          reason: `Recursive search covers too many files to check for protected files; search a narrower directory: ${simpleCommand.trim().slice(0, 80)}`,
          rule: "protected-path"
        };
      }
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== ".git" && !excludedDirectory.some((rule) => rule.test(entry.name))) {
          stack.push(full);
        }
      } else if (
        (included.length === 0 || included.some((rule) => rule.test(entry.name))) &&
        !excludedFile.some((rule) => rule.test(entry.name))
      ) {
        const pattern = findProtectedPattern(full, cwd, patterns);
        if (pattern) {
          const shown = normalizeRelativePath(relative(cwd, full));
          return {
            allowed: false,
            reason: `Recursive search would read ${shown} (matches protected read pattern ${pattern}); exclude it, for example --exclude='.env*', or search a narrower directory`,
            rule: "protected-path"
          };
        }
      }
    }
  }
  return { allowed: true };
}

// Splits on ; | || && and newlines, but not inside quotes, so "a|b" stays one word.
function splitSimpleCommands(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: string | undefined;
  for (let index = 0; index < command.length; index += 1) {
    const char = command.charAt(index);
    if (quote) {
      current += char;
      quote = char === quote ? undefined : quote;
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === ";" || char === "\n" || char === "|") {
      parts.push(current);
      current = "";
      index += char === "|" && command.charAt(index + 1) === "|" ? 1 : 0;
    } else if (char === "&" && command.charAt(index + 1) === "&") {
      parts.push(current);
      current = "";
      index += 1;
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

const exclusionFlags = /(?:^|\s)(?:--exclude(?:-dir|-from)?|--ignore(?:-dir)?)(?:=|\s+)(?:'[^']*'|"[^"]*"|\S+)/gu;
const negatedGlobFlags = /(?:^|\s)(?:--glob|--iglob|-g)(?:=|\s*)(?:'!?[^']*'|"!?[^"]*"|!\S+)/gu;

// Values that tell a search what to skip are not files being read; --exclude=.env must not count as reading .env.
function withoutExclusions(simpleCommand: string): string {
  return simpleCommand
    .replace(exclusionFlags, " ")
    .replace(negatedGlobFlags, (match) => (/[=\s]['"]?!/u.test(match) ? " " : match));
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
  for (const simpleCommand of splitSimpleCommands(command)) {
    const search = evaluateRecursiveSearch(simpleCommand, cwd, config);
    if (!search.allowed) {
      return search;
    }
    const writes = writeIndicators.some((indicator) => indicator.test(simpleCommand));
    for (const operand of operandsOf(withoutExclusions(simpleCommand))) {
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
