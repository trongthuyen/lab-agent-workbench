import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveConfig, resolveProjectConfig } from "./config.js";
import type { ConfigLayer, WorkbenchConfig } from "./types.js";

export interface LoadedConfig {
  config: WorkbenchConfig;
  /** True when the project has no .lawb/config.json and the built-in defaults apply. */
  defaulted: boolean;
}

/** Reads `.lawb/config.json` and resolves it; the CLI and the Pi extension both load through here. */
export async function loadProjectConfig(cwd: string): Promise<LoadedConfig> {
  let source: string;
  try {
    source = await readFile(join(cwd, ".lawb", "config.json"), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { config: resolveConfig(), defaulted: true };
    }
    throw error;
  }
  return { config: resolveProjectConfig(JSON.parse(source) as ConfigLayer), defaulted: false };
}
