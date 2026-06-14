# ADR-0013 — Tracer admin SSE auth and admin config-read contract (FOLLOW-309 / FOLLOW-310)

**Status:** ACCEPTED **Date:** 2026-06-14 **Tickets:** FOLLOW-309 (Weight Editor config-read GET),
FOLLOW-310 (SSE auth) **Cross-references:** ADR-0012, RETRO-077, FOLLOW-267, FOLLOW-269, FOLLOW-294,
FOLLOW-303

---

## Context

PR #298 (FOLLOW-269) shipped four K.3.6 tracer admin pages. RETRO-077 found three severed wires at
the page-to-route seam. This ADR pins two contracts that fix the two P0 breaks (RETRO-077 CB-1 and
CB-2). The remaining two findings (nav wiring FOLLOW-311, CSV export FOLLOW-312) are separate
tickets that need no new contracts.

### CB-2 — Admin SSE stream is unconsuable from the browser (FOLLOW-310)

`GET /api/admin/tracer/sessions/[id]/stream/route.ts:55` authenticates via
`verifyTracerAdminAuth(req)` which reads only the `Authorization` header
(`apps/control-plane/src/lib/tracer-auth.ts:43`). The page
(`apps/control-plane/src/app/admin/tenants/[id]/tracer/page.tsx:149`) opens the stream with the
browser `EventSource` API. `EventSource` is a native browser API that CANNOT send custom request
headers. Every stream connection therefore arrives with no `Authorization` header and receives
a 401.

The page attempts `?token=${token}` as a query param (`page.tsx:147`) but `verifyTracerAdminAuth`
never reads query params — it reads only headers. The query-param token is additionally sourced from
`localStorage` (`getAdminToken`), while the page docstring at `:10-13` claims an `X-Admin-Token`
cookie — a third inconsistency in how the admin token is sourced.

**The structural root cause:** the existing `verifyTracerAdminAuth` was designed for programmatic
API clients (curl, admin tools, FOLLOW-267 route tests), not for browser-session pages. Admin pages
are a different trust surface.

### CB-1 + LG-1 — Weight Editor cannot load config and cannot PUT-update (FOLLOW-309)

`apps/control-plane/src/app/admin/tracer/weights/page.tsx:136` calls
`fetch('/api/admin/intent/config')` with the default GET method. The route file
`apps/control-plane/src/app/api/admin/intent/config/route.ts` exports only a `POST` handler. Next.js
App Router returns 405 on any unexported method. The editor therefore renders an error banner on
every page open and never loads the live config.

Even if the path were corrected to the SDK-facing `GET /api/intent/config`, that route drops the row
`id` from its response body (`apps/control-plane/src/app/api/intent/config/route.ts:280-285`).
`IntentConfigResponse` (defined in `packages/shared/src/schemas/tracer.ts`) has no `id` field. The
page sets `configId` from `json.id` (`page.tsx:161`), which is always `undefined`. The `handleSave`
branch on `configId` (`page.tsx:203`) therefore always takes the POST path — POST-creating a new row
per save — and the PUT update path is dead code.

### TG-1 — Fabricated fixtures hid both bugs

All 23 tests in the four page test files mock `global.fetch` with hand-authored response fixtures.
`weights/page.test.tsx:23` supplies `MOCK_LIVE_RESPONSE` with `id: '3ecd...'` (a field the real GET
route never emits) and returns it as HTTP 200 (which the admin config route cannot produce for GET).
No test asserts the fetched URL, method, or that the response shape matches what the production
route handler returns. This is why both CB-1 and LG-1 passed CI. This ADR imposes a test-integrity
constraint on FOLLOW-309 and FOLLOW-310 as acceptance criteria.

---

## Decision

### 1. Auth mechanism for the admin SSE stream (fixes CB-2 / FOLLOW-310)

**Use the Supabase session cookie (`sb-access-token`) that the browser already holds.**

The existing `@estalara/auth` `getAuthClaims` helper (`packages/auth/src/middleware.ts:138-148`)
already reads from two sources in order:

1. `Authorization: Bearer <token>` header
2. `sb-access-token` cookie (line 46-53 of `middleware.ts`)

The middleware (`apps/control-plane/src/middleware.ts:50-64`) gates all `/admin/*` routes on a valid
Estalara staff JWT from `getAuthClaims`. Any request that reaches an `/admin/**` route handler has
already been verified to carry a valid staff JWT cookie by the time the middleware passes it
through. The `sb-access-token` cookie is `HttpOnly` and `Secure`; it is sent by the browser with
every same-origin request including EventSource connections.

Therefore `verifyTracerAdminAuth` Path 2 (`packages/auth/src/middleware.ts:63-79`) already accepts
the cookie path — `getAuthClaims(req)` reads the cookie and returns the claims. No code change is
required to `verifyTracerAdminAuth` itself; the SSE route handler must simply stop calling
`verifyTracerAdminAuth` which returns 401 before `getAuthClaims` can be reached when no
`Authorization` header is present.

Wait — re-reading `tracer-auth.ts:42-61`: Path 1 reads the Bearer header; if `adminSecret` is set
AND `token` (from header) is empty, the condition `if (adminSecret && token)` is false and code
falls through to Path 2. Path 2 calls `getAuthClaims(req)` which reads the cookie. So
`verifyTracerAdminAuth` already correctly falls through to the cookie path when no Bearer header is
sent.

**The fix is therefore entirely in the SSE route handler: remove the 401-before-stream-starts
short-circuit caused by calling `verifyTracerAdminAuth` before streaming.** Actually, reading the
route more carefully, the stream route already calls `verifyTracerAdminAuth(req)` at line 55 and
returns early on auth failure. The issue is that `verifyTracerAdminAuth` does fall through to
`getAuthClaims` when no Bearer is present, and `getAuthClaims` reads the `sb-access-token` cookie.
This SHOULD work — unless `ADMIN_API_SECRET` is set and the length-mismatch branch exits without
falling through.

Re-reading `tracer-auth.ts:48-60`: when `adminSecret` is set and `token` is empty (`''`), the
condition is `if (adminSecret && token)` where `token = ''` which is falsy. Code falls through to
Path 2. Path 2 calls `getAuthClaims` which reads the cookie. **The cookie path already works in
`verifyTracerAdminAuth` without any change.**

The actual bug is that the page passes `?token=${token}` with a `localStorage` token value that is
NOT a valid Supabase JWT. This causes `getAuthClaims` to parse a non-JWT string, return null (JWT
parse fails), and `verifyTracerAdminAuth` returns 401. **The fix is in the page**: the page must NOT
pass any token via the query string. When the admin is browsing the control-plane in a logged-in
browser session, the `sb-access-token` cookie is present and `verifyTracerAdminAuth` will
authenticate via Path 2 automatically.

**Chosen mechanism: `sb-access-token` HttpOnly session cookie, sent automatically by the browser
with every same-origin request including EventSource connections.**

**Why not a query-param token?**

A short-lived, single-use query-param token (the next-best alternative) would require:

1. A token-issuance endpoint called before each EventSource connection.
2. A token store (Upstash Redis or a Postgres table) with TTL enforcement and single-use
   invalidation.
3. The route must read `searchParams.get('token')`, hash it, compare to the store, and invalidate —
   adding state to a stateless route handler.
4. Tokens in URLs appear in server logs, browser history, and `Referer` headers on any subsequent
   navigation — a credential-leak surface for a long-lived admin secret.

The cookie path requires zero new infrastructure because `@estalara/auth` `getAuthClaims` already
reads `sb-access-token` and `verifyTracerAdminAuth` already calls `getAuthClaims`. The only change
needed is removing the localStorage-sourced `?token` query param from the page, which unblocks the
existing Path 2.

**`verifyTracerAdminAuth` is NOT modified.** The helper is correct. The page is the error site.

**Compatibility with non-SSE admin routes:** unaffected. Those routes are consumed programmatically
(curl, admin scripts) where a Bearer header is set. Path 1 continues to work unchanged.

**Compatibility with Next.js App Router + Vercel SSE:** `new Response(stream, ...)` with a
`ReadableStream` is supported on Vercel Edge Functions and Node.js runtime. The `sb-access-token`
cookie is read in the request handler synchronously before the stream is opened; no async cookie
reads are needed inside the `ReadableStream` constructor.

### 2. Admin config-read GET contract (fixes CB-1 + LG-1 / FOLLOW-309)

**Add a `GET` handler to `apps/control-plane/src/app/api/admin/intent/config/route.ts`.**

This is a sibling handler to the existing `POST` in the same file. It is admin-authenticated (same
`verifyTracerAdminAuth` guard). It returns the currently-active global config row (and optionally a
tenant-specific row) with its database `id` included.

**Scope decision: global-only for the Weight Editor MVP.**

The Weight Editor page at `/admin/tracer/weights` edits the global default config (no tenant
selector on the page). Per-tenant config editing is explicitly deferred to a later ticket (not in
scope for FOLLOW-309). The GET therefore returns the active global row. A `?tenant_id=` query param
MAY be added in a future ticket; it is not part of this contract and the route MUST NOT accept it
until that ADR is written. This is a product-scope decision, not a technical one — flagged for CEO
confirmation (see §CEO Decision Required below).

**The SDK-facing `GET /api/intent/config` route is NOT modified.** It continues to serve tenants via
Bearer API-key auth with the `IntentConfigResponse` shape (no `id` field). Two separate routes serve
two separate callers.

#### Wire contract — `GET /api/admin/intent/config`

```
Method:  GET
Path:    /api/admin/intent/config
Auth:    Bearer <ADMIN_API_SECRET>  OR  Supabase staff JWT (sb-access-token cookie)
         — same verifyTracerAdminAuth gate as the existing POST handler

Query params: none in v1. ?tenant_id= is reserved for a future ticket; return 400 if received.

Response 200 (active global row found):
{
  "id":         "<uuid>",
  "tenant_id":  null,
  "is_active":  true,
  "weights":    { /* IntentWeights — all sub-fields optional */ },
  "created_at": "<ISO 8601 UTC string>"
}

Response 200 (no active global row):
{
  "id":         null,
  "tenant_id":  null,
  "is_active":  false,
  "weights":    {},
  "created_at": null
}

Response 400:
{
  "error": {
    "code":    "unsupported_param",
    "message": "?tenant_id is not supported on this route in v1; omit it"
  }
}

Response 401/403: { "error": { "code": "unauthorized", "message": "..." } }
Response 500:     { "error": { "code": "db_error", "message": "..." } }
                  — Rule K.2: configured-but-failing DB → 500 + Sentry; NO mock fallback
```

**Nullability contract:**

| Field        | Active-row-found | No-active-row | Notes                                              |
| ------------ | ---------------- | ------------- | -------------------------------------------------- |
| `id`         | `string`         | `null`        | UUID when row exists, `null` when absent           |
| `tenant_id`  | `null`           | `null`        | Global scope — always `null` in v1                 |
| `is_active`  | `true`           | `false`       | Boolean, never absent                              |
| `weights`    | `object`         | `{}`          | `IntentWeights` when row exists, empty `{}` absent |
| `created_at` | `string`         | `null`        | ISO 8601 UTC when row exists, `null` when absent   |

All fields are always present in the response body. No field is `undefined`. The `id` and
`created_at` fields are explicitly `null` (not absent) when no row exists so the page can branch
without `?.` checks.

#### Shared Zod schema — `AdminIntentConfigResponseSchema`

A new schema is added to `packages/shared/src/schemas/tracer.ts` (alongside the existing
`IntentConfigResponseSchema`):

```typescript
// packages/shared/src/schemas/tracer.ts

export const AdminIntentConfigResponseSchema = z.object({
  /** Database row UUID, or null when no active global row exists. */
  id: z.string().uuid().nullable(),
  /** Always null in v1 (global scope only). */
  tenant_id: z.string().uuid().nullable(),
  /** True when an active row was found. */
  is_active: z.boolean(),
  /** Active weight config. Empty object {} when no row exists. */
  weights: IntentWeightsSchema,
  /** Row creation timestamp (ISO 8601 UTC), or null when no row exists. */
  created_at: z.string().nullable(),
});

export type AdminIntentConfigResponse = z.infer<typeof AdminIntentConfigResponseSchema>;
```

This schema is exported from `packages/shared/src/schemas/index.ts`. The route handler constructs
its response body against this type. The Weight Editor page imports `AdminIntentConfigResponse` from
`@estalara/shared` and builds its fetch fixture from this type (not a hand-authored object).

`IntentConfigResponseSchema` (the SDK-facing schema) is NOT modified. The two schemas serve
different callers and have different field sets — `id` is admin-only.

### 3. Test-integrity constraint imposed by this ADR (FOLLOW-309 and FOLLOW-310)

The RETRO-077 TG-1 finding is a recurring pattern (also RETRO-072, RETRO-074). This ADR makes the
following a hard acceptance criterion for both fix tickets:

**FOLLOW-309 tests MUST drive the real `GET /api/admin/intent/config` route handler** (imported and
called directly, as in FOLLOW-297's test pattern) OR derive all response fixtures from
`AdminIntentConfigResponseSchema` (constructing fixture objects by calling `parse()` on valid data,
never hand-typing them). The test MUST assert the response includes `id` as a string UUID.

**FOLLOW-310 tests MUST verify** that `verifyTracerAdminAuth` returns `ok: true` when called with a
request carrying only the `sb-access-token` cookie (no `Authorization` header) and a valid staff JWT
in that cookie. A mock of `getAuthClaims` returning a valid `StaffClaims` object is acceptable for
this targeted auth-path test. The test MUST also assert that the page component does NOT include any
`?token=` or `?admin_token=` query param in the EventSource URL it constructs.

Hand-fabricated server response shapes with fields the real route does not emit are prohibited in
both tickets' test suites.

---

## Consequences

### Positive

- SSE auth fix requires zero new infrastructure and zero new auth helpers. The existing
  `sb-access-token` cookie path in `verifyTracerAdminAuth` / `getAuthClaims` already handles it. The
  only code change is removing the erroneous localStorage-token query param from the page.
- The admin config GET is a strict extension of the existing route file — same auth guard, same
  file, new exported function. No new routes, no new middleware, no schema migration.
- `AdminIntentConfigResponseSchema` is type-system-enforced on both the route handler (return type
  assertion) and the page (typed fetch response). The class of bug where a page expects `json.id`
  and the route never emits it becomes a TypeScript compile error.
- The Weight Editor PUT path becomes functional: once `loadConfig()` receives `id`, `configId` is
  set and `handleSave` correctly issues `PUT /api/admin/intent/config/:id` for updates instead of
  POST-creating a new row per save.
- Cookie-based SSE auth does not appear in server logs, browser history, or Referer headers.

### Negative

- The Weight Editor page must be updated to remove the localStorage-token logic entirely.
  `getAdminToken()` is effectively dead code for browser-session flows. It may still be useful for
  programmatic/scripted access (ADMIN_API_SECRET as Bearer), but for a Next.js page in the admin
  panel its only role was the now-removed `?token=` query param.
- `GET /api/admin/intent/config` returns only the global row in v1. Per-tenant weight editing
  requires a future ADR and ticket. The Weight Editor cannot currently show or edit per-tenant
  overrides; the page scope must document this limitation.

### Risks

- **Cookie same-site scope:** if the control-plane is served on a different domain than the admin is
  logged into, `sb-access-token` will not be sent. In practice the middleware already gates all
  `/admin/*` routes on this cookie, so a logged-in admin has it. No additional risk.
- **Vercel streaming + cookie auth:** the route reads the cookie before streaming begins (in the
  synchronous part of the handler before `new ReadableStream(...)`). This is safe — cookie
  extraction is synchronous with respect to the handler; the stream itself does not need auth
  re-verification. Confirmed pattern from middleware.ts and the existing GET session route.
- **`id: null` handling in the page:** if no active global row exists, the page receives `id: null`.
  The `handleSave` branch `if (configId)` must treat `null` as POST (create), not PUT — which is the
  correct behavior. Implementors must not change this branch to strict `=== null` check vs falsy
  check until FOLLOW-309 acceptance tests confirm it.

### Reversibility

HIGH for both contracts. The GET handler can be removed (405 restores the pre-fix behavior). The
page-side removal of `?token=` is a one-line change. Neither decision creates persistent state or a
public API surface.

---

## Alternatives

### Alternative A (SSE auth) — Short-lived single-use query-param token

Issue a token via a `POST /api/admin/tracer/stream-token` endpoint. The page calls this before
opening EventSource, receives a 60-second-TTL single-use token, and passes it as `?t=<token>`. The
stream route reads `searchParams.get('t')`, validates against a Redis key, and deletes it on first
use.

Rejected: requires a new endpoint, a new Redis key namespace (or Postgres table), two network
round-trips per stream open, TTL management, and single-use invalidation logic. The credential still
appears in the URL during the 60-second window (server logs, browser DevTools network panel). None
of this complexity is needed because `getAuthClaims` already reads `sb-access-token` and
`verifyTracerAdminAuth` already calls `getAuthClaims`. The cookie path costs zero lines of new
infrastructure.

### Alternative B (SSE auth) — Extend `verifyTracerAdminAuth` to accept a `?token=` query param

Add a third path: if a `token` query param is present, compare it constant-time against
`ADMIN_API_SECRET`. This preserves the localStorage-token approach in the page.

Rejected: a long-lived `ADMIN_API_SECRET` in a URL is a credential leak regardless of constant-time
comparison. URL parameters appear in server logs, browser history, proxy caches, and Referer
headers. The query-param path was the original design error that generated this finding. Endorsing
it in the contract perpetuates the risk. The `sb-access-token` cookie path eliminates the
credential-in-URL issue entirely.

### Alternative C (config GET) — Point the Weight Editor at the SDK-facing `GET /api/intent/config`

Change the page to call `/api/intent/config` (with an admin Bearer token) instead of
`/api/admin/intent/config`. The SDK-facing route is already a GET and returns weight data.

Rejected for two reasons: (1) `GET /api/intent/config` uses API-key Bearer auth (ADR-0012 §1), not
the admin secret or staff JWT. An admin page calling a tenant-keyed endpoint is architecturally
wrong — it conflates the admin and SDK trust surfaces. (2) The SDK-facing route drops `id` from its
response (by design — the SDK does not need it). The Weight Editor needs `id` to PUT-update.
Modifying `IntentConfigResponse` to add `id` would pollute the SDK-facing contract with admin-only
fields. The separate admin GET is the correct separation.

### Alternative D (config GET) — Return `id` from the SDK-facing `GET /api/intent/config`

Add an `id` field to `IntentConfigResponseSchema` and have the SDK-facing route return it.

Rejected: the SDK has no use for the config row's database ID. Adding an admin-operational field to
the SDK-facing response creates schema coupling between two different callers. The SDK-facing schema
(`IntentConfigResponseSchema`) is shared with FOLLOW-268-sdk (ADR-0012 §3); adding `id` requires
SDK-engineer coordination for a field the SDK explicitly discards. Separate schemas for separate
callers is cleaner and was the intended design.

---

## CEO Decision Required

**Per-tenant weight editing scope for FOLLOW-309.**

This ADR specifies `GET /api/admin/intent/config` as global-only in v1, with `?tenant_id=` reserved
and returning 400. The Weight Editor at `/admin/tracer/weights` currently has no tenant selector.
The following is needed from the CEO/CPO before FOLLOW-309 is accepted:

> **Q: Is the Weight Editor MVP scope global weights only, or must it also support per-tenant
> overrides in Sprint 17?**

If per-tenant editing is needed in Sprint 17, FOLLOW-309 scope expands to include:

- A tenant selector in the UI
- `GET /api/admin/intent/config?tenant_id=<uuid>` returning the tenant-specific active row
- `AdminIntentConfigResponseSchema.tenant_id` widened from always-`null` to `string | null`

If global-only is confirmed for Sprint 17, FOLLOW-309 proceeds as specified. A follow-up ticket
handles per-tenant editing in a later sprint.

---

## Implementation guidance

### FOLLOW-310 — SSE auth fix (backend-engineer, 4h, P0)

**Backend changes (`apps/control-plane/src/app/admin/tenants/[id]/tracer/page.tsx`):**

1. Remove `getAdminToken()` call and the `?token=${token}` query param from the `EventSource` URL
   construction at `page.tsx:147-149`.
2. The EventSource URL becomes just `${streamUrl}?tenant_id=${tenantId}` (keeping the `tenant_id`
   param which the stream route requires for ClickHouse scoping).
3. Update the page docstring (`:10-13`) to remove the incorrect `X-Admin-Token` cookie reference and
   state that auth is via `sb-access-token` session cookie.
4. No changes to `verifyTracerAdminAuth`, `getAuthClaims`, or the stream route handler.

**Test requirement (must pass, no hand-fabricated fixtures):**

- Write a test that calls `verifyTracerAdminAuth` with a `NextRequest` that has NO `Authorization`
  header but has a `Cookie: sb-access-token=<valid-staff-jwt>` header. Mock `getAuthClaims` to
  return a valid `StaffClaims` object with `estalara_staff: true`. Assert the result is
  `{ ok: true, via: 'staff_jwt' }`.
- Write a test asserting the page component's EventSource URL does NOT contain `?token=`.

### FOLLOW-309 — Weight Editor config-read GET (backend-engineer, 5h, P0)

**Backend changes (`apps/control-plane/src/app/api/admin/intent/config/route.ts`):**

1. Add a `GET` export alongside the existing `POST` export.
2. Auth: call `verifyTracerAdminAuth(req)`. Return 401/403 on failure (same pattern as POST).
3. Reject any request with a `tenant_id` query param (400 `unsupported_param`).
4. Query:
   `SELECT id, tenant_id, weights, is_active, created_at FROM intent_weight_configs WHERE tenant_id IS NULL AND is_active = true ORDER BY created_at DESC LIMIT 1`.
5. If no row: return
   `{ id: null, tenant_id: null, is_active: false, weights: {}, created_at: null }`.
6. If row found: parse `weights` through `IntentWeightsSchema`; return
   `{ id, tenant_id: null, is_active: true, weights, created_at: row.createdAt.toISOString() }`.
7. Rule K.2: DB configured-but-failing → 500 + Sentry. No mock fallback for admin reads.
8. Return type must be asserted against `AdminIntentConfigResponse` (imported from
   `@estalara/shared`).

**Shared schema changes (`packages/shared/src/schemas/tracer.ts`):**

1. Add `AdminIntentConfigResponseSchema` and export `AdminIntentConfigResponse` type (see schema
   definition in §Decision above).
2. Export both from `packages/shared/src/schemas/index.ts`.

**UI changes (`apps/control-plane/src/app/admin/tracer/weights/page.tsx`):**

1. Change `loadConfig()` to fetch `GET /api/admin/intent/config` (the new route).
2. Type the parsed response as `AdminIntentConfigResponse` (imported from `@estalara/shared`).
3. `setConfigId(json.id)` now correctly sets a string UUID (or null) instead of always undefined.
4. `handleSave` branches: `if (configId)` → `PUT /api/admin/intent/config/${configId}`; else →
   `POST /api/admin/intent/config`. This branch was correct code; it just never received a valid
   `configId` before.
5. Update the docstring at `page.tsx:7` from "consumes GET /api/admin/intent/config [which does not
   exist]" to "consumes GET /api/admin/intent/config (ADR-0013)".

**Test requirement (no hand-fabricated fixtures):**

- Import the real `GET` route handler function. Call it directly with a mocked `NextRequest`.
- Test 1: no active global row → `{ id: null, is_active: false, weights: {}, created_at: null }`.
- Test 2: active global row → response includes a string `id`, `is_active: true`, `weights` matching
  `IntentWeightsSchema`.
- Test 3: unauthenticated request → 401.
- Test 4: `?tenant_id=<uuid>` query param present → 400 `unsupported_param`.
- Test 5: DB configured but throws → 500 `db_error` (mock the DB client to throw).
- All fixture response objects MUST be created via `AdminIntentConfigResponseSchema.parse(...)` or
  typed as `AdminIntentConfigResponse` — never hand-authored with ad-hoc fields.

---

## References

- `apps/control-plane/src/lib/tracer-auth.ts` — `verifyTracerAdminAuth` (Path 2 already reads cookie
  via `getAuthClaims`)
- `packages/auth/src/middleware.ts:41-53` — `extractRawToken` reads `sb-access-token` cookie
- `apps/control-plane/src/middleware.ts:50-64` — middleware gates `/admin/*` on staff JWT
- `apps/control-plane/src/app/api/admin/intent/config/route.ts` — POST-only file to extend with GET
- `apps/control-plane/src/app/admin/tracer/weights/page.tsx` — Weight Editor (CB-1 / LG-1 site)
- `apps/control-plane/src/app/admin/tenants/[id]/tracer/page.tsx` — Live Monitor (CB-2 site)
- `packages/shared/src/schemas/tracer.ts` — add `AdminIntentConfigResponseSchema` here
- `packages/shared/src/schemas/intent-weights.ts` — `IntentWeightsSchema` (weights field type)
- ADR-0012 (`docs/adr/ADR-0012-k36-d1-intent-weight-application.md`) — auth split between SDK and
  admin routes
- RETRO-077 (`backlog/RETROSPECTIVES.md`) — source findings CB-1, CB-2, LG-1, TG-1
- FOLLOW-309 — Weight Editor config-read GET fix
- FOLLOW-310 — Live Monitor SSE auth fix
- FOLLOW-311 — nav wiring (separate ticket, no contract needed)
- FOLLOW-312 — CSV export Accept header (separate ticket, no contract needed)
