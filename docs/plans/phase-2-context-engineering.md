# Phase 2 — Context Engineering (v0.2)

**Trạng thái:** Đã được maintainer chấp nhận (2026-11-03) làm design change cho Phase 2, scope v0.2 alpha: P2-01 → P2-04 + P2-06. P2-05 (structured compaction) vẫn là tùy chọn và cần quyết định riêng trước khi làm. Các thông số và ngưỡng trong tài liệu là điểm khởi đầu, chưa được đo.

**Baseline repository:** `a00354e` — các package phát hành ở v0.1.3 (đã có `/lawb` feature controls từ v0.1.2).

**Cập nhật gần nhất:** bỏ kiểm định benchmark live khỏi Phase 2 theo quyết định của maintainer (chưa muốn làm). Hệ quả: mọi tính năng context là **opt-in/experimental**, không bật mặc định và không tuyên bố hiệu quả; xem mục 3 và 7.

**Phạm vi:** Pi + NestJS; không thay runtime, không thêm technology profile.

## 1. Kết luận

Phase 1 đã có nền tảng đủ để bắt đầu Phase 2: config, policy, telemetry, CLI gates, replay eval và live benchmark. Bước tiếp theo nên làm agent **đọc đúng kiến thức của project, đưa vừa đủ vào context và tiếp tục đúng sau compaction/resume** — không xây thêm agent framework.

Ưu tiên triển khai:

1. Chốt config/session lifecycle, mở rộng cơ chế `/lawb` hiện có thay vì dựng hệ override thứ hai.
2. Retrieval cục bộ có policy boundary.
3. Dynamic injection có budget và không lặp.
4. Structured compaction (tùy chọn, làm cuối, chỉ ở mức experimental).
5. Dogfood thủ công và tài liệu, kèm smoke test đóng gói.

**Không có benchmark live trong Phase 2.** Vì vậy không có bằng chứng đo được rằng context engineering cải thiện kết quả. Phase 2 chỉ chứng minh được tính **đúng đắn và an toàn** bằng test và scenario deterministic; "có giúp ích không" được ghi rõ là chưa kiểm chứng.

## 2. Những gì đã xác minh

| Hạng mục | Hiện trạng / bằng chứng |
|---|---|
| Config | `core/src/config.ts` merge object đệ quy, replace array/scalar, reject unknown key. `resolveConfig()` nhận nhiều layer nhưng runtime/CLI đọc project file trực tiếp trên base; chưa tự áp dụng profile từ tên trong file. |
| Profile | `core/src/profiles.ts` chỉ có base và NestJS. `lawb init` materialize config đã resolve nên cách dùng thông thường vẫn nhận NestJS gates. |
| Runtime | `pi-extension/src/index.ts` đăng ký `tool_call`, `tool_execution_start/end`; chưa có `context`/compaction hooks. Config cache bằng `Map<cwd, Promise<LoadedConfig>>`, được xóa khi session chuyển. |
| Session override | **Đã có từ v0.1.2** cho 4 switch (`featureCatalog` trong `core/src/features.ts`): `pi-extension/src/feature-controls.ts` lưu bằng `appendEntry`, restore từ `getBranch()` ở `session_start`/`session_tree`, dọn ở `session_shutdown`, chỉ đổi khi agent idle, không có tool cho model. Context override phải đi qua cơ chế này. |
| Telemetry | JSONL chứa redacted args và thời gian tool, không ghi tool results; chưa có session correlation, context budget hoặc compaction metrics. |
| Quality gates | Đã có `lawb gates`; đoạn “nothing runs it yet” trong `evals/README.md` đã lỗi thời. |
| Replay / checks | `npm run check` và `npm run eval` là baseline. Con số cụ thể phải chạy lại ở đầu P2-01, không trích số cũ. Replay là fixture coverage, không phải bảo đảm mọi hành vi an toàn. |
| Packaging | v0.1.3 sửa lỗi `/lawb` hỏng khi cài từ npm: `@earendil-works/pi-tui` được import lúc runtime nhưng chỉ là peer dependency. Unit test trong repo không bắt được lỗi này; chỉ cài tarball vào thư mục sạch mới bắt được. |
| Pi API | Đã đối chiếu declarations Pi 1.4.0: có hooks `context`, `before_agent_start`, `session_before_compact`, `getContextUsage()`, `compact()`, `appendEntry()`; root export có `generateSummary`, `generateSummaryWithUsage`, `findCutPoint`, `estimateTokens`, `shouldCompact`. Peer/dev dependency đã là `^1.4.0`. |
| Live benchmark | EXP-002/002b là bằng chứng cũ (ceiling effect, T10 0/5). **Không chạy lại và không mở rộng trong Phase 2.** Harness `evals/src/bench` giữ nguyên, không sửa. |

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
- **Benchmark live, fixture NestJS mở rộng, harness multi-turn, EXP-003/EXP-004 và verifier preflight:** hoãn, chưa lên lịch. Không dùng kết quả cũ để tuyên bố lợi ích của context features.

**Project knowledge ở đây là file có sẵn trong repository**, không phải tri thức agent tự ghi nhớ từ các phiên trước.

## 4. Thiết kế đề xuất

### 4.1. Giữ core nhỏ, adapter Pi mỏng

Không thêm package ở bước đầu. Branch-scoped override **không** có `session.ts` mới: thêm nhóm context vào `core/src/features.ts` và `pi-extension/src/feature-controls.ts`. Tách logic trong các package hiện tại:

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
- Session override v0.2 mở rộng `FeatureStates`/`featureCatalog` hiện có (ví dụ switch `contextInjection`, `structuredCompaction`); entry `lawb-features` được tăng version có migration rõ ràng, entry v1 cũ vẫn đọc được. Không cung cấp shortcut để giảm policy bảo vệ hoặc đổi telemetry destination.
- Override chỉ do thao tác explicit của người dùng/flags được validate; không có tool cho model tự sửa override.
- Cập nhật config theo snapshot ở ranh giới user task. Tool calls đang chạy dùng snapshot nhất quán; `/reload` và session replacement xóa cache cũ (đã có từ v0.1.2, giữ nguyên).
- Invalid project config tiếp tục fail closed tại tool policy boundary; retrieval lỗi thì bỏ phần context bổ sung và báo trạng thái, không fallback sang reader không được bảo vệ.

Thông số khởi điểm, chưa được tuning hay đo thực nghiệm (không có benchmark trong Phase 2):

| Tham số | Giá trị đề xuất |
|---|---:|
| Tổng injected context mỗi request | tối đa khoảng 4.000 estimated tokens, kèm hard byte cap |
| Retrieval | tối đa 5 chunks, mỗi chunk tối đa khoảng 800 estimated tokens |
| File đọc để retrieval | tối đa 256 KiB/file; giới hạn số file và tổng bytes mỗi lượt |
| Sources mặc định khi bật context | docs Markdown trong workspace và metadata project được allowlist; không auto-scan source code |
| Compaction strategy | `native` mặc định; `structured` opt-in |

Chốt tên key và cross-field validation trong PR đầu tiên, tránh hai hệ setting cùng sở hữu reserve/keepRecent của Pi. Vì không đo được, giữ giá trị bảo thủ và để người dùng chỉnh qua config.

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
- CLI đề xuất: `lawb context inspect --query "..."` hiển thị source, range, score, estimate và lý do bỏ qua; không dump snippet/raw query vào telemetry. Trong Pi, hiển thị cùng metadata và trạng thái budget qua `/lawb` (một mục xem trạng thái), không thêm slash command thứ hai trừ khi menu hiện có không đủ.

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
- Tái dùng `feature-controls.ts` (entry `lawb-features`, restore từ `getBranch()`, newest-entry-wins, cwd khớp mới áp dụng, compensation khi ghi lỗi). Không lưu thêm transcript hay tool output.
- `/new` reset override; `/resume` restore phiên đích; `/fork` kế thừa state tại fork point; `/tree` reconstruct tại leaf mới; `/reload` restore cùng branch. Phần lớn đã có test từ v0.1.2; bổ sung test cho các key context mới.
- Không kế thừa cache/override sang workspace khác. Cleanup pending calls và state cũ ở shutdown.
- Entry hỏng/khác version: bỏ context override, về project context config an toàn và báo warning; tuyệt đối không làm giảm policy.
- Thay đổi chỉ qua menu `/lawb` khi agent idle; không tạo thêm session picker hay lệnh riêng.

### 4.6. Token budget và compaction

Phân biệt hai phép đo: **budget phần injected context** và **context tổng của model**. Ước lượng token không phải billing, cũng không bảo đảm request sẽ không overflow.

- Dùng `ctx.getContextUsage()` và context window của model; tokens `null`/usage chưa có phải là unknown, không coi là 0.
- Budget packing dùng estimator nhất quán + hard UTF-8 byte cap. Chừa safety margin; model switch phải tính lại budget.
- Structured compaction **không có bằng chứng lợi ích** vì không có benchmark; chỉ phát hành như experimental opt-in, hoặc hoãn hẳn nếu thời gian hạn chế.
- v0.2 đầu tiên cảnh báo áp lực context, dựa vào auto-compaction native của Pi thay vì thêm scheduler cạnh tranh.
- Structured strategy tích hợp `session_before_compact`, dùng preparation/cut point native. Giữ `firstKeptEntryId`, recent messages và pairing tool call/result.
- Summary contract: goal, explicit constraints, decisions, completed/in-progress/blocked, next steps, source/file references; không ghi “tests passed” nếu chỉ có kế hoạch chạy tests.
- Preserve previous summary và split-turn prefix; summary là trạng thái phiên, không phải nơi thay policy/config. Policy enforcement luôn nằm ngoài LLM context.
- Ưu tiên helper compaction native để Pi tiếp tục quản lý model/auth/retry/usage; không thêm Anthropic SDK hay provider client riêng vào Workbench. Đã xác minh `generateSummary`/`generateSummaryWithUsage`/`findCutPoint` được export ở Pi 1.4.0; P2-05 chỉ cần pin range và có test tương thích.
- Summary rỗng, malformed, bị cắt, lỗi model hoặc abort: không commit summary lỗi. Non-abort có thể fallback native một lần nếu còn khả năng; abort phải dừng, không âm thầm tạo lượt model khác.
- Không chặn/cancel overflow compaction chỉ vì context feature đang lỗi. Không gọi `compact()` đệ quy từ chính before-compact handler.
- Không log summary/tool results. Chỉ ghi trigger, strategy, duration, estimates, usage có sẵn, outcome và fallback reason enum.

## 5. Kế hoạch triển khai theo PR

Ước lượng cho một người quen TypeScript/Pi; chưa tính thời gian chờ review.

| PR | Nội dung | Điều kiện xong | Ước lượng |
|---|---|---|---:|
| P2-01 | Context config contract; shared profile-aware loader; pin/test Pi compatibility; sửa docs lệch; packaging smoke test | Config cũ chạy nguyên nghĩa; profile + project + context override precedence có tests; script cài tarball vào thư mục sạch và chạy `/lawb` handler | 2 ngày |
| P2-02 | Secure local retrieval + CLI inspect | Deterministic ranking; citations đúng; protected/outside/symlink/junction/artifact sources không xuất hiện; size/scan limits và cancellation có tests/scenarios | 2–3 ngày |
| P2-03 | Budget + dynamic injection | Feature opt-in; không inject lặp qua nhiều turn; source đổi được refresh; no-match/unknown-usage/model-switch hoạt động; không đụng context người khác | 2–3 ngày |
| P2-04 | Context switches trong `/lawb` + lifecycle | New/resume/fork/tree/reload/cross-workspace có test cho switch mới; không sửa policy; unknown entry version xử lý an toàn | 1–2 ngày |
| P2-05 (tùy chọn) | Structured compaction + metadata telemetry | Native fallback; previous summary/split turn/cancel/length/error được kiểm thử; không phá tool pairing; telemetry không có content/secrets | 2–3 ngày |
| P2-06 | Dogfood so sánh nhẹ bật/tắt context (mục 6.3), docs, changelog, threat model | Có bảng chi phí quan sát được theo 6.3; docs nói rõ feature experimental, số liệu chỉ là quan sát nhỏ, không phải benchmark | 1–2 ngày |

**Tổng:** khoảng 8–12 ngày công không tính P2-05, 10–15 ngày nếu có. **Scope đề xuất cho v0.2 alpha: P2-01 → P2-04 + P2-06**; P2-05 chỉ làm nếu muốn và vẫn experimental.

Dependency: `P2-01 → P2-02 → P2-03 → P2-04 → (P2-05) → P2-06`.

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

Thêm nhóm `PKG-`: cài tarball `npm pack` của core/pi-extension/cli vào thư mục sạch (không dùng node_modules của repo) và chạy command/handler thật bằng loader của Pi. Nhóm này tồn tại vì lỗi v0.1.3 chỉ lộ khi cài từ npm.

### 6.2. Live benchmark — hoãn

EXP-003 (retrieval/injection) và EXP-004 (compaction/resume), fixture NestJS mở rộng, harness multi-turn và `bench validate` **không thuộc Phase 2**. Nếu sau này muốn tuyên bố lợi ích hoặc bật mặc định, cần mở lại thành design change riêng, với pilot, tiêu chí đóng băng trước và báo cáo uncertainty. Đến lúc đó: mọi context feature giữ opt-in.

### 6.3. Dogfood đo chi phí (không phải benchmark)

Mục đích: biết context features làm **tăng hay giảm** token, tiền và thời gian trên công việc thật, để quyết định có nên giữ chúng. Không dùng để tuyên bố hiệu quả.

- **Cách làm:** chọn 5–8 task thật nhỏ trong repo này hoặc repo NestJS của maintainer. Mỗi task chạy hai lần bằng Pi bình thường, một lần context tắt và một lần bật, cùng model và thinking level. Đổi thứ tự bật/tắt giữa các task để tránh thiên lệch do cache nóng. Không cần fixture mới, harness mới hay hidden verifier; maintainer tự xét kết quả đúng/sai.
- **Dữ liệu lấy từ telemetry và usage của Pi:** injected tokens ước tính, input/output token, `cacheRead`/`cacheWrite` khi provider báo, số tool call (read/search), thời gian từng lượt, và thời gian bước retrieval. Với compaction (nếu có P2-05) ghi thêm usage và thời gian của lượt tóm tắt. Usage không có thì ghi `unavailable`, không tính là 0.
- **Quy tắc ghi nhận:** lưu model, Pi version, commit, config và switches vào một bảng trong `docs/experiments/` (tên đề xuất `DOGFOOD-001`). Chạy lỗi thì ghi lại, không loại bỏ lặng lẽ. Không đưa nội dung prompt, snippet hay kết quả tool vào báo cáo.
- **Cách diễn giải:** cỡ mẫu nhỏ nên chỉ báo cáo số liệu thô và nhận xét định tính (ví dụ "task X tốn thêm ~N token, giảm M tool call"). Không tính ý nghĩa thống kê, không so sánh tiền khi chưa có giá model và cache, không suy ra kết luận chung.
- **Dùng kết quả để làm gì:** nếu chi phí tăng rõ mà không thấy lợi ích, giữ feature ở trạng thái experimental hoặc hoãn (đặc biệt P2-05). Quyết định bật mặc định vẫn cần design change riêng.

## 7. Release gates đề xuất

1. `npm run check`, build, replay cũ và context/session scenarios mới đều pass.
2. Config v1 cũ + context disabled không thay đổi policy decisions/gates/telemetry location. Có golden regression cho legacy fixture.
3. 100% deterministic known-sensitive-source/canary cases bị loại khỏi retrieval/injection và telemetry/report.
4. Context override đúng precedence và không rò qua branch/workspace trong toàn bộ lifecycle matrix.
5. Injected content không vượt estimated-token budget và hard byte cap; CLI giải thích được nguồn được chọn/bỏ.
6. Smoke test đóng gói (`PKG-`) pass: cài từ tarball sạch, mọi import runtime nằm trong `dependencies`.
7. **Không bật mặc định.** Mọi context feature mặc định tắt và được gọi là experimental trong docs/changelog; không nêu lợi ích hiệu năng hay chất lượng vì chưa đo.
8. Có báo cáo `DOGFOOD-001` theo mục 6.3 (chi phí token/thời gian quan sát được, kể cả khi context làm tăng chi phí).
9. Update installation/config docs, threat model, failure catalog và changelog. Pin supported Pi range theo compatibility test.

## 8. Rủi ro và cách thu nhỏ

| Rủi ro | Cách xử lý |
|---|---|
| Retrieval mở đường đọc secret ngoài tool policy | Reader boundary riêng, allowlist, canonical path checks, exclusions, canary cases; không đổi guardrail thành tuyên bố sandbox. |
| Inject thêm gây context pollution/cache churn | Stable ordering, không timestamps trong payload, dedupe/hash, no-match skip, đo cache usage và baseline không retrieval. |
| Summary bỏ mất decision hoặc “bịa đã test” | Structured contract, active-branch truth, giữ recent window native, hidden retention assertions, opt-in trước. |
| Repeated compaction mất thông tin tích lũy | Preserve previous summary, split-turn tests, retention scenario qua ít nhất hai lần compaction. |
| Session state lẫn nhánh | Restore từ branch, lifecycle matrix, clear cache trên tree/session transitions. |
| Pi API drift | Chỉ dùng public API, pin range `^1.4.0`, compatibility test và `PKG-` smoke test. |
| Không có bằng chứng lợi ích / chi phí tăng | Opt-in, mặc định tắt, ghi rõ "chưa đo"; dogfood chi phí theo 6.3; hoãn compaction nếu chi phí tăng mà không thấy lợi ích. |
| Lỗi chỉ lộ khi cài từ npm | `PKG-` smoke test trong CI; mọi import runtime phải là dependency. |
| Phạm vi phình thành memory/RAG platform | Local lexical retrieval, no new packages/services, không persistent content index, không new runtime/profile. |

## 9. Việc nên bắt đầu ngay khi duyệt plan

- [ ] Chốt scope v0.2 alpha (P2-01..P2-04 + P2-06) và quyết định có làm P2-05 không.
- [ ] Tạo branch P2-01; document supported Pi APIs và contract schema context/session entries.
- [ ] Chạy lại `npm run check` và `npm run eval`, ghi số liệu hiện tại vào PR P2-01.
- [ ] Thống nhất project loader/profile semantics, legacy config regression và cách mở rộng `featureCatalog`.
- [ ] Viết script smoke test đóng gói (`PKG-`).
- [ ] Chọn danh sách task dogfood (6.3) và chốt các trường telemetry cần có (injected tokens, thời gian retrieval) ngay từ P2-03, để P2-06 không phải thêm instrumentation muộn.

## Tài liệu tham chiếu

- [Roadmap tiếng Việt](../../PROJECT_OVERVIEW_vn.md)
- [Configuration contract](../architecture/configuration.md)
- [Threat model](../architecture/threat-model.md)
- [EXP-002 và EXP-002b](../experiments/EXP-002-live-agent-benchmark.md) (bằng chứng cũ, không mở rộng trong Phase 2)
- [Failure catalog](../failure-catalog/README.md)
- [Evaluation guide](../../evals/README.md)

Pi API đối chiếu từ documentation cài trên máy: `docs/extensions.md`, `docs/compaction.md`, `docs/session-format.md`, `docs/sessions.md`; examples `custom-compaction.ts`, `trigger-compact.ts`, `prompt-customizer.ts`; declarations Pi 1.4.0 tại dependency của repository. Cần xác nhận lại against version được pin khi triển khai.
