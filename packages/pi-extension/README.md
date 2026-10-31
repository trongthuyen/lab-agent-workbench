# @lab-agent-workbench/pi-extension

Pi extension for Lab Agent Workbench. It blocks writes to protected paths and risky shell commands
and records redacted tool-call telemetry as JSONL. It reads `.lawb/config.json` from the project
directory and falls back to the base configuration when the file is absent.

```bash
pi install npm:@lab-agent-workbench/pi-extension        # all projects
pi install -l npm:@lab-agent-workbench/pi-extension     # current project only
```

The policy is a guardrail, not an operating-system sandbox. This is a v0.1 prototype. See the
[repository](https://github.com/trongthuyen/lab-agent-workbench).
