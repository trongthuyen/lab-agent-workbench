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

`lab-agent-workbench` là dự án nghiên cứu và phát triển một hệ thống **Coding Agent có khả năng tùy biến sâu**, xây dựng trên nền tảng Pi.

Dự án hướng đến hai mục tiêu chính:

1. **Agent Engineering Lab:** Nghiên cứu cách coding agent hoạt động, phân tích những vấn đề thực tế và thử nghiệm các phương pháp cải thiện hiệu quả, độ tin cậy.
2. **Reusable Agent Toolkit:** Xây dựng bộ công cụ có thể dễ dàng cài đặt, cấu hình và tái sử dụng trên nhiều dự án, phù hợp với từng tech stack, nghiệp vụ và coding style.

Dự án không nhằm xây dựng lại toàn bộ Claude Code hay OpenCode, mà tập trung phát triển một coding agent linh hoạt, dễ kiểm soát và có khả năng mở rộng.

---

## 2. Core Objectives

### 2.1. Understand Agent Engineering

Nghiên cứu và thực hành những thành phần cốt lõi của coding agent:

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

Phát triển bộ công cụ cho phép:

- Cài đặt và áp dụng nhanh vào project mới.
- Cấu hình agent theo tech stack và nghiệp vụ.
- Tùy chỉnh coding standards, workflows và permissions.
- Tích hợp tools, skills, MCP và extensions.
- Chia sẻ cấu hình giữa nhiều dự án.
- Nâng cấp agent mà không cần thay đổi project-specific configuration.

### 2.3. Improve Agent Reliability

Tìm hiểu nguyên nhân và cải thiện những vấn đề phổ biến:

- Agent hallucination.
- Context loss và context pollution.
- Tool execution failures.
- Unnecessary tool calls và token consumption.
- Repeated actions và infinite loops.
- Unsafe commands và unintended file modifications.
- Poor planning và incomplete implementation.
- Code regressions sau khi agent thay đổi source code.

Mỗi vấn đề được nghiên cứu thông qua **Experiment → Observation → Analysis → Improvement → Evaluation**.

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

**Architecture Principle:** Ưu tiên sử dụng các khả năng native của Pi. Chỉ phát triển extension khi cần bổ sung chức năng, điều chỉnh hành vi hoặc nghiên cứu một vấn đề cụ thể.

Pi là runtime chính. Hệ thống có thể mở rộng sang runtime khác trong tương lai nhưng không triển khai multi-runtime ở giai đoạn đầu.

Permission policy và sandbox là hai lớp khác nhau. Workbench có thể dùng extension để cho phép hoặc chặn hành động, nhưng chỉ xem một cơ chế là sandbox khi có ranh giới cách ly ở cấp process, container hoặc hệ điều hành.

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
- Run lint, typecheck and tests as the initial quality gate.
- Provide `lawb init`, initially distributed through `npx`.
- Establish baseline and Workbench evaluation scenarios.

**Deliverable:** A Pi package and CLI that can initialize, protect, observe and evaluate one sample NestJS project end to end.

Frontend, fullstack, microservices, subagents and long-term memory are deferred until this vertical slice demonstrates reusable abstractions and measurable value.

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

**Focus:** Measure, debug and optimize agent performance.

- Agent execution inspector.
- Failure classification and analysis.
- Automated benchmark scenarios.
- Regression evaluation.
- Token and cost optimization.
- Model routing experiments.
- Documentation and reusable presets.

**Deliverable:** A stable, reusable and measurable Agent Engineering Workbench.

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

# Start agent
pi
```

`lawb` là CLI dự kiến phát triển, chưa phải công cụ có sẵn. Trong v0.1, CLI được chạy qua `npx` để không phụ thuộc vào việc Pi package có đưa executable lên `PATH` hay không. Pi package và CLI có thể nằm trong cùng monorepo nhưng được phát hành như hai package riêng.

Project configuration sẽ hỗ trợ:

- Global defaults.
- Technology-specific profiles.
- Project-specific overrides.
- Custom coding standards.
- Business rules.
- Tool permissions.
- Quality gates.
- Skills và workflows.

**Configuration Priority:**

`Base → Technology Profile → Project Override → Session Override`

---

## 8. Evaluation & Research Methodology

Mỗi feature được phát triển theo quy trình:

1. **Identify:** Xác định vấn đề thực tế khi sử dụng coding agent.
2. **Reproduce:** Tạo tình huống có thể tái hiện vấn đề.
3. **Analyze:** Phân tích nguyên nhân qua execution traces và agent behavior.
4. **Implement:** Phát triển giải pháp bằng Pi extension hoặc configuration.
5. **Evaluate:** So sánh kết quả trước và sau cải tiến.
6. **Document:** Ghi lại kết quả, trade-offs và bài học.

### Key Metrics

- Task Success Rate
- Tool Call Efficiency
- Token Consumption
- Error Recovery Rate
- Human Intervention Rate
- Code Regression Rate
- Execution Time

Các thí nghiệm cần kiểm soát model, cấu hình, codebase và điều kiện chạy để kết quả so sánh có ý nghĩa.

Do agent output có tính không xác định, mỗi thí nghiệm phải khai báo số lần chạy và báo cáo kết quả tổng hợp thay vì kết luận từ một lần chạy duy nhất.

### Experiment Manifest

Mỗi thí nghiệm phải có một manifest máy đọc được, ví dụ:

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

Raw artifacts được lưu trong `evals/runs/` và thường không commit. Báo cáo tổng hợp, cấu hình thí nghiệm và kết luận được lưu trong `evals/reports/` để theo dõi regression.

---

## 9. Design Principles

- **Pi-first:** Sử dụng Pi làm nền tảng chính.
- **Minimal Core:** Giữ core nhỏ, tránh xây dựng lại những chức năng Pi đã cung cấp.
- **Modular:** Các extension có thể bật/tắt độc lập.
- **Configuration over Modification:** Ưu tiên cấu hình thay vì sửa source code.
- **Project Agnostic:** Logic dùng chung không phụ thuộc nghiệp vụ cụ thể.
- **Safety by Default:** Các hành động rủi ro cần được kiểm soát.
- **Observable by Design:** Agent behavior phải có thể theo dõi và phân tích.
- **Evaluation Driven:** Mỗi cải tiến cần có bằng chứng về hiệu quả.
- **Avoid Overengineering:** Chỉ bổ sung abstraction khi có nhu cầu thực tế.

---

## 10. Non-goals for v0.1

- Không xây dựng agent runtime mới hoặc fork Pi.
- Không hỗ trợ multi-runtime.
- Không triển khai subagents hoặc long-term memory.
- Không tuyên bố permission policy là security sandbox cấp hệ điều hành.
- Không tối ưu cho mọi tech stack; v0.1 chỉ chứng minh vertical slice NestJS.
- Không hướng đến autonomous development hoàn toàn không cần con người giám sát.

---

## 11. Success Criteria

Dự án v0.1 được xem là đạt mục tiêu khi:

- Khởi tạo sample NestJS project trong dưới hai phút trên môi trường tham chiếu.
- Không cần sửa source code của Workbench để áp dụng cho sample project.
- Configuration precedence và merge rules đạt 100% test cases đã định nghĩa.
- Chặn 100% destructive-command và protected-path fixtures đã biết.
- Không ghi secret fixtures vào telemetry hoặc evaluation reports.
- Quality gate chạy lint, typecheck và tests với kết quả tái lập.
- Hoàn thành ít nhất 8/10 benchmark tasks trên bộ scenario v0.1.
- Không làm giảm task success rate so với Pi mặc định trên cùng model và điều kiện chạy.
- Mỗi experiment ghi lại model, configuration, repository commit, số lần chạy và metrics.
- Có tài liệu cài đặt, threat model, experiment report và failure catalog ban đầu.

---

## 12. Expected Outcome

**`lab-agent-workbench` không chỉ là một bộ extension cho Pi, mà còn là môi trường thực hành Agent Engineering.**

Sản phẩm cuối cùng gồm ba thành phần:

1. **Reusable Coding Agent Toolkit:** Bộ công cụ có thể mang sang nhiều dự án.
2. **Agent Engineering Laboratory:** Môi trường nghiên cứu, thử nghiệm và đánh giá hành vi agent.
3. **Engineering Knowledge Base:** Tập hợp các vấn đề, giải pháp, thí nghiệm và best practices được kiểm chứng trong quá trình phát triển.

**Long-term Vision:** Xây dựng một hệ sinh thái coding agent cá nhân có thể tùy chỉnh, quan sát, đánh giá và liên tục cải tiến dựa trên kinh nghiệm phát triển phần mềm thực tế.
