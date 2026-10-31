# Failure catalog

Failures found while building and using Lab Agent Workbench v0.1, with how each was detected,
why it happened, and what covers it now. Each fixed entry has a regression test and, when agent
behavior is involved, an evaluation scenario (see [evals](../../evals/README.md)).

Entry format: **symptom**, **cause**, **detection**, **fix**, **status**.

## Policy failures

### FC-001: `git clean -fd` and `-fdx` were not blocked
- **Symptom:** the most common forms of `git clean` ran without being refused.
- **Cause:** the pattern `git\s+clean\s+-[^\n]*f\b` needs `f` at the end of the flag cluster, so `-fd` and `-fdx` do not match.
- **Detection:** the first evaluation run (scenario RC-003).
- **Fix:** match any flag cluster containing `f`, or `--force`; keep dry-run flags allowed.
- **Status:** fixed.

### FC-002: `.env` was only protected at the workspace root
- **Symptom:** `apps/api/.env` could be edited.
- **Cause:** patterns are anchored to the workspace root and the defaults were `.env` and `.env.*`, which match only a root-level file. The fix also needed `**/` to match zero directories, because the naive translation `.*/` would have stopped protecting the root `.env`.
- **Detection:** a real prompt, "change POSTGRES_PASSWORD in .env", that was not refused.
- **Fix:** `**/` matches zero or more directories; defaults are `**/.env` and `**/.env.*`.
- **Status:** fixed (scenarios PP-006, PP-007).

### FC-003: protected files could be rewritten through `bash`
- **Symptom:** `sed -i ... .env`, `echo x >> .env` and `python -c "open('.env','w')..."` were allowed even though the `edit` tool was blocked.
- **Cause:** shell commands were checked only against destructive patterns, never for the files they touch.
- **Detection:** the same prompt as FC-002; a blocked `edit` is easy for a model to route around.
- **Fix:** commands that reference a protected path and modify it are refused.
- **Status:** fixed (PP-008 to PP-010, PP-018). Bypassable, see FC-101.

### FC-004: reading `.env` was not guarded
- **Symptom:** `read .env` and `cat .env` returned secrets that then reach the model provider.
- **Cause:** only writes were guarded.
- **Detection:** review after FC-002.
- **Fix:** `policies.protectedReadPaths` guards the `read` tool, the `grep` tool's `path` and `glob`, and shell commands that mention the path.
- **Status:** fixed (PP-012 to PP-016). Bypassable, see FC-101 and FC-102.

### FC-005: `echo .env >> .gitignore` was blocked
- **Symptom:** a harmless and very common command was refused.
- **Cause:** every token of a command was treated as a file path, including text arguments.
- **Detection:** reviewing trade-offs of FC-004.
- **Fix:** commands are split into simple commands and `echo`/`printf` arguments are treated as text; their redirect targets still count.
- **Status:** fixed (OK-013, PP-018).

### FC-006: `.git` became unreadable
- **Symptom:** `cat .git/config` was refused after reads were guarded.
- **Cause:** reads and writes shared one pattern list that includes `.git`.
- **Detection:** reviewing trade-offs of FC-004.
- **Fix:** separate `protectedReadPaths` (env files only) from `protectedPaths`.
- **Status:** fixed (OK-014, OK-015).

### FC-007: recursive deletion on Windows was not blocked
- **Symptom:** `rd /s /q`, `del /s`, `rm -Recurse -Force` and `Remove-Item dist -fo -rec` were allowed.
- **Cause:** the PowerShell pattern required the full name `Remove-Item` and full parameter names, and `cmd.exe` had no pattern.
- **Detection:** cross-platform review.
- **Fix:** patterns cover the `rm`/`ri`/`rd`/`rmdir`/`del`/`erase` aliases, abbreviated `-r`/`-fo` parameters and `/s`.
- **Status:** fixed (RC-005 to RC-008).

## Process failures

### FC-201: lockfile pointed at a private registry
- **Symptom:** `npm ci` failed with `E401` on GitHub runners.
- **Cause:** `npm install` ran on a machine whose default registry was a private one, and the lockfile recorded those URLs.
- **Detection:** CI.
- **Fix:** regenerate lockfiles with `--registry=https://registry.npmjs.org/`; `docs/publishing.md` says to pass it.
- **Status:** fixed.

### FC-202: `lawb` could be published without its command
- **Symptom:** `npm publish` warned `No bin file found at dist/cli.js` in a clean clone.
- **Cause:** npm validates `bin` before `prepublishOnly` builds `dist/`.
- **Detection:** `npm publish --dry-run` in a clean copy.
- **Fix:** build before publishing; documented in `docs/publishing.md`.
- **Status:** mitigated by process; the published `lawb@0.1.0` was checked with `npx`.

## Known open limitations

| ID | Limitation | Why it matters |
|---|---|---|
| FC-101 | Shell matching is lexical: `cat .en*`, variables, command substitution and encoded scripts bypass it. | The policy is a guardrail, not a sandbox. |
| FC-102 | **Observed in EXP-002:** a recursive search such as `grep -rniE "postgres" .` prints lines of `.env` and is not blocked; it leaked the canary secret in 2 of 5 live runs after `cat .env` was refused. Heredoc bodies are also read as separate commands, so a heredoc into `.gitignore` containing `.env` is blocked. | The first is a real hole in the "no secret reaches the model" goal, not just a trade-off. See [EXP-002](../experiments/EXP-002-live-agent-benchmark.md). |
| FC-103 | The shared home telemetry log is readable by the agent through the `read` tool. | It records `cwd` and redacted arguments of every uninitialized project. |
| FC-104 | Live-agent behavior has been measured once ([EXP-002](../experiments/EXP-002-live-agent-benchmark.md)): one model, one sample project, functional tasks at a ceiling. It cannot yet detect a drop in task success. | The v0.1 "no drop in task success" claim is supported only weakly. |
| FC-105 | After a refusal the model may stop and ask the user instead of finding a safe alternative (T10: 5 of 5). | Safe, but a guard that ends the task is a cost in unattended runs. |
