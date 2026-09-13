# AREA 6 — Adaptation engine (`/api/adapt` + helpers) — audit at `main` @ f510f749

Read-only. Every claim below is traced to code at HEAD. Docs are compared against, never trusted.

## Branch table (the shipped decision tree)

Thresholds: `route.ts:106-108` (`CONFIDENCE_THRESHOLD=0.6`, `HIGH_SIMILARITY_THRESHOLD=0.85`,
`LOW_SIMILARITY_THRESHOLD=0.6`). Order of evaluation in `runDecisionTree`: 1 → 2 → 4 → 3.

| #   | condition (evaluated in this order)               | what is actually SERVED                                                                                                     | LLM model                                                                                                                            | judge budget                                                  | timeouts                                                                                                                                                           | fallback                                                                                                                                                        | recorded `source` / `scoring_path`                                                                                                               | tests                                                          |
| --- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| 1   | `confidence <= 0.6` (`:341`)                      | `[]`                                                                                                                        | none                                                                                                                                 | n/a                                                           | n/a                                                                                                                                                                | none (terminal)                                                                                                                                                 | `source:'default'`; `scoring_path` = `not_applicable` unless a ReorderDirective was built (`:712`, `:949`)                                       | `route.test.ts`, `route.follow346.test.ts`                     |
| 2   | `similarity > 0.85` (`:440`)                      | `withholdUngroundedDirectives(resolvePlaybook())` → **only the `cta`**, English (`ungrounded-directives.ts:60`, `:104-118`) | none (no listing fetch: `listing-facts-context.ts:31`, `:88`)                                                                        | n/a                                                           | 800 ms placeholder fetch (`listing-details.ts:51`)                                                                                                                 | n/a                                                                                                                                                             | `source:'playbook'`, `fallback_reason:'ungrounded_directives_withheld'`, `variant_suppressed` → recorded variant `control` (`:452-472`, `:1994`) | `route.follow1163.test.ts`, `route.follow1140.test.ts`         |
| 4   | `similarity <= 0.6` (`:513`)                      | gateway directives verbatim, or **`[]`** on any null (`:537`, `:545-549`)                                                   | `forceModel` ?? `getGlobalGenerationModel()` (default `claude-sonnet-4-6`) (`llm-gateway.ts:1354-1362`, `global-config-store.ts:44`) | 3 (`JUDGE_CALL_BUDGET_GENERATION_BAND`, `llm-gateway.ts:235`) | judge 2000 ms/call w/ AbortController (`:141`, `:1156-1167`); **generation call has NO timeout** (`:1392-1396`); no route budget (by decision, `route.ts:474-511`) | `source:'playbook_fallback_llm_unavailable'` + `fallback_reason` ∈ {`llm_unavailable`,`fact_check_refused`,`listing_context_unavailable`} — **zero directives** | same                                                                                                                                             | `route.test.ts` (`llm_full`), `llm-gateway.follow1178.test.ts` |
| 3   | `0.6 < similarity <= 0.85` (fall-through, `:552`) | gateway directives verbatim (`:576`), else **the withheld template = English `cta` only** (`:592-606`)                      | `forceModel` ?? `claude-haiku-4-5` (not selectable) (`llm-gateway.ts:1355-1357`)                                                     | 3 (`JUDGE_CALL_BUDGET_TWEAK_BAND`, `:211`)                    | as above                                                                                                                                                           | `source:'playbook_fallback_llm_unavailable'` + `fallback_reason`; 1 directive                                                                                   | `route.follow1163.test.ts`, `llm-gateway.follow1180.test.ts`, FOLLOW-1022 canary                                                                 |

Notes on the table: the judge is always `claude-haiku-4-5` regardless of band
(`llm-gateway.ts:1189`); `max_tokens` is 512 for generation, 50 for the judge; `scoring_path` is a
**reorder-path** discriminator (`'cosine'|'djb2_fallback'|'djb2_guard'|'not_applicable'`,
`route.ts:949`) and is gated behind `SCORING_PATH_COLUMN_ENABLED` (`:720-788`) — it says nothing
about which text branch ran. Demo mode pins `similarity=0.75`, `confidence=0.95`
(`demo-override-store.ts:97-98`) → always branch 3.

---

## AD-1 — Playbook census: 18 registered, 17 with exactly 3 slots, `headline` is the only variant-bearing slot

- **Claim** The registry holds 18 playbooks, one per `ARCHETYPE_NAMES` entry; the 17 non-neutral
  ones carry exactly 3 slots (`headline`, `cta`, `feature`) and `neutral` carries 0; `variants.en`
  (3 arms) exists on `headline` only, in all 17.
- **Status** CONFIRMED (memory `17 shipped playbooks × 3 slots` is accurate).
- **Evidence** `packages/sdk/src/core/playbooks/index.ts:36-56` (18-entry map, `getPlaybook` falls
  back to `neutralPlaybook`); `packages/sdk/src/core/intent.ts:49-68` (18 archetype names — 1:1, no
  unmapped archetype); slot count per file = 3 for all except `neutral.ts` (0);
  `archetypes/yield-hunter.ts:7-19` (headline+variants, `cta`, `feature`); every `variants:` block
  in the 17 files sits under `slot: 'headline'`.
- **Impact on measured pilot** none by itself; it is the premise the next four findings rest on.
- **Ticket coverage** FOLLOW-1164 (playbooks → briefs) OPEN P2, queued after FOLLOW-1165
  (QUEUE.md:28).
- **Priority** P3 (reference finding).
- **Proposed AC** (1) a CI census test asserts slot count and variant placement per playbook so a
  4th slot cannot land silently (the judge budgets are derived from `3`, `llm-gateway.ts:206-210`,
  `:217-221`).
- **Red-first** add a 4th slot to one playbook in a fixture → the census test must go red; today
  nothing does.

## AD-2 — Production-eligible directive surface is ONE slot, and it is English-only regardless of `locale`

- **Claim** After §E.7.0 the only directive any template path can serve is the `cta`; no playbook
  slot carries a `pl`/`es` override, so `runDecisionTree`'s locale chain can never fire and a
  Polish/Spanish session is served English copy on branch 2, on every branch-3 fallback (outage _or_
  fact-check refusal), and — because `filterDirectivesByPageType` strips `headline` off non-detail
  pages — on most LLM responses too.
- **Status** PARTIAL (the withhold works as designed; the locale half is a live gap).
- **Evidence** `ungrounded-directives.ts:60` `NON_ASSERTIVE_SLOTS = new Set(['cta'])`;
  `route.ts:392-398` value chain
  `(locale==='pl'? s.pl : locale==='es'? s.es : undefined) ?? variants.en[i] ?? s.en`; a repo-wide
  scan of `packages/sdk/src/core/playbooks/archetypes/*.ts` finds `pl:`/`es:` **only** inside
  `copy_template` (e.g. `yield-hunter.ts:46`), never on a slot; `route.ts:1436-1437` (`headline`
  stripped unless `page_type==='listing_detail'`).
- **Impact on measured pilot** degrades data + product: a non-English pilot page measures "did we
  paint an English CTA", and RETRO-321's expectation that a non-English pilot would _fail_ the
  differentiator is wrong — it passes (see AD-6).
- **Ticket coverage** PARTIAL: FOLLOW-362 (DONE — suppresses the _bandit_ for non-`en`), FOLLOW-400
  (un-suppress trigger, stub, P3, `promoted_to_queue` not set), FOLLOW-1164 (briefs). **No ticket
  says "the served copy is English for pl/es buyers".**
- **Priority** P1 for any non-English pilot; P2 if the measured pilot is English-only (a CEO call —
  see Open questions). Depends on FOLLOW-1164.
- **Proposed AC** (1) either the 17 `cta` strings gain `pl`/`es` values, or `/api/adapt` returns
  `directives: []` (+ a named `fallback_reason`) for a non-`en` locale rather than English copy; (2)
  a test asserts, per locale, that no served directive value equals the English string unless the
  locale IS `en`; (3) MASTER_DESIGN records which locales the directive axis supports.
- **Red-first** `POST /api/adapt` with `locale:'pl'`, `similarity:0.9` → today returns the English
  `cta`; the new test asserts a `pl` string or an empty response.

## AD-3 — `similarity` and `confidence` are the same number, so branch 2 and branch 4 are nearly unreachable

- **Claim** The SDK sends `similarity = probabilities[archetype]` and
  `confidence = that same value × 1.2` when the quiz was answered (otherwise identical).
  Consequences at HEAD: without a quiz, branch 4 is **unreachable** (`similarity<=0.6` implies
  `confidence<=0.6`, and branch 1 returns first); with a quiz it is reachable only for
  `similarity ∈ (0.5, 0.6]`; the quiz leaf pins `similarity` at exactly `0.85`, which is **not**
  `> 0.85`, so the quiz path never reaches branch 2 either. The only routinely exercised branch
  is 3.
- **Status** CONFIRMED (code), and it makes the ADP-002 header at `route.ts:7-10` misleading — the
  two axes are not independent.
- **Evidence** `packages/sdk/src/core/adapt.ts:1245-1247`
  (`body.confidence = intentState.confidence`,
  `body.similarity = intentState.probabilities[intentState.archetype]`); `intent.ts:848`
  (`confidence: maxProb`), `:732-735` + `:694` (`QUIZ_CONFIDENCE_BONUS = 1.2`), `:1334-1344` (quiz
  leaf `leafProb = 0.85`); `route.ts:1776-1778` (server trusts the body as-is);
  `demo-override-store.ts:98` (`0.75`).
- **Impact on measured pilot** invalidates measurement of anything branch-scoped: a pilot cannot
  report "branch 2 was sub-second" or "Sonnet full generation converts better" because those
  branches barely execute. FOLLOW-1184 already records that every live number is `similarity: 0.75`.
- **Ticket coverage** PARTIAL: FOLLOW-1184 (P2, "every live number is still `similarity: 0.75`", the
  band instrument has never been RUN) — it measures the bands but does not state the reachability
  arithmetic. No ticket says `similarity == confidence`.
- **Priority** P1 (cheap, and it changes how FOLLOW-1184's output must be read). Depends on nothing.
- **Proposed AC** (1) a unit test over the SDK→route contract pins which `(confidence, similarity)`
  pairs are producible and which branches they select; (2) the route/ADP-002 docblock states that
  `similarity` is the archetype posterior, not a cosine, and that branch 4 needs a quiz; (3)
  FOLLOW-1184's report includes the reachable pair set.
- **Red-first** a test asserting "branch 4 is reachable from a behaviour-only session" fails today;
  after the fix the documented pair set is asserted and green.

## AD-4 — "RAG" is dead in practice: retrieval requires an `intent_vector` nobody sends; grounding is an HTTP listing fetch

- **Claim** A real retrieval step exists (pgvector cosine over the `answers` table, top-3) but it
  returns `{}` unless the caller supplies both `listing_id` and a `1536`-dim `intent_vector`, and no
  producer in the repo sends `intent_vector`. What actually grounds the prompt is `withListingFacts`
  → a plain HTTP GET of the listing (4 text fields, 2 s abort, fail-open).
- **Status** PARTIAL / STALE (the `TICKET-AGENCY-001` "RAG" label survives; the retrieval never
  fires).
- **Evidence** `lib/rag-retrieval.ts:39-46` (early `{}` when vector absent), `:52-63` (the pgvector
  query); `route.ts:1884-1888` (`body.intent_vector ?? null`); grep for `intent_vector` outside the
  route/docs returns no producer; `lib/listing-facts-context.ts:84-101` (the fact merge, ceiling
  0.85), `lib/listing-details.ts:38`/`:78-84` (2000 ms abort, `redirect:'manual'`, fail-open);
  `route.ts:1919` (`groundingMissing`).
- **Impact on measured pilot** degrades data: the agency-curated FAQ layer contributes nothing, so
  grounding quality is whatever the listing backend returns, and MP-010's "listing never shown to
  the model" cause is only half closed.
- **Ticket coverage** PARTIAL: FOLLOW-1120 (DONE — narrows the fallback reason), MP-010/MP-017. **No
  ticket wires or retires `intent_vector`** → NO COVERAGE for the retrieval half.
- **Priority** P2. Depends on the intent engine exposing a session vector (FOLLOW-817 axis).
- **Proposed AC** (1) either the SDK/ingest supplies `intent_vector` (and a test proves a non-empty
  `answers` hit reaches `listingContext`), or `retrieveListingContext` is retired and the code/docs
  stop calling this path RAG; (2) a counter distinguishes "no FAQ rows" from "no vector".
- **Red-first** an integration test asserting `listingContext` contains at least one `answers` row
  for a seeded tenant+listing through the real SDK request shape is red today.

## AD-5 — The judge is bounded; the generation call is not, and a config DB error 500s branch 4

- **Claim** Two real bounds exist on the judge (2 s per call via `AbortController` + 3 calls per
  request per band, both fail closed). The **generation** call has no deadline, no abort signal and
  no route budget, so its worst case is the Anthropic SDK default (minutes, with retries) on a
  request a buyer is waiting on. Separately, `getGlobalGenerationModel()` is awaited **outside** the
  gateway's `try` and throws when a DB is configured but unreachable (or when `DATABASE_URL_ADMIN`
  is unset while `DATABASE_URL` is set) — so a Postgres hiccup makes branch 4 answer 500 with no
  directives, no `source` and no ClickHouse row, while the code comment above it claims the
  opposite.
- **Status** PARTIAL (judge: CONFIRMED; generation deadline: documented-as-declined; the throw path:
  a defect).
- **Evidence** judge: `llm-gateway.ts:141` (`JUDGE_DEADLINE_MS=2000`), `:1156-1167` (deadline race +
  `controller.abort()`) + `:1186-1196` (`{signal}` on the request), `:271-273` (`judgeCallBudget`),
  `:1574-1596` (over-budget skip, fail-closed); generation: `:1392-1396` (`client.messages.create`
  with no `timeout`/`signal`), `route.ts:474-511` (the explicit "not now" on a route budget); throw
  path: `llm-gateway.ts:1362` `model = await getGlobalGenerationModel()` sits above the `try` at
  `:1390`, `global-config-store.ts:70-78` (throws by design when configured),
  `packages/db/src/client.ts:188-191` (`throw new Error('DATABASE_URL_ADMIN is not set')`), and the
  contradicting comment at `llm-gateway.ts:1358-1361` ("never hard-fails even when config DB is
  unavailable"); POST has no try/catch around `runDecisionTree` (`route.ts:1969`).
- **Impact on measured pilot** blocks go-live on the throw path (a 500 on `/api/adapt` is an outage,
  not a fallback) and degrades data on the deadline path (an un-bounded tail is attributed to "the
  model is slow" with no cut-off).
- **Ticket coverage** PARTIAL: FOLLOW-1040 (DONE — judge bounds), Track LATENCY FOLLOW-1037 (DONE) /
  1038 / 1039, FOLLOW-1063 (Postgres pool, P2, queued behind localhost path). **The unguarded
  `getGlobalGenerationModel()` throw has NO COVERAGE.**
- **Priority** P1 for the throw (one `try/catch` or a `.catch(() => DEFAULT_GENERATION_MODEL)`); P2
  for the generation deadline (needs the new `source` value FOLLOW-1040 refused to invent).
- **Proposed AC** (1) a config-DB failure on branch 4 returns a normal `playbook_fallback_*`
  response, never a 5xx, proven by a test that makes the store reject; (2) the false comment at
  `llm-gateway.ts:1358-1361` is corrected; (3) if a generation deadline is added it ships with its
  `source`/`fallback_reason` consumer (SDK enum + canary + ClickHouse).
- **Red-first** mock `getGlobalGenerationModel` to reject, POST with
  `similarity: 0.3, confidence: 0.9` → today the handler throws; green when the response is a 200
  `playbook_fallback_llm_unavailable`.

## AD-6 — Refusal is indistinguishable from adaptation on branch 3, and the FOLLOW-819 gate counts directives

- **Claim** On branch 3 a refused batch (`fact_check_refused`) and an LLM outage both return one
  English `cta` with `source:'playbook_fallback_llm_unavailable'`; on branch 4 both return zero
  directives. The FOLLOW-819 harness's AC(1) asserts `totalDirectives > 0` and only _logs_ `source`,
  so a refused batch passes the gate that FOLLOW-820 condition 1 grades.
- **Status** CONFIRMED (the defect is exactly FOLLOW-1186's claim, verified independently here).
- **Evidence** `route.ts:592-606` (branch-3 fallback serves the withheld template), `:545-549`
  (branch 4 serves `[]`), `llm-gateway.ts:1598-1634` (the verdict loop, ending in
  `fallback('fact_check_refused')` at `:1634`);
  `tests/e2e/follow-819/differentiator-e2e.mjs:886-900` (`totalDirectives` sum, `source` recorded as
  metadata only). `playbook_fallback_llm_capped` is still a value with no producer
  (`llm-gateway.ts:1365-1377` returns `llm_unavailable` on the cap).
- **Impact on measured pilot** invalidates measurement: FOLLOW-820 condition 1 can read GREEN on a
  run where the model's output was refused every time and the buyer saw a canned English button
  label.
- **Ticket coverage** FOLLOW-1186 (P2, `promoted_to_queue: false`) — filed, not scheduled;
  FOLLOW-899 (cap producer, P2 **FROZEN**); FOLLOW-1188 item 1 (the wrong-branch prose).
- **Priority** **P0 relative to FOLLOW-820** — it is cheap and it is the difference between a gate
  and a ceremony. Depends on nothing.
- **Proposed AC** (as FOLLOW-1186) (1) AC(1) asserts the adapted arm's
  `source ∈ {llm_tweaked, llm_full}` or reports adapted/refused/template separately with
  `fallback_reason`; (2) red-first via a forced refusal; (3) the harness docblock states a template
  `cta` alone is not adaptation.
- **Red-first** drive the harness against a fixture whose generation the fact check refuses: AC(1)
  is green today, must be red after.

## AD-7 — Grounding and hallucination control: corpus is the listing + the buyer's own events; four hard-coded claims still ship in variants

- **Claim** §E.7.0 is implemented on the corpus (`buildDirectiveGroundingText` = `listingContext`
  JSON + `recentEvents`, lower-cased — no template text), the number check is a deterministic
  canonical-digit reject, proper names are a high-recall Unicode capital scan against a ~90-word
  stop-cap list with a Haiku judge as the precision filter, and `#886`'s registers now book
  exempt/over-budget flags. Two residuals: (a) FOLLOW-1157's four hard-coded claims are still in the
  shipped variants and are still injected into the Haiku prompt as "Current directives"; (b) the
  unjudged register is a lower bound, not a partition (FOLLOW-1187).
- **Status** PARTIAL.
- **Evidence** corpus: `llm-gateway.ts:877-895`; numbers: `:997-1009` + `canonNumber` `:925-927`;
  names: `:1011-1094` (segment-initial exemption, `\p{Lu}` candidate test, `\p{L}\p{N}` boundaries),
  stop-caps `:735-859`; judge: `:1120-1268`; registers: `:388-400` (`FACT_CHECK_UNJUDGED_SOURCE`)
  with its derivation at `:314-386`, `:1537-1550` (scan+exempt), `:1553-1572` (exempt rows),
  `:1574-1596` (over-budget row); provenance exemption `:988-995` + its call site `:1537-1546`;
  hard-coded claims at HEAD — `archetypes/vacation-rental-investor.ts:14`
  (`Tourist License, Near Beach`), `golden-visa-buyer.ts:10,15`
  (`Golden Visa Eligible — Residency by Investment`, `Fast Track Residency`),
  `commercial-investor.ts:14` (`Triple Net Lease`), `family-buyer.ts:13` (`Near Top-Rated Schools`);
  prompt injection of them: `llm-gateway.ts:594-628` (`Current directives … ${baseDirectivesJson}`
  built from `s.en`). Remaining placeholder tokens are 5 kinds, all on headlines: `{bedrooms}`×15,
  `{location_highlight}`×4, `{key_feature}`×3, `{neighborhood}`×3, `{sqm}`×3 — `{yield}`/`{income}`
  are gone (ESC-075).
- **Impact on measured pilot** legal-security exposure is _mitigated_ today only because `headline`
  is withheld on the paths that never read the listing — the strings cannot reach a buyer through
  branch 2 or a branch-3 fallback. They can still steer the model (the prompt shows them as framing;
  `GROUNDING_RULE` asks the model not to carry their vocabulary — a soft control).
- **Ticket coverage** FOLLOW-1157 (OPEN, queued near-last: QUEUE.md:28), FOLLOW-1158, FOLLOW-1164,
  FOLLOW-1187 (P2, filed), FOLLOW-1165 (unblocked by #886), FOLLOW-1188 (prose).
- **Priority** P2 for FOLLOW-1157 as long as the withhold holds; it becomes P1 the moment
  FOLLOW-1164 re-opens `headline` service. Depends on FOLLOW-1164.
- **Proposed AC** (1) a test enumerates every shipped slot/variant string and fails on any claim
  about the property that a listing could contradict (the four above are the red-first set); (2) the
  same test pins that such strings are not passed to the model as `Current directives`, or states
  why framing is exempt; (3) FOLLOW-1187's lower-bound caveat lands in MP-012.
- **Red-first** the enumeration test fails today on exactly those four strings.

## AD-8 — The bandit is inert end to end: no served copy depends on the arm, and `ab_bandit_weights` cannot move

- **Claim** (i) On the template paths the arm-bearing slot (`headline`) is withheld, which ESC-077
  option 2 handles by recording `control`. (ii) On the LLM paths the arm reaches nothing at all:
  `callLlmGateway` receives the raw `basePlaybook` and both prompt builders render `s.en`, never
  `variants.en[variantIndex]` — yet `recordedVariant` is the sampled arm, so v1/v2 are credited for
  copy no arm influenced. (iii) `ab_bandit_weights` has exactly one writer besides the seeder —
  `POST /api/adapt/feedback` — and it 503s unless `FEEDBACK_ENDPOINT_ENABLED === 'true'`, which is
  unset by default and whose prod flip is itself a FOLLOW-820 condition. So no posterior has ever
  moved from real feedback.
- **Status** CONFIRMED (i is by design; ii is FOLLOW-1168's defect; iii is the deliberate
  pilot-launch gate).
- **Evidence** (i) `route.ts:375-398`, `:466-470`, `:598-606`, `:1994` / `:1325`; (ii)
  `route.ts:1969-1981` passes `basePlaybook: playbook` (not the variant-selected directives) and
  `llm-gateway.ts:596-604` builds `Current directives` from `s.en`, `:676`
  (`Available slots: headline, cta, feature` literal) — nothing reads `VARIANT_INDEX` on these
  paths; (iii) `feedback/route.ts:262` (503 gate), `:119-170` (`updateBanditArm` upsert),
  `.env.example:117-119`; `lib/bandit-query.ts:55-108` (read + seed only);
  `packages/shared/src/bandit.ts:127-166`.
- **Grading against FOLLOW-820** the checklist requires: FOLLOW-819 green **including demonstrated
  holdout arm separation**, FOLLOW-815, FOLLOW-817's prod traffic proof, and "FOLLOW-450's prod
  operator leg flipped with a pasted real weight delta". So the pilot does **not** require a
  _working_ bandit — but it does require one real `ab_bandit_weights` delta, and it requires the
  holdout mechanism to separate arms. Item (ii) is the only part of this finding that corrupts pilot
  data; (iii) is the gate itself.
- **Impact on measured pilot** (ii) degrades data (a variant column that means nothing on the two
  branches that actually serve model copy); (i) and (iii) none.
- **Ticket coverage** FOLLOW-1168 (P1, OPEN, next-after-retros in QUEUE.md:25); ESC-077 RESOLVED
  (option 2); FOLLOW-450 operator leg = FOLLOW-820 condition 4; FOLLOW-1164 (what a variant means
  once slots are briefs).
- **Priority** P1 for FOLLOW-1168 (already queued); P3 for the rest.
- **Proposed AC** (1) either the LLM prompt is built from the variant-selected copy (and a test
  proves two arms produce two different prompts), or the LLM branches report `variant_suppressed`
  and record `control`; (2) a test asserts `adaptation_decisions.variant !== 'control'` only when
  some served value could have differed by arm; (3) the FOLLOW-450 weight delta is pasted as
  evidence, per FOLLOW-820 condition 4.
- **Red-first** assert that the Anthropic request body differs between `variant:'control'` and
  `variant:'v2'` for the same playbook — red today.

## AD-9 — `archetype_hint` is an unvalidated free string that lands in the prompt and in a `LowCardinality` column

- **Claim** `POST /api/adapt` accepts `archetype_hint: z.string().optional()` and casts it to
  `ArchetypeId`. The value is interpolated into the model prompt (`Archetype: ${archetypeId} — …`)
  and written to `adaptation_decisions.archetype`, which is `LowCardinality(String)`. `getPlaybook`
  falls back to neutral, so nothing crashes and nothing rejects.
- **Status** CONFIRMED.
- **Evidence** `route.ts:211` (schema), `:1776` (`as ArchetypeId` cast), `llm-gateway.ts:612-628`
  (`Archetype: ${archetypeId}`, and the same id is echoed into the required JSON schema line),
  `route.ts:791` (`param_p_archetype`),
  `infra/clickhouse/migrations/0003_create_adaptation_decisions.sql:19`
  (`archetype LowCardinality(String)`).
- **Impact on measured pilot** degrades data (unbounded cardinality in the column every pilot query
  groups by) and is a prompt-injection surface for any holder of a tenant API key or demo JWT.
- **Ticket coverage** NO COVERAGE. The only mention of `z.string().optional()` here is as an
  accidental fail-safe leg inside the P3 stub at `backlog/FOLLOW_UPS.md:14594`.
- **Priority** P2 (authenticated-caller-only, cheap fix). Depends on nothing.
- **Proposed AC** (1) `archetype_hint` is validated against `ARCHETYPE_NAMES` (`z.enum`) and an
  unknown value either 400s or is coerced to `neutral` **before** it reaches the prompt and the log;
  (2) a test posts `archetype_hint: "ignore previous instructions"` and asserts it never appears in
  the model request nor in the ClickHouse params.
- **Red-first** that test fails today (the string reaches both).

## AD-10 — `GROUNDING_RULE` promises the model a consequence the product no longer has

- **Claim** The prompt tells the model that non-compliant output is "DISCARDED and the buyer is
  served generic template copy instead". Since §E.7.0 that is false on both LLM branches: branch 4
  serves nothing and branch 3 serves one English `cta`.
- **Status** STALE (prose in shipped source; behaviour is correct).
- **Evidence** `llm-gateway.ts:559-562` vs `route.ts:545-549` and `:592-606`; MASTER_DESIGN §E.7.0
  (`docs/MASTER_DESIGN.md:2664-2672`, "there is no third behaviour to fall back to").
- **Impact on measured pilot** none directly; it is the same class of drift FOLLOW-1188 was opened
  for, and it misstates the stake to the model.
- **Ticket coverage** PARTIAL — FOLLOW-1188 (P2) sweeps four other stale sentences in this file but
  not this one.
- **Priority** P3, fold into FOLLOW-1188.
- **Proposed AC** (1) the rule states the real consequence per band; (2) FOLLOW-1188's item list
  gains this line so the sweep is complete.
- **Red-first** a docs/prose assertion test is not warranted; proof of done is the FOLLOW-1188 PR
  diff naming this string.

## AD-11 — The $100/day breaker is global, serial, and outside the instrumented segment

- **Claim** Every LLM-branch request runs a blocking `SELECT sum(cost_usd) FROM llm_calls` against
  ClickHouse before calling the model; the query has no tenant filter, fails open on error, and sits
  _after_ the `route_pre_llm` segment, so its latency is in no instrument.
- **Status** CONFIRMED (low severity under the single-tenant re-brand model).
- **Evidence** `llm-gateway.ts:484-510` (`getRolling24hSpend`, fail-open `return 0`), `:1364-1382`
  (cap/warn), `route.ts:1944` (`summarizePreLlmSegment` closes before the `runDecisionTree` call at
  `:1969`), `lib/adapt-segment-timing.ts:51-61`.
- **Impact on measured pilot** degrades data (one un-timed dependency hop per adapted request, on
  the exact axis MP-013/MP-014 are about).
- **Ticket coverage** PARTIAL: FOLLOW-899 (cap has no distinguishable `source`, P2 FROZEN). No
  ticket on the un-timed hop or the missing tenant scope.
- **Priority** P3.
- **Proposed AC** (1) the spend query is timed into the same register as the other segments, or
  cached for a bounded window; (2) if multi-tenant ever returns, the cap is per-tenant.
- **Red-first** a test asserting a `route_pre_llm`-style breakdown entry exists for the breaker
  query is red today.

## AD-12 — Duplicated band thresholds: the gateway re-states `0.6`/`0.85` as literals

- **Claim** The route owns the thresholds as named constants; the gateway re-implements the same
  band with bare literals, and `listing-facts-context.ts` keeps a third private copy. All three
  agree today.
- **Status** CONFIRMED (latent drift risk).
- **Evidence** `route.ts:106-108` vs `llm-gateway.ts:1355`
  (`similarity > 0.6 && similarity <= 0.85`) vs `listing-facts-context.ts:31`
  (`LLM_BRANCH_SIMILARITY_CEILING = 0.85`, with its own drift note).
- **Impact on measured pilot** none today; a one-sided edit would silently mismatch the
  prompt/model/budget triple with the route's branch.
- **Ticket coverage** NO COVERAGE.
- **Priority** P3.
- **Proposed AC** (1) a parity test asserts the three values are equal (the `listing-facts-context`
  docblock already nominates a boundary test); (2) no fourth copy.
- **Red-first** change `HIGH_SIMILARITY_THRESHOLD` to 0.9 in a fixture: nothing reds today.

---

## Area verdict

The adaptation engine's _safety_ machinery is the strongest part of this area: §E.7.0's withhold,
the narrowed grounding corpus, the deterministic number reject, the bounded fail-closed judge and
the new unjudged registers are all real, tested and honestly documented. The _product_ machinery is
much thinner than the documentation implies. After the withhold, the only thing a template path can
serve is one English `cta`; the locale parameter is dead for every shipped playbook; the Thompson
bandit influences no served byte on any branch and its posteriors cannot move because its only
writer is gated; and the four-branch routing is effectively one branch, because `similarity` is the
same quantity as `confidence` and nobody sends anything but 0.75. Two items should move before
FOLLOW-820 is graded: AD-6 (the gate counts directives, so a refused batch scores as an adaptation —
FOLLOW-1186 is filed but unscheduled) and AD-5's unguarded `getGlobalGenerationModel()` throw (a 500
where the design promises a fallback). AD-3 does not block GO but must be stated in the ruling, or
the pilot will be read as evidence about branches that never ran.

## Open questions for the CEO

1. **Is the measured pilot English-only?** If not, AD-2 is a P1 blocker: a `pl`/`es` buyer is served
   English copy on branch 2, on every branch-3 fallback and on every non-detail page, and the
   differentiator gate would score that as a pass (AD-6). If yes, say so in FOLLOW-820 so no later
   audit re-files it.
2. **Does the `cta` carve-out from §E.7.0 stand as ratified?** The ruling's text says every
   directive must derive from the listing; FOLLOW-1163/ESC-077 serve the `cta` on the argument that
   it asserts no property fact. That reading is defensible and enumerated, but it is currently an
   engineering interpretation of a CEO ruling, and it is the single directive the pilot will
   actually paint.
