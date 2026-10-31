import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getProfile, resolveConfig, type ConfigLayer, type WorkbenchConfig } from "@lab-agent-workbench/core";

export interface InitOptions {
  cwd: string;
  profile: string;
  force?: boolean;
}

export interface InitResult {
  configPath: string;
  config: WorkbenchConfig;
  created: boolean;
}

export async function initializeProject(options: InitOptions): Promise<InitResult> {
  const directory = join(options.cwd, ".lawb");
  const configPath = join(directory, "config.json");
  const config = resolveConfig(getProfile(options.profile));

  await mkdir(directory, { recursive: true });
  if (!options.force) {
    try {
      await readFile(configPath, "utf8");
      return { configPath, config, created: false };
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (code !== "ENOENT") {
        throw error;
      }
    }
  }

  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { configPath, config, created: true };
}

export async function readProjectConfig(cwd: string): Promise<WorkbenchConfig> {
  const configPath = join(cwd, ".lawb", "config.json");
  const source = await readFile(configPath, "utf8");
  return resolveConfig(JSON.parse(source) as ConfigLayer);
}
