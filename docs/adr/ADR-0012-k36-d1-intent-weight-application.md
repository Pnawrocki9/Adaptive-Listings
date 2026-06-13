# ADR-0012 — K.3.6 D-1 intent-weight application: auth transport, canonical weights shape, and SDK injection contract

**Status:** ACCEPTED **Date:** 2026-06-13 **Accepted:** 2026-06-13 (CTO Rafał Palak, CEO Piotr
Nawrocki — "BUILD full D-1 weight-application path") **Tickets:** FOLLOW-294 (P1 blocking),
FOLLOW-268 (write API), FOLLOW-293 (closure verification) **Cross-references:** ADR-0011,
FOLLOW-267, FOLLOW-268, FOLLOW-293, FOLLOW-294, FOLLOW-295, FOLLOW-296, FOLLOW-297, RETRO-061

---

## Context

PR #283 (FOLLOW-267) shipped the K.3.6 Archetype Tracer admin API (8 routes) and a
`GET /api/intent/config` route intended as the SDK-facing weight-config endpoint (AC8). RETRO-061
identified three contract defects that block the D-1 "immediate weights" build leg:

**Defect 1 — Security (live route):** `GET /api/intent/config` is unauthenticated. It accepts
`tenant_id` as an arbitrary query parameter, allowing any anonymous caller to read any tenant's
weight configuration by iterating UUIDs. The route docstring at `:14-17` justifies this with "same
risk as `/api/quiz/public-config` per ADR-0011 — no auth." That claim is false:

- `/api/quiz/public-config` is API-key-authenticated via `Authorization: Bearer <tenant-api-key>`,
  SHA-256 compared constant-time against `api_keys.hashed_key`, with `tenant_id` derived from the
  authenticated key (never a query parameter).
- The `createAdminClient()` path used by `/api/intent/config` uses the service-role Postgres
  connection, which bypasses the migration-0029 RLS policy on `intent_weight_configs`.

The no-real-data window (today `GET /api/intent/config` returns `DEFAULT_WEIGHTS` with
`data_source: 'mock'` because no `intent_weight_configs` rows exist yet) means there is no immediate
data leak. However, the FOLLOW-268 write path will create real rows, so the auth defect must be
corrected before any real rows exist.

**Defect 2 — No SDK injection point:** `DEFAULT_WEIGHTS` (route `:57-71`) invents a shape
`{ signal_weights: { quiz_answer, chat_turn, behavioral, dwell, pageview, referrer, filter_applied }, priors: { neutral: 1.0 }, behavioral_damping: 0.85 }`.
None of these keys map to the SDK intent engine's internal model in
`packages/sdk/src/core/intent.ts`. The SDK uses:

- Hardcoded `BASE_PRIOR` (initial archetype probabilities)
- Hardcoded `SIGNAL_LIKELIHOODS` (multiplicative likelihood per behavioral event type)
- Hardcoded `BEHAVIORAL_DAMPING = 0.3` (scalar applied to all behavioral likelihoods)
- Hardcoded `QUIZ_LIKELIHOODS` and `CHAT_INTENT_LIKELIHOODS` (fixed tables)

There is no code path where externally-fetched weights reach `intent.ts`.
`IntentConfigResponse.weights` is typed as `z.record(z.unknown())`, which is opaque — the SDK cannot
apply what it cannot parse.

**Defect 3 — FOLLOW-268 mis-scoped:** The existing FOLLOW-268 stub is `P2, backend-only POST/PUT`.
The CEO decision (2026-06-10) is to BUILD the full D-1 path: server-supplied weights must be fetched
by the SDK at init time and applied to the intent engine's live classification. This is a two-leg
build (backend write API + SDK fetch-and-apply), not a backend-only ticket.

---

## Decision

### 1. Auth transport for the SDK-facing weight-config route

**Adopt the ADR-0011 `/api/quiz/public-config` pattern verbatim.**

- Header: `Authorization: Bearer <tenant-api-key>` (the SDK's `data-api-key` value from the
  snippet).
- Lookup: SHA-256(bearerToken) compared constant-time against `api_keys.hashed_key` (same
  `sha256Hex` + `constantTimeEqual` helpers used in `quiz/public-config/route.ts`).
- `tenant_id` is resolved from the authenticated key — it is NEVER accepted as a query parameter.
- CORS: `Access-Control-Allow-Origin: *` — same as `/api/quiz/public-config` (buyer-facing pages, no
  credentials).
- Cache-Control: `public, max-age=300` (5-minute CDN TTL). Weights change rarely; caching reduces DB
  load. Same value as the current route's `CACHE_HEADERS`.

**The existing `?tenant_id=<uuid>` query parameter is removed.** The route becomes:

```
GET /api/intent/config
Authorization: Bearer <tenant-api-key>
```

**The "no auth, same risk profile as /api/quiz/public-config" docstring claim is retired.** It is
factually incorrect in both directions — the precedent route requires auth, and this route did not
have it.

**Admin write path (FOLLOW-268) uses a separate auth model.** The write API
(`POST/PUT /api/admin/intent/config`) authenticates via the existing tracer-admin pattern: Bearer
`ADMIN_API_SECRET` OR Estalara staff JWT. This is already correct in the FOLLOW-268 stub and does
not change. The two auth models serve two different callers:

| Route                               | Caller                      | Auth model                           |
| ----------------------------------- | --------------------------- | ------------------------------------ |
| `GET /api/intent/config`            | SDK (anonymous buyer page)  | Bearer API key → key-derived tenant  |
| `POST/PUT /api/admin/intent/config` | Estalara staff / admin tool | Bearer ADMIN_API_SECRET or staff JWT |

### 2. Canonical weights shape

**The weights object is defined by what the SDK intent engine can actually apply.** Inspecting
`packages/sdk/src/core/intent.ts`, the externally-configurable parameters are:

| Parameter                     | Current location                                     | SDK structure                               |
| ----------------------------- | ---------------------------------------------------- | ------------------------------------------- |
| Archetype prior probabilities | `BASE_PRIOR` — one value per archetype               | `Record<Archetype, number>` summing to 1.0  |
| Behavioral damping scalar     | `BEHAVIORAL_DAMPING = 0.3`                           | single `number` in (0, 1]                   |
| Behavioral signal likelihoods | `SIGNAL_LIKELIHOODS` — per event-type, per archetype | `Record<string, Record<Archetype, number>>` |

The canonical `Archetype` union and `ARCHETYPE_NAMES` array (18 values) in `intent.ts` are the
single source of truth for valid archetype keys. The canonical behavioral event-type keys are the
keys of `SIGNAL_LIKELIHOODS` in `intent.ts`.

**The `weights` payload is defined as follows (pinned v1 shape):**

```typescript
// packages/shared/src/schemas/intent-weights.ts  (new file — see §Implementation)

export const INTENT_SIGNAL_KEYS = [
  'scroll.depth',
  'listing.viewed',
  'cta.clicked',
  'quiz.event',
  'listing.bookmarked',
  'device_type.desktop',
  'device_type.mobile',
  'micro_poll.answered',
  'photo.dwell',
  'feature.expanded',
  'mortgage_calc.used',
  'price.compared',
  'inquiry.started',
] as const;

export type IntentSignalKey = (typeof INTENT_SIGNAL_KEYS)[number];

// Re-exported from intent.ts canonical list — see §Implementation note.
export const ARCHETYPE_KEYS = [
  'yield_hunter',
  'vacation_rental_investor',
  'flip_investor',
  'portfolio_builder',
  'golden_visa_buyer',
  'commercial_investor',
  'family_buyer',
  'first_time_buyer',
  'upsizer',
  'downsizer',
  'luxury_buyer',
  'remote_worker',
  'lifestyle_expat',
  'retiree_relocator',
  'diaspora_buyer',
  'second_home_buyer',
  'student_parent',
  'neutral',
] as const;

export type ArchetypeKey = (typeof ARCHETYPE_KEYS)[number];

export const IntentWeightsSchema = z
  .object({
    /**
     * Per-archetype prior probability overrides. Values must be > 0.
     * The SDK normalizes to sum-to-1 after applying, so absolute magnitudes are
     * relative — only the ratios matter. Partial records are accepted; unspecified
     * archetypes retain their SDK-internal BASE_PRIOR value.
     * All keys must be valid ArchetypeKey values.
     */
    priors: z.record(z.enum(ARCHETYPE_KEYS), z.number().positive()).optional(),

    /**
     * Behavioral damping scalar applied to all SIGNAL_LIKELIHOODS before
     * multiplicative update. Must be in (0, 1]. Value 1.0 = no damping (raw
     * likelihood applied). Value 0.3 = SDK default (BEHAVIORAL_DAMPING).
     */
    behavioral_damping: z.number().positive().max(1).optional(),

    /**
     * Per-signal-type likelihood overrides. Keys must be valid IntentSignalKey values.
     * Values are per-archetype likelihood multipliers (> 0; 1.0 = no information for
     * that archetype from this signal). Partial records are accepted; unspecified
     * signal types retain their SDK-internal SIGNAL_LIKELIHOODS values. Unspecified
     * archetypes within a given signal entry default to 1.0 (no information).
     *
     * Note: `listing.bookmarked`, `micro_poll.answered`, `feature.expanded`, and
     * `filter.applied` have payload-conditional intercepts in the SDK that run
     * before the SIGNAL_LIKELIHOODS lookup. Server-supplied likelihoods for these
     * signals apply to the base (non-payload-conditional) component only. The
     * payload-conditional boosts are not overridable in v1.
     */
    signal_likelihoods: z
      .record(z.enum(INTENT_SIGNAL_KEYS), z.record(z.enum(ARCHETYPE_KEYS), z.number().positive()))
      .optional(),
  })
  .strict();

export type IntentWeights = z.infer<typeof IntentWeightsSchema>;
```

**Key decisions in this shape:**

- All three sub-fields are optional. A weights row may supply only `behavioral_damping`, only
  `priors`, only `signal_likelihoods`, or any combination. This avoids requiring tenants or admins
  to specify the full 18×13 matrix.
- Keys are validated against the canonical `ARCHETYPE_KEYS` and `INTENT_SIGNAL_KEYS` enums via Zod —
  solving FOLLOW-268 AC4's "known archetype/signal set" requirement.
- `.strict()` rejects unknown fields — prevents silent acceptance of the old invented keys
  (`quiz_answer`, `chat_turn`, `dwell`, `pageview`, `referrer`, `filter_applied`) that had no SDK
  consumers.
- The `priors` field replaces `DEFAULT_WEIGHTS.priors` which was `{ neutral: 1.0 }` — meaningless as
  an override because neutral already has the highest base prior.

**`IntentConfigResponse.weights` is narrowed from `z.record(z.unknown())` to `IntentWeightsSchema`**
in `packages/shared/src/schemas/tracer.ts`.

**No hand-duplicated key lists.** `INTENT_SIGNAL_KEYS` is defined once in
`packages/shared/src/schemas/intent-weights.ts`. `ARCHETYPE_KEYS` is defined once there and
re-exported. The SDK `intent.ts` `ARCHETYPE_NAMES` and `SIGNAL_LIKELIHOODS` keys must match; an
implementation-time assertion is required (see §Implementation guidance).

### 3. SDK weight-injection contract

**The SDK fetches `/api/intent/config` at init, parallel to `fetchQuizConfig`, and applies the
result before the first behavioral signal is processed.**

#### Hook signature (new function in `packages/sdk/src/core/intent.ts`)

```typescript
/**
 * Apply server-supplied weight overrides to the intent engine's defaults.
 *
 * Called once at session start (after consent is resolved, before behavioral
 * signals are processed). Returns an overrides bundle that callers pass to
 * `applyBehavioralSignal` and `initIntentState` instead of the module-level
 * constants. Pure function — does not mutate module state.
 *
 * Fallback contract: if `weights` is null (fetch failed or returned mock),
 * the returned bundle contains the SDK's internal defaults unchanged.
 * The intent engine MUST behave identically to the no-server-weights path
 * when weights is null.
 *
 * @param weights - Parsed IntentWeights from the server, or null on failure.
 * @returns IntentEngineOverrides — resolved values for behavioral_damping,
 *          initial priors, and signal_likelihoods to use for this session.
 */
export function resolveIntentOverrides(weights: IntentWeights | null): IntentEngineOverrides;

export interface IntentEngineOverrides {
  /** Resolved behavioral damping scalar. Default: BEHAVIORAL_DAMPING (0.3). */
  behavioralDamping: number;
  /** Resolved initial archetype priors (normalized). Default: BASE_PRIOR. */
  basePrior: ArchetypeProbabilities;
  /**
   * Resolved signal likelihoods. Merged over SIGNAL_LIKELIHOODS: server values
   * for specified signal types override SDK defaults; unspecified signals retain
   * SDK defaults. Missing archetypes within a signal entry default to 1.0.
   */
  signalLikelihoods: Record<string, ArchetypeProbabilities>;
}
```

**Application contract:**

- `applyBehavioralSignal` is updated to accept an optional `overrides: IntentEngineOverrides`
  parameter (defaulting to the module-level defaults when absent, for backward compatibility).
- `initIntentState` is updated to accept an optional `overrides: IntentEngineOverrides` parameter so
  the initial prior respects server-supplied priors.
- `resolveIntentOverrides(null)` returns the module-level defaults — callers need not branch.

**`data_source` application rule:**

| `data_source` value    | SDK behavior                                                                  |
| ---------------------- | ----------------------------------------------------------------------------- |
| `'live'`               | Parse `weights` as `IntentWeightsSchema`; apply via `resolveIntentOverrides`. |
| `'mock'`               | Treat as null — use SDK internal defaults. Do NOT apply mock weights.         |
| fetch failed / timeout | Treat as null — use SDK internal defaults.                                    |

Rationale: mock weights (`data_source: 'mock'`) are dev/CI placeholders. Applying them in production
would silently skew archetype scoring with non-tenant-specific values. The SDK must observe
`data_source` and only apply `'live'` weights.

**Init sequence (updated, extends ADR-0011 §SDK init sequence):**

```
1. readConfig()              — parse snippet dataset (immutable binding: API key, decision URL)
2. resolveConsent()          — consent gate; banner renders here (pre-fetch)
3a. fetchQuizConfig()        — GET /api/quiz/public-config (1000 ms timeout, ADR-0011)
3b. fetchIntentWeights()     — GET /api/intent/config (1000 ms timeout) [NEW — this ADR]
                               Steps 3a and 3b run in parallel (Promise.all or equivalent).
4. mergeQuizConfig()         — overlay quiz server values onto SdkConfig (ADR-0011)
5. resolveIntentOverrides()  — build IntentEngineOverrides from fetched weights or null [NEW]
6. initIntentState(overrides) — init with server-supplied priors (or SDK defaults on null) [UPDATED]
7. scheduleQuizTrigger()     — uses merged config.quiz.enabled
8. schedulesMicroPoll()      — uses merged config.microPollsEnabled
```

Step 3b runs parallel to 3a, not sequentially after it. Both must complete (or timeout) before steps
5-8 run.

**Timeout and error handling:**

- Timeout budget: 1000 ms (same as `fetchQuizConfig`).
- On network error, non-2xx, timeout, or Zod parse failure: log `console.warn` when
  `config.debug === true`; proceed with SDK internal defaults (same reference as the no-server
  path).
- On `data_source: 'mock'`: log `console.debug` when `config.debug === true`; proceed with SDK
  internal defaults.
- The fetch MUST NOT block DOM augmentation, archetype detection, or quiz/micro-poll scheduling —
  only the intent engine initialization (step 6) waits for it.

**New function signature in `packages/sdk/src/core/quiz-config.ts` or a new
`packages/sdk/src/core/intent-weights.ts`:**

```typescript
/**
 * Fetch intent weight overrides from GET /api/intent/config.
 *
 * Returns parsed IntentWeights on success with data_source='live',
 * null on any failure (network, non-2xx, timeout, parse error, data_source='mock').
 *
 * @param decisionApiUrl - Base URL from SdkConfig.decisionApiUrl.
 * @param apiKey         - Tenant API key (Bearer token).
 * @param timeoutMs      - Fetch timeout in ms (default 1000).
 */
export async function fetchIntentWeights(
  decisionApiUrl: string,
  apiKey: string,
  timeoutMs?: number,
): Promise<IntentWeights | null>;
```

### 4. Interim security posture

The already-merged `/api/intent/config` route is unauthenticated but currently returns only
`DEFAULT_WEIGHTS` with `data_source: 'mock'` because the `intent_weight_configs` table has no rows.
There is no real data leaking today.

**No emergency hotfix is required.** The fix must land before the FOLLOW-268 write path creates real
rows. The sequencing rule is:

> FOLLOW-294-auth (corrected auth leg) MUST merge before any `intent_weight_configs` INSERT is
> executed in any environment (dev, staging, or prod).

The corrected route removes the `?tenant_id` query param entirely. Any cached or bookmarked URLs
with the old `?tenant_id` format will receive 400 (the Zod `QuerySchema` that validated `tenant_id`
is removed; if a `tenant_id` query param appears, it is ignored — the SDK does not send one anyway).

### 5. Ticket breakdown and sequencing

The following replaces the existing FOLLOW-268 stub and reshapes FOLLOW-294/297 into concrete
sequenced tickets.

#### Ticket A — FOLLOW-294 (P1, blocks everything): Auth fix + shared weights schema

**Agent:** backend-engineer (auth fix) + architect (Zod schema in shared) **Prerequisite for:**
FOLLOW-268-write, FOLLOW-268-sdk

Work items:

1. Create `packages/shared/src/schemas/intent-weights.ts` with `IntentWeightsSchema`,
   `IntentEngineOverrides` type, `INTENT_SIGNAL_KEYS`, `ARCHETYPE_KEYS` as described in §2.
2. Add `IntentWeightsSchema` to `packages/shared/src/schemas/index.ts`.
3. Narrow `IntentConfigResponse.weights` from `z.record(z.unknown())` to `IntentWeightsSchema` in
   `packages/shared/src/schemas/tracer.ts`.
4. Rewrite `GET /api/intent/config` to use the ADR-0011 auth pattern (Bearer API key →
   `resolveApiKey` helper — copy from `quiz/public-config/route.ts`). Remove `?tenant_id` query
   parameter. Remove the stale docstring claim.
5. Add `≥5 Zod schema tests` in `packages/shared/src/schemas/intent-weights.test.ts`.
6. Update `docs/INTERFACES.md` (entry for `GET /api/intent/config` + `IntentWeightsSchema`).
7. Add an example in `packages/shared/src/examples/intent-weights.ts`.
8. Correct the `intent-weight-configs.ts` read-path comment (`:11`) to describe the actual
   `or(eq, isNull)` query rather than the `COALESCE(...)` fiction (RETRO-061 DG-2). **AC:**
   FOLLOW-294 AC1–AC6. Must pass prettier + vitest.

#### Ticket B — FOLLOW-268-write (P1, backend leg, depends on A): Admin write API

**Agent:** backend-engineer **Prerequisite for:** FOLLOW-268-sdk (write path must exist before SDK
validation test)

Work items:

1. `POST /api/admin/intent/config` — create row; auth via Bearer `ADMIN_API_SECRET` or staff JWT.
2. `PUT /api/admin/intent/config/[id]` — update weights + `is_active` toggle.
3. Body validated with `IntentWeightsSchema` (from Ticket A).
4. `GET /api/intent/config` returns `data_source: 'live'` after a successful POST. **AC:**
   FOLLOW-268 AC1–AC6. Must NOT create any `intent_weight_configs` rows in any environment before
   Ticket A merges (sequencing rule from §4).

#### Ticket C — FOLLOW-268-sdk (P1, SDK leg, depends on A + B): SDK fetch and weight application

**Agent:** sdk-engineer **Prerequisite for:** FOLLOW-293 (closure verification)

Work items:

1. Add `resolveIntentOverrides(weights: IntentWeights | null): IntentEngineOverrides` to
   `packages/sdk/src/core/intent.ts`.
2. Update `applyBehavioralSignal` and `initIntentState` to accept optional
   `overrides: IntentEngineOverrides` (backward-compatible default = module constants).
3. Add `fetchIntentWeights(decisionApiUrl, apiKey, timeoutMs)` to a new
   `packages/sdk/src/core/intent-weights.ts`.
4. Wire into `init()` in `index.ts` as step 3b parallel to `fetchQuizConfig` (step 3a).
5. Observe `data_source`: apply only on `'live'`; fall through to defaults on `'mock'` or null.
6. Write ≥5 tests in `packages/sdk/src/__tests__/intent-weights.test.ts` covering:
   - null weights → SDK defaults unchanged
   - `data_source: 'mock'` → SDK defaults unchanged
   - live `behavioral_damping` override → applied to `applyBehavioralSignal`
   - live `priors` override → reflected in `initIntentState` output
   - live `signal_likelihoods` partial override → merges over SDK defaults
7. Add Zod parse-error path: invalid server response → null (do not throw). **AC:** FOLLOW-293
   AC1–AC3 (closure verification). Must pass prettier + vitest.

#### Ticket D — FOLLOW-297 (P1, parallel to A–C): Route + helper unit tests

**Agent:** qa-engineer or backend-engineer **Can run parallel to Ticket A.**

Work items:

1. Unit tests for the corrected `GET /api/intent/config` auth path (401 on missing bearer, 404 on
   unknown key, 200 with `data_source: 'live'` on valid key with active row, 200 with
   `data_source: 'mock'` on valid key with no active row, 503 on auth DB error).
2. Test the `resolveApiKey` helper (same pattern as `quiz/public-config` tests if they exist).
   **AC:** FOLLOW-297 (RETRO-061 finding).

#### Tickets E–G — FOLLOW-293/295/296 (P2, after A–D complete)

These are scoped independently and do not block the D-1 build path:

- FOLLOW-293: closure verification gate (retro-analyst reads the completed chain).
- FOLLOW-295: tracer session route tenant-scoping.
- FOLLOW-296: SSE stream Zod validation + docstring fix.

#### Sequencing diagram

```
A (auth fix + shared schema)   ─┬─> B (write API)  ─┬─> C (SDK leg)  ─> D-293 (verify)
                                │                    └─> D (route tests, parallel)
                                └─> D (route tests, can start from A)

E (FOLLOW-295), F (FOLLOW-296) — independent, after A
```

---

## Wire Contract

### `GET /api/intent/config` (revised)

```
Method: GET
Path:   /api/intent/config
Auth:   Authorization: Bearer <tenant-api-key>
        (same SHA-256 constant-time lookup as GET /api/quiz/public-config)

CORS:   Access-Control-Allow-Origin: *
        Access-Control-Allow-Methods: GET, OPTIONS
        Access-Control-Allow-Headers: Authorization

Cache-Control: public, max-age=300

Response 200 (live row found):
{
  "weights": {                          // IntentWeights — all sub-fields optional
    "behavioral_damping": 0.25,         // example — may be absent
    "priors": {                         // example — may be absent or partial
      "yield_hunter": 0.06,
      "neutral": 0.30
    },
    "signal_likelihoods": {             // example — may be absent or partial
      "cta.clicked": {
        "yield_hunter": 1.20,
        "flip_investor": 1.15
      }
    }
  },
  "effective_at": "2026-06-13T10:00:00Z",
  "is_tenant_specific": true,
  "data_source": "live"
}

Response 200 (no active row — global default or tenant-specific):
{
  "weights": {},                        // empty — SDK uses internal defaults
  "effective_at": "2026-06-13T10:00:00Z",
  "is_tenant_specific": false,
  "data_source": "mock"
}

Response 200 (DB unconfigured — dev/CI):
{
  "weights": {},
  "effective_at": "<now ISO>",
  "is_tenant_specific": false,
  "data_source": "mock"
}

Response 401: { "error": "Invalid API key" }
Response 404: { "error": "Tenant not found" }
Response 503: { "error": "Service temporarily unavailable" }   // auth DB error
Response 500: { "error": { "code": "db_error", ... } }        // tenant-fetch DB error
```

**Nullability contract:** all fields in a 200 response are always present. `weights` is always an
object (may be empty `{}`). No field is `null` or `undefined`. The SDK MUST NOT treat an absent
sub-field of `weights` as an error — absent sub-fields mean "use SDK defaults for that parameter."

### `IntentWeightsSchema` wire examples

**Example 1 — behavioral damping only:**

```json
{ "behavioral_damping": 0.2 }
```

**Example 2 — priors only (partial):**

```json
{ "priors": { "yield_hunter": 0.08, "neutral": 0.28 } }
```

**Example 3 — all three, partial:**

```json
{
  "behavioral_damping": 0.25,
  "priors": { "family_buyer": 0.07, "neutral": 0.3 },
  "signal_likelihoods": {
    "cta.clicked": { "yield_hunter": 1.2 },
    "listing.viewed": { "portfolio_builder": 1.15 }
  }
}
```

**Example 4 — empty (SDK defaults):**

```json
{}
```

---

## Consequences

### Positive

- Closes the cross-tenant weight enumeration vulnerability before real data exists.
- Establishes one canonical key set for archetype and signal identifiers — shared between the
  Postgres write-path validator (FOLLOW-268) and the SDK applier (FOLLOW-268-sdk). Eliminates the
  class of key-list drift that caused RETRO-053/055 (Rule-S pattern).
- The `resolveIntentOverrides` / `IntentEngineOverrides` interface makes the SDK weight-application
  path testable in isolation without a running server.
- `data_source: 'mock'` is a first-class signal to the SDK — it cannot accidentally apply dev
  defaults to live buyers.
- Backward compatible: `applyBehavioralSignal` and `initIntentState` keep their existing signatures;
  overrides are optional parameters with SDK-default fallbacks.

### Negative

- The `signal_likelihoods` override surface only covers the base (non-payload-conditional) component
  of `listing.bookmarked`, `micro_poll.answered`, `feature.expanded`, and `filter.applied`.
  Payload-conditional boosts (e.g. bedroom count → `family_buyer`) are not overridable in v1. This
  is a deliberate v1 boundary — extending it requires a new ADR.
- Adds a second parallel network fetch at SDK init (alongside `fetchQuizConfig`). Both run in
  parallel; the combined latency budget is 1000 ms (whichever resolves last, up to the timeout). The
  quiz timer (30 s) and micro-poll timer (90 s) dwarf this in practice.
- `IntentWeightsSchema.priors` validation requires values to be positive but does not enforce
  sum-to-1 — normalization is the SDK's responsibility. This is intentional: partial overrides
  (specifying only some archetypes) make sum-to-1 enforcement at the wire boundary impractical.

### Risks

- **Partial priors divergence:** if a server-supplied `priors` record specifies only a subset of
  archetypes, the SDK merges it with `BASE_PRIOR` (unspecified archetypes keep their BASE_PRIOR
  value) and then normalizes. The merge semantics must be documented in the implementing code and
  tested. Risk: if the merge logic is "replace BASE_PRIOR with server priors only" (not merge),
  unspecified archetypes go to 0 — uniform distribution collapse. Mitigation: the test suite for
  `resolveIntentOverrides` must include the partial-priors case.
- **SIGNAL_LIKELIHOODS drift:** if a new behavioral event type is added to `intent.ts`
  `SIGNAL_LIKELIHOODS` without a corresponding entry added to `INTENT_SIGNAL_KEYS` in shared, the
  new signal type becomes non-overridable from the server silently. Mitigation: an `as const`
  assertion test in `intent-weights.test.ts` that cross-checks `INTENT_SIGNAL_KEYS` against the keys
  of `SIGNAL_LIKELIHOODS` (importing both from their respective modules).
- **Reversibility:** HIGH. If the server-weights path proves impractical (wrong abstraction,
  performance issue, Zod version conflict), `fetchIntentWeights` can be made a no-op returning null
  at the call site and `resolveIntentOverrides(null)` returns SDK defaults — the rest of the SDK is
  unchanged. The `IntentWeightsSchema` and `IntentEngineOverrides` types remain as dormant
  scaffolding.

---

## Alternatives

### Alternative A — Audit-only descope: keep weights as opaque JSON, no SDK application

Keep `IntentConfigResponse.weights` typed as `z.record(z.unknown())`. The route returns the stored
JSONB blob for human inspection only; the SDK fetches it but discards the weights. Close D-1 as
"admin can see stored weights" and defer SDK application to D-2 or D-3.

Rejected: CEO explicitly decided "BUILD the full SDK weight-application path" (2026-06-10).
Audit-only leaves the FOLLOW-293 wire open (HALF_WIRE_P: producer exists, consumer absent) and
repeats the pattern that generated RETRO-061's §3 finding.

### Alternative B — Opaque JSONB with a versioned sub-schema field

Keep `weights: z.record(z.unknown())` on the wire but add a `schema_version: '1'` field. The SDK
reads `schema_version` and branches on known versions. Unknown versions → SDK defaults.

Rejected: adds a versioning indirection layer without solving the key-list drift problem. The Zod
`z.record(z.unknown())` cannot enforce key validity at either the write or read boundary; the SDK
must still parse manually. All the risk with none of the schema-enforcement benefit. The
`IntentWeightsSchema` approach enforces both sides from the same canonical definition.

### Alternative C — Three separate config endpoints (one per weights sub-field)

`GET /api/intent/config/priors`, `GET /api/intent/config/damping`,
`GET /api/intent/config/likelihoods`. Allows independent cache TTLs and partial updates.

Rejected: three fetch round-trips at SDK init (even parallel), three auth lookups, three DB rows or
a more complex schema. The monolithic weights object is simpler and consistent with how
`/api/quiz/public-config` returns all quiz config in a single fetch. A single row in
`intent_weight_configs.weights` (JSONB) already stores the bundle. Split can be introduced in a
future ADR if operational evidence warrants it.

---

## Implementation guidance

### Key files to create or modify

| File                                                          | Action                                                                                          | Owner    |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------- |
| `packages/shared/src/schemas/intent-weights.ts`               | CREATE — `IntentWeightsSchema`, `IntentEngineOverrides`, `INTENT_SIGNAL_KEYS`, `ARCHETYPE_KEYS` | Ticket A |
| `packages/shared/src/schemas/intent-weights.test.ts`          | CREATE — ≥5 schema cases                                                                        | Ticket A |
| `packages/shared/src/examples/intent-weights.ts`              | CREATE — 4 wire examples                                                                        | Ticket A |
| `packages/shared/src/schemas/tracer.ts`                       | MODIFY — narrow `IntentConfigResponse.weights`                                                  | Ticket A |
| `packages/shared/src/schemas/index.ts`                        | MODIFY — export from intent-weights                                                             | Ticket A |
| `apps/control-plane/src/app/api/intent/config/route.ts`       | MODIFY — add auth, remove `?tenant_id`                                                          | Ticket A |
| `packages/db/src/schema/intent-weight-configs.ts`             | MODIFY — correct read-path comment                                                              | Ticket A |
| `docs/INTERFACES.md`                                          | MODIFY — add entry                                                                              | Ticket A |
| `packages/sdk/src/core/intent.ts`                             | MODIFY — `resolveIntentOverrides`, update `applyBehavioralSignal` + `initIntentState`           | Ticket C |
| `packages/sdk/src/core/intent-weights.ts`                     | CREATE — `fetchIntentWeights`                                                                   | Ticket C |
| `packages/sdk/src/index.ts`                                   | MODIFY — wire step 3b                                                                           | Ticket C |
| `packages/sdk/src/__tests__/intent-weights.test.ts`           | CREATE — ≥5 cases                                                                               | Ticket C |
| `apps/control-plane/src/app/api/admin/intent/config/route.ts` | CREATE — POST/PUT write API                                                                     | Ticket B |

### Assertion test requirement (SIGNAL_LIKELIHOODS ↔ INTENT_SIGNAL_KEYS drift guard)

In `packages/shared/src/schemas/intent-weights.test.ts`, include a test that imports
`INTENT_SIGNAL_KEYS` and asserts it is a subset of (or equal to) the exported keys of
`SIGNAL_LIKELIHOODS` from `packages/sdk/src/core/intent.ts`. This test will fail if a new signal
type is added to the SDK without a corresponding update to the shared schema.

Because `packages/shared` may not import from `packages/sdk` (circular dependency risk), the
preferred implementation is to export `SIGNAL_LIKELIHOODS` keys as a separate const from `intent.ts`
that `packages/shared` can mirror — or to run the assertion test from the SDK package's own test
suite where both imports are valid.

### No spec without code or FOLLOW stub

This ADR adds behavioral specifications. Each behavioral spec maps to a concrete ticket above. The
implementing PRs are the evidence artifacts required by the guardrail. No FOLLOW stubs are created
here because the tickets are concrete and sequenced (not deferred to an unscheduled sprint).

---

## References

- ADR-0011 (`docs/adr/ADR-0011-quiz-config-transport.md`) — quiz-config auth model (correct
  precedent; supersedes the miscited "no auth" docstring)
- RETRO-061 — source of the three defects documented in §Context
- FOLLOW-267 / PR #283 — merged PR that shipped the defective route
- FOLLOW-268 — reshaped by this ADR into FOLLOW-268-write (backend) + FOLLOW-268-sdk (SDK)
- FOLLOW-293 — closure verification gate (after FOLLOW-268-sdk merges)
- FOLLOW-294 — P1 auth fix + shared schema (Ticket A)
- FOLLOW-295 — P2 tracer session scoping (independent)
- FOLLOW-296 — P2 SSE stream validation (independent)
- FOLLOW-297 — P1 route + helper tests (Ticket D)
- `apps/control-plane/src/app/api/intent/config/route.ts` — route to be rewritten
- `apps/control-plane/src/app/api/quiz/public-config/route.ts` — auth pattern to replicate
- `packages/sdk/src/core/intent.ts` — `ARCHETYPE_NAMES`, `SIGNAL_LIKELIHOODS`, `BEHAVIORAL_DAMPING`
- `packages/sdk/src/core/config.ts` — `SdkConfig` (SDK has `apiKey`, no `tenantId` in its
  public-config calls; confirms the Bearer-API-key transport is the correct fit)
- `packages/db/src/schema/intent-weight-configs.ts` — `intentWeightConfigs` table
- `packages/shared/src/schemas/tracer.ts` — `IntentConfigResponse` to be narrowed
