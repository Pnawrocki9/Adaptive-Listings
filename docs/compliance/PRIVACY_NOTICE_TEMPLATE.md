# Estalara Adaptive Listings — Tenant-Embed Privacy Notice Template

**Version:** 1.6 **Date:** 2026-07-28 **Author:** Compliance Engineering **Regulatory basis:** GDPR
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
> or equivalent section. All eleven keys listed below are written by the Estalara SDK loaded on your
> website.

| Key name                                    | Storage type   | Data stored                                                                                                | Lifetime                                                                                                                      | Consent required                                                  | Purpose                                                                                                                             |
| ------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `__estalara_session__`                      | sessionStorage | Session ID (pseudonymous SHA-256 hash), session start time, page count                                     | Tab lifetime (cleared on tab close)                                                                                           | No (Mode A)                                                       | Session continuity within a single browser tab                                                                                      |
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
>   timestamp. Sources: `DISMISS_STORAGE_KEY` in `packages/sdk/src/ui/quiz-trigger.ts`;
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

| Gate item                                                                                   | Owner                     | Status  |
| ------------------------------------------------------------------------------------------- | ------------------------- | ------- |
| DPO review of DPIA §13.1 LIA (consent-denial audit log)                                     | Compliance Engineering    | PENDING |
| DPO review of DPIA §13.2 LIA (cross-session identifier)                                     | Compliance Engineering    | PENDING |
| DPO sign-off recorded in DPIA (replace PENDING note in §13.1/§13.2/§13.3/§13.4/§13.5 gates) | DPO-as-a-Service provider | PENDING |
| FOLLOW-128 deployed to production (§13.2 banner disclosure live for EN/PL/ES)               | SDK Engineer              | PENDING |
| §13.2 staging localStorage QA: "Deny"/"Withdraw" removes cross-session key                  | Compliance Engineering    | PENDING |
| DPO review of DPIA §13.3 (intent-state sessionStorage store)                                | Compliance Engineering    | PENDING |
| §13.3 staging sessionStorage QA: "Deny"/"Withdraw" removes `estalara_intent_*` key          | Compliance Engineering    | PENDING |
| DPO review of DPIA §13.4 LIA (buying-intent + lead ranking, FOLLOW-373)                     | Compliance Engineering    | PENDING |
| DPO review of DPIA §13.5 (FOLLOW-372 suspend-not-erase addendum)                            | Compliance Engineering    | PENDING |
| §6 registration consent text reviewed by DPO before go-live on app.estalara.com             | Compliance Engineering    | PENDING |
| Rafał implements app-side chat text retention per HANDOFF (backlog/HANDOFFS.md FOLLOW-373)  | Rafał Palak (CTO)         | PENDING |
| Tenant DPA updated to reference this template version                                       | Legal / Compliance Eng.   | PENDING |

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

<!-- BEGIN CANONICAL CONSENT TEXT platform-v1.3-2026-06-21 -->

By creating an account and clicking "I agree", you consent to the Estalara Adaptive Listings service
(provided by Time2Show, Inc.) processing your information for the following purposes:

1. **Behavioral tracking** — We analyze how you browse listings (scroll depth, time spent, clicks,
   and searches) to personalize the listings shown to you.

2. **Chat analysis** — Your messages in the Estalara AI chat are analyzed in real time to understand
   your buying intent (e.g., budget, urgency, preferred location). We extract a structured summary
   of your intent — we do not store the full text of your messages in our personalization system.

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

**Your rights:** You can withdraw this consent at any time by contacting the agency's DSR contact.
Withdrawal stops new personalization processing. A data erasure request will result in deletion of
your behavioral data from Estalara's systems within 30 days. Withdrawal does not affect the
lawfulness of processing before withdrawal.

For full details, see the agency privacy policy and Estalara's privacy documentation at
compliance@estalara.com.

<!-- END CANONICAL CONSENT TEXT platform-v1.3-2026-06-21 -->

> **Open disclosure-quality finding, carried forward from the removed `[agency DSR contact]` slot
> (FOLLOW-705, not fixed here).** The bracket removed above was an unfilled editorial slot; deleting
> it aligns the doc with the served text but also removes the only visible signal that the
> withdrawal channel is unresolved. Recording it here so the signal survives: **the text served to
> investors since 2026-06-21 names no concrete DSR address** — "the agency's DSR contact" is not
> actionable on its own, and `compliance@estalara.com` appears only as a documentation contact, not
> as the stated withdrawal channel. GDPR Art. 7(3) requires withdrawal to be as easy as giving
> consent, and Art. 13(1)(a)–(b) requires contact details. Resolving this **changes the disclosed
> meaning**, so it requires a `PLATFORM_REGISTRATION_TOS_VERSION` bump, a new sentinel version, a
> re-pinned `CANONICAL_CONSENT_TEXT_HASH` and DPO review — deliberately out of scope for FOLLOW-705,
> which is a meaning-preserving reconciliation. Escalated to the PM in the FOLLOW-705 PR.

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

> **Note (FOLLOW-704, open):** the `CANONICAL_CONSENT_TEXT_HASH` constant in `lib.ts` does **not**
> currently equal this hash — it is a hand-typed placeholder. Pinning it is FOLLOW-704's scope, not
> this section's; this section only fixes _which bytes_ it must be pinned to.

### 6.2 C-07 Boundary Confirmation (operator-facing — not shown to investors)

Raw chat text is stored APP-SIDE only (app.estalara.com infrastructure, Rafał Palak's
responsibility). The Adaptive-Listings system stores only a 12-dimensional intent vector with a
24-hour TTL. Code-verified: `schemas.py` (class `ChatIntentDetectedPayload`) has no `messages` or
`raw_text` field; `redis_writer.py` — `payload.model_dump()` serializes only the structured payload.
Since FOLLOW-730 that payload also carries two diagnostic fields, `data_source` and
`extraction_error`, which record WHY an extraction produced its result (a fixed enum plus an
exception CLASS name — never the exception message, and never buyer content). See
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

| Version | Date       | Author                 | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------- | ---------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 2026-05-27 | Compliance Engineering | Initial creation (FOLLOW-129). §13.1 + §13.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
|         |            |                        | disclosure paragraphs from DPIA Audit F-13/F-14                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 1.1     | 2026-06-08 | Compliance Engineering | FOLLOW-218: added §4 client-storage table listing all five active SDK keys including the new `estalara_intent_{sessionId}` sessionStorage entry. Renumbered old §4 (DPO Gate) to §5; old §5 (Revision History) to §6. DPO gate updated to add §13.3 review item and §13.3 staging QA gate item.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 1.2     | 2026-06-08 | Compliance Engineering | FOLLOW-230: §4 updated to list all eight active SDK keys. Added three keys omitted from v1.1: `estalara_variant:{sessionId}` (sessionStorage, A/B variant, strictly-necessary), `__estalara_quiz_dismissed__` (localStorage, preference timestamp, strictly-necessary), `__estalara_micro_poll_dismissed__` (localStorage, preference timestamp, strictly-necessary). Updated header from "all five" to "all eight". Added per-key implementation notes with grep-verified source references.                                                                                                                                                                                                                                                                                                                          |
| 1.4     | 2026-06-22 | Compliance Engineering | FOLLOW-375: §4 updated to list all ten active SDK keys. Added `__estalara_quiz_completed__` (sessionStorage, session-scoped quiz-completion suppression flag, strictly-necessary — Rule N) and `estalara_resolved_archetype_{sessionId}` (sessionStorage, resolved source-of-truth archetype, Mode B, erased on consent denial — ADR-0014). Updated header from "all eight" to "all ten".                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 1.5     | 2026-07-25 | Compliance Engineering | FOLLOW-653 (external-brand go-live technical check): §4 updated to list all eleven active SDK keys. Added `__estalara_profiling_opt_out__[:{userId}]` (localStorage, per-user AL DOM-adaptation opt-out flag, Mode B, erased on consent denial/withdrawal — FOLLOW-372/§H.9), a key that shipped in PR #337 (2026-06-21) but was never added to this table — the `privacy-notice-keys-sync` CI gate does not scan for `_OPT_OUT_KEY`-suffixed constants, so the gap went undetected until this grep-verified audit. Updated header from "all ten" to "all eleven".                                                                                                                                                                                                                                                     |
| 1.6     | 2026-07-28 | Compliance Engineering | FOLLOW-705: §6.1 made byte-conformant with the server-side renderer, which this ticket rules the byte-canonical artifact for `consent_records.consent_text_hash`. Substituted the two unfilled editorial slots `[agency DSR contact]` → "the agency's DSR contact" and `[agency privacy policy]` → "the agency privacy policy" (the prose the renderer has served since 2026-06-21 — the published doc, not the served text, was the divergent artifact). Added BEGIN/END sentinels around the hashable block and §6.1.1, an executable normalization spec, enforced by the new `consent-text-sync` CI gate. **No change to disclosed meaning** (no purpose, recipient, retention period, right or lawful basis differs) → `PLATFORM_REGISTRATION_TOS_VERSION` deliberately NOT bumped, and no re-consent is required. |
| 1.3     | 2026-06-21 | Compliance Engineering | FOLLOW-373: §6 added — Platform-Wide Registration Consent disclosure for app.estalara.com pilot. Covers six purposes (a)–(f) with investor-facing EN text (§6.1), C-07 boundary confirmation (§6.2), and DOM opt-out disclosure (§6.3). DPO gate updated: four new gate items. Old §6 Revision History renumbered to §7. Template version bumped to 1.3.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
