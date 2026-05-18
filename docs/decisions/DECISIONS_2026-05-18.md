# DECISIONS_2026-05-18 — Phase 2 Strategic Direction

**Stage:** Post-AI-Council-Checkpoint-2, Pre-Phase-2 implementation **Status:** Approved
**Supersedes:** Parts of DECISIONS_2026-05-17 affected by AUDIT-001 findings and Council 2 verdict

---

## Context

After Phase 1 completion (12 commits, architectural reconciliation pushed to origin/main) and
AUDIT-001 reality check, AI Council Checkpoint 2 issued REVISE/conditional GO verdict on chat
integration with 8 blocking questions. This document captures the answers to those questions and the
resulting Phase 2 plan.

Key discovery: app.estalara.com has production-grade Estalara AI chat (OpenAI + pgvector + Google
Maps) ready for integration. The integration gap is just bridging it to Adaptive Listings intent
classifier.

---

## Strategic foundations

### D1 — Flagship market: app.estalara.com as international private-label SaaS

**Decision:** app.estalara.com IS the product. Not a single-country pilot.

- One multi-tenant platform, white-label per agency
- Agencies from any country can deploy with their own brand
- Languages are platform features (EN/PL today, ES being added), NOT per-country deployments
- ETAP 1 (now, Phase 2-5): Adaptive Listings runs INSIDE app.estalara.com
- ETAP 2 (post-seed, post-MOAT): Universal SDK sold separately for agencies outside app.estalara.com

**Council misframe corrected:** "Polish flagship vs Spanish flagship" was based on assumption of
country-specific pilots. Reality: one international product, language is a feature.

### D2 — Classifier architecture: SHARED across all tenants

**Decision:** Single intent classifier shared across ALL tenants/agencies. MOAT through aggregation.

- All behavioral + chat + quiz signals from all buyers across all agencies feed the same classifier
- Base priors (`BASE_PRIOR`) and signal likelihoods (`SIGNAL_LIKELIHOODS`) are global
- Per-session state remains isolated (live in browser memory only)
- Network effect: more agencies → more data → better classifier → all agencies benefit
- ML retraining is offline on aggregated ClickHouse data, NOT real-time per-session
- Implies: standard SaaS data sharing clause in tenant agreements (anonymized behavioral data feeds
  shared classifier)

**Why this matters:** This is the core MOAT thesis. Competitors (Mutiny, Dynamic Yield) work on
anonymous click streams; Estalara works on aggregated buyer conversations across vertical-specific
real-estate context.

### D3 — Privacy-by-design: Adaptive Listings collects ZERO PII

**Decision:** Adaptive Listings layer collects ONLY behavioral data. No email, login, name, phone.

- Session identifier = HMAC(tenant_id, anonymous_seed), non-reversible
- ClickHouse events contain only anonymized behavioral telemetry
- PII (email, chat history) stays in core-master (Kotlin/Spring AI backend)
- DSR scope dramatically reduced: core-master handles email/chat deletion; Adaptive Listings has
  nothing to delete (already anonymous)
- Cross-system DSR coordination is simple: core-master deletes buyer, Adaptive Listings unaffected

**Implication:** GDPR compliance burden for Adaptive Listings is minimal. Most data is not PII in
GDPR sense.

---

## Success metrics

### D4 — Five success metrics for Option B (chat integration)

**Decision:** Track all 5 metrics, prioritize per audience:

1. **Qualified inquiry rate lift** vs 10% holdout — investor narrative
2. **Engagement / time-on-page lift** — proxy that adaptation works
3. **Chat-to-contact conversion lift** — chat → agent inquiry
4. **Visible adaptation rate** — % of buyers who saw content change
5. **Listing-view → LIVE session signup conversion** — Piotr's killer metric, strongest business
   case

**Why metric #5 is the differentiator:**

- LIVE sessions are unique Estalara product feature (Mutiny/Dynamic Yield don't have)
- LIVE signup is undeniable conversion event (buyer clicked join)
- Direct revenue correlation for agencies
- Hypothesis: per-archetype LIVE CTA copy raises signup rate
  - yield_hunter → "Join investor Q&A"
  - family_buyer → "Schedule family viewing"
  - lifestyle_expat → "Talk to English-speaking agent"

**Slot already designed:** `data-estalara-slot="cta-live"` in Rafał's integration guide.

---

## Product extensions

### D5 — Conversation-to-Listing Delta report (Council 10x opportunity)

**Decision:** INCLUDE in Phase 2 as shadow experiment.

**What it is:** Per-listing aggregation delivered to agency as report:

- Top buyer intents observed for this listing
- Repeated objections/questions
- Missing facts (questions buyers ask that listing doesn't answer)
- Copy improvement suggestions
- Frequent location queries (Google Places hits)

**Example report for "Mieszkanie Kazimierz 3pok 85m²":**

- 47 buyers viewed | 12 asked about rental ROI (yield_hunter dominance) | 8 asked about English
  schools | 5 asked about parking
- **Suggestion:** add "investment potential" section + school info
- **Missing fact:** no parking info in description

**Why this is strategic:**

- Zero UX risk (backend aggregation, no buyer-facing change)
- Second monetization path (insights value even if personalization lift is weak)
- Cheap test of MOAT thesis: if agencies say "this is game-changing" → data aggregation play
  validated
- Mutiny/Dynamic Yield cannot do this (no chat NLP, no vertical context)

**Delivery:** Weekly/monthly report per agency, dashboard widget in admin panel + optional email.

---

## Execution model

### D6 — Parallel execution, NOT sequential

**Decision:** Piotr works on Adaptive Listings (Phase 2A + 2B + 2C) IN PARALLEL with Rafał working
on NATIVE-001 (chat bridge integration on app.estalara.com).

- Phase 2A trust floor builds production-grade infrastructure
- Phase 2B intent spine prepares /api/chat-intent endpoint
- Phase 2C demo polish prepares all artifacts needed for first demo
- Rafał finishes NATIVE-001 → everything snaps together → demo works day 1

**Risk caveat:** If NATIVE-001 slips beyond 4 weeks, fallback to Plan B (Conversation-to-Listing
Delta report as main demo proof point, personalization as "shipping next sprint").

### D7 — NATIVE-001 timeline assumption

**Decision:** Assume 2-3 weeks for Rafał to complete NATIVE-001 (target ~2026-06-08).

- Integration guide already delivered (RAFAL_INTEGRATION_GUIDE.md v1.1)
- Verified against actual code (line numbers, field names, types)
- Est 4-6h focused work for Rafał

**Decision point at Week 3:** If Rafał is not >50% complete on NATIVE-001, switch to Plan B
narrative.

---

## Phase 2A trust floor sequencing

### D8 — Trust floor order: B → D → A → C

**Decision:** Within Phase 2A, sequence is:

```
Week 1:
├── B: RLS on 5 Supabase tables (Day 1-2)
├── D: Tenant kill switch (Day 3-4, parallel to B)
└── Phase 2B intent spine work begins (Day 5+)
Week 2:
├── A: DSR ClickHouse hard-delete (Day 1-2)
├── C: Doppler CI integration (Day 3-4)
└── Phase 2B continues in parallel
```

**Rationale:**

- **B first:** Largest security risk. Multi-tenant shared classifier requires strict row-level
  isolation. Investor diligence checks this first.
- **D parallel:** Operational safety net before shadow chat classifier goes live. Must be able to
  kill per-tenant in 1 minute.
- **A second:** GDPR Art.17 blocker, but D3 (privacy-by-design) dramatically reduces urgency. Still
  required before first agency pilot.
- **C last:** Process improvement, not security gap. Current secrets management works. Defer if
  scope creeps elsewhere.

---

## Phase 2 master plan

```
PHASE 2A — Production-trust floor (Weeks 1-2)
├── B: RLS on 5 Supabase tables
├── D: Tenant kill switch (adaptive_enabled column + middleware)
├── A: DSR ClickHouse hard-delete (FOLLOW-039)
└── C: Doppler CI integration (FOLLOW-040)

PHASE 2B — Intent spine readiness (Weeks 1-3, parallel to 2A)
├── applyArchetypeHints wire-up + regression test (Council Slice A)
├── Minimum signals gate (~10 LOC + tests) (Council Slice B)
├── Chat-intent schema definition (Zod)
├── /api/chat-intent endpoint in control-plane
├── Shadow mode chat classifier (no UI mutation yet)
└── 100 synthetic conversation labels — precision baseline

PHASE 2C — app.estalara.com demo polish (Weeks 3-5)
├── 000-app-estalara fixture in auto-detect corpus
├── Spanish quiz strings (~30 LOC, 2 files)
├── Admin panel mock-data removal
├── Conversation-to-Listing Delta report (shadow aggregator)
├── Golden-path E2E test: chat → archetype → adaptation → LIVE signup
├── Instrumentation: live_session.signup event
└── Demo dashboard for agency

PHASE 2D — Integration & Demo (Weeks 5-8, when Rafał finishes)
├── NATIVE-001 verification (Rafał completes)
├── End-to-end testing on app.estalara.com
├── First measurements of all 5 metrics vs holdout
└── Demo-ready state

CHECKPOINT 3 — AI Council review (Week 4-5)
└── Phase 2 results + readiness assessment for first agency
```

---

## What this document supersedes

- DECISIONS_2026-05-17 framing of "Poland + Spain co-primary markets" → corrected to "international
  private-label SaaS"
- DECISIONS_2026-05-17 framing of "first agency demo per country" → corrected to "first demo on
  app.estalara.com multi-tenant platform"
- AI Council Checkpoint 1 NO-GO on dual-market demos → no longer relevant (international product,
  not dual pilots)

---

## What this document does NOT change

- DECISIONS_2026-05-17 6 production archetypes (yield_hunter, vacation_rental_investor,
  luxury_buyer, lifestyle_expat, family_buyer, neutral) — confirmed appropriate
- DECISIONS_2026-05-17 13 strategic deferrals — still deferred
- DECISIONS_2026-05-17 north-star metric (qualified inquiry rate vs 10% holdout) — confirmed, now
  supplemented with 4 additional metrics
- Phase 1 architectural decisions (ADR-0004, ADR-0005, MASTER_DESIGN v1.9-A through D) — unchanged

---

## Approval

- **Piotr Nawrocki (CEO):** approved 2026-05-18
- **AI Council Checkpoint 2:** REVISE/conditional GO (blocking questions answered in this document)
- **Next checkpoint:** Council Checkpoint 3 at end of Phase 2 (~Week 4-5)

---

## Implementation tickets to follow

Phase 2A starts with RLS-001 ticket (see backlog/QUEUE.md once created).
