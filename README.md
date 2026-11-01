# Lab Agent Workbench

Pi-first Agent Engineering Lab and reusable coding-agent toolkit.

The project is currently a **v0.1 foundation prototype**. Its first vertical slice targets NestJS projects and focuses on deterministic configuration, protected-path and risky-command policies, redacted JSONL telemetry, quality gates, and reproducible evaluation.

Project documentation:

- [English overview](./PROJECT_OVERVIEW_en.md)
- [Tổng quan tiếng Việt](./PROJECT_OVERVIEW_vn.md)
- [Configuration contract](./docs/architecture/configuration.md)
- [Initial threat model](./docs/architecture/threat-model.md)
- [Evaluation scenarios](./evals/README.md)
- [Installation](./docs/installation.md)
- [Failure catalog](./docs/failure-catalog/README.md)
- [EXP-001: policy replay](./docs/experiments/EXP-001-policy-replay.md)
- [EXP-002: live-agent benchmark](./docs/experiments/EXP-002-live-agent-benchmark.md)

## Requirements

- Node.js 22.19 or newer
- npm 10 or newer
- Pi Coding Agent for extension integration

## Development

```bash
npm install
npm run check   # lint, typecheck, tests
npm run build
npm run eval    # replay evaluation scenarios: pi-default baseline vs Workbench
node packages/cli/dist/cli.js --help
```

## Workspace packages

- `@lab-agent-workbench/core`: configuration, profiles, policies, and redaction.
- `@lab-agent-workbench/lawb`: project initialization CLI.
- `@lab-agent-workbench/pi-extension`: Pi policy and telemetry integration.
- `@lab-agent-workbench/evals`: deterministic evaluation scenarios and runner, plus the sample NestJS fixture in `evals/fixtures/nestjs-sample`.

## Current CLI prototype

```bash
lawb init --profile nestjs
lawb config
```

## Installation

Packages are published to npm under the `@lab-agent-workbench` scope.

```bash
pi install npm:@lab-agent-workbench/pi-extension      # Pi extension (add -l for project scope)
npx @lab-agent-workbench/lawb init --profile nestjs   # writes .lawb/config.json
```

Restart Pi after installing. Without `-l` the extension applies to every project you open with Pi;
with `-l` it applies only to the current project.

`lawb init` also appends `**/.lawb` to the project's `.gitignore` (creating it if needed), so the
config and telemetry stay out of version control. Pass `--no-gitignore` to skip that. Teams that want
to share the config should skip it and ignore only `.lawb/runs/`.

### Interactive feature controls (v0.1.2)

In Pi, run `/lawb` to toggle write/workspace protection, secret read protection, risky-command
blocking, and redacted telemetry. Use Up/Down to select, Enter/Space to toggle, **Ctrl+S to apply**,
and Esc to discard. Disabling guardrails requires confirmation and leaves a visible footer warning.

Switches apply to **this Pi session's active branch**: they survive resume/reload and follow
fork/tree navigation, but a new session starts from project defaults. They do not edit
`.lawb/config.json` or affect other sessions or the standalone CLI. Re-enabling a guardrail restores
its configured rules, not necessarily the built-in defaults. Quality gates remain an explicit
`lawb gates` command; there is no fake switch for CLI commands or unimplemented Phase 2 features.

From a clone, build and install the local extension as described below, then restart Pi. The menu
requires interactive TUI mode; policy and telemetry still work in print/JSON/RPC modes.

### Quality gates

`lawb gates` runs the commands in `qualityGates.commands` (for the `nestjs` profile: `npm run lint`,
`npm run typecheck`, `npm test`) and exits non-zero if any fail. It prints the commands before running
them; add `--bail` to stop at the first failure. It exits non-zero when none are configured, so an
empty config is not mistaken for a pass. The commands come from `.lawb/config.json`, so review that
file before running gates in a repository you do not trust.

### Without `lawb init`

A project with no `.lawb/config.json` runs on the built-in defaults, and nothing is created inside
it. Telemetry for such projects goes to one shared log in your home directory,
`~/.lawb/runs/telemetry.jsonl` (`%USERPROFILE%\.lawb\runs\telemetry.jsonl` on Windows); each record
carries the `cwd` it came from. Run `lawb init` in a project to give it its own profile and its own
`.lawb/runs/telemetry.jsonl`.

### From a clone

To run unreleased changes, build the repository and install the extension from its path:

```bash
git clone https://github.com/trongthuyen/lab-agent-workbench.git && cd lab-agent-workbench
npm install && npm run build
pi install ./packages/pi-extension
node packages/cli/dist/cli.js init --profile nestjs   # run inside the target project
```

Rebuild with `npm run build` and restart Pi after pulling changes, because Pi loads
`packages/pi-extension/dist/`. Releases are described in [Publishing](./docs/publishing.md).

## Security boundary

The current policy extension is a guardrail, not an operating-system sandbox. See the threat model before relying on it for sensitive workloads.
