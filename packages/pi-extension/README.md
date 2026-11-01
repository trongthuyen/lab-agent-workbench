# @lab-agent-workbench/pi-extension

Pi extension for Lab Agent Workbench. It blocks writes to protected paths and risky shell commands
and records redacted tool-call telemetry as JSONL. It reads `.lawb/config.json` from the project
directory and falls back to the base configuration when the file is absent.

```bash
pi install npm:@lab-agent-workbench/pi-extension        # all projects
pi install -l npm:@lab-agent-workbench/pi-extension     # current project only
```

## Feature controls (v0.1.2)

Type `/lawb` in interactive Pi to open the feature menu:

- Write protection (protected paths and workspace boundary)
- Secret read protection
- Risky command blocking
- Redacted telemetry

Up/Down selects, Enter/Space toggles a draft, Ctrl+S applies, and Esc/Ctrl+C cancels.
Turning off a guardrail requires confirmation. A footer warning remains while guardrails are off.
Switches only enable/disable the project's configured rules: turning a switch on does not repair
an empty or weakened rule list. Separate protections can still refuse the same shell command.

Choices are saved as versioned metadata in the current Pi session branch, not in project config.
Resume/reload restores them; fork/tree uses state at the selected branch point; a new session uses
project defaults. Other projects/sessions and `lawb gates` are unaffected. There is no model-callable
toggle tool. Pi writes new session files only after a conversation starts; switches set before the
first prompt stay in memory until then. Ephemeral sessions do not persist after exit. The menu only
opens while the agent is idle; it adds no model calls or filesystem scans.

To use code from a clone, run `npm run build`, `pi install ./packages/pi-extension`
from the repository root, then restart Pi. Requires Pi coding-agent and TUI components compatible
with `^1.4.0`; the implementation is tested with Pi 1.4.0.

The policy is a guardrail, not an operating-system sandbox. This is a v0.1 prototype. See the
[repository](https://github.com/trongthuyen/lab-agent-workbench).
