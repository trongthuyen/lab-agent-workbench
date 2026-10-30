#!/usr/bin/env node
import { initializeProject, readProjectConfig } from "./init.js";

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function printHelp(): void {
  process.stdout.write(`Lab Agent Workbench CLI\n\nUsage:\n  lawb init --profile <name> [--force]\n  lawb config\n`);
}

async function main(args: string[]): Promise<void> {
  const [command] = args;
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "init") {
    const profile = readOption(args, "--profile") ?? "nestjs";
    const result = await initializeProject({
      cwd: process.cwd(),
      profile,
      force: args.includes("--force")
    });
    process.stdout.write(
      result.created
        ? `Created ${result.configPath}\n`
        : `Skipped existing ${result.configPath}; use --force to replace it.\n`
    );
    return;
  }

  if (command === "config") {
    const config = await readProjectConfig(process.cwd());
    process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`lawb: ${message}\n`);
  process.exitCode = 1;
});
