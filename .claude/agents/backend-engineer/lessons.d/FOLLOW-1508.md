- **2026-11-08 / FOLLOW-1508** · Ingest consent gate narrowed to consent only (ESC-093 (2)):
  `PROFILING_ALLOWED_CONSENT_STATES` is `{consented}`; a profiling event under `legitimate-interest`
  takes the existing `none` path (per-event `consent_not_granted`, counter, warn log, Sentry). Audit
  and operational classes unchanged. · Risks weighed: the shared ingest test fixtures were LI
  `page.view`, so suites asserting "accepted" or "sink called" went red and were re-pinned to
  `consented`; the e2e smoke fixture had 22 LI profiling rows against an `accepted: 50` pin (flipped
  those, kept the 2 LI `inquiry.started` rows as an end-to-end proof operational still passes).
  Control-plane readers do not filter on `consent_state` and the lift readers already join only
  consented `adaptation_decisions` sessions, so nothing they count moves; the browser SDK sends no
  profiling before the banner grant except on the `createShadowHost()` null path, which now loses
  its rows. · Guardrail I'd add: _when narrowing an allowed set, grep every fixture carrying the
  removed value and sort them into "goes through the gate" and "does not" before running anything;
  only the first set needs re-pinning_.
