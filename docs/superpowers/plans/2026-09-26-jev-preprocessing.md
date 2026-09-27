# Jev preprocessing implementation

User approved implementing the discussed pipeline, with Sol coding and Luna doing simple investigation/checks. User explicitly approved using the current `b/note-design` checkout (the default b/dev is occupied elsewhere). No commit, push, branch switch, or instruction-file edits are needed.

## Requirements

Preserve deterministic duplicate removal, then optionally use TypeSafe Jev through OpenRouter to classify semantic duplication versus additional information, importance, content role, and topic boundaries before the existing text summarizer. No raw capture/audio leaves the device. Preserve the existing remote consent gate. Add a clearly described optional setting, default off. Keep existing personal OpenRouter and operator-service paths functional. Operator keys remain server-side.

Jev uses POST https://openrouter.ai/api/alpha/decisions with model `typesafe/jev-1.13`, `state`, `questions`, and provider preferences. Choice returns choice/probabilities/confidence, Score returns score/probabilities/confidence, Noul returns noul. Usage fields are input_tokens/output_tokens/cost. Source: https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request . Preserve no-fallback/ZDR/data-collection-deny routing; never relax privacy settings on errors.

Use bounded local context, preserving chronological order, epochs and capture gaps. Never compare all pairs in the lecture. Ask narrow questions about duplicate/additional/correction/unrelated/uncertain relationship, content role, importance, and topic transition. Only confidently redundant or confidently non-learning chatter may be omitted from summary input. Low recognition confidence, uncertain answers, conditions, exceptions, corrections, formulas, examples and new information remain. Importance alone never deletes evidence. Retained evidence gets importance guidance; topic boundaries influence raw-evidence chunking but never interfere with synthesis convergence. Prevent excessive tiny summary requests.

Keep source evidence in session memory, and preserve selection reasons and duplicate target IDs/time references in preprocessing metadata. No fabricated citations. Distinguish deliberate filtering from uncited evidence. Reuse existing encrypted archive selection metadata where possible. Do not store plaintext evidence/notes on disk or log provider response bodies. Failure/cancellation stops visibly, with original session evidence intact and no automatic provider fallback. Account usage includes Jev calls; operator path retains authentication, strict validation, budget reservations, idempotency and no plaintext persistence.

## Task 1: implementation (Sol)

Implement minimal shared Jev question/result policy and call support, pipeline integration, settings/options wiring, operator route as needed, and meaningful synthetic tests. Reuse native fetch and existing patterns, add no dependencies. Test enabled/disabled/consent gates; duplication versus conditions/corrections; malformed/low-confidence judgments; gaps/epochs; bounded payloads; topic chunk budget; provenance; abort/error; usage and service quota/privacy. Update a feature usage document if useful (not AGENTS/memory/skill files).

## Task 2: review and verification

Controller checks API contract and complete diff; independent Sol review checks correctness/privacy and regressions. Luna runs simple configuration/static checks as needed. Fix findings through implementing Sol. Run node --test lib/*.test.js and server tests, plus relevant changed-file syntax and git diff --check. Real paid inference only if an already configured authorized key is available without exposing credentials; otherwise report mock-vs-live limits explicitly.

## Progress

- Preflight: current checkout has only two unrelated untracked vision design/plan docs; leave them untouched.
- Baseline: node --test lib/*.test.js passed 98 tests.
- Interface check: pipeline and clients share summary adapter; new decisions method must be wired through both adapters and offscreen settings, while service evidence validation must allow only explicitly validated Jev hints.
- Interface check: filtering changes coverage; deliberate exclusions must remain outside summarizer coverage denominator but remain in evidenceRefs/preprocessing.
- Interface check: semantic boundary fields apply to raw chunks only, not synthesis nodes.
- Task 1 implemented and covered by synthetic Jev, summary, archive metadata, client, and operator-service tests. Focused Jev/summary/server suite: 46 passed. See `docs/jev-preprocessing.md` for usage and limits.
- Final controller verification: `node --test lib/*.test.js server/index.test.js` passed 120/120 on 2026-09-27; `git diff --check` passed.
- Live synthetic verification: OpenRouter accepted pinned TypeSafe + ZDR + no-fallback requests. The actual Jev client retained a Korean condition and correction and filtered a paraphrased duplicate. No real lecture data was sent. Two synthetic calls cost USD 0.00013503 total. This is a connectivity/small behavior check, not a Korean lecture accuracy benchmark.
