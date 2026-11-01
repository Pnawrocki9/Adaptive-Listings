# FOLLOW-1316 — Cross-Visit Buyer Profile: Compliance Design Review

**Type:** design half of the compliance gate, written before any code exists. **Date:** 2026-11-01.
**Base:** `origin/main` `179b4d4c`. **Author:** Compliance Engineering (not a lawyer). **Not the
merge gate:** a second, signed review of the finished PR is. **Not a disclosure:** nothing here
tells a data subject anything, and every requirement below describes behaviour that does NOT exist
yet. Section 1 is the only part that states what the code does today, and each statement cites the
line.

The build itself is not reopened: the CEO approved it on 2026-10-16 (ESC-085 D-E). Localhost holds
no real data subjects, so everything in section 9 "before production" binds the CTO handover, not
the localhost build.

## 0. What would force a rebuild if found later

| #   | Finding                                                                                                                                                                                                 | Consequence for the design                                  | Req.          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------- |
| B1  | **No in-product withdrawal exists.** The AC "withdrawal deletes the stored profile" has nothing to hang on.                                                                                             | A new control ships in this ticket.                         | R24-R28       |
| B2  | **`/api/adapt` has no effective consent gate**, and the SDK sends it a non-canonical vocabulary.                                                                                                        | A new gate, not reuse of `assignHoldout`'s skip.            | R5            |
| B3  | **Every existing denial path erases the xid locally and tells the server nothing.** Erase first and the profile's key is gone for good. `getOrCreateCrossSessionId()` also re-mints on read.            | Delete-then-erase order; a read-only accessor for sending.  | R2, R25, R26  |
| B4  | **The ticket's "send `xid` with events" must not be built.** Every store it would reach outlives 90 days, one of them with no retention at all.                                                         | xid goes to `/api/adapt` and the profile routes only.       | R3, R4        |
| B5  | **`POST /api/dsr/initiate` refuses every caller today**, so K4b's "revoked through DSR" cannot be driven through it.                                                                                    | Self-service routes; the erase route takes an optional xid. | R30, R31, R33 |
| B6  | **A stable arm contradicts a standing CEO ruling.** Decision #5 (2026-09-13) makes the tab session the unit of assignment. The ticket's AC changes it. It needs a recorded ruling, not an implicit one. | ESC-090 item; arm code is one parameter, so no rebuild.     | R39-R41, D-1  |

None of these blocks building on localhost except that D-1 should be recorded before the holdout
code lands.

## 1. Verified from the code

| Question                          | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                    | Reference                                                                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What is `xid`?                    | `{id, created_at}` under `localStorage['__estalara_xid__']`; a random UUID, rotated after 90 days, read from no device attribute. **The fallback is `Math.random`**, unlike the session id, which rejects when no CSPRNG exists.                                                                                                                                                                                                           | `packages/sdk/src/core/session.ts:206,209,232-240,252`                                                                                                                                             |
| Where is it created?              | Only after consent: the banner's `onGranted`, and on load when the state is already `granted`.                                                                                                                                                                                                                                                                                                                                             | `packages/sdk/src/core/consent-flow.ts:84,131`                                                                                                                                                     |
| Is it sent anywhere?              | No. `cross_session_id` appears in no SDK file. Ingest would accept it on `intent.snapshot` and write it to Postgres.                                                                                                                                                                                                                                                                                                                       | `apps/ingest/src/handlers/events.ts:395`; `apps/ingest/src/handlers/intent-snapshot.ts:310`                                                                                                        |
| Where is banner consent recorded? | **In the browser:** `localStorage['estalara_consent']`, with no version and no expiry. **On the server:** only a `consent.granted` event, payload `{language, method}`, in ClickHouse `events` under `session_id`, deleted at 180 days. No text version, no hash, no xid. `consent_records` is written only by platform registration; the banner never writes it. A `granted` buyer is never re-prompted, so a text change reaches nobody. | `session.ts:27,49`; `packages/shared/src/schemas/events/consent.ts:27-41`; `packages/shared/src/consent-retention.ts:70`; `apps/control-plane/src/app/api/v1/consent/platform-registration/lib.ts` |
| How is consent enforced?          | Ingest gates on the `consent_state` the client sends. It is an assertion, and the server cannot check it for an anonymous buyer. `/api/adapt` does not gate at all: `consent_mode_enabled` defaults to `false` and no SDK code sends it.                                                                                                                                                                                                   | `apps/ingest/src/consent-gate.ts`; `apps/control-plane/src/app/api/adapt/route.ts:86,742`                                                                                                          |
| Vocabulary                        | Events send `consented` / `none` / `legitimate-interest`. `/api/adapt` is sent `granted` / `denied` / `unknown`, and `granted` and `denied` are not in `ConsentStateSchema`. `denied` is also absent from `SKIP_CONSENT_STATES`.                                                                                                                                                                                                           | `packages/sdk/src/core/events.ts:34-40`; `packages/sdk/src/core/adapt.ts:796`; `packages/shared/src/schemas/event.ts:29`; `packages/shared/src/ab-holdout.ts:24`                                   |
| Can a buyer withdraw?             | Not in the product. `setConsentState` has two callers, both in the banner, and the banner renders only while `pending`. The §H.9 toggle is an opt-out and never touches consent. "Withdraw" appears in no SDK UI file. **Disclosure 13.2 ("deleted if you withdraw consent") and Notice §3 ("clicking 'Withdraw consent' in the personalization banner") describe a control that does not exist.**                                         | `consent-flow.ts:60,81,94`; `apps/control-plane/public/consent-text.json`; `docs/AUDIT-2026-09-13.md` C-6                                                                                          |
| Does a denial reach the server?   | No. The stored-`denied` branch and `onDenied` call `eraseCrossSessionId()` directly.                                                                                                                                                                                                                                                                                                                                                       | `consent-flow.ts:47,96`                                                                                                                                                                            |
| Can a DSR start?                  | No. `initiate` now refuses every caller (no verified claim carries a `tenant_id` since FOLLOW-1335) and would then 404 on the never-written `session_embeddings`. Erase, access and portability work only from a seeded row, and only by `(tenant_id, session_id)`. Access and portability are `GET`.                                                                                                                                      | `apps/control-plane/src/app/api/dsr/initiate/route.ts:102-110,147-165`; `dsr/access/route.ts:68`; `dsr/portability/route.ts:67`                                                                    |
| Opt-out                           | `?profiling_opt_out=1` returns neutral before tenant resolution, the holdout and any logging. A restore placed after it inherits that.                                                                                                                                                                                                                                                                                                     | `apps/control-plane/src/app/api/adapt/route.ts:652-669`                                                                                                                                            |
| Holdout                           | Stateless `HMAC(secret, tenant_id\nsession_id)`. Nothing is stored.                                                                                                                                                                                                                                                                                                                                                                        | `packages/shared/src/ab-holdout.ts:139-151`                                                                                                                                                        |
| GPC                               | **No code reads `navigator.globalPrivacyControl`**, while the ROPA and the DPIA say the signal is honoured. This is a false statement in the record today, independent of this ticket.                                                                                                                                                                                                                                                     | grep over `packages/sdk/src` and `apps/control-plane/src` returns 0; `docs/compliance/ropa.md:159`; `docs/compliance/dpia.md:1215,1295`                                                            |
| Redis helpers                     | `tenant-schema.ts` puts the value in the URL and swallows errors; DSR erase does not check HTTP status or command errors (R-01). Neither pattern may be copied.                                                                                                                                                                                                                                                                            | `apps/control-plane/src/lib/tenant-schema.ts:85-100`; `dsr/erase/route.ts:80-133`; FOLLOW-1308                                                                                                     |

## 2. Q1 — consent

**Does the ESC-070 distinction hold? Yes, for what ESC-070 banned, with one repair.** ESC-070 Path C
banned an identifier computed from the device: deterministic, re-derivable, colliding, present
before any decision. `xid` is none of those: drawn at random, minted after consent, erased on
denial. The repair is R1: once `xid` is a server-side key it is a bearer credential, and the
`Math.random` fallback the DPIA already concedes (§13.2) is not acceptable for one.

**What the distinction does not buy.** Randomness is not an exemption. Storing and reading `xid`
still engages ePrivacy Art. 5(3), and a persistent random id tied to an inferred profile is still
personal data under pseudonymisation. It settles the mechanism, not the lawful basis.

**Consent category: consent (Art. 6(1)(a)), never legitimate interest.** DPIA §13.2 concludes under
legitimate interest but says in terms that it "does not pre-approve the server-side linking that
FOLLOW-146 would introduce". DPIA §2.2 excludes Mode C for marketing personalisation, and the
compliance review of FOLLOW-1358 (C3) already refused legitimate interest for `quiz_runs`. Notice
§3's "carried out under the legitimate interest" must go. This is a posture change, hence ESC-090.

**Is the existing wording enough? Engineering read: no, not for production.** The served sentence
is:

> To remember your preferences across visits, we store a pseudonymous identifier in your browser for
> up to 90 days. This identifier is refreshed every 90 days and is deleted if you withdraw consent.

Once this ships, three things differ from what it says: the identifier leaves the browser; an
inferred profile is stored on a server under it, which "in your browser" reads as excluding; and
"your preferences" describes something the buyer set, whereas an archetype is something we inferred.
The sentence stays literally true about the identifier and misleads about the processing. ADR-0014
§5 states the project's own earlier position, "no cross-session profiling without re-consent", and
`docs/AUDIT-2026-09-13.md` (persistence decision) expected a consent-text bump for this exact
feature.

**ESC-086: yes, this touches it, and it does not inherit its answer.** ESC-086(b) ruled "§1 notice
sentence now, banner only after counsel" for quiz answers stored under a **per-tab** id. Here the
same open question gets harder, because the data now follows the buyer across visits.
Recommendation: follow the ESC-086 pattern for sequencing (notice text with the PR, banner after
counsel), add this to the same counsel question, and gate production on the answer (R8, section 9).
Do not treat ESC-086(b) as having already decided it. The draft sentence for counsel is in section
9; it does not ship, and `consent-disclosures.canonical.json` stays byte-identical in this ticket.

## 3. Q2 — what may be stored

**Recommended value, closed and strict:**

| Field        | Value                                                                                   | Why it is needed                                          |
| ------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `v`          | schema version integer                                                                  | reject stale shapes                                       |
| `archetype`  | canonical id, not in the non-persistable set (R11)                                      | the restore itself                                        |
| `confidence` | number in `[0,1]`, rounded to 2 places                                                  | `/api/adapt` gates on it (`route.ts:61`)                  |
| `source`     | `quiz` or `behavior`                                                                    | the access response, the chat rule R13                    |
| `traits`     | array from `premium`, `works_from_home`, `seasoned_investor`, `will_let`; may be absent | copy continuity; a restored buyer may not retake the quiz |

**Never stored:** free text or chat in any form; the 12-dim chat intent dimensions (24-hour promise,
C-07); the probability map; `answer_path`, `step_ms`, `quiz_run_id`; `session_id` or any session
list; `lead_id`; listing ids or viewing history; IP, user agent, language; the holdout arm
(derivable).

**Traits.** None is on its face an Art. 9 category (engineering read; counsel confirms, L-3), but
they are not equal. `has_children` states who lives in the buyer's household. `residency_goal` and
`buying_from_abroad` can point at nationality or migration status. Held for 13 months under a
per-tab id, these rows cannot be tied back to a browser. Held for 90 days under `xid`, they are read
back and acted on for the same person, on a possibly shared computer. So they stay out of v1, and
including them is decision D-2.

ESC-089 does not decide this. It lifted limits on **what copy may say**, and nothing here restricts
copy: within a session `has_children` keeps working exactly as built. The honest limit of the
exclusion: `family_buyer` itself implies family status and stays persistable, so excluding the trait
reduces the disclosure and does not eliminate it.

**Archetypes.** `diaspora_buyer` and `golden_visa_buyer` can imply origin or migration intent. Since
inferences can themselves reveal special-category data (CJEU C-184/20, for counsel to apply, L-3),
hold them out of persistence until answered. `golden_visa_buyer` is now a trait in quiz v2, but
`diaspora_buyer` is still a v2 quiz result ("Moving back home",
`packages/shared/src/quiz-default-v2.ts:190,326`), so those buyers get no restore until L-3 is
answered. That is a real product cost, and it is part of D-2. K4b is unaffected: it uses
`yield_hunter`.

**Chat.** A label moved by the chat prior is a chat-derived inference, and the served text says "the
intent summary is kept for 24 hours". Keeping that label for 90 days is not literally the summary,
yet a reader would not expect it. v1 does not write it (R13); D-3 can lift that.

## 4. Q3 — where: Redis with an absolute TTL, conditional on the region

| Criterion | Redis key with `EXAT`                                                                                                                                                                                        | H003 handover table + cron                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Retention | **Enforced by the store.** No job to forget, which is the recurring defect (ESC-071; four ROPA rows marked UNENFORCED).                                                                                      | A job plus a read-time check. Precedent exists (FOLLOW-1364).                         |
| Deletion  | One `DEL`, effective immediately.                                                                                                                                                                            | Transactional with the other DSR deletes, but backups may retain rows (undocumented). |
| Residency | **The weak point.** ROPA Appendix A records Upstash as "United States (multi-region)", and its DPF status is unconfirmed (DPIA §4 Risk B). Fine for a 24-hour key; a 90-day profile is a different weighing. | **The strong point.** Supabase EU Frankfurt is on record (ROPA Activity 17).          |
| Loss      | Eviction drops a buyer to neutral, which fails safe.                                                                                                                                                         | Durable.                                                                              |
| Handover  | No migration; one region check.                                                                                                                                                                              | CTO applies SQL and schedules a cron; 503 until then.                                 |
| Localhost | Present (`f817-redis` through `:8078`), unless `SKIP_CHAT=1`, which must make AC(9) fail.                                                                                                                    | Applied by `localhost-up.sh`.                                                         |

**Recommendation: Redis.** Privacy comes down to enforcement by construction against residency, and
residency can be fixed by a configuration fact, while a job's reliability cannot. **Condition:** the
CTO confirms before production that the production Upstash database is EU-only (not verifiable from
this repo). If not, take H003. R19 keeps that swap to one module, so it is no rebuild.

**Rejected: `intent_sessions.cross_session_id`.** It needs no migration and DSR reads it, which is
tempting. But `0028_intent_sessions.sql` says "no short TTL", the table has no row in the ROPA
retention schedule, and each row carries the full probability map. Setting the column would attach
the xid to data held indefinitely.

**Relation to `quiz_runs` / `quiz_completions` (13 months, enforced by
`/api/cron/quiz-retention`).** Different purpose, different key, no link. Those rows measure
accuracy under a per-tab id; the profile acts on a returning buyer. A profile must never be rebuilt
from them (R23), or the 90-day limit would be false in practice. Deleting a profile does not delete
them, so no text may say "all your data".

## 5. Q4 — retention

**Term: up to 90 days, ending when the xid itself expires.**
`expires_at = min(now + 90 d, xid.created_at + 90 d)`, set once by `EXAT` on first write. Overwrites
keep it (`KEEPTTL`). Reads, restores and opt-out never extend it. A sliding TTL would let a day-89
write live to day 179, long after the browser rotated to a new id and lost any way to reach it. With
this formula the profile dies no later than the id, so rotation creates no orphan. An orphan can
still exist if a buyer clears site data; it lasts until the TTL and nothing can read it without the
xid. Record that in the DPIA.

## 6. Q5 — withdrawal and DSR

**Path in a browser holding the xid:** the new control sets `denied` at once, so sending stops; a
`keepalive` delete carries the xid; the local xid is erased **only on a 2xx**; on failure it stays,
and the stored-`denied` branch retries on the next load before erasing. Keeping it briefly is the
price of the delete being reachable at all, and the TTL bounds the failure case.

**Self-service is what makes rights real here.** The buyer has no account and no way to know a
session id. Holding the xid is the proof, so the browser can erase, read and export without an OTP.
That needs R1 (unguessable) and works even after withdrawal.

**Known gaps, stated so nobody claims them closed.**

- FOLLOW-1279 / FOLLOW-1308: `initiate` stays closed. This ticket does not fix it and does not
  depend on it.
- R-01 (unverified Redis results) stays in the session-keyed erase; the profile path must not
  inherit it.
- No mapping from xid to past session ids (R35). Withdrawal cannot reach `quiz_runs` from earlier
  tabs, though ROPA Activity 17 rests those rows on consent. They age out at 13 months. Whether Art.
  17(1)(b) requires more is L-4. The mapping is deliberately not built: it would create the
  cross-session linkage this design avoids.

## 7. Q6 — opt-out, holdout, shared computers

**Opt-out (§H.9): suspend, not erase.** No xid is sent, nothing is read or written, the profile
stays and its clock keeps running; resuming restores it if unexpired. This fits §H.9's "accumulated
state is preserved". DPIA §13.5 reached its sufficiency conclusion on the premise that no new
retained state exists beyond short TTLs, and it cites a "Withdraw" cascade that does not exist, so
it must be re-read (its DPO gate is still PENDING). A buyer who wants deletion uses withdrawal; the
toggle's wording must not suggest otherwise.

**Holdout.** Keeping the arm is a minor privacy matter: it is one pure HMAC over a value already
sent, stores nothing, and takes no demographic signal, preserving the RETRO-002 pattern. It becomes
a purpose matter only for holdout buyers, who get no adaptation for up to 90 days, so a profile held
for them has no use and is not written (R14). The bigger issue is measurement, not privacy: arms per
xid with denominators per session means correlated rows, and it reverses decision #5
(`docs/MASTER_DESIGN.md`, "Decision #5"). That is D-1.

**Shared computer: worth cheap mitigations.** Consent and profile belong to the browser, not the
person. A second person never saw the banner, gets the first person's archetype, and their behaviour
can overwrite it. Copy for `family_buyer` or `retiree_relocator` can reveal something to another
household member. Mitigations: sensitive traits out (R12), no "welcome back" wording (R42), a
visible way to forget (R24), and no restore across a change of logged-in account (R43). Whether the
banner consent can carry the second person is L-5.

## 8. Requirements

**M** = must, blocks the signed review. **S** = should, a departure is explained in the PR. Each
line states its test.

### Identifier and sending

- **R1 M** `xid` uses the session id's ladder: `randomUUID`, then `getRandomValues`, then no xid and
  no sending; `Math.random` is removed. _Test: no-CSPRNG environment yields no xid and no wire
  field._
- **R2 M** Sending uses a new read-only accessor that reads `localStorage` on every send, bypasses
  `_xidCache`, never mints, and returns null unless all hold: `estalara_consent === 'granted'`; id
  unexpired; consent text version acceptable (R6); not opted out; no GPC (R7). _Test: one case per
  condition; a second tab withdrawing stops the first tab's next send._
- **R3 M** `xid` and `xid_created_at` travel only in the POST body of `/api/adapt` and the profile
  routes: never a URL, query string, event, beacon or `GET /api/adapt/description`. _Test: request
  capture across a full session._
- **R4 M** The SDK does not set `cross_session_id` and adds no xid to any event. This narrows the
  ticket's "with events" and FOLLOW-146 AC2. _Test: after a run, the xid value is absent from
  `events`, `adaptation_decisions`, `llm_calls`, `intent_events` and
  `intent_sessions.cross_session_id`._
- **R5 M** The SDK sends canonical `consented` to `/api/adapt`. A new route gate, independent of
  `consent_mode_enabled`, honours `xid` only when `consent_state === 'consented'` and the id is a
  strict UUID v4; otherwise it behaves as if no xid were sent: no read, no write. `granted` is not
  accepted. _Test: table over
  `absent, none, session-only, legitimate-interest, granted, denied, unknown`._
- **R6 M** At grant the SDK records the served `text_version` in `localStorage`; `consent.granted`
  gains an additive `text_version`; one constant names the minimum version valid for this feature.
  Below it, or absent, no xid is sent and the banner can be re-shown. This is what lets counsel's
  text change reach existing consents. _Test: raising the constant stops sending and re-prompts._
- **R7 M** `navigator.globalPrivacyControl === true` means no xid is sent. _Test: unit, plus NC-7._
- **R8 M** Server flag, default off, on only in `localhost-up.sh`: off means `xid` is ignored. The
  control plane deploys on every merge, so without this the path is live before counsel answers.
  _Test: flag off, valid consented xid, no read and no write._

### What is stored and who reads it

- **R9 M** A strict Zod schema holds exactly the section 3 fields; unknown keys are refused. _Test:
  extra key refused; raw store value compared to the schema._
- **R10 M** None of the "never stored" items appears. _Test: raw value inspected in the K4b run._
- **R11 M** One constant lists non-persistable archetypes: `neutral`, `diaspora_buyer`,
  `golden_visa_buyer`. _Test: each writes nothing._
- **R12 M** Traits are filtered through the section 3 allow-list on the server. `has_children`,
  `residency_goal`, `buying_from_abroad` are dropped pending D-2, with no effect on in-session copy.
  _Test: dropped from the stored value and still applied in the session that declared them._
- **R13 M** `source` is `quiz` when the archetype is the quiz result, `behavior` when
  `chatPriorApplied` is false; otherwise nothing is written and the last write stands. _Test:
  chat-moved state writes nothing._
- **R14 M** A write needs all of: valid consented xid; not opted out; AL on; no demo override;
  treatment arm; confidence above `CONFIDENCE_THRESHOLD`. _Test: one negative per condition._
- **R15 M** The store module is imported only by `/api/adapt`, the profile routes and DSR
  erase/access: not analytics, lead ranking, agent summaries or admin. The profile is not
  transferred under §H.8. _Test: an importer allowlist gate._
- **R16 M** The xid never reaches logs, Sentry, LLM prompts, `features_snapshot` or `dsr_audit_log`;
  errors carry code only (the FOLLOW-1358 C1 pattern). `features_snapshot` may carry
  `profile_restored` and `assignment_unit`, keeping the AI Act trail. _Test: forced store error,
  sinks asserted; NC-8._

### Store

- **R17 M** Key `buyer_profile:{tenant_id}:{sha256(xid)}`, so a dump yields no usable credential;
  outside the `session:` prefix; commands by POST body. _Test: the raw xid is absent from keys and
  request URLs._
- **R18 M** Results are explicit: `hit`, `miss`, `error` on read; `deleted`, `not_found`, `failed`
  on delete, checking HTTP status and command errors. Redis unconfigured with R8 on is `error`,
  reported to Sentry by code, never a silent no-op. A read error means neutral; a delete error means
  non-2xx. _Test: HTTP 403 and `[{error}]` each yield `failed`._
- **R19 M** All store access sits behind one module, so H003 replaces one file. _Test: review._
- **R20 M** New `CTO_HANDOVER.md` §4 row gates production on the conditions in section 9, including
  the Upstash region and the H003 fallback. _Test: row present._

### Retention

- **R21 M** Expiry per section 5: `EXAT` at first write, `KEEPTTL` on overwrite, never extended by a
  read. A missing or malformed `xid_created_at` means the xid is ignored. _Test: `PTTL` never grows;
  a day-89 write gets about one day; a far-future `created_at` is capped at 90 days._
- **R22 M** One shared constant drives SDK rotation and server expiry, with a gate in the pattern of
  `check-consent-retention-sync.mjs` that also checks the served sentence. _Test: the gate's
  self-test._
- **R23 M** Restore reads the profile store only, never `quiz_runs`, `quiz_completions` or
  `intent_sessions`. _Test: an empty store with those rows present restores nothing._

### Withdrawal

- **R24 M** A visible withdrawal control in the existing widget, reachable wherever the toggle
  renders, no harder than Accept (Art. 7(3)), in en/pl/es, distinct from the opt-out. _Test: e2e
  click in each locale._
- **R25 M** Order: state `denied` first; `keepalive` delete; local erase only on 2xx; on failure
  keep the xid and retry on next load. _Test: blocked delete keeps the xid; the next load deletes
  and then erases._
- **R26 M** The same delete-then-erase runs in the stored-`denied` branch (`consent-flow.ts:47`) and
  in `onDenied` when a xid exists (`:96`). A halted SDK sends the delete and nothing else. _Test:
  each branch._
- **R27 M** A delete leaves a 24-hour hash-only tombstone; a write against it is refused. _Test:
  delayed write after delete leaves no profile._
- **R28 M** Withdrawal also runs the existing local erases, reverts the DOM and halts. A later grant
  mints a new xid with a new draw and no inheritance. _Test: re-grant restores nothing._

### DSR and rotation

- **R29 M** Rotation needs no call; R21 already ended the profile. _Test: a rotated xid restores
  nothing._
- **R30 M** Self-service POST routes, xid in the body, the same key and origin gate as
  `api/quiz/run`, rate-limited, in the CORS list and the single-tenant route allowlist: erase;
  access; portability as versioned JSON. They work regardless of consent state. _Test: route tests,
  including after withdrawal._
- **R31 M** `POST /api/dsr/erase` gains an optional body `xid`. The delete is awaited inline, not in
  `afterResponse`, and the response reports it; `failed` must not read as completed. _Test:
  route-driven test on a seeded verification row, failure case included._
- **R32 S** Access and portability on the DSR routes take the xid by header or POST, never the query
  string; otherwise FOLLOW-1308 takes it, by written amendment. _Test: per route._
- **R33 M** FOLLOW-1308 is amended so its ownership design covers xid. K4b drives DSR revocation
  through a seeded row, and the evidence says so rather than implying `initiate` works. _Test:
  amendment present._
- **R34 M** `dsr_audit_log` records the action and result without the xid, because that log is
  long-lived and immutable. _Test: audit row inspected._
- **R35 M** No xid-to-session mapping anywhere, and DPIA §8 states the resulting limit. _Test: R9,
  R4._

### Opt-out, holdout, shared computer, accuracy

- **R36 M** Opted out: no xid sent; the server restore sits after `route.ts:653`; no write; profile
  kept, clock running; resume restores if unexpired. _Test: order pinned; NC-5._
- **R37 S** Any `__estalara_profiling_opt_out__*` key suppresses sending, because the flag is scoped
  by lead id and the xid by browser. _Test: scoped key, anonymous session, no xid._
- **R38 M** Toggle copy does not imply deletion. _Test: copy review per locale._
- **R39 M** The arm is keyed on a valid consented xid, otherwise `session_id`, through the existing
  secret; `assignHoldout` stays pure and stores nothing. _Test: two sessions, same arm; no-xid
  fallback._
- **R40 M** A holdout-arm xid gets no read and no write. _Test: NC-10._
- **R41 M** `assignment_unit` is recorded per decision, without the xid, and the SoT sentence
  changes in the same PR, subject to D-1. _Test: value in `features_snapshot`._
- **R42 M** No text tells a buyer they were recognised. _Test: copy review._
- **R43 S** No restore when the logged-in lead id differs from the one last seen in this browser.
  _Test: account switch, no restore._
- **R44 S** A restored buyer can still take the quiz; a new result overwrites without history (Art.
  5(1)(d)), and the ADR-0014 §5 stranding problem does not return. _Test: re-quiz overwrites; TTL
  unchanged._

### Delivery

- **R45 M** The section 10 document edits land in the PR, each behavioural sentence grep-verified
  against merged code (Rule N); text says what holds when the flag is on. _Test: signed review._
- **R46 S** Bundle measured with `scripts/check-bundle-size.ts` early. The limit is 43,136 B and
  this adds a control plus send logic. Withdrawal strings can live in `consent-text.json`; a higher
  limit goes to ESC per the ESC-080 precedent.

## 9. Decisions and legal confirmation

**Human decisions (CEO):**

| #   | Decision                                                                                         | Recommendation                                                                                 |
| --- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| D-1 | Arm per xid, reversing decision #5 for consented sessions                                        | Accept; the ticket needs it. Record correlated denominators; architect updates the SoT.        |
| D-2 | Persist `has_children`, `residency_goal`, `buying_from_abroad`, and the `diaspora_buyer` result? | Not in v1. Cost: a returning family buyer keeps `family_buyer` copy, not the add-on.           |
| D-3 | Persist chat-moved labels?                                                                       | Not until the text discloses it.                                                               |
| D-4 | Narrow "with events" out; no cross-session conversion linkage (DPIA §13.2 purpose (b))           | Accept. Lift stays per session. A later wish needs its own review, and FOLLOW-146 AC2 changes. |

**Legal confirmation needed before production. I am not a lawyer, and every lawful-basis statement
in this record is an engineering read.**

| #   | Question                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L-1 | Does the banner cover server-side persistence of an inferred profile for up to 90 days? If not, is the section-9 draft sufficient, and do earlier consents need renewal? (ESC-086(b) packet.)                      |
| L-2 | One Accept for personalisation and persistence, or a separate choice (granularity)?                                                                                                                                |
| L-3 | Do archetype labels or traits reveal Art. 9 data by inference (`diaspora_buyer`, `golden_visa_buyer`, `residency_goal`, `buying_from_abroad`), requiring explicit consent? Is `has_children` otherwise acceptable? |
| L-4 | After withdrawal, does Art. 17(1)(b) require erasing consent-based rows from earlier sessions that cannot be located (R35)?                                                                                        |
| L-5 | Shared browsers: can one person's consent carry processing that reaches another? Is the consent's indefinite lifetime acceptable?                                                                                  |
| L-6 | Does §13.5 suspend-not-erase still hold with a 90-day server-side profile? (DPO gate already PENDING.)                                                                                                             |
| L-7 | Is Art. 22 engaged by persistent copy adaptation? UAE PDPL and CCPA treatment of the same flow?                                                                                                                    |

**Before production (CTO handover row, R20):** L-1 to L-6 answered; DPO sign-off of the rewritten
§13.2 and §13.5; Upstash EU region confirmed or H003 applied; R8 flag set by the CTO only after
those.

**Draft banner sentence for counsel, EN only. It does not ship and needs the sign-off path of
`consent-disclosures.canonical.json`:**

> To remember your preferences across visits, we store a pseudonymous identifier in your browser
> and, linked to it on our servers, the buyer type we inferred from your activity and quiz answers.
> Both are kept for up to 90 days. They are deleted if you withdraw consent.

## 10. Documents to change (listed, not edited here)

| Document                                                          | Sections                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/compliance/dpia.md`                                         | §2.2 Mode B (the "verified consent record via API" text is not how the banner works); §2.2.1 item 1 ("not currently transmitted"); §2.3 and §2.6 Upstash rows; §2.4 flow; §2.5 new row; §3.1 purpose; §3.3; §3.5; §4 Risk A (line 864; shared computer), Risk B (Upstash), Risk E; §5; §6.3 and §7 GPC (lines 1215, 1295); §7 items 5-6 (a consent `expired_at` and a withdrawal cascade, both to be checked against code); §8 self-service path and the R35 limit; §11; §13.2 rewritten to consent, withdrawal corrected; §13.5 re-read |
| `docs/compliance/ropa.md`                                         | Retention table new row; Activity 2 xid purpose, GPC (line 159); Activity 7 (banner consent is an event, not `consent_records`); Activity 8; Activity 12 unit; **new Activity 18**; Appendix A Upstash (line 427); Appendix B; Revision History. FOLLOW-1204's AC is absorbed here.                                                                                                                                                                                                                                                      |
| `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md`                      | §1 ("A later visit begins with a new identifier" and its implementation record); §3 in full (legal basis, the nonexistent "Withdraw consent" control, the record); §4 xid row plus the R6 key; §5 checklist; §6.3 opt-out vs withdrawal; §7                                                                                                                                                                                                                                                                                              |
| `docs/compliance/lia-template.md`                                 | Lines 138, 238, 312, 494 ("currently untransmitted")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `docs/compliance/README.md`                                       | Index versions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `consent-text.json`, canonical record, `examples/consent-text.ts` | Withdrawal strings only, if R46 takes that route. The 13.2 sentence changes **only after L-1**.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `docs/handover/CTO_HANDOVER.md`                                   | Lines 196-197; new §4 row (R20)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `docs/MASTER_DESIGN.md` (architect)                               | "Decision #5" paragraph; §H.9 seams (profile behaviour); §Snapshot row                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ADR-0014 (architect)                                              | Dated notice on §5; ADRs are immutable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `docs/compliance/C-07-chat-retention-scope.md`                    | Only if D-3 lifts R13                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

**Found while reading, to file separately:** the GPC claims above have no implementing code (R7
covers only this feature's sending); `intent_sessions` has no ROPA retention row; `ingest` accepts a
client-supplied `cross_session_id` into that table.

## 11. K4b negative controls

**Every control is paired.** In the same run and with the same xid, a positive restore is shown
first and the key's presence is asserted, so an empty store cannot pass. Without this, the controls
are vacuous. AC(9) sends no `archetype_hint` in the probe, because a hint alone can produce
adaptation.

| #     | Setup                                                                                           | Must observe                                                                         |
| ----- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| NC-1  | Valid xid and stored profile, `consent_state` absent                                            | Neutral; no store read                                                               |
| NC-2  | The same, each of `none`, `session-only`, `legitimate-interest`, `granted`, `denied`, `unknown` | Neutral; no store read                                                               |
| NC-3  | Withdrawal in a real browser                                                                    | Key gone; local xid gone; same xid replayed gives neutral; next page sends no xid    |
| NC-4  | `/api/dsr/erase` with `xid`, seeded verification row                                            | Key gone; same xid gives neutral; response reports `deleted`                         |
| NC-5  | Opt-out on, then off                                                                            | On: no xid on the wire, neutral, key still present, `PTTL` not raised. Off: restored |
| NC-6  | Key expiry forced by the harness                                                                | Neutral, then no resurrection                                                        |
| NC-7  | Browser capture: pending, denied, GPC on, old `text_version`                                    | No xid in any request                                                                |
| NC-8  | After the whole run, search for the xid value                                                   | 0 hits in the R4 stores, control-plane logs, prompts, Redis keys                     |
| NC-9  | Delete blocked at the network, then reload                                                      | Local xid kept, then delete sent, then erased; key gone                              |
| NC-10 | xid forced into the holdout arm                                                                 | Same arm in session 2; no key ever written                                           |
| NC-11 | Stale second tab or delayed write after withdrawal                                              | No profile comes back                                                                |
| NC-12 | Redis down, or `SKIP_CHAT=1`                                                                    | AC(9) RED or an explicit error, never GREEN; withdrawal delete is non-2xx            |
| NC-13 | Demo override active; `family_buyer` with `has_children`; chat-moved label                      | Nothing from the override or chat path stored; trait absent from raw value           |
| NC-14 | Flag R8 off                                                                                     | No read, no write, neutral                                                           |

Per the plan's K4b STOP rule, a profile restored in any of NC-1 to NC-7 or NC-14 is a privacy
defect: do not merge.
