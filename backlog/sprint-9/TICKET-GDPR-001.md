# TICKET-GDPR-001 — DPIA + ROPA Compliance Documents

**Sprint:** 9 **Agent:** compliance-engineer **Priority:** P0 **Estimated hours:** 8 **Status:**
BACKLOG **Depends on:** (none — standalone documentation work) **Unblocks:** TICKET-GDPR-002,
TICKET-GDPR-003, TICKET-GDPR-004

## Context

Master Design section H (Compliance & Privacy Multi-Region) mandates two foundational compliance
artifacts before Estalara can serve any EU/UK/UAE tenant in production:

1. **DPIA (Data Protection Impact Assessment)** — required under GDPR Art. 35.3.c for "systematic
   monitoring of publicly accessible areas on a large scale." Behavioral fingerprinting for real
   estate listing personalization meets this threshold. Master Design G.2 commits to this
   explicitly: "Estalara robi DPIA dla całego produktu."

2. **ROPA (Records of Processing Activities)** — required under GDPR Art. 30 for any controller or
   processor. Must enumerate every processing activity, its lawful basis, data category, retention
   period, and cross-border transfer mechanism. Master Design H.1 notes the ROPA is "auto-generated
   from configuration" — this ticket produces the baseline document from which the dashboard export
   will render a per-tenant version.

Both documents cover all four operational jurisdictions: EU GDPR, UK GDPR, CCPA/CPRA (US), and UAE
PDPL (Federal Decree-Law 45/2021 + Cabinet Decision 111/2023). The UAE coverage also includes DIFC
Data Protection Law No. 5 of 2020 for Dubai International Financial Centre tenants.

These documents are append-only living artifacts analogous to ADRs. Once accepted, changes are added
as numbered revision sections; original text is not altered.

**References:**

- `docs/MASTER_DESIGN.md` sections H.1–H.6 (compliance obligations per jurisdiction)
- `docs/MASTER_DESIGN.md` section G.1–G.3 (behavioral fingerprinting legal analysis + techniques)
- `docs/MASTER_DESIGN.md` section G.2 (Session Mode / Consented Mode / LI Mode definitions)
- `docs/MASTER_DESIGN.md` section F.3 (privacy-preserving techniques: k-anon ≥50, DP ε≤2)
- `docs/MASTER_DESIGN.md` section A.3 (multi-region data residency table)
- GDPR Art. 35 (DPIA), Art. 30 (ROPA), Art. 6.1.f (legitimate interest)
- EDPB Guidelines 2/2023 on tracking techniques (fingerprinting covered by ePrivacy Art. 5(3))
- CNIL June 2025 guidance — legitimate interest permitted for AI development purposes

## Acceptance criteria

All of the following must be met before the PR may be merged:

1. **`docs/compliance/dpia.md` exists and is complete.** The file must contain, in order:
   - Cover page: document version (v1.0), date (2026-05-14), authors (Estalara Ltd.), DPO review
     status (pending appointment), next mandatory review date (2027-05-14 or after any major
     processing change).
   - Section 1 — System description: all three integration tiers (Observer / Augment / Native), the
     three consent modes (Session Mode / Consented Mode / LI Mode) per Master Design G.2, and which
     regions data resides in per the Master Design A.3 multi-region table.
   - Section 2 — Necessity and proportionality: why behavioral intent detection is proportionate to
     the legitimate interest; what alternatives were considered (cookie-based tracking, explicit
     profiling) and rejected; data minimisation measures in place (session-scoped HMAC hash rotated
     every 30 min idle, k-anonymity ≥50 before cross-tenant aggregation, DP ε≤2 on embedding
     updates). Reference CNIL June 2025 guidance confirming LI for AI development.
   - Section 3 — Risk assessment: minimum 5 risks, each with likelihood (low/medium/high), severity
     (low/medium/high), and a named mitigation already present in the system. Required risks: (a)
     re-identification via fingerprint cross-correlation, (b) cross-border data transfer exposure,
     (c) LLM provider (Anthropic) data retention, (d) unauthorized tenant access to another tenant's
     session data, (e) regulatory enforcement action (CNIL/ICO/UAE Data Office on fingerprinting
     without consent).
   - Section 4 — Mitigations and residual risk: summary table with one row per risk. Overall
     residual risk must be assessed. Any item rated "high" residual risk blocks EU/UK/UAE production
     launch and requires escalation to Piotr Nawrocki before merge.
   - Section 5 — Jurisdictional addenda: one sub-section per jurisdiction.
     - EU GDPR: Art. 35 DPIA obligation, Art. 6.1.f LI basis, DPO appointment (EU-based).
     - UK GDPR: PECR implications, ICO December 2024 fingerprinting stance, how Session Mode
       satisfies the "strictly necessary" exemption.
     - US CCPA/CPRA: fingerprint as "unique personal identifier," GPC signal honoring, no data sale,
       opt-out mechanism.
     - UAE PDPL: DPIA required under Art. 9 + Cabinet Decision 111/2023, DPO required for
       large-scale profiling, AES-256 at rest + TLS 1.2+ in transit (already in stack per H.5). DIFC
       tenants: DIFC Data Protection Law No. 5 of 2020 noted as separate regime.
   - Section 6 — Consultation record: DPO name (placeholder: "TBD — DPO appointment in progress"),
     data subjects consultation assessment (not required per Art. 35.9 when individual risk is low),
     supervisory authority pre-consultation assessment (not required if overall residual risk is
     medium or below).

2. **`docs/compliance/ropa.md` exists and is complete.** One structured sub-section per processing
   activity. Required activities:

   | Activity                                     | Lawful Basis                       | Data Categories                                                                  | Retention                              |
   | -------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------- |
   | Behavioral event collection (ingest)         | Art. 6.1.f LI                      | Behavioral signals, session_id hash                                              | Session scope: 30 min idle + tab close |
   | Session embedding computation                | Art. 6.1.f LI                      | 1024-dim embedding vector, session_id                                            | 90 days from last active event         |
   | Adaptation decision logging (ClickHouse)     | Art. 6.1.f LI                      | session_id, archetype, directive type, holdout_group                             | 13 months (AI Act audit trail)         |
   | LLM prompt processing (Anthropic, processor) | Art. 6.1.f LI + DPA with Anthropic | Behavioral context — no direct PII                                               | Not retained by Anthropic per DPA      |
   | Tenant configuration storage (Postgres)      | Art. 6.1.b contract performance    | Tenant admin contact, billing info                                               | Contract duration + 7 years            |
   | Consent record storage                       | Art. 6.1.c legal obligation        | session_id, consent_type, timestamp, ip_address (encrypted)                      | 3 years from consent event             |
   | DSR processing                               | Art. 6.1.c legal obligation        | session_id, DSR OTP token via email                                              | 30 days from DSR resolution            |
   | Global archetype aggregation                 | Art. 6.1.f LI — model improvement  | DP-anonymized vectors only (k-anon ≥50, ε≤2 — no personal data post-aggregation) | Indefinite (no personal data)          |
   | Agency staff audit logging                   | Art. 6.1.c legal obligation        | Staff user_id, action, timestamp                                                 | 7 years                                |

   Each sub-section must also specify: controller identity (Estalara Ltd.), processors where
   applicable, cross-border transfer mechanism (AC item 3), and data residency region.

3. **Cross-border transfer mechanisms documented for each cross-jurisdiction data flow:**
   - EU → US (Anthropic API calls, OpenAI embeddings): Standard Contractual Clauses Module 2
     (controller → processor) + Transfer Impact Assessment reference.
   - UAE events: remain in Cloudflare dxb / AWS me-central-1; DP-aggregated archetypes only
     transferred to EU global archetype store — no personal data crosses the border.
   - UK tenants: UK International Data Transfer Agreement (IDTA) mechanism noted.
   - US tenants (Supabase US-East): raw events stay in US region; no EU/UAE transfer.

4. **Retention schedule table in ropa.md uses exact Postgres and ClickHouse table names** from the
   codebase. Required rows: `session_embeddings` (Postgres, 90 days), `consent_records` (Postgres, 3
   years), `adaptation_decisions` (ClickHouse, 13 months), `ab_bandit_weights` (Postgres, anonymized
   — retained), `llm_calls` (ClickHouse, 13 months), `answers` (Postgres, contract duration). This
   table is the authoritative source for the TICKET-GDPR-002 deletion worker.

5. **Sub-processors appendix.** ROPA includes an appendix listing all sub-processors: Anthropic
   (LLM), OpenAI (embeddings), Cloudflare (edge ingest + CDN), Supabase (Postgres), ClickHouse Cloud
   (event store), Upstash Redis (cache), Modal (ML compute), Sentry (error tracking), Vercel
   (control plane hosting), Redpanda Cloud (event bus). Each entry: name | jurisdiction | processing
   role | data categories processed | DPA/SCC status.

6. **All four jurisdictions substantively covered.** Spot-check commands (run by PM-orchestrator
   before marking READY_FOR_REVIEW):
   - `grep -c "CCPA\|CPRA" docs/compliance/dpia.md` returns ≥3
   - `grep -c "UAE\|PDPL" docs/compliance/dpia.md` returns ≥3
   - `grep -c "UK GDPR\|ICO\|PECR" docs/compliance/dpia.md` returns ≥3
   - Same three commands on `docs/compliance/ropa.md` each return ≥2.

7. **No placeholder-only sections.** "TBD" is acceptable only for DPO name (genuine pending
   appointment) and supervisory authority pre-consultation outcome. All other sections are
   substantive prose or complete tables.

## Files to touch

| File                        | Action                                                                   |
| --------------------------- | ------------------------------------------------------------------------ |
| `docs/compliance/dpia.md`   | NEW — DPIA v1.0 per GDPR Art. 35 + UK/UAE/US addenda                     |
| `docs/compliance/ropa.md`   | NEW — ROPA v1.0 per GDPR Art. 30 with sub-processors appendix            |
| `docs/compliance/README.md` | NEW — index listing all compliance documents and review schedule         |
| `docs/INTERFACES.md`        | Add entry noting compliance documents location and annual review cadence |

Read `docs/MASTER_DESIGN.md` sections G, H.1–H.6, F.3, and A.3 before drafting. The DPIA Section 2
must accurately reflect the fingerprinting approach described in G.3 (canvas + AudioContext + screen

- WebGL attributes, HMAC with `tenant_secret + day_bucket`, 30-minute idle session reset).

## Test expectations

This ticket produces legal documents, not executable code. The gate criteria are:

1. **PM-orchestrator structure review:** reads both documents in full, confirms every numbered
   section in AC items 1–2 is present and substantive before marking READY_FOR_REVIEW.

2. **Jurisdiction grep checks** (AC item 6): PM-orchestrator runs the six grep commands in the PR
   pipeline. Add a `scripts/check-compliance-docs.sh` shell script that runs them and exits non-zero
   on failure, so CI enforces the check automatically.

3. **Retention table completeness:** `grep "session_embeddings" docs/compliance/ropa.md` and
   `grep "adaptation_decisions" docs/compliance/ropa.md` both return matches. Include in the check
   script.

4. **Sub-processor completeness:**
   `grep "Anthropic\|Supabase\|Cloudflare\|Modal" docs/compliance/ropa.md` returns ≥4 matches.

5. **Human legal review:** Piotr Nawrocki must approve the PR before merge. PM-orchestrator adds to
   the PR description: "LEGAL REVIEW REQUIRED — @piotrnawrocki must approve before merge." This is a
   hard gate.

## Branch naming

`compliance-engineer/TICKET-GDPR-001-dpia-ropa`

## PR title format

`docs(compliance): DPIA (Art. 35) + ROPA (Art. 30) — EU/UK/UAE/US [TICKET-GDPR-001]`

## Definition of done

- PR opened, all local checks green (no TS changes — docs-only CI path).
- `gh pr checks <pr-number> --watch` returns all SUCCESS.
- `scripts/check-compliance-docs.sh` exits 0.
- PM-orchestrator validates all 7 AC items above.
- PM-orchestrator comments `PM-validated. CI green. Pending Piotr legal review.`
- Piotr Nawrocki approves PR (human sign-off required for legal documents).
- Ticket moved to `READY_FOR_REVIEW` in QUEUE.md.
