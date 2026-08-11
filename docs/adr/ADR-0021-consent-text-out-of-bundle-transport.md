# ADR-0021 — Consent-banner text transport: identifier-free static asset fetched pre-consent, fail-closed

**Status:** PROPOSED → ACCEPTED on merge of the FOLLOW-915 design PR (merging is the ratification
act, ADR-0020 precedent). The **mechanism** — banner text out of the bundle, ordered ahead of the
consent gate — is pre-ratified by CEO ruling ESC-051 (Piotr, 2026-08-08); this ADR records the
design that makes the mechanism compliant. **Compliance countersign requested**
(compliance-engineer) on §D5 only — the scope clarification of ADR-0011's addendum sentence.
**Compliance countersign: GRANTED WITH BINDING CONDITIONS, 2026-08-09 (compliance-engineer,
FOLLOW-915)** — attestation scope, one record correction, and three testable conditions are in the
countersign block at the end of §D5; the implementation PR does not merge with any condition unmet.
**Date:** 2026-08-08 **Proposed by:** architect (FOLLOW-915 AC(0)) **Implementing ticket:**
FOLLOW-915 (sdk-engineer half, follows this contract) **Cross-references:** ESC-051 (RESOLVED),
ESC-028, ADR-0011 (addendum scope-clarified, quiz-config decision unchanged), ADR-0019, FOLLOW-278,
FOLLOW-815, FOLLOW-916, Rule N, `docs/compliance/dpia.md` §2.2 / §6.1 / §13.1 / §13.2

---

## Context

ESC-051: the SDK bundle budget is exhausted (measured at HEAD: 42,994 bytes gzip against a
43,008-byte budget — **14 bytes** of headroom), and FOLLOW-815's chat-storage disclosure had to be
_trimmed to fit a performance budget_ — a regulator-facing text edited for bytes. The CEO ruled
(2026-08-08): **lazy-load the consent banner text out of the bundle, not a third budget raise**,
because _"consent text grows from regulation, not from engineering, and must never compete with code
for a performance budget."_ The ruling's controlling constraint: the notice must render **before any
profiling begins** — the text fetch must be ordered ahead of the consent gate, not merely off the
critical path.

`packages/sdk/src/ui/consent-banner.ts` (~14.4KB raw / ~5.5KB gzip standalone, EN+PL+ES `COPY`
strings plus render code) is the largest movable object in the budget. _(This is the module's
isolated compressed size, not its marginal contribution to the bundle after removal — those two
numbers diverged 4.1×; see the §Consequences/Positive annotation, FOLLOW-932.)_

**The collision (FOLLOW-915 AC(0)).** ADR-0011's FOLLOW-278 addendum (Accepted 2026-06-11/12,
compliance-confirmed 2026-06-12) states:

> "The fetch MUST run after consent, not before — fetching tenant data before consent is resolved
> would be a GDPR-compliance issue on the data-transport level. The consent banner cannot wait for
> the fetch."

Read as one proposition, this forbids FOLLOW-915's required ordering. Read in its own context, it is
**two propositions with different subjects**:

1. **A compliance claim about `fetchQuizConfig()`** — a request that carries the tenant API key
   (`Authorization: Bearer <tenant-api-key>`, ADR-0011 Implementation Notes; superset endpoint per
   ADR-0019) and returns tenant configuration. Fetching _tenant data_ pre-consent is forbidden.
2. **An ordering consequence** — "the consent banner cannot wait for the fetch," where "the fetch"
   is, throughout the addendum, that same `fetchQuizConfig()`. Given (1) places the fetch after
   consent, the banner _logically cannot_ wait for it. The sentence carries no compliance rationale
   of its own and the addendum never considered any other fetch — ADR-0011's entire subject is
   quiz-config transport.

**Verdict: the split survives contact with the decision record.** ADR-0011 forbids pre-consent
fetches of _tenant data_. It is silent on — because it never contemplated — a pre-consent fetch of
Estalara's own static, tenant-agnostic legal copy. The compliance half of the addendum is untouched
and re-affirmed by this ADR (§D1). The latency half is superseded **only** insofar as it would be
read as "the banner may not wait for _any_ fetch" (§D5).

### Compliance analysis (answered from the existing DPIA — no ESC-056 required)

The question "may the SDK fetch its own static consent text before consent is resolved?" is
answerable from `docs/compliance/dpia.md`:

- **The request class already exists pre-consent.** The SDK bundle itself is fetched pre-consent
  from `admin.estalara.com` (`SDK_SERVE_URL = ${CONTROL_PLANE_URL}/sdk.js`,
  `packages/shared/src/domains.ts:57`) — today that bundle _contains_ the banner text. A sibling
  static asset on the same origin, fetched at the same lifecycle moment, exposes exactly what the
  bundle fetch already exposes: one transient-IP HTTP request to a DPF-certified sub-processor with
  a DPA in place (Vercel — dpia.md sub-processor table, line 223; Cloudflare transient-IP precedent,
  line 217). No new sub-processor, no new data category, no new lifecycle moment.
- **ePrivacy Art. 5(3) / PECR Rule 6** (dpia.md §6.1, lines 903–906, 925–929) govern _storing or
  accessing information on terminal equipment_. The text fetch stores nothing beyond standard HTTP
  cache — identical in kind to the script load — and delivering **the consent mechanism itself** is
  the paradigm case of "strictly necessary for a service explicitly requested"; a notice that cannot
  be displayed without consent to display it is circular.
- **No profiling, no identifier.** The request carries no tenant identifier, no API key, no session
  or visitor identifier, no cookies (§D3). It cannot contribute to the fingerprinting/profiling
  processing the DPIA gates behind consent (§2.2 Modes, §13.1/§13.2), because it is byte-identical
  for every tenant and every visitor.

The one condition on which this whole analysis rests is §D3: the request must remain
identifier-free. A `?tenant=` query param or an `Authorization` header would collapse it back into
the ADR-0011 prohibition.

---

## Decision

### D1 — ADR-0011's compliance rule re-affirmed, unchanged

Any request that carries a tenant identifier or credential, or returns tenant-specific data
(`fetchQuizConfig()` / `GET /api/quiz/public-config` per ADR-0019, `/api/adapt`, ingest, all events)
**remains strictly post-consent**. Nothing in this ADR weakens that. The ADR-0011 quiz-config
transport decision is not revisited.

### D2 — Transport and ordering

The banner `COPY` strings (all locales) move out of the bundle into **one static JSON document**
served from the control-plane origin (the same origin already serving `sdk.js`):

```
GET {CONTROL_PLANE_URL}/consent-text.json
Access-Control-Allow-Origin: *                                  (REQUIRED — see the note below)
Cache-Control: public, max-age=300, stale-while-revalidate=60   (ADR-0011 cache precedent)
Content-Type: application/json; charset=utf-8
```

> **All three lines have a producer and a standing observer.** [FOLLOW-935 AC(4)] They are emitted
> by the `headers()` rule in `apps/control-plane/next.config.mjs`. `Content-Type` was added to this
> block late: the rule had been producing it since FOLLOW-929 while appearing in neither this
> response block nor `docs/INTERFACES.md`, so a served header had no written contract to drift from.
> The deployed response is asserted per-deploy by `scripts/check-consent-text-headers.sh` — an
> EFFECT probe against the real origin, not an assertion about the config object that emits it.

Recommended artifact location: `apps/control-plane/public/consent-text.json` (same serving path as
the checked-in `estalara-detect.iife.js` companion, FOLLOW-325 precedent).

> **CORRECTION — 2026-08-09 (FOLLOW-929), appended not rewritten.** The sentence above and the §D2
> premise _"the same origin already serving `sdk.js`"_ substituted one transport for another and
> shipped a P0. `sdk.js` is loaded by `<script src>`, which is **not subject to CORS**; this
> document is read by `fetch(…, { mode: 'cors' })`, which **is** — and the SDK executes on the
> TENANT's origin, not the control plane's. Nothing set `Access-Control-Allow-Origin`, so every
> first-visit browser would have discarded the response and failed closed per §D4: no banner, null
> `init()`. The header is now produced by `apps/control-plane/next.config.mjs` `headers()` and
> asserted by `apps/control-plane/src/consent-text-headers.test.ts`, which derives the path from
> `CONSENT_TEXT_URL` rather than hardcoding it. **`Access-Control-Allow-Origin: *` is required by
> §D3, not merely tolerated:** a reflected-origin allowlist would make the response vary by tenant,
> which is the tenant-distinguishing behaviour §D3 forbids, and the request carries no credentials.
> The `Cache-Control` line above likewise had no producer until the same commit. The URL is a new
> shared constant `CONSENT_TEXT_URL` in `packages/shared/src/domains.ts` — compile-time inlined,
> never derived from snippet dataset values (derivation from `data-decision-url` is forbidden: a
> tenant-controlled attribute must not be able to redirect the consent-text fetch).

**Updated init sequence** (replaces the ADR-0011 §"SDK init sequence" diagram _for the pending path
only_; granted/denied paths are byte-unchanged):

```
1. readConfig()                 — snippet dataset (immutable binding only)   [unchanged]
2. getConsentState()
   ├─ 'denied'   → halt, erase, return null                                 [unchanged; no text fetch]
   ├─ 'granted'  → proceed to step 3                                        [unchanged; no text fetch, no banner]
   └─ 'pending'  → fetchConsentText()   — identifier-free static GET, 3000 ms budget
        ├─ 200 + Zod-valid  → renderConsentBanner(fetched text) → await visitor decision
        └─ error / timeout / invalid → FAIL CLOSED (§D4)
3. fetchQuizConfig()            — AFTER consent, per ADR-0011               [unchanged]
4. mergeQuizConfig()                                                        [unchanged]
5. scheduleQuizTrigger() / micro-polls                                      [unchanged]
```

The fetch MAY be initiated at any point after `readConfig()` (it is identifier-free, so early
initiation is compliance-neutral), MUST be awaited before the banner renders, and SHOULD be skipped
entirely when consent is already `granted` or `denied` (the majority of page views — returning
visitors pay zero extra requests).

**The invariant, stated as the test AC(1) must prove:** no event is pushed to the queue, no storage
key is written, and no tenant-identified request is issued until the banner — rendered from
successfully fetched and validated text — has received the visitor's decision. Latency cannot break
this invariant: everything that could profile is sequenced _behind_ the awaited fetch, so a slow
fetch delays the banner and the product equally, never the banner alone.

### D3 — Identifier-free constraint (the load-bearing compliance condition)

The consent-text request MUST carry:

- no tenant identifier, API key, or `Authorization` header;
- no session, visitor, or consent-state identifier;
- no query parameters of any kind;
- no cookies or credentials — `fetch(CONSENT_TEXT_URL, { credentials: 'omit', mode: 'cors' })`;
- a URL byte-identical for every tenant and every visitor.

A future change that parameterizes this request (per-tenant text, locale in the URL, A/B variants)
**re-opens the ADR-0011 compliance question and requires a new ADR plus compliance review before
implementation**. Locale selection is client-side: the document ships all locales (EN+PL+ES) and the
SDK selects using the existing level-2/3/4 chain (snippet `data-language` → `navigator.language` →
`'en'`). One document, one fetch, no locale leak in the URL.

### D4 — Failure mode: fail-closed, no degraded fallback text

On network error, non-2xx, timeout (3000 ms), or Zod validation failure of the fetched document:

- **no banner renders, and the SDK halts for this page view** — destroy the shadow host, dispatch
  zero events, write zero storage keys, return `null`;
- consent state **remains `'pending'`** (it is not recorded as denied); the fetch is retried
  naturally on the next page load;
- **no built-in fallback text ships in the bundle.** A trimmed fallback is exactly the ESC-051
  defect — disclosure content degraded by an engineering constraint — and a full fallback defeats
  the ruling. If the text cannot be shown, consent cannot be asked, so nothing runs. This is
  compliance-conservative by construction: the failure mode of the consent path is _less_
  processing, never more.

Availability cost is accepted: if the control-plane origin cannot serve a static file, the adapt
endpoint on the same origin is down too — the product is non-functional for that visitor regardless.

### D5 — Scope clarification of ADR-0011 (partial supersession, addendum only)

The ADR-0011 FOLLOW-278 addendum sentence _"The consent banner cannot wait for the fetch"_ is
**scoped to `fetchQuizConfig()`** (the only fetch the addendum discusses) and is superseded only as
a general claim: the banner MAY wait for the identifier-free consent-text fetch defined here, and
under this ADR it MUST. The preceding sentence — the tenant-data prohibition — is re-affirmed
verbatim by §D1. ADR-0011's Status remains ACCEPTED; its quiz-config transport decision, wire
contract, and auth-resolution notes are untouched. A dated annotation in ADR-0011 links here;
ADR-0011's original text is byte-intact per the supersede-never-edit rule.

Because compliance signed the 2026-06-12 confirmation inside that addendum, **compliance-engineer
countersign on this D5 scope reading is required before FOLLOW-915's implementation PR merges**
(action item below). If compliance rejects the reading, this ADR reverts to PROPOSED and ESC-056 is
filed with the CEO stating that ESC-051 as ruled is unimplementable without a compliance-posture
change.

#### Compliance countersign — GRANTED WITH BINDING CONDITIONS (compliance-engineer, 2026-08-09, FOLLOW-915)

**Attested.**

1. **The two-proposition reading of the ADR-0011 FOLLOW-278 addendum is correct.** Verified against
   the addendum text itself: "the fetch" denotes `fetchQuizConfig()` in every occurrence (it is the
   only fetch the addendum discusses; init-sequence step 3 is its referent); the compliance
   rationale attaches to _tenant data_; and the sentence "The consent banner cannot wait for the
   fetch" states an ordering consequence and carries no compliance rationale of its own. What
   compliance confirmed on 2026-06-12 inside that addendum was banner-locale legal sufficiency ("no
   locale-specific legal text"), not a universal prohibition on pre-consent fetches — nothing
   compliance previously signed is weakened by §D5. The tenant-data rule survives byte-intact via
   §D1.
2. **A pre-consent GET of Estalara's own static, identifier-free consent text is lawful, conditional
   on §D3 exactly as written.** ePrivacy Art. 5(3) / PECR Rule 6(4) strictly-necessary exemption
   (`docs/compliance/dpia.md` §6.1, lines 903–906 and 925–929): delivering the consent mechanism
   itself is the paradigm strictly-necessary case — a notice whose display required consent would be
   circular. GDPR: Art. 6(1)(f) covers the transient-IP processing inherent to serving an HTTP
   asset, reinforced by the Arts. 12–13 transparency obligations this asset exists to discharge. The
   analysis collapses the moment the request carries any identifier — §D3 is the entire compliance
   foundation, as this ADR itself states.
3. **§D4 fail-closed is endorsed on compliance grounds, not merely engineering grounds.**
   Transparency duties attach to processing; the fail-closed path processes nothing, so a visitor
   un-noticed on a failed fetch is also un-profiled — GDPR does not require notifying people about
   processing that does not occur. The rejected alternative (a trimmed built-in fallback) is
   compliance-worse: consent obtained on an incomplete disclosure is not "informed" under Art. 4(11)
   / Art. 7 GDPR, which would invalidate the lawful basis of everything downstream. The engineering
   rationale ("a trimmed fallback recreates the ESC-051 defect") survives the compliance reading and
   is strengthened by it: less-processing-on-failure is the correct failure mode for a consent
   surface.

**Correction placed on the record.** The Context section's claim that leg 1 is "answerable from the
existing DPIA" was overstated. At countersign time, dpia.md's Vercel sub-processor row (line 223)
and ropa.md's (line 444) scoped Vercel's data category to _tenant admin sessions / dashboard
traffic_; the pre-consent visitor-browser fetch of `sdk.js` was an existing practice the DPIA
**failed to mention, not one it covered**, and the "Cloudflare transient-IP precedent" (line 217) is
a different sub-processor on the ingest path. "We already do X" is not "X is assessed." Legs 2 and 3
carry the conclusion on their own, so this does not make ESC-051 unimplementable and does not force
ESC-056 — but the countersign rests on the corrected record, not on absence-of-mention: DPIA v2.18
§2.8 and ROPA v2.14 (same PR as this countersign) now record the pre-consent static-asset request
class, its lawful basis, and its one open gap (Vercel runtime-log retention, dpia.md §2.7.1).

**Binding conditions (testable; the FOLLOW-915 implementation PR does not merge without them).**

1. Every locale of the checked-in `consent-text.json` carries the DPIA-mandated disclosure sentences
   **byte-identical** to the shipped `COPY` strings — the §13.1 denial-log sentence (dpia.md lines
   1439–1445) and the §13.2 cross-session-identifier sentence (dpia.md lines 1514–1519) — and the
   same test that validates the artifact against `ConsentTextDocumentSchema` (§D7) asserts the
   presence of both sentences per locale.
2. AC(1) asserts the §D3 request shape **byte-exactly**: the compile-time `CONSENT_TEXT_URL`
   constant, no query string, no `Authorization` header, `credentials: 'omit'`. This is already an
   obligation of this ADR; the countersign is void if it is dropped or weakened.
3. The implementation PR updates dpia.md §13.1/§13.2's cross-references stating the disclosure
   strings "are defined in the `COPY` constant" in `consent-banner.ts` — true today, false the
   moment the strings move (Rule N: a compliance document may not describe a source of record that
   no longer exists).

**Enforcement (FOLLOW-925, added 2026-08-09).** All three conditions above have a consumer:
`scripts/check-adr-0021-conditions.mjs`, CI job `ADR-0021 §D5 binding conditions (FOLLOW-925)`, a
hard gate with a `--self-test` that proves each condition red-first. It ARMS on the presence of any
§D7 artifact (`consent-text.json`, the Zod schema, `CONSENT_TEXT_URL`) rather than passing while
they are absent, so a half-landed implementation is red and the byte-identity obligation cannot be
dropped by doing part of the work. Condition 1's canonical bytes are checked in at
`docs/compliance/consent-disclosures.canonical.json`, captured from the shipped `COPY` constant at
`f80f41b7` — the state compliance signed. Editing a sentence there is a compliance change, not a
copy edit.

**Not attested.** The §13.1/§13.2 LIA DPO gates (still PENDING — this is an engineering-compliance
countersign, not DPO sign-off, and it does not advance the EU-pilot DPO gate); the quiz-config
transport decision (unchanged, ADR-0011); the Vercel runtime-log retention figure (open gap, dpia.md
§2.7.1/§2.8); any parameterized variant of this fetch (per §D3, a new ADR plus compliance review is
required before one exists).

### D6 — FOLLOW-278 constraint status (stated, not built)

FOLLOW-278's accepted constraint ("banner always renders with pre-fetch `config.language`") becomes
**partially reversible**: its latency premise ("the banner cannot wait for a fetch") is retired by
D2, but its compliance premise stands — the _tenant-configured_ language lives in tenant data and
still cannot reach the pre-consent banner except via the `data-language` snippet-attribute escape
hatch already specified in the ADR-0011 addendum. Nothing changes now: the document ships all
locales and the existing selection chain applies. Any future tenant-locale-aware banner goes through
the escape hatch, not through this fetch (D3).

### D7 — Wire contract

```
GET {CONTROL_PLANE_URL}/consent-text.json
→ 200 OK, application/json

{
  "schema_version": 1,                  // literal 1; structural guard
  "text_version":   "2026-08-08.1",     // bumped on every copy change; audit trail
  "locales": {
    "en": { /* field-for-field the current COPY locale entry of consent-banner.ts */ },
    "pl": { /* … */ },
    "es": { /* … */ }
  }
}
```

- The locale entry shape is locked by a Zod schema in `packages/shared/src/schemas/consent-text.ts`
  (`ConsentTextDocumentSchema`, `ConsentTextLocaleSchema`), derived field-for-field from the
  existing `COPY` structure in `consent-banner.ts` — the schema is the contract; this ADR
  intentionally does not restate every key.
- Unknown fields are ignored (forward-compatible); a missing required field or wrong
  `schema_version` fails validation → §D4 fail-closed.
- `text_version` gives the SDK banner a byte-canonical, versioned text source — aligned with the
  FOLLOW-916 principle (server-rendered text is byte-canonical for consent evidence). No dependency
  either way: FOLLOW-916 concerns the registration-consent surface, not the SDK banner.
- **Interface obligations (ride with the FOLLOW-915 implementation PR, per architect guardrails):**
  Zod schema in `packages/shared/src/schemas/consent-text.ts`; a `.test.ts` with ≥5 cases (valid
  doc; missing locale; wrong `schema_version`; unknown extra field accepted; missing required copy
  field rejected); an entry in `docs/INTERFACES.md`; an example document in
  `packages/shared/src/examples/`. The checked-in `apps/control-plane/public/consent-text.json` MUST
  be generated from / validated against the same schema in a test so the served artifact and the
  contract cannot drift.

### D8 — Rule N and storage keys

No new client-storage key. The text is cached by HTTP semantics only (no localStorage/sessionStorage
copy in v1) — so `scripts/check-privacy-notice-keys.sh` is unaffected and FOLLOW-915 AC(4) is
satisfied structurally. If a storage-layer cache is ever added, it needs a new `*_STORAGE_KEY`, a
Privacy Notice §4 row, and an amendment here.

---

## Consequences

### Positive

- The consent text never again competes with code for the byte budget (ESC-051's ruling honored
  mechanically, not by discipline). Copy edits in any locale ship with zero bundle delta.
- ~5.5KB gzip leaves the bundle (banner strings; render code stays). Restores real headroom under
  the 42KB budget and unblocks FOLLOW-913 / FOLLOW-898 from coin-flip CI.
  - **Measured outcome (2026-08-09, FOLLOW-932 / RETRO-264) — do not silently correct the estimate
    above; this is an annotation, not a rewrite.** The actual marginal bundle delta was **~1,345 B
    (~1.31KB), measured with `zlib.gzipSync` — the instrument the gate at
    `packages/sdk/scripts/check-bundle-size.js` enforces** — a **4.1× miss**. _Two quantities are
    easy to swap here and one revision of this annotation did swap them: the **delta** is what left
    the bundle (~1,345 B), the **headroom** is what remains under the 42KB ceiling (1,356 B at
    `25cff8bc`, 1,367 B at `9afa0a46`). **Two DIFFERENT elevens appear above and they are causally
    unrelated — do not merge them** (RETRO-265): `1,356 − 1,345 = 11` is the **pre-move headroom**,
    the slack that already existed before anything was removed; `1,367 − 1,356 = 11` is **#711
    independently shrinking the bundle**, a later and unconnected event. Their coincidence is the
    third generation of the same number-confusion this annotation exists to correct. Delta and
    headroom drift independently on every merge — **run the gate**, which prints both, rather than
    quoting either from here._ Cause: the estimate applied the `consent-banner.ts` module's own
    _standalone_ raw/gzip size (see the ~5.5KB figures at line 29 and in References below) as if it
    were the bundle's _marginal_ gzip delta after removal — gzip shares a dictionary with the rest
    of the bundle, so the incremental contribution of one module is routinely smaller than that
    module's isolated compressed size. Authoritative before/after bytes: `docs/INTERFACES.md`
    (Consent-Banner Text Document section).
- Text updates propagate to all visitors within the 5-minute cache TTL — today they wait on every
  tenant's visitors re-fetching the SDK bundle, which is strictly worse for disclosure freshness.
- The failure mode of the consent path is provably "less processing," never "profiling without
  notice."
- `text_version` creates an audit-ready record of which copy was live when.

### Negative

- First-visit banner render costs one RTT (pending path only; ~50–200 ms typical). Returning
  visitors are unaffected. No compliance impact — the invariant sequences all profiling behind the
  render regardless of latency.
- New runtime dependency for first-visit onboarding: control-plane static serving down ⇒ no banner,
  no adaptation for that visitor (fail-closed). Accepted — see D4.
- A stale-cached bundle may render newer text (or vice versa within the TTL). The document is
  self-contained legal copy with a structural version guard; skew is bounded at 5 minutes on the
  text side.

### Risks

- **The identifier-free constraint erodes.** Highest-probability future defect: someone
  parameterizes the URL (tenant branding, locale, experiment arm) without noticing D3 is the entire
  compliance foundation. Mitigation: D3's explicit new-ADR-plus-compliance-review trigger, and the
  AC(1) test asserting the request URL and headers byte-exactly.
- **Compliance countersign on D5 is refused.** Bounded: this ADR reverts to PROPOSED, ESC-056 goes
  to the CEO, no implementation has merged (the countersign gates the implementation PR).

### Reversibility

HIGH. Re-inline the `COPY` strings and delete the fetch; no backend contract, no migration, no
tenant action. The static asset can be left in place harmlessly.

---

## Alternatives

**A — Third budget raise (43→45KB).** Rejected by CEO ruling ESC-051 explicitly: a budget raised
whenever it binds is not a constraint; this would be the second raise (ESC-028 was 40→42KB).

**B — Code-split the banner module (lazy JS chunk, not lazy text).** Rejected: the SDK is a single
IIFE injected on arbitrary tenant pages — no module context, fragile chunk-URL resolution, larger
blast radius (moves code + text when only text grows from regulation). The ordering problem is
identical, so this buys complexity without buying compliance.

**C — Keep text in bundle, keep trimming (status quo).** Rejected: 14 bytes of headroom; recreates
the exact ESC-051 defect (legal copy edited to fit a byte budget) on the next mandatory sentence.

**D — Serve text from a tenant-parameterized endpoint (e.g., extend
`GET /api/quiz/public-config`).** Rejected: attaches the tenant API key to a pre-consent request —
precisely what ADR-0011 forbids and D1 re-affirms. Also unnecessary: the text is deliberately
identical for all tenants (single-tenant re-brand model; and per-tenant legal copy would need
compliance review per D3 anyway).

---

## Action items

- @compliance-engineer — countersign D5 (scope reading of the ADR-0011 addendum) before the
  FOLLOW-915 implementation PR merges; record the countersign as a dated line under this ADR's
  Status.
- @sdk-engineer (FOLLOW-915 implementation half) — build to D2–D4, D7–D8; AC(1)'s ordering test must
  assert the D2 invariant and the D3 request shape byte-exactly; AC(2) is D4 (fail-closed, no
  fallback text — argue nothing, cite D4); AC(3) bundle before/after; AC(4) satisfied via D8.
- @pm-orchestrator — hold FOLLOW-913 / FOLLOW-898 until the implementation PR lands and the new
  headroom is measured.

---

## References

- ESC-051 (`backlog/ESCALATIONS.md`) — CEO ruling, 2026-08-08
- FOLLOW-915 (`backlog/FOLLOW_UPS.md`) — ticket + PM AC(0) annotation (session 107)
- `docs/adr/ADR-0011-quiz-config-transport.md` — addendum scope-clarified by this ADR (§D5)
- `docs/adr/ADR-0019-per-tenant-presentation-config.md` — superset public-config fetch (stays
  post-consent)
- `docs/compliance/dpia.md` — §2.2 (consent modes), §6.1 (ePrivacy Art. 5(3) / PECR), §13.1/§13.2
  (banner disclosure mandates), sub-processor table (Vercel line 223, Cloudflare line 217)
- `packages/sdk/src/ui/consent-banner.ts` — current `COPY` source (~14.4KB raw / ~5.5KB gzip
  standalone — module-isolated size, not the ~1.31KB marginal bundle delta actually measured;
  FOLLOW-932)
- `packages/sdk/src/index.ts:286–380` — consent gate + FOLLOW-278 rationale block (to be updated by
  the implementation PR to cite this ADR)
- `packages/shared/src/domains.ts:57` — `SDK_SERVE_URL` (the pre-existing pre-consent request to the
  same origin)
- `scripts/check-privacy-notice-keys.sh` — Rule N gate (unaffected per D8)
- FOLLOW-916 — byte-canonical consent text principle (registration surface; aligned, independent)
