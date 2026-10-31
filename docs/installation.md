# Installation

## Requirements

- Node.js 22.19 or newer and npm 10 or newer.
- [Pi Coding Agent](https://pi.dev/). Tested with Pi 1.4.0.
- Linux, macOS or Windows. CI runs on all three.

## Install the Pi extension

```bash
pi install npm:@lab-agent-workbench/pi-extension        # every project you open with Pi
pi install -l npm:@lab-agent-workbench/pi-extension     # the current project only
pi list                                                  # confirm it is listed
```

Restart Pi after installing. The extension loads when Pi starts, so a session that was already open
does not have it.

## Initialize a project (optional)

```bash
cd my-nestjs-project
npx @lab-agent-workbench/lawb init --profile nestjs
```

This writes `.lawb/config.json` and appends `**/.lawb` to `.gitignore` (skip that with
`--no-gitignore`). Without it the project runs on the built-in defaults and its telemetry goes to
`~/.lawb/runs/telemetry.jsonl` (`%USERPROFILE%\.lawb\runs\telemetry.jsonl` on Windows). See
[Configuration](./architecture/configuration.md).

Re-run `lawb init --profile nestjs --force` after upgrading to pick up new default policies: the file is
a snapshot, and arrays in it replace the defaults rather than extending them.

## Check that it works

In a Pi session inside the project, ask Pi to edit `.env`. The call should be refused with
`Path matches protected pattern ...`. After any tool call, `.lawb/runs/telemetry.jsonl` (or the home log
for an uninitialized project) gains one JSON line per call.

`npx @lab-agent-workbench/lawb gates` runs the project's quality gates.

## Setup time

The v0.1 target is to initialize the sample NestJS project in under two minutes. Measured on 2026-10-31
(Linux on WSL2, Node 24.22.1, npm 11.19.1, home broadband), starting from an empty npm cache and an empty
Pi agent directory, with the published 0.1.0 packages:

| Step | Time |
|---|---|
| `npx @lab-agent-workbench/lawb init --profile nestjs` | 3.1 s |
| `pi install npm:@lab-agent-workbench/pi-extension` | 1.9 s |
| Total | about 5 s |

This excludes installing Node, Pi and the project's own dependencies, and it depends on network speed.
It was a single run on one machine, so read it as "seconds, not minutes", not as a benchmark.

## Upgrade and uninstall

```bash
pi update                                                # update installed packages
pi remove npm:@lab-agent-workbench/pi-extension          # uninstall
```

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Nothing is blocked and no telemetry appears | Pi was not restarted, or the extension is disabled. Run `pi list`, then `pi config` to check its resources are enabled. |
| Tool calls fail with an error from the extension | `.lawb/config.json` is invalid (unknown key, bad JSON, bad regular expression). The extension fails closed instead of ignoring it. Fix the file or run `lawb init --force`. |
| An old project still lets `apps/api/.env` through | Its config predates the current defaults. Run `lawb init --profile nestjs --force`. |
| `npm install` fails with `E401` | The machine's default npm registry is private. Pass `--registry=https://registry.npmjs.org/`. |

## From a clone

See the README for building from source. After pulling changes run `npm run build` and restart Pi,
because Pi loads `packages/pi-extension/dist/`.
