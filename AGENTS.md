# Repository guidance

## Scope

Keep v0.1 focused on the Pi + NestJS vertical slice. Do not add multi-runtime support, subagents, long-term memory, or additional technology profiles without an accepted design change.

## Commands

- Build: `npm run build`
- Typecheck and test: `npm run check`
- Run CLI help: `node packages/cli/dist/cli.js --help`

## Engineering rules

- Preserve deterministic configuration precedence: Base → Technology Profile → Project Override → Session Override.
- Configuration objects merge recursively; arrays and scalar values are replaced by the later layer.
- Policy evaluation must fail closed when required tool arguments are absent or invalid.
- Do not log tool results or unredacted secrets.
- Treat permission policies as guardrails, not security sandboxes.
- Every behavior change requires a regression test and, when agent behavior is involved, an evaluation scenario.
