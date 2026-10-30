# Lab Agent Workbench — Project Overview

## 1. Introduction

**Project Name:** lab-agent-workbench

**Document Version:** 1.2

**Project Status:** Active Development

**Target Release:** v0.1.0

**Type:** Agent Engineering Lab & Reusable Coding Agent Toolkit

**Primary Runtime:** [Pi Coding Agent](https://pi.dev/)

**Tech Stack:** TypeScript, Node.js, Pi Extensions, MCP

**Philosophy:** Pi-first, Learning by Building, Reusability, Observability, Extensibility.

### Project Vision

`lab-agent-workbench` is a research and development project for building a deeply customizable **Coding Agent** on top of Pi.

The project has two primary goals:

1. **Agent Engineering Lab:** Study how coding agents behave, analyze real-world problems, and experiment with methods that improve effectiveness and reliability.
2. **Reusable Agent Toolkit:** Build a toolkit that can be installed, configured, and reused across projects while adapting to each technology stack, domain, and coding style.

The project does not aim to rebuild Claude Code or OpenCode in full. It focuses on creating a flexible, controllable, and extensible coding agent environment.

---

## 2. Core Objectives

### 2.1. Understand Agent Engineering

Research and practice the core components of coding agents:

- Agent loop & tool execution
- Agent lifecycle & hooks
- Context engineering & compaction
- Memory & session management
- Planning & task execution
- Subagent orchestration
- Permission policies & execution isolation
- Error handling & recovery
- Observability & evaluation

### 2.2. Build a Reusable Agent Toolkit

Develop a toolkit that supports:

- Fast installation and adoption in new projects.
- Agent configuration by technology stack and domain.
- Custom coding standards, workflows, and permissions.
- Integration with tools, skills, MCP, and extensions.
- Shared configuration across projects.
- Workbench upgrades without modifying project-specific configuration.

### 2.3. Improve Agent Reliability

Investigate the causes of and improvements for common problems:

- Agent hallucination.
- Context loss and context pollution.
- Tool execution failures.
- Unnecessary tool calls and token consumption.
- Repeated actions and infinite loops.
- Unsafe commands and unintended file modifications.
- Poor planning and incomplete implementation.
- Code regressions after agent changes.

Each problem is studied through **Experiment → Observation → Analysis → Improvement → Evaluation**.

---

## 3. System Architecture

```text
Developer
    │
    ▼
Project Configuration
    │
    ▼
Pi Coding Agent Runtime
    │
    ▼
Lab Agent Workbench
    │
    ├── Core & Configuration
    ├── Safety & Permissions
    ├── Context & Memory
    ├── Planning & Tasks
    ├── Subagent Orchestration
    ├── Skills & Workflows
    ├── Git & Quality Gates
    ├── Telemetry & Debugging
    └── Evaluation
    │
    ▼
Project Profiles
    ├── Base
    ├── Frontend
    ├── NestJS
    ├── Fullstack
    └── Microservices
    │
    ▼
Tools / MCP / Git / Project Codebase
```

**Architecture Principle:** Prefer Pi's native capabilities. Build an extension only when a feature, behavioral adjustment, or focused experiment requires one.

Pi is the primary runtime. The system may support other runtimes in the future, but multi-runtime support is outside the initial scope.

Permission policy and sandboxing are separate layers. The Workbench may use extensions to allow or block actions, but a mechanism is considered a sandbox only when it establishes an isolation boundary at the process, container, or operating-system level.

---

## 4. Key Modules

| Module | Responsibility |
|---|---|
| Core & Configuration | Configuration loading, validation, overrides, shared policies |
| Safety & Permissions | Tool authorization, command protection, file access policies |
| Context Engineering | Context injection, compaction, token budgeting, knowledge retrieval |
| Memory & Sessions | Session persistence, reusable project knowledge |
| Planning & Tasks | Plan mode, task tracking, dependency management |
| Subagent Orchestration | Agent delegation, parallel execution, isolation |
| Skills & Workflows | Reusable development workflows, coding standards |
| Git & Quality Gates | Checkpoints, diff review, lint, tests, typecheck |
| Telemetry & Debugging | Execution traces, token usage, errors, retries |
| Evaluation | Benchmark scenarios, regression tests, reliability metrics |

---

## 5. Repository Structure

```text
lab-agent-workbench/
├── packages/
│   ├── core/                 # Shared logic & policies
│   ├── pi-extension/         # Pi runtime integrations
│   └── cli/                  # Workbench CLI
│
├── profiles/
│   ├── base/
│   ├── frontend/
│   ├── nestjs/
│   ├── fullstack/
│   └── microservices/
│
├── skills/                   # Reusable agent skills
├── agents/                   # Specialized agent definitions
├── evals/
│   ├── scenarios/           # Reproducible evaluation scenarios
│   ├── fixtures/            # Controlled test inputs and repositories
│   ├── runs/                # Raw run artifacts, normally gitignored
│   └── reports/             # Versioned aggregate results
├── examples/                 # Example integrations
├── docs/
│   ├── architecture/
│   ├── experiments/
│   └── failure-catalog/
│
├── AGENTS.md
└── package.json
```

---

## 6. Development Roadmap

### Phase 1 — Foundation (v0.1)

**Focus:** Deliver one complete vertical slice for a NestJS project on Pi.

- Initialize the TypeScript workspace and Pi package.
- Define a versioned configuration schema and deterministic merge rules.
- Implement one NestJS profile on top of the base profile.
- Implement protected-path and risky-command policies.
- Record redacted tool execution telemetry in JSONL format.
- Run lint, typecheck, and tests as the initial quality gate.
- Provide `lawb init`, initially distributed through `npx`.
- Establish baseline and Workbench evaluation scenarios.

**Deliverable:** A Pi package and CLI that can initialize, protect, observe, and evaluate one sample NestJS project end to end.

Frontend, fullstack, microservices, subagents, and long-term memory are deferred until this vertical slice demonstrates reusable abstractions and measurable value.

### Phase 2 — Context Engineering (v0.2)

**Focus:** Improve context quality and efficiency.

- Dynamic context injection.
- Custom context compaction strategies.
- Token budgeting.
- Session management.
- Project knowledge retrieval.
- Context-related experiments.

**Deliverable:** Improved handling of large codebases and long-running development sessions.

### Phase 3 — Agent Workflows (v0.3)

**Focus:** Improve agent autonomy and development workflows.

- Plan mode and task manager.
- Subagent orchestration.
- Git checkpoints and change review.
- Automated quality gates.
- Reusable debugging and code review workflows.

**Deliverable:** A more capable coding agent with structured task execution and verification.

### Phase 4 — Evaluation & Optimization (v1.0)

**Focus:** Measure, debug, and optimize agent performance.

- Agent execution inspector.
- Failure classification and analysis.
- Automated benchmark scenarios.
- Regression evaluation.
- Token and cost optimization.
- Model routing experiments.
- Documentation and reusable presets.

**Deliverable:** A stable, reusable, and measurable Agent Engineering Workbench.

---

## 7. Developer Experience

Expected workflow:

```bash
# Navigate to an existing project
cd my-nestjs-project

# Initialize project configuration
npx @your-scope/lawb init --profile nestjs

# Install the Pi package at project scope
pi install --local npm:@your-scope/lab-agent-workbench

# Customize project-specific settings
npx @your-scope/lawb config

# Start the agent
pi
```

`lawb` is a planned CLI and is not yet available. In v0.1, the CLI runs through `npx` so it does not depend on a Pi package placing an executable on `PATH`. The Pi package and CLI may live in the same monorepo while being published as separate packages.

Project configuration will support:

- Global defaults.
- Technology-specific profiles.
- Project-specific overrides.
- Custom coding standards.
- Business rules.
- Tool permissions.
- Quality gates.
- Skills and workflows.

**Configuration Priority:**

`Base → Technology Profile → Project Override → Session Override`

---

## 8. Evaluation & Research Methodology

Each feature follows this process:

1. **Identify:** Identify a real problem encountered when using a coding agent.
2. **Reproduce:** Create a scenario that reliably reproduces the problem.
3. **Analyze:** Analyze the cause through execution traces and agent behavior.
4. **Implement:** Develop a solution through a Pi extension or configuration.
5. **Evaluate:** Compare results before and after the improvement.
6. **Document:** Record results, trade-offs, and lessons learned.

### Key Metrics

- Task Success Rate
- Tool Call Efficiency
- Token Consumption
- Error Recovery Rate
- Human Intervention Rate
- Code Regression Rate
- Execution Time

Experiments must control the model, configuration, codebase, and execution conditions so comparisons remain meaningful.

Because agent output is nondeterministic, each experiment must declare its run count and report aggregate results instead of drawing conclusions from a single run.

### Experiment Manifest

Each experiment must include a machine-readable manifest, for example:

```yaml
id: EXP-001
problem: repeated-tool-call
baseline: pi-default
variant: loop-guard-v1
model: provider/model
repository_commit: abc123
runs: 10
metrics:
  - task_success_rate
  - tool_calls
  - tokens
  - duration
```

Raw artifacts are stored in `evals/runs/` and are normally not committed. Aggregate reports, experiment configuration, and conclusions are stored in `evals/reports/` to support regression tracking.

---

## 9. Design Principles

- **Pi-first:** Use Pi as the primary platform.
- **Minimal Core:** Keep the core small and avoid rebuilding features that Pi already provides.
- **Modular:** Extensions can be enabled and disabled independently.
- **Configuration over Modification:** Prefer configuration over source-code changes.
- **Project Agnostic:** Shared logic must not depend on a specific business domain.
- **Safety by Default:** Risky actions must be controlled.
- **Observable by Design:** Agent behavior must be traceable and analyzable.
- **Evaluation Driven:** Every improvement requires evidence of effectiveness.
- **Avoid Overengineering:** Add abstractions only in response to demonstrated needs.

---

## 10. Non-goals for v0.1

- Do not build a new agent runtime or fork Pi.
- Do not support multiple runtimes.
- Do not implement subagents or long-term memory.
- Do not claim that a permission policy is an operating-system security sandbox.
- Do not optimize for every technology stack; v0.1 proves only the NestJS vertical slice.
- Do not target fully autonomous development without human oversight.

---

## 11. Success Criteria

Project v0.1 is considered successful when:

- It initializes the sample NestJS project in under two minutes on the reference environment.
- Applying it to the sample project requires no Workbench source-code changes.
- Configuration precedence and merge rules pass 100% of their defined test cases.
- It blocks 100% of known destructive-command and protected-path fixtures.
- It writes no secret fixtures to telemetry or evaluation reports.
- The quality gate runs lint, typecheck, and tests with reproducible results.
- It completes at least 8 of 10 benchmark tasks in the v0.1 scenario set.
- It does not reduce task success rate relative to default Pi under the same model and execution conditions.
- Every experiment records the model, configuration, repository commit, run count, and metrics.
- Installation documentation, a threat model, an experiment report, and an initial failure catalog are available.

---

## 12. Expected Outcome

**`lab-agent-workbench` is not only a collection of Pi extensions; it is also a practical environment for Agent Engineering.**

The final product consists of three components:

1. **Reusable Coding Agent Toolkit:** A toolkit that can be applied across projects.
2. **Agent Engineering Laboratory:** An environment for researching, experimenting with, and evaluating agent behavior.
3. **Engineering Knowledge Base:** A collection of problems, solutions, experiments, and best practices validated during development.

**Long-term Vision:** Build a personal coding-agent ecosystem that can be customized, observed, evaluated, and continuously improved through real-world software engineering experience.
