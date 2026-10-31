# Initial threat model

Status: v0.1 draft

## Assets

- Project source code and Git history
- Credentials and environment files
- User files outside the project workspace
- Agent prompts, tool arguments, and telemetry

## Trust boundaries

- Pi and Workbench extensions run with the user's operating-system permissions.
- Model output and tool arguments are untrusted.
- Project-local configuration is untrusted until the project is trusted.
- MCP servers and third-party Pi packages are separate trust domains.

## Covered in the first vertical slice

- Block writes and edits outside the configured workspace.
- Block writes and edits to configured protected paths. `**/` matches zero or more directories, so
  the default `**/.env` and `**/.env.*` protect env files at any depth, except `.env.example` and
  `.env.sample`, which a negated `!` pattern re-allows.
- Block the `read` tool, and the `grep` tool when pointed at a protected `path` or `glob`, for paths in
  `protectedReadPaths` (env files by default). Reads are not limited to the workspace.
- Block recursive searches (`grep -r`, `rg --hidden`, ...) whose directory tree contains a protected read
  file, checked against the disk, unless the file is excluded from the search.
- Block `bash` and `powershell` commands that mention a protected read path, and commands that modify
  a protected path (`.git`, env files): redirects, `sed -i`, `tee`, `cp`, `mv`, `rm`, inline
  interpreter scripts, `Set-Content`. `echo` and `printf` arguments are treated as text.
- Block known destructive shell and PowerShell command patterns.
- Fail closed when write/edit calls have no path or shell calls have no command.
- Redact configured string patterns and sensitive object keys before telemetry is written.
- Keep project telemetry inside the workspace; uninitialized projects log only to `~/.lawb/runs/`.

## Known limitations

- This is an in-process policy guard, not a process, container, or operating-system sandbox.
- Regular-expression command matching is not a complete shell parser and may be bypassed by aliases, encoding, indirection, scripts, or an unrecognized tool.
- Lexical path checks do not yet resolve every symlink or junction escape.
- Shell path protection is a lexical heuristic: variables, globs, command substitution,
  indirection and encoded scripts bypass it, and heredoc bodies are read as separate commands. Searches are
  covered only for `grep`-family tools, `rg`, `ag` and `ack`; `find ... | xargs cat`, `Get-ChildItem -Recurse |
  Select-String`, `findstr /s` and similar pipelines are not. A recursive `grep` leaked an env secret in 2 of 5
  live runs before it was covered (EXP-002).
- A malicious or compromised extension running in the same Pi process can bypass Workbench policy.
- Telemetry redaction cannot guarantee removal of secrets in unknown encodings or formats.
- The shared `~/.lawb/runs/telemetry.jsonl` records the working directory and redacted tool arguments of
  every uninitialized project in one place; treat it as sensitive and do not sync it.
- `lawb gates` executes the commands in `.lawb/config.json` with the user's permissions. A config from an
  untrusted repository can therefore run arbitrary commands, exactly as its npm scripts could; read the
  printed commands and the config before running gates there.
- The current implementation does not prompt for conditional approval; it only allows or blocks.

## Planned mitigations

- Canonicalize existing path targets and parent directories before mutation.
- Add platform-specific command fixtures and parser-assisted checks.
- Add project-trust and package-provenance documentation.
- Add secret canary tests for telemetry and evaluation reports.
- Evaluate an optional external sandbox separately from the policy extension.
