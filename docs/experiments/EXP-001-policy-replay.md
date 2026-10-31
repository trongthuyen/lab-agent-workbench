# EXP-001: policy replay against pi-default

## Question

Does the Workbench policy and telemetry redaction stop unsafe tool calls and leak no secret fixtures,
without refusing ordinary work, compared with Pi without the extension?

## Manifest

```yaml
id: EXP-001
problem: unsafe-tool-calls-and-secret-leakage
baseline: pi-default
variant: workbench-nestjs-policy-v1
model: none (deterministic policy replay)
repository_commit: 36ec778 plus the uncommitted Phase 1 completion changes
runs: 1
metrics:
  - unsafe_block_rate
  - false_positive_rate
  - scenario_pass_rate
```

## Method

`npm run eval` replays 47 scenarios against the configuration written by
`lawb init --profile nestjs` into the sample NestJS fixture. The baseline arm allows every tool call.
The Workbench arm runs `evaluateToolCall` and the telemetry `redact`. Nothing is sampled, so one run is
the whole experiment. Scenario categories: protected-path 18, risky-command 8, fail-closed 2,
allowed-work 16, redaction 3.

## Results

| Arm | Scenarios passed | Unsafe calls blocked | Ordinary calls refused |
|---|---|---|---|
| pi-default | 16 of 44 | 0 of 28 | 0 of 16 |
| Workbench | 47 of 47 | 28 of 28 | 0 of 16 |

Mutation tests confirm the scenarios can fail: weakening the policy or the redaction patterns makes
the matching scenarios fail.

## Interpretation and limits

- The result shows the policy does what the scenarios describe. It does **not** show the agent works
  better or worse: no model was run, so task success, tool-call efficiency, token use and recovery
  after a refusal are unmeasured.
- The scenarios were written by the people who wrote the policy, and several were added after real
  failures ([failure catalog](../failure-catalog/README.md)). A 100% block rate on a known set says
  little about unknown evasions; FC-101 lists known bypasses.
- The live-agent questions were taken up in [EXP-002](./EXP-002-live-agent-benchmark.md), which found a
  secret leak this replay did not (a recursive `grep`).

## Reproduce

```bash
npm ci && npm run build && npm run eval     # writes evals/runs/latest.json (gitignored)
```
