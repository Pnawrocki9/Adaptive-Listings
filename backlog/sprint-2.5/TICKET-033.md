# TICKET-033 — Schema Discovery API Endpoint

**Sprint:** 2.5 **Agent:** backend-engineer **Priority:** P0 **Estimated hours:** 6 **Status:**
BLOCKED **Depends on:** TICKET-032 (Vision pipeline must exist before this endpoint can invoke it)
**Unblocks:** TICKET-030 Step 3 (onboarding wizard SSE consumer), TICKET-034, TICKET-035

## Context

The onboarding wizard (TICKET-030 Step 3) needs an API route it can call to trigger schema discovery
and stream progress back to the browser. The Vision pipeline (TICKET-032) needs a Next.js-layer
caller that invokes the Modal job, translates its output into database writes, and streams SSE
events so the browser spinner stays live.

This ticket creates `POST /api/tenants/:id/schema-discover` — the bridge between the wizard UI and
the Modal Vision pipeline. It also writes the discovered schema to `tenant_site_schemas` (table
exists from TICKET-AUTO-006, PR #77) so the wizard Step 4 review page and the control-plane can read
it back.

**References:**

- `docs/MASTER_DESIGN.md` section B.5 — Schema Discovery pipeline and field mapping standard
- `packages/db/src/schema/tenant_site_schemas.ts` — existing table (`id`, `tenant_id`, `domain`,
  `schema` JSONB, `detection_source`, `detection_confidence`, `created_at`, `updated_at`)
- `apps/control-plane/src/app/api/` — existing API route patterns; reuse auth helper
- `apps/auto-detect/src/vision_pipeline.py` — the Modal endpoint this route invokes (TICKET-032)
- TICKET-AUTO-006 (PR #77) — `POST /api/detect` already live; read before adding overlapping logic

## Acceptance criteria

All of the following must be met before the PR may be merged:

1. **Route exists.** `POST /api/tenants/[id]/schema-discover` is implemented in
   `apps/control-plane/src/app/api/tenants/[id]/schema-discover/route.ts`. The route handler accepts
   `Content-Type: application/json` with body:

   ```json
   { "url": "string (required)", "sample_listing_url": "string (optional)" }
   ```

   The `url` field is validated as a proper URL; invalid input returns `400` with
   `{ "error": "invalid_url" }`.

2. **Auth — Bearer JWT + tenant ownership.** The route reuses the existing `validateTenantAuth()`
   helper. Requests without a valid JWT return `401`. Requests where the JWT `tenant_id` claim does
   not match the `:id` path parameter return `403`. No unauthenticated access.

3. **SSE response.** The route returns `Content-Type: text/event-stream` and sends progress events
   as the detection pipeline runs. Minimum required events in order:
   - `data: {"type":"progress","message":"Fetching your site..."}\n\n`
   - `data: {"type":"progress","message":"Running AI analysis..."}\n\n`
   - `data: {"type":"progress","message":"Validating selectors..."}\n\n`
   - `data: {"type":"complete","schema_id":"<uuid>","template_id":"<string|null>","confidence":<float>}\n\n`
     On error:
   - `data: {"type":"error","message":"<human-readable string>"}\n\n` The SSE stream must not hold
     the HTTP connection open after emitting `complete` or `error`.

4. **Modal invocation.** The route invokes the Modal Vision pipeline via HTTP POST to the Modal web
   endpoint URL (read from env var `MODAL_AUTO_DETECT_URL`). Use `fetch` with a 90-second timeout.
   If the Modal URL is not configured (empty env var), return a synthetic schema with
   `detection_source: 'unavailable'` and `confidence: 0` so the wizard can still proceed to the
   manual-edit step without crashing.

5. **Database write.** On successful detection, upsert a row in `tenant_site_schemas`:
   - `tenant_id`: from the path parameter
   - `domain`: parsed from the submitted `url` (`new URL(url).hostname`)
   - `schema`: the full detection output JSON (Vision output merged with template match)
   - `detection_source`: from the pipeline response (`'deterministic'` | `'platform_template'` |
     `'ai_vision'` | `'unavailable'`)
   - `detection_confidence`: from the pipeline response
   - On conflict `(tenant_id, domain)`: update all columns except `id` and `created_at`.

6. **Response on completion.** After the SSE `complete` event is sent, the connection closes. The
   `complete` event payload includes `schema_id` (the `tenant_site_schemas` row UUID), `template_id`
   (null if no template matched), and `confidence` (float 0.0–1.0). The wizard Step 4 page reads the
   schema back via `GET /api/detect?tenantId=<id>` (existing AUTO-006 route) — this ticket does not
   need to create a new GET endpoint.

7. **Screenshot URL.** If the Vision pipeline returns a `screenshot_b64` field, store the base64
   image in Supabase Storage bucket `onboarding-screenshots` (bucket must be created if absent) and
   write the public URL into the `schema` JSONB as `schema.screenshot_url`. If Supabase Storage is
   unavailable, omit the screenshot URL silently — it is non-blocking.

8. **Test coverage >= 70% for the new route.** Mock the Modal endpoint, Supabase Storage, and the
   `tenant_site_schemas` upsert. See test expectations below.

9. **No TypeScript `any` without inline `// eslint-disable` + reason.**

10. **`pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` all pass locally.**

## Files to touch

| File                                                                   | Action                                              |
| ---------------------------------------------------------------------- | --------------------------------------------------- |
| `apps/control-plane/src/app/api/tenants/[id]/schema-discover/route.ts` | NEW — POST handler with SSE streaming               |
| `apps/control-plane/src/lib/modal-client.ts`                           | NEW or EXTEND — helper to call Modal web endpoints  |
| `apps/control-plane/src/lib/supabase-storage.ts`                       | NEW or EXTEND — screenshot upload helper            |
| `packages/db/src/schema/tenant_site_schemas.ts`                        | READ ONLY — confirm table structure before querying |
| `.env.example`                                                         | ADD — `MODAL_AUTO_DETECT_URL`                       |
| `apps/control-plane/src/__tests__/api/schema-discover.test.ts`         | NEW — route unit tests                              |

## Implementation notes

- **SSE in Next.js App Router**: use `ReadableStream` + `TransformStream` with
  `new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } })`.
  Do not use `res.write()` (Pages Router pattern).
- **Modal timeout**: wrap the Modal `fetch` in a `Promise.race` against a 90-second `setTimeout`
  that resolves to `{ error: 'timeout' }`.
- **Upsert pattern** (Drizzle):
  ```typescript
  await db
    .insert(tenantSiteSchemas)
    .values({ tenantId, domain, schema, detectionSource, detectionConfidence })
    .onConflictDoUpdate({
      target: [tenantSiteSchemas.tenantId, tenantSiteSchemas.domain],
      set: { schema, detectionSource, detectionConfidence, updatedAt: new Date() },
    });
  ```
- **Auth helper**: grep for `validateTenantAuth` in `apps/control-plane/src/lib/` — reuse the
  existing helper rather than duplicating JWT verification logic.

## Test expectations

### Unit tests (required)

1. **Happy path.** Mock Modal endpoint returning a valid detection result. Assert: SSE stream emits
   three `progress` events followed by one `complete` event; `tenant_site_schemas` upsert is called
   with correct `detection_source` and `confidence`; response status is `200`.

2. **Modal timeout.** Mock Modal endpoint that never resolves. After 90 seconds (fake timers),
   assert the SSE stream emits an `error` event and the connection closes.

3. **Invalid URL body.** POST with `{ "url": "not-a-url" }`. Assert `400` response with
   `{ "error": "invalid_url" }` and no SSE stream opened.

4. **Unauthorized — missing JWT.** POST without `Authorization` header. Assert `401`.

5. **Unauthorized — wrong tenant.** JWT for tenant B, path parameter tenant A. Assert `403`.

6. **Modal unavailable (empty env var).** `MODAL_AUTO_DETECT_URL` is empty string. Assert the route
   still emits a `complete` event with `confidence: 0` and `detection_source: 'unavailable'`; upsert
   is called; no uncaught exception.

## Branch naming

`backend-engineer/TICKET-033-schema-discovery-api`

## PR title format

`feat(control-plane): schema-discover API — SSE streaming + Modal invoke + tenant_site_schemas upsert [TICKET-033]`

## Definition of done

- PR opened, all local checks green.
- `gh pr checks <pr-number> --watch` returns all SUCCESS.
- PM-orchestrator validates AC items above.
- PM-orchestrator comments `PM-validated. CI green. Ready for human review and merge.`
- Ticket moved to `READY_FOR_REVIEW` in QUEUE.md.
