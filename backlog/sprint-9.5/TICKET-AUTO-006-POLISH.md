# TICKET-AUTO-006-POLISH — Detection Preview + Save & Activate (trust moment for demo)

**Sprint:** 9.5 **Agent:** backend-engineer **Priority:** P0 **Estimated hours:** 3 **Status:**
READY **Depends on:** TICKET-030 (integration) **Unblocks:** FOLLOW-018

## Context

Sprint 7.5 TICKET-AUTO-006 (PR #77) built a "Detection Preview UI skeleton". This ticket polishes it
into the production-quality "trust moment" for the demo: the screen where an admin looks at what the
engine detected about their site before committing.

**Why this matters for the demo:** an investor needs to see that the system actually understands the
site structure — real selectors, real field names, real confidence scores — before they believe the
"zero-config" promise. The preview screen is that proof.

**What the original skeleton built (do not rebuild):**

- Basic field list rendering (partial, from AUTO-006 PR #77)

**What this ticket adds:**

- Complete field preview table with selectors, sample values, confidence badges
- The "Save & Activate" action (new `POST /api/schema/activate` endpoint)
- Tenant status update on activation
- Copyable SDK snippet generation using the real public API key

**Manual selector editing is explicitly OUT OF SCOPE.** No visual editor, no inline input fields for
overriding selectors. The admin can accept or reject (go back). Editing is a post-MVP feature.

**References:**

- `packages/db/src/schema/tenant_site_schemas.ts` — `TenantSiteSchemaRow`, canonical schema store
- `packages/db/src/schema/tenants.ts` — `status` field (`'pending' | 'active' | ...`)
- `packages/db/src/schema/api_keys.ts` — `type: 'public'` key for the snippet
- `apps/control-plane/src/app/api/detect/route.ts` — TICKET-033 response shape
- `docs/MASTER_DESIGN.md` §B.4, §B.4.4 (onboarding flow), §Q

## Acceptance criteria

All of the following must be met before the PR may be merged:

1. **`<DetectionPreview>` component props.** The component accepts:

   ```typescript
   interface DetectionPreviewProps {
     schema: TenantSiteSchema;
     fields: Array<{
       name: string;
       selector: string;
       sample_value: string | null;
       confidence: number;
     }>;
     detection_source: string;
     detection_confidence: number;
     tenantId: string;
   }
   ```

   These props come from the TICKET-033 API response as passed by the TICKET-030 wizard.

2. **Header summary.** Renders a summary line, e.g.: "Detected via **data-estalara** · **99%
   confidence**" with the source and overall confidence humanised (multiply by 100 and round; source
   formatted as `data-estalara` → `"data-estalara"`, `ai_vision` → `"AI Vision"`, etc.).

3. **Field table.** Renders each detected field as a row with columns: Field Name, Selector, Sample
   Value, Confidence. Confidence shown as a percentage badge coloured green (≥80%), yellow (50–79%),
   red (<50%). Null `sample_value` shows "—".

4. **Save & Activate button.** Present and enabled at all times the component is displayed (the
   parent wizard only renders this component in `detected` state, which requires a non-null schema).

5. **Activation API — `POST /api/schema/activate`.** New route that:
   - Requires JWT auth (same pattern as TICKET-033).
   - Accepts `{ schema: TenantSiteSchema }` body.
   - Upserts the schema to `tenant_site_schemas` (idempotent — uses the same `tenant_domain_uniq`
     constraint).
   - If the tenant's `status` is `'pending'`, updates it to `'active'` in the `tenants` table.
   - Queries `api_keys` for the tenant's active `type = 'public'` key (non-revoked, non-expired). If
     none exists, generates a new one (`prefix: 'est_pub_'`) and inserts it.
   - Returns `{ api_key: string, tenant_id: string }`.

6. **SDK snippet display.** After a successful activation call, renders a code block:

   ```html
   <script
     src="https://cdn.estalara.com/sdk.js"
     data-tenant-id="<tenant_id>"
     data-api-key="<api_key>"
   ></script>
   ```

   The `tenant_id` and `api_key` come from the activate API response. Uses the raw API key value
   returned at creation time — it is shown once and never shown again (standard key hygiene; the DB
   stores only the hash + last 4 chars).

7. **Copy button.** A "Copy snippet" button copies the full `<script>` tag to the clipboard via the
   Clipboard API. Button text changes to "Copied!" for 2 seconds then resets.

8. **Activation loading state.** The "Save & Activate" button shows a spinner and is disabled while
   the `POST /api/schema/activate` call is in flight. On API error, show an inline error message.

9. **No TypeScript `any` without inline `// eslint-disable` + reason.**

10. **`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass locally before PR is
    opened.**

## Files to touch (expected)

| File                                                                     | Action                                                          |
| ------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `apps/control-plane/src/components/onboarding/DetectionPreview.tsx`      | Create or replace skeleton — full field table + Save & Activate |
| `apps/control-plane/src/components/onboarding/DetectionPreview.test.tsx` | Unit tests                                                      |
| `apps/control-plane/src/app/api/schema/activate/route.ts`                | New activation endpoint                                         |
| `apps/control-plane/src/app/api/schema/activate/route.test.ts`           | Tests for activation endpoint                                   |

Read `apps/control-plane/src/app/api/detect/route.ts` for the auth pattern to reuse in the activate
route.

## Test expectations

### Unit tests (required)

1. **Field table renders all fields.** Render `<DetectionPreview>` with 3 mock fields. Assert all 3
   rows are in the DOM with correct name, selector, and confidence badge color class.

2. **Null sample value shows dash.** Pass `sample_value: null` for one field. Assert that row shows
   "—" in the Sample Value column.

3. **Copy button.** Mock `navigator.clipboard.writeText`. Click "Copy snippet". Assert the mock was
   called with a string containing `data-api-key`.

4. **Save & Activate → spinner.** Click "Save & Activate". Assert the button is disabled and shows a
   loading indicator before the mocked API resolves.

5. **Snippet shown after activation.** Mock `POST /api/schema/activate` to return
   `{ api_key: 'est_pub_test123', tenant_id: 'uuid-abc' }`. Assert the code block containing
   `data-api-key="est_pub_test123"` is rendered.

### Integration test (required)

6. **Activation endpoint — upserts and returns key.** POST to `/api/schema/activate` with a valid
   JWT and a minimal `TenantSiteSchema`. Assert: (a) `tenant_site_schemas` row exists/updated, (b)
   tenant status set to `'active'`, (c) response includes a non-empty `api_key`.

## Branch naming

`backend-engineer/TICKET-AUTO-006-POLISH-detection-preview-activate`

## PR title format

`feat(control-plane): Detection Preview + Save & Activate — schema activation + SDK snippet [TICKET-AUTO-006-POLISH]`

## Definition of done

- PR opened, all local checks green.
- `gh pr checks <pr-number> --watch` returns all SUCCESS.
- PM-orchestrator validates AC items above.
- PM-orchestrator comments `PM-validated. CI green. Ready for human review and merge.`
- Ticket moved to `READY_FOR_REVIEW` in QUEUE.md.
