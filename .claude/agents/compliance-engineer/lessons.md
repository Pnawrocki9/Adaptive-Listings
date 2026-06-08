# Compliance Engineer — Lessons Learned

## 2026-06-08 / FOLLOW-218

**What I documented/implemented:** Added DPIA §13.3 disclosure for the `estalara_intent_*`
sessionStorage archetype/intent-probability cache introduced by FOLLOW-176 (PR #217). Updated ROPA
Activity 14, Privacy Notice Template §4 client-storage table, and all three document version
headers. DPIA → v2.3. ROPA → v2.1. Privacy Notice Template → v1.1.

**Where a disclosure could have drifted from shipped behavior:** The DPIA §13.3 asserts three
concrete behaviors: (1) the key is written only on consent granted, (2) the key is erased on
denial/withdrawal, (3) the maximum intra-tab lifetime is 30 minutes (`INTENT_STATE_STALE_MS`).
Before writing, I grep-verified all three against `packages/sdk/src/core/session.ts` (functions
`persistIntentState`, `rehydrateIntentState`, `eraseIntentState`) and the call sites in
`packages/sdk/src/index.ts` (lines 209, 260, 329, 455, 595). The constant
`INTENT_STATE_STALE_MS = 30 * 60 * 1000` is byte-for-byte verified at `session.ts:295`. The
sessionStorage API is verified at `session.ts:348` (`setItem`) and `session.ts:427` (`removeItem`).
No claim was made without a matching verified code symbol.

**A guardrail I would add:** Any PR that introduces a new client-side storage write (localStorage,
sessionStorage, IndexedDB, cookie) must include a checklist item in its PR description: (a) key name
exact string, (b) storage API, (c) consent gate code reference, (d) erasure code reference, (e) DPIA
section that will be updated or a FOLLOW stub if the doc update is deferred. This catches the
RETRO-032 pattern (storage added without disclosure) at PR review time rather than at retro time.

---

## 2026-06-08 / FOLLOW-230

**What I documented/implemented:** (a) Resolved ROPA Activity-14 number collision between FOLLOW-218
(intent-state cache, already merged as Activity 14) and FOLLOW-187 (CRM ingest, specced as Activity
14). Decision: keep Activity 14 for intent-state cache (already merged), assign Activity 15 to
FOLLOW-187. Updated FOLLOW-187 stub in `FOLLOW_UPS.md` and both QUEUE.md entries. ROPA → v2.2. (b)
Added 3 missing SDK storage keys to Privacy Notice §4: `estalara_variant:{sessionId}`
(sessionStorage, strictly-necessary), `__estalara_quiz_dismissed__` (localStorage,
strictly-necessary), `__estalara_micro_poll_dismissed__` (localStorage, strictly-necessary). Updated
§4 header from "all five" to "all eight". Grep-verified all 3 against shipped SDK source before
disclosure. (c) Created `scripts/check-privacy-notice-keys.sh` and wired into `ci.yml` as
`privacy-notice-keys-sync` job. (d) Added dual-store erasure model paragraph to DPIA §13.3
connecting client-cache erasure (`eraseIntentState` at `index.ts:209/260`) and server archetype
erasure (DSR cascade FOLLOW-039). DPIA → v2.4.

**Where a disclosure could have drifted from shipped behavior:** The `eraseMicroPollDismissal()`
function exists in `micro-poll.ts` with a docstring saying "Must be called on consent
denial/withdrawal" but grep shows it is NOT called from `index.ts`. I deliberately did NOT disclose
erasure-on-denial for `__estalara_micro_poll_dismissed__` because the code does not implement it.
The disclosure states "not erased on consent denial" — consistent with the actual code. The
docstring/code divergence is a separate P2 issue not owned by this ticket.

**A guardrail I would add:** Whenever a compliance doc PR adds a new ROPA Activity number, it should
grep for any backlog stubs that claim the same number and update them in the same PR. The collision
would have been caught at FOLLOW-218 merge time if the PR description had included a step: "grep
QUEUE.md and FOLLOW_UPS.md for 'Activity 14' and confirm no collision."
