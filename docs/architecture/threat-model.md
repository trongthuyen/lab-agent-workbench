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
- Local context retrieval (`retrieveContext`, `lawb context inspect`) opens files itself, outside the `tool_call`
  policy, so it enforces its own guards: workspace confinement on canonical paths, `protectedReadPaths` on both the
  lexical and the real path, internal exclusions (`.git`, `node_modules`, `.lawb`, build output, `*.jsonl`/`*.log`)
  that `context.sources` cannot override, no walking through symlinked directories, bounded reads that skip rather
  than truncate, and redaction of retrieved text. These are guardrails, not a sandbox: a file replaced between the
  check and the read (TOCTOU) is not defended against, redaction misses unknown secret formats, and retrieved
  documents are untrusted data that may contain instructions. When `context.enabled` is on, selected excerpts are added to model requests as a transient, labelled
  "untrusted" message. A document can still contain instructions that a model follows; the frame lowers that risk
  and cannot remove it, and policy enforcement stays outside the model. The extra tokens cost money and time, and
  changing excerpts can reduce provider cache hits; none of this has been measured.
- Context injection is a second path by which file content reaches the model provider besides the `read` tool. It
  keeps the project's `protectedReadPaths` even when the session's secret-read switch is off, re-reads each source
  through the same checks before every request, and records only counters in telemetry. A session with injection
  on sends excerpts of the user's Markdown docs to the configured model provider; it is off unless the project or
  the user turns it on.
- Individual tool calls do not prompt for conditional approval; they are allowed or blocked.
- The v0.1.2 `/lawb` TUI lets an idle user disable guardrails for a Pi session branch after
  confirmation. That intentionally removes the corresponding checks; a visible footer warning is
  informational, not enforcement. Turning a switch back on restores configured rules, which may
  themselves be weak or empty. Invalid config/required arguments still fail closed.
- Feature choices persist in Pi session metadata and can be inherited on resume/fork. There is no
  model-callable toggle tool, but session files and same-process extensions are not tamper-resistant.
  Review imported sessions as trusted local state; this UI is not an authorization or sandbox boundary.

## Planned mitigations

- Canonicalize existing path targets and parent directories before mutation.
- Add platform-specific command fixtures and parser-assisted checks.
- Add project-trust and package-provenance documentation.
- Add secret canary tests for telemetry and evaluation reports.
- Evaluate an optional external sandbox separately from the policy extension.
