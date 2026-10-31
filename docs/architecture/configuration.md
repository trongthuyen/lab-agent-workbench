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

Later layers take precedence. Objects merge recursively. Arrays and scalar values are replaced as a whole; arrays are never appended implicitly.

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

In shell commands, `echo` and `printf` arguments are treated as text, so `echo .env >> .gitignore`
is allowed while `echo x > .env` is not.

## Loading a project file

`.lawb/config.json` is applied as a layer over the defaults, so a file written by an older release
that lacks a newer key (for example `protectedReadPaths`) still loads and receives the default.
Unknown keys are still rejected.

## Migration policy

A future incompatible schema must increment `version` and provide an explicit migration command. The runtime must not silently reinterpret an unsupported version.
