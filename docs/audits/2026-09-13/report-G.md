# Audit report G — AREA 9 (compliance declarations vs code) + AREA 10 (auto-onboarding chain)

Read-only. Repo `/home/asipi/Projects/Adaptive-Listings`, `main` @ `f510f749`. Every claim below was
read at HEAD; no repo file was modified and no mutating git command was run.

**One-line framing.** The compliance _corpus_ (DPIA v2.21, ROPA v2.16, PRIVACY*NOTICE_TEMPLATE v1.9,
all 2026-08-24) is unusually honest — it self-marks its own unenforced claims with ticket ids, and
the consent \_mechanism* is genuinely built and CI-gated. The gaps are (a) three declarations that
exist only in `docs/MASTER_DESIGN.md` prose (fair-housing linter, k-anonymity ≥50, ε≤2), (b) a
consent-_record_ layer that does not exist for the SDK banner, and (c) retention: exactly two
enforced windows in the whole estate. AREA 10's chain is real up to activation and then breaks at
one deliberate, documented hop — the KV api-key record — which makes "copy-paste & go live in 60s"
architecturally unreachable, not merely unfinished.

---

## AREA 9 — Compliance declarations vs code

### C-1 — `packages/compliance` is a 14-line stub; every capability its own docblock claims lives elsewhere or nowhere

- **Claim** The package that names itself "Consent management, data retention policies, and
  fair-housing linter" exports one version constant and nothing else; the same is true of
  `packages/sdk-loader`.
- **Status** ASPIRATIONAL (dead package)
- **Evidence** `packages/compliance/src/index.ts:1-14` — docblock claims the three capabilities,
  body is `export const COMPLIANCE_VERSION = '0.0.0' as const;`. Its only test asserts that string
  (`packages/compliance/src/index.test.ts:7-8`). `packages/sdk-loader/src/index.ts:11` is
  `export const LOADER_VERSION = '0.0.0'`. Consent code actually lives in
  `packages/sdk/src/{ui/consent-banner.ts,core/consent-text.ts,core/session.ts}`,
  `packages/shared/src/consent-retention.ts` and `apps/ingest/src/consent-gate.ts`.
- **Impact on measured pilot** none directly — but it misleads readers into believing a linter
  exists (see C-11, and FOLLOW-824's own note that this has already happened twice).
- **Ticket coverage** FOLLOW-824 (`backlog/QUEUE.md:28249-28268`, **BLOCKED_ON_HUMAN, P3**) is the
  build-or-delete ruling but names only `platform-templates` and `intent-ontology`. `compliance` and
  `sdk-loader` are **NO COVERAGE**.
- **Priority** P3; depends on FOLLOW-824 ruling.
- **Proposed AC** (1) FOLLOW-824's scope extended to `packages/compliance` + `packages/sdk-loader`;
  (2) on delete, both removed from `pnpm-workspace.yaml` and from the "10 packages" count in
  `CLAUDE.md`; (3) if kept, the docblock states "placeholder — no implementation" in its first line.
- **Red-first proof** A test asserting `ls packages/*/src | wc -l` style inventory has no
  `*_VERSION = '0.0.0'`-only package is red today (4 such packages) and green when resolved.

### C-2 — The client-side consent gate is real, sequenced correctly, and fails closed

- **Claim** No behavioral event, no storage write and no tenant-identified request happens before a
  consent decision; a failure to fetch the disclosure halts the page view rather than degrading it.
- **Status** CONFIRMED
- **Evidence** `packages/sdk/src/index.ts:368-517` — gate at step 3a before session init
  (`getOrCreateSession()` is at `:522`). `denied` → erase xid / intent state / quiz cache / opt-out
  flag, destroy host, `return null` (`:374-389`). `pending` → `await fetchConsentText(...)`
  (`:435`); `null` → `earlyHost.destroy(); return null` with **no bundled fallback text**
  (`:437-455`). `packages/sdk/src/core/consent-text.ts:59-75` — `credentials: 'omit'`, no headers,
  no query string, 3000 ms abort, every failure mode collapses to `null`. Byte-shape of that request
  is asserted by `scripts/check-adr-0021-conditions.mjs`; banner copy vs served document vs
  canonical JSON are held equal by `scripts/check-consent-retention-sync.mjs`. Bot UA short-circuit
  before anything at all: `packages/sdk/src/index.ts:346-350`.
- **Impact on measured pilot** none (this is the thing that must be true).
- **Ticket coverage** FOLLOW-815 — `backlog/QUEUE.md:1973` **CODE_COMPLETE_OPERATOR_PENDING**
  (residue: FOLLOW-706 prod count, FOLLOW-868 proof the mailbox is monitored).
- **Priority** n/a.

### C-3 — The server-side consent gate is real, but accepts `legitimate-interest` for profiling-class events, and the SDK emits exactly that for `pending`

- **Claim** `apps/ingest` enforces consent at the storage boundary; the allowed set for
  profiling-class events is `{consented, legitimate-interest}`, and the SDK maps consent state
  `pending` → `legitimate-interest`.
- **Status** CONFIRMED as code; **REQUIRES HUMAN REVIEW** as a lawful-basis question
- **Evidence** `apps/ingest/src/consent-gate.ts:75-80`
  (`PROFILING_ALLOWED_CONSENT_STATES = {'consented','legitimate-interest'}`), `:194-217` classifier,
  `:43-57` the three classes (`profiling` gated, `audit` always, `operational` always) and the
  `session.quality.snapshot` payload-key strip. Consumed at
  `apps/ingest/src/handlers/events.ts:363,380,394`. SDK side:
  `packages/sdk/src/core/events.ts:34-40` — `granted→consented`, `denied→none`,
  `pending→legitimate-interest`, evaluated per batch at `:78`.
- **Why it needs a human** `docs/MASTER_DESIGN.md:682` itself records that EDPB 2/2023 and ICO
  (12/2024) treat behavioral fingerprinting as Art. 5(3) ePrivacy — i.e. **consent**, not LI, in
  EU/UK for marketing purposes. The gate nonetheless treats LI as sufficient for the profiling
  class. The LIA exists (`docs/compliance/lia-template.md` v2.0) but whether it carries this is
  counsel's call. In practice the SDK reaches ingest with `pending` only in the non-browser branch
  (`earlyHost === null`, `packages/sdk/src/index.ts:509-512`, "treat as granted and continue"), so
  the exposure is narrow — but it is the branch nobody watches.
- **Impact on measured pilot** legal-security exposure.
- **Ticket coverage** ROPA Activity 2 already records the ePrivacy 5(3)(b) question as **open with
  counsel** (`docs/compliance/ropa.md:762`). No implementation ticket → **NO COVERAGE** for the
  code-side decision.
- **Priority** P1; depends on a counsel answer.
- **Proposed AC** (1) a recorded ruling on whether LI is an acceptable basis for profiling-class
  events in EU/UK; (2) if not, `PROFILING_ALLOWED_CONSENT_STATES` narrows to `{consented}` and the
  `earlyHost === null` branch stops defaulting to "continue"; (3) a test asserting the non-browser
  branch emits no profiling-class event.
- **Red-first proof** A test that drives `init()` with `createShadowHost()` returning `null` and
  asserts zero profiling-class events reach `dispatchEvents` — red today.

### C-4 — There is no durable consent RECORD for the SDK banner decision (Art. 7(1) demonstrability)

- **Claim** `consent_records` is written only by the platform-registration (logged-in investor)
  endpoint. The anonymous visitor's banner decision — the one that actually gates profiling — leaves
  only a ClickHouse event whose payload is `{language, method}`: no `tos_version`, no
  `consent_text_hash`, no timestamped record of which disclosure version was shown.
- **Status** PARTIAL
- **Evidence** Only writer:
  `apps/control-plane/src/app/api/v1/consent/platform-registration/route.ts:76,779-812` (repo-wide
  grep for `consentRecords` outside `/dist/` and tests returns that file alone). Banner event shape:
  `packages/shared/src/schemas/events/consent.ts:27-40` (granted) and `:58-75` (denied) —
  `language: QuizLanguageSchema` + `method: z.literal('banner')`, nothing else. Emitted at
  `packages/sdk/src/index.ts:471-476` / `:486-492`. By contrast the registration path derives and
  stores a hash: `.../platform-registration/lib.ts:57` (`platform-v1.4-2026-08-07`) and the derived
  `computeConsentTextHash(renderPlatformConsentText(...))`.
- **Impact on measured pilot** legal-security exposure — under Art. 7(1) the controller must be able
  to demonstrate _what_ the subject consented to; today it can demonstrate only _that_ someone
  clicked Accept in some locale.
- **Ticket coverage** **NO COVERAGE** (grepped FOLLOW_UPS/QUEUE/ESCALATIONS/RETROSPECTIVES for
  `consent_text_hash` + `consent_records` — only the registration path appears).
- **Priority** P1; depends on nothing (the consent-text document already carries a version the
  banner could echo).
- **Proposed AC** (1) `consent.granted`/`consent.denied` payloads carry the served consent-text
  version/hash, taken from the fetched document rather than a literal; (2) a `consent_records` row
  (or an equivalent queryable store) exists per banner decision with
  `consent_type='sdk_behavioral'`; (3) the DSR access/portability responses disclose it; (4) the CI
  sync gate covers the new field.
- **Red-first proof** A contract test asserting `ConsentGrantedPayloadSchema` requires a
  version/hash field — red today.

### C-5 — The consent proof expires before the data it authorizes

- **Claim** The consent-decision audit log is deleted at 180 days by a real daily cron, while the
  behavioral data it authorizes lives 13 months in `events` and **forever** in four other ClickHouse
  tables.
- **Status** PARTIAL (both mechanisms work; the relationship between them is wrong)
- **Evidence** `packages/shared/src/consent-retention.ts:70` `CONSENT_LOG_RETENTION_DAYS = 180`;
  `:79` the deletion is scoped to `['consent.granted','consent.denied']` only, with the module
  header stating "every other row in `events` is left to the table's 13-month TTL, which this
  mechanism must not disturb". `infra/clickhouse/migrations/0001_create_events.sql:46`
  `TTL toDateTime(ts) + INTERVAL 13 MONTH`. Cron scheduled: `apps/control-plane/vercel.json` →
  `/api/internal/retention/consent-log`, `0 2 * * *`.
- **Impact on measured pilot** legal-security exposure — between day 181 and day ~395 the estate
  holds profiling data for a session with no record that consent was ever given for it.
- **Ticket coverage** ESC-071 ruled the 180-day figure and FOLLOW-1118 built the mechanism (both
  closed); the _asymmetry_ is **NO COVERAGE**.
- **Priority** P1; depends on C-4 (a consent record outside `events` is the natural fix).
- **Proposed AC** (1) a recorded decision on which of the two windows moves; (2) whichever it is, it
  derives from one constant, the way `CONSENT_LOG_RETENTION_DAYS` already does; (3) a gate asserting
  `consent-proof retention >= behavioral-data retention` for every table in `DSR_CLICKHOUSE_TABLES`.
- **Red-first proof** A unit test asserting `CONSENT_LOG_RETENTION_DAYS >= 395` (or the inverse
  relation after the ruling) — red today at 180.

### C-6 — No in-product consent-withdrawal affordance; Art. 7(3) is an email address

- **Claim** Once `estalara_consent` is `granted` the banner never renders again, and no SDK surface
  flips it back to `denied`. The disclosed withdrawal channel is an email to
  `compliance@estalara.com`.
- **Status** PARTIAL
- **Evidence** Banner renders only on the `pending` branch (`packages/sdk/src/index.ts:390-506`);
  `setConsentState` accepts `'granted'|'denied'` (`packages/sdk/src/core/session.ts:49-51`) and its
  only `'denied'` call site is the banner's Decline button. The §H.9 toggle is a different thing and
  says so — "Reversible — NOT erasure… Hard erasure (Art. 17 GDPR withdrawal) remains on the
  FOLLOW-139 path" (`packages/sdk/src/core/profiling-opt-out.ts:16-18`). Disclosed channel:
  `.../platform-registration/lib.ts:143` ("withdraw this consent at any time by emailing
  compliance@estalara.com"), and `:92-95` states out loud that the mailbox being monitored "is an
  operator obligation, not something this module can enforce".
- **Impact on measured pilot** legal-security exposure. Art. 7(3) requires withdrawal to be "as easy
  as" giving consent; giving it is one click, withdrawing it is an email.
- **Ticket coverage** FOLLOW-868 (proof the mailbox is monitored) is open operator residue on
  FOLLOW-815 (`backlog/QUEUE.md:1978-1980`). The _ease-of-withdrawal_ gap is **NO COVERAGE**.
- **Priority** P1; depends on nothing.
- **Proposed AC** (1) the §H.9 widget (or an equivalent surface) offers "withdraw consent", distinct
  from "suspend personalization", which sets `estalara_consent=denied`, erases every `__estalara_*`
  key, and emits `consent.denied`; (2) an E2E proves no event is dispatched after the withdrawal in
  the same page view; (3) the privacy notice and banner name the in-product channel alongside the
  mailbox.
- **Red-first proof** An E2E that grants consent, withdraws it via the widget, and asserts
  `localStorage['estalara_consent'] === 'denied'` — red today (no such control exists).

### C-7 — §H.9 opt-out is wired end-to-end, including the in-session DOM restore that FOLLOW-1019 said was missing

- **Claim** Opt-out suspends client profiling, drops behavioral events before they are queued,
  actively reverts the adapted DOM without a reload, and is enforced again server-side on both
  `/api/adapt` and `/api/quiz/completion`. Scope is AL-DOM + quiz persistence only, as §H.9 says.
- **Status** CONFIRMED
- **Evidence** In-session restore: `packages/sdk/src/index.ts:1367-1383` — the FOLLOW-1019 fix,
  `restoreOriginalSlots(previousListingId ?? detectListingId())`, with the previously-false comment
  corrected in place. Event suppression: `:1404-1409` ("Do NOT push to eventQueue"), plus
  `:1524,1684,1958`. Server side: `apps/control-plane/src/app/api/adapt/route.ts:1110,1202-1206` (no
  `adaptation_decisions` row is written on this path) and `:1638`;
  `apps/control-plane/src/app/api/quiz/completion/route.ts:404-410` skips persistence. Ingest
  deliberately does **not** read opt-out: `apps/ingest/src/consent-gate.ts:15-20` records the CEO
  ruling that the §H.8 stream must keep flowing.
- **Impact on measured pilot** none.
- **Ticket coverage** FOLLOW-1019 **DONE** — PR #767, `b421a1d5`, 2026-08-18, test
  `follow-1019.test.ts` (`backlog/FOLLOW_UPS.md:38170-38171`). FOLLOW-372 / FOLLOW-383 / FOLLOW-389
  closed.
- **Priority** n/a.

### C-8 — Session identity: the device fingerprint is gone, but a 90-day localStorage identifier is still minted and still goes nowhere

- **Claim** `generateSessionId()` is now 122 bits of CSPRNG in UUID v4 layout (the unkeyed
  `SHA-256(userAgent|screen|timeZone|language)` device digest is gone, and reintroducing it is
  forbidden by test). Separately, `__estalara_xid__` — a UUID with a 90-day TTL in `localStorage` —
  is still created the moment consent is granted and is **never transmitted**, so it is a persistent
  identifier with no purpose. No cookie, canvas, WebGL or AudioContext signal is read anywhere.
- **Status** the fix: CONFIRMED. The xid: PARTIAL (dormant persistent identifier).
- **Evidence** `packages/sdk/src/core/session.ts:85-140` — the docblock records the defect and the
  ruling (ESC-070 Path C, CEO 2026-08-24), and `:126-140` is the three-rung CSPRNG mint with an
  explicit `Promise.reject` rather than a fallback digest. xid: `:206` key, `:209`
  `XID_TTL_MS = 90 * 24 * 60 * 60 * 1000`, `:252-284` create/persist; created at
  `packages/sdk/src/index.ts:468` and `:517`, both commented "FOLLOW-146 will attach xid to event
  payloads". Grep for `cross_session_id` in `packages/sdk/src` returns **nothing** — the field
  exists on the receiving side only (`apps/ingest/src/handlers/events.ts:466-477`,
  `apps/ingest/src/handlers/intent-snapshot.ts:83,310`,
  `packages/db/src/schema/intent-sessions.ts:56`). No `document.cookie`, `canvas`, `WebGL` or
  `AudioContext` in `packages/sdk/src` (non-test). The complete SDK storage-key set is 9 keys, of
  which 4 are `localStorage` (`estalara_consent`, `__estalara_xid__`,
  `__estalara_profiling_opt_out__`, the quiz-dismissal key).
- **Residual** rows minted under the old digest (64-char hex) are still held and are still device
  digests; `SessionState.sessionId`'s own docblock says "nothing re-derives or migrates them"
  (`session.ts:57-66`).
- **Impact on measured pilot** degrades data (cross-session continuity the LIA's necessity test
  depends on is unavailable) + legal-security exposure (storage of an identifier that serves no
  declared purpose is hard to justify under Art. 5(1)(c)).
- **Ticket coverage** FOLLOW-1106 / FOLLOW-1107 **merged** (`backlog/QUEUE.md:1639`, ESC-070
  RESOLVED at `:1641`). FOLLOW-146 (`backlog/FOLLOW_UPS.md:4010-4030`) — **status: OPEN, P0** ("the
  conditional FIRED"), never promoted to QUEUE. Legacy-row remediation: **NO COVERAGE**.
- **Priority** P1 (either wire the xid or stop writing it); depends on nothing.
- **Proposed AC** (1) a ruling: transmit the xid (FOLLOW-146) or delete the mint; (2) whichever is
  chosen, a test asserts the other is impossible; (3) a decision recorded on the legacy 64-char
  device-digest rows (retain / re-key / delete) with a count measured from prod.
- **Red-first proof** A test asserting either "`__estalara_xid__` appears in an outbound event
  envelope" or "`XSESSION_STORAGE_KEY` is never written" — both red today.

### C-9 — DSR: the mechanism is broad and real; the data subject cannot reach it

- **Claim** Access / erase / portability / mutation-poll routes exist, with OTP+Resend verification,
  and erasure covers 5 ClickHouse tables and 7 Postgres tables in one cascade. But
  `POST /api/dsr/initiate` requires a **tenant-scoped agency Bearer JWT** plus the subject's
  `session_id`, and there is no public DSR page and no SDK affordance — so the anonymous visitor,
  whose session id lives only in their own `sessionStorage`, cannot start a request.
- **Status** PARTIAL
- **Evidence** Routes:
  `apps/control-plane/src/app/api/dsr/{initiate,access,erase,portability,mutation-poll}/route.ts`.
  Auth + flow: `apps/control-plane/src/app/api/dsr/initiate/route.ts:7-16` ("Auth: Bearer JWT
  (tenant-scoped agency user)… Confirm session_id belongs to this tenant"). Erase coverage:
  `apps/control-plane/src/lib/clickhouse-dsr.ts:68-77` (`events`, `adaptation_decisions`,
  `llm_calls`, `session_quality`, `intent_events`, all on `session_id`) and `:43-46` (the two
  deliberate exclusions, with reasons); Postgres side
  `apps/control-plane/src/app/api/dsr/erase/route.ts:320,347,378,398,414,426,440`
  (`session_embeddings`, `consent_records`, `conversion_labels` ×2, `engagement_scores`,
  `quiz_completions`, `intent_sessions`).
  `find apps/control-plane/src/app -ipath '*dsr*' -name page.tsx` → nothing; grep `dsr` in
  `packages/sdk/src` → nothing.
- **Impact on measured pilot** legal-security exposure (Art. 12 — the controller must facilitate
  exercise of rights).
- **Ticket coverage** the mechanism: FOLLOW-039 / FOLLOW-455 / FOLLOW-581 closed. The reachability
  gap: **NO COVERAGE**. Note `docs/MASTER_DESIGN.md:4939-4943` lists "Right to access/erasure
  self-service portal dla buyers" under §U.11.4 _Sprint 12+ placeholder spec_, i.e. not built.
- **Priority** P1; depends on C-4 (a consent record gives the subject something to quote).
- **Proposed AC** (1) a data-subject-initiated path exists that does not require an agency JWT —
  either a public page that accepts an email + a value the visitor can read from their own browser,
  or a documented human intake with a named SLA; (2) the SDK/privacy notice tells the visitor how to
  obtain the identifier the intake needs; (3) an E2E drives the path end-to-end without any tenant
  credential.
- **Red-first proof** An integration test issuing `POST /api/dsr/initiate` with **no** Authorization
  header and asserting a non-401 outcome — red today.

### C-10 — Retention: exactly two enforced windows in the estate; everything else has no mechanism

- **Claim** The only enforced retention in the repo is `events` (13-month ClickHouse TTL) and the
  consent-log subset of `events` (180-day cron). `adaptation_decisions`, `llm_calls`,
  `session_quality`, `intent_events`, `session_summary` and `dsr_audit_log` have no TTL clause; no
  Vercel cron deletes from any Postgres personal-data table. `intent_events` declares a 90-day
  window "enforced via TTL cron" that does not exist.
- **Status** PARTIAL — and the ROPA already says so honestly, which is why this is a work item
  rather than a doc-vs-code discrepancy.
- **Evidence** TTL inventory over `infra/clickhouse/migrations/*.sql`: only
  `0001_create_events.sql:46` (`INTERVAL 13 MONTH`) and `0020_description_generations_ttl.sql:31`
  (`MODIFY TTL … INTERVAL 13 MONTH`) contain a TTL. `0014_intent_events.sql:34-43` — "Retention: 90
  days enforced via TTL cron (FOLLOW-266 scope note)… A TTL ALTER TABLE will be added in a follow-up
  migration once the TTL enforcement cron is wired"; no such cron exists.
  `0003_create_adaptation_decisions.sql:9-10` — "no explicit TTL here — inherits default cluster
  retention settings". Crons actually scheduled: `apps/control-plane/vercel.json` → four, of which
  two are retention (`conversion-labels`, `consent-log`) and neither touches Postgres profile data.
  ROPA marks each gap: `docs/compliance/ropa.md:117` (`session_embeddings` "**UNENFORCED
  (FOLLOW-1113)**"), `:186` ("'session scope only' was never true of the server side and is
  withdrawn"), `:221`, `:440`.
- **Impact on measured pilot** legal-security exposure (Art. 5(1)(e)); the `session_embeddings`
  1024-dim behavioral embedding — the derived profile itself — is the highest-stakes row and has no
  deletion path except a DSR request.
- **Ticket coverage** FOLLOW-1110 (`adaptation_decisions`, **P1**), FOLLOW-1111 (`llm_calls`, P2),
  FOLLOW-1112 (`intent_events`, P2), FOLLOW-1113 (`session_embeddings` + `engagement_scores`,
  **P1**, `backlog/FOLLOW_UPS.md:43635-43684`). All four carry `promoted_to_queue: false` and no
  `status:` line → **OPEN, not in QUEUE**. `session_summary` and `dsr_audit_log` are covered by
  neither (`dsr_audit_log` is a deliberate Art. 17(3)(b) retention; `session_summary` is a
  materialized view).
- **Priority** P1 (1113 first, then 1110); depends on the ClickHouse manual-apply constraint
  ([MP-015]).
- **Proposed AC** per-ticket ACs are already written and verifiable; add (5) `session_summary` gets
  an explicit stated disposition so it does not become FOLLOW-1115.
- **Red-first proof** `scripts/` gate asserting every table in `DSR_CLICKHOUSE_TABLES` plus every PG
  table named in the ROPA Retention Schedule has either a TTL clause or a scheduled deleter — red
  today for 6+ tables.

### C-11 — Fair housing: no linter exists, and the CEO's binding condition for re-opening the question has been met

- **Claim** There is no fair-housing linter, no protected-class check and no `brand_safety_score`
  anywhere in the code. Both tickets were CANCELLED by the CEO on two premises — "archetype space is
  purely behavioral, no protected-class signals collected" and "all buyers receive the same complete
  set of listings" — and **both are falsified at HEAD**: `family_stage` (`young_family` /
  `established_family` / `empty_nester` / `retiree`) is inferred from chat text by the Modal
  intent-engine and folded into archetype priors, and `reorder` directives re-rank the listing
  container per archetype.
- **Status** ASPIRATIONAL (the linter) + **REQUIRES HUMAN REVIEW** (the cancellation premise)
- **Evidence** Zero code: grep for
  `fair.housing|fairHousing|FAIR_HOUSING|protected.class|protectedClass|discrimin` across
  `packages`, `apps`, `infra`, `scripts`, `.github` returns only
  `packages/compliance/src/index.ts:2` (a docblock) and unrelated `discriminatedUnion` matches.
  Cancellations: `backlog/QUEUE.md:16975-17000` TICKET-FAIR-001 **CANCELLED 2026-05-13** with
  `cancel_reason` "Not required at this stage — archetype space is purely behavioral, no
  protected-class signals collected. **Re-open if demographic or proxy-demographic signals are ever
  proposed for the archetype space**"; `backlog/FOLLOW_UPS.md:944-953` FOLLOW-034 **CANCELLED
  2026-05-14** — "All buyers receive the same complete set of listings; copy_template and variant
  strings adjust presentation framing only, not which listings are shown." **Premise 1 falsified:**
  `apps/intent-engine/src/schemas.py:68` `family_stage: str | None`, extracted by the Haiku prompt
  at `apps/intent-engine/src/nlp.py:199` and returned at `:390`; consumed as an archetype likelihood
  at `packages/sdk/src/core/intent.ts:509-521`
  (`family_stage=young_family|established_family|empty_nester|retiree`); cached at
  `apps/control-plane/src/lib/chat-intent-cache.ts:36`. Familial status is an FHA protected class
  and age is an Equality Act 2010 protected characteristic.
  `packages/sdk/src/core/playbooks/archetypes/diaspora-buyer.ts:36` additionally declares
  `international_ip_country_mismatch` as a diaspora-buyer signal — a national-origin proxy
  (declarative only; no producer found). **Premise 2 falsified:**
  `apps/control-plane/src/app/api/adapt/route.ts:974-1003` `buildReorderDirective()` emits
  `type: 'reorder'`; applied to the host DOM at `packages/sdk/src/core/adapt.ts:1175-1176`
  (`applyReorderDirective`). Per-archetype `listing_rules.boost_if/suppress_if` +
  `boost_class`/`suppress_class` are declared on every playbook (e.g. `diaspora-buyer.ts:22-27`,
  keyed on `family_area`). The declared design intent was explicit that this gate precedes
  activation: `docs/MASTER_DESIGN.md:4938` — "linter musi być gotowy ZANIM Profile Mode aktywny u
  pierwszego customer — bez tego ryzyko Fair Housing Act violation".
- **Impact on measured pilot** legal-security exposure; **blocks go-live in any US region**. EU-only
  provisioning (§Snapshot.1 row A.3) bounds it today, but the archetype set includes
  `retiree_relocator`, `student_parent`, `family_buyer`, `diaspora_buyer` and `golden_visa_buyer`,
  and EU/UK anti-discrimination law is not silent either.
- **Ticket coverage** both tickets CANCELLED (above); the re-open condition is **NO COVERAGE**.
- **Priority** **P1** (P0 if any US traffic is contemplated); depends on a CEO/counsel ruling, not
  on other tickets.
- **Proposed AC** (1) a dated ruling that re-reads the 2026-05-13/14 cancellations against
  `family_stage` and the reorder directive and states whether the caveat's trigger has fired; (2) if
  it has, a linter that fails CI on any playbook `copy_template` / variant / slot value referencing
  a protected characteristic, and a runtime check on `reorder` that the ordering input contains no
  protected-class-derived dimension; (3) `family_stage` either dropped from the archetype prior or
  documented as a lawful, non-steering input with counsel's signature; (4) DPIA gains a fair-housing
  section (it has none — grep for "Fair Housing" in `docs/compliance/dpia.md` returns nothing).
- **Red-first proof** A test asserting no inferred dimension name in
  `packages/sdk/src/core/intent.ts`'s likelihood table matches a protected-class proxy list — red
  today on `family_stage=retiree`.

### C-12 — k-anonymity ≥50 and ε≤2 exist only in `MASTER_DESIGN` prose, and one of those mentions is a green tick

- **Claim** There is no k-anonymity code, no differential-privacy noise, no scheduled global
  aggregation job and no test. The only code mention is a note saying the opposite.
- **Status** ASPIRATIONAL (the numbers) / STALE (the `✅` in §U.11.3)
- **Evidence** Case-insensitive grep for
  `k_anon|kanon|k-anon|epsilon|laplace|differential.privacy|dp_noise` across `packages`, `apps`,
  `infra`, `.github`, `scripts` returns exactly two hits:
  `packages/sdk/src/__tests__/intent-switch-margin.test.ts:96` (a numeric epsilon in an unrelated
  test) and `apps/control-plane/src/app/api/admin/analytics/rollup/data.ts:12-14` — "This is NOT the
  parked cross-tenant DP-MOAT epic — **plain rollup, no differential privacy**, single first-party
  data pool". Declarations: `docs/MASTER_DESIGN.md:682` ("globalna agregacja … k-anonymity ≥50,
  differential privacy ε≤2"), `:2933-2934` (the mitigation table: "k-anonymity (k≥50) … Differential
  Privacy (ε≤2) — Gaussian noise na embedding updates per epoch"), and `:4931` — a **`✅`** bullet
  inside the §U.11.3 forward-compatibility checklist: "✅ Differential privacy, k-anonymity ≥50, no
  tenant*id w training data". `docs/compliance/ropa.md:226` carries the same claim as a \_security
  measure*: "k-anonymity ≥50 before any cross-tenant use". §Snapshot.1 row F/G is honest ("global DP
  aggregation = design-only").
- **Impact on measured pilot** none today (there is one tenant and one data pool, so there is no
  cross-tenant aggregation to protect); **blocks** any second-tenant or Insights launch, and the
  `✅` + the ROPA security-measure line are the kind of claim a regulator reads as a control.
- **Ticket coverage** **NO COVERAGE** (no FOLLOW/TICKET mentions k-anonymity or epsilon anywhere in
  `backlog/`).
- **Priority** P2 as engineering (nothing to protect yet); **P1 as a doc correction**, because a
  `✅` and a ROPA "security measure" assert a control that does not exist.
- **Proposed AC** (1) `docs/MASTER_DESIGN.md:4931` de-ticked and marked design-only; (2)
  `ropa.md:226` drops the k-anonymity clause or marks it **UNENFORCED** with a ticket id, matching
  the house style the ROPA already uses elsewhere; (3) a stub ticket exists for the aggregation job
  so the numbers have an owner.
- **Red-first proof** A gate asserting no `✅` bullet in `MASTER_DESIGN` names a symbol absent from
  the codebase — red today on this line.

### C-13 — DPIA / ROPA: current, unusually honest, but unsigned — and the DPIA still describes retired Tiers

- **Claim** DPIA v2.21 and ROPA v2.16 are both dated **2026-08-24** (3 weeks before this audit) and
  both self-mark unenforced claims with ticket ids. Neither has DPO sign-off; the UK Art. 27
  representative is unappointed; and DPIA §1 still describes "three integration tiers (Observer,
  Augment, and Native)", retired by CEO ruling 2026-06-05.
- **Status** PARTIAL (content current) / STALE (the tiers paragraph) / BLOCKED (sign-off is a human
  act)
- **Evidence** `docs/compliance/dpia.md:1-8` — "**Version:** 2.21 **Date:** 2026-08-24 … **DPO
  Review Status:** External DPO appointment in progress (DPO-as-a-Service provider). Placeholder
  contact: compliance@estalara.com"; `:37-39` — "The system operates across three integration tiers
  (Observer, Augment, and Native), processes data in four geographic regions (EU, US, UK, UAE)" —
  both halves stale (§Snapshot.1 row A.3: only EU provisioned). `docs/compliance/ropa.md:1-7` v2.16
  / 2026-08-24, "**DPO Review Status:** External DPO appointment in progress"; `:22` "**UK
  Representative (UK GDPR art. 27):** Appointment in progress". Honesty markers:
  `ropa.md:117,186,221,440,762,763`. Adjacent corpus: `PRIVACY_NOTICE_TEMPLATE.md:1-9` v1.9 /
  2026-08-24 with `:87-91` recording that v1.8's DO-NOT-PUBLISH flag was discharged by
  ESC-071/FOLLOW-1118.
- **Impact on measured pilot** legal-security exposure — an unsigned DPIA is not a completed DPIA
  under Art. 35, and the pilot is the first real-subject processing.
- **Ticket coverage** FOLLOW-1114 (`backlog/FOLLOW_UPS.md:43689+`, P1) is the adjacent go-live-gate
  ticket and is effectively discharged by PRIVACY_NOTICE v1.8/1.9. The DPO appointment appears as §5
  DPO-gate rows in the template. The retired-Tiers paragraph in DPIA §1 is **NO COVERAGE** (the
  known terminology-drift ticket, §Snapshot.1 row B.1, scopes MASTER_DESIGN §B.1, not the DPIA).
- **Priority** P1 for the sign-off (human), P3 for the Tiers paragraph.
- **Proposed AC** (1) DPO engaged and the sign-off block replaced with a name and a date; (2) UK
  Art. 27 rep appointed or the UK region formally descoped; (3) DPIA §1 rewritten to the single
  experience and to the regions actually provisioned, with the historical framing dated as the ROPA
  does it.
- **Red-first proof** A gate asserting no compliance doc contains "Tier 1"/"Tier 2"/"Tier 3" or
  "three integration tiers" outside a dated historical block — red today.

---

## AREA 10 — Auto-onboarding chain, hop by hop

| #   | Hop                                                  | State                                     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Tested by                                                                                                                                                               |
| --- | ---------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | URL in → server-side fetch + SSRF guard              | **implemented**                           | `apps/control-plane/src/app/api/detect/route.ts:1-44` (auth via `resolveTenantAccess` + staff override, SSRF block on private IPs/IPv6/bare hostnames, 60 s detection cache, 501 on "Not implemented", 400 `FETCH_FAILED`)                                                                                                                                                                                                                                                                                                                                                                        | route tests; `corpus-gate` CI job                                                                                                                                       |
| 2   | Platform template (L3)                               | **absent (stub)**                         | `packages/platform-templates/src/index.ts:47-54` `matchPlatform()` returns `null` unconditionally; `src/templates/index.ts:30` `export const templates: PlatformTemplate[] = []`. Grep for `platform-templates`/`matchPlatform` outside the package itself: **zero consumers**                                                                                                                                                                                                                                                                                                                    | none (nothing to test)                                                                                                                                                  |
| 3   | DOM / deterministic detection (L1–L2, 11 techniques) | **implemented**                           | `packages/sdk/src/auto-detect/techniques/` — 12 files (`json-ld`, `wordpress`, `angular`, `mui-components`, `css-modules`, `css-in-js`, `drupal-php`, `data-attributes`, `data-estalara`, `article-tag`, + `ai-vision`); priority cascade at `packages/sdk/src/auto-detect/pipeline.ts:81`                                                                                                                                                                                                                                                                                                        | `.github/workflows/ci.yml:511-542` `corpus-gate` — 24 **synthetic** fixtures, pooled precision ≥95% / recall ≥80%, report uploaded                                      |
| 4   | AI Vision (L4/L5)                                    | **implemented, text-only**                | `packages/sdk/src/auto-detect/techniques/ai-vision.ts`; dynamic import + `callAnthropic()` from the detect route. **Sends HTML text, not a screenshot**, contrary to §B.5.1 L5 — measured 0.3 confidence (below the 0.5 threshold → `null`) on a bespoke Tailwind site, per `docs/MASTER_DESIGN.md:31` item (4)                                                                                                                                                                                                                                                                                   | route tests (`ANTHROPIC_API_KEY`-gated)                                                                                                                                 |
| 5   | Generated per-tenant configuration                   | **implemented**                           | `tenant_site_schemas` upsert in `apps/control-plane/src/app/api/schema/activate/route.ts:1-35`; presentation/brand config per ADR-0019 (`docs/adr/ADR-0019-per-tenant-presentation-config.md`, **ACCEPTED** 2026-07-24) backed by `tenants.brand_config` (`packages/db/src/schema/tenants.ts:74`) and `GET /api/config`                                                                                                                                                                                                                                                                           | activate route tests; `packages/shared/src/schemas/presentation-config.test.ts`                                                                                         |
| 6   | Script tag / snippet                                 | **implemented**                           | `apps/control-plane/src/components/onboarding/DetectionPreview.tsx:169-186` `buildSnippet()` — companion detect script + SDK tag carrying `data-tenant-id`, `data-api-key`, `data-decision-url=${CONTROL_PLANE_URL}/api`, optional `data-inquiry-submit-selector`                                                                                                                                                                                                                                                                                                                                 | `DetectionPreview.test.tsx`                                                                                                                                             |
| 7   | `sdk-loader` package                                 | **absent (stub)**                         | `packages/sdk-loader/src/index.ts:11` `LOADER_VERSION = '0.0.0'`. The real loader is the served bundle + companion tag from hop 6                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | none                                                                                                                                                                    |
| 8   | **Activation → working ingest**                      | **BROKEN without an operator**            | `schema/activate/route.ts` writes the Postgres `api_keys` row and returns the raw key, and writes **nothing** to Cloudflare KV (grep `KV`/`allowedOrigins` in that file → zero hits). Ingest authenticates **only** against KV: `apps/ingest/src/auth.ts:75-79` — `kv.get('api_key:'+apiKey)`; `if (!raw) return {ok:false, reason:'unknown_key'}` → 401, **no Postgres fallback**. The KV record is written by one manual CLI: `apps/control-plane/scripts/project-allowed-origins.mts`, requiring `CLOUDFLARE_API_TOKEN` + `DATABASE_URL_ADMIN` (`docs/runbooks/BRAND_PROVISIONING.md:480-535`) | the script has its own guards; the **end-to-end** hop is untested                                                                                                       |
| 9   | Magic-Link email onboarding                          | **absent**                                | `backlog/QUEUE.md:16595-16602` TICKET-040 **BLOCKED**, P1. Grep `magic.link                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | magicLink                                                                                                                                                               | MAGIC_LINK`in`apps/control-plane/src` → zero hits. The wizard is reachable only from an authenticated dashboard session (`/dashboard/onboarding/detect`) | n/a      |
| 10  | Drift detection (daily cron)                         | **implemented; operator-pending in prod** | `apps/data-quality/src/crons/schema_validation.py` — `DRIFT_THRESHOLD = 0.8` (`:151`), `compute_coverage` (`:283-315`), Sentry 24 h dedup (`:405-461`), `schema_validation_history` row (`:366-403`), `cron_heartbeats` (`:463`). Deployed by `.github/workflows/modal-deploy.yml` `deploy-data-quality` (`:85`, `:94-96`)                                                                                                                                                                                                                                                                        | `apps/data-quality/src/crons/test_schema_validation.py`; `scripts/check-cron-heartbeat.sh`. §Snapshot.1 row B.6 is `CODE_COMPLETE_OPERATOR_PENDING` and has not flipped |
| 11  | Drift → anyone finding out                           | **partial / dead branch**                 | Sentry `capture_message` (`:688`, `:792`) + the history row are the live channels. The `schema_drift_detected` event goes to Redpanda topic `estalara.schema` (`:511-562`) and has **no consumer anywhere in the repo** (grep outside `apps/data-quality` → zero) — and per ESC-017 / ADR-0022 the Redpanda hop was retired. No admin email (contrary to §B.6.1 step 4d)                                                                                                                                                                                                                          | cron unit tests only                                                                                                                                                    |
| 12  | Self-healing / auto re-detect / rollback             | **absent**                                | `docs/MASTER_DESIGN.md:1548-1620` §B.6.1 steps 4a–4d (auto re-detection, compare, auto-update, notify) and §B.6.3 auto-recovery are unimplemented: grep `self.heal                                                                                                                                                                                                                                                                                                                                                                                                                                | self_heal                                                                                                                                                               | auto.repair                                                                                                                                              | redetect | rollback`across`apps`+`packages`returns only unrelated hits (an optimistic-UI rollback in`dashboard/quiz/page.tsx:161`). §B.6.2's SDK `schema.drift*detected`telemetry does not exist either (grep in`packages/sdk`/`packages/shared`→ zero;`detectMismatch` is \_archetype* drift, a different concept) | none |

### O-1 — The chain breaks at hop 8, and that break is a ratified design decision, not an unfinished ticket

- **Claim** A tenant who completes the wizard receives a snippet whose `data-api-key` has no
  Cloudflare KV record, so every `POST /v1/events` from that snippet returns 401 `unknown_key`.
  Closing the gap automatically was considered and **rejected**: the KV key is `api_key:<RAW key>`
  and the raw key is never stored in Postgres, so no server can address the record — and giving
  Vercel a CF token with KV write scope was ruled a security-posture change.
- **Status** CONFIRMED (as a break) / the decision: CONFIRMED and closed
- **Evidence** `apps/ingest/src/auth.ts:70-79`; `schema/activate/route.ts` (no KV write);
  `backlog/FOLLOW_UPS.md:18704-18740` FOLLOW-658 — "**STATUS 2026-07-26: ✅ DONE — PR #628**… AC1 →
  `project-allowed-origins.mts`: an explicit, single-command provisioning step (**NOT** an automatic
  projection — the KV key is `api_key:<RAW key>` and the raw key is never stored in Postgres, so no
  server can address the record; and giving Vercel a CF token with KV write scope is a
  security-posture change, not a bug fix)". Runbook consequence:
  `docs/runbooks/BRAND_PROVISIONING.md:480-535`, including the `[]`-means-inherit-in-PG vs
  `[]`-means-deny-all-in-KV trap.
- **Impact on measured pilot** none for the pilot itself (one operator-provisioned tenant); it
  **invalidates the self-serve claim** permanently as designed.
- **Ticket coverage** FOLLOW-658 **DONE** — the gap is closed _as a documented operator step_, not
  as automation. No ticket claims otherwise.
- **Priority** P2 — documentation truth, not code.
- **Proposed AC** (1) §B.4's "Copy-paste & go live" text names the operator step; (2) the wizard's
  success screen states that the snippet is inert until provisioning completes, rather than
  presenting it as live; (3) an integration test asserts a freshly-activated key is rejected by
  ingest until the projection runs (locks the expectation in).
- **Red-first proof** An integration test: activate a tenant, POST an event with the returned key,
  assert 401 `unknown_key`; then run the projection and assert 200. The first half passes today, the
  second half has never been exercised end-to-end.

### O-2 — L3 of a five-layer pipeline is a documented no-op with zero consumers

- **Claim** `packages/platform-templates` is an empty registry whose `matchPlatform()` returns
  `null` unconditionally and which nothing imports; `docs/MASTER_DESIGN.md:688` still advertises "15
  pre-built platform templates" and `:4150` "50+ platform templates".
- **Status** ASPIRATIONAL
- **Evidence** `packages/platform-templates/src/index.ts:47-54`, `src/templates/index.ts:22-30`;
  zero consumers (grep). §Snapshot.1 row B.4.4 already says "⛔ **Blocked** —
  `templates: PlatformTemplate[] = []`" and row B.5 says L3 is "de facto replaced by L1+L2
  coverage".
- **Impact on measured pilot** none (L1+L2 run 100/100 on the synthetic corpus).
- **Ticket coverage** TICKET-032 **BLOCKED** (`backlog/QUEUE.md:16496-16503`, P0 — stale priority);
  FOLLOW-824 **BLOCKED_ON_HUMAN, P3** is the build-or-delete ruling
  (`backlog/QUEUE.md:28249-28268`).
- **Priority** P3; depends on the FOLLOW-824 ruling.
- **Proposed AC** as written in FOLLOW-824, plus: the two template-count claims in
  `MASTER_DESIGN.md:688` / `:4150` are corrected or dated in the same PR.
- **Red-first proof** A gate asserting every package with a non-test export has ≥1 non-test importer
  (Rule I, scoped to `matchPlatform`) — red today.

### O-3 — AI Vision sends text, not a screenshot, which is exactly the case the pilot tenant is

- **Claim** §B.5.1 L5 specifies screenshot+HTML → Claude Vision. The shipped technique sends HTML
  text only, and on the bespoke Tailwind site that is the pilot tenant it returned confidence 0.3
  (below the 0.5 threshold → `null`) with a wrong headline selector. The mitigation is a
  **hand-curated** schema row.
- **Status** PARTIAL / STALE vs §B.5.1
- **Evidence** `docs/MASTER_DESIGN.md:31` item (4) — the measurement, recorded in the repo's own
  changelog; item (5) "Plan A (pilot, teraz — FOLLOW-159): dla bespoke tenantów aktywowany schemat w
  `tenant_site_schemas` jest **kurowany/ręcznie autorski**". Code:
  `packages/sdk/src/auto-detect/techniques/ai-vision.ts`.
- **Impact on measured pilot** none — Plan A (curated selectors) is the pilot's actual mechanism,
  and it works; but it means detection is not what makes the pilot tenant adapt.
- **Ticket coverage** FOLLOW-160 (screenshot-based Vision, Plan B) — filed, not shipped.
- **Priority** P2; depends on nothing.
- **Proposed AC** (1) §B.5.1 L5 is marked "text-only today; screenshot pipeline = FOLLOW-160"; (2)
  the detect route's response distinguishes "detected" from "curated"; (3) a corpus fixture for the
  pilot tenant exists (the open gap §Snapshot.1 row B.5 names as FOLLOW-103).
- **Red-first proof** A corpus case for a bespoke Tailwind page asserting a non-null schema — red
  today.

### O-4 — Drift is detected but the notification path claimed by §B.6.1 does not exist, and one branch is dead

- **Claim** The cron computes coverage, writes history, and raises a deduplicated Sentry message. It
  does **not** email the admin (§B.6.1 step 4d), does not trigger re-detection (4a–4c), and its
  `schema_drift_detected` Redpanda emission has no consumer on a bus the estate has retired.
- **Status** PARTIAL (detection) / ASPIRATIONAL (notification + healing)
- **Evidence**
  `apps/data-quality/src/crons/schema_validation.py:151,283-315,366-403,405-461,511-562,688,792`;
  `docs/MASTER_DESIGN.md:1548-1620` for the claimed flow; ADR-0022 "retire the Redpanda remnants";
  §Snapshot.1 row A.1 records that the Redpanda hop was replaced by direct Modal HTTP under
  ADR-0016.
- **Impact on measured pilot** degrades data — a selector breaking mid-measurement produces a Sentry
  event nobody is paged on, and the run silently stops adapting.
- **Ticket coverage** FOLLOW-817 (deploy job) DONE; the §B.6 row's flip condition is still open
  (`docs/MASTER_DESIGN.md:479`). The **notification** and **healing** legs: **NO COVERAGE**.
- **Priority** P2 for notification (P1 if a drift during the measurement window would invalidate it
  — see below); depends on the B.6 row flipping first.
- **Proposed AC** (1) a drift row raises an alert on a channel with a named human owner (not Sentry
  alone); (2) the dead Redpanda emission is deleted or given a consumer; (3) §B.6.1 steps 4a–4c and
  §B.6.2/§B.6.3 are marked design-only until built.
- **Red-first proof** Insert a synthetic `drift_detected=true` row and assert an alert is delivered
  to the configured channel — red today (no channel is configured).

### O-5 — (i) MINIMUM for a manual pilot on one tenant vs (ii) the "copy-paste & go live" promise

**(i) What one operator can actually do today, by hand, and where the runbook is.**
`docs/runbooks/BRAND_PROVISIONING.md` (1068 lines) is a complete, step-numbered manual path and it
covers every hop the automation does not:

| Step        | What the operator does                                                                                             | Runbook    |
| ----------- | ------------------------------------------------------------------------------------------------------------------ | ---------- |
| 0           | one-time `FIRST_PARTY_TENANT_ID` flip in Doppler **and** Vercel **and** the ingest Worker                          | `:56-85`   |
| 1           | create the `tenants` row                                                                                           | `:146`     |
| 2           | detect + activate (staff path, explicit `?tenant_id`) → captures the raw `est_pub_…` key                           | `:178-247` |
| 3 / 3a / 3b | brand config, per-brand legal identity (required for external brands), `tos_version` grace window                  | `:248-411` |
| 4           | `quiz_enabled` / `al_enabled` flags                                                                                | `:412`     |
| 5           | quiz definition                                                                                                    | `:451`     |
| **6**       | **`project-allowed-origins.mts --apply`** — the only in-repo writer of `KV_API_KEYS`; needs `CLOUDFLARE_API_TOKEN` | `:480-535` |
| 7           | intent weights                                                                                                     | `:740`     |
| B / C       | out-of-repo deploy handoff + per-brand verification checklist                                                      | `:758-830` |

Complementing it: `docs/runbooks/SDK_PRODUCTION_INTEGRATION.md` (416 lines) marks each requirement
`[HOST]` or `[PLATFORM]` — §1 DOM contract, §2 "the listing id MUST update in place on SPA
navigation **[HOST] — the #1 gotcha**", §3 bundle delivery, §9 anti-flicker cloak, §10 loader
placement — i.e. the host page has **action-required** obligations, which by itself contradicts
"admin agencji nie powinien myśleć o CSS selectors". `docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md` (829
lines) is the localhost equivalent. **Verdict: (i) exists and is good.** A pilot needs an operator
with Doppler, Vercel, Cloudflare and Supabase credentials, roughly an hour, and for a bespoke tenant
a hand-curated selector set.

**(ii) The promise in the docs, verbatim, and what must be softened.**

| Claim                                                                                                                                                                               | Where                        | Status at HEAD                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "Copy-paste & go live w 60s — admin wkleja URL… generuje script tag, monitoruje drift **i sam się naprawia** gdy strona klienta się zmieni" + "**15 pre-built platform templates**" | `docs/MASTER_DESIGN.md:688`  | Three falsehoods: no self-healing (O-4), zero templates (O-2), and the snippet is inert until hop 8 (O-1)                                                                            |
| "Filozofia: 'Copy-paste & go live w 60 sekund.' Onboarding na poziomie Intercoma — admin agencji nie powinien myśleć o CSS selectors, schema mapping, ani field mapping"            | `docs/MASTER_DESIGN.md:957`  | Contradicted by `SDK_PRODUCTION_INTEGRATION.md` §1/§2/§9/§10 `[HOST] — action required`, and by the curated-selector Plan A                                                          |
| "Magic Link onboarding flow (paste URL → AI Vision detect → script tag w 90s)"                                                                                                      | `docs/MASTER_DESIGN.md:3802` | Magic Link does not exist — TICKET-040 **BLOCKED**                                                                                                                                   |
| "Zero-config onboarding — Magic Link + AI Vision + **50+ platform templates** + WordPress Plugin… time-to-value <5 min"                                                             | `docs/MASTER_DESIGN.md:4150` | Magic Link absent; 0 templates; WordPress plugin §Snapshot.1 B.4.5 = design-only                                                                                                     |
| "Time to data flowing \| <5min \| Od code paste do pierwszego event w ClickHouse"                                                                                                   | `docs/MASTER_DESIGN.md:1642` | Unreachable from code paste alone: 401 until hop 8                                                                                                                                   |
| "a shadow-mode pilot **is live** on `app.estalara.com`"                                                                                                                             | `README.md:14`               | FALSE and independently measured false: ESC-020 / FOLLOW-820 re-ran `curl … \| grep -c "data-estalara"` at **0** on 2026-08-04 (`scratchpad/audit/follow-820.md`, "On GO" paragraph) |
| "Active development — **Sprint 22b** (Full-Stack Audit Remediation) in progress"                                                                                                    | `README.md:12,22`            | ~2.5 months stale; the live plan is the FOLLOW-820 localhost-first path                                                                                                              |

Note the **architectural** reason (ii) cannot be reached by finishing tickets: ADR-0019 (ACCEPTED,
2026-07-24) redefined a tenant as "a **full white-label deployment of `app.estalara.com`** on the
client's own domain — same app, same known DOM, one shared data pool, one `tenants` row per brand"
(`docs/adr/ADR-0019-per-tenant-presentation-config.md`, Context). Under that model the product does
not onboard arbitrary third-party sites at all, so the §B.4 promise describes a different product
than the one being built.

- **Status** (i) CONFIRMED. (ii) ASPIRATIONAL, and partly superseded rather than pending.
- **Impact on measured pilot** none for execution; **blocks go-live** for any outward-facing
  self-serve claim, and `README.md:14` is a live false statement about production.
- **Ticket coverage** FOLLOW-824 (templates, P3), TICKET-040 (Magic Link, BLOCKED), FOLLOW-160
  (screenshot Vision). The README staleness and the five MASTER_DESIGN claims: **NO COVERAGE**.
- **Priority** **P1** for `README.md:14` (a false production claim, one line); P2 for the
  MASTER_DESIGN claims.
- **Proposed AC** (1) `README.md` Status section restated against §Snapshot.1 + FOLLOW-820 — pilot
  is _not_ live, current path is the localhost gate; (2) each of the five MASTER_DESIGN claims above
  gains an inline "(ASPIRATIONAL — see §Snapshot.1 row …)" marker or is rewritten to the ADR-0019
  model; (3) §B.4's headline distinguishes "operator-provisioned brand onboarding" (built) from
  "self-serve copy-paste" (not built, and not on the current architecture's path).
- **Red-first proof** A docs gate asserting no `README.md` or `MASTER_DESIGN` §B.4 line claims a
  live production pilot while `scripts`-measurable `data-estalara` count on the prod page is 0 — red
  today. Cheaper red-first: a test asserting `README.md` contains no sentence matching
  `pilot is live` — red today.

---

## Area verdict

**AREA 9.** The consent _mechanism_ is the strongest part of this codebase: a correctly sequenced,
fail-closed client gate (C-2), a real server-side gate at the storage boundary (C-3), a §H.9 opt-out
that is wired on both sides including the in-session DOM revert (C-7), a genuinely broad DSR cascade
(C-9), and a compliance corpus that marks its own unenforced claims with ticket ids rather than
hiding them (C-10, C-13). The device-fingerprint defect is fixed at HEAD (C-8). What remains is
three things of different kinds. First, two declarations that exist only as prose and one of them
carries a `✅`: the fair-housing linter and k-anonymity/ε (C-11, C-12). Second, a missing _record_
layer — the banner decision produces no durable, versioned consent record, and the proof it does
produce is deleted 215 days before the data it authorizes (C-4, C-5); combined with no in-product
withdrawal (C-6) and no data-subject-reachable DSR intake (C-9), the Art. 7/Art. 12 story is
mechanically weaker than the DPIA reads. Third, retention: two enforced windows in the entire
estate, with the 1024-dim behavioral embedding among the unenforced (C-10) — already ticketed as
FOLLOW-1110…1113, all four still OPEN and none in QUEUE. **C-11 is the finding I would put in front
of the CEO first**: the cancellation of both fair-housing tickets rested on two premises that the
code has since falsified, and the CEO wrote the re-open condition himself.

**AREA 10.** Hops 1, 3, 4, 5, 6, 10 are implemented and mostly tested; hops 2, 7, 9, 12 are absent;
hop 11 is half-dead; and hop 8 is a hard break that FOLLOW-658 closed _as a manual operator step
after explicitly rejecting automation on security grounds_. That single decision is what separates
(i) from (ii): a manual pilot on one tenant is fully supported by a good 1068-line runbook, while
"copy-paste & go live in 60s" is not a backlog item but a claim about a product the ADR-0019
re-brand model no longer describes. Six doc claims need softening; `README.md:14` ("a shadow-mode
pilot is live on app.estalara.com") is the urgent one because ESC-020 measured it false at 0.

## Open questions for the CEO

1. **Fair housing (C-11).** Your 2026-05-13 cancellation said "re-open if demographic or
   proxy-demographic signals are ever proposed for the archetype space". `family_stage` — with
   `young_family` / `empty_nester` / `retiree` values — is now inferred from chat by the Modal
   intent-engine and folded into archetype priors, and `reorder` directives re-rank the listing
   container. Has the condition fired? (If yes, the linter blocks any US traffic, and the DPIA needs
   a fair-housing section it does not have.)
2. **Lawful basis for profiling-class events (C-3).** `apps/ingest/src/consent-gate.ts` accepts
   `legitimate-interest` as sufficient. `MASTER_DESIGN:682` records the EDPB/ICO position that this
   needs consent in EU/UK. Counsel question; the ROPA already logs it as "open with counsel".
3. **Consent-proof asymmetry (C-5).** Behavioral data lives 13 months (or forever); the record that
   it was consented to is deleted at 180 days. Which number moves?
4. **The dormant xid (C-8).** `__estalara_xid__` is disclosed to users in three languages, minted
   for 90 days, and transmitted nowhere. Wire it (FOLLOW-146, P0, OPEN) or stop writing it?
5. **The self-serve promise (O-5).** Under ADR-0019 every tenant is a white-label deployment of your
   own app. Should §B.4's "copy-paste & go live in 60s" be rewritten to operator-provisioned brand
   onboarding, or is arbitrary-third-party-site self-serve still a roadmap commitment (in which case
   hop 8 needs a security-posture decision about KV write scope)?
6. **`README.md:14`.** It says the pilot is live on app.estalara.com; ESC-020 measured 0
   `data-estalara` occurrences on 2026-08-04. Correct it now, or leave it until FOLLOW-820 GO makes
   it true?
