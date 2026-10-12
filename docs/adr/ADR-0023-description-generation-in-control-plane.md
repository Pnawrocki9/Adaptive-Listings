# ADR-0023 — One LLM runtime: description generation, the fact check and claim containment move into the control plane

**Status:** **ACCEPTED** — CEO (Piotr Nawrocki), 2026-10-12 (proposed the same day) · **Author:**
architect · **Decision of record:** CEO ruling D5, 2026-09-24
(`docs/PLAN-AUDIT-REMEDIATION-2026-09-24.md` §A, package WP-2.11) · **Supersedes:** ADR-0016 (on
acceptance) · **Implemented by:** FOLLOW-1297 (two PRs, see §5) · **References:** ADR-0009,
ADR-0010, ADR-0016, ADR-0022, ESC-076 (§E.7.0), ESC-083, FOLLOW-1291, FOLLOW-1290, FOLLOW-1305,
FOLLOW-1312, FOLLOW-1313, CONVENTIONS_PATCH Rule Z

---

## 1. Context

**D5 (CEO, 2026-09-24):** "One LLM runtime: move description generation from Modal (Python) to the
control plane (TS, `after()`) and have one fact check, one spend limit? — **Yes, as the LAST Phase 2
package, through ADR-0023 and parity tests (Rule Z).** Supersedes ADR-0016." The named alternative
(keep two runtimes, align the checkers by a parity test) was considered and not chosen.

**What ADR-0016 built.** On a cache miss `GET /api/adapt/description` POSTs a
`DescriptionRequestedEvent` to `MODAL_DESCRIPTION_URL` (`description/route.ts:147`, dispatched in
`afterResponse()` at `:559`); the Modal app `estalara-description-generator`
(`apps/llm-gateway/src/jobs/generate_description.py`) calls Sonnet, runs the fact check, writes
Upstash Redis directly and the durable Postgres row through the callback
`POST /api/internal/description-cache`, which also writes the ClickHouse `description_generations`
audit row. The activation embed-seed overflow takes the same road (`MODAL_EMBED_SEED_URL`,
`lib/listing-embed-seed-publisher.ts`).

**Why two runtimes are a hallucination-containment risk.** The anti-hallucination path exists twice,
in two languages, maintained by hand:

| concern                     | Python (`generate_description.py`)                     | TypeScript (control plane)                         |
| --------------------------- | ------------------------------------------------------ | -------------------------------------------------- |
| digit rule                  | `_check_numbers`, `_canon_number` (regex `IGNORECASE`) | `checkDirectiveFacts`, `canonNumber` (no `i` flag) |
| proper names / inflection   | `_check_headline_facts`, `_stem_loose`                 | `checkDirectiveFacts` (MP-012 segment exemption)   |
| claim classes (FOLLOW-1305) | `_check_unsupported_claims`, `_check_body_claims`      | `claim-containment.ts` `checkUnsupportedClaims`    |
| stamp                       | `CLAIMS_VALIDATION_VERSION = "claims-v1"`              | same constant, a test reads the Python line        |
| spend cap                   | rolling-24h `sum(cost_usd)` scan of `llm_calls`        | UTC-day Upstash counter (FOLLOW-1290)              |

FOLLOW-1305 had to ship the same containment twice (#974), with "same patterns, same codes, same
corpus in both test suites" enforced only by comments and a hand-copied corpus. The two spend caps
are no longer the same cap: Python never increments the `llm:spend:<day>` counter FOLLOW-1290
introduced, so description spend is invisible to the gate `/api/adapt` reads. Every future fix
(FOLLOW-1311, the typed claim contract, is planned "once, in TypeScript, after FOLLOW-1297") would
otherwise be a two-language change.

## 2. Decision

Description generation, its fact check and its claim containment run **in the control plane**, in
`after()` of the request that missed the cache. `apps/llm-gateway` is deleted.

- **`apps/control-plane/src/lib/grounding-check.ts`** — the one description-path checker, pure (no
  I/O): digit rule, headline facts, body facts, body claims, contract (leak) check, `canonNumber`,
  `stemLoose`. Its behaviour is the Python job's behaviour, proven by the parity corpus (§4).
- **`apps/control-plane/src/lib/description-generator.ts`** — model resolution, prompt rendering
  (the v1.9 system prompt, `_ARCHETYPE_GUIDANCE`, the headline prompt, byte-identical), the
  Anthropic calls, the verdict parser, the spend gate (`llm-spend-counter.ts`), `llm_calls` rows
  (through `llm-calls-register.ts`), and both cache writes (PG through `publishPgCachedDescription`,
  the FOLLOW-1291 revision-fenced UPSERT, migration 0041; Redis through `setCachedDescription`).
- **`description/route.ts`** calls `generateDescription(event)` in `afterResponse()` where it calls
  `publishDescriptionRequested(event)` today. Everything before the dispatch (auth, model
  precedence, PG → revision fence → Redis lookup, legacy admission, empty-original refusal) is
  unchanged.
- **Embed seed:** the overflow beyond `MAX_INLINE_SEED` is requeued to a control-plane internal
  route instead of Modal (§6, G-06). Embedding already goes through `lib/openai-client.ts`
  (`api/listings/embed/route.ts:189`); the Modal job never embedded, it only looped over that route.
- **Scope boundary — no /api/adapt change.** `checkDirectiveFacts` and `claim-containment.ts` keep
  their current semantics on `/api/adapt`. `grounding-check.ts` may import a TS primitive only where
  the parity corpus AND the existing `/api/adapt` tests both stay green unchanged; otherwise it
  carries the Python semantics itself. Unifying the two predicates is a later, measured change.

## 3. Signature

Pure checker (`lib/grounding-check.ts`); `listingContext` is `Record<string, string>` exactly as
`DescriptionRequestedEventSchema.listing_context` types it:

```ts
export type NumberViolation = 'hallucinated_number';
export type FactViolation = NumberViolation | 'hallucinated_proper_name';
export type ClaimViolation = 'unsupported_amenity' | 'unsupported_guarantee' | 'unit_mismatch'; // = claim-containment.ts
export type ContractViolation = 'residual_tag' | 'formatted_body' | 'leak_marker';

export function canonNumber(token: string): string; // _canon_number
export function stemLoose(word: string): string; // _stem_loose
export function checkNumbers(text: string, grounding: string): NumberViolation | null; // _check_numbers
export function checkBodyFacts(
  body: string,
  original: string,
  ctx: Record<string, string>,
): NumberViolation | null;
export function checkBodyClaims(
  body: string,
  original: string,
  ctx: Record<string, string>,
): NumberViolation | ClaimViolation | null;
export function checkHeadlineFacts(
  headline: string,
  original: string,
  ctx: Record<string, string>,
): FactViolation | ClaimViolation | null;
export function bodyViolatesContract(body: string): ContractViolation | null; // _body_violates_contract
```

Generator (`lib/description-generator.ts`). The pure halves are exported so the parity test drives
them with recorded model output and no network:

```ts
export const CLAIMS_VALIDATION_VERSION = 'claims-v1'; // single definition; claim-containment.ts re-exports it

export function resolveGenerationModel(
  override?: string,
  generation?: string,
): AllowedGenerationModel;
export function renderDescriptionPrompt(
  e: DescriptionRequestedEvent,
  model: AllowedGenerationModel,
): { system: string; user: string; maxTokens: number }; // _max_tokens_for: 450..2000
export function renderHeadlinePrompt(e: DescriptionRequestedEvent): {
  system: string;
  user: string;
  maxTokens: 60;
};

export type DescriptionOutcome =
  | { verdict: 'SKIPPED'; reason: 'spend_cap' }
  | {
      verdict: 'FAILED';
      reason: 'empty' | ContractViolation | 'truncated' | 'timeout' | 'api_error';
    }
  | { verdict: 'NEUTRAL'; neutralReason: string | null }
  | { verdict: 'REFUSED'; violation: NumberViolation | ClaimViolation }
  | { verdict: 'FIT'; description: string; verifiedFacts: string[] };

export function interpretDescription(
  raw: { text: string; stopReason: string | null },
  e: DescriptionRequestedEvent,
): Exclude<DescriptionOutcome, { verdict: 'SKIPPED' } | { reason: 'timeout' | 'api_error' }>;
export function interpretHeadline(
  rawText: string,
  e: DescriptionRequestedEvent,
): { headline: string | null; violation: FactViolation | ClaimViolation | 'empty' | null };

export interface GenerationReport {
  outcome: DescriptionOutcome;
  headline: string | null; // null unless outcome FIT and the headline passed
  claimsValidation: typeof CLAIMS_VALIDATION_VERSION | null; // set iff outcome FIT
  writes: {
    pg: 'published' | 'stale' | 'not_configured' | 'failed' | 'skipped';
    redis: 'written' | 'not_configured' | 'failed' | 'skipped';
    audit: 'written' | 'not_configured' | 'failed' | 'skipped'; // description_generations
  };
}
/** Never throws. Validates `e` with DescriptionRequestedEventSchema first (invalid → FAILED, no I/O). */
export async function generateDescription(e: DescriptionRequestedEvent): Promise<GenerationReport>;
```

**Order of operations (ported verbatim from `generate_description()`):** spend gate → description
call → `parseAdaptationVerdict` (missing tag ⇒ FIT, ADR-0010) → `parseVerifiedFacts` →
`bodyViolatesContract` → truncation (`stop_reason === 'max_tokens'` or a surviving
`<verified_facts_used`) → `checkBodyClaims` → (FIT only) headline call → `checkHeadlineFacts`.
NEUTRAL writes the negative-cache marker to both caches; REFUSED, FAILED and SKIPPED write no cache.

**Byte-identical outputs (these are contracts other code and queries read):**

- `llm_calls.source` values on this path are exactly `description`, `headline`,
  `description_claim_refused` — no new value is introduced by the port (a timeout or API error
  writes no generation row, as today; it is captured to Sentry `area: 'description'`,
  `kind: 'description_generation_failed'`). `session_id` = `listing_id || 'desc'`; `latency_ms` =
  the Anthropic call's wall time; the refusal row has zero tokens, cost and latency.
- `cost_usd` comes from `computeCost` in `llm-gateway.ts`, which today prices only
  `claude-haiku-4-5` and `claude-sonnet-4-6`. Before the port merges, every id in
  `ALLOWED_GENERATION_MODELS` gets an explicit price no lower than the Python rate it replaces
  (Haiku 0.00025/0.00125, Sonnet 0.003/0.015, Opus ≥ the Sonnet rate Python bills it at today), with
  a test. Otherwise `claude-opus-4-8` would be under-billed against the cap.
- Redis value: `{text, headline, generated_at, verified_facts_used}` plus `verdict` only on NEUTRAL
  and `claims_validation` only on FIT. Absent keys are **omitted, never `null`**:
  `DescriptionCacheValue.claims_validation` is `z.string().optional()`, and the PG side's
  `claimsValidation: string | null` maps `null` ↔ omitted. `headline` is `string | null` on both.
- `description_generations` row: `source: 'modal_generation'` is kept as-is, because consumers query
  it. `writeDescriptionGenerationAudit` moves from the callback route into a lib both callers use.

## 4. Parity rule (Rule Z)

**Corpus.** A frozen corpus of **≥ 50 cases** is produced from the Python job **after FOLLOW-1305
(#974) and FOLLOW-1312 (#977) are on `main`**, so the port inherits the corrected checker and not
the pre-containment one. FOLLOW-1312 did not change the Python. Description refusal stays
whole-body; per-slot refusal is an `/api/adapt` property. Each case is
`{input: DescriptionRequestedEvent, raw_description: {text, stop_reason}, raw_headline: string | null}`
→ expected
`{prompt_sha256: {system, user}, outcome, headline, headline_violation, claims_validation}`.
Composition (minimums): ≥ 30 raw outputs recorded from live Sonnet calls on real fixture listings
(mostly FIT); all negative and positive cases of the FOLLOW-1305 hand corpus, each wrapped as a raw
model output; ≥ 3 NEUTRAL (with and without `<neutral_reason>`); ≥ 5 FAILED covering `empty`, each
`ContractViolation`, and `truncated` by both tells; ≥ 1 missing-verdict-tag FIT; ≥ 1 REFUSED per
violation code; ≥ 5 suppressed headlines. Production inputs carry `listing_context = {}` today
(`retrieveListingContext` is called with `intentVector = null`, `rag-retrieval.ts:44`), so ≥ 10
cases carry a **synthetic non-empty** context, including non-ASCII values and area keys.

**Production and location.** `scripts/parity/freeze-description-corpus.py` (outside
`apps/llm-gateway/**`, so it does not trigger `modal-deploy.yml`) imports the job module, replays
each recorded raw text through `_generate_with_sonnet` / `_generate_headline` with the Anthropic
client stubbed, and computes the expected values by calling the job's own functions. It writes
`apps/control-plane/src/lib/__fixtures__/description-parity/corpus.v1.jsonl` and `MANIFEST.json`
(git SHA of `generate_description.py`, `CLAIMS_VALIDATION_VERSION`, case count, per-verdict counts,
the generator's sha256). The corpus is committed in PR A and **never regenerated**. The generator is
deleted with `apps/llm-gateway` in PR B. After that the fixture is the only record of the Python
behaviour.

**"Identical" means**, for every case: `outcome.verdict`; its reason code (`reason`, `violation`,
`neutralReason`); `description` and `verifiedFacts` (FIT); `headline` (string or `null`) and
`headline_violation`; the `claims_validation` stamp; and the sha256 of both rendered prompts. 100 %
or the PR does not merge. **No divergence allowance:** a Python defect is ported faithfully and
listed here, and fixing it is a later change that re-freezes the corpus as `corpus.v2`. Known
porting hazards the corpus must pin:

1. **`json.dumps` is `ensure_ascii=True`** in both the prompt (`indent=2`) and the grounding text
   (`_check_body_facts` / `_check_headline_facts`). Escapes like `é` put hex digits into the
   grounding's digit set (by reading: an `é` in a context value grounds a hallucinated `9`), and a
   non-ASCII proper name present only in `listing_context` is not found. Port as a `pythonJsonDumps`
   helper. This is a **latent fail-open** (inert while `listing_context` is `{}`), carried to
   FOLLOW-1311. The corpus must contain the `é`/`9` case. If Python does not admit it, delete this
   item.
2. The Python digit regex is case-insensitive; the TS `/api/adapt` one is not.
3. Python `\w` / `\b` / `str.isupper()` are Unicode-aware. Map them to `[\p{L}\p{N}_]` lookarounds
   and `\p{Lu}`, never to ASCII classes.
4. Headline cut `[:120]` counts **code points** (`Array.from`), and `.strip()` uses Python's
   whitespace set.
5. `_claim_grounding` = `original_description` + positive fields as `key: value`. That is not the TS
   `buildClaimGrounding`, which takes fields only.

## 5. Rollback and cutover sequence

FOLLOW-1297 ships as **two PRs** because a single deleting PR would leave no rollback switch.

1. **ADR-0023 ACCEPTED** (CEO). FOLLOW-1297 does not open before this.
2. **PR A: port, behind the existing switch.** Adds §2–§4 and the G-02/G-03/G-06 fixes. The route
   selects by the env var: `MODAL_DESCRIPTION_URL` set → today's Modal dispatch, unchanged; unset →
   `generateDescription` in `after()`. `MODAL_EMBED_SEED_URL` works the same way for the seed
   overflow. PR A touches nothing under `apps/llm-gateway/**` or the `modal-deploy.yml` paths, so
   **its merge triggers no Modal deploy**. Prod still has both URLs set → prod is unchanged.
   Localhost has neither → **localhost runs the ported path from the first boot.**
3. **Localhost evidence:** FOLLOW-819 ×3 GREEN in a row on PR A's merge commit, one un-restarted
   control plane, with the evidence lines of §8.
4. **Prod cutover (operator, scheduled by the PM under the localhost-first ruling. A merge does not
   imply it):** remove `MODAL_DESCRIPTION_URL` and `MODAL_EMBED_SEED_URL` from Vercel production and
   preview, then redeploy. Verify: `adapt-llm-source-smoke.yml` green; prod `llm_calls` rows
   `source = 'description'` appear; the p95 gate of §8 holds. **Rollback at any point in steps
   3–5:** put the two env vars back and redeploy Vercel. During this window these stay deployable
   and untouched: the deployed `estalara-description-generator`, its source and `deploy-llm-gateway`
   job, `Test (Python) (3.12, llm-gateway)`, the callback route `/api/internal/description-cache`,
   `publishDescriptionRequested`, `listing-embed-seed-publisher.ts`.
5. **PR B: deletion**, only after 3 and 4 are green. Deletes `apps/llm-gateway/`, the two Modal
   dispatch branches and publishers, the callback route, the corpus generator, the cross-runtime
   fixtures, and edits the gates of §7 **in the same PR**. Its merge **does** trigger
   `modal-deploy.yml`: the workflow file and `scripts/check-modal-*.py` are in its `paths`. The
   `deploy-llm-gateway` job is gone by then, so the run redeploys the unchanged `intent-engine` and
   re-runs its container-effect probe. It does not touch the deployed description app. After PR B,
   rollback means `git revert` of PR B (its merge redeploys llm-gateway through the restored job)
   plus the env vars back.
6. **Operator:** `modal app stop estalara-description-generator` once FOLLOW-819 ×1 is GREEN on PR
   B's merge commit. That is never before the ×3 of step 3. Residue: llm-gateway-only keys in the
   Modal `estalara-secrets` bundle. If `LLM_DAILY_SPEND_CAP_USD` was set there, its value is lost,
   because the TS cap is the constant `DAILY_SPEND_CAP_USD = 100`. The operator checks before
   step 4.

## 6. Folded gap candidates (FOLLOW-1297 amendment, 2026-10-11)

- **G-02: the Redis failure is isolated from the durable write.** Python writes Redis first and
  `raise_for_status()` (`generate_description.py:2306–2315`) aborts the job before the PG callback
  (`:675`), so a Redis 5xx loses the durable row. Port: **PG first** (`publishPgCachedDescription`,
  the durable truth), then Redis, each in its own `try`, each reported in `GenerationReport.writes`.
  Redis is skipped when PG returned `'stale'`, because a stale-revision key is never read. Redis is
  still attempted when PG `'failed'`, so the read path's Redis → PG backfill gets a second chance. A
  configured-but-failed write is logged and captured (Rule K.2). Test: Redis 500 →
  `pg: 'published'`, `redis: 'failed'`.
- **G-03: explicit Anthropic budget; an unavailable cap is observable; fail-open kept.** Python
  relies on the SDK defaults (per-attempt timeout, 2 retries) bounded only by Modal `timeout=120`
  (`:460`). Port, on the FOLLOW-1040 pattern (an `AbortController` deadline on the **total**,
  because SDK `timeout` bounds one attempt): description 75 s total with `maxRetries: 1`; headline
  20 s total with `maxRetries: 1`; `description/route.ts` sets `export const maxDuration = 120` (=
  the Modal budget) because `after()` work counts against it. Hitting the deadline gives
  `FAILED/timeout`, no cache write and a Sentry capture. The spend gate is `getDailySpend()` ≥
  `DAILY_SPEND_CAP_USD` (exported, single constant), with Sentry `kind: 'spend_cap'`,
  `area: 'description'` as in Python. `llm-spend-counter.ts` additionally captures **once per
  instance** when Redis is unconfigured and `VERCEL_ENV === 'production'`
  (`kind: 'spend_counter_unconfigured'`). Today that state is silent. The read still fails open.
- **G-06: checkpoint/requeue and bounded concurrency for the embed seed.** The inline loop
  (`seed-listing-embeddings.ts:476`) is serial, and the overflow goes to Modal in one shot (`:472`).
  Port: inline batch with concurrency 4 under a wall-clock budget. The not-yet-processed remainder
  is the checkpoint. It is POSTed to a new `POST /api/internal/listings/embed-seed`
  (`INTERNAL_API_SECRET`, body = the existing `ListingEmbedSeedRequestedEventSchema`, plus an
  additive optional `requeue_depth` int bounded at 20), which runs the same loop in its own
  `after()` and requeues what is left. A listing that failed is retried once on the next hop, then
  reported with its id. Each hop returns `{succeeded, failed: string[], remaining, requeued}`. The
  embed endpoint is an idempotent upsert, so a duplicated hop is safe. The `requeue_depth` field
  needs its schema test (≥ 5 cases), an `INTERFACES.md` line and an example, in PR A.
- **G-10: one frozen Python resolution for CI and Modal images.** For `llm-gateway` this becomes
  moot in PR B (deleted). It is **not** moot for `intent-engine`, which stays on Modal, or for
  `data-quality`, whose `Test (Python)` row stays. PR B pins each remaining Python app to one lock
  file that both its `Test (Python)` install and its Modal image build consume. PR B already edits
  those files.

## 7. Gates to edit in PR B (same PR, per the `required-checks.txt` rule)

| file                                                                                                                                | edit                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.github/required-checks.txt`                                                                                                       | delete `Test (Python) (3.12, llm-gateway)`, `Modal App singleton guard (FOLLOW-438)`, `Cross-language event contract`; rename the presence-only row to `any-state Assert intent-engine container reaches its own logic (prod)` |
| `.github/workflows/ci.yml`                                                                                                          | `Test (Python)` matrix drops `llm-gateway`; delete `modal-app-singleton-guard` (its only subject is gone) and `cross-language-contract` (no Python consumer of either event remains)                                           |
| `.github/workflows/modal-deploy.yml`                                                                                                | delete `deploy-llm-gateway`; drop `apps/llm-gateway/**` from `paths`                                                                                                                                                           |
| `.github/workflows/cron-heartbeat.yml`                                                                                              | container probe → intent-engine only; job renamed to match the register                                                                                                                                                        |
| `scripts/check-modal-local-imports.py`                                                                                              | REGISTRY drops `apps/llm-gateway/src/main.py`; the `--app llm-gateway` workflow-evidence tuple goes; self-test literals reviewed                                                                                               |
| `scripts/check-modal-container-effect.py`, `check-modal-app-singleton.sh`                                                           | drop the `llm-gateway` app / delete the script                                                                                                                                                                                 |
| `scripts/mirror-files.json`, `scripts/baselines/sentry-init-mirror-exclusions.baseline`, `scripts/check-sentry-capture-has-init.sh` | drop the llm-gateway members                                                                                                                                                                                                   |
| `tests/integration/archetype-id-parity.test.ts`, `claim-containment.test.ts`                                                        | retarget from the Python source lines to the TS constants                                                                                                                                                                      |

Run the PR-checks verifier **from PR B's worktree**, because the register is read from the checkout.

## 8. Consequences

**Positive.** One checker, one prompt, one spend counter, in one language. FOLLOW-1311 and any
lexicon change become single-file changes. Description spend now increments the counter the
`/api/adapt` gate reads (it did not since FOLLOW-1290). Modal cold start and one network hop leave
the generation path. One Modal app, one deploy job and three gates go away.

**Local evidence (consequence, and required in PR A).** Until now the FOLLOW-819 series never
exercised generation. Localhost has no `MODAL_DESCRIPTION_URL`, so every miss logged "skipping Modal
dispatch". Even after FOLLOW-1313 (#986) set `DATABASE_URL`, no PG row was written. After PR A the
miss is an in-process call, so **the series will generate, spend and write.** Each of the ×3 runs
must report: local ClickHouse `llm_calls` rows for the fixture listing (`session_id = <listing_id>`)
with `source IN ('description','headline','description_claim_refused')`, ≥ 1 per run; the
`description_cache_persistent` row-count delta (≥ 1 on FIT or NEUTRAL, 0 with a refusal row on
REFUSED); the `GenerationReport.writes` log line. The `[pg_cache_off]` preflight
(`scripts/dev/localhost-up.sh` step 11b) stays. If a FOLLOW-819 AC implicitly assumed
`template_fallback`, it now surfaces as a harness finding, because the description slot can turn
`ai_cached` on a later run.

**Cost and latency.** `llm_calls` is the measure. MP-010, MP-012 and MP-017 define the adapt-path
`llm_calls` signals (`source`, `tokens_in`). None of them pins description latency. Before step 4,
the PM records a new MEASURED_PREMISES entry: prod
`quantile(0.95)(latency_ms) FROM llm_calls WHERE source = 'description'` over the 14 days before
cutover. Gate: the same quantile over ≥ 30 post-cutover rows ≤ the baseline. With fewer rows the
result is UNMEASURED, not green. `latency_ms` is the model call in both runtimes, so this guards the
timeout/retry configuration and is blind to end-to-end time to `ai_cached`. Anthropic spend is
unchanged per call. Vercel adds function time for up to ~95 s of awaited I/O per generation, and the
Modal compute disappears.

**Negative and risks.** Generation now shares the control plane's function concurrency. A
`maxDuration` kill drops the work silently except for the missing row. That is the same
non-durability class ADR-0016 accepted, and there is still no durable queue. The anti-hallucination
path changes runtime. The parity corpus is the control for that. It is bounded by its cases, so the
corpus composition is part of the contract.

**Unchanged.** `intent-engine` stays on Modal (chat path, ADR-0016's ingest → Modal leg, ADR-0022).
ESC-076 / §E.7.0 stay as they are: grounding is the listing's own text. Per-slot refusal on
`/api/adapt` (FOLLOW-1312) and whole-body refusal on descriptions stay. So do the revision fence,
legacy admission, the NEUTRAL negative cache and the wire `DescriptionResponse`. No migration and no
new vendor or secret are needed: `ANTHROPIC_API_KEY` and Upstash are already in the control plane's
env.

**Reversibility.** High until PR B (an env var). Medium after PR B (a revert plus a redeploy).

**Docs owed by FOLLOW-1297:** MASTER_DESIGN §A.1, §E.7.4–E.7.6, the Snapshot.1 llm-gateway rows (PR
B), `docs/INTERFACES.md` (description event becomes in-process; seed route), Modal runbooks.

## 9. Supersession and related ADRs

| ADR      | effect                                                                                                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-0016 | **Superseded by ADR-0023** for both flows it covered (description, embed seed). Its Redpanda-removal context is history; its out-of-scope items were closed by ADR-0022.                       |
| ADR-0010 | Unaffected in substance: FIT/NEUTRAL, missing tag ⇒ FIT, and the NEUTRAL negative cache are ported verbatim. Only the location moves (`_parse_adaptation_verdict` → `parseAdaptationVerdict`). |
| ADR-0009 | Unaffected. The per-listing headline moves runtime. It is still grounded on listing fields (FOLLOW-1305) and suppressed on violation.                                                          |
| ADR-0005 | Its llm-gateway Modal app ceases to exist after PR B. The principle "intelligence in TS" is extended, not reversed. No status change.                                                          |
| ADR-0022 | Unaffected.                                                                                                                                                                                    |

## 10. Alternatives considered

- **Keep two runtimes and align them with a parity test (the D5 alternative).** It is cheaper and
  avoids touching the anti-hallucination path. Rejected by the ruling: it keeps two checkers, two
  spend caps and every future fix in two languages, and parity tests alone did not prevent the
  FOLLOW-1290 cap split.
- **Keep generation in Python but move the check into the TS callback (validate before
  `publishPgCachedDescription`).** One checker without a generation port. Rejected: the Redis write
  and the spend cap stay in Python, so it is still two runtimes and two caps, and the check would
  run after the model output has already crossed a network boundary.
- **Durable queue (Upstash QStash) between route and generator.** It fixes the non-durability that
  both ADR-0016 and this ADR accept. Deferred: it adds a vendor, which needs its own escalation, and
  the revision fence plus regenerate-on-miss already make a lost job self-healing on the next
  request.

## References

`docs/PLAN-AUDIT-REMEDIATION-2026-09-24.md` §A D5, WP-2.11 · `backlog/FOLLOW_UPS.md` FOLLOW-1297 and
its 2026-10-11 amendment · `apps/llm-gateway/src/jobs/generate_description.py` ·
`apps/control-plane/src/app/api/adapt/description/route.ts` · `lib/description-pg-cache.ts` ·
`lib/description-cache.ts` · `lib/claim-containment.ts` · `lib/llm-gateway.ts` ·
`lib/llm-calls-register.ts` · `lib/llm-spend-counter.ts` · `lib/seed-listing-embeddings.ts` ·
`app/api/internal/description-cache/route.ts` · `packages/shared/src/schemas/description.ts`,
`listing-embed-seed.ts` · `packages/db/migrations/0040_*`, `0041_*` ·
`docs/ops/MEASURED_PREMISES.md` MP-010/012/017 · CONVENTIONS_PATCH Rule Z
