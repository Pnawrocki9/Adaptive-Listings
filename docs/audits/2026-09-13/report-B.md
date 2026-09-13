# AREA 3 — Behavioural / intent signal matrix (read-only audit, HEAD `f510f749`)

Findings prefixed `S-n`. Every line/column below was read at HEAD. Docs are compared against, never
used as evidence of behaviour.

## 0. Where "declared" lives

| Declaration surface                  | Path                                                                                 | What it declares                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Canonical discriminated union        | `packages/shared/src/schemas/events/index.ts:142-221`                                | 55 event types (`EventSchema`)                                                            |
| Flat literal tuple                   | `packages/shared/src/schemas/events/index.ts:225-290`                                | same 55, pinned by `events.test.ts:76` (`EVENT_TYPES.length).toBe(55)`)                   |
| Consent classification (fail-closed) | `apps/ingest/src/consent-gate.ts:88-160`                                             | `Record<EventType, ConsentClass>` — compile-time-exhaustive over all 55                   |
| Intent weights (server-overridable)  | `packages/shared/src/schemas/intent-weights.ts:53-67`                                | 13 `INTENT_SIGNAL_KEYS`                                                                   |
| SDK likelihood table                 | `packages/sdk/src/core/intent.ts:330-433`                                            | 13 `SIGNAL_LIKELIHOODS` keys (10 event types + 2 `device_type.*` + `micro_poll.answered`) |
| Doc taxonomy                         | `docs/MASTER_DESIGN.md:1655-1700` (§C.1) + `:2052-2085` (§D.6) + `:2087-2110` (§D.7) | categories + per-archetype signal claims                                                  |
| Persistence                          | `infra/clickhouse/migrations/0001_create_events.sql:17-47`                           | ONE table `events(type LowCardinality, payload String)` — every accepted type lands here  |

There is no per-event ClickHouse table. `session_quality` (migration 0005) exists with **no
producer** — stated in code at `apps/ingest/src/consent-gate.ts:56-58`.

## 1. The matrix (55 declared types)

Legend — Producer: `SDK/observer` = fires from `setupObservers`, therefore also feeds
`applyBehavioralSignal`; `SDK/host` = fires only when the HOST page dispatches a CustomEvent (code
outside this repo); `NONE` = no producer anywhere in the repo. Consumer = code that reads it to
change archetype/confidence/directives. Persisted = CH `events` for anything emitted; extra sinks
named. Effect = what it can change in the product. Test = emission-path test, or `schema-only` when
the only hits are `events.test.ts` / `consent-gate.test.ts`.

| #     | Signal                                                                      | Declared                                                          | Producer                                                                                             | Intent/adapt consumer                                                                                                  | Persisted                                                                                      | Product effect                                                                                                  | Test                                                    |
| ----- | --------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1     | `page.view`                                                                 | union+gate                                                        | `core/events.ts:107-140` ← `index.ts:577`                                                            | **NONE** (absent from `SIGNAL_LIKELIHOODS`)                                                                            | CH `events`                                                                                    | none (analytics only)                                                                                           | `__tests__/events.test.ts`                              |
| 2     | `page.exit`                                                                 | union+gate                                                        | **NONE**                                                                                             | NONE                                                                                                                   | never                                                                                          | NONE                                                                                                            | schema-only                                             |
| 3     | `tab.visible`                                                               | union+gate                                                        | **NONE**                                                                                             | NONE                                                                                                                   | never                                                                                          | NONE                                                                                                            | schema-only                                             |
| 4     | `tab.hidden`                                                                | union+gate                                                        | **NONE**                                                                                             | NONE                                                                                                                   | never                                                                                          | NONE                                                                                                            | schema-only                                             |
| 5     | `scroll.depth`                                                              | union+gate+weights                                                | `core/observer.ts:428`                                                                               | `core/intent.ts:332`                                                                                                   | CH `events`                                                                                    | pushes off `neutral` (0.95); +1 `signal_count` → DOM floor + refetch cadence                                    | `__tests__/events.test.ts`, `observer-*.test.ts`        |
| 6     | `mouse.dwell`                                                               | union+gate                                                        | **NONE**                                                                                             | NONE                                                                                                                   | never                                                                                          | NONE                                                                                                            | schema-only                                             |
| 7     | `mouse.rage_click`                                                          | union+gate                                                        | **NONE**                                                                                             | NONE                                                                                                                   | never                                                                                          | NONE                                                                                                            | schema-only                                             |
| 8     | `mouse.exit_intent`                                                         | union+gate                                                        | **NONE**                                                                                             | NONE                                                                                                                   | never                                                                                          | NONE                                                                                                            | schema-only                                             |
| 9     | `photo.opened`                                                              | union+gate                                                        | **NONE**                                                                                             | NONE                                                                                                                   | never                                                                                          | NONE                                                                                                            | schema-only                                             |
| 10    | `photo.gallery.next`                                                        | union+gate                                                        | **NONE**                                                                                             | NONE                                                                                                                   | never                                                                                          | NONE                                                                                                            | schema-only                                             |
| 11    | `photo.zoomed`                                                              | union+gate                                                        | **NONE**                                                                                             | NONE                                                                                                                   | never                                                                                          | NONE                                                                                                            | schema-only                                             |
| 12    | `photo.dwell`                                                               | union+gate+weights                                                | `core/observer.ts:131` (IO, 2000 ms)                                                                 | `core/intent.ts:402`                                                                                                   | CH `events`                                                                                    | `luxury_buyer`/`second_home_buyer` boost (§D.6 "✅ Strong")                                                     | `__tests__/observer-behavioral.test.ts`                 |
| 13    | `floorplan.opened`                                                          | union+gate                                                        | **NONE**                                                                                             | NONE                                                                                                                   | never                                                                                          | NONE                                                                                                            | schema-only                                             |
| 14    | `floorplan.zoom`                                                            | union+gate                                                        | **NONE**                                                                                             | NONE                                                                                                                   | never                                                                                          | NONE                                                                                                            | schema-only                                             |
| 15    | `floorplan.dwell`                                                           | union+gate                                                        | **NONE**                                                                                             | NONE                                                                                                                   | never                                                                                          | NONE                                                                                                            | schema-only                                             |
| 16    | `price.hovered`                                                             | union+gate                                                        | **NONE**                                                                                             | NONE                                                                                                                   | never                                                                                          | NONE                                                                                                            | schema-only                                             |
| 17    | `price.compared`                                                            | union+gate+**weights**                                            | **NONE**                                                                                             | `core/intent.ts:423` (live consumer)                                                                                   | never                                                                                          | would drive `flip_investor` — §D.6 calls it "✅ Strong"                                                         | `intent.test.ts` (synthetic call only)                  |
| 18    | `feature.expanded`                                                          | union+gate+weights                                                | `core/observer.ts:206`                                                                               | `core/intent.ts:411` + payload intercept `:1117-1163`                                                                  | CH `events`                                                                                    | `golden_visa_buyer`, `remote_worker`, `retiree_relocator`, `downsizer`, `vacation_rental_investor`              | `observer-behavioral.test.ts`                           |
| 19    | `mortgage_calc.used`                                                        | union+gate+weights                                                | `core/observer.ts:278`                                                                               | `core/intent.ts:415`                                                                                                   | CH `events`                                                                                    | `family_buyer`, `first_time_buyer`                                                                              | `intent-weights.test.ts`, `observer-behavioral.test.ts` |
| 20    | `search.query`                                                              | union+gate                                                        | **NONE**                                                                                             | NONE                                                                                                                   | never                                                                                          | NONE                                                                                                            | schema-only                                             |
| 21    | `filter.applied`                                                            | union+gate (**excluded** from weights, `intent-weights.ts:50-52`) | `core/observer.ts:344,370`                                                                           | intercept `core/intent.ts:1171-1191` → `applyFilterBoosts:934`                                                         | CH `events`                                                                                    | `commercial_investor`, `upsizer`, `student_parent`, `yield_hunter`; **undamped**                                | `follow-211.test.ts`                                    |
| 22    | `filter.removed`                                                            | union+gate                                                        | **NONE**                                                                                             | NONE                                                                                                                   | never                                                                                          | NONE                                                                                                            | schema-only                                             |
| 23    | `sort.changed`                                                              | union+gate                                                        | **NONE**                                                                                             | NONE                                                                                                                   | never                                                                                          | NONE                                                                                                            | schema-only                                             |
| 24    | `chat.opened`                                                               | union+gate                                                        | **NONE**                                                                                             | NONE                                                                                                                   | never                                                                                          | NONE                                                                                                            | schema-only                                             |
| 25    | `chat.message.sent`                                                         | union+gate                                                        | `index.ts:1753-1801` (**SDK/host**: `estalara:chat:message-sent`)                                    | indirect, 6 hops → `applyChatIntentPrior` (`core/intent.ts:1399`)                                                      | CH `events` + Redis `shadow:{t}:{s}:chat_intent` (`apps/intent-engine/src/redis_writer.py:46`) | strongest non-quiz archetype override (all 18)                                                                  | `follow-387.test.ts` etc. (jsdom, hops 1+3 untested)    |
| 26    | `chat.intent.detected`                                                      | union+gate, and §C.4 says intent-engine emits it                  | **NONE** — `main.py:74-104` returns a dict + writes Redis, never queues an ingest event              | NONE                                                                                                                   | never                                                                                          | NONE                                                                                                            | schema-only                                             |
| 27    | `listing.next`                                                              | union+gate                                                        | **NONE**                                                                                             | NONE                                                                                                                   | never                                                                                          | NONE                                                                                                            | schema-only                                             |
| 28    | `listing.compared`                                                          | union+gate                                                        | **NONE**                                                                                             | NONE                                                                                                                   | never                                                                                          | NONE                                                                                                            | schema-only                                             |
| 29    | `listing.bookmarked`                                                        | union+gate+weights                                                | `index.ts:1932-1986` (**SDK/host**: `estalara:listing:favorited`)                                    | `core/intent.ts:350` + intercept `:1025-1065`                                                                          | CH `events`                                                                                    | `family_buyer`, `upsizer`, `commercial_investor`; "strongest deterministic non-quiz" per §C.1                   | `follow-210.test.ts`, `follow-385/389`                  |
| 30    | `inquiry.started`                                                           | union+gate+weights                                                | `core/observer.ts:589` — **only if `options.inquirySubmitSelector` is set** (`:579`)                 | `core/intent.ts:432`                                                                                                   | CH `events`                                                                                    | pushes off `neutral`; numerator of `/api/pilot/inquiry-starts`                                                  | `observer-inquiry.test.ts`                              |
| 31    | `inquiry.completed`                                                         | union+gate                                                        | `index.ts:1893-1922` (**SDK/host**: `inquiry.completed` on `document`)                               | conversion only — `api/pilot/cta-lift/route.ts:174`, `inquiry-starts/route.ts:177`                                     | CH `events`                                                                                    | lift numerator; bandit feedback                                                                                 | `adapt.test.ts`, `follow569-*.test.ts`                  |
| 32    | `tour.requested`                                                            | union+gate                                                        | **NONE**                                                                                             | NONE                                                                                                                   | never                                                                                          | NONE                                                                                                            | schema-only                                             |
| 33    | `session.started`                                                           | union+gate                                                        | `index.ts:634`                                                                                       | NONE directly; `device_type.*` prior is applied in-memory at `index.ts:1258-1263`                                      | CH `events`                                                                                    | device prior (via the separate `device_type.*` key, not this event)                                             | schema-only                                             |
| 34    | `session.quality.snapshot`                                                  | union+gate                                                        | `index.ts:665`                                                                                       | `api/dashboard/analytics/lift/route.ts` (DQS panel)                                                                    | CH `events` (**not** `session_quality`)                                                        | none on adaptation                                                                                              | `dqs.test.ts`, `dqs-integration.test.ts`                |
| 35    | `ab.assignment`                                                             | union+gate                                                        | **NONE** (producer deleted with decision-api — `apps/decision-api/src/app/api/adapt/route.ts:19-25`) | NONE                                                                                                                   | never                                                                                          | NONE — superseded by `adaptation_decisions.holdout_group`                                                       | schema-only                                             |
| 36    | `consent.granted`                                                           | union+gate (audit)                                                | `index.ts:472`                                                                                       | NONE                                                                                                                   | CH `events`                                                                                    | audit trail                                                                                                     | `event-contract.test.ts`, `consent-banner.test.ts`      |
| 37    | `consent.denied`                                                            | union+gate (audit)                                                | `index.ts:488`                                                                                       | NONE                                                                                                                   | CH `events`                                                                                    | audit trail                                                                                                     | as above                                                |
| 38    | `listing.viewed`                                                            | union+gate+weights                                                | `core/observer.ts:455,478`                                                                           | `core/intent.ts:333` + `applyListingViewRate` (`index.ts:1472`)                                                        | CH `events`                                                                                    | `yield_hunter`, `portfolio_builder`; also triggers cross-listing re-adapt (`index.ts:1430-1467`)                | `follow-208/383`, 15 files                              |
| 39    | `cta.clicked`                                                               | union+gate+weights                                                | `core/observer.ts:551`                                                                               | `core/intent.ts:338`                                                                                                   | CH `events`                                                                                    | `yield_hunter`, `flip_investor`, `luxury_buyer`; AC(5) lift numerator (`follow-819/differentiator-e2e.mjs:645`) | 17 files                                                |
| 40    | `quiz.event`                                                                | union+gate+weights                                                | `index.ts:1588,1700`                                                                                 | table entry is **identity** (`intent.ts:346` `makeLikelihood({})`); real effect via `applyQuizLeaf` (`intent.ts:1333`) | CH `events` + PG `quiz_completions` (`api/quiz/completion/route.ts`)                           | quiz leaf p=0.85 — strongest prior                                                                              | `event-contract.test.ts`, `follow554-*`                 |
| 41    | `quiz.mismatch`                                                             | union+gate                                                        | `index.ts:1610`, `core/adapt.ts:1405`                                                                | NONE (observability)                                                                                                   | CH `events`                                                                                    | none                                                                                                            | `follow-101.test.ts`                                    |
| 42    | `sidebar.closed`                                                            | union+gate                                                        | **NONE** (`ui/sidebar-widget.ts` is never rendered from `index.ts`)                                  | NONE                                                                                                                   | never                                                                                          | NONE                                                                                                            | schema-only                                             |
| 43    | `adapt.applied`                                                             | union+gate                                                        | `core/adapt.ts:931,1001,1154`                                                                        | NONE                                                                                                                   | CH `events`                                                                                    | observability                                                                                                   | `follow-793-802-803-*`                                  |
| 44    | `adapt.skipped`                                                             | union+gate                                                        | `core/adapt.ts:516,806,822,836,896,949,1023,1033`; `annotate-slots.ts:143`                           | NONE                                                                                                                   | CH `events`                                                                                    | observability                                                                                                   | 9 files                                                 |
| 45    | `adapt.reapplied`                                                           | union+gate                                                        | `core/adapt.ts:554`                                                                                  | NONE                                                                                                                   | CH `events`                                                                                    | observability                                                                                                   | `follow-793-802-803-*`                                  |
| 46    | `adapt.page_type_resolved`                                                  | union+gate                                                        | `index.ts:881`                                                                                       | NONE                                                                                                                   | CH `events`                                                                                    | observability                                                                                                   | `follow-1138.test.ts`                                   |
| 47-52 | `adapt.description.{applied,skipped,error,re,headline.applied,headline.re}` | union+gate                                                        | `core/adapt-description.ts:176,183,258,331,391,425,445,448`                                          | NONE                                                                                                                   | CH `events`                                                                                    | observability                                                                                                   | `adapt-description.test.ts`, `follow-380`               |
| 53    | `live.signup`                                                               | union+gate                                                        | `index.ts:1844-1882` (**SDK/host**: `live.signup` on `document`)                                     | conversion label (`api/pilot/*`), bandit feedback                                                                      | CH `events`                                                                                    | primary pilot conversion (D-4)                                                                                  | `adapt.test.ts`                                         |
| 54    | `intent.snapshot`                                                           | union+gate                                                        | `core/intent-snapshot.ts:46` ← `index.ts:1489-1497`, `:2022`                                         | NONE (write-only trail)                                                                                                | CH `intent_events` (`apps/ingest/src/handlers/intent-snapshot.ts:171`) + PG `intent_sessions`  | tracer / K.3.6                                                                                                  | `intent-snapshot.test.ts`, 10 files                     |
| 55    | `boot_timing`                                                               | union+gate                                                        | `index.ts:1314`                                                                                      | NONE                                                                                                                   | CH `events`                                                                                    | latency telemetry                                                                                               | `follow-1037.test.ts`                                   |

**Signals that exist only inside the SDK (not ingest event types)** — declared in
`INTENT_SIGNAL_KEYS` and `SIGNAL_LIKELIHOODS`, so they are part of the declared surface:

| Signal                            | Declared                                       | Producer                                                                                                                                    | Consumer                                                | Persisted                                                                    | Effect                                                      | Test                             |
| --------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------- |
| `device_type.desktop` / `.mobile` | `intent-weights.ts:59-60`, `intent.ts:353,375` | `index.ts:1258-1263` (init-time)                                                                                                            | same call                                               | not as an event                                                              | investor-vs-own-use prior ×1.2                              | `follow-207.test.ts`             |
| `micro_poll.answered`             | `intent-weights.ts:61`, `intent.ts:398`        | `index.ts:1688` — gated on `config.microPollsEnabled`, whose stored default is **false** (`packages/shared/src/schemas/quiz-config.ts:124`) | intercept `intent.ts:1071-1113` (**undamped** ×1.2-1.3) | persisted as `quiz.event` with `trigger:'micro_poll'` (`index.ts:1698-1710`) | `family_buyer`, `vacation_rental_investor`, investor family | `follow-209.test.ts`             |
| referrer / UTM prior              | §C.1 "Nowe sygnały"                            | `index.ts:1254`                                                                                                                             | `applyReferrerHints` (`intent.ts:1512`)                 | not persisted                                                                | investment/personal prior                                   | `follow-207.test.ts`             |
| auto-detect archetype hints       | `auto-detect/archetype-hints.ts`               | `index.ts:1243`                                                                                                                             | `applyArchetypeHints` (`intent.ts:1594`)                | not persisted                                                                | site-level boosts capped per archetype                      | `intent-archetype-hints.test.ts` |
| dwell timer                       | §C.1 (FOLLOW-190/227)                          | `index.ts:846`                                                                                                                              | `applyDwellSignal` (`intent.ts:1753`)                   | not persisted                                                                | leading-archetype boost, ≤3 ticks                           | `follow-227.test.ts`             |
| `listing.view_rate` (derived)     | §C.1                                           | `index.ts:1472`                                                                                                                             | `applyListingViewRate` (`intent.ts:1662`)               | not persisted                                                                | `portfolio_builder`/`flip_investor` vs `family_buyer`       | `follow-208.test.ts`             |

## 2. Counts

| Metric                                                                  | Count              | Notes                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Declared** ingest event types                                         | **55**             | `EVENT_TYPES`, pinned by `events.test.ts:76`                                                                                                                                                                                                           |
| **Actually emitted** by the SDK                                         | **31**             | rows 1,5,12,18,19,21,25,29,30,31,33,34,36,37,38,39,40,41,43,44,45,46,47-52,53,54,55                                                                                                                                                                    |
| — of those, host-CustomEvent-gated (no in-repo producer of the trigger) | **4**              | `chat.message.sent`, `listing.bookmarked`, `live.signup`, `inquiry.completed`                                                                                                                                                                          |
| — of those, config-gated (silently off by default)                      | **2**              | `inquiry.started` (needs `data-inquiry-submit-selector`), `quiz.event`/micro-poll arm (`micro_polls_enabled` default `false`)                                                                                                                          |
| **Never emitted** anywhere in the repo                                  | **24**             | rows 2,3,4,6,7,8,9,10,11,13,14,15,16,17,20,22,23,24,26,27,28,32,35,42                                                                                                                                                                                  |
| **Consumed by intent logic** (can move archetype/confidence)            | **11** event types | `scroll.depth`, `photo.dwell`, `feature.expanded`, `mortgage_calc.used`, `filter.applied`, `listing.bookmarked`, `inquiry.started`, `listing.viewed`, `cta.clicked`, `price.compared`, `chat.message.sent` (indirect). `quiz.event` is table-identity. |
| — of those, with a producer                                             | **10**             | `price.compared` has a consumer and no producer                                                                                                                                                                                                        |
| **Persisted** (would produce a CH row if fired)                         | **55**             | single `events` table; all 55 are consent-classified, so none is rejected as `unclassified_event_type`. In practice only the 31 emitted ever produce rows.                                                                                             |
| **Extra sinks**                                                         | 3                  | `intent.snapshot` → CH `intent_events` + PG `intent_sessions`; `chat.message.sent` → Redis shadow key; `quiz.event` → PG `quiz_completions`                                                                                                            |
| **Tested** — schema round-trip                                          | **55**             | `events.test.ts` (109 `ev(...)` cases) + `consent-gate.test.ts` exhaustive map                                                                                                                                                                         |
| **Tested** — emission path (jsdom/E2E driving real code)                | **31**             | the 24 dead types have schema-only coverage                                                                                                                                                                                                            |
| **Exercised by the FOLLOW-819 differentiator E2E**                      | **4**              | `scroll.depth`, `listing.viewed`, `cta.clicked`, `quiz.event` (`tests/e2e/follow-819/differentiator-e2e.mjs:746-770,776-940,999-1013`). No chat arm, no `photo.dwell`, no `filter.applied`, no `feature.expanded`.                                     |

## 3. Chat integration — hop-by-hop

The runbook `docs/runbooks/SDK_PRODUCTION_INTEGRATION.md:134-146` declares six hops. Verified at
HEAD:

| Hop | What                                                                                                   | Code at HEAD                                                                                                                                                  | Status                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | host page dispatches `estalara:chat:message-sent` on `document`                                        | **no code in this repo**; the only in-repo mentions are backlog/docs. `docs/AUDIT-2026-08-17.md:180-184` records it was never ported into the GitLab app repo | **ASPIRATIONAL / outside repo**                                                                                                                                                                                   |
| 2   | SDK listener queues `chat.message.sent` (drops `is_agent`, scrubs PII, derives `lead_id`)              | `packages/sdk/src/index.ts:1753-1801`                                                                                                                         | **CONFIRMED**                                                                                                                                                                                                     |
| 3   | ingest POSTs to Modal `chat_nlp_endpoint`                                                              | `apps/ingest/src/handlers/events.ts:514-540` → `handlers/chat-nlp-dispatch.ts:105`                                                                            | code **CONFIRMED**; `MODAL_CHAT_NLP_URL` is set **only** in `[env.dev]` (`apps/ingest/wrangler.toml:101`) and is a manual secret for prod (`:191`) → **silent no-op when unset** (`chat-nlp-dispatch.ts:105-110`) |
| 4   | intent-engine (Haiku 4.5) writes `shadow:{tenant}:{session}:chat_intent`, 24 h TTL, `SET NX` admission | `apps/intent-engine/src/main.py:74-104`, `src/redis_writer.py:46,86-120`                                                                                      | **CONFIRMED**                                                                                                                                                                                                     |
| 5   | `/api/adapt` reads the key, flattens, returns `chat_intent_dimensions` + `chat_intent_detected_at`     | `apps/control-plane/src/app/api/adapt/route.ts:2065-2142`, `src/lib/chat-intent-cache.ts:111,224`                                                             | **CONFIRMED**                                                                                                                                                                                                     |
| 6   | SDK folds it once per extraction and re-sends `archetype_hint` next call                               | `packages/sdk/src/core/adapt.ts:1365-1410` → `core/intent.ts:1399`                                                                                            | **CONFIRMED** (lands one adapt call late, by design)                                                                                                                                                              |

Cross-runtime parity of hops 4↔5 is pinned by `tests/fixtures/chat-intent-signal-parity.json` and a
live round-trip smoke (`tests/integration/redis-shadow-round-trip.smoke.test.ts`).

**What HAS been run on localhost, and where it starts.**
`docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md:227-314` (§3.7, FOLLOW-817) documents an **executed**
2026-08-07 run of hops **3 and 4**: a real `chat.message.sent` POST to the local ingest Worker with
`MODAL_CHAT_NLP_URL` set → `local_dev.py` shim → real Haiku 4.5 → shadow key read back as
`family_buyer`/0.82 with `purchase_purpose=relocation`, plus a negative control (kill the shim, same
POST still returns `{"accepted":1,"rejected":0}` HTTP 200 and the key is `null`). That is real
evidence, and it is bounded in three ways: it is a **manual `curl` runbook**, not a test in CI; it
**starts at `/v1/events`**, so hops 1 and 2 (host dispatch → SDK listener) are bypassed entirely;
and it **stops at the shadow key**, so hops 5 and 6 (`/api/adapt` read → `applyChatIntentPrior` →
changed directives) were not exercised in that run. The runbook's own §3.7 preamble states chat is
_"the only discriminator for 8 of 17 archetypes"_.

**Batch tier (§C.3 — Sonnet 4.6 every 6 h):** `apps/intent-engine/src/clickhouse_reader.py:15-28`
returns `[]` with a `TODO FOLLOW-101`. The 6 h cron therefore processes 0 sessions.
**ASPIRATIONAL.**

**Production chat producer on any site:** none. `apps/control-plane` contains no chat UI and no
dispatcher. `apps/control-plane/public/sdk.js` is a built SDK bundle, not a host page. ESC-020 keeps
the SDK off `app.estalara.com` entirely (`docs/AUDIT-2026-08-17.md:175`, FOLLOW-820 condition 3
requires `MODAL_CHAT_NLP_URL` on the **prod** Worker plus a traffic proof, still unmet).

**No automated test anywhere drives chat.**
`grep -ni chat tests/e2e/follow-819/differentiator-e2e.mjs` returns one comment (`:777`) and nothing
else; `grep -rln chat tests/` finds only the parity fixture, the Python shadow-writer helper, the
Redis round-trip smoke and the load generators. So the single strongest archetype lever in the
product is covered on localhost by one hand-run `curl` sequence over two of its six hops (§3.7) and
by nothing in CI — on exactly the substrate FOLLOW-820 grades.

---

## Findings

### S-1 — 24 of 55 declared event types have no producer anywhere in the repo, and 55 is a CI-pinned constant that cannot detect it

- **Claim:** `EVENT_TYPES` declares 55 types; 24 are never emitted by any code in the repo, and the
  only test that counts them asserts the total, not producibility.
- **Status:** CONFIRMED
- **Evidence:** dead set: `page.exit`, `tab.visible`, `tab.hidden`, `mouse.dwell`,
  `mouse.rage_click`, `mouse.exit_intent`, `photo.opened`, `photo.gallery.next`, `photo.zoomed`,
  `floorplan.{opened,zoom,dwell}`, `price.hovered`, `price.compared`, `search.query`,
  `filter.removed`, `sort.changed`, `chat.opened`, `chat.intent.detected`, `listing.next`,
  `listing.compared`, `tour.requested`, `ab.assignment`, `sidebar.closed` — declared at
  `packages/shared/src/schemas/events/index.ts:225-290`, classified at
  `apps/ingest/src/consent-gate.ts:88-160`, zero `type: '<t>'` hits under `packages/sdk/src`.
  Counter pinned at `packages/shared/src/schemas/events/events.test.ts:76`.
- **Impact on measured pilot:** degrades data — a 55-type taxonomy reads as 55 signals in every
  design doc and dashboard; the real behavioural surface is 10 event types. It does not by itself
  invalidate a measurement.
- **Ticket coverage:** FOLLOW-540 (`backlog/FOLLOW_UPS.md:14342`) proposes exactly this — enumerate
  the producer-less types with provenance + a Rule-H carve-out. `promoted_to_queue: false`, absent
  from `backlog/QUEUE.md` → **stub, never promoted**, P3.
- **Priority + dependencies:** P2 (raise from FOLLOW-540's P3 — see S-2/S-3, both concrete defects
  this register would have surfaced). No dependencies.
- **Proposed AC:**
  - A `RESERVED_EVENT_TYPES` const adjacent to `EVENT_TYPES` listing every producer-less type with a
    one-line reason (`reserved`, `host-contract`, `superseded`, `dead`).
  - A test asserts `EVENT_TYPES = producible ∪ RESERVED_EVENT_TYPES` with an empty intersection, so
    a new type must land in one list or the other in the same PR.
  - §C.1's "SDK Producer Status" column regenerated from that const, not hand-maintained.
- **Red-first proof:** add the const with the 24 names and the partition test; it is red today (the
  set is undeclared) and green when the list matches a grep of SDK emit sites.

### S-2 — `price.compared` has a live intent consumer and no producer; §D.6 rests `flip_investor` on it as "✅ Strong"

- **Claim:** `SIGNAL_LIKELIHOODS['price.compared']` is read on every behavioural signal and can
  never fire, so the documented strong passive discriminator for `flip_investor` is unreachable.
- **Status:** STALE (docs claim a working discriminator; code disagrees)
- **Evidence:** consumer `packages/sdk/src/core/intent.ts:421-431`
  (`'price.compared': makeLikelihood({...})`); overridable server-side at
  `packages/shared/src/schemas/intent-weights.ts:65`; zero producers — no `type: 'price.compared'`
  under `packages/sdk/src`. `docs/MASTER_DESIGN.md:2062` —
  `flip_investor | price.compared + filter.applied(facet=renovation) | ✅ Strong ('price.compared' SIGNAL_LIKELIHOODS entry) | ... | 🟢 Full`.
- **Impact on measured pilot:** degrades data — one of the 9 archetypes counted as "🟢 Full" in the
  coverage summary (`:2072`) has, in practice, only the undamped `filter.applied` intercept. The
  pilot's per-archetype lift table will have a `flip_investor` row whose assignment path is weaker
  than the plan assumes.
- **Ticket coverage:** **NO COVERAGE.**
  `grep -n "price.compared" backlog/FOLLOW_UPS.md backlog/QUEUE.md` finds only the load-test weight
  table. FOLLOW-344 (the ticket that wrote the D.6 column) explicitly forbids inventing passive
  discriminators but asserted this one exists.
- **Priority + dependencies:** P2. Independent; feeds FOLLOW-212 calibration.
- **Proposed AC:**
  - Choose one: (a) emit `price.compared` from a real observer keyed on a detected price-comparison
    surface, or (b) delete the `SIGNAL_LIKELIHOODS` entry + the `INTENT_SIGNAL_KEYS` member and
    re-grade `flip_investor` in §D.6 to quiz/chat-only.
  - If (b), `intent-weights.ts`'s "13 valid behavioral signal keys" docstring and the server
    override API drop the key in the same PR.
  - §D.6's coverage summary arithmetic (`9/18 🟢`) recomputed and restated.
- **Red-first proof:** a test asserting every `INTENT_SIGNAL_KEYS` member with a non-identity
  likelihood has at least one emit site in `packages/sdk/src`. Red today on `price.compared`; green
  after either branch.

### S-3 — `ab.assignment` is a P0 ticket marked DONE whose producer was deleted; the arm record survives only in `adaptation_decisions`

- **Claim:** the `ab.assignment` producer added by TICKET-AB-005 lived in `apps/decision-api`, which
  is now a 410-Gone stub; the canonical control-plane route never re-added it.
- **Status:** CONFIRMED (regression, benign)
- **Evidence:** `apps/decision-api/src/app/api/adapt/route.ts:19-25` — _"A/B holdout assignment,
  `ab.assignment` emit, and ReorderDirective building have all been removed"_.
  `backlog/QUEUE.md:17160-17170` — TICKET-AB-005 `status: DONE`, `promoted_from: FOLLOW-006`. Zero
  producers today. The arm is instead written to CH `adaptation_decisions.holdout_group` on **both**
  arms — treatment `apps/control-plane/src/app/api/adapt/route.ts:2156-2172`, holdout `:1836-1852`
  (`directiveCount=0`, `variant='control'`), GET `:1375-1391`.
- **Impact on measured pilot:** none for the lift query (it reads `adaptation_decisions`, e.g.
  `api/pilot/cta-lift/route.ts:106-174`). It is a false "wired" claim in the backlog and a dead
  schema.
- **Ticket coverage:** FOLLOW-006 (`backlog/FOLLOW_UPS.md:142`, `promoted_as: TICKET-AB-005`) —
  marked satisfied. No ticket records the deletion.
- **Priority + dependencies:** P3. Fold into S-1's reserved register.
- **Proposed AC:**
  - `ab.assignment` classified `superseded` in the reserved register, citing
    `adaptation_decisions.holdout_group` as the surviving record.
  - TICKET-AB-005's QUEUE entry gains a `historical_note` that its producer was removed with
    decision-api (the pattern already used for TICKET-AB-006).
  - A test asserting both arms write an `adaptation_decisions` row (this is the property the pilot
    actually depends on).
- **Red-first proof:** an integration test that POSTs `/api/adapt` twice with session ids on both
  sides of the HMAC boundary and asserts two rows with distinct `holdout_group` and
  `directive_count` 0 vs >0. Red today (no such test exists at the route level); green when added.

### S-4 — The four highest-value signals depend on a host CustomEvent contract with no producer in this repo and no E2E, and one of them is the primary pilot conversion

- **Claim:** `chat.message.sent`, `listing.bookmarked`, `live.signup` and `inquiry.completed` fire
  only when the host page dispatches a CustomEvent; nothing in the repo (not even a test fixture)
  dispatches any of the four.
- **Status:** PARTIAL — SDK consumer side is real and unit-tested; the producer side is out-of-repo
  and unverified.
- **Evidence:** `packages/sdk/src/index.ts:1753` (`estalara:chat:message-sent`), `:1932`
  (`estalara:listing:favorited`), `:1844` (`live.signup`), `:1893` (`inquiry.completed`).
  `grep -n dispatchEvent tests/e2e/follow-819/fixture-listing.html` → no hits; the only fixture
  dispatch anywhere is a debug hook (`packages/sdk/e2e/fixtures/inquiry.html:90`).
  `docs/AUDIT-2026-08-17.md:180-184` records hop 1 was never ported into the GitLab app repo.
  `live.signup` is the primary pilot conversion (CEO D-4,
  `packages/shared/src/schemas/events/index.ts:271`).
- **Impact on measured pilot:** invalidates measurement on the conversion axis —
  `/api/pilot/cta-lift` joins on `inquiry.completed` and `live.signup` (`route.ts:159-174`); if the
  host does not dispatch them, both arms are 0 and the lift is undefined rather than negative, i.e.
  indistinguishable from "no effect".
- **Ticket coverage:** the DOM contract is documented as `[HOST] action` in
  `docs/runbooks/SDK_PRODUCTION_INTEGRATION.md:14,138`. FOLLOW-1030's AC
  (`backlog/FOLLOW_UPS.md:38702-38707`) asks for a **probe that fails when the host snippet is
  absent**, citing this exact precedent — `promoted_to_queue` not set to true in the stub. No ticket
  covers the other three events' host producers. **PARTIAL COVERAGE (FOLLOW-1030, unpromoted).**
- **Priority + dependencies:** P1 — it sits on the FOLLOW-820 → measured-pilot path. Depends on
  nothing in this repo; the fixture half can land immediately.
- **Proposed AC:**
  - `tests/e2e/follow-819/fixture-listing.html` gains a scripted dispatcher for all four
    CustomEvents (a host simulator), driven by the harness.
  - The differentiator harness asserts one `chat.message.sent`, one `listing.bookmarked` and one
    `live.signup` row in CH `events` under the run's `session_id`.
  - A single published table of the four host contracts (event name, target — note `estalara:*` for
    two and bare `live.signup` / `inquiry.completed` for the other two — and required `detail`
    fields) with each name cited at its listener's `file:line`.
  - A CI probe that fails when a named substrate page lacks the dispatchers (FOLLOW-1030's AC
    restated as a gate).
- **Red-first proof:** run the harness today and query
  `SELECT type, count() FROM events WHERE session_id = '<run>' GROUP BY type` — the four types are
  absent. Green when all four appear.

### S-5 — The chat→archetype chain is wired in code for hops 2-6 but has zero end-to-end evidence, and the batch tier is a stub returning `[]`

- **Claim:** every code hop of the chat path exists; hops 3-4 were manually executed on localhost in
  August; hops 1-2 and 5-6 have never been driven in the same run as anything else, no automated
  test covers the chain, and the §C.3 6-hourly Sonnet batch enrichment is a no-op.
- **Status:** PARTIAL (hops 2-6 wired; hops 3-4 manually proven) + ASPIRATIONAL (hop 1, batch tier)
- **Evidence:** hop table in §3 above. Executed-but-partial:
  `docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md:227-314` — hops 3-4 run for real on 2026-08-07 with a
  negative control, starting at a hand-written `curl` to `/v1/events` (so hops 1-2 bypassed) and
  ending at the shadow key (so hops 5-6 unexercised); it is a manual runbook, not a CI test. Batch:
  `apps/intent-engine/src/clickhouse_reader.py:15-28` returns `[]`
  (`TODO FOLLOW-101: implement real ClickHouse query over default.events`), consumed by
  `apps/intent-engine/src/jobs/batch_enrich.py:39`. Hop 3 config: `apps/ingest/wrangler.toml:101`
  sets `MODAL_CHAT_NLP_URL` in `[env.dev]` only; `chat-nlp-dispatch.ts:105-110` makes an unset value
  a silent no-op — and the runbook's own negative control proves ingest still returns HTTP 200 when
  the whole chat pipeline is dead. No chat in the differentiator E2E
  (`grep -ni chat tests/e2e/follow-819/differentiator-e2e.mjs` → `:777` comment only).
- **Impact on measured pilot:** blocks go-live on the differentiator claim. §D.6 routes **8 of 18
  archetypes** to quiz-or-chat only (`docs/MASTER_DESIGN.md:2072`), and
  `docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md` §9.2 (per FOLLOW-883) judges quiz or chat **required**
  on the pilot page. FOLLOW-820 condition 3 already names the missing traffic proof.
- **Ticket coverage:** FOLLOW-817 (Modal deploy + the §3.7 localhost run — DONE per FOLLOW-820
  note), FOLLOW-892 (DONE on an effect), ESC-042 item 1 (open — `chat_intent` shadow key populated
  end-to-end _in prod_). FOLLOW-101 named in the batch stub. FOLLOW-819 is `IN_PROGRESS`
  (`backlog/QUEUE.md:28078`) and its AC set contains **no chat arm**. → coverage exists for the
  deploy and hop-3/4 legs, **NO COVERAGE for an automated hop-1-to-6 chat E2E**.
- **Priority + dependencies:** P1. Depends on S-4's fixture dispatcher (hop 1 simulator) and a local
  Modal/`local_dev.py` shim (`apps/intent-engine/src/local_dev.py:15,34,150`).
- **Proposed AC:**
  - A localhost E2E arm: fixture dispatches `estalara:chat:message-sent` with an investor-leaning
    message → assert (a) a `chat.message.sent` row in CH `events`, (b) the
    `shadow:{tenant}:{session}:chat_intent` key exists, (c) the next `/api/adapt` response carries
    non-empty `chat_intent_dimensions` + `chat_intent_detected_at`, (d) the following response's
    `archetype` differs from the behaviour-only arm's.
  - Run against the REAL control plane (`/api/adapt` via `llm-gateway.ts`), never the `:9100` mock.
  - `clickhouse_reader.read_recent_chat_sessions` either implements the query or the 6 h cron is
    disabled and §C.3's batch paragraph is marked deferred, so a scheduled no-op stops reading as a
    shipped tier.
  - `MODAL_CHAT_NLP_URL` absence emits an observable warning per batch containing a
    `chat.message.sent`, not a silent skip.
- **Red-first proof:** the four-assertion chat arm added to
  `tests/e2e/follow-819/differentiator-e2e.mjs`. Red today at assertion (a). Green only when the
  whole chain runs.

### S-6 — `inquiry.started` and the micro-poll arm are silently disabled by default, and both are counted as active in §C.1/§D.6

- **Claim:** two producers exist but are gated on configuration whose default is off, so a default
  tenant emits neither.
- **Status:** PARTIAL
- **Evidence:** `packages/sdk/src/core/observer.ts:578-581` — the inquiry click observer is wired
  only `if (inquirySubmitSelector && ...)`, sourced from `data-inquiry-submit-selector`
  (`core/config.ts:266`), emitted by `buildSnippet` only when the detected schema supplies it
  (`apps/control-plane/src/components/onboarding/DetectionPreview.tsx:174-184,231`). Micro-poll:
  `packages/sdk/src/index.ts:1740` gates on `config.microPollsEnabled`; stored default is
  `micro_polls_enabled: false` (`packages/shared/src/schemas/quiz-config.ts:124`). §C.1 lists
  inquiry as `✅ Active (inquiry.started) after FOLLOW-099` (`docs/MASTER_DESIGN.md:1687`).
- **Impact on measured pilot:** degrades data — `inquiry.started` is the denominator of
  `/api/pilot/inquiry-starts` (`route.ts:177-178`). A pilot page without the attribute produces a
  structurally empty numerator on that axis, which reads as "no inquiries", not "not instrumented".
  Micro-poll is the third undamped solicited-input path FOLLOW-883 says the pilot framing omits.
- **Ticket coverage:** FOLLOW-097 (`backlog/FOLLOW_UPS.md:2735`, _"inquiry.started never emitted in
  prod"_), FOLLOW-114 (snippet emission — landed, `DetectionPreview.tsx:174`), FOLLOW-127 (detection
  must produce the selector), FOLLOW-275 (micro-poll flag end-to-end), FOLLOW-883 (naming micro-poll
  in §9.2, `promoted_to_queue: false`). Coverage exists but is scattered and none asserts the pilot
  substrate actually carries either.
- **Priority + dependencies:** P2. Depends on which page the measured pilot runs on.
- **Proposed AC:**
  - The pilot fixture/substrate carries `data-inquiry-submit-selector`, and the harness asserts one
    `inquiry.started` row per simulated inquiry.
  - A start-up warning (or `adapt.skipped`-style event) when the SDK boots on a page with an inquiry
    form but no selector configured.
  - `micro_polls_enabled` state for the pilot tenant is recorded in the FOLLOW-819 run artefact, so
    a run cannot be graded without knowing whether the third input path was on.
- **Red-first proof:** query CH `events` for `type='inquiry.started'` on the current harness run —
  zero rows. Green when the fixture + selector land.

### S-7 — `chat.intent.detected` is documented in §C.4 as emitted by the intent engine and is emitted by nothing

- **Claim:** the event contract §C.4 specifies for the SDK↔intent-engine boundary has no producer;
  the real transport is the Redis shadow key.
- **Status:** STALE
- **Evidence:** `docs/MASTER_DESIGN.md:1716-1720` — _"`chat.intent.detected` — emitowany przez
  `apps/intent-engine` po NLP"_. `apps/intent-engine/src/main.py:74-104` returns
  `payload.model_dump()` and calls `write_shadow_intent`; it never constructs an ingest envelope.
  Zero producers repo-wide. Consent-classified `profiling` at `apps/ingest/src/consent-gate.ts:115`.
- **Impact on measured pilot:** none operationally — the shadow key is the working transport. It
  matters because §D.7 fallback rule 4 (`:2103`) keys off _"if `chat.intent.detected` not
  available"_, so the documented fallback condition is unobservable.
- **Ticket coverage:** **NO COVERAGE** for the doc/contract reconciliation. FOLLOW-346
  (`backlog/FOLLOW_UPS.md:9590`) covers activating the engine, not this contract.
- **Priority + dependencies:** P3. Fold into S-1.
- **Proposed AC:**
  - §C.4 states the real transport (Redis `shadow:{tenant}:{session}:chat_intent`, read by
    `/api/adapt`) and marks the event type `reserved`.
  - §D.7 rule 4's condition restated against something observable (`chat_intent_dimensions === null`
    in the adapt response).
- **Red-first proof:** a doc-link test (the repo already runs `scripts/check-*` gates) asserting
  every event type §C.4 claims a producer for appears in the producible set. Red on
  `chat.intent.detected`.

### S-8 — `intent.snapshot`'s `archetype_deltas` column is `'{}'` on 100% of rows, and the ticket number that tracks it collides with a DONE ticket

- **Claim:** the per-signal delta trail that distinguishes CH `intent_events` from the Postgres
  summary is permanently empty, and its follow-up id is reused.
- **Status:** CONFIRMED
- **Evidence:** producer `packages/sdk/src/core/intent-snapshot.ts:75-78` —
  `last_signal_delta: undefined` with the comment _"the SDK does not currently track"_. Consumer
  `apps/ingest/src/handlers/intent-snapshot.ts:180` —
  `JSON.stringify(event.payload.last_signal_delta?.archetype_deltas ?? {})`. Stub at
  `backlog/FOLLOW_UPS.md:7461` (**FOLLOW-288**, P1, `last_signal_delta`/`archetype_deltas`
  HALF*WIRE_C) collides with `backlog/QUEUE.md:20513` **FOLLOW-288** *"K.3.6 ClickHouse smoke gate
  repair — replace migration 0016 SELECT 1 no-op"\_, `DONE` per `:15963`.
- **Impact on measured pilot:** degrades data — FOLLOW-212's calibration wants
  `(signal_vector → quiz_archetype)`, and the only per-signal trail in the estate is empty.
  FOLLOW-269 replay is likewise starved.
- **Ticket coverage:** FOLLOW-288 stub exists but its number resolves in QUEUE to a different, DONE
  ticket → effectively **NO TRACKED COVERAGE**. The stub is not in QUEUE under its own header.
- **Priority + dependencies:** P2; blocks FOLLOW-212 quality and FOLLOW-269.
- **Proposed AC:**
  - Renumber the `last_signal_delta` stub to a free FOLLOW id and record the collision, so the
    number is not read as DONE.
  - Either populate `last_signal_delta.{archetype_deltas,event_type}` from the signal just
    processed, or drop the CH column + the payload field + the ingest derivation in one PR.
  - If populated: a contract test asserting a non-empty `archetype_deltas` reaches the CH INSERT
    from the real `emitIntentSnapshot` call site.
- **Red-first proof:** `SELECT count() FROM intent_events WHERE archetype_deltas != '{}'` → 0 today.
  Green (>0) after option (a), or the column is gone after option (b).

### S-9 — `packages/intent-ontology` is the declared 12-dimension ontology and is a 14-line placeholder with zero importers

- **Claim:** the package the design names as the intent ontology exports one version constant and is
  imported by nothing.
- **Status:** ASPIRATIONAL
- **Evidence:** `packages/intent-ontology/src/index.ts:1-14` — _"Full implementation in
  TICKET-013"_, exports `INTENT_ONTOLOGY_VERSION = '0.0.0'`.
  `grep -rn "intent-ontology" apps packages --exclude-dir=node_modules` returns only its own
  `package.json`, its own docstring and its own test. The de-facto registry is
  `packages/shared/src/archetypes.ts` (`CANONICAL_ARCHETYPE_IDS`, consumed at
  `packages/shared/src/schemas/intent-weights.ts:40`).
- **Impact on measured pilot:** none functionally; it inflates the "10 packages" figure in
  `CLAUDE.md` and keeps a phantom module in the dependency graph.
- **Ticket coverage:** FOLLOW-784 (`backlog/FOLLOW_UPS.md:25412`) — fill-or-delete; **FOLLOW-824**
  (`backlog/QUEUE.md:28249`) is the CEO decision ticket, `status: BLOCKED_ON_HUMAN`, P3.
- **Priority + dependencies:** P3, blocked on the CEO ruling in FOLLOW-824.
- **Proposed AC:** (as FOLLOW-824) a dated build-or-delete ruling; on delete, the package is removed
  and `CLAUDE.md`'s package count updated in the same PR.
- **Red-first proof:** `scripts/check-rule-i.sh` (wired-or-dead) flags `INTENT_ONTOLOGY_VERSION`;
  the count drops by one when the package is deleted.

### S-10 — Only 4 of the 10 live behavioural signals are exercised by the run that grades FOLLOW-820 condition 1

- **Claim:** the differentiator E2E drives `scroll.depth`, `listing.viewed`, `cta.clicked` and the
  quiz; the other six live behavioural signals are never fired, so their intent effect has never
  been measured end-to-end.
- **Status:** PARTIAL
- **Evidence:** `tests/e2e/follow-819/differentiator-e2e.mjs:752-763` (scrolls + image clicks),
  `:776-940` (real quiz widget), `:999-1013` (one `[data-estalara-cta]` click), `:645` (the
  synthetic `cta.clicked` fallback envelope). No `filter.applied`, `feature.expanded`,
  `mortgage_calc.used`, `photo.dwell` (the image _clicks_ at `:758-763` do not satisfy the 2000 ms
  IntersectionObserver dwell at `packages/sdk/src/core/observer.ts:27,131`), `inquiry.started` or
  `listing.bookmarked` driving. Fixture carries `headline`/`description`/`cta`/`feature` slots only
  (`tests/e2e/follow-819/fixture-listing.html:89,98,120,127`).
- **Impact on measured pilot:** invalidates measurement of the differentiator claim's breadth — ARM
  A ("behavioral signals only", `:746-750`) is designed to answer whether behaviour alone clears the
  gate, and it exercises three of ten signals. A red ARM A is therefore not evidence that behaviour
  cannot clear the gate; it is evidence that _these three_ cannot.
- **Ticket coverage:** FOLLOW-883 (undamped-boost class has four members,
  `backlog/FOLLOW_UPS.md:30747`, `promoted_to_queue: false`, blocks FOLLOW-819), FOLLOW-1099 (quiz
  arm never executed), FOLLOW-1126 (quiz locators unbound), FOLLOW-1075/1098/1121/1124 (AC(5)
  arithmetic). None widens the behavioural arm. → **PARTIAL COVERAGE**; the breadth gap itself is
  uncovered.
- **Priority + dependencies:** P1 (on the FOLLOW-820 path). Depends on fixture work shared with
  S-4/S-6.
- **Proposed AC:**
  - The fixture gains the surfaces the remaining signals need: a filter form (`filter.applied`), an
    expandable feature block with a recognised `payload.feature` value, a mortgage-calculator input,
    and photos held in-viewport ≥2000 ms.
  - ARM A drives all ten live signals and the artefact records, per signal, the count of CH `events`
    rows it produced — so a zero is visibly a _missing_ signal, not a weak one.
  - ARM A's verdict line names which signals were exercised, so a red result cannot be read as a
    verdict on behaviour in general.
- **Red-first proof:** run the harness and
  `SELECT type, count() FROM events WHERE session_id = '<armA>' GROUP BY type` — expect ≤3 types
  today. Green when all ten appear with non-zero counts.

### S-11 — Every declared type is consent-classified, so the fail-closed gate cannot catch a produced-but-unregistered type; the one time it happened, only a manual audit found it

- **Claim:** `evaluateConsent`'s `unclassified_event_type` branch is structurally unreachable for
  the 55 declared types, and the historical defect it would catch (SDK emits a type the union lacks)
  is caught by nothing automated.
- **Status:** CONFIRMED
- **Evidence:** `apps/ingest/src/consent-gate.ts:88` types the map as
  `Record<EventType, ConsentClass>` — exhaustive by construction; the `unclassified_event_type` path
  (`:199-202`) fires only for a string outside `EventType`.
  `packages/shared/src/schemas/events/index.ts:127-131` records the precedent: the SDK emitted six
  `adapt.description.*` types that ingest silently rejected until FOLLOW-461/audit F-04 registered
  them by hand.
- **Impact on measured pilot:** degrades data — a future SDK emit of an unregistered type is dropped
  at ingest with a rejection counter (`handlers/events.ts:448`) and no alarm, exactly as the
  `adapt.description.*` family was.
- **Ticket coverage:** FOLLOW-540 (`backlog/FOLLOW_UPS.md:14342`) names this inverse axis explicitly
  — _"the inverse (registered-but-unproduced) is equally invisible to CI"_ — and is unpromoted P3. →
  **PARTIAL COVERAGE (unpromoted).**
- **Priority + dependencies:** P2. Same PR as S-1.
- **Proposed AC:**
  - A CI check greps `packages/sdk/src` for `type: '<literal>'` emit sites and fails when any
    literal is absent from `EVENT_TYPES`.
  - The `schemaRejectedTypes` counter (`apps/ingest/src/handlers/events.ts:448`) raises a Sentry
    event, not only a log line, so a live drop is observable.
- **Red-first proof:** add the grep check plus a deliberate throwaway emit of an unregistered type
  in a fixture — the check must fail. It currently has no way to.

## Area verdict

The declared signal surface (55 event types) is roughly **3× larger than the emitted surface (31)
and 5× larger than the surface that can move an archetype (10 event types + 4 SDK-internal
signals)**. That gap is mostly benign reserved schema, but it hides three real defects:
`price.compared` is a live consumer with no producer while §D.6 counts it as a strong discriminator
for `flip_investor` (S-2); `ab.assignment`'s producer was deleted under a ticket still marked DONE
(S-3); and `intent.snapshot`'s delta trail is empty on every row under a colliding ticket number
(S-8). The more serious exposure is the **conversion and chat axes**: the four highest-value signals
— chat, favourites, `live.signup`, `inquiry.completed` — all depend on a host CustomEvent contract
that has no producer in this repo, no fixture, and no E2E (S-4), and the chat chain, wired
faithfully for hops 2-6 and manually proven for hops 3-4 only (`LOCAL_PILOT_ENVIRONMENT.md` §3.7),
has never been driven from host dispatch through to a changed directive in one run, has no automated
coverage at all, and its batch tier is a stub returning `[]` (S-5). Since §D.6 routes 8 of 18
archetypes to quiz-or-chat only, FOLLOW-820 condition 1 is being graded by a run that exercises 3 of
10 behavioural signals and 0 chat hops (S-10, S-11). The fixes are cheap and concentrated: one
host-simulator fixture plus a widened ARM A would close S-4, S-5, S-6 and S-10 at once, and a
`RESERVED_EVENT_TYPES` register (FOLLOW-540, filed, never promoted) would close S-1, S-3, S-7 and
S-11.

## Open questions for the CEO

1. **`price.compared` (S-2): implement or retire?** Retiring it drops `flip_investor` from "🟢 Full"
   to quiz/chat-only and changes §D.6's headline coverage number (9/18 → 8/18). Implementing it
   needs a price-comparison surface that the pilot page may not have. This is a product-coverage
   call, not an engineering one.
2. **Does FOLLOW-819 / condition 1 need a chat arm before GO?** FOLLOW-820 condition 3 requires a
   chat traffic proof in **prod**, which arrives after GO. Condition 1 grades localhost and has no
   chat arm; the only localhost chat evidence is the manual §3.7 runbook, which starts after hop 2
   and stops before hop 5, so no run has ever shown a chat message changing a directive. Adding an
   automated localhost chat arm (S-5) is ~1 ticket; the alternative is an explicit ruling that chat
   is out of scope for condition 1.
3. **FOLLOW-824 is still `BLOCKED_ON_HUMAN`** — the one-line build-or-delete ruling for
   `packages/intent-ontology` (and `packages/platform-templates`, 155 lines) unblocks S-9.
