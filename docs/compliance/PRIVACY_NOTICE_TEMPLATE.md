# Estalara Adaptive Listings — Tenant-Embed Privacy Notice Template

**Version:** 1.2 **Date:** 2026-06-08 **Author:** Compliance Engineering **Regulatory basis:** GDPR
Art. 13/14, ePrivacy Directive Art. 5(3), UK GDPR, CCPA § 1798.100(b) **DPO gate:** See §5 — DPO
sign-off required before this template is distributed to EU tenants.

---

## Purpose

This template provides the disclosure paragraphs that tenants operating Estalara Adaptive Listings
must include in their public-facing Privacy Policy (or equivalent notice). Tenants paste the
relevant sections into their own document and may rephrase for style provided the material
disclosures are preserved. Sections marked **mandatory for EU pilot** must be present verbatim or
equivalent before Estalara is enabled on EU-resident traffic.

Estalara's Data Processing Agreement (DPA) with each tenant requires inclusion of these disclosures.
Non-compliance voids the DPA warranty for that tenant.

---

## 1. General Estalara Personalization Disclosure (mandatory for all tenants)

> **Tenant action —** insert this paragraph in your Privacy Policy under "Third-party services" or
> an equivalent section.

This website uses **Estalara Adaptive Listings**, a personalization service provided by Time2Show,
Inc. (operating as Estalara), to adapt how property listings are displayed based on your browsing
behavior during your visit. Estalara captures anonymous behavioral signals — such as which listings
you view, how long you spend on each, and the search filters you apply — and uses these to reorder
and highlight listings that are likely to be more relevant to you.

Estalara does not read your name, email address, phone number, or any account credentials. Your
activity is represented by a pseudonymous session identifier that is discarded when you close your
browser tab or after 30 minutes of inactivity. For the legal basis and further detail, see §2 and §3
below.

---

## 2. Consent-Denial Audit Log Disclosure (mandatory for EU/UK tenants — DPIA §13.1)

> **Source:** DPIA §13.1 LIA — Audit Finding F-13. Lawful basis: GDPR Art. 6(1)(f) (legitimate
> interest — operational accountability under Art. 5(2)). Added FOLLOW-129.

> **Tenant action —** insert this paragraph adjacent to your consent management / cookie notice
> description.

If you decline the personalization consent prompt on this website, Estalara records the fact of your
denial — a single binary signal ("consent declined") together with a pseudonymous session token — on
its servers for compliance and debugging purposes. This record allows Estalara to demonstrate to
supervisory authorities that data collection ceased upon your decision, and to detect technical
errors in the consent management system.

**The denial log is retained for a maximum of 7 days and is then permanently and automatically
deleted.** No behavioral data, device fingerprint, or content of your browsing session is included
in this record. The session token in the log is ephemeral and rotates on every new browser session.

This processing is carried out under the legitimate interest of accountability under GDPR Art. 5(2),
as documented in Estalara's Data Protection Impact Assessment (DPIA §13.1). You may object to this
processing by submitting a data subject request to [tenant DSR contact].

---

## 3. Cross-Session Identifier Disclosure (mandatory for EU/UK tenants in Mode B — DPIA §13.2)

> **Source:** DPIA §13.2 LIA — Audit Finding F-14. Lawful basis: GDPR Art. 6(1)(f) (legitimate
> interest — personalization continuity and conversion measurement). Balancing test GREEN contingent
> on FOLLOW-128 banner deployment. Added FOLLOW-129.

> **Tenant action —** insert this paragraph if you have enabled cross-session (Mode B) journey
> tracking in your Estalara configuration. It must also appear in the Estalara consent banner itself
> — see the coordination note below.

To remember your listing preferences across separate visits, Estalara stores a pseudonymous
identifier in your browser's local storage. This identifier is generated from general browser
characteristics (such as screen settings and timezone) and is unique to this website — it cannot be
used to identify you across other websites.

**This identifier is stored for up to 90 days. It is refreshed every 90 days and is immediately
deleted if you withdraw consent or click "Decline" on the personalization prompt.** No raw browser
characteristics are stored on Estalara's servers — only the hashed result.

This processing is carried out under the legitimate interest of personalization continuity and
conversion measurement, as documented in Estalara's Data Protection Impact Assessment (DPIA §13.2).
You may object at any time by clicking "Withdraw consent" in the personalization banner, or by
submitting a data subject request to [tenant DSR contact].

> **Coordination note for §3 (FOLLOW-128 dependency):** The disclosure in this section must also
> appear in the Estalara consent banner visible to visitors — not only in the Privacy Policy —
> because the cross-session identifier is set on first page load before the visitor navigates to the
> policy. The banner copy is implemented in `packages/sdk/src/ui/consent-banner.ts` (COPY constant).
> **FOLLOW-128** owns the SDK code change to add this disclosure to the EN, PL, and ES banner locale
> strings. This section of the Privacy Notice template is **not sufficient on its own** for GDPR
> compliance until FOLLOW-128 is deployed. The DPIA §13.2 balancing test GREEN status is contingent
> on FOLLOW-128 deployment.

---

## 4. Client-Storage Table — All Active Keys (mandatory disclosure for EU/UK tenants)

> **Tenant action —** include this table in your Privacy Policy under a "Cookies and local storage"
> or equivalent section. All eight keys listed below are written by the Estalara SDK loaded on your
> website.

| Key name                            | Storage type   | Data stored                                                                        | Lifetime                                                                                                     | Consent required | Purpose                                                                                                                          |
| ----------------------------------- | -------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `__estalara_session__`              | sessionStorage | Session ID (pseudonymous SHA-256 hash), session start time, page count             | Tab lifetime (cleared on tab close)                                                                          | No (Mode A)      | Session continuity within a single browser tab                                                                                   |
| `estalara_consent`                  | localStorage   | Consent decision: `"granted"` or `"denied"`                                        | Persistent (survives tab close); overwritten on re-choice                                                    | No               | Remember consent decision to avoid re-prompting                                                                                  |
| `__estalara_xid__`                  | localStorage   | Cross-session pseudonymous identifier (UUID v4 + creation timestamp)               | Up to 90 days; erased on consent denial/withdrawal                                                           | Yes (Mode B)     | Personalization continuity across separate visits (DPIA §13.2)                                                                   |
| `__estalara_lead_id__`              | sessionStorage | Derived pseudonymous lead ID (first 16 hex chars of SHA-256 of Keycloak user UUID) | Tab lifetime                                                                                                 | Yes              | Link authenticated buyer sessions to behavioral profile without storing raw user ID                                              |
| `estalara_intent_{sessionId}`       | sessionStorage | Inferred archetype label + per-archetype probability vector (profiling-adjacent)   | Tab lifetime; max 30 minutes since last write (`INTENT_STATE_STALE_MS`); erased on consent denial/withdrawal | Yes (Mode B)     | Session-level archetype continuity: avoids re-computing intent on every page navigation within a tab (DPIA §13.3)                |
| `estalara_variant:{sessionId}`      | sessionStorage | A/B variant assignment string for the current session (e.g., `"variant_0"`)        | Tab lifetime (sessionStorage cleared on tab close); no cross-session persistence                             | No               | Ensure consistent A/B variant within a tab so feedback pings match the served variant (`SESSION_VARIANT_KEY_PREFIX`, `adapt.ts`) |
| `__estalara_quiz_dismissed__`       | localStorage   | Unix timestamp (ms) of the last quiz dismissal                                     | 24 hours from dismissal (self-expires by TTL check; not erased on consent denial)                            | No               | User preference: suppress the intent-quiz prompt for 24 hours after dismissal to avoid re-prompting                              |
| `__estalara_micro_poll_dismissed__` | localStorage   | Unix timestamp (ms) of the last micro-poll dismissal                               | 24 hours from dismissal (self-expires by TTL check; not erased on consent denial)                            | No               | User preference: suppress the micro-poll bottom-toast for 24 hours after dismissal to avoid re-prompting                         |

> **Implementation notes:**
>
> - `estalara_intent_*` and `estalara_variant:*`: the key suffix is the per-tab session ID, so the
>   full key name varies per session. The wildcard forms above are used for disclosure. Both entries
>   are sessionStorage and are cleared automatically by the browser on tab close.
> - `estalara_intent_*` is written only when consent is granted and is erased immediately on consent
>   denial/withdrawal (`eraseIntentState()` at `index.ts:209` and `index.ts:260`). Source: DPIA
>   §13.3 (FOLLOW-218).
> - `estalara_variant:*` stores only the variant assignment string (no behavioral or profile data).
>   No erase-on-denial is required or implemented because the data is not behavioral tracking data.
>   Source: `SESSION_VARIANT_KEY_PREFIX` in `packages/sdk/src/core/adapt.ts`.
> - `__estalara_quiz_dismissed__` and `__estalara_micro_poll_dismissed__` store only a Unix
>   timestamp; they contain no identifier or behavioral signal. Legal basis is strictly-necessary
>   under ePrivacy Art. 5(3)(b): storing a dismissal preference is necessary to provide the
>   interactive service functionality explicitly requested (dismissing the prompt). No
>   erase-on-denial is implemented because these keys contain no personal data beyond a preference
>   timestamp. Sources: `DISMISS_STORAGE_KEY` in `packages/sdk/src/ui/quiz-trigger.ts`;
>   `MICRO_POLL_DISMISS_KEY` in `packages/sdk/src/ui/micro-poll.ts`.

---

## 5. DPO Gate — Pre-Distribution Checklist

> **Status: PENDING.** This template must not be distributed to EU tenants or published on
> app.estalara.com until the DPO gate below is closed.

| Gate item                                                                           | Owner                     | Status  |
| ----------------------------------------------------------------------------------- | ------------------------- | ------- |
| DPO review of DPIA §13.1 LIA (consent-denial audit log)                             | Compliance Engineering    | PENDING |
| DPO review of DPIA §13.2 LIA (cross-session identifier)                             | Compliance Engineering    | PENDING |
| DPO sign-off recorded in DPIA (replace PENDING note in §13.1/§13.2/§13.3 DPO gates) | DPO-as-a-Service provider | PENDING |
| FOLLOW-128 deployed to production (§13.2 banner disclosure live for EN/PL/ES)       | SDK Engineer              | PENDING |
| §13.2 staging localStorage QA: "Deny"/"Withdraw" removes cross-session key          | Compliance Engineering    | PENDING |
| DPO review of DPIA §13.3 (intent-state sessionStorage store)                        | Compliance Engineering    | PENDING |
| §13.3 staging sessionStorage QA: "Deny"/"Withdraw" removes `estalara_intent_*` key  | Compliance Engineering    | PENDING |
| Tenant DPA updated to reference this template version                               | Legal / Compliance Eng.   | PENDING |

Once all gate items above are DONE, update this table, record the DPO sign-off date, and update the
DPO gate notes in `docs/compliance/dpia.md` §13.1, §13.2, and §13.3.

**Responsible escalation path:** If DPO sign-off is not received within 5 business days of this
template being shared with the DPO, escalate to the human (Piotr Nawrocki) via
`backlog/ESCALATIONS.md`.

---

## 6. Revision History

| Version | Date       | Author                 | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------- | ---------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 2026-05-27 | Compliance Engineering | Initial creation (FOLLOW-129). §13.1 + §13.2                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
|         |            |                        | disclosure paragraphs from DPIA Audit F-13/F-14                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 1.1     | 2026-06-08 | Compliance Engineering | FOLLOW-218: added §4 client-storage table listing all five active SDK keys including the new `estalara_intent_{sessionId}` sessionStorage entry. Renumbered old §4 (DPO Gate) to §5; old §5 (Revision History) to §6. DPO gate updated to add §13.3 review item and §13.3 staging QA gate item.                                                                                                                                                                                               |
| 1.2     | 2026-06-08 | Compliance Engineering | FOLLOW-230: §4 updated to list all eight active SDK keys. Added three keys omitted from v1.1: `estalara_variant:{sessionId}` (sessionStorage, A/B variant, strictly-necessary), `__estalara_quiz_dismissed__` (localStorage, preference timestamp, strictly-necessary), `__estalara_micro_poll_dismissed__` (localStorage, preference timestamp, strictly-necessary). Updated header from "all five" to "all eight". Added per-key implementation notes with grep-verified source references. |
