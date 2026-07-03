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
