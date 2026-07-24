# Compliance Engineer — Lessons Learned

## 2026-06-08 / FOLLOW-218

**What I documented/implemented:** Added DPIA §13.3 disclosure for the `estalara_intent_*`
sessionStorage archetype/intent-probability cache introduced by FOLLOW-176 (PR #217). Updated ROPA
Activity 14, Privacy Notice Template §4 client-storage table, and all three document version
headers. DPIA → v2.3. ROPA → v2.1. Privacy Notice Template → v1.1.

**Where a disclosure could have drifted from shipped behavior:** The DPIA §13.3 asserts three
concrete behaviors: (1) the key is written only on consent granted, (2) the key is erased on
denial/withdrawal, (3) the maximum intra-tab lifetime is 30 minutes (`INTENT_STATE_STALE_MS`).
Before writing, I grep-verified all three against `packages/sdk/src/core/session.ts` (functions
`persistIntentState`, `rehydrateIntentState`, `eraseIntentState`) and the call sites in
`packages/sdk/src/index.ts` (lines 209, 260, 329, 455, 595). The constant
`INTENT_STATE_STALE_MS = 30 * 60 * 1000` is byte-for-byte verified at `session.ts:295`. The
sessionStorage API is verified at `session.ts:348` (`setItem`) and `session.ts:427` (`removeItem`).
No claim was made without a matching verified code symbol.

**A guardrail I would add:** Any PR that introduces a new client-side storage write (localStorage,
sessionStorage, IndexedDB, cookie) must include a checklist item in its PR description: (a) key name
exact string, (b) storage API, (c) consent gate code reference, (d) erasure code reference, (e) DPIA
section that will be updated or a FOLLOW stub if the doc update is deferred. This catches the
RETRO-032 pattern (storage added without disclosure) at PR review time rather than at retro time.

---

## 2026-06-08 / FOLLOW-230

**What I documented/implemented:** (a) Resolved ROPA Activity-14 number collision between FOLLOW-218
(intent-state cache, already merged as Activity 14) and FOLLOW-187 (CRM ingest, specced as Activity
14). Decision: keep Activity 14 for intent-state cache (already merged), assign Activity 15 to
FOLLOW-187. Updated FOLLOW-187 stub in `FOLLOW_UPS.md` and both QUEUE.md entries. ROPA → v2.2. (b)
Added 3 missing SDK storage keys to Privacy Notice §4: `estalara_variant:{sessionId}`
(sessionStorage, strictly-necessary), `__estalara_quiz_dismissed__` (localStorage,
strictly-necessary), `__estalara_micro_poll_dismissed__` (localStorage, strictly-necessary). Updated
§4 header from "all five" to "all eight". Grep-verified all 3 against shipped SDK source before
disclosure. (c) Created `scripts/check-privacy-notice-keys.sh` and wired into `ci.yml` as
`privacy-notice-keys-sync` job. (d) Added dual-store erasure model paragraph to DPIA §13.3
connecting client-cache erasure (`eraseIntentState` at `index.ts:209/260`) and server archetype
erasure (DSR cascade FOLLOW-039). DPIA → v2.4.

**Where a disclosure could have drifted from shipped behavior:** The `eraseMicroPollDismissal()`
function exists in `micro-poll.ts` with a docstring saying "Must be called on consent
denial/withdrawal" but grep shows it is NOT called from `index.ts`. I deliberately did NOT disclose
erasure-on-denial for `__estalara_micro_poll_dismissed__` because the code does not implement it.
The disclosure states "not erased on consent denial" — consistent with the actual code. The
docstring/code divergence is a separate P2 issue not owned by this ticket.

**A guardrail I would add:** Whenever a compliance doc PR adds a new ROPA Activity number, it should
grep for any backlog stubs that claim the same number and update them in the same PR. The collision
would have been caught at FOLLOW-218 merge time if the PR description had included a step: "grep
QUEUE.md and FOLLOW_UPS.md for 'Activity 14' and confirm no collision."

---

## 2026-06-08 / FOLLOW-187

**What I documented/implemented:** Added ROPA Activity 15 (CRM Deep-Outcome Ingest,
`conversion_labels`) to `docs/compliance/ropa.md` (v2.3). Added `conversion_labels` row to the
Retention Schedule table. Updated DPIA §2.3 (System Components) and §2.5 (Data Types and Retention).
Filed FOLLOW-234 (data-engineer TTL cron) as the Rule N enforcement complement. Updated QUEUE.md.

**Where a disclosure could have drifted from shipped behavior:** The 13-month retention period for
`conversion_labels` is an intended policy, not an implemented one. Grep of
`packages/db/src/schema/ conversion_labels.ts`, `packages/db/migrations/0019_conversion_labels.sql`,
`0020_conversion_labels_dedup.sql`, and all `apps/` non-test files confirmed no TTL enforcement
exists anywhere. Per Rule N I could not write "13-month retention enforced" without code evidence.
Instead the Retention Schedule row carries `**TTL NOT YET ENFORCED**` and the DPIA §2.5 row carries
`policy only; not yet enforced`, and FOLLOW-234 is marked before-go-live.

**A guardrail I would add:** Any new Postgres table added to ROPA with a stated retention period
must have the data-engineer TTL ticket filed in the SAME PR. A retention claim with no enforcement
code is a Rule N violation. Reviewers must grep for the cron/deletion implementation before
approving any retention period as "enforced" — not as a post-merge follow-up.

---

## 2026-06-19 / FOLLOW-346 (C-07 chat retention DPIA scope brief)

**What I documented/implemented:** Authored `docs/compliance/C-07-chat-retention-scope.md` — a CEO-
ready decision brief answering 5 questions on lawful basis, retention periods, Privacy Notice
updates, intent-vector-only retention, and a live-activation recommendation for the chat NLP bridge
(FOLLOW-346 shadow-only cycle).

**Where a disclosure could have drifted from shipped behavior:** The central fact underlying the
entire brief is that raw chat text is NOT persisted — only the 12-dim intent vector. Before writing
any claim, I grep-verified `ChatIntentDetectedPayload` field list in `schemas.py:58–79` (no
`messages` or `raw_text` field), `write_shadow_intent` in `redis_writer.py:49` (serializes
`payload.model_dump()` only), `ttl_seconds=86400` at `redis_writer.py:40`, and the shadow key format
at `redis_writer.py:37` and `chat-intent-cache.ts:62`. If any of those had shown a `messages` field
being serialized, the LI basis conclusion in Q4 would have been wrong and Q1 would have required a
consent-mandatory finding for the current shadow cycle, not just for future raw-text retention.

**A guardrail I would add:** When a new modal/serverless function writes to any storage (Redis,
ClickHouse, Postgres), the PR must include a comment explicitly listing which fields of the payload
model ARE and ARE NOT persisted. A "model_dump()-serializes-the-whole-object" pattern is fragile: if
a `messages` field is added to `ChatIntentDetectedPayload` later, raw chat text would silently start
being written to Redis without any disclosure review. The schema contract should use an allowlist
(serialize only named fields), not a full model dump.

- **2026-07-17 / FOLLOW-574** · Closed the ClickHouse axis of the DSR Art. 15/20 disclosure:
  full-row export of all 5 `DSR_CLICKHOUSE_TABLES` on access + portability, `events` volume-safe via
  keyset pagination + cap + continuation cursor (CEO ESC-037); disclosure SET derived from the
  constant so it can't drift below erasure. · **Where a disclosure could have drifted from shipped
  behavior:** the brief told me to "mirror the erase side exactly" and filter `intent_events` on
  `intent_session_id` via `resolveIntentSessionId()`. Re-verification (migrations 0015/0016 +
  `clickhouse-tracer.ts`) showed real rows are keyed on the String `session_id` column and
  `intent_session_id` is a zero-UUID default — so BOTH the erase filter AND a mirrored disclosure
  filter match ZERO real rows. Following the brief's letter would have shipped a false-empty Art. 15
  disclosure. I disclosed on the authoritative `(tenant_id, session_id)` key (truthful), filed the
  erase no-op as FOLLOW-581, and logged the deviation in ESC-038. · **Guardrail I'd add:** when a
  delegation brief pins a specific filter column/key, grep the actual WRITER (ingest/Modal) to
  confirm what column real rows populate before trusting the brief's "correctness trap" note — a
  brief can be built on a superseded migration model. (engagement_scores AC(d): PHANTOM CONFIRMED —
  no writer in repo or out-of-repo actors; arms RETRO-176 PHANTOM-STORE count→1; FOLLOW-582.)

- **2026-07-25 / FOLLOW-653** · External-brand go-live technical check (4 axes: privacy-policy
  surfacing, consent umbrella, per-user opt-out, DSR flows) for 3 white-label re-brand clients
  sharing one data pool. Found + fixed a real Rule N gap in the same PR (grep-verified before
  writing): `__estalara_profiling_opt_out__` (shipped PR #337, 2026-06-21) was never added to
  `PRIVACY_NOTICE_TEMPLATE.md` §4 because the CI gate (`check-privacy-notice-keys.sh`) only scans
  `_STORAGE_KEY`/`_KEY_PREFIX`/`_DISMISS_KEY` suffixes — `PROFILING_OPT_OUT_KEY` matched none of
  them. Also found the ticket's OWN framing was wrong on axis 3: the brief (and same-day
  FOLLOW-641/ADR-0019) claimed "no visitor-facing opt-out toggle UI exists" — grep of
  `packages/sdk/src/ui/profiling-toggle.ts` + its unconditional mount at `index.ts:1051` showed the
  toggle has been live and reachable on every brand since 2026-06-21; only per-brand
  appearance/placement (FOLLOW-641 AC-2) is a real residual gap. **Where a disclosure could have
  drifted from shipped behavior:** if I had trusted the delegation brief's premise instead of
  grepping the SDK myself, I would have reported a false P0 ("opt-out unreachable on client brands")
  instead of the real, narrower gaps (hardcoded "Estalara" in DSR emails; consent_text_hash silently
  defaults to the canonical-tenant hash for any tenant that omits it — an audit-integrity risk that
  is new specifically because of white-labeling, not present at one first-party tenant). **A
  guardrail I'd add:** when a delegation brief asserts "X does not exist yet" as the reason a task
  is scoped a certain way, grep for X before accepting the premise — a same-day sibling ticket/ADR
  can itself be built on a stale scan, and propagating that premise into a go-live compliance report
  would itself become a false statement.
