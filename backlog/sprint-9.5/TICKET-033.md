# TICKET-033 — Schema Discovery API endpoint (POST /api/detect tenant-scoped wrapper)

**Sprint:** 9.5 **Agent:** backend-engineer **Priority:** P0 **Estimated hours:** 4 **Status:**
READY **Depends on:** — **Unblocks:** TICKET-030, FOLLOW-018

## Context

The Sprint 7.5 auto-detection engine (11 deterministic techniques + AI Vision fallback) already runs
behind `POST /api/detect` in `apps/control-plane/src/app/api/detect/route.ts`. The engine achieves
100% precision / 100% recall on 24 corpus platforms. `ANTHROPIC_API_KEY` is now active in Doppler
(Krok B) so AI Vision (Technique 11) is fully operational.

**The problem:** the existing route accepts `tenant_id` as an optional request body parameter
defaulting to `'anonymous'` (line 140 of the route). There is no JWT authentication and no SSRF
protection. The Magic Link wizard (TICKET-030) needs to call this endpoint as an authenticated
tenant, get back a structured response it can render as a field preview, and be confident the
detection result is persisted under the correct tenant.

This ticket is **not a rebuild** of the detection engine. It is a thin tenant-aware auth + SSRF +
response-shaping layer on top of what already exists.

**What already works (do not re-implement):**

- Detection via `detectSiteSchema(html, url, tenantId)` in `@estalara/sdk/auto-detect`
- AI Vision fallback at line ~175 of the route
- DB upsert to `tenant_site_schemas` (schema: `packages/db/src/schema/tenant_site_schemas.ts`) using
  `unique('tenant_site_schemas_tenant_domain_uniq')` on `(tenant_id, domain)`

**References:**

- `apps/control-plane/src/app/api/detect/route.ts` — existing route to extend
- `packages/db/src/schema/tenant_site_schemas.ts` — `TenantSiteSchemaRow` type
- `packages/shared/src/` — for any new shared Zod types
- `docs/MASTER_DESIGN.md` §B.4, §B.5

## Acceptance criteria

All of the following must be met before the PR may be merged:

1. **JWT authentication.** `POST /api/detect` requires a valid `Authorization: Bearer <tenant-JWT>`
   header. The `tenant_id` is extracted from JWT claims via `getAuthClaims()` (already used
   elsewhere in the app) and replaces the optional body param. Requests without a valid JWT return
   `401` with `{ "error": { "code": "UNAUTHORIZED", "message": "..." } }`.

2. **SSRF protection.** Before issuing the server-side `fetch` for the provided URL, parse the
   hostname and block requests matching any of:
   - IPv4 private ranges: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`
   - IPv6 loopback and private: `::1`, `fc00::/7`
   - Hostnames: `localhost` and any bare hostname without a TLD (e.g. `internal`, `db`)
   - Non-http/https schemes (already partially validated by existing Zod schema — keep it) Blocked
     requests return `400` with `{ "error": { "code": "SSRF_BLOCKED", "message": "..." } }`.

3. **Wizard-ready response shape.** On successful detection, the response body must include:

   ```json
   {
     "schema": {
       /* full TenantSiteSchema object */
     },
     "detection_source": "data_estalara",
     "detection_confidence": 0.99,
     "fields": [
       {
         "name": "price",
         "selector": "[data-estalara-price]",
         "sample_value": "€450,000",
         "confidence": 0.99
       }
     ],
     "cached": false,
     "request_id": "uuid-v4"
   }
   ```

   `fields` is derived from the `TenantSiteSchema` returned by detection — map the schema's field
   definitions to this flattened shape. `sample_value` may be null if the detection technique did
   not capture a live sample. `request_id` is a new `crypto.randomUUID()` per request.

4. **Null-schema response.** When detection returns `schema: null` (below confidence threshold),
   return `200` with:

   ```json
   {
     "schema": null,
     "detection_source": null,
     "detection_confidence": 0,
     "fields": [],
     "cached": false,
     "request_id": "..."
   }
   ```

   Do not write any row to `tenant_site_schemas`.

5. **Idempotent upsert preserved.** When schema is non-null, the existing upsert logic writes to
   `tenant_site_schemas` with the `tenant_domain_uniq` constraint. No duplicate rows. Calling the
   endpoint twice for the same domain returns the same (or newer) schema.

6. **Detection cache guard.** If a `tenant_site_schemas` row for `(tenant_id, domain)` exists with
   `updated_at` within the last 60 seconds, skip re-running the full detection pipeline and re-fetch
   html; instead return the stored schema immediately with `"cached": true`. This prevents burning
   AI Vision quota during rapid demo retries. The 60-second guard applies only to the expensive
   pipeline path — it does NOT apply to the activate flow in FOLLOW-018.

7. **AI Vision preserved.** When `ANTHROPIC_API_KEY` is set and L1–L10 all return null, AI Vision
   (Technique 11) is still invoked as before. No change to this logic.

8. **Test coverage.** `≥70%` for the new auth and SSRF logic. Tests must cover: (a) missing JWT →
   401, (b) SSRF address → 400, (c) successful detection → wizard response shape, (d) null detection
   → correct null body, (e) cache guard → `cached: true` on second call within 60s.

9. **No TypeScript `any` without inline `// eslint-disable` + reason.**

10. **`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass locally before PR is
    opened.**

## Files to touch (expected)

| File                                                  | Action                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------- |
| `apps/control-plane/src/app/api/detect/route.ts`      | Add JWT auth, SSRF guard, wizard response shape, cache guard                |
| `apps/control-plane/src/app/api/detect/route.test.ts` | Add tests for auth, SSRF, new response shape, cache guard                   |
| `packages/shared/src/schemas/detect.ts`               | New file — export `DetectResponseSchema` Zod type if consumed by TICKET-030 |
| `packages/shared/src/index.ts`                        | Export new type if added                                                    |

## Test expectations

### Unit tests (required)

1. **SSRF guard — private IP.** Call the SSRF guard function with `http://192.168.1.1/page`. Assert
   it throws or returns a blocked result.

2. **SSRF guard — localhost.** Call with `http://localhost/internal`. Assert blocked.

3. **SSRF guard — valid URL passes.** Call with `https://www.rightmove.co.uk/listing/123`. Assert it
   is not blocked.

4. **Missing JWT → 401.** POST to `/api/detect` with no Authorization header. Assert response status
   401 and `error.code === 'UNAUTHORIZED'`.

5. **Cache guard.** Mock the DB to return a row with `updated_at` = 30 seconds ago. Assert the
   detect pipeline is NOT called and `cached: true` is in the response.

### Integration test (required)

6. **Full detection → wizard shape.** POST with a valid JWT and a URL served by the test fixture
   `000-app-estalara`. Assert response includes `detection_source: 'data_estalara'`,
   `detection_confidence >= 0.99`, and `fields.length >= 1`.

## Branch naming

`backend-engineer/TICKET-033-schema-discovery-api`

## PR title format

`feat(control-plane): Schema Discovery API — JWT auth + SSRF guard + wizard response [TICKET-033]`

## Definition of done

- PR opened, all local checks green.
- `gh pr checks <pr-number> --watch` returns all SUCCESS.
- PM-orchestrator validates AC items above.
- PM-orchestrator comments `PM-validated. CI green. Ready for human review and merge.`
- Ticket moved to `READY_FOR_REVIEW` in QUEUE.md.
