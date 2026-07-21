# Estalara Adaptive Listings — Code Audit Diagnosis

**Date:** 2026-07-21  
**Audience:** Piotr (CEO) + engineering agents  
**Scope:** Diagnosis only — no refactor. Anchored on `docs/MASTER_DESIGN.md` v4.3 §Snapshot.1, ADRs,
`CONVENTIONS_PATCH.md`, `backlog/QUEUE.md`, then verified against HEAD code.  
**Prior audits:** Investor readiness (2026-05-16), Full-Stack Audit remediation (2026-07-01 / Sprint
22b), Audit #3 (2026-07-11 / Sprint 23). This report re-verifies current HEAD.

---

## 1. Executive Summary

The foundation is real software, not a painted demo: an anonymous buyer session can load the SDK,
classify into one of 18 archetypes client-side, hit the canonical control-plane `/api/adapt`, get
playbook directives applied, and (when cached) get an LLM description with anti-hallucination
guards. What is broken or unfinished is the **measurement and learning loop in production**, plus
the **server-side chat-NLP path**, which is wired through a bus that is a permanent no-op. Finishing
on this foundation can work — but only if operator gates and a few dead wires are treated as
first-class blockers, not polish.

**Verdict color: 🟡 YELLOW**

**Overall progress:** ≈55–60% of §Snapshot.1 scope is built and wired end-to-end; the buyer
adaptation shell works; the intent-core is partially live (client Bayesian + quiz), while chat-NLP
Modal and bandit learning are code-complete but inert in prod.

**Top reasons:**

1. **Canonical adapt path is real** — control-plane `/api/adapt` + 18 playbooks + holdout +
   ClickHouse `adaptation_decisions`; Worker path correctly returns 410 (ADR-0004/0006).
2. **Measurement loop is frozen in prod** — `FEEDBACK_ENDPOINT_ENABLED !== 'true'` → bandit stays
   Beta(1,1); Wave 0 operator session (`FOLLOW-553`) not fully closed.
3. **Chat-NLP intent path is dead in prod** — `apps/intent-engine` is a real Modal service, but it
   is only fed by `stream-consumer` from Redpanda, and `REDPANDA_REST_URL` is empty (ADR-0016 /
   ESC-017).
4. **Archetype IDs are consistent** (parity-tested); `packages/intent-ontology` remains a stub —
   ADR-0006 SoT lives in SDK `ARCHETYPE_NAMES`, not the ontology package.
5. **Cosine affinity is code-wired but pilot-starved** — empty `listing_embeddings` → silent djb2
   fallback for reorder scores.

---

## 2. System Map

### Pipeline stage → reality

| Stage                        | Real files                                                                                    | Canonical vs deprecated                                         | Live vs placeholder                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| SDK load + signal capture    | `packages/sdk/src/index.ts`, `core/observer.ts`, `core/events.ts`, `core/intent.ts`           | Canonical                                                       | **Live** (browser Bayesian + quiz v2.0)                               |
| Event ingest                 | `apps/ingest/src/handlers/events.ts`, `clickhouse-producer.ts`, `redpanda-producer.ts`        | Canonical                                                       | **CH live** (post-ACK + CF Queue retry); **Redpanda no-op**           |
| Intent / archetype           | Client: `packages/sdk/src/core/intent.ts`; Server chat-NLP: `apps/intent-engine/`             | Client = production SoT for archetype; Modal = shadow chat dims | Client **live**; Modal **code real, prod-dead** (no Redpanda feed)    |
| Ontology package             | `packages/intent-ontology/src/index.ts`                                                       | Intended SoT per design; unused                                 | **Stub** (`INTENT_ONTOLOGY_VERSION = '0.0.0'`)                        |
| Adapt (directives)           | `apps/control-plane/src/app/api/adapt/route.ts`                                               | **Canonical** (ADR-0004/0006)                                   | **Live**                                                              |
| Adapt (Worker)               | `apps/decision-api/src/app/api/adapt/route.ts`                                                | Deprecated                                                      | **410 Gone**                                                          |
| Description LLM              | `…/adapt/description/route.ts` + `apps/llm-gateway/src/jobs/generate_description.py`          | Canonical (ADR-0016 direct Modal HTTPS)                         | **Live** (fact whitelist + NEUTRAL gate)                              |
| Holdout / bandit             | `packages/shared/src/ab-holdout.ts`, adapt route Thompson sample, `…/adapt/feedback/route.ts` | Canonical                                                       | Math **wired**; feedback **503-gated in prod**                        |
| Analytics / lift             | `…/pilot/cta-lift/route.ts`, dashboard analytics routes                                       | Canonical                                                       | **Fail-loud** when CH configured; mock only if `CLICKHOUSE_URL` unset |
| Dashboard / admin            | control-plane `/dashboard/*`, `/admin/*`                                                      | Canonical                                                       | Agency surfaces real; staff hubs **live-or-mock** (FOLLOW-593+)       |
| Schema discovery             | SDK auto-detect + `/api/detect`                                                               | Canonical                                                       | L1+L2+L4 **live**; L3 templates **empty `[]`**                        |
| Continuous schema validation | `apps/data-quality/src/crons/schema_validation.py`                                            | Canonical                                                       | Cron **real** (526 LOC); `main.py` still placeholder wrapper          |
| Stream consumer              | `apps/stream-consumer/`                                                                       | Designed Redpanda→CH + chat-NLP spawn                           | **Code real; bus inactive** → idle                                    |

### Architecture (current runtime)

```mermaid
flowchart LR
  Buyer[Anonymous buyer] --> SDK[packages/sdk]
  SDK -->|events POST| Ingest[apps/ingest CF Worker]
  Ingest -->|INSERT| CH[(ClickHouse events)]
  Ingest -.->|REDPANDA_REST_URL empty| RP[Redpanda no-op]
  SDK -->|archetype_hint| Adapt[control-plane /api/adapt]
  Adapt -->|afterResponse| CH2[(adaptation_decisions)]
  Adapt -->|directives| SDK
  SDK -->|GET| Desc[/api/adapt/description]
  Desc -->|Modal HTTPS| LLM[llm-gateway generate_description]
  LLM --> Redis[(Upstash Redis)]
  LLM --> PG[(Postgres description_cache)]
  RP -.->|never receives| SC[stream-consumer]
  SC -.->|would spawn| IE[intent-engine Haiku]
  IE -.->|shadow Redis| Adapt
  SDK -->|POST feedback| FB[/api/adapt/feedback]
  FB -.->|503 unless FEEDBACK_ENDPOINT_ENABLED| Bandit[(ab_bandit_weights)]
```

---

## 3. Critical Path Walkthrough

One anonymous buyer session on a listing (pilot host assumed).

| #   | Hop                                | Status                           | Evidence                                                                                                                        |
| --- | ---------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | SDK loads / auto-`init()`          | **connected**                    | `packages/sdk/src/index.ts:1741–1747`                                                                                           |
| 2   | Consent banner / gate              | **connected**                    | `index.ts` consent branch; ingest `evaluateConsent` in `apps/ingest/src/consent-gate.ts:181+`                                   |
| 3   | Behavioral events queued + flushed | **connected (partial taxonomy)** | Observer + index emit ~22–28 of 52 `EVENT_TYPES`; flush via `core/events.ts` → ingest                                           |
| 4   | Ingest validates + ACK             | **connected**                    | `handlers/events.ts` Zod `EventSchema` + 200 ACK                                                                                |
| 5   | Persist to ClickHouse              | **connected (async)**            | `waitUntil(pushToClickHouse)`; retry queue ADR-0017                                                                             |
| 6   | Dual-write Redpanda                | **dead (intentional no-op)**     | `redpanda-producer.ts:82–87` when `REDPANDA_REST_URL` unset                                                                     |
| 7   | Client Bayesian / quiz archetype   | **connected**                    | `intent.ts` `ARCHETYPE_NAMES` (18 IDs); quiz `applyQuizLeaf`                                                                    |
| 8   | Server chat-NLP prior              | **code wired; operator-pending** | Ingest → Modal HTTPS `chat_nlp_endpoint` (F-01 draft); needs `MODAL_CHAT_NLP_URL`. `CHAT_NLP_LIVE=false` still gates directives |
| 9   | `POST /api/adapt` (control-plane)  | **connected**                    | Canonical route; holdout + Thompson + playbooks                                                                                 |
| 10  | Worker `/api/adapt`                | **dead by design**               | `decision-api/.../adapt/route.ts` → HTTP 410                                                                                    |
| 11  | Reorder affinity cosine            | **stubbed fallback**             | Code prefers cosine; missing embeddings → djb2 (`adapt/route.ts:1451–1474`)                                                     |
| 12  | SDK applies directives             | **connected**                    | `core/adapt.ts` `adapt.applied` / DOM mutation                                                                                  |
| 13  | Description adapt                  | **connected**                    | Cache miss → Modal enqueue via `afterResponse`; fact guards in Python job                                                       |
| 14  | Log decision → CH                  | **connected**                    | `logDecisionAsync` via `afterResponse`                                                                                          |
| 15  | `ab.assignment` event bus          | **dead**                         | `ab-events.ts:40–41` no-op without Redpanda (CH decision log still carries holdout)                                             |
| 16  | Feedback → bandit update           | **stubbed / gated**              | `feedback/route.ts:262–269` returns 503 unless env flag                                                                         |
| 17  | Lift / CTA analytics               | **connected when CH set**        | Fail-loud 500 on CH error; mock only if URL unset (`cta-lift/route.ts:343–358`)                                                 |

**Bottom line for the path that ships value today:** steps 1–5, 7, 9, 12–14 work. Learning (16) and
chat-driven intent (8) do not run in production as designed.

---

## 4. Known-Traps Checklist Results

| #   | Trap                                                  | Result                                | Evidence                                                                                                                                                                                                                                               | Linked findings                        |
| --- | ----------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| 1   | Scaffold-theater (Rule H)                             | **Present**                           | 52 event types defined (`packages/shared/.../events/index.ts:201–261`); SDK emits ~22–28; `ab.assignment` publisher no-ops without Redpanda (`ab-events.ts:40–41`); chat-NLP Modal real but unfed; `platform-templates` = `[]`; `intent-ontology` stub | F-01, F-02, F-03, F-08                 |
| 2   | Migrations don't auto-apply                           | **Present (risk)**                    | Migrations live under `packages/db/migrations/`; STATUS/QUEUE repeatedly note manual CH/Postgres apply + FOLLOW-553 operator legs; code assumes tables like `adaptation_decisions`, `listing_embeddings`                                               | F-04                                   |
| 3   | Vercel fire-and-forget without `after()`              | **Absent (hardened)**                 | Shared `afterResponse()` wraps `next/server` `after()` (`lib/after-response.ts:19–28`); adapt/DSR/description sinks use it                                                                                                                             | —                                      |
| 4   | Double `/api/api`                                     | **Absent (fixed)**                    | Historical bug documented; `buildEndpoint` + comments in `intent-weights.ts:85`, `quiz-config.ts:145`; regression smoke exists                                                                                                                         | —                                      |
| 5   | Auth admin SSR (`getAuthClaims` vs SSR)               | **Mostly absent / residual**          | Browser session path uses `createServerClient` fallback in `session-auth.ts`; some API routes still `getAuthClaims` only (`dsr/initiate`, `listings/embed`) — OK if Bearer-only callers                                                                | F-12 (Low)                             |
| 6   | ClickHouse traps (empty user, grants, missing tables) | **Mitigated in code; prod uncertain** | Call sites default `CLICKHOUSE_USER ?? 'default'`; canary docs mention Code-516; prod table/grant state needs operator attestation (FOLLOW-553/404 class)                                                                                              | F-04                                   |
| 7   | Fabricated metrics on CH error                        | **Absent on configured path**         | `cta-lift/route.ts:343–358` + tests: CH set + fail → 500, no mock; mock only when URL unset with `data_source: 'mock'`                                                                                                                                 | —                                      |
| 8   | GDPR / consent                                        | **Mostly correct**                    | Consent mapping fixed (`events.ts:27–39`, `:76–78`); ingest gate classifies profiling/audit/operational; §H.9 opt-out skips profiling sinks but keeps stream (`consent-gate.ts` header comments; STATUS §H.9 table)                                    | F-13 (residual disclosure hygiene Low) |
| 9   | SQL-injection-shaped code                             | **Present (narrow)**                  | `admin/labels/route.ts:139–141` quote-escape + regex allowlist for `model_version`; tenant_id parameterized. Historical quote-only pattern documented as fixed elsewhere                                                                               | F-05                                   |
| 10  | Tenant isolation                                      | **Mostly present**                    | RLS migrations (`0012_rls_policies.sql` et al.); route-level `tenant_id` checks; ADR-0018 staff path uses explicit fences + tests. Residual: service-role staff paths need continued INV-5 discipline                                                  | F-06                                   |
| 11  | Baseline hygiene (any / prettier / secrets / bundle)  | **Mixed**                             | Bundle **under** 42 KB gzip per §Snapshot.1 (39.86 KB) — stale “93.3 KB” claim is wrong; `scripts/check-bundle-size.ts` is still a **placeholder**; Tier naming residue; Rule I ~190 dead-symbol warnings                                              | F-09, F-10                             |

---

## 5. Findings by Severity

### 5.1 Bugs & logic

**F-05 | Severity: Medium | Layer: Analytics / Infra**

- **File:** `apps/control-plane/src/app/api/admin/labels/route.ts:139–155`
- **What's wrong:** `model_version` is still interpolated into ClickHouse SQL via
  `replace(/'/g, "\\'")` behind a `^[\w. -]+$` allowlist. Tenant id is parameterized correctly;
  decision IDs are UUID-filtered.
- **Why it matters:** Same shape as the historical quote-escape class. Allowlist reduces risk today;
  any future relaxation reopens injection.
- **Proposed fix:** Bind `model_version` as a ClickHouse typed URL param like other routes. Effort:
  **S**.

**F-11 | Severity: Medium | Layer: Adaptation**

- **File:** `apps/control-plane/src/app/api/adapt/route.ts:1451–1474`,
  `packages/db/src/schema/listing_embeddings.ts:6–12`
- **What's wrong:** Cosine affinity is implemented, but missing embeddings fail-open to djb2 hash
  scores. Pilot `listing_embeddings` are documented empty outside demo seed.
- **Why it matters:** Card reorder looks “AI affinity” in the response
  (`score_function: 'archetype_affinity'`) while ranking is often deterministic hash. Silent quality
  degradation.
- **Proposed fix:** Seed pilot listings (FOLLOW-553 / embed path); emit explicit
  `score_function: 'djb2_fallback'` (or metric) when cosine not used; alert on high fallback rate.
  Effort: **M**.

### 5.2 Architectural / conceptual

**F-01 | Severity: Critical | Layer: Intent Engine**

- **Files:** `apps/stream-consumer/src/consumers/events.py:13–16,46–100`;
  `apps/ingest/src/redpanda-producer.ts:82–87`; `apps/intent-engine/src/main.py`;
  `apps/control-plane/.../adapt/route.ts:98–100,1504–1521`
- **What's wrong:** Server chat-NLP is a real Modal app (~650+ LOC across `nlp.py` + jobs), but
  production never feeds it: ingest Redpanda publish is a no-op; stream-consumer is the spawn
  bridge; even shadow reads do not change directives until `CHAT_NLP_LIVE=true` (C-07).
- **Why it matters:** Product story “chat questions reshape archetype” does not run server-side in
  prod. Only client Bayesian + quiz drive adaptation.
- **Proposed fix:** Mirror ADR-0016: invoke `process_chat_message` via direct Modal HTTPS from
  ingest or control-plane on `chat.message.sent` (or after CH write), bypassing Redpanda for pilot.
  Keep shadow flag until C-07. Effort: **L**.
- **Fix status (2026-07-21):** **CODE DRAFTED** on branch `cursor/adaptive-listings-code-audit-fb97`
  — `chat_nlp_endpoint` added to `apps/intent-engine/src/main.py`; ingest `dispatchChatNlp` +
  `waitUntil` on `chat.message.sent`. Still **OPERATOR-PENDING**: deploy Modal endpoint + set Worker
  secrets `MODAL_CHAT_NLP_URL` + `INTERNAL_API_SECRET`. Does not flip `CHAT_NLP_LIVE`.

**F-07 | Severity: High | Layer: Intent Engine**

- **Files:** `packages/intent-ontology/src/index.ts:14`; `packages/sdk/src/core/intent.ts:49–68`;
  `packages/shared/src/archetypes.ts:13–59`
- **What's wrong:** Design/ADR narrative wants a single ontology SoT; runtime SoT is SDK
  `ARCHETYPE_NAMES` with a hand-maintained shared copy + parity tests. Ontology package is still a
  version stub.
- **Why it matters:** Not currently divergent (parity tests exist), but the “intended” package is
  empty — future agents will reintroduce drift.
- **Proposed fix:** Either populate `intent-ontology` and generate both copies, or formally document
  SDK as SoT and retire the ontology package from the architecture diagram. Effort: **M**.

### 5.3 Missing pieces & dead ends (Rule H)

**F-02 | Severity: High | Layer: Analytics / Adaptation**

- **File:** `apps/control-plane/src/app/api/adapt/feedback/route.ts:262–269`
- **What's wrong:** Feedback endpoint returns 503 unless `FEEDBACK_ENDPOINT_ENABLED === 'true'`.
  Bandit weights stay uniform Beta(1,1) → Thompson sampling is random.
- **Why it matters:** A/B “learning” is theater in prod until the operator flag + canary prove a
  weight delta (Rule AA / FOLLOW-450).
- **Proposed fix:** Run Wave 0 operator checklist (`FOLLOW-553`): flip Doppler flag, provision keys,
  `pnpm feedback:canary`, paste attestation. Effort: **S** (ops) / code already landed.

**F-03 | Severity: High | Layer: SDK / Ingest**

- **Files:** `packages/shared/src/schemas/events/index.ts:201–261` (52 types); SDK emitters in
  `index.ts`, `observer.ts`, `events.ts`, `adapt.ts`, `adapt-description.ts`
- **What's wrong:** Roughly half the taxonomy has no production producer (e.g. `mouse.*`,
  `floorplan.*`, `price.*`, `search.query`, `chat.opened`, `listing.next`, `tour.requested`,
  `page.exit`, `tab.*`, `sidebar.closed`, most `photo.*` beyond dwell). Intent likelihood tables
  reference some of these (`intent.ts` `price.compared`) that never fire.
- **Why it matters:** Archetype accuracy ceiling is capped by missing signals; schema implies
  coverage that runtime lacks.
- **Proposed fix:** Prioritize high-discrimination emitters (photo gallery, price compare,
  chat.opened, page.exit) end-to-end; add CI that fails if a likelihood key has zero producer.
  Effort: **L**.

**F-08 | Severity: Medium | Layer: Infra**

- **Files:** `packages/platform-templates/src/templates/index.ts:30`;
  `apps/data-quality/src/main.py:22`
- **What's wrong:** Platform templates registry is empty (`[]`). `data-quality` entrypoint still
  returns `"status": "placeholder"` even though `crons/schema_validation.py` is real.
- **Why it matters:** L3 discovery is a no-op (mitigated by L1+L2). Placeholder `main.py` misleads
  status reads.
- **Proposed fix:** Either ship TICKET-032 templates or delete L3 from the “live” discovery story;
  make `get_service_info` reflect the cron. Effort: **S–L**.

**F-14 | Severity: Medium | Layer: Analytics**

- **File:** `apps/control-plane/src/lib/ab-events.ts:40–41`
- **What's wrong:** `publishAbAssignmentEvent` silently resolves when Redpanda URL missing. Holdout
  is still logged via `adaptation_decisions`, so lift can work — but the `ab.assignment` event type
  remains schema/bus theater.
- **Why it matters:** Dual sinks confuse “is assignment audited?” audits.
- **Proposed fix:** Also write `ab.assignment` into ClickHouse `events` (or drop the Redpanda
  publish from the critical narrative). Effort: **M**.

### 5.4 Performance & UX

**F-09 | Severity: Low | Layer: SDK**

- **Files:** `scripts/check-bundle-size.ts:25` (placeholder); §Snapshot.1 B.2: 39.86 KB gzip / 42 KB
  budget
- **What's wrong:** Automated budget gate is not implemented; stale Tier budgets in the script; the
  old “93.3 KB over budget” claim is an uncompressed conflation.
- **Why it matters:** Headroom is thin (~5%); without CI, regressions will land silently.
- **Proposed fix:** Implement TICKET-018 size-limit gate at 42 KB gzip; drop Tier labels. Effort:
  **S**.

**F-10 | Severity: Low | Layer: SDK / Docs**

- **Files:** `packages/sdk/src/index.ts:2`, `ui/sidebar-widget.ts:2`, many “Tier 1/2/3” comments;
  `scripts/check-bundle-size.ts` tier keys
- **What's wrong:** Tiers retired 2026-06-05 (§E.7); comments and scripts still teach the dead
  model.
- **Why it matters:** Agent/human confusion; not a runtime bug (`page_context` is analytics-only).
- **Proposed fix:** Mechanical rename sweep + CONVENTIONS note. Effort: **S**.

### 5.5 Privacy, security, compliance

**F-06 | Severity: Medium | Layer: Dashboard / Infra**

- **Files:** `packages/db/migrations/0012_rls_policies.sql`; ADR-0018 staff write chain
  (FOLLOW-592+)
- **What's wrong:** RLS exists on core tenant tables; staff/service-role paths bypass RLS by design
  and rely on application fences. Ongoing work (FOLLOW-608/597/598) hardens atomicity. Residual risk
  is process, not “no isolation.”
- **Why it matters:** Highest blast radius on bandit/intent-config staff writes.
- **Proposed fix:** Land FOLLOW-608 before FOLLOW-598; keep INV-5 tenant-filter tests mandatory.
  Effort: **M** (in queue).

**F-12 | Severity: Low | Layer: Dashboard**

- **Files:** `apps/control-plane/src/app/api/dsr/initiate/route.ts:80`;
  `listings/embed/route.ts:107`
- **What's wrong:** Some routes still use Bearer `getAuthClaims` only (correct for machine callers;
  wrong if ever called from browser cookie sessions).
- **Proposed fix:** Document caller class per route; use `getSessionAuthClaims` only where browsers
  call. Effort: **S**.

**F-13 | Severity: Low | Layer: Compliance**

- **What's wrong:** Historical Rule N disclosure mismatches (cross-session id, retention) were
  tracked as FOLLOW-139/140 class; §H.8/§H.9 code path looks correctly wired now. Residual: keep
  disclosures synced with sessionStorage/opt-out behavior.
- **Proposed fix:** Periodic DPIA↔code parity check in release checklist. Effort: **S**.

**F-04 | Severity: High | Layer: Infra**

- **What's wrong:** Merged SQL ≠ applied prod schema (Postgres + ClickHouse). Operator Wave 0
  (`FOLLOW-553` READY_OPERATOR) still owns CH migration attestation, secrets, embed seed, feedback
  canary.
- **Why it matters:** Code can be green while pilot metrics stay empty or queries fail.
- **Proposed fix:** Treat FOLLOW-553 as the single P0 before feature ports; paste prod
  DESCRIBE/SELECT evidence into QUEUE. Effort: **S–M** (ops).

### 5.6 LLM-generation integrity

**F-15 | Severity: Low (controls present) | Layer: Adaptation / LLM**

- **Files:** `apps/llm-gateway/src/jobs/generate_description.py:50–76,658–762`;
  `adapt/description/route.ts:444–452` (empty original → Sentry, skip generation); FOLLOW-465
  NEUTRAL negative-cache
- **What's wrong:** No critical hole found in design: fact whitelist + `<verified_facts_used>` +
  FIT/NEUTRAL gate + fail-loud empty original + no Redis write on truncation. Residual risk is model
  non-compliance (prompt-only enforcement, not a separate fact-checker against listing_context).
- **Why it matters:** Prompt discipline is strong; it is not a cryptographic guarantee.
- **Proposed fix:** Optional post-hoc numeric fact checker comparing output tokens to whitelist
  (reject/store NEUTRAL on mismatch). Effort: **M**.

---

## 6. Progress Against the Plan

**Sources used:**

- `docs/MASTER_DESIGN.md` §Snapshot.1 (v4.3, 2026-07-09)
- `backlog/QUEUE.md` (session 44 header, 2026-07-21)
- `STATUS.md` / `backlog/STATUS.md`
- Code HEAD on `main` at audit time

### 6.1 Plan-vs-reality table

| Plan item                     | Source           | True status                         | Evidence                                                             | Linked findings |
| ----------------------------- | ---------------- | ----------------------------------- | -------------------------------------------------------------------- | --------------- |
| Multi-tenant + RLS            | Snapshot A.2 / J | **Done**                            | tenants + `0012_rls_policies.sql`                                    | F-06            |
| Multi-region US/UK/UAE        | A.3              | **Not started**                     | Only EU provisioned (Snapshot)                                       | —               |
| SDK observer + DOM adapt      | B.1              | **Partially done**                  | Live adapt slots; Tier-3 Native deferred; Tier comments stale        | F-10            |
| SDK bundle ≤42 KB gzip        | B.2              | **Done** (gate missing)             | Snapshot 39.86 KB; script placeholder                                | F-09            |
| Platform adapters             | B.3              | **Not started**                     | No adapter code                                                      | —               |
| Auto-onboarding wizard        | B.4              | **Partially done**                  | Detect→activate E2E; Magic Link blocked                              | —               |
| Platform templates (15)       | B.4.4            | **Not started**                     | `templates = []`                                                     | F-08            |
| Schema discovery L1–L5        | B.5              | **Partially done**                  | L1+L2+L4 live; L3 empty                                              | F-08            |
| Continuous schema validation  | B.6              | **Done**                            | `schema_validation.py` 526 LOC                                       | F-08 (wrapper)  |
| Event ingest → CH             | C                | **Partially done**                  | CH path live; taxonomy half-empty; Redpanda dead                     | F-03, F-01      |
| Intent engine (18 archetypes) | D                | **Partially done**                  | Client Bayesian+quiz live; Modal chat dead in prod; ontology stub    | F-01, F-07      |
| DQS measurement               | D.5              | **Not started**                     | Snapshot design-only                                                 | —               |
| Adapt + A/B + bandit          | E.1–E.3          | **Done but broken** (prod learning) | Code wired; feedback 503-gated                                       | F-02            |
| Quiz widget v2.0              | E.4              | **Done**                            | Cascading tree + `applyQuizLeaf`                                     | —               |
| Placeholder resolution L2–7   | E.6              | **Partially done**                  | Level 1 only                                                         | —               |
| Description pipeline          | E.7              | **Done**                            | Live Modal + permanent cache + guards                                | F-15            |
| Archetype embedding space     | F                | **Partially done**                  | 18 archetype vectors seeded (claimed); listing vectors pilot-starved | F-11            |
| Compliance GDPR suite         | H                | **Done**                            | Consent + DSR + CH erase + §H.8/§H.9                                 | F-13            |
| Internal admin panel          | K                | **Partially done**                  | Live DB with mock fallback; tracer live; staff write ports in flight | F-06            |
| Pricing / billing UI          | L                | **Not started**                     | Design-only                                                          | —               |
| Pilot measurement go-live     | QUEUE FOLLOW-553 | **Partially done**                  | READY_OPERATOR; Steps incomplete                                     | F-02, F-04      |
| ADR-0018 staff writes         | QUEUE 592–600    | **Partially done**                  | 592–596/605/607 done; 608 in progress; 597/598 next                  | F-06            |
| decision-api retirement       | ADR-0006         | **Done** (Phase 1)                  | 410 Gone                                                             | —               |

### 6.2 Where you are now

You are past “scaffold” and past Sprint 0. Per §Snapshot.1 reconciled with code: **roughly 55–60% of
the Master Design implementation surface is truly complete end-to-end.**

What works as a product slice today:

- Onboard/detect → snippet → SDK signals → ingest → ClickHouse
- Client archetype (behavioral + quiz) → control-plane adapt → DOM + description LLM

What does **not** yet work as the brochure claims:

- Server chat-NLP → live adaptation
- Bandit learning from outcomes
- Reliable cosine listing affinity on the pilot tenant
- Full signal taxonomy

Active engineering focus (QUEUE session 44) is **staff admin write ports** (FOLLOW-608 → 609 → 597 →
598), which improves Estalara ops UX but does **not** unblock pilot measurement. The real pilot
unblocker remains **FOLLOW-553 Wave 0 (operator)**.

### 6.3 Next steps per QUEUE.md

**Queued order (current):** FOLLOW-608 (IN_PROGRESS) → FOLLOW-609 → FOLLOW-597 → FOLLOW-598 → …

**Recommended reorder for product truth:**

1. **FOLLOW-553 operator Wave 0** (feedback flag, CH attest, embed seed, secrets) — blocks
   F-02/F-04/F-11
2. **Chat-NLP direct Modal invoke** (new ticket or promote follow-up) — blocks F-01
3. Then resume ADR-0018 staff ports (608 already started — finish it, but do not prioritize 598 over
   Wave 0)
4. Signal enrichment emitters (F-03) before claiming accuracy numbers

### 6.4 Divergences

**Planned-but-missing:** multi-region; adapters; WP plugin; platform templates; DQS; ontology
package; Redpanda-backed stream path; Magic Link email.

**Built-but-unplanned / evolved:** ADR-0016 direct Modal description (bypasses Redpanda); CF Queue
CH retry (ADR-0017); client-side SoT archetype (ADR-0014); staff superadmin access (ADR-0018). These
are good adaptations — document them as the real architecture.

**Plan-code mismatches:** Snapshot.2 still mentions deleted Modal apps / old placeholders; README
“Sprint 0” is false; “93.3 KB bundle” is false; “intent-engine is 27-line stub” is false (code real,
**feed** dead); admin “100% mock” is stale post FOLLOW-593 (live with mock fallback).

---

## 7. Verdict & Recommended Next Steps

### Will it work as intended if finished on this foundation?

**Yes — with conditions.** The TypeScript edge path (SDK + control-plane + ClickHouse + Modal
description) is the right spine and already carries the differentiator for quiz/behavior-driven
adaptation. Continuing on this foundation is rational. It will **not** “just work” if you assume
Redpanda, stream-consumer, Modal chat-NLP, and bandit learning are already live — those are the
silent holes that make a pilot unmeasurable and chat-blind.

### Must-fix-before-pilot

1. Operator Wave 0 / FOLLOW-553 (feedback enable + CH attest + listing embed seed) — **F-02, F-04,
   F-11**
2. Rewire chat-NLP off Redpanda for pilot — **F-01**
3. Confirm lift dashboard shows ClickHouse `data_source: 'clickhouse'` on the pilot tenant — **trap
   7 / F-04**

### Nice-to-have (post first measured pilot)

- Broader event emitters (F-03)
- Ontology package consolidation (F-07)
- Bundle CI gate + Tier comment cleanup (F-09, F-10)
- Post-hoc LLM fact checker (F-15)
- Platform templates (F-08)

### Sequencing (reconciled with queue)

| Priority | Work                          | Why                                            |
| -------- | ----------------------------- | ---------------------------------------------- |
| P0       | FOLLOW-553 ops session        | Turns code-complete loops into measurable prod |
| P0       | Chat-NLP direct invoke ticket | Makes Modal intent-engine real in prod         |
| P1       | Finish FOLLOW-608 then 609    | Unblocks safe staff writes without duplication |
| P1       | FOLLOW-597 / 598 after 608    | Staff config; 598 only after feedback live     |
| P2       | Signal emitters + bundle gate | Accuracy + regression hygiene                  |

### Open questions for Piotr

1. Confirm prod Doppler: is `FEEDBACK_ENDPOINT_ENABLED` still unset? (Code defaults to 503.)
2. Confirm pilot tenant: any rows in `listing_embeddings`?
3. C-07 / `CHAT_NLP_LIVE`: do you want chat priors to move directives this pilot, or stay
   shadow-only after the feed is fixed?
4. Accept Redpanda as post-pilot? (ADR-0016 already did for descriptions — extend that ruling to
   chat-NLP?)
5. Is the next human calendar hour better spent on FOLLOW-553 ops than on FOLLOW-597 feature ports?

---

## 8. Appendix

### Files reviewed (primary)

- `docs/MASTER_DESIGN.md` (§Snapshot.1, version header)
- `docs/adr/ADR-0004`, `ADR-0005`, `ADR-0006`, `ADR-0014`, `ADR-0016`, `ADR-0017`, `ADR-0018`
- `CONVENTIONS_PATCH.md` (Rules H, K.2, AA, N, W)
- `backlog/QUEUE.md`, `STATUS.md`, `backlog/STATUS.md`
- `AUDIT_REPORT_INVESTOR_READINESS.md`, `AUDIT_IMPLEMENTATION_MAP.md`, `AUDIT_RISK_MATRIX.md`
  (historical)
- SDK: `packages/sdk/src/index.ts`, `core/intent.ts`, `observer.ts`, `events.ts`, `adapt.ts`,
  `adapt-description.ts`
- Shared: `packages/shared/src/archetypes.ts`, `schemas/events/index.ts`, `ab-holdout.ts`
- Ingest: `handlers/events.ts`, `redpanda-producer.ts`, `clickhouse-producer.ts`, `consent-gate.ts`
- Control-plane: `api/adapt/route.ts`, `api/adapt/description/route.ts`,
  `api/adapt/feedback/route.ts`, `api/pilot/cta-lift/route.ts`, `lib/ab-events.ts`,
  `lib/after-response.ts`, `admin/tenants/data.ts`, `api/admin/labels/route.ts`
- Decision-api: `api/adapt/route.ts` (410)
- Modal: `apps/intent-engine/*`, `apps/llm-gateway/src/jobs/generate_description.py`,
  `apps/stream-consumer/src/consumers/events.py`, `apps/data-quality/*`
- Stubs: `packages/intent-ontology`, `packages/platform-templates`

### Files NOT reviewed (why)

- Full Terraform / multi-region infra manifests (out of critical path; Snapshot already marks
  design-only)
- Every control-plane dashboard page UI polish
- Pilot SvelteKit host `app.estalara.com` source (not in this monorepo)
- Entire `backlog/RETROSPECTIVES.md` history (sampled via conventions + QUEUE)
- Production Doppler/Vercel env values (cannot be read from repo — called out as open questions)
- Live p95 latency under load (static audit only)

### Glossary

| Term                      | Meaning                                                                 |
| ------------------------- | ----------------------------------------------------------------------- |
| Canonical adapt           | `apps/control-plane` `/api/adapt` (ADR-0004/0006)                       |
| SoT archetype             | Latest non-neutral archetype (ADR-0014); IDs from SDK `ARCHETYPE_NAMES` |
| Rule H                    | Schema/scaffold must ship with a runtime consumer                       |
| Rule K.2                  | Decision surfaces fail loud — never fabricate metrics                   |
| Rule AA                   | Operator-gated tickets are not “DONE” until prod attestation            |
| CHAT_NLP_LIVE             | Env flag; false = shadow chat intent does not change directives         |
| FEEDBACK_ENDPOINT_ENABLED | Env flag; false = bandit feedback 503                                   |
| djb2 fallback             | Hash-based listing affinity when embeddings missing                     |
| Wave 0                    | FOLLOW-553 operator go-live checklist                                   |

---

_End of report. Offer: (a) deep-dive any finding ID, (b) draft the fix for a must-fix item, (c)
produce a sequenced plan merging findings with the remaining QUEUE._
