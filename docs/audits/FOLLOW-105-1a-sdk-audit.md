# FOLLOW-105 Substep 1a: SDK / Snippet / Endpoint Audit

**Ticket:** FOLLOW-105 substep 1a **Date:** 2026-05-25 **Status:** audit-only / read-only — zero
code changes made **Branch:** feat/follow-105-1a-sdk-audit

## Executive Summary

**Section A:** The snippet generator (`buildSnippet()` in `DetectionPreview.tsx`) emits
`https://cdn.estalara.com/sdk.js` with `data-tenant-id` and `data-api-key` only — it omits
`data-decision-url` entirely. Because the SDK treats a missing `data-decision-url` as "directives
disabled" (returns null from `fetchDirectives()`), every tenant snippet generated through the
onboarding wizard will silently disable adaptation today. This is a **[BLOCKER]**.

**Section B:** `app.estalara.com` returned content from what appears to be a separate SvelteKit
product (Rafal's listing portal, per `packages/shared/src/domains.ts` note); no Estalara SDK script
tag was found in the page source. Live snippet verification must be deferred to TICKET-PILOT-001.

**Section C:** The Worker `/api/adapt` handler in `apps/decision-api/src/app/api/adapt/route.ts` has
no structured request logging, no Sentry import, and no Cloudflare Analytics binding. The only
Sentry reference is a `globalThis.Sentry?.captureException` fire-and-forget for the `ab.assignment`
emit path — it does not log incoming requests. Traffic volume and request sources for the last 7
days are unknowable from the repo.

**Section D:** The ADR-0004 documented response contract (9 fields) does not match what the live
control-plane `POST /api/adapt` actually returns (7 fields, all differently named). Every single
ADR-0004 field name is either renamed or absent in the live implementation. The live response type
(`AdaptationDirectives`) is authoritative and the ADR block is entirely stale.

**Section E:** Because the snippet generator omits `data-decision-url`, substep 1c (Worker 410 Gone)
is insufficient alone — substep 1b must also fix `buildSnippet()` to emit the canonical
control-plane URL. The ADR-0004 contract drift is total; substep 1b scope must include a complete
replacement of the documented contract block.

**Section F:** Three distinct risk items found beyond the core blocker: (1) the live `AdaptResponse`
type the SDK parses (`packages/sdk/src/core/adapt.ts`) does not match the actual
`AdaptationDirectives` type the control-plane returns — field names conflict even today; (2) the
demo mockup layout hardcodes `data-decision-url="/api"` (a relative path, not the canonical absolute
host); (3) `packages/shared/src/domains.ts` exports a `DECISION_API_URL` constant
(`https://decision.estalara.com`) that names the deprecated Worker, not the control-plane — this
constant must not be used by any future snippet generator.

---

## Section A: Snippet Generator Location and Emitted Host

### A.1 Locating the Generator — Resolving the Discrepancy

**ADR-0006 candidate:** `apps/control-plane/src/lib/tenant-schema.ts` **FOLLOW-105 stub candidate:**
`apps/control-plane/src/lib/sdk-snippet.ts`

Neither file contains a snippet generator. `tenant-schema.ts` exists and contains
`getTenantSchema()` (Redis + Postgres schema lookup) — no snippet logic. `sdk-snippet.ts` does not
exist in the repository at all.

The actual snippet generator is:

```
apps/control-plane/src/components/onboarding/DetectionPreview.tsx
```

Function name: `buildSnippet(tenantId: string, apiKey: string): string` — line 96.

This is a React component function, not a lib utility. It is called at line 137:

```ts
// DetectionPreview.tsx:137
const snippet = activated !== null ? buildSnippet(snippetTenantId, activated.api_key) : '';
```

`activated` is set from the response of `POST /api/schema/activate` (line 157), which returns
`{ api_key: string, tenant_id: string }`.

### A.2 What Does the Generator Emit?

```ts
// apps/control-plane/src/components/onboarding/DetectionPreview.tsx:96-98
function buildSnippet(tenantId: string, apiKey: string): string {
  return `<script\n  src="https://cdn.estalara.com/sdk.js"\n  data-tenant-id="${tenantId}"\n  data-api-key="${apiKey}"\n></script>`;
}
```

The emitted snippet:

```html
<script src="https://cdn.estalara.com/sdk.js" data-tenant-id="<uuid>" data-api-key="<key>"></script>
```

**`data-decision-url` is NOT present.** The generator emits only `data-tenant-id` and
`data-api-key`. The `src` host (`https://cdn.estalara.com/sdk.js`) is hardcoded — not env-driven,
not per-tenant configurable.

There is no conditional logic (no dev/stg/prd branching). The string is a compile-time template
literal with no environment substitution.

The `src` URL is hardcoded and does not use the `SDK_CDN_URL` constant exported from
`packages/shared/src/domains.ts:17`, which is a separate finding noted in RETRO entry at
`backlog/RETROSPECTIVES.md:1450`.

### A.3 Origin Trace

| Value                                   | Hardcoded / Env-driven / Per-tenant     | Source                               |
| --------------------------------------- | --------------------------------------- | ------------------------------------ |
| `src="https://cdn.estalara.com/sdk.js"` | Hardcoded string literal                | `DetectionPreview.tsx:97`            |
| `data-tenant-id` value                  | Per-tenant — from `activated.tenant_id` | `POST /api/schema/activate` response |
| `data-api-key` value                    | Per-tenant — from `activated.api_key`   | `POST /api/schema/activate` response |
| `data-decision-url`                     | **MISSING** — not emitted               | N/A                                  |

**The emitted snippet does not point at the control-plane OR the Worker. It points at neither —
`data-decision-url` is absent, which disables the adapt fetch entirely.**

### A.4 SDK Consumption Side — Exact Line Numbers

**`packages/sdk/src/core/config.ts`:**

- Line 80: `const decisionApiUrl = script.dataset.decisionUrl;`
  - Reads the `data-decision-url` attribute (camelCase: `dataset.decisionUrl`).
- Lines 91-93: `...(decisionApiUrl !== undefined ? { decisionApiUrl } : {}),`
  - If `data-decision-url` is absent from the `<script>` tag, `decisionApiUrl` is `undefined` and is
    NOT set on the returned `SdkConfig`.

**`packages/sdk/src/core/adapt.ts`:**

- Line 475: `if (!config.decisionApiUrl) return null;`
  - First guard in `fetchDirectives()`. When `decisionApiUrl` is absent (because the snippet omitted
    it), the function returns `null` immediately — no adapt request is made.
- Line 507: `const res = await fetch(\`${config.decisionApiUrl}/adapt\`, { ... });`
  - This line is only reached when `decisionApiUrl` is set. The URL appends `/adapt` to whatever
    host was written into `data-decision-url`.

The data flow is:

```
<script data-decision-url="...">
  → config.ts:80 reads dataset.decisionUrl
  → config.ts:91 sets decisionApiUrl on SdkConfig (only if attribute present)
  → adapt.ts:475 guards on config.decisionApiUrl — returns null if absent
  → adapt.ts:507 fetch(config.decisionApiUrl + "/adapt") — only if present
```

The approximate line numbers in ADR-0006 (`:80` for config.ts and `:507` for adapt.ts) are
**accurate**. The actual lines are config.ts:80 and adapt.ts:507.

---

## Section B: Deployed app.estalara.com Actual Snippet

A `WebFetch` request was made against `https://app.estalara.com`.

**Result:** The page returned content consistent with a separate SvelteKit listing portal product
(navigation, price filters, "Saved Offers", "Livestreams"). No `<script>` tags with
`data-decision-url`, `data-tenant-id`, `data-api-key`, or `src` pointing to `cdn.estalara.com` or
`sdk.js` were found in the returned HTML.

This is consistent with `packages/shared/src/domains.ts:8` which states:

> NOTE: app.estalara.com belongs to Rafal's separate SvelteKit product — not this control plane. The
> control plane (Next.js/Vercel) lives at admin.estalara.com.

The pilot embed (if any) would be on a tenant site loading the SDK from the customer's own page, not
on `app.estalara.com` itself. The control-plane dashboard lives at `admin.estalara.com`.

**Action required by TICKET-PILOT-001:** Verify the actual snippet on the pilot tenant's listing
page during shadow-mode setup. This audit cannot determine the live value.

---

## Section C: Worker /api/adapt Traffic Profile (Last 7 Days)

### C.1 Monitoring Infrastructure in the Worker

Reviewed `apps/decision-api/src/app/api/adapt/route.ts` (447 lines) for monitoring:

| Monitoring type                                       | Present?      | Notes                                                                                    |
| ----------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------- |
| Sentry import (`import * as Sentry`)                  | No            | Not imported                                                                             |
| Structured request logging (`console.log` on request) | No            | Zero request-level logs                                                                  |
| Cloudflare Analytics Engine binding                   | No            | Not in `Env` interface (`apps/decision-api/src/index.ts`)                                |
| Per-request ClickHouse logging                        | No            | Only `apps/control-plane` adapt route has ClickHouse logging                             |
| Sentry `captureException` on `/api/adapt` path        | Indirect only | Used in the `ab.assignment` fire-and-forget emission path only — not for request ingress |
| Redpanda event emission for adapt requests            | No            | `ab.assignment` events emitted, but not adapt request telemetry                          |

The only Sentry reference in the Worker is:

```ts
// apps/decision-api/src/app/api/adapt/route.ts:387-388
const gSentry = (globalThis as { Sentry?: GlobalSentry }).Sentry;
gSentry?.captureException(err, { tags: { ab_assignment_emit_failed: true } });
```

This fires only on `ab.assignment` publish failures, not on incoming adapt requests.

### C.2 GAP Assessment

**GAP:** No structured logging exists for Worker `/api/adapt` requests. Request volume, source IPs,
and User-Agents for the last 7 days are unknowable from this repo. Cloudflare's dashboard may have
aggregate Worker invocation metrics, but those are not accessible here.

**Recommendation for substep 1c (Phase 1 — 410 Gone with logging):** The 410 Gone response handler
must add structured request logging at the point of deprecation. Per ADR-0006 §Decision 3, the log
must capture:

- Caller identity: `User-Agent` header (external callers)
- Stack context: `Referer` header (browser-sourced calls)
- Timestamp and tenant_id (from request body, best-effort)

Without this logging, the Phase-1 monitoring window will be blind. The 7-day window after Phase-1
that gates Phase-2 retirement (FOLLOW-107) requires at least one data point to confirm zero traffic
— that data point cannot come from Cloudflare analytics alone if the Worker has no explicit
per-request logging.

**This informs FOLLOW-107 Phase-2 retirement decision in Sprint 14:** If logging is not added in
substep 1c, the Sprint 14 retirement decision will have no empirical basis.

---

## Section D: ADR-0004 Contract vs Live Response Drift

### D.1 ADR-0004 Documented Contract (lines 74-83)

| ADR-0004 field         | ADR-0004 type                        |
| ---------------------- | ------------------------------------ |
| `adapt_decision_id`    | string (uuid)                        |
| `archetype`            | string (one of 18 known IDs)         |
| `archetype_confidence` | number (0–1)                         |
| `holdout`              | boolean                              |
| `variant_index`        | number (0, 1, or 2)                  |
| `directives`           | `ReorderDirective[]`                 |
| `slot_copy`            | `Record<string, string>`             |
| `timing_ms`            | `{ path: string, total_ms: number }` |
| `explainability_id`    | string (links to provenance audit)   |

### D.2 Live Control-Plane Response Shape

The `POST /api/adapt` handler in `apps/control-plane/src/app/api/adapt/route.ts` returns the
`AdaptationDirectives` type (defined in `packages/shared/src/directives.ts:110-155`):

| Live field     | Live type                                                 |
| -------------- | --------------------------------------------------------- |
| `session_id`   | string                                                    |
| `archetype`    | `ArchetypeId \| 'neutral'`                                |
| `confidence`   | number (0–1)                                              |
| `similarity`   | number (0–1)                                              |
| `tier`         | `1 \| 2 \| 3`                                             |
| `directives`   | `(TextDirective \| ClassDirective \| ReorderDirective)[]` |
| `source`       | string enum (6 values)                                    |
| `variant`      | string (optional)                                         |
| `generated_at` | string (ISO 8601)                                         |

Note: `holdout_group` also appears in holdout-arm responses (from the `POST` handler body
construction at line 599/609), but is not part of the formal `AdaptationDirectives` type.

### D.3 Field-by-Field Comparison

| ADR-0004 field         | Live field                    | Status                                                                                                                                |
| ---------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `adapt_decision_id`    | (none)                        | MISSING-IN-LIVE — no UUID identity field                                                                                              |
| `archetype`            | `archetype`                   | MATCH (name matches; type extended to include `'neutral'`)                                                                            |
| `archetype_confidence` | `confidence`                  | RENAMED (`archetype_confidence` → `confidence`)                                                                                       |
| `holdout`              | `holdout_group` (conditional) | RENAMED + OPTIONAL (boolean, in holdout path only)                                                                                    |
| `variant_index`        | `variant`                     | RENAMED + TYPE-MISMATCH (`number 0/1/2` → `string 'control'/'v1'/'v2'`)                                                               |
| `directives`           | `directives`                  | PARTIAL-MATCH (name matches; ADR says `ReorderDirective[]` only; live uses `(TextDirective \| ClassDirective \| ReorderDirective)[]`) |
| `slot_copy`            | (none)                        | MISSING-IN-LIVE                                                                                                                       |
| `timing_ms`            | (none)                        | MISSING-IN-LIVE                                                                                                                       |
| `explainability_id`    | (none)                        | MISSING-IN-LIVE                                                                                                                       |
| (none)                 | `session_id`                  | EXTRA-IN-LIVE                                                                                                                         |
| (none)                 | `similarity`                  | EXTRA-IN-LIVE                                                                                                                         |
| (none)                 | `tier`                        | EXTRA-IN-LIVE                                                                                                                         |
| (none)                 | `source`                      | EXTRA-IN-LIVE                                                                                                                         |
| (none)                 | `generated_at`                | EXTRA-IN-LIVE                                                                                                                         |

**Drift magnitude: TOTAL.** Of the 9 ADR-0004 fields, only 1 (`archetype`) has an exact name match.
4 are renamed, 4 are completely absent from the live implementation. The live response adds 5 fields
not mentioned in ADR-0004. The documented contract is a different API from what ships.

### D.4 SDK AdaptResponse vs Live Shape

There is a secondary drift: the SDK's internal `AdaptResponse` interface
(`packages/sdk/src/core/adapt.ts:154-167`) is also misaligned with the live `AdaptationDirectives`:

| SDK AdaptResponse field | Live AdaptationDirectives field | Status                                   |
| ----------------------- | ------------------------------- | ---------------------------------------- |
| `session_id`            | `session_id`                    | MATCH                                    |
| `archetype`             | `archetype`                     | MATCH                                    |
| `confidence`            | `confidence`                    | MATCH                                    |
| `directives`            | `directives`                    | MATCH (union type compatible)            |
| `ttl_seconds`           | (none)                          | EXTRA-IN-SDK (live does not return this) |
| `variant`               | `variant`                       | MATCH                                    |
| (none)                  | `similarity`                    | MISSING-IN-SDK                           |
| (none)                  | `tier`                          | MISSING-IN-SDK                           |
| (none)                  | `source`                        | MISSING-IN-SDK                           |
| (none)                  | `generated_at`                  | MISSING-IN-SDK                           |

The SDK treats the response as `data as AdaptResponse` (adapt.ts:519 — cast without validation), so
missing fields are silently undefined. The `ttl_seconds` field the SDK reads is never returned by
the live route. This is a secondary finding but does not affect functional behavior given the cast
approach.

---

## Section E: Recommendations for Substep 1b and 1c

### E.1 Does the Snippet Generator Already Emit the Canonical Control-Plane URL?

**No.** The snippet generator emits neither the control-plane URL nor the Worker URL.
`data-decision-url` is entirely absent from the generated snippet. This means:

- Every tenant onboarded via the Magic Link wizard today has a snippet that silently disables
  adaptation (SDK returns `null` from `fetchDirectives()` at adapt.ts:475).
- Substep 1c (Worker 410 Gone) alone is insufficient. The SDK will never reach the Worker OR the
  control-plane until `buildSnippet()` is fixed.
- Substep 1b must include a code change to `buildSnippet()` in `DetectionPreview.tsx` to emit
  `data-decision-url="https://admin.estalara.com"` (using the `CONTROL_PLANE_URL` constant from
  `packages/shared/src/domains.ts:34`).

### E.2 Worker Traffic Volume Assessment

Unknowable from this repo. The Worker has no request-level logging. See Section C.2.

**Confidence in the Phase-1 410-Gone approach:** Medium. The missing-`data-decision-url` finding
suggests that any tenant who went through the wizard's onboarding flow has never been sending
requests to the Worker either — their SDK is not calling `/api/adapt` at all. There may be a small
population of manually configured tenants or development/demo sessions (such as the mockup layout
which hardcodes `data-decision-url="/api"`) that do reach the Worker. The 410 Gone approach is still
correct, but the logging added in substep 1c is essential to determine actual traffic before Phase-2
retirement.

### E.3 ADR-0004 Contract Drift Scope for Substep 1b

The drift is total. Per ADR-0006 §Decision 5 ("live wins"), substep 1b must:

1. Replace the ADR-0004 "Documented response contract (canonical)" block (lines 73-83) entirely with
   the live `AdaptationDirectives` field list from `packages/shared/src/directives.ts`.
2. Add a revision note: "Updated 2026-05-25 to reflect live implementation; original draft contract
   preserved in git history."
3. Note the `adapt_decision_id` absence (the live route generates no stable UUID for a decision —
   `session_id` is the closest analog). If `adapt_decision_id` is needed for the pilot's
   explainability audit trail, it is a new field requirement, not a rename.
4. Note the `explainability_id` absence — this was in the ADR-0004 contract but is not implemented.
   ADR-0006 must record this as deferred.

### E.4 Recommended Spawn Order for Phase 2 (Lane A Tickets)

Based on A–D, the recommended order is:

1. **Substep 1b (first):** Fix `buildSnippet()` + update ADR-0004 contract block + flip ADR-0006 to
   ACCEPTED. This is the prerequisite for everything else — without it, no tenant is reaching either
   endpoint.
2. **Substep 1c (second):** Implement Worker 410 Gone WITH structured request logging. The logging
   must be in place before the monitoring window starts.
3. **Substep 1d (third):** Add CI Rule H/J gate. Can only be written after 1b defines what "correct
   canonical URL" means in the snippet.
4. **FOLLOW-107 (Sprint 14):** Phase-2 full retirement. Only after the 7-day monitoring window from
   1c confirms zero (or accounted-for) traffic.

---

## Section F: Risks, Surprises, and Blockers

### [BLOCKER] F.1 Snippet Generator Omits data-decision-url

**Finding:** `buildSnippet()` at `DetectionPreview.tsx:96-98` does not emit `data-decision-url`.

**Impact:** Every tenant who completed the Magic Link onboarding wizard received a snippet that
silently disables adaptation. The SDK reads `data-decision-url` at `config.ts:80` and guards on it
at `adapt.ts:475` — absent means no adapt request is ever made. The pilot would have zero
personalization today for any tenant onboarded via the wizard, regardless of which endpoint is
canonical.

**Fix required in substep 1b:** `buildSnippet()` must be updated to emit
`data-decision-url="https://admin.estalara.com"` (the control-plane host, using `CONTROL_PLANE_URL`
from `packages/shared/src/domains.ts:34`).

### [BLOCKER] F.2 Demo Mockup Layout Uses Relative data-decision-url

**Finding:** `apps/control-plane/src/app/dashboard/demo/mockup/layout.tsx:29` sets:

```tsx
data-decision-url="/api"
```

This is a relative path, not an absolute host. Per `adapt.ts:507`, the fetch becomes: `/api/adapt` —
a same-origin call to `admin.estalara.com/api/adapt`. This happens to hit the canonical
control-plane endpoint for the demo (correct behavior), but only because the demo runs within the
control-plane's own origin. If this pattern is ever copied to an external tenant snippet, it would
resolve against the tenant's domain (wrong). The comment in the file acknowledges this construction
("the SDK appends '/adapt' itself") but uses a relative path instead of the absolute host. This
should be corrected to the absolute URL in substep 1b.

### [RISK] F.3 DECISION_API_URL Constant Names the Deprecated Worker

**Finding:** `packages/shared/src/domains.ts:28-30` exports:

```ts
export const DECISION_API_DOMAIN = 'decision.estalara.com' as const;
export const DECISION_API_URL = `https://${DECISION_API_DOMAIN}` as const;
export const DECISION_API_ENV = 'ESTALARA_DECISION_API_URL' as const;
```

`decision.estalara.com` is the Worker domain (the deprecated path). `DECISION_API_URL` must not be
used as the value for `data-decision-url` in any snippet generator. The correct constant for the
canonical endpoint is `CONTROL_PLANE_URL` (`https://admin.estalara.com`). Substep 1b should add a
deprecation comment to `DECISION_API_URL` or remove the constant.

### [RISK] F.4 Zero Traffic Visibility Before 410 Gone Deployment

**Finding:** The Worker has no per-request logging. Any traffic to Worker `/api/adapt` today is
invisible. Without logging, the Phase-1 monitoring window is blind and FOLLOW-107 Sprint-14
retirement decision has no empirical basis. Structured logging must be added as part of the 410 Gone
implementation in substep 1c (not as a follow-up).

### [RISK] F.5 SDK AdaptResponse Type Not Validated Against Live Contract

**Finding:** `adapt.ts:519` casts the response as `data as AdaptResponse` without Zod validation.
The SDK's `AdaptResponse` interface includes `ttl_seconds` (not returned by the live route) and
omits `similarity`, `tier`, `source`, and `generated_at`. The cast silently swallows mismatches.
This is an existing gap noted in the RETRO log. It is not a blocker for substep 1b/1c but should be
tracked: the SDK should validate the adapt response against a Zod schema derived from
`AdaptationDirectives` in `packages/shared`.

### [INFORMATIONAL] F.6 adapt_decision_id and explainability_id Are Not Implemented

**Finding:** ADR-0004 specifies `adapt_decision_id` (UUID per decision) and `explainability_id`
(link to provenance audit). Neither field exists in the live `AdaptationDirectives` type or is
returned by the control-plane route. If the pilot requires explainability audit trail (per Master
Design §E.1), a new ticket is needed to add these fields. Substep 1b should document them as
"deferred / not implemented" in the updated ADR-0004 contract block, not silently drop them.

### [INFORMATIONAL] F.7 File-Structure Surprises Affecting FOLLOW-105 Estimate

- `sdk-snippet.ts` does not exist. The stub ticket's filename reference is wrong.
- `tenant-schema.ts` exists but contains schema lookup, not snippet generation.
- The actual generator is buried in a React component (`DetectionPreview.tsx`) rather than a
  standalone lib utility. This means the `buildSnippet()` fix in substep 1b is a component edit
  inside a TSX file, not a pure TypeScript utility. It does not change the effort estimate
  materially, but the PR diff will touch a client component.
- The `app.estalara.com` domain is a separate product and is not the right verification target. The
  control-plane dashboard is at `admin.estalara.com`. TICKET-PILOT-001 should verify the snippet on
  the pilot tenant's listing page, not on `app.estalara.com`.
