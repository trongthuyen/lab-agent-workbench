#!/usr/bin/env node
import { runQualityGates } from "./gates.js";
import { gitignoreEntry, initializeProject, readProjectConfig } from "./init.js";

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function printHelp(): void {
  process.stdout.write(`Lab Agent Workbench CLI\n\nUsage:\n  lawb init --profile <name> [--force] [--no-gitignore]\n  lawb config\n  lawb gates [--bail]\n`);
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
      force: args.includes("--force"),
      gitignore: !args.includes("--no-gitignore")
    });
    process.stdout.write(
      result.created
        ? `Created ${result.configPath}\n`
        : `Skipped existing ${result.configPath}; use --force to replace it.\n`
    );
    if (result.gitignoreUpdated) {
      process.stdout.write(`Added ${gitignoreEntry} to .gitignore\n`);
    }
    return;
  }

  if (command === "config") {
    const config = await readProjectConfig(process.cwd());
    process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
    return;
  }

  if (command === "gates") {
    const config = await readProjectConfig(process.cwd()).catch((error: unknown) => {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      throw code === "ENOENT" ? new Error("No .lawb/config.json found; run `lawb init` first") : error;
    });
    const commands = config.qualityGates.commands;
    if (commands.length === 0) {
      throw new Error("No quality gates configured in .lawb/config.json (qualityGates.commands)");
    }

    process.stdout.write(`Running ${commands.length} quality gate(s) from .lawb/config.json:\n`);
    for (const gate of commands) {
      process.stdout.write(`  ${gate}\n`);
    }
    const results = await runQualityGates({
      cwd: process.cwd(),
      commands,
      bail: args.includes("--bail")
    });
    for (const result of results) {
      const status = result.passed ? "PASS" : "FAIL";
      const seconds = (result.durationMs / 1000).toFixed(1);
      process.stdout.write(`${status} ${result.command} (${seconds}s, exit ${result.exitCode ?? "none"})\n`);
    }
    const failed = results.filter((result) => !result.passed).length;
    process.stdout.write(
      failed === 0
        ? "Quality gates passed\n"
        : `Quality gates failed: ${failed} of ${results.length}\n`
    );
    if (failed > 0) {
      process.exitCode = 1;
    }
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`lawb: ${message}\n`);
  process.exitCode = 1;
});
