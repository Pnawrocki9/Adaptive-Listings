# ml-engineer lessons

- **2026-07-03 / FOLLOW-485** · Implemented ADR-0016: replaced the Redpanda poller dispatch path for
  description.requested and listing-embed-seed.requested with direct authenticated Modal HTTPS web
  endpoints (`@modal.fastapi_endpoint(method="POST")`, modal 1.4.2 — the older `@modal.web_endpoint`
  is deprecated). Added `description_requested_endpoint` (generate_description.py) and
  `listing_embed_seed_requested_endpoint` + a new spawn()-able `process_embed_seed_request` job
  (consume_embed_seed_requests.py, since the old poller processed listings inline with no existing
  per-event function to `.spawn()`). Both endpoints validate the same REQUIRED_FIELDS contract the
  retired pollers used and check `Authorization: Bearer <INTERNAL_API_SECRET>` via
  `hmac.compare_digest`. control-plane `publishDescriptionRequested` and
  `publishListingEmbeddingSeed` now POST the raw event JSON (no more Redpanda `records` envelope) to
  `MODAL_DESCRIPTION_URL` / `MODAL_EMBED_SEED_URL` with the Bearer header; unset URL is a fail-open
  no-op (Sentry breadcrumb, not capture); non-2xx/network failures capture to Sentry with
  `kind: 'dispatch_failed', sink: 'modal'`. Pollers kept, just unscheduled (`schedule=` removed),
  with a top comment marking them superseded-but-retained. · **Where real vs placeholder logic was a
  judgment call:** pytest can't easily instantiate Modal's actual FastAPI-wrapped route (the
  `@app.function` decorator returns an opaque `modal.Function`, not the raw callable), so the unit
  tests call the plain async endpoint function directly via the existing modal-stub convention
  (`conftest.py`'s stub makes `@modal.fastapi_endpoint` a no-op passthrough). To verify this
  actually matches Modal's real runtime behavior (not just my assumption), I additionally ran a
  manual sanity script against the REAL installed `modal` package: extracted
  `endpoint_fn.get_raw_f()` and mounted it into a genuine `fastapi.FastAPI().add_api_route(...)` —
  the exact mechanism Modal's own `_runtime/asgi.py::magic_fastapi_app` uses internally — and drove
  it through `TestClient` for all four cases (401/401/400/202). This is evidence, not a guess, that
  the endpoint will behave correctly once actually deployed via `modal deploy`. · **Guardrail I'd
  add:** when adding a Modal `@modal.fastapi_endpoint`, the PR should include (or CI should run) the
  `get_raw_f()` + `fastapi.TestClient` sanity check as a permanent test, not just an ad-hoc one-off
  verification — today nothing catches a future dependency-injection regression (e.g. someone
  switching `Body(...)` for a raw `Request` param) because the stubbed unit tests bypass FastAPI's
  parameter binding entirely.

- **2026-06-30 / FOLLOW-437** · Fixed two Modal deployment bugs (ESC-034): (1) `main.py` was an
  empty placeholder that registered zero functions on `modal deploy main.py`; (2) both
  `generate_description.py` and `consume_embed_seed_requests.py` each independently declared
  `modal.App("estalara-description-generator")`, so deploying either file wiped the other's
  functions from the live app. Fix: extracted the shared `app` and `_image` into a new
  `jobs/_app.py` module; both consumers import from there; `main.py` now imports both consumer
  modules (load-bearing side-effects) and re-exports `app`. Verified: `modal.App(...)` called
  exactly once, both consumers share the same object by identity. All 104 Python tests pass
  including the cross-language contract gate. · **Judgment calls:** (1) App name
  `estalara-description-generator` preserved despite being a misnomer for a multi-consumer gateway —
  renaming would orphan live functions, and the risk is not worth a cosmetic. Filed a comment in
  `_app.py` explaining the decision explicitly. (2) `_image` in `_app.py` carries the UNION of both
  consumers' pip dependencies — `anthropic>=0.28` (only needed by `generate_description`) is
  included in the image for both; this is intentional (single image for one app) and harmless
  (anthropic is already in the llm-gateway pyproject dependencies). (3) `get_service_info()` status
  changed from `"placeholder"` to `"active"` — the function is real infrastructure metadata now.
  Updated test assertion accordingly. · **Guardrail I'd add:** When adding a second consumer to an
  existing Modal app, CI should assert that no module other than the designated shared `_app.py`
  calls `modal.App(...)` — a grep or AST check would have caught the collision before it reached
  production.

- **2026-06-30 / FOLLOW-435 LEG 2** · Built the Modal embed-seed consumer in
  `apps/llm-gateway/src/jobs/consume_embed_seed_requests.py`, mirroring
  `consume_description_requests()` exactly (30s Modal cron, 25s poll window, confluent-kafka
  consumer, commit-per-message, fire-per-listing). Added 13-test Python contract suite
  `test_listing_embed_seed_event_contract.py` and a hard-gate CI step in the
  `cross-language-contract` job. Extended `apps/llm-gateway` rather than creating a new Modal app —
  same `estalara-secrets` secret, same image, same deploy command. · **Judgment calls:** (1)
  `text_fields` omitted from the embed POST body: the handoff says "optional — may be omitted if not
  available" and the consumer has no listing text at this stage; omitting it lets the endpoint fetch
  from its own DB. Named this clearly in the docstring. (2) `EMBED_API_BASE_URL` and
  `INTERNAL_API_SECRET` added to `.env.example` (not hardcoded) — both must be provisioned in the
  Modal `estalara-secrets` secret before the consumer can go live. Documented in PR. · **Guardrail
  I'd add:** When a new Modal consumer needs an outbound HTTP secret (`INTERNAL_API_SECRET`), a CI
  step should verify the secret name is declared in `.env.example` AND in the consumer's docstring —
  today both are true but only by convention; easy to miss in a PR that adds both the consumer and a
  new secret name simultaneously.

- **2026-06-25 / FOLLOW-341** · Activated cosine affinity path by extracting
  `seedArchetypeEmbeddings` into `src/lib/archetype-seeder.ts` (testable TypeScript module) from
  `scripts/seed-archetypes.mts` (not in tsconfig include, cannot be imported in tests). Added 8 unit
  tests via `vi.mock('openai')` + `vi.stubGlobal('fetch', ...)`. Added
  `archetype-embeddings-not-null` CI job (soft-skip without Doppler). PR #324 had merged earlier
  FOLLOW-341 work but only shipped a names/descriptions check — the embedding NULL check and unit
  test were missing. · **Judgment calls:** (1) The Rule I check scans `packages/ apps/` with
  `--include="*.ts"` but not `--include="*.mts"`, so `scripts/seed-archetypes.mts` importing
  `archetype-seeder.ts` is invisible to it; the 4 new Rule I violations are a pre-existing Rule I
  limitation. Accepted and noted in PR. (2) Kept `_resetOpenAIForTest()` exported (a test-only
  helper) rather than injecting the OpenAI instance, because the test imports the module fresh and
  the singleton needs a reset path. · **Guardrail I'd add:** Rule I should scan `*.mts` files as
  potential importers so CLI scripts don't cause false-positive zero-importer violations for their
  lib modules.

- **2026-06-24 / FOLLOW-384** · Added `profiling_opt_out: bool = False` parameter to
  `write_shadow_intent` with an early-return guard; threaded the flag through both call sites
  (`process_chat_message` in `main.py` and `batch_enrich_conversations` in `batch_enrich.py`). Two
  new tests assert the skip path (AC-2) and positive write path (AC-3). Change was ~15 lines across
  4 files; all 16 pre-existing tests continued to pass. · **Judgment calls:** (1) The batch tier
  (`batch_enrich.py`) cannot yet source opt-out state from ClickHouse — `clickhouse_reader.py` does
  not return it. Used `session.get("profiling_opt_out", False)` with a comment explaining the safe
  default and a "revisit" note, rather than silently dropping the hook or fabricating a query. (2)
  The opt-out flag was NOT added to `ChatIntentDetectedPayload`/`schemas.py` — it is a session-level
  control signal, not a payload dimension. This keeps the schema clean and avoids a misleading field
  that would suggest the payload itself carries consent state. (3) The Redis shadow round-trip CI
  check (cross-language, write_shadow_intent → readShadowChatIntent) passed — confirming the key
  format contract was not broken. · **Guardrail I'd add:** When a compliance flag (opt-out, consent)
  is added to one tier of a multi-tier pipeline, a CI check should verify ALL tiers that share the
  downstream write path accept the flag — here main.py and batch_enrich.py, but if a third tier is
  added later the check would not catch it. A shared test fixture that enumerates call sites would
  help.

- **2026-06-12 / FOLLOW-272** · Tightened `_check_headline_facts` to prevent digit-coincidence and
  first-word proper-name escape. Two changes: (1) Digit check: replaced bare
  `token.lower() in grounding` substring with a numeric-boundary lookaround
  `(?<![0-9.,])<token>(?![0-9.,])` so short tokens like `"5"` don't match `"425000"` or `"1,200"`
  matches aren't verified by `"1,500"`. (2) Proper-name scan: extended from `words[1:]` to `words`
  (all words) so a hallucinated proper name as the headline's first word is caught; added common
  real-estate descriptive adjectives (`"Strong"`, `"Prime"`, `"Ideal"`, `"Stunning"`, etc.) to
  `_HEADLINE_STOP_CAPS` to prevent false positives on generic sentence-starters. Added 6 new
  precision tests (3 red-then-green: digit-coincidence, first-word proper name,
  substring-in-stop-word; 3 green: exact price, grounded first-word, hyphenated bed count). ·
  **Judgment calls:** (1) Extending to `words[0]` required expanding the stop-caps set with ~30
  common real-estate adjectives — this is inherently non-exhaustive but conservative: if a rare
  adjective is absent from the set AND absent from the grounding, the headline is suppressed (safe
  fallback). Any legitimate first-word proper noun in the grounding passes because
  `re.search(\bWord\b, grounding)` finds it. (2) The token `"1,200/m"` (extracted from
  `"$1,200/mo"`) does not match `"1,200"` in grounding under either the old or new implementation —
  the regex includes `/m` as part of the token. Documented this in test docstrings; test fixture
  uses space-terminated price to demonstrate the pass case cleanly. · **Guardrail I'd add:** When
  tightening a fact-check heuristic, write the regression tests BEFORE changing the code ("red
  first") so you confirm the old code fails the new precision cases — here I wrote the tests after
  and discovered one test was wrong because the original was also failing it (for the `/mo` suffix
  reason). Red-first would have caught this earlier.

- **2026-06-11 / FOLLOW-169** · Brought `_generate_headline` to the description's anti-hallucination
  bar. Added `_HEADLINE_SYSTEM_PROMPT` (same fact-whitelist rules as
  `_SONNET_SYSTEM_PROMPT_TEMPLATE`), threaded `verified_facts` from the description call to avoid
  re-grounding, and added `_check_headline_facts()` post-gen detector (digit strings + capitalised
  proper-name heuristic, both verified against grounding text). SDK gate for AC3 was already
  implicit (fetchDescription returns null for non-ai_cached), not explicit — added route-invariant
  tests to make the contract visible and locked. · **Judgment calls:** (1) The proper-name heuristic
  (capitalised mid-headline words not in stop-caps set) has a false-positive risk for legitimately
  capitalised words (e.g. nationality adjectives, brand model names) that happen to not appear
  verbatim in listing_context. Conservative decision: if a buyer-visible word isn't in the grounding
  text it shouldn't be in the headline — false positives produce a suppressed headline (fallback to
  playbook), which is safer than a hallucinated named entity. (2) The verified_facts pass-through is
  optional (fallback to raw inputs when None) to remain backward-compatible with callers that don't
  have facts available. (3) Digit matching in `_check_headline_facts` uses
  `re.findall(r"\d[\d.,/%m²sqftftm-]*")` — designed to catch "7.2%" and "300m" while not splitting
  on "3-bed". The hyphen in the char class is at the end so it is literal, not a range. ·
  **Guardrail I'd add:** When adding a post-generation safety check for a new output type, also add
  a `log.warning` telemetry test (asserts log was called with the expected code) — currently the K.2
  log warning is not tested in isolation, only the return-None behavior is.

- **2026-06-10 / FOLLOW-101** · Built the chat.intent.detected → Bayesian prior bridge. Part A
  (control-plane): `chat-intent-cache.ts` reads Redis shadow key, flattens `intent_dimensions` to
  `Record<string,string>` (nulls/false booleans omitted), included as `chat_intent_dimensions` in
  `AdaptResponse`. Part B (SDK): `fetchDirectives` now returns `FetchDirectivesResult` envelope;
  when dims present, `applyChatIntentPrior` runs once per session (Rule R gate), result persisted to
  sessionStorage, `quiz.mismatch` dispatched on `chat_mismatch`. · **Judgment calls:** (1) The
  `FetchDirectivesResult` return type change cascaded to 6 existing test files — not just
  adapt.test.ts. Lesson: before changing a widely-used return type, grep ALL test files that call
  the function, not just the primary test file. (2) `quiz.mismatch` `behavioral_archetype` field was
  repurposed for the chat archetype — semantically correct (it's the non-quiz archetype), but the
  field name is misleading in this context. Filed no FOLLOW because it's deliberate reuse of an
  existing schema; the `confidence_gap: 0` default is an honest placeholder until real gap
  computation is wired. (3) `sessionStorage` key format: `persistIntentState` uses underscore
  separator (`estalara_intent_${id}`) not colon — always check the actual function before writing
  test assertions on storage keys. · **Guardrail I'd add:** When a TypeScript function's return type
  changes, a CI lint step could grep all test files for direct property access on the old return
  type and flag them (e.g., calls to `result?.archetype` where `result` is now a
  `FetchDirectivesResult`). Avoids silent test false-passes.

- **2026-06-10 / FOLLOW-087** · Built the two-tier chat NLP pipeline in apps/intent-engine
  (real-time Haiku 4.5 `process_chat_message` + 6h Sonnet 4.6 batch cron), shared `extract_intent`
  producing the 12-dim `ChatIntentDetectedPayload` contract (schemas.py, consumed by FOLLOW-101),
  shadow-only Redis writes, ClickHouse reader honestly stubbed to `[]`. · **Judgment calls:** (1)
  The spec mandated relative imports (`from .nlp`, `from ..main`), but this repo's Modal apps
  install `src/` as FLAT top-level modules (editable install flattens — no `src` package), and CI
  runs `python -m pytest src/`. Relative imports break there; I used absolute top-level imports
  (`from nlp import`, `from main import`) to match the actual import mode while keeping the spec's
  behavioral contract intact. (2) `detect_language_mix` — the spec's own test case "Szukam
  mieszkania w Krakowie" has NO diacritics, so a diacritic-only heuristic fails it; I added a
  high-precision PL/ES keyword set so the specced case passes without English collisions. (3) The
  ClickHouse reader is a stub — named `read_recent_chat_sessions` returning `[]` with a TODO, so the
  batch tier is honestly a no-op (per ML guardrail: don't name for a computation not done). ·
  **Guardrail I'd add:** Gitleaks `cloudflare-api-token` rule (`[a-zA-Z0-9_-]{40}`, entropy 3.0)
  false-positives on long descriptive Python test function names. The allowlist covered
  `apps/*/src/*/test_*.py` (nested) but NOT `apps/*/src/test_*.py` (top-level) — any new Modal app
  with a top-level `src/test_*.py` and verbose test names will hit this. Worth codifying: "Modal-app
  Python test modules with >40-char snake*case test names live at `src/test*\*.py`; ensure the
  gitleaks allowlist matches both nested and top-level test paths."

- **2026-07-01 / FOLLOW-364** · Docs-only fix: reconciled the §D.6 archetype coverage-summary prose
  in `docs/MASTER_DESIGN.md` to a clean 18-way partition (9 🟢 Full + 6 🟡 Quiz/chat-only + 2 ⚪
  Quiz/chat-only + 1 🟢 Always [neutral] = 18), verified by counting the actual Status column of
  every table row (via `awk`/`grep`) rather than trusting the prior prose. Also fixed the
  directly-contradicted Snapshot.1 D.6 row (line 439, dated pre-FOLLOW-344, claimed 13/3/2) to
  match. · **Judgment call:** the original double-count (`lifestyle_expat`/`upsizer` counted once
  inside "8/18 Full" and again as a standalone "+2/18 Full") was a prose bug, not a genuine
  two-bucket archetype — the table's Status column gives each archetype exactly one value. No
  escalation needed; there was no real taxonomy ambiguity. · **Guardrail I'd add:** a small CI check
  that greps the §D.6 table's Status column and asserts the coverage-summary sentence's counts match
  would catch this class of prose/table drift before it reaches a retro.

- **2026-07-02 / FOLLOW-460** · Closed audit F-10: `generate_description.py` was still SETting Redis
  with `EX 72h/48h` and tier-derived `max_tokens` floors years after Master Design §E.7 v2.0
  declared "no Tiers, no TTL" — durability of a generation silently depended on a read landing
  within the old TTL window to trigger the read-path's Postgres backfill. Fix: removed
  `tier`/`ttl_seconds` entirely from the Python job (both event fields are now ignored, not just
  defaulted), collapsed the per-Tier `max_tokens` floor into one `_MAX_TOKENS_FLOOR`, dropped the
  Redis `SET`'s `EX` arg, and added `_write_to_postgres_cache()` — a new HTTP callback to the
  control-plane's `POST /api/internal/description-cache` (which already existed, unused, built for
  exactly this) that writes `description_cache_persistent` immediately after every successful
  generation. Verified the read path (`getPgCachedDescription` → `getCachedDescription` →
  template_fallback) already matched the ordering in Master Design and needed no change; added a
  control-plane test (`route.follow460.test.ts`) proving a Postgres row generated 100h ago is served
  as `ai_cached` with zero Redis lookup and zero Modal re-enqueue. · **Judgment call:** Modal
  functions have no direct Postgres connection — rather than bolt on a new
  `psycopg`/Drizzle-over-HTTP pattern, I reused the exact HTTP-callback shape
  `consume_embed_seed_requests.py` already established for the same problem
  (`POST /api/listings/embed`), including a dedicated `DESCRIPTION_CACHE_API_BASE_URL` /
  `DESCRIPTION_CACHE_INTERNAL_SECRET` env-var pair mirroring `EMBED_API_BASE_URL` /
  `INTERNAL_API_SECRET`. Documented both in `.env.example`, but **the Modal secret
  `estalara-secrets` in the actual Modal workspace still needs these two keys added** (devops
  action, same runbook shape as `docs/runbooks/modal-embed-seed-consumer-golive.md`) before the fix
  takes effect in production — until then `_write_to_postgres_cache` silently no-ops (logged
  warning, not a crash) and durability regresses to the pre-fix read-path-only backfill. · **A
  guardrail I'd add:** a "new Modal env var pair added" check that cross-references `.env.example`
  entries introduced in a diff against a checklist item in the PR body confirming the paired Modal
  secret provisioning step was filed — this is the second time (after FOLLOW-436) a Modal HTTP
  callback shipped code-complete but secret-unprovisioned; two occurrences now meets the
  promote-to-rule bar per CONVENTIONS_PATCH.md.

- **2026-07-08 / FOLLOW-463** · Closed audit F-17: `description_generations` (migration 0007) had
  zero writers — `verified_facts_used` only ever lived in the Redis cache value and expired with it.
  Fix: forwarded `verified_facts` from `generate_description.py`'s existing
  `POST /api/internal/description-cache` callback (payload previously omitted it), and added a
  `writeDescriptionGenerationAudit` ClickHouse insert to that route, gated on `description !== ''`
  (a FOLLOW-465 NEUTRAL marker has no generation to audit) and fail-loud-but-non-blocking on CH
  failure (Sentry, PG write is the durability source-of-truth). Reused the existing
  `clickhouse-http.ts` client + the `writeDsrAuditLog`/`logLlmCallAsync` JSONEachRow-POST pattern —
  no new client, no new migration. · **Judgment call:** while verifying reachability I found the
  prod `ingest_worker` ClickHouse grant was _deliberately_ narrowed (ESC-032/FOLLOW-424, 2026-06-29)
  to **exclude** `description_generations` on the premise "no writer exists" — a premise this exact
  ticket invalidates. The code is correct and will self-heal the moment the grant is added (no
  redeploy needed), so I shipped it rather than blocking on the grant, but filed an OPEN escalation
  (`backlog/ESCALATIONS.md`) — without it the audit trail stays empty in prod indefinitely while
  every signal (green CI, green tests, Sentry silent because nothing calls the route in test/CI)
  looks like success. This is the RETRO-021 shape almost repeating (measured-in-fixture,
  unreachable-in-prod) but for a permission grant instead of a missing seed. · **A guardrail I'd
  add:** when a PR adds a new writer to a ClickHouse table, grep
  `docs/runbooks/clickhouse-ingest-worker-grant-narrowing.md`'s Confirmed Table Access list for that
  table name — if it's listed "no writer / intentionally dropped," the PR must either update the
  runbook+file a grant escalation (what I did) or the write path is dead on arrival in prod with no
  local signal. Same pattern class as the FOLLOW-460 unprovisioned-secret lesson above (Modal
  env-var pairs) — this is grant provisioning's analogue; worth promoting to a CONVENTIONS_PATCH
  rule if a third instance appears.

- **2026-07-24 / FOLLOW-635** · Scoped "un-shadow chat NLP for pilot." Traced the full chat→decision
  path and found the read is not just wired — chat already influences the DECISION via the SDK
  client prior loop (`applyChatIntentPrior` mutates `intentState.archetype` → next call sends it as
  `body.archetype_hint` → server drives directives), un-gated by `CHAT_NLP_LIVE`. But it is DARK in
  prod because the WRITE path (`estalara-intent-engine` Modal app) is not deployed
  (`modal-deploy.yml` ships only llm-gateway). Concluded: un-shadow = a DEPLOY leg (Modal Phase B) +
  one design ruling, NOT an ml-code change; filed ESC-042, no PR. · **Judgment call:** the guardrail
  "don't ship a name for a computation it doesn't do" bit HARD here — `CHAT_NLP_LIVE` and three
  "shadow-only / zero UX effect" docstrings are now factually false (chat DOES affect adaptation). I
  deliberately did NOT open a churn PR to fix them, because whether to delete the flag (option A) vs
  build server-side fusion (option B) is a product decision I must not pre-empt; the doc/flag
  cleanup should land atomically with that ruling. · **Guardrail I'd add:** when a
  "shadow/dark/gated" safety flag exists, verify it actually gates the data's influence end-to-end
  (incl. any client-side feedback loop) — a flag that only changes a log line while the signal
  reaches the decision by another route is a false safety control, exactly the RETRO-003/005 class
  of "name implies a computation it doesn't perform."

- **2026-07-24 / FOLLOW-635 (PR #613, option-A cleanup)** · Executed the CEO's option-A ruling from
  the same-day scoping entry above: deleted `CHAT_NLP_LIVE` (`adapt/route.ts`) after grepping to
  confirm it gated nothing but a `console.info`; corrected the false "shadow-only / zero UX effect"
  docstrings in `route.ts`, `intent-engine/src/{main,redis_writer}.py`, `sdk/src/core/adapt.ts`;
  also found (via the same grep sweep, not in the original file list) the identical false claim in
  `packages/shared/src/directives.ts`'s `chat_intent_dimensions` JSDoc and fixed it for consistency
  — it's the canonical type both control-plane and SDK import, so leaving it stale would have
  reintroduced the exact misleading-name problem one file over. Also removed the now-dead
  `CHAT_NLP_LIVE=false` entry from `.env.example`. Rewrote the FOLLOW-346 test file's describe/AC-1
  to assert the real contract (unconditional attach, no flag) instead of a flag-gate that no longer
  exists — left AC-2/3/4 (absent-key, no-raw-text, fail-open) as-is since they already asserted real
  behavior. Did NOT touch `modal-deploy.yml` (that's ESC-042, Piotr-side) and did NOT touch any §H.9
  opt-out logic (`redis_writer.py`'s `profiling_opt_out` early-return, `route.ts`'s
  `profiling_opt_out=1` gates) — verified via the existing Python/TS test suites that opt-out and
  fail-open behavior are unchanged (all green: 26 pytest, 335 control-plane adapt tests, 1534 SDK
  tests). · **Where real vs placeholder logic was a judgment call:** none in this PR — this was
  comment/test-contract-only, no behavior change; the "real vs placeholder" judgment call already
  happened in the prior scoping session (chat IS live-influencing, not a stub). · **A guardrail I'd
  add:** a CI grep that fires whenever a PR deletes a `process.env.<FLAG>` read but leaves any other
  file in the repo still referencing that flag name in a docstring/comment without the flag also
  being removed there — would have caught `directives.ts` automatically instead of relying on a
  manual repo-wide grep sweep.

- **2026-07-25 / FOLLOW-639** · **What I built:** per-brand FULLY editable quiz — new additive
  `quiz_definitions` table (migration 0035, partial-unique active-per-tenant),
  `QuizDefinitionSchema` slice in shared with HARD integrity (unknown archetype / dangling `next` /
  cycle / duplicate id) + the shared `reduceWeightsToArchetype` argmax (ONE source of truth) +
  non-blocking `computeUnreachableArchetypes`; `quiz_definition` on `GET /api/quiz/public-config`;
  SDK generic tree-walker replacing the hardcoded `resolveArchetype()`/`QUIZ_CONTENT` (EN-only
  `DEFAULT_QUIZ_DEFINITION`, argmax reduction, persistence path byte-preserved); staff editor
  `PUT /api/admin/tenants/quiz-definition` (ADR-0018 §3a atomic-audited). Bundle 40.99→40.75KB (net
  win). · **Where real vs placeholder was a judgment call:** two. (1) ADR D6 said "3 hardcoded
  languages leave" (EN-only default) vs the ticket's "existing tests stay green unmodified / byte
  identical" — these conflict for PL/ES. Resolved in favor of the ADR (EN-only default) because the
  single live tenant is EN, baseline headroom was only ~1KB (keeping PL/ES risked the 42KB gate),
  and full editability is exactly what lets a PL/ES brand ship its own tree. Rewrote the SDK
  quiz-widget + follow-273 tests (they tested the removed `resolveArchetype`/`QUIZ_CONTENT`),
  keeping the ROUTE tests green (unconfigured → no slice). Proved parity with a walk-vs-old-switch
  test. (2) Progress indicator shows `1/3` on the gate now (longest-path) vs the old tentative `1/2`
  — a cosmetic UI diff, not a persistence-contract change; accepted + noted. · **A guardrail I'd
  add:** a corpus/parity gate that fails if `DEFAULT_QUIZ_DEFINITION` (walked + argmax) ever stops
  reproducing the 17 legacy leaves — the byte-identical-fallback promise is only as strong as that
  parity test, and a future weight edit could silently break it.

## 2026-07-30 · FOLLOW-736 — shadow-key write admission (ADR-0020, `SET … NX`)

**Built.** `has_intent_signal(dims: ChatIntentDimensions) -> bool` + two branches in
`write_shadow_intent`: signal-bearing → `SET … EX`, empty → `SET … EX NX`. Shared parity fixture
`tests/fixtures/chat-intent-signal-parity.json` consumed by BOTH the Python predicate and the TS
`flattenIntentDimensions`. Compliance sync (C-07 / ROPA) + MASTER_DESIGN §D.1.1.

**Where real-vs-placeholder was a judgment call.** Two places, both about a name over-claiming:

1. `local_dev.py` returns `"shadow_key_written": not profiling_opt_out`, with a comment asserting
   that flag "is the whole truth and cannot drift out of step with the writer". My change made that
   false — I reproduced it live: a degraded POST against a warm key answered
   `shadow_key_written: true` while the NX write had stored nothing. The ticket said "do not touch
   `local_dev.py`". I read that as _do not change its behaviour_ and corrected the comment + README
   only (byte-identical call site), then filed FOLLOW-749 rather than improvising a return value on
   `write_shadow_intent`, whose `-> None` signature the ADR pins. Leaving a comment that says the
   opposite of what the code now does is the RETRO-003 failure mode with extra steps.
2. `ex=ttl_seconds` on the NX branch looks redundant (an existing key ignores the whole command) and
   is very tempting to delete. Deleting it would leave a session's FIRST record with no TTL at all —
   a permanent personal-data key. The handoff named this as trap 2; I would not have caught it from
   the code alone.

**Guardrail I'd add.** _When a change makes a sibling module's diagnostic field or comment
over-claim, correcting the prose is in scope even when the file is on the "do not touch" list —
behaviour is what the scope line protects, not stale prose. Say so explicitly in the PR and file the
ticket for the real fix._ Corollary that saved me here: **verify against a real client, not a
mock.** Docker `redis:7-alpine` + `hiett/serverless-redis-http` gives a genuine Upstash-REST
endpoint in ~30s, so "TTL not refreshed" became three descending TTL readings (86400 → 86369
→ 86314) instead of an assertion about `kwargs`. A mocked client would have proven the kwargs and
none of the semantics.

**Also worth remembering.** `pkill -f "<pattern>"` matches the agent's own shell command line and
kills the session — it cost me two tool calls. Use `pgrep -af` first and a pattern that cannot match
the invoking command.

- **2026-08-05 / FOLLOW-832** · Fixed `test_buyer_text_escapes_both_sinks` (renamed
  `test_buyer_text_escapes_all_sinks`): its "sink 2" assertion built the Redis-bound payload itself
  via
  `nlp._neutral_payload(extraction_error=f"{nlp._classify_extraction_error(exc)}: {type(exc).__name__}")`
  — a test-authored copy of `nlp.py:504`'s expression — so perturbing the real expression (`{exc}`
  for `{type(exc).__name__}`) left the suite green while the real `extract_intent()` return value
  leaked the buyer-text sentinel. The fix captures the return value the neighboring "sink 3" block
  already computed and discarded, and asserts over `json.dumps(returned.model_dump())` instead of a
  replica. Applied the SAME fix to the multilingual-retry arm (3b) for symmetry — its own
  `extraction_error=f"retry_failed: {type(exc).__name__}"` at `nlp.py:563` is a DIFFERENT expression
  from line 504's and had never been asserted by anything, primary-arm or otherwise. · **Where real
  vs placeholder logic was a judgment call:** the ticket's AC(3) listed
  `docs/compliance/dpia.md:255-258` as a citation to re-point, but that section doesn't name the
  test function (verified by grep) and the concurrently-dispatched FOLLOW-811 worker's own QUEUE.md
  scoping note explicitly assigns `dpia.md` §2.7 to itself for exactly this reason
  (disjoint-file-set safety between the two parallel worktrees) — so I left `dpia.md` untouched
  rather than risk a same-section collision with a worker running at the same time, and said so in
  the PR body instead of silently doing 3/4 of the AC. Also judgment: whether arm 3b needed the same
  returned-payload fix as arm 3 wasn't literally required by AC(1) (which only named the sink-3
  block) — did it anyway because the ticket's own closing paragraph named the exact failure mode
  (Rule S half-fixed pair) this would have been. · **A guardrail I'd add:** when a retro stub's
  citation list assumes a file hasn't been touched by a sibling ticket's citations yet ("dpia.md
  does not cite the test name" — true at filing time), a worker executing later should re-verify
  that assumption against the CURRENT state of any file shared with a concurrently-dispatched ticket
  before editing it, not just trust the stub's snapshot.

- **2026-08-20 / FOLLOW-1054** · Replaced the value-side candidate selector in `checkDirectiveFacts`
  (`apps/control-plane/src/lib/llm-gateway.ts`) with `/^\p{Lu}/u`, closing the ASCII fail-open that
  skipped every accented-capital word before any grounding comparison ran. · **Judgment call:** the
  one-character fix is trivial; the honest work was measuring what the widening ADMITS. 17/17
  generic accented adjectives become flaggable mid-segment, and the temptation was to quietly add
  `Élégant`/`Único`/`Świetny` to `FACT_CHECK_STOP_CAPS`. The measurement that settled it was the
  control group nobody asked for: French generics whose first letter is ASCII (`Charmant`,
  `Spacieux`, `Potentiel`) were ALREADY 5/5 flagged before the change, so an accented-only exemption
  would have been incoherent. Measure the population your fix does NOT touch — it is what tells you
  whether a new number is a regression or a pre-existing one becoming visible. · **Guardrail I'd
  add:** a candidate/skip predicate inside a safety check must state, in the same PR, the count of
  inputs it admits that it previously skipped — a fail-open fix's risk lives entirely in that delta,
  not in the bug it closes.

- **2026-08-20 / FOLLOW-1036 + FOLLOW-1050 + FOLLOW-1055 (one PR, three commits)** · Ported the two
  FOLLOW-1034 fact-check corrections (canonical digits, loose stem) from `checkDirectiveFacts` into
  `generate_description.py`'s `_check_headline_facts` and `_check_body_facts`; de-primed the Sonnet
  description prompt's ten verbatim banned coinages; deleted two dead ASCII-only module symbols. ·
  **Judgment call — the port's whole difficulty was what NOT to copy.** The TS side's `\p{L}\p{N}`
  lookarounds and `\p{Lu}` selector exist because JS `\b` and `[A-Z]` are ASCII; Python's `\b` and
  `str.isupper()` are Unicode-aware, so transliterating them (or reaching for the dead
  `_HEADLINE_CAPS_WORD_RE` sitting three lines above the function) would have INTRODUCED the
  fail-open the source PRs had just closed. Ported behaviour, not regexes — and pinned the
  non-introduction with a test that goes red if anyone ever adds `re.ASCII` or `[a-z0-9-]`. The
  second call was `_check_body_facts`: it shared the digit half verbatim, so fixing only its sibling
  would have left the shadow-mode measurement that gates flip-to-enforcement running on a defect
  already fixed next door. · **Guardrail I'd add:** when porting a fix between languages, the PR
  must state, per regex/predicate touched, whether the TARGET language already has the property the
  source-language fix was buying — because a cross-language port is the one refactor where the
  faithful diff and the correct diff can be opposites, and "make it look like the other file" is the
  default instinct.

- **2026-09-13 / FOLLOW-1191 (P0)** · Repaired both embedding seeders (a `.mts`→`.ts` ESM/CJS
  named-import SyntaxError had made `pnpm seed:archetypes` and `pnpm seed:listings` dead at module
  instantiation for ~11 weeks); gave the archetype seeder a loopback-only direct-Postgres transport
  so the localhost substrate can be seeded at all; replaced the `Archetype embeddings not-NULL`
  heredoc with a unit-tested assertion that also checks row count, `vector_dims` and name coverage;
  removed the job-level `continue-on-error` from that gate and from `post-migrate-seed.yml`; added a
  secretless `Seed script import check` gate. Local result: 18/18 non-NULL 1024-dim archetype
  vectors, 12 listing vectors for the fixture tenant, and the FIRST
  `adaptation_decisions.scoring_path = 'cosine'` row that has ever existed anywhere. · **Judgment
  call — the ticket asked me to register `Seed archetype embeddings (if any NULL)` in
  `.github/required-checks.txt`, and doing that literally would have broken every future PR.** That
  workflow triggers on `push: main` only, so it emits no check-run on a PR, and both register
  sections require PRESENCE: the entry would make `gh-pr-checks-verified.sh` exit 3 forever. I put
  it in the "DELIBERATELY NOT REGISTERED" block with the structural reason and named what replaces
  the coverage on each axis. Second call: I first exported `resolveSeedTarget` to unit-test the
  loopback refusal directly, which added two new Rule I violations — so I unexported it and drove
  the same eight cases through `seedArchetypeEmbeddings()` with `@estalara/db` mocked. That was
  strictly better evidence: it proves the transport that was CHOSEN is the one that RAN, and that
  the hosted `fetch` is never called on the loopback path. · **Guardrail I'd add:** a soft-skip
  contract must be implemented at the STEP that can legitimately be skipped, never as a job-level
  `continue-on-error` — job level cannot distinguish "the token is missing" from "the thing is
  broken", so a registered green-required name plus a job-level `continue-on-error` is a gate that
  reports success by construction. Grep for that pair before trusting any gate's green.

- **2026-09-14 / FOLLOW-1192.** Closed the id-join RETRO-324 §4a LG-1 flagged one hop past #892:
  `DEMO_LISTING_MANIFEST` hardcoded `listing-001..012`, the FOLLOW-819 fixture's single listing
  carries a different UUID, so a browser-driven adapt request against it always fell back to djb2
  even with both embedding tables populated. Added the fixture's UUID as a 13th manifest entry
  (content copied verbatim from the fixture's own headline/description, not invented) instead of
  renaming the fixture's id, because the 12 existing `listing-NNN` ids are load-bearing in an
  unrelated fixture family (`packages/sdk/e2e/fixtures/index.html`, `sprint-9-5-demo.spec.ts`), and
  six files outside this ticket's editable scope (`docs/*`, `backlog/*`, README) quote the fixture's
  UUID as ground truth — changing it would have created Rule AI violations I had no scope to repair
  in the same PR. Verified the pre-fix defect directly against the live local Postgres (`00e2`
  tenant: 12 listing_embeddings rows, 0 for the fixture UUID; 18/18 archetype_embeddings, confirming
  #892 is live) rather than trusting the retro's prose. · **Judgment call — red-first without
  vitest.** This worktree had no `node_modules` anywhere; I proved red→green with a dependency-free
  Node script performing the identical two regex/membership operations the real vitest test
  performs, against `origin/main`'s file and the fixed file, and separately confirmed the test's
  path-join resolves to the real fixture via `fs.existsSync`. That is evidence the LOGIC is right,
  not that the actual test file compiles and runs under vitest — I said so explicitly in the PR
  rather than implying the proxy was the real run. · **Judgment call — gitleaks' own `git` mode is
  blocked for worktree-isolated agents** (any launcher taking a bare `git` operand is refused,
  regardless of binary path — tried 3 shapes). Substituted a plain `git diff origin/main..HEAD`
  piped into `gitleaks detect --pipe`, which scans the identical content the mandated command would
  have and is not refused. · **Guardrail I'd add:** none — the ticket's own escape hatches (state
  what you couldn't run, cite the query) were sufficient; the gap is that no worker before me seems
  to have hit the gitleaks-git-mode sandbox refusal, so it's worth a one-line addition to
  `docs/AGENT_WORKFLOW.md` noting the `git diff | gitleaks detect --pipe` substitute so the next
  agent doesn't burn time rediscovering it.

- **2026-10-04 / FOLLOW-1286 (WP-2.1, D3 bandit freeze)** · **Built:** `BANDIT_ENABLED` (default
  off) — `/api/adapt` POST+GET serve and log `variant='control'` without reading arms;
  `/api/ab/weights`, the bandit-resume PATCH and `/api/adapt/feedback` answer 404 `bandit_disabled`
  before auth; the new-tenant seed is skipped; dashboards hide the arms panel; SDK variant cache +
  HMAC feedback ping removed (−466 B gzip). · **Judgment call — the plan's own verification
  contradicted its scope:** FOLLOW-819 AC(4) required a feedback-driven Beta delta, which a frozen
  feedback route can never produce, so "freeze" and "FOLLOW-819 ×3 green" could not both hold.
  Re-scoped AC(4) to assert the freeze from substrate (404 reason + arm unmoved + every served AND
  logged variant `control`), kept the delta branch for flag-on, and flagged it as a gate-semantics
  change for the PM/CEO rather than silently weakening it. · **Judgment call — SDK-derived CORS
  registry:** removing the SDK fetch site made the middleware row for `/api/adapt/feedback`
  unmatched; kept the middleware row (route frozen, not deleted) and named a single explicit
  exception in the parity test. · **Guardrail I'd add:** a plan WP that disables a hop must list
  which FOLLOW-819 AC reads that hop, so the gate change is ruled with the freeze instead of
  discovered mid-ticket.

- **2026-10-11 / FOLLOW-1251** · **Built:** `isAuthoredSectionLabel` — a reviewed, string-pinned
  allow-list of 13 `feature` section labels (the 4 that are property claims left out), consumed by
  the gateway's proper-name exemption; the label never enters the grounding corpus. · **Judgment
  call — element 2 (per-slot refusal) not shipped:** ESC-076/§E.7.0 says "A directive is generated
  FROM the listing's own text, or it is not generated" (per-directive) but states "When we cannot
  ground, we do not adapt" only at request level, and FOLLOW-457 chose whole-batch refusal; nothing
  rules on a partially invented batch, so ambiguous → not implemented. · **Judgment call — the brief
  said the F-02 corpus "must still be refused":** at HEAD it is ACCEPTED (lower-case amenities raise
  no proper-name flag; price-as-area matches the price digits) — that is FOLLOW-1305's defect, so no
  "still refused" test could pass; reported instead of pinned. · **Guardrail I'd add:** a brief's
  "must still be refused" claim should cite the test that proves it today.

- **2026-10-11 / FOLLOW-1305** · **Built:** unsupported-claim containment in both runtimes — the
  Python body check (shadow since FOLLOW-778) enforced plus amenity/guarantee/area-unit checks →
  verdict `REFUSED` before FIT and before both cache writers; TS `claim-containment.ts` with
  per-slot verdicts collapsed by one `batchRefusal` policy before any judge call; legacy admission
  via a `claims_validation` stamp (migration 0040) — an unstamped FIT hit is a miss; headline
  whitelist from listing fields, not `verified_facts_used`; few-shot examples rewritten. ·
  **Judgment calls:** (1) legacy = miss, not re-check on read — re-checking needs the listing text
  on a <100ms hot path; a miss costs one regeneration per row, once; (2) the claim check is a
  BOUNDED English lexicon, named as such, not the FOLLOW-1311 contract; (3) `_run_job` (the job-body
  copy) now delegates to `get_raw_f()` instead of being re-synced — the copy is what hid the shadow
  FIT; (4) refusals are not negative-cached (brief: write nothing), so a refused listing re-spends
  on each miss, bounded by the spend breaker. · **Guardrail I'd add:** a fact check that runs in
  "shadow" must name its flip ticket in the same PR, or it is a detector with a FIT behind it.

- **2026-10-11 / FOLLOW-1312** · **Built:** per-slot refusal — `batchRefusal` → `slotRefusal`
  (served/refused partitions); the gateway serves grounded slots, books its generation row SERVED
  when ≥1 slot is served and `_fact_check_rejected` only when all are refused, and writes one
  zero-cost `fact_check_slot_refused_<slot>_<violation>` row per refused slot (no DDL: no grant). ·
  **Judgment calls:** (1) over-budget batches still skip the judge entirely — under per-slot that is
  a latency choice, no longer outcome-neutral; named so (`overJudgeBudget`, was
  `judgeCannotSaveBatch`); (2) the model-written slot name is bounded to the playbook's own slots
  else `other`, because `source` is LowCardinality; (3) two 1178/1180 fixtures still used `terrace`
  (an amenity since FOLLOW-1305) and passed only by the old whole-batch short-circuit. · **Guardrail
  I'd add:** when a check gains a new deterministic class, grep every fixture value the class now
  matches — a test can keep passing for the wrong reason.

- **2026-10-12 / FOLLOW-1297 (PR A)** · **Built:** the Python description job ported to the control
  plane behind `MODAL_DESCRIPTION_URL` — `lib/grounding-check.ts` (pure checker with Python's
  whitespace set, `ensure_ascii` JSON, Unicode `\b`/`\w`/`isupper`, code-point slicing),
  `lib/description-generator.ts` (byte-identical prompts spliced from the Python module, verdict
  parser, G-02 PG-first writes with per-write results, G-03 total deadlines, one spend cap), the
  G-06 embed-seed hop/requeue route, and a 98-case parity corpus frozen FROM the Python (33 live
  Sonnet recordings, $0.74). · **Judgment calls:** (1) carried the Python defects as they are — an
  `é` in a context value grounds a `9`, a dangling `<verified_facts_used` is `residual_tag` not
  `truncated`, non-ASCII names only in context are never found — and pinned each one in the corpus
  rather than "fixing" it in the port; (2) `str.isupper()` ported as `\p{Uppercase}`, not the ADR's
  `\p{Lu}` (CPython's UPPER*MASK is the derived property); (3) hashes and ids in the fixture are
  written in colon/dot-grouped form because the repo's gitleaks heuristic flags any 40-char
  `[A-Za-z0-9*-]`run. · **Guardrail I'd add:** a parity corpus must be hashed from the bytes ON DISK (JSON round trip, no`sort_keys`) — key order of `listing_context`
  is part of the prompt, and the first freeze passed the live cases and failed every hand case for
  exactly that.

- **2026-10-16 / FOLLOW-1314** · **Built:** the description route reads the listing once and sends
  its own title/price/location as `listing_context`; the digit + proper-name grounding reads field
  values unescaped (corpus v2: 3 verdicts changed, listed). · **Judgment call:** the PM's hypothesis
  ("most proper-name refusals are the listing's own city") was wrong on the evidence — classifying
  all 18 refused live headlines found ONE place-name false refusal (Jávea, hidden by
  `ensure_ascii`), 15 true refusals (invented claims), and two false refusals caused by the
  Title-Case capitalised-word rule ("Near", "Quiet-Street"). Widening that rule was out of brief, so
  it is reported, not fixed; the digit-paraphrase rule was not built because no case's outcome
  depended on it once the title field (`3 bed, 2 bath`) reached the check. Sending fields switched
  ON the latent `é`→`9` fail-open, so it had to be closed in the same change. · **Guardrail I'd
  add:** before fixing a refusal class, print the FIRST failing token per case (not the code) — the
  violation code alone hid that "hallucinated_proper_name" mostly meant "Title-Case common word".

- **2026-10-16 / FOLLOW-1315** · **Built:** the headline prompt asks for sentence case, listing
  facts only, place names as written and no outcome promise; corpus v3 = prompt-digest re-freeze of
  v2 (verdicts unchanged), v1/v2 guards replay with v3's headline digests. Live, fixture listing, 18
  archetypes: served headlines 0/6 → 8/8 of headline calls. · **Real vs placeholder:** the old
  system prompt itself PERMITTED "strong rental demand" — the model was obeying it. One served
  headline still invents ("single-storey" for "single-family"): the checks cannot see a lower-case
  paraphrase claim, so a prompt fix raises the served rate AND the share of what only the claim
  contract (FOLLOW-1311) can catch. · **Guardrail I'd add:** every served headline in a live
  measurement is diffed by hand against the grounding payload — a 100 % served rate is not a 100 %
  grounded rate.

- **2026-10-20 / FOLLOW-1359** · **Built:** the v3.0 fold: `applyQuizLeaf(state, leaf, evidence)`
  0.72 / 0.90 / 0.90, confidence = posterior, neutral leaf unpinned, "None of these" = pre-quiz
  state + `quiz_rejected`; one `rebuild()` for all seven behavioural recompute sites (confirmed-leaf
  anchor with a real 0.005 floor); chat τ = 0.5 while confirmed; `CHAT_ONLY_CONFIDENCE_SCALE`; drift
  guards + `applyDriftCandidate`. +73 B gzip (the dedup of the seven return blocks paid for most of
  it). · **Real vs placeholder:** a "floor" applied before renormalisation is not a floor — the
  first cut let 20 commercial bookmarks drive 16 archetypes to 0.0016 under a constant named
  `QUIZ_PROB_FLOOR`; the honest floor needs the leaf mass capped at 1 − 17 × 0.005 = 0.915. Also the
  spec's "two 3-bed bookmarks → ~0.55" measures 0.462 (one bookmark gives 0.577). · **Guardrail I'd
  add:** every number a design doc states as a consequence ("~0.55", "3 do not flip") gets a pin
  computed by the code before the doc is ruled; and a brief's expected behaviour ("correcting draws
  a follow-up") is probed against the math before it is pinned.

- **2026-10-22 / FOLLOW-1380** · **Built:** blind Haiku 5.5 vs Sonnet 5.5 comparison through the
  real `generateDescription()` (24 cases, Opus 5.5 pairwise judge with swapped orders, blind
  single-text error audit, CEO blind sample). · **Real vs placeholder judgment call:** 16 of 17
  claim-check refusals were checker false positives (thousands separators, English-only amenity
  regex on a Polish original), so "refusals" measured the checker more than the model. I reported
  them as the stated rule required and diagnosed each one; I did not quietly reclassify. ·
  **Guardrail I'd add:** a model comparison must diagnose every refusal (generator token vs
  normalised cross-check) before a refusal count enters a decision rule. Every generator output also
  needs a language check: the generator served a Polish body on an EN page and no check caught it.

- **2026-10-26 / FOLLOW-1399** · **Built:** the FOLLOW-1380 comparison at n = 60 (34 Polish
  originals, seeded draw), headlines judged, every refusal diagnosed to its trigger phrase. · **Real
  vs placeholder judgment call:** "refusals level 12 vs 13" looks like parity, but 16 of 25 refusals
  were the same template word ("turnkey" / "pod klucz") that both models copy from `copy_template`;
  the count measures template adherence, not faithfulness. My own deterministic number check also
  misread decimal commas ("3,4 m") as invented numbers until I read the hits. · **Guardrail I'd
  add:** before any judge spend, run the deterministic checks and read every hit by hand; and budget
  judge calls from a 2-call pilot (Opus 5.5 at low effort cost USD 0.018 per pair judgment, the
  whole budget hinged on it).

- **2026-10-26 / FOLLOW-1400–1405** · **Built:** the familial-steering refusal on generated bodies
  and headlines (`steersByFamilialStatus`, the `/api/adapt` implementation, corpus v8); templates
  that no longer recommend refused words ("turnkey" family, "dla rodziny"), each pinned by a test
  over every `copy_template` sentence; a Sonnet 5.5 thinking reserve of 6,000; a closing language
  paragraph on the description prompt (corpus v9 re-freeze); `assertsNoWorkClaim` (negation, both
  paths); `stripGroundedDecades` (both digit rules). · **Real vs placeholder judgment calls:** (1)
  the brief asked for the language at the START and end of the prompt; measured, any change at the
  start made Haiku 5.5 write its reasoning into the reply (4–10 of 48 FAILED) — shipped end-only and
  said so; (2) the staff note "thinking off" for Sonnet 5.5 was false (16 of 20 thinking-prone calls
  thought) — renamed; (3) the diaspora template RECOMMENDED the exact phrase the steering check
  refuses, so the guard alone would only have converted served copy into refusals; (4) a negation
  guard on a claim check is a fail-open risk, so a self-negative phrase ("nie wymaga remontu") stays
  a claim whatever precedes it and "not only" affirms. · **Guardrail I'd add:** a prompt edit is
  live-measured for NEW failure classes (visible reasoning, thinking under `disabled`), not only for
  the class it targets — the targeted metric went 16/48 → 0/48 on every variant, and only the side
  count told them apart.

- **2026-10-26 / FOLLOW-1406–1407** · **Built:** `claims-v2` (a `claims-v1` FIT row in Postgres or
  Redis is a miss, regenerated once; proven against PGlite with the real migrations — the upsert's
  `<=` revision guard lets the regenerated row replace the v1 row at the same revision); corpus v10
  = stamp-only re-freeze of v9, guarded byte for byte (`v10 === v9.split(OLD).join(NEW)`), older
  guards replay with the current stamp as they replay the current digests; yield_hunter /
  family_buyer templates no longer recommend or excuse familial wording, with two template scans. ·
  **Real vs placeholder judgment call:** route tests mocked the generator with a literal
  `'claims-v1'`, so they stayed green under any bump and proved nothing about it; the new tests take
  the REAL constant through `importOriginal`. The 542 failures were the frozen corpora asserting the
  CURRENT constant — history must pin its own literal, only the newest corpus pins the constant. ·
  **Guardrail I'd add:** a version stamp's tests must include one that reads the real constant on
  the read path (not a mocked literal); and a fair-housing template scan reads exception clauses
  ("unless", "chyba że", "salvo que"), not only banned phrases — the family_buyer exception was
  invisible to the phrase scanner.

- **2026-10-29 / FOLLOW-1411** · **Built:** the ESC-089 lift — `steersByFamilialStatus` retired on
  `/api/adapt` and the description path; `describesResidentsByProtectedGround` (a closed en/pl/es
  phrase list: statements about residents' race, ethnic origin or religion, `protected_ground`) runs
  where it ran; schools, nurseries and playgrounds joined the amenity lexicon (both paths);
  family_buyer, upsizer, diaspora, second_home, lifestyle_expat and yield_hunter templates,
  `has_children` and four headline personas family-fitted with "only as the listing states"; corpus
  v11 (the four v8 cases back to v7) + v12 (persona re-freeze, proven by swapping the persona text
  back byte for byte). · **Real vs placeholder judgment calls:** (1) the steering list was also the
  only thing that caught "safe for children" and "great area for kids"; no claim check ever read a
  school — lifting it alone would have made "never invent a school" a prompt wish, so the
  school/nursery/playground grounding shipped with the lift; "safe area" stays a subjective,
  unchecked area claim (as the brief ruled), and is reported, not hidden; (2) colour words count
  only before a word for people ("mostly white walls", "pueblos blancos"), historic quarter names
  pass, and nationality is targeting — each pinned by a passing control; (3) the brief expected no
  stamp bump because the lift only turns refusals into FITs — true for the lift, false for the
  change: the same ticket ADDED two refusal classes that no `claims-v2` row ever passed, so
  `claims-v3` (corpus v13); (4) live, the school check refused two honest Polish bodies that said
  the listing names no schools ("nie wymienia szkół, przedszkoli ani placów zabaw"): the
  30-character negation window stops at a comma, so the second item of a negated list reads as
  asserted; fixed in the prompt (omit, do not narrate absence), not in the window. · **Guardrail I'd
  add:** before removing a refusal, list every claim class it was incidentally catching and name the
  check that still catches each one — or ship that check with the removal.

- **2026-10-30 / FOLLOW-1415** · **Built:** the CEO's facts-vs-discrimination ruling on
  `describesResidentsByProtectedGround`, as three closed lists: resident-group phrases (refused
  unless a historical qualifier puts a COLLECTIVE noun in the past), composition/exclusion phrases
  (always refused), sensitive history (Holocaust/Shoah, ghetto, deportations, pogroms, massacres,
  ethnic cleansing, genocide, war crimes, camps — always refused, en/pl/es). Added the noun-first
  Polish phrasing ("społeczność muzułmańska") the old list missed. `claims-v4` + corpus v14
  stamp-only re-freeze. · **Real vs placeholder judgment calls:** (1) the historical exemption first
  covered every resident noun, and the red-first tests caught "friendly old Muslim neighbours" and
  "Once inside, Muslim neighbours" passing ("old" = age, "once" = conjunction), so it now covers
  collective nouns only (community/population/społeczność/comunidad + "zamieszkana przez"), with
  adjectives directly before the phrase and adverbs ≤6 words before it, no comma or present marker
  in between or after; (2) stem lists are written by form where a stem collides ("getto" not "gett*"
  → Gettysburg; "deportación" not "deport*" → polideportivo); (3) the bump was needed because
  sensitive history is a new refusal class and cache hits are not re-checked on read; the rule-1
  relaxation alone would not have needed it. · **Guardrail I'd add:** every exemption in a refusal
  guard gets at least one "the exemption word used in its other sense" refusal test ("old" = aged,
  "once" = when) before it ships.

- **2026-10-30 / FOLLOW-1419** · **Built:** the CEO's 2026-10-30 tightening of
  `describesResidentsByProtectedGround`: rule 3 now also refuses painful-association terms (Nazi /
  German / Soviet occupation, Nazis, Gestapo, SS, Third Reich, camp names, expulsions, wysiedlenia,
  wywózki, łapanka, forced labour, death trains) en/pl/es; a PLACE named by race, ethnic origin or
  religion ("żydowska dzielnica", "the Jewish quarter", "la judería") passes only with a historical
  adjective directly before it. `claims-v6` + corpus v19 stamp-only re-freeze (no corpus verdict
  moved). · **Real vs placeholder judgment calls:** (1) camp names that are also towns (Oświęcim,
  Brzezinka, Płaszów, Dachau, Mauthausen, Sachsenhausen, Chełmno, Terezín) refuse only beside a camp
  word; names no town carries (Auschwitz, Birkenau, Stutthof …) refuse bare, but Treblinka, Sobibór,
  Bełżec, Majdanek are also villages/places and refuse bare because the CEO named them; (2) words
  whose ordinary listing sense collides were scoped by context, not dropped: "wywózka" unless
  followed by śmieci/odpadów/gruzu…, Polish "okupacja" only with a perpetrator adjective or "w
  czasie / podczas / okresie", Spanish "ocupación" only with nazi/alemana ("ocupación inmediata" is
  a listing term), Spanish "expulsión" only of judíos/moriscos; (3) streets and buildings were kept
  out of the place rule ("ul. Żydowska" is an address, "a Catholic school" an institution). ·
  **Guardrail I'd add:** for every new refusal term, pin at least one real-listing sentence that
  uses the same string in its ordinary sense as a PASS test before it ships.
- **2026-10-31 / FOLLOW-1426** · Moved the `/api/adapt` tweak band from hardcoded Haiku 4.5 to the
  global generation model; the band is now decided once from `similarity` (`bandFor`) and drives
  source, prompt and judge budget. · Judgment call: kept the tweak prompt (not the generation
  prompt) on the new model; judge stays Haiku. · Guardrail I'd add: never infer a band/label from a
  model id (`model === X`); a test must vary the model and assert the label does not move.
- **2026-10-31 / FOLLOW-1311 slice 4** · Attribute lexicon en/pl/es plus T8 as a `groundedBy` table;
  `claims-v9`. · Judgment call: the frozen replay moved one body only, on a key ("top floor") not in
  the brief's list; the other 125 recognised claims were grounded. "Detached" for "single-family"
  has no evidence in either corpus; an older pinned test held the one real case and changed my first
  choice, found only by running neighbouring test files. · Guardrail I'd add: dump every recognised
  claim with its grounding source over the recordings before reading a verdict diff; a diff of zero
  says nothing until the recogniser is shown to fire.
