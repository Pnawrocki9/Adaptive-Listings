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
consumer reading behavioral events from Redpanda must import from `@estalara/shared`.

## Decision API Contract

Canonical endpoint: `https://admin.estalara.com/api/adapt` (ADR-0004, ADR-0006, ADR-0007).
Implemented in `apps/control-plane/src/app/api/adapt/route.ts`.

Adaptation directive response schema: `packages/shared/src/directives.ts` (`AdaptationDirectives`
type). SDK validates responses against the mirror Zod schema at
`packages/sdk/src/core/adapt-schema.ts`. CI Rule H (`scripts/check-adapt-schema-drift.sh`) asserts
the two stay in sync.

The Cloudflare Worker route (`apps/decision-api/src/app/api/adapt/route.ts`) is retired — it returns
`410 Gone` since 2026-05-25. Phase 2 full deletion is tracked by FOLLOW-107.

SDK loader contract: every embed snippet MUST include
`data-decision-url="https://admin.estalara.com/api"` (the SDK appends `/adapt` at call time). See
`apps/control-plane/src/components/onboarding/DetectionPreview.tsx:129` (`buildSnippet()`).

(TICKET-GDPR-004 adds `consent_state` field to directive request.)

## Quiz Public Config Contract (ACCEPTED — ADR-0011 / FOLLOW-275)

SDK runtime config endpoint. Called by the SDK at init time (after consent, before quiz/micro-poll
schedulers fire) to fetch post-activation-mutable quiz/widget config without requiring a snippet
reinstall.

Endpoint: `GET https://admin.estalara.com/api/quiz/public-config`

Auth: `Authorization: Bearer <tenant-api-key>` (the `data-api-key` from the embed snippet). CORS:
open (`*`). Cache-Control: `max-age=300, stale-while-revalidate=60`.

Response (200):

```json
{
  "quiz_enabled": true,
  "micro_polls_enabled": false,
  "language": "en",
  "accent_color": "#2563EB"
}
```

All four ADR-0011 core fields are non-nullable. SDK timeout budget: 1000 ms. On error/timeout the
SDK falls back to snippet dataset attributes (DEPRECATED_FALLBACK) then to hardcoded defaults. The
canonical Zod schema is `QuizPublicConfigResponseSchema` in
`packages/shared/src/schemas/quiz-config.ts` (≥5 test cases, FOLLOW-275).

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
D4 color precedence (`quiz_config.accent_color` > `brand.primary_color` > SDK default): the sticky
quiz-trigger background uses `brand.primary_color` (else the hardcoded `#ef4444`); the quiz card
shows `brand.logo_url` atop it (none when null). `white_label` is parsed/exposed but not yet
consumed by FOLLOW-623 (colors/logo only).

Example 1 — fully-populated branded tenant (200):

```json
{
  "quiz_enabled": true,
  "micro_polls_enabled": true,
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
  "micro_polls_enabled": false,
  "language": "en",
  "accent_color": "#2563EB",
  "data_source": "db"
}
```

```json
{
  "quiz_enabled": true,
  "micro_polls_enabled": false,
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
  "micro_polls_enabled": false,
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

Producer: `apps/control-plane/src/app/api/quiz/public-config/route.ts`. Consumer:
`packages/sdk/src/core/quiz-config.ts` (`fetchQuizConfig`) → `packages/sdk/src/index.ts`
(`mergeQuizConfig`) → `packages/sdk/src/ui/quiz-trigger.ts` + `quiz-widget.ts`.

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

## Auto-Detect Companion Bundle — `window.__EStalaraDetect` (FOLLOW-325)

The auto-detect companion is a separate IIFE bundle that extends the main SDK's cold-start
site-level archetype detection without adding to the mandatory 40 KB gzip budget.

### Serving

Bundle artifact: `apps/control-plane/public/estalara-detect.iife.js` Canonical URL:
`https://admin.estalara.com/estalara-detect.iife.js` Served as: Vercel static asset from `public/`
(same mechanism as `sdk.js`) Size (once PR #308 merges): ~12.43 KB gzip

Dev fallback route: `GET /api/sdk-detect` — reads from `packages/sdk/dist/estalara-detect.iife.js`;
returns an empty JS comment when the SDK has not been built (pre-PR #308).

### Interface contract

The companion IIFE assigns the following global on the browser `window` object:

```ts
interface EStalaraDetect {
  /**
   * Run all detection techniques against the current page DOM and return a
   * TenantSiteSchema candidate. Called by the main SDK `init()` on cold start
   * when window.__EStalaraDetect is present.
   * Mirrors the server-side `detectSiteSchema` from `@estalara/sdk/auto-detect`.
   */
  detectSiteSchema: (opts?: { debug?: boolean }) => Promise<DetectionResult | null>;

  /**
   * Extract archetype hints from the current page (framework detection, JSON-LD
   * signals, etc.) for use in the cold-start intent seed.
   * Mirrors `extractArchetypeHints` from `@estalara/sdk/auto-detect`.
   */
  extractArchetypeHints: () => ArchetypeHint[];
}

declare global {
  interface Window {
    __EStalaraDetect?: EStalaraDetect;
  }
}
```

The companion is built by `packages/sdk/src/auto-detect/detect-bundle.ts` (added in PR #308). The
concrete `DetectionResult` and `ArchetypeHint` types are exported from `@estalara/sdk/auto-detect`.

### Load ordering

The snippet generator (`buildSnippet()` in
`apps/control-plane/src/components/onboarding/DetectionPreview.tsx`) emits the companion tag BEFORE
the main SDK tag. Both tags have no `async` or `defer` attribute, which guarantees that the browser
executes them in source order:

```html
<script src="https://admin.estalara.com/estalara-detect.iife.js"></script>
<script
  src="https://admin.estalara.com/sdk.js"
  data-tenant-id="..."
  data-api-key="..."
  data-decision-url="https://admin.estalara.com/api"
></script>
```

When the companion is absent or fails to load, `window.__EStalaraDetect` is undefined and the main
SDK `init()` skips cold-start archetype hints silently — adaptation still works via the server-side
schema on the first adapt request.

### Default ON / opt-out

Companion emission is default ON for all Tier 1+2 tenants (CEO product decision 2026-06-15).
Per-tenant opt-out is deferred to FOLLOW-331 (requires a `detect_companion_disabled` column on the
`tenants` table and a dashboard toggle).

Tier 3 (Native `<EstalaraListing/>`) does NOT use the companion. Tier 3 tenants own the entire
listing DOM via the `<EstalaraListing/>` component, so site-level auto-detection is not meaningful —
there is no third-party DOM to introspect. The Tier 3 onboarding path (when implemented) will
suppress the companion tag via a tenant flag. Tracked by FOLLOW-332.

### Depends on

PR #308 (`sdk-engineer/FOLLOW-324-sdk-bundle-size`) — this interface is PENDING until that PR merges
and `packages/sdk/dist/estalara-detect.iife.js` is copied to
`apps/control-plane/public/estalara-detect.iife.js`.

## DSR Endpoint

`POST /api/v1/dsr/:tenant_id` — implemented in TICKET-GDPR-002. Input/output schema documented in
`backlog/sprint-9/TICKET-GDPR-002.md`.
