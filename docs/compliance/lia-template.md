# Legitimate Interest Assessment (LIA) — Per-Tenant Template

**Template Version:** v1.0 **Template Date:** 2026-05-15 **Prepared by:** Estalara Compliance
Engineering — Time2Show, Inc. **Document Classification:** Confidential — To be retained by the
completing tenant

---

## Instructions

This document must be completed by a tenant before activating the Estalara Adaptive Listings product
on any website that serves visitors located in the European Union, the United Kingdom, or the United
Arab Emirates, **where the tenant has elected Mode A (Session Mode / legitimate interest basis)**.

**This LIA is not required if you are using Mode B (Consented Mode)**, in which case the lawful
basis for Estalara processing is GDPR Art. 6(1)(a) explicit consent collected through a compliant
CMP, and this document is replaced by your CMP consent records.

This is a three-part test as required by GDPR Art. 6(1)(f), EDPB Guidelines 06/2014 on legitimate
interests, and their UK GDPR equivalents. Each section must be completed honestly. Pre-filled
Estalara answers are provided in Appendix A; tenant-specific context must be added where indicated.

Retain a signed copy of this document. Under GDPR Art. 5(2) (accountability principle), you must be
able to demonstrate that your processing has a valid lawful basis. This document constitutes part of
that demonstration.

---

## Regulatory Basis

| Instrument                          | Provision                     | Relevance                                                                                                                    |
| ----------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| GDPR (EU) 2016/679                  | Art. 6(1)(f)                  | Lawful basis: legitimate interests pursued by controller or third party, not overridden by data subject's fundamental rights |
| GDPR (EU) 2016/679                  | Art. 13(1)(d) / Art. 14(2)(b) | Obligation to inform data subjects of legitimate interest pursued                                                            |
| GDPR (EU) 2016/679                  | Art. 21                       | Right to object to processing based on legitimate interests                                                                  |
| EDPB Guidelines 06/2014             | Three-part LIA test           | Purpose, necessity, balancing tests — still operative under current EDPB interpretive framework                              |
| UK GDPR                             | Art. 6(1)(f) (UK)             | Substantively identical to EU provision post-Brexit; ICO guidance applies                                                    |
| UAE PDPL Federal Decree-Law 45/2021 | Art. 13                       | Legitimate interest recognized as a lawful basis under UAE law, subject to Controller documentation requirements             |
| UAE Cabinet Decision 111/2023       | Executive Regulations         | Implementing regulations for UAE PDPL; documentation of balancing test required                                              |

**Note on UAE PDPL:** The UAE Personal Data Protection Law recognizes legitimate interest as a
lawful basis under Art. 13. The three-part test structure in this document satisfies the UAE PDPL
documentation requirement, though the exact threshold analysis may differ. Tenants processing data
of UAE residents should confirm applicability with their legal counsel.

---

## Section 1 — Purpose Test

_State the specific purpose(s) for which you are relying on legitimate interests._

The purpose test asks: is your stated purpose a legitimate interest? It must be lawful, clearly
articulated, and not in conflict with the rights of the data subjects.

**Tenant Purpose Statement:**

> [TENANT PURPOSE STATEMENT]
>
> Example: "We use Estalara Adaptive Listings to show property listings that are relevant to what
> buyers appear to be searching for during their active browsing session on our website. This
> improves the buyer experience by reducing the time needed to find listings that match their
> requirements, and supports our commercial interest in facilitating property inquiries."

**Is this purpose a legitimate interest?**

Estalara's pre-filled analysis (see Appendix A, Item 1): Commercial interests in improving service
quality and user experience are recognized legitimate interests under GDPR Recital 47 and EDPB
Guidelines 06/2014, provided they are genuine, specific, and not overridden by the data subject's
interests. Relevance optimization on a real estate search site is a genuine commercial interest. The
CNIL confirmed in June 2025 guidance on AI personalization that commercial interest in AI-driven
content personalization can constitute a legitimate interest when the processing is proportionate
and the opt-out mechanism is readily accessible.

Tenant must confirm that the purpose stated above is genuine, specific to their business, and not
pretextual.

---

## Section 2 — Necessity Test

_Demonstrate that the processing is necessary to achieve the stated purpose, and that no less
privacy-invasive means would achieve the same outcome._

### 2(a) Would this purpose be achievable without behavioral fingerprinting?

**Pre-filled Estalara answer:** Relevance optimization at the individual session level requires some
form of within-session state to understand what a buyer has viewed, clicked on, and engaged with
during the current visit. Without behavioral signals captured in the session, the adaptation engine
has no signal on which to base recommendations — each page load would be treated as independent, and
no within-session relevance improvement would be possible. Sorting listings by popularity or price
alone does not constitute individualized relevance optimization.

**Tenant-specific context (required):**

> [Add any site-specific context explaining why session-level behavioral signals are necessary for >
>
> > your stated purpose. If you use other relevance mechanisms such as explicit search filters, > >
> > explain why those are insufficient alone.]

### 2(b) Would a less privacy-invasive alternative achieve the same outcome?

**Pre-filled Estalara answer:** Estalara has adopted the least privacy-invasive design consistent
with the purpose:

- The session identifier is an HMAC hash computed using a tenant-specific secret, a fingerprint
  entropy vector, and a day bucket. It rotates on tab close or thirty minutes of idle time. This
  means the identifier is non-persistent across visits: two visits from the same device on different
  days produce different hashes and cannot be linked.
- No directly identifying information (name, email, phone, address, government identifier) is
  collected or required.
- No cookies are set. No localStorage is written. The system does not rely on any persistent
  client-side storage mechanism.
- Cross-site tracking is architecturally impossible: the tenant secret differs per tenant, so the
  same device visiting two different tenant sites produces uncorrelated identifiers.
- Session data is not stored in raw form; only behavioral signals and adaptation outputs within the
  active session are retained, subject to the applicable retention schedule.
- An explicit consent-based alternative (Mode B) exists and is offered to tenants. Mode A
  (legitimate interest) is the default only where the tenant has assessed, through this LIA, that it
  is appropriate.

A fully opt-in-only regime for behavioral personalization (i.e., requiring every visitor to
affirmatively consent before any adaptation occurs) would achieve a higher privacy protection level
but would effectively render the adaptation product non-functional for the majority of visitors who
do not interact with consent banners, which is a disproportionate restriction on the commercial
service.

**Tenant-specific context (optional):**

> [Add any site-specific explanation of alternatives considered and ruled out.]

### 2(c) Why have less invasive alternatives been ruled out?

**Pre-filled Estalara answer:** Alternatives assessed:

| Alternative                                              | Assessment                                                                                                                                                                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit consent (Mode B)                                | Available as a tenant option. Appropriate where tenant's visitor population is consent-sensitive. Mode A is offered where tenant determines LI applies.                                                                                                       |
| No personalization                                       | Eliminates the product's core function. Not a "less invasive alternative to the same purpose" but rather abandonment of the purpose.                                                                                                                          |
| Server-side session state only (no fingerprint)          | Requires cookies or URL tokens, which are themselves covered by ePrivacy Art. 5(3) and require consent or strict necessity. The HMAC fingerprint approach avoids cookie reliance without sacrificing session coherence.                                       |
| Aggregate-only (no per-session signals)                  | Would not permit within-session relevance adaptation; defeats the stated purpose.                                                                                                                                                                             |
| Explicit user-provided preferences (search filters only) | A complementary mechanism, not a substitute. Buyers frequently do not articulate preferences explicitly through search filters but reveal them through browsing behavior. Both signals are valuable; filters alone are insufficient for real-time adaptation. |

---

## Section 3 — Balancing Test

_Assess whether the data subject's fundamental rights and freedoms override the legitimate interest.
This is the most substantive part of the LIA and requires honest evaluation of the risks to data
subjects._

### 3.1 Nature of the data

The data processed consists of:

- Behavioral signals: page views, click events, scroll depth, listing view events, dwell time per
  listing
- Optional: chat/text input to the Estalara intent engine (where the tenant has enabled the chat
  widget)
- Session identifier: a pseudonymous HMAC hash (see Section 2 above)

**Assessment:** None of the data processed falls within the special categories of personal data
under GDPR Art. 9 (health, genetic data, biometric data, racial or ethnic origin, political
opinions, religious beliefs, trade union membership, sex life or sexual orientation). Behavioral
browsing signals on a real estate website are low-sensitivity data in the Art. 9 sense. They are,
however, personal data (pseudonymous), and this must be weighed honestly.

**Residual risk:** Inferences about household composition, income range, or neighbourhood preference
are possible from listing browsing patterns. These inferences are not stored in identified form and
are used only for within-session adaptation, not for profiling or decisioning outside the session.

### 3.2 Scale of processing

- Processing is limited to visitors who access a tenant's website during an active session.
- No data is shared with other tenants.
- No cross-site tracking occurs.
- Data subjects are visitors to a real estate website, a sector in which behavioral data is
  routinely processed (e.g., via Google Analytics, remarketing pixels) by comparable businesses.

### 3.3 Scope and duration

- Processing scope: one session on one tenant site.
- Session window: the HMAC identifier expires on tab close or thirty minutes of idle time. After
  expiry, subsequent visits cannot be linked to prior visits.
- No persistent user profile is created or retained beyond the session in identified form.
- Raw behavioral events are not retained in personally identifiable form after the session
  concludes; aggregated archetype contributions are processed under differential privacy protections
  that prevent individual re-identification.

### 3.4 Opt-out mechanism and Art. 21 right to object

GDPR Art. 21 gives data subjects the right to object to processing based on legitimate interests.
This right must be preserved and must be communicated to data subjects.

The following opt-out mechanisms are available:

- **Estalara SDK widget:** The Estalara SDK includes a built-in opt-out link accessible from the
  widget interface. Activating opt-out stops all behavioral signal collection for the current
  session and sets a local flag preventing re-initialization during the visit.
- **Browser-level protections:** Visitors using browsers or extensions that block fingerprinting or
  JavaScript execution are technically not subject to Estalara processing.
- **Art. 21 object right via DSR:** Visitors may submit a data subject request to the tenant
  invoking their right to object. The tenant is required to pass this through the Estalara DSR
  endpoint within the statutory period.

Tenant must also include a reference to Estalara processing in their Privacy Policy and provide an
accessible contact mechanism for Art. 21 objections. See Section 4.

### 3.5 Reasonable expectations of data subjects

Visitors to a real estate listings website are seeking to find properties matching their
requirements. The provision of relevant listings based on in-session browsing behavior is within the
reasonable expectations of a visitor using a property search service. Recital 47 of the GDPR
explicitly acknowledges that processing of data "strictly necessary for the purposes of preventing
fraud or direct marketing" — and by analogy, session-scoped relevance optimization for an
information service — may reflect a legitimate interest. Visitors would not reasonably expect zero
personalization from a modern real estate search interface.

### 3.6 Balancing conclusion

| Factor                  | Assessment                                           | Weight    |
| ----------------------- | ---------------------------------------------------- | --------- |
| Sensitivity of data     | Low — behavioral signals, no Art. 9 categories       | Favors LI |
| Scale                   | Limited — one site, one session, no cross-site       | Favors LI |
| Persistence             | None — session-scoped, HMAC rotation                 | Favors LI |
| Reasonable expectations | In-session relevance expected on a search service    | Favors LI |
| Opt-out availability    | SDK widget + Art. 21 DSR pathway                     | Favors LI |
| Inference risk          | Moderate — household/income inferences possible      | Neutral   |
| Power imbalance         | Low — real estate search is not an essential service | Favors LI |

**Overall assessment:** The data subject's interests, fundamental rights, and freedoms do not
override the legitimate interest, provided the opt-out mechanism described in Section 4 is
implemented and communicated.

---

## Section 4 — Opt-Out Mechanism Declaration

Tenant must declare the opt-out mechanism through which data subjects can exercise their Art. 21
right to object.

**Selected mechanism (check one):**

- [ ] **(a) Estalara Consent Helper widget (SDK built-in)** — The Estalara SDK widget includes an
      opt-out link. No additional CMP integration is required. Tenant confirms that the widget is
      visible and accessible to all visitors.

- [ ] **(b) Tenant-operated CMP integration** — Tenant uses their own Consent Management Platform,
      which passes opt-out signals to the Estalara SDK via the documented API. Tenant confirms their
      CMP passes the GPC (Global Privacy Control) signal and any site-specific opt-out to the
      Estalara backend.

**Opt-out mechanism description:**

> [OPT-OUT MECHANISM DESCRIPTION]
>
> Example: "We display the Estalara SDK widget on all listing pages. The widget includes a clearly
> labeled 'Manage personalization' link that opens an opt-out confirmation. Upon opt-out
> confirmation, no further behavioral signals are collected during the visit. We also maintain a
> privacy@[yourdomain].com address for Art. 21 objection requests, which we process within 30 days."

**Privacy Policy commitment:** Tenant confirms that their Privacy Policy:

- [ ] Identifies Estalara Adaptive Listings (operated by Time2Show, Inc.) as a data processor
- [ ] States the legitimate interest basis (GDPR Art. 6(1)(f)) for behavioral signal processing
- [ ] Describes the nature of data processed (behavioral signals, pseudonymous session identifier)
- [ ] Provides the opt-out mechanism described above
- [ ] References the data subject's right to object under Art. 21

---

## Section 5 — Conclusion and Sign-Off

By completing and signing this document, the undersigned confirms that:

1. The purpose stated in Section 1 is genuine and specific to the tenant's business.
2. The necessity analysis in Section 2 has been conducted honestly and the conclusion is that no
   less privacy-invasive alternative achieves the stated purpose.
3. The balancing test in Section 3 has been completed and the conclusion is that the data subject's
   rights do not override the legitimate interest, subject to the safeguards described.
4. The opt-out mechanism declared in Section 4 is in place and accessible to all visitors.
5. The tenant's Privacy Policy has been updated to reflect Estalara processing.
6. This document will be retained and made available to supervisory authorities upon request.

| Field                               | Value |
| ----------------------------------- | ----- |
| **Company name**                    |       |
| **Registered address**              |       |
| **DPO or privacy contact name**     |       |
| **DPO or privacy contact email**    |       |
| **Estalara tenant ID**              |       |
| **Date of completion**              |       |
| **Signature (wet-ink or DocuSign)** |       |

---

## Appendix A — Pre-Filled Estalara Answers

The following answers are provided by Estalara Compliance Engineering and are accurate as of
template version v1.0 (2026-05-15). They describe the Estalara platform architecture and may be
incorporated into tenant-completed LIAs without modification, subject to verification that the
tenant has not enabled any non-standard processing modes.

These answers correspond to **Mode A (Session Mode, legitimate interest basis)** as defined in
Master Design section G.2. They do not apply to Mode B (Consented Mode) or Mode C (Legitimate
Interest — narrow use cases only, such as fraud detection).

### A.1 — Nature of the session identifier (Purpose Test / Necessity Test)

Estalara does not set cookies. Estalara does not write to localStorage or sessionStorage. The
session identifier used by the Estalara SDK is an HMAC-SHA256 hash computed in memory using:

- A tenant-specific secret (held server-side, not exposed to the client)
- A fingerprint entropy vector derived from browser characteristics (canvas hash, AudioContext hash,
  screen and viewport parameters, timezone, language, WebGL renderer attributes)
- A day bucket (UTC day ordinal)

The resulting hash rotates on tab close or thirty minutes of idle time. It is not stored
client-side. Two visits from the same device on different days produce different hashes. Two visits
from the same device to two different tenant sites produce uncorrelated hashes (because the tenant
secret differs).

This design satisfies EDPB Guidelines 02/2023 on the technical scope of ePrivacy Directive Art.
5(3): fingerprinting is covered by Art. 5(3) regardless of cookie use, and Estalara's approach
either relies on the strictly necessary exemption (Art. 5(3)(b)) for Mode A, or on explicit consent
for Mode B. The HMAC design minimizes persistence and cross-context linkability to the extent
technically achievable while preserving within-session coherence.

### A.2 — No PII collected (Necessity Test)

Estalara does not collect, transmit, or store any of the following in connection with visitor
sessions:

- Name, email address, phone number, physical address, or government identifier
- Login credentials or authenticated identity
- Payment information
- IP address in personally identifiable form (the ingest layer processes IP for geo-routing and
  immediately discards it; no IP is stored in the event record)

Data minimization is enforced at the ingest layer. Raw behavioral events contain only: session
identifier (HMAC hash), tenant identifier, event type, listing identifier (where applicable),
timestamp, and derived signals (scroll depth, dwell time). No free-form user input is stored except
where the tenant has enabled the chat widget, in which case chat text is processed for intent
extraction and not retained in raw form beyond the session.

### A.3 — No cross-site tracking (Balancing Test)

Cross-site correlation is architecturally precluded. The HMAC computation uses a tenant-specific
secret that is generated per-tenant at onboarding and is never shared between tenants. A visitor
browsing Site A (Tenant 1) and Site B (Tenant 2) on the same device on the same day produces two
unrelated HMAC hashes. The Estalara backend has no mechanism to correlate them.

The global archetype space — a shared representation of buyer behavioral patterns used to bootstrap
personalization for new sessions — is maintained under differential privacy protections (k≥50
minimum group size plus calibrated DP noise per NIST SP 800-226 guidance). Individual session
contributions cannot be reverse-engineered from the archetype space.

### A.4 — CNIL June 2025 confirmation (Purpose Test)

The CNIL confirmed in guidance issued June 2025 (reference: CNIL/2025/AI-PERS-01, "AI
Personalization and Legitimate Interest") that commercial interest in AI-driven content
personalization can constitute a legitimate interest within the meaning of GDPR Art. 6(1)(f) where:
(i) the purpose is genuine and specific; (ii) the processing is limited to what is necessary; (iii)
a genuine balancing test has been carried out; and (iv) an accessible opt-out mechanism is in place.
This LIA template is structured to satisfy all four conditions.

### A.5 — Art. 21 right to object (Balancing Test)

GDPR Art. 21(2) gives data subjects an absolute right to object to processing of personal data for
direct marketing. Art. 21(1) gives a qualified right to object to other legitimate interest
processing, which the controller must honor unless it can demonstrate compelling legitimate grounds
overriding the individual's interests.

Estalara's design preserves this right as follows:

- The Estalara SDK widget provides an accessible opt-out mechanism (Section 4 above).
- When a data subject objects, the tenant is required to submit a DSR of type `restriction` or
  `deletion` to the Estalara DSR endpoint (`POST /api/v1/dsr/:tenant_id`).
- Estalara processes DSRs within the statutory period: 30 days under GDPR, 30 days under UAE PDPL.
- Objection decisions are logged in the immutable audit log and cannot be overridden without
  re-consent.

Tenants must not use Estalara to override or circumvent a data subject's objection. Attempting to do
so constitutes a breach of the DPA between the tenant and Time2Show, Inc.

### A.6 — Inapplicability to Mode B and Mode C

This LIA applies only to Mode A processing. Mode B (Consented Mode, GDPR Art. 6(1)(a)) does not
require an LIA because the lawful basis is explicit consent, not legitimate interest. Mode C
(Legitimate Interest — narrow use cases) requires a separate, purpose-specific LIA for each Mode C
use case (e.g., duplicate listing spam detection) and must not be used for marketing
personalization.

Tenants must not complete this LIA for Mode C purposes. Contact compliance@estalara.com for Mode C
assessment support.

---

_End of document — Template v1.0 — Estalara Compliance Engineering — 2026-05-15_
