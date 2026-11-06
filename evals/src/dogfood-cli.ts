#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { formatRow, summarizeSession, tableHeader } from "./dogfood.js";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function main(args: string[]): Promise<void> {
  const session = option(args, "--session");
  const label = option(args, "--label");
  if (!session || !label) {
    throw new Error("Usage: dogfood --session <pi-session.jsonl> --label <run name> [--telemetry <telemetry.jsonl>] [--json]");
  }
  const telemetry = option(args, "--telemetry");
  const summary = summarizeSession(
    label,
    await readFile(session, "utf8"),
    telemetry ? await readFile(telemetry, "utf8").catch(() => "") : undefined
  );
  process.stdout.write(args.includes("--json") ? `${JSON.stringify(summary, null, 2)}\n` : `${tableHeader}\n${formatRow(summary)}\n`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`dogfood: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
