# Estalara — Interface and Cross-Module Registry

This file documents the location of key contracts, interfaces, and documents that cross module
boundaries. Maintained by the architect and compliance-engineer. Referenced by PM-orchestrator
before delegating downstream tickets.

---

## Compliance Documents

| Document                                      | Location                              | Owner               | Review Cadence                                                                         | Regulatory Basis                                    |
| --------------------------------------------- | ------------------------------------- | ------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------- |
| DPIA (Data Protection Impact Assessment)      | `docs/compliance/dpia.md`             | compliance-engineer | Annual; ad-hoc on material processing change or regulatory guidance change             | GDPR Art. 35; UK GDPR; UAE PDPL Art. 9              |
| ROPA (Records of Processing Activities)       | `docs/compliance/ropa.md`             | compliance-engineer | Annual; ad-hoc on new processing activity, sub-processor, or transfer mechanism change | GDPR Art. 30; UK GDPR Art. 30; UAE PDPL Art. 15     |
| Compliance README (document index)            | `docs/compliance/README.md`           | compliance-engineer | Updated with each new compliance document                                              | N/A                                                 |
| LIA Template (Legitimate Interest Assessment) | `docs/compliance/lia-template.md`     | compliance-engineer | Per-tenant on Mode A/C activation (TICKET-GDPR-003)                                    | GDPR Art. 6(1)(f); ICO LIA guidance; CNIL June 2025 |
| Regulatory Watch                              | `docs/compliance/REGULATORY_WATCH.md` | compliance-engineer | Continuous                                                                             | All active regulations                              |

### Retention Periods (authoritative — cross-reference for deletion workers)

The authoritative retention schedule for all deletion workers and DSR cascades is the table at the
top of `docs/compliance/ropa.md`. The TICKET-GDPR-002 deletion worker must reference this table for
`session_embeddings` (90 days), `consent_records` (3 years), `adaptation_decisions` (13 months),
`llm_calls` (13 months), `ab_bandit_weights` (indefinite — no personal data), and `staff_audit_log`
(7 years).

### Lawful Basis (authoritative — cross-reference for consent gating)

The lawful basis definitions for each processing activity are in `docs/compliance/ropa.md` per
activity. The TICKET-GDPR-004 consent gating implementation must use the mode definitions from
`docs/compliance/dpia.md` Section 7 (Consent Strategy).

---

## Event Schema

Ingest event contract: `packages/shared/src/schemas/event.ts` (Zod discriminated union). Any
consumer reading behavioral events (ClickHouse `events`, Modal dispatch payloads) must import from
`@estalara/shared`.

## Decision API Contract

Canonical endpoint: `POST https://admin.estalara.com/api/adapt` (ADR-0004, ADR-0006, ADR-0007).
Implemented in `apps/control-plane/src/app/api/adapt/route.ts`. POST is the only method:
`GET /api/adapt` was retired by FOLLOW-1287 (ADR-0004 amendment, 2026-10-05) and answers 405.

Adaptation directive response schema: `packages/shared/src/directives.ts` (`AdaptationDirectives`
type). SDK validates responses against the mirror Zod schema at
`packages/sdk/src/core/adapt-schema.ts`. CI Rule H (`scripts/check-adapt-schema-drift.sh`) asserts
the two stay in sync.

Credentials (`Authorization: Bearer …`): a tenant API key (`resolveApiKey`, ADR-0015) always. Two
more variants exist only when the control plane runs with `DEMO_MODE=1` (FOLLOW-1288; read in one
place, `apps/control-plane/src/lib/demo/demo-mode.ts`): the demo-session HS256 JWT signed with
`DEMO_MODE_JWT_SECRET` (FOLLOW-205, revocable via `demo_sessions.revoked_at`), and the ops caller
`ADAPT_API_KEY` pinned to `OPS_TENANT_ID` (the only caller whose body `holdout_pct` is honoured —
the FOLLOW-819 harness's control arm). The per-tenant archetype override (`demo_override: true` on
the response) is likewise `DEMO_MODE=1` only. With the flag unset those bearers are ordinary unknown
keys (`401 invalid_demo_token`), and `api/demo/*` and `dashboard/demo/*` answer 404.

The former Decision API Cloudflare Worker (410 Gone since 2026-05-25) was removed 2026-09-24
(FOLLOW-1262); `/api/adapt` on the control plane is the only decision endpoint (ADR-0006).

SDK loader contract: every embed snippet MUST include
`data-decision-url="https://admin.estalara.com/api"` (the SDK appends `/adapt` at call time). The
onboarding wizard's `buildSnippet()` that generated such snippets was removed by FOLLOW-1328
(ESC-085); the host writes its own snippet.

SDK public-contract removals (ESC-081, FOLLOW-1293, 2026-10-12; consumers = 0, ESC-020): the
`@estalara/sdk` export `identify()` and the `data-tier` script attribute (`config.tier`) no longer
exist; a stray `data-tier` on a snippet is ignored. The ingest event envelope
(`packages/shared/src/schemas/event.ts`) and the `intent.snapshot` payload never carried a `tier`
field; the envelope is a non-strict `z.object`, so a stray `tier` key on an event is stripped by
`EventEnvelopeSchema` (ingest does not reject the event, and nothing writes it to ClickHouse).
`micro_poll.answered` is no longer a valid `INTENT_SIGNAL_KEYS` key of the intent-weights override
contract (no stored row holds it, checked on prod 2026-10-12).

(TICKET-GDPR-004 adds `consent_state` field to directive request.)

## Description Generation and Embed-Seed Requeue (FOLLOW-1297 / ADR-0023)

`description.requested` (`DescriptionRequestedEventSchema`,
`packages/shared/src/schemas/description.ts`) is consumed **in-process** by
`apps/control-plane/src/lib/description-generator.ts` (`generateDescription(event)`, in `after()` of
`GET /api/adapt/description`). It is no longer a network message: the Modal endpoint, the
`MODAL_DESCRIPTION_URL` variable and the callback `POST /api/internal/description-cache` were
deleted with `apps/llm-gateway` (PR B). The payload is unchanged.

`listing-embed-seed.requested` (`ListingEmbeddingSeedRequestedEventSchema`,
`packages/shared/src/schemas/listing-embed-seed.ts`) gains two additive optional fields:
`requeue_depth` (int 0..20, hops already taken) and `retry_listing_ids` (ids on their single retry).
The activation overflow is requeued to the internal route `POST /api/internal/listings/embed-seed`
(`Authorization: Bearer <INTERNAL_API_SECRET>`, body = the event; answers 202
`{ accepted, requeue_depth, listing_count }` and runs one hop in `after()`: concurrency 4 under a 10
s budget, the unstarted remainder requeued with `requeue_depth + 1`, a listing that fails its retry
reported by id). Example hop payload:
`{ "tenant_id": "<uuid>", "listing_ids": ["prop-060", "prop-061", "prop-052"], "requeue_depth": 1, "retry_listing_ids": ["prop-052"] }`.
The Modal consumer ignores both fields; the required-key fixture is unchanged.

## Quiz Public Config Contract (ACCEPTED — ADR-0011 / FOLLOW-275)

SDK runtime config endpoint. Called by the SDK at init time (after consent, before the quiz
scheduler fires) to fetch post-activation-mutable quiz/widget config without requiring a snippet
reinstall.

Endpoint: `GET https://admin.estalara.com/api/quiz/public-config`

Auth: `Authorization: Bearer <tenant-api-key>` (the `data-api-key` from the embed snippet). CORS:
open (`*`). Cache-Control: `max-age=300, stale-while-revalidate=60`.

Response (200):

```json
{
  "quiz_enabled": true,
  "language": "en",
  "accent_color": "#2563EB"
}
```

All three core fields are non-nullable (`micro_polls_enabled` was removed from the contract with the
micro-poll feature, FOLLOW-1294; a stale extra key is stripped by the SDK's Zod parse). SDK timeout
budget: 1000 ms. On error/timeout the SDK falls back to snippet dataset attributes
(DEPRECATED_FALLBACK) then to hardcoded defaults. The canonical Zod schema is
`QuizPublicConfigResponseSchema` in `packages/shared/src/schemas/quiz-config.ts` (≥5 test cases,
FOLLOW-275).

Status: ACCEPTED (ADR-0011 at `docs/adr/ADR-0011-quiz-config-transport.md`, PR #269 merged
2026-06-11).

### Superset — `PresentationConfigResponse` (ACCEPTED — ADR-0019)

ADR-0019 (`docs/adr/ADR-0019-per-tenant-presentation-config.md`, ACCEPTED 2026-07-24) makes this
same response the unified per-tenant presentation contract. The route path and auth/CORS/cache are
UNCHANGED (extending, not renaming — Alternatives A); the response gains OPTIONAL top-level slices,
each shipped together with its real SDK consumer (Rule L). The canonical superset Zod schema is
`PresentationConfigResponseSchema` in `packages/shared/src/schemas/presentation-config.ts` (extends
`QuizPublicConfigResponseSchema`; ≥5 test cases). Wire examples:
`packages/shared/src/examples/presentation-config.ts`.

Slices (by ticket): `brand` (FOLLOW-623 — SHIPPED), `quiz_placement` (FOLLOW-640), `opt_out_widget`
(FOLLOW-641), `quiz_definition` (FOLLOW-639 — SHIPPED). A shipped slice's absence means the SDK uses
its built-in default (ADR-0019 D4) — an unconfigured tenant is byte-identical to pre-ADR-0019.

**`brand` slice (FOLLOW-623):** read from `tenants.brand_config` (the same jsonb column written by
`/api/config` PATCH, PR #616). `logo_url` is `string | null` end-to-end, NEVER `undefined`
(D-nullability). Omitted when the tenant configured no brand (column default `{}`). Consumed per the
D4 color precedence (`quiz_config.accent_color` > `brand.primary_color` > SDK default): the
profiling opt-out toggle's accent uses `brand.primary_color` (else the SDK `accentColor`); the quiz
card shows `brand.logo_url` atop it (none when null). FOLLOW-1015 deleted the sticky quiz trigger,
which was `brand.primary_color`'s other consumer. `white_label` is parsed/exposed but not yet
consumed by FOLLOW-623 (colors/logo only).

Example 1 — fully-populated branded tenant (200):

```json
{
  "quiz_enabled": true,
  "language": "pl",
  "accent_color": "#2563EB",
  "data_source": "db",
  "brand": {
    "primary_color": "#1a73e8",
    "logo_url": "https://cdn.example.com/brands/acme/logo.svg",
    "white_label": true
  }
}
```

Example 2 — unconfigured tenant (200); brand slice absent, `logo_url` shape shown via a
brand-without-logo variant:

```json
{
  "quiz_enabled": true,
  "language": "en",
  "accent_color": "#2563EB",
  "data_source": "db"
}
```

```json
{
  "quiz_enabled": true,
  "language": "es",
  "accent_color": "#2563EB",
  "data_source": "db",
  "brand": { "primary_color": "#c026d3", "logo_url": null, "white_label": false }
}
```

**`quiz_definition` slice (FOLLOW-639):** the tenant's ACTIVE editable quiz tree, read from the
dedicated `quiz_definitions` table (ADR-0019 D2) and re-validated with `QuizDefinitionSchema` on
read. Omitted when the tenant has no active/valid definition — the SDK then walks its built-in
`DEFAULT_QUIZ_DEFINITION` (byte-identical to pre-ADR-0019 for every path). The SDK reduces the
walked answer `weights` vectors to a single archetype by argmax (`reduceWeightsToArchetype`),
preserving the ADR-0014 SoT + FOLLOW-101/554 + completion-ping persistence path unchanged. Hard
integrity (unknown archetype id, dangling `next`, cycle, duplicate id) is rejected on write; the
unreachable-archetype list is a NON-BLOCKING editor warning.

Example 3 — tenant with an active quiz definition (200):

```json
{
  "quiz_enabled": true,
  "language": "en",
  "accent_color": "#2563EB",
  "data_source": "db",
  "quiz_definition": {
    "schema_version": 1,
    "root": "q_gate",
    "languages": ["en"],
    "questions": [
      {
        "id": "q_gate",
        "prompt_i18n": { "en": "What are you looking for?" },
        "answers": [
          {
            "id": "a_invest",
            "label_i18n": { "en": "Investment" },
            "weights": {},
            "next": "q_focus"
          },
          { "id": "a_skip", "label_i18n": { "en": "Just browsing" }, "weights": {}, "next": null }
        ]
      },
      {
        "id": "q_focus",
        "prompt_i18n": { "en": "What is your focus?" },
        "answers": [
          {
            "id": "a_yield",
            "label_i18n": { "en": "Rental yield" },
            "weights": { "yield_hunter": 1 },
            "next": null
          },
          {
            "id": "a_flip",
            "label_i18n": { "en": "Flip / renovate" },
            "weights": { "flip_investor": 1 },
            "next": null
          }
        ]
      }
    ]
  }
}
```

The staff write path is `PUT /api/admin/tenants/quiz-definition?tenant_id=<uuid>` (ADR-0018 §3a
staff-atomic-audited, `action: 'quiz_definition.update'`).

**Staff quiz-definition API (FOLLOW-1362 C1, ESC-086 item 5).** All under
`/api/admin/tenants/quiz-definition`, staff-only via `resolveTenantAccess` with `?tenant_id=<uuid>`
as the single tenant fence. Reads: any staff rank. Writes: `estalara:ops`+ (decision Q-H; 403
otherwise), each ONE transaction whose first statement is
`pg_advisory_xact_lock(hashtext('quiz_definitions'), hashtext(tenant_id::text))`, then the
`max(version)` / active-row read, the mutation and the `staff_audit_log` row (rolled back together).
Audit payloads carry a version pair and `sha256` (`computeQuizDefinitionHash` of the serve-schema
parse), never the definition blob. History is append-only: no row is ever deleted or re-activated in
place. Response types are exported from each route file.

| Method + path                      | Body / query                                                                 | Result                                                                                                                                                                                                                       | Audit `action`                                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET …/quiz-definition`            | —                                                                            | `QuizDefinitionState`: `version`, `definition`, `warnings`, `can_write`, `lint`, `invalid_active` + `raw` (the stored JSON when the active row fails the serve schema)                                                       | —                                                                                                                  |
| `PUT …/quiz-definition`            | `{definition, base_version?: number \| null, source?: 'editor' \| 'import'}` | new version `max + 1`; 400 `validation_failed` with `issues[]` (lint codes) when `QuizDefinitionAuthoringSchema` fails (no write); 409 `version_conflict` when `base_version` is not the active version                      | `quiz_definition.update` `{before: {version, sha256}, after: {version, root, sha256, questions, answers}, source}` |
| `GET …/quiz-definition/versions`   | `&version=<n>` optional                                                      | newest 50 `{version, is_active, created_at, created_by, question_count, answer_count, sha256, valid}`; with `version`: that row + `definition`, `raw`, `lint` (404 when the tenant has no such version)                      | —                                                                                                                  |
| `PUT …/quiz-definition/activate`   | `{from_version, base_version: number \| null}`                               | restore = COPY of `from_version` as version `max + 1`, parsed with the SERVE schema only (lint returned, not enforced); 404 cross-tenant/missing, 409 `version_conflict` / `already_active`, 422 `invalid_source_definition` | `quiz_definition.restore` `{before, after, restored_from}`                                                         |
| `PUT …/quiz-definition/deactivate` | `{base_version?: number \| null}` optional                                   | active row set inactive → `GET /api/quiz/public-config` serves `DEFAULT_QUIZ_DEFINITION_V2`; 409 `no_active_definition` / `version_conflict`                                                                                 | `quiz_definition.revert_to_default` `{before: {version, sha256}, after: {version: null}}`                          |

Producer: `apps/control-plane/src/app/api/quiz/public-config/route.ts`. Consumer:
`packages/sdk/src/core/quiz-config.ts` (`fetchQuizConfig`) → `packages/sdk/src/index.ts`
(`mergeQuizConfig`) → `packages/sdk/src/ui/quiz-widget.ts` (the card auto-opens since FOLLOW-1015;
`quiz-trigger.ts` is now `quiz-session-state.ts` and holds the completed/dismissed flags only).
NOTE: the `quiz_placement` slice has had no SDK consumer since that change — see FOLLOW-1016.

## Quiz Accuracy Report (FOLLOW-1363, Faza Q package Q8)

`GET /api/admin/tenants/quiz-accuracy?tenant_id=<uuid>&from=&to=&definition_hash=&language=` —
staff-only (`resolveTenantAccess` with the staff override, any staff rank), read-only, computed on
read from `quiz_runs` (H002). Implements `docs/decisions/PREREG-quiz-accuracy-2026-10.md` §2–§4, §7.
Response type: `QuizAccuracyResponse` exported from the route file; arithmetic in
`apps/control-plane/src/lib/quiz-accuracy.ts`; SQL in `readQuizAccuracyData` (`lib/quiz-runs.ts`).
Consumer: the staff tab `/admin/tenants/[id]/quiz-accuracy` and the monthly watch
`GET /api/cron/quiz-accuracy-watch` (`CRON_SECRET`, Sentry warning).

### GET /api/cron/quiz-retention

FOLLOW-1364 (ESC-086 C6). Vercel Cron, daily `15 4 * * *` UTC,
`Authorization: Bearer ${CRON_SECRET}` (constant-time compare; unset secret = 401). Deletes
`quiz_runs` (`shown_at`) and `quiz_completions` (`created_at`) rows older than 13 months (CEO ruling
2026-10-20), tenant-agnostic, in batches of 5 000, idempotent. Response type `QuizRetentionResponse`
exported from the route file: 200
`{data_source: 'postgres', retention_months: 13, quiz_runs: {deleted, skipped?: 'table_missing'}, quiz_completions: {deleted}}`;
`data_source: 'not_configured'` when no database is set; 500 `quiz_retention_failed` plus one
sanitised Sentry exception. Localhost: invoke by hand with the secret; nothing schedules it.

- Every 200 carries `data_source: 'quiz_runs'`. A database without H002 answers 200
  `{available: false, code: 'quiz_runs_table_missing', message}` (never an empty report); a thrown
  read is 500 + Sentry. `from` is inclusive, `to` exclusive (ISO date or datetime, on `shown_at`).
- One `definition_hash` per report (the requested one, else the hash with the most decided rows in
  range); `definition_hashes[{hash, version, n}]` lists the choices. Decided = `confirmed` +
  `corrected`, `resolved_archetype <> 'neutral'`.
- `headline`: verdict over the FIRST 400 decided rows in DECISION order (`updated_at`, ties by id;
  PREREG Amendment 1 A3), `analysed_n`; `decided` counts all. `PASS` iff the Wilson 95 % lower bound
  ≥ 0.90 (372/400), `FAIL` otherwise at 400, `FUTILE` when the Wilson upper bound of the first 130
  or first 200 rows is < 0.90 (`futility_looks[]`), `INSUFFICIENT_N` below 400. `verdict_binding` is
  false when `from`, `to` or `language` narrows the sample (the tab then shows "SUBSET — not the
  verdict").
- `response_rate` (A1): decided / (non-neutral runs that reached the result screen) inside the
  ANALYSIS WINDOW (decision or last-status time ≤ that of the 400th decided row; everything while
  fewer than 400 are decided); a non-neutral run still `completed` there counts as not responding;
  valid at ≥ 0.60 (the tab shows a PASS as "PASS — VOID" otherwise). `pessimistic`: the same window
  with `unconfirmed` and abandoned `completed` runs counted as wrong (`unconfirmed`, `abandoned`).
  `all_decided`: all rows, monitoring only.
- Secondary (all decided rows, never gated): `per_leaf[]` (precision, recall, Wilson CIs,
  `claimable` at n_true ≥ 100, `flagged` when claimable and recall lower bound < 0.80),
  `macro_recall` (classes with ≥ 30 true labels), `confusion{labels, columns, matrix}` with a
  `none_of_these` column, `by_language`, `by_speed_tertile` (summed `step_ms`), `fast_yes`
  (`result_ms` < 1500 among confirmed, reported, never excluded), `monthly[]` with the §7 warn
  flags.
- Limitation: `quiz_runs` has no staff / ops-key marker, so only the tenant-level exclusion (harness
  tenant) is implemented; staff sessions on the production tenant cannot be told apart.

## Chat-Intent Shadow Key Contract (`shadow:{tenant_id}:{session_id}:chat_intent`)

Cross-runtime shared-cache contract. **Producer:** Python — `write_shadow_intent`
(`apps/intent-engine/src/redis_writer.py`), payload `ChatIntentDetectedPayload`
(`apps/intent-engine/src/schemas.py`). **Consumer:** TypeScript — `readShadowChatIntent` +
`flattenIntentDimensions` (`apps/control-plane/src/lib/chat-intent-cache.ts`), surfaced to the SDK
as `chat_intent_dimensions` on the `/api/adapt` response and folded into the archetype prior once
per session (`packages/sdk/src/core/adapt.ts:838-897`, Rule R). **Eraser:** `deleteShadowChatIntent`
(DSR Art. 17 cascade, FOLLOW-557). Store: Upstash Redis, TTL 86400s.

**Write-admission rule — ADR-0020 (PROPOSED; implementation FOLLOW-736, not at HEAD yet):** a
payload carrying no usable dimension (degraded _or_ neutral-success) is written with `SET … NX`, so
it can never overwrite, and never TTL-refresh, an accumulated prior. A payload carrying ≥1 usable
dimension is written with a plain `SET … EX`. The predicate is a content check, never a
`data_source` check.

**Nullability parity (both directions, enforced by
`tests/fixtures/chat-intent-signal-parity.json`):** Python emits explicit JSON `null` for every
unset dimension (`schemas.py:34-55`); TypeScript declares every field both optional and nullable
(`chat-intent-cache.ts:33-44`), so `null` and absent behave identically. A dimension "counts" iff it
survives `flattenIntentDimensions`: non-null, non-empty string, or boolean `true`.
**`tax_aware: false` is not a signal on either side.** Any future dimension that is neither `str`
nor `bool` must be added to both runtimes in the same PR.

**Example 1 — good extraction (overwrites, refreshes TTL):**

```json
{
  "tenant_id": "tnt_a1b2",
  "session_id": "sess_9f3c",
  "intent_dimensions": {
    "purchase_purpose": "investment",
    "urgency": "0-3mo",
    "budget_band": null,
    "family_stage": null,
    "geo_priority": null,
    "feature_priority": null,
    "cross_border": null,
    "finance_complexity": "cash",
    "decision_role": "decider",
    "risk_appetite": "aggressive",
    "emotional_state": "comparison_shopping",
    "tax_aware": true
  },
  "archetype_hint": "yield_hunter",
  "confidence": 0.85,
  "model_used": "haiku-4.5",
  "source": "realtime",
  "message_count": 3,
  "detected_at": "2026-07-30T10:00:00+00:00"
}
```

→ `SET shadow:tnt_a1b2:sess_9f3c:chat_intent <json> EX 86400`; SDK receives
`{purchase_purpose:"investment", urgency:"0-3mo", finance_complexity:"cash", decision_role:"decider", risk_appetite:"aggressive", emotional_state:"comparison_shopping", tax_aware:"true"}`.

**Example 2 — degraded extraction 40 s later (preserves Example 1 verbatim, TTL untouched):**

```json
{
  "tenant_id": "tnt_a1b2",
  "session_id": "sess_9f3c",
  "intent_dimensions": {
    "purchase_purpose": null,
    "urgency": null,
    "budget_band": null,
    "family_stage": null,
    "geo_priority": null,
    "feature_priority": null,
    "cross_border": null,
    "finance_complexity": null,
    "decision_role": null,
    "risk_appetite": null,
    "emotional_state": null,
    "tax_aware": null
  },
  "archetype_hint": "neutral",
  "confidence": 0.0,
  "model_used": "haiku-4.5",
  "source": "realtime",
  "message_count": 4,
  "detected_at": "2026-07-30T10:00:40+00:00",
  "data_source": "error_fallback",
  "extraction_error": "upstream_5xx"
}
```

→ `SET … NX` returns falsy, nothing is written, the Example-1 record and its remaining TTL survive;
the degradation is reported to Sentry and returned to the caller. Had the key been empty, this exact
record would have been stored (markers included) and the SDK would have applied nothing (`{}` fails
the `Object.keys(...).length > 0` guard).

**Known gap:** this payload has **no shared Zod schema** in `packages/shared` — the TypeScript side
is a hand-maintained mirror interface with a runtime `JSON.parse` + shape check
(`chat-intent-cache.ts:22-51, 113-124`). Tracked as **FOLLOW-737**. ADR-0020 does not change the
record shape, so it does not widen this gap, but it does not close it either.

## Auto-Detect Companion Bundle — REMOVED (FOLLOW-1265)

The `estalara-detect.iife.js` companion bundle, its `window.__EStalaraDetect` global, the
`GET /api/sdk-detect` route and the companion `<script>` tag in the install snippet were removed by
FOLLOW-1265 (WP-0.4, CEO ruling D4). Site detection runs server-side only, through
`POST /api/detect` (`detectSiteSchema` from `@estalara/sdk/auto-detect`); the SDK `init()` no longer
reads any detect global. Tenant snippets installed before the removal may still carry the old tag —
its 404 is harmless and the tag can be deleted.

The server-side path was removed in turn by FOLLOW-1328 (ESC-085): `POST /api/detect`,
`POST /api/schema/activate`, the `@estalara/sdk/auto-detect` and
`@estalara/sdk/auto-detect/ai-vision` sub-path exports and the `DetectionResult` type export of
`@estalara/sdk` no longer exist.

## Consent-Banner Text Document (ACCEPTED — ADR-0021 / FOLLOW-915)

```
GET {CONTROL_PLANE_URL}/consent-text.json
→ 200 OK
Access-Control-Allow-Origin: *                                  (REQUIRED — cross-origin fetch)
Cache-Control: public, max-age=300, stale-while-revalidate=60
Content-Type: application/json; charset=utf-8
```

All three response headers are produced by the `headers()` rule in
`apps/control-plane/next.config.mjs` and asserted against the **deployed** origin by
`scripts/check-consent-text-headers.sh` (FOLLOW-935). `Access-Control-Allow-Origin` is load-bearing,
not decorative: the SDK executes on the TENANT's origin, so this fetch is cross-origin, and without
the header the browser discards the response and the banner never renders (FOLLOW-929).
`Content-Type` is listed here for the first time at FOLLOW-935 — the rule had been emitting it while
it appeared in no contract, so there was nothing for it to drift from.

The banner copy is served OUT OF THE SDK BUNDLE. ESC-051's ruling states why: **consent text grows
from regulation, not from engineering, and must never compete with code for a performance budget.**
Moving it returned ~1,345 gzip bytes to the SDK: **42,997 → 41,652 bytes, headroom ~11 → 1,356**,
measured at `25cff8bc`. **These are dated observations, not standing facts** — at `31cab8b4` the
same measurement reads 41,641 B / **1,367 B** headroom, because FOLLOW-931 touched
`packages/shared`. Single-digit-byte drift on any merge is normal; the gate now prints bytes and
headroom itself (FOLLOW-932), so **run it rather than quoting this line**. The `42,997` before-
figure is derived from a KB-only gate output, so its true value lies in **`[42,993, 43,002]`**
(**−4/+5** around the quoted 42,997) — enumerated by brute force over every integer byte count that
`(x / 1024).toFixed(2)` renders as `41.99`. _RETRO-265 proposed `−4/+0` on the premise that the
reading was truncated; `toFixed` **rounds**, so that correction was wrong in both the mechanism and
the upper bound, and the original `±5` was substantially right._ This imprecision is the very defect
FOLLOW-932 closed: the gate now prints the byte count, so nothing downstream has to invert a
rounding. Those figures are `zlib.gzipSync`, which is what
`packages/sdk/scripts/check-bundle-size.js` actually enforces. An earlier revision of this line
quoted CLI `gzip -c` (level 6) and read 1,433 — measuring a budget with a different compressor than
the gate uses overstates the headroom, and this line had been held up as the number to scope
FOLLOW-913/898 against (RETRO-264 DG-1).

- **Schema:** `ConsentTextDocumentSchema` / `ConsentTextLocaleSchema` in
  `packages/shared/src/schemas/consent-text.ts` (11 test cases). Locale-entry fields are derived
  field-for-field from the `COPY` constant that shipped in the SDK before FOLLOW-915.
- **Wire example:** `packages/shared/src/examples/consent-text.ts`. The served artefact
  (`apps/control-plane/public/consent-text.json`) is validated against the schema AND asserted
  field-for-field equal to the example by `packages/shared/src/schemas/consent-text.test.ts`, so the
  contract and the bytes a visitor receives cannot drift.
- **URL:** `CONSENT_TEXT_URL` in `packages/shared/src/domains.ts` — compile-time constant, never
  derived from a snippet dataset value.
- **Forward compatibility:** unknown top-level fields are stripped, not rejected. A missing required
  field or a wrong `schema_version` fails validation. Every `QuizLanguage` locale is REQUIRED
  (`z.record` with an enum key rejects unknown keys but does not require known ones — an explicit
  refinement does).

**The request shape is a compliance contract, not a style choice (ADR-0021 §D3).** No tenant id, api
key or `Authorization`; no session, visitor or consent-state identifier; no query parameters;
`credentials: 'omit'`; a URL byte-identical for every tenant and every visitor. The lawfulness
analysis that permits this fetch BEFORE consent — ePrivacy Art. 5(3) / PECR 6(4) strictly-necessary,
since a notice whose display required consent would be circular — collapses the moment the request
carries any identifier. Parameterizing it (per-tenant text, locale in the URL, A/B arms) requires a
NEW ADR plus compliance review. `scripts/check-adr-0021-conditions.mjs` asserts the shape on every
PR.

**Ordering and failure (§D2/§D4).** Fetched on the `pending` consent path ONLY — a returning visitor
pays no extra request — and AWAITED before the banner renders, so no event, storage write or
tenant-identified request can precede the visitor's decision. On error, non-2xx, 3000 ms timeout or
validation failure the SDK FAILS CLOSED: no banner, nothing processed, consent stays `pending` and
the next page load retries. **No fallback text ships in the bundle** — a trimmed fallback would
recreate the ESC-051 defect, and consent obtained on an incomplete disclosure is not "informed"
under GDPR Art. 4(11)/Art. 7. Proven by `packages/sdk/src/__tests__/follow-915.test.ts`, which
drives the real `init()`.

## DSR Endpoint

`POST /api/v1/dsr/:tenant_id` — implemented in TICKET-GDPR-002. Input/output schema documented in
`backlog/sprint-9/TICKET-GDPR-002.md`.
