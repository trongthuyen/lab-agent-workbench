# DOGFOOD-001: what does context injection cost?

Status: **protocol ready, not yet run.** No results exist, and nothing below should be read as one.

This is a small hands-on comparison, not a benchmark (the live benchmarks were deliberately left out of Phase 2).
Its only job is to show, on real work, whether the opt-in context features add or save tokens, tool calls and time,
so a maintainer can decide whether they stay experimental, get tuned, or are dropped. It does not support any claim
that context injection improves answers.

## Question

On the same small tasks, with the same model and thinking level, what changes in token usage (including cache
reads and writes), read/search tool calls, wall time and model time when `context.enabled` is on?

## Procedure

1. Pick 5 to 8 small real tasks from a repository whose Markdown docs hold knowledge that is not obvious from
   the prompt. Include at least one task that needs no docs, to see the overhead of injecting when it does not help.
2. Run `lawb context inspect --query "<task prompt>"` first, to see what would be injected and why other
   sources were skipped. It prints no document text.
3. Run each task twice from a clean session with the same model and thinking level: once with context off and once
   with it on (project `context.enabled`, or the `/lawb` switch). Alternate which comes first from task to task, so
   a warm provider cache does not favor one arm.
4. Do not change the config, docs or Workbench build between the two runs of a task. Record each run's outcome
   yourself (done / partly / failed): there are no hidden tests, so this is a maintainer's judgment.
5. For every run, summarize the Pi session file:

   ```bash
   npm run build
   npm run dogfood -- --session <path-to-session.jsonl> --label "T3 context-on" \
     --telemetry <project>/.lawb/runs/telemetry.jsonl
   ```

   Pi keeps sessions under `~/.pi/agent/sessions/`. The command reads usage, timing and tool names only; it never
   copies message text, tool arguments or results. Add `--json` for the structured form.

## What is recorded

Per run: assistant turns, input / output / `cacheRead` / `cacheWrite` tokens, provider cost when reported, tool
calls (and read + grep + find + ls separately), model time, wall time, and, from the telemetry log, the estimated
injected tokens and retrieval milliseconds. Anything the provider did not report is written `unavailable`, never 0,
and a run with some turns missing usage is flagged `(+N turn(s) without usage)`, because its totals are incomplete.

Also record by hand: model and thinking level, Pi version, Workbench commit, the effective `context` settings, and
the outcome of the task. Include failed and aborted runs; do not drop them quietly.

## How to read it

- With this few runs, report the raw numbers and short notes (for example "T3: +620 input tokens, 2 fewer
  read calls"). No significance tests, no averages across unlike tasks, no cost comparison unless the price list and
  cache pricing for that model are written down.
- Cache reads and writes can outweigh the injected text: compare the `cacheRead`/`cacheWrite` columns, not only
  input tokens.
- Decide, per feature, one of: keep experimental as is; tune the starting values (budget shares, ranking
  threshold); drop. Turning it on by default needs a separate design change with real evidence.

## Results

| Task | Arm | Outcome | Turns | Input | Output | cacheRead | cacheWrite | Cost | Tool calls | Read/search | Model ms | Wall ms | Injected tok (est.) | Retrieval ms |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| _not run yet_ | | | | | | | | | | | | | | |

Conditions (fill in when run): model / thinking level / Pi version / Workbench commit / repository / date.

Notes and decision: _none yet._
