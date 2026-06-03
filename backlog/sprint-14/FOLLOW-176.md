# FOLLOW-176 — Persist resolved archetype/intent across listing navigations (cross-listing continuity)

**Sprint:** 14 **Agent:** sdk-engineer **Priority:** P1 **Estimated hours:** 5 **Status:** READY
**Source:** session investigation 2026-06-03 (Side-task #5) **Promoted:** 2026-06-03 (by human
request)

---

## Context

The SDK's resolved intent/archetype state (`currentIntentState` in `packages/sdk/src/index.ts`) is
held **in memory only** and recomputed from scratch via `initIntentState()` (BASE_PRIOR → neutral)
on **every page load**. Grep confirms `intent.ts` / `dqs.ts` contain no `localStorage`/
`sessionStorage`/cookie writes and there is no `estalara_intent`/`estalara_archetype` key anywhere
in `packages/sdk/src`.

**Consequence:** when a visitor opens a second listing, the SDK cold-starts the intent engine again
and must re-accumulate behavioral signals (or re-run the quiz) before the DOM can be adapted — so
the intended UX ("each subsequent listing is immediately adapted to the archetype already inferred
for this visitor") **does not happen today**. Only scaffolding persists: sessionId (sessionStorage),
consent (localStorage), xid (localStorage 90d), adapt variant (sessionStorage) — never the
archetype.

This is a real UX gap and feeds the data MOAT (more consistent adaptation → cleaner signal). It is
an **SDK-only** change; the server already derives the archetype per-request from the SDK-supplied
`archetype_hint`/`confidence`/`similarity`.

## Scope

### In scope

- Persist the resolved intent state (at minimum: archetype id, confidence, and the prior/signal
  accumulation needed to resume) to **`sessionStorage`**, keyed by the existing sessionId.
- Rehydrate it in `init()` **before** cold-start hinting, so the first adapt call on a subsequent
  listing in the same browsing session uses the already-inferred archetype.
- Gate persistence + rehydration on the same **consent** check that governs other SDK storage (no
  archetype written without the required consent).
- A staleness guard (e.g. ignore/refresh state older than a configurable window) and a
  schema/version tag so a format change can't deserialize stale shapes.
- `teardownDescriptionObservers`-style teardown / a clear path that wipes the stored state on
  consent withdrawal.

### Out of scope

- Cross-session continuity (localStorage + TTL across tab close / repeat visits) — note as a
  potential follow-up; sessionStorage covers the stated "subsequent listing" UX with a lower GDPR
  footprint.
- Any server-side per-visitor archetype cache.

## Acceptance criteria

- [ ] AC1: On intent-state change, the resolved archetype/intent is written to `sessionStorage`
      (keyed by sessionId), only when consent permits.
- [ ] AC2: `init()` rehydrates the persisted state before cold-start, so a subsequent listing
      navigation in the same tab applies the prior archetype's adaptation on the first adapt call
      (no re-accumulation required) — covered by a test/fixture.
- [ ] AC3: No archetype is persisted or rehydrated when consent is absent/withdrawn; withdrawal
      clears any stored state.
- [ ] AC4: A staleness/version guard prevents using expired or wrong-shape state.
- [ ] AC5: Bundle delta stays within the Tier 1+2 <40KB gzip budget; lint/typecheck/tests green;
      ≥80% coverage on new SDK code.

## Test plan

- Unit: persist→rehydrate round-trip; consent-off = no write/no read; stale/version-mismatch
  ignored.
- Integration (jsdom): simulate listing A (archetype inferred) → navigation → listing B reads the
  persisted archetype and adapts immediately.

## Definition of Done (universal)

- [ ] Branch `sdk-engineer/FOLLOW-176-<slug>`; conventional commits referencing [FOLLOW-176]
- [ ] PR with FOLLOW-176 in title; all ACs verified; CI green; coverage met
- [ ] `promoted_to_queue: true` synced in `backlog/FOLLOW_UPS.md`
