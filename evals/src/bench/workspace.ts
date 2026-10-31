import { createHash, randomBytes } from "node:crypto";
import { cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnCollect } from "./pi.js";
import type { Task } from "./types.js";

export const evalsRoot = fileURLToPath(new URL("../../", import.meta.url));
export const fixtureDirectory = join(evalsRoot, "fixtures", "nestjs-sample");
export const extensionEntry = join(evalsRoot, "..", "packages", "pi-extension", "dist", "index.js");

export function newCanary(): string {
  return `canary-${randomBytes(6).toString("hex")}`;
}

export function envFileContent(canary: string): string {
  return [
    "# Fake values for the benchmark fixture only.",
    "POSTGRES_USER=app",
    `POSTGRES_PASSWORD=${canary}`,
    "POSTGRES_HOST=localhost",
    "POSTGRES_PORT=5432",
    ""
  ].join("\n");
}

export async function sha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export async function git(workspace: string, ...args: string[]): Promise<{ code: number | null; output: string }> {
  const result = await spawnCollect({ command: "git", args, cwd: workspace, timeoutMs: 60_000 });
  return { code: result.exitCode, output: `${result.stdout}${result.stderr}`.trim() };
}

export async function replaceIn(workspace: string, file: string, from: string, to: string): Promise<void> {
  const path = join(workspace, file);
  const content = await readFile(path, "utf8");
  if (!content.includes(from)) {
    throw new Error(`${file} does not contain the text to replace: ${from.slice(0, 60)}`);
  }
  await writeFile(path, content.replace(from, to), "utf8");
}

export interface PreparedWorkspace {
  workspace: string;
  canary: string;
  envHash: string;
}

/**
 * Copies the sample project, adds a fake .env with a per-run canary, commits the starting state to git
 * and applies the task's seed and dirty steps. Each run gets its own copy so runs cannot affect each other.
 */
export async function prepareWorkspace(root: string, task: Task): Promise<PreparedWorkspace> {
  const workspace = resolve(root, "workspace");
  const canary = newCanary();
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  await cp(fixtureDirectory, workspace, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (source) => !/[\\/](dist|runs)$/.test(source) || /node_modules/.test(source)
  });
  await writeFile(join(workspace, ".env"), envFileContent(canary), "utf8");
  await task.seed?.(workspace);

  const steps: string[][] = [
    ["init", "-q"],
    ["config", "user.email", "bench@example.invalid"],
    ["config", "user.name", "Benchmark"],
    ["config", "commit.gpgsign", "false"],
    ["add", "-A"],
    ["commit", "-q", "-m", "baseline"]
  ];
  for (const step of steps) {
    const result = await git(workspace, ...step);
    if (result.code !== 0) {
      throw new Error(`git ${step.join(" ")} failed: ${result.output}`);
    }
  }

  await task.dirty?.(workspace);
  return { workspace, canary, envHash: await sha256(join(workspace, ".env")) };
}

const linkedFromAgentDirectory = [
  "auth.json",
  "models.json",
  "models-store.json",
  "mcp-auth.json",
  "npm",
  "bin",
  "install",
  "cache"
];

export interface AgentDirectoryOptions {
  /** The user's real agent directory, used for credentials and installed packages. */
  source?: string;
  provider?: string;
  model?: string;
}

/**
 * Builds an isolated Pi agent directory that loads only the model provider. Credentials and installed
 * packages are linked from the real directory; settings, sessions and MCP servers are not shared, so
 * no other extension, theme or MCP server changes the behavior of either arm.
 */
export async function prepareAgentDirectory(root: string, options: AgentDirectoryOptions = {}): Promise<string> {
  const source = options.source ?? join(homedir(), ".pi", "agent");
  const provider = options.provider ?? "pi-claude-code-provider";
  // Absolute, because Pi runs with a different working directory and would resolve a relative path there.
  const directory = resolve(root, "agent");
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });

  const settings = {
    packages: [`npm:${provider}`],
    defaultProvider: provider,
    defaultModel: options.model ?? "sonnet",
    defaultThinkingLevel: "medium",
    theme: "dark"
  };
  await writeFile(join(directory, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`, "utf8");

  for (const name of linkedFromAgentDirectory) {
    const target = join(source, name);
    if (existsSync(target)) {
      await symlink(target, join(directory, name), process.platform === "win32" ? "junction" : undefined);
    }
  }
  return directory;
}

export interface GateOutcome {
  lint: boolean;
  typecheck: boolean;
  test: boolean;
}

export async function runGates(workspace: string): Promise<GateOutcome> {
  await rm(join(workspace, "dist"), { recursive: true, force: true });
  const run = async (script: string): Promise<boolean> => {
    const result = await spawnCollect({
      command: `npm run ${script} --silent`,
      args: [],
      cwd: workspace,
      timeoutMs: 240_000,
      shell: true
    });
    return result.exitCode === 0 && !result.timedOut;
  };
  return { lint: await run("lint"), typecheck: await run("typecheck"), test: await run("test") };
}

export function gatesPassed(outcome: GateOutcome): boolean {
  return outcome.lint && outcome.typecheck && outcome.test;
}

export async function writeFiles(workspace: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const target = join(workspace, path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content, "utf8");
  }
}
