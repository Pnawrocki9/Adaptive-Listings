# Data Protection Impact Assessment (DPIA)

**Document ID:** ESTALARA-DPIA-001 **Version:** 2.10 **Date:** 2026-07-17 **Authors:** Time2Show,
Inc. — Compliance Engineering **DPO Review Status:** External DPO appointment in progress
(DPO-as-a-Service provider). Placeholder contact: compliance@estalara.com **Next Mandatory Review
Date:** 2027-05-15 (annual) or upon any material change to processing described herein (see
"Material Change Triggers" in ROPA Appendix C), whichever is sooner. **Classification:** Internal —
Restricted

---

## Table of Contents

1. Executive Summary
2. System Description and Processing Description
3. Necessity and Proportionality
4. Risk Assessment
5. Mitigations and Residual Risk Summary
6. Jurisdictional Addenda
7. Consent Strategy
8. Data Subject Rights
9. Cross-Border Transfer Mechanisms
10. Consultation Record
11. Revision History
12. Appendix — AI Act FRIA Threshold Analysis

---

## 1. Executive Summary

Estalara Adaptive Listings (the "Estalara product") is an embeddable AI personalization layer for
real estate websites, operated by **Time2Show, Inc.** (a Delaware C-corporation registered at 1111B
S Governors Ave Ste 20579, Dover, DE 19904-6903, United States). It captures behavioral signals —
scroll depth, click events, listing view events, and optional chat-based intent queries — from
visitors to tenant-operated property listing websites, and uses those signals to adapt how listings
are presented in real time to each pseudonymous visitor. The system operates across three
integration tiers (Observer, Augment, and Native), processes data in four geographic regions (EU,
US, UK, UAE), and is delivered as a software-as-a-service product used by real estate agencies
(tenants).

**Data classification**: Visitor identity is represented solely by a session-scoped HMAC hash that
rotates on tab close or thirty minutes of idle time. The system never reads cookies, never stores
login credentials, and never requires user registration. Time2Show does not collect directly
identifying information (names, emails, phone numbers, government identifiers, addresses) about
visitors. However, **pseudonymous session identifiers constitute personal data under GDPR art. 4(1)
read with Recital 26**, as confirmed by EDPB Guidelines 02/2023 on technical scope of Art. 5(3) of
the ePrivacy Directive (finalized October 2024) and consistent CJEU case law (Breyer C-582/14). The
data processed is therefore **pseudonymous personal data**, not the absence of personal data.

**Establishment**: Time2Show, Inc.'s Chief Executive Officer is a Polish citizen and tax resident,
resident in Poland, from where he directs the business operations of the Company including
determinations of the purposes and means of personal data processing. Pursuant to GDPR Article 3(1),
Recital 22, and EDPB Guidelines 3/2018, this establishes Time2Show as having an establishment in the
Union. GDPR applies to Time2Show under art. 3(1), and the **Urząd Ochrony Danych Osobowych (UODO,
Poland)** is identified as the **Lead Supervisory Authority** under the one-stop-shop mechanism of
art. 56 GDPR. Under UK GDPR, Time2Show has no UK establishment and therefore requires a UK
representative under UK GDPR art. 27 (appointment in progress).

**DPIA legal basis**: This DPIA is required under Article 35(3)(c) of the General Data Protection
Regulation (EU) 2016/679 because Time2Show engages in systematic monitoring of behavior of data
subjects on a publicly accessible area (real estate listing websites) on a large scale. The
behavioral fingerprinting technique employed — combining canvas hash, AudioContext hash, screen and
viewport parameters, timezone, language, and WebGL renderer attributes into a session-keyed HMAC —
constitutes "access to information stored in terminal equipment" within the meaning of Article 5(3)
of Directive 2002/58/EC (ePrivacy Directive), and processing of personal data within the meaning of
GDPR because a session-scoped pseudonymous identifier constitutes personal data under Article 4(1)
when associated with online behavior. EDPB Guidelines 02/2023 on technical scope of Art. 5(3) of
ePrivacy Directive (adopted 14 November 2023, finalised in October 2024) confirm that fingerprinting
is covered by ePrivacy Article 5(3) regardless of whether cookies are used.

**DPIA triggering analysis under UODO/ICO/CNIL obligatory DPIA lists**: The processing meets
criteria from multiple supervisory-authority lists of mandatory DPIAs:

- **UODO Communication of 17 June 2019** on the list of processing operations requiring DPIA (issued
  under GDPR art. 35(4)): operations involving (i) systematic and extensive evaluation of natural
  persons through automated processing, including profiling, (ii) processing on a large scale, (iii)
  systematic monitoring of publicly accessible areas, (iv) use of new technological solutions. The
  Estalara product engages criteria (i), (ii), (iii), and (iv).
- **ICO list of operations requiring DPIA**: includes "innovative technology", "tracking of
  individuals' geolocation or behaviour", and "profiling at scale". The Estalara product engages all
  three.
- **CNIL list of processing operations subject to mandatory DPIA**: includes processing involving
  innovative use of technologies, profiling at scale, and behavioural monitoring. Engaged.

This document identifies the necessity and proportionality of that processing, assesses its risks,
documents the mitigations in place, and serves as the controller's record of the DPIA process under
art. 35(7) GDPR.

**Production status**: The Estalara product is in a **hybrid pilot deployment** phase as of the date
of this DPIA — a limited number of pilot tenants are processing real visitor data in production,
with the platform ready for broader scaling. This DPIA must be re-reviewed prior to scaling beyond
the current pilot cohort, per Risk E (Regulatory Enforcement) treatment below.

---

## 2. System Description and Processing Description

### 2.1 Integration Tiers

The Estalara product operates in three integration tiers:

- **Tier 1 Observer:** A read-only sidebar or floating widget injected into tenant websites via a
  JavaScript snippet. Observes visitor behavior (scroll, click, listing view, chat input). Makes no
  DOM mutations to the host page. Sends batched behavioral events to the Estalara ingest endpoint.
- **Tier 2 Augment:** Declarative DOM slot mutations — headline text, photo order, feature
  highlights — driven by adaptation directives returned by the Estalara Decision API. Requires
  tenant to declare slot identifiers. Light mutation of host page content.
- **Tier 3 Native:** A full `<EstalaraListing/>` Preact component owned and rendered by the Estalara
  SDK, embedding the entire listing experience including adaptive UI. Maximum personalization
  capability; tenant delegates full listing display to the Estalara product.

All tiers share the same ingest pipeline, privacy controls, and lawful basis regime. Behavioral data
is processed identically regardless of integration tier.

### 2.2 Consent Modes

Per Master Design section G.2, every tenant session operates in exactly one of three consent modes
determined at session initialization:

- **Mode A — Session Mode (default):** The session fingerprint hash is computed per-session using
  `HMAC(tenant_secret, fingerprint_entropy, day_bucket)`. The hash rotates on tab close or thirty
  minutes of idle time. Cross-session linking is technically impossible because the day bucket
  changes. Cross-tenant correlation is impossible because the tenant secret differs per tenant. This
  mode relies on the ePrivacy Directive Article 5(3)(b) "strictly necessary" exemption for services
  explicitly requested by the user. It does not require a consent banner. Data is scoped to one
  session on one tenant site.
- **Mode B — Consented Mode:** Tenant collects explicit user consent via the Estalara Consent Helper
  or their own CMP, and passes a verified consent record to the Estalara backend via API. Full
  behavioral fingerprint with ninety-day persistence is enabled. Cross-listing journeys within a
  declared partner group are permitted. Sessions in Mode B contribute to global archetype training
  (with differential privacy protections applied).
- **Mode C — Legitimate Interest Mode:** Narrow use cases only, such as duplicate listing spam
  detection. Not permitted for marketing personalization per EDPB Guidelines on legitimate interests
  and CNIL enforcement guidance. This mode is tenant-configurable but subject to a documented
  Legitimate Interest Assessment.

### 2.3 System Components

| Component                | Technology                                         | Function                                                                                         | Data Processed                                                                                                                              |
| ------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| JavaScript SDK           | TypeScript 5 + Preact 10, Shadow DOM               | Behavioral signal capture and session fingerprinting                                             | Canvas hash, AudioContext hash, screen/viewport/timezone/language, WebGL renderer attributes                                                |
| Edge Ingest              | Cloudflare Workers (regions: fra/lhr/iad/dxb)      | Event validation, HMAC auth, batching to event bus                                               | Behavioral event payloads, session_id hash, tenant_id                                                                                       |
| Event Bus                | Redpanda Cloud (Kafka-compatible)                  | Durable ordered delivery of behavioral events                                                    | Same as Edge Ingest                                                                                                                         |
| Intent Engine            | Modal (Python), current-gen Claude (Haiku)         | Intent extraction, embedding computation                                                         | Behavioral event sequence, session embedding vector                                                                                         |
| Session Embeddings Store | Supabase (Postgres 16) per-region                  | Per-session 1024-dim embedding + archetype match                                                 | session_id, tenant_id, embedding vector, matched archetype                                                                                  |
| Global Archetype Store   | Supabase + pgvector                                | Cross-tenant DP-aggregated archetype centroids                                                   | DP-anonymized embedding vectors; no session_id, no tenant_id                                                                                |
| Adaptation Engine        | Modal (Python), current-gen Claude (Sonnet)        | Listing adaptation directive generation                                                          | Session embedding, archetype label, listing metadata                                                                                        |
| Decision API             | Next.js 15 Edge Runtime on Vercel                  | Returns JSON adaptation directives in real time                                                  | session_id, archetype, adaptation variant                                                                                                   |
| ClickHouse Cloud         | ClickHouse (event store)                           | Immutable adaptation decision log, analytics                                                     | session_id, archetype, directive type, holdout_group, timestamps                                                                            |
| Consent Records          | Supabase (Postgres 16)                             | Consent state storage                                                                            | session_id, consent_type, granted boolean, encrypted ip_address                                                                             |
| Engagement Score Store   | Supabase (Postgres 16) per-region                  | Per-session engagement intensity score (Sole Controller — see Joint Controller analysis in ROPA) | session_id, engagement_score, component features                                                                                            |
| DSR Queue                | Control Plane API + Postgres                       | Data subject request processing                                                                  | DSR type, session_id or fingerprint_hash, jurisdiction                                                                                      |
| Control Plane            | Next.js 15 App Router on Vercel                    | Tenant dashboard, configuration, analytics, billing                                              | Tenant admin email, billing info, usage metrics                                                                                             |
| Cache                    | Upstash Redis (multi-region)                       | Session intent vector cache, adaptation cache                                                    | session_id → embedding vector (TTL-bounded)                                                                                                 |
| LLM Provider             | Anthropic API (current-gen Claude models)          | Intent extraction prompts, adaptation reasoning                                                  | Behavioral context strings; no direct PII per DPA                                                                                           |
| Embeddings Provider      | OpenAI API (text-embedding-3-small)                | 1024-dim embedding generation                                                                    | Behavioral signal text; no direct PII per DPA                                                                                               |
| Error Tracking           | Sentry                                             | Error and performance monitoring                                                                 | Stack traces, request context. Redaction is partial and NOT uniform across apps — see §Sentry redaction scope (FOLLOW-739)                  |
| CRM Outcome Ingest       | Next.js 15 control plane (`POST /api/crm/outcome`) | Receive tenant CRM outcome labels via authenticated webhook; upsert into `conversion_labels`     | `prediction_id` (UUID), `outcome_class`, `label_source`, `lead_id` (pseudonymous), `outcome_raw` (JSONB, PII-stripped per DPA), `tenant_id` |

References to "current-gen Claude models" reflect the operational practice of selecting Claude Haiku
and Claude Sonnet at the model-tier level, with specific version selection (e.g., Claude Haiku 4.5,
Claude Sonnet 4.6) managed at the application configuration layer. A minor version update does not
trigger a DPIA re-assessment; a major architectural change in the LLM provider relationship (e.g.,
switching providers, adding self-hosted inference, removing zero-retention clause) does.

### 2.4 Data Flows

1. Visitor arrives at tenant website. SDK loads in Shadow DOM.
2. SDK computes session fingerprint from browser attributes; hashes with
   `HMAC(tenant_secret, entropy, day_bucket)`. No hash is stored client-side beyond the current
   session.
3. Behavioral events (scroll, click, listing_view, chat_message) are batched every two seconds and
   sent to the nearest Cloudflare Worker ingest endpoint via HTTPS.
4. The Worker validates the event against Zod schemas, authenticates via HMAC-signed API key, and
   publishes to Redpanda. Ingest ACK returns within fifty milliseconds p95.
5. Redpanda delivers events to the Intent Engine (Modal). Intent Engine computes or updates the
   session embedding vector and stores it in `session_embeddings` (Postgres).
6. Decision API reads the embedding, matches against global archetype space via cosine similarity,
   applies Thompson sampling A/B weights from `ab_bandit_weights`, and returns adaptation directives
   as JSON.
7. SDK or Tier 2/3 integration applies directives to the listing presentation.
8. Adaptation decision is logged to ClickHouse (`adaptation_decisions` table, thirteen-month
   retention).
9. Engagement Score (Time2Show as Sole Controller — see ROPA Joint Controller analysis) is computed
   per session from behavioral features and stored in `engagement_scores` table.
10. On session expiry (tab close or thirty-minute idle), session state is released from Redis cache.
11. Nightly batch job applies k-anonymity (k≥50) and Differential Privacy (ε≤2 per epoch) to
    aggregate session embeddings into global archetype centroids. Aggregation output contains no
    session_id, no tenant_id, no PII.

### 2.5 Data Types and Retention

| Data Type                                                                   | Store                                      | Retention                                                                                                                                    | Basis                                       |
| --------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Behavioral event payload (scroll, click, view)                              | Redpanda (transient)                       | Session scope; purged after Intent Engine consumption                                                                                        | Processing necessity                        |
| Session fingerprint hash (session_id)                                       | Redis cache, Postgres (session_embeddings) | 30 min idle + tab close (Redis); 90 days from last active event (Postgres)                                                                   | Processing necessity; ePrivacy 5(3)(b)      |
| Session embedding vector (1024-dim)                                         | Postgres: `session_embeddings`             | 90 days from last active event                                                                                                               | LI — intent matching                        |
| Engagement Score (planned; no producer built as of 2026-07-17 — FOLLOW-582) | Postgres: `engagement_scores`              | 90 days from last active event (retention applies once a producer exists)                                                                    | LI — Time2Show as Sole Controller           |
| Archetype match and adaptation decisions                                    | ClickHouse: `adaptation_decisions`         | 13 months (AI Act audit trail per Master Design H.2)                                                                                         | Legal obligation + LI                       |
| LLM call records                                                            | ClickHouse: `llm_calls`                    | 13 months                                                                                                                                    | Audit, model improvement                    |
| Consent records                                                             | Postgres: `consent_records`                | 3 years from consent event                                                                                                                   | Legal obligation (Art. 6.1.c)               |
| DSR tokens                                                                  | Postgres: `dsr_tokens`                     | 30 days from DSR resolution                                                                                                                  | Legal obligation                            |
| A/B bandit weights                                                          | Postgres: `ab_bandit_weights`              | Retained (anonymized — no session_id)                                                                                                        | Legitimate interest                         |
| Global archetype embeddings                                                 | Postgres: `archetype_embeddings`           | Indefinite (no personal data post-DP-aggregation)                                                                                            | Legitimate interest                         |
| Tenant configuration and admin contact                                      | Postgres: `tenants`, `users`               | Contract duration + 7 years                                                                                                                  | Art. 6.1.b (contract)                       |
| Billing records                                                             | Postgres + Stripe                          | Contract duration + 7 years                                                                                                                  | Legal obligation                            |
| Staff audit log                                                             | Postgres: `staff_audit_log`                | 7 years                                                                                                                                      | Legal obligation + Art. 6.1.c               |
| LLM prompt content (Anthropic)                                              | Not retained by Anthropic per DPA          | Zero retention (DPA clause required)                                                                                                         | Processor DPA                               |
| CRM outcome labels (`conversion_labels`)                                    | Postgres: `conversion_labels`              | 13 months from `labeled_at`, enforced by daily Vercel cron at `/api/internal/retention/conversion-labels` (FOLLOW-234 / PR #230, 2026-06-08) | LI (model calibration + AI Act audit trail) |

### 2.6 Third-Party Processors

| Processor        | Role                                           | Data Category                                      | DPF Status                                         | DPA Status                                           |
| ---------------- | ---------------------------------------------- | -------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------- |
| Anthropic        | LLM inference (current-gen Claude models)      | Behavioral context prompts (no PII)                | Verified annually at dataprivacyframework.gov/list | DPA in place — zero-retention clause                 |
| OpenAI           | Embedding computation (text-embedding-3-small) | Behavioral context text (no PII)                   | Verified annually at dataprivacyframework.gov/list | DPA in place — zero-retention clause                 |
| Cloudflare       | Edge ingest, CDN, Workers                      | Event payloads, session_id, IP address (transient) | Certified (EU-U.S. DPF + UK Extension)             | DPA in place (Cloudflare Enterprise DPA)             |
| Supabase         | Postgres (per-region projects)                 | All Postgres tables listed in 2.5                  | Verified annually at dataprivacyframework.gov/list | DPA in place — per-region projects (EU, US, UK, UAE) |
| ClickHouse Cloud | Event store                                    | adaptation_decisions, llm_calls                    | Verified annually at dataprivacyframework.gov/list | DPA in place                                         |
| Upstash          | Redis cache (multi-region)                     | Session intent vectors (TTL-bounded)               | Verified annually at dataprivacyframework.gov/list | DPA in place                                         |
| Modal            | ML compute (serverless)                        | Embedding computation, archetype update jobs       | Verified annually at dataprivacyframework.gov/list | DPA in place                                         |
| Redpanda Cloud   | Event bus                                      | Behavioral event payloads (transient)              | N/A (EU instance)                                  | DPA in place                                         |
| Vercel           | Control plane hosting                          | Tenant admin sessions, dashboard traffic           | Certified (EU-U.S. DPF)                            | DPA in place (Vercel DPA)                            |
| Sentry           | Error and performance tracking                 | Stack traces, request context (see redaction note) | Verified annually at dataprivacyframework.gov/list | DPA in place (Sentry DPA)                            |
| Stripe           | Billing and payment processing                 | Tenant billing details, invoices                   | Verified annually at dataprivacyframework.gov/list | DPA in place (Stripe DPA)                            |

**Transfer mechanism layering**: Where a US-based sub-processor is DPF-certified, DPF is the primary
transfer mechanism for EU→US flows. SCCs (Module 2 Controller-to-Processor) and a Transfer Impact
Assessment are maintained contractually in each DPA as a fallback in the event of DPF lapse,
withdrawal, or invalidation. This dual-mechanism approach is consistent with EDPB guidance and
provides continuity of lawful transfer basis. UK→US transfers use the UK Extension to the EU-U.S.
DPF (where the sub-processor is so certified) with UK IDTA as fallback. UAE→US transfers use UAE
PDPL Art. 22 SCCs (UAE has no DPF participation).

### 2.7 Sentry redaction scope — partial, per-app, and no PII-pattern matching (FOLLOW-739)

Earlier revisions of this DPIA described Sentry data as "scrubbed of PII via SDK `beforeSend` hook;
CI-verified", which implied a uniform, pattern-based control across the whole sub-processor
relationship. **That was inaccurate on both counts.** Corrected 2026-08-04 against the code. Four
applications emit to Sentry and they are not treated alike:

| App                                                                             | Redaction in force                                                                                            | Covers                                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `apps/intent-engine` + Rule-J mirrors (`apps/llm-gateway`, `apps/data-quality`) | `_scrub_chat_intent_exception_value` (`observability.py`) — blanket overwrite of the exception `value` string | ONLY events tagged `area=chat_intent`, ONLY that one field |
| `apps/control-plane` (Next.js)                                                  | **None** — no `beforeSend`, no scrubbing, `sendDefaultPii` not set                                            | —                                                          |

Two clarifications that matter for an accurate record:

1. **There is no PII-pattern regex anywhere in the estate.** The Python hook does not scan for PII
   shapes; it unconditionally replaces one field on events carrying one tag. Breadcrumbs, `extra`,
   `request` and `contexts` are never modified on any path, in any app.
2. **"CI-verified" named the wrong artifact.** `scripts/check-sentry-init-singleton.sh` (wired into
   `ci.yml`) is an init-bypass guard and does not inspect the hook's contents. The behaviour is
   pinned by `apps/intent-engine/src/test_observability.py` (pytest, normal CI matrix), which
   includes a buyer-text sentinel assertion.

**Residual risk for `apps/control-plane` — assessed and accepted.** Raw buyer chat text does not
enter that application, so there is no message content available for a scrubber to remove: chat
intent arrives already **derived** (`lib/chat-intent-cache.ts` reads Modal's dimension vector from
Redis; raw `messages` is not a field on the payload model), LLM prompts are assembled from
archetype, playbook copy, behavioural **event labels** and agency-curated listing metadata
(`LlmGatewayInput`), and every capture site's `extra`/`contexts` carries identifiers and status
values only (`tenant_id`, `listing_id`, `archetype`, `session_id`, HTTP status, table, window).
Verified by grep over `apps/control-plane/src`, not assumed.

The accepted boundary: control-plane is unscrubbed **by construction, not by control** — no
mechanism prevents a future change from routing buyer text into a captured exception. Whether it
should get its own hook is tracked as **FOLLOW-811**, deliberately out of scope here.

---

## 3. Necessity and Proportionality

### 3.1 Purpose Specification

Time2Show, Inc. processes behavioral signals exclusively for the purpose of real-time
personalization of real estate listing presentations through the Estalara product. The specific
objectives are: (a) inferring the likely property-type intent of a pseudonymous visitor (the
"archetype" — e.g., family buyer, investment buyer) from behavioral signals without requiring
registration or login; (b) adapting the order, emphasis, and framing of listing information to match
that inferred intent; (c) improving archetype detection accuracy over time through
privacy-preserving cross-tenant aggregation; and (d) computing an Engagement Score (Time2Show as
Sole Controller) for product analytics and tenant-surface visitor engagement reporting.

**Platform-wide consent umbrella (CEO decision 2026-06-21 — FOLLOW-373):** For the app.estalara.com
pilot, Adaptive-Listings owns the full consent layer for the entire Estalara platform. Consent is
mandatory at app.estalara.com registration; without granting consent the investor cannot register or
use chat. The Adaptive-Listings consent layer must disclose and lawfully cover all six processing
purposes enumerated in §H.8 of the Master Design and in §13.4 of this DPIA:

| #   | Purpose                      | Description                                                                             |
| --- | ---------------------------- | --------------------------------------------------------------------------------------- |
| (a) | Behavioral tracking          | Scroll depth, dwell time, click patterns, listing-view rate, quiz answers               |
| (b) | Reading investor chat        | Chat messages read to extract buying-intent signals; raw text stored APP-SIDE only      |
| (c) | Transfer to agency/agent     | Derived behavioral insights (archetype, confidence) shared with the listing agency      |
| (d) | Buying-intent identification | 12-dimensional intent vector (24 h TTL, no free text) from behavioral signals + chat    |
| (e) | Lead ranking                 | Investors ranked by buying-intent strength for agent prioritization                     |
| (f) | Agent-facing chat summaries  | Summaries of questions asked in LIVE chat and Estalara AI chat surfaced to agency staff |

**C-07 boundary (binding — must never be violated):** Raw chat text is stored APP-SIDE only
(app.estalara.com). Adaptive-Listings stores only the 12-dimensional intent vector with a 24-hour
TTL — no free text, no message content. This is verified in shipped code: `schemas.py`, class
`ChatIntentDetectedPayload` (its fields contain no `messages` or `raw_text` field) and
`redis_writer.py` (`payload.model_dump()` serializes only `ChatIntentDetectedPayload`). Since
FOLLOW-730 that payload also carries `data_source` and `extraction_error` — extraction provenance
(an enum, plus an exception CLASS name with the message deliberately excluded), not buyer content,
so the boundary above is unchanged. See also the C-07 scoping brief
(`docs/compliance/C-07-chat-retention-scope.md`).

### 3.2 Why Behavioral Signals Are the Minimum Required

A visitor browsing a real estate website without logging in leaves no profile. Traditional
personalization either requires login (creating PII obligations and friction that drives visitors
away) or cookie-based cross-site tracking (now blocked by Safari ITP, Firefox ETP, and Brave by
default, and legally restricted across all operating jurisdictions). The Estalara product's design
was chosen because:

- Behavioral signals (scroll depth to certain sections, dwell time on price vs. floor plan, click
  patterns on listing photos) are the minimum data sufficient to detect property-type intent at
  session resolution.
- A session-scoped HMAC fingerprint is the minimum identifier needed to link events within a single
  visit; a persistent identifier (cookie, IP, login) would be a more privacy-invasive alternative.
- The k-anonymity and Differential Privacy applied to global archetype training ensure that
  cross-tenant signal aggregation does not enable individual re-identification.
- No personally identifying fields (name, email, phone, ID numbers, addresses) are collected,
  transmitted, or stored at any layer.

### 3.3 Data Minimization Measures

The following measures implement data minimization as required by GDPR Article 5(1)(c):

- **Session-scoped HMAC rotation:** The session identifier changes at every tab close and every
  thirty minutes of idle time. After rotation, there is no technical mechanism to link the new
  session to the previous one within the Estalara product (the HMAC key incorporates a day_bucket;
  even within the same calendar day, tab close resets the session).
- **No directly identifying fields in event schema:** The Estalara ingest Zod schema enforces a PII
  blocklist. Fields containing email, name, phone, or national identification patterns are rejected
  at the Edge Ingest layer. The schema is validated in CI.
- **k-anonymity requirement (k≥50):** An archetype centroid is published to the global archetype
  store only if at least fifty unique sessions from at least three distinct tenants contributed to
  the cluster. Sessions that form a cluster of fewer than fifty are suppressed.
- **Differential Privacy (ε≤2 per epoch):** Gaussian noise scaled to the DP-SGD privacy budget is
  added to embedding updates during the nightly archetype aggregation job. The cumulative privacy
  budget is tracked per epoch and reset annually. This provides a formal mathematical guarantee that
  no individual session's contribution to an archetype centroid can be reverse-engineered.
- **No raw personal data in global store:** The global `archetype_embeddings` table contains only
  aggregate embedding vectors and metadata (archetype name, confidence threshold, sample count). No
  session_id, no tenant_id, no personal data of any kind.
- **Consent-aware aggregation:** Sessions in Mode A (Session Mode) contribute only to tenant-local
  archetype matching and not to global cross-tenant training. Only Mode B (Consented) sessions
  contribute to the global archetype space. This ensures that cross-tenant aggregation is
  underpinned by explicit consent.

### 3.4 CNIL Guidance on Legitimate Interest for AI Development

CNIL published guidance in June 2025 (Recommendations on relying on legitimate interests to develop
AI systems) confirming that commercial entities may invoke legitimate interest under GDPR Article
6(1)(f) for AI model development purposes, subject to a balancing test. The Time2Show / Estalara
Legitimate Interest Assessment documents: (a) the legitimate interest pursued (real-time listing
personalization and archetype model improvement); (b) the necessity of behavioral processing for
that interest; and (c) the balancing test (data subjects browsing property listings have a
reasonable expectation of receiving a personalized experience; the data is pseudonymous and
session-scoped; the impact on their rights and freedoms is minimal given the k-anonymity and DP
safeguards). Full LIA is maintained in `docs/compliance/lia-template.md` (produced under
TICKET-GDPR-003).

### 3.5 Purpose Limitation

Behavioral data is used only for listing personalization, archetype model improvement, and
Engagement Score computation. It is never used for: targeted advertising outside the tenant website;
credit scoring; employment decisions; insurance underwriting; political profiling; or any purpose
beyond real estate listing presentation optimization. Tenant DPAs prohibit secondary use. Anthropic
and OpenAI DPAs include zero-retention clauses for prompt content.

---

## 4. Risk Assessment

The following five risks are identified as material. Each is assessed on likelihood (Low / Medium /
High) and inherent severity (Low / Medium / High) before mitigation. The framework draws from the
internal Legal Risk Assessment methodology (severity × likelihood matrix with GREEN/YELLOW/ORANGE/
RED classification).

### Risk A — Re-identification via Fingerprint Cross-Correlation

**Description:** A sophisticated adversary (including a tenant, a third-party analytics provider
injected on the same page, or a law enforcement agency) could attempt to cross-correlate Estalara
session fingerprints with external data sources (browser fingerprinting databases, IP geolocation,
timing side-channels) to re-identify individual visitors.

**Likelihood (pre-mitigation):** Medium. Browser fingerprinting accuracy degrades below fifty
percent after twenty-four hours due to Safari ITP, Firefox ETP, and Brave farbling (Kochava
research, 2024). Cross-session re-identification requires access to both the raw fingerprint entropy
and the tenant secret used in the HMAC; the tenant secret is stored server-side only.

**Severity (pre-mitigation):** High. Re-identification of property browsing behavior could reveal
sensitive information about an individual's financial situation, family composition, or place of
intended residence.

**Mitigations:**

- HMAC with tenant-secret: the session hash cannot be reverse-engineered without the tenant secret,
  which is stored exclusively in Doppler / environment secrets and never transmitted to the client.
- Day-bucket rotation: even with the tenant secret, an adversary cannot link sessions across days.
- k-anonymity (k≥50) on all cross-tenant aggregations prevents statistical re-identification from
  global data.
- Differential Privacy (ε≤2) provides formal mathematical re-identification resistance at the global
  archetype layer.
- Tenant-isolated data storage: RLS policies prevent any tenant from querying another tenant's
  session data.

**Residual Likelihood:** Low. **Residual Severity:** Medium. **Residual Risk:** LOW-MEDIUM
(GREEN-YELLOW band).

### Risk B — Cross-Border Data Transfer Exposure

**Description:** Behavioral data processed in EU and UK regions is transmitted to US-based
processors (Anthropic API, OpenAI embeddings API) for LLM inference and embedding computation.
Following the Schrems II judgment (Data Protection Commissioner v. Facebook Ireland, Case C-311/18),
transfers to US entities that are subject to US surveillance laws (FISA 702, EO 12333) carry a
residual risk that SCCs alone may be insufficient without supplementary measures.

**Likelihood (pre-mitigation):** Medium. The EU-U.S. Data Privacy Framework (DPF), implemented by
Commission Implementing Decision (EU) 2023/1795 of 10 July 2023, provides an adequacy decision for
DPF-certified US entities. The General Court of the European Union upheld the DPF in case T-553/23
Latombe on 3 September 2025, dismissing the first judicial challenge. However, this decision may be
appealed to the CJEU, and NOYB has indicated intent to bring a broader "Schrems III" challenge.
Concerns persist regarding U.S. executive-branch developments affecting the independence of the
Privacy and Civil Liberties Oversight Board and the Data Protection Review Court — both integral to
the DPF's redress prong.

**Severity (pre-mitigation):** Medium. The data transferred is pseudonymous behavioral context
without direct identifiers; even if intercepted, it does not directly identify individuals. However,
because pseudonymous data is personal data, the transfer remains subject to GDPR Chapter V.

**Mitigations:**

- **EU-U.S. Data Privacy Framework** (primary mechanism for DPF-certified sub-processors):
  Cloudflare and Vercel are confirmed DPF-certified. Anthropic, OpenAI, Stripe, Sentry, Upstash,
  ClickHouse, Modal, and Supabase status is verified at https://www.dataprivacyframework.gov/list
  and tracked in `docs/compliance/REGULATORY_WATCH.md`. Where confirmed, DPF serves as the primary
  transfer mechanism per Commission Implementing Decision (EU) 2023/1795.
- **Standard Contractual Clauses (Module 2, Controller-to-Processor)** executed with all US-based
  processors as a contractual fallback in the event of DPF lapse or invalidation.
- **Zero-retention DPA clauses** with Anthropic and OpenAI: contractually committed to not retaining
  prompt content.
- **Transfer Impact Assessment (TIA)** maintained in `docs/compliance/transfers/` for each EU→US and
  UK→US transfer.
- **Behavioral context** sent to LLM endpoints contains no direct identifiers (enforced by PII
  blocklist at ingest).
- **UK IDTA** executed for UK-to-US transfers where the sub-processor does not participate in the UK
  Extension to the EU-U.S. DPF.
- **UAE data**: LLM inference uses the nearest available Bedrock region (eu-central-1 for MVP); UAE
  event data remains in Cloudflare dxb / AWS me-central-1 and is not transferred except as
  DP-anonymized archetype vectors.

**Residual Likelihood:** Low-Medium. **Residual Severity:** Low-Medium. **Residual Risk:** LOW
(GREEN-YELLOW band).

### Risk C — LLM Provider (Anthropic) Data Retention

**Description:** When behavioral context is sent to the Anthropic API for intent extraction or
adaptation reasoning, there is a risk that Anthropic retains prompt content for model training,
safety review, or abuse monitoring, beyond what is disclosed in its public documentation.

**Likelihood (pre-mitigation):** Low-Medium. Anthropic's enterprise DPA includes a "no training on
customer data" clause, but usage monitoring for safety may occur.

**Severity (pre-mitigation):** Medium. If behavioral context were retained and linked to other data
held by Anthropic, it could contribute to a data subject's profile in ways not anticipated by
Time2Show or the data subject.

**Mitigations:**

- DPA with Anthropic includes explicit zero-retention clause for prompt content.
- Behavioral context sent in prompts is stripped of any potential direct identifiers by the
  PII-blocklist layer before reaching the LLM gateway.
- LiteLLM router logs all LLM calls to the internal `llm_calls` ClickHouse table (thirteen-month
  retention) for auditability.
- DPA compliance verification is a condition of the Time2Show onboarding gate for new LLM providers.

**Residual Likelihood:** Low. **Residual Severity:** Low-Medium. **Residual Risk:** LOW (GREEN
band).

### Risk D — Unauthorized Tenant Access to Another Tenant's Session Data

**Description:** A misconfiguration of Row Level Security policies, a bug in the tenant JWT claim
extraction, or a tenant-side API key compromise could allow one tenant to read or manipulate session
embeddings, adaptation decisions, or behavioral data belonging to another tenant.

**Likelihood (pre-mitigation):** Low. RLS policies are enforced at the Supabase (Postgres) level and
are tested in CI.

**Severity (pre-mitigation):** High. Cross-tenant data access would constitute a personal data
breach under GDPR Article 4(12), triggering seventy-two-hour notification obligations to supervisory
authorities and potentially to affected data subjects.

**Mitigations:**

- All Postgres tables with session-level data have RLS policies enforced at the database level (not
  application level). Application-level bypasses are audited and prohibited.
- Tenant JWT claims are validated at every API request; tenant_id is extracted from the signed JWT,
  not from request parameters.
- ClickHouse event store uses per-tenant partition keys and column-level access controls.
- The HMAC session hash incorporates the tenant_secret, making cross-tenant session hash reuse
  technically impossible even if an API key were compromised.
- Automated RLS policy tests run on every CI pass (packages/db test suite).

**Residual Likelihood:** Very Low. **Residual Severity:** High. **Residual Risk:** LOW (GREEN band)
given high severity but very low likelihood and hard technical controls.

### Risk E — Regulatory Enforcement Action on Fingerprinting

**Description:** National supervisory authorities (CNIL, ICO, UAE Data Office, Polish UODO) may
determine that Mode A fingerprinting does not qualify for the ePrivacy Directive Article 5(3)(b)
strictly necessary exemption, and may issue enforcement orders, fines, or require consent for all
fingerprinting activities.

**Likelihood (pre-mitigation):** Medium. The ICO's December 2024 statement on Google's
fingerprinting policy change describes fingerprinting as "not a fair means of tracking" and sets a
"high bar" for compliance. The CNIL enforcement trend (€325M Google, September 2025) indicates
intensifying scrutiny. The ICO's December 2024 guidance does, however, confirm that session-scoped
recording of user interactions may satisfy the strictly necessary exemption.

**Severity (pre-mitigation):** High. Under GDPR Article 83(5), supervisory authorities may impose
fines of up to €20M or four percent of global annual turnover. An enforcement order requiring
consent for all fingerprinting would require immediate product changes and could affect EU/UK/UAE
tenant onboarding.

**Mitigations:**

- Mode A is designed specifically around the strictly necessary exemption: session-scoped, rotates
  on idle/close, never persists across sessions, no cross-tenant use.
- Legal analysis and LIA are maintained and reviewed at minimum annually and upon any material
  guidance change.
- `docs/compliance/REGULATORY_WATCH.md` tracks EDPB guidelines, ICO guidance, CNIL enforcement
  actions, and UODO developments.
- Consent Helper is available as a Mode B upgrade path for any tenant or jurisdiction where Mode A
  coverage is uncertain.
- This DPIA is a living document; regulatory guidance changes trigger a re-assessment within thirty
  days.
- External DPO (once appointed) will engage proactively with UODO (as Lead Supervisory Authority),
  ICO, and CNIL for informal guidance on the Mode A strictly necessary analysis.

**Residual Likelihood:** Low-Medium. **Residual Severity:** High. **Residual Risk:** MEDIUM (ORANGE
band). This risk is flagged for ongoing monitoring. It does not constitute a "High" residual risk
blocking the current hybrid pilot deployment because Mode B (Consent Mode) provides a compliant
fallback for any jurisdiction where Mode A coverage is challenged, and the strictly necessary legal
analysis is well-grounded in current ICO guidance. However, the external DPO must review this risk
assessment before any scaling beyond the current pilot cohort.

---

## 5. Mitigations and Residual Risk Summary

| Risk                         | Residual Likelihood | Residual Severity | Residual Risk             | Production Launch Blocker?                                                               |
| ---------------------------- | ------------------- | ----------------- | ------------------------- | ---------------------------------------------------------------------------------------- |
| A — Re-identification        | Low                 | Medium            | LOW-MEDIUM (GREEN-YELLOW) | No                                                                                       |
| B — Cross-border transfer    | Low-Medium          | Low-Medium        | LOW (GREEN-YELLOW)        | No                                                                                       |
| C — Anthropic data retention | Low                 | Low-Medium        | LOW (GREEN)               | No                                                                                       |
| D — Cross-tenant data leak   | Very Low            | High              | LOW (GREEN)               | No                                                                                       |
| E — Regulatory enforcement   | Low-Medium          | High              | MEDIUM (ORANGE)           | No (Mode B fallback available; external DPO review required before scaling pilot cohort) |

**Overall Residual Risk Assessment:** MEDIUM, driven primarily by Risk E. The overall assessment
does not reach HIGH. No risks rated HIGH residual risk are present. Supervisory authority
pre-consultation under GDPR Article 36 is not required at this time (overall residual risk is
Medium, not High). External DPO review of Risk E is required before scaling beyond the current pilot
cohort.

---

## 6. Jurisdictional Addenda

### 6.1 EU GDPR

**DPIA obligation:** This DPIA is required under GDPR Article 35(3)(c) ("systematic monitoring of a
publicly accessible area on a large scale") and additionally meets multiple criteria on the UODO
mandatory DPIA list (Communication of 17 June 2019). Real estate listing websites are publicly
accessible. The Estalara behavioral monitoring is systematic (rule-based, automatic, across all
sessions on a tenant site) and operates at scale across multiple tenants.

**Establishment and Lead Supervisory Authority:** Time2Show, Inc. has an establishment in the
European Union by virtue of the stable presence of its Polish-resident CEO, from whom the central
administrative and decision-making activities of the Company emanate (GDPR art. 3(1), Recital 22,
EDPB Guidelines 3/2018). The Lead Supervisory Authority under the one-stop-shop mechanism (art. 56)
is the **Urząd Ochrony Danych Osobowych (UODO, Poland)**.

**Article 27 EU Representative:** Not required. Article 27(1) GDPR mandates a Union representative
only where art. 3(2) is the sole basis of GDPR application. Where art. 3(1) (establishment) applies,
no representative is required.

**Lawful basis:** Article 6(1)(f) — Legitimate Interest — for behavioral analytics and listing
personalization (Mode A and Mode C tenants), and for Engagement Score computation (Time2Show as Sole
Controller). Article 6(1)(a) — Consent — for Mode B tenants where explicit consent has been
collected by the tenant via CMP or Estalara Consent Helper. Article 6(1)(b) — Contract Performance —
for tenant account and billing data processing. Article 6(1)(c) — Legal Obligation — for consent
record retention, audit logging, and DSR processing.

**ePrivacy:** Article 5(3) of Directive 2002/58/EC requires prior consent for access to terminal
equipment unless the access is strictly necessary for a service explicitly requested by the
subscriber or user. Mode A relies on the strictly necessary exemption. Mode B requires consent
collected by the tenant. The Estalara Consent Helper is available as a drop-in component.

**DPO appointment:** An external DPO (DPO-as-a-Service provider) is being appointed. The DPO will be
registered with the UODO before scaling beyond the current pilot cohort. The CEO is structurally
excluded from this role pursuant to GDPR art. 38(6) conflict-of-interest doctrine, CJEU Case
C-453/21 (X-FAB Dresden, 2023), and EDPB Guidelines 4/2017. Placeholder contact:
compliance@estalara.com.

**EDPB Guidelines 02/2023:** These guidelines (on technical scope of Art. 5(3) of the ePrivacy
Directive, adopted 14 November 2023, finalised October 2024) confirm that fingerprinting is within
the scope of ePrivacy Article 5(3). The Estalara Mode A design has been assessed against these
guidelines. The strictly necessary analysis is documented in the LIA (TICKET-GDPR-003).

### 6.2 UK GDPR and PECR

**UK GDPR:** Post-Brexit, UK data protection is governed by the UK GDPR (as retained in domestic law
by the European Union (Withdrawal) Act 2018) and the Data Protection Act 2018. The substantive
obligations are materially identical to EU GDPR.

**PECR:** The Privacy and Electronic Communications Regulations 2003 (SI 2003/2426) implement
ePrivacy Article 5(3) in the UK. Rule 6 of PECR requires consent (or the strictly necessary
exemption) for storing or accessing information on a user's device. Mode A relies on the strictly
necessary exemption under PECR Rule 6(4): the fingerprinting is solely for the purpose of delivering
the interactive listing experience explicitly requested by the visitor.

**UK Representative (UK GDPR art. 27):** Time2Show has no establishment in the UK. UK GDPR therefore
requires the appointment of a UK representative based in the UK. Appointment is in progress and will
be completed before any UK tenant onboarding.

**ICO position:** The ICO's December 2024 statement on fingerprinting confirms that fingerprinting
is "not a fair means of tracking" in the advertising context, but distinguishes session-scoped
functional uses. The ICO's draft guidance on online tracking (December 2024) confirms that
"recording information or selections made on an online service" may satisfy the strictly necessary
exemption. The Estalara Mode A falls within this characterization. The ICO's online tracking
strategy for 2025 is tracked in `docs/compliance/REGULATORY_WATCH.md`.

**ICO DPO registration:** The appointed external DPO will be registered with the ICO before any UK
tenant goes live, separately from the UODO registration.

**IDTA:** UK-to-US transfers (Anthropic, OpenAI) are covered by the UK International Data Transfer
Agreement, the UK equivalent of EU SCCs. Where the sub-processor participates in the UK Extension to
the EU-U.S. DPF, that is the primary mechanism; UK IDTA is the contractual fallback.

### 6.3 US — CCPA / CPRA (California)

**Applicable law:** California Consumer Privacy Act (Cal. Civ. Code § 1798.100 et seq.) as amended
by the California Privacy Rights Act (Proposition 24, 2020).

**Applicability threshold analysis:** CCPA applies to businesses that meet at least one of three
thresholds: (a) annual gross revenue exceeding $25M USD; (b) processing personal information of
100,000 or more California residents or households annually; or (c) deriving 50% or more of annual
revenue from selling or sharing California residents' personal information. Time2Show's CCPA
applicability depends on the scale of US tenant deployment. The Estalara product is designed for
CCPA compliance regardless of whether the thresholds are currently met, on the basis that
applicability is expected as US tenant adoption scales. Threshold status is monitored quarterly by
the compliance team.

**Browser fingerprints as unique personal identifiers:** Under Cal. Civ. Code § 1798.140(ae),
"unique personal identifier" includes "a device identifier" and an "alias" persistently linked to a
person. A browser fingerprint is classified as a unique personal identifier under CCPA. Even
Estalara's session-scoped hash may qualify as a unique personal identifier for CCPA purposes because
it is linked to an individual's device during the session.

**Service provider relationship:** Time2Show operates as a "service provider" under CCPA Section
1798.140(ag) rather than a "third party" that receives personal information for its own purposes,
because it processes behavioral data solely to provide the listing personalization service to the
tenant (business). The tenant is the "business" under CCPA. Time2Show DPAs with tenants include the
service provider clauses required under CCPA Section 1798.140(ag)(1). For the Engagement Score
(Time2Show as Sole Controller, see ROPA Joint Controller analysis), Time2Show acts in a
controller-like role but does not "sell" or "share" personal information for cross-context
behavioral advertising.

**No "sale" or "sharing":** Time2Show does not sell or share personal information with third parties
for cross-context behavioral advertising. The service provider relationship precludes
characterization as a sale under CCPA Section 1798.140(ad).

**GPC (Global Privacy Control) signal:** US tenants are required to honor the GPC signal
automatically. When the Estalara SDK detects `navigator.globalPrivacyControl === true`, it switches
the session to Mode A (Session Mode only, no global archetype contribution) and provides a mechanism
for the visitor to opt out of any data collection beyond strictly necessary. Implementation is
tracked in TICKET-GDPR-004.

**Notice at collection:** CCPA Section 1798.100(b) requires a notice at or before the point of
collection. The Estalara SDK includes a footer link to the tenant's privacy notice (tenant is
responsible for maintaining an up-to-date privacy policy referencing Time2Show as a service
provider). The Time2Show control plane generates a privacy policy template for tenants.

**Consumer rights:** Access, deletion, correction, and opt-out rights under CCPA are honored through
the DSR endpoint (TICKET-GDPR-002). The forty-five-day CCPA response deadline is tracked in the DSR
queue.

**Opt-out mechanism:** For Mode B US tenants, an "Opt Out of Personalization" link is provided.
Opting out switches the session to Mode A for the remainder of the session and for subsequent
sessions from the same device (to the extent the opt-out can be persisted without cookies —
Time2Show uses a URL parameter or a first-party localStorage flag if consent was previously
granted).

### 6.4 UAE — PDPL and DIFC

**Federal PDPL (Federal Decree-Law 45/2021):** The UAE Personal Data Protection Law applies to any
processing of personal data of UAE residents, including by entities outside the UAE. Behavioral
session identifiers (fingerprint hashes linked to online behavior) constitute personal data as
"online identifier" under Article 1. Processing requires a lawful basis (Article 5): explicit
consent, contract performance, legal obligation, or protection of vital interests. Specific
references to UAE PDPL implementing regulations are verified with UAE-licensed counsel.

**Time2Show's basis under UAE PDPL:** For Mode A tenants, Time2Show relies on the data subject's
implicit consent through use of the service (the UAE PDPL permits processing on the basis of
"implicit or explicit consent of the data subject" under Article 5(1)(a) in the context of a service
relationship). For Mode B tenants, explicit consent is collected by the tenant's CMP. UAE Data
Office guidance on implicit consent for interactive digital services is tracked in
`docs/compliance/REGULATORY_WATCH.md`.

**DPIA under UAE PDPL:** The UAE PDPL's implementing regulations require a DPIA before any
"high-risk" processing, defined to include processing of a large number of personal data subjects or
use of automated decision-making that could affect data subjects. This DPIA satisfies that
requirement for UAE-region processing.

**DPO requirement:** Article 10 of the UAE PDPL requires the appointment of a DPO for controllers
that process data on a large scale or engage in large-scale systematic monitoring. Time2Show's UAE
operations meet this threshold. The appointed external DPO will cover UAE operations (subject to UAE
Data Office guidance on whether a UAE-resident DPO is required).

**Encryption requirements:** Article 16 of the UAE PDPL requires appropriate security measures.
Time2Show implements AES-256 at rest (Supabase, ClickHouse, Upstash) and TLS 1.3 in transit (all API
endpoints).

**Data residency:** UAE event data is processed in Cloudflare dxb (UAE Points of Presence) and
stored in AWS me-central-1 (Bahrain region, closest to UAE) for Postgres. ClickHouse uses a
dedicated UAE instance or the EU ClickHouse Cloud instance for MVP (with a commitment to migrate to
a UAE-resident instance before UAE tenant scale). DP-anonymized archetype vectors are the only data
permitted to cross the UAE border to the global archetype store.

**Cross-border transfers:** The UAE Data Office maintains an adequacy list. EU is on the adequacy
list. For transfers to US-based processors (Anthropic, OpenAI), Time2Show uses Standard Contractual
Clauses as permitted under Article 22 of the UAE PDPL where the UAE Data Office has not issued an
adequacy decision for the US. (UAE has no participation in the EU-U.S. DPF.)

**DIFC tenants (Dubai International Financial Centre):** DIFC tenants are subject to DIFC Data
Protection Law No. 5 of 2020 (as amended), administered by the DIFC Commissioner of Data Protection.
The DIFC regime is substantively similar to the GDPR and requires lawful basis, DPO notification,
DPIA, and SCC-equivalent transfer mechanisms. DIFC tenants are subject to a separate compliance
module in the Time2Show control plane. A dedicated DIFC DPIA addendum will be produced before any
DIFC tenant goes live.

---

## 7. Consent Strategy

The three consent modes described in Section 2.2 implement the following consent decision tree:

1. **Region determination:** At session initialization, the SDK reads the tenant's `region`
   configuration and the browser's geographic signal (Cloudflare headers). EU, UK, and UAE regions
   default to Mode A.
2. **GPC detection (US only):** If `navigator.globalPrivacyControl === true`, the session is locked
   to Mode A with no global archetype contribution, regardless of tenant consent configuration.
3. **Tenant CMP verification (Mode B):** If the tenant has configured Mode B, the SDK polls the
   tenant's CMP for a consent record. If a valid consent record exists (via Estalara Consent Helper
   API or a verified IAB TCF consent string), the session enters Mode B. If no consent record is
   found within two seconds, the session falls back to Mode A.
4. **LIA documentation (Mode C):** Mode C requires a tenant-specific LIA on file in the Time2Show
   control plane. Only specific narrow purposes (spam detection) are permitted. The compliance gate
   at tenant onboarding verifies the LIA before Mode C is activated.
5. **Consent expiry:** Mode B consents expire after ninety days. The SDK checks consent record
   `expired_at` on each session initialization. Expired consents fall back to Mode A until
   re-consent is obtained.
6. **Consent withdrawal:** If a data subject withdraws consent (via DSR endpoint or tenant-provided
   UI), the session is downgraded to Mode A within twenty-four (24) hours of receipt of the
   withdrawal notice, the session embedding is quarantined from global archetype contribution within
   seven (7) days, and a deletion request is queued for cascade execution per the DSR workflow
   (Section 8).

**Implementation reference:** TICKET-041 (SDK consent banner) implements the user-facing consent
collection flow. TICKET-GDPR-004 implements the consent state propagation from SDK through ingest to
Decision API.

**Update v2.8 — Mandatory registration consent (FOLLOW-373):** For the app.estalara.com pilot,
consent is captured at registration and is mandatory (Mode B). The registration consent covers all
six purposes (a)–(f) enumerated in §3.1 above and §13.4 below. The SDK consent banner (Mode B for
anonymous visitors) is a separate consent surface for tenant-embedded anonymous sessions; it is not
the registration-consent surface for app.estalara.com investors. The `consent_records` table records
the platform-wide grant with `consent_type = 'platform_registration'` alongside `tos_version` and
`consent_text_hash`. See §13.4 for the full LIA covering purposes (d) and (e).

---

## 8. Data Subject Rights

Under GDPR (Articles 15–22), UK GDPR, UAE PDPL (Articles 6–9), and CCPA (Sections
1798.100–1798.125), data subjects have rights to access, erasure, portability, rectification, and
restriction of processing. Given that Time2Show processes only pseudonymous session-level data and
not direct identifiers, the practical exercise of these rights is mediated through the tenant, who
is responsible for verifying the identity of the requestor.

**DSR workflow:**

1. A visitor contacts the tenant to exercise their data rights.
2. The tenant verifies the requester's identity (Time2Show does not perform identity verification;
   it relies on the tenant's verification).
3. The tenant submits a DSR request to the Estalara DSR endpoint (`POST /api/v1/dsr/request`) with
   the verified requester proof, the DSR type, and the requester identifier (session_id,
   fingerprint_hash, or hashed email if the tenant maintains an account link).
4. The Estalara DSR worker resolves the identifier to all session records (via `session_id` lookup
   in `session_embeddings`, `consent_records`, `adaptation_decisions`, `engagement_scores`,
   `llm_calls`, and `dsr_tokens` tables).
5. For **Access** and **Portability**: the worker compiles a structured export (JSON) of all
   session-level records associated with the identifier and delivers via the tenant's verified
   channel (one-time download link, OTP-protected). The Postgres tables read at
   `GET /api/dsr/access` and `GET /api/dsr/portability` are: `session_embeddings`,
   `consent_records`, `conversion_labels` (both `lead_id` namespaces — FOLLOW-246), and, as of
   FOLLOW-558, `engagement_scores`, `quiz_completions`, and `intent_sessions` — the same three
   tables that were already part of the Erasure cascade in step 6 below (`engagement_scores` via
   FOLLOW-193, `quiz_completions` + `intent_sessions` via FOLLOW-455) but were previously omitted
   from the Access/Portability disclosure (Art. 15/20 completeness gap, audit finding A3-F-06). A
   parity test (`apps/control-plane/src/app/api/dsr/disclosure-route-driven-pglite.test.ts`,
   "FOLLOW-558 PARITY" describe block) asserts the Access/Portability table set matches the Erasure
   table set so a future new store cannot silently drift the two apart again. In addition, as of
   FOLLOW-574 (CEO ruling ESC-037, 2026-07-17), the same two endpoints disclose the **actual rows**
   of every ClickHouse PII table in the canonical erase inventory `DSR_CLICKHOUSE_TABLES` —
   `events`, `adaptation_decisions`, `llm_calls`, `session_quality`, and `intent_events`. Art. 15(3)
   requires "a copy of the personal data", so the `events` behavioural log is exported as full rows
   (superseding the FOLLOW-455 aggregate `count`); because a session's `events` can be high-volume,
   the export is volume-safe — keyset-paginated with an in-memory row cap and a continuation cursor,
   never one unbounded response. The disclosure SET is **derived from `DSR_CLICKHOUSE_TABLES`** (the
   same constant `POST /api/dsr/erase` deletes from), so a table added to the erase set is disclosed
   automatically and disclosure can never silently fall below erasure. `intent_events` is disclosed
   on its authoritative subject key `(tenant_id, session_id)` — the String `session_id` column
   (migrations 0015/0016), not the zero-default `intent_session_id` UUID. As of FOLLOW-581 the
   erase-side filter also targets `session_id`, so erasure and disclosure now agree on the same
   authoritative key (the prior `intent_session_id` erase filter was a latent Art. 17 no-op — it
   matched zero real rows — and is now resolved). When ClickHouse is unconfigured or the query
   fails, the response marks `clickhouse.available = false` with a note — never a fabricated or
   silently-empty disclosure (Rule K.2). _(Boundary note: FOLLOW-575 owns the separate
   reconciliation of §8 step 6's erasure enumeration and the parity-test-claim wording; it should
   rebase onto DPIA v2.10.)_
6. For **Erasure**: the worker executes a cascade deletion across all in-region stores: Postgres
   (`session_embeddings`, `consent_records`, `engagement_scores`, `answers`) synchronously inside a
   single transaction, ClickHouse (`events`, `adaptation_decisions`, `llm_calls`, `session_quality`)
   asynchronously via `ALTER TABLE ... DELETE WHERE session_id IN (...)` mutations whose status is
   tracked in the Postgres operational table `dsr_clickhouse_mutations` and polled every 5 minutes
   by the Vercel Cron handler `/api/dsr/mutation-poll`, Upstash Redis (fire-and-forget SCAN + DEL of
   `session:{session_id}:*`), Modal (any cached embeddings). The archetype contribution log is
   updated to exclude the session from any future global archetype training (Mode B sessions only).
   Mutation retries: up to 3 attempts with exponential backoff (1 min / 5 min / 30 min); permanent
   failures fire Sentry alerts tagged `dsr_erase_clickhouse_mutation_failed`. See Master Design
   §H.1.1 for the data inventory and detailed flow.
7. For **Rectification**: limited applicability given the pseudonymous nature of the data; primarily
   covers correction of consent record state.
8. For **Restriction**: the session is flagged as "restricted" and excluded from further adaptation
   processing while the DSR is being resolved.
9. The DSR processing is logged to `staff_audit_log` (7-year retention).

**SLAs:**

- GDPR / UK GDPR: 30 days (extendable by 60 days for complex requests with notice).
- UAE PDPL: 30 days.
- CCPA: 45 days (extendable by 45 days with notice).
- Consent withdrawal: session downgrade within 24 hours; archetype contribution quarantine within 7
  days.

**Erasure failure alerting:** Permanent failures of ClickHouse erasure mutations (after 3 retry
attempts with exponential backoff) trigger a Sentry error tagged
`dsr_erase_clickhouse_mutation_failed`. Mutations that remain in `pending` or `in_progress` status
for more than one hour without advancing trigger a Sentry warning tagged `dsr_mutation_stuck`.
Incident owner: Piotr Nawrocki (asi.piotr@gmail.com). Response SLA: 5 minutes for permanent
failures; 30 minutes for stuck mutations. Full runbook and Sentry alert rule configuration:
`docs/ops/DSR_ALERTING.md`.

**Engagement Score in DSR cascade:** The `engagement_scores` table is included in the erasure
cascade because the Engagement Score is per-session pseudonymous personal data under Time2Show's
sole controllership. Erasure removes the score together with the underlying `session_embeddings`
record.

**CRM outcome labels (`conversion_labels`) in DSR cascade — OPEN gap (FOLLOW-184):** The DSR erase
route (`apps/control-plane/src/app/api/dsr/erase/route.ts`) includes two DELETE passes covering
`conversion_labels`: Pass A deletes rows where `lead_id = session_id` (SDK feedback-ping rows), and
Pass B deletes rows where `lead_id = durable_lead_id` (CRM webhook rows, supplied by the DSR
initiator via the `durable_lead_id` field — FOLLOW-239 / PR #234). Pass B runs only when the
operator supplies the `durable_lead_id` token at DSR initiation; if omitted and the tenant has
CRM-namespace rows, the erasure is flagged as `crm_tenant_unverifiable` in the audit log and a
Sentry warning is raised (FOLLOW-238, FOLLOW-239). The identifier-resolution model (session_id vs.
opaque CRM `lead_id`) means GDPR Art. 17 completeness for CRM-integrated tenants is
operator-dependent: the operator must supply `durable_lead_id` at DSR initiation, or manually
reconcile CRM-side deletions. The code implementation for Pass B shipped in FOLLOW-239 (PR #234);
the PG-harness integration test proving end-to-end identifier resolution (FOLLOW-185) is not yet
merged. **FOLLOW-184 remains OPEN.** CRM-integrated tenants must not go live until FOLLOW-184 is
DONE. This gap is separate from CRM go-live gate Conditions 8+9 (TTL cron + compliance docs), which
are SATISFIED as of DPIA v2.7.

**Implementation reference:** TICKET-GDPR-002 implements the DSR endpoint, cascade worker, and audit
logging.

---

## 9. Cross-Border Transfer Mechanisms

| Transfer Route                 | Data Type                            | Primary Mechanism                                          | Fallback Mechanism                   |
| ------------------------------ | ------------------------------------ | ---------------------------------------------------------- | ------------------------------------ |
| EU (fra) → US (Anthropic)      | Behavioral context prompts           | EU-U.S. DPF                                                | SCCs Module 2 + zero-retention DPA   |
| UK (lhr) → US (Anthropic)      | Behavioral context prompts           | UK Extension to EU-U.S. DPF                                | UK IDTA + zero-retention DPA         |
| EU (fra) → US (OpenAI)         | Embedding computation inputs         | EU-U.S. DPF                                                | SCCs Module 2 + zero-retention DPA   |
| UK (lhr) → US (OpenAI)         | Embedding computation inputs         | UK Extension to EU-U.S. DPF                                | UK IDTA + zero-retention DPA         |
| EU/UK → US (Stripe)            | Billing contact + billing data       | EU-U.S. DPF                                                | SCCs Module 2 / UK IDTA + Stripe DPA |
| EU → US (Cloudflare)           | Edge transient + tenant_id           | EU-U.S. DPF                                                | SCCs Module 2                        |
| EU → US (Vercel)               | Tenant admin sessions, API logs      | EU-U.S. DPF                                                | SCCs Module 2                        |
| UAE → EU (global archetype)    | DP-anonymized aggregate vectors only | Not a personal data transfer (k-anon ≥50 + DP ε≤2 applied) | N/A                                  |
| UAE → US (Anthropic inference) | Behavioral context prompts           | UAE PDPL Art. 22 SCCs + zero-retention DPA                 | (UAE has no DPF participation)       |

The DPF was upheld by the European General Court on 3 September 2025 (T-553/23 Latombe). DPF status
of each sub-processor is verified at https://www.dataprivacyframework.gov/list and tracked in
`docs/compliance/REGULATORY_WATCH.md`. SCCs are maintained contractually in all DPAs as a fallback
in the event of DPF lapse or invalidation.

Per-transfer Transfer Impact Assessments are maintained in `docs/compliance/transfers/`. Each TIA
covers: (a) characterization of the data; (b) US legal regime applicable to the recipient (FISA 702,
EO 12333 analysis); (c) technical and organizational supplementary measures (zero-retention,
encryption, PII blocklist); (d) ongoing monitoring obligations.

---

## 10. Consultation Record

**Internal consultation:**

- Engineering and architecture review: completed during Master Design v2.0 (2026-02 through
  2026-04). Privacy-by-design controls (HMAC fingerprint, k-anonymity, DP) were integrated into the
  system design from inception.
- Legal review: completed v1.0 (2026-05) and refreshed v2.0 (2026-05) following entity migration to
  Time2Show, Inc. and integration of DPF as primary EU→US transfer mechanism. Pending: external
  legal counsel review in Delaware (corporate), Poland (RODO), and the United Kingdom (UK GDPR).
- DPO review: external DPO appointment is in progress. The appointed DPO will review and
  counter-sign this DPIA before the next scaling milestone.

**Data subject consultation:** Time2Show is unable to consult directly with data subjects (visitors
to tenant websites) because they are pseudonymous and not individually contactable by Time2Show. The
consultation obligation under GDPR Article 35(9) is interpreted as not applying to this processing,
on the basis that consultation is "where appropriate". Tenant agencies (who have direct
relationships with their visitors) are encouraged to gather visitor feedback on the Estalara
experience and to share it with Time2Show as part of the tenant feedback process.

**Supervisory authority consultation under Article 36:** The overall residual risk is assessed as
Medium, not High. Under GDPR Article 36(1), prior consultation with the supervisory authority is
required only where the DPIA indicates that the processing would result in a high residual risk in
the absence of measures taken by the controller to mitigate the risk. Because the residual risk is
Medium (driven primarily by Risk E, which has compliant fallback paths via Mode B), Article 36
pre-consultation is not required at this time. The appointed external DPO will independently assess
whether informal consultation with UODO (as Lead Supervisory Authority) is advisable.

**Lead Supervisory Authority rationale:** UODO is identified as Lead Supervisory Authority under the
one-stop-shop mechanism of GDPR art. 56, on the basis that Time2Show's main establishment in the EU
is in Poland (the place of central administration and decision-making, per art. 4(16), attributable
to the stable presence of the CEO who directs business operations from Poland).

---

## 11. Revision History

| Version | Date       | Author                 | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------- | ---------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 2026-05-15 | Compliance Engineering | Initial DPIA. Five risks identified and assessed. Jurisdictional addenda for EU, UK, US (CCPA), UAE PDPL + DIFC.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2.0     | 2026-05-15 | Compliance Engineering | Comprehensive update reflecting Time2Show, Inc. as the operating entity with EU establishment via Polish-resident CEO. UODO confirmed as Lead Supervisory Authority on one-stop-shop basis. EU Art. 27 representative not required (Art. 3(1) basis); UK Art. 27 representative appointment in progress. External DPO appointment in progress (CEO structurally excluded per CJEU C-453/21). DPF integrated as primary EU→US transfer mechanism with SCCs as contractual fallback. Joint Controller Analysis classifying Engagement Score as Sole Controllership. Consent withdrawal SLAs clarified (24h session downgrade, 7d archetype quarantine). Engagement Score added to DSR erasure cascade. CCPA applicability threshold analysis added. AI Act FRIA threshold analysis appendix added. Production status updated to "hybrid pilot deployment".                                                                                                                                                                                                                                                                                                                          |
| 2.1     | 2026-05-24 | Data Engineering       | Section 8 (Data Subject Rights) — Erasure flow updated to reflect FOLLOW-039 implementation: synchronous Postgres delete + asynchronous ClickHouse `ALTER TABLE ... DELETE WHERE` mutations across `events`, `adaptation_decisions`, `llm_calls`, `session_quality`; status tracked in new Postgres operational table `dsr_clickhouse_mutations`; Vercel Cron `/api/dsr/mutation-poll` polls every 5 min; retries 3× with exponential backoff; Sentry alert on permanent failure. Cross-reference Master Design §H.1.1 for the canonical erasure flow + data inventory. Pre-2.1 the DPIA cited a "daily cron" erasure design that had not been built; that gap is now closed and EU pilot is unblocked.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2.2     | 2026-05-24 | Compliance Engineering | Section 8 (Data Subject Rights) — Added "Erasure failure alerting" paragraph documenting FOLLOW-078 stuck mutation detection: `dsr_mutation_stuck` Sentry warning fires when a `pending`/`in_progress` mutation has not advanced in >1 hour; `dsr_erase_clickhouse_mutation_failed` Sentry error fires on permanent failure. Incident owner and 5-minute response SLA documented. Runbook: `docs/ops/DSR_ALERTING.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2.3     | 2026-06-08 | Compliance Engineering | Section 13.3 added — disclosure for `estalara_intent_*` sessionStorage intent-state store (FOLLOW-218 / RETRO-032). Documents data category (inferred archetype + per-archetype probability vector), storage medium (sessionStorage, tab-lifetime), staleness window (30 minutes, `INTENT_STATE_STALE_MS`), consent gate (write occurs only when consent is 'granted', verified at `index.ts:329/455/595`), and erasure-on-denial/withdrawal (verified `eraseIntentState` call sites at `index.ts:209` and `index.ts:260`). No behavioral change to SDK required — gap was documentation-only. Privacy Notice Template §4 and §5 updated to add `estalara_intent_*` row and DPO gate item. ROPA Activity 14 added. DPIA version header bumped to 2.3 / 2026-06-08.                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2.4     | 2026-06-08 | Compliance Engineering | Section 13.3 updated (FOLLOW-230): added "Dual-store erasure model" paragraph connecting the two independent erasure paths — client cache (`estalara_intent_*` sessionStorage, erased at `index.ts:209`/`index.ts:260` via `eraseIntentState`) and server archetype (`session_embeddings`, erased via DSR cascade FOLLOW-039 / Master Design §H.1.1). Privacy Notice Template §4 updated to list all eight active SDK storage keys (three keys omitted from v1.1 added: `estalara_variant:*`, `__estalara_quiz_dismissed__`, `__estalara_micro_poll_dismissed__`; header updated from "all five" to "all eight"). ROPA Revision History updated to record Activity 14 number reservation and FOLLOW-187 renumbering to Activity 15.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2.5     | 2026-06-08 | Compliance Engineering | FOLLOW-187: §2.3 (System Components) — added CRM Outcome Ingest row (`POST /api/crm/outcome`, `conversion_labels` Postgres table). §2.5 (Data Types and Retention) — added `conversion_labels` row with 13-month intended retention and explicit enforcement-gap notice pending FOLLOW-234 TTL cron. ROPA Activity 15 added (CRM Deep-Outcome Ingest). Retention is policy-only until FOLLOW-234 ships; go-live gate for CRM-integrated tenants is UNSATISFIABLE until then per Rule N.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 2.6     | 2026-06-08 | Compliance Engineering | FOLLOW-235: TTL enforcement gap closed — cron shipped in FOLLOW-234 (PR #230, `c97fd50`). §2.5 `conversion_labels` retention row updated: "policy only; not yet enforced" notice removed; replaced with live enforcement statement referencing daily Vercel cron at `/api/internal/retention/conversion-labels` (FOLLOW-234 / PR #230, 2026-06-08).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2.7     | 2026-06-08 | Compliance Engineering | FOLLOW-187 conditions 8 and 9 CONFIRMED SATISFIED. §2.3 (System Components) and §2.5 (Data Types and Retention) are complete for CRM Deep-Outcome Ingest. TTL cron is live (FOLLOW-234 / PR #230, `c97fd50`). ROPA Activity 15 complete (ROPA v2.5). CRM go-live compliance gate is now SATISFIABLE for Conditions 8+9. §8 (Data Subject Rights) updated with open-gap note: DSR cascade for `conversion_labels` via `lead_id` identifier resolution (FOLLOW-184) is a separate OPEN gap tracked as FOLLOW-184 — CRM-integrated tenants must not go live until FOLLOW-184 is DONE (code implementation shipped via FOLLOW-239 / PR #234; PG-harness integration test FOLLOW-185 not yet merged). This is separate from Conditions 8+9 which are confirmed.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2.8     | 2026-06-21 | Compliance Engineering | FOLLOW-373: Platform-wide consent umbrella (CEO decision 2026-06-21). §3.1 updated: six processing purposes (a)–(f) enumerated; C-07 boundary re-asserted with grep-verified code evidence. §7 (Consent Strategy) updated: mandatory-at-registration consent for app.estalara.com pilot (Mode B); `consent_type = 'platform_registration'`; `consent_records` binary-grant schema confirmed sufficient. §13.4 added: LIA for buying-intent identification (purpose d) and lead ranking (purpose e) — dual lawful basis (Art. 6(1)(a) consent + LI proportionality framework); balancing test PASSES subject to three conditions. §13.5 added: FOLLOW-372 suspend-not-erase sufficiency addendum — suspend is sufficient for AL-DOM-only opt-out; no new PII created; Art. 21 objection right satisfied; Art. 17 erasure path unchanged. DPO gate extended to cover §13.4 and §13.5.                                                                                                                                                                                                                                                                                               |
| 2.9     | 2026-07-15 | Compliance Engineering | FOLLOW-558 (audit A3-F-06): §8 (Data Subject Rights) step 5 updated to disclose the exact Postgres table set read by `GET /api/dsr/access` and `GET /api/dsr/portability` — `engagement_scores`, `quiz_completions`, and `intent_sessions` were already part of the Erasure cascade (`engagement_scores` FOLLOW-193, `quiz_completions` + `intent_sessions` FOLLOW-455) but had been omitted from the Access/Portability disclosure, an Art. 15/20 completeness gap. Code fix + a route-driven parity test (`disclosure-route-driven-pglite.test.ts`, "FOLLOW-558 PARITY") ship in the same PR, per Rule N.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2.10    | 2026-07-17 | Compliance Engineering | FOLLOW-574 (audit RETRO-176 §LG-1; CEO ruling ESC-037): §8 step 5 extended to record that `GET /api/dsr/access` + `GET /api/dsr/portability` now disclose the **actual rows** of every ClickHouse PII table in `DSR_CLICKHOUSE_TABLES` (`events`, `adaptation_decisions`, `llm_calls`, `session_quality`, `intent_events`), closing the ClickHouse axis of the Art. 15/20 completeness gap that FOLLOW-558 closed for Postgres. `events` is a full-row export (Art. 15(3) "a copy", superseding the FOLLOW-455 aggregate count), delivered volume-safely (keyset pagination + row cap + continuation cursor). The disclosure set is derived from `DSR_CLICKHOUSE_TABLES` so it cannot drift below the erase set. `intent_events` disclosed on its authoritative `(tenant_id, session_id)` key (migrations 0015/0016); the erase-side `intent_session_id` filter is a latent no-op tracked as FOLLOW-581. AC(d): `engagement_scores` confirmed a phantom store (no producer in repo or out-of-repo actors) — ROPA Activity "Engagement Score computation" + §2.5 retention row annotated; producer absence filed as FOLLOW-582. Code + unit tests ship in the same PR, per Rule N. |
| 2.11    | 2026-07-17 | Compliance Engineering | FOLLOW-581 (GDPR Art. 17 completeness, P1): §8 step 5 divergence note resolved. `POST /api/dsr/erase` previously deleted `intent_events` with `ALTER TABLE ... DELETE WHERE intent_session_id IN (...)`, but real rows carry the SDK fingerprint in the String `session_id` column with `intent_session_id` left at its zero-UUID default (migrations 0015/0016; the ingest writer omits it) — so the erase filter matched zero real rows (a latent Art. 17 no-op). The erase-side filter (and the mutation-poll retry path) now target `session_id`, the same authoritative key FOLLOW-574's disclosure already used, so erasure and disclosure agree. The `DSR_CLICKHOUSE_TABLES.idSource` machinery and the now-orphaned `resolveIntentSessionId` helper were removed (Rule I). Code + unit tests (`clickhouse-dsr.test.ts` mutation-SQL, `erase/route.test.ts` route behaviour) ship in the same PR, per Rule N. Step 6's ClickHouse erasure enumeration reconciliation remains FOLLOW-575's scope.                                                                                                                                                                           |

---

## 12. Appendix — AI Act FRIA Threshold Analysis

This appendix addresses whether the Estalara AI system requires a Fundamental Rights Impact
Assessment (FRIA) under EU Regulation 2024/1689 (the "AI Act"), and the classification of Time2Show
under that Regulation.

### 12.1 Provider Classification (AI Act art. 3(3))

Time2Show, Inc. is a **provider** of an AI system within the meaning of AI Act art. 3(3): Time2Show
develops the Estalara AI system and places it on the market or puts it into service under its own
name. Time2Show is not a deployer (the tenants are deployers in respect of their use of the system
on their websites). This classification triggers the provider-side obligations in the AI Act
(documentation, conformity assessment for high-risk systems, transparency for general-purpose AI,
etc.) to the extent the system falls within scope.

### 12.2 Risk Classification

The AI Act establishes four risk tiers: prohibited (art. 5), high-risk (art. 6 and Annex III),
limited-risk (transparency obligations under art. 50), and minimal-risk. The Estalara system is
analyzed against each tier:

**Prohibited practices (art. 5):** None engaged. The system does not engage in subliminal
manipulation that causes significant harm, exploit vulnerabilities of specific groups, conduct
social scoring by public authorities, perform real-time remote biometric identification in public
spaces, or any other practice prohibited under art. 5.

**High-risk (art. 6 + Annex III):** Annex III enumerates the use cases that classify an AI system as
high-risk:

1. _Biometric categorisation systems_ — not applicable; the Estalara system does not categorise
   natural persons based on biometric data.
2. _Critical infrastructure_ — not applicable.
3. _Educational and vocational training_ — not applicable.
4. _Employment, workers management, and access to self-employment_ — not applicable.
5. _Access to and enjoyment of essential private and public services_ — analysed: real estate
   listing personalization is not an "essential" service in the sense of the AI Act (which refers to
   services such as creditworthiness assessment, public benefits, emergency services). Property
   listings are commercial information, not an essential service. **Not high-risk.**
6. _Law enforcement_ — not applicable.
7. _Migration, asylum, border control_ — not applicable.
8. _Administration of justice and democratic processes_ — not applicable.

The Estalara system is therefore **not high-risk** under the AI Act.

**Limited-risk (art. 50):** Article 50 imposes transparency obligations on AI systems that interact
with natural persons. The Estalara product includes an optional chat interface (intent extraction
from chat queries). Where this chat is exposed to visitors, the tenant must disclose that the
visitor is interacting with an AI system. This disclosure is included in the Estalara Privacy Notice
template provided to tenants.

**Minimal-risk:** The bulk of the Estalara system (behavioral signal capture, embedding computation,
archetype matching, adaptation directive generation) is minimal-risk under the AI Act. No specific
obligations beyond the limited-risk transparency duty apply.

### 12.3 FRIA Requirement

The Fundamental Rights Impact Assessment under AI Act art. 27 applies to **deployers** of
**high-risk AI systems** in specific use cases (public authorities, providers of essential services
such as banking and insurance). Because the Estalara system is not high-risk (per section 12.2), and
because Time2Show is the provider rather than the deployer, the FRIA obligation does not directly
apply to Time2Show.

Tenants who deploy the Estalara system are not deployers of a high-risk system (the system is not
high-risk), so tenants are also not subject to the FRIA obligation under art. 27.

### 12.4 General-Purpose AI Model Obligations

The Estalara product uses general-purpose AI models from Anthropic (Claude) and OpenAI (embeddings)
as sub-processors. The obligations on GPAI model providers (AI Act art. 51 ff.) apply to Anthropic
and OpenAI as providers of those models, not to Time2Show as a provider of an AI system that
incorporates those models. Time2Show's obligations are limited to ensuring that its use of GPAI
models complies with the terms of service and DPA of the upstream provider.

### 12.5 Conclusion

The Estalara AI system is **not high-risk** under the AI Act. **No FRIA is required**. Transparency
obligations under art. 50 are satisfied via the Privacy Notice template disclosing AI-driven
personalization and (where applicable) AI-driven chat interaction. AI Act audit trail requirements
(art. 12) are addressed by the `adaptation_decisions` log in ClickHouse (13-month retention).

This classification is to be re-assessed if: (a) the system functionality expands into any Annex III
use case; (b) the AI Act implementing regulations or delegated acts modify the high-risk thresholds;
(c) a future supervisory authority opinion characterizes commercial personalization as falling
within an "essential service" interpretation.

_This document is append-only. New risks are added as new sections. Existing sections are amended by
appending a change note with version reference, not by modifying original text._

---

## 13. Legitimate Interest Assessments — Sprint 1 Findings (2026-05-27)

### 13.1 LIA — Consent-Denied Audit Dispatch (Audit Finding F-13)

**Finding summary (audit):** When a visitor denies consent via the Estalara consent banner, the SDK
dispatches a lightweight server-side event (`consent.denied`) to the Estalara Ingest Worker. The
audit flagged that this dispatch occurs without an explicit Legitimate Interest Assessment
documenting the lawful basis, since the processing post-dates consent denial.

**Processing activity:** Receipt and logging of a single boolean signal (`consent = denied`) tied to
a pseudonymous session token (ephemeral; rotates on tab close). No behavioral signals, no archetype
inference, no adaptation. The log record is retained for a maximum of 7 days, then deleted by the
automated retention sweep. No cross-tenant access; no export outside the EU unless the ClickHouse
cluster is configured in a non-EU region (documented separately in §4 of this DPIA).

**Legitimate interest test (three-part):**

1. **Purpose test — is there a legitimate interest?** Yes. Recording the consent decision is
   necessary for: (a) audit-trail integrity — demonstrating to supervisory authorities that the SDK
   correctly ceased data processing upon denial; (b) debugging — detecting SDK bugs where consent
   state is not honoured; (c) fraud/abuse detection — identifying automated scripts that flood the
   consent denial path to exhaust session quotas. These purposes are operational and directly serve
   compliance obligations under GDPR Art. 5(2) (accountability principle).

2. **Necessity test — is processing necessary for that purpose?** Yes. The minimal alternative —
   logging consent denial in `localStorage` only — is insufficient for audit-trail purposes because
   it is not available to Time2Show's compliance team and is erasable by the visitor without a
   trace. A single server-side record of the denial timestamp and session token is the minimum
   necessary to satisfy the accountability obligation.

3. **Balancing test — does the legitimate interest override individual rights?** Yes, on balance.
   The data processed is a binary signal (denied) and a pseudonymous session token with a 7-day TTL.
   No content, no behavioral signal, no device fingerprint is included. The individual reasonable
   expectation of a visitor is that a website will record the fact of consent denial for compliance
   purposes; this is consistent with standard industry practice and the ICO / CNIL / UODO published
   guidance on consent management platform logging. The residual privacy impact is minimal.

**Conclusion:** Processing is lawful under GDPR Art. 6(1)(f) (legitimate interests). The lawful
basis is operational accountability under Art. 5(2). No additional safeguards beyond the 7-day
retention limit and pseudonymisation are required at this time.

**Consent banner disclosure:** The Estalara Privacy Notice template (provided to tenants) must be
updated to include the following sentence (or equivalent): _"We record the fact of your consent
decision — including a denial — for compliance and debugging purposes. This log is retained for 7
days and is then permanently deleted."_ Tenants must include this disclosure before enabling
Estalara on EU-resident traffic. **Action owner:** Compliance Engineering. **Due:** before EU pilot
go-live.

**Cross-reference — SDK implementation:** The banner copy and the `onDenied` callback that triggers
the `consent.denied` dispatch are implemented in `packages/sdk/src/ui/consent-banner.ts`
(`renderConsentBanner`). The disclosure strings for EN, PL, and ES locales are defined in the `COPY`
constant in that file. The mandated disclosure sentence above must appear in those locale strings.
**FOLLOW-128** owns the SDK code change to add the §13.1 disclosure sentence to the banner copy. The
tenant-facing disclosure paragraph is in `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` §2.

**DPO gate:** DPO review of this LIA is required before EU pilot go-live. Status: **PENDING** — DPO
sign-off not yet received. Gate is tracked in `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` §4 (DPO
Gate). The pilot runbook Go/No-Go checklist (`docs/ops/PILOT_RUNBOOK.md` §EU pre-flight) carries a
corresponding gate item.

---

### 13.2 LIA — Stable Cross-Session Fingerprint (Audit Finding F-14)

**Finding summary (audit):** The Estalara SDK implements Mode B (cross-session) fingerprinting for
tenants who opt in to cross-listing journey tracking (§4.2 of this DPIA). In Mode B the session
fingerprint persists for 90 days. The audit flagged that the consent banner copy does not explicitly
disclose the cross-session nature of the identifier, creating a gap between the actual behavior and
the disclosed behavior.

**Processing activity:** The cross-session fingerprint is an HMAC of browser entropy attributes
(canvas hash, AudioContext hash, screen/viewport/timezone/language, WebGL renderer) keyed by
`tenant_secret` and a 30-day rotation bucket. The hash is stored in `localStorage` and transmitted
with every ingest event. It enables the Estalara system to link listing views across separate
browser sessions (e.g. a visitor who views a listing on day 1 and returns on day 14 to view related
listings). No raw fingerprint entropy is stored server-side; only the salted hash.

**Legitimate interest test (three-part):**

1. **Purpose test — is there a legitimate interest?** Yes. Cross-session journey tracking serves:
   (a) personalization continuity — without it, a returning visitor's archetype confidence resets to
   the uniform prior on every new session, degrading adaptation quality; (b) conversion measurement
   — the pilot lift experiment requires linking a listing-view event on day 1 to an inquiry event on
   day 14 to compute time-lagged conversion; (c) fraud/abuse detection — repeated rapid re-visits
   from the same device to inflate engagement metrics can only be detected across sessions.

2. **Necessity test — is processing necessary for that purpose?** Yes for purposes (a)–(c). A
   session-only identifier satisfies none of them: it resets on tab close. A user-authenticated
   identifier would require a logged-in user, which is incompatible with Estalara's
   anonymous-visitor architecture. A 90-day cross-session hash is the minimum viable identifier for
   the stated purposes.

3. **Balancing test — does the legitimate interest override individual rights?** Balanced, with
   mitigations. The hash is pseudonymous (not directly re-identifiable without the `tenant_secret`),
   is refreshed every 90 days (limiting staleness), and is cleared on explicit consent withdrawal
   (erasure in `localStorage`). However, a 90-day cross-session identifier goes beyond what a
   typical visitor would expect without disclosure. The gap identified in audit F-14 is that the
   consent banner currently does not explain this; visitors therefore cannot exercise meaningful
   informed objection. **The balancing test is passed only if the disclosure gap is remediated.**

   **Balancing test status: GREEN — unconditionally passed as of FOLLOW-139.** FOLLOW-128
   implemented the required disclosure strings in `packages/sdk/src/ui/consent-banner.ts` for EN,
   PL, and ES locales (landed on `main` 2026-05-27). FOLLOW-139 implemented the matching SDK
   enforcement: `localStorage` storage with 90-day TTL rotation, `getOrCreateCrossSessionId()`
   called in `packages/sdk/src/index.ts` immediately after consent is granted (both on init when
   consent is already 'granted' and in the `onGranted` callback when the user accepts the banner),
   and `eraseCrossSessionId()` called on every consent-denied/withdrawal path in
   `packages/sdk/src/core/session.ts` and `packages/sdk/src/index.ts`. The disclosure gap is closed
   and the erasure-on-withdrawal obligation is implemented. This balancing test is now
   unconditionally passed.

**Conclusion:** Processing is lawful under GDPR Art. 6(1)(f) (legitimate interests). The lawful
basis is personalization continuity and conversion measurement. The legitimate interest is not
overridden by individual rights: the cross-session nature is disclosed (FOLLOW-128) and the 90-day
localStorage identifier with erasure-on-withdrawal is implemented (FOLLOW-139).

**Required consent banner update (mandatory before EU pilot go-live):** The Estalara consent banner
and tenant Privacy Notice template must be updated to explicitly state, in plain language: _"To
remember your preferences across visits, we store a pseudonymous identifier in your browser for up
to 90 days. This identifier is refreshed every 90 days and is deleted if you withdraw consent."_
This disclosure must appear in the consent banner — not only in the Privacy Policy — because the
identifier is set at first page load before the visitor navigates to the policy.

**Cross-reference — SDK implementation:** The banner copy is implemented in
`packages/sdk/src/ui/consent-banner.ts` (`COPY` constant, `renderConsentBanner` function).
**FOLLOW-128** owns the code change to add the §13.2 cross-session disclosure sentence to the `COPY`
locale strings for EN, PL, and ES. The tenant-facing disclosure paragraph is in
`docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` §3.

**Action owner:** Compliance Engineering (banner copy, DPIA/Privacy Notice docs) + SDK Engineer
(consent-withdrawal `localStorage` erasure). **Status: COMPLETE** — FOLLOW-128 delivered the
disclosure strings and FOLLOW-139 delivered the `localStorage` 90-day TTL + erasure-on-withdrawal
implementation. Both are merged to `main`.

**DPO gate:** DPO review of this LIA is required before EU pilot go-live. Status: **PENDING** — DPO
sign-off not yet received. Gate is tracked in `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` §4 (DPO
Gate).

**Staging QA — tracked pending verification (owner: Compliance Engineering):** QA engineer must
confirm that clicking "Deny" or "Withdraw" on a staging session removes the cross-session
`localStorage` key (`__estalara_xid__`, set by `getOrCreateCrossSessionId()` in
`packages/sdk/src/core/session.ts`). This verification cannot be automated from CI because it
requires a real browser session against the staging environment. It is a manual pre-flight gate: see
`docs/ops/PILOT_RUNBOOK.md` §EU pre-flight, "consent disclosure and localStorage QA" gate item.
Status: **READY FOR STAGING VERIFICATION** — FOLLOW-139 implementation deployed to `main`; staging
deploy and manual QA verification pending.

---

### 13.3 Client-Side sessionStorage — Intent-State Store (`estalara_intent_*`)

**Finding summary (RETRO-032 / FOLLOW-176 / PR #217):** PR #217 (FOLLOW-176, merged 2026-06-07)
introduced a new client-side storage write in the Estalara SDK: the resolved archetype label and
full per-archetype probability vector are persisted to `sessionStorage` under the key
`estalara_intent_{sessionId}` after the intent engine has converged on the visitor's most likely
buyer type. This data was not disclosed in any prior DPIA section, Privacy Notice paragraph, or ROPA
activity row. This section closes that gap. No behavioral change to the SDK is required — the
erasure-on-withdrawal and consent gate are already implemented (verified below). The missing element
was exclusively the documentation.

**Processing activity:**

The SDK writes, reads, and erases an entry from `sessionStorage` keyed by
`estalara_intent_{sessionId}`, where `sessionId` is the per-tab HMAC hash already described in §2.4.
The entry is a JSON envelope with schema:

```json
{ "version": 1, "savedAt": <Unix ms timestamp>, "state": <IntentState object> }
```

The `state` field contains the full `IntentState`: the resolved archetype label (e.g., `"family"`,
`"investor"`) and the per-archetype probability vector produced by the Thompson-sampling intent
engine. This is **profiling-adjacent data**: it is an inferred categorisation of the visitor's
likely property-purchasing intent, derived from their behavioral signals during the current tab
session.

**Storage medium:** `sessionStorage` (browser API). `sessionStorage` is cleared automatically by the
browser when the tab is closed. It is not shared between tabs and is not accessible to the server.

**Verified SDK symbols (grep-verified against `packages/sdk/src/core/session.ts` and
`packages/sdk/src/index.ts`):**

- Key construction: `intentStateStorageKey(sessionId)` returns `` `estalara_intent_${sessionId}` ``
  (`packages/sdk/src/core/session.ts:325`)
- Write: `persistIntentState(sessionId, intentState)` — calls
  `sessionStorage.setItem(intentStateStorageKey(sessionId), JSON.stringify(envelope))`
  (`session.ts:348`)
- Read: `rehydrateIntentState(sessionId)` — calls `sessionStorage.getItem(key)`; rejects entries
  where `envelope.version !== INTENT_STATE_SCHEMA_VERSION` or where
  `Date.now() - envelope.savedAt > staleMsThreshold` (default
  `INTENT_STATE_STALE_MS = 30 * 60 * 1000` ms, i.e., 30 minutes) (`session.ts:373–406`)
- Erase: `eraseIntentState(sessionId)` — calls
  `sessionStorage.removeItem(intentStateStorageKey(sessionId))` (`session.ts:424–430`)

**Consent gate (verified):**

`persistIntentState` and `rehydrateIntentState` are called only after the consent gate in
`packages/sdk/src/index.ts` has confirmed `consentState === 'granted'`. The function docstrings in
`session.ts:335` and `session.ts:368` explicitly state: "Consent gate: callers MUST check consent
before calling this function." The gate in `index.ts:201–268` returns early (halts the SDK entirely)
before reaching `rehydrateIntentState` (`index.ts:329`) or `persistIntentState` (`index.ts:455`,
`index.ts:595`) when consent is `'denied'` or when the visitor declines the banner. The intent-state
entry is therefore written if and only if consent is granted.

**Erasure on consent denial or withdrawal (verified):**

`eraseIntentState` is called on every denial/withdrawal path:

1. `index.ts:209` — consent already `'denied'` at SDK init (returning visitor who previously denied
   or mid-session withdrawal detected on re-load): `eraseIntentState(peekStoredSessionId())`
2. `index.ts:260` — visitor clicks "Decline" on the banner during the current session:
   `eraseIntentState(auditSession.sessionId)` (called immediately before the SDK halts)

Both call sites use `sessionStorage.removeItem(intentStateStorageKey(sessionId))` via
`eraseIntentState`. A visitor who denies or withdraws consent will have no `estalara_intent_*` entry
in their `sessionStorage` after the erase runs.

**Data category:** Inferred archetype / buyer-intent profile (pseudonymous). Specifically: a
categorisation of the visitor (e.g., family buyer, investor, downsizer) plus the numerical
probability weights that produced it. This constitutes profiling within the meaning of GDPR art.
4(4) — it is an automated evaluation of personal aspects relating to a natural person (buying
intent) using behavioral signals (scroll, clicks, dwell time).

**Lifetime:** `sessionStorage` is cleared by the browser on tab close. Within an open tab, the SDK
treats entries older than `INTENT_STATE_STALE_MS` (30 minutes) as expired and removes them
proactively on the next rehydration attempt (`session.ts:391–394`). The effective maximum lifetime
is therefore: tab lifetime, capped at 30 minutes since the last archetype write. There is no
cross-session persistence. There is no server-side copy of this entry. This is a client-only,
tab-scoped cache.

**Lawful basis:** Consent (GDPR Art. 6(1)(a), ePrivacy Art. 5(3)). The entry is written only when
the visitor has granted consent via the Estalara consent banner (Mode B / Mode A with explicit
opt-in via the Estalara Consent Helper). For Mode A sessions (no consent collected), the SDK halts
before reaching any `persistIntentState` call, and no intent-state entry is written.

**Necessity and proportionality:** Without the sessionStorage cache, the intent engine must
re-accumulate behavioral signals from scratch on every page navigation within the same tab,
producing slower and noisier archetype convergence. The cache eliminates this cold-start degradation
within a tab without introducing any cross-session or cross-tab tracking. The data minimization
principle (GDPR Art. 5(1)(c)) is satisfied: only the resolved intent state (already computed
server-side) is persisted, not the raw behavioral event stream. The 30-minute staleness window and
tab-close clearing enforce proportionality.

**Privacy-by-design controls:**

- `sessionStorage` (not `localStorage`): impossible to persist across tab close.
- Session-scoped key (`estalara_intent_{sessionId}`): isolates entries per tab, per session.
- Version guard (`INTENT_STATE_SCHEMA_VERSION`): any schema change causes silent rejection and
  re-computation from scratch — stale profiling data cannot outlive a schema bump.
- 30-minute staleness guard (`INTENT_STATE_STALE_MS`): limits the window in which a stale archetype
  label could influence adaptation.
- Erase on consent denial/withdrawal: no inferred profile data survives a consent revocation.

**No server-side retention obligation:** Because the data is client-only and is erased by the
browser on tab close (or sooner, on denial/withdrawal), there is no corresponding server-side
retention schedule entry required in ROPA Activity 3 or the Retention Schedule table. The entry is
absent from all server-side stores (Supabase, ClickHouse, Upstash). The existing ROPA Activity 3
(Session Embedding Computation) row describes the server-side equivalent archetype match stored in
`session_embeddings`. The client-side cache is a separate processing step now disclosed here and in
ROPA Activity 14.

**Dual-store erasure model (FOLLOW-230):** The inferred archetype / intent profile exists in two
independent stores and each has its own erasure path:

1. **Client cache (`estalara_intent_*`, sessionStorage):** Erased on consent denial or withdrawal by
   `eraseIntentState(sessionId)`, which calls
   `sessionStorage.removeItem(intentStateStorageKey(sessionId))` (verified at
   `packages/sdk/src/core/session.ts:427`). Called at two sites:
   - `packages/sdk/src/index.ts:209` — when a returning visitor's stored consent state is `'denied'`
     at SDK init (consent previously denied or mid-session withdrawal detected on reload).
   - `packages/sdk/src/index.ts:260` — when the visitor clicks "Decline" on the consent banner
     during the current session, immediately before the SDK halts. The browser additionally clears
     sessionStorage on tab close, providing a second independent clearing mechanism independent of
     any SDK code path.

2. **Server archetype (`session_embeddings` table, Postgres per-region):** Erased via the DSR
   erasure cascade (FOLLOW-039, implemented in `apps/control-plane/src/dsr/`). On receipt of an
   erasure DSR, the cascade executes a synchronous Postgres `DELETE WHERE session_id = $1` on
   `session_embeddings` (and `consent_records`, `engagement_scores`, `answers`) inside a single
   transaction, followed by asynchronous ClickHouse mutations on `adaptation_decisions`,
   `llm_calls`, `session_quality`. The cascade is described in DPIA §8 and documented in Master
   Design §H.1.1. The 13-month ClickHouse retention TTL enforces a bounded maximum lifetime without
   DSR action.

These two erasure paths are independent: the client cache is erased synchronously in the visitor's
browser on every consent denial/withdrawal event; the server archetype record is erased in response
to an explicit DSR erasure request (or naturally expires after 90 days via the nightly TTL cron).
Data subjects who wish to erase both stores should submit a DSR erasure request via the tenant's DSR
channel; the client-side cache is additionally cleared immediately upon withdrawing consent via the
consent banner.

**Required Privacy Notice update:** `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` §4 has been updated
(FOLLOW-230) to list all eight active SDK storage keys, including the three keys omitted from v1.1:
`estalara_variant:{sessionId}`, `__estalara_quiz_dismissed__`, and
`__estalara_micro_poll_dismissed__`. Each key now has an explicit consent classification and per-key
implementation notes with grep-verified source references. No separate SDK implementation work is
required for the three newly-listed keys — their storage behavior was already shipped.

**DPO gate:** DPO review of this section (§13.3) is required before EU pilot go-live, together with
§13.1 and §13.2. Status: **PENDING** — DPO sign-off not yet received. Gate tracked in
`docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` §5.

---

---

### 13.4 LIA — Buying-Intent Identification and Lead Ranking (Platform-wide Consent — FOLLOW-373)

**Context (CEO decision 2026-06-21):** The app.estalara.com pilot makes consent mandatory at
registration for all six processing purposes (a)–(f). Purposes (a)–(c) and (f) are disclosed as
consent-only. Purposes (d) (buying-intent identification) and (e) (lead ranking) additionally
require a documented balancing test because: (i) the consent is mandatory (no platform use without
it), meaning the voluntariness of consent is structurally constrained; (ii) the processing affects
how investors are surfaced to agents, which is an economic decision. This LIA is required
supplementary to the mandatory consent under GDPR Art. 6(1)(a) to demonstrate proportionality.

**Processing activity — Purpose (d): Buying-intent identification**

The 12-dimensional intent vector is derived from behavioral signals (scroll depth, dwell time, click
patterns, listing-view rate) and from chat-message analysis (Haiku/Sonnet NLP extractions yielding
`ChatIntentDetectedPayload` dimensions). The vector is stored in Upstash Redis shadow key
`shadow:{tenant_id}:{session_id}:chat_intent` with a 24-hour TTL. No raw chat text is stored by
Adaptive-Listings at any layer (C-07 boundary — see §3.1 above). The derived vector is used
exclusively to identify the investor's likely buying intent (purchase purpose, urgency, budget band,
family stage, geo priority, feature priority, cross-border status, finance complexity, decision
role, risk appetite, emotional state, tax awareness).

**Processing activity — Purpose (e): Lead ranking**

Investors are ranked by buying-intent strength derived from the behavioral embedding and the
12-dimensional chat-intent vector. This ranking is surfaced to agency staff via the agent-facing
dashboard and chat-summary UI. The ranking is pseudonymous (keyed by session_id / investor account
reference) and does not constitute a fully automated decision that "solely" determines a legal
effect on the investor (the agent retains discretion); GDPR Art. 22 is therefore not engaged for the
ranking itself. However, the ranking influences how prominently an investor is prioritized by
agents, which has a practical economic significance. This significance requires honest balancing.

**Legitimate interest test — Purpose (d):**

1. **Purpose test:** Identifying buying-intent from behavioral and chat signals is a genuine
   commercial interest of both Time2Show and the tenant agency. The tenant's business purpose is to
   facilitate property transactions; the investor's purpose in using the platform is to find and
   transact a property. Identifying buyer seriousness and intent is a legitimate purpose within the
   real estate context and within the investor's reasonable expectations when signing up to a
   platform that explicitly markets AI-driven buyer matching.

2. **Necessity test:** The 12-dim vector is the minimum data needed to drive archetype-prior
   updates. Raw chat messages are not needed (and are not retained — C-07 boundary). The 24-hour TTL
   limits staleness. No less privacy-invasive alternative achieves the same intent-signal precision.

3. **Balancing test:**
   - The data is pseudonymous: the 12-dim vector is keyed by session_id (HMAC hash). It contains
     structured enumeration values, not free text. Re-identification from the vector alone is
     technically infeasible.
   - The investor reasonably expects that a real estate personalization platform reads their
     expressed preferences and browsing behavior to improve listing relevance. The six purposes are
     explicitly disclosed at registration.
   - The mandatory-consent structure constrains voluntariness. However, the investor retains the
     ability to exercise a DSR erasure request at any time, which triggers cascade deletion of the
     intent vector, session embeddings, and adaptation log (§8 of this DPIA). The FOLLOW-372 DOM
     opt-out toggle provides an additional safeguard (see §13.5 below).
   - **Balancing test result: PASSES**, subject to three conditions: (i) the six purposes are fully
     disclosed at registration before account creation; (ii) a DSR erasure pathway is accessible to
     the investor via the tenant; (iii) the C-07 boundary (no raw chat text in AL) is maintained.

**Legitimate interest test — Purpose (e):**

1. **Purpose test:** Lead ranking by buying-intent strength is a core product value proposition for
   the tenant agency. Agents with limited bandwidth benefit from prioritizing the most serious
   buyers first. This is a genuine and specific commercial interest.

2. **Necessity test:** Ranking requires the buying-intent signal (purpose d). No less invasive
   alternative produces equivalent ranking quality without the behavioral + chat-intent signals.

3. **Balancing test:**
   - The ranking is pseudonymous within the AL stack and is surfaced to the tenant agency alongside
     the investor's own account information (which the investor provided directly to the agency).
   - The investor has a reasonable expectation, on a platform where they registered to interact with
     agents, that their expressed behavior is used to shape how agents respond to them.
   - The agent retains full discretion; the ranking is an advisory signal, not an automated
     determinative decision (GDPR Art. 22 not engaged).
   - The investor can exercise a DSR erasure request to remove their session data from the ranking
     signal (§8).
   - **Balancing test result: PASSES**, on the same conditions as purpose (d).

**Conclusion:** Purposes (d) and (e) are lawful under GDPR Art. 6(1)(a) (mandatory registration
consent) supplemented by a documented LI basis (Art. 6(1)(f)) providing the proportionality
framework above. The consent is reinforced by the LIA. Both bases are on the record.

**Lawful basis for app-side purposes (b) and (f):** Raw chat text (purpose b) is stored APP-SIDE
only. AL has no role in its storage or retention. AL's role is limited to reading the text in-flight
to extract the 12-dim vector. Purpose (f) (agent-facing chat summaries) is implemented APP-SIDE by
Rafał Palak's team. AL's contribution to purpose (f) is limited to the intent vector that informs
the summary generation. The lawful basis for the full purpose (f) is consent (mandatory
registration) declared at app.estalara.com. Time2Show documents its contribution; Rafał implements
the app-side enforcement.

**IMPLEMENTATION FOLLOW:** App-side data retention/deletion windows for purposes (b) and (f) are
documented in a HANDOFF to Rafał Palak in `backlog/HANDOFFS.md` (FOLLOW-373 → Rafał Palak, CTO). The
retention windows for AL-owned data (12-dim intent vector: 24 h Redis TTL; session embeddings: 90
days; adaptation decisions: 13 months) are already enforced in shipped code and are re-asserted in
ROPA Activity 16 (§below in ROPA).

**DPO gate:** DPO review of this §13.4 LIA is required before the mandatory-consent registration
flow is deployed to production. Status: **PENDING** — DPO sign-off not yet received. Gate is tracked
in `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` §5 (DPO Gate, item added by FOLLOW-373).

---

### 13.5 Addendum — FOLLOW-372 Suspend-Not-Erase Sufficiency for AL-DOM Opt-Out

**Purpose:** Determine whether the reversible "suspend" opt-out for AL DOM adaptation (FOLLOW-372)
is legally sufficient for the AL-only DOM adaptation processing, without triggering a full consent
withdrawal and erasure.

**Scope of the FOLLOW-372 toggle:** The toggle controls Adaptive-Listings DOM adaptation only. When
OFF: the SDK skips `applyArchetypeHints()` and intent-weight updates; the Decision API returns
neutral directives (no personalization). When ON: full adaptation resumes with no data loss. The
toggle does NOT affect app.estalara.com's buying-intent identification (purpose d), lead ranking
(purpose e), or agent-facing chat summaries (purpose f) — those ride the mandatory registration
consent (§H.8 of Master Design) and are outside AL's per-user opt-out scope.

**Does suspend create new PII?** No. The suspend state is stored as a localStorage key (per-user,
per-device) and optionally as a `consent_records` row with `consent_type = 'al_dom_opt_out'`. No new
behavioral data is generated during the suspended period — the SDK emits no events, collects no
signals, and performs no embeddings. The 12-dim intent vector accumulated before the opt-out
continues to expire naturally under the 24-hour Redis TTL; the `session_embeddings` record continues
toward its 90-day TTL. No new data accumulation occurs.

**Is suspend-not-erase sufficient for GDPR Art. 18 (restriction) and Art. 21 (objection)?** Yes, for
AL-DOM processing only.

- **Art. 21 objection to LI-basis processing:** The FOLLOW-372 toggle satisfies the Art. 21
  objection right for AL DOM adaptation where the lawful basis is LI (Mode A / Mode C anonymous
  visitors). Activating the toggle stops the LI-basis processing immediately. This is the correct
  mechanism — Art. 21 requires cessation of processing, not erasure.

- **Art. 17 erasure (consent withdrawal):** The mandatory registration consent (Mode B for
  app.estalara.com investors) is a separate matter. Consent withdrawal by a registered investor is
  handled by the FOLLOW-139 erasure path (consent banner "Withdraw" → cascade deletion). The
  FOLLOW-372 toggle is an opt-out of DOM adaptation only, not a consent withdrawal. An investor who
  suspends DOM adaptation retains their registration consent and continues to receive the
  registration-gated services (chat, lead visibility, agent summaries). This is explicitly
  communicated in the toggle UX (FOLLOW-372 AC).

- **No new processing ceases to be necessary:** The 12-dim vector, session embeddings, and
  adaptation logs that already exist are subject to their existing retention schedules. No new
  retention obligation is created by the suspended state. The suspension gate in the SDK and
  Decision API is a processing gate, not a deletion gate.

**Conclusion: Suspend-not-erase is legally sufficient for AL-only DOM adaptation opt-out.** The
toggle satisfies the Art. 21 objection right for DOM adaptation. It does not affect the Art. 17
erasure right (which remains on the consent-withdrawal path). No new PII is created by the suspend
state. The 12-dim vector TTL continues to expire naturally. FOLLOW-372 may proceed without requiring
a full erasure cascade.

**DPO gate:** DPO review of this §13.5 addendum is required before the FOLLOW-372 toggle is deployed
to production. Status: **PENDING** — tracked alongside §13.4 DPO gate above.

---

_Sections 13.1 and 13.2 added 2026-05-27 in response to Audit Findings F-13 and F-14 (Sprint 1 GDPR
gate). Authored by Compliance Engineering. Updated 2026-05-27 (FOLLOW-129): cross-references to
`packages/sdk/src/ui/consent-banner.ts` and FOLLOW-128 added; §13.2 balancing test marked GREEN
contingent on FOLLOW-128 deployment; privacy notice template created at
`docs/compliance/PRIVACY_NOTICE_TEMPLATE.md`; pilot runbook EU pre-flight gate added. Updated
2026-05-28 (FOLLOW-139): §13.2 balancing test transitioned to unconditionally GREEN following
implementation of `localStorage` 90-day TTL cross-session identifier with erasure-on-withdrawal in
`packages/sdk/src/core/session.ts` (`getOrCreateCrossSessionId`, `eraseCrossSessionId`), wiring
`getOrCreateCrossSessionId()` into the consent-granted path in `packages/sdk/src/index.ts` (called
both on init when consent is already 'granted' and in the `onGranted` banner callback), and wiring
`eraseCrossSessionId()` into the consent-denied path._ Section 13.3 added 2026-06-08 (FOLLOW-218):
disclosure for `estalara_intent_*` sessionStorage intent-state store introduced by FOLLOW-176 / PR
#217. Section 13.4 and 13.5 added 2026-06-21 (FOLLOW-373): platform-wide consent umbrella LIA for
purposes (d) and (e) and FOLLOW-372 suspend-not-erase sufficiency addendum.

_**DPO gate status: PENDING.** DPO sign-off on §13.1, §13.2, §13.3, §13.4, and §13.5 LIAs has not
yet been received. This is a hard gate before EU pilot go-live. DPO sign-off must be recorded by
updating this note and the gate line in `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` §5.
Responsible: Compliance Engineering (coordinate with external DPO-as-a-Service provider — contact:
compliance@estalara.com)._
