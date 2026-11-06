- **2026-11-06 / FOLLOW-1465** · Server-side consent only (ESC-091 C-1, record H-13):
  `assignHoldout` assigns an arm only for `consent_state === 'consented'` (now a required option,
  fail closed; the caller-sent `consent_mode_enabled` is accepted and ignored), so `/api/adapt`
  writes no decision row for any other caller, and the lift readers, which count only
  `adaptation_decisions` sessions, are consent-only by construction (pinned in
  `route-helpers.test.ts`). · Risks weighed: a gate in a shared pure function silently turned every
  test POST without `consent_state` into a neutral skip; suites that mocked `assignHoldout` stayed
  green, the rest went red, and a few would have gone vacuous (assertions of "nothing served" pass
  on a skip), so I re-pinned the request builders to a consenting caller and checked each "granted"
  fixture; the FOLLOW-819 harness's synthetic control arm POSTs with no consent and would have
  stopped logging its row, so it now sends `consented`; legacy localhost rows written before the
  gate are not filtered (no consent column on `adaptation_decisions`). · Guardrail I'd add: _when a
  gate moves into a shared function every route uses, list every direct-POST caller outside the SDK
  (harnesses, probes, scripts) and check what each sends, not only the unit suites_.
