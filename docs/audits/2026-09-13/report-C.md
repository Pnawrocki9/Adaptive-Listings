# Audit report C — AREA 4 (Intent engine, `I-n`) + AREA 5 (Embeddings path, `E-n`)

Repo `/home/asipi/Projects/Adaptive-Listings`, branch `main` @ `f510f749`. Read-only. Line numbers
at HEAD.

## Where the real code lives (orientation, verified)

| Thing                         | Real location                                                               | Notes                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Bayesian archetype classifier | `packages/sdk/src/core/intent.ts` (1782 lines)                              | Runs **client-side** in the SDK. The only classifier that decides the archetype the pilot serves. |
| Canonical archetype list      | `packages/sdk/src/core/intent.ts:49-69` (`ARCHETYPE_NAMES`)                 | `packages/shared/src/archetypes.ts:13` names it "TRUE canonical source of truth".                 |
| Chat NLP (extraction only)    | `apps/intent-engine/src/nlp.py`                                             | 12 intent dimensions + `archetype_hint`; no Bayesian scoring.                                     |
| Server decision tree          | `apps/control-plane/src/app/api/adapt/route.ts:281-634` (`runDecisionTree`) | Consumes client-sent `archetype_hint` / `confidence` / `similarity`.                              |
| Cosine / hash affinity        | `apps/control-plane/src/app/api/adapt/route.ts:879-1010`                    | `deterministicScore`, `affinityScore`, `buildReorderDirective`.                                   |
| Embedding lookups             | `apps/control-plane/src/lib/embedding-lookup.ts`                            | Fail-open -> `null` -> hash fallback.                                                             |
| `packages/intent-ontology`    | 14 lines, one constant                                                      | Not the intent engine (see I-1).                                                                  |

---

# AREA 4 — Intent engine

## I-1 — `packages/intent-ontology` is a 14-line placeholder; the intent engine is in the SDK

- **Claim** Docs present `@estalara/intent-ontology` as the "12-dimension buyer intent schema"; at
  HEAD it exports one string constant and has zero consumers.
- **Status** STALE (docs) / ASPIRATIONAL (package)
- **Evidence** `packages/intent-ontology/src/index.ts:1-14` (whole file); `:14`
  `export const INTENT_ONTOLOGY_VERSION = '0.0.0' as const;`; `:4` "Full implementation in
  TICKET-013". `packages/intent-ontology/README.md:7` "Placeholder — full implementation pending."
  `README.md:307` still lists it as "12-dimension buyer intent schema". The real 12-dimension vector
  is `apps/intent-engine/src/schemas.py` + `CHAT_INTENT_LIKELIHOODS`
  (`packages/sdk/src/core/intent.ts:476-560`).
- **Impact on measured pilot** none (dead package) — but it misdirects every reader about where
  intent logic lives, which is the 2026-05-20 duplication anti-pattern's mechanism.
- **Ticket coverage** FOLLOW-784 (P3, `backlog/FOLLOW_UPS.md:25412`, no QUEUE row -> OPEN);
  FOLLOW-824 (CEO build-or-delete, `backlog/QUEUE.md:28249`, status **BLOCKED_ON_HUMAN**).
- **Priority** P3 — depends only on the FOLLOW-824 ruling.
- **Proposed AC** (1) FOLLOW-824 ruled; (2) on "delete", package removed from the workspace, from
  `README.md:307`, and from the `10 packages` count in `CLAUDE.md`; (3) on "build", it owns the
  12-dimension schema and both `nlp.py` and `CHAT_INTENT_LIKELIHOODS` take dimension names from it.
- **Red-first proof** CI assertion that every `packages/*` has >=1 non-test importer outside itself:
  red today for `intent-ontology`, green after delete-or-wire.

## I-2 — (a) Reachability: 18 defined, **18/18 reachable via the built-in quiz**; the "13/18" memory is stale

- **Claim** 18 archetypes are defined in four parity-gated places, and the built-in default quiz
  tree resolves all 17 non-neutral archetypes plus `neutral`.
- **Status** CONFIRMED (18/18 quiz-reachable) — supersedes "13/18".
- **Evidence**
  - Definitions (all 18): `packages/sdk/src/core/intent.ts:49-69`;
    `packages/shared/src/archetypes.ts:26`; `packages/db/src/seed/archetype-seeds.ts:17-126` (18
    rows); `apps/intent-engine/src/nlp.py:71-90` (18);
    `apps/llm-gateway/src/jobs/generate_description.py:161-236` (`_ARCHETYPE_GUIDANCE`, 18 keys);
    `packages/sdk/src/core/playbooks/archetypes/` (18 files).
  - Parity gates exist and run:
    `packages/shared/src/__tests__/archetype-canonical-parity.test.ts:81` (parses the real
    `intent.ts`); `tests/integration/archetype-id-parity.test.ts:174,239,252,270` (parses `nlp.py`,
    `_ARCHETYPE_GUIDANCE`, `REACHABLE_ARCHETYPES`, `MOCK_ARCHETYPES`). The integration package was
    added to the CI filter at `.github/workflows/ci.yml:201` after FOLLOW-1065 found it had "zero
    executions".
  - Quiz reachability enumerated from `packages/sdk/src/ui/quiz-widget.ts:118-295`
    (`DEFAULT_QUIZ_DEFINITION`) under the argmax reducer at `:319-340`: investor ->
    `vacation_rental_investor`, `flip_investor`, `commercial_investor`, `yield_hunter`,
    `portfolio_builder`, `golden_visa_buyer` (6); own-use -> `first_time_buyer`, `family_buyer`,
    `upsizer`, `downsizer`, and via Q3 weight 2 -> `luxury_buyer`, `remote_worker` (6); cross-border
    -> `second_home_buyer`, `student_parent`, `retiree_relocator`, `diaspora_buyer`,
    `lifestyle_expat` (5); "Just browsing" (all-empty weights) -> `neutral`. **17 + neutral =
    18/18.**
  - Chat path covers all 17: every non-neutral archetype appears as a favoured key in
    `CHAT_INTENT_LIKELIHOODS` (`packages/sdk/src/core/intent.ts:476-560`).
  - `docs/MASTER_DESIGN.md:484` and `:2079` already claim 18/18 (FOLLOW-344 / FOLLOW-364) —
    **correct**. `docs/MASTER_DESIGN.md:563` ("≥13/18") is the historical FOLLOW-100 target.
- **Impact on measured pilot** none — docs beat the memory here.
- **Ticket coverage** N/A (no defect).
- **Priority** P3 (memory/doc hygiene).
- **Proposed AC** (1) memory `project_adaptive_listings_v1_scope` corrected 13/18 -> 18/18 with this
  evidence; (2) `MASTER_DESIGN.md:563` marked historical.
- **Red-first proof** A test walking every root->leaf path of `DEFAULT_QUIZ_DEFINITION` through
  `resolveArchetypeFromPath` asserting the resolved set equals `ARCHETYPE_NAMES`. Absent today ->
  red by absence.

## I-3 — (a) Behavioral-only sessions are effectively unreachable: 17 ideal signals to unseat `neutral`, **61** to clear the server gate

- **Claim** With shipped constants the passive behavioral path cannot in practice produce
  adaptation; adaptation needs the quiz or chat.
- **Status** CONFIRMED (arithmetic on shipped constants)
- **Evidence** `BASE_PRIOR` gives `neutral: 0.37` vs `0.04/0.03` per archetype
  (`packages/sdk/src/core/intent.ts:207-231`). Damping is `1 + (raw - 1) * BEHAVIORAL_DAMPING`,
  `BEHAVIORAL_DAMPING = 0.3` (`:1030-1032`, `:572`), so the strongest table entry
  (`mortgage_calc.used` -> `first_time_buyer: 1.25`, `neutral: 0.8`, `:414-420`) becomes `1.075` /
  `0.94`. Simulating that exact update repeatedly from `BASE_PRIOR` (no decay): argmax first leaves
  `neutral` at **n = 17**; `confidence` (= `probs[argmax]`, `classifyFromProbabilities` `:805-828`)
  first exceeds `CONFIDENCE_THRESHOLD = 0.6` (`apps/control-plane/src/app/api/adapt/route.ts:106`,
  applied as `confidence <= CONFIDENCE_THRESHOLD -> directives: []` at `:341-344`) at **n = 61**.
  Decay at `DEFAULT_DECAY_RATE = 0.02`/min (`:691`) makes it worse. Absent `confidence` the server
  substitutes `0.5` (`route.ts:1777`) — also below the gate.
- **Impact on measured pilot** **invalidates measurement** of any non-quiz arm: such sessions log
  `source: 'default'` with zero directives, so "no adaptation" reads as a product result rather than
  an uncrossable gate.
- **Ticket coverage** FOLLOW-212 (stub in `backlog/FOLLOW_UPS.md`, no QUEUE row -> OPEN; scheduled
  **after** FOLLOW-820 per `backlog/QUEUE.md:7652`, and named in FOLLOW-820 AC(5)) covers
  _calibrating_ the constants, not the fact that the path cannot reach the gate. **The reachability
  fact: NO COVERAGE.**
- **Priority** P1 — blocks interpretation of FOLLOW-819/820; no dependencies.
- **Proposed AC**
  - A unit test computes, from the real constants, the minimum signal count per `SIGNAL_LIKELIHOODS`
    key to (a) unseat `neutral` and (b) cross `0.6`, and prints them.
  - `MASTER_DESIGN §D.6/§D.7` record those numbers so "Full (behavioral)" is qualified by the signal
    count it needs.
  - FOLLOW-820's evidence pack states which arms can cross the gate without a quiz completion.
- **Red-first proof** The test above (red by absence). Second: an E2E driving 10
  `mortgage_calc.used` events with no quiz, asserting a non-`default` `source` — red today by
  design; the ticket decides whether it should ever be green.

## I-4 — (b) Constants inventory, and a **dormant per-archetype threshold set** contradicting the live one

- **Claim** Live tuning constants are single-sourced in the SDK (no Python/TS numeric duplication),
  but `archetype_embeddings.confidence_threshold` ships 18 per-archetype thresholds (0.500-0.620)
  that no decision code reads, while the route uses one hardcoded `0.6`.
- **Status** PARTIAL
- **Evidence**
  - Client constants: `SWITCH_MARGIN = 0.05` (`intent.ts:190`), `BASE_PRIOR` (`:207`),
    `QUIZ_LIKELIHOODS` (`:233-312`), `SIGNAL_LIKELIHOODS` (`:331-431`),
    `CHAT_REST_LIKELIHOOD = 0.05` (`:447`), `CHAT_INTENT_LIKELIHOODS` (`:476`),
    `BEHAVIORAL_DAMPING = 0.3` (`:572`), `DEFAULT_DECAY_RATE = 0.02` (`:691`),
    `QUIZ_CONFIDENCE_BONUS = 1.2` (`:694`), `MISMATCH_MIN_SIGNALS = 3` (`:702`),
    `MISMATCH_OPPOSING_THRESHOLD = 0.4` (`:705`), `MISMATCH_GAP_THRESHOLD = 0.3` (`:708`), quiz-leaf
    `leafProb = 0.85` (`:1334`), `DWELL_BASE_BOOST = 0.08` / `DWELL_UNIT_MS = 30_000` /
    `DWELL_MAX_SESSION_CONTRIBUTION = 3` (`:1718-1735`), `HINT_MAX_BOOST_PER_ARCHETYPE = 0.3`
    (`:1560`).
  - Server constants: `CONFIDENCE_THRESHOLD = 0.6`, `HIGH_SIMILARITY_THRESHOLD = 0.85`,
    `LOW_SIMILARITY_THRESHOLD = 0.6` (`route.ts:106-108`).
  - SDK DOM floors: `DOM_ADAPT_CONFIDENCE_FLOOR` 0.5, `DOM_ADAPT_MIN_SIGNAL_COUNT` 2,
    `DOM_ADAPT_DESCRIPTION_MIN_SIGNAL_COUNT` 5 (`packages/sdk/src/core/adapt-floor.ts`).
  - **Python duplicates no numeric weight.** Only threshold in `nlp.py` is
    `_MULTILINGUAL_RETRY_CONFIDENCE = 0.6` (`apps/intent-engine/src/nlp.py:137`), governing a
    Haiku->Sonnet retry, not archetype scoring. No `SIGNAL_LIKELIHOODS`/`BASE_PRIOR` equivalent in
    Python -> **no cross-language value divergence.**
  - Dormant set: `packages/db/src/seed/archetype-seeds.ts:23,29,35,...` ships `confidenceThreshold`
    ('0.500'-'0.620'); column at `packages/db/src/schema/archetype_embeddings.ts:31` and
    `packages/db/migrations/0002_goofy_spencer_smythe.sql:9`; `git grep confidenceThreshold` over
    `apps/`+`packages/` returns only schema, seed, migration and a `toBeDefined()` test — **no read
    in any decision path**.
  - Server-supplied overrides exist and are live for damping/likelihoods (`intent.ts:588-687`,
    `resolveIntentWeights`) via `/api/intent/config`; they cannot override the three server
    thresholds.
- **Impact on measured pilot** degrades data — a DB reader will believe per-archetype gating is in
  effect when a single 0.6 applies to all. The cross-file line citations in `adapt-floor.ts:62,65`
  ("route.ts:86", "route.ts:275") are already off by ~20 and ~66 lines, which is how such claims
  rot.
- **Ticket coverage** FOLLOW-212 (OPEN) covers damping/likelihood calibration only. **Dormant
  `confidence_threshold`: NO COVERAGE.**
- **Priority** P2; independent.
- **Proposed AC**
  - Either `runDecisionTree` reads the per-archetype `confidence_threshold` (default `0.600`), or
    the column + 18 seed values are deleted and the seed comment says the gate is global.
  - A Rule-I-style assertion that every `archetype_embeddings` column has a reader, or a documented
    exception.
  - `adapt-floor.ts`'s cross-file line citations replaced by symbol names.
- **Red-first proof** A test that, for two archetypes with different seeded thresholds, sends a
  `confidence` between them and asserts different `source`. Red today (identical), green when wired
  — or replaced by one asserting the column is gone.

## I-5 — (d) `similarity` is a **posterior probability**, not a cosine similarity — name and every downstream reader disagree with the producer

- **Claim** The SDK sends `similarity = probabilities[argmax]`; the wire contract, server docblocks,
  the ClickHouse column and migration comments all call it cosine similarity.
- **Status** CONFIRMED (mismatch)
- **Evidence** Producer: `packages/sdk/src/core/adapt.ts:1247`
  `body.similarity = intentState.probabilities[intentState.archetype];`. Contract:
  `packages/sdk/src/core/adapt.ts:361-362` `/** Cosine similarity to the matched archetype 0-1. */`;
  `packages/sdk/src/core/adapt-schema.ts:101`. Server: `route.ts:265`
  `@param similarity - Cosine similarity to the matched archetype 0-1`; the value drives branch
  selection (`route.ts:431,512`) and is written verbatim to
  `adaptation_decisions.similarity Float32`
  (`infra/clickhouse/migrations/0003_create_adaptation_decisions.sql:21`; `route.ts:774`
  `param_p_similarity`) and into `features_snapshot` (`route.ts:750`). A real cosine helper exists
  and is unused: `packages/sdk/src/core/embedding.ts:191` `matchArchetypeHeuristic` has zero
  non-test importers (`git grep` -> tests + `AUDIT_IMPLEMENTATION_MAP.md:43`, which already records
  it as "exported but never imported"). The admin tracer never surfaces `similarity` at all — only
  `confidence` (`apps/control-plane/src/app/admin/tenants/[id]/tracer/page.tsx:63-64,246-248`), so
  the tracer and `adaptation_decisions` describe a session with two different numbers and no shared
  field.
- **Impact on measured pilot** **invalidates measurement** of the branch mix: anyone analysing
  `adaptation_decisions.similarity` reads it as archetype-listing fit when it is buyer archetype
  confidence — and FOLLOW-819/FOLLOW-1130 narratives are built on these rows.
- **Ticket coverage** No ticket names the semantic mismatch. FOLLOW-1163
  (`backlog/FOLLOW_UPS.md:46840`, MERGED #871) reasons correctly that "`similarity` is confidence
  about the BUYER's archetype and says nothing about the PROPERTY" (quoted at `route.ts:433-435`) —
  the project already knows this and fixed the _withholding_ consequence while leaving the field
  name, both contract docblocks and the column untouched. **NO COVERAGE for the rename.**
- **Priority** P1; no dependencies.
- **Proposed AC**
  - `AdaptRequest`/`AdaptResponse` docblocks and `route.ts`'s `@param` say "posterior probability of
    the argmax archetype", not cosine.
  - Either rename the wire field with a versioned deprecation, or add a `similarity_semantics` note
    to `adaptation_decisions` (column COMMENT or migration header) plus rename the two threshold
    constants (`HIGH_/LOW_ARCHETYPE_PROBABILITY_THRESHOLD`).
  - `matchArchetypeHeuristic` is wired or deleted (it is the only real client-side cosine in the
    repo, and it is dead).
- **Red-first proof** A contract test asserting `body.similarity === probabilities[archetype]`
  **and** that no docblock on the path contains "cosine": red today on the second clause.

## I-6 — (d) Crossing `similarity > 0.85` **reduces** adaptation to a CTA swap — the most-resolved buyer gets the least

- **Claim** Branch 2 (`similarity > 0.85`) withholds every property-asserting slot and serves only
  `cta`, so a buyer one behavioral signal past a quiz leaf is downgraded from LLM-tweaked headline
  copy to CTA-only.
- **Status** CONFIRMED
- **Evidence** `route.ts:441-449` — branch 2 calls `withholdUngroundedDirectives`;
  `apps/control-plane/src/lib/ungrounded-directives.ts:60` `NON_ASSERTIVE_SLOTS = new Set(['cta'])`,
  `:33-34` "`headline` — assertive, WITHHELD" / "`feature` — MIXED, and therefore withheld whole".
  Quiz leaf sets `probabilities[leaf] = 0.85` (`intent.ts:1334-1344`) and
  `confidence = min(0.85 x 1.2, 1.0) = 1.0`; `similarity = 0.85` is **not** `> 0.85`, so the first
  post-quiz request is branch 3 (`llm_tweaked`). One subsequent favourable damped update on the leaf
  (e.g. `mortgage_calc.used`, `intent.ts:414-420`) lifts it above 0.85 and permanently flips the
  session to branch 2.
- **Impact on measured pilot** **invalidates measurement** — adaptation intensity is non-monotonic
  in confidence, so per-archetype lift is confounded by a threshold crossing unrelated to the
  archetype.
- **Ticket coverage** FOLLOW-1164 (`backlog/FOLLOW_UPS.md:46949` + amendments `:47935`, `:48286`) —
  stub, no QUEUE row -> OPEN, listed **P2** in the NEXT chain (`backlog/QUEUE.md:137`). Correct
  remedy, under-priced.
- **Priority** **P1** (raise from P2) — measurement axis, not just copy; depends on FOLLOW-1183 per
  `backlog/QUEUE.md:137` ("now unblocked by #886").
- **Proposed AC**
  - A test drives quiz-leaf -> one behavioral signal and asserts the served slot set does not
    shrink.
  - The branch-2/branch-3 boundary is documented in terms of what the buyer sees, naming the
    quiz-leaf-plus-one-signal case.
  - An analyst can separate "branch 2, CTA only" from "branch 3, full copy" in
    `adaptation_decisions` (today only via `source`, which is logged — assert it).
- **Red-first proof** The two-step session test: red today (slot count drops 3 -> 1), green when
  FOLLOW-1164 lands.

## I-7 — (c) Cold start and outage posture is correct; degraded-vs-legitimate neutral is genuinely instrumented

- **Claim** A zero-signal session gets `neutral` + no directives; every failure on the chain fails
  open without blocking the response; a degraded neutral is distinguishable from a legitimate one on
  the chat path.
- **Status** CONFIRMED
- **Evidence** Cold start: `BASE_PRIOR` `neutral: 0.37` (`intent.ts:230`) -> argmax `neutral`,
  `confidence 0.37` -> `route.ts:341-344` returns `{ directives: [], source: 'default' }`. Missing
  fields default to `0.5` (`route.ts:1777-1778`), also below the gate.
  `docs/adr/ADR-0014-cross-listing-adaptation-and-sot-archetype.md:103-106` states the same
  contract. Intent service down: `apps/intent-engine/src/nlp.py:236-256` returns a neutral payload
  with `data_source` / `extraction_error` set, and `:236-240` records that the two cases "are
  otherwise byte-identical (RETRO-233 §4a LG-1)" — so this fallback is **not** silent (contrast
  E-2). Dispatch failures captured, never thrown:
  `apps/ingest/src/handlers/chat-nlp-dispatch.ts:93,146-167`. Redis shadow read fail-open
  (`route.ts:2064-2072` + try/catch). Embedding lookups fail-open
  (`apps/control-plane/src/lib/embedding-lookup.ts:10-12,54-60,104-110`). `logDecisionAsync` no-ops
  without `CLICKHOUSE_URL` (`route.ts:718-719`) and is registered via `afterResponse`
  (`route.ts:2155-2157`).
- **Impact on measured pilot** none — this area is in good shape.
- **Ticket coverage** N/A.

## I-8 — (e) Persistence: cross-**listing** finished; cross-**tab** and cross-**session** not built (and not claimed)

- **Claim** The SoT archetype survives SPA navigation and same-tab reload; it does not survive a new
  tab, window, or session. No server-side restore path exists.
- **Status** PARTIAL — cross-listing DONE, cross-tab NOT BUILT, cross-session NOT BUILT
  (deliberately, for Mode A compliance).
- **Evidence**
  - **Finished.** SoT key: `packages/sdk/src/core/session.ts:501`
    ``return `estalara_resolved_archetype_${sessionId}`;`` — sessionStorage, consent-gated, erased
    with the intent state; design at `docs/adr/ADR-0014-...md:83-97`. Anti-neutral-decay in code:
    quiz-stickiness clause `packages/sdk/src/core/intent.ts:837-844`, `SWITCH_MARGIN` hysteresis
    `:822-828`. Cross-listing re-adaptation + revert-to-original per ADR-0014 §3 (`:99-123`).
  - **Not cross-tab.** The session lives in sessionStorage (`session.ts:142-145,167-172`, key
    `__estalara_session__`), so a second tab mints a new `session_id` and starts from `BASE_PRIOR`.
    No `BroadcastChannel`, no `storage` listener, no localStorage mirror of the archetype
    (`grep localStorage packages/sdk/src/core/session.ts` -> consent key, `__estalara_xid__`,
    nothing else).
  - **Not cross-session, and not read back.** `__estalara_xid__` (localStorage, 90-day TTL,
    `session.ts:205-280`) is recorded — `apps/ingest/src/handlers/events.ts:466-477` forwards it,
    `apps/ingest/src/handlers/intent-snapshot.ts:310` persists it as
    `intent_sessions.cross_session_id` — and read **only** by DSR routes
    (`apps/control-plane/src/app/api/dsr/access/route.ts:182`, `.../portability/route.ts:178`).
    Nothing joins on it to resume an archetype.
  - Server-side session state is write-only for decisions: `intent_sessions` is upserted by the
    ingest Worker over PostgREST (`intent-snapshot.ts:300`) and read only by the admin tracer and
    DSR routes; `/api/adapt` never reads it — the archetype always arrives as the client's
    `archetype_hint` (`route.ts:210`, consumed `:1777`).
  - **Product claims.** `README.md:4` "...based on chat, behavior, questions, and **cross-listing
    journey**" is **supported** (cross-listing within a tab is implemented).
    `docs/MASTER_DESIGN.md:2995` scopes the journey to one tenant — also supported.
    `docs/MASTER_DESIGN.md:2935` and `:5095` describe a 24h-rotating HMAC session id, a different
    (older) identity model than the shipped sessionStorage id + 90-day `xid` (`session.ts:205-212`)
    — STALE, but a security-section description, not a product claim.
- **Impact on measured pilot** degrades data — a buyer opening a listing in a new tab (normal
  real-estate browsing) is a fresh cold-start session with no archetype, diluting per-archetype
  samples and understating adaptation coverage. Does not block go-live and falsifies no README
  claim.
- **Ticket coverage** NO COVERAGE for cross-tab archetype continuity (`cross-tab` over the ticket
  index -> 0 hits; `cross_session_id` over `backlog/` -> DSR contexts only).
- **Priority** P2; depends on FOLLOW-815 (any widening of persistence scope is a disclosure change).
- **Proposed AC**
  - A decision is recorded (CEO question 1) before any code.
  - If shipped: the resolved archetype is readable in a second tab within one navigation,
    consent-gated identically, erased by the same `eraseIntentState` path, covered by a DSR
    access/erase test.
  - If scope-restricted: `MASTER_DESIGN §D` and the FOLLOW-820 evidence pack state that a new tab is
    a new session, and pilot denominators are per session, not per person.
- **Red-first proof** Playwright: resolve an archetype in tab A, open tab B on a second listing of
  the same origin, assert tab B's first `/api/adapt` carries the same `archetype_hint`. Red today
  (tab B sends `neutral`).

### Decision for the CEO — cross-tab / cross-session persistence

**No README or MASTER_DESIGN claim has to change under either option** — the shipped claim is
"cross-listing journey", which is implemented. The exposure is measurement dilution, not a false
public claim.

|                         | Option A — ship cross-tab continuity before the pilot                                                                                                                                                                                                                                                                                                                                                                | Option B — restrict pilot scope explicitly                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Work                    | Mirror the SoT archetype to `localStorage` keyed by `xid`, or have `/api/adapt` resolve `archetype_hint` from `intent_sessions` when the client sends only `xid`. ~1-2 days SDK + 0.5 day server.                                                                                                                                                                                                                    | Zero code. Write the limitation into the FOLLOW-820 evidence pack and §D.                                           |
| Consent/legal           | Widens processing from tab-lifetime to 90-day device-scoped profiling -> a DISCLOSED-MEANING change under §H.8: costs a consent-text version bump and must land **after** FOLLOW-815. `docs/adr/ADR-0014-...md:134-141` explicitly moved the quiz-completion flag _from_ localStorage _to_ sessionStorage to keep "Mode A — no cross-session profiling without re-consent"; Option A partially reverses that ruling. | None. Stays inside ADR-0014's ruling.                                                                               |
| Pilot risk              | New persistence surface + new DSR erase target immediately before the first real-traffic run.                                                                                                                                                                                                                                                                                                                        | Per-archetype samples diluted by new-tab browsing; the effect is unmeasured today.                                  |
| Lines that would change | `docs/adr/ADR-0014-cross-listing-adaptation-and-sot-archetype.md:96`, `:134-141`; `docs/compliance/dpia.md` §13.2; the three locale consent banners.                                                                                                                                                                                                                                                                 | `docs/MASTER_DESIGN.md:2079` (add a session-scope sentence to the §D.6 coverage summary); the FOLLOW-820 checklist. |

**Recommendation: Option B for this pilot.** Localhost-first puts FOLLOW-815 ahead of everything,
and Option A cannot ship before it without re-opening a disclosure the CEO already ruled on in
ADR-0014. Measure the dilution first — `intent_sessions` already stores `cross_session_id`, so
`count(distinct session_id) per cross_session_id` is available today — then decide with a number.

## I-9 — `deterministicScore` is not djb2, and the wrong name is in the telemetry vocabulary

- **Claim** The function documented and telemetered as "djb2" is `hash = hash*31 + c` from
  `hash = 0` — Java's `String.hashCode`, not djb2 (`5381`, `hash*33 + c`).
- **Status** CONFIRMED (naming defect)
- **Evidence** `apps/control-plane/src/app/api/adapt/route.ts:871` "via djb2" and `:879-886`
  `let hash = 0; ... hash = (hash * 31 + key.charCodeAt(i)) >>> 0;`. The mirror is more careful:
  `apps/decision-api/src/lib/reorder.ts:224` "djb2-**style** hash". The wrong name is baked into
  `ScoringPath` values `'djb2_fallback' | 'djb2_guard'` (`route.ts:949`),
  `infra/clickhouse/migrations/0022_adaptation_decisions_scoring_path.sql:3`, and
  `README.md:105,137`.
- **Impact on measured pilot** none functionally.
- **Ticket coverage** NO COVERAGE.
- **Priority** P3; independent. Do **not** rename the enum values (shipped column) — fix the
  comments.
- **Proposed AC** (1) every "djb2" comment on the control-plane path reads "stable 32-bit string
  hash (Java-style `31·h + c`)"; (2) `ScoringPath` docblock states the enum name is historical.
- **Red-first proof** A grep gate: `djb2` must not appear in a sentence claiming the algorithm (only
  in enum values plus a documented-historical note). Red today.

---

# AREA 5 — Embeddings path

## E-1 — P0: `pnpm seed:archetypes` and `pnpm seed:listings` are **broken at HEAD**, and the workflow that runs the first one has failed silently on every retained run

- **Claim** Both embedding seed entrypoints die at module instantiation before doing any work;
  `post-migrate-seed.yml`, which runs the archetype seeder on every push to `main`, has failed on
  **every** run GitHub still retains, and job-level `continue-on-error: true` reports the workflow
  as success.
- **Status** CONFIRMED (reproduced locally at HEAD + CI logs)
- **Evidence**
  - Reproduced read-only at HEAD: importing the seeder module the way the script does yields
    `EXPORTS: [ 'default' ]` — named exports are invisible across the `.mts` (ESM) -> `.ts` (CJS; no
    `"type": "module"` in root `package.json` or `apps/control-plane/package.json`) boundary under
    `tsx`. Same result for `apps/control-plane/src/lib/seed-listing-embeddings.js`.
  - CI run `34648088457` (push of `f510f749`, the audited HEAD), job `103423580954`:
    `import { ARCHETYPE_EMBEDDING_DIM, seedArchetypeEmbeddings } from '../src/lib/archetype-seeder.js';`
    `SyntaxError: The requested module '../src/lib/archetype-seeder.js' does not provide an export named 'ARCHETYPE_EMBEDDING_DIM'`
    ... `ELIFECYCLE Command failed with exit code 1.` The export **does** exist —
    `apps/control-plane/src/lib/archetype-seeder.ts:28`
    `export const ARCHETYPE_EMBEDDING_DIM = 1024;` — so this is a resolution defect, not a missing
    symbol. Import sites: `apps/control-plane/scripts/seed-archetypes.mts:46`,
    `apps/control-plane/scripts/seed-estalara-listings.mts:41`.
  - Masking: `.github/workflows/post-migrate-seed.yml:34` `continue-on-error: true` at **job**
    level. All 200 runs GitHub lists report workflow conclusion `success`; the seed step is
    `failure` in every run sampled (`34648088457`, `33126869324`, `32964587666`, `31568479781` — the
    oldest retained, 2026-08-12). The offending import landed in `cbd1d943` (2026-06-25,
    `feat(adapt): archetype embedding population job + CI NULL check [FOLLOW-341]`, PR #352), so the
    likely window is ~11 weeks; logs before 2026-08-12 are expired, so the pre-August window is
    inference from the diff, not from a log.
  - `FORCE_RESEED` on description change (`post-migrate-seed.yml:73-88`) sits inside the same broken
    step, so a future edit to `packages/db/src/seed/archetype-seeds.ts` would silently not re-embed.
    That file has not changed since `f0aca061` (2026-05-11), so today's vectors are not stale —
    luck, not a control.
  - `README.md:77-79` and `:125-138` instruct an operator to run exactly this command as a required
    setup step; `:135-137` warns that skipping it "silently degrades the entire adaptation chain to
    the djb2 deterministic hash path".
- **Impact on measured pilot** **blocks go-live** for any environment whose `archetype_embeddings`
  are not already populated, and blocks `listing_embeddings` seeding everywhere — the documented
  remaining blocker for the cosine differentiator (`backlog/QUEUE.md:21203-21206`:
  "`listing_embeddings` is EMPTY for the pilot tenant"). The differentiator FOLLOW-819/820 exist to
  demonstrate cannot be reached while its only seeding tool is dead.
- **Ticket coverage** **NO COVERAGE.** `backlog/QUEUE.md:21202` claims "the `pnpm seed:archetypes`
  script is separately broken, tracked by FOLLOW-446" — wrong attribution: FOLLOW-446
  (`backlog/QUEUE.md:23469-23488`, status **DONE**, PR #403) is about the _CI gate's_ blind spots
  and its stub (`backlog/FOLLOW_UPS.md:12753-12780`) never mentions the script. The breakage has
  been recorded as covered by a DONE ticket that does not cover it.
- **Priority** **P0** — localhost path, ahead of prod-axis work; no dependencies.
- **Proposed AC**
  - `pnpm seed:archetypes` and `pnpm seed:listings` both run to completion from a clean checkout
    (fix the ESM/CJS boundary — `.ts` specifier under `tsx`, a `default`-export barrel, or
    `"type": "module"` scoping; state which and why).
  - A CI job **without** `continue-on-error` executes both scripts in import-only/dry-run mode on
    every PR, so a future resolution break fails the PR that causes it.
  - `post-migrate-seed.yml`'s `continue-on-error` is scoped to the missing-`DOPPLER_TOKEN_DEV` path
    only (FOLLOW-446's AC-2 applied to the second workflow), and the job name is added to
    `.github/required-checks.txt`.
  - The false attribution at `backlog/QUEUE.md:21202` is corrected.
- **Red-first proof**
  `node --input-type=module -e "import('.../archetype-seeder.js').then(m => { if (!('ARCHETYPE_EMBEDDING_DIM' in m)) process.exit(1) })"`
  — exits 1 today, 0 when fixed. Plus a `post-migrate-seed.yml` run whose **job** conclusion (not
  workflow conclusion) is success.

## E-2 — P1: the cosine->hash fallback is **silent** — `scoring_path` is disabled in every environment and the per-listing fallback logs only at `console.debug`

- **Claim** No environment records `scoring_path`, and the per-listing fallback emits no reason
  code, no metric, and no log above `debug`.
- **Status** CONFIRMED
- **Evidence** Writer gate: `route.ts:736`
  `const scoringPathColumnEnabled = process.env.SCORING_PATH_COLUMN_ENABLED === 'true';`, with
  `:781-788` appending the column only when set. The variable is **unset everywhere**:
  `apps/control-plane/.env.example:88` `SCORING_PATH_COLUMN_ENABLED=` (blank, comment "'true' only
  when migration 0022 is live on that instance"); `git grep SCORING_PATH_COLUMN_ENABLED` finds no
  docker-compose, no Doppler reference, no CI export — only the route, the admin page and tests. The
  admin panel says so: `apps/control-plane/src/app/admin/analytics/page.tsx:131` renders
  "SCORING_PATH_COLUMN_ENABLED is not set on this deployment ... Expected until ClickHouse migration
  0022 is applied (FOLLOW-820)". Per-listing telemetry: `route.ts:925-935` — two `console.debug`
  calls (cosine exception; missing embedding); no Sentry, no counter, no field. Whole-batch failures
  DO log at `console.error`/`console.warn` (`route.ts:2032-2043`), and the chat path's equivalent
  degradation IS instrumented with a reason code (`nlp.py:236-240`, `extraction_error`) — the repo
  has the pattern and did not apply it here.
- **Impact on measured pilot** **invalidates measurement** of the cosine differentiator. FOLLOW-820
  condition 1 requires telling real cosine ranking from a stable hash shuffle; the instrument that
  does that is off by default in the only environment the gate is graded on.
- **Ticket coverage** FOLLOW-560 (`backlog/QUEUE.md:26765`, **DONE**, PR #825, **LOCAL axis only**,
  prod apply deferred to FOLLOW-820); FOLLOW-1071 (`backlog/FOLLOW_UPS.md:41250`, P1 in the stub, P2
  at `backlog/QUEUE.md:1853`, `promoted_to_queue: false` -> **OPEN**) already proves AC(3) of the
  E2E passes on `not_applicable`, the column's own DEFAULT, so green is indistinguishable from "the
  writer flag was never on"; FOLLOW-1072 (DONE, #837) seeded `tenant_site_schemas` and produced the
  first non-default value — `djb2_fallback`. **Partial coverage: the silence has tickets; the
  alert/readiness/fail-posture items below do not.**
- **Priority** P1 — FOLLOW-820 critical path; depends on E-1 (without a working seeder, `cosine` can
  never be observed).
- **Proposed AC (the five items requested, plus the decision)**
  1. **Telemetry with reason code.** `affinityScore` returns a discriminated reason (`cosine` |
     `archetype_embedding_missing` | `listing_embedding_missing` | `dim_mismatch` | `cosine_threw`),
     aggregated per decision and written alongside `scoring_path`. The two `console.debug` calls
     (`route.ts:927,933`) become one structured `console.warn` + sampled `Sentry.captureMessage`.
  2. **Readiness check.** A `/api/health/embeddings` (or startup assertion) reporting:
     `archetype_embeddings` row count, count with NULL embedding, stored vector dimension, and
     `listing_embeddings` count for the pilot tenant. FOLLOW-820's evidence pack pastes it.
  3. **Alert.** A Sentry alert (or the `.github/workflows/cron-heartbeat.yml` pattern) fires when
     the share of decisions with `scoring_path != 'cosine'` exceeds a threshold over a window — on
     the fallback _rate_, not a single event.
  4. **Negative test.** An integration test asserts: archetype embedding present + listing embedding
     absent -> `djb2_fallback` **and** the warn is emitted; both present -> `cosine`. Today neither
     direction is asserted in the shipped configuration (`route.clickhouse.test.ts:631-720` asserts
     the four values with the flag **stubbed on**).
  5. **`SCORING_PATH_COLUMN_ENABLED=true` on the localhost substrate** (migration 0022 is already
     applied locally per `backlog/QUEUE.md:26765`), so FOLLOW-819 grades a written value.
- **Red-first proof** Run the differentiator harness on localhost and read
  `cosineVsDjb2Distinguishable` — the harness already computes and discards it
  (`backlog/FOLLOW_UPS.md:41250`). It reads `false` today; green = `true` with >=1 `cosine` row.

### Fail-open vs fail-closed for the pilot (decision required)

|                   | Fail-open (today)                                                                                                                                                | Fail-closed                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Behaviour         | Missing/broken embedding -> hash score, ranking still emitted, 200.                                                                                              | Missing embedding -> **no** `ReorderDirective`; text directives unaffected; decision logged with the reason.      |
| Pilot consequence | Reorder always fires, sometimes on noise — and per E-3, in a mixed batch on _adversarial_ noise. Lift attributed to "adaptation" partly measures a hash shuffle. | Reorder fires only when real. Coverage drops to the embedded fraction; that fraction becomes a reportable number. |
| Risk              | A silent quality regression is indistinguishable from a product result.                                                                                          | A misconfiguration shows up as "no reorder" — visible and diagnosable.                                            |

**Recommendation: fail-closed for the reorder directive only, for the duration of the measured
pilot.** The stated contract "MUST never 5xx on embedding lookup failure"
(`apps/control-plane/src/lib/embedding-lookup.ts:10-12`) is preserved: fail-closed here omits one
directive, it does not error. The pilot's purpose is attribution, and a ranking that is sometimes a
hash cannot be attributed — E-3 shows the mixed case is worse than random. Keep fail-open for text
directives, where the playbook fallback is a real product behaviour.

## E-3 — P1: in a mixed batch, un-embedded listings **systematically outrank** embedded ones (incommensurable score scales)

- **Claim** `buildReorderDirective` sorts one array containing cosine similarities (typically
  ~0.1-0.5 for `text-embedding-3-small` text pairs, range `[-1, 1]`) and hash scores (uniform on
  `[0, 1)`, mean 0.5), so a listing with **no** embedding beats a correctly-scored listing more
  often than not.
- **Status** CONFIRMED at code level (the "typical cosine magnitude" premise is an expectation, not
  measured here — see the red-first test)
- **Evidence** `route.ts:983-994` — `scored` is built by `affinityScore` per listing and sorted
  `b.score - a.score` with no normalisation; `affinityScore` (`:908-936`) returns
  `computeCosineSimilarity(...)` when both embeddings exist and `deterministicScore(...)` otherwise,
  in the **same** array. `computeCosineSimilarity` (`packages/shared/src/embeddings.ts:31-56`)
  returns `dot/(magA*magB)` in `[-1, 1]` and is not clamped — contradicting `route.ts:871` "stable
  0-1 affinity score". `deterministicScore` (`:879-886`) returns `(hash % 10000)/10000` in `[0, 1)`.
  This is exactly `scoring_path = 'djb2_fallback'`, the state actually observed on the local
  substrate (`backlog/QUEUE.md:26765`: "`djb2_fallback`, expected — no embeddings are seeded yet").
- **Impact on measured pilot** **invalidates measurement**, and worse than a null result: in the
  mixed case the reorder is anti-correlated with fit, so a measured _negative_ lift would be a true
  reading of a defect and would be misread as "adaptation does not work".
- **Ticket coverage** **NO COVERAGE.** FOLLOW-1071/1072/1073 cover whether the cosine path is
  _reachable_ and whether `scoring_path` _discriminates_; none addresses score comparability.
  Ticket-index grep for `mixed batch` / `incommensur` / `score scale` -> 0 hits.
- **Priority** P1; same dependency as E-2 (the fix is cheap; observing it needs E-1).
- **Proposed AC**
  - Either the batch is all-cosine or all-hash (the natural consequence of E-2's fail-closed
    recommendation), or hash scores are mapped into a band strictly below the minimum observed
    cosine and that band is documented.
  - A unit test builds a 4-listing batch — 2 embedded (cosine 0.3, 0.25), 2 un-embedded — and
    asserts the embedded pair ranks first.
  - `route.ts:871`'s "0-1" claim is corrected to the real cosine range, or the cosine result is
    clamped/rescaled with a stated rationale.
- **Red-first proof** The 4-listing test: red today (for two `U[0,1)` draws against 0.3, at least
  one exceeds it ~91% of the time), green when fixed.

## E-4 — Vector columns, model and dimensions are internally consistent; the one dimension split is intentional but undocumented as a guard

- **Claim** `pgvector` is enabled and the three decision-path vector columns are `vector(1024)` with
  `text-embedding-3-small` at `dimensions: 1024`; a fourth column is `vector(1536)` for a different
  purpose and nothing cross-compares them.
- **Status** CONFIRMED
- **Evidence** Extension: `packages/db/migrations/0002_goofy_spencer_smythe.sql:1`. Columns:
  `0002_...sql:8,21` `"embedding" vector(1024)` (archetype + session),
  `0013_listing_embeddings.sql:31` `vector(1024)`, `0006_answers.sql:22`
  `question_embedding vector(1536) NOT NULL`. Drizzle:
  `packages/db/src/schema/archetype_embeddings.ts:28`, `listing_embeddings.ts:48`,
  `session_embeddings.ts:37` (1024), `answers.ts:50` (1536). Producers:
  `apps/control-plane/src/lib/archetype-seeder.ts:28,30,66` (`ARCHETYPE_EMBEDDING_DIM = 1024`,
  `EMBEDDING_MODEL = 'text-embedding-3-small'`, `dimensions: ARCHETYPE_EMBEDDING_DIM`);
  `apps/control-plane/src/app/api/listings/embed/route.ts:51` `LISTING_EMBEDDING_DIM = 1024`;
  `apps/control-plane/src/lib/openai-client.ts:36-37`
  `embedText -> embedTextWithDimensions(text, 1536)`, used only by the answers RAG path
  (`apps/control-plane/src/app/api/tenants/[id]/answers/route.ts:95`,
  `apps/control-plane/src/lib/rag-retrieval.ts:60` `ORDER BY question_embedding <=> ...`).
  `affinityScore` guards on equal length (`route.ts:915-917`), so a 1536 vector would fall to the
  hash — silently (E-2's problem, not a dimension bug).
- **Impact on measured pilot** none today; a latent trap if a listing is ever seeded via `embedText`
  (1536) rather than the listings route (1024) — the result is an invisible permanent hash fallback
  for that listing.
- **Ticket coverage** NO COVERAGE for the guard.
- **Priority** P3.
- **Proposed AC** (1) a single exported `EMBEDDING_DIMENSIONS` map in `@estalara/db` that every
  producer and column asserts against; (2) a `dim_mismatch` reason code in E-2's telemetry; (3)
  `embedText`'s docblock states it is the answers-RAG-only 1536 path.
- **Red-first proof** Insert a 1536-dim listing embedding in a test and assert the decision records
  `dim_mismatch` rather than an indistinguishable fallback: red today (no such reason code).

## E-5 — P1: the registered required gate `Archetype embeddings not-NULL check` **can never fail**, and would pass on an empty table

- **Claim** It is listed in `.github/required-checks.txt` as must-be-SUCCESS but carries job-level
  `continue-on-error: true`, so a real failure still reports success; and it asserts only "no NULL
  rows", which an empty table satisfies vacuously.
- **Status** CONFIRMED
- **Evidence** `.github/required-checks.txt` (first non-comment entry region) registers
  `Archetype embeddings not-NULL check`; the register's header states a registered name must be
  SUCCESS or the gate is exit 3. `.github/workflows/ci.yml:1364` `continue-on-error: true` on that
  job. Assertion body `ci.yml:1412-1440`: `select(...).where(isNull(archetypeEmbeddings.embedding))`
  -> `if (nullRows.length > 0) process.exit(1)`; **no** row-count assertion, no `= 18` assertion, no
  dimension assertion, despite the log line at `:1437` claiming "all 18 archetype embeddings
  populated". This is the same swallow-everything defect FOLLOW-446's AC-2 was written to close
  (`backlog/FOLLOW_UPS.md:12770-12773`: "drop `continue-on-error` from the build steps, or split
  build into its own hard-failing job") — and FOLLOW-446 is **DONE** at `backlog/QUEUE.md:23472`
  with the note "Gate is now genuinely green and verifies embeddings instead of silently
  soft-skipping on every kind of failure via continue-on-error", which is false at HEAD. Empirically
  the gate **is** passing for real right now (run `34648088467`, step "Assert no NULL embeddings in
  archetype_embeddings" = success), so Doppler-`dev` does hold non-NULL archetype vectors —
  consistent with `backlog/QUEUE.md:21200` ("archetype_embeddings ARE seeded in prod — 18/18
  non-null, 1024-dim, verified 2026-07-01"). The finding is about the control, not today's data.
- **Impact on measured pilot** degrades data — the one control between a fresh DB and a silent
  all-hash pilot cannot go red, and it is the control FOLLOW-820's evidence pack would cite.
- **Ticket coverage** FOLLOW-446 (**DONE — row is STALE**, AC-2 unmet); FOLLOW-447
  (`backlog/QUEUE.md:23490`, status **READY**, P3) is the sibling-gate audit that would catch it.
- **Priority** P1 (raise FOLLOW-447 from P3, or re-open FOLLOW-446); no dependencies.
- **Proposed AC**
  - `continue-on-error` scoped to the missing-token path only; a genuine query/build failure turns
    the check red.
  - The assertion also requires `count(*) = ARCHETYPE_SEEDS.length` and
    `vector_dims(embedding) = 1024` for every row.
  - `Post-migrate seed archetype embeddings` is added to `.github/required-checks.txt` (absent
    today) — that alone would have surfaced E-1 in June.
  - FOLLOW-446's QUEUE note is corrected to state which ACs it actually closed.
- **Red-first proof** Point the gate at a DB with zero `archetype_embeddings` rows (or stub the
  query) and confirm the check-run reports **failure**. Today it reports success for both the
  empty-table and the broken-job cases.

## E-6 — P1: listing embeddings have no automated seed for a real tenant; the demo manifest is hardcoded

- **Claim** `listing_embeddings` is populated only by activation-time seeding of a hardcoded demo
  manifest or a manual `POST /api/listings/embed`; there is no CI/cron path and no not-NULL gate
  equivalent to the archetype one.
- **Status** PARTIAL
- **Evidence** `apps/control-plane/src/lib/seed-listing-embeddings.ts:104`
  `export const DEMO_LISTING_MANIFEST: ListingTextContent[]`; `:300-340`
  `seedListingEmbeddingsForActivation` uses `extractListingIdsFromSchema` or falls back to
  `DEMO_LISTING_MANIFEST` when `tenantId === DEMO_TENANT_ID` (`:335`); `MAX_INLINE_SEED = 50`
  (`:60`). Manual route: `apps/control-plane/src/app/api/listings/embed/route.ts`. `README.md:81`
  marks `pnpm seed:listings` "(Optional)" — and it is the script E-1 shows is broken. No workflow in
  `.github/workflows/` references listing embeddings. Recorded state: `backlog/QUEUE.md:21203-21206`
  "cosine ORDERING is still inactive in prod because `listing_embeddings` is EMPTY for the pilot
  tenant (000-app-estalara); cosine needs BOTH sides non-null, else djb2".
- **Impact on measured pilot** **blocks** the cosine differentiator (FOLLOW-820 condition 1) — the
  archetype side is seeded, the listing side is not, and `cosine` requires both.
- **Ticket coverage** The FOLLOW-046 carve-out and the ESC-020 activation tie are recorded at
  `backlog/QUEUE.md:21205-21206`; FOLLOW-1071/1072 cover the instrument. No ticket makes
  listing-side seeding a FOLLOW-819 precondition.
- **Priority** P1; depends on E-1 (the tool) and E-5 (a gate that can go red).
- **Proposed AC**
  - The localhost substrate has >=1 tenant with `reorder_capable = true`, >=2 listings with non-NULL
    1024-dim embeddings, and a matching archetype embedding — proven by a pasted query.
  - A hard-gated `listing-embeddings-present` CI check for that tenant, mirroring the archetype gate
    **after** E-5's fixes.
  - FOLLOW-819's README records listing-embedding presence as an explicit precondition of AC(3).
- **Red-first proof** One `/api/adapt` POST on the localhost substrate with `listing_ids` for a
  reorder-capable tenant recording `scoring_path = 'cosine'`. Zero such rows exist anywhere today
  (`backlog/QUEUE.md:26765`: "`cosine` still has zero observations anywhere").

## E-7 — No committed secrets on the embedding path

- **Claim** No OpenAI/Anthropic-style key literal is committed in seeds, fixtures, or anywhere in
  the working tree.
- **Status** CONFIRMED
- **Evidence** A recursive scan of the working tree (excluding `node_modules`, `.next`, `.git`) for
  the `sk-...` / `sk-proj-...` / `sk-ant-...` key-literal pattern classes returned **zero** matches,
  with and without the example/placeholder filter. Keys come from the environment only:
  `apps/control-plane/src/lib/archetype-seeder.ts:47-56` (`getOpenAI`, lazy from env),
  `apps/control-plane/src/lib/openai-client.ts:8` ("If not set, every call to `embedText()`
  throws"). `Gitleaks secrets scan` is a registered required check and green on the HEAD run.
- **Impact on measured pilot** none.
- **Ticket coverage** N/A.

---

## Area verdict

**Intent engine (AREA 4).** The classifier is in better shape than the docs suggest: 18/18
archetypes are genuinely reachable through the built-in quiz tree, the four duplicate archetype
lists are parity-gated across TS _and_ Python and those gates now actually execute, cold-start and
outage posture is correct, and there is no cross-language numeric divergence. Three real problems.
(1) The passive behavioral path cannot reach the server's `0.6` gate in any realistic session — 17
ideal signals to leave `neutral`, 61 to be served anything — so "behavioral adaptation" is, at HEAD,
quiz-or-chat adaptation, and no ticket says so (I-3, P1). (2) `similarity` is a posterior
probability carrying a cosine-similarity name into the branch logic, the ClickHouse column, and the
feature snapshot the conversion-label loop will replay (I-5, P1). (3) Crossing `similarity > 0.85`
_reduces_ the served slot set to a CTA, so the most-resolved buyer is adapted least (I-6, P1; remedy
exists as FOLLOW-1164 but is priced P2). Cross-listing persistence is genuinely finished per
ADR-0014; cross-tab and cross-session are not built, are not claimed in README/MASTER_DESIGN, and
should stay unbuilt for this pilot.

**Embeddings path (AREA 5).** The weaker half, and it holds the audit's one P0. **Both embedding
seed entrypoints are dead at HEAD** — a `.mts`->`.ts` named-export resolution failure reproduced
locally and visible in every retained CI log — and the workflow that runs the archetype seeder on
every push to `main` has been reporting success for that failure because of a job-level
`continue-on-error` (E-1). Today's archetype vectors survive only because the seed descriptions have
not changed since May. The gate that should have caught this is registered as required yet cannot go
red and would pass on an empty table (E-5), and the ticket written to close exactly that defect is
marked DONE with a note that is false at HEAD. Meanwhile the cosine->hash fallback is silent in
every environment (`SCORING_PATH_COLUMN_ENABLED` unset everywhere; per-listing fallback at
`console.debug` only — E-2), and in the mixed case the fallback is not merely uninformative: hash
scores on `[0,1)` systematically outrank real cosine values, so the ranking is anti-correlated with
fit (E-3, no coverage). `cosine` has zero observations anywhere in the project's history. FOLLOW-820
condition 1 asks the differentiator E2E to tell cosine from a hash shuffle; at HEAD neither side of
that comparison can be produced, and the instrument that would report it is off. **E-1 -> E-6 -> E-2
is the ordered path to making FOLLOW-819 gradeable, and none of it depends on prod.** No secrets are
committed.

## Open questions for the CEO

1. **Cross-tab / cross-session archetype continuity (I-8).** Ship it before the pilot (Option A —
   reverses part of ADR-0014 §5's Mode A lifetime-match ruling, costs a consent-text bump, must land
   after FOLLOW-815), or restrict pilot scope and state the session-scoped denominator explicitly
   (Option B — zero code, zero disclosure change)? **Recommended: B, and measure the dilution first
   — `intent_sessions` already records `cross_session_id`, so
   `count(distinct session_id) per cross_session_id` is available today.**
2. **Fail-open vs fail-closed for the reorder directive during the measured pilot (E-2).** Keep
   today's fail-open (reorder always emitted, sometimes on a hash and, per E-3, sometimes
   anti-correlated with fit), or fail-closed (omit the `ReorderDirective` when embeddings are absent
   and report coverage as a number)? **Recommended: fail-closed for the reorder directive only; the
   never-5xx contract is untouched because this omits a directive rather than erroring.**
3. **Priority ruling on FOLLOW-1164 (I-6).** It is P2 in the NEXT chain but it is the reason the
   highest-confidence sessions receive a CTA and nothing else. Raise to P1 on the measurement axis,
   or accept non-monotonic adaptation intensity for this pilot and document it in the FOLLOW-820
   evidence pack?
4. **`archetype_embeddings.confidence_threshold` (I-4).** Wire the 18 per-archetype thresholds the
   DB already stores, or delete the column and the seed values so the single hardcoded `0.6` is the
   only gate a reader can find? Either is acceptable; the present state — 18 seeded values nothing
   reads — is the one that misleads.
