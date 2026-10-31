# Changelog

Versions are released together: `@lab-agent-workbench/core`, `@lab-agent-workbench/pi-extension` and
`@lab-agent-workbench/lawb` always share a version, because the other two pin `core` exactly.

## 0.1.1 (2026-10-31)

### Added
- `lawb gates` runs the commands in `qualityGates.commands`, prints them first, and exits non-zero on a
  failure, when none are configured, or when there is no config. `--bail` stops at the first failure.
- Recursive searches (`grep -r`, `egrep`, `rgrep`, `ack`, and `rg`/`ag` with `--hidden` or `-u`) are
  refused when the directory tree they would search holds a file matching `protectedReadPaths`, because
  printing matching lines would print the secret. `--exclude`, `--exclude-dir`, `--include` and `rg -g`
  are honored, so `grep -rn foo --exclude='.env*' .` and `grep -rn foo --include=*.ts .` still work.
- Windows deletion patterns: `rd /s`, `rmdir /s`, `del /s`, `erase /s`, and PowerShell `rm`, `ri`, `del`
  with `-Recurse -Force`, including abbreviated parameters such as `-rec -fo`.

### Changed
- Shell commands are split on `;`, `|`, `||` and `&&` outside quotes, so a quoted `|` in a search pattern no
  longer cuts a command in two.
- The policy now reads the file system when it checks a recursive search, so that decision depends on the
  directory contents at the time of the call.
- An exclusion value such as `--exclude=.env` is no longer treated as reading `.env`.

### Upgrading
- Update the extension and the CLI together (`pi install npm:@lab-agent-workbench/pi-extension`, then restart
  Pi). The extension's policy comes from `core`, so the new checks apply as soon as it loads.
- **Existing `.lawb/config.json` files keep their old pattern lists**, because arrays in a project file
  replace the defaults. To pick up the Windows deletion patterns, run `lawb init --profile nestjs --force`
  or copy the new `riskyCommandPatterns` by hand. The recursive-search check does not depend on the config
  file beyond `protectedReadPaths`, which older files already have or receive by default.

### Not in the packages
The live-agent benchmark (`npm run bench`), the evaluation scenarios, the failure catalog and the EXP-001 to
EXP-002b reports live in the repository only.

## 0.1.0 (2026-10-31)

First release.

- Configuration with a fixed precedence (Base, Technology Profile, Project Override), deterministic merge
  and strict validation; a `nestjs` profile.
- Policy: protected write paths and protected read paths with `**/` and `!` patterns, shell commands that
  read or modify protected files, risky command patterns (`rm -rf`, `git reset --hard`, `git clean -f`),
  and fail-closed handling of missing arguments.
- Redacted JSONL telemetry; projects without a config log to `~/.lawb/runs/telemetry.jsonl`.
- `lawb init` (adds `**/.lawb` to `.gitignore`) and `lawb config`.
- Pi extension that applies the policy and writes telemetry.
