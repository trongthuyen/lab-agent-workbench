import { spawn } from "node:child_process";

export interface GateResult {
  command: string;
  /** Null when the process was killed by a signal or could not be started. */
  exitCode: number | null;
  durationMs: number;
  passed: boolean;
}

export type GateRunner = (command: string, cwd: string) => Promise<number | null>;

/** Runs the command through the platform shell and streams its output to the terminal. */
export const spawnGate: GateRunner = (command, cwd) =>
  new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, stdio: "inherit" });
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code));
  });

export interface GateOptions {
  cwd: string;
  commands: readonly string[];
  /** Stop at the first failing gate instead of running the rest. */
  bail?: boolean;
  runner?: GateRunner;
}

export async function runQualityGates(options: GateOptions): Promise<GateResult[]> {
  const runner = options.runner ?? spawnGate;
  const results: GateResult[] = [];
  for (const command of options.commands) {
    const startedAt = Date.now();
    const exitCode = await runner(command, options.cwd);
    const passed = exitCode === 0;
    results.push({ command, exitCode, durationMs: Date.now() - startedAt, passed });
    if (!passed && options.bail) {
      break;
    }
  }
  return results;
}
