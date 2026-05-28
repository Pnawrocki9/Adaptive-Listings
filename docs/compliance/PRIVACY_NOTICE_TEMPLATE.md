# Estalara Adaptive Listings — Tenant-Embed Privacy Notice Template

**Version:** 1.0 **Date:** 2026-05-27 **Author:** Compliance Engineering **Regulatory basis:** GDPR
Art. 13/14, ePrivacy Directive Art. 5(3), UK GDPR, CCPA § 1798.100(b) **DPO gate:** See §4 — DPO
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

## 4. DPO Gate — Pre-Distribution Checklist

> **Status: PENDING.** This template must not be distributed to EU tenants or published on
> app.estalara.com until the DPO gate below is closed.

| Gate item                                                                     | Owner                     | Status  |
| ----------------------------------------------------------------------------- | ------------------------- | ------- |
| DPO review of DPIA §13.1 LIA (consent-denial audit log)                       | Compliance Engineering    | PENDING |
| DPO review of DPIA §13.2 LIA (cross-session identifier)                       | Compliance Engineering    | PENDING |
| DPO sign-off recorded in DPIA (replace PENDING note in §13.1/§13.2 DPO gates) | DPO-as-a-Service provider | PENDING |
| FOLLOW-128 deployed to production (§13.2 banner disclosure live for EN/PL/ES) | SDK Engineer              | PENDING |
| §13.2 staging localStorage QA: "Deny"/"Withdraw" removes cross-session key    | Compliance Engineering    | PENDING |
| Tenant DPA updated to reference this template version                         | Legal / Compliance Eng.   | PENDING |

Once all gate items above are DONE, update this table, record the DPO sign-off date, and update the
DPO gate notes in `docs/compliance/dpia.md` §13.1 and §13.2.

**Responsible escalation path:** If DPO sign-off is not received within 5 business days of this
template being shared with the DPO, escalate to the human (Piotr Nawrocki) via
`backlog/ESCALATIONS.md`.

---

## 5. Revision History

| Version | Date       | Author                 | Change                                          |
| ------- | ---------- | ---------------------- | ----------------------------------------------- |
| 1.0     | 2026-05-27 | Compliance Engineering | Initial creation (FOLLOW-129). §13.1 + §13.2    |
|         |            |                        | disclosure paragraphs from DPIA Audit F-13/F-14 |
