# Backend Engineer — Lessons Log

---

## 2026-06-02 / DEMO-001

**What I built:** Per-tenant DEMO MODE archetype + model override. New `demo_overrides` table
(migration 0017), `GET/PUT /api/demo/override` (JWT-gated, Zod-validated), override wired into
`POST /api/adapt` (replaces `archetype_hint` with chosen archetype at high confidence), description
endpoint keyed cache by model to bust on model switch, `forceModel` param added to `callLlmGateway`,
admin UI at `/dashboard/demo/override` with toggle + dropdowns.

**Wiring/auth/fail-loud risks I weighed:**

1. **Rule K.2 on the adapt route:** When `getDemoOverride` throws (configured DB, connection
   refused), I degrade to the SDK hint rather than failing the response — this is correct because
   the adapt endpoint is decision-grade but the override is an _additional_ operator intent layer.
   The degradation is logged loudly and `demo_override` flag is absent from response, making
   provenance observable on the wire.

2. **Rule K.2 on the description route:** Same fail-open treatment — if the DB throws when checking
   DEMO MODE for the description cache key, we use the standard key. This is the right call: the
   worst outcome is a cache miss, not wrong data.

3. **Rule H for the `override_model` event field:** Added `override_model?: string` to
   `DescriptionRequestedEvent` in `@estalara/shared`. Non-test consumer is the description route
   itself (it writes the field to the Redpanda event). ML-engineer consuming it in the Modal job is
   FOLLOW-166 (explicitly deferred with stub).

4. **Auth on the PUT endpoint:** `requireTenantAccess(req, 'agency:admin')` using verified JWT,
   tenant_id taken from JWT claims (never from request body), same commit as the endpoint. Satisfies
   Rule H auth-in-same-PR.

5. **The double `getDemoOverride` call in the adapt route:** I called it twice in the treatment arm
   (once to check enabled, once to get the archetype). Flagged as a risk but acceptable given the DB
   call is fast + the alternative (threading the whole state across try/catch blocks) was harder to
   reason about. A refactor to call it once would reduce DB load.

**A guardrail I'd add:** The adapt route should propagate `demo_override` through to the Redpanda
`ab.assignment` event so the data-engineer can also exclude demo traffic at the event level, not
just at the ClickHouse analytics query level.

---

## 2026-06-03 / FOLLOW-161

**What I built:** Global admin-selectable LLM generation model. New `app_config` global key-value
table (migration 0018), `getGlobalGenerationModel()`/`setGlobalGenerationModel()` helpers,
`GET/PUT /api/admin/generation-model` (agency:admin JWT), `/dashboard/settings` page with model
picker + cost/latency hints table, wired `llm-gateway.ts` full-generation path to use global model
(Haiku tweak path stays Haiku), `description/route.ts` threads `generation_model` into event
payload + keys standard cache by active model, `_resolve_generation_model()` extended with
`generation_model` param in Python job.

**Wiring/auth/fail-loud risks I weighed:**

1. **Precedence chain integrity:** DEMO override_model > global generation_model > default. Verified
   in both TypeScript (description route builds the event, llm-gateway uses forceModel first) and
   Python (\_resolve_generation_model now takes both params, override_model wins if allow-listed).
   End-to-end tests cover all 3 priority levels.

2. **Rule K.2 on global config read:** `getGlobalGenerationModel()` distinguishes "DB not
   configured" (returns default — OK for dev/CI) from "DB configured but threw" (throws, forces
   caller to decide). The description route catches-and-defaults on the throw, keeping the endpoint
   fail-open for non-critical path. The admin GET/PUT routes surface 500 on DB failure.

3. **AC5 cache key:** Standard path now appends `:${globalModel}` suffix so switching global model
   busts the cache. DEMO path already had `:demo:${model}` suffix — kept as-is. Important: the old
   standard cache key format was `desc:{t}:{l}:{a}:{locale}` (no model suffix). Any existing Redis
   entries written before this PR will miss on the new key (desired behaviour — they'll regenerate
   with the correct model).

4. **Rule H for `generation_model` event field:** Added `generation_model?: string` to
   `DescriptionRequestedEventSchema` in `@estalara/shared`. Non-test consumer is
   `apps/control-plane/src/app/api/adapt/description/route.ts` (same PR). Python consumer is
   `_resolve_generation_model()` in same PR.

5. **Tier 1 short-circuit moved earlier:** Discovered that the Tier 1 early return was placed after
   the DB calls (DEMO check + global model read). Moved it before both DB calls so Tier 1 stays O(0)
   DB calls. Test caught this regression.

**A guardrail I'd add:** The `app_config` table has no RLS and no rate-limiting on the admin write
endpoint — a rogue agency:admin could change the model rapidly. Adding a per-minute rate limit on
the PUT would prevent accidental or malicious thrashing. Currently not a priority since it's a
single global write.

---

## 2026-06-03 / FOLLOW-179

**What I built:** UNIQUE constraint on `conversion_labels(tenant_id, prediction_id)` + validated
upsert helper (`upsertConversionLabel`) that applies a class-precedence policy (source dominance +
funnel finality) via `INSERT ... ON CONFLICT DO UPDATE WHERE <rank CASE>`. Replaced the plain
`db.insert()` in the feedback route. Added `conversionLabelRank()` as the TS-layer single source of
truth for the same ordering.

**Wiring/auth/fail-loud risks I weighed:**

- The `onConflictDoUpdate` WHERE clause embeds SQL rank constants that must stay in sync with the TS
  `OUTCOME_CLASS_RANK` map; documented the sync requirement in the code but there is no automated
  enforcement — a future class addition that updates only one side would silently mismatch. This is
  a potential future Rule O-style gate candidate.
- Adding `@estalara/shared` as a dep to `@estalara/db` is the first cross-package import in the db
  layer; vitest config needed an explicit alias because `@estalara/db` previously had no
  inter-package deps and no alias setup.
- The `upsertConversionLabel` helper deliberately does NOT set `app.current_tenant_id` — it uses the
  admin client (which bypasses RLS), matching the existing pattern. Any future caller that wants RLS
  enforcement must use a tenant client instead; this should be documented explicitly to prevent
  misuse.

**A guardrail I'd add:** A CI check that asserts the SQL rank CASE values in
`upsert-conversion-label.ts` are byte-identical to the TS constants in `conversion-label.ts` —
preventing the two from drifting when a new outcome class is added. Pattern analogous to Rule J
mirror checks.

---

## 2026-06-06 / FOLLOW-193

**What I built:** DSR engagement_scores erasure (DPIA §8 line 773 compliance gap) + Vercel cron
restore stub (deployment gated on CEO Q3 Vercel Pro confirmation). Added `engagement_scores` Drizzle
schema (migration 0021, RLS), exported from `@estalara/db`, imported into the DSR erase route and
deleted inside the existing transaction for atomicity. Three new integration tests cover AC3 (delete
issued), AC4 (row absent after), and atomicity (same transaction call as session_embeddings). Cron
block added to `vercel.json` noting the Vercel Pro gate.

**Wiring/auth/fail-loud risks I weighed:**

- The `engagement_scores` delete is inside the Drizzle `db.transaction()` — if it fails, the whole
  transaction rolls back and no partial erasure escapes. Important because a partial Postgres erase
  (session_embeddings deleted, engagement_scores left) is a GDPR Art. 17 gap that no external signal
  would surface.
- The cron block in `vercel.json` is real config — if CEO confirms Q3 and someone deploys before
  reading the PR comment, the cron activates. Mitigated by the explicit code comment and PR
  description gate warning.
- Rebuilding the db package before committing is required when a new schema file is added — ESLint
  needs the dist `.d.ts` files to resolve types for the control-plane. Without the rebuild, ESLint
  fails with "Unsafe member access" on the new table's columns.
- `git stash`/`git stash pop` across branches is dangerous: it can silently drop or revert staged
  changes. Prefer committing to a WIP commit rather than stashing when switching context.

**A guardrail I'd add:** A CI check that scans the DPIA §8 "erasure cascade" table and asserts each
listed table has a `tx.delete(table)` call inside `erase/route.ts`. Would catch future tables added
to the DPIA but forgotten in the code — the same gap that made this ticket necessary.
