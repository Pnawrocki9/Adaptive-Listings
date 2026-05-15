# Records of Processing Activities (ROPA)

**Document ID:** ESTALARA-ROPA-001
**Version:** 1.0
**Date:** 2026-05-15
**Authors:** Estalara Technologies Ltd. — Compliance Engineering
**Regulation:** GDPR Article 30 (EU) | UK GDPR Article 30 | UAE PDPL Art. 15 | CCPA service provider disclosure
**DPO Review Status:** Pending appointment
**Next Mandatory Review Date:** 2027-05-15 (annual) or upon any material processing change
**Classification:** Internal — Restricted

---

## Overview

This document constitutes the Records of Processing Activities maintained by Estalara Technologies Ltd. as both data controller (for its own operational data) and data processor (for behavioral data processed on behalf of tenant real estate agencies). It is maintained as an append-only living document per the same ADR-style convention as the DPIA.

**Controller:** Estalara Technologies Ltd.
**Processor (on behalf of tenants):** Estalara Technologies Ltd.
**DPO Contact:** dpo@estalara.io (appointment in progress)
**Registered address:** [Estalara registered entity address — to be confirmed with legal]

### Joint Controller Analysis

Estalara and its tenants (real estate agencies) are not joint controllers for behavioral data collected on tenant websites. The tenant determines the purposes of the listing website (real estate marketing); Estalara determines the means of personalization processing. The relationship is Controller (tenant) → Processor (Estalara) for behavioral data. For Estalara's own operational data (audit logs, staff actions, global archetype model), Estalara is sole controller.

---

## Retention Schedule — Authoritative Table

This table is the authoritative source for the TICKET-GDPR-002 deletion worker and for data subject request cascades.

| Table Name | Store | Retention Period | Basis | Notes |
|---|---|---|---|---|
| `session_embeddings` | Postgres (Supabase, per-region) | 90 days from last active event | Processing necessity (LI) | Deleted by DSR erasure worker; TTL enforced by nightly cron |
| `consent_records` | Postgres (Supabase, per-region) | 3 years from consent event | Legal obligation (Art. 6.1.c) | `granted_at` + 3 years; revocation sets `revoked_at` but record is retained |
| `adaptation_decisions` | ClickHouse Cloud | 13 months | AI Act audit trail + LI | Partition by month; TTL set at partition level |
| `llm_calls` | ClickHouse Cloud | 13 months | Audit + model improvement | Same TTL partition as adaptation_decisions |
| `ab_bandit_weights` | Postgres (Supabase) | Retained indefinitely | LI (model state — no personal data) | Contains no session_id; anonymized statistical weights only |
| `archetype_embeddings` | Postgres (Supabase) | Retained indefinitely | LI (model — no personal data) | Post-DP-aggregation; no personal data |
| `answers` | Postgres (Supabase) | Contract duration (tenant) | Art. 6.1.b (contract) | Cascade deleted on tenant offboarding |
| `staff_audit_log` | Postgres (Supabase) | 7 years | Legal obligation (Art. 6.1.c) | Append-only; no deletion |
| `tenants` | Postgres (Supabase) | Contract duration + 7 years | Art. 6.1.b + legal obligation | Soft-delete via `deleted_at`; hard delete after retention period |
| `users` | Postgres (Supabase) | Contract duration + 7 years | Art. 6.1.b + legal obligation | Tenant admin users |
| `api_keys` | Postgres (Supabase) | Contract duration | Art. 6.1.b (contract) | Rotatable by tenant; revoked keys retained for audit 1 year |
| Upstash Redis (session cache) | Upstash Redis | 30 min idle TTL | Processing necessity | TTL enforced by Redis EXPIRE; no persistent storage |
| Redpanda event bus | Redpanda Cloud | Session scope (consumed immediately) | Processing necessity | Transient; consumed by Intent Engine within seconds |
| DSR tokens | Postgres (`dsr_tokens`) | 30 days from DSR resolution | Legal obligation | Referenced by TICKET-GDPR-002 |
| Stripe billing records | Stripe + Postgres | Contract duration + 7 years | Legal obligation + Art. 6.1.b | Stripe holds source of truth; Postgres holds invoice metadata |

---

## Processing Activities

### Activity 1 — Behavioral Event Collection (Ingest)

| Field | Value |
|---|---|
| **Activity name** | Behavioral event collection (ingest) |
| **Controller** | Tenant (real estate agency) — Estalara acts as Processor |
| **Processor** | Estalara Technologies Ltd. |
| **Purpose** | Capture visitor behavioral signals (scroll depth, click events, listing view events, chat queries) to enable real-time listing personalization |
| **Lawful basis (EU/UK)** | Art. 6(1)(f) Legitimate Interest (Mode A, Mode C) / Art. 6(1)(a) Consent (Mode B) |
| **Lawful basis (UAE PDPL)** | Art. 5(1)(a) implicit/explicit consent; Art. 5(1)(c) legitimate interests |
| **Lawful basis (US CCPA)** | Service provider relationship (Cal. Civ. Code § 1798.140(ag)); no "sale" |
| **Data categories** | Behavioral signals (scroll depth %, element IDs clicked, listing_id viewed, viewport dimensions, dwell time); session_id (HMAC hash — pseudonymous identifier); device class; tenant_id |
| **Data subjects** | Anonymous property buyers visiting tenant-operated real estate websites |
| **Retention** | Redpanda: session scope (consumed within seconds); Redis cache: 30 min idle TTL |
| **Recipients** | Redpanda Cloud (event bus); Intent Engine (Modal); ClickHouse Cloud (after Intent Engine processing) |
| **Third-country transfers** | EU→US: Anthropic (LLM inference on behavioral context), OpenAI (embeddings) — SCCs Module 2 + TIA |
| **Cross-border mechanism** | SCCs Module 2 (EU→US); UK IDTA (UK→US); UAE PDPL Art. 22 SCCs (UAE→US if applicable) |
| **Data residency region** | EU: fra1 (Frankfurt); UK: lhr1 (London); US: iad1 (Virginia); UAE: dxb (Dubai) |
| **Security measures** | TLS 1.3 in transit; HMAC-signed API key authentication; origin allowlist; Zod schema validation with PII blocklist; k-anonymity ≥50 before cross-tenant aggregation |

---

### Activity 2 — Session Fingerprinting (HMAC Hash Computation)

| Field | Value |
|---|---|
| **Activity name** | Session fingerprinting (HMAC session hash computation) |
| **Controller** | Tenant (as the operator of the website) — Estalara acts as Processor |
| **Processor** | Estalara Technologies Ltd. |
| **Purpose** | Compute a session-scoped pseudonymous identifier that links behavioral events within a single session without enabling cross-session or cross-tenant tracking |
| **Lawful basis (EU/UK)** | Art. 6(1)(f) LI (Mode A: strictly necessary for service delivery per ePrivacy Art. 5(3)(b)); Art. 6(1)(a) Consent (Mode B) |
| **Lawful basis (UAE PDPL)** | Art. 5(1)(a) consent for interactive service; Art. 5(1)(c) legitimate interest |
| **Lawful basis (US CCPA)** | Service provider operational necessity; GPC signal honored (disables cross-session contribution) |
| **Data categories** | Canvas fingerprint hash, AudioContext fingerprint hash, screen resolution, viewport dimensions, timezone, browser language, WebGL renderer string — all combined and hashed via HMAC; never stored individually |
| **Data subjects** | Anonymous property buyers |
| **Retention** | Session scope only; hash rotates on tab close or 30-minute idle timeout; the intermediate entropy attributes are not stored |
| **Recipients** | Estalara edge ingest (Cloudflare Workers); session hash used as `session_id` in all downstream systems |
| **Third-country transfers** | None for the fingerprinting computation itself (computed in Cloudflare Worker closest to visitor) |
| **Cross-border mechanism** | N/A |
| **Data residency region** | Computed in-region at the Cloudflare POP closest to the visitor; never transmitted as raw fingerprint entropy |
| **Security measures** | HMAC with per-tenant secret (prevents cross-tenant correlation); day_bucket rotation (prevents cross-day linking); tenant secret stored exclusively in server-side secrets (Doppler); raw fingerprint entropy attributes are discarded after HMAC computation |

---

### Activity 3 — Session Embedding Computation

| Field | Value |
|---|---|
| **Activity name** | Session embedding computation (intent engine) |
| **Controller** | Tenant (listing personalization purpose) — Estalara acts as Processor |
| **Processor** | Estalara Technologies Ltd. |
| **Purpose** | Compute a 1024-dimensional behavioral embedding vector representing the inferred intent of the anonymous session, for use in archetype matching and adaptation directive selection |
| **Lawful basis (EU/UK)** | Art. 6(1)(f) LI (intent detection and personalization) |
| **Lawful basis (UAE PDPL)** | Art. 5(1)(c) legitimate interest / Art. 5(1)(a) consent (Mode B) |
| **Lawful basis (US CCPA)** | Service provider operational necessity |
| **Data categories** | session_id (HMAC hash), tenant_id, 1024-dim embedding vector (computed from behavioral event sequence), matched_archetype label, similarity_score, signal_count, quiz_archetype (if quiz answered) |
| **Data subjects** | Anonymous property buyers |
| **Retention** | Table `session_embeddings` (Postgres): 90 days from last active event; enforced by nightly TTL cron |
| **Recipients** | Supabase (Postgres, per-region); Upstash Redis (intent vector cache, 30-min TTL) |
| **Third-country transfers** | EU→US: OpenAI API for embedding computation — SCCs Module 2 + TIA; UK→US: UK IDTA |
| **Cross-border mechanism** | SCCs Module 2 (EU→US, OpenAI); UK IDTA (UK→US, OpenAI) |
| **Data residency region** | `session_embeddings` stored in Supabase per-region project (EU: Frankfurt; US: US-East; UK: separate UK Supabase project; UAE: AWS me-central-1) |
| **Security measures** | TLS 1.3; Supabase RLS policies (`tenant_isolation` policy on `session_embeddings`); field-level encryption for session tokens; k-anonymity ≥50 before any cross-tenant use |

---

### Activity 4 — Adaptation Decision Logging (ClickHouse)

| Field | Value |
|---|---|
| **Activity name** | Adaptation decision logging |
| **Controller** | Estalara Technologies Ltd. (as controller for AI Act audit trail obligations) |
| **Processor** | ClickHouse Cloud |
| **Purpose** | Immutable record of every adaptation directive served, for AI Act compliance audit trail, A/B performance measurement, and tenant analytics |
| **Lawful basis (EU/UK)** | Art. 6(1)(f) LI (legitimate interest in AI system auditability and product improvement) + AI Act Article 12 logging obligations |
| **Lawful basis (UAE PDPL)** | Art. 5(1)(c) legitimate interest |
| **Lawful basis (US CCPA)** | Service provider operational necessity |
| **Data categories** | session_id (pseudonymous), tenant_id, archetype label, directive type, holdout_group, listing_id, timestamp |
| **Data subjects** | Anonymous property buyers |
| **Retention** | Table `adaptation_decisions` (ClickHouse): 13 months; enforced by partition-level TTL. Minimum 13 months is specified by Master Design H.2 for AI Act audit trail. Enterprise tenants may have longer retention contractually. |
| **Recipients** | ClickHouse Cloud (event store); Tenant analytics dashboard (aggregated, no session_id exposed) |
| **Third-country transfers** | EU ClickHouse Cloud instance: within EU (Frankfurt). US ClickHouse Cloud instance: within US. UK: logical separation within EU ClickHouse instance. UAE: Dedicated instance or EU instance (MVP). |
| **Cross-border mechanism** | None (data stays in-region); ClickHouse Cloud EU instance is in Frankfurt |
| **Data residency region** | EU: Frankfurt; US: US-East; UK: EU instance (logical separation); UAE: dedicated instance (post-MVP) |
| **Security measures** | TLS 1.3; ClickHouse RBAC with per-tenant partition access controls; column-level encryption for PII-proximate fields; read-only access for tenant analytics views (no session_id) |

---

### Activity 5 — LLM Prompt Processing (Anthropic API — Processor)

| Field | Value |
|---|---|
| **Activity name** | LLM prompt processing for intent extraction and adaptation reasoning |
| **Controller** | Estalara Technologies Ltd. |
| **Processor** | Anthropic PBC (LLM inference) |
| **Purpose** | Extract buyer intent from chat messages and behavioral context; generate listing adaptation reasoning and adapted text content |
| **Lawful basis (EU/UK)** | Art. 6(1)(f) LI (processing behavioral context to improve listing presentation is proportionate to the interest of data subjects in receiving relevant listings); DPA with Anthropic |
| **Lawful basis (UAE PDPL)** | Art. 5(1)(c) legitimate interest; DPA with Anthropic |
| **Lawful basis (US CCPA)** | Service provider — Anthropic is a sub-processor; Cal. Civ. Code § 1798.140(ag) |
| **Data categories** | Behavioral context strings (constructed from event sequence and archetype label); no direct PII — PII blocklist enforced at ingest before data reaches LLM prompt |
| **Data subjects** | Anonymous property buyers (behavioral context only — no direct identifiers in prompts) |
| **Retention** | Not retained by Anthropic per DPA zero-retention clause. Estalara retains `llm_calls` metadata (model, token count, latency, tenant_id) in ClickHouse for 13 months; prompt/response content is not retained |
| **Recipients** | Anthropic API (US-based) — sub-processor |
| **Third-country transfers** | EU→US: SCCs Module 2 (Controller-to-Processor) + TIA; UK→US: UK IDTA |
| **Cross-border mechanism** | SCCs Module 2 (EU→US); UK IDTA (UK→US); UAE PDPL Art. 22 SCCs (UAE→US for inference where Bedrock eu-central-1 is used) |
| **Data residency region** | Inference occurs at Anthropic's infrastructure (US). Bedrock regional endpoints used where available to reduce data travel distance. |
| **Security measures** | DPA with zero-retention clause (contractual); PII blocklist enforced before prompt construction; TLS 1.3; LiteLLM router for fallback and monitoring |

---

### Activity 6 — Tenant Configuration Storage (Postgres)

| Field | Value |
|---|---|
| **Activity name** | Tenant configuration and API key management |
| **Controller** | Estalara Technologies Ltd. (for its own controller purposes as SaaS provider) |
| **Processor** | Supabase (Postgres hosting) |
| **Purpose** | Store and manage tenant agency accounts, API keys, configuration (integration tier, region, consent mode, brand tokens), and billing linkage |
| **Lawful basis (EU/UK)** | Art. 6(1)(b) Contract Performance (tenant agreement for SaaS service delivery) |
| **Lawful basis (UAE PDPL)** | Art. 5(1)(b) contract performance |
| **Lawful basis (US CCPA)** | Service operational necessity; disclosed in privacy policy |
| **Data categories** | Tenant name, slug, status, plan, allowed_origins, brand_config, quiz_config, Stripe customer/subscription IDs, registration_id, approver_id, timestamps. Table: `tenants`. Tenant admin users: email, hashed password (via Supabase Auth). Table: `users`. API keys: hashed key values, scopes, expiry. Table: `api_keys`. |
| **Data subjects** | Tenant agency staff (admin users) |
| **Retention** | `tenants`, `users`, `api_keys`: contract duration + 7 years (statutory accounting and contractual retention). Soft-delete via `deleted_at` column; hard delete scheduled after retention period. |
| **Recipients** | Supabase (Postgres per-region); Vercel (control plane; reads config at runtime); Stripe (billing linkage — Stripe receives `stripe_customer_id`) |
| **Third-country transfers** | EU tenant config: EU Supabase project (Frankfurt). UK: separate Supabase project (UK data residency). US: US-East Supabase. UAE: AWS me-central-1 Postgres. Stripe: US-based; covered by SCCs / UK IDTA / UAE PDPL SCCs for billing data |
| **Cross-border mechanism** | Stripe: SCCs Module 2 (EU→US); UK IDTA; UAE PDPL Art. 22 SCCs |
| **Data residency region** | Per-region Supabase projects; UK project for UK data residency |
| **Security measures** | Supabase Auth (JWT, MFA); RLS policies on all tables; HMAC-signed API keys; Doppler for secret management; TLS 1.3 |

---

### Activity 7 — Consent Record Storage

| Field | Value |
|---|---|
| **Activity name** | Consent record storage (Mode B tenants) |
| **Controller** | Tenant (consent collected on their website) — Estalara stores as Processor |
| **Processor** | Estalara Technologies Ltd. |
| **Purpose** | Maintain an auditable record of consent decisions for Mode B sessions, as required by GDPR Art. 7(1) (demonstrability of consent), CCPA service provider documentation, and UAE PDPL consent records |
| **Lawful basis** | Art. 6(1)(c) Legal Obligation (consent record maintenance is required by GDPR Art. 7(1) and equivalent provisions) |
| **Data categories** | session_id (pseudonymous HMAC hash), tenant_id, consent_type ('behavioral_tracking' | 'quiz_completion'), granted (boolean), tos_version, consent_text_hash (SHA-256 of displayed text), ip_address (encrypted at application layer before insert — never stored as plaintext), user_agent, granted_at, revoked_at. Table: `consent_records`. |
| **Data subjects** | Anonymous property buyers (Mode B sessions) |
| **Retention** | Table `consent_records` (Postgres): 3 years from consent event (`granted_at`). Revocation sets `revoked_at` but record is retained for proof of prior consent. |
| **Recipients** | Supabase (Postgres, per-region) |
| **Third-country transfers** | As per Activity 6 — per-region Supabase; no additional transfers |
| **Cross-border mechanism** | As per Activity 6 |
| **Data residency region** | Per-region Supabase project |
| **Security measures** | ip_address encrypted at application layer before insert (field-level encryption with KMS key); TLS 1.3; RLS policy on `consent_records` (tenant isolation); IP encryption key stored in Doppler, separate from general secrets |

---

### Activity 8 — DSR Processing (Access, Erasure, Portability)

| Field | Value |
|---|---|
| **Activity name** | Data Subject Request processing |
| **Controller** | Estalara Technologies Ltd. (as the entity that processes the request on behalf of the tenant/data subject) |
| **Processor** | Supabase (Postgres for DSR queue and audit log) |
| **Purpose** | Process data subject requests for access, erasure, portability, rectification, and restriction, as required by GDPR Arts. 15–22, UK GDPR, UAE PDPL Arts. 6–9, and CCPA Secs. 1798.100–1798.125 |
| **Lawful basis** | Art. 6(1)(c) Legal Obligation |
| **Data categories** | DSR type, session_id or fingerprint_hash or email_hash (requester identifier), jurisdiction, requester_proof (from tenant's identity verification), DSR OTP token (email-based for access/portability), status, created_at, resolved_at, outcome. Table: `dsr_tokens`. |
| **Data subjects** | Property buyers exercising statutory rights; tenant admin staff submitting requests on behalf of buyers |
| **Retention** | DSR tokens and queue records: 30 days from DSR resolution (active processing period). Audit log entry in `staff_audit_log`: 7 years (statutory maximum, per-jurisdiction audit requirement). |
| **Recipients** | Supabase (Postgres); ClickHouse (deletion cascade); Upstash Redis (deletion cascade); Modal caches (deletion cascade) |
| **Third-country transfers** | Cascade deletion touches all in-region stores; no new cross-border transfer introduced by DSR processing |
| **Cross-border mechanism** | N/A (in-region deletion cascade) |
| **Data residency region** | DSR queue stored in the region of the original data subject request |
| **Security measures** | OTP tokens are single-use, 24h TTL; requester proof validated by tenant before submission; all DSR processing logged to immutable `staff_audit_log`; DSR response delivered only to verified requestor via tenant-controlled channel |
| **SLA** | 30 days (GDPR, UAE PDPL); 45 days (CCPA, extendable by 45 days); 30 days (UK GDPR) |

---

### Activity 9 — Global Archetype Aggregation

| Field | Value |
|---|---|
| **Activity name** | Global archetype aggregation (cross-tenant model improvement) |
| **Controller** | Estalara Technologies Ltd. (sole controller — tenants do not determine purposes of global model) |
| **Processor** | Modal (ML compute); Supabase (archetype_embeddings store) |
| **Purpose** | Aggregate session embedding vectors from consented Mode B sessions across tenants, with k-anonymity (k≥50) and Differential Privacy (ε≤2 per epoch), to update global archetype centroids. This improves cold-start intent detection for all tenants (network effect). |
| **Lawful basis (EU/UK)** | Art. 6(1)(f) LI (model improvement; CNIL June 2025 guidance confirms LI for AI development purposes); output data is not personal data (k-anon ≥50 + DP ε≤2) |
| **Lawful basis (UAE PDPL)** | Art. 5(1)(c) legitimate interest |
| **Lawful basis (US CCPA)** | Service provider / operational necessity; aggregated data is not personal information after DP processing |
| **Data categories** | Input: session_id, embedding vector (from Mode B sessions only). Output: archetype_name, embedding vector (aggregate), sample_count, confidence_threshold. Table: `archetype_embeddings`. After aggregation, no session_id, no tenant_id is retained in the output. |
| **Data subjects** | Mode B (consented) property buyers whose sessions contribute to the aggregate |
| **Retention** | `archetype_embeddings` (Postgres): Indefinite. The aggregated output contains no personal data after DP processing (GDPR Recital 26 and Article 4(1) definition: cannot be attributed to identified or identifiable natural person). |
| **Recipients** | All Estalara tenants (benefit from improved archetypes); Supabase (archetype store) |
| **Third-country transfers** | Global archetype store (EU Frankfurt Supabase) — replicates DP-anonymized vectors only to all regional deployments. This is not a personal data transfer (no personal data in aggregate). |
| **Cross-border mechanism** | Not a personal data transfer; no mechanism required. |
| **Data residency region** | Global archetype store: EU Frankfurt (primary); per-region read replicas of aggregate vectors |
| **Security measures** | k-anonymity (k≥50, minimum 3 tenants per cluster) before publication; DP-SGD Gaussian noise ε≤2 per epoch; epoch budget tracked; Mode A sessions excluded from global aggregation; `session_id → archetype_contribution_log` retained for 90 days to enable erasure exclusion |

---

### Activity 10 — Agency Staff Audit Logging

| Field | Value |
|---|---|
| **Activity name** | Agency staff audit logging (Estalara internal operational audit) |
| **Controller** | Estalara Technologies Ltd. |
| **Processor** | Supabase (Postgres) |
| **Purpose** | Maintain an immutable record of all Estalara staff actions affecting tenants, users, and data processing, for security, compliance, and accountability purposes |
| **Lawful basis (EU/UK)** | Art. 6(1)(c) Legal Obligation (GDPR Art. 30(1)(g) security measures documentation; NIS2 audit obligations for supply chain; contractual obligations to enterprise tenants) |
| **Lawful basis (UAE PDPL)** | Art. 5(1)(d) legal obligation |
| **Lawful basis (US CCPA)** | Operational necessity (internal compliance use) |
| **Data categories** | admin_user_id (Estalara staff member), action (e.g., 'tenant.approved', 'impersonation.started'), target_tenant_id, target_user_id, payload (structured action details), ip_address, user_agent, created_at. Table: `staff_audit_log`. |
| **Data subjects** | Estalara staff members (admin users); tenant admin users (as targets of staff actions) |
| **Retention** | Table `staff_audit_log` (Postgres): 7 years. Append-only — rows are never updated or deleted. Consistent with GDPR Art. 30, enterprise contractual audit requirements, and UAE PDPL document retention guidance. |
| **Recipients** | Supabase (Postgres); Estalara compliance-admin role (read-only, single human: DPO or designated compliance officer); Sentry (error tracking on audit log write failures) |
| **Third-country transfers** | EU audit log: EU Supabase project (Frankfurt). Per-region projects for UK and UAE. Sentry: US-based — SCCs in place |
| **Cross-border mechanism** | Sentry: SCCs Module 2 (EU→US); UK IDTA |
| **Data residency region** | Per-region Supabase project; UK project for UK residency |
| **Security measures** | Append-only constraint enforced at DB level (no UPDATE/DELETE grants on table); RLS NOT enabled — accessed exclusively via Supabase service role restricted to `compliance-admin` role; read-only API for DPO queries; encryption at rest (Supabase AES-256) |

---

### Activity 11 — Billing and Usage Metering

| Field | Value |
|---|---|
| **Activity name** | Billing and usage metering (Stripe integration) |
| **Controller** | Estalara Technologies Ltd. |
| **Processor** | Stripe Inc. (payment processor) |
| **Purpose** | Manage tenant subscription billing, usage metering (API calls, session counts), invoice generation, and payment processing |
| **Lawful basis (EU/UK)** | Art. 6(1)(b) Contract Performance |
| **Lawful basis (UAE PDPL)** | Art. 5(1)(b) contract performance |
| **Lawful basis (US CCPA)** | Service operational necessity; disclosed in privacy policy |
| **Data categories** | Tenant agency name, billing contact email, Stripe customer ID, Stripe subscription ID, usage metrics (session count, API call count, per-tier aggregates), invoice amounts and dates. No behavioral data or session-level data flows to Stripe. |
| **Data subjects** | Tenant agency billing contact (typically agency owner or finance staff) |
| **Retention** | Stripe: as per Stripe data retention policies. Estalara Postgres (`tenants` table Stripe fields): contract duration + 7 years. |
| **Recipients** | Stripe Inc. (US-based payment processor) |
| **Third-country transfers** | EU→US: SCCs Module 2 + Stripe DPA; UK→US: UK IDTA + Stripe DPA; UAE→US: UAE PDPL Art. 22 SCCs + Stripe DPA |
| **Cross-border mechanism** | Stripe DPA + SCCs (EU→US); UK IDTA (UK→US); UAE PDPL Art. 22 SCCs (UAE→US) |
| **Data residency region** | Stripe processes in US; Estalara Postgres fields in per-region Supabase projects |
| **Security measures** | Stripe PCI DSS Level 1 compliance; no card numbers stored by Estalara; Stripe webhook signatures verified via HMAC; TLS 1.3 for all Stripe API calls |

---

### Activity 12 — A/B Holdout Assignment

| Field | Value |
|---|---|
| **Activity name** | A/B holdout assignment and Thompson sampling bandit |
| **Controller** | Estalara Technologies Ltd. (as the entity operating the A/B system) |
| **Processor** | Supabase (Postgres for bandit weights) |
| **Purpose** | Assign anonymous sessions to adaptation variants (treatment) or control (holdout) using Thompson sampling on per-(tenant, archetype, variant) Beta distribution parameters, to measure the causal effect of personalization on listing engagement |
| **Lawful basis (EU/UK)** | Art. 6(1)(f) LI (product improvement and personalization efficacy measurement) |
| **Lawful basis (UAE PDPL)** | Art. 5(1)(c) legitimate interest |
| **Lawful basis (US CCPA)** | Service provider operational necessity |
| **Data categories** | tenant_id, archetype label, variant identifier, alpha/beta parameters (aggregate statistical weights — no personal data), paused boolean, updated_at. Table: `ab_bandit_weights`. Session assignment (treatment vs holdout) is logged in `adaptation_decisions` (ClickHouse) as `holdout_group`. |
| **Data subjects** | Anonymous property buyers (session assignment is pseudonymous; `ab_bandit_weights` table contains no session_id) |
| **Retention** | `ab_bandit_weights` (Postgres): Retained indefinitely (no personal data). Session holdout assignment in `adaptation_decisions` (ClickHouse): 13 months. |
| **Recipients** | Supabase (Postgres); Decision API (reads weights at runtime) |
| **Third-country transfers** | None (Postgres per-region; ClickHouse per-region) |
| **Cross-border mechanism** | N/A |
| **Data residency region** | Per-region Supabase project |
| **Security measures** | RLS on `ab_bandit_weights` (tenant can read/write only its own rows); no session_id in the weights table; regression-detection job auto-pauses variants with statistically significant negative delta |

---

## Appendix A — Sub-Processors

The following sub-processors process personal data or pseudonymous data on behalf of Estalara. All sub-processors are required to execute a Data Processing Agreement (DPA) with Estalara as a condition of service.

| Sub-Processor | Jurisdiction | Processing Role | Data Categories Processed | DPA / Transfer Mechanism Status |
|---|---|---|---|---|
| **Anthropic PBC** | United States | LLM inference (Claude Haiku 4.5, Claude Sonnet 4.6) for intent extraction and adaptation reasoning | Behavioral context prompts (no direct PII); LLM call metadata | DPA required — zero-retention clause; EU→US SCCs Module 2; UK IDTA |
| **OpenAI LLC** | United States | Embedding computation (text-embedding-3-small, 1024-dim) | Behavioral context text (no direct PII); embedding computation requests | DPA required — zero-retention clause; EU→US SCCs Module 2; UK IDTA |
| **Cloudflare Inc.** | United States | Edge ingest (Workers), CDN, DDoS protection, regional routing | Behavioral event payloads, session_id, IP address (transient at edge), tenant_id | Cloudflare Enterprise DPA in place; EU→US SCCs; UK IDTA |
| **Supabase Inc.** | United States (EU hosting available) | Managed Postgres (transactional DB, per-region projects) | All Postgres tables (session_embeddings, consent_records, tenants, users, ab_bandit_weights, archetype_embeddings, staff_audit_log, answers, api_keys, dsr_tokens) | DPA required — per-region projects (EU Frankfurt, US-East, UK separate project, UAE AWS me-central-1 via Supabase); EU project uses EU data center |
| **ClickHouse Cloud** | Multiple (EU, US regions available) | Managed event store | adaptation_decisions, llm_calls tables; tenant analytics | DPA required; EU instance in Frankfurt; US instance in US-East |
| **Upstash Inc.** | United States (multi-region) | Managed Redis (session intent vector cache) | Session_id → embedding vector (TTL 30 min); adaptation result cache | DPA required; multi-region replication; EU region available; EU→US SCCs |
| **Modal Labs Inc.** | United States | Serverless ML compute (Intent Engine, archetype update job, adaptation engine) | Session embedding computation inputs; archetype aggregation inputs | DPA required; EU→US SCCs Module 2 |
| **Redpanda Cloud** | Multiple regions | Managed Kafka-compatible event bus | Behavioral event payloads (transient — consumed within seconds) | DPA required; per-region deployment |
| **Vercel Inc.** | United States | Control plane hosting (Next.js dashboard and API) | Tenant admin session data (authenticated), API request logs | Vercel DPA in place; EU→US SCCs; UK IDTA |
| **Sentry Inc.** (Functional Software) | United States | Error and performance monitoring | Stack traces, request context (scrubbed of PII before transmission), tenant_id | Sentry DPA in place; EU→US SCCs; UK IDTA |
| **Stripe Inc.** | United States | Payment processing and billing | Tenant billing contact, payment method (via Stripe elements, not stored by Estalara), Stripe customer/subscription IDs | Stripe DPA in place (PCI DSS Level 1); EU→US SCCs; UK IDTA; UAE PDPL Art. 22 SCCs |

---

## Appendix B — Cross-Border Transfer Index

| Transfer Route | Data Type | Mechanism | TIA Reference |
|---|---|---|---|
| EU (fra) → US (Anthropic) | Behavioral context prompts | SCCs Module 2 + zero-retention DPA | `docs/compliance/transfers/eu-us-anthropic-tia.md` |
| UK (lhr) → US (Anthropic) | Behavioral context prompts | UK IDTA + zero-retention DPA | `docs/compliance/transfers/uk-us-anthropic-tia.md` |
| EU (fra) → US (OpenAI) | Embedding computation inputs | SCCs Module 2 + zero-retention DPA | `docs/compliance/transfers/eu-us-openai-tia.md` |
| UK (lhr) → US (OpenAI) | Embedding computation inputs | UK IDTA + zero-retention DPA | `docs/compliance/transfers/uk-us-openai-tia.md` |
| EU/UK → US (Stripe) | Billing contact + billing data | SCCs Module 2 / UK IDTA + Stripe DPA | `docs/compliance/transfers/eu-us-stripe-tia.md` |
| UAE → EU (global archetype) | DP-anonymized aggregate vectors only | Not a personal data transfer (k-anon ≥50 + DP ε≤2 applied) | N/A — no personal data |
| UAE → US (Anthropic inference) | Behavioral context prompts | UAE PDPL Art. 22 SCCs + zero-retention DPA | `docs/compliance/transfers/uae-us-anthropic-tia.md` |

---

## Revision History

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 2026-05-15 | Compliance Engineering | Initial ROPA. 12 processing activities. Sub-processors appendix (11 entities). Cross-border transfer index. Authoritative retention table with exact Postgres and ClickHouse table names. Covers EU GDPR, UK GDPR, CCPA/CPRA, UAE PDPL + DIFC. |

*This document is append-only. New processing activities are added as new sections. Existing sections are amended by appending a change note with version reference, not by modifying original text.*
