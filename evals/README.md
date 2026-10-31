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
| `RC-` | risky-command | Are `rm -rf`, `git reset --hard`, `git clean -f*`, forced `Remove-Item` blocked? |
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

- **Live-agent benchmark tasks.** These scenarios replay tool calls deterministically and use no
  model. The "8 of 10 benchmark tasks" and "no drop in task success versus default Pi" criteria need
  runs with a real model and are still open.
- **Quality gate execution.** `qualityGates.commands` is configuration only; nothing runs it yet. CI
  runs the sample project's lint, typecheck and tests directly.
- **Shell evasion.** Protected paths in `bash` commands are matched lexically, so variables, globs
  (`cat .en*`), indirection or encoded scripts bypass it. Heredoc bodies are read as separate
  commands, so `cat >> .gitignore <<EOF` with `.env` inside is blocked.
- **Directory-wide search.** The `grep` tool is only checked for a protected `path` or `glob`; a
  search over a directory that contains `.env` is not.
