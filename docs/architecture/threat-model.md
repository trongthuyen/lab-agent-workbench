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
- Block writes and edits to configured protected paths.
- Block known destructive shell and PowerShell command patterns.
- Fail closed when write/edit calls have no path or shell calls have no command.
- Redact configured string patterns and sensitive object keys before telemetry is written.
- Keep telemetry output inside the workspace.

## Known limitations

- This is an in-process policy guard, not a process, container, or operating-system sandbox.
- Regular-expression command matching is not a complete shell parser and may be bypassed by aliases, encoding, indirection, scripts, or an unrecognized tool.
- Lexical path checks do not yet resolve every symlink or junction escape.
- A malicious or compromised extension running in the same Pi process can bypass Workbench policy.
- Telemetry redaction cannot guarantee removal of secrets in unknown encodings or formats.
- The current implementation does not prompt for conditional approval; it only allows or blocks.

## Planned mitigations

- Canonicalize existing path targets and parent directories before mutation.
- Add platform-specific command fixtures and parser-assisted checks.
- Add project-trust and package-provenance documentation.
- Add secret canary tests for telemetry and evaluation reports.
- Evaluate an optional external sandbox separately from the policy extension.
