# Status — 2026-06-25T21:00Z (Sprint 22 ACTIVE — FOLLOW-359/363/341 DONE [merged]; FOLLOW-342 IN_PROGRESS [delegated 2026-06-25, backend-engineer]; FOLLOW-361/356/389 READY; ESC-020/ESC-028 OPEN [both non-blocking]; ESC-029/ESC-030 RESOLVED; §H.9 opt-out epic live-chat leg CLOSED — batch axis + test-hardening legs remain open; PROD SEED ACTION REQUIRED for §F cosine MOAT — see below)

## Active CI-check counters (step 5b tracking)

| Ticket     | CI checks used | Fix iterations used | Status                           |
| ---------- | -------------- | ------------------- | -------------------------------- |
| FOLLOW-359 | 1/5            | 0/3                 | DONE (PR #350 merged 2026-06-25) |
| FOLLOW-363 | 1/5            | 0/3                 | DONE (PR #351 merged 2026-06-25) |
| FOLLOW-341 | 1/5            | 0/3                 | DONE (PR #352 merged 2026-06-25) |

## PROD SEED ACTION REQUIRED — §F cosine MOAT go-live (FOLLOW-341)

FOLLOW-341 (PR #352) is merged and code-complete. The archetype embedding job populates
archetype_embeddings.embedding so that affinityScore() in route.ts uses real cosine similarity
instead of djb2-fallback ordering. Dev DB auto-populates via post-migrate-seed.yml on push:main
(uses DOPPLER_TOKEN_DEV — dev Supabase). PROD Supabase does NOT auto-populate.

OPERATOR ACTION (human — required before §F cosine signal is live in prod): cd apps/control-plane &&
SUPABASE_SERVICE_ROLE_KEY=<prod_key> OPENAI_API_KEY=<key> pnpm seed:archetypes OR: trigger
seed-archetypes.yml workflow_dispatch with prod credentials via GitHub Actions UI.

Until this runs: affinityScore() silently falls back to djb2-fallback ordering in prod. Not a crash
or error — a safe degradation. Same pattern as RETRO-076/FOLLOW-307 (Postgres migrations don't
auto-apply). Must appear in prod deployment checklist before go-live.

FOLLOW-342 is unblocked on code and can be delegated now. Its differentiated-playbook behavior will
use djb2-fallback ordering in prod until the manual seed runs, which is acceptable.

## Open escalations

| ESC     | Age                                                                       | Summary                                     | Blocking?      |
| ------- | ------------------------------------------------------------------------- | ------------------------------------------- | -------------- |
| ESC-020 | 19d                                                                       | Estalara-app DOM hooks not deployed to prod | No (per note)  |
| ESC-028 | 2d                                                                        | Upstash secrets for Redis smoke CI          | No (soft-skip) |
| ESC-030 | RESOLVED (2026-06-25) — CEO Option A; FOLLOW-341 delegated to ml-engineer |

## FOLLOW-384 — DONE (2026-06-24)

- PR #347 squash-merged to main by Piotr Nawrocki. Merge commit: 532f3d8.
- PM-validated 2026-06-24T13:00Z. CI green. Runtime wiring confirmed (step 5c).
- RETRO-108 pending spawn (see Pending Retro Spawns table below).
- QUEUE.md: FOLLOW-384 → DONE. FOLLOW_UPS.md: FOLLOW-384 → status DONE.

## FOLLOW-385 — DONE (2026-06-24)

- PR #348 squash-merged to main. Merge commit: f7ac516. Commit range: 532f3d8..f7ac516.
- PM-validated 2026-06-24T18:00Z. CI green (Rule I pre-existing-red — non-blocking, same baseline as
  PR #347/#346/#345). All other real gates PASS.
- ACs 1–5 verified. Runtime wiring confirmed. Scope discipline confirmed (no §H.8 paths touched).
- EPIC NOTE: §H.9 opt-out epic is NOT closed. FOLLOW-387 (P1) is the remaining open leg.
- RETRO-109 appended 2026-06-24 by pm-orchestrator (this ticket — see RETROSPECTIVES.md). RETRO-108
  pending spawn (FOLLOW-384 basis).

## FOLLOW-341 — DONE (2026-06-25)

- PR #352 merged to main 2026-06-25.
- PM-validated 2026-06-25T14:00Z. CI: 1/5 checks used. Fix iterations: 0/3.
- All real CI gates GREEN at time of merge. Non-blocking: archetype-embeddings-not-null
  (continue-on-error:true) and Rule I pre-existing-red (net -1 violation vs main).
- Runtime wiring confirmed: seedArchetypeEmbeddings() producer at archetype-seeder.ts:171, consumers
  at seed-archetypes.mts:62 (CLI) + post-migrate-seed.yml (GHA). affinityScore() cosine path at
  route.ts:516 reads vector(1024) from archetype_embeddings table.
- UNBLOCKS FOLLOW-342 (code). §F cosine MOAT prod go-live requires manual seed — see "PROD SEED
  ACTION REQUIRED" section above.
- RETRO pending.

## FOLLOW-363 — DONE (2026-06-25)

- PR #351 merged to main 2026-06-25.
- PM-validated 2026-06-25T12:00Z. CI: 1/5 checks used. Fix iterations: 0/3.
- All real CI gates GREEN. Rule I pre-existing-red only (non-blocking).
- ACs 1-5 verified. 13-call-site inventory comment added. Rule S satisfied.
- Runtime wiring: applyDwellSignal + applyListingViewRate both thread state.archetype through
  classifyFromProbabilities. Non-test consumers: index.ts:633 (dwell) + index.ts:1055 (view rate).
- RETRO pending.

## FOLLOW-359 — DONE (2026-06-25)

- PR #350 merged to main 2026-06-25.
- PM-validated 2026-06-25T12:00Z. CI: 1/5 checks used. Fix iterations: 0/3.
- All real CI gates GREEN. Rule I pre-existing-red only (non-blocking).
- ACs 1-4 + HOLDOUT COMPAT verified. variant field at route.ts:826 uses getHandlerVariant (single
  source of truth for runDecisionTree + logDecisionAsync). Non-test producer: route.ts:791. Non-test
  consumer: adapt.ts:775 (cacheVariant). No type break (directives.ts:171 already optional).
- RETRO pending.

## FOLLOW-387 — DONE (2026-06-24)

- PR #349 squash-merged to main. Merge commit: b7412e1. Commit range: f7ac516..b7412e1.
- PM post-merge reconciliation: 2026-06-24T23:00Z.
- CI: all real gates GREEN (1/5 CI checks, 0/3 fix iterations). Rule I pre-existing-red only.
- All 5 ACs verified (AC-4 confirmed real end-to-end test — NOT a TG-1 repeat).
- Runtime wiring: SDK index.ts:1344 → events.py:85+107 → main.py:37+62 → write_shadow_intent.
- ESC-029 RESOLVED (CEO approved ChatMessageSentPayloadSchema extension 2026-06-24).
- §H.9 opt-out epic — live-chat leg: CLOSED by this merge.
- §H.9 opt-out epic — remaining open legs: FOLLOW-389 (P2, sdk-engineer, test-hardening
  HW-1/TG-1/DG-1) — READY in QUEUE.md. FOLLOW-388 (P2, data-engineer, batch axis) — READY in
  QUEUE.md; blocked on FOLLOW-101.
- RETRO-110: IN PROGRESS — dedicated retrospective-analyst running in parallel (dual-pass
  prevention: pm-orchestrator did NOT write RETRO-110; do not append to RETROSPECTIVES.md in this
  session).

## FOLLOW-342 — IN_PROGRESS (delegated 2026-06-25)

- Delegated to backend-engineer 2026-06-25. Branch:
  backend-engineer/FOLLOW-342-variant-playbook-selection.
- P1, backend-engineer. CI checks: 0/5. Fix iterations: 0/3.
- Scope: thread selectedVariant into runDecisionTree/getPlaybook so control/v1/v2 produce distinct
  playbook copy; unit test variant->copy mapping across all 3 arms.
- PROD COSINE CAVEAT: affinityScore() uses djb2-fallback ordering in prod until operator runs
  `pnpm seed:archetypes` against prod Supabase (§F cosine MOAT go-live — see PROD SEED ACTION
  REQUIRED section above). FOLLOW-342 code is correct end-to-end; prod degradation is safe. Decision
  to proceed on code rather than gate on prod-seed: the operator action is independent and can run
  in parallel; stalling a P1 ticket for it is not justified.

## CONVENTIONS_PATCH update — 2026-06-25 (traceability record)

- CEO authorized two rule additions to CONVENTIONS_PATCH.md on 2026-06-25.
- Rule S amendment: call-site inventory comment required for all shared guarded helpers (any helper
  whose guard logic is invisible at the call site must carry an inline comment listing all call
  sites affected). Codified following the FOLLOW-363 audit finding on classifyFromProbabilities.
- Rule M (new): no code comment, PR body, or ticket note may claim a value/table/row "auto-populates
  on merge" or "auto-applies on deploy" unless a workflow step explicitly targets the production
  environment and runs unconditionally. Pattern codified from RETRO-076 (Postgres migrations don't
  auto-apply) + RETRO-089 (drift-guard docstring overclaimed CI guard). Count >= 2.
- CONVENTIONS_PATCH.md already updated by CEO directly. This entry is for audit traceability only.
  PM did not edit CONVENTIONS_PATCH.md.

## FOLLOW-389 — READY (promoted 2026-06-24)

- Promoted to QUEUE.md from FOLLOW_UPS.md after PR #349 merged.
- P2, sdk-engineer (lead) + backend-engineer (co: route gate confirmation).
- Scope: wire /api/quiz/completion opt-out producer + replace modeled SDK tests + fix micro-poll
  comment.
- Dependency: FOLLOW-385 DONE. No blockers.

## FOLLOW-388 — READY (promoted 2026-06-24, blocked on FOLLOW-101)

- Promoted to QUEUE.md from FOLLOW_UPS.md after PR #349 merged.
- P2, data-engineer.
- Scope: surface per-session opt-out in read_recent_chat_sessions + correct batch_enrich.py comment.
- Dependencies: FOLLOW-387 DONE. FOLLOW-101 still OPEN — do not delegate until FOLLOW-101 merges.

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

| RETRO     | Source ticket                    | PR        | Status                                                                              | Notes                                                                                                             |
| --------- | -------------------------------- | --------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| RETRO-059 | FOLLOW-274                       | #267      | DONE                                                                                |                                                                                                                   |
| RETRO-060 | FOLLOW-273                       | #268      | DONE                                                                                | Rule W promoted (ClickHouse ORDER BY key DDL)                                                                     |
| RETRO-061 | (no body — DG-2 cited)           | —         | N/A                                                                                 | Cited in test headers; no actual entry filed                                                                      |
| RETRO-062 | FOLLOW-276                       | #272      | DONE (2026-06-17) — no FOLLOW filed (docs-only)                                     |
| RETRO-063 | FOLLOW-278                       | #273      | DONE (2026-06-17) — no FOLLOW filed (docs+test, constraint accepted)                |
| RETRO-064 | FOLLOW-266 Ph1                   | #277      | DONE (2026-06-17) — FOLLOW-319/320 filed                                            | Root-cause retro: 0014 ORDER BY key dead-on-arrival; Rule W already governs                                       |
| RETRO-065 | FOLLOW-266 Ph2                   | #278      | COMPLETE                                                                            | 3 P1 defects found (CB-1/LG-1/LG-2) → FOLLOW-286                                                                  |
| RETRO-066 | (ESC-021 sourced)                | —         | COMPLETE                                                                            | ClickHouse MODIFY COLUMN on ORDER BY key → Rule W                                                                 |
| RETRO-067 | FOLLOW-266 Ph3                   | #280      | DONE (2026-06-17) — FOLLOW-321 filed (snapshot trigger HALF_WIRE)                   | RETRO-059 stubs FOLLOW-288/289 confirmed still open; bundled #279 payload attributed to RETRO-068                 |
| RETRO-068 | FOLLOW-286                       | #279      | DONE (2026-06-17) — FOLLOW-322 filed (mock-backend rejection gap)                   | LG-A/LG-B superseded by FOLLOW-287; FOLLOW-290/291/292 stubs confirmed; Rule W governs                            |
| RETRO-069 | FOLLOW-287+288                   | #281+#282 | DONE (2026-06-17) — no new stubs (FOLLOW-290/291/292 cover it)                      | ESC-021 root cause; SELECT 1 no-op pattern; Rule W count=3 (reinforces; already promoted)                         |
| RETRO-070 | FOLLOW-267                       | #283      | COMPLETE                                                                            | Rule K.2 amended; FOLLOW-298/299/300 filed                                                                        |
| RETRO-071 | FOLLOW-268-write                 | #285      | COMPLETE                                                                            | FOLLOW-301/302 filed                                                                                              |
| RETRO-072 | FOLLOW-297                       | #286      | COMPLETE                                                                            | FOLLOW-303 filed                                                                                                  |
| RETRO-073 | FOLLOW-301                       | #289      | COMPLETE                                                                            | FOLLOW-304 filed (P2 GET cross-scope determinism)                                                                 |
| RETRO-074 | FOLLOW-268-sdk                   | #290      | COMPLETE                                                                            | FOLLOW-305 filed (P1 double-/api blocker); Rule X count=1                                                         |
| RETRO-075 | FOLLOW-305                       | #291      | COMPLETE                                                                            | FOLLOW-306 filed (P3 hygiene); Rule X PROMOTED (count=2)                                                          |
| RETRO-076 | FOLLOW-266 Ph2 seed + FOLLOW-302 | #293      | COMPLETE                                                                            | FOLLOW-307 filed; OG-1 no-auto-Postgres-apply fact; FOLLOW-302 CLOSED; NO new Rule (count=1)                      |
| RETRO-087 | FOLLOW-325                       | #315      | DONE (2026-06-17) — no new stubs (FOLLOW-331/332/335 cover it)                      | DETECT_SERVE_URL companion wire closed; LG-1 detect-bundle.ts → FOLLOW-335 still open                             |
| RETRO-088 | FOLLOW-336                       | #316      | DONE (2026-06-18) — FOLLOW-337 filed (Format gate pre-existing-red)                 | checkStaffSession + middleware + SignInForm auth tests. Format pre-existing-red confirmed.                        |
| RETRO-089 | FOLLOW-331                       | #317      | DONE (2026-06-18) — FOLLOW-338 filed (mis-pointing docstring + 0030 third copy, P3) | DEFAULT_INTENT_WEIGHTS drift guard + docstring fix. Rule P-OVERCLAIMED-VERIFICATION count=2 → promoted as Rule Y. |
| RETRO-090 | FOLLOW-332                       | #318      | DONE (2026-06-18) — FOLLOW-339 filed (signOut Server Action, P3)                    | admin/layout.test.tsx + admin/page.test.tsx + pilot-tenant.test.ts. 19/19 tests. Wiring CLEAN.                    |
| RETRO-091 | FOLLOW-335                       | #319      | PENDING SPAWN                                                                       | detect-bundle.ts globalThis.\_\_EStalaraDetect unit test. FOLLOW-335 merged 2026-06-18T21:56Z.                    |
| RETRO-092 | FOLLOW-343                       | #321      | PENDING SPAWN                                                                       | Confidence/signal floor DOM adaptation gate. PR #321 merged 2026-06-19, squash commit 56b0018.                    |

**ALL Wave-2 retros complete: RETRO-062/063/064/067/068/069 DONE 2026-06-17.** **RETRO-087
(FOLLOW-325 / PR #315) DONE 2026-06-17.**

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

## Sprint 18+ Current State (2026-06-18 reconcile pass)

**ALL SPRINT 18 PRs MERGED AND RETROS NEAR-COMPLETE.**

**FOLLOW-331 DONE** (PR #317, merged fedfeb0). DEFAULT_INTENT_WEIGHTS drift guard + docstring fix.
CI check counter: 1/5, fix iter 0/3. RETRO-089 PENDING SPAWN.

**FOLLOW-332 DONE** (PR #318, merged fb9d201). admin/layout.test.tsx + admin/page.test.tsx +
pilot-tenant.test.ts. CI check counter: 0/5 (no iteration needed). RETRO-090 PENDING SPAWN.

**FOLLOW-324 DONE** (PR #308). SDK bundle 52.61 KB → 39.73 KB gzip. RETRO-082 DONE.

**FOLLOW-325 DONE** (PR #315, merged 43ad849 2026-06-17). buildSnippet() companion auto-include.
DETECT_SERVE_URL wired: producer packages/shared/src/domains.ts:73, non-test consumer
DetectionPreview.tsx:183. RETRO-087 DONE 2026-06-17 — no new stubs (FOLLOW-331/332/335 cover
residuals).

**FOLLOW-336 DONE** (PR #316, merged 1626013 2026-06-18T04:41:38Z). checkStaffSession + middleware +
SignInForm auth tests. CI check counter: 1/5, fix iter 1/3. Format check FAILING on PR #316 CI —
confirmed PRE-EXISTING-RED (commit 59ac6b5 preceding this PR also had Format check FAILING). Not a
regression. RETRO-088 DONE 2026-06-18.

**FOLLOW-326 DONE** (PRs #309/#310/#311). admin.estalara.com sign-in + Supabase SSR. RETRO-083 DONE.

**FOLLOW-327 DONE** (PR #312). Single-tenant nav + DEFAULT_INTENT_WEIGHTS. RETRO-084 DONE.

**FOLLOW-328 DONE** (PR #313). ClickHouse Basic auth fix (Code 516 resolved). RETRO-085 DONE.

**FOLLOW-330 DONE** (PR #314). Tracer SSR crash + CH cold-start timeout. RETRO-086 DONE.

**FOLLOW-293 DONE** (PR #307). K.3.6 D-1 live-network smoke. RETRO-081 DONE.

**Wave-2 retros:** RETRO-062/063/064/067/068/069 ALL DONE 2026-06-17.

**Retro spawns: RETRO-089/090 recorded in RETRO TRACKING table (2026-06-18 reconcile pass).**

**Sprint 18 P2 ticket status:**

- FOLLOW-336 (DONE): checkStaffSession + middleware + SignInForm tests (qa-engineer, 3h) — PR #316
- FOLLOW-331 (DONE): DEFAULT_INTENT_WEIGHTS drift guard + docstring fix (sdk-engineer, 3h) — PR #317
- FOLLOW-332 (DONE): admin/layout.test.tsx + admin/page.test.tsx (qa-engineer, 2h) — PR #318
- FOLLOW-335 (READY_FOR_REVIEW): detect-bundle.ts globalThis.\_\_EStalaraDetect unit test
  (sdk-engineer, 1h) — PR #319 opened. PM-validated 2026-06-18T21:40Z. All real CI gates GREEN.
  Test-only PR, ACs verified, RETRO-091 pending spawn after merge.
- FOLLOW-337 (STUB): Fix pre-existing Format check failure on main (devops-engineer, P3) — confirmed
  pre-existing-red on commit 59ac6b5 and all subsequent; needs prettier config audit + CI fix.
- FOLLOW-338 (STUB): Fix re-introduced mis-pointing drift-guard docstring + reconcile migration-0030
  third copy of intent defaults (RETRO-089 DG-1 + TG-1, P3, sdk-engineer + data-engineer, 2h).
- FOLLOW-339 (STUB): Assert admin signOut Server Action behavior (RETRO-090 TG-1, P3, qa-engineer,
  1h).

## ESCALATION STATUS

ESC-020 OPEN (non-blocking) — Rafal prod deploy pending (CEO 2026-06-10 clarification: local-first
then Rafal deploys). ESC-021/022/023/024 all RESOLVED.

ESC-025 OPEN (P0) — FOLLOW-346 chat NLP shadow bridge dead-on-arrival in prod (payload key mismatch:
consumer reads `content`, producer emits `message`). FOLLOW-366 P0 hotfix IN_PROGRESS. Filed
2026-06-20 by retrospective-analyst.

ESC-026 OPEN (P0) — FOLLOW-342 GET-path bandit contaminates holdout baseline in prod (no holdout
short-circuit on GET variant selection). FOLLOW-360 P0 hotfix IN_PROGRESS. Contamination began at PR
#327 merge 2026-06-19. Any analytics on adaptation_decisions between 2026-06-19 and FOLLOW-360 fix
should treat holdout-row variants as suspect. Filed 2026-06-20 by retrospective-analyst.

ESC-027 RESOLVED — CEO ruled option (a): rename to `directive_scope`. FOLLOW-357 PR #334 opened
2026-06-20. PM validation in progress — PR #334 has TWO PR-introduced CI regressions (Rule H FAIL +
Test Node 22 FAIL). Bounced back to backend-engineer for fix. FOLLOW-357 status: IN_PROGRESS. See
QUEUE.md for exact fix instructions.

## CI Gates — All Real Gates GREEN on main (verified 2026-06-17)

Real gates (GREEN on main): Build, Build (control-plane), Typecheck, Lint, Test (Node 22), SDK E2E,
Rule H, Rule J, ClickHouse migrations smoke, Corpus gate, Tracer query CI guard, Demo integration,
K.3.6 live smoke, Gitleaks, Migration journal monotonicity. Pre-existing FAILURE / NON-BLOCKING:
Format check (confirmed pre-existing-red — commit 59ac6b5 and all subsequent commits incl. PR #316
show Format check FAIL; NOT introduced by any recent PR), Python tests (adaptation-engine,
auto-detect, archetype-pipeline, data-quality, intent-engine, llm-gateway, stream-consumer), Rule I
(FOLLOW-090). FOLLOW-337 stub filed to track Format fix.

## CI CHECK COUNTER (Sprint 18 — COMPLETE)

| Ticket     | CI checks | Fix iterations | Status                                           |
| ---------- | --------- | -------------- | ------------------------------------------------ |
| FOLLOW-325 | 1/5       | 0/3            | DONE (PR #315, 2026-06-17)                       |
| FOLLOW-336 | 1/5       | 1/3            | DONE (PR #316, 2026-06-18)                       |
| FOLLOW-331 | 1/5       | 0/3            | DONE (PR #317, fedfeb0)                          |
| FOLLOW-332 | 0/5       | 0/3            | DONE (PR #318, fb9d201)                          |
| FOLLOW-335 | 1/5       | 0/3            | DONE (PR #319 merged 49540aa, 2026-06-18T21:56Z) |

## CI CHECK COUNTER (Sprint 22 — ACTIVE)

| Ticket     | CI checks | Fix iterations | Status                                                                                             |
| ---------- | --------- | -------------- | -------------------------------------------------------------------------------------------------- |
| FOLLOW-384 | 1/5       | 0/3            | DONE (PR #347 merged 532f3d8, 2026-06-24). RETRO-108 pending.                                      |
| FOLLOW-385 | 1/5       | 0/3            | DONE (PR #348 merged f7ac516, 2026-06-24). RETRO-109 appended.                                     |
| FOLLOW-387 | 1/5       | 0/3            | DONE (PR #349 merged b7412e1, 2026-06-24). RETRO-110 in-progress.                                  |
| FOLLOW-359 | 1/5       | 0/3            | DONE (PR #350 merged 2026-06-25). RETRO pending.                                                   |
| FOLLOW-363 | 1/5       | 0/3            | DONE (PR #351 merged 2026-06-25). RETRO pending.                                                   |
| FOLLOW-341 | 1/5       | 0/3            | DONE (PR #352 merged 2026-06-25). RETRO pending. Prod seed action pending.                         |
| FOLLOW-342 | 0/5       | 0/3            | IN_PROGRESS (delegated 2026-06-25; branch backend-engineer/FOLLOW-342-variant-playbook-selection). |

## CI CHECK COUNTER (Sprint 19 — ACTIVE)

| Ticket          | CI checks | Fix iterations | Status                                                                                                                     |
| --------------- | --------- | -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| FOLLOW-343      | 1/5       | 0/3            | DONE (PR #321 merged squash commit 56b0018, 2026-06-19). RETRO-092 pending.                                                |
| FOLLOW-340      | 1/5       | 0/3            | READY_FOR_REVIEW (PR #322, 2026-06-19). Real CI gates: 0 non-SUCCESS. Bundle 39.91 KB gzip. PM-validated.                  |
| FOLLOW-344      | 1/5       | 0/3            | READY_FOR_REVIEW (PR #329, 2026-06-19). Real CI gates: 10/10 SUCCESS. PM-validated 2026-06-19T22:00Z.                      |
| FOLLOW-346-dpia | 1/5       | 0/3            | READY_FOR_REVIEW (PR #328, 2026-06-19). Docs-only. Real CI gates: 9/9 SUCCESS (no Demo integration expected).              |
| FOLLOW-346      | 1/5       | 0/3            | READY_FOR_REVIEW (PR #330, 2026-06-20). CI green (all real gates pass). PM-validated. Wiring confirmed end-to-end (5c+5d). |

## CI CHECK COUNTER (Sprint 20 — ACTIVE)

| Ticket     | CI checks | Fix iterations | Status                                                                                                                              |
| ---------- | --------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| FOLLOW-360 | —         | —              | DONE (PR merged — P0 hotfix; commit 2836adc)                                                                                        |
| FOLLOW-366 | —         | —              | DONE (PR merged — P0 hotfix; commit eaf31a9)                                                                                        |
| FOLLOW-357 | 2/5       | 1/3            | READY_FOR_REVIEW (PR #334, 2026-06-20T13:00Z). Fix commit a59763e resolves both regressions. All real CI gates GREEN. PM-validated. |
| FOLLOW-372 | 0/5       | 0/3            | READY — promoted to queue 2026-06-21 (CEO-directed). Not yet delegated.                                                             |
| FOLLOW-373 | 0/5       | 0/3            | READY — promoted to queue 2026-06-21 (CEO-directed). Not yet delegated.                                                             |

## OPEN ESCALATION AGES (as of 2026-06-24)

| ESC     | Filed      | Days open | Summary                                                               |
| ------- | ---------- | --------- | --------------------------------------------------------------------- |
| ESC-020 | 2026-06-10 | 14        | Rafal prod deploy (non-blocking)                                      |
| ESC-025 | 2026-06-20 | RESOLVED  | P0 hotfix FOLLOW-366 merged (eaf31a9)                                 |
| ESC-026 | 2026-06-20 | RESOLVED  | P0 hotfix FOLLOW-360 merged (2836adc)                                 |
| ESC-027 | 2026-06-20 | RESOLVED  | CEO ruling (a) received; FOLLOW-357 PR #334 READY_FOR_REVIEW          |
| ESC-028 | 2026-06-23 | 1         | Upstash secrets not provisioned for redis-shadow smoke (non-blocking) |

---

FOLLOW-343: DONE. PR #321 merged (squash commit 56b0018, 2026-06-19). DOM_ADAPT_CONFIDENCE_FLOOR=0.5
gate wired in production. All real CI gates GREEN pre-merge. RETRO-092 pending spawn. FOLLOW-340:
READY_FOR_REVIEW. PR #322 open (2026-06-19). annotateSlots() from slot_selectors wire. Real CI
gates: 0 non-SUCCESS. Bundle 39.91 KB gzip. PM-validated 2026-06-19. RETRO-093 pending after merge.
RETRO-091 (FOLLOW-335 / PR #319) still pending spawn (FOLLOW-335 merged 2026-06-18T21:56Z).
RETRO-092 (FOLLOW-343 / PR #321) pending spawn (PR #321 merged 2026-06-19).

FOLLOW-344 READY_FOR_REVIEW (PR #329, 2026-06-19T22:00Z). ml-engineer implemented switch-margin
hysteresis (SWITCH_MARGIN=0.05) in classifyFromProbabilities() + §D.6 quiz/chat-only annotation. CEO
Q#2 resolved 2026-06-19 (buckets decision: switch-margin stabilizer shipped; blending deferred). All
real CI gates GREEN: Build, Build(cp), Typecheck, Lint, Test Node 22, SDK E2E, Rule H, Rule J, Demo
integration, Vercel — all SUCCESS. Non-real-gate failures (Format, Rule I, Python tests) are
pre-existing-red per CI gate landscape. ACs 1-4 all verified with code evidence in PR body. Runtime
wiring confirmed: SWITCH_MARGIN produced at intent.ts:167, consumed at intent.ts:767 inside
classifyFromProbabilities(), which is called at 12 non-test production call sites (lines 789, 824,
977, 1021, 1077, 1098, 1121, 1161, 1318, 1422, 1509, 1578, 1637 in intent.ts).

FOLLOW-346-dpia READY_FOR_REVIEW (PR #328, 2026-06-19T22:00Z). compliance-engineer delivered
docs/compliance/C-07-chat-retention-scope.md (DPIA scope brief for chat NLP free-text retention).
Docs-only; no route.ts edits. Shadow-cycle confirmed compliant. Five live-activation gate items
documented. All real CI gates GREEN. Demo integration check not expected (docs-only branch).
IMPORTANT: FOLLOW-346 implementation (chat bridge edits route.ts) is BLOCKED until PR #327
(FOLLOW-342) merges to avoid a route.ts three-way conflict. This is recorded in QUEUE.md.

Open CEO questions blocking Sprint 19 tickets: Q3 (chat shadow-vs-live → FOLLOW-346 implementation),
Q4 (embedding job vs drop cosine claim → FOLLOW-341 direction). ESC-020 non-blocking.

## Pending Retro Spawns

| RETRO     | Source ticket | PR(s)          | Status to spawn                                                                                                                                  |
| --------- | ------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| RETRO-062 | FOLLOW-276    | #272           | PENDING                                                                                                                                          |
| RETRO-063 | FOLLOW-278    | #273           | PENDING                                                                                                                                          |
| RETRO-081 | FOLLOW-293    | #307           | DONE (2026-06-17) — no new FOLLOW filed                                                                                                          |
| RETRO-082 | FOLLOW-324    | #308           | DONE (2026-06-17) — FOLLOW-335 filed                                                                                                             |
| RETRO-083 | FOLLOW-326    | #309/#310/#311 | DONE (2026-06-17) — FOLLOW-336 filed                                                                                                             |
| RETRO-084 | FOLLOW-327    | #312           | DONE (2026-06-17) — FOLLOW-331/332 filed                                                                                                         |
| RETRO-085 | FOLLOW-328    | #313           | DONE (2026-06-17) — FOLLOW-333 filed                                                                                                             |
| RETRO-086 | FOLLOW-330    | #314           | DONE (2026-06-17) — FOLLOW-334 filed                                                                                                             |
| RETRO-091 | FOLLOW-335    | #319           | PENDING SPAWN (FOLLOW-335 merged 2026-06-18)                                                                                                     |
| RETRO-092 | FOLLOW-343    | #321           | PENDING SPAWN (FOLLOW-343 merged 2026-06-19, squash commit 56b0018)                                                                              |
| RETRO-108 | FOLLOW-384    | #347           | PENDING SPAWN (FOLLOW-384 merged 2026-06-24, squash commit 532f3d8)                                                                              |
| RETRO-109 | FOLLOW-385    | #348           | DONE (appended 2026-06-24 by pm-orchestrator; no new stubs — FOLLOW-387 already filed by RETRO-108)                                              |
| RETRO-110 | FOLLOW-387    | #349           | IN PROGRESS — dedicated retrospective-analyst running in parallel (merge commit b7412e1, 2026-06-24). pm-orchestrator must NOT write this entry. |

## Sprint 19 State (2026-06-19)

**IN PROGRESS.** FOLLOW-343 DONE. FOLLOW-340, FOLLOW-344, FOLLOW-346-dpia all READY_FOR_REVIEW.

1. FOLLOW-343 (P1, sdk-engineer) — confidence floor, **DONE** (PR #321 merged 56b0018, 2026-06-19)
2. FOLLOW-340 (P1, sdk-engineer) — slot self-annotation, **READY_FOR_REVIEW** (PR #322, 2026-06-19,
   CI green, PM-validated)
3. FOLLOW-344 (P2, ml-engineer) — switch-margin hysteresis + §D.6 annotation, **READY_FOR_REVIEW**
   (PR #329, 2026-06-19, CI green, PM-validated 2026-06-19T22:00Z)
4. FOLLOW-346-dpia (P2, compliance-engineer) — C-07 DPIA scope brief, **READY_FOR_REVIEW** (PR #328,
   2026-06-19, CI green, PM-validated 2026-06-19T22:00Z, docs-only)
5. FOLLOW-341 (P1, ml-engineer) — archetype embeddings, READY (CEO open question #4 to unblock)
6. FOLLOW-342 (P1, backend-engineer) — bandit variant thread, BLOCKED on FOLLOW-341
7. FOLLOW-346 (P2, data-engineer) — chat NLP shadow bridge, READY_FOR_REVIEW (PR #330, 2026-06-20,
   CI green, PM-validated). PR #327 blocker cleared (merged 2026-06-19T21:17Z). CEO Q#3 addressed:
   CHAT_NLP_LIVE=false by default (shadow-only), live-mode explicitly gated.
8. FOLLOW-345 (P2, backend-engineer) — page_type/tier, READY (P2, can start in parallel)

RETRO-092 pending spawn for FOLLOW-343 (PR #321). RETRO-091 pending spawn for FOLLOW-335 (PR #319).
Audit PR #320 awaiting human merge (docs-only, real CI gates GREEN). Open CEO questions that unblock
Sprint 19 blocked tickets: Q2 (archetype blending), Q3 (chat shadow-vs-live), Q4 (embedding job vs
drop cosine claim). ESC-020 non-blocking.

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

RETRO-064 DONE (2026-06-17): FOLLOW-266 Phase 1 root-cause retro (PR #277). FOLLOW-319
(intent_events TTL gap) + FOLLOW-320 (Drizzle index direction drift) filed. Rule W already governs;
no new rule.

RETRO-067 DONE (2026-06-17): FOLLOW-266 Phase 3 SDK emission (PR #280). FOLLOW-321 filed (snapshot
trigger HALF_WIRE: micro_poll.answered crossing 5-multiple boundary emits no periodic snapshot).

RETRO-068 DONE (2026-06-17): FOLLOW-286 ingest handler defect-fix (PR #279). FOLLOW-322 filed
(mock-fetchImpl cannot catch type-incompatibility in dual-write INSERT-body). Rule W governs; no
new.

RETRO-069 DONE (2026-06-17): FOLLOW-287+288 ESC-021 repair (PRs #281+#282). No new stubs — all gaps
covered by FOLLOW-290/291/292. SELECT 1 no-op pattern noted (count 1, no Rule). Rule W count=3
reinforced (already promoted at RETRO-060).

RETRO-087 DONE (2026-06-17): FOLLOW-325 companion wire closure (PR #315). DETECT_SERVE_URL wired:
producer packages/shared/src/domains.ts:73, consumer DetectionPreview.tsx:183. No new stubs —
FOLLOW-331/332/335 cover residuals. detect-bundle.ts global bridge untested pattern count=2
(RETRO-082+087) but deferred: wait for FOLLOW-335 to land before promoting Rule.

RETROS THROUGH RETRO-090 RECORDED (2026-06-18 reconcile pass). RETRO-089 (FOLLOW-331 / PR #317) and
RETRO-090 (FOLLOW-332 / PR #318) entries recorded in RETRO TRACKING table above. FOLLOW-337 filed
(Format gate pre-existing-red). FOLLOW-338 + FOLLOW-339 stubs added (RETRO-089/090 findings). RULE Y
promoted (CONVENTIONS_PATCH.md). FOLLOW-335 PR #319 PM-validated 2026-06-18T21:40Z —
READY_FOR_REVIEW. Next action: human merge PR #319, then spawn RETRO-091.
