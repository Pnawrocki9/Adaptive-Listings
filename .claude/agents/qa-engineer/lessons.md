# QA Engineer — Lessons Log

---

## 2026-06-18 / FOLLOW-336

**What I tested:** SSR admin auth — `checkStaffSession` (tracer-auth), `checkAdminSession`
(middleware admin gate), `SignInForm` sign-in form.

**Where a test could have passed over a dead wire:**

- `makeRequest` with a plain `headers` object created `NextRequest` that satisfies the TypeScript
  type but fails at runtime when `NextResponse.next({ request: req })` does
  `req.headers instanceof Headers`. A test using that helper would have thrown before ever reaching
  the assertions — so the tests were failing loud, not silently. But if someone had mocked
  `NextResponse.next` to skip the check, the admin gate tests would have passed over a dead wire
  (never exercising the real `checkAdminSession` path).

**Root cause of E119 (`request.headers must be an instance of Headers`):** jsdom patches
`globalThis.Headers` with its own implementation, breaking the `instanceof` check in
`NextResponse.next({ request: req })`. The fix is `@vitest-environment node` for any middleware test
file that exercises `NextResponse.next({ request })`.
`new NextRequest(url, { headers: new Headers() })` alone is insufficient in jsdom — the `Headers`
class used by `NextRequest.headers` (from Node.js's native fetch) is not the same as jsdom's shimmed
`Headers`.

**A guardrail I'd add:** For any test file that exercises Next.js middleware directly (not just
route handlers), document that `@vitest-environment node` is required when the middleware calls
`NextResponse.next({ request: req })`. A comment in the vitest.config.ts explaining this would
prevent the next engineer from spending time on the same diagnosis.

---

## 2026-07-18 / FOLLOW-583

**What I tested:** Extended the archetype-ID parity guard (FOLLOW-561) to a 4th hand-maintained
full-parity copy (`generate_description.py` `_ARCHETYPE_GUIDANCE`, feeds the live Modal
AI-description prompt) and 2 subset copies (`demo-override-store.ts` `REACHABLE_ARCHETYPES`,
legitimate; `route-helpers.ts`/`export/route.ts` mock archetype fixtures, which had an already-live
invalid id `family_upsizer`).

**Where a test could have passed over a dead wire:** if I'd hand-typed the 18 keys expected in
`_ARCHETYPE_GUIDANCE` into a fixture array instead of parsing the real `.py` file, the test would
have passed forever regardless of what the file actually contains — the multi-line, nested-quote
dict values made that shortcut tempting (a naive line-based split risks matching a substring inside
a value string, e.g. any prose line that happens to end `": ("`... though in practice no value line
does). Anchoring the key regex to `^\s{4}"([a-z_]+)":\s*\(` with the `m` flag and verifying it
matched exactly 18 (not more, not fewer) against the real checked-in file before wiring it into the
suite was the check that made this a real test rather than a restated fixture.

**A guardrail I'd add:** when a "subset-validity" guard covers two files that logically describe one
fixture set (here: `MOCK_ARCHETYPES` array + `buildMockExportRows()`'s inline literals), union them
into one assertion rather than two — otherwise a future drift where one file is fixed and the other
isn't goes undetected by whichever half-guard runs first. Did this here; worth calling out
explicitly as the pattern for any future "two files, one dataset" guard.

- **2026-07-19 / FOLLOW-585** · Added subset-validity parity assertions for 2 more `MOCK_ARCHETYPES`
  dev/CI fallback copies (`pilot/cta-lift`, `dashboard/analytics/lift`), red-first against the
  invalid `'investor'` literal, then fixed to `'portfolio_builder'`. · Where a test could have
  passed over a dead wire: when I first wrote the fix-comment I placed it _inside_ the array-literal
  block being regex-parsed (`between [ and ] as const;`); the comment's quoted word `'investor'` was
  picked up by the existing `/'([a-z_]+)'/g` scan as a false positive, producing a misleading "still
  red" result that looked like the fix hadn't landed rather than a parser artifact — caught only
  because I re-ran and inspected the failure message closely enough to notice it still said
  `investor` after editing the source array. · Guardrail I'd add: when a regex-based parity parser
  scans a full source block (not just an array literal), any future contributor adding an inline
  comment inside that block should keep it free of quoted strings matching the value pattern — worth
  a one-line note at the top of `archetype-id-parity.test.ts`'s parser helpers warning that
  comments-in-block can false-positive the scan. (Not adding it now — out of the ticket's declared
  scope of exactly 3 files.)

---

## 2026-07-19 / FOLLOW-587

**What I tested:** Swept the 3rd/4th non-canonical archetype literals FOLLOW-585 missed — both
inline object-literal fields (`top_archetype: 'family_nester'` in tracer sessions mock,
`archetype: 'investor'` in the audit-log mock), invisible to a `MOCK_ARCHETYPES`-name-anchored grep.
Added a red-first subset-validity guard for the tracer mock, fixed both literals, then applied the
durable compile-time root-fix: retyped the three hand-authored `MOCK_ARCHETYPES` arrays as
`readonly ArchetypeId[]`.

**Where a test could have passed over a dead wire:** the retype itself silently broke the existing
parity test's own parser regex (`MOCK_ARCHETYPES\s*=\s*\[...\]\s*as const;` no longer matched once
`: readonly ArchetypeId[]` sat between the name and `=`). Caught only because the parser's own
"matched > 0" guard threw loud
(`could not locate ... — the literal was likely renamed or reformatted`) instead of silently
reporting an empty match set as a pass. This is the exact fail-loud design the FOLLOW-561 doc
comment promises — worth calling out as a real payoff, not just theoretical: a compile-time root-fix
and a regex-based runtime guard covering the same literal are two independent layers, and changing
the first without touching the second can silently disarm the second unless it's built to fail loud
on structural drift.

**A guardrail I'd add:** whenever a ticket's "durable root-fix" step adds a type annotation to a
literal that an existing regex-parser test also scans, always re-run that parser test _before_
declaring the retype done — don't assume a `tsc`-clean retype is orthogonal to a runtime
string-parse guard on the same line. (Caught this time because the full parity suite was re-run as a
matter of course; would recommend making it an explicit sub-step in any future "add readonly type
annotation near a parsed literal" ticket.)

---

## 2026-07-20 / FOLLOW-589

**What I tested:** `apps/control-plane/src/app/api/admin/tracer/history/route.ts`
`buildMockEvents()` — the `archetype_deltas: JSON.stringify({ ... })` blob. Added a 12th
parser/assertion to `tests/integration/archetype-id-parity.test.ts` (subset-validity, same pattern
as the FOLLOW-587 guard). Captured RED against main's current state (`family_nester`, 11 passed / 1
failed), applied the one-line fix (`family_nester` → `family_buyer`), re-ran GREEN 12/12.

**Where a test could have passed over a dead wire:** none this time — the new parser is a genuinely
new structural shape (unquoted object-literal KEY inside a `JSON.stringify({...})` call), so
`JSON.parse` on the raw source text can't be used (it isn't valid JSON until stringified at
runtime); had to regex the `{...}` body directly and match keys via `/(\w+)\s*:\s*-?\d/g`. This is
the 3rd sub-shape of the same value-domain-literal bug class (quoted array literal → quoted
object-field value → unquoted JSON-blob key) that a naive "grep for the anchor name" sweep keeps
missing one shape at a time (FOLLOW-561→583→585→587→589). A repo-wide sweep for `JSON.stringify({`
blocks + a targeted grep across known-typo variants (`family_nester`, `luxury_seeker`, etc.) found
no other live instance of this shape.

**A guardrail I'd add:** Rule AD (promoted this session) should be checked BEFORE writing the next
parser, not just documented after — for any future archetype-literal ticket, enumerate the known
structural shapes (quoted array entry, quoted object field, unquoted object key, Python dict key,
SQL insert value) up front and grep for all of them in one pass, rather than fixing shapes
one-ticket-at-a-time as each new sweep stumbles on the next. This ticket is evidence the chain is
now closable — worth confirming in the next retro that no 6th shape surfaces.

---

## 2026-07-20 / FOLLOW-588

**What I tested:** hardened all 11 archetype-ID-parity parser helpers (`stripComments()`) so a
quoted/keyed archetype id sitting inside a `//`/`#`/`/* */` comment INSIDE a captured `[...]`/
`(...)`/`{...}` block can no longer false-positive the scan. Added 2 regression tests (JS `//` case
via `parseMockArchetypesGeneric`, Python `#` case via `parseNlpPyArchetypes`) using inline
self-contained fixture strings, NOT real repo files — run through the REAL parser functions (same
stripping path), not a reimplementation. Proved red→green by temporarily neutering `stripComments`
to an identity no-op: both new tests failed exactly as predicted (`investor` leaked through from the
comment) while all 12 pre-existing assertions against real files stayed green (confirming the
neutering didn't corrupt anything the real files depend on); restored the hardened version and
re-ran green 14/14.

**Where a test could have passed over a dead wire:** this ticket exists precisely because the
_previous_ parity tests were exactly that kind of trap — they passed even when the underlying regex
scan could be fooled by a comment, because no test had ever exercised that path. The fix here is the
regression test itself; nothing new introduced this time (the fixtures are run through the real
parsers, not hand-rolled duplicate parsing logic, per the QA charter's own guardrail against
dead-wire tests).

**A guardrail I'd add:** when a captured-block regex parser is added for a NEW literal shape (a 6th
shape, a new file), require a comment-injection regression test alongside it from day one — don't
wait for a real debugging incident (FOLLOW-585) to discover the gap. Consider adding a lint rule or
PR-template checklist item for "regex captures a delimited block + scans for quoted values inside it
→ has this been comment-injection tested?" so the pattern doesn't need re-discovering a 3rd time in
a different test file.

- **2026-08-01 / FOLLOW-752** · **What I tested:** extended the real-Redis gate
  (`redis-shadow-round-trip.smoke.test.ts`) with two cases proving `write_shadow_intent`'s
  `SET … NX` write-admission invariant (ADR-0020 D3/D4) is honoured by an ACTUAL Upstash instance —
  warm-key (signal write, then empty write, assert the FIRST record survives AND TTL strictly
  decreases rather than resetting to 86400) and cold-key (empty write on a fresh session IS stored,
  markers intact). Both drive the PRODUCTION `write_shadow_intent` via a new parameterized
  subprocess script (`nx_invariant_writer.py`) and read back via the PRODUCTION
  `readShadowChatIntent` / `deleteShadowChatIntent` — nothing hand-injected. **Where a test could
  have passed over a dead wire:** the prior state of the world, exactly — `test_intent_engine.py`'s
  `_write()` helper proved `nx=True` was passed to a `MagicMock`, which accepts any kwarg name, so
  an SDK rename/deprecation of `nx=` would leave that suite green while production silently reverted
  to clobbering; the sibling real-Redis gate existed but its one fixture (8 non-null dims) never
  reached the NX branch at all (`grep nx` on it was zero hits) — a green gate over the unchanged
  path read as coverage of the changed one. Verified the new cases actually catch the regression by
  removing `nx=True` from `redis_writer.py:130` against a real dockerized Redis (`redis:7-alpine` +
  `hiett/serverless-redis-http`) and confirming the warm-key value got clobbered (red), then
  restoring and reconfirming green — a `MagicMock`-only suite cannot produce this evidence because a
  mock has no real "clobber" to observe. **A guardrail I'd add:** when a real-Redis/real-network CI
  gate is filed as closing a ticket's evidence gap, require the PR to state which CODE BRANCH each
  fixture actually reaches (grep for the differentiating call, e.g. `nx=`) — "a real-Redis gate
  exists" is not the same claim as "a real-Redis gate exercises this branch," and the two were
  conflated here for weeks (FOLLOW-368 → FOLLOW-736 → this ticket) before anyone grepped.

- **2026-08-24 / FOLLOW-1074** · **What I tested:** nothing new — this was a docs-only correction of
  `tests/e2e/follow-819/README.md` §3, whose MANUAL runbook still told an operator to run the exact
  three silently-failing command forms (`doppler run -c dev -- pnpm dev` overrides-before-doppler;
  fixture served on `:9200`, outside `CORS_DEV_EXTRA_ORIGINS`; KV seed against the wrong tenant)
  that PR #833's own §6 had measured and proved wrong 180 lines below, plus a preamble that still
  claimed "UNVERIFIED-BY-EXECUTION" after §0 said otherwise. Fixed all four in place, added forward
  pointers from each corrected command to its §6 paragraph, and fixed one runtime error string in
  `differentiator-e2e.mjs` that independently told an operator to run the same retired doppler form
  (caught only because the AC's grep was scoped to `tests/` as well as `docs/`, not because it was
  named in the ticket's four-item list). **Where a test could have passed over a dead wire:** N/A in
  the strict sense (no test code), but the analogous failure mode is real: PR #833 measured the four
  defects by actually EXECUTING the runbook, then fixed only the sibling doc
  (`LOCAL_PILOT_ENVIRONMENT.md`) and not the README itself — the correction was "verified" (the
  underlying facts were real, re-checked independently by RETRO-305) but the fix's OWN scope was
  half-wired, exactly the shape this repo keeps re-discovering (Rule AI, now a 5th+ sighting) one
  level up: not a green test over a dead wire, but a green retrospective over a half-applied fix.
  **A guardrail I'd add:** when a retro's own §6/DG finding says "the sibling doc was corrected,
  this one was not," the retro or its promoted FOLLOW-up should itself grep for the corrected string
  pattern across BOTH files before filing, so the follow-up ticket states the exact stale line
  numbers instead of a summary an implementer has to re-derive by reading both documents cold (which
  is what happened here: the ticket's own AC bullet cited "§3.6" for a KV-seed defect that actually
  lives in this README's §3.5, sourced from `LOCAL_PILOT_ENVIRONMENT.md`'s different §3.6 — a
  cross-document section-number collision that cost real verification time and would recur for the
  next agent who trusts the ticket text over reading both files directly).

- **2026-08-24 / FOLLOW-1075** · **What I tested:** AC(5)'s two independently-sufficient blockers
  (no `cta.clicked` event at all, and only one arm driven) in `tests/e2e/follow-819/`. Added a real
  `[data-estalara-cta]` button to the fixture (the SDK's actual click collector, `observer.ts:547`,
  distinct from the `data-estalara-slot="cta"` copy slot — found by reading the SDK's own e2e
  fixture, `packages/sdk/e2e/fixtures/index.html`, rather than inventing a selector), clicked it in
  the adapted-arm browser session, and drove a genuinely separate holdout session via
  `holdout_pct: 1` on a real `POST /api/adapt` — a real field of `AdaptPostBodySchema` consumed by
  the real `assignHoldout()` (HMAC-SHA-256), never an injected `holdout_group` output — plus a real
  ingest `cta.clicked` event for that session. Executed end-to-end against real ClickHouse/Postgres/
  ingest-Worker/control-plane containers on localhost, twice, and cross-checked the endpoint's
  `ctaLift` against a hand-run ClickHouse query before trusting it. **Where a test could have passed
  over a dead wire — TWO found by execution, both in my OWN first draft, neither would have shown up
  from reading the code:** (1) the CTA click used Playwright's `force: true`, which skips
  scroll-into-view; the button sits below the fold on this fixture, so the forced click silently hit
  whatever was in the (unscrolled) viewport instead, Playwright reported the click as successful,
  and my own `adaptedCtaClicked` boolean (derived from `locator.count() > 0`, not from the click's
  actual effect) read `true` while zero `cta.clicked` rows landed in ClickHouse — a green boolean
  over a dead wire, caught only by querying ClickHouse directly before AND after the click rather
  than trusting either the click call's return value or the boolean I had just written to represent
  it. (2) the pre-existing sibling code (Arms A/B) waits `sleep(3000)` after emitting events, with a
  comment claiming "≥ the 2000ms batch flush interval" — the real producer (`index.ts`
  `BATCH_INTERVAL_MS`) is a fixed 5000ms `setInterval`, not reset per-event and never verified
  against that comment before I copied its pattern for my own click. A `sleep(3000)` after a click
  can land in the dead zone just after a flush cycle and observe zero rows — not a flake, a duration
  that was never read from its own producer, the exact FOLLOW-875 lesson this repo already codified
  for a threshold, unapplied to a duration. Fixed by reading `BATCH_INTERVAL_MS` from `index.ts` at
  run time instead of repeating the unverified constant. **A guardrail I'd add:** any Playwright
  `.click()` in this harness with `force: true` needs its resulting side effect (a specific row, a
  specific event) verified against the real substrate in the SAME PR that adds it, not assumed from
  the call succeeding — `force: true` is a documented actionability bypass, and Rule AU's "assert
  the behaviour, not the name" applies exactly as much to a boolean derived from a Playwright API
  call as it does to a grep for a symbol.

- **2026-09-13 / FOLLOW-1186** · **Tested:** FOLLOW-819 AC(1)'s verdict, pulled into a pure
  `evaluateAc1()` and driven by `ac1-verdict.test.ts` with response bodies derived from `route.ts`
  return sites (branch-3 refusal/outage, branch-2 template, `llm_tweaked`/`llm_full`, empty). The
  same verdict table run against the pre-fix predicate bytes (sliced from `origin/main`) flipped
  5/10: every non-adapted fixture passed. · **Dead wire:** AC(1) pooled its conjuncts across
  responses — confidence from the highest-confidence body, `directives.length` summed over all of
  them — so a template `cta` or even a neutral `default` response's appended `reorder` supplied the
  count. A real local artefact (ranAt 2026-08-25T22:37Z) recorded AC(1) PASS with zero LLM
  adaptation (`default`, `playbook_fallback_llm_unavailable/listing_context_unavailable`,
  `playbook`). AC(7)'s adapted-arm conjunct still reads the same pooled `totalDirectives > 0`. ·
  **Guardrail I'd add:** an acceptance predicate over a response SET must evaluate every conjunct on
  the SAME element (exists-one-that-satisfies-all), never min/max/sum across elements; and a count
  of "directives" must name which directive types stand for the claim, because the POST handler
  appends `reorder` on every `source`.

- **2026-09-13 / FOLLOW-1200** · **Tested:** FOLLOW-819 harness config/preflight/artefact only (AC
  predicates untouched, FOLLOW-1196 owns those next). `LISTING_URL` default `:9200` → `:5173` plus a
  new `assertListingOriginAllowed()` that reads `CORS_DEV_EXTRA_ORIGINS` from `origin-policy.ts` at
  run time and hard-fails before any session starts; `assertRealControlPlane()`'s probe pulled into
  a pure `evaluateControlPlaneProbe()` that now fails on a 5xx / a non-2xx body carrying
  `demo_auth_misconfigured`; `last-run.json` now carries `harnessSha`/`startedAt` plus a
  `--check-staleness` verdict gated on `git merge-base --is-ancestor`. · **Dead wire this closes:**
  `assertRealControlPlane()` checked only `probe.status === 404` — a healthy-LOOKING 500
  `demo_auth_misconfigured` (Turbo silently stripping the Doppler env, L-1) passed as a real control
  plane, so every downstream AC(1)/(2)/(3) red read as a product defect instead of a bring-up one.
  Proven pre-fix-vs-post-fix in `harness-preflight.test.ts` (`legacy=true, fixed=false` on the
  500/503 rows) rather than asserted in prose. · **Guardrail I'd add:** any preflight/guard function
  in a harness whose job is "refuse a misconfigured substrate" needs the SAME red-first
  pre-fix-vs-post-fix proof `evaluateAc1()` set the precedent for — a guard that only ever tightens
  is still a guard whose original gap was unproven until someone fed it the exact input it used to
  wave through.

- **2026-09-13 / FOLLOW-1196** (entry written by the FOLLOW-1205 worker; the FOLLOW-1196 worker
  could not write it) · a verdict over a set must bind every condition to the same response, and a
  shared predicate must be one function, not a re-derivation.

- **2026-09-13 / FOLLOW-1205 + FOLLOW-1206** · **Tested:** the FOLLOW-819 preflight probe through
  the REAL `POST /api/adapt` handler and REAL middleware, imported into `tests/e2e` (DB client
  faked, env as the world), across 8 substrate states plus the pre-fix request in each; a
  socket-level test of `assertRealControlPlane()` itself; freshness axes (aborted, dirty tree, no
  tree record); `outcomes.adapted` bound to the qualifying count. Live `next dev --turbo` for the
  two facts a unit test cannot show (Node `fetch` delivers `Origin`; middleware ACAO survives on a
  401/500). · **Where a test passed over a dead wire:** #898's "healthy 401" row WAS the L-1
  response, because every probe row was typed from a ticket. The verdict function was right and the
  probe never delivered the input it guards against. Same shape in the CORS test: a docblock
  claiming "read at HEAD, not a copy" over a hardcoded copy. · **Guardrail I'd add:** a detector
  test's triggering row must be produced by importing the producer and sending it the detector's
  exact request built by the SAME exported builder the detector uses; then mutate the builder (drop
  one header) and confirm the table goes red. If the row survives the mutation, it never depended on
  the wire.
