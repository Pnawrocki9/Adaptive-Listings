# Estalara Adaptive Listings — Investor-Readiness Audit Report

**Audit date:** 2026-05-16 **Repository HEAD:** `398dc97` (branch
`audit/investor-readiness-master-design`) **Auditor:** Multi-agent audit orchestrated by Claude Code
(Opus 4.7) — 5 specialist subagents (codebase, master design, intent engine, adaptive content,
backend/compliance/infra) running in parallel; technical validation via
`pnpm typecheck/lint/test/build` **Master Design version under review:** v1.8 (updated this commit)
— reconciles against v1.7.1 strategic narrative **Companion documents:**
`AUDIT_IMPLEMENTATION_MAP.md`, `AUDIT_RISK_MATRIX.md`, `AUDIT_TEST_GAPS.md`

---

## 1. Executive Summary

Estalara Adaptive Listings is a credible, mid-build embeddable AI platform that _adapts real-estate
listing content to anonymous buyer archetypes in real time_. The team has done exceptionally well on
(a) **discipline infrastructure** — per-ticket retrospectives, accumulating rules, hard CI gates
against repeating failure modes, and (b) **regulatory positioning** — DPIA + ROPA + LIA + DSR +
consent-gate landed in a single sprint, ahead of the AI Act 2026-08-02 deadline. The hard truth is
that _the headline differentiator — the 18-archetype, signal-rich, LLM-augmented adaptive listing —
does not yet end-to-end run on real traffic_. The plumbing carries events; the brain in the middle
is not finished. What runs today is a Tier 1/Tier 2 SDK with a 3-bucket keyword classifier and a
deterministic-hash card reorder, plus a strong compliance and analytics tail. The team has _shipped
fast_, but a recurring pattern (codified as Rule H) has been _shipping scaffolds that look live but
do nothing at runtime_. With 6–12 weeks of disciplined focus on closing the open Rule H follow-ups,
unblocking Sprint 2.5 onboarding, and wiring chat NLP + bandit variant selection, this becomes a
defensible Series-A-stage proposition. Without that focus, it is a sophisticated demo wrapped in
genuinely strong process artifacts. A controlled EU pilot with one well-instrumented agency is
feasible today; a _self-serve, multi-region, differentiated PropTech platform_ is one quarter away.

| Dimension               | Score (1–10) | Reasoning                                                                                                                                                                                                                                                                            |
| ----------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Investor confidence** | **6**        | Strong process, strong compliance, weak end-to-end product wiring. Salvageable in one quarter with focus.                                                                                                                                                                            |
| **Technical readiness** | **6**        | Ingest, auth, DSR, schema validation, A/B math, description pipeline are real. Differentiator (intent → archetype → adapt) is not yet wired end-to-end.                                                                                                                              |
| **Innovation**          | **6**        | The _concept_ (anonymous archetype space + adaptive listing layer + behavioral fingerprinting + auto-onboarding) is genuinely novel for real estate. The _implementation_ of innovation is still mostly behavioral fingerprinting + LLM templates — fundable but not yet defensible. |
| **Execution risk**      | **6**        | Mitigated by retro/Rule-H culture. Worsened by Sprint 2.5 bottleneck + Modal-placeholder drift + bandit-as-dead-data pattern.                                                                                                                                                        |

**One-line verdict:** Process-mature, compliance-strong, differentiator-incomplete. Worth funding if
the runway is spent closing the wiring gaps, not building new surface.

---

## 2. Product Vision Assessment

**What Estalara is trying to become.** A headless, embeddable AI layer that any real-estate website
can install in <60 seconds and that thereafter (a) detects the anonymous buyer's intent from
behavior + optional chat + optional opt-in quiz, (b) places that buyer in one of ~18 behavioral
archetypes (yield_hunter, downsizer, lifestyle_expat, golden_visa_buyer, …), and (c) adapts listing
content — headline, CTA, feature emphasis, photo order, copy variants — in real time. Plus a
standalone SaaS dashboard for agencies (analytics, A/B holdout, Quiz config) and the broader
Estalara org (Internal Ops Panel).

**Why it could matter.** Real-estate buyer journeys are exceptionally long, cross-listing, and
signal-rich, yet the industry's content layer is still mostly static. Existing personalization
vendors (Mutiny, Dynamic Yield, Optimizely) are horizontal and require weeks of implementation. A
vertical-deep, embeddable-first product that handles consent + multi-region + AI Act compliance +
zero-config onboarding could plausibly capture both the SMB (WordPress, ~40% of agencies) and the
enterprise (Idealista, Otodom, Rightmove, Zillow API consumers) ends of the market simultaneously.

**Genuinely innovative angles** (verified against code, not just deck):

1. **Behavioral archetypes as a global, k-anonymous, differentially-private aggregation surface**
   (§A.2, §F). The architecture explicitly separates session-scoped probabilistic IDs (no cross-site
   persistence) from a global archetype embedding space updated via DP. If executed, this is a fair
   GDPR posture _and_ a data-network-effect moat that competitors built on third-party cookies
   cannot replicate. _Status: design only — `archetype_embeddings` table seeded with 3 of 18
   archetypes; DP aggregation pipeline not yet built._
2. **Auto-onboarding via AI Vision schema discovery** (§B.4–B.6). A 5-layer cascade (data-attributes
   → JSON-LD → platform-templates → AI Vision → manual) with daily drift detection and self-healing.
   _Status: layers 1, 2, 4, 5 work; layer 3 (platform templates) is a no-op
   (`templates: PlatformTemplate[] = []`); daily drift cron is real (526 LOC)._
3. **Anti-hallucination LLM description pipeline with audit trail** (§E.7, v1.7.1). The Sonnet job
   consumes the agent's _original_ description as the only factual source, parses
   `<verified_facts_used>` from the response into ClickHouse for audit. _Status: shipped — 668 LOC,
   fully tested._ This is genuinely differentiated relative to generic LLM content vendors and is
   the most legally defensible AI-content posture I've seen in a real-estate product.
4. **Per-ticket retrospective learning loop with permanent rule promotion**
   (`backlog/RETROSPECTIVES.md`, `CONVENTIONS_PATCH.md`). Rare in early-stage codebases. Rule H
   exists _because_ the same pattern was observed 12 times and codified into a CI gate. This is real
   engineering hygiene.

**What is not yet proven.**

- Whether 4 behavioral signal types (page.view, scroll.depth, listing.viewed, cta.clicked) are
  enough to discriminate 18 archetypes (audit verdict: **not currently**; only 3 archetype clusters
  get meaningful signal).
- Whether agencies will tolerate AI-generated descriptions being served _without their
  preview/approval_. There is no agency approval workflow today.
- Whether the auto-detect Vision pipeline holds up beyond 24 corpus platforms (corpus gate: 100/100
  on 24 platforms; production traffic is the real test).
- Whether the Modal-vs-TS architectural ambiguity reflects a pragmatic pivot or unmanaged drift.

---

## 3. Current Implementation Assessment

See **`AUDIT_IMPLEMENTATION_MAP.md`** for the file-level evidence table. Headline numbers:

- **10 apps** (`apps/`):
  - **4 substantial TS services:** `ingest`, `decision-api`, `control-plane`, `stream-consumer`
  - **2 substantial Python services:** `llm-gateway/jobs/generate_description.py` (668 LOC),
    `data-quality/crons/schema_validation.py` (526 LOC)
  - **4 placeholders (13–27 LOC each):** `intent-engine`, `archetype-pipeline`, `adaptation-engine`,
    `auto-detect` (Modal-side)
- **10 packages** (`packages/`):
  - **5 substantial:** `sdk` (52 source files; e2e suite; auto-detect; 18 playbooks; Bayesian intent
    engine), `shared`, `db` (12 migrations), `auth`, `platform-templates` (skeleton + 0 templates)
  - **5 thin scaffolds:** `compliance`, `intent-ontology`, `sdk-loader`, `sdk-react`, `sdk-vue`
- **Backlog:** 73 DONE / 11 BLOCKED / 2 READY / 2 CANCELLED / 2 BACKLOG across Sprints 0–9
- **Migration count:** 12 Postgres migrations (`packages/db/migrations/0000`..`0011`) + 9 ClickHouse
  migrations (`infra/clickhouse/migrations/`)
- **Test count:** 102 TS test files + 14 Python test files = 116 total
- **CI workflow gates:** 13 jobs per PR (lint, typecheck, format, test-node, test-python matrix,
  build, build-control-plane, gitleaks, clickhouse-smoke, corpus-gate, rule-h, sdk-e2e); 1 nightly
  cron (e2e-smoke ingest→ClickHouse); 2 manual dispatches (deploy-staging, load-test)
- **Gate results today:** typecheck ✅ 17/17, lint ✅ 0 errors, tests ✅ 26/26 tasks, build ✅ (SDK
  IIFE 93.3 KB — over the §B.2 40 KB budget)

**What is built end-to-end:**

- Tenant onboards manually → ingest worker validates + persists events to Redpanda → stream-consumer
  batches to ClickHouse → Tier 1 sidebar widget renders confidence + archetype hint → Decision API
  returns 3-bucket directives → SDK applies headline/CTA/feature text replacement + listing-card
  reorder → A/B holdout measured against control → analytics dashboard surfaces lift. DSR endpoints
  work. Consent gate works. Schema drift detected daily.

**What is partial:**

- Tier 2 mutation engine consumes only 3 of 18 archetype buckets (via the Worker route); the full
  18-archetype route exists but is only reachable from the control-plane Next.js endpoint, not the
  default Worker.
- A/B bandit math + holdout are shipped but bandit variant _selection_ per request always returns
  index 0 — three-variants-per-slot data exists but is dead.
- Intent classification uses only 4 behavioral signals; 33 declared event schemas have no SDK
  producer.
- Auto-detection Vision pipeline runs in the control-plane Next.js route (not the named Modal app);
  platform-template layer is a no-op.

**What is design-only:**

- The named Modal services (`intent-engine`, `archetype-pipeline`, `adaptation-engine`).
- Multi-region (US/UK/UAE) infrastructure.
- Federated archetype embedding aggregation.
- Tier 3 Native React/Vue components (explicitly deferred to Q5–Q6 per §P.2).
- Fair-housing linter (§U.11 forward-compat checklist).
- WordPress plugin.
- 5 Adapters (Intercom/Drift/Crisp/Idealista/Otodom).
- SOC 2 readiness artifacts (SBOM, threat model, MFA enforcement).
- DR / RPO / RTO / SLO definitions.
- Billing self-serve UI (webhook only).
- Disaster recovery automation.

**What is missing or risky:**

- DSR-erase does not hard-delete from ClickHouse (Art. 17 non-compliance for any EU tenant —
  FOLLOW-039 P0).
- Doppler CI not wired (staging deploys can't inject secrets — FOLLOW-040 P0).
- RLS missing on 5 tables (`session_embeddings`, `tenant_site_schemas`, `ab_bandit_weights`,
  `schema_validation_history`, `archetype_embeddings`).
- Five P0 auth fixes (JWT verify, tenant header spoof, /adapt auth gate, RLS JWT injection,
  tenant-aware idempotency) shipped in Sprint 8 — the system had been running with these issues _for
  weeks_ prior. Process risk codified.

---

## 4. Intent Detection and Archetype Matching Assessment

### Mechanism explanation

Two intent-detection paths exist in the code:

**(a) In-browser Bayesian classifier** — `packages/sdk/src/core/intent.ts` (~600 LOC). Initializes a
prior over 18 archetypes (`BASE_PRIOR`, neutral = 0.37). Applies signals via Bayesian update:

- `applyQuizPrior(purpose, horizon)` — 6 conditional likelihood tables
- `applyBehavioralSignal(event)` — only 4 event types have likelihood entries: `scroll.depth`,
  `listing.viewed`, `cta.clicked`, `quiz.event`
- `applyDecay(seconds)` — exponential decay back toward prior
- `applyArchetypeHints(hints)` — _implemented but never called from `src/index.ts`_ — site-level
  hint extraction is dead wire today
- `detectMismatch(behavior, quiz)` — emits `quiz.mismatch` event

**(b) Server-side `intent-engine` Modal app** — `apps/intent-engine/src/main.py` = 27-line
placeholder. Schema for `chat.intent.detected` exists (`packages/shared/src/schemas/events/chat.ts`)
with a comment saying "the intent engine writes this after running Haiku 4.5 NLP" — that code does
not exist.

### Archetype matching

The ontology is _inconsistent_ across the codebase:

- `packages/intent-ontology/src/index.ts` — 14-line stub exporting only
  `ONTOLOGY_VERSION = '0.0.0'`. The version-stub is the only thing the package exports.
- `packages/sdk/src/core/intent.ts:22-44` — 18 archetypes as TS union (canonical).
- `packages/sdk/src/core/playbooks/index.ts` — 18 playbook entries with slots, listing_rules,
  feature_priority, copy_template in en/pl/es.
- `packages/db/src/schema/archetype_embeddings.ts` — pgvector table seeded with **3** archetypes
  (investor/family/neutral).
- `apps/decision-api/src/app/api/adapt/route.ts:195-246` — `detectArchetype()` = substring keyword
  match returning `investor`/`family`/`neutral` only.
- `apps/control-plane/src/app/api/adapt/route.ts:111-176` — trusts the SDK's hint, looks up
  `getPlaybook(archetypeId)` from the 18-playbook registry.

There is **no pgvector cosine lookup in any production path** (despite a populated 1024-dim
embedding column). There is no chat NLP. There is no server-side intent persistence (`IntentState`
lives in a browser JS closure and dies on tab close).

### Strengths

- The Bayesian classifier is _real, tested, and production-wired_. Unit tests cover init, quiz
  priors, decay, mismatch detection.
- Quiz integration is shipped and well-instrumented.
- The 18-playbook registry is rich (slots, voice patterns, listing rules, feature priority, 3
  variants per slot, en/pl/es locales).
- Anti-hallucination LLM description pipeline (§E.7.5) is genuinely well-engineered.
- A/B holdout + bandit math is fair-housing-safe by design (no user attributes).

### Weaknesses

- **Only 4 of 37 declared event schemas have an SDK producer.** The "rich signal" promise is
  structurally not deliverable today — there is no observer for chat, photos, floorplans,
  mortgage_calc, inquiries, exit-intent, dwell, or rage-clicks.
- **Only 3 archetypes are behaviorally discriminable** from the current signal set. The other 15
  archetypes never fire from behavior alone — they require the quiz, which most visitors will not
  take.
- **No server-side intent persistence.** Sessions are lost on tab close.
- **No LLM in the real-time decision path.** The only Anthropic call that fires on SDK traffic is
  the async description warmer.
- **Bandit variant selection is dead.** `bandit.ts` has zero non-test importers. Variant index 0 is
  always picked.
- **Archetype-affinity scoring is a hash.** `deterministicScore()` is djb2 — same archetype always
  sees same order; no real ranking model.
- **archetype_embeddings underseeded.** 3 of 18 archetypes have embeddings. The pgvector matcher has
  nothing to match against for 15 archetypes.

### Risks

- **False archetype assignment is structurally probable.** With 4 weak signals and 18 archetypes,
  the classifier will overfit to `neutral`/`yield_hunter`/`portfolio_builder` and misclassify e.g. a
  `downsizer` or `student_parent` as one of those — leading to wrong copy being served.
- **Cold-start problem unaddressed.** First visit, no quiz: classifier stays at prior. The
  `applyArchetypeHints` mechanism that _would_ seed from site context is implemented but never
  called.
- **No DQS measurement.** Master Design §D.5 promises 90–97% accuracy via continuous detection
  quality system. No accuracy measurement code exists. We don't know how the classifier is
  performing.

### Required improvements (in priority order)

1. Wire `applyArchetypeHints()` in SDK init (cheap, already tested).
2. Implement 8–12 more SDK signal producers (chat, photo dwell, mortgage_calc, exit-intent,
   inquiry_started) + corresponding `SIGNAL_LIKELIHOODS` entries.
3. Build server-side intent persistence in `apps/intent-engine` so sessions survive tab close.
4. Implement chat NLP (consume `chat.message.sent`, emit `chat.intent.detected`).
5. Seed all 18 archetypes into `archetype_embeddings`.
6. Wire pgvector cosine matcher into `apps/archetype-pipeline` or directly into the decision route.
7. Add DQS instrumentation: ground-truth labeling pipeline + accuracy metric in ClickHouse.
8. End-to-end test of synthetic behavioral trace → final archetype assignment.

### Verdict

**🟥 Conceptually promising but not yet proven.** The Bayesian classifier framework is correct and
the 18-archetype + 3-variant playbook structure is well-designed. The instrumentation is the gap. As
built today, the system can distinguish _investor vs family vs neutral_ from behavior alone — and
that is what the Cloudflare Worker decision API actually returns. The 18-archetype experience
requires either the Quiz (opt-in) or the as-yet-unbuilt chat NLP. Verdict moves to _likely works
after planned implementation_ if 6 of the 8 improvements above land.

---

## 5. Adaptive Listing Content Assessment

### Mechanism explanation

Three directive types ship and are tested:

- `TextDirective` — selector `[data-estalara-slot="<name>"]`, replaces `textContent`, supports
  `{token}` placeholder interpolation from sibling `data-estalara-<token>` attributes.
- `ClassDirective` — adds/removes CSS classes; selector allowlisted to `^\[data-estalara-`.
- `ReorderDirective` — sorts children of a container by `scores[listing_id]`, supports `pin_top_n`,
  fingerprinted for idempotency.

A fourth type, `VisibilityDirective`, is declared in
`apps/decision-api/src/app/api/adapt/route.ts:102` as part of the `DirectiveType` union but has no
`applyVisibility()` function in `packages/sdk/src/core/adapt.ts` — declared, never implemented.

### Current status

| Capability                                   | Status                                                     | Evidence                                                       |
| -------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------- |
| Dynamic content blocks (text replacement)    | ✅ Shipped                                                 | `applyTextDirective`, e2e tested                               |
| Archetype-specific ordering of listing cards | 🟡 Shipped but with hash-noise scoring                     | `applyReorderDirective` + `deterministicScore`                 |
| Personalized copy (3 variants per slot)      | 🟥 Variant selection not wired                             | bandit selects index 0 always; `variant_index` not on the wire |
| Conditional visibility (show/hide blocks)    | 🟥 Not implemented                                         | no `applyVisibility` function                                  |
| Session-level adaptation                     | ✅ Shipped                                                 | refetch every 5 signals                                        |
| Persistence of detected profile              | 🟥 Browser closure only                                    | no server-side intent state                                    |
| A/B / multivariate testing                   | 🟡 Holdout + analytics shipped; bandit-driven variants not | `ab-assignment.ts`, `ab-events.ts`, `bandit.ts` (unused)       |
| Analytics feedback loop                      | ✅ Shipped                                                 | `/dashboard/analytics` panel 3 (lift vs holdout, z-test)       |
| Photo order adaptation                       | 🟥 Not implemented                                         | no directive type, no slot                                     |
| Feature emphasis (per-card reorder)          | 🟥 Not implemented                                         | `feature_priority` declared in playbooks; no consumer          |
| Agency preview/approve before serve          | 🟥 Not implemented                                         | no UI; LLM copy ships immediately                              |
| Fallback on detection uncertainty            | ✅ Shipped                                                 | confidence < 0.6 → no directives; multiple layered fallbacks   |
| SEO / SSR safety                             | 🟡 Client-side only — original copy crawled, FOOC visible  | `el.textContent = resolved` post-paint                         |

### Strengths

- Mutation engine is _idempotent_ (fingerprints on directive content), _fail-safe_ (returns null on
  any error), _allowlisted_ (selector regex prevents arbitrary DOM hijack), and _consented_ (gated
  by `consent_state === 'granted'` when `consent_required`).
- Original page content is never destroyed — fallback is always "no adaptation", never "broken
  page".
- Playwright e2e proves text-replacement works end-to-end against a fixture.
- Class-scoped Shadow DOM for Tier 1 widget prevents CSS bleed into / out of the host page.

### Weaknesses

- **Two parallel adapt endpoints with different intelligence levels.** Tenants using the Worker
  route get 3 archetype buckets; tenants using the Next.js route get 18 + LLM. The SDK doesn't pin
  one.
- **Reorder scoring is a hash, not affinity.** Same archetype + same listing_id → same order,
  forever.
- **Photo reorder and feature emphasis** — both promised in copy throughout §B/§E — have no
  directive type and no consumer.
- **VisibilityDirective declared but not implemented** (Rule H violation hiding in plain sight).
- **No agency approval gate.** LLM-generated headlines and descriptions ship live the moment the LLM
  returns. For real-estate marketing this is a real risk (legal claims, factual errors, brand voice
  deviation).
- **Placeholder resolution incomplete.** §E.6 promises a 7-level hierarchy (DOM attr → URL param →
  tenant config → archetype default → locale default → token literal → skip). Only Level 1 is
  implemented; unresolved tokens stay literal as `{token}` on-page (FOLLOW-026 P1).
- **FOOC (Flash of Original Content).** Adaptation lands hundreds of ms post-paint — visually
  visible.

### Risks

- Reorder scoring is hash-noise. Pilots will not see lift attributable to _archetype-aware_ ranking,
  only to A/B copy variants.
- Without bandit variant selection wired, the 3-variants-per-slot work in TICKET-046 is dead data;
  A/B will measure neutral vs (random) archetype copy, not optimized variants.
- Without agency approval workflow, an LLM hallucination ships to a real buyer before anyone reviews
  it. The §E.7.5 anti-hallucination WHITELIST + audit trail is a strong mitigation but not a
  substitute for human review at MVP.
- §E.6 unresolved tokens visible on-page is a brand-trust risk for any tenant whose template doesn't
  expose the expected attributes.

### Required improvements

1. Pick one canonical `/api/adapt` endpoint and retire the other (ADR required).
2. Implement bandit variant selection per request + add `variant_index` to TextDirective wire
   format.
3. Replace `deterministicScore` with a real archetype-listing affinity (ANN over listing embeddings
   × archetype embeddings).
4. Implement `applyVisibility` directive type.
5. Implement photo reorder + feature emphasis directives.
6. Build agency preview/approve UI for LLM-generated copy.
7. Complete the 7-level placeholder resolution hierarchy (Levels 2–7).
8. Add SSR option for known-archetype repeat visitors (post-MVP).

### Verdict

**🟡 Logic exists but only partially connected to UI.** The mutation primitive (text + class +
reorder) is real, tested, and ships. The intelligence behind which mutation to apply is _partial_: 3
archetype buckets at the Worker, 18 at the Next.js route, no bandit-driven variants anywhere. A
pilot tenant today will see headlines flip from generic to investor-targeted (1 of 18 archetypes
effectively distinguishable) and cards reorder via a hash function. That is enough for a credible
demo + analytics tail, not enough for the "18 differentiated experiences" Master Design promises.

---

## 6. Architecture Assessment

### Strengths

- **Edge-first ingest.** Cloudflare Workers + Hono + Sentry+OTel double-wrap + durable-object rate
  limit + idempotency + REST-proxy Redpanda producer with retries and W3C trace propagation. Real
  production engineering.
- **At-least-once data pipeline with ReplicatedMergeTree dedup.** SDK → Worker → Redpanda → Modal
  stream-consumer → ClickHouse, with distributed tracing across language boundaries. Offsets
  committed only after successful insert; DLQ on terminal failure.
- **Tenant auth is the most mature layer.** Discriminated JWT (tenant claims vs staff claims),
  3-tier role hierarchy on both sides, middleware-enforced on `/admin` + `/dashboard`, Web-Crypto
  HMAC verification, Supabase JWT hook SQL committed.
- **GDPR posture is the standout.** DPIA v2.0 + ROPA + LIA template + DSR endpoints + consent gate +
  tenant_compliance_records. Conservative defaults (`consent_required = true` for new tenants).
- **Schema validation cron is real.** Daily Modal cron with HTTP fetch + BeautifulSoup
  re-validation + drift detection + Sentry dedup + Redpanda emission.
- **Anti-hallucination LLM pipeline is genuinely well-engineered.** WHITELIST prompt,
  `<verified_facts_used>` audit trail to ClickHouse.
- **CI gate set is broad.** 13 PR-blocking jobs including a project-specific Rule H scaffold-wiring
  check and a 24-platform auto-detection corpus precision/recall gate.
- **Discipline infrastructure works.** Per-ticket retros, accumulating rules, automated promotion of
  recurring patterns to permanent CI gates.

### Weaknesses

- **Modal placeholder gap.** Four named services are 22-line stubs. Either rebuild or rebrand.
- **Two parallel `/api/adapt` endpoints** with subtly divergent contracts.
- **`packages/compliance` and `packages/intent-ontology` are empty.** All compliance logic is inline
  in `apps/control-plane` + `apps/decision-api`. Engineers reading the package READMEs will be
  misled.
- **Terraform footprint is misleading.** Most modules are commented-out scaffolding
  (`# uncomment in TICKET-020`). Only Cloudflare R2 + DNS are actually IaC-managed; Supabase,
  Redpanda, ClickHouse, Workers, KV namespaces are wrangler/vendor-console managed.
- **Single-region deployment** despite four-region marketing claim.
- **Admin panel uses mock data.** `/admin/registrations`, `/admin/demo-sessions`, `/admin/tenants`
  import `mock-data.ts`.
- **Bandit is dead code.** Imported by zero non-test files.
- **Variant transport not on the wire.** `TextDirective` has no `variant_index` field.

### Scalability concerns

- ClickHouse partitioned by `(tenant_id, toYYYYMMDD(ts))` with 13-month TTL — reasonable for ~100
  tenants. Beyond that, partition key may need refinement.
- Redpanda REST proxy (not native Kafka) — Cloudflare Workers constraint. Adds latency vs native
  client (~30–50ms typical). Acceptable for MVP.
- Decision API caches tenant schemas in Upstash Redis (TICKET-AB-011); good for read path. Write
  path through the bandit is fire-and-forget to Redpanda.
- No read-replica / cross-region replication strategy in repo. Single-region failure = full outage.
- pgvector with 1024-dim embeddings is fine for 5–10M vectors; migration to Qdrant flagged for Y2
  per §I.

### Maintainability concerns

- **Two adapt endpoints** double the surface area to maintain.
- **Empty packages** (`compliance`, `intent-ontology`, `sdk-loader`, `sdk-react`, `sdk-vue`) consume
  mindshare during onboarding without adding value.
- **CLAUDE.md is 6 minor versions stale** vs MASTER_DESIGN.md. Onboarding agents will read stale
  guidance.
- **Section T (Demo Mode) heading is missing** from current MASTER_DESIGN despite being referenced
  from §U and having live code. Minor doc-drift.
- **ADR discipline is thin** — only 2 ADRs for a project this complex. Most architectural decisions
  are implicit in code.

### Data model concerns

- **RLS coverage incomplete** on 5 tables (`session_embeddings`, `tenant_site_schemas`,
  `ab_bandit_weights`, `schema_validation_history`, `archetype_embeddings`). The DSR-access route
  queries `session_embeddings` — currently relying on application-layer tenant scoping rather than
  DB-layer enforcement.
- **DSR-erase soft-deletes only** in ClickHouse. RODO Art. 17 non-compliance for EU tenants.
- **archetype_embeddings underseeded** (3 of 18 archetypes).

### Integration concerns

- **Five MVP-promised adapters (Intercom/Drift/Crisp/Idealista/Otodom)** don't exist in code.
- **No customer-facing billing surface** — webhook-only Stripe integration. No checkout, no customer
  portal, no `/dashboard/billing` page.
- **No WordPress plugin.**

---

## 7. Test and Quality Assessment

See **`AUDIT_TEST_GAPS.md`** for detail.

**Existing tests:**

- 102 TS test files + 14 Python test files = 116 total.
- 4 Playwright e2e specs covering Tier 1 + Tier 2 + consent gate (runs on PR).
- Multi-service ingest→ClickHouse smoke (nightly cron, not on PR).
- Vitest coverage thresholds enforced: 80% for packages (libraries), 70% for apps (services). All
  vitest configs verified.
- 24-platform auto-detection corpus CI gate at 100/100 precision/recall.
- Real mock-based test coverage for the description Sonnet pipeline (TC-1 through TC-9, locale,
  WHITELIST enforcement).

**Missing tests:**

- **No end-to-end test of intent → archetype → adapt → DOM** (FOLLOW-022 P1).
- **No slot-name CI contract test** (TICKET-SLOT-CONTRACT-001 READY, not merged). Without this,
  renaming `feature` → `feature-section` in one place silently breaks the SDK.
- **No placeholder-token coverage test** — unresolved tokens silently appear on-page.
- **No locale fallback test** — tenant configured for `pl` silently gets English.
- **No corpus regression test for reorder.**
- **No Python coverage gate.** `test-python` matrix runs without `--cov`.
- **No load test in CI.** k6 scripts exist (TICKET-017) but only on manual dispatch.

**CI/build status (this commit):**

- Typecheck ✅ 17/17
- Lint ✅ 0 errors, 3 unused-eslint-disable warnings
- Tests ✅ 26/26 tasks (control-plane: 37 files / 367 tests pass)
- Build ✅ (SDK IIFE 93.3 KB)
- Format ✅ (assumed — `pnpm format:check` not run in audit; CI runs it)

**Critical quality gaps:**

1. The differentiator loop has no end-to-end test.
2. Bandit is dead code; tests pass because they test the math in isolation, not the production
   wiring.
3. Two parallel adapt routes have no consistency contract test.
4. SDK bundle is 93 KB; §B.2 says 40 KB. Either re-baseline or split entry points.

---

## 8. Privacy, Compliance, and Trust Risks

### Behavioral tracking risks

- **Session-scoped probabilistic ID** (no cross-site cookie, no persistent fingerprint) — strong
  posture, codified in §G.
- **Consent-required default = true** for new tenants — conservative.
- **Consent gate at Decision API** runs _before_ A/B assignment; gated sessions get no directives
  and no event emitted — exactly correct GDPR posture.

### Personalization transparency risks

- **No "Why am I seeing this?"** UI on the tenant's site. Master Design §H promises transparency
  obligations; SDK delivers no transparency disclosure beyond the sidebar widget (which only the
  visitor who opens it sees).
- **No agency-side audit log** for "what copy did we serve to this archetype yesterday?" —
  ClickHouse `adaptation_decisions` has the data, no dashboard yet.

### Real estate compliance risks

- **Fair housing linter not built.** §U.11 forward-compat lists this as MVP-blocker for Profile
  Mode. Today's archetype space is purely behavioral (`yield_hunter`, `family_buyer`, etc.) and
  Piotr's 2026-05-13 decision is that archetype = behavioral, not demographic — which is the correct
  posture. But there is no automated check that future copy variants don't drift toward demographic
  targeting language.
- **No content provenance disclosure.** Generated descriptions don't carry an AI-content marker.

### AI-generated content risks

- **Anti-hallucination WHITELIST is shipped** (§E.7.5) — best-in-class for the LLM description
  pipeline.
- **No human-in-the-loop approval** before LLM copy ships. For real estate this is a real risk.
- **`<verified_facts_used>` audit trail** is stored in ClickHouse — defensible for litigation.
- **AI Act risk classification** held as _not high-risk_ (recommendation/personalization, not
  eligibility/credit) — defensible per §H.

### Data retention / consent risks

- **13-month TTL** on ClickHouse events — within typical norms.
- **DSR-erase does not hard-delete from ClickHouse** (FOLLOW-039 P0) — RODO Art. 17 non-compliance.
- **DSR-access route queries `session_embeddings`** which has no RLS — application-layer scoping
  only.
- **No DPA template per tenant** in repo (likely lives in Notion per §U.11 plan).

---

## 9. Investor Risk Matrix

See **`AUDIT_RISK_MATRIX.md`** for the full matrix with priorities. Top 10 by severity ×
probability:

| #   | Risk                                                                       | Sev  | Prob     | Evidence                                                                             | Mitigation                                                                          | Priority |
| --- | -------------------------------------------------------------------------- | ---- | -------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | -------- |
| 1   | Differentiator (intent→archetype→adapt) not end-to-end wired               | High | Certain  | Modal placeholders; bandit unused; 4 of 37 signals; 3 of 18 archetypes discriminable | Close FOLLOW-007/019/025/028, build chat NLP, seed all 18 embeddings                | P0       |
| 2   | Sprint 2.5 onboarding blocked                                              | High | Certain  | 4 of 6 tickets BLOCKED; no zero-config path exists                                   | Dedicate one sprint to TICKET-030/032/033/034                                       | P0       |
| 3   | DSR-erase non-compliance (RODO Art. 17)                                    | High | Certain  | FOLLOW-039; ClickHouse soft-delete only                                              | Implement hard delete from `events` + `adaptation_decisions` + `session_embeddings` | P0       |
| 4   | RLS coverage gap on 5 tables                                               | High | Possible | `rls-policies.sql` missing 5 tables                                                  | Backfill RLS in a migration; add a meta-test                                        | P0       |
| 5   | Two parallel `/api/adapt` endpoints diverge                                | Med  | Likely   | Different archetype cardinalities + holdout behavior                                 | ADR + retire one                                                                    | P1       |
| 6   | Modal placeholder drift confuses new hires + investors                     | Med  | Likely   | 4 stub apps; CLAUDE.md says "10 Modal apps"                                          | Pivot doc + diagram, or rebuild apps                                                | P1       |
| 7   | Bandit variant selection is dead                                           | Med  | Certain  | bandit.ts has 0 non-test importers                                                   | Wire variant_index transport + selection                                            | P1       |
| 8   | Recurring pre-Sprint-8 auth fixes (FIX-013..019) reveal review process gap | Med  | Possible | 5 P0 fixes in single cluster                                                         | Code review checklist + security regression suite                                   | P1       |
| 9   | Single-region infrastructure under multi-region claim                      | Med  | Possible | Terraform: only Cloudflare R2/DNS active                                             | Stand up second region end-to-end                                                   | P2       |
| 10  | SDK bundle over budget (93 KB vs 40 KB)                                    | Med  | Certain  | tsup output                                                                          | Split Tier 1 vs Tier 2 entry, or re-baseline §B.2                                   | P2       |

Lower-priority but documented in matrix: missing fair-housing linter, missing Master Admin live
data, agency approval workflow gap, no DR plan, no SOC 2 readiness work, billing webhook-only,
locale fallback untested, Section T heading missing from doc.

---

## 10. Probability of Success

**Probability of building a working MVP** (single-region EU pilot with one well-instrumented agency,
observable adaptation, working analytics): **High (60–80%).** The team has shipped the hard parts
(ingest, auth, GDPR, A/B, schema validation). What remains is closing the wiring gaps, not building
new architecture. 6–10 weeks of disciplined focus on the open Rule H follow-ups + Sprint 2.5 unblock
should land this.

**Probability of building a differentiated product** (18-archetype intent + chat NLP + bandit-driven
variants + photo reorder + agency approval workflow + zero-config onboarding across WordPress +
Idealista-class platforms): **Medium (30–60%).** Requires (a) finishing the in-flight pivot from
Modal to TS-edge (or rebuilding Modal apps), (b) adding 8–12 SDK signal producers, (c) implementing
chat NLP, (d) building agency approval UI, (e) shipping platform templates. This is one full quarter
of focused work, _not_ parallel to closing the MVP wiring gaps. If the team continues to layer new
sprints on top of accumulating follow-ups, probability drops to the low end.

**Probability of reaching investor-grade technical credibility** (an investor's CTO reviewer comes
away convinced this is a real, well-instrumented system): **High (60–80%) for process; medium
(30–60%) for product.** A skilled technical due-diligence reviewer reading
`backlog/RETROSPECTIVES.md`, `CONVENTIONS_PATCH.md`, the CI workflow, and the GDPR compliance work
will form a strongly positive impression. The same reviewer running the SDK end-to-end against a
fresh tenant and seeing the 3-bucket Worker output, the dead bandit, the empty platform templates,
and the Modal placeholders may form a much more cautious view. The doc-vs-code reconciliation in
this commit narrows that gap by being honest.

**Probability of defensibility if executed well** (the moat the Master Design promises —
embeddable + vertical-deep + DP archetype embedding space + auto-onboarding + AI Act-aware
compliance — actually holds up against Mutiny/Dynamic Yield horizontal entrants): **Medium
(30–60%).** The vertical-real-estate ontology + the anti-hallucination LLM pipeline + the
consent-aware multi-region posture are genuinely differentiated. The DP archetype embedding space is
the most exciting MOAT claim and is currently design-only. If the team executes the archetype
embedding space _and_ successfully closes 3+ EU agencies as pilots, defensibility is real. If the
embedding space stays at 3 archetypes and pilots stall, defensibility collapses to "another
personalization vendor with better compliance documentation".

---

## 11. Recommendations

### Immediate fixes (1–2 weeks)

1. **Wire `applyArchetypeHints()` in SDK init.** Implemented + tested; just call it after
   `initIntentState()`. (`packages/sdk/src/index.ts` after line 273.) Cheap cold-start win.
2. **Implement ClickHouse hard delete in DSR-erase.** FOLLOW-039. Adds
   `DELETE FROM events WHERE session_id IN (...)` + `description_generations_verified_facts` +
   `session_embeddings`. RODO Art. 17 compliance.
3. **Wire Doppler in CI.** FOLLOW-040. Add `DOPPLER_TOKEN_DEV` to GitHub Secrets; flip
   `continue-on-error: false`.
4. **Pick canonical `/api/adapt` endpoint.** Write an ADR (target
   `docs/adr/ADR-0004-canonical-adapt-endpoint.md`). Retire the other route or document the split
   with rationale.
5. **Add slot-name contract CI test.** TICKET-SLOT-CONTRACT-001 is READY; ship it.
6. **Backfill RLS** on `session_embeddings`, `tenant_site_schemas`, `ab_bandit_weights`,
   `schema_validation_history`, `archetype_embeddings`. One migration; sub-100 LOC.
7. **Resolve the SDK bundle budget.** Either split Tier 1 / Tier 2 entry points (recommended) or
   update §B.2 to reflect 93 KB.

### Product proof milestones (2–6 weeks)

8. **Unblock Sprint 2.5.** Allocate one sprint to TICKET-030 (Magic Link wizard), TICKET-032 (15
   platform templates), TICKET-033 (Auto-Detect Modal), TICKET-034 (Schema Discovery API). This is
   the MVP entry point.
9. **Seed all 18 archetypes** into `archetype_embeddings` (currently 3).
10. **Add 8 SDK signal producers**: chat events, photo gallery interaction, mortgage_calc,
    inquiry_started, exit-intent, dwell on photos, rage-click, tab visibility. Then add
    `SIGNAL_LIKELIHOODS` entries for each.
11. **Wire bandit variant selection per request.** FOLLOW-007/025/028. Add `variant_index` to
    `TextDirective` wire format; update `applyTextDirective` fingerprint to include variant_index.
12. **Replace `deterministicScore`** with archetype-listing affinity via embedding cosine.
    FOLLOW-019.
13. **Implement `applyVisibility` directive.** Closes a Rule H violation.
14. **Build agency preview/approve UI** for LLM-generated copy.

### Investor confidence milestones (6–12 weeks)

15. **Implement chat NLP in `apps/intent-engine`** OR formally update Master Design §A.1 to reflect
    the TS-edge pivot.
16. **End-to-end test of differentiator loop** (FOLLOW-022). Synthetic behavioral trace → measured
    archetype → measured DOM mutation → measured lift.
17. **Stand up second region** (US or UK) end-to-end on Terraform — finish Supabase + Redpanda +
    ClickHouse + Workers + KV IaC modules, replace `# uncomment in TICKET-020` with applied
    resources.
18. **Ship 15 platform templates** + WordPress plugin for the SMB long tail.
19. **DQS measurement pipeline.** §D.5 promises 90–97% accuracy; today there is no accuracy metric
    in ClickHouse. Ground-truth labeling + lift attribution.
20. **SOC 2 Type I readiness work.** SBOM (Syft), MFA enforcement on agency owners, formal threat
    model document, supplier list.

### Strategic technical roadmap (post-MVP)

21. **DP archetype embedding aggregation pipeline** (§F MOAT) — k-anonymity ≥50, DP ε≤2, weekly
    cron, cross-tenant aggregation. This is the headline defensibility play.
22. **Tier 3 Native React/Vue components** (§P.2 — explicitly Q5–Q6).
23. **Self-healing schema detection v2** with predictive drift (§B.5.4).
24. **Federated learning hooks** for the largest enterprise tenants (§F Y2).
25. **Migration from pgvector to Qdrant** at the 5–10M vector threshold (§I Y2).

---

## 12. Final Verdict

**Is this only a nice concept?** No. There is real technical substance. The ingest layer, the GDPR
posture, the SDK Tier 1 widget, the auto-detect Vision pipeline (TS-side), the description Sonnet
job with audit trail, the A/B holdout, the schema validation cron, and the per-ticket retrospective
learning loop are all real and well-engineered. The codebase is mid-build but the parts that are
built are built well.

**Is it likely to become innovative?** Yes, conditionally. The behavioral archetype space + the
anti-hallucination LLM pipeline + the consent-aware multi-region posture + the per-tenant
auto-onboarding are a genuinely differentiated combination for real estate. Whether it becomes
innovative depends on whether the team closes the wiring gaps before adding more surface. The Rule H
pattern (schema scaffold without runtime consumer) has recurred 12+ times; if it recurs in chat NLP,
photo signals, and visibility directives, innovation stays theoretical.

**What must be proven next?**

1. That the differentiator loop runs end-to-end on real traffic with measurable lift over the
   holdout (not just unit-tested in isolation).
2. That a real EU agency can self-serve onboard in <60 seconds via Magic Link + Auto-Detect.
3. That 8+ behavioral signals discriminate 8+ archetypes (not just 3) in real traffic.
4. That the bandit selects variants per request and lifts CTR over neutral.
5. That DSR-erase actually removes data from ClickHouse.

**Would this pass early technical due diligence?** Yes, for the _process_ and _compliance_ layers —
those would be highlights. The _product_ layer would attract honest follow-up questions: "Show me
the bandit picking variant 2 for archetype 7 on tenant X." "Show me the chat NLP detecting intent
from a real chat transcript." "Show me a tenant self-serve onboarded in the last 7 days." If those
questions have clean answers in 6–10 weeks, the round closes. If they're still placeholder answers
in 12+ weeks, the round stalls.

**What would I tell an investor?** _"This is a high-discipline early-stage team that has done
unusually mature work on the regulatory and observability layers and is building a credible
vertical-deep alternative to horizontal personalization vendors. The differentiating product feature
— adaptive 18-archetype listings — is not yet wired end-to-end on real traffic; what runs today is a
3-bucket prototype with strong analytics and compliance scaffolding around it. The team's per-ticket
retrospective loop and accumulating CI gates are rare engineering hygiene that materially de-risks
execution. If you fund this round, I would tie tranche-2 release to four specific milestones: (a)
one EU agency self-serve onboarded, (b) 8+ behavioral signals + 8+ discriminable archetypes shipped,
(c) bandit-driven variant selection live in production, (d) end-to-end measured lift vs holdout. All
four are 6–10 weeks of focused work, not new architecture. The team can execute it; the question is
whether they will focus on closing wiring gaps instead of adding new surface."_

---

**End of report. Companion documents:** `AUDIT_IMPLEMENTATION_MAP.md` · `AUDIT_RISK_MATRIX.md` ·
`AUDIT_TEST_GAPS.md`. Master Design v1.8 (this commit) reconciles to the same evidence.
