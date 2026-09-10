# AGENTS.md

Rules for Codex, Claude Code, and Antigravity.

## 1. Project & Form Factor

- Target: Chrome Extension (Manifest V3), Vanilla JavaScript (ES2022+).
- Update this file first if form factor changes to Electron, desktop, or web app.
- No build steps or bundlers.
- Code style references: Inspect `lib/ai.js` and `lib/mergeLines.js`.

## 2. Invariants (Legal & Architecture)

- Memory only: Process screen captures and audio strictly in memory. Never send raw inputs externally.
- No auto cloud fallback: If local processing fails, halt and ask. Do not route data to external AI.
- Storage limit: Never store transcripts, images, or notes in `chrome.storage` or files. Settings only (`lib/settings.js`).
- Respect protections: Stop immediately if DRM or capture blockers are present. Never bypass them.
- Non-substitutive: Output structured summaries, concepts, and questions only. Never recreate verbatim lecture text.
- Service worker: `background.js` terminates when idle. Never keep persistent state in global memory.

## 3. Git & Branching

- Branch format: `<initial>/<agent>/<task-slug>`
- Identify user initial via `git config user.name`, `user.email`, or GitHub user:
  - `coconutdoyou` (Kiwook) -> `w`
  - `qnwlghks` (Jihwan) -> `b`
  - Fallback: ask user if neither matches.
- Examples: `w/codex/landing-page`, `b/claude/auth-fix`
- Use Conventional Commits (`feat:`, `fix:`).

## 4. Agent Rules & Skills

- Ponytail: Follow lazy senior dev mode (`.agents/rules/ponytail.md`, `.agents/skills/ponytail`). Prefer YAGNI, standard platform features, and minimal diffs.
- UI/UX Pro Max: Follow UI/UX design intelligence (`.agents/skills/ui-ux-pro-max`).
- Archify: Create and render architecture, workflow, sequence, data-flow, and lifecycle diagrams (`.agents/skills/archify`).

## 5. Verification

- Run tests before finishing: `node --test lib/*.test.js`
