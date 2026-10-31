# @lab-agent-workbench/core

Configuration schema, profiles, policy evaluation and redaction shared by the Lab Agent Workbench
packages.

- Config layers merge in the order Base → Technology Profile → Project Override → Session Override.
  Objects merge recursively; arrays and scalars are replaced by the later layer.
- Policy evaluation fails closed when required tool arguments are absent or invalid.
- Policies are guardrails, not an operating-system sandbox.

This is a v0.1 prototype. See the [repository](https://github.com/trongthuyen/lab-agent-workbench).
