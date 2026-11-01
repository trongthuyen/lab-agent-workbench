# Configuration contract

Status: v0.1 draft

## Location

Project configuration is stored at `.lawb/config.json`.

## Precedence

Configuration layers are applied in this order:

1. Base defaults
2. Technology profile
3. Project override
4. Session override

Later layers take precedence. In v0.1 the project override is the `.lawb/config.json` file itself (loaded over the
base defaults). The v0.1.2 pre-Phase 2 `/lawb` TUI wires a narrowly scoped session override layer
for feature switches, described below; arbitrary session configuration is still deferred.
Objects merge recursively. Arrays and scalar values are replaced as a whole; arrays are never appended implicitly.

## Session feature switches (v0.1.2)

`/lawb` is an idle-only, interactive Pi command, not a model-callable tool. Draft changes require
Ctrl+S to apply; Esc cancels, and disabling guardrails requires explicit confirmation. It adds a
session layer over the unchanged base/project configuration:

| Switch | When off |
|---|---|
| Write protection | `policies.allowOutsideWorkspace: true`, `policies.protectedPaths: []` |
| Secret read protection | `policies.protectedReadPaths: []` |
| Risky command blocking | `policies.riskyCommandPatterns: []` |
| Telemetry | `telemetry.enabled: false` |

When a guardrail is on, its original configured values are used; no list is erased from project
config. Telemetry initially follows project config and can be explicitly enabled for the session.
All-on is not proof that rule lists are non-empty. Missing/invalid required tool arguments are
still refused, and invalid project configuration still fails closed even with all switches off.

Pi owns persistence: a `lawb-features` custom entry contains only `version: 1`, `cwd`, and the four
boolean `features` (`writeProtection`, `readProtection`, `riskyCommands`, `telemetry`). Restore uses
the newest entry on the active branch, never inactive branches. Invalid state falls back to project
defaults with a warning; a different workspace cannot inherit the saved switches. New sessions
start from defaults, resume/reload restores, fork inherits at its fork point, and tree navigation
reconstructs state. Session transitions clear config and pending-call caches, so `/reload` also
picks up repaired or edited project config.

Switches are not written into `.lawb/config.json`, shared with other sessions, or applied to CLI
commands. Existing v1 files need no migration. Session files are trusted local state, not a
tamper-resistant security store. Pi only creates a new session file after a user/assistant message;
switches set before the first prompt stay in memory until then. In ephemeral Pi sessions switches
last only until exit.

## Validation

- The only supported schema version is `1`.
- Unknown keys are rejected.
- Required fields must be present after resolution.
- Command and redaction patterns must compile as regular expressions.
- Invalid configuration fails closed in the Pi `tool_call` policy boundary.

## Schema

```json
{
  "version": 1,
  "profile": "nestjs",
  "policies": {
    "allowOutsideWorkspace": false,
    "protectedPaths": [".git", ".git/**", "**/.env", "**/.env.*", "!**/.env.example", "!**/.env.sample"],
    "protectedReadPaths": ["**/.env", "**/.env.*", "!**/.env.example", "!**/.env.sample"],
    "riskyCommandPatterns": []
  },
  "telemetry": {
    "enabled": true,
    "path": ".lawb/runs/telemetry.jsonl",
    "redactPatterns": []
  },
  "qualityGates": {
    "commands": ["npm run lint", "npm run typecheck", "npm test"]
  }
}
```

The example omits the built-in regular-expression values for readability. `lawb init --profile nestjs` writes the complete resolved configuration.

## Path patterns

`policies.protectedPaths` guards writes and edits (the `write` and `edit` tools and shell commands that
modify the path). `policies.protectedReadPaths` guards reads (the `read` tool, the `grep` tool's
`path` and `glob`, and shell commands that mention the path). They are separate so `.git` can be read
but not modified. Both hold globs matched against workspace-relative paths, case-insensitively.

`*` stays inside one path segment, `**` crosses segments, and a `**/` prefix also matches zero
directories (`**/.env` matches `.env` and `apps/api/.env`).

Patterns apply in order and the last match wins. A leading `!` re-allows paths matched by earlier
patterns, so the defaults protect `.env` and `.env.*` but not the template files `.env.example` and
`.env.sample`. Put a negated pattern after the pattern it carves out of. Arrays are replaced rather
than appended, so a project that overrides either list must restate the defaults it still wants.

Recursive searches (`grep -r`, `egrep`, `rgrep`, `ack`, and `rg`/`ag` when they search hidden files) are
checked against the disk: the directory tree they would search is walked, skipping `node_modules` and
`.git`, and the command is refused if it contains a file matching `protectedReadPaths`, because printing
matching lines would print the secret. A search over a tree without such files is allowed, and
`--exclude='.env*'` (or `rg -g '!.env*'`) makes it allowed. Excluding only some of the files is not enough.
A tree of more than 100,000 entries is refused as unverifiable. `rg` and `ag` skip hidden files by
default, so they are refused only with `--hidden`, `-u` or `--no-ignore`.

In shell commands, `echo` and `printf` arguments are treated as text, so `echo .env >> .gitignore`
is allowed while `echo x > .env` is not.

## Quality gates

`qualityGates.commands` is an ordered list of shell commands. `lawb gates` runs them in the project
directory through the platform shell, streams their output to the terminal (Workbench does not record
it) and exits 1 if any command fails, if none are configured, or if there is no config file.
`lawb gates --bail` stops at the first failure.

## Telemetry location

A project with `.lawb/config.json` writes telemetry to `telemetry.path`, which must stay inside the
workspace (default `.lawb/runs/telemetry.jsonl`). A project **without** that file uses the built-in
defaults and writes to `.lawb/runs/telemetry.jsonl` under the user's home directory instead
(`os.homedir()`: `$HOME` on Linux and macOS, `%USERPROFILE%` on Windows), so uninitialized projects
are not modified. Every record includes the `cwd` it came from. `telemetry.enabled: false` in a project
config disables both.

`lawb init` appends `**/.lawb` to the project `.gitignore` (idempotent; `.lawb`, `.lawb/`, `/.lawb`
and `**/.lawb/` count as already present; an existing file keeps its LF or CRLF line endings;
`--no-gitignore` skips it). This also ignores
`.lawb/config.json`, so the config is not shared through git unless the entry is narrowed to
`.lawb/runs/`.

## Loading a project file

`.lawb/config.json` is applied as a layer over the defaults, so a file written by an older release
that lacks a newer key (for example `protectedReadPaths`) still loads and receives the default.
Unknown keys are still rejected.

## Migration policy

A future incompatible schema must increment `version` and provide an explicit migration command. The runtime must not silently reinterpret an unsupported version.
