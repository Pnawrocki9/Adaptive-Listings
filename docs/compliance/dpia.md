# Data Protection Impact Assessment (DPIA)

**Document ID:** ESTALARA-DPIA-001
**Version:** 1.0
**Date:** 2026-05-15
**Authors:** Estalara Technologies Ltd. — Compliance Engineering
**DPO Review Status:** Pending appointment (DPO appointment in progress; placeholder: dpo@estalara.io)
**Next Mandatory Review Date:** 2027-05-15 (annual) or upon any material change to processing described herein, whichever is sooner.
**Classification:** Internal — Restricted

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

---

## 1. Executive Summary

Estalara Adaptive Listings is an embeddable AI personalization layer for real estate websites. It captures anonymous behavioral signals — scroll depth, click events, listing view events, and optional chat-based intent queries — from visitors to tenant-operated property listing websites, and uses those signals to adapt how listings are presented in real time to each anonymous visitor. The system operates across three integration tiers (Observer, Augment, and Native), processes data in four geographic regions (EU, US, UK, UAE), and is delivered as a software-as-a-service product used by real estate agencies (tenants). No personally identifiable information is collected by Estalara; visitor identity is represented solely by a session-scoped HMAC hash that rotates on tab close or thirty minutes of idle time. The system never reads cookies, never stores login credentials, and never requires user registration.

This DPIA is required under Article 35(3)(c) of the General Data Protection Regulation (EU) 2016/679 because Estalara engages in systematic monitoring of behavior of data subjects on a publicly accessible area (real estate listing websites) on a large scale. The behavioral fingerprinting technique employed — combining canvas hash, AudioContext hash, screen and viewport parameters, timezone, language, and WebGL renderer attributes into a session-keyed HMAC — constitutes "access to information stored in terminal equipment" within the meaning of Article 5(3) of Directive 2002/58/EC (ePrivacy Directive), and "processing of personal data relating to natural persons" within the meaning of the GDPR because a session-scoped pseudonymous identifier constitutes personal data under Article 4(1) when associated with online behavior. EDPB Guidelines 2/2023 on technical storage and access (finalized October 2024) confirm that fingerprinting is covered by ePrivacy Article 5(3) regardless of whether cookies are used. This document identifies the necessity and proportionality of that processing, assesses its risks, and documents the mitigations in place.

---

## 2. System Description and Processing Description

### 2.1 Integration Tiers

Estalara operates in three integration tiers:

- **Tier 1 Observer:** A read-only sidebar or floating widget injected into tenant websites via a JavaScript snippet. Observes visitor behavior (scroll, click, listing view, chat input). Makes no DOM mutations to the host page. Sends batched behavioral events to the Estalara ingest endpoint.
- **Tier 2 Augment:** Declarative DOM slot mutations — headline text, photo order, feature highlights — driven by adaptation directives returned by the Estalara Decision API. Requires tenant to declare slot identifiers. Light mutation of host page content.
- **Tier 3 Native:** A full `<EstalaraListing/>` Preact component owned and rendered by Estalara, embedding the entire listing experience including adaptive UI. Maximum personalization capability; tenant delegates full listing display to Estalara.

All tiers share the same ingest pipeline, privacy controls, and lawful basis regime. Behavioral data is processed identically regardless of integration tier.

### 2.2 Consent Modes

Per Master Design section G.2, every tenant session operates in exactly one of three consent modes determined at session initialization:

- **Mode A — Session Mode (default):** The session fingerprint hash is computed per-session using `HMAC(tenant_secret, fingerprint_entropy, day_bucket)`. The hash rotates on tab close or thirty minutes of idle time. Cross-session linking is technically impossible because the day bucket changes. Cross-tenant correlation is impossible because the tenant secret differs per tenant. This mode relies on the ePrivacy Directive Article 5(3)(b) "strictly necessary" exemption for services explicitly requested by the user. It does not require a consent banner. Data is scoped to one session on one tenant site.
- **Mode B — Consented Mode:** Tenant collects explicit user consent via the Estalara Consent Helper or their own CMP, and passes a verified consent record to Estalara via API. Full behavioral fingerprint with ninety-day persistence is enabled. Cross-listing journeys within a declared partner group are permitted. Sessions in Mode B contribute to global archetype training (with differential privacy protections applied).
- **Mode C — Legitimate Interest Mode:** Narrow use cases only, such as duplicate listing spam detection. Not permitted for marketing personalization per EDPB Guidelines on legitimate interests and CNIL enforcement guidance. This mode is tenant-configurable but subject to a documented Legitimate Interest Assessment.

### 2.3 System Components

| Component | Technology | Function | Data Processed |
|---|---|---|---|
| JavaScript SDK | TypeScript 5 + Preact 10, Shadow DOM | Behavioral signal capture and session fingerprinting | Canvas hash, AudioContext hash, screen/viewport/timezone/language, WebGL renderer attributes |
| Edge Ingest | Cloudflare Workers (regions: fra/lhr/iad/dxb) | Event validation, HMAC auth, batching to event bus | Behavioral event payloads, session_id hash, tenant_id |
| Event Bus | Redpanda Cloud (Kafka-compatible) | Durable ordered delivery of behavioral events | Same as Edge Ingest |
| Intent Engine | Modal (Python), Claude Haiku 4.5 | Intent extraction, embedding computation | Behavioral event sequence, session embedding vector |
| Session Embeddings Store | Supabase (Postgres 16) per-region | Per-session 1024-dim embedding + archetype match | session_id, tenant_id, embedding vector, matched archetype |
| Global Archetype Store | Supabase + pgvector | Cross-tenant DP-aggregated archetype centroids | DP-anonymized embedding vectors; no session_id, no tenant_id |
| Adaptation Engine | Modal (Python), Claude Sonnet 4.6 | Listing adaptation directive generation | Session embedding, archetype label, listing metadata |
| Decision API | Next.js 15 Edge Runtime on Vercel | Returns JSON adaptation directives in real time | session_id, archetype, adaptation variant |
| ClickHouse Cloud | ClickHouse (event store) | Immutable adaptation decision log, analytics | session_id, archetype, directive type, holdout_group, timestamps |
| Consent Records | Supabase (Postgres 16) | Consent state storage | session_id, consent_type, granted boolean, encrypted ip_address |
| DSR Queue | Control Plane API + Postgres | Data subject request processing | DSR type, session_id or fingerprint_hash, jurisdiction |
| Control Plane | Next.js 15 App Router on Vercel | Tenant dashboard, configuration, analytics, billing | Tenant admin email, billing info, usage metrics |
| Cache | Upstash Redis (multi-region) | Session intent vector cache, adaptation cache | session_id → embedding vector (TTL-bounded) |
| LLM Provider | Anthropic API (Claude Haiku 4.5 / Sonnet 4.6) | Intent extraction prompts, adaptation reasoning | Behavioral context strings; no direct PII per DPA |
| Embeddings Provider | OpenAI API (text-embedding-3-small) | 1024-dim embedding generation | Behavioral signal text; no direct PII per DPA |
| Error Tracking | Sentry | Error and performance monitoring | Stack traces, request context (scrubbed of PII) |

### 2.4 Data Flows

1. Visitor arrives at tenant website. SDK loads in Shadow DOM.
2. SDK computes session fingerprint from browser attributes; hashes with `HMAC(tenant_secret, entropy, day_bucket)`. No hash is stored client-side beyond the current session.
3. Behavioral events (scroll, click, listing_view, chat_message) are batched every two seconds and sent to the nearest Cloudflare Worker ingest endpoint via HTTPS.
4. The Worker validates the event against Zod schemas, authenticates via HMAC-signed API key, and publishes to Redpanda. Ingest ACK returns within fifty milliseconds p95.
5. Redpanda delivers events to the Intent Engine (Modal). Intent Engine computes or updates the session embedding vector and stores it in `session_embeddings` (Postgres).
6. Decision API reads the embedding, matches against global archetype space via cosine similarity, applies Thompson sampling A/B weights from `ab_bandit_weights`, and returns adaptation directives as JSON.
7. SDK or Tier 2/3 integration applies directives to the listing presentation.
8. Adaptation decision is logged to ClickHouse (`adaptation_decisions` table, thirteen-month retention).
9. On session expiry (tab close or thirty-minute idle), session state is released from Redis cache.
10. Nightly batch job applies k-anonymity (k≥50) and Differential Privacy (ε≤2 per epoch) to aggregate session embeddings into global archetype centroids. Aggregation output contains no session_id, no tenant_id, no PII.

### 2.5 Data Types and Retention

| Data Type | Store | Retention | Basis |
|---|---|---|---|
| Behavioral event payload (scroll, click, view) | Redpanda (transient) | Session scope; purged after Intent Engine consumption | Processing necessity |
| Session fingerprint hash (session_id) | Redis cache, Postgres (session_embeddings) | 30 min idle + tab close (Redis); 90 days from last active event (Postgres) | Processing necessity; ePrivacy 5(3)(b) |
| Session embedding vector (1024-dim) | Postgres: `session_embeddings` | 90 days from last active event | LI — intent matching |
| Archetype match and adaptation decisions | ClickHouse: `adaptation_decisions` | 13 months (AI Act audit trail per Master Design H.2) | Legal obligation + LI |
| LLM call records | ClickHouse: `llm_calls` | 13 months | Audit, model improvement |
| Consent records | Postgres: `consent_records` | 3 years from consent event | Legal obligation (Art. 6.1.c) |
| DSR tokens | Postgres: `dsr_tokens` | 30 days from DSR resolution | Legal obligation |
| A/B bandit weights | Postgres: `ab_bandit_weights` | Retained (anonymized — no session_id) | Legitimate interest |
| Global archetype embeddings | Postgres: `archetype_embeddings` | Indefinite (no personal data post-DP-aggregation) | Legitimate interest |
| Tenant configuration and admin contact | Postgres: `tenants`, `users` | Contract duration + 7 years | Art. 6.1.b (contract) |
| Billing records | Postgres + Stripe | Contract duration + 7 years | Legal obligation |
| Staff audit log | Postgres: `staff_audit_log` | 7 years | Legal obligation + Art. 6.1.c |
| LLM prompt content (Anthropic) | Not retained by Anthropic per DPA | Zero retention (DPA clause required) | Processor DPA |

### 2.6 Third-Party Processors

| Processor | Role | Data Category | DPA Status |
|---|---|---|---|
| Anthropic | LLM inference (Claude Haiku 4.5, Sonnet 4.6) | Behavioral context prompts (no PII) | DPA required — zero-retention clause |
| OpenAI | Embedding computation (text-embedding-3-small) | Behavioral context text (no PII) | DPA required — zero-retention clause |
| Cloudflare | Edge ingest, CDN, Workers | Event payloads, session_id, IP address (transient) | DPA in place (Cloudflare Enterprise DPA) |
| Supabase | Postgres (per-region projects) | All Postgres tables listed in 2.5 | DPA required — per-region projects (EU, US, UK, UAE) |
| ClickHouse Cloud | Event store | adaptation_decisions, llm_calls | DPA required |
| Upstash | Redis cache (multi-region) | Session intent vectors (TTL-bounded) | DPA required |
| Modal | ML compute (serverless) | Embedding computation, archetype update jobs | DPA required |
| Redpanda Cloud | Event bus | Behavioral event payloads (transient) | DPA required |
| Vercel | Control plane hosting | Tenant admin sessions, dashboard traffic | DPA in place (Vercel DPA) |
| Sentry | Error and performance tracking | Stack traces, scrubbed request context | DPA in place (Sentry DPA) |
| Stripe | Billing and payment processing | Tenant billing details, invoices | DPA in place (Stripe DPA) |

---

## 3. Necessity and Proportionality

### 3.1 Purpose Specification

Estalara processes behavioral signals exclusively for the purpose of real-time personalization of real estate listing presentations. The specific objectives are: (a) inferring the likely property-type intent of an anonymous visitor (the "archetype" — e.g., family buyer, investment buyer) from behavioral signals without requiring registration or login; (b) adapting the order, emphasis, and framing of listing information to match that inferred intent; and (c) improving archetype detection accuracy over time through privacy-preserving cross-tenant aggregation.

### 3.2 Why Behavioral Signals Are the Minimum Required

A visitor browsing a real estate website without logging in leaves no profile. Traditional personalization either requires login (creating PII obligations and friction that drives visitors away) or cookie-based cross-site tracking (now blocked by Safari ITP, Firefox ETP, and Brave by default, and legally restricted across all operating jurisdictions). Estalara's design was chosen because:

- Behavioral signals (scroll depth to certain sections, dwell time on price vs. floor plan, click patterns across listings, chat questions) are reliable proxies for buyer intent that do not require any PII collection.
- Session-scoped HMAC hashing ensures the signals are linked within a session for coherent adaptation but cannot be linked across sessions or across tenants, eliminating cross-session profiling as a technical possibility.
- The fingerprinting attributes used (canvas hash, AudioContext hash, viewport dimensions, timezone, language, WebGL renderer) are standard browser-accessible APIs. No camera, microphone, geolocation, or device identifier is accessed.
- Alternatives considered and rejected: (i) cookie-based session persistence — rejected because legally restricted under ePrivacy Art. 5(3) without consent in EU/UK/UAE, and technically ineffective in modern browsers; (ii) login-gated personalization — rejected because it fundamentally changes the visitor experience and introduces PII obligations inconsistent with Estalara's privacy-by-design architecture; (iii) IP-address based inference — rejected because EDPB Guidelines 2/2023 classify IP-only tracking as within the scope of ePrivacy Art. 5(3), and IP addresses are personal data under GDPR (Court of Justice, Case C-582/14, Breyer).

### 3.3 Data Minimization Measures

The following measures implement data minimization as required by GDPR Article 5(1)(c):

- **Session-scoped HMAC rotation:** The session identifier changes at every tab close and every thirty minutes of idle time. After rotation, there is no technical mechanism to link the new session to the previous one within Estalara's system (the HMAC key incorporates a day_bucket; even within the same calendar day, tab close resets the session).
- **No PII fields in event schema:** The Estalara ingest Zod schema enforces a PII blocklist. Fields containing email, name, phone, or national identification patterns are rejected at the Edge Ingest layer. The schema is validated in CI.
- **k-anonymity requirement (k≥50):** An archetype centroid is published to the global archetype store only if at least fifty unique sessions from at least three distinct tenants contributed to the cluster. Sessions that form a cluster of fewer than fifty are suppressed.
- **Differential Privacy (ε≤2 per epoch):** Gaussian noise scaled to the DP-SGD privacy budget is added to embedding updates during the nightly archetype aggregation job. The cumulative privacy budget is tracked per epoch and reset annually. This provides a formal mathematical guarantee that no individual session's contribution to an archetype centroid can be reverse-engineered.
- **No raw PII in global store:** The global `archetype_embeddings` table contains only aggregate embedding vectors and metadata (archetype name, confidence threshold, sample count). No session_id, no tenant_id, no personal data of any kind.
- **Consent-aware aggregation:** Sessions in Mode A (Session Mode) contribute only to tenant-local archetype matching and not to global cross-tenant training. Only Mode B (Consented) sessions contribute to the global archetype space. This ensures that cross-tenant aggregation is underpinned by explicit consent.

### 3.4 CNIL Guidance on Legitimate Interest for AI Development

CNIL published guidance in June 2025 (Recommendations on relying on legitimate interests to develop AI systems) confirming that commercial entities may invoke legitimate interest under GDPR Article 6(1)(f) for AI model development purposes, subject to a balancing test. Estalara's Legitimate Interest Assessment documents: (a) the legitimate interest pursued (real-time listing personalization and archetype model improvement); (b) the necessity of behavioral processing for that interest; and (c) the balancing test (data subjects browsing property listings have a reasonable expectation of receiving a personalized experience; the data is pseudonymous and session-scoped; the impact on their rights and freedoms is minimal given the k-anonymity and DP safeguards). Full LIA is maintained in `docs/compliance/lia-template.md` (produced under TICKET-GDPR-003).

### 3.5 Purpose Limitation

Behavioral data is used only for listing personalization and archetype model improvement. It is never used for: targeted advertising outside the tenant website; credit scoring; employment decisions; insurance underwriting; political profiling; or any purpose beyond real estate listing presentation optimization. Tenant DPAs prohibit secondary use. Anthropic and OpenAI DPAs include zero-retention clauses for prompt content.

---

## 4. Risk Assessment

The following five risks are identified as material. Each is assessed on likelihood (Low / Medium / High) and inherent severity (Low / Medium / High) before mitigation.

### Risk A — Re-identification via Fingerprint Cross-Correlation

**Description:** A sophisticated adversary (including a tenant, a third-party analytics provider injected on the same page, or a law enforcement agency) could attempt to cross-correlate Estalara session fingerprints with external data sources (browser fingerprinting databases, IP geolocation, timing side-channels) to re-identify individual visitors.

**Likelihood (pre-mitigation):** Medium. Browser fingerprinting accuracy degrades below fifty percent after twenty-four hours due to Safari ITP, Firefox ETP, and Brave farbling (Kochava research, 2024). Cross-session re-identification requires access to both the raw fingerprint entropy and the tenant secret used in the HMAC; the tenant secret is stored server-side only.

**Severity (pre-mitigation):** High. Re-identification of anonymous property browsing behavior could reveal sensitive information about an individual's financial situation, family composition, or place of intended residence.

**Mitigations:**
- HMAC with tenant-secret: the session hash cannot be reverse-engineered without the tenant secret, which is stored exclusively in Doppler / environment secrets and never transmitted to the client.
- Day-bucket rotation: even with the tenant secret, an adversary cannot link sessions across days.
- k-anonymity (k≥50) on all cross-tenant aggregations prevents statistical re-identification from global data.
- Differential Privacy (ε≤2) provides formal mathematical re-identification resistance at the global archetype layer.
- Tenant-isolated data storage: RLS policies prevent any tenant from querying another tenant's session data.

**Residual Likelihood:** Low. **Residual Severity:** Medium. **Residual Risk:** LOW-MEDIUM.

### Risk B — Cross-Border Data Transfer Exposure

**Description:** Behavioral data processed in EU and UK regions is transmitted to US-based processors (Anthropic API, OpenAI embeddings API) for LLM inference and embedding computation. Following the Schrems II judgment (Data Protection Commissioner v. Facebook Ireland, Case C-311/18), transfers to US entities that are subject to US surveillance laws (FISA 702, EO 12333) carry a residual risk that SCCs alone may be insufficient without supplementary measures.

**Likelihood (pre-mitigation):** Medium. The EU-US Data Privacy Framework (DPF) entered into force in July 2023 and provides an adequacy decision for DPF-certified US entities. Anthropic and OpenAI must be confirmed as DPF participants. Even so, a future adequacy challenge (a "Schrems III" scenario) could invalidate the DPF.

**Severity (pre-mitigation):** Medium. The data transferred is behavioral context without PII; even if intercepted, it does not directly identify individuals.

**Mitigations:**
- Standard Contractual Clauses (Module 2, Controller to Processor) executed with Anthropic and OpenAI.
- Zero-retention DPA clauses: Anthropic and OpenAI contractually commit to not retaining prompt content.
- Transfer Impact Assessment (TIA) maintained in `docs/compliance/transfers/`.
- Behavioral context sent to LLM endpoints contains no direct PII (enforced by PII blocklist at ingest).
- UK IDTA executed for UK-to-US transfers (Anthropic, OpenAI).
- UAE data: LLM inference uses the nearest available Bedrock region (eu-central-1 for MVP); UAE event data remains in Cloudflare dxb / AWS me-central-1 and is not transferred except as DP-anonymized archetype vectors.

**Residual Likelihood:** Low-Medium. **Residual Severity:** Low-Medium. **Residual Risk:** LOW.

### Risk C — LLM Provider (Anthropic) Data Retention

**Description:** When behavioral context is sent to the Anthropic API for intent extraction or adaptation reasoning, there is a risk that Anthropic retains prompt content for model training, safety review, or abuse monitoring, beyond what is disclosed in its public documentation.

**Likelihood (pre-mitigation):** Low-Medium. Anthropic's enterprise DPA includes a "no training on customer data" clause, but usage monitoring for safety may occur.

**Severity (pre-mitigation):** Medium. If behavioral context were retained and linked to other data held by Anthropic, it could contribute to a data subject's profile in ways not anticipated by Estalara or the data subject.

**Mitigations:**
- DPA with Anthropic must include explicit zero-retention clause for prompt content.
- Behavioral context sent in prompts is stripped of any potential PII by the PII-blocklist layer before reaching the LLM gateway.
- LiteLLM router logs all LLM calls to the internal `llm_calls` ClickHouse table (thirteen-month retention) for auditability.
- DPA compliance verification is a condition of the Estalara onboarding gate for new LLM providers.

**Residual Likelihood:** Low. **Residual Severity:** Low-Medium. **Residual Risk:** LOW.

### Risk D — Unauthorized Tenant Access to Another Tenant's Session Data

**Description:** A misconfiguration of Row Level Security policies, a bug in the tenant JWT claim extraction, or a tenant-side API key compromise could allow one tenant to read or manipulate session embeddings, adaptation decisions, or behavioral data belonging to another tenant.

**Likelihood (pre-mitigation):** Low. RLS policies are enforced at the Supabase (Postgres) level and are tested in CI.

**Severity (pre-mitigation):** High. Cross-tenant data access would constitute a personal data breach under GDPR Article 4(12), triggering seventy-two-hour notification obligations to supervisory authorities and potentially to affected data subjects.

**Mitigations:**
- All Postgres tables with session-level data have RLS policies enforced at the database level (not application level). Application-level bypasses are audited and prohibited.
- Tenant JWT claims are validated at every API request; tenant_id is extracted from the signed JWT, not from request parameters.
- ClickHouse event store uses per-tenant partition keys and column-level access controls.
- The HMAC session hash incorporates the tenant_secret, making cross-tenant session hash reuse technically impossible even if an API key were compromised.
- Automated RLS policy tests run on every CI pass (packages/db test suite).

**Residual Likelihood:** Very Low. **Residual Severity:** High. **Residual Risk:** LOW (given high severity but very low likelihood and hard technical controls).

### Risk E — Regulatory Enforcement Action on Fingerprinting

**Description:** National supervisory authorities (CNIL, ICO, UAE Data Office, Polish UODO) may determine that Estalara's Mode A fingerprinting does not qualify for the ePrivacy Directive Article 5(3)(b) strictly necessary exemption, and may issue enforcement orders, fines, or require consent for all fingerprinting activities.

**Likelihood (pre-mitigation):** Medium. The ICO's December 2024 statement on Google's fingerprinting policy change describes fingerprinting as "not a fair means of tracking" and sets a "high bar" for compliance. The CNIL enforcement trend (€325M Google, September 2025) indicates intensifying scrutiny. The ICO's December 2024 guidance does, however, confirm that session-scoped recording of user interactions may satisfy the strictly necessary exemption.

**Severity (pre-mitigation):** High. Under GDPR Article 83(5), supervisory authorities may impose fines of up to €20M or four percent of global annual turnover. An enforcement order requiring consent for all fingerprinting would require immediate product changes and could affect EU/UK/UAE tenant onboarding.

**Mitigations:**
- Mode A is designed specifically around the strictly necessary exemption: session-scoped, rotates on idle/close, never persists across sessions, no cross-tenant use.
- Legal analysis and LIA are maintained and reviewed at minimum annually and upon any material guidance change.
- `docs/compliance/REGULATORY_WATCH.md` tracks EDPB guidelines, ICO guidance, CNIL enforcement actions, and UODO developments.
- Consent Helper is available as a Mode B upgrade path for any tenant or jurisdiction where Mode A coverage is uncertain.
- This DPIA is a living document; regulatory guidance changes trigger a re-assessment within thirty days.
- DPO (once appointed) will engage proactively with ICO and CNIL for informal guidance on the Mode A strictly necessary analysis.

**Residual Likelihood:** Low-Medium. **Residual Severity:** High. **Residual Risk:** MEDIUM. This risk is flagged for ongoing monitoring. It does not constitute a "High" residual risk blocking production launch because Mode B (Consent Mode) provides a compliant fallback for any jurisdiction where Mode A coverage is challenged, and the strictly necessary legal analysis is well-grounded in current ICO guidance. However, the DPO must review this risk assessment before the EU pilot launch.

---

## 5. Mitigations and Residual Risk Summary

| Risk | Residual Likelihood | Residual Severity | Residual Risk | Production Launch Blocker? |
|---|---|---|---|---|
| A — Re-identification | Low | Medium | LOW-MEDIUM | No |
| B — Cross-border transfer | Low-Medium | Low-Medium | LOW | No |
| C — Anthropic data retention | Low | Low-Medium | LOW | No |
| D — Cross-tenant data leak | Very Low | High | LOW | No |
| E — Regulatory enforcement | Low-Medium | High | MEDIUM | No (Mode B fallback available; DPO review required before EU pilot) |

**Overall Residual Risk Assessment:** MEDIUM, driven primarily by Risk E. The overall assessment does not reach HIGH. No risks rated HIGH residual risk are present. Supervisory authority pre-consultation under GDPR Article 36 is not required at this time (overall residual risk is Medium, not High). DPO review of Risk E is required before EU pilot launch.

---

## 6. Jurisdictional Addenda

### 6.1 EU GDPR

**DPIA obligation:** This DPIA is required under GDPR Article 35(3)(c) ("systematic monitoring of a publicly accessible area on a large scale"). Real estate listing websites are publicly accessible. Estalara's behavioral monitoring is systematic (rule-based, automatic, across all sessions on a tenant site) and operates at scale across multiple tenants.

**Lawful basis:** Article 6(1)(f) — Legitimate Interest — for behavioral analytics and listing personalization (Mode A and Mode C tenants). Article 6(1)(a) — Consent — for Mode B tenants where explicit consent has been collected by the tenant via CMP or Estalara Consent Helper. Article 6(1)(b) — Contract Performance — for tenant account and billing data processing.

**ePrivacy:** Article 5(3) of Directive 2002/58/EC requires prior consent for access to terminal equipment unless the access is strictly necessary for a service explicitly requested by the subscriber or user. Mode A relies on the strictly necessary exemption. Mode B requires consent collected by the tenant. The Estalara Consent Helper is available as a drop-in component.

**DPO appointment:** An EU-based DPO is being appointed. The DPO will be registered with the relevant national supervisory authority (Polish UODO, as Estalara's founders are based in Poland). Placeholder: dpo@estalara.io.

**EDPB Guidelines 2/2023:** These guidelines (finalized October 2024) confirm that fingerprinting is within the scope of ePrivacy Article 5(3). Estalara's Mode A design has been assessed against these guidelines. The strictly necessary analysis is documented in the LIA (TICKET-GDPR-003).

### 6.2 UK GDPR and PECR

**UK GDPR:** Post-Brexit, UK data protection is governed by the UK GDPR (as retained in domestic law by the European Union (Withdrawal) Act 2018) and the Data Protection Act 2018. The substantive obligations are materially identical to EU GDPR.

**PECR:** The Privacy and Electronic Communications Regulations 2003 (SI 2003/2426) implement ePrivacy Article 5(3) in the UK. Rule 6 of PECR requires consent (or the strictly necessary exemption) for storing or accessing information on a user's device. Estalara's Mode A relies on the strictly necessary exemption under PECR Rule 6(4): the fingerprinting is solely for the purpose of delivering the interactive listing experience explicitly requested by the visitor.

**ICO position:** The ICO's December 2024 statement on fingerprinting confirms that fingerprinting is "not a fair means of tracking" in the advertising context, but distinguishes session-scoped functional uses. The ICO's draft guidance on online tracking (December 2024) confirms that "recording information or selections made on an online service" may satisfy the strictly necessary exemption. Estalara's Mode A falls within this characterization. The ICO's online tracking strategy for 2025 is tracked in `docs/compliance/REGULATORY_WATCH.md`.

**ICO DPO registration:** An ICO-registered DPO is required (UK GDPR Article 37). The appointed DPO (or EU DPO with UK coverage) will be registered with the ICO before any UK tenant goes live.

**IDTA:** UK-to-US transfers (Anthropic, OpenAI) are covered by the UK International Data Transfer Agreement, the UK equivalent of EU SCCs.

### 6.3 US — CCPA / CPRA (California)

**Applicable law:** California Consumer Privacy Act (Cal. Civ. Code § 1798.100 et seq.) as amended by the California Privacy Rights Act (Proposition 24, 2020). Applicable to any business that processes personal information of California residents above the CCPA thresholds.

**Browser fingerprints as unique personal identifiers:** Under Cal. Civ. Code § 1798.140(ae), "unique personal identifier" includes "a device identifier" and an "alias" persistently linked to a person. A browser fingerprint is classified as a unique personal identifier under CCPA. Even Estalara's session-scoped hash may qualify as a unique personal identifier for CCPA purposes because it is linked to an individual's device during the session.

**Service provider relationship:** Estalara operates as a "service provider" under CCPA Section 1798.140(ag) rather than a "third party" that receives personal information for its own purposes, because it processes behavioral data solely to provide the listing personalization service to the tenant (business). The tenant is the "business" under CCPA. Estalara's DPA with tenants must include the service provider clauses required under CCPA Section 1798.140(ag)(1).

**No "sale" or "sharing":** Estalara does not sell or share personal information with third parties for cross-context behavioral advertising. The service provider relationship precludes characterization as a sale under CCPA Section 1798.140(ad).

**GPC (Global Privacy Control) signal:** US tenants are required to honor the GPC signal automatically. When the Estalara SDK detects `navigator.globalPrivacyControl === true`, it switches the session to Mode A (Session Mode only, no global archetype contribution) and provides a mechanism for the visitor to opt out of any data collection beyond strictly necessary. Implementation is tracked in TICKET-GDPR-004.

**Notice at collection:** CCPA Section 1798.100(b) requires a notice at or before the point of collection. The Estalara SDK includes a footer link to the tenant's privacy notice (tenant is responsible for maintaining an up-to-date privacy policy referencing Estalara as a service provider). The Estalara control plane generates a privacy policy template for tenants.

**Consumer rights:** Access, deletion, correction, and opt-out rights under CCPA are honored through the DSR endpoint (TICKET-GDPR-002). The forty-five-day CCPA response deadline is tracked in the DSR queue.

**Opt-out mechanism:** For Mode B US tenants, an "Opt Out of Personalization" link is provided. Opting out switches the session to Mode A for the remainder of the session and for subsequent sessions from the same device (to the extent the opt-out can be persisted without cookies — Estalara uses a URL parameter or a first-party localStorage flag if consent was previously granted).

### 6.4 UAE — PDPL and DIFC

**Federal PDPL (Federal Decree-Law 45/2021 and Cabinet Decision 111/2023):** The UAE Personal Data Protection Law applies to any processing of personal data of UAE residents, including by entities outside the UAE. Behavioral session identifiers (fingerprint hashes linked to online behavior) constitute personal data as "online identifier" under Article 1. Processing requires a lawful basis (Article 5): explicit consent, contract performance, legal obligation, or protection of vital interests.

**Estalara's basis under UAE PDPL:** For Mode A tenants, Estalara relies on the data subject's implicit consent through use of the service (the UAE PDPL permits processing on the basis of "implicit or explicit consent of the data subject" under Article 5(1)(a) in the context of a service relationship). For Mode B tenants, explicit consent is collected by the tenant's CMP. UAE Data Office guidance on implicit consent for interactive digital services is tracked in `docs/compliance/REGULATORY_WATCH.md`.

**DPIA under Art. 9 + Cabinet Decision 111/2023:** The UAE PDPL's implementing regulations require a DPIA before any "high-risk" processing, defined to include processing of a large number of personal data subjects or use of automated decision-making that could affect data subjects. This DPIA satisfies that requirement for UAE-region processing.

**DPO requirement:** Article 10 of the UAE PDPL requires the appointment of a DPO for controllers that process data on a large scale or engage in large-scale systematic monitoring. Estalara's UAE operations meet this threshold. The appointed EU DPO will cover UAE operations (subject to UAE Data Office guidance on whether a UAE-resident DPO is required).

**Encryption requirements:** Article 16 of the UAE PDPL and Cabinet Decision 111/2023 require appropriate security measures. The ITSEC PDPL guidance specifies AES-256 at rest and TLS 1.2+ in transit. Estalara implements AES-256 at rest (Supabase, ClickHouse, Upstash) and TLS 1.3 in transit (all API endpoints).

**Data residency:** UAE event data is processed in Cloudflare dxb (UAE Points of Presence) and stored in AWS me-central-1 (Bahrain region, closest to UAE) for Postgres. ClickHouse uses a dedicated UAE instance or the EU ClickHouse Cloud instance for MVP (with a commitment to migrate to a UAE-resident instance before UAE tenant scale). DP-anonymized archetype vectors are the only data permitted to cross the UAE border to the global archetype store.

**Cross-border transfers:** The UAE Data Office maintains an adequacy list. EU is on the adequacy list. For transfers to US-based processors (Anthropic, OpenAI), Estalara uses Standard Contractual Clauses as permitted under Article 22 of the UAE PDPL where the UAE Data Office has not issued an adequacy decision for the US.

**DIFC tenants (Dubai International Financial Centre):** DIFC tenants are subject to DIFC Data Protection Law No. 5 of 2020 (as amended), administered by the DIFC Commissioner of Data Protection. The DIFC regime is substantively similar to the GDPR and requires lawful basis, DPO notification, DPIA, and SCC-equivalent transfer mechanisms. DIFC tenants are subject to a separate compliance module in the Estalara control plane. A dedicated DIFC DPIA addendum will be produced before any DIFC tenant goes live.

---

## 7. Consent Strategy

The three consent modes described in Section 2.2 implement the following consent decision tree:

1. **Region determination:** At session initialization, the SDK reads the tenant's `region` configuration and the browser's geographic signal (Cloudflare headers). EU, UK, and UAE regions default to Mode A.
2. **GPC detection (US only):** If `navigator.globalPrivacyControl === true`, the session is locked to Mode A with no global archetype contribution, regardless of tenant consent configuration.
3. **Tenant CMP verification (Mode B):** If the tenant has configured Mode B, the SDK polls the tenant's CMP for a consent record. If a valid consent record exists (via Estalara Consent Helper API or a verified IAB TCF consent string), the session enters Mode B. If no consent record is found within two seconds, the session falls back to Mode A.
4. **LIA documentation (Mode C):** Mode C requires a tenant-specific LIA on file in the Estalara control plane. Only specific narrow purposes (spam detection) are permitted. The compliance gate at tenant onboarding verifies the LIA before Mode C is activated.
5. **Consent expiry:** Mode B consents expire after ninety days. The SDK checks consent record `expired_at` on each session initialization. Expired consents fall back to Mode A until re-consent is obtained.
6. **Consent withdrawal:** If a data subject withdraws consent (via DSR endpoint or tenant-provided UI), the session is immediately downgraded to Mode A, the session embedding is quarantined from global archetype contribution, and a deletion request is queued.

**Implementation reference:** TICKET-041 (SDK consent banner) implements the user-facing consent collection flow. TICKET-GDPR-004 implements the consent state propagation from SDK through ingest to Decision API.

---

## 8. Data Subject Rights

Under GDPR (Articles 15–22), UK GDPR, UAE PDPL (Articles 6–9), and CCPA (Sections 1798.100–1798.125), data subjects have rights to access, erasure, portability, rectification, and restriction of processing. Given that Estalara processes only pseudonymous session-level data and not PII, the practical exercise of these rights is mediated through the tenant, who is responsible for verifying the identity of the requestor.

**DSR workflow:**
1. A visitor contacts the tenant to exercise their data rights.
2. The tenant verifies the requester's identity (Estalara does not perform identity verification; it relies on the tenant's verification).
3. The tenant submits a DSR request to the Estalara DSR endpoint (`POST /api/v1/dsr/:tenant_id`) with the type, identifier (session_id hash or fingerprint_hash or email_hash), requester proof, and jurisdiction.
4. The DSR is queued and processed within the statutory deadline: thirty days for GDPR and UAE PDPL; forty-five days for CCPA (extendable by forty-five days on notice).
5. For erasure requests: cascade delete from Postgres (`session_embeddings`, `consent_records`), ClickHouse (`adaptation_decisions`, `llm_calls`), Redis cache, and Modal caches. Archetype contribution is handled as described in the DPIA's right to erasure cascade below.
6. For access/portability requests: all data under the identifier is aggregated and delivered as JSON.
7. Every DSR is logged to the immutable audit log (`staff_audit_log`) with actor, timestamp, action, and outcome.
8. Audit log records of DSR processing are retained for seven years (the longest applicable statutory retention period across jurisdictions).

**Right to erasure cascade — archetype contributions:** When a session is deleted, its contribution to archetype centroids may already have been incorporated into the global archetype space. Because contributions are aggregated under k-anonymity (k≥50) and differential privacy (ε≤2), no individual session's contribution is identifiable or material to the centroid. Estalara relies on the DP guarantee (combined with k≥50 group size) as the technical implementation of the right to erasure for archetype contributions. This approach is documented explicitly in this DPIA and will be referenced in the LIA. Sessions deleted within ninety days (while the `session_id → archetype_contribution_log` mapping exists) are excluded from the next scheduled archetype refresh.

**Implementation reference:** TICKET-GDPR-002 implements the DSR endpoint and deletion cascade.

---

## 9. Cross-Border Transfer Mechanisms

| Transfer | Origin | Destination | Mechanism | Notes |
|---|---|---|---|---|
| LLM inference (Anthropic) | EU (fra) | US | SCCs Module 2 (C2P) + TIA | Zero-retention DPA clause required |
| LLM inference (Anthropic) | UK (lhr) | US | UK IDTA | Zero-retention DPA clause required |
| LLM inference (Anthropic) | UAE | EU (nearest Bedrock region) | UAE PDPL Art. 22 SCCs | UAE data stays in-region for storage; inference only crosses border |
| Embeddings (OpenAI) | EU | US | SCCs Module 2 (C2P) + TIA | Zero-retention DPA clause required |
| Embeddings (OpenAI) | UK | US | UK IDTA | Zero-retention DPA clause required |
| Global archetype aggregation | Any region → Global store (EU) | Pseudonymized aggregate vectors only | Not a personal data transfer (k-anon ≥50 + DP ε≤2) | No transfer mechanism required |
| UAE event data | UAE | UAE (in-region) | No transfer | Stays in Cloudflare dxb + AWS me-central-1 |
| US event data | US | US (in-region) | No transfer | Raw events stay in US region |
| Billing (Stripe) | All regions | US (Stripe) | SCCs / IDTA / UAE PDPL SCCs | Only billing identifiers, no behavioral data |

Transfer Impact Assessments for each EU→US and UK→US transfer are maintained in `docs/compliance/transfers/`.

---

## 10. Consultation Record

**DPO name:** TBD — DPO appointment in progress. Placeholder contact: dpo@estalara.io.

**Data subject consultation:** GDPR Article 35(9) requires the controller to seek the views of data subjects or their representatives where appropriate. Individual-level risk from Estalara's processing is assessed as LOW to MEDIUM (pseudonymous, session-scoped, no PII). Accordingly, individual data subject consultation is not required. This assessment reflects that the processing does not involve special categories of data (Article 9), does not produce legal effects, and does not involve automated decision-making that significantly affects individuals.

**Supervisory authority pre-consultation:** GDPR Article 36 requires prior consultation with the supervisory authority where the DPIA indicates that processing would result in a high risk, in the absence of measures taken to mitigate the risk. The overall residual risk assessed in Section 5 is MEDIUM, not HIGH. Accordingly, mandatory pre-consultation is not required at this time. If Risk E (regulatory enforcement on fingerprinting) is assessed as HIGH residual risk following DPO review or regulatory guidance change, mandatory pre-consultation with the UODO (as the lead supervisory authority for Estalara, a Polish-founded entity) will be initiated.

---

## 11. Revision History

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 2026-05-15 | Compliance Engineering | Initial DPIA. Covers EU GDPR, UK GDPR + PECR, CCPA/CPRA, UAE PDPL + DIFC. Five risks assessed. All jurisdictional addenda substantive. |

*This document is append-only. Changes are added as new rows in the Revision History and, for material changes, as numbered addenda sections below the original text. Original text is not altered.*
