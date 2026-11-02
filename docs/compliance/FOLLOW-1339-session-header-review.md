# FOLLOW-1339 — `X-Estalara-Session-Id` and the signed conversions: compliance review

**By role:** compliance-engineer agent, Estalara Adaptive Listings. **Not a lawyer.** Every
statement about a lawful basis or a legal requirement is an engineering read, and nothing here says
any of this is legally sufficient. **Date:** 2026-11-02. **Reviewed:** branch
`backend-engineer/FOLLOW-1339-signed-events` at `961fe187`, plus the unversioned local tree
`~/Projects/Estalara-gitlab-2026-08-17` (`core-master`, `web-master`), read on this date. **Stack:**
not started; nothing below is a new live measurement. **Not a disclosure.** **Amended the same
day:** the edits of section 8 were applied at the coordinator's request, with the deviations listed
there, and ESC-091 was filed. C-1 to C-5 remain open; only C-5's recommendation is applied on
localhost, pending the ruling.

Each answer separates **Established** (a document or the code says it, with the reference),
**Engineering read** (my reasoning on those facts) and **Counsel** (not mine to decide).

Path shorthand: `kt/` is `core-master` `src/main/kotlin/com/time2show/core/`; `al/` is `kt/` plus
`service/adaptivelistings/`; `web/` is `web-master/src/`.

## 1. Verdict

**Localhost: PASS WITH CONDITIONS (section 9).** No real data subject is in the flow. PostHog is off
on localhost (`web/lib/posthog.ts:4,10-11`), and the backend sends nothing unless the `AL_*` group
is set (`al/ConversionEventClient.kt:34`). The code does what the spec says about the header: it is
read only at three publish sites, it is not stored, and it is not logged by anything in
`core-master`. On localhost the front end sends it only when the host's optional-analytics choice is
explicitly `optional: true`, pending ESC-091 C-5.

**Production: NOT PASSED (section 10).** Three things need more than code, and one correction to the
brief changes the analysis:

1. **The processing has no recorded purpose and no consent text.** DPIA §3.1 says "no other
   purpose", and no sentence served to a buyer mentions measuring conversions.
2. **Time2Show holds both sides.** The same company runs the host database and ClickHouse, so these
   rows are re-linkable by the party holding them. Several records say or imply otherwise.
3. **A buyer cannot withdraw in production as configured.** With `BUYER_PROFILE_ENABLED` off, no
   withdrawal control renders (`consent-flow.ts:226`). The header then keeps flowing on every later
   conversion in that browser, because the grant has no expiry.

**Correction to the brief.** "Nothing links them in storage" is true of the two new events. It is
not true of the session they name. For a logged-in buyer who used the AI chat in that tab,
ClickHouse `events` already holds `session_id` beside `payload.lead_id` on `chat.message.sent`, and
`lead_id` is an unkeyed SHA-256 prefix of the Keycloak subject (Q2).

## 2. Q1 — the session id beside the login: which record does it break?

### Established

**The co-presence is real and every subject is a registered user.**
`auth.anyRequest().authenticated()` (`kt/config/WebSecurityConfiguration.kt:76`) covers all three
endpoints, and each takes a `jwtUserDetails` principal (`kt/controller/MessageController.kt:94-97`,
`kt/controller/CalendarController.kt:135-139`, `kt/service/web/LivestreamServiceImpl.kt:266-269`).

**What holds in the code, checked rather than taken from the README:**

| Claim                                | Finding                                                                                                                                                                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read on three paths only             | `BuyerSessionId.fromCurrentRequest()` at `CalendarServiceImpl`, `LivestreamServiceImpl:382`, `ConversationServiceImpl`. No other reader of the header. CORS names it for all routes, but nothing else reads it              |
| Not stored                           | Neither entity gained a column. `ConversationCreatedEvent` and `LivePresentationRegisteredEvent` are in-memory                                                                                                              |
| Not logged by `core-master`          | `RedactingRequestLoggingFilter` logs URL and body, never headers (`:50,61`). The async handler prints params (`AsyncConfiguration.kt:20-24`), and `BuyerSessionId.toString()` is redacted. Actuator exposes three endpoints |
| Other consumer of the event          | `MessageEventListener.onConversationCreated` builds its SSE message field by field and does not touch the id                                                                                                                |
| Front end sends it only on six calls | Helper at `web/lib/estalaraConversionHeaders.ts`; call sites match the README table one for one; no interceptor                                                                                                             |
| Payload carries no account field     | `ConversionEventClient.buildBody`: no login, account id, name, `lead_id` or xid                                                                                                                                             |

**Not established by anything in reach:** that an edge proxy, load balancer or APM does not log the
header (no `access_log`, `log_format` or header capture appears in `infrastructure-master`, which
proves nothing about production), and PostHog (Q2).

### Records this breaks

No record says literally "the host never sees the session id" or "never joins to identity"; I
searched the compliance corpus, `MASTER_DESIGN.md` and `CTO_HANDOVER.md`. `core-master` appears
**zero times** in `dpia.md`, `ropa.md`, the notice and the LIA, so the system receiving the header
is in no record at all. These statements do conflict:

| #   | Where                                    | Quote                                                                                                                                                                                                           | Finding                                                                                                                                                    |
| --- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | DPIA §3.1                                | "exclusively for the purpose of real-time personalization … and no other purpose"                                                                                                                               | **Broken by this flow.** Conversion measurement is a further purpose. §3.1(c) was amended for quiz accuracy for the same reason (v2.25)                    |
| 2   | DPIA §3.5                                | "Behavioral data is used only for listing personalization and archetype model improvement."                                                                                                                     | **Broken by this flow**, same reason                                                                                                                       |
| 3   | ROPA Activity 2, Purpose                 | "so that behavioural events from one visit can be associated with each other, and only with each other"                                                                                                         | **Broken in effect.** The id is handed to a system holding the account, and the event is then associable with that account's record by time (Q2)           |
| 4   | ROPA Activity 2, Recipients              | "Estalara edge ingest (Cloudflare Workers); the identifier is used as `session_id` in all downstream systems"                                                                                                   | **Incomplete.** The host backend now receives it                                                                                                           |
| 5   | ROPA Activities 1, 2, 12, Data subjects  | "Anonymous property buyers"                                                                                                                                                                                     | **False for every row of this flow:** both conversions need a login                                                                                        |
| 6   | Notice §1                                | "it is kept only in the browser tab you are using and discarded when you close that tab"                                                                                                                        | **Broken further.** Ingest already receives it, which the implementation record concedes; now a backend does too, in a request that shows who is logged in |
| 7   | Notice §1                                | "Estalara does not read your name, email address, phone number, or any account credentials."                                                                                                                    | **False at company level** and see section 12 item 1: the SDK already reads the login token (`boot.ts:160`)                                                |
| 8   | Notice §1                                | "Estalara captures anonymous behavioral signals"                                                                                                                                                                | **Wrong word** for a session whose conversion is server-confirmed for an account                                                                           |
| 9   | Notice §1                                | "A later visit begins with a new identifier that cannot be traced back to the earlier one."                                                                                                                     | **Strained.** True of the identifier. Two sessions that each convert can be tied through one account. The caveat sits in the record, not in the sentence   |
| 10  | DPIA §1                                  | "Time2Show does not collect directly identifying information (names, emails, phone numbers, government identifiers, addresses) about visitors"                                                                  | **False at company level** since ESC-085; this flow makes it operative. See "who is who" below                                                             |
| 11  | DPIA §3.2                                | "No personally identifying fields (name, email, phone, ID numbers, addresses) are collected, transmitted, or stored at any layer."                                                                              | **Same.** "Any layer" must mean the AL stack, and must say so                                                                                              |
| 12  | DPIA §1                                  | "Visitor identity is represented solely by a **randomly minted UUID v4**"                                                                                                                                       | **Stale** for logged-in buyers; §2.2.1 already concedes `lead_id`. Add the fourth vector there                                                             |
| 13  | DPIA §10                                 | "they are pseudonymous and not individually contactable by Time2Show"                                                                                                                                           | **False for this population**, and it is the stated ground for not consulting data subjects under Art. 35(9)                                               |
| 14  | LIA A.2                                  | "does not collect, transmit, or store … Login credentials or authenticated identity" "in connection with visitor sessions"                                                                                      | **Broken** in the transmit limb at company level                                                                                                           |
| 15  | `MASTER_DESIGN.md` §D.8                  | "Adaptive Listings collects ZERO PII"; quiz answers: "no link to email/identity"; "Adaptive Listings has no PII to delete."                                                                                     | **Broken in effect**; architect owns it                                                                                                                    |
| 16  | FOLLOW-1316 design review §3             | "Held for 13 months under a per-tab id, these rows cannot be tied back to a browser."                                                                                                                           | **Premise weakened.** It was one reason `has_children` and two other traits could stay in `quiz_runs`. They can now be tied back to an account (Q4)        |
| 17  | Host policy, `estalara/en/policy.md:306` | "If we introduce … adaptive listing presentation … we will provide information about the data used, purpose, logic, consequences, legal basis, retention, and available controls before the processing begins." | **Published promise, unmet** for the product as a whole. Not created by this flow; it binds it                                                             |

**What still holds:** DPIA §1 "never reads cookies" (a header is not a cookie, which is the README's
reason for choosing it); "No xid" (`buildBody`); DPIA §3.1 "no cross-session conversion linkage" as
a statement about storage.

### Who is who

**Established.** `estalara/en/policy.md:9,14`: "**Time2Show, Inc.**, doing business as **Estalara**"
and "Time2Show, Inc. determines why and how the personal data described in this Policy is
processed." Notice §6.1 record: "the brand and the processor are the same company in the
single-tenant deployment". `MASTER_DESIGN.md` §A.2: AL "serves ONE tenant, Estalara's own
app.estalara.com". **Yet** ROPA Activities 1 and 2 and Joint Controller Analysis (a) still read
"Tenant is Controller, Time2Show is Processor".

**Engineering read.** Row 10, 11, 13 and 14 were written when the identifying party was a separate
company. Under ESC-085 they are not. **Counsel:** L-11.

## 3. Q2 — re-linkage, retention, DSR

### How close, and who holds both

**Established.**

| Side       | Field                                                                                                                                                                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host       | `ConversationEntity.createdAt`, `Instant.now()` at construction (`kt/model/ConversationEntity.kt:38`), with the buyer's account id on the row. `LivePresentationRegistrationEntity.registrationTime`, same, with the `participant` account            |
| ClickHouse | `ts` = `System.currentTimeMillis()` when the event is built, after commit on the async thread (`al/ConversionEventClient.kt:39`), fixed across re-sends. `DateTime64(3)` (`0001_create_events.sql:25`). `ingest_received_at` also, to the millisecond |
| Exact key  | `live.signup` also carries `slot_uuid` (the live's uuid) and `listing_id`. `inquiry.completed` carries neither                                                                                                                                        |

**The gap is the rest of the transaction plus the async hand-off.** I did not measure it; expect
well under a few seconds unloaded. It hardly matters: single tenant, low volume, millisecond clocks,
and `ts` always follows the host's time. For `live.signup`, `slot_uuid` narrows the search to that
live's registrants before time is even used, and some lives will have few. For `inquiry.completed`,
the nearest `createdAt` is usually one row.

**Who holds both: Time2Show, Inc.**, per "who is who". The repository does not show who has
credentials to both stores, and I do not assume they are separated. Retention overlap is the whole
13 months: host "Direct messages — until the relevant account or conversation is deleted"
(`policy.md`, retention section), `events` TTL 13 months.

**A stronger link already exists, and it is not new.** On the real app:

- `web/lib/ui/chatbot/ChatBot.svelte:394` dispatches `estalara:chat:message-sent` with `user_uuid`;
- `adapt-loop.ts:531,557` derives `lead_id` and queues `chat.message.sent` with `payload.lead_id`
  under the session; `chat.ts:47` keeps it through validation;
- `session.ts:274-280`: `deriveLeadId` is an **unkeyed** SHA-256, 16 hex chars. Anyone with the
  realm's user list can compute it. Time2Show has the realm;
- the same rows hold the chat text, in which "anything else you type — including names" is stored
  (Notice §6.1 purpose 2).

So for a buyer who chatted, `conversion → session_id → lead_id → account` is deterministic, with no
timestamp needed. **Checked and not a link today:** `adaptation_decisions.lead_id` exists (migration
0013), but `/api/adapt` writes `''` (`adapt/route.ts:817,1068`, "not wired via POST body yet
(FOLLOW-170)"). Wiring it would link every session, not just chatters: condition M-6.

**Other parties.** If a buyer accepted optional cookies, PostHog runs replay and
`identify(username)` (`web/lib/posthog.ts:87,90`). `posthog.init` sets no `session_recording`
options (`:51-55`), so whether headers are captured is decided by a project setting I cannot see.
PostHog's documentation says header capture is off by default and can be enabled in project settings
or code, and its always-redacted list does not include this header. If that setting is on, the id
sits beside the username at a processor. **In production only; unverified: condition H-9.** PostHog
appears in no AL compliance document, though the host policy discloses it (§3.13).

### Does this change "pseudonymous"?

**Established.** DPIA §1 already calls the id "pseudonymous personal data", citing Art. 4(1),
Recital 26 and Breyer. So nothing here moves it from non-personal to personal.

**Engineering read.**

1. "Pseudonymous" may stay as a description of what is on the row. It must stop implying that the
   holder cannot attribute it. Art. 4(5) pseudonymisation asks that the additional information be
   kept separately under measures ensuring non-attribution, and no such measure is recorded here.
2. These rows are better described as personal data of an identifiable registered buyer, held
   without a stored account key, that the holder can re-link. Proposed wording is in section 8.
3. C-413/23 P (EDPS v SRB) does not obviously help. As commentaries read it, a recipient without
   realistic means of re-identifying may fall outside; here the holder has the means. I read
   secondary sources only.

**Counsel:** L-10.

### Retention statements

**Established.** `events` TTL 13 months, enforced (`0001_create_events.sql:46`). The consent-log
cron deletes only `consent.*`. `lift-csv.ts` and `lift-snapshots.ts` have no `session_id`, so
aggregates hold no key. **Nothing promised is false on retention**, and the TTL I verified exists,
but no record lists conversion rows: ROPA retention row owed. Withdrawal does not shorten it (Q3).

### Does erasure reach these rows?

**Established.** Mechanically yes: `DSR_CLICKHOUSE_TABLES` includes `events`, and
`buildEraseMutationSql` deletes by `session_id` with no filter on `caller_signed`. Practically not
yet, and for this population perhaps never:

1. **`POST /api/dsr/initiate` refuses every caller** (`initiate/route.ts:102-108`). FOLLOW-1308 is
   READY, not done.
2. **The buyer cannot name the session.** It dies with the tab, and the host deliberately keeps no
   copy. FOLLOW-1308's ownership proof ("ClickHouse by `session_id`") does not help someone who has
   only an account.
3. **The two working routes from an account to a session are the two joins this review warns
   about:** `lead_id` for those who chatted, and timestamps for the rest. Notice §6.1 promises "A
   data erasure request will result in deletion of your behavioral data from Estalara's systems
   within 30 days." For a logged-in buyer who emails compliance@estalara.com, that promise has no
   procedure behind it for these rows.
4. **Tenant filter.** FOLLOW-1308 adds `tenant_id` to the mutation. Ingest sets the tenant from the
   key's record (`handlers/events.ts:343`). The server key and the page key must map to one tenant,
   or a tenant-scoped erase misses one class of row. The lift's join would also fail, so it would
   show; a test belongs in FOLLOW-1308.

**Counsel and CEO:** whether Time2Show may rely on Art. 11 while it can re-link. Refusing because
"we cannot identify you" sits badly beside a working join, and building the lookup makes the join a
design feature. L-10, C-4.

## 4. Q3 — Art. 5(3), lawful basis, the consent check, withdrawal

### Does existing text cover this purpose and this reader?

**Established: the texts.** The served strings are in `consent-text.json`, `text_version`
`2026-08-24.1`:

- `text`: "We personalize this page based on your browsing behavior."
- `disclosure13_1`: the consent log. `disclosure13_2`: "To remember your preferences across visits…"
- `disclosurePlatform`: chat analysis, profile transfer, lead ranking, summaries.
- Registration consent, Notice §6.1, purposes 1 to 6: the nearest is "to personalize the listings
  shown to you".
- Notice §1 discloses one measurement only, "to measure how accurate the quiz is".
- No text mentions conversions, a comparison, or that some visitors are not personalised. The word
  holdout appears nowhere in the notice; the only trace is the §4 key row for `estalara_variant`.
- ROPA Activity 12 records efficacy measurement under "Art. 6(1)(f) LI". ESC-084 and ESC-085 D-J
  ruled who emits and what counts; neither ruled this basis or this path. ESC-084 called host
  emission a "post-GO deployment step".

**Engineering read: not covered.** The precedent is in the corpus: quiz accuracy got its own
sentence (FOLLOW-1358 C8), and FOLLOW-1316's design review refused to stretch "your preferences" to
an inferred profile. The same reasoning applies. On the **reader**, the gap is smaller than it
looks: the host's code and the SDK belong to one company, on one origin. The gap is the purpose.
**Art. 5(3):** DPIA §1 already treats `sessionStorage` reads as engaged. EDPB Guidelines 2/2023, as
summarised in the sources I read, say gaining access is independent of who stored the value. The
strictly-necessary limb does not look available for measuring a product's effect. CNIL's
audience-measurement exemption, as vendors summarise it, requires anonymous statistics and bars
cross-referencing; a per-session row beside a login does not look like that. It is French guidance
and UODO is the DPIA's lead authority. **Counsel:** L-8, L-9.

**The host's own banner.** `web/lib/ui/CookieConsent.svelte` offers "Optional cookies (for
analytics)", pre-ticked (`optionalConsent = true`, `:11`), written to `cookieConsent`. As first
reviewed, the helper did not read it, so a buyer who **unticked analytics** and accepted the
personalization prompt still had this measurement read under a personalization consent. **Since
2026-11-02 07:30, on localhost, pending ESC-091 C-5:** the helper returns no header unless
`cookieConsent` is present and its `optional` is `true`
(`web/lib/estalaraConversionHeaders.ts:14-15`). So refused **and** not yet answered both mean no
header, which is stricter than the recommendation asked. This is not a ruling. It also does not make
the box a consent to this purpose: its label says analytics, it is pre-ticked (section 12 item 5),
and reading `cookieConsent` adds a condition, not a basis (C-1, L-8).

### Is the front-end check enough?

**Established.**

- The helper's two tests, `estalara_consent === 'granted'` and `cookieConsent.optional === true`,
  are **the only consent control in the chain**.
- The backend treats header presence as consent and writes `"consent_state" to "consented"`
  (`al/ConversionEventClient.kt:87-88`).
- Ingest does not check it either: `inquiry.*` and `live.signup` are class `operational`, "ALWAYS
  ingest" (`consent-gate.ts`). A signed row with any `consent_state` persists.
- **The helper now has a unit test,** `web/lib/estalaraConversionHeaders.test.ts`, added after this
  review was first written: consent pending and denied, cookies refused and absent, malformed
  session, non-string id, storage throwing, each paired with a positive where it can be. A
  browser-level control is still owed (M-3).
- **The delivered diff matches the local tree.** `web-master-x1-conversion-header.patch` on
  `sdk-engineer/FOLLOW-1341-web-master-slots` (`9af12ff3`) carries the helper, the six call sites,
  the `cookieConsent` check and the unit test (M-2).
- **The helper ignores the text version.** A grant below `MIN_PROFILE_TEXT_VERSION` re-shows the
  banner (`consent-flow.ts:114`) but stays `granted` until the buyer answers, and a grant with no
  recorded version is never stale (`session.ts:94-97`). So raising the minimum for a new sentence
  would not stop this header. FOLLOW-1316 R6 solved this for the xid only.
- **The helper ignores GPC.** `readSendableXid` honours it for the xid; ROPA Activity 2 says "GPC
  signal honored". FOLLOW-1438 owns that claim.
- **Opt-out does not stop it.** That matches §H.9 (the ingest stream keeps flowing for opted-out
  users, `consent-gate.ts`), so this is consistent, not a defect. Notice §6.3 should say so.

**Engineering read.** A client-side check is the same posture the DPIA already records ("the server
cannot check consent: it takes the `consent_state` the SDK sends", §2.2), so for a browser-held
consent it is not a new weakness. **It is enough only if it is delivered, tested and treated as a
control.** Two differences from the anonymous case matter:

1. **Here the server knows the account,** so an account-level stop is possible (next section).
2. **The row's `consent_state: consented` records a claim nobody observed.** It would read as
   evidence of consent under Art. 7(1). `consent.granted` exists only under the tab that clicked
   Accept, so a returning buyer's session has no matching grant. Forwarding the accepted text
   version as an additive field would at least state what was claimed: H-3.

### Does withdrawal stop it?

| Case                                        | Established                                                                                                                           | Result                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Same tab, control present                   | `withdrawConsent` sets `denied` first (`consent-flow.ts:64`); helper reads `localStorage` on each call                                | **Stops**                                          |
| Another open tab                            | Same read, no cached value                                                                                                            | **Stops**, better than `/api/adapt` (P-4)          |
| Request already sent, or commit just done   | Event goes out after commit; up to 3 sends                                                                                            | One event may land after the click                 |
| Banner Decline, stored `denied`             | Helper returns `{}`, though a session id exists (README is right on this)                                                             | **Stops**                                          |
| **Production as configured, flag off**      | Control renders only if `buyerProfileEnabled` or the xid was sent (`consent-flow.ts:226`); the banner does not return after `granted` | **No way to withdraw** but clearing site data; P-2 |
| **Email to compliance@estalara.com**        | Registration text offers this route. It cannot reach the browser's `localStorage`, and the backend has no account flag                | **Does not stop it**                               |
| Analytics refused later, in cookie settings | `setCookieConsent` writes `cookieConsent`; helper reads it on each call. Localhost, pending C-5                                       | **Stops**                                          |
| Rows already sent                           | `withdrawConsent` touches no ClickHouse row. DPIA §8: withdrawal "cannot locate … `events`"                                           | **Stay** up to 13 months                           |

**Counsel:** L-14, with L-4.

## 5. Q4 — what the events reveal, and the holdout

**Established: on the row itself.** `live.signup`: session, time, live uuid, listing, `event_kind`.
`inquiry.completed`: session, time, `channel: conversation`. No Art. 9 category in the payload. The
schema's "PII note" holds. A conversation row is the click, not a message (README known limits).

**New facts about the buyer, engineering read:**

1. **A strong intent signal,** server-confirmed: this session took a step toward a specific listing
   or contacted an agent. The SDK's browser emitters could already say so, but on the real app
   nothing dispatches them (`live.signup` and `inquiry.completed` have no producer in `web/`), so
   for real sessions this is new.
2. **Every `caller_signed = 1` row says the person holds an account.**
3. **The bigger change is to the rows already there.** Under that `session_id` sit the archetype,
   `adaptation_decisions`, chat text, and `quiz_runs` for 13 months. `quiz_runs` holds traits such
   as `has_children`, `residency_goal`, `buying_from_abroad`. ESC-090 item 3 kept those out of the
   returning-buyer profile because that profile acts on one person; design review §3 tolerated them
   in `quiz_runs` because they "cannot be tied back to a browser". Once re-linkable, they describe a
   named account. **Add to L-3:** L-12.

**Holdout. Established.** The event carries no arm, and the host never learns one. The arm is a
stateless HMAC (`ab-holdout.ts`) over the session or, with the flag on, the xid; it is logged in
`adaptation_decisions.holdout_group`. No demographic input, and nothing in this flow feeds it, so
the RETRO-002 pattern holds. The conversion is read only by the lift readers; the bandit feedback
ping is gone (FOLLOW-1286).

**Does the arm change the analysis? Yes, in three ways. Engineering read:**

1. **For a held-out buyer, measurement is the only purpose.** They accepted "We personalize this
   page", were not personalised, and their conversion is read anyway. It must be: the lift has no
   denominator otherwise. So the holdout cannot use personalization as its reason. FOLLOW-1316 R14
   reasoned the same way ("a profile held for them has no use"), but there it could stop processing,
   and here it cannot. This is the sharpest argument that a measurement sentence is needed.
2. **The experiment is undisclosed.** Whether withholding must be disclosed: L-13.
3. **Re-linkage makes the arm an attribute of an account,** and with the flag on it is stable for up
   to 90 days (ESC-090 item 2). That does not break ESC-090 item 4 in storage, but two conversions
   by one account can be tied through the host, which is what item 4 chose not to do. A written
   no-join rule is what keeps that ruling meaningful: H-7.

**Does it need a notice line? Engineering read: yes.** Art. 13 asks for purposes and recipients.
Wording is in section 8. Sufficiency is counsel's.

## 6. Design alternative, for the CEO and counsel

**A receipt instead of a header.** The backend returns a signed receipt; the front end hands it to
the SDK; the SDK adds its own session id and sends it. The session id never reaches `core-master`,
host code never reads SDK storage, and the SDK's own gate applies, which answers Q1 and most of Q3's
reader question.

**My recommendation: do not rebuild now.** It does not remove the lasting risk, because the event
time still matches the host's. It changes ingest verification (a public contract, ESC). It needs SDK
bytes, and FOLLOW-1316 reported 8 B of room. Ad blockers can drop it. Keep it as the fallback if
counsel rejects the host's read under L-9.

## 7. Questions for counsel

Same packet as L-1 to L-7 (FOLLOW-1316 design review section 9). No proposed answer here is a legal
opinion.

| #    | Question                                                                                                                                                                                                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L-8  | Is section 8's sentence sufficient for conversion measurement, in the banner or the notice? Do earlier grants need renewal? Separate choice from personalization?                                                                                                                                                  |
| L-9  | Art. 5(3): does the host's read of `__estalara_session__` need consent for this purpose? Is any exemption open? Is reading `estalara_consent` itself in scope?                                                                                                                                                     |
| L-10 | Recital 26, Art. 4(5), Art. 11: are these rows pseudonymised in the Art. 4(5) sense when one company holds both stores? Can it rely on Art. 11 while able to re-link? Does C-413/23 P change anything?                                                                                                             |
| L-11 | Who is controller? ROPA says tenant and processor; the host policy says Time2Show determines purposes and means. Also: DPIA §1 claims an EU establishment (Art. 3(1), UODO lead), while `policy.md:18` says "established outside the European Union" under Art. 3(2) with a representative. They cannot both stand |
| L-12 | L-3 extended: do `quiz_runs` traits, once re-linkable to an account, reveal Art. 9 data, and does that change their 13-month retention?                                                                                                                                                                            |
| L-13 | Must the holdout be disclosed? Is measuring a buyer who accepted personalization and was withheld it covered by that acceptance?                                                                                                                                                                                   |
| L-14 | L-4 extended: does withdrawal require erasing conversion rows already sent? Must an emailed withdrawal stop this flow?                                                                                                                                                                                             |
| L-7  | Extended: UAE PDPL and CCPA treatment of this flow; GPC as a stop                                                                                                                                                                                                                                                  |

## 8. Edits owed, with proposed wording

**Applied 2026-11-02** in `dpia.md` v2.28, `ropa.md` v2.23, `lia-template.md` v2.2 and
`PRIVACY_NOTICE_TEMPLATE.md` v1.16, plus the index in `docs/compliance/README.md` and row 21 of
`CTO_HANDOVER.md`. Each behavioural sentence maps to the references above (Rule N), and states
**localhost only** where the emitter is not live. No text decides ESC-091: the basis is "not
determined", and the notice paragraph names none and promises no erasure route.

**Applied differently from the proposals below:**

1. **ROPA is append-only** (its own closing rule), so Activities 1, 2 and 12 and the Joint
   Controller Analysis take dated notes. "And only with each other" stays in place, marked as not
   holding.
2. **Notice §1's first sentence** also says what the SDK does read: the proposal removed a false
   statement but left the login-token read undisclosed. Added: "If you are logged in, it reads the
   login token held in your browser and uses only your account's identifier from it".
3. **The notice marking** is per passage rather than the whole document: §1's correction is true
   today and is not held back; the conversion paragraph, the two §4 additions and the §6.3 line
   carry the mark.
4. **The conversion paragraph** gains the C-5 condition, "or first join" and "new conversation", to
   match what the code fires on (ESC-091 (a) and (c)). DPIA §2.2.1 item 4 and ROPA Activity 19 carry
   the same additions, and ROPA Activity 19 gains "When it fires" and "Re-linkage" rows.
5. **DPIA §1's correction** follows the paragraph rather than splitting it.
6. **Not applied, because not owned here:** `MASTER_DESIGN.md` §D.8, `FOLLOW_UPS.md`, the patches
   README (M-4). **Not applied, because held for counsel:** rows 6, 8 and 9 of section 2 in Notice
   §1; the record names them. FOLLOW-1316 design review §3's dated note was not requested and stays
   owed.

### DPIA (`dpia.md`, v2.28)

- **§1, after "…about visitors."** _"Correction (v2.28, FOLLOW-1339): since ESC-085 the only host is
  Time2Show's own platform, so at company level Time2Show also holds the account data of logged-in
  buyers. This paragraph describes the Adaptive Listings stack, not the company. See §2.2.1 item
  4."_
- **§2.2.1, new item 4.** _"**The conversion header** (FOLLOW-1339; localhost only, production not
  enabled). With the SDK banner's consent granted, the host front end reads the session identifier
  from `sessionStorage` and sends it as `X-Estalara-Session-Id` to the host backend on the requests
  that register for a live presentation or create a conversation with an agent. That request also
  carries the buyer's login. The backend holds the identifier in memory for one event and does not
  store or log it in its own code. It then posts a signed `live.signup` or `inquiry.completed` under
  that identifier, and the row is stored in ClickHouse `events` with `caller_signed = 1`. The row
  holds no account field. **It can still be matched to the account:** the host keeps the account and
  a time for the same action, and Time2Show holds both stores. For a buyer who used the chat in that
  tab, `chat.message.sent` already holds `lead_id` under the same session. These rows must not be
  described as anonymous or as not attributable by Time2Show."_
- **§2.3,** new row: host backend, `core-master`, receives the header. **§2.4,** new step 13, same
  facts.
- **§2.5,** new row: _"Signed conversion events (`live.signup`, `inquiry.completed`,
  `caller_signed = 1`) | ClickHouse `events` | 13 months, enforced (`0001_create_events.sql:46`) |
  Pending counsel; see §3.1"_.
- **§3.1, new objective (d).** _"(d) measuring whether personalization changes the probability that
  a session registers for a live presentation or contacts an agent, comparing the adapted arm
  against the holdout (ESC-085 D-J; FOLLOW-1339; localhost only). Per session; no cross-session
  linkage in storage. Basis: pending CEO ruling and counsel (L-8, L-9)."_ Change "and no other
  purpose" to follow it.
- **§3.2,** replace "at any layer" with "at any layer of the Adaptive Listings stack; the host
  platform, operated by the same company, holds account data (§2.2.1 item 4)".
- **§3.3,** new bullet: the header on six calls, no storage; **only after H-6:** `slot_uuid`
  dropped.
- **§3.5,** add "and conversion measurement (§3.1(d))".
- **§4 Risk A,** new paragraph: _"**The conversion flow changes who the adversary is
  (FOLLOW-1339).** The party able to correlate is not only a third party. Time2Show holds the host's
  account and time records and the event store. Timestamps agree closely, `slot_uuid` narrows a live
  registration to that live's registrants, and for buyers who chatted `lead_id` is a deterministic
  key: an unkeyed hash of the account subject. No technical measure prevents the join. Severity is
  as stated above, because the joined session holds archetype, quiz traits and chat text."_
- **§4 new Risk G,** §5 row G: **Not rated;** waits for counsel and the DPO. Yes, a blocker for
  enabling it in production. **Risk A's "Low (forward)" must be re-read** by the DPO for this
  population.
- **§6.1,** add one sentence: the host's read is a further read for a further purpose; L-9.
- **§8, "What withdrawal does not reach",** add `events` conversion rows by name, and: _"A logged-in
  buyer cannot name a session whose tab has closed, and the host keeps no copy, so an account-based
  request has no route to these rows today other than the joins in §2.2.1. FOLLOW-1308 owns the
  procedure; C-4 and L-10 decide it."_
- **§10,** "not individually contactable" limited to non-logged-in visitors.
- **Revision history.**

### ROPA (`ropa.md`, v2.23)

- **New Activity 19 — Signed conversion measurement.** Controller: **pending L-11**, with today's
  conflict stated. Purpose: section §3.1(d) wording. Lawful basis: pending C-1. Categories:
  `session_id`, event type, time, live uuid, listing id, `event_kind` or `channel`, `caller_signed`;
  **transient in the host backend:** the id beside the login. Subjects: **registered buyers with a
  login who accepted the SDK banner, in both arms.** Retention: 13 months, `events`. Recipients:
  host backend (`core-master`), ingest, ClickHouse. Withdrawal: as in Q3's table, limits included.
  DSR: as in Q2. Status: localhost only.
- **Activity 2.** Purpose: replace "and only with each other" with "and, for a consented logged-in
  buyer, with the signed conversion of Activity 19". Recipients: add the host backend. Subjects: "or
  logged-in".
- **Activities 1 and 12.** Cross-refer; Activity 12's purpose reads "listing engagement" and its
  basis "LI": mark as pending C-1 for conversions.
- **Retention Schedule,** new row. **Joint Controller Analysis (a),** dated note: single-tenant
  conflict, L-11. **Appendix (sub-processors):** check whether the host's hosting belongs here.
  **Revision history.**

### Notice (`PRIVACY_NOTICE_TEMPLATE.md`, v1.16). All DO NOT PUBLISH until H-2, H-3 and H-5 hold

- **§1, first sentences.** Replace "Estalara does not read your name…" with: _"The Estalara
  personalization code does not read your name, email address or phone number from your account. If
  you are logged in, it reads the login token held in your browser and uses only your account's
  identifier from it, to derive the pseudonymous lead ID listed in §4."_ (Section 12 item 1.)
- **§1, implementation record,** the map for the new paragraph below, and the withdrawal limit at
  P-2. The paragraph's last sentence is true only once H-5 holds.
- **§4, `__estalara_session__` row,** add: "On the conversion requests of §1, read by this website's
  own code and sent to its server." The keys gate is unaffected: no new key.
- **§5,** checklist row: this review, section 10, every item true. **§6.3,** add: "Does not stop the
  conversion measurement of §1." **§7,** revision.

**§1, new paragraph; its first clause becomes a bracket like §3's link when pasted.** If H-6 drops
`slot_uuid`, delete "which presentation and". "We use this to…" is the only statement of purpose and
must not be widened without returning here.

> Only where the conversion flow is enabled: If you are logged in, have accepted the personalization
> prompt and have accepted optional analytics cookies, then when you register for or first join a
> live presentation, or open a new conversation with an agent, this website's server receives the
> session identifier described above together with your request, which also shows who you are. The
> server does not store the identifier. It sends Estalara a record that this identifier took that
> step, with the time and, for a live presentation, which presentation and listing. We use this to
> measure whether personalization makes these steps more likely. For this comparison some visitors
> see listings without personalization, and their steps are measured too. The record is kept for 13
> months and holds no name or account identifier. It is not anonymous: because the same company runs
> this website and Estalara, it could be matched to your account. If you withdraw your consent, no
> further records are sent; records already sent are not deleted by withdrawing.

**Banner draft for counsel, EN only. It does not ship,** and needs the
`consent-disclosures.canonical.json` sign-off path:

> If you are logged in and register for a live presentation or contact an agent, we also record that
> step to measure whether personalization helps. For this comparison, some visitors see listings
> without personalization.

### Other documents

| Document                                                       | Edit                                                                                                                                            | Owner             |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `lia-template.md` A.2                                          | Limit "authenticated identity" to the AL stack and the tenant case; add the §2.2.1 fourth vector. Conversions rest on no LIA unless C-1 says so | Compliance        |
| `consent-text.json`, canonical record, `examples/`             | Only after L-8, with `MIN_PROFILE_TEXT_VERSION` or a new minimum in the same change                                                             | Compliance, SDK   |
| `CTO_HANDOVER.md` §4                                           | New row, section 10's list; §7 pointer                                                                                                          | Compliance        |
| `README.md` of the patches                                     | Section 9, M-4                                                                                                                                  | Backend           |
| `MASTER_DESIGN.md` §D.8                                        | "ZERO PII" and "no link to email/identity" corrected; D-J gains a line on the header                                                            | Architect         |
| FOLLOW-1316 design review §3                                   | Dated note on "cannot be tied back"                                                                                                             | Compliance        |
| `FOLLOW_UPS.md`, FOLLOW-1308                                   | Amendment: signed rows in the erase test; account-holder route after C-4                                                                        | PM                |
| `web/lib/legal/*/en/policy.md`, `cookie.md`, and other locales | The `policy.md:306` promise; SDK keys; PostHog line. Four brand folders exist                                                                   | CTO, with counsel |

## 9. Conditions of the localhost merge

- **M-1.** The DPIA and ROPA edits of section 8 and this record land with the code, marked localhost
  only (FOLLOW-1316 M-2 precedent). The notice edits land marked DO NOT PUBLISH. _Edits applied, not
  yet committed._
- **M-2.** The helper and its six call sites are delivered as a `web-master` diff:
  `docs/handover/estalara-app-patches/web-master-x1-conversion-header.patch`, on
  `sdk-engineer/FOLLOW-1341-web-master-slots`. _Delivered at `9af12ff3`, with the `cookieConsent`
  check and the unit test._
- **M-3.** A test of the helper: pending, denied, granted without a session, malformed JSON, storage
  throwing, and granted with a session. _Exists at `web/lib/estalaraConversionHeaders.test.ts`, with
  the C-5 cases._ Plus K5 controls, with analytics refused or unanswered added, each paired with a
  positive in the same run: no header and no row on pending and on denied; withdraw, then click: no
  header; withdraw in a second tab, then click: no header. After the run, search the `core-master`
  log for the session id value: 0 hits. "Not logged" is code-read evidence until then.
- **M-4.** The patches README gains under Known limits: the row is re-linkable by Time2Show (time,
  `slot_uuid`, `lead_id` for chatters); `consent_state` on the row is the backend's assertion and
  ingest does not gate this class; no withdrawal control with the flag off. It also corrects "does
  not touch `web-master`" when M-2 lands.
- **M-5.** _ESC-091 filed; FOLLOW-1454 carries H-1 to H-12 to the CTO; row 21 added._ The PM files
  stubs with a before-go-live `depends_on` for H-3 to H-10 and section 12's items. The FOLLOW-1308
  amendment. The `CTO_HANDOVER.md` row.
- **M-6.** Wiring `adaptation_decisions.lead_id` (FOLLOW-170) comes back to this role first: it
  would turn a link for chatters into a link for everyone.

## 10. Conditions for production (CTO handover)

All must be true. **None is today.** Owners in brackets.

1. **H-1 — Off until the rest hold.** All six `AL_*` variables stay unset, and the helper is not
   deployed or is behind a flag defaulting to no header: with `AL_*` unset the backend discards the
   id, but the host's read has still happened. Verified at the handover, not assumed. [CTO]
2. **H-2 — Counsel has answered L-8 to L-14 and L-7 as extended,** with L-1 to L-6 still owed under
   FOLLOW-1316. [Counsel, Compliance]
3. **H-3 — Text and version.** Measurement text as counsel settles it, on the canonical sign-off
   path. The helper requires a recorded `estalara_consent_text_version` at or above a minimum raised
   in the same change, since `granted` alone survives a stale grant. The accepted version travels on
   the event as an additive field, through ESC, or the record states why not. [Compliance, SDK,
   Backend]
4. **H-4 — Published policies.** The host's policy and cookie policy state this processing, meeting
   `policy.md:306` "before the processing begins". [CTO, Counsel]
5. **H-5 — Withdrawal works.** FOLLOW-1316 P-2 holds: a control that renders **with
   `BUYER_PROFILE_ENABLED` off**, explains itself and confirms. An emailed withdrawal stops this
   flow, via an account-level stop in `core-master`, or counsel accepts the stated limit. [SDK,
   Backend, Compliance]
6. **H-6 — Minimised.** `slot_uuid` is not sent: no lift reader uses it (`lift/route-helpers.ts`,
   `rollup/data.ts`, `lift-csv.ts`, `lift-snapshots.ts` have no match). The same grep finds no
   `listing_id` there; keep it only if a named reader needs it. C-3 decides coarsening of `ts` and
   `ingest_received_at`. [Backend, CEO]
7. **H-7 — A no-join rule that exists.** A written rule that host records and these rows are not
   joined except for a DSR under a documented procedure; separate credentials for the two stores,
   checked rather than assumed; a named owner. The DPIA may state these only once they are real.
   [CTO, Compliance]
8. **H-8 — DSR.** FOLLOW-1308 is done, its erase test includes a `caller_signed = 1` row and its
   tenant filter catches both key classes; the route for an account holder follows C-4. [Backend,
   Compliance]
9. **H-9 — Nothing else captures the header.** Edge, proxy, load balancer and APM confirmed not to
   log it. PostHog header capture confirmed off in project settings and pinned in `posthog.init`. A
   search of a production log sample for the id value returns 0. [CTO]
10. **H-10 — GPC and analytics refusal.** The helper honours `navigator.globalPrivacyControl`, or
    FOLLOW-1438 corrects the claim. `cookieConsent.optional` per the C-5 ruling; applied on
    localhost pending it. [Frontend, Compliance]
11. **H-11 — Sign-off.** The DPO signs §2.2.1 item 4, §3.1(d), Risks A and G. ROPA Activity 19's
    controller field is filled from L-11. [DPO]
12. **H-12 — Measured.** The real-app gap between host time and `ts` is measured and recorded, so
    the DPIA states a number. [QA]

## 11. Points on which the CEO must rule

**Filed as ESC-091, OPEN.** **Not ruled by ESC-084 or ESC-085 D-J,** which settled who emits and
what counts. None of these is needed for localhost; all are before production. C-5's recommendation
is applied on localhost pending its ruling, and the others are not applied in either direction: the
header exists because localhost needs an emitter, not because C-2 is decided.

| #   | Decision                                                                                                       | Recommendation                                                                                                                                                                                              | Cost                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| C-1 | Basis for conversion measurement: consent only, or legitimate interest as ROPA Activity 12 has it              | **Consent only,** as ESC-090 item 1 chose for the xid. The storage read seems to need consent anyway, withdrawal is then the single stop, and an LI basis would need an objection route that does not exist | A banner bump and re-prompt; only consenting sessions count (already so) |
| C-2 | Keep the header, knowing the session id reaches the backend beside the login; or build the receipt (section 6) | **Keep,** with the receipt as fallback if counsel rejects L-9                                                                                                                                               | Co-presence stays, controlled by code review alone                       |
| C-3 | Coarsen `ts` and `ingest_received_at` on signed conversions                                                    | **Decide after H-12.** Rounding up keeps `last_signed_conversion_at >= ad.ts` true but lets some pre-exposure conversions count, a small lift bias. It reduces matching, and does not end it at low volume  | Lift accuracy against matching difficulty                                |
| C-4 | A logged-in buyer's erasure: build an account-to-session lookup, or answer under Art. 11                       | **After L-10.** I lean to the lookup used only for a DSR: refusing while the join works looks worse                                                                                                         | The join becomes a design feature                                        |
| C-5 | Buyer refused optional analytics and accepted personalization: does the header go?                             | **No.** One line in the helper, and the buyer's clearest statement about measurement wins                                                                                                                   | Fewer conversions counted, in both arms                                  |

## 12. Found while reading, to file separately

1. **Notice §1 was false, independent of this flow; corrected in v1.16.** "does not read … any
   account credentials" against `boot.ts:160`: `localStorage.getItem('kc_token')`, parsed for `sub`,
   after the consent gate. By this role's rule, a false statement to data subjects is a P0 on the
   text. No live exposure as far as the record shows: "production serves no SDK" (ESC-081, ESC-082,
   dated 2026-10-04; not re-checked here). Fix the sentence (section 8), and DPIA §13.2 if it
   repeats it.
2. **DPIA §1 and the host policy disagree on establishment.** L-11.
3. **`deriveLeadId` is unkeyed,** so "pseudonymous lead ID" holds only against a party without the
   user list. Worth a keyed hash; it changes `lead_id` continuity, so ESC first.
4. **The `README` calls the header "the buyer's own claim".** True, and accepted for the lift: a
   logged-in buyer can attach a conversion to someone else's id if they know it. An Art. 5(1)(d)
   footnote, no more, since the id is unguessable.
5. **The host's optional-analytics box is pre-ticked** (`web/lib/ui/CookieConsent.svelte:11`).
   PostHog replay and `identify` rest on it. Whether a pre-ticked box is valid consent is for
   counsel (C-673/17 Planet49); it is outside this repository's documents, and CTO should see it
   with H-4. **Since C-5 was applied on localhost, the header's condition also rests on this box:**
   a buyer who leaves it ticked satisfies the helper.

## 13. Regulatory reference and deltas

GDPR Arts. 4(1), 4(5), 5(1)(b), 5(1)(c), 5(1)(d), 5(1)(e), 6(1)(a), 6(1)(f), 7(1), 7(3), 9, 11, 13,
15, 17, 35(9), Recital 26; ePrivacy Art. 5(3); EDPB Guidelines 2/2023; C-582/14 Breyer; C-413/23 P
EDPS v SRB; C-673/17 Planet49, for counsel to apply. Outside sources were read through search
summaries and vendor or law-firm pages, not the primary text.

**Audit-log schema delta:** none. **Event schema:** `channel: 'conversation'` and `event_kind`, both
in the PR. **Protected-class scan:** no new buyer-facing copy in this PR; the draft sentences name
no protected class or proxy.

NEXT: the PM stages these paths, gets `web-master-x1-conversion-header.patch` regenerated (M-2),
takes M-4 and the architect's §D.8 edit, and the CEO rules ESC-091.
