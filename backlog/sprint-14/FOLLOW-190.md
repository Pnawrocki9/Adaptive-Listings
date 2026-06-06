# FOLLOW-190 — Dwell-time confidence lift: accumulate temporal engagement as intent signal

**Sprint:** 14 **Agent:** sdk-engineer **Priority:** P2 **Estimated hours:** 4 **Status:** READY
**Source:** CEO session 2026-06-04 (signal enrichment gap) **Promoted:** 2026-06-04

---

## Context

The SDK's `registerFeedbackListener` in `packages/sdk/src/core/adapt.ts:259–278` already tracks
dwell time (≥30s + page hidden) and fires a server-side `converted: false` feedback ping. This is a
_reporting_ signal only — it is never fed back into the local Bayesian intent engine.

`currentIntentState.confidence` in `packages/sdk/src/index.ts:178` does not grow based on how long a
user spends on a listing. Every behavioral confidence increment today comes from discrete UI events
(`applyBehavioralSignal`, line 330) — scroll depth, chat questions, etc. Temporal engagement is a
strong implicit confirmation of archetype fit and is currently invisible to the classifier.

**Consequence:** a visitor who spends 3 minutes exploring a listing while engaging with the SDK gets
the same confidence score as one who bounced after 10 seconds. The intent engine is blind to one of
the strongest behavioral signals available.

## Design

Add a **`applyDwellSignal(state: IntentState, elapsed_ms: number): IntentState`** pure function in
`intent.ts` (alongside `applyBehavioralSignal`). It creates a dynamic likelihood object that
reinforces the currently leading archetype:

```ts
// Boost the top archetype proportional to log(elapsed_ms); all others stay at 1.0.
// DWELL_BASE_BOOST = 0.08 (tunable constant; ~half a behavioral signal at BEHAVIORAL_DAMPING=0.3)
const boost = 1 + DWELL_BASE_BOOST * Math.log2(elapsed_ms / DWELL_UNIT_MS);
const likelihood = Object.fromEntries(
  ARCHETYPE_NAMES.map((k) => [k, k === state.archetype ? boost : 1.0]),
) as ArchetypeProbabilities;
return applyLikelihood(state, likelihood, /* incrementSignalCount= */ false);
```

`incrementSignalCount` stays `false` — dwell is continuous, not discrete; mixing it into
`signal_count` would distort the `REFETCH_SIGNAL_INTERVAL` refetch heuristic.

Wire the thresholds in `index.ts` using an interval timer that fires at 30s, 90s, and 180s:

```ts
// After adapt response received and archetype != 'neutral':
const DWELL_THRESHOLDS_MS = [30_000, 90_000, 180_000];
const dwellTimer = setInterval(() => {
  const elapsed = Date.now() - adaptedAt;
  if (DWELL_THRESHOLDS_MS.some((t) => Math.abs(elapsed - t) < TICK_TOLERANCE_MS)) {
    currentIntentState = applyDwellSignal(currentIntentState, elapsed);
    onIntentUpdate(currentIntentState.archetype, currentIntentState.confidence);
    // Do NOT trigger a server refetch — dwell is a local confidence nudge only.
  }
}, 5_000);
// Clear on page unload / SDK teardown.
```

The server-side feedback ping in `registerFeedbackListener` is **unchanged** — this is an
independent, local-only confidence update.

## Scope

### In scope

- `applyDwellSignal` pure function in `intent.ts` (no side effects, testable in isolation).
- Interval-based threshold trigger in `index.ts`, gated on consent and `archetype !== 'neutral'`.
- Teardown: clear interval on `visibilitychange` (hidden) or SDK teardown; reset on archetype
  switch.
- DWELL_BASE_BOOST and DWELL_UNIT_MS as named constants (not magic numbers).

### Out of scope

- Sending any server-side signal on dwell confidence updates (the feedback ping in
  `registerFeedbackListener` remains the only server call).
- Cross-session persistence of accumulated dwell — FOLLOW-176 handles persistence; this ticket only
  ensures the in-session `currentIntentState` carries the updated confidence (FOLLOW-176 picks it up
  automatically via the shared state reference).
- Changing `REFETCH_SIGNAL_INTERVAL` logic (dwell does NOT increment `signal_count`).

## Acceptance criteria

- [ ] AC1: At 30s, 90s, and 180s of dwell on a listing (with archetype ≠ neutral and consent
      granted), `currentIntentState.confidence` is nudged upward via `applyDwellSignal`.
- [ ] AC2: Dwell signal only fires when consent permits behavioral tracking (same gate as other SDK
      storage and signals).
- [ ] AC3: `applyDwellSignal` does not increment `signal_count` — the refetch interval is unaffected
      by dwell ticks.
- [ ] AC4: When the archetype switches mid-session (due to quiz or other signals), the dwell timer
      resets — the boost then reinforces the new leading archetype, not the old one.
- [ ] AC5: No server-side fetch is triggered by dwell confidence updates.
- [ ] AC6: `applyDwellSignal` is a pure function (no DOM access, no globals) — fully unit-testable
      with `initIntentState()` as the fixture.
- [ ] AC7: FOLLOW-176 compatibility — the persisted intent state shape is unchanged; dwell updates
      land in `currentIntentState` and are carried by the existing persist path.
- [ ] AC8: Bundle delta stays within Tier 1+2 <40KB gzip budget; lint/typecheck/tests green; ≥80%
      coverage on new SDK code.

## Test plan

- Unit (`intent.ts`): `applyDwellSignal` at 30s/90s/180s → confidence increases; top archetype
  retained; signal_count unchanged; neutral archetype → no-op (or identity).
- Unit (`index.ts`): consent-off → no dwell tick fired; archetype switch → timer resets; teardown →
  interval cleared.
- Integration (jsdom): start timer → advance fake clock to 30s → assert
  `currentIntentState.confidence` is higher than the post-adapt baseline.

## Dependencies

- None blocking. FOLLOW-176 (archetype persistence) is recommended first (so dwell-boosted
  confidence also gets persisted), but not strictly required — this ticket is independent and
  forward-compatible with FOLLOW-176's persist format.

## Definition of Done (universal)

- [ ] Branch `sdk-engineer/FOLLOW-190-<slug>`; conventional commits referencing [FOLLOW-190]
- [ ] PR with FOLLOW-190 in title; all ACs verified; CI green; coverage met
