# ADR-0021 — Consent-banner text transport: identifier-free static asset fetched pre-consent, fail-closed

**Status:** PROPOSED → ACCEPTED on merge of the FOLLOW-915 design PR (merging is the ratification
act, ADR-0020 precedent). The **mechanism** — banner text out of the bundle, ordered ahead of the
consent gate — is pre-ratified by CEO ruling ESC-051 (Piotr, 2026-08-08); this ADR records the
design that makes the mechanism compliant. **Compliance countersign requested**
(compliance-engineer) on §D5 only — the scope clarification of ADR-0011's addendum sentence.
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
strings plus render code) is the largest movable object in the budget.

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
Cache-Control: public, max-age=300, stale-while-revalidate=60   (ADR-0011 cache precedent)
```

Recommended artifact location: `apps/control-plane/public/consent-text.json` (same serving path as
the checked-in `estalara-detect.iife.js` companion, FOLLOW-325 precedent). The URL is a new shared
constant `CONSENT_TEXT_URL` in `packages/shared/src/domains.ts` — compile-time inlined, never
derived from snippet dataset values (derivation from `data-decision-url` is forbidden: a
tenant-controlled attribute must not be able to redirect the consent-text fetch).

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
- `packages/sdk/src/ui/consent-banner.ts` — current `COPY` source (~14.4KB raw / ~5.5KB gzip)
- `packages/sdk/src/index.ts:286–380` — consent gate + FOLLOW-278 rationale block (to be updated by
  the implementation PR to cite this ADR)
- `packages/shared/src/domains.ts:57` — `SDK_SERVE_URL` (the pre-existing pre-consent request to the
  same origin)
- `scripts/check-privacy-notice-keys.sh` — Rule N gate (unaffected per D8)
- FOLLOW-916 — byte-canonical consent text principle (registration surface; aligned, independent)
