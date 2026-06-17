# Status — 2026-06-17T18:00Z

_Rule I: a ticket is DONE only if its primary artifact has at least one non-test runtime caller._

## Active sprint: Sprint 17 (OPEN)

**Sprint 16 COMPLETE** — 16 tickets DONE
(FOLLOW-170/173/174/175/176/182/183/184/185/187/190/227/230/234/270/271). FOLLOW-191 remains
READY_FOR_REVIEW (ESC-020, Rafal deploy pending).

**Sprint 17 WAVE 1 COMPLETE (2026-06-12).** All 8 Wave 1 tickets DONE: FOLLOW-274 (PR #267),
FOLLOW-273 (PR #268), FOLLOW-272 (PR #275), FOLLOW-275 (PRs #270+#271), FOLLOW-276 (PR #272),
FOLLOW-277 (PR #276), FOLLOW-278 (PR #273), FOLLOW-279 (PR #274).

**Sprint 17 WAVE 2 COMPLETE (2026-06-12/13):**

- FOLLOW-266 Phases 1+2+3 ALL DONE (PRs #277/#278/#280). RETRO-067 pending spawn.
- FOLLOW-286 DONE (PR #279). RETRO-068 pending spawn.
- FOLLOW-287 DONE (PR #281, CB-2/DG-1 fixes).
- FOLLOW-288 DONE (PR #282, migration 0016 SELECT 1 no-op, intent_session_id removed from INSERT).
  All CI gates GREEN.

**Sprint 17 D-1 SEED + FOLLOW-302 DONE (2026-06-14):**

- FOLLOW-266 Phase 2 seed (migration 0030 — global-default intent_weight_configs row) DONE — PR
  #293, merge commit 6381499. Code-correct + idempotent (WHERE NOT EXISTS guard + 0029
  partial-unique index backstop). RETRO-076 complete.
- FOLLOW-302 (stale signal_weights→signal_likelihoods documentation on migration 0029:12 + schema
  docstring) DONE — folded into PR #293. Both sites corrected; verified in merge commit. CLOSED.
- RETRO-076 filed (RETRO-076 §OG-1): ARCHITECTURAL FACT — Postgres/Supabase migrations do NOT
  auto-apply in this repo. Only ClickHouse ci.yml auto-applies. Every Postgres seed/DDL carries a
  "merged does not equal live" gap until an operator runs db:migrate. FOLLOW-307 tracks the apply.
- FOLLOW-307 added (P1, devops-engineer): apply 0030 in prod/staging Supabase + decide standing
  apply mechanism. THE single remaining action to make D-1 fully-live-in-prod.

**Sprint 17 WAVE 3 + WAVE 4 COMPLETE (2026-06-13/14):**

- FOLLOW-267 DONE (PR #283).
- FOLLOW-294/Ticket-A DONE (PR #284, merge a14c907 — authenticated GET /api/intent/config +
  IntentWeightsSchema, cross-tenant enumeration closed).
- FOLLOW-268-write/Ticket-B DONE (PR #285, merge 2998a93 — POST/PUT admin write API).
- FOLLOW-297/Ticket-D DONE (PR #286, merge 8cdf94f — 111-assertion tracer test suite).
- FOLLOW-299 DONE (PR #287, merge c387103 — data_source enum widened to include 'error').
- FOLLOW-301 DONE (PR #289, merge a14c907 — one-active invariant + atomic swap + deterministic GET
  ORDER BY + real POST→GET round-trip). RETRO-073 complete.
- FOLLOW-268-sdk/Ticket-C DONE (PR #290, merge ea2089b — resolveIntentOverrides +
  fetchIntentWeights, ADR-0012 Ticket C). RETRO-074 complete.
- FOLLOW-305 DONE (PR #291, merge 3d9e8f0 — buildEndpoint helper, fixed double-/api prod 404 on 4
  endpoints). RETRO-075 complete. K.3.6 D-1 PRODUCTION-LIVE.

## K.3.6 D-1 HEADLINE — PRODUCTION-ACTING IN CODE; APPLY PENDING

**K.3.6 D-1 "immediate weights" is CODE-COMPLETE, PRODUCTION-WIRED, and seed MERGED as of
2026-06-14.** Code chain: #284 (auth+schema) → #285 (write API) → #286 (tests) → #287 (enum) → #289
(invariant) → #290 (SDK apply) → #291 (prod URL fix) → #293 (seed migration 0030). Producer →
snippet → SDK-fetch → apply chain is correct end-to-end.

**Remaining to fully-live-in-prod: FOLLOW-307 (P1, devops-engineer) — apply migration 0030 to prod
Supabase.** Postgres migrations do NOT auto-apply in this repo (RETRO-076 OG-1 architectural fact;
only ClickHouse ci.yml does). The seed SQL is correct and idempotent; it just needs an operator to
run db:migrate against prod DATABASE_URL_DIRECT. Once applied, GET /api/intent/config flips
data_source:'mock' → 'live' for override-less tenants. Then FOLLOW-293 live smoke can go green.

**IMPORTANT co-victim note (RETRO-074/075):** the same double-/api bug that blocked D-1 had ALSO
been silently breaking quiz-config delivery (FOLLOW-275) and the feedback/quiz-completion write
pings in production. All FOUR were fixed by PR #291 (buildEndpoint helper). This resolves a
partial-personalization risk for TICKET-PILOT-001.

## D-1 Remaining Tail (open items)

- **FOLLOW-307** (P1, devops-engineer) — THE key remaining action: apply migration 0030 in prod +
  staging Supabase; verify active global row exists; add data_source:'live' assertion to FOLLOW-293
  smoke; decide standing Postgres auto-apply-or-checklist mechanism. BACKLOG/READY.
- **FOLLOW-293** (P2, qa-engineer) — live-network smoke test. Gated on FOLLOW-307 (0030 must be
  applied before smoke can assert data_source:'live'). BLOCKED on FOLLOW-307.
- **FOLLOW-304** (P2, backend-engineer) — GET per-scope determinism (cross-scope starvation when ≥2
  active global rows; degrades safely). NON-BLOCKING. BACKLOG.
- **FOLLOW-306** (P3, sdk-engineer) — fetchDescription centralization via buildEndpoint +
  endpoint.test.ts. NOT prod-blocking. BACKLOG.
- **FOLLOW-266 Phase 2 seed** — DONE (PR #293, merge commit 6381499). Migration 0030 merged and
  code-correct. Operational apply pending (FOLLOW-307).
- **FOLLOW-302** — DONE (folded into PR #293). Both stale-doc sites corrected.
- **FOLLOW-269** (P2, backend-engineer) — frontend tracer UI (live monitor + history + weight
  editor + export dashboard). BLOCKED on FOLLOW-268-sdk (now DONE) — ready to plan.
- **Earlier open backlog:** FOLLOW-295/296/298/300/303 (P2/P3, all BACKLOG, non-blocking).
  FOLLOW-302 is now DONE (closed PR #293).

## RETRO TRACKING (completed retros)

| RETRO     | Source ticket                    | PR        | Status                                                               | Notes                                                                                                                                                                      |
| --------- | -------------------------------- | --------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RETRO-059 | FOLLOW-274                       | #267      | DONE                                                                 |                                                                                                                                                                            |
| RETRO-060 | FOLLOW-273                       | #268      | DONE                                                                 | Rule W promoted (ClickHouse ORDER BY key DDL)                                                                                                                              |
| RETRO-061 | (no body — DG-2 cited)           | —         | N/A                                                                  | Cited in test headers; no actual entry filed                                                                                                                               |
| RETRO-062 | FOLLOW-276                       | #272      | DONE (2026-06-17) — no FOLLOW filed (docs-only)                      |
| RETRO-063 | FOLLOW-278                       | #273      | DONE (2026-06-17) — no FOLLOW filed (docs+test, constraint accepted) |
| RETRO-064 | FOLLOW-266 Ph1                   | #277      | PENDING SPAWN                                                        |                                                                                                                                                                            |
| RETRO-065 | FOLLOW-266 Ph2                   | #278      | COMPLETE                                                             | 3 P1 defects found (CB-1/LG-1/LG-2) → FOLLOW-286                                                                                                                           |
| RETRO-066 | (ESC-021 sourced)                | —         | COMPLETE                                                             | ClickHouse MODIFY COLUMN on ORDER BY key → Rule W                                                                                                                          |
| RETRO-067 | FOLLOW-266 Ph3                   | #280      | PENDING SPAWN                                                        |                                                                                                                                                                            |
| RETRO-068 | FOLLOW-286                       | #279      | PENDING SPAWN                                                        |                                                                                                                                                                            |
| RETRO-069 | FOLLOW-287+288                   | #281+#282 | PENDING SPAWN                                                        |                                                                                                                                                                            |
| RETRO-070 | FOLLOW-267                       | #283      | COMPLETE                                                             | Rule K.2 amended; FOLLOW-298/299/300 filed                                                                                                                                 |
| RETRO-071 | FOLLOW-268-write                 | #285      | COMPLETE                                                             | FOLLOW-301/302 filed                                                                                                                                                       |
| RETRO-072 | FOLLOW-297                       | #286      | COMPLETE                                                             | FOLLOW-303 filed                                                                                                                                                           |
| RETRO-073 | FOLLOW-301                       | #289      | COMPLETE                                                             | FOLLOW-304 filed (P2 GET cross-scope determinism)                                                                                                                          |
| RETRO-074 | FOLLOW-268-sdk                   | #290      | COMPLETE                                                             | FOLLOW-305 filed (P1 double-/api blocker); Rule X count=1                                                                                                                  |
| RETRO-075 | FOLLOW-305                       | #291      | COMPLETE                                                             | FOLLOW-306 filed (P3 hygiene); Rule X PROMOTED (count=2)                                                                                                                   |
| RETRO-076 | FOLLOW-266 Ph2 seed + FOLLOW-302 | #293      | COMPLETE                                                             | FOLLOW-307 filed (P1 devops apply gate); OG-1 no-auto-Postgres-apply fact recorded; FOLLOW-302 CLOSED both sites; NO new Rule (OG-1 count=1, promote-on-2nd condition set) |

**Wave-2 retros still pending spawn:** RETRO-062/063/064/067/068/069.

**Rule X promoted** (CONVENTIONS_PATCH.md): every SDK→control-plane fetch site MUST use
buildEndpoint(decisionApiUrl, path) + a test asserting the resolved URL against the real production
snippet base (${CONTROL_PLANE_URL}/api). Promoted from RETRO-074/075 (count 2; threshold met).

## CI CHECK COUNTER (current sprint, per ticket)

| Ticket         | CI checks                                   | Fix iterations |
| -------------- | ------------------------------------------- | -------------- |
| FOLLOW-266 Ph3 | 2/5                                         | 1/3            |
| FOLLOW-287     | 2/5                                         | 2/3            |
| FOLLOW-288     | 1/5                                         | 0/3            |
| FOLLOW-301     | (per PR body — green first pass)            | 0/3            |
| FOLLOW-268-sdk | (per PR body — green)                       | 0/3            |
| FOLLOW-305     | (per PR body — 1383 vitest green, CI green) | 0/3            |

## Sprint 18+ Current State (2026-06-17)

**FOLLOW-324 DONE** (PR #308, merged 2026-06-15). SDK bundle: 52.61 KB -> 39.73 KB gzip. Companion
estalara-detect.iife.js = 12.43 KB. CI: all real gates GREEN (verified via gh pr view 308).

**FOLLOW-325 READY_FOR_REVIEW** (PR #315, 2026-06-17). buildSnippet() companion auto-include. PM
re-validated 2026-06-17T18:00Z. All real CI gates GREEN. Runtime wiring confirmed (DETECT_SERVE_URL
producer: packages/shared/src/domains.ts:73; non-test consumer: DetectionPreview.tsx:23,183). PR
comment posted. CI check counter: 1/5, fix iterations: 0/3. Awaiting human merge.

**FOLLOW-326 DONE** (PRs #309/#310/#311, all merged 2026-06-15). admin.estalara.com sign-in +
Supabase SSR auth flow. AC1-AC8 completed.

**FOLLOW-327 DONE** (PR #312, merged 2026-06-16). Single-tenant admin nav + canonical Weight Editor
defaults (DEFAULT_INTENT_WEIGHTS in @estalara/shared, "Reset to defaults" button).

**FOLLOW-328 DONE** (PR #313, merged 2026-06-16). ClickHouse Basic auth fix — include username in
Authorization header (Code 516 AUTHENTICATION_FAILED resolved). New shared clickhouse-http.ts.

**FOLLOW-330 DONE** (PR #314, merged 2026-06-16). Tracer history SSR window crash + CH cold-start
timeout fixed (timeout raised 8s→30s/45s, buildJsonlExportUrl uses relative URL).

**FOLLOW-293 DONE** (PR #307, merged 2026-06-15). K.3.6 D-1 live-network smoke. ESC-024 resolved by
Piotr. Smoke run 27555287447: AC-LN1/LN2/LN3 all GREEN.

**Pending retro spawns:** RETRO-062 (PR #272), RETRO-063 (PR #273), RETRO-064 (PR #277), RETRO-067
(PR #280), RETRO-068 (PR #279), RETRO for FOLLOW-324 (PR #308), RETRO for FOLLOW-326 (PRs
#309/#310/#311), RETRO for FOLLOW-327 (PR #312), RETRO for FOLLOW-328 (PR #313), RETRO for
FOLLOW-330 (PR #314).

## ESCALATION STATUS

ESC-020 OPEN (non-blocking) — Rafal prod deploy pending (CEO 2026-06-10 clarification: local-first
then Rafal deploys). ESC-021/022/023/024 all RESOLVED. No new open escalations.

## CI Gates — All Real Gates GREEN on main (verified 2026-06-17)

Real gates: Build, Build (control-plane), Typecheck, Lint, Format, Test (Node 22), SDK E2E, Rule H,
Rule J, ClickHouse migrations smoke, Corpus gate, Tracer query CI guard, Demo integration, K.3.6
live smoke, Gitleaks, Migration journal monotonicity — all GREEN. Python tests (adaptation-engine,
auto-detect): pre-existing FAILURE, NON-BLOCKING per CI landscape. Rule I: pre-existing FAILURE,
NON-BLOCKING (90 FOLLOW-090).

## CI CHECK COUNTER (FOLLOW-325, current ticket)

| Ticket     | CI checks | Fix iterations |
| ---------- | --------- | -------------- |
| FOLLOW-325 | 1/5       | 0/3            |

FOLLOW-325: PR #315 opened (commit 438de07). PM re-validated 2026-06-17T18:00Z (second session).
Real blocking gates: ALL GREEN. Pre-existing-red non-blocking: Rule I (168 violations, FOLLOW-090),
Python tests (all Modal app variants), Doppler verify (timing flap — passes on one of two runs).
Status: READY_FOR_REVIEW. Awaiting human merge. PM comment posted: #315 comment (evidence pasted).

## Pending Retro Spawns (8 retros outstanding as of 2026-06-17)

| RETRO     | Source ticket | PR(s)          | Status to spawn                          |
| --------- | ------------- | -------------- | ---------------------------------------- |
| RETRO-062 | FOLLOW-276    | #272           | PENDING                                  |
| RETRO-063 | FOLLOW-278    | #273           | PENDING                                  |
| RETRO-081 | FOLLOW-293    | #307           | DONE (2026-06-17) — no new FOLLOW filed  |
| RETRO-082 | FOLLOW-324    | #308           | DONE (2026-06-17) — FOLLOW-335 filed     |
| RETRO-083 | FOLLOW-326    | #309/#310/#311 | DONE (2026-06-17) — FOLLOW-336 filed     |
| RETRO-084 | FOLLOW-327    | #312           | DONE (2026-06-17) — FOLLOW-331/332 filed |
| RETRO-085 | FOLLOW-328    | #313           | DONE (2026-06-17) — FOLLOW-333 filed     |
| RETRO-086 | FOLLOW-330    | #314           | DONE (2026-06-17) — FOLLOW-334 filed     |

RETRO-084 findings: LG-1 DEFAULT_INTENT_WEIGHTS drift guard missing (docstring claims CI guard that
does not exist: intent-weights-drift.test.ts MISSING); TG-1 single-tenant admin shell change shipped
with ZERO test on changed files. No functional bug. No Rule promoted (P-DUP-CONTRACT +
P-SHELL-UNTESTED both count-1 first sightings). FOLLOW-331 (drift guard, P2) + FOLLOW-332 (admin
tests, P2) filed. Wiring audit CLEAN.

RETRO-085 DONE (2026-06-17): ClickHouse Basic auth fix (FOLLOW-328 / PR #313). FOLLOW-333 filed
(TG-1: route-level auth-header assertions for 11 uncovered call-sites, P3). FOLLOW-329 carry-forward
confirmed. No Rule promoted (centralized-helper coverage illusion count-1; K.2 silent-mock sub-shape
already governed by Rule K.2).

RETRO-086 DONE (2026-06-17): Tracer SSR crash + CH cold-start timeout fix (FOLLOW-330 / PR #314).
FOLLOW-334 filed (LG-1: keep-warm cron for CH Cloud auto-idle, P2). No Rule promoted (window-at-SSR
count-1; hardcoded-timeout count-1; both first sightings below threshold).

RETRO-081 DONE (2026-06-17): K.3.6 D-1 live-network smoke (FOLLOW-293 / PR #307). CLEAN wiring
audit. Smoke run 27555287447 GREEN (ESC-024 resolved by Piotr). FOLLOW-307 apply attested. No new
FOLLOW stubs (LG-1/2/3 all P3 by-design).

RETRO-082 DONE (2026-06-17): SDK bundle size fix (FOLLOW-324 / PR #308). FOLLOW-335 filed (TG-1:
detect-bundle.ts producer-side unit test, P2). LG-1 (snippet half-wire) closing via FOLLOW-325 PR
#315. No Rule promoted (IIFE static-import-inflation count-1).

RETRO-083 DONE (2026-06-17): admin.estalara.com sign-in + SSR auth (FOLLOW-326 / PRs
#309/#310/#311). FOLLOW-336 filed (TG-1/TG-2: checkStaffSession + middleware admin gate untested, P2
3h). 3-PR chain. Wiring CLEAN. No Rule promoted (cookie-name-mismatch count-1;
untested-primary-auth-gate count-1).

RETRO-062 DONE (2026-06-17): Stale quiz-config docstrings post-ADR-0011 (FOLLOW-276 / PR #272).
Docs-only, no FOLLOW stubs.

RETRO-063 DONE (2026-06-17): Consent-banner locale constraint accepted (FOLLOW-278 / PR #273).
Render-hop test + ADR-0011 addendum. No FOLLOW stubs.

ALL 8 PENDING RETROS COMPLETE (2026-06-17). Next: read QUEUE.md and pick next ticket.
