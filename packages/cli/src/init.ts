import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getProfile, resolveConfig, type ConfigLayer, type WorkbenchConfig } from "@lab-agent-workbench/core";

export interface InitOptions {
  cwd: string;
  profile: string;
  force?: boolean;
  // Add the .lawb ignore entry to the project .gitignore. Defaults to true.
  gitignore?: boolean;
}

export interface InitResult {
  configPath: string;
  config: WorkbenchConfig;
  created: boolean;
  gitignoreUpdated: boolean;
}

export const gitignoreEntry = "**/.lawb";
const equivalentEntries = new Set([".lawb", ".lawb/", "/.lawb", "/.lawb/", "**/.lawb", "**/.lawb/"]);

// Appends the ignore entry unless an equivalent one exists. Returns true when the file changed.
export async function ensureGitignoreEntry(cwd: string): Promise<boolean> {
  const path = join(cwd, ".gitignore");
  let content = "";
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code !== "ENOENT") {
      throw error;
    }
  }

  if (content.split(/\r?\n/).some((line) => equivalentEntries.has(line.trim()))) {
    return false;
  }
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const separator = content === "" || content.endsWith("\n") ? "" : eol;
  await writeFile(path, `${content}${separator}${gitignoreEntry}${eol}`, "utf8");
  return true;
}

export async function initializeProject(options: InitOptions): Promise<InitResult> {
  const directory = join(options.cwd, ".lawb");
  const configPath = join(directory, "config.json");
  const config = resolveConfig(getProfile(options.profile));

  await mkdir(directory, { recursive: true });
  const gitignoreUpdated = options.gitignore === false ? false : await ensureGitignoreEntry(options.cwd);
  if (!options.force) {
    try {
      await readFile(configPath, "utf8");
      return { configPath, config, created: false, gitignoreUpdated };
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") {
        throw error;
      }
    }
  }

  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { configPath, config, created: true, gitignoreUpdated };
}

export async function readProjectConfig(cwd: string): Promise<WorkbenchConfig> {
  const configPath = join(cwd, ".lawb", "config.json");
  const source = await readFile(configPath, "utf8");
  return resolveConfig(JSON.parse(source) as ConfigLayer);
}
