# Legitimate Interest Assessment (LIA) — Per-Tenant Template

**Template Version:** v2.0 **Template Date:** 2026-08-24 **Prepared by:** Estalara Compliance
Engineering — Time2Show, Inc. **Document Classification:** Confidential — To be retained by the
completing tenant

> **v2.0 — this template was materially wrong until 2026-08-24 and must not be used in its v1.0
> form.** Every pre-filled answer about the session identifier described a mechanism
> (`HMAC(tenant_secret, fingerprint_entropy, day_bucket)`, rotation on tab close or 30 minutes of
> idle) that **has never existed in the product**. Two of those answers — §3.6's "Persistence: None"
> and §A.3's "cross-site correlation is architecturally precluded" — were not merely inaccurate,
> they were the two heaviest weights on the data-subject side of the balancing test, and they were
> **inverted**: the identifier that actually shipped from 2026-05-10 to 2026-08-24 was a stable,
> unkeyed device digest, identical across tenants, measured persisting 41–106 hours across 2–5
> calendar days. A tenant who completed and signed v1.0 of this template ran a balancing test on
> false premises. **Any v1.0 LIA on file should be re-run against this version.** Measurement:
> `docs/compliance/FOLLOW-1105-session-identifier-assessment.md`. Ruling: `backlog/ESCALATIONS.md`
> ESC-070 (Path C, CEO, 2026-08-24). Remedy shipped: FOLLOW-1106 / PR #844, `d9160da0`. Correction
> ticket: FOLLOW-1107.

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

### 2(a) Would this purpose be achievable without capturing within-session behavioral signals?

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

- The session identifier is a **randomly minted UUID v4**. It is drawn from the browser's
  cryptographic random number generator and is derived from **nothing** — not the device, not the
  browser configuration, not the visitor, not the tenant, not any earlier session. It is held in
  `sessionStorage`, which is scoped to a single browser tab and cleared by the browser when that tab
  closes. Verify at `packages/sdk/src/core/session.ts`: `generateSessionId()`,
  `SESSION_STORAGE_KEY = '__estalara_session__'`, `getOrCreateSession()`. The properties are pinned
  by tests in `packages/sdk/src/__tests__/session.test.ts` — _"mints 500 distinct ids in one
  identical environment"_, _"never hashes anything — crypto.subtle.digest is not called"_, _"does
  not read navigator.userAgent, screen or Intl"_.
- Because the identifier has no derivation, it cannot be re-derived: neither Estalara nor a tenant
  can recompute a visitor's earlier session identifier from their browser, and two identifiers
  minted on two visits carry no computable relation to each other.
- No directly identifying information (name, email, phone, address, government identifier) is
  collected or required.
- **No cookies are set.** `localStorage` and `sessionStorage` **are** used, and the complete list of
  keys — eleven of them — is published in `PRIVACY_NOTICE_TEMPLATE.md` §4, which the tenant must
  reproduce in its own privacy policy. The tenant should read that table before completing this
  section. _(Corrected v2.0: v1.0 of this template stated "No localStorage is written. The system
  does not rely on any persistent client-side storage mechanism." Both clauses were false —
  `estalara_consent`, `__estalara_xid__` and `__estalara_profiling_opt_out__` are localStorage keys
  written by the shipped SDK — and they contradicted the Privacy Notice template sitting in the same
  directory.)_
- **On cross-site tracking, stated as what is checkable.** The session identifier contributes
  nothing to cross-site correlation: it is random, so the same visitor on two tenant sites receives
  two unrelated values, and no shared derivation exists that could relate them. This is a statement
  about the identifier, **not** a guarantee that no cross-site linkage of any kind is possible — see
  §3.3 for the vectors that remain and are not closed by it.
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

| Alternative                                              | Assessment                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit consent (Mode B)                                | Available as a tenant option. Appropriate where tenant's visitor population is consent-sensitive. Mode A is offered where tenant determines LI applies.                                                                                                                                                                                           |
| No personalization                                       | Eliminates the product's core function. Not a "less invasive alternative to the same purpose" but rather abandonment of the purpose.                                                                                                                                                                                                              |
| Server-side session state only                           | Requires cookies or URL tokens, which are themselves covered by ePrivacy Art. 5(3) and require consent or strict necessity. A random token in tab-scoped `sessionStorage` also engages Art. 5(3) — the storage step does, whatever the technique — but it is discarded with the tab rather than persisting, and it carries no device information. |
| Aggregate-only (no per-session signals)                  | Would not permit within-session relevance adaptation; defeats the stated purpose.                                                                                                                                                                                                                                                                 |
| Explicit user-provided preferences (search filters only) | A complementary mechanism, not a substitute. Buyers frequently do not articulate preferences explicitly through search filters but reveal them through browsing behavior. Both signals are valuable; filters alone are insufficient for real-time adaptation.                                                                                     |

---

## Section 3 — Balancing Test

_Assess whether the data subject's fundamental rights and freedoms override the legitimate interest.
This is the most substantive part of the LIA and requires honest evaluation of the risks to data
subjects._

> **Re-derived in v2.0 (FOLLOW-1107), not edited.** The v1.0 balancing test placed two weights on
> the controller's side — "Persistence: None — session-scoped, HMAC rotation" (§3.6) and "cross-site
> correlation is architecturally precluded" (§A.3) — that were false, and false in the direction
> that favoured the controller. Deleting them would leave the test **unrun**, not merely weakened,
> so each factor below has been re-assessed against the shipped mechanism at `d9160da0` and the
> weight column re-derived. Where a factor now cuts differently than in v1.0, that is stated.

### 3.1 Nature of the data

The data processed consists of:

- Behavioral signals: page views, click events, scroll depth, listing view events, dwell time per
  listing
- Optional: chat/text input to the Estalara intent engine (where the tenant has enabled the chat
  widget)
- Session identifier: a pseudonymous random UUID v4 held in tab-scoped `sessionStorage` (see Section
  2(b) above)

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
- No data is shared with other tenants. Tenant isolation is enforced by Postgres RLS policies,
  per-tenant ClickHouse partition keys, and tenant claims carried in signed JWTs — not by any
  property of the identifier.
- **The session identifier performs no cross-site tracking**: it is random per tab, so the same
  visitor on two tenant sites receives two unrelated values. This replaces v1.0's flat "no
  cross-site tracking occurs", which was an absolute claim, was false of the identifier that
  actually shipped, and is not something an identifier's construction can establish on its own. §3.3
  states what remains.
- Data subjects are visitors to a real estate website, a sector in which behavioral data is
  routinely processed (e.g., via Google Analytics, remarketing pixels) by comparable businesses.

### 3.3 Scope and duration

- Processing scope: one session on one tenant site.
- **Session window:** the identifier lives in `sessionStorage` and is discarded by the browser when
  the tab is closed. There is **no** thirty-minute idle expiry — no such timer exists in the SDK,
  and v1.0 of this template asserted one. A new browsing context begins with a new random identifier
  that carries no computable relation to the previous one. _Browser caveat, stated because it is the
  one exception: if the visitor's browser restores a closed tab or a previous browsing session
  (Ctrl+Shift+T, crash recovery, "continue where you left off"), it restores that tab's
  `sessionStorage` too, and the same identifier resumes. That is browser behaviour, not an Estalara
  store, and it is the reason this template says "discarded when the tab is closed" rather than
  "unrecoverable"._
- **What the identifier does not close, and must be weighed here.** Three linkage vectors survive
  the identifier's randomness and are part of the tenant's balancing decision:
  1. `__estalara_xid__` — a 90-day cross-session identifier in `localStorage`, created **only** in
     Mode B after consent is granted and erased on denial or withdrawal. A Mode A tenant completing
     this LIA does not enable it. (At `d9160da0` it is also never transmitted to Estalara —
     FOLLOW-146 — so it presently produces no server-side linkage even where enabled.)
  2. `lead_id` — for a visitor authenticated through the tenant's identity provider, a deterministic
     `SHA-256` prefix of their account identifier, attached to chat and live events. This is a
     durable cross-session key **by design**, and it is the reason this document makes no absolute
     cross-session claim anywhere.
  3. Network and behavioural metadata — a source IP is visible to the edge on every request, and
     stored behavioural sequences can support correlation independently of any identifier.
- No persistent user profile is created or retained beyond the session in identified form.
- Behavioral events are retained in pseudonymous form in the Estalara event store subject to the
  retention schedule in `ROPA — Retention Schedule`; the tenant should read that table, including
  the rows currently marked **UNENFORCED**, rather than assume events are discarded when the session
  ends. Aggregated archetype contributions are processed under differential privacy protections that
  prevent individual re-identification. _(v1.0 said raw behavioral events "are not retained in
  personally identifiable form after the session concludes". They are retained pseudonymously, keyed
  by `session_id`, for the periods in the ROPA — which is a materially different statement and the
  one the tenant must weigh.)_

### 3.4 Opt-out mechanism and Art. 21 right to object

GDPR Art. 21 gives data subjects the right to object to processing based on legitimate interests.
This right must be preserved and must be communicated to data subjects.

The following opt-out mechanisms are available:

- **Estalara SDK widget:** The Estalara SDK renders an opt-out toggle inside its Shadow DOM
  (`renderProfilingToggle()`, `packages/sdk/src/ui/profiling-toggle.ts`, mounted once the Shadow DOM
  host exists post-consent). Activating it writes `__estalara_profiling_opt_out__` to `localStorage`
  and takes effect immediately and **persistently** — it survives tab close and applies on
  subsequent visits until the visitor opts back in, at which point the key is removed. What it
  suppresses, verified in `packages/sdk/src/index.ts`: the behavioral collector's events are dropped
  before they reach the dispatch queue, DOM adaptation and Decision API calls stop, intent state is
  not rehydrated, and the quiz/micro-poll prompts are suppressed. **What it deliberately does not
  suppress:** a small set of platform events protected under Master Design §H.8 — notably
  `listing.bookmarked` — continue to reach ingest, by CEO ruling of 2026-06-23 (FOLLOW-384). _(v1.0
  of this template said opt-out "stops all behavioral signal collection for the current session" and
  set a flag "preventing re-initialization during the visit". Both were wrong in both directions: it
  is narrower than "all", and broader than "the visit".)_
- **Browser-level protections:** Visitors who block JavaScript execution, or block the Estalara
  script specifically, are technically not subject to Estalara processing. _(v1.0 also offered
  anti-fingerprinting protections here. Those are no longer relevant in either direction: the
  product performs no fingerprinting, so blocking it changes nothing — and this bullet should not be
  presented to a tenant as an opt-out route the visitor can rely on.)_
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

_Re-derived v2.0 (FOLLOW-1107) against the mechanism at `d9160da0`. The "was (v1.0)" column is kept
deliberately: a tenant who signed the earlier version needs to see which weight moved and why._

| Factor                        | Assessment (v2.0, verified)                                                                                                                                                                                                                                          | Weight             | Was (v1.0)                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------- |
| Sensitivity of data           | Low — behavioral signals, no Art. 9 categories                                                                                                                                                                                                                       | Favors LI          | Favors LI (unchanged)        |
| Scale                         | Limited — one site, one session; the identifier contributes nothing to cross-site correlation                                                                                                                                                                        | Favors LI          | Favors LI (premise now true) |
| Identifier persistence        | **Tab-scoped, not zero.** Discarded when the tab closes (browser session-restore excepted, §3.3); a new visit begins with a new, unrelated random identifier                                                                                                         | Favors LI          | "None" — false as written    |
| **Event-store retention**     | **Newly weighed.** Behavioral events keyed by `session_id` are retained pseudonymously per the ROPA schedule — 13 months in `events`, and **indefinitely** in `adaptation_decisions` / `llm_calls` / `intent_events`, which carry no TTL (FOLLOW-1110 / 1111 / 1112) | **Against LI**     | absent from the v1.0 table   |
| Cross-session linkage vectors | `__estalara_xid__` (Mode B only, consent-gated, currently untransmitted), `lead_id` (authenticated visitors, durable by design), network/behavioural metadata — §3.3                                                                                                 | Neutral to Against | absent from the v1.0 table   |
| Reasonable expectations       | In-session relevance expected on a search service                                                                                                                                                                                                                    | Favors LI          | Favors LI (unchanged)        |
| Opt-out availability          | SDK toggle (persistent, scope stated in §3.4) + Art. 21 DSR pathway                                                                                                                                                                                                  | Favors LI          | Favors LI (scope corrected)  |
| Inference risk                | Moderate — household/income inferences possible                                                                                                                                                                                                                      | Neutral            | Neutral (unchanged)          |
| Power imbalance               | Low — real estate search is not an essential service                                                                                                                                                                                                                 | Favors LI          | Favors LI (unchanged)        |

**Overall assessment.** On the re-derived weights the balance still favours the legitimate interest,
but it is **no longer the comfortable margin v1.0 recorded**, and it is now conditional on three
things rather than one:

1. the opt-out mechanism in Section 4 is implemented and communicated (as in v1.0);
2. the tenant discloses the client-storage keys listed in `PRIVACY_NOTICE_TEMPLATE.md` §4 — v1.0
   told tenants no local storage was written, so a tenant following it would have under-disclosed;
3. **the event-store retention rows currently marked UNENFORCED are enforced.** Two of the factors
   above rest on data ageing out. Until `adaptation_decisions`, `llm_calls` and `intent_events`
   carry TTLs (FOLLOW-1110 / 1111 / 1112) and `session_embeddings` has a working sweep
   (FOLLOW-1113), an honest completion of this template records indefinite pseudonymous retention on
   the data-subject side of the scale.

**A tenant is not obliged to reach the same conclusion.** These are Estalara's pre-filled answers
about Estalara's mechanism; the balance depends on the tenant's own purpose, visitor population and
jurisdiction, and the tenant is the controller who signs it.

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

The following answers are provided by Estalara Compliance Engineering and describe the Estalara
platform as it ships at commit `d9160da0` (2026-08-24). Each is written so that a reader can
re-check it against a named symbol rather than take it on trust; where a claim is bounded, the bound
is stated. They may be incorporated into tenant-completed LIAs without modification, subject to
verification that the tenant has not enabled any non-standard processing modes.

> **The v1.0 (2026-05-15) answers in this appendix were false and are not carried forward.** They
> described an HMAC keyed by a tenant secret and a day bucket; no such mechanism ever existed. If a
> tenant LIA on file cites §A.1 or §A.3 as of v1.0, it is citing a description of the product that
> was never true, and it should be re-run against this version.

These answers correspond to **Mode A (Session Mode, legitimate interest basis)** as defined in
Master Design section G.2. They do not apply to Mode B (Consented Mode) or Mode C (Legitimate
Interest — narrow use cases only, such as fraud detection).

### A.1 — Nature of the session identifier (Purpose Test / Necessity Test)

**Estalara sets no cookies. Estalara does write to `localStorage` and `sessionStorage`** — eleven
keys, all enumerated in `PRIVACY_NOTICE_TEMPLATE.md` §4, which the tenant must reproduce in its own
privacy policy.

The session identifier used by the Estalara SDK is a **randomly minted UUID v4**:

- Minted by `generateSessionId()` (`packages/sdk/src/core/session.ts`) from the browser's
  cryptographic random number generator — `crypto.randomUUID()` where available, and
  `crypto.getRandomValues(new Uint8Array(16))` in RFC-4122 v4 layout where it is not (a plain-HTTP
  page). If neither exists the function rejects and no identifier is minted.
- Derived from **no** input: not the device, not the browser configuration, not the visitor, not the
  tenant, not any earlier session. No digest is computed at all.
- Stored in `sessionStorage['__estalara_session__']`. `getOrCreateSession()` reads that key first
  and mints only on a miss, which is what gives the identifier stability across navigation and
  reload **within** a tab; the browser clears it when the tab closes.

Each of those three statements is pinned by a test that fails if it stops being true
(`packages/sdk/src/__tests__/session.test.ts`): _"mints 500 distinct ids in one identical
environment"_, _"never hashes anything — crypto.subtle.digest is not called"_, _"does not read
navigator.userAgent, screen or Intl"_, _"falls back to crypto.getRandomValues when randomUUID is
absent"_, _"rejects loudly rather than minting a weak or device-derived id"_.

**Consequence for the necessity test.** A random per-tab token is the minimum identifier that
supports within-session relevance: it is sufficient to associate the events of one visit, and it
carries no information beyond that. It is strictly less invasive than the alternatives — a cookie or
a persistent local-storage token would outlive the visit, and a device fingerprint would read the
visitor's terminal equipment in order to identify them. It is also less invasive than what this
product itself shipped before 2026-08-24, which was a device fingerprint.

**Relationship to ePrivacy Art. 5(3), stated without concluding it.** EDPB Guidelines 02/2023
confirm that Art. 5(3) is technology-neutral: writing to and reading from `sessionStorage` engages
it just as fingerprinting does, cookies or no cookies. Estalara's position is that Mode A is
designed around the strictly necessary exemption in Art. 5(3)(b) and that Mode B rests on explicit
consent. **Whether the 5(3)(b) exemption is in fact available for Mode A is a legal question that
Estalara has not answered and does not answer here** — it is isolated as question 4 of
`docs/compliance/FOLLOW-1105-session-identifier-assessment.md` §9, and the tenant's own counsel
should reach a view before relying on Mode A. Two facts belong in that view: the shipped SDK renders
a consent banner and awaits a decision in every mode, so consent is being obtained in practice; and
before 2026-08-24 the identifier was a persistent cross-site device digest, for which the same
question is materially harder.

### A.2 — No PII collected (Necessity Test)

Estalara does not collect, transmit, or store any of the following in connection with visitor
sessions:

- Name, email address, phone number, physical address, or government identifier
- Login credentials or authenticated identity
- Payment information
- IP address in personally identifiable form (the ingest layer processes IP for geo-routing and
  immediately discards it; no IP is stored in the event record)

Data minimization is enforced at the ingest layer. Raw behavioral events contain only: session
identifier (random UUID v4), tenant identifier, event type, listing identifier (where applicable),
timestamp, and derived signals (scroll depth, dwell time). Where the tenant has enabled the chat
widget, chat message text **is** retained in the Estalara event store for 13 months, PII-scrubbed
for email and phone patterns only — this is deliberate §H.8 design, ruled on under ESC-049
(2026-08-07), and it must be disclosed to visitors. _(Corrected v2.0: v1.0 of this template said
chat text was "not retained in raw form beyond the session". That was already contradicted by the
ESC-049 ruling recorded in the DPIA and the ROPA; it is corrected here so the three documents
agree.)_

### A.3 — Cross-site correlation: what the identifier does, and where the limit of the claim is (Balancing Test)

**What is true and checkable.** A visitor browsing Site A (Tenant 1) and Site B (Tenant 2) receives
two independently random session identifiers. They are unrelated because they are drawn
independently from a CSPRNG, not because a secret separates them — there is no per-tenant secret in
the identifier and there never was. Nothing can be recomputed from one to reach the other, by
Estalara or by anyone else. `sessionStorage` is additionally origin-partitioned by the browser, so
the two sites cannot see each other's key.

**Where the claim stops, and this is the part v1.0 got backwards.** The above is a property of the
identifier. It is **not** the assertion v1.0 made — _"cross-site correlation is architecturally
precluded"_ — and that assertion must not be restored in any form. It was inverted: from 2026-05-10
to 2026-08-24 the identifier was an unkeyed device digest, so the same visitor received the
**identical** identifier on every site running the Estalara SDK, and the correlation the sentence
called impossible was automatic. Two lessons are carried forward rather than the sentence: an
absolute architectural claim about linkage cannot be made by an identifier alone, and the vectors
that remain — `__estalara_xid__` in Mode B, `lead_id` for authenticated visitors, and network or
behavioural metadata (§3.3) — are what a balancing test actually has to weigh.

**Data written before 2026-08-24.** Event rows carrying the legacy device digest are still held, and
in those rows the cross-tenant correlation is present in the data. Their expiry is governed by the
ROPA retention schedule, three rows of which are currently **UNENFORCED** (FOLLOW-1110 / 1111 /
1112).

The global archetype space — a shared representation of buyer behavioral patterns used to bootstrap
personalization for new sessions — is **specified** to be maintained under differential privacy
protections (k≥50 minimum group size plus calibrated DP noise per NIST SP 800-226 guidance), so that
individual session contributions cannot be reverse-engineered from it.

> **Flagged, not asserted (v2.0, FOLLOW-1107).** While verifying this appendix I checked what
> actually populates `archetype_embeddings` at `d9160da0`, and it is an **idempotent seeder** over
> fixed archetype definitions (`apps/control-plane/src/lib/archetype-seeder.ts`, invoked from
> `scripts/seed-archetypes.ts`, touching only rows `WHERE embedding IS NULL`) — not a nightly
> aggregation over visitor session embeddings. I found no such aggregation job in this repository,
> and the cross-tenant differential-privacy work is recorded elsewhere as parked. **What follows
> from that is favourable to the data subject and unfavourable to this paragraph's precision:** if
> no visitor session contributes to the global archetype space, then the k-anonymity and DP controls
> are not currently protecting anything because there is nothing flowing into them to protect. This
> is outside the FOLLOW-1107 work list, is stated here rather than corrected across the corpus
> because a half-measured sweep is exactly the failure this revision exists to undo, and needs its
> own measurement ticket. **A tenant should not weigh the DP control in its balancing test until
> that measurement exists.**

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

---

## Appendix B — Platform-Wide Consent LIA: Buying-Intent Profiling (FOLLOW-373)

**Template version:** v1.1 (2026-06-21) **Applicable to:** app.estalara.com pilot (Mode B, mandatory
registration consent) **Purposes covered:** (d) Buying-intent identification, (e) Lead ranking by
buying-intent strength **DPIA cross-reference:** DPIA §13.4

This appendix documents the balancing test for purposes (d) and (e) where the lawful basis is
mandatory registration consent (GDPR Art. 6(1)(a)) supplemented by a Legitimate Interest
proportionality framework (Art. 6(1)(f)). The mandatory nature of the consent constrains its
voluntariness; this LIA provides the proportionality analysis required to ensure the processing
satisfies the data minimization and necessity principles under Art. 5(1)(b)(c).

### B.1 — Purpose Test

**Purpose (d) — Buying-intent identification:** Time2Show's commercial interest in providing a
relevant, personalized listing experience to registered investors, and in enabling agents to
understand the investor's likely purchase criteria, is a genuine and specific commercial interest.
The investor's interest in receiving relevant listings and in being understood by agents is aligned.

**Purpose (e) — Lead ranking:** The tenant agency's legitimate interest in prioritizing follow-up
with the most serious buyers is a genuine commercial purpose within real estate sales, and is within
the reasonable expectations of a registered investor on a platform that explicitly markets AI-driven
buyer matching.

**Is this purpose a legitimate interest?** Yes. CNIL June 2025 guidance confirms that commercial
interest in AI-driven content personalization can constitute a legitimate interest where the purpose
is genuine, specific, and proportionate. Identifying and ranking buyer intent in a real estate
context satisfies all three conditions.

### B.2 — Necessity Test

**Can purposes (d) and (e) be achieved without the 12-dim intent vector?** No. The intent vector is
the minimum data needed to produce a buyer-intent signal from behavioral and chat inputs without
retaining raw chat text. Alternatives assessed:

| Alternative                                    | Assessment                                                       |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| Raw chat text retention                        | Requires explicit consent + 30-day TTL (C-07). Disproportionate. |
| Session-only embeddings (no intent dimensions) | Insufficient precision for per-agent-meeting briefing            |
| Manual agent data entry                        | Defeats the automated personalization purpose                    |
| No ranking (first-come-first-served)           | Does not serve the commercial interest                           |

The 24-hour TTL for the intent vector, enforced natively by Upstash Redis (`redis_writer.py`,
`ttl_seconds=86400`), is the minimum retention consistent with within-session personalization and
the investor's reasonable expectation of continuity during an active session.

### B.3 — Balancing Test

| Factor                       | Assessment                                                                                                                                                                                                                                                                                                                                                                                                          | Weight                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Sensitivity of data          | Low to medium — buying intent dimensions, no Art. 9 categories. Household composition inference possible but not stored verbatim.                                                                                                                                                                                                                                                                                   | Neutral                         |
| Scale                        | Limited — registered investors only, not anonymous public visitors                                                                                                                                                                                                                                                                                                                                                  | Favors LI                       |
| Persistence                  | 24 h Redis TTL — **enforced** (`apps/intent-engine/src/redis_writer.py`, `ttl_seconds: int = 86400`). No cross-session persistence beyond the `session_embeddings` store, which is covered by consent and declared at 90 days — but that 90-day limit is **UNENFORCED (FOLLOW-1113)**: the nightly TTL cron it assumes is not in `apps/control-plane/vercel.json`, so rows are removed today only by a DSR erasure. | Neutral until FOLLOW-1113 lands |
| Reasonable expectations      | Investor registered on a platform that explicitly discloses AI-driven buyer matching and agent lead ranking                                                                                                                                                                                                                                                                                                         | Favors LI                       |
| Mandatory consent structure  | Consent is mandatory — voluntariness is constrained. This is the primary risk factor.                                                                                                                                                                                                                                                                                                                               | Against LI                      |
| Power imbalance              | Low — real estate platform is not an essential service; investor chose to register                                                                                                                                                                                                                                                                                                                                  | Favors LI                       |
| Art. 21 / FOLLOW-372 opt-out | FOLLOW-372 DOM toggle provides Art. 21 objection right for DOM adaptation. DSR erasure path available for full withdrawal.                                                                                                                                                                                                                                                                                          | Favors LI                       |
| Agent discretion             | Ranking is advisory; agent retains full discretion. GDPR Art. 22 not engaged.                                                                                                                                                                                                                                                                                                                                       | Favors LI                       |

**Overall assessment:** The mandatory consent structure is the primary tension point. However, the
processing is proportionate because: (a) the investor's reasonable expectation on this platform
includes AI-driven buyer matching; (b) the data is pseudonymous and has a short TTL; (c) Art. 21
objection and full erasure pathways are available; (d) the agent retains discretion over follow-up
prioritization. **Balancing test result: PASSES**, subject to the three conditions stated in DPIA
§13.4 (six-purpose disclosure at registration; accessible DSR pathway; C-07 boundary maintained).

### B.4 — C-07 Boundary Assertion

Raw chat text is not processed or stored by Adaptive-Listings. The 12-dim intent vector derived from
chat analysis is the only AL-side artifact. This boundary is verified in shipped code (see §6.2 of
Privacy Notice Template and C-07 scoping brief). Any future change to this boundary requires a new
C-08 scoping brief and explicit DPO sign-off before implementation.

---

_Appendix B added 2026-06-21 (FOLLOW-373) — Compliance Engineering._

---

## Template Revision History

| Version  | Date       | Author                 | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------- | ---------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1.0     | 2026-05-15 | Compliance Engineering | Initial per-tenant LIA template. **Superseded — do not use.** Its pre-filled answers described a session identifier that never existed in the product.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| v1.1     | 2026-06-21 | Compliance Engineering | Appendix B added (FOLLOW-373) — platform-wide consent LIA for buying-intent profiling.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **v2.0** | 2026-08-24 | Compliance Engineering | **FOLLOW-1107, after ESC-070 Path C shipped (FOLLOW-1106 / PR #844, `d9160da0`).** §2(b), §2(c), §3.1, §3.2, §3.3, §3.4, §3.6, §A.1, §A.2, §A.3 corrected against the shipped mechanism, each claim anchored to a named symbol or a named test. The two **inverted** claims — §3.6's "Persistence: None — session-scoped, HMAC rotation" and §A.3's "cross-site correlation is architecturally precluded" — are replaced by bounded statements, not softened, and §A.3 records why the absolute form must not return. The balancing test in §3.6 is **re-derived**, not edited: two new factors (event-store retention; residual cross-session linkage vectors) were added because removing the false weights would otherwise have left the test unrun, and a "was (v1.0)" column shows every weight that moved. §2(b) and §A.1 now state that `localStorage`/`sessionStorage` **are** written, reconciling this template with `PRIVACY_NOTICE_TEMPLATE.md` §4, which the two documents previously contradicted. §A.2's chat-text claim reconciled with the ESC-049 ruling. §3.4's opt-out scope corrected in both directions. Retention promises with no mechanism marked UNENFORCED (FOLLOW-1110/1111/1112/1113). No legal conclusion is drawn: the Art. 5(3)(b) question is explicitly referred to tenant counsel in §A.1. |

_Tenants holding a signed v1.0 LIA: it was completed against false pre-filled answers and should be
re-run against v2.0._
