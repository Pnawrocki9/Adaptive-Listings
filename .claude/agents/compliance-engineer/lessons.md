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
