# DECISIONS_2026-05-18 v2 — Phase 2 Reframing After Council 2.5

**Stage:** Same-day amendment to DECISIONS_2026-05-18 (Council Checkpoint 2.5) **Status:** Approved
**Amends:** DECISIONS_2026-05-18.md Phase 2 plan only **Does NOT change:** D1-D8 strategic decisions
(those remain locked)

---

## Why this amendment exists

DECISIONS_2026-05-18 (commit 6255b72) was created based on Council Checkpoint 2, which assumed
Estalara was a working system needing hardening. Later same day, status discovery revealed:
**Estalara is a shelf product.**

- 8 sprints DONE in code (CI green, tests passing)
- All 7 vendor accounts opened (Cloudflare, Vercel, Supabase, ClickHouse, Redpanda, Modal, Doppler)
- Zero vendor services activated
- Application has never run end-to-end against real infrastructure
- Supabase project literally created today (2026-05-18), with no migrations applied

Council Checkpoint 2.5 was run on the same day with corrected facts. All 4 agents (Architecture,
Innovation, Repository, Orchestrator) returned approve_with_changes verdicts. This document captures
the resulting Phase 2 reframing.

---

## What remains LOCKED (from DECISIONS_2026-05-18)

The 8 strategic decisions are NOT up for re-discussion:

- **D1:** app.estalara.com as international private-label SaaS
- **D2:** Shared classifier across all tenants (MOAT thesis)
- **D3:** Privacy-by-design (no PII in Adaptive Listings)
- **D4:** 5 success metrics including LIVE session signup conversion
- **D5:** Conversation-to-Listing Delta report in Phase 2 (now Phase 4)
- **D6:** Parallel execution with Rafał on NATIVE-001
- **D7:** NATIVE-001 timeline assumption (2-3 weeks)
- **D8:** Trust floor B→D→A→C sequence (still valid, now in Phase 3)

---

## What changes (Council 2.5 amendment)

### Phase 2 reframing: activation first, then hardening

**Old Phase 2 plan (DECISIONS_2026-05-18):** 2A trust floor (RLS/DSR/Doppler/kill switch), 2B intent
spine readiness, 2C demo polish.

**New Phase 2 structure (Council 2.5):**

Phase 0 — Runtime readiness audit (2-3 days, no code), deliverable RUNTIME_READINESS_AUDIT.md.

Phase 1 — Minimum viable activation (Weeks 1-2): Cloudflare Worker (ingest + decision endpoint),
Supabase (with migrations + RLS from day 1), Vercel (control plane or fixture page), Doppler
(secrets wiring), DNS (estalara.com subdomains), first end-to-end signal: 1 session → 1 event → 1
decision → visible in logs.

Phase 2 — Breakage stabilization (Weeks 3-4): 2-week failure budget (Council explicit estimate), fix
migration ordering issues, fix Worker runtime incompatibilities, fix env/secrets failures, fix
schema drift between TS and Python, add basic observability, add rollback path.

Phase 3 — Trust floor on verified path (Weeks 5-6): B RLS verification (already designed in
RLS_DISCOVERY_2026-05-18), D Tenant kill switch, A DSR ClickHouse hard-delete (only if ClickHouse
activated), C Doppler CI integration, cost guardrails + retention posture.

Phase 4 — Minimum intent spine (Weeks 7-9): applyArchetypeHints wire-up + regression test, minimum
signals gate (~10 LOC), /api/chat-intent endpoint (Adaptive Listings side), shadow mode chat
classifier (when Rafał ready), Conversation-to-Listing Delta report (shadow aggregator), 100
synthetic conversation labels — precision baseline.

Phase 5 — Demo packaging (Weeks 10-12): NATIVE-001 integration (if Rafał on schedule),
000-app-estalara fixture in auto-detect corpus, Spanish quiz strings (~30 LOC), admin panel
mock-data removal, demo dashboard, demo script and instrumentation, add ClickHouse only if event
volume requires; Redpanda/Modal deferred.

### Vendor staging: activate 5 first, defer 4

**Council 2.5 decision: do NOT activate all 7 vendors at once.**

**Activate in Phase 1:** Cloudflare (Worker + R2 if needed), Supabase (Postgres + Auth), Vercel
(Next.js hosting), Doppler (secrets), DNS (estalara.com subdomains).

**Defer until needed:** ClickHouse Cloud (add only when event volume requires analytics warehouse),
Redpanda Cloud (add only when backpressure / replay becomes real), Modal (add only when
stream-consumer Python is required path), R2 (add only if SDK CDN delivery needs object storage).

**Rationale:** Activating 7 vendors simultaneously multiplies integration debugging surface. Stage
them; replace event bus with direct Supabase writes for Phase 1.

### Demo success redefinition

**Old expectation:** "First agency demo showing measurable lift across 5 metrics"

**New expectation (Council 2.5):** "First agency demo showing **directional proof** of the adaptive
loop" — visitor → inferred intent → listing mutation → engagement signal. Directional evidence on
key metrics. NOT statistically significant lift (requires traffic volume not available pre-demo).

### Traffic strategy

**Council 2.5 confirmed traffic mix (Piotr Q2 answer):** Internal browser tests (A) — pipeline
verification. Synthetic traffic generator (B) — load testing activated pipeline. app.estalara.com
production traffic (C) — real signals when Rafał finishes NATIVE-001. Phases 1-3 use A+B. Phase 4-5
introduce C.

### Failure budget acknowledgment

**Council 2.5 explicit:** Expect 30-50% of integration seams to fail on first activation. **2-week
failure budget** is built into Phase 2 (weeks 3-4). This is not "if breakage happens" — it is "when
breakage happens".

---

## Top 3 risks shelf-product status introduces

From Council 2.5:

1. **False confidence from DONE status.** Eight sprints validated CI mocks, not runtime behavior.
   Migration files, Worker bundles, Python schemas, fixture loading may all break first contact with
   real infrastructure.

2. **Integration fan-out risk.** Activating 7 vendors simultaneously multiplies root-cause ambiguity
   when something breaks. Mitigated by staging (5 first, 4 deferred).

3. **Demo credibility risk.** Without traffic volume + instrumentation maturity, statistically
   significant lift on 5 metrics is unrealistic in 10-12 weeks. Mitigated by reframing demo
   expectations to "directional proof".

---

## Sprint status reclassification (Council Q9)

HANDOFF_v3 currently labels Sprints 0-8 as "DONE". Council 2.5 recommends reclassifying these to
"CODE-COMPLETE" to prevent future agents (or new team members) from assuming production-ready
status. This will be applied in HANDOFF_v3 update (same commit as this document).

---

## Council 2.5 blocking questions — Piotr answers

1. **Demo success definition:** Directional proof-of-adaptation. Confirmed.
2. **Ownership matrix:** All Piotr (DNS, vendor admin, billing, Doppler). Confirmed.
3. **Supabase migrations applied?** No. Confirmed (Supabase project created 2026-05-18, no
   migrations).
4. **Defer Redpanda/Modal/ClickHouse OK?** Yes. Confirmed.
5. **First activation surface:** Controlled fixture page (not app.estalara.com — Rafał not ready).
   Confirmed.
6. **Traffic source:** A+B for activation, C when NATIVE-001 ready. Confirmed.
7. **Code coupling audit:** Phase 0 audit will determine. Deferred to Phase 0.
8. **Worker runtime compatibility:** Phase 0 audit will determine. Deferred to Phase 0.
9. **Reclassify Sprint status:** Yes, in this commit. Confirmed.
10. **Accept 2-week failure budget?** Yes. Confirmed.

---

## Implementation approval status

Council 2.5 verdict: APPROVED_TO_IMPLEMENT=false for any production code changes.

APPROVED actions: Phase 0 runtime readiness audit (read-only, documentation deliverable), this
document creation, HANDOFF_v3 Sprint status reclassification.

NOT YET APPROVED: any vendor activation, any migration application, any deployment to any vendor
environment, any production code changes.

Phase 0 audit must complete and answer blocking questions Q7 and Q8 before Phase 1 activation is
approved.

---

## Approval

- Piotr Nawrocki (CEO): approved 2026-05-18
- AI Council Checkpoint 2.5: approve_with_changes (all 4 agents)
- Next checkpoint: Council Checkpoint 3 after Phase 1 minimum viable activation (~Week 2)

---

## Implementation tickets to follow

Phase 0 starts with RUNTIME-AUDIT-001 ticket. See backlog/QUEUE.md once created.
