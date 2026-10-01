# AGENTS.md

Rules for Codex, Claude Code, and Antigravity.

지침파일은 명시적인 지시가 있을 때만 수정할것

## 1. Project & Form Factor

- Target: Chrome Extension (Manifest V3), Vanilla JavaScript (ES2022+), with a small stateless Node.js service (container runtime) that proxies operator-funded model calls (summary, paid cloud recognition) and stores only ciphertext archives; accounts and usage metadata live in Supabase.
- Pipeline v2 plan and decisions: `docs/architecture-v2.md`.
- Update this file first if form factor changes to Electron, desktop, or web app.
- No build steps or bundlers.
- Code style references: Inspect `lib/ai.js` and `lib/mergeLines.js`.
- Read `memory.md` for cross-file couplings that the code does not reveal (e.g. the landing hero mockup mirrors `sidepanel.html`).

## 2. Invariants (Legal & Architecture)

- Raw media in memory only: Screen frames, tab audio and media segments fetched for background processing are processed in memory and released immediately. Never write raw media to disk, IndexedDB, Cache Storage, OPFS, downloads or the HTTP cache (fetch with `cache:"no-store"`), and never offer raw-media export.
- Free tier recognition is on-device: Free users' frames and audio never leave the device. Only refined text goes to the service for summarization, with consent and a monthly quota.
- Paid cloud recognition needs consent: Frames and audio chunks leave the device only when a paid user enabled cloud recognition and accepted the separate transfer consent. They travel through the operator service to zero-retention providers and are never persisted by the service. Mask known watermark regions (student IDs, names) before upload.
- Background processing needs usage consent: Two explicit consents (personal study use only; only content the user is authorized to access) before the first background job and again after each terms version change.
- No silent switching: Never switch recognition engines (cloud/local) or sources (background/real-time) without telling the user. Halt and ask.
- No auto cloud fallback: If local processing fails, halt and ask. Do not route data to external AI.
- Storage limit: Plaintext lecture content lives in memory only. Derived artifacts (transcripts, slide text, formula/figure crops, notes, checkpoints, content-free logs) may be persisted only AES-GCM encrypted on the device (`lib/package-store.js`). `chrome.storage` holds settings and consent records only (`lib/settings.js`). The service stores only authenticated ciphertext and content-free metadata (accounts, usage).
- Crops: Only figure, table or formula regions may be cropped and kept (encrypted). Never store whole slides.
- Inference boundary: Operator API keys stay on the server. External processing requires explicit consent: HTTPS protects transport, but the service/model necessarily sees the data transiently during inference. Never describe inference as end-to-end encrypted.
- Respect protections: Stop immediately if DRM/EME, encrypted streams (HLS `EXT-X-KEY`/`EXT-X-SESSION-KEY` other than NONE, DASH `ContentProtection`) or capture blockers are present. Never fetch key URIs, never bypass. Header rules may only reproduce the Referer of the page the user is viewing, scoped to the extension's own requests.
- Non-substitutive: Output structured summaries, concepts, and questions only. Never recreate verbatim lecture text.
- Content-free telemetry: Pipeline events, logs and server usage records never contain lecture content.
- Dev-only admin: `admin.html`/`admin.js` are never packaged (audited by `tools/package-cws.mjs`).
- Service worker: `background.js` terminates when idle. Never keep persistent state in global memory.

## 3. Git & Branching

- Default: all current changes belong on `<initial>/dev`, as explicitly requested by the user. Do not create a new branch per task or per agent.
- Identify user initial via `git config user.name`, `user.email`, or GitHub user:
  - `coconutdoyou` (Kiwook) -> `w`
  - `qnwlghks` (Jihwan) -> `b`
  - Fallback: ask user if neither matches.
- New branch only when the user asks, or when work must be isolated (risky refactor, parallel spike). Then use `<initial>/<task-slug>` (no agent segment) and delete it after merge.
- Never commit directly to `main`; merge via PR from `<initial>/dev`.
- Use Conventional Commits (`feat:`, `fix:`).

## 4. Agent Rules & Skills

- Ponytail: Follow lazy senior dev mode (`.agents/rules/ponytail.md`, `.agents/skills/ponytail`). Prefer YAGNI, standard platform features, and minimal diffs.
- UI/UX Pro Max: Follow UI/UX design intelligence (`.agents/skills/ui-ux-pro-max`).
- Archify: Create and render architecture, workflow, sequence, data-flow, and lifecycle diagrams (`.agents/skills/archify`).
- QA Agent: `gemini-flash` (`.agents/agents/gemini-flash.md`) using Gemini 3.8 Flash, configured strictly for Antigravity CLI (`agy --agent gemini-flash`) for high-speed implementation, syntax checks, invariant audits, and QA test verification.
- Superpowers (`.agents/skills/`, obra/superpowers): `using-superpowers` governs skill invocation. Approved skills only: `brainstorming` (explore intent/requirements before creative work), `subagent-driven-development` (execute plan tasks via subagents), `systematic-debugging` (root-cause before fixes). Ignore other installed superpowers skills.

## 5. Verification

- Run tests before finishing: `node --test lib/*.test.js server/*.test.js tools/*.test.mjs` and `node tools/package-cws.mjs --dry-run --skip-tests` (same gate as CI).
