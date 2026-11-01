# Phase 2 — Context Engineering (v0.2)

**Trạng thái:** Đề xuất để review, chưa phải design change đã được chấp nhận.

**Baseline repository:** `78fe611` — các package phát hành ở v0.1.1.

**Phạm vi:** Pi + NestJS; không thay runtime, không thêm technology profile.

## 1. Kết luận

Phase 1 đã có nền tảng đủ để bắt đầu Phase 2: config, policy, telemetry, CLI gates, replay eval và live benchmark. Bước tiếp theo nên làm agent **đọc đúng kiến thức của project, đưa vừa đủ vào context và tiếp tục đúng sau compaction/resume** — không xây thêm agent framework.

Ưu tiên triển khai:

1. Chốt config/session lifecycle và dựng phép đo context.
2. Retrieval cục bộ có policy boundary.
3. Dynamic injection có budget và không lặp.
4. Session state dựa trên Pi, không tạo memory store riêng.
5. Compaction có cấu trúc, giữ recent context và fallback native.
6. Benchmark, dogfood và quyết định feature nào đủ bằng chứng để bật mặc định.

**Không đặt mục tiêu “hỗ trợ large codebase” chỉ bằng demo:** phải có fixture nhiều module/tài liệu gây nhiễu và task nhiều turn, khác bộ task nhỏ hiện tại.

## 2. Những gì đã xác minh

| Hạng mục | Hiện trạng / bằng chứng |
|---|---|
| Config | `core/src/config.ts` merge object đệ quy, replace array/scalar, reject unknown key. `resolveConfig()` nhận nhiều layer nhưng runtime/CLI đọc project file trực tiếp trên base; chưa tự áp dụng profile từ tên trong file. |
| Profile | `core/src/profiles.ts` chỉ có base và NestJS. `lawb init` materialize config đã resolve nên cách dùng thông thường vẫn nhận NestJS gates. |
| Runtime | `pi-extension/src/index.ts` mới đăng ký `tool_call`, `tool_execution_start/end`; chưa có context/session/compaction hooks. Config cache bằng `Map<cwd, Promise<LoadedConfig>>`. |
| Session override | Có trong contract nhưng được ghi rõ là chưa nối runtime tại `docs/architecture/configuration.md`. |
| Telemetry | JSONL chứa redacted args và thời gian tool, không ghi tool results; chưa có session correlation, context budget hoặc compaction metrics. |
| Quality gates | Đã có `lawb gates` và tests; đoạn “nothing runs it yet” trong `evals/README.md` đã lỗi thời. |
| Replay | Chạy lại `npm run eval`: Workbench pass 53/53, block 30/30 unsafe cases, 0/20 false positives. Đây là fixture coverage, không phải bảo đảm mọi hành vi đều an toàn. |
| Checks | Chạy lại `npm run check`: lint/typecheck pass, 78 tests pass. `npm run eval` cũng build thành công. Môi trường đọc project: Node 24.8.0, npm 11.6.0; CI dùng Node 22.19.0. |
| Live benchmark cũ | EXP-002b báo cáo 35/35 functional runs pass, 0 violations; chỉ chạy lại Workbench arm. T10 vẫn 0/5 hoàn thành; functional tasks có ceiling effect. Chưa chạy lại live benchmark trong lần review này. |
| Verifier preflight | `npm run bench -- validate` hiện fail 7 reference solutions. Fixture chưa có dependencies; chạy typecheck trực tiếp báo thiếu `@nestjs/common`, `@nestjs/core`. Cần cài fixture rồi validate lại trước khi kết luận verifier lỗi. |
| Harness | `evals/src/bench/run.ts` hardcode model/thinking, chạy `-p --no-session` với một prompt. Chưa đo multi-turn, resume hay compaction. |
| Pi API | Đã đối chiếu docs native và declarations của Pi 1.4.0 trong `node_modules`: có `context`, `before_agent_start`, session hooks, `getContextUsage()`, `compact()`, `appendEntry()`. Peer/dev dependency hiện là `*`. |

Các kết luận về live-agent là từ report đã commit, không phải kết quả thực nghiệm mới.

## 3. Scope và non-goals

### Bắt buộc cho v0.2

- Project knowledge retrieval cục bộ, trả về nguồn và vị trí trong file.
- Dynamic context injection theo task, có dedupe, freshness và giới hạn dung lượng.
- Budget dành cho phần context Workbench thêm vào; cảnh báo context tổng theo Pi.
- Session override cho nhóm context, lưu/khôi phục theo active branch của Pi.
- Structured compaction strategy tùy chọn, giữ mục tiêu, constraints, decisions, progress và references.
- Context telemetry chỉ chứa metadata/counters; regression tests và evaluation scenarios cho từng behavior.
- Backward compatibility với `.lawb/config.json` v1 đang sử dụng.

### Không làm trong Phase 2

- Subagents, multi-runtime, plan/task manager, git checkpoints và tự động chạy gates sau mỗi task: để Phase 3.
- Long-term memory, tự học kiến thức giữa các session, vector database, embeddings hoặc remote retrieval.
- AST/dependency graph toàn repository, language server và additional technology profiles.
- Viết lại session browser, session storage, agent loop hay model routing của Pi.
- Tổng quát hóa shell policy thành sandbox. Các giới hạn FC-101/102 vẫn phải được công bố.
- Tự động xóa/summarize mọi tool result để tiết kiệm token; đây là tối ưu rủi ro, chỉ xem xét sau khi có phép đo.

**Project knowledge ở đây là file có sẵn trong repository**, không phải tri thức agent tự ghi nhớ từ các phiên trước.

## 4. Thiết kế đề xuất

### 4.1. Giữ core nhỏ, adapter Pi mỏng

Không thêm package ở bước đầu. Tách logic trong các package hiện tại:

```text
packages/core/src/
  config.ts                 # schema, resolution + profile semantics
  context/types.ts          # source, chunk, selection, budget contracts
  context/retrieve.ts       # deterministic lexical ranking
  context/budget.ts         # bounded packing, dedupe, estimates
  context/access.ts         # access checks cho reader mới
  context/compact.ts        # summary contract và validation, không tự gọi provider
packages/pi-extension/src/
  index.ts                  # composition, giữ policy boundary
  context.ts                # context selection/injection adapter
  session.ts                # branch-scoped overrides và lifecycle
  compaction.ts             # native Pi integration + fallback
  telemetry.ts              # metadata-only context events
packages/cli/src/
  context.ts                # inspect/dry-run retrieval
```

Tên file là định hướng, không phải yêu cầu tạo abstraction trước khi cần.

### 4.2. Config và compatibility

- Nối đúng thứ tự **Base → Technology Profile → Project Override → Session Override** trong loader dùng chung cho CLI và extension.
- Project cũ đã materialize vẫn được giữ nguyên: array trong project file tiếp tục thắng profile/defaults. Không dùng `init --force` như migration tự động.
- Thêm nhóm `context` theo cách additive trong schema v1 nếu không đổi nghĩa key cũ; default mới được bổ sung khi resolve. Nếu cần đổi nghĩa không tương thích, phải có version mới và migration riêng.
- Trong giai đoạn thử nghiệm, `context.enabled` mặc định `false`. Init config cũ vẫn chạy policy/telemetry như trước.
- Session override v0.2 chỉ cho phép key context đã khai báo; không cung cấp shortcut để giảm policy bảo vệ hoặc đổi telemetry destination.
- Override chỉ do thao tác explicit của người dùng/flags được validate; không có tool cho model tự sửa override.
- Cập nhật config theo snapshot ở ranh giới user task. Tool calls đang chạy dùng snapshot nhất quán; `/reload` và session replacement phải xóa cache cũ.
- Invalid project config tiếp tục fail closed tại tool policy boundary; retrieval lỗi thì bỏ phần context bổ sung và báo trạng thái, không fallback sang reader không được bảo vệ.

Thông số khởi điểm để benchmark, chưa phải tuning đã chứng minh:

| Tham số | Giá trị đề xuất |
|---|---:|
| Tổng injected context mỗi request | tối đa khoảng 4.000 estimated tokens, kèm hard byte cap |
| Retrieval | tối đa 5 chunks, mỗi chunk tối đa khoảng 800 estimated tokens |
| File đọc để retrieval | tối đa 256 KiB/file; giới hạn số file và tổng bytes mỗi lượt |
| Sources mặc định khi bật context | docs Markdown trong workspace và metadata project được allowlist; không auto-scan source code |
| Compaction strategy | `native` mặc định; `structured` opt-in |

Chốt tên key và cross-field validation trong PR đầu tiên, tránh hai hệ setting cùng sở hữu reserve/keepRecent của Pi.

### 4.3. Retrieval trước, injection sau

Luồng: **discover allowlisted sources → kiểm tra quyền → đọc có giới hạn → chunk → lexical rank → dedupe → pack theo budget → inject**.

- Bắt đầu bằng lexical ranking deterministic: filename/heading match, keyword và source priority; tie-break bằng path + vị trí. Chưa cần embeddings.
- Chunk theo heading/đoạn, mang `source`, line range và content hash. Metadata luôn lấy từ filesystem, không tin nguồn tự khai báo trong nội dung tài liệu.
- Chỉ chọn chunk có relevance vượt ngưỡng; không có match thì không nhét tài liệu bất kỳ cho đủ quota.
- Không duplicate `AGENTS.md`/context files Pi đã nạp. Kiểm tra metadata native ở `before_agent_start` thay vì tự scan parent directories.
- Dùng `before_agent_start` để chuẩn bị selection; `context` hook chèn một message riêng của Workbench vào request, thay vì append persistent message mỗi turn.
- Chỉ thay/remove message thuộc Workbench; không đụng prompt, tool schemas, user message hay nội dung của extension khác.
- Không tự rút bớt context gốc của Pi để cố đạt budget. Nếu hết dung lượng, giảm/bỏ phần Workbench bổ sung.
- Refresh khi source đổi hoặc bắt đầu task mới; context hook phải re-check quyền/current fingerprint trước khi tái dùng cache. Không cần background watcher ở MVP.
- CLI đề xuất: `lawb context inspect --query "..."` hiển thị source, range, score, estimate và lý do bỏ qua; không dump snippet/raw query vào telemetry. Trong Pi có `/lawb-context` để xem cùng metadata và trạng thái budget.

### 4.4. Reader mới phải tự có policy boundary

`fs.readFile` trong extension **không đi qua `tool_call`**. Không được mặc định extension đã có policy nên retrieval cũng được bảo vệ.

- Giới hạn retrieval trong workspace, kể cả khi read tool thông thường cho phép đọc ngoài workspace.
- Kiểm tra cả lexical path và canonical path trước đọc; không theo symlink/junction ra ngoài workspace hay alias vào protected file. Không xác minh được thì bỏ nguồn đó.
- Áp dụng `protectedReadPaths` và exclusions trước đọc, sau canonicalization và trước emit context. Không ghi nội dung bị chặn vào cache.
- Loại `.git`, `node_modules`, generated files, `.lawb/runs`, telemetry và session artifacts khỏi retrieval. Exclusion nội bộ không được source allowlist ghi đè.
- Chạy redaction hiện có trên snippet trước injection như defense in depth; không tuyên bố nó bắt được mọi secret.
- Retrieved content được đóng khung là dữ liệu tham khảo không đáng tin, không nối vào system instructions. Có scenario tài liệu chứa chỉ thị “bỏ qua policy”. Đây không phải bảo đảm loại bỏ prompt injection.
- Cache chỉ trong bộ nhớ, namespace theo workspace/session, bounded và invalidated khi đổi policy/config/session. Không tạo vector index hoặc content cache trên disk.
- Telemetry/report không chứa snippet, summary, tool result, raw prompt/query hoặc secret. Có secret-canary tests cho cả injection và reporting.

### 4.5. Session management = dùng Pi, không thay Pi

- Pi tiếp tục sở hữu `/resume`, `/new`, `/fork`, `/tree`, session JSONL và session IDs.
- Workbench lưu entry có version qua `appendEntry()` cho context override và metadata cần khôi phục; không lưu thêm transcript hay tool output.
- Restore từ **active branch** (`getBranch()`), không replay mọi entry của mọi nhánh qua `getEntries()`.
- `/new` reset override; `/resume` restore phiên đích; `/fork` kế thừa state tại fork point; `/tree` reconstruct tại leaf mới; `/reload` restore cùng branch.
- Không kế thừa cache/override sang workspace khác. Cleanup pending calls, timers và state cũ ở shutdown; không giữ stale `ctx` sau session replacement.
- Entry hỏng/khác version: bỏ context override, về project context config an toàn và báo warning; tuyệt đối không làm giảm policy.
- Lệnh đề xuất `/lawb-context set <key> <value>` và `/lawb-context reset`, chỉ khi agent idle; không tạo thêm session picker.

### 4.6. Token budget và compaction

Phân biệt hai phép đo: **budget phần injected context** và **context tổng của model**. Ước lượng token không phải billing, cũng không bảo đảm request sẽ không overflow.

- Dùng `ctx.getContextUsage()` và context window của model; tokens `null`/usage chưa có phải là unknown, không coi là 0.
- Budget packing dùng estimator nhất quán + hard UTF-8 byte cap. Chừa safety margin; model switch phải tính lại budget.
- v0.2 đầu tiên cảnh báo áp lực context, dựa vào auto-compaction native của Pi thay vì thêm scheduler cạnh tranh.
- Structured strategy tích hợp `session_before_compact`, dùng preparation/cut point native. Giữ `firstKeptEntryId`, recent messages và pairing tool call/result.
- Summary contract: goal, explicit constraints, decisions, completed/in-progress/blocked, next steps, source/file references; không ghi “tests passed” nếu chỉ có kế hoạch chạy tests.
- Preserve previous summary và split-turn prefix; summary là trạng thái phiên, không phải nơi thay policy/config. Policy enforcement luôn nằm ngoài LLM context.
- Ưu tiên helper compaction native để Pi tiếp tục quản lý model/auth/retry/usage; không thêm Anthropic SDK hay provider client riêng vào Workbench. Spike phải xác minh helper thực sự được public export ở Pi version hỗ trợ.
- Summary rỗng, malformed, bị cắt, lỗi model hoặc abort: không commit summary lỗi. Non-abort có thể fallback native một lần nếu còn khả năng; abort phải dừng, không âm thầm tạo lượt model khác.
- Không chặn/cancel overflow compaction chỉ vì context feature đang lỗi. Không gọi `compact()` đệ quy từ chính before-compact handler.
- Không log summary/tool results. Chỉ ghi trigger, strategy, duration, estimates, usage có sẵn, outcome và fallback reason enum.

## 5. Kế hoạch triển khai theo PR

Ước lượng cho một người quen TypeScript/Pi; chưa tính thời gian chờ review và chi phí live runs.

| PR | Nội dung | Điều kiện xong | Ước lượng |
|---|---|---|---:|
| P2-01 | Context RFC/config contract; shared profile-aware loader; pin/test Pi compatibility; sửa docs lệch; benchmark preflight | Config cũ chạy nguyên nghĩa; profile + project + context override precedence có tests; thiếu fixture deps fail sớm với hướng dẫn; chốt manifest EXP-003 trước tuning | 2–3 ngày |
| P2-02 | Secure local retrieval + CLI inspect | Deterministic ranking; citations đúng; protected/outside/symlink/junction/artifact sources không xuất hiện; size/scan limits và cancellation có tests/scenarios | 2–3 ngày |
| P2-03 | Budget + dynamic injection | Feature opt-in; không inject lặp qua nhiều turn; source đổi được refresh; no-match/unknown-usage/model-switch hoạt động; không đụng context người khác | 2–3 ngày |
| P2-04 | Pi branch-scoped session state + context commands | New/resume/fork/tree/reload/cross-workspace có lifecycle tests; context override không sửa policy; unknown entry version xử lý an toàn | 1–2 ngày |
| P2-05 | Structured compaction + metadata telemetry | Native fallback; previous summary/split turn/cancel/length/error được kiểm thử; không phá tool pairing; telemetry không có content/secrets | 2–3 ngày |
| P2-06 | Multi-turn benchmark, EXP-003/004 reports, dogfood + release docs | Verifiers validate trước live run; báo cáo đủ arms/repetitions/usage; đạt release gates bên dưới hoặc giữ feature experimental | 3–4 ngày |

**Tổng:** khoảng 12–18 ngày công, tương đương 3–4 tuần có review. Nếu cần scope nhỏ: giao P2-01 đến P2-04 thành v0.2 alpha, giữ compaction native; không tuyên bố đã hoàn thành toàn bộ Phase 2.

Dependency: `P2-01 → P2-02 → P2-03 → P2-04 → P2-05 → P2-06`. Harness/scenarios của P2-06 phải được dựng dần từ P2-01, không chờ viết feature xong mới tạo phép đo.

## 6. Evaluation plan

### 6.1. Deterministic scenarios — chạy CI không dùng model

Thêm context/session scenario contracts riêng, không nhét vào tool-call replay schema hiện tại một cách gượng ép. Tái dùng reporting utilities, fixture canaries và failure-catalog convention.

Nhóm bắt buộc:

- `CTX-`: chọn đúng nguồn, no-match, ranking ties, dedupe, stale source, file quá lớn, scan limit.
- `CTX-SAFE-`: protected source, ngoài workspace, symlink/junction, artifact exclusion, malicious instructions, canary không vào injected context hoặc report.
- `BUD-`: packing biên, UTF-8 bytes, estimator limits, unknown usage và đổi model.
- `SES-`: override precedence, branch restore, resume/new/fork/tree/reload, workspace isolation, invalid state entry.
- `CMP-`: summary schema, empty/truncated/failed/aborted responses, split turn, previous summary, native fallback và tool pairing.

Mỗi behavior change có unit test ở package sở hữu và eval scenario tương ứng. CI chạy Windows/macOS/Linux; trường hợp không thể tạo symlink phải báo skip rõ, không báo pass giả.

### 6.2. EXP-003 — Retrieval và injection có giúp không?

**Hai arm chính:** foundation v0.1-compatible (cùng policy, context disabled) và cùng build với retrieval/injection enabled. Pi-default chỉ là arm tham khảo nếu cần; không dùng nó để gán tác dụng policy cho context.

- Fixture NestJS mở rộng trong `evals/fixtures/`, không thay tech profile: nhiều module, docs có conventions/domain rules và nhiều tài liệu không liên quan.
- Ít nhất 8 task, 5 repetitions/task/arm, seeded interleaving. Tasks phải cần kiến thức không lộ trực tiếp trong prompt và có hidden verifiers.
- Có tasks không cần retrieval để đo overhead/false injection, tasks tài liệu cập nhật và tasks nguồn nhạy cảm.
- Configurable model/thinking nhưng không tự đổi provider hoặc mặc định model của người dùng. Record requested/served model, Pi version, commit, config hash, fixture hash, seed và effective conditions.
- Pilot riêng để kiểm tra task difficulty/harness; đóng băng criteria + task set trước confirmatory runs. Không gộp pilot vào kết quả chính.
- Metrics: functional success, source-hit/selection correctness theo oracle, injected tokens, total reported token components, cacheRead/cacheWrite, tool calls, latency và violations.
- Không suy cost từ total tokens đơn thuần; cache và model-specific pricing có thể làm kết luận đổi chiều. Không cộng token estimate như thể đó là provider usage.

### 6.3. EXP-004 — Tiếp tục đúng sau compaction/resume?

**Arms:** native compaction + retrieval giống nhau, so với structured compaction + cùng retrieval. Không thay hai yếu tố cùng lúc.

- Ít nhất 6 kịch bản multi-turn, 5 repetitions/arm: constraint được đặt sớm, quyết định bị thay đổi, test chưa chạy, lỗi chưa giải quyết, tài liệu đổi và resume/fork đúng branch.
- Harness phải giữ một Pi session qua các turn và chủ động trigger compaction/resume qua public Pi control surface. Chốt transport trong P2-01; không dùng `-p --no-session` hiện tại để giả lập mất context.
- Test adapter/harness trước model runs: assert compaction thực sự xảy ra, resumed session đúng ID/branch, recent context được giữ và không lộ verifier.
- Đo fact/constraint retention bằng assertions cụ thể và hidden tests, không chỉ hỏi LLM tự chấm summary của nó.
- Count cả usage/latency của summarization. Native usage không quan sát được thì ghi unavailable; không tính thành 0 hay so cost thiếu một arm.
- Báo cáo confidence intervals và breakdown từng task; với số runs này kết luận chỉ là thực nghiệm ban đầu, không phải chứng minh statistical non-inferiority.

## 7. Release gates đề xuất

1. `npm run check`, build, replay cũ và context/session scenarios mới đều pass; verifiers reference/unsafe validation pass sau setup đúng dependencies.
2. Config v1 cũ + context disabled không thay đổi policy decisions/gates/telemetry location. Có golden regression cho legacy fixture.
3. 100% deterministic known-sensitive-source/canary cases bị loại khỏi retrieval/injection và telemetry/report; không có known safety violation trong live variant runs.
4. Context override đúng precedence và không rò qua branch/workspace trong toàn bộ lifecycle matrix.
5. Injected content không vượt estimated-token budget và hard byte cap; CLI giải thích được nguồn được chọn/bỏ.
6. EXP-003 functional success point estimate không giảm quá 10 điểm phần trăm so với foundation; EXP-004 không giảm quá 10 điểm so với native. Phải công bố uncertainty, không gọi đây là chứng minh “không regression”.
7. Có ít nhất một lợi ích đo được, đăng ký trước confirmatory run: ví dụ giảm ≥15% median read/search calls trên retrieval tasks; structured compaction tăng ≥15 điểm retention score trên forced-compaction tasks. So hiệu quả riêng từng feature, không dùng một lợi ích để che regression của feature khác.
8. Nếu pilot cho thấy ceiling effect hoặc không có nhu cầu compaction, sửa thiết kế task trước confirmatory run thay vì đổi threshold sau khi xem kết quả.
9. Feature không đạt safety/correctness gate không phát hành để bật sử dụng; feature đúng nhưng chưa chứng minh lợi ích chỉ được giữ opt-in/experimental. Chưa bật default chỉ vì tests pass.
10. Update installation/config docs, threat model, failure catalog, experiment reports và changelog. Pin supported Pi version/range theo compatibility test, không tiếp tục dựa vào `*` mà không kiểm tra.

Các con số ở gate 6–7 là **đề xuất để chốt**, không phải kết quả hay cam kết chắc chắn đạt được.

## 8. Rủi ro và cách thu nhỏ

| Rủi ro | Cách xử lý |
|---|---|
| Retrieval mở đường đọc secret ngoài tool policy | Reader boundary riêng, allowlist, canonical path checks, exclusions, canary cases; không đổi guardrail thành tuyên bố sandbox. |
| Inject thêm gây context pollution/cache churn | Stable ordering, không timestamps trong payload, dedupe/hash, no-match skip, đo cache usage và baseline không retrieval. |
| Summary bỏ mất decision hoặc “bịa đã test” | Structured contract, active-branch truth, giữ recent window native, hidden retention assertions, opt-in trước. |
| Repeated compaction mất thông tin tích lũy | Preserve previous summary, split-turn tests, retention scenario qua ít nhất hai lần compaction. |
| Session state lẫn nhánh | Restore từ branch, lifecycle matrix, clear cache trên tree/session transitions. |
| Pi API drift hoặc provider cũ không còn dùng được | Compatibility spike, public API only, model/config là input benchmark; preflight fail sớm, không tự fallback model giữa arms. |
| Harness không đủ khó | Expanded NestJS fixture, multi-turn tasks, separate pilot, verifier mutation/reference checks. |
| Phạm vi phình thành memory/RAG platform | Local lexical retrieval, no new packages/services, không persistent content index, không new runtime/profile. |

## 9. Việc nên bắt đầu ngay khi duyệt plan

- [ ] Chốt v0.2 MVP/full-scope và release criteria bên trên.
- [ ] Tạo branch P2-01; document supported Pi APIs và contract schema context/session entries.
- [ ] Bổ sung hướng dẫn setup fixture (`npm ci --prefix evals/fixtures/nestjs-sample`) và dependency preflight; chạy lại `bench validate`.
- [ ] Thống nhất project loader/profile semantics, legacy config regression và cache lifecycle.
- [ ] Viết manifest EXP-003 + thiết kế multi-turn harness EXP-004 trước khi tuning retrieval/summary.

## Tài liệu tham chiếu

- [Roadmap tiếng Việt](../../PROJECT_OVERVIEW_vn.md)
- [Configuration contract](../architecture/configuration.md)
- [Threat model](../architecture/threat-model.md)
- [EXP-002 và EXP-002b](../experiments/EXP-002-live-agent-benchmark.md)
- [Failure catalog](../failure-catalog/README.md)
- [Evaluation guide](../../evals/README.md)

Pi API đối chiếu từ documentation cài trên máy: `docs/extensions.md`, `docs/compaction.md`, `docs/session-format.md`, `docs/sessions.md`; examples `custom-compaction.ts`, `trigger-compact.ts`, `prompt-customizer.ts`; declarations Pi 1.4.0 tại dependency của repository. Cần xác nhận lại against version được pin khi triển khai.
