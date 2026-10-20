## 2026-10-20 · FOLLOW-1363 — quiz-accuracy report (Faza Q package Q8)

Built: pure `lib/quiz-accuracy.ts` (`buildQuizAccuracyReport`), `readQuizAccuracyData` in
`lib/quiz-runs.ts`, `GET /api/admin/tenants/quiz-accuracy`, staff tab
`/admin/tenants/[id]/quiz-accuracy`, monthly `cron/quiz-accuracy-watch`. First package whose SQL ran
on a real Postgres (PGlite + H002).

Risks weighed: the PREREG fixes ONE analysis on n = 400, so the headline is the FIRST 400 decided
rows by `shown_at` (later rows cannot flip a verdict) and the futility looks are the chronological
prefixes 130 / 200 (stateless, identical whenever the tab is opened). Per-class claims need at least
100 true labels, so the secondary metrics run over ALL decided rows instead. A language or date
filter changes the sample, so `verdict_binding` goes false rather than printing a PASS for a subset.
Response rate uses decided / (completed - neutral): neutral leaves are never asked to confirm, so
counting them would deflate the rate. `quiz_runs` has no staff/ops marker: only the tenant-level
exclusion exists, stated in the docs and the report, not faked.

Guardrail I'd add: a Rule-I friendly habit for pure-lib packages - keep constants and helper types
un-exported unless a non-test file imports them (the gate counts test-only importers as zero); and
when a statistic has a threshold, derive the test boundary from the formula (n = 130 -> 110, n = 200
-> 171), never from a remembered number - my first guess (113) was wrong.

### Opus review follow-up (C1-C5)

Ordering a "first N" sample by the time a row was SHOWN is wrong when the unit is a decision: a run
shown earlier but decided later displaces rows already in the sample. Order by the terminal
transition (`updated_at`, frozen by the upsert's WHERE) and make the window cut in SQL with a
(updated_at, id) tuple compare, not in JS on millisecond-rounded timestamps. A validity flag
(response rate, subset filter) must change the verdict BADGE, not sit in a side panel: a green PASS
next to a red footnote is how a void claim gets quoted. Guardrail: any "verdict" field a UI renders
needs a test that the badge text changes when each validity flag flips.
