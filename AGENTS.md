# AGENTS.md

Rules for Codex, Claude Code, and Antigravity.

지침파일은 명시적인 지시가 있을 때만 수정할것

## 1. Project & Form Factor

- Target: Chrome Extension (Manifest V3), Vanilla JavaScript (ES2022+), with a small Node.js service for operator-funded text summarization and encrypted archives.
- Update this file first if form factor changes to Electron, desktop, or web app.
- No build steps or bundlers.
- Code style references: Inspect `lib/ai.js` and `lib/mergeLines.js`.
- Read `memory.md` for cross-file couplings that the code does not reveal (e.g. the landing hero mockup mirrors `sidepanel.html`).

## 2. Invariants (Legal & Architecture)

- Memory only: Process screen captures and audio strictly in memory. Never send raw inputs externally.
- No auto cloud fallback: If local processing fails, halt and ask. Do not route data to external AI.
- Storage limit: Never store plaintext transcripts, images, or notes in `chrome.storage`, caches, or files. Settings only (`lib/settings.js`). User-requested archives are encrypted/decrypted on the device; only authenticated ciphertext may be stored by the service.
- Inference boundary: Operator API keys stay on the server. External text summarization requires explicit consent: HTTPS protects transport, but the service/model necessarily sees text transiently during inference. Never describe inference as end-to-end encrypted.
- Respect protections: Stop immediately if DRM or capture blockers are present. Never bypass them.
- Non-substitutive: Output structured summaries, concepts, and questions only. Never recreate verbatim lecture text.
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

## 5. Verification

- Run tests before finishing: `node --test lib/*.test.js`
