# Lab Agent Workbench

Pi-first Agent Engineering Lab and reusable coding-agent toolkit.

The project is currently a **v0.1 foundation prototype**. Its first vertical slice targets NestJS projects and focuses on deterministic configuration, protected-path and risky-command policies, redacted JSONL telemetry, quality gates, and reproducible evaluation.

Project documentation:

- [English overview](./PROJECT_OVERVIEW_en.md)
- [Tổng quan tiếng Việt](./PROJECT_OVERVIEW_vn.md)
- [Configuration contract](./docs/architecture/configuration.md)
- [Initial threat model](./docs/architecture/threat-model.md)
- [Evaluation scenarios](./evals/README.md)

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

Packages are published under the `@lab-agent-workbench` npm scope. Until the first release is
published, install from a clone instead (see [Publishing](./docs/publishing.md)).

```bash
pi install npm:@lab-agent-workbench/pi-extension      # Pi extension (add -l for project scope)
npx @lab-agent-workbench/lawb init --profile nestjs   # writes .lawb/config.json
```

`lawb init` also appends `**/.lawb` to the project's `.gitignore` (creating it if needed), so the
config and telemetry stay out of version control. Pass `--no-gitignore` to skip that. Teams that want
to share the config should skip it and ignore only `.lawb/runs/`.

### Without `lawb init`

A project with no `.lawb/config.json` runs on the built-in defaults, and nothing is created inside
it. Telemetry for such projects goes to one shared log in your home directory,
`~/.lawb/runs/telemetry.jsonl` (`%USERPROFILE%\.lawb\runs\telemetry.jsonl` on Windows); each record
carries the `cwd` it came from. Run `lawb init` in a project to give it its own profile and its own
`.lawb/runs/telemetry.jsonl`.

## Security boundary

The current policy extension is a guardrail, not an operating-system sandbox. See the threat model before relying on it for sensitive workloads.
