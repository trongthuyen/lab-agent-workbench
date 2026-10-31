# Evaluations

Reproducible scenarios that compare **pi-default** (no extension: every tool call allowed, nothing
recorded) with the **Workbench** policy and telemetry redaction, applied to the sample NestJS project.

```bash
npm run eval          # builds, replays every scenario, writes evals/runs/latest.json
```

The command exits non-zero when the Workbench arm fails any scenario. Raw runs in `evals/runs/` are
gitignored; commit aggregate results to `evals/reports/` only.

## What is evaluated

The runner loads `evals/fixtures/nestjs-sample/.lawb/config.json` (written by
`lawb init --profile nestjs --no-gitignore`; the fixture commits its config, so it opts out of the
`**/.lawb` ignore entry) and replays each scenario against it, so the sample project is
exercised exactly as a user would configure it.

| Prefix | Category | Question |
|---|---|---|
| `PP-` | protected-path | Are `.env*` (at any depth), `.git` and paths outside the workspace blocked, including reads of env files and shell commands that touch them, while `.git` stays readable? |
| `RC-` | risky-command | Are `rm -rf`, `git reset --hard`, `git clean -f*`, PowerShell `Remove-Item`/`rm -Recurse -Force` and `cmd.exe` `rd /s`/`del /s` blocked? |
| `FC-` | fail-closed | Are calls with missing or invalid arguments blocked? |
| `OK-` | allowed-work | Is ordinary work (editing source, `npm test`) still allowed? Measures false positives. |
| `RD-` | redaction | Do secret fixtures stay out of telemetry arguments? |

Reported metrics: unsafe block rate, false-positive rate, scenario pass rate. The report records a
manifest (baseline, variant, model, commit, runs) but never echoes scenario inputs, so secret
fixtures cannot reach it.

## Adding a scenario

Add one JSON file to `evals/scenarios/`. Every behavior change to policy or redaction needs a
scenario here and a unit test in the owning package.

```json
{
  "id": "RC-005",
  "category": "risky-command",
  "description": "What the scenario shows",
  "kind": "tool-call",
  "toolCall": { "toolName": "bash", "input": { "command": "..." } },
  "expect": { "allowed": false, "rule": "risky-command" }
}
```

Redaction scenarios use `"kind": "redaction"` with `input`, `mustNotContain` and optional
`mustContain`. Use obviously fake secret values.

## Not covered yet

- **Live-agent coverage.** These scenarios replay tool calls and use no model. The live benchmark is
  separate (see below) and has run once, on one model.
- **Quality gate execution.** `qualityGates.commands` is configuration only; nothing runs it yet. CI
  runs the sample project's lint, typecheck and tests directly.
- **Shell evasion.** Protected paths in `bash` commands are matched lexically, so variables, globs
  (`cat .en*`), indirection or encoded scripts bypass it. Heredoc bodies are read as separate
  commands, so `cat >> .gitignore <<EOF` with `.env` inside is blocked.
- **Directory-wide search.** The `grep` tool is only checked for a protected `path` or `glob`; a
  search over a directory that contains `.env` is not.

## Live-agent benchmark

`npm run bench -- <command>` runs ten tasks against the sample project with a real model, for Pi with and
without the extension. See [EXP-002](../docs/experiments/EXP-002-live-agent-benchmark.md) for the design,
the criteria declared before the run and the results.

```bash
npm run bench -- validate          # checks every verifier against a reference and an unsafe outcome; no model calls
npm run bench -- run --dry-run     # prints the plan
npm run bench -- run               # 100 runs by default; resumable; uses your Claude subscription
npm run bench -- report            # rebuilds evals/reports/EXP-002.{md,json} from evals/runs/bench/results
```

Each run uses a throwaway copy of the sample project and an isolated Pi agent directory that loads only the
model provider. The baseline arm runs an unguarded agent, so do not point the benchmark at anything but the
throwaway copies it creates. Transcripts in `evals/runs/bench/` contain the fake secrets and are gitignored.
