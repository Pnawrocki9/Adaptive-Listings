# FOLLOW-1316 — Cross-Visit Buyer Profile: Signed Compliance Review of the Finished Build

**Signed by role:** compliance-engineer agent, Estalara Adaptive Listings. **Not a lawyer.** Every
statement about a lawful basis or a legal requirement is an engineering read, and nothing here says
any of this is legally sufficient. **Date:** 2026-11-02. **SHA reviewed:** `eba51b2f` (branch
`sdk-engineer/FOLLOW-1316-session-imports`), which is the first review's `685b4e35` (PR #1132), this
record's documents, and the B-1 fix. **Gate of:** ESC-085 D-E, ESC-090. **Terms:** merging to
`main`, localhost-first. Production is a separate question, section 8.

The code was read as it is, not as its authors reported it. Where this record and the design review
differ on what the code does, this record governs.

## 1. Verdict

**PASS WITH CONDITIONS for merging to `main` on localhost-first terms, at `eba51b2f`.** The
conditions are in section 9. No ESC-090 ruling is broken, no profile was restored where it must not
be, and no xid reached a store it must not reach.

The first signature of this record, at `685b4e35`, was BLOCK on B-1. B-1 is resolved below.

**For production: not passed.** Section 8 lists what must be true first. Several items are not legal
questions and need code.

## 2. Blockers

**None open.**

**B-1, resolved at `eba51b2f`: `Consent corpus sync` was red.** At `685b4e35`,
`packages/sdk/src/core/session.ts:24,26` imported `@estalara/shared` and `./profiling-opt-out.js`,
so `scripts/check-session-identifier-corpus-sync.mjs` exited 1 on G3
(`could not import packages/sdk/src/core/session.ts to execute its claims`), locally and in CI (run
41376659149, step [5/6]). Rule: `.github/required-checks.txt:95` and the gate's contract at line 25.

**The fix, judged on `git diff 5fde72e6 eba51b2f`: behaviour is unchanged.**

- **The move.** The xid block went to `packages/sdk/src/core/xid.ts`. A line diff of the removed
  block against the new file shows only the differences named in the next three bullets, plus one
  trailing blank line. `session.ts` now has no imports, and G3 passes against the real function.
- **Two exports dropped.** `XSESSION_STORAGE_KEY` and `CrossSessionId` lost `export`. No non-test
  code imported them from outside the block. The keys gate matches the constant with or without
  `export`, and still reports 8 keys.
- **Two exports added.** `drawUuid` and `readConsentTextVersion`, unchanged in body, because
  `xid.ts` needs them.
- **The one logic line, `readSendableXid`.** Was: `version === null || version < MIN`, on one read.
  Is: `readConsentTextVersion() === null || isConsentTextStale()`, where stale is
  `version !== null && version < MIN` (`session.ts:94-97`). The same truth table on every input. It
  reads storage twice instead of once, with no side effect. If another tab removes the version
  between the two reads, the id can be sent once; the single read had the same outcome for a removal
  just after it, and `denied` is set before that removal.
- **Comments and citations.** The lead-id comments at `session.ts` and `boot.ts:157` now state the
  localStorage copies truthfully, which closes that item of M-5. They name the scoped opt-out key
  too, already in Notice §4. `dpia.md` and the notice changed citations only. Two of those are
  inside the superseded record of §13.2, which is otherwise verbatim; that record states no current
  behaviour.
- **G8** now reads `xid.ts`; its self-test passes 13 of 13.

`Rule I — wired-or-dead check` was red on #1132 at `685b4e35`. That gate has a documented
pre-existing-red baseline; whether this PR adds to it is for the PR's CI verifier and was not judged
here.

## 3. What was checked, and how

| Evidence                                                                                                                                          | Result                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source read: store, route helper, `/api/adapt`, `/api/dsr/erase`, `session.ts`, `consent-flow.ts`, `profiling-toggle.ts`, `adapt.ts`, `intent.ts` | Findings below                                                                                                                                                 |
| `route.buyer-profile.test.ts`                                                                                                                     | Run here: 57 passed                                                                                                                                            |
| `profile-routes.test.ts`                                                                                                                          | Run here: 35 passed, against the Redis double (the real-Redis mode was not used)                                                                               |
| `erase/route-driven-pglite.test.ts`                                                                                                               | Run here: 23 passed                                                                                                                                            |
| `buyer-profile-store.importers.test.ts`, `sentry-xid-capture.test.ts`                                                                             | Run here: 7 passed                                                                                                                                             |
| `packages/sdk/src/__tests__/follow-1316.test.ts`                                                                                                  | Run here: 48 passed, with `@estalara/shared` aliased to this SHA's source                                                                                      |
| AC(9), runs 272, 273, 276 at `685b4e35`, `[FRESH]`, clean tree                                                                                    | Read: `TALLY green=9`, AC(9) PASS, `privacyViolations: []`, NC-8 scanned 103 requests, 0 hits                                                                  |
| Runs 274, 275, same SHA, between them                                                                                                             | Read: AC(9) PASS with no privacy violation; the run is `UNMEASURED` on ACs 1, 2, 4, 5, 7. So 272, 273, 276 are not three in a row; AC(9) itself passed all 5   |
| Run 271, previous SHA                                                                                                                             | Read: AC(9) FAIL on `d:keyGone`, `c:replayProfileRestore=error`. `685b4e35` graded `d`'s delete and retries an errored read; README §1.3 records the inference |
| `tests/e2e/follow-819/README.md` §1.3                                                                                                             | Read; agrees with the evidence shape                                                                                                                           |
| `packages/sdk/e2e/returning-buyer.spec.ts`                                                                                                        | Read, not run here: every network answer in it is stubbed. The CI job `SDK E2E tests` passes on this SHA                                                       |
| Stack                                                                                                                                             | Not started. Nothing below is a new live measurement                                                                                                           |

**At `eba51b2f`:** the SDK tests `follow-1316.test.ts` and `session.test.ts` were run here, 65
passed, and every gate of section 10. The server tests were not re-run, since the fix touches no
server file. **AC(9) was not re-run at this SHA.** The live evidence is from `685b4e35` and is
carried over on the diff judgement of section 2; the bundle did change, so `SDK E2E tests` on the
merge SHA is part of M-1.

**Not exercised live in any of those runs:** a holdout xid (`heldOut: 0` in all three), Redis down,
the flag off, a blocked delete against the real store, and hosted Upstash.

## 4. ESC-090 rulings

| #   | Ruling                                                                                                                     | Finding     | Reference                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Consent only; up to 90 days ending with the xid, non-sliding; flag default off, on only in `localhost-up.sh`; handover row | Met         | `buyer-profile-store.ts:207-209,225-243,69-80`; `scripts/dev/localhost-up.sh:484`; the variable appears elsewhere only as an empty line in `.env.example`, in tests and in docs; `CTO_HANDOVER.md` section 4 row 20. **Whether production's environment leaves it unset cannot be seen from this repo: condition M-4**                                                                      |
| 2   | Arm per xid for consented sessions, `session_id` fallback; correlated rows in the SoT                                      | Met         | `adapt/route.ts:775`; `ab-holdout.ts:159`; `MASTER_DESIGN.md` "Amended by ESC-090 item 2"                                                                                                                                                                                                                                                                                                   |
| 3   | Not persisted: three traits, `diaspora_buyer`, chat-moved labels. In-session copy unchanged                                | Met         | `buyer-profile-store.ts:36-43`; `intent.ts:128-132`; `adapt/route.ts:1041-1046`. The store also refuses `golden_visa_buyer` (R11), stricter than the ruling. The chat rule rests partly on the SDK's `archetype_source`: the server's own backstop covers `behavior` only (`chatIntentDimensions === null`), and a `quiz` assertion is trusted. A tampering client affects only its own row |
| 4   | xid in `/api/adapt` and profile bodies only; no ClickHouse column; no cross-session conversion link                        | Met         | `adapt.ts:231-252,832-840`; `assignment_unit` and `profile_restored` are JSON inside `features_snapshot`, `adapt/route.ts:388-389`; NC-8 zero hits in all four tables                                                                                                                                                                                                                       |
| 5   | §E.7.5 reversal by #1123 confirmed                                                                                         | Not touched | No playbook or claim file is in this diff. ESC-089 stands; this review restricts no copy                                                                                                                                                                                                                                                                                                    |
| —   | Surfaces approved, all additive                                                                                            | Exceeded    | Three public fields and two behaviours are outside the list: section 7 item 6, and the addendum the PM records                                                                                                                                                                                                                                                                              |

**Consent vocabulary:** `/api/adapt` is sent canonical `consented` and `none` (`adapt.ts:828`). The
gate accepts `consented` alone. `unknown` stays on the `pending` path, which does not reach it, and
`ConsentStateSchema` is unchanged. **Holdout input:** still one HMAC over a random id, no proxy
signal, RETRO-002 pattern preserved. **Protected-class scan of new copy, en/pl/es:** "Withdraw
consent", "Wycofaj zgodę", "Retirar el consentimiento"; no protected class or proxy, nothing shown
to a subset.

## 5. Requirements

M = met. **D** = departure, ruled in section 7. **S-tier** requirements are marked (S).

| Req      | Finding       | Reference and note                                                                                                                                         |
| -------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1       | M             | `session.ts:177-188`, `xid.ts:116-126`; `Math.random` absent from both, test line 742                                                                      |
| R2       | M             | `xid.ts:73-87`; also refuses without SubtleCrypto, which is an addition                                                                                    |
| R3       | M             | `adapt.ts:835-837`, `:231-252`; NC-8 `wireLeaks: []`                                                                                                       |
| R4       | M             | No `cross_session_id` in the SDK; NC-8                                                                                                                     |
| R5       | M             | `adapt.ts:828`; `buyer-profile-store.ts:225-243`; table test line 301; live seven POSTs                                                                    |
| R6       | **D**         | `session.ts:65,94-97`, `xid.ts:76-77`; `consent-flow.ts:114,137,147`. Section 7 item 3                                                                     |
| R7       | M             | `xid.ts:78-79`. **This feature's sending only**; FOLLOW-1438 owns the rest                                                                                 |
| R8       | M             | `buyer-profile-store.ts:207-209`; `quiz/public-config/route.ts:370`. **The routes of R30 are not behind it, by design:** section 7 item 14                 |
| R9, R10  | M             | `buyer-profile-store.ts:95-107`; live raw value `{"v":1,"archetype":"yield_hunter","confidence":0.9,"source":"quiz","traits":["seasoned_investor"]}`       |
| R11      | M             | `buyer-profile-store.ts:36-40`; test line 463; live control (d)                                                                                            |
| R12      | M             | `buyer-profile-store.ts:43,354`; test line 451                                                                                                             |
| R13      | M             | `intent.ts:128-132`; `adapt/route.ts:1041-1046`; tests lines 483, 505; SDK tests 523-614                                                                   |
| R14      | M             | `adapt/route.ts:1041-1049`, past the opt-out, AL and holdout returns; test line 539                                                                        |
| R15      | M             | `buyer-profile-store.importers.test.ts:15`                                                                                                                 |
| R16      | M             | `buyer-profile-store.ts:133-141`; `sentry.server.config.ts` excludes `data`; test lines 1011-1075. See section 7 item 10 on whether Sentry runs at all     |
| R17      | M             | `buyer-profile-store.ts:158-164,187-197`; test line 1096                                                                                                   |
| R18      | **D**         | Results are explicit and checked, `:148-185`. "Reported to Sentry" does not happen in effect: section 7 item 10                                            |
| R19      | M             | One module; the flag read in `public-config` is an env read, kept out on purpose for R15                                                                   |
| R20      | M             | `CTO_HANDOVER.md` row 20; this PR adds a pointer to section 8 below                                                                                        |
| R21      | M             | `buyer-profile-store.ts:69-80,236-241`; live `pttlMs` about 90 days; test lines 725-800                                                                    |
| R22      | M             | `XID_RETENTION_DAYS`; `check-consent-retention-sync.mjs` G8, self-test 13 of 13                                                                            |
| R23      | M             | The store reads nothing else; test line 840                                                                                                                |
| R24      | **D**         | `profiling-toggle.ts:211-223`; `consent-flow.ts:226`. Section 7 items 1 and 13                                                                             |
| R25      | M             | `consent-flow.ts:36-41,63-72`; live control (b); SDK tests 802-873                                                                                         |
| R26      | **D**         | `consent-flow.ts:38,99-111,162-175`. Section 7 item 4                                                                                                      |
| R27      | M             | `buyer-profile-store.ts:69-90`, atomic. **Length departs:** section 7 item 7                                                                               |
| R28      | **D**         | `consent-flow.ts:63-72`; `adapt-loop.ts:167-183`. Section 7 item 5; wider than reported                                                                    |
| R29      | M             | Test line 380                                                                                                                                              |
| R30      | **D**         | `buyer-profile-route.ts`, `middleware.ts:81`, allow-list present; the SDK calls only `erase`. Section 7 item 2                                             |
| R31      | M             | `dsr/erase/route.ts:340-368,378`; live control (c), seeded row                                                                                             |
| R32 (S)  | Deferred      | DSR `GET` routes take no xid; FOLLOW-1308 amended in writing, `backlog/FOLLOW_UPS.md`                                                                      |
| R33      | M             | That amendment; evidence carries `seededVerificationRow: true`                                                                                             |
| R34      | M             | `buyer-profile-route.ts:257-267`; test "records the action and result, without the xid or its hash". Section 7 item 9                                      |
| R35      | M             | No server mapping. The browser entry holds `lead` beside the id: section 7 item 12                                                                         |
| R36      | M             | `adapt.ts:832`; route returns at `:680` before any read; test line 816; SDK test 362                                                                       |
| R37 (S)  | M             | `profiling-opt-out.ts`, `hasProfilingOptOutKey()`                                                                                                          |
| R38      | M             | Toggle words unchanged, `profiling-toggle.ts:85-94`                                                                                                        |
| R39, R40 | M             | `adapt/route.ts:775,845-848`; tests lines 856, 935. A held-out xid was **not** exercised live                                                              |
| R41      | M             | `adapt/route.ts:388-389`; MASTER_DESIGN amended                                                                                                            |
| R42      | M             | `profile_restore` reaches only a debug log (`adapt-loop.ts:358-359`); no text                                                                              |
| R43 (S)  | Narrow        | `xid.ts:86`. A different logged-in lead gets no send. A logged-out session on that browser still sends: section 7 item 13                                  |
| R44 (S)  | M, with a gap | Re-quiz overwrites, `KEEPTTL`; test line 769. "None of these" does not clear the label: section 7 item 15                                                  |
| R45      | Done here     | Section 10                                                                                                                                                 |
| R46 (S)  | Reported      | 43,128 B against the 43,136 B limit, 8 B of room, as reported by the coordinator at `eba51b2f`. Not rebuilt on this machine. The budget is why R24 is thin |

## 6. Negative controls

**Live** = driven by AC(9) on the real control plane, in runs 272, 273, 276. **Double** = route test
over the Redis double. **Stubbed** = real browser with every network answer stubbed, or the SDK
under `_initForTest`.

| NC    | Finding                                                                                                                  | Where proved                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| NC-1  | Holds                                                                                                                    | Live (a); Double                                                                                  |
| NC-2  | Holds, all six states: `profile_restore` absent, neutral, key still present                                              | Live (a); Double                                                                                  |
| NC-3  | Holds: key gone, local id gone, `denied`, next page no `/api/adapt`, replay `miss`, tombstone present                    | Live (b)                                                                                          |
| NC-4  | Holds, `buyer_profile_erasure: deleted`, on a **seeded** row                                                             | Live (c); pglite                                                                                  |
| NC-5  | Holds                                                                                                                    | Double (server); SDK test 362. Not live                                                           |
| NC-6  | Holds                                                                                                                    | Double, line 800. Not live                                                                        |
| NC-7  | Holds. Pending and no text version live; denied, GPC, old version stubbed                                                | Live (a); Stubbed; SDK test 283                                                                   |
| NC-8  | Holds: 0 hits in requests, `events`, `adaptation_decisions`, `llm_calls`, `intent_events`, Redis keys, Postgres and logs | Live (e). `llm_calls` and `intent_events` report `rows: null` with 0 hits                         |
| NC-9  | Holds                                                                                                                    | Stubbed; SDK test 873. Not against the real store                                                 |
| NC-10 | Holds                                                                                                                    | Double, line 935. No draw held out live in these runs                                             |
| NC-11 | Holds                                                                                                                    | Double, including a lost response and a failed undo; the race has a real-Redis mode, not run here |
| NC-12 | Holds                                                                                                                    | Double; `ac9-verdict.test.ts` pins that `error` is RED. Not live                                  |
| NC-13 | Holds                                                                                                                    | Double; live (d) for the non-persistable result                                                   |
| NC-14 | Holds                                                                                                                    | Double, line 395. Not live, since localhost runs with the flag on                                 |

K4b's STOP rule did not fire: no profile was restored in NC-1 to NC-7 or NC-14 in any run read.

## 7. Rulings on departures

"Localhost" means the merge terms: no real data subjects (design review, opening). "Production"
names the section 8 item that holds it.

1. **R24, label with no explanation, no confirmation. Localhost: ACCEPTED. Production: BLOCKER
   (P-2).** On localhost the control works: visible, native button, one click, three locales, and
   the effect is proved. In production a buyer cannot tell what it does before clicking or whether
   it worked after, and a failed delete is silent. Accept is one click with text around it; this is
   one click with none. Whether that meets Art. 7(3) is counsel's; my read is that it should not be
   offered to counsel as the design. **A byte budget is not a compliance reason:** the strings can
   ride `consent-text.json`, as R46 foresaw, or the budget goes to ESC as in ESC-080.
2. **R30, nothing reaches `/access` or `/portability`. Localhost: ACCEPTED. Production: BLOCKER
   (P-3).** The routes are correct and tested. A right a buyer cannot exercise is not exercised: the
   id sits in `localStorage` and `initiate` refuses everyone. The notice therefore promises nothing
   here.
3. **R6, a grant with no recorded version sends no xid and is not re-prompted. ACCEPTED, both.** It
   fails closed, and such a buyer gets no server-side processing, so no consent to it is missing.
   The cost is product only: those buyers never get the feature. Production also needs P-1 on the
   minimum.
4. **R26, a never-sent id erased with no request. ACCEPTED, both.** I checked the premise rather
   than taking it: `markXidSent` writes `sent` before the send and a failure to write stops the send
   (`xid.ts:93-102`, `adapt.ts:834`), and a profile can only exist under an id that was sent. No
   bundle sent the id before this feature.
5. **R28. Localhost: ACCEPTED. Production: BLOCKER (P-4). The gap is wider than reported.**
   `restoreOriginalSlots()` (`adapt-loop.ts:167-183`) restores `headline` and `description` only. So
   **`cta` and `feature` text stay too**, not just class and reorder, and AC(9)'s restored response
   serves exactly `headline`, `cta`, `feature`, `reorder`. No further data is processed by what is
   left on the page, which is why this is not a merge blocker. There is also no way back after
   `denied`; the R28 test reaches a "later grant" only by clearing storage.
6. **`archetype_source`, `profile_restore`: ACCEPTED, with `buyer_profile_enabled`, which was not on
   the list.** All three add no personal data beyond what the caller already holds and are not
   logged. `profile_restore` reaches no text (R42). They are public surface outside ESC-090's list,
   so the PM's acceptance has to be recorded: CLAUDE.md sends such changes to
   `backlog/ESCALATIONS.md`. Condition M-3.
7. **90-day tombstone after a DSR erase. Localhost: ACCEPTED. Production: goes to counsel with L-4
   (P-1).** It is justified: that browser is not told and keeps writing. A SHA-256 of a 122-bit
   random value is useless without the id. It is nevertheless data kept **because of** an erasure
   request, and it can outlive the id by nearly 90 days, since the server does not know `created_at`
   at that point. Disclosed in the §3 draft and DPIA §2.5. A future in-product "erase but stay
   consented" button would need more than the 24 hours of the self-service path.
8. **`sha256(client IP)`, 60 s; client-settable `x-forwarded-for`. Localhost: ACCEPTED. Production:
   CONDITION (P-5).** An unsalted hash of an IPv4 address is reversible by enumeration, so this is
   personal data for its 60 seconds, not an anonymisation, and the docs now say so. A spoofed header
   only sidesteps the quota: the routes hand nothing to anyone without the xid. What it allows is a
   flood of tombstones and audit rows. The header's trustworthiness on the production platform must
   be verified, not assumed; a keyed hash is cheap.
9. **`dsr_audit_log` row per request, no TTL; `consent.denied` with `method: 'banner'`. Localhost:
   ACCEPTED. Production: CONDITION (P-6).** The row holds no personal data as written (tenant, type,
   action, times, `session_id` empty, `email_hash` of an empty string, which a reader could mistake
   for a subject). No retention is promised for it, and the docs now say "no TTL". Rows grow with a
   flood. A withdrawal indistinguishable from a Decline weakens the Art. 7(1) trail, since the log
   cannot show consent was given and later withdrawn. An additive `method` value fixes it, through
   ESC.
10. **Server Sentry apparently not initialised. Localhost: ACCEPTED. Production: CONDITION (P-7).**
    Confirmed as far as the repo shows: no `instrumentation.ts` under `apps/control-plane`, and
    `@sentry/nextjs` 10 loads `sentry.server.config.ts` through it. Not measured at runtime. It is
    no privacy defect here, since fewer recipients is the safe side. It does mean R18's "reported to
    Sentry" is `console.error` plus the wire, for this feature and **for every server capture in the
    control plane**, so DPIA §2.7's Sentry description overstates what runs. When someone adds the
    file, `include: { data: false }` is what keeps the xid out, and that is pinned by test. **Update
    (FOLLOW-1442):** P-7 is met by this change. `apps/control-plane/src/instrumentation.ts` now
    loads the server and edge configs, so with `SENTRY_DSN_CONTROL_PLANE` set the server captures
    reach Sentry and R18's "reported to Sentry" and DPIA §2.7 are true. `include: { data: false }`
    is unchanged and still pinned by test.
11. **Holdout rows log `neutral`, treatment rows the restored archetype. ACCEPTED, both, for
    privacy.** It follows from R40: reading a profile to label a row would read it for a buyer who
    gets no use from it. It is a measurement defect, recorded in MASTER_DESIGN: `by_archetype` lift
    compares unlike cohorts for returning buyers. Whoever reads that split owes the caveat;
    FOLLOW-820's lift evidence must not quote it uncaveated.
12. **`family_buyer`, `lifestyle_expat`, `student_parent` persisted pending L-3. Localhost:
    ACCEPTED. Production: BLOCKER until L-3 (P-1).** `family_buyer` is ruled by ESC-090 item 3. The
    other two are not named there; they are in L-3. **I add `retiree_relocator` to L-3:** it implies
    age. ESC-089 governs what copy may say, not what is stored, and nothing here touches copy. The
    `lead` field in the browser entry is **not** in this list but belongs near it: the 16-hex lead
    id now reaches localStorage, for as long as the entry lives. It is disclosed, and since
    `eba51b2f` the code comments say so.
13. **Withdrawal on a shared computer. Localhost: ACCEPTED. Production: BLOCKER until L-5 (P-1).**
    Person B's click erases person A's profile and denies consent for the browser, with no way back.
    That fails safe. The harder half is B being served A's label without having seen a banner, and a
    logged-out session still sends an id bound to a lead (`xid.ts:86` compares only when `leadId` is
    non-empty). **Also not on the PM's list: the control is absent with the flag off** unless the id
    was already sent (`consent-flow.ts:226`), against R24's "wherever the toggle renders". With the
    flag off the banner sentence "deleted if you withdraw consent" has no control behind it.
    Harmless on localhost, where the flag is on. **This binds the SDK embed in production whether or
    not the flag is ever set (P-2).**
14. **Found, not on the PM's list: `/api/profile/*` go live in production on merge, flag off.** By
    design (R30: a right outlives the flag). Nothing calls them there, since no `sent` id exists. A
    caller with the public key can create tombstones, quota keys and audit rows. **ACCEPTED**, and
    the docs do not describe the feature as dormant. Not behind the flag means P-5 and P-6 apply
    from the first deploy, at the low level that a route nobody calls implies.
15. **Found: "None of these" leaves the stored label.** A returning buyer who rejects a quiz result
    sends `neutral` with no source, the route reads the store, and the old label is restored in that
    same session (`intent-loop.ts:218-224`, `adapt/route.ts:845-848`). An Art. 5(1)(d) accuracy
    question, and nothing tests it. **Localhost: ACCEPTED. Production: CONDITION (P-8).**
16. **Found: another open tab keeps adapting after a withdrawal.** Input: tabs A and B open, click
    in A, navigate in B. Output: B's `POST /api/adapt` carries `consent_state: none` and no xid,
    keeps its session hint, and the route serves and logs a decision, because it gates only the xid
    on consent and there is no `storage` listener. Rule: R28 "halts"; Art. 7(3). R2's test covers
    the xid only. **Localhost: ACCEPTED. Production: BLOCKER (P-4).**
17. **R27 length and R31 order** of the design review's section 12: consistent with the code as
    read.

## 8. Before production

All of these, and none is satisfied today. Items P-2 to P-4 bind the SDK embed (`CTO_HANDOVER.md`
row

1. as well, because the banner sentence already promises withdrawal.

| #    | What must be true                                                                                                                                                                                                                                                                                                                                                                                  | Owner                    |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| P-1  | Counsel has answered L-1 to L-6, with the additions of this record: `retiree_relocator` in L-3; the 90-day tombstone and the 60-second IP hash in L-4. The banner sentence changes only after that (ESC-086(b)), **and `MIN_PROFILE_TEXT_VERSION` is raised to the new `text_version` in the same change.** Today it equals the served version, so the old sentence counts as covering the profile | Counsel, Compliance, SDK |
| P-2  | A withdrawal control renders **with the flag off too**, says what it does in a sentence, confirms the result, and tells the buyer when a delete failed. Budget through ESC, or strings in `consent-text.json`                                                                                                                                                                                      | SDK, Compliance          |
| P-3  | A buyer can reach access and export: through the interface, or through a working `initiate` (FOLLOW-1279, FOLLOW-1308) that accepts an xid. Notice §3's empty slot is then filled                                                                                                                                                                                                                  | SDK, Backend             |
| P-4  | Withdrawal restores every directive it can reach, or the notice's "may stay adapted" is accepted by counsel; other open tabs stop adapting; a decision exists on a way back from `denied`                                                                                                                                                                                                          | SDK, Backend             |
| P-5  | `x-forwarded-for` as used here is verified platform-set on the production host, or replaced; decision on a keyed hash                                                                                                                                                                                                                                                                              | Backend, CTO             |
| P-6  | A retention decision for the self-service `dsr_audit_log` rows, and a withdrawal distinguishable from a Decline in the consent log                                                                                                                                                                                                                                                                 | Data, Compliance         |
| P-7  | Server Sentry is initialised, or the docs and R18 say it is not. `include: { data: false }` stays. FOLLOW-811's re-review triggers apply                                                                                                                                                                                                                                                           | DevOps, Backend          |
| P-8  | A decision on "None of these" against a stored label                                                                                                                                                                                                                                                                                                                                               | Compliance, SDK          |
| P-9  | The DPO has signed off DPIA §13.2 and §13.5                                                                                                                                                                                                                                                                                                                                                        | DPO                      |
| P-10 | The production Upstash database is confirmed EU-only, or H003 replaces the store; `EVAL` confirmed on hosted Upstash; a real write, restore and erase verified there (row 20). AC(9)'s evidence is one local Redis                                                                                                                                                                                 | CTO                      |
| P-11 | Only then does the CTO set `BUYER_PROFILE_ENABLED`. Notice §3 stays DO NOT PUBLISH until P-1 to P-4 and P-9 hold                                                                                                                                                                                                                                                                                   | CTO                      |

L-7 goes to counsel in the same packet. GPC stays with FOLLOW-1438. `intent_sessions` retention
stays a separate ticket.

## 9. Conditions of the localhost merge

- **M-1.** Open: `Consent corpus sync`, `SDK E2E tests` and the rest of the required register green
  in CI on the merge SHA. `eba51b2f` is unpushed; the gates pass locally.
- **M-2.** Open: this record and its documents land with the code, in the same merge.
- **M-3.** Open: the PM records the ESC-090 addendum in `backlog/ESCALATIONS.md`.
- **M-4.** Checked, as reported by the coordinator: on 2026-11-02 `BUYER_PROFILE_ENABLED` is absent
  by name from Doppler `prd` and Vercel production. Not verifiable from this repo, and not re-read
  by this role.
- **M-5.** Open: the PM files stubs for P-2, P-3, P-4, P-5, P-6, P-7, P-8, each with a
  before-go-live `depends_on`, plus: the `privacy-notice-keys-sync` gate does not see keys named
  `*_VERSION_KEY` or `*_CACHE_KEY`; `MASTER_DESIGN.md` §Snapshot still says sending the xid "is the
  ticket's SDK half".

A later change that alters behaviour comes back to this role.

## 10. Documents changed, and the Rule N check

| Document                                           | Change                                                                                                                                                                 |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/compliance/dpia.md` v2.27                    | §13.2 rewritten; old text kept as a marked record. §13.5 re-read. §2.2, §2.2.1, §2.3, §2.4, §2.5, §2.6, §3.1, §3.3, §3.5, Risks A, B, E, §5, §7 items 2, 5, 6, §8, §11 |
| `docs/compliance/ropa.md` v2.22                    | New Activity 18; four Retention Schedule rows; notes on Activities 2, 7, 8, 12; Appendices A, B; revision                                                              |
| `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` v1.15 | §3 rewritten, DO NOT PUBLISH; §1, §4 (thirteen keys, including `estalara_consent_text_version` and the found-missing `estalara_quiz_config_cache`), §5, §6.3, §7       |
| `docs/compliance/lia-template.md` v2.1             | The three "untransmitted" statements; key count                                                                                                                        |
| `docs/compliance/README.md`                        | Index versions                                                                                                                                                         |
| `docs/handover/CTO_HANDOVER.md`                    | One bullet points at section 8 above                                                                                                                                   |

**Not changed, deliberately:** `consent-text.json`, the canonical record and
`examples/consent-text.ts`, so the banner sentence is byte-identical; `backlog/ESCALATIONS.md`,
`backlog/QUEUE.md`; product code; the GPC claims beyond one true sentence in DPIA §7 and a note in
ROPA Activity 2. **Owed by the architect, design review section 10:** ADR-0014 notice, §H.9 seams.

**Rule N.** Every behavioural sentence added was checked against a non-test symbol at this SHA. The
map is the implementation record in `PRIVACY_NOTICE_TEMPLATE.md` §3 and the retention table in DPIA
§13.2; the references in sections 4 to 7 above are the rest. Where the code falls short, the
documents state the shortfall as a gap rather than the requirement as a behaviour. The gates that
read these documents were run at `eba51b2f`:

| Gate                                                          | Result on the edited tree               |
| ------------------------------------------------------------- | --------------------------------------- |
| `scripts/check-consent-retention-sync.mjs`, and `--self-test` | Pass; 13 of 13                          |
| `scripts/check-privacy-notice-keys.sh`                        | Pass                                    |
| `scripts/check-consent-text-sync.mjs`                         | Pass                                    |
| `scripts/check-consent-contract-sync.mjs`                     | Pass                                    |
| `scripts/check-adr-0021-conditions.mjs`                       | Pass                                    |
| `scripts/check-compliance-docs.sh`                            | Pass                                    |
| `scripts/check-session-identifier-corpus-sync.mjs`            | Pass; G3 runs against the real function |

**Regulatory reference for this record:** GDPR Arts. 5(1)(c), 5(1)(d), 5(1)(e), 6(1)(a), 7(1), 7(3),
9, 13, 15, 17, 20; ePrivacy Art. 5(3); CJEU C-184/20, for counsel to apply. **Audit-log schema
delta:** none; three new `dsr_type` values in a `LowCardinality(String)` column. **Consent-log
delta:** optional `text_version` on `consent.granted`.

NEXT: the PM pushes, verifies CI on the merge SHA (M-1), takes M-2, M-3 and M-5, and merges.
