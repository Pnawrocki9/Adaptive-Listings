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

All fields non-nullable. SDK timeout budget: 1000 ms. On error/timeout the SDK falls back to snippet
dataset attributes (DEPRECATED_FALLBACK) then to hardcoded defaults. The canonical Zod schema must
be added to `packages/shared/src/schemas/quiz-config.ts` as `QuizPublicConfigResponseSchema` with ≥5
test cases as part of FOLLOW-275 implementation (ADR-0011 guardrail for accepted interfaces).

Status: ACCEPTED (ADR-0011 at `docs/adr/ADR-0011-quiz-config-transport.md`, PR #269 merged
2026-06-11).

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
