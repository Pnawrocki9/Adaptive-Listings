# Estalara Adaptive Listings — Tenant-Embed Privacy Notice Template

**Version:** 1.9 **Date:** 2026-08-24 **Author:** Compliance Engineering **Regulatory basis:** GDPR
Art. 13/14, ePrivacy Directive Art. 5(3), UK GDPR, CCPA § 1798.100(b) **DPO gate:** See §5 — DPO
sign-off required before this template is distributed to EU tenants.

> **v1.8 (FOLLOW-1107, 2026-08-24) — §1 changed, and a tenant who already published §1 must
> republish.** From this template's creation until today, §1 told visitors their session identifier
> was "discarded when you close your browser tab or after 30 minutes of inactivity". The second
> clause was never true (no idle timer has ever existed), and the first was true only of the
> _storage_: the identifier itself was a device fingerprint that the SDK recomputed identically on
> the next visit, in the next tab, and on every other site running the Estalara SDK. **As of commit
> `d9160da0` the sentence in §1 below is true end-to-end** — the identifier is randomly minted, is
> derived from nothing about the device, lives only in that tab's `sessionStorage`, and a new visit
> begins with a new, unrelated identifier. Measurement:
> `docs/compliance/FOLLOW-1105-session-identifier-assessment.md`. Ruling: `backlog/ESCALATIONS.md`
> ESC-070. Implementation: FOLLOW-1106 / PR #844.

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

> **Implementation record for §1 (Rule N — do not delete; this is what makes the paragraph
> publishable).** Every behavioural claim in the paragraph below is checkable against a symbol in
> the shipped SDK at commit `d9160da0`:
>
> - _"generated at random … not calculated from your device"_ — `generateSessionId()` in
>   `packages/sdk/src/core/session.ts` returns `crypto.randomUUID()`, or an RFC-4122 v4 value built
>   from `crypto.getRandomValues(new Uint8Array(16))` where `randomUUID` is unavailable, and rejects
>   if neither exists. Pinned by `packages/sdk/src/__tests__/session.test.ts`: _"mints 500 distinct
>   ids in one identical environment"_, _"never hashes anything — crypto.subtle.digest is not
>   called"_, _"does not read navigator.userAgent, screen or Intl"_.
> - _"kept only in the browser tab you are using and discarded when you close that tab"_ — the value
>   is written to `sessionStorage['__estalara_session__']` (`SESSION_STORAGE_KEY`, `writeSession()`)
>   and `getOrCreateSession()` reads that key before minting. `sessionStorage` is scoped to one tab
>   and cleared by the browser on tab close. **Known browser caveat:** if a visitor's browser
>   restores a closed tab or a previous session (Ctrl+Shift+T, crash recovery, "continue where you
>   left off"), it restores that tab's `sessionStorage` too and the identifier resumes. That is
>   browser behaviour, not an Estalara store, and it is why the paragraph says "discarded when you
>   close that tab" and not "permanently destroyed".
> - _"a later visit begins with a new identifier that cannot be traced back to the earlier one"_ —
>   true of **this** identifier, because it has no derivation to reverse. It is not a claim that no
>   linkage of any kind exists: if you enable Mode B (§3) the `__estalara_xid__` identifier
>   deliberately spans visits, and a visitor logged in to your site is linked by a separate
>   account-derived key. Do not extend the §1 sentence into a general no-tracking statement.
> - **Server-side storage is a separate matter from the sentence above,** which is about the
>   identifier in the visitor's browser. Events carrying the identifier are retained by Estalara for
>   the periods in the ROPA retention schedule; §1 does not say otherwise and must not be
>   paraphrased into "your data is deleted when you close the tab".

This website uses **Estalara Adaptive Listings**, a personalization service provided by Time2Show,
Inc. (operating as Estalara), to adapt how property listings are displayed based on your browsing
behavior during your visit. Estalara captures anonymous behavioral signals — such as which listings
you view, how long you spend on each, and the search filters you apply — and uses these to reorder
and highlight listings that are likely to be more relevant to you.

Estalara does not read your name, email address, phone number, or any account credentials. Your
activity is represented by a pseudonymous session identifier. This identifier is generated at random
— it is not calculated from your device, your browser settings, or anything else about you — and it
is kept only in the browser tab you are using and discarded when you close that tab. A later visit
begins with a new identifier that cannot be traced back to the earlier one. For the legal basis and
further detail, see §2 and §3 below.

---

## 2. Consent-Denial Audit Log Disclosure (mandatory for EU/UK tenants — DPIA §13.1)

> **Source:** DPIA §13.1 LIA — Audit Finding F-13. Lawful basis: GDPR Art. 6(1)(f) (legitimate
> interest — operational accountability under Art. 5(2)). Added FOLLOW-129.

> **✅ PUBLISHABLE as of v1.9 — the DO-NOT-PUBLISH flag v1.8 raised is discharged (ESC-071 ruled,
> FOLLOW-1118 shipped).** The v1.8 flag was correct: from 2026-05-28 to 2026-08-24 the paragraph
> below promised a 7-day deletion that no mechanism performed, because the `consent.denied` audit
> event lands in ClickHouse `events` whose only TTL is 13 months. The CEO ruling of 2026-08-24
> (ESC-071) set the disclosed period to **180 days** — the data is wanted at this stage, so the
> remedy moved from the retention side to the text side — and required the mechanism to follow the
> declared value. It now does: `CONSENT_LOG_RETENTION_DAYS` in
> `packages/shared/src/consent-retention.ts` is the single declared value, the banner sentence in
> all three locales is generated from it, and the daily Vercel cron
> `GET /api/internal/retention/consent-log` deletes `consent.granted` / `consent.denied` older than
> it and nothing else. `scripts/check-consent-retention-sync.mjs` fails CI if the constant, the
> disclosure and the cron window disagree — this template is inside that sweep, so the paragraph
> below cannot drift from the banner again. _Still deliberately byte-aligned with the banner text
> (`docs/compliance/consent-disclosures.canonical.json`) rather than independently worded._

> **Tenant action —** insert this paragraph adjacent to your consent management / cookie notice
> description.

If you decline the personalization consent prompt on this website, Estalara records the fact of your
denial — a single binary signal ("consent declined") together with a pseudonymous session token — on
its servers for compliance and debugging purposes. This record allows Estalara to demonstrate to
supervisory authorities that data collection ceased upon your decision, and to detect technical
errors in the consent management system.

**The denial log is retained for a maximum of 180 days and is then permanently and automatically
deleted.** No behavioral data and no content of your browsing session is included in this record —
only the fact of the decision and the random session identifier described in §1.

This processing is carried out under the legitimate interest of accountability under GDPR Art. 5(2),
as documented in Estalara's Data Protection Impact Assessment (DPIA §13.1). You may object to this
processing by submitting a data subject request to [tenant DSR contact].

---

## 3. Cross-Session Identifier Disclosure (mandatory for EU/UK tenants in Mode B — DPIA §13.2)

> **Source:** DPIA §13.2 LIA — Audit Finding F-14. Lawful basis: GDPR Art. 6(1)(f) (legitimate
> interest — personalization continuity and conversion measurement). Balancing test GREEN on the
> disclosure and erasure limbs (FOLLOW-128 + FOLLOW-139 both shipped); qualified in DPIA v2.20
> because the identifier is not currently transmitted (FOLLOW-146). Added FOLLOW-129.

> **Tenant action —** insert this paragraph if you have enabled cross-session (Mode B) journey
> tracking in your Estalara configuration. It must also appear in the Estalara consent banner itself
> — see the coordination note below.

To remember your listing preferences across separate visits, Estalara stores a pseudonymous
identifier in your browser's local storage. This identifier is a randomly generated value — it is
not calculated from your device or your browser settings, and it contains no information about
either.

**This identifier is stored for up to 90 days. It is refreshed every 90 days and is immediately
deleted if you withdraw consent or click "Decline" on the personalization prompt.**

This processing is carried out under the legitimate interest of personalization continuity and
conversion measurement, as documented in Estalara's Data Protection Impact Assessment (DPIA §13.2).
You may object at any time by clicking "Withdraw consent" in the personalization banner, or by
submitting a data subject request to [tenant DSR contact].

> **Coordination note for §3:** The disclosure in this section must also appear in the Estalara
> consent banner visible to visitors — not only in the Privacy Policy — because the cross-session
> identifier is set on first page load before the visitor navigates to the policy. FOLLOW-128
> delivered those strings for EN, PL and ES; since ADR-0021 they are served out-of-bundle from
> `apps/control-plane/public/consent-text.json`, with the byte record held in
> `docs/compliance/consent-disclosures.canonical.json`.

> **Implementation record for §3 (Rule N), corrected v1.8 / FOLLOW-1107.** Verified at `d9160da0` in
> `packages/sdk/src/core/session.ts`:
>
> - _"a randomly generated value … not calculated from your device"_ — `getOrCreateCrossSessionId()`
>   mints via `generateUuid()`, which returns `crypto.randomUUID()` where available and an RFC-4122
>   v4 shape otherwise. No browser attribute is read.
> - _"stored for up to 90 days … refreshed every 90 days"_ —
>   `XID_TTL_MS = 90 * 24 * 60 * 60 * 1000`; a stored entry older than that is replaced with a fresh
>   UUID. The key is `XSESSION_STORAGE_KEY = '__estalara_xid__'`.
> - _"immediately deleted if you withdraw consent or click Decline"_ — `eraseCrossSessionId()`
>   (`localStorage.removeItem` plus in-memory cache clear), called on both denial paths in
>   `packages/sdk/src/index.ts` (the stored-`denied` branch of `init()` and the banner's `onDenied`
>   callback).
> - **Two claims were removed in v1.8, not softened.** _"generated from general browser
>   characteristics (such as screen settings and timezone)"_ and _"No raw browser characteristics
>   are stored on Estalara's servers — only the hashed result"_ described a mechanism that has never
>   existed: this identifier has always been a random UUID. The second sentence was also misleading
>   in a way a visitor could not detect — it implied a hash of their characteristics is held
>   server-side, when in fact **nothing** is: the identifier is not currently transmitted to
>   Estalara at all (FOLLOW-146). A tenant enabling Mode B should ask Estalara whether FOLLOW-146
>   has shipped before relying on cross-visit continuity.
> - _"unique to this website — it cannot be used to identify you across other websites"_ was also
>   removed. It is true in the sense that `localStorage` is origin-partitioned by the browser, so
>   another site cannot read this key — but as a sentence in a privacy notice it reads as a general
>   no-cross-site-tracking promise, and this corpus has already been damaged once by an absolute
>   linkage claim (see the v1.8 note in the header). Tenants who want to say something here should
>   say what the browser enforces, not what the identifier precludes.

---

## 4. Client-Storage Table — All Active Keys (mandatory disclosure for EU/UK tenants)

> **Tenant action —** include this table in your Privacy Policy under a "Cookies and local storage"
> or equivalent section. All eleven keys listed below are written by the Estalara SDK loaded on your
> website.

| Key name                                    | Storage type   | Data stored                                                                                                | Lifetime                                                                                                                      | Consent required                                                  | Purpose                                                                                                                             |
| ------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `__estalara_session__`                      | sessionStorage | Session ID (pseudonymous **random UUID v4** — no device input; see §1), session start time, page count     | Tab lifetime (cleared on tab close)                                                                                           | No (Mode A)                                                       | Session continuity within a single browser tab                                                                                      |
| `estalara_consent`                          | localStorage   | Consent decision: `"granted"` or `"denied"`                                                                | Persistent (survives tab close); overwritten on re-choice                                                                     | No                                                                | Remember consent decision to avoid re-prompting                                                                                     |
| `__estalara_xid__`                          | localStorage   | Cross-session pseudonymous identifier (UUID v4 + creation timestamp)                                       | Up to 90 days; erased on consent denial/withdrawal                                                                            | Yes (Mode B)                                                      | Personalization continuity across separate visits (DPIA §13.2)                                                                      |
| `__estalara_lead_id__`                      | sessionStorage | Derived pseudonymous lead ID (first 16 hex chars of SHA-256 of Keycloak user UUID)                         | Tab lifetime                                                                                                                  | Yes                                                               | Link authenticated buyer sessions to behavioral profile without storing raw user ID                                                 |
| `estalara_intent_{sessionId}`               | sessionStorage | Inferred archetype label + per-archetype probability vector (profiling-adjacent)                           | Tab lifetime; max 30 minutes since last write (`INTENT_STATE_STALE_MS`); erased on consent denial/withdrawal                  | Yes (Mode B)                                                      | Session-level archetype continuity: avoids re-computing intent on every page navigation within a tab (DPIA §13.3)                   |
| `estalara_resolved_archetype_{sessionId}`   | sessionStorage | Resolved source-of-truth archetype label (the most recent non-neutral archetype)                           | Tab lifetime; erased on consent denial/withdrawal (alongside `estalara_intent_*`)                                             | Yes (Mode B)                                                      | Keeps adaptation stable across listings: restores the resolved archetype when behavioral drift decays it to neutral (ADR-0014)      |
| `estalara_variant:{sessionId}`              | sessionStorage | A/B variant assignment string for the current session (e.g., `"variant_0"`)                                | Tab lifetime (sessionStorage cleared on tab close); no cross-session persistence                                              | No                                                                | Ensure consistent A/B variant within a tab so feedback pings match the served variant (`SESSION_VARIANT_KEY_PREFIX`, `adapt.ts`)    |
| `__estalara_quiz_dismissed__`               | localStorage   | Unix timestamp (ms) of the last quiz dismissal                                                             | 24 hours from dismissal (self-expires by TTL check; not erased on consent denial)                                             | No                                                                | User preference: suppress the intent-quiz prompt for 24 hours after dismissal to avoid re-prompting                                 |
| `__estalara_quiz_completed__`               | sessionStorage | Flag `"1"` set after the buyer completes the intent quiz this session                                      | Tab lifetime (sessionStorage; cleared on tab close); not erased on consent denial                                             | No                                                                | User preference: suppress the intent-quiz prompt for the rest of the session after completion (lockstep with the session archetype) |
| `__estalara_micro_poll_dismissed__`         | localStorage   | Unix timestamp (ms) of the last micro-poll dismissal                                                       | 24 hours from dismissal (self-expires by TTL check; not erased on consent denial)                                             | No                                                                | User preference: suppress the micro-poll bottom-toast for 24 hours after dismissal to avoid re-prompting                            |
| `__estalara_profiling_opt_out__[:{userId}]` | localStorage   | Flag `"true"` when the visitor has opted out of AL DOM adaptation via the per-user profiling toggle (§H.9) | Persistent (survives tab close) until the visitor opts back in (key removed) or consent is denied/withdrawn (erased) — no TTL | Yes (Mode B; only rendered after registration consent is granted) | Persist the visitor's reversible opt-out choice for AL DOM adaptation across page loads (FOLLOW-372 / §H.9)                         |

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
>   timestamp. Sources: `DISMISS_STORAGE_KEY` in `packages/sdk/src/ui/quiz-session-state.ts`;
>   `MICRO_POLL_DISMISS_KEY` in `packages/sdk/src/ui/micro-poll.ts`.
> - `__estalara_profiling_opt_out__` (optionally suffixed `:{userId}` when a Keycloak-derived lead
>   ID is present — see `__estalara_lead_id__` above) is written by
>   `packages/sdk/src/core/profiling-opt-out.ts` `setProfilingOptOut()`
>   (`PROFILING_OPT_OUT_KEY = '__estalara_profiling_opt_out__'`, line 30) and read by
>   `isProfilingOptedOut()`. The value is set to `"true"` on opt-out and the key is `removeItem`'d
>   (not merely overwritten) on opt-in. It is erased on consent denial/withdrawal by
>   `eraseProfilingOptOut()`, called from `packages/sdk/src/index.ts` at both the pre-consent denial
>   branch (`init()`, "denied" state) and the in-banner "Decline" callback — grep-verified
>   2026-07-25 (FOLLOW-653). The visitor-facing toggle that writes this key
>   (`packages/sdk/src/ui/profiling-toggle.ts` `renderProfilingToggle()`) is unconditionally mounted
>   once the Shadow DOM host exists post-consent (`index.ts` step 5b) — it is NOT gated behind any
>   additional feature flag. **This key was previously omitted from this table** (FOLLOW-653 gap
>   finding): it does not match the `_STORAGE_KEY` / `_KEY_PREFIX` / `_DISMISS_KEY` naming patterns
>   the `privacy-notice-keys-sync` CI gate (`scripts/check-privacy-notice-keys.sh`, FOLLOW-230)
>   scans for, so the gate did not catch the omission. See
>   `docs/compliance/EXTERNAL_BRAND_GOLIVE_CHECK-2026-07.md` Axis 1 and the PROPOSED STUBS section
>   for the tracked gate-coverage follow-up.

---

## 5. DPO Gate — Pre-Distribution Checklist

> **Status: PENDING.** This template must not be distributed to EU tenants or published on
> app.estalara.com until the DPO gate below is closed.

| Gate item                                                                                                                                                                                                                                                                                          | Owner                        | Status              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------- |
| DPO review of DPIA §13.1 LIA (consent-denial audit log)                                                                                                                                                                                                                                            | Compliance Engineering       | PENDING             |
| DPO review of DPIA §13.2 LIA (cross-session identifier)                                                                                                                                                                                                                                            | Compliance Engineering       | PENDING             |
| DPO sign-off recorded in DPIA (replace PENDING note in §13.1/§13.2/§13.3/§13.4/§13.5 gates)                                                                                                                                                                                                        | DPO-as-a-Service provider    | PENDING             |
| FOLLOW-128 deployed to production (§13.2 banner disclosure live for EN/PL/ES)                                                                                                                                                                                                                      | SDK Engineer                 | PENDING             |
| §13.2 staging localStorage QA: "Deny"/"Withdraw" removes cross-session key                                                                                                                                                                                                                         | Compliance Engineering       | PENDING             |
| DPO review of DPIA §13.3 (intent-state sessionStorage store)                                                                                                                                                                                                                                       | Compliance Engineering       | PENDING             |
| §13.3 staging sessionStorage QA: "Deny"/"Withdraw" removes `estalara_intent_*` key                                                                                                                                                                                                                 | Compliance Engineering       | PENDING             |
| DPO review of DPIA §13.4 LIA (buying-intent + lead ranking, FOLLOW-373)                                                                                                                                                                                                                            | Compliance Engineering       | PENDING             |
| DPO review of DPIA §13.5 (FOLLOW-372 suspend-not-erase addendum)                                                                                                                                                                                                                                   | Compliance Engineering       | PENDING             |
| §6 registration consent text reviewed by DPO before go-live on app.estalara.com                                                                                                                                                                                                                    | Compliance Engineering       | PENDING             |
| Rafał implements app-side chat text retention per HANDOFF (backlog/HANDOFFS.md FOLLOW-373)                                                                                                                                                                                                         | Rafał Palak (CTO)            | PENDING             |
| Tenant DPA updated to reference this template version                                                                                                                                                                                                                                              | Legal / Compliance Eng.      | PENDING             |
| **DPO re-review of DPIA §2.2.1, §13.1 and §13.2 as revised by FOLLOW-1107 (v2.20)** — the session-identifier description, the Risk A/D/E rewrites and the two withdrawn legal conclusions post-date any earlier review                                                                             | Compliance Engineering       | PENDING             |
| **DPO re-review of `lia-template.md` v2.0** — the balancing test was re-derived, not edited; any tenant LIA signed against v1.0 rests on false pre-filled answers                                                                                                                                  | Compliance Engineering       | PENDING             |
| **ESC-071 resolved** — §2's denial-log retention was UNENFORCED (FOLLOW-140). Ruled by the CEO 2026-08-24 (180 days) and enforced by FOLLOW-1118: the disclosure is generated from `CONSENT_LOG_RETENTION_DAYS` and a daily cron deletes to the same value. §2's DO-NOT-PUBLISH flag is discharged | Compliance Engineering + CEO | RESOLVED 2026-08-24 |
| **Retention rows marked UNENFORCED are enforced** — FOLLOW-1110 (`adaptation_decisions`), FOLLOW-1111 (`llm_calls`), FOLLOW-1112 (`intent_events`), FOLLOW-1113 (`session_embeddings`); §1's promise about the browser-side identifier is unaffected, but the ROPA periods a tenant reproduces are | Data Engineering             | PENDING             |

Once all gate items above are DONE, update this table, record the DPO sign-off date, and update the
DPO gate notes in `docs/compliance/dpia.md` §13.1, §13.2, §13.3, §13.4, and §13.5.

**Responsible escalation path:** If DPO sign-off is not received within 5 business days of this
template being shared with the DPO, escalate to the human (Piotr Nawrocki) via
`backlog/ESCALATIONS.md`.

---

## 6. Platform-Wide Registration Consent — app.estalara.com Disclosure

> **Scope:** This section applies to **app.estalara.com** specifically, where consent is mandatory
> at investor registration (CEO decision 2026-06-21, FOLLOW-373). Sections §§1–4 cover the
> tenant-embed disclosure surface. This section covers the app.estalara.com registration consent
> surface.

> **DPO gate:** DPO review required before this text goes live on app.estalara.com. Status: PENDING
> (see §5 above).

> **Implementation note for Rafał (CTO):** The registration checkbox on app.estalara.com must
> present the disclosure in §6.1 before the investor creates their account. Store a
> `consent_records` row with `consent_type = 'platform_registration'`, `granted = true`,
> `tos_version`, and `consent_text_hash` (SHA-256 of the displayed text) at submission time. No DB
> migration is needed — `consent_type` is a free-text column in the existing schema.

### 6.1 Registration Consent Disclosure Text (English — mandatory)

> **Action:** Display this text (or an equivalent translation) above the consent checkbox at
> registration. The checkbox must not be pre-ticked (GDPR Art. 7(2)).

> **Canonical bytes — ruling, FOLLOW-705 (2026-07-28).** The byte-canonical artifact for
> `consent_records.consent_text_hash` is **the string returned by `renderPlatformConsentText()`**
> (`apps/control-plane/src/app/api/v1/consent/platform-registration/lib.ts`), served as
> `consent_text` by `GET /api/v1/consent/platform-registration`. That is the exact string the data
> subject reads before clicking "I agree", and it is the only artifact that exists for a white-label
> brand (this section is written for the Estalara identity only). The block below is the **published
> rendering of those same bytes for the Estalara identity**; it MUST reduce to them byte-for-byte
> under the normalization in §6.1.1. The `consent-text-sync` CI gate
> (`scripts/check-consent-text-sync.mjs`) enforces that equality on every push, so the two cannot
> drift silently. Do not reintroduce `[bracket]` template slots in the block below: the served text
> contains none, so a bracket here would make the published text differ from what was displayed.

<!-- BEGIN CANONICAL CONSENT TEXT platform-v1.4-2026-08-07 -->

By creating an account and clicking "I agree", you consent to the Estalara Adaptive Listings service
(provided by Time2Show, Inc.) processing your information for the following purposes:

1. **Behavioral tracking** — We analyze how you browse listings (scroll depth, time spent, clicks,
   and searches) to personalize the listings shown to you.

2. **Chat analysis and message storage** — Your messages in the Estalara AI chat are analyzed in
   real time to understand your buying intent (e.g., budget, urgency, preferred location). We
   extract a structured summary of your intent, which we hold for 24 hours, and we also store the
   text of the messages themselves for 13 months. Email addresses and phone numbers are
   automatically masked before that text is stored; anything else you type — including names and
   financial or family details — is stored as you wrote it. Please do not type information into chat
   that you would not want stored.

3. **Transfer to agency/agent** — Your inferred buyer profile (archetype, buying-intent score) is
   shared with the real estate agency or agent you interact with on this platform.

4. **Buying-intent identification** — We build a 12-dimensional profile of your buying intent from
   your behavioral and chat signals. This profile is held for up to 24 hours in our personalization
   system.

5. **Lead ranking** — You may be ranked alongside other investors by buying-intent strength. Agents
   use this ranking to prioritize follow-up. This ranking is advisory — the agent retains full
   discretion.

6. **Chat-question summaries** — A summary of questions you have asked in LIVE chat and in the
   Estalara AI chat may be shown to the agency's staff to help them prepare for a conversation with
   you.

**This consent is required to use the platform.** Without granting it, you cannot create an account
or access chat features.

**Your rights:** You can withdraw this consent at any time by emailing compliance@estalara.com, a
monitored mailbox for privacy requests; you can also contact the agency directly. Withdrawal stops
new personalization processing. A data erasure request will result in deletion of your behavioral
data from Estalara's systems within 30 days. Withdrawal does not affect the lawfulness of processing
before withdrawal.

For full details, see the agency privacy policy. The Adaptive Listings technology described above is
operated by Estalara (Time2Show, Inc.), which processes your data for Estalara as a processor;
compliance@estalara.com is Estalara's address and reaches Estalara's privacy team.

<!-- END CANONICAL CONSENT TEXT platform-v1.4-2026-08-07 -->

> **RESOLVED 2026-08-07 (FOLLOW-815, implementing the FOLLOW-814 CEO+DPO ruling) — the
> disclosure-quality finding recorded here since FOLLOW-705 is closed by the v1.4 text above.** The
> finding was: the text served to investors from 2026-06-21 to the v1.4 deploy named **no concrete
> withdrawal address** — "the agency's DSR contact" is not actionable on its own, and
> `compliance@estalara.com` appeared only as a documentation contact (GDPR Art. 7(3) requires
> withdrawal to be as easy as giving consent; Art. 13(1)(a)–(b) requires contact details). The
> ruling chose option (a) of FOLLOW-710: **name a concrete monitored DSR mailbox in the text and
> stand it up.** The mailbox is `compliance@estalara.com`, the same address `ropa.md` §Controller
> already records as the DPO contact — chosen over standing up a new address so that exactly one
> privacy mailbox exists for the platform. **Operator obligation, not enforceable in code: that
> mailbox must actually be monitored, and withdrawal requests arriving on it must be actioned within
> the §8 SLA.** The second half of the same bump replaced the closing paragraph, which had presented
> an Estalara mailbox as _"{Brand}'s privacy documentation"_ for every white-label brand
> (FOLLOW-711); it now names Estalara / Time2Show, Inc. as the processor and the address as
> Estalara's own. A per-brand contact rendered from `brand_config` was the considered alternative
> and was **explicitly declined by the CEO** (FOLLOW-814 item 3) — revisit at the first external
> brand.

> **Known cosmetic artefact of the processor sentence, recorded rather than hidden.** For the
> FIRST-PARTY identity the closing paragraph renders as _"…operated by Estalara (Time2Show, Inc.),
> which processes your data for Estalara as a processor…"_ — true, but redundant, because the brand
> and the processor are the same company in the single-tenant deployment. Removing the redundancy
> requires either brand-parameterising the sentence (declined above) or two texts (two hashes, two
> TOS versions). Accepted as-is; re-read at the first external brand, when the sentence starts
> carrying its full weight.

### 6.1.1 Hashable-block normalization (executable specification — FOLLOW-705)

This specification exists so that any reader can reproduce the canonical hash without guessing. The
prior wording ("the exact text block starting at 'By creating an account…' through
'…compliance@estalara.com.' with trailing newline stripped") was not sufficient — it named neither
the markdown stripping nor the hard-wrap treatment, and that ambiguity is how the placeholder
`CANONICAL_CONSENT_TEXT_HASH` defect (FOLLOW-704) survived unnoticed for over a month.

**Canonical text `C(brand)`** — the return value of
`renderPlatformConsentText({ brandName, legalEntity })`. Its invariants: UTF-8; LF line endings
only; no leading or trailing whitespace and **no trailing newline**; paragraphs separated by exactly
one blank line (`\n\n`); each paragraph is a single physical line of unbounded length (no hard
wrap); no markdown emphasis markers.

**Canonical hash** — `SHA-256(C(brand))`, lowercase hex, over the UTF-8 bytes of `C(brand)` with
nothing appended (no `\n`, no `\r\n`).

**Normalization `N(block)`** mapping the published block above onto `C(Estalara)`:

| Step | Rule                                                                                                                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1   | Take the bytes strictly between the `<!-- BEGIN CANONICAL CONSENT TEXT … -->` and `<!-- END CANONICAL CONSENT TEXT … -->` lines, excluding both sentinel lines.                                                           |
| N2   | Decode as UTF-8. A CR (`\r`), a tab, or a `[` character anywhere in the block is a hard error, not something to normalize away.                                                                                           |
| N3   | Strip leading and trailing whitespace from the whole block.                                                                                                                                                               |
| N4   | Split into paragraphs on one or more blank lines (regex `/\n[ \t]*\n+/`).                                                                                                                                                 |
| N5   | Within each paragraph, strip leading and trailing whitespace from every physical line and join the lines with a single space (U+0020). This undoes the 100-column prettier wrap and the 3-space list-continuation indent. |
| N6   | Delete every occurrence of `**` (markdown strong). No other inline markdown is permitted inside the block.                                                                                                                |
| N7   | Join the paragraphs with exactly one blank line (`\n\n`).                                                                                                                                                                 |
| N8   | Emit with no trailing newline.                                                                                                                                                                                            |

**Assertion:**
`N(block) === renderPlatformConsentText({ brandName: 'Estalara', legalEntity: 'Time2Show, Inc.' })`,
byte-for-byte. Enforced by `node scripts/check-consent-text-sync.mjs` (CI job `consent-text-sync`,
hard gate).

**Reproducing the hash from a shell** (this command is verified to work, unlike the
`echo -n "<exact text>"` instruction it replaces):

```bash
node scripts/check-consent-text-sync.mjs --print-text | sha256sum   # → the canonical hash
node scripts/check-consent-text-sync.mjs --print-hash               # same value, computed in-process
```

> **Note (FOLLOW-704 → CLOSED by FOLLOW-815, 2026-08-07):** `CANONICAL_CONSENT_TEXT_HASH` in
> `lib.ts` now **equals this hash by construction** — it is declared as
> `computeConsentTextHash(renderPlatformConsentText(FIRST_PARTY_BRAND_IDENTITY))`, i.e. the same
> expression this section specifies, so the two cannot disagree. From 2026-06-21 to that change it
> was a hand-typed literal that was the SHA-256 of no text at all. Two mechanisms keep the
> derivation honest: the `consent-text-sync` gate refuses a constant that has been turned back into
> a literal, and a route unit test recomputes the hash through the real renderer and compares.
>
> **Verifying a row written under an OLDER `tos_version`:** check the repo out at a commit where
> `PLATFORM_REGISTRATION_TOS_VERSION` equals that row's `tos_version`, then run the `--print-hash`
> command above. There is deliberately no `tos_version → hash` map: for `platform-v1.3-2026-06-21`
> the default-path value written was the placeholder, so those rows correspond to no text and are
> not verifiable against one (that population is FOLLOW-706's remediation scope).

### 6.2 C-07 Boundary Confirmation (operator-facing — not shown to investors)

> **⚠️ CORRECTED 2026-08-07 (FOLLOW-866 / ESC-049 addendum, ridden by FOLLOW-815). The paragraph
> below was materially false and is retained only in corrected form.** It asserted that raw chat
> text is stored app-side ONLY and that Adaptive-Listings stores nothing but the 12-dim vector.
> **Adaptive-Listings DOES store buyer chat message text**: `chat.message.sent.payload.message`
> (≤4000 chars) is written verbatim into the ClickHouse `events` table by deliberate §H.8 design and
> retained for **13 months** (`infra/clickhouse/migrations/0001_create_events.sql` TTL). The PII
> scrubber masks **email addresses and phone numbers only** — names, financial detail and family
> composition pass through. This is now disclosed to data subjects in §6.1 purpose 2 above. Lawful
> basis remains **legitimate interest with full transparency**; **no new consent checkbox** was
> added (CEO+DPO ruling, `ESCALATIONS.md` → ESC-049 addendum Q1/Q3). Authoritative facts and the
> full three-store verification: `docs/compliance/C-07-chat-retention-scope.md` **v1.3** — read
> that, not this summary, and do not let the two drift.

The claim below is **true of Redis and Postgres only**, which is the narrower boundary that actually
holds: no raw chat text reaches the Upstash Redis shadow key or any Postgres table. Code-verified:
`schemas.py` (class `ChatIntentDetectedPayload`) has no `messages` or `raw_text` field;
`redis_writer.py` — `payload.model_dump()` serializes only the structured payload. The
12-dimensional intent vector with a 24-hour TTL is what the PERSONALIZATION path holds; the
ClickHouse `events` retention above is a separate, additional store on the ingest path. Since
FOLLOW-730 that payload also carries two diagnostic fields, `data_source` and `extraction_error`,
which record WHY an extraction produced its result (a fixed enum plus an exception CLASS name —
never the exception message, and never buyer content). See
`docs/compliance/C-07-chat-retention-scope.md`.

App-side chat text retention and deletion windows are specified in `backlog/HANDOFFS.md` FOLLOW-373
HANDOFF to Rafał Palak, CTO.

### 6.3 Per-User DOM Adaptation Opt-Out Disclosure (FOLLOW-372)

The Estalara SDK provides a per-user toggle to suspend DOM adaptation (headline reordering, photo
order, feature highlights) without withdrawing the registration consent. The toggle:

- Does NOT affect buying-intent identification (purpose 4), lead ranking (purpose 5), or agent chat
  summaries (purpose 6) — those ride the registration consent.
- Is reversible: suspending preserves the accumulated profile; re-enabling resumes full
  personalization with no data loss.
- Satisfies the GDPR Art. 21 right to object to legitimate-interest DOM adaptation processing.

---

## 7. Revision History

| Version | Date       | Author                 | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------- | ---------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 2026-05-27 | Compliance Engineering | Initial creation (FOLLOW-129). §13.1 + §13.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
|         |            |                        | disclosure paragraphs from DPIA Audit F-13/F-14                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 1.1     | 2026-06-08 | Compliance Engineering | FOLLOW-218: added §4 client-storage table listing all five active SDK keys including the new `estalara_intent_{sessionId}` sessionStorage entry. Renumbered old §4 (DPO Gate) to §5; old §5 (Revision History) to §6. DPO gate updated to add §13.3 review item and §13.3 staging QA gate item.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 1.2     | 2026-06-08 | Compliance Engineering | FOLLOW-230: §4 updated to list all eight active SDK keys. Added three keys omitted from v1.1: `estalara_variant:{sessionId}` (sessionStorage, A/B variant, strictly-necessary), `__estalara_quiz_dismissed__` (localStorage, preference timestamp, strictly-necessary), `__estalara_micro_poll_dismissed__` (localStorage, preference timestamp, strictly-necessary). Updated header from "all five" to "all eight". Added per-key implementation notes with grep-verified source references.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 1.4     | 2026-06-22 | Compliance Engineering | FOLLOW-375: §4 updated to list all ten active SDK keys. Added `__estalara_quiz_completed__` (sessionStorage, session-scoped quiz-completion suppression flag, strictly-necessary — Rule N) and `estalara_resolved_archetype_{sessionId}` (sessionStorage, resolved source-of-truth archetype, Mode B, erased on consent denial — ADR-0014). Updated header from "all eight" to "all ten".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 1.5     | 2026-07-25 | Compliance Engineering | FOLLOW-653 (external-brand go-live technical check): §4 updated to list all eleven active SDK keys. Added `__estalara_profiling_opt_out__[:{userId}]` (localStorage, per-user AL DOM-adaptation opt-out flag, Mode B, erased on consent denial/withdrawal — FOLLOW-372/§H.9), a key that shipped in PR #337 (2026-06-21) but was never added to this table — the `privacy-notice-keys-sync` CI gate does not scan for `_OPT_OUT_KEY`-suffixed constants, so the gap went undetected until this grep-verified audit. Updated header from "all ten" to "all eleven".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 1.7     | 2026-08-07 | Compliance Engineering | FOLLOW-815 (implementing the FOLLOW-814 CEO+DPO ruling of 2026-08-07, discharging FOLLOW-704 / FOLLOW-710 / FOLLOW-711): §6.1 consent text bumped `platform-v1.3-2026-06-21` → `platform-v1.4-2026-08-07`. **Disclosed meaning CHANGED in two places, so this IS a re-consent boundary** (unlike v1.6, which was meaning-preserving): (1) Art. 7(3) withdrawal channel is now the concrete monitored mailbox `compliance@estalara.com` instead of the un-actionable "the agency's DSR contact"; (2) the closing paragraph names Estalara / Time2Show, Inc. as the **processor** operating the service for the brand, replacing wording that presented an Estalara mailbox as the client brand's own documentation contact. Both sentinels bumped. `CANONICAL_CONSENT_TEXT_HASH` is no longer a hand-typed literal — it is derived from `renderPlatformConsentText()`, closing FOLLOW-704. §6.1's open disclosure-quality finding marked RESOLVED; §6.1.1's FOLLOW-704 note replaced with the per-`tos_version` verification procedure. **Third change, ESC-049 addendum (CEO+DPO, same date, riding this SAME single bump — no second bump spent):** §6.1 purpose 2 renamed "Chat analysis" → "Chat analysis and message storage" and now DISCLOSES that buyer chat message text is stored for 13 months with email addresses and phone numbers masked. The prior wording — "we do not store the full text of your messages in our personalization system" — was **false to data subjects**: `chat.message.sent.payload.message` is written verbatim to the ClickHouse `events` table by §H.8 design (FOLLOW-866; facts in `C-07-chat-retention-scope.md` v1.3, merged as PR #687). Lawful basis stays **legitimate interest with full transparency**; **no new consent checkbox** (ESC-049 addendum Q1/Q3). The same correction was applied to the two byte-synced surfaces, `packages/sdk/src/ui/consent-banner.ts` (EN/PL/ES) and `platform-registration/lib.ts`, and to §6.2, whose C-07 boundary paragraph asserted the same false claim. DPO gate for §6.1 remains PENDING (§5).   |
| 1.6     | 2026-07-28 | Compliance Engineering | FOLLOW-705: §6.1 made byte-conformant with the server-side renderer, which this ticket rules the byte-canonical artifact for `consent_records.consent_text_hash`. Substituted the two unfilled editorial slots `[agency DSR contact]` → "the agency's DSR contact" and `[agency privacy policy]` → "the agency privacy policy" (the prose the renderer has served since 2026-06-21 — the published doc, not the served text, was the divergent artifact). Added BEGIN/END sentinels around the hashable block and §6.1.1, an executable normalization spec, enforced by the new `consent-text-sync` CI gate. **No change to disclosed meaning** (no purpose, recipient, retention period, right or lawful basis differs) → `PLATFORM_REGISTRATION_TOS_VERSION` deliberately NOT bumped, and no re-consent is required.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 1.3     | 2026-06-21 | Compliance Engineering | FOLLOW-373: §6 added — Platform-Wide Registration Consent disclosure for app.estalara.com pilot. Covers six purposes (a)–(f) with investor-facing EN text (§6.1), C-07 boundary confirmation (§6.2), and DOM opt-out disclosure (§6.3). DPO gate updated: four new gate items. Old §6 Revision History renumbered to §7. Template version bumped to 1.3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 1.8     | 2026-08-24 | Compliance Engineering | **FOLLOW-1107, after ESC-070 Path C shipped (FOLLOW-1106 / PR #844, `d9160da0`).** **§1 corrected — this is the one user-facing sentence in the compliance corpus and it was false for three months.** It promised an identifier "discarded when you close your browser tab or after 30 minutes of inactivity"; there has never been an idle timer, and the identifier was a device fingerprint the SDK recomputed identically on the next visit and on every other site running it. The paragraph now states what ships: randomly generated, not calculated from the device, kept in that tab only, a new visit begins with a new unrelated identifier — each clause backed by a symbol and a test in the new §1 implementation record. **§2 flagged DO-NOT-PUBLISH:** its 7-day denial-log retention has no enforcing mechanism (FOLLOW-140) and, unlike §1, that promise is ALREADY being made to visitors by the shipped banner in three locales — escalated as ESC-071; the paragraph is deliberately left byte-aligned with the banner rather than softened. Two unverifiable clauses removed from it ("device fingerprint", "rotates on every new browser session"). **§3 corrected:** `__estalara_xid__` was described as "generated from general browser characteristics (such as screen settings and timezone)" with "only the hashed result" stored on Estalara's servers. It has always been a random UUID, and nothing is stored server-side because it is never transmitted (FOLLOW-146). The absolute "cannot be used to identify you across other websites" is removed rather than restated. **§4:** the `__estalara_session__` row's data description corrected from "pseudonymous SHA-256 hash" to "random UUID v4"; all eleven key names unchanged, so the `privacy-notice-keys-sync` gate is unaffected. **§5 DPO gate** gains four rows (DPIA re-review, LIA v2.0 re-review, ESC-071, retention TTLs). **§6.1 untouched** — it is byte-locked to `renderPlatformConsentText()` by `scripts/check-consent-text-sync.mjs` and carries no session-identifier sentence. |
| 1.9     | 2026-08-24 | Backend Engineering    | **FOLLOW-1118 / ESC-071 — §2 corrected to 180 days and its DO-NOT-PUBLISH flag discharged.** v1.8 flagged §2 because the 7-day denial-log retention it promised had no enforcing mechanism and was already being told to visitors in three locales. Ruled by the CEO on 2026-08-24: the disclosed period becomes **180 days** and the mechanism is built to follow the declared value. §2's retention sentence now reads 180 days, byte-aligned as before with the banner text — which is itself no longer hand-written but generated from `CONSENT_LOG_RETENTION_DAYS` (`packages/shared/src/consent-retention.ts`), the same constant the new daily `internal/retention/consent-log` cron deletes by. §2's warning box is rewritten to record what was false, for how long, and what now enforces it. §5's ESC-071 DPO-gate row moves PENDING → RESOLVED. Nothing else in this template changes: §1, §3, §4 and the CI-synced §6.1 are untouched, and all eleven storage-key names are unchanged so the `privacy-notice-keys-sync` gate is unaffected. A tenant who already published §2 should republish it — the figure told to visitors has changed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
