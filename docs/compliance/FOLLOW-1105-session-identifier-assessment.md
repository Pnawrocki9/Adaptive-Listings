# FOLLOW-1105 — measurement of the session-identifier gap, and the fork

**Measured at `main` = `5704a31f`** (re-verified: `git rev-parse HEAD` → `5704a31f24caa551…`, tree
clean). Read-only. No repo file touched, no mutating git command run.

**Not a legal opinion.** Everything below is "what the regulation's text requires" + "what the code
does" + "where they disagree". Questions that need counsel are listed in §8 and marked.

---

## 0. The one-paragraph version

The four documents describe a session identifier that has never existed in this repository. The
shipped one is a plain unkeyed SHA-256 of four device attributes, byte-identical since the SDK's
first commit on 2026-05-10 — five days **before** the DPIA that describes something else was
written. It is a stable device fingerprint: I measured five production sessions whose events span
**41 to 106 hours across 2 to 5 distinct calendar days**, which is a direct experimental refutation
of "rotates on tab close or thirty minutes of idle time" and of "cross-session linking is
technically impossible". Separately, and worse for the record: the 90-day cross-visit identifier the
consent banner **does** disclose to users in three languages (`__estalara_xid__`) is written to
localStorage and **never transmitted anywhere** — so the identifier we told users about does
nothing, and the identifier we told users does not exist is doing all the work. There is a third
path that neither the retro nor the ticket named, it costs about one engineer-day, and it makes all
four documents true as written.

---

## 1. Q1 — Is `generateSessionId()` the identifier that reaches storage? Yes, unmodified.

**Producer.** `/home/asipi/Projects/Adaptive-Listings/packages/sdk/src/core/session.ts:69`

```ts
const parts = [
  navigator.userAgent,
  `${screen.width}x${screen.height}`,
  Intl.DateTimeFormat().resolvedOptions().timeZone,
  navigator.language,
];
const buffer = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(parts.join('|')));
```

No key. No tenant input. No time input. Its own docblock says "Generate a **deterministic** 64-char
hex session ID from stable browser signals."

**Chain to storage, each hop read in source:**

| hop | file:line                                                             | what happens to the value                                                               |
| --- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | `packages/sdk/src/core/session.ts:130`                                | becomes `SessionState.sessionId`, persisted to `sessionStorage['__estalara_session__']` |
| 2   | `packages/sdk/src/index.ts:481`                                       | `getOrCreateSession()` — the only session source in `init()`                            |
| 3   | `packages/sdk/src/core/events.ts:72`                                  | `session_id: session.sessionId` on every outbound event                                 |
| 4   | `apps/ingest/src/clickhouse-producer.ts:186`                          | `session_id: toStr(event.session_id)` — pass-through, no re-derivation                  |
| 5   | `infra/clickhouse/migrations/0001_create_events.sql:22`               | `events.session_id String`, also part of `ORDER BY`                                     |
| 6   | `packages/shared/src/ab-holdout.ts:124`                               | same string is the HMAC **message** for A/B arm assignment                              |
| 7   | `infra/clickhouse/migrations/0003_create_adaptation_decisions.sql:17` | `adaptation_decisions.session_id`                                                       |

**It is never salted, truncated, re-derived or replaced downstream.** I grepped every hop for a
transform; hop 4 is a string coercion and nothing else.

**Was an HMAC version ever built?** No — and this is the finding that closes the question the
backlog left open by repeatedly calling the shipped thing a "legacy HMAC fingerprint":

- `git log --oneline --all -- packages/sdk/src/core/session.ts` → 13 commits; the earliest,
  `852f5dee` (**2026-05-10**, `feat(sdk): tier 1 core [TICKET-031]`), already contains
  `generateSessionId()` **byte-identical to HEAD**. Every later commit adds neighbours (xid,
  lead_id, intent state); none touches this function.
- `git log --all -S "day_bucket"` and `-S "dayBucket"` → the string has **never** appeared in any
  commit outside documentation and backlog prose. There is no deleted implementation to recover.
- `grep -rn "day_bucket\|dayBucket" --include=*.ts --include=*.py --include=*.sql packages apps infra`
  → zero hits.
- The DPIA that describes the HMAC design was committed `cd407336` on **2026-05-15** — five days
  _after_ the code it contradicts. **This was never a drift; it was wrong on the day it was
  written.**

**Other session-id producers?** Three HMAC call sites exist in the repo and none of them mints a
session id: `packages/shared/src/ab-holdout.ts` (A/B arm), `packages/sdk/src/core/adapt.ts` (request
signing), `packages/auth/src/middleware.ts` (JWT verify). There is exactly one session-id producer.

---

## 2. Q2 — Stability in practice. Measured, then reasoned.

### 2.1 The measurement (production ClickHouse, read-only)

```
SELECT substring(session_id,1,12) AS sid, count(), min(ts), max(ts),
       dateDiff('hour',min(ts),max(ts)) AS span_hours, uniqExact(toDate(ts)) AS distinct_days
FROM events GROUP BY session_id
```

| sid (truncated) | events | span_hours | distinct calendar days |
| --------------- | ------ | ---------- | ---------------------- |
| `e365550ea8ef`  | 148    | **106**    | 4                      |
| `9058655a5e64`  | 28     | **84**     | 5                      |
| `3e82880cf029`  | 31     | **80**     | 2                      |
| `74fb9d656158`  | 36     | **51**     | 2                      |
| `285feb262bbc`  | 6      | **41**     | 3                      |
| `bbbbbbbbbbbb`  | 1      | 0          | 1 (synthetic test row) |

Five real identifiers, each alive across multiple days. Under the documented design the maximum
possible span is one day (`day_bucket`) and in practice 30 minutes. **The documented property is
falsified by the product's own production data.** (Total: 250 rows, 1 tenant — this is pilot/dev-era
traffic, so it proves the _mechanism_, not a user-population statistic.)

### 2.2 Which way does the harm cut? Both, and that is the point.

The input is `UA | WxH | timezone | language`. Two regimes coexist:

- **The head of the distribution merges people.** On a single-country property site nearly every
  visitor shares timezone and language. What is left is browser+OS+major-version and screen size.
  The modal bucket (say Windows Chrome-latest at 1920×1080, `Europe/Warsaw`, `pl-PL`) plausibly
  covers a low-double-digit percentage of visitors, who all receive **one identical `session_id`**.
  Those visitors are merged into a single "session" in ClickHouse, in `session_embeddings`, in the
  A/B arm, and in the DSR erasure key.
- **The tail singles people out durably.** A less common configuration (unusual screen geometry, a
  minority browser, a traveller's timezone) is close to unique and persists until the user updates
  their browser or changes monitor. That is a persistent cross-site device identifier.

So: **high collision for the majority (a merging harm) _and_ durable identification for the minority
(a tracking harm), with no way for the system to tell which visitor is in which regime.** The
GDPR-relevant consequence: for the tail the identifier singles out a natural person, which is what
matters for Art. 4(1); the head does not make the system safe, it only makes the data wrong.

**Note the accidental rotation.** Chrome ships a major version roughly every four weeks and the
major version is still present in the reduced UA string, so most fingerprints _do_ change every few
weeks — on browser update, on a monitor change, on travel. This is **not** a compliance control: it
is unpredictable, uncontrolled, unenforced, provides no cryptographic separation, and cannot be
described to a data subject or a regulator as a retention or rotation guarantee. It is also why the
7-day analytics window mostly still works today.

**If you want a real population number** (not needed for this decision): once the pilot carries real
traffic, `SELECT uniqExact(session_id), count() FROM events` plus the per-fingerprint row-count
distribution gives the collision picture directly. Today N=5 and no such claim is supportable.

---

## 3. Q3 — Retention. The ROPA defect is separate from the DPIA defect, and larger than expected.

**ROPA Activity 2 (`docs/compliance/ropa.md:175`)** states retention as: _"Session scope only; hash
rotates on tab close or 30-minute idle timeout."_ The rotation does not happen (§1, §2), so the
record's stated retention has no mechanism behind it. What actually retains the identifier:

| store                           | documented                                            | **measured in production**                                                                                                                                              |
| ------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `events` (carries `session_id`) | 13 months                                             | ✅ `TTL toDateTime(ts) + INTERVAL 13 MONTH` — enforced                                                                                                                  |
| `adaptation_decisions`          | ROPA:219 "13 months; enforced by partition-level TTL" | ❌ **no TTL** (`system.tables` → `has_ttl = 0`, 377 rows)                                                                                                               |
| `llm_calls`                     | ROPA:115-table "13 months, same TTL partition"        | ❌ **no TTL** (459 rows)                                                                                                                                                |
| `intent_events`                 | migration 0014 comment "90 days via TTL cron"         | ❌ **no TTL** (0 rows)                                                                                                                                                  |
| `session_quality`               | —                                                     | ❌ no TTL (0 rows)                                                                                                                                                      |
| `session_embeddings` (Postgres) | ROPA:115 "90 days; TTL enforced by nightly cron"      | ❌ **no such cron** — `apps/control-plane/vercel.json` has exactly three crons: `dsr/mutation-poll`, `internal/retention/conversion-labels`, `canary/adaptation-writes` |
| `conversion_labels`             | 13 months via daily cron                              | ✅ cron exists and is scheduled                                                                                                                                         |

Verified with `SELECT name, engine, create_table_query LIKE '%TTL%', total_rows FROM system.tables`
against prod, and by reading `vercel.json`.

**So there are three retention defects, and they are independent:**

1. **DPIA defect** — the identifier is described as rotating; it does not.
2. **ROPA Activity 2 defect** — the retention field of a Art. 30 record states a _rotation_ as its
   retention control. Even if a TTL existed, "session scope only" is contradicted by a 13-month
   `events` TTL that stores the identifier verbatim.
3. **ROPA Retention-Schedule defect (pre-existing, adjacent, not caused by this)** — four documented
   retention periods have no enforcement in production. Under my own standing rule (every retention
   promise paired with a verified TTL) each of these needs a data-engineer TTL ticket before the
   corresponding row can be treated as satisfied. These are worth fixing whichever path is chosen.

---

## 4. Q4 — Blast radius across the compliance corpus

Enumerated per document, per sentence. "FALSE" = the code contradicts it; "INVERTED" = the code does
the opposite of what the sentence asserts is impossible.

### `docs/compliance/dpia.md`

| line          | sentence (abridged)                                                                                                 | verdict                                                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 41-42         | "session-scoped HMAC hash that rotates on tab close or thirty minutes of idle"                                      | FALSE                                                                                                                                                                                                |
| 62-63         | entropy = "canvas hash, AudioContext hash, screen and viewport, timezone, language, WebGL renderer"                 | FALSE — **in the safe direction**; the product collects far less                                                                                                                                     |
| 121           | `HMAC(tenant_secret, fingerprint_entropy, day_bucket)`                                                              | FALSE                                                                                                                                                                                                |
| **122**       | **"Cross-session linking is technically impossible because the day bucket changes"**                                | **INVERTED** — cross-session linking is automatic, permanent and measured (§2.1)                                                                                                                     |
| 122-123       | "Cross-tenant correlation is impossible because the tenant secret differs per tenant"                               | INVERTED — there is no tenant input                                                                                                                                                                  |
| 141-142       | tech-inventory rows repeating the entropy vector and "session_id hash"                                              | FALSE                                                                                                                                                                                                |
| 170           | "No hash is stored client-side beyond the current session"                                                          | partly FALSE — the hash _is_ written to `sessionStorage`, and re-derives identically afterwards                                                                                                      |
| 669, 680-682  | "After rotation, there is no technical mechanism to link the new session to the previous one"                       | INVERTED                                                                                                                                                                                             |
| 742, 750, 752 | "cannot be reverse-engineered without the tenant secret" / "day-bucket rotation … cannot link sessions across days" | FALSE — an unkeyed digest is offline-enumerable over the (UA × resolution × tz × lang) space, which is small                                                                                         |
| 853-854       | "cross-tenant session hash reuse technically impossible even if an API key were compromised"                        | INVERTED                                                                                                                                                                                             |
| **880**       | **"Mode A is designed specifically around the strictly necessary exemption: session-scoped, rotates…"**             | this is the sentence carrying the **ePrivacy Art. 5(3)(b)** argument, and its premise is FALSE                                                                                                       |
| 1454          | "a pseudonymous session token (ephemeral; rotates on tab close)"                                                    | FALSE                                                                                                                                                                                                |
| 1521-1523     | §13.2 describes the _cross-session_ id as an HMAC of the same entropy with a 30-day bucket                          | FALSE — the real `__estalara_xid__` is a `crypto.randomUUID()` with a 90-day TTL (`session.ts:150-215`). §13.2 already carried a known "dual-id-narrative collision" (MASTER_DESIGN:103, FOLLOW-150) |
| 1617          | "`estalara_intent_{sessionId}` where sessionId is the per-tab HMAC hash"                                            | FALSE                                                                                                                                                                                                |
| 1810          | "the 12-dim vector is keyed by session_id (HMAC hash)"                                                              | FALSE                                                                                                                                                                                                |

### `docs/compliance/lia-template.md` — this is the document that fails hardest

| line          | sentence                                                                                                                             | verdict                                                                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 105-107       | HMAC + tenant secret + day bucket; "two visits from the same device on different days produce different hashes and cannot be linked" | FALSE, and it is the **necessity test**                                                                                                                                                                                                                 |
| **108-110**   | **"No cookies are set. No localStorage is written. The system does not rely on any persistent client-side storage mechanism."**      | FALSE three times over: `localStorage['estalara_consent']` (`session.ts:26`), `localStorage['__estalara_xid__']` (`session.ts:143`), `localStorage['__estalara_profiling_opt_out__']`, plus `sessionStorage` writes at `session.ts:113`, `:340`, `:465` |
| **113-114**   | **"Cross-site tracking is architecturally impossible: the tenant secret differs per tenant"**                                        | **INVERTED — and this claim carries the balancing test**                                                                                                                                                                                                |
| 139           | comparison table: "the HMAC fingerprint approach avoids cookie reliance"                                                             | FALSE premise                                                                                                                                                                                                                                           |
| 159, 182, 224 | "expires on tab close or thirty minutes"; "Persistence: None — session-scoped, HMAC rotation → Favors LI"                            | FALSE; row 224 is a **weight on the controller's side of the balancing test**                                                                                                                                                                           |
| 310-325       | §A.1, the formal necessity/purpose test                                                                                              | FALSE in every element                                                                                                                                                                                                                                  |
| 347-350       | "Cross-site correlation is architecturally precluded … the Estalara backend has no mechanism to correlate them"                      | INVERTED                                                                                                                                                                                                                                                |

**Internal contradiction that already existed:** `lia-template.md:108`'s "no localStorage is
written" is contradicted inside the compliance corpus itself by `PRIVACY_NOTICE_TEMPLATE.md:99-111`,
a table that lists the localStorage keys. Two documents in the same directory disagree about whether
the product writes localStorage.

### `docs/compliance/ropa.md`

| line               | field                                                                                                           | verdict                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 151, 195, 281, 414 | "session_id (HMAC hash — pseudonymous identifier)" ×4 activities                                                | FALSE (mis-description of a data category in an Art. 30 record)                    |
| 162, 166           | Activity 2 title/name "Session Fingerprinting (HMAC Hash Computation)"                                          | FALSE                                                                              |
| 173                | data categories = canvas + AudioContext + viewport + WebGL                                                      | FALSE (over-declares; safe direction)                                              |
| **175**            | retention = "session scope only; hash rotates…"                                                                 | FALSE — see §3                                                                     |
| 178-179            | "Computed in-region at the Cloudflare POP closest to the visitor; never transmitted as raw fingerprint entropy" | FALSE — computation is **in the browser** (`crypto.subtle.digest`), not at the POP |
| 180                | security measures = per-tenant HMAC secret + day_bucket rotation + Doppler-held secret                          | FALSE — none of these three controls exists                                        |
| 219                | `adaptation_decisions` 13 months "enforced by partition-level TTL"                                              | FALSE — measured, no TTL                                                           |

### `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md`

| line   | sentence                                                                                                                    | verdict                                                                                                                                                                   |
| ------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **34** | "a pseudonymous session identifier that is **discarded when you close your browser tab** or after 30 minutes of inactivity" | **FALSE as written** — the _storage_ is discarded; the _identifier_ is recomputed identically on the next visit, on the next tab, and on every other site running the SDK |
| 56     | "The session token in the log is ephemeral and rotates on every new browser session"                                        | FALSE                                                                                                                                                                     |

### Derived surfaces — checked, and this is the good news

- **Shipped consent-banner copy: CLEAN.** `docs/compliance/consent-disclosures.canonical.json` +
  `packages/sdk/src/ui/consent-banner.ts:206,210` — the two byte-locked disclosure sentences
  (en/pl/es) are about the **denial log (7 days)** and the **90-day `__estalara_xid__`**. Neither
  mentions the session fingerprint. **No shipped banner string is falsified by this finding.**
- **Registration consent text: CLEAN.** `renderPlatformConsentText()`
  (`apps/control-plane/src/app/api/v1/consent/platform-registration/lib.ts:124-146`) — the text a
  data subject reads before clicking "I agree" contains no session-identifier sentence. Its six
  purposes are unaffected. `CANONICAL_CONSENT_TEXT_HASH` is derived, not asserted, so no hash churn.
- **`PRIVACY_NOTICE_TEMPLATE.md` §6.1 (the CI-synced block): CLEAN.**
  `scripts/check-consent-text-sync.mjs` gates only the sentinel-delimited §6.1 block. The false
  sentence is in **§1**, which no gate covers and no code renders.
- **Privacy-policy generator: does not exist.** No `privacy-policy-generator/` directory.
  `packages/compliance/src/index.ts` is a stub exporting one constant (`COMPLIANCE_VERSION`).
  Nothing to regenerate.
- **Fair-housing packs: not touched.** No fair-housing rule-pack files exist in the repo yet, and
  `assignHoldout()` still takes only `(tenant_id, session_id)` — **the confirmed-clean
  no-proxy-demographic pattern from RETRO-002 is preserved**; nothing here disturbs it.
- **AI Act material: indirectly touched.** The AI Act audit-trail argument rests on
  `adaptation_decisions` being retained 13 months (ROPA:219). That table has **no TTL at all**, so
  the audit trail is longer than declared, not shorter — a transparency defect, not a compliance
  hole in the audit direction.
- **DSR/export paths: touched, and one is a live bug — see §6.**

---

## 5. Q5 — Is anything user-facing currently false? **No. It is a template, not a rendered surface.**

This is the answer that sets urgency, so it is stated precisely.

- `PRIVACY_NOTICE_TEMPLATE.md` §1 is a **paste-into-your-own-policy template for tenants**. Nothing
  in this repository renders it. `grep -rln PRIVACY_NOTICE_TEMPLATE` returns docs, backlog, and one
  CI job that reads **only §6.1**.
- **The one live tenant does not carry it.** I fetched `https://app.estalara.com/en/legal/policy`:
  no sentence about a session identifier, a fingerprint, tab close, 30 minutes of inactivity,
  Adaptive Listings, or Time2Show. The §1 disclosure has not been published.
- The repo already knew it could not verify this:
  `docs/compliance/EXTERNAL_BRAND_GOLIVE_CHECK-2026-07.md:35` records axis 1 as **"PARTIAL /
  OPERATOR-GATED"** with the note that whether a Privacy Policy page contains the §1/§4 disclosures
  "is decided entirely on the out-of-repo `app.estalara.com` side".
- The DPO gate in `PRIVACY_NOTICE_TEMPLATE.md:157-172` is **all PENDING** — the template has not
  been signed off for distribution.

**Consequence for urgency:** no data subject has yet been told the false sentence, so this is not a
live Art. 12/13 transparency breach. It is a **loaded gun**: the moment a tenant publishes §1 —
which is exactly what the external-brand go-live checklist instructs them to do — it becomes one.
Nothing else about the finding is downgraded by this: the unlawful-fingerprint question in §7 does
not depend on what has been published.

---

## 6. Two code defects found while measuring — file these regardless of which path is chosen

**6.1 (P1) — The denial path writes the device fingerprint to a 13-month store.**
`packages/sdk/src/index.ts:459-463`: when a visitor clicks **Deny** on the banner, the SDK calls
`getOrCreateSession()` to attach a `session_id` to the `consent.denied` audit event, then
`dispatchEvents(...)`. That event lands in `events` (13-month TTL) carrying the visitor's device
fingerprint. So the audit record of a refusal is keyed by a durable device identifier of the person
who refused. (On a _return_ visit the SDK halts at `index.ts:332` before session creation — so this
is once per browser, not per visit. The `consent.denied` disclosure sentence covers a 7-day denial
log; the ClickHouse row lives 13 months.)

**6.2 (P1) — DSR erasure of `consent_records` is not tenant-scoped.**
`apps/control-plane/src/app/api/dsr/erase/route.ts:327`:

```ts
await tx.delete(consentRecords).where(eq(consentRecords.sessionId, record.sessionId));
```

Every sibling delete in that transaction carries `AND tenant_id`; this one does not. With a
session*id that is (a) identical across tenants and (b) shared by every visitor in the same device
bucket, one data subject's erasure request deletes **other people's** consent records — including
across tenants. Today this is contained by the single-tenant model and by there being ~5 real
sessions, so it is latent, not exploited. It becomes real on the day a second brand is provisioned.
Note it is \_also* an under-erasure in the other direction: an erasure served for tenant A leaves
the identical fingerprint's rows on tenant B intact.

---

## 7. The fork

### Path A — code to documents: implement `HMAC(tenant_secret, entropy, day_bucket)` + rotation

**What the documents actually specify, and why it cannot be built as written.**
`lia-template.md:310-315` says the hash is "computed in memory" **by the Estalara SDK** using "a
tenant-specific secret (held server-side, **not exposed to the client**)". Those two clauses are
mutually exclusive — a browser cannot key an HMAC with a secret it is not given. `ropa.md:178` picks
the other horn (computed at the Cloudflare POP), which is coherent but means the identifier must be
**server-minted**: the SDK would have to transmit raw fingerprint entropy to the edge (contradicting
`ropa.md:179`, "never transmitted as raw fingerprint entropy") and would have no id for its first
request. So Path A is not "add an HMAC call"; it is **re-architecting session identity to be
server-minted**, across SDK, ingest, the adapt route, and the ClickHouse join key.

**And it makes the product more invasive.** To match `dpia.md:62` and `ropa.md:173`, Path A must
**add canvas hashing, AudioContext hashing, WebGL renderer probing and viewport capture** — four
fingerprinting surfaces the product does not currently touch. The document argues the design is
minimally invasive; conforming to it requires increasing invasiveness.

**Consumers that assume a stable `session_id`, and what each needs under 30-min/tab-close
rotation:**

| #   | consumer                                    | file:line                                                                                                             | what breaks                                                                                                                                     | what it would need                                                                                                                                                 |
| --- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | A/B arm assignment                          | `packages/shared/src/ab-holdout.ts:124`                                                                               | arm is `HMAC(tenant_id, session_id)`; rotation **re-randomises the arm mid-journey**, so one person can be in both arms                         | a separate stable experiment key, and a new contamination-exclusion filter (this repo already carries one for the last such incident: migration `0017_follow371…`) |
| 2   | 7-day analytics rollup                      | `apps/control-plane/src/app/api/admin/analytics/rollup/data.ts:133,210,213`                                           | joins `events` ↔ `adaptation_decisions` on `session_id`; any CTA click >30 min after the adapt call stops joining; session denominators inflate | a durable join key, i.e. exactly the thing rotation removes                                                                                                        |
| 3   | bandit feedback loop                        | `apps/control-plane/src/app/api/adapt/feedback/route.ts`                                                              | the feedback ping must carry the same `session_id` as the decision row                                                                          | same                                                                                                                                                               |
| 4   | cross-listing journey / SoT archetype       | `packages/sdk/src/core/session.ts:340,465` (`estalara_intent_{sessionId}`, `estalara_resolved_archetype_{sessionId}`) | keys are **suffixed with the session id**; rotation orphans them and resets the archetype to the uniform prior                                  | re-key onto a stable per-tab handle                                                                                                                                |
| 5   | chat intent cache                           | `shadow:{tenant}:{session}:chat_intent`, 24 h TTL                                                                     | unreachable 30 minutes after it is written                                                                                                      | same                                                                                                                                                               |
| 6   | `session_embeddings`                        | unique `(tenant_id, session_id)`, 90-day                                                                              | a new row every 30 minutes instead of one per visitor                                                                                           | same                                                                                                                                                               |
| 7   | tracer / quiz completions / demo revocation | `apps/control-plane/src/app/api/admin/tracer/*`, `demo-session-revocation.ts`                                         | per-session views fragment into 30-minute shards                                                                                                | same                                                                                                                                                               |
| 8   | **DSR access / erase / portability**        | `apps/control-plane/src/app/api/dsr/{access,erase,portability}/route.ts`                                              | a data subject supplies **one** `session_id`; a rotating id means erasure reaches only the last 30 minutes of their data                        | a durable subject key — i.e. Path A **weakens the Art. 17 right it is meant to protect**                                                                           |

**Critical-path cost.** Every one of consumers 1-3 is an input to FOLLOW-819 (the differentiator
E2E), which is the gate feeding FOLLOW-820. Path A invalidates the FOLLOW-819 baseline and requires
re-measuring it. Estimate: **3-5 engineer-days across sdk/backend/data + a re-run of FOLLOW-819**,
on the critical path, and at the end `PRIVACY_NOTICE_TEMPLATE.md:34` is _still_ false — a
`day_bucket` gives day scope, not the tab scope the sentence promises to users.

### Path B — documents to code: describe the unkeyed device fingerprint honestly

**Cost: zero lines of code. 1-2 days of careful writing. The posture consequence is the whole
cost.**

- **Lawful basis.** `dpia.md:880` rests Mode A on **ePrivacy Art. 5(3)(b)** — the "strictly
  necessary for a service explicitly requested" exemption — and the premise it offers is that the
  identifier rotates and is unlinkable. EDPB Guidelines 02/2023 put fingerprinting inside Art. 5(3)
  regardless of cookie use (the DPIA cites this itself at `lia-template.md:322-325`). A
  deterministic unkeyed device digest that persists across sessions **and across every site running
  the SDK** is not plausibly "strictly necessary" for displaying a property listing. Whether 5(3)(b)
  can still be argued is a **counsel question**, not an engineering one (§8).
- **The LIA.** `lia-template.md:113` and `:224` are not decoration — they are the two heaviest
  weights on the balancing test. Remove them and the balancing test is not weakened, it is
  **unrun**. The LIA must be re-derived from the real mechanism, and it must be re-derived per
  tenant, since it is a template tenants complete.
- **The commercial position ("anonymous buyer, no consent friction") — already not what ships.**
  This is the most decision-relevant thing I measured on this axis. `packages/sdk/src/index.ts:348`:
  when localStorage consent is `pending`, the SDK **always renders the banner and awaits a
  decision** — `getOrCreateSession()` at `:481` runs only after that. `config.consentState` defaults
  to `'legitimate_interest'` (`config.ts:186`) but that value **does not bypass the banner**. And
  `index.ts:392-411` fails **closed**: if the consent-text fetch fails, the SDK returns `null` and
  profiles nobody. So the product already operates in consent mode. **Path B does not cost you a
  no-consent-friction position; it costs you the written claim to one you are not exercising.**
- **Compatibility with the CEO's consent-umbrella ruling (2026-06-21).** I found the ruling
  (`/home/asipi/.claude/projects/-home-asipi-Projects-Adaptive-Listings/memory/project_consent_umbrella_optout_decision.md`;
  documented in ROPA Activity 16 and DPIA §13.4). It puts the whole platform under one **mandatory
  registration consent captured at app.estalara.com registration**. Verdict: **Path B does not
  reopen the ruling — it narrows where the ruling reaches.** The umbrella covers _registered_
  investors; the SDK fingerprint is computed on the _anonymous listing page, before registration_.
  The umbrella never addressed that population. So the ruling stands intact, and a gap it was never
  asked about becomes visible. That gap is currently covered — in code, though not in the DPIA — by
  the banner the SDK already renders.
- **What Path B cannot write away:** defect 6.1 (a durable device fingerprint of a person who
  _refused_ consent, retained 13 months) and defect 6.2. Those are code, not prose.

### Path C — the third path. Keep the stability, delete the fingerprint. ~1 engineer-day.

**Concrete mechanism:** in `packages/sdk/src/core/session.ts:69`, replace the body of
`generateSessionId()` with a random 128-bit token (`crypto.randomUUID()`, already imported and used
by `generateUuid()` at `:169` with a documented fallback). Change nothing else.

**Why this costs nothing in analytics — the load-bearing observation:** `getOrCreateSession()`
(`:125`) reads `sessionStorage['__estalara_session__']` **first** and only calls
`generateSessionId()` when no stored session exists. Every one of the eight consumers in the Path A
table reads the id out of that storage. `sessionStorage` already survives navigation and full reload
for the tab's lifetime. **So a random per-tab token has identical intra-session stability to today's
fingerprint. Nothing rotates mid-session. No consumer changes. No migration. No re-baseline.**

**What it delivers, checked sentence by sentence:**

- `PRIVACY_NOTICE_TEMPLATE.md:34` ("discarded when you close your browser tab") becomes **true as
  literally written** — the storage lifetime already matches; only the derivation made it false.
- `dpia.md:122` ("cross-session linking is technically impossible") becomes **true, and by a
  stronger mechanism than the HMAC it claims** — a random token has no device input to re-derive
  from, whereas `HMAC(secret, entropy, day_bucket)` still links every session within a UTC day and
  is still re-derivable by anyone holding the tenant secret.
- `lia-template.md:113` ("cross-site tracking is architecturally impossible") becomes **true** — a
  per-tab random token is uncorrelated across tenants because it is uncorrelated with everything.
- The collision problem in §2.2 disappears: no two visitors share an id.
- The Path A consumer table becomes empty. FOLLOW-819 needs no re-measurement.
- ePrivacy: a random token in `sessionStorage` for the duration of the requested interaction is the
  textbook shape of the 5(3)(b) argument, instead of its counter-example. (Still a counsel question,
  but a _much_ easier one — §8.)

**The one real cost, stated honestly.** Today the fingerprint silently provides cross-visit
continuity server-side (`session_embeddings` keyed by `(tenant_id, session_id)` for 90 days: a
returning visitor lands on their old row). Path C removes that. The lawful way to restore it already
exists and is already specified: `__estalara_xid__` — a `crypto.randomUUID()` in localStorage with a
90-day TTL, erased on denial and withdrawal (`session.ts:143-236`), **and disclosed to users in the
byte-locked banner sentence in en/pl/es**. It is inert today: written at `index.ts:426,473` and
**never transmitted**, because **FOLLOW-146 has been open since 2026-05-28** (P1, 4 h estimate,
"thread `__estalara_xid__` onto event payloads and into the ClickHouse session-join key").

That inversion is the finding worth putting in front of the CEO on its own:

> **The 90-day cross-visit identifier we disclose to users does nothing. The device fingerprint we
> tell users does not exist provides all cross-visit continuity. Path C swaps them back.**

Path C also removes 6.1 outright (a random token attached to a `consent.denied` event is not a
device fingerprint) and defuses 6.2 (a random id no longer collides across people or tenants — the
missing tenant predicate should still be fixed).

---

## 8. Recommendation, and the arithmetic

**Path C is clearly better: it is the only option that makes all four documents true as written
without adding fingerprinting surface, without touching a single consumer, and without re-baselining
the gate on the critical path.**

|       | code changed                                         | consumers to re-work | new data collected                                      | FOLLOW-819 re-measurement | are the four docs true afterwards?                                                                        | est.                                        |
| ----- | ---------------------------------------------------- | -------------------- | ------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **A** | SDK + shared + ingest + control-plane + CH migration | **8** (§7 table)     | **+4 surfaces** (canvas, AudioContext, WebGL, viewport) | **yes**                   | **no** — `PRIVACY_NOTICE:34` stays false (day scope ≠ tab scope)                                          | 3-5 days, on critical path                  |
| **B** | 0                                                    | 0                    | 0                                                       | no                        | yes, but they then describe a persistent cross-site device identifier; LIA must be re-run; 6.1/6.2 remain | 1-2 days + an open counsel question         |
| **C** | **~5 lines** in one function + tests                 | **0**                | 0                                                       | no                        | **yes, all four, by a stronger mechanism than documented**                                                | **~1 day** + FOLLOW-146 (already open, 4 h) |

The arithmetic that decides it: Path A costs 3-5 days, adds four fingerprinting surfaces, and still
leaves the user-facing sentence false. Path C costs ~1 day, adds nothing, and makes it true. Path A
is strictly dominated. Path B is the fallback if the CEO wants to ship the current identifier and
re-run the lawful-basis analysis with counsel — it is a legitimate choice, but it leaves a P0 in
production rather than closing it.

**Path C still needs a small amount of Path B's writing**, and that is not a hidden cost — it is
required work under either path: `ropa.md` Activity 2 must be rewritten regardless (its data
categories, computation location, and security measures are wrong about the _current_ code and would
be wrong about Path C too), and the corpus-wide "HMAC hash" phrasing (§4) must be corrected in all
four documents. Budget **1 day of code + 1 day of document correction**, and the corrections are
identical to work Path B would have to do anyway.

**Sequencing note.** This sits directly on the localhost-first critical path (FOLLOW-819 →
FOLLOW-815 → FOLLOW-820), and FOLLOW-815 is FROZEN pending this answer (`backlog/QUEUE.md:113,422`).
Path C is the only option that does not push that path out: it changes no consumer FOLLOW-819
measures, so 819 does not need re-running.

---

## 9. What needs outside counsel, not an engineer

I am not counsel and have not formed a view on any of these.

1. **Does the shipped mechanism — an unkeyed, deterministic, cross-site-stable device digest —
   forfeit the ePrivacy Art. 5(3)(b) "strictly necessary" exemption?** The DPIA asserts it does not;
   the assertion rests on properties that do not exist. This is the question the whole record turns
   on.
2. **Was there a notification-triggering event?** Nothing false has been published to a data subject
   (§5) and the population is ~5 pilot/dev sessions with no identified individuals. Whether that
   combination engages any Art. 33/34 or UODO duty is a counsel call, not mine.
3. **Retroactive validity of consents already collected.** Consents were obtained against a banner
   whose byte-locked sentences are accurate (§4), but under a DPIA whose Mode A description is not.
   Whether the DPIA defect reaches the validity of those consents is a legal question.
4. **Is a per-tab random token in `sessionStorage` (Path C) inside 5(3)(b), or does it still need
   consent?** My engineering read is that it is the strongest available position and materially
   easier than today's; the ruling is counsel's. Note the SDK asks for consent anyway (§7 Path B),
   so the practical exposure is low either way.
5. **Path B only:** can a legitimate-interest basis carry a persistent cross-site device identifier
   after EDPB 02/2023 and the ICO's December 2024 fingerprinting position (both already cited in
   `docs/MASTER_DESIGN.md:680`)? If not, Path B is not a documentation exercise but a product change
   with a different name.

---

## 10. Escalation flags beyond ESC-069 (identified, not written — I filed nothing)

1. **Compliance posture change.** Whichever path is chosen alters the documented lawful basis for
   the core processing activity. CLAUDE.md lists "change pricing, billing, or **compliance
   posture**" as escalation-class. **This needs a CEO ruling recorded in ESCALATIONS.md before
   either path starts** — it is the decision this document exists to inform, and it should be
   minuted, not inferred from a merged PR.
2. **A P1 security defect found by a test-adjacent read (6.2).** "A test reveals a security issue"
   is escalation-class. The un-tenant-scoped `consent_records` delete should be filed as a bug and
   escalated, independently of the path chosen.
3. **Four unenforced retention promises in an Art. 30 record (§3).** These predate this finding and
   need paired data-engineer TTL tickets (`adaptation_decisions`, `llm_calls`, `intent_events`,
   `session_embeddings`). Not a new escalation if filed as tickets — but the ROPA rows must be
   marked UNENFORCED until the TTLs exist, because a Art. 30 record that states a retention period
   with no mechanism is the same class of defect as the one this whole document is about.
4. **The go-live gate in `EXTERNAL_BRAND_GOLIVE_CHECK-2026-07.md:324` is currently UNSATISFIABLE.**
   It instructs a brand deployment to publish `PRIVACY_NOTICE_TEMPLATE.md` §1 — a paragraph
   containing a false statement about the shipped behaviour. Under my own standing rule, a
   pre-flight gate that references a behaviour the code does not produce is a disguised P0 and must
   be marked UNSATISFIABLE until the behaviour exists. **Under Path C it becomes satisfiable the day
   the ~5-line change ships.** Under Path A it stays unsatisfiable (day scope ≠ tab scope). Under
   Path B the §1 paragraph must be rewritten before any brand publishes it.

---

## 11. Follow-up tickets this measurement implies (not filed — numbers not minted)

Per Rule AN I have not minted numbers. Recommended shape, whichever path is chosen:

- **P0, sdk-engineer** — implement the chosen identifier;
  `blocks: [FOLLOW-815, FOLLOW-820 cond. 2]`. Red-first AC: a test asserting two independent
  `generateSessionId()` calls in fresh contexts produce **different** values. Today
  `packages/sdk/src/__tests__/session.test.ts:48-52` asserts the exact opposite —
  `it('produces the same ID for the same environment inputs (deterministic)')`,
  `expect(id1).toBe(id2)`. It is a green test that pins the defect in place, and it must be inverted
  in the same PR.
- **P0, compliance-engineer** — corpus correction sweep across the four documents (§4 tables are the
  work list), with a `depends_on` on the code ticket so no document asserts a behaviour before it
  ships.
- **P1, backend-engineer** — add the missing `tenant_id` predicate at `dsr/erase/route.ts:327`
  (6.2).
- **P1, sdk-engineer** — stop attaching a device fingerprint to the `consent.denied` event (6.1);
  resolved automatically by Path C, still needs its own regression test.
- **P1, data-engineer ×4** — TTL enforcement for `adaptation_decisions`, `llm_calls`,
  `intent_events`, `session_embeddings` (§3), each paired to the ROPA row it makes true.
- **P1 — unfreeze/close FOLLOW-146** (open since 2026-05-28): thread `__estalara_xid__` onto event
  payloads. Under Path C this is what restores lawful cross-visit continuity; under any path it is
  what makes the shipped banner disclosure non-vacuous.

---

## 12. Evidence index (every claim above, re-runnable)

```
git rev-parse HEAD                                        → 5704a31f24caa551…
git log --oneline --reverse --all -- packages/sdk/src/core/session.ts | head -1   → 852f5dee (2026-05-10)
git show 852f5dee:packages/sdk/src/core/session.ts        → generateSessionId() byte-identical to HEAD
git log -1 --format=%ad --date=short cd407336             → 2026-05-15  (the DPIA, 5 days AFTER the code)
git log --all -S "day_bucket" --oneline                   → docs/backlog commits only; never code
grep -rn "day_bucket\|dayBucket" --include=*.ts --include=*.py --include=*.sql packages apps infra → (empty)
grep -rniE "hmac" packages apps --include=*.ts | grep -v test   → ab-holdout.ts, adapt.ts, auth/middleware.ts only
```

Production ClickHouse (read-only, `doppler run -c prd`, user `ingest_worker`):

```
SELECT count(), uniqExact(session_id), uniqExact(tenant_id) FROM events   → 250, 6, 1
-- per-session spans: 106h/4d, 84h/5d, 80h/2d, 51h/2d, 41h/3d  (§2.1)
SELECT name, create_table_query LIKE '%TTL%' AS has_ttl, total_rows FROM system.tables
  → events 1 | adaptation_decisions 0 | llm_calls 0 | intent_events 0 | session_quality 0 | dsr_audit_log 0
```

Live surface: `GET https://app.estalara.com/en/legal/policy` → no session-identifier sentence
present (§5).

NEXT: put §8 in front of the CEO for a Path A / B / C ruling, record it in ESCALATIONS.md as a
compliance-posture decision, and — whichever way it goes — file 6.2 as a P1 bug today, since the
un-tenant-scoped `consent_records` delete is wrong under all three paths.

---

## 13. Outcome — appended 2026-08-24 (FOLLOW-1107). Nothing above this line was altered.

**Path C shipped.** ESC-070 was ruled by the CEO on 2026-08-24 in favour of Path C, and the code
landed the same day as **FOLLOW-1106 / PR #844, merged `d9160da0`**. `generateSessionId()` now
returns `crypto.randomUUID()`, with an RFC-4122 v4 value built from `crypto.getRandomValues()` on a
non-secure-context page and an explicit rejection when neither API exists — **no fingerprint
fallback on any rung.** `getOrCreateSession()` still reads `sessionStorage` first, so intra-session
stability is unchanged and no consumer moved, exactly as §7 Path C predicted. The determinism test
at `packages/sdk/src/__tests__/session.test.ts` was **inverted, not deleted**, and four further
tests now pin the mechanism (500 distinct ids; `crypto.subtle.digest` never called;
`navigator`/`screen`/ `Intl` never read; loud rejection with no CSPRNG).

**Corpus corrected.** FOLLOW-1107 landed the document sweep this assessment's §4 specified:
`dpia.md` → v2.20 (new §2.2.1 is the single anchor for identifier claims), `lia-template.md` → v2.0
(balancing test **re-derived**, not edited), `ropa.md` → v2.15 (Activity 2 rewritten in full and
renamed), `PRIVACY_NOTICE_TEMPLATE.md` → v1.8 (§1, the one user-facing sentence, is now true
end-to-end). The two **inverted** claims — `dpia.md`'s "cross-session linking is technically
impossible" and `lia-template.md`'s "cross-site tracking is architecturally impossible" — were
replaced by bounded statements naming three residual linkage vectors (`__estalara_xid__`, `lead_id`,
network/behavioural metadata), and `lia-template.md` §A.3 records why the absolute form must not
return. FOLLOW-150's dual-id-narrative collision is closed.

**Which of §10's flags moved:**

| §10 flag                                             | Status at `d9160da0`                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1 — compliance-posture ruling needed                 | **CLOSED** — ESC-070, CEO, minuted                                                                                       |
| 2 — un-tenant-scoped `consent_records` delete (§6.2) | **FIXED** — the tenant predicate is present at `dsr/erase/route.ts` (FOLLOW-1108)                                        |
| 3 — four unenforced retention promises (§3)          | **OPEN** — now marked UNENFORCED in the ROPA and DPIA rather than stated as fact (FOLLOW-1110 / 1111 / 1112 / 1113)      |
| 4 — `EXTERNAL_BRAND_GOLIVE_CHECK` §1 UNSATISFIABLE   | **SATISFIABLE** for the §1 identifier sentence as of `d9160da0`; §2's 7-day denial-log paragraph is now the blocking one |

**One finding this assessment noted only in passing turned out to be the sharper one.** §6.1
observed that the `consent.denied` disclosure covers a 7-day denial log while the ClickHouse row
lives 13 months. Path C removed the fingerprint from that row, but not the retention mismatch — and
that mismatch is, unlike anything in the identifier finding, **already rendered to data subjects**
in three byte-locked locales. Filed as **ESC-071**; the pre-existing ticket is FOLLOW-140 (open
since 2026-05-28).

**Two things surfaced while verifying the corrections, recorded here so they are not lost:** the
Redis `session:{session_id}:*` namespace that the ROPA gave a 30-minute TTL has a deleter in the DSR
path and **no writer anywhere in this repository**; and `archetype_embeddings` is populated by an
idempotent seeder over fixed archetype definitions, not by a nightly differential-privacy
aggregation over visitor session embeddings — so the k-anonymity/DP control the corpus cites in
several places needs its own measurement before any balancing test weighs it. Both are outside
FOLLOW-1107's work list, are flagged in the documents rather than swept, and need tickets.

**Counsel questions in §9 remain open.** Path C makes questions 1 and 4 materially easier — the
mechanism is now a per-session random token rather than a persistent cross-site device digest — but
easier is not answered, and no legal conclusion has been drawn in any document in this sweep. Two
that had been drawn on the old premise were **withdrawn** rather than restated (`dpia.md` §6.2's
"the Estalara Mode A falls within this characterization" and §4 Risk E's "the strictly necessary
legal analysis is well-grounded in current ICO guidance").
