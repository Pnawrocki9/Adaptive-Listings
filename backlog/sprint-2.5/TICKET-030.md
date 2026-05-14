# TICKET-030 — Magic Link Onboarding Wizard UI

**Sprint:** 2.5 **Agent:** backend-engineer **Priority:** P0 **Estimated hours:** 8 **Status:**
READY **Depends on:** TICKET-024 (JWT middleware, merged PR #42), TICKET-025 (control-plane
skeleton, merged PR #20) **Unblocks:** TICKET-032, TICKET-033, TICKET-040 (Sprint 3)

## Context

Master Design section B.4.2 specifies a five-step "Magic Link" onboarding flow: the agency admin
enters a site URL, receives a magic link email, lands back on the wizard, AI Vision analyzes the
site, and the outcome is a live tenant with a copyable script tag. The target is Time-to-first-
script-tag below 60 seconds (Master Design B.7 success metric). No developer involvement required.

Sprint 2 delivered the authenticated dashboard layout (TICKET-025, TICKET-027) and the tenant auth
infrastructure (TICKET-024). This ticket builds the wizard at
`apps/control-plane/src/app/onboarding/` — a route family outside the authenticated dashboard,
because visitors arrive here unauthenticated via their magic link.

The wizard calls `POST /api/tenants/:id/schema-discover` (TICKET-033) in Step 3. TICKET-033 may not
be merged when this ticket starts; Step 3 must degrade gracefully (static "Detection queued"
message, no crash) if that endpoint returns 404.

**References:**

- `docs/MASTER_DESIGN.md` sections B.4.1, B.4.2 — Magic Link flow diagram and B.7 success metrics
- `apps/control-plane/src/app/dashboard/layout.tsx` — layout and Tailwind patterns to match
- `apps/control-plane/src/app/api/` — existing auth and tenant CRUD patterns
- `packages/db/src/schema/tenants.ts` — `status` column (`pending` | `active` | `suspended`)
- TICKET-026 (PR #43) — bare signup skeleton; extend rather than replace

## Acceptance criteria

All of the following must be met before the PR may be merged:

1. **Route structure.** Five pages exist under `apps/control-plane/src/app/onboarding/`:
   - `page.tsx` — Step 1: URL + agency name form (public route)
   - `verify/page.tsx` — Step 2: magic link callback + redirect
   - `detect/page.tsx` — Step 3: spinner + SSE progress log
   - `review/page.tsx` — Step 4: schema preview + editable selectors
   - `layout.tsx` — shared wizard layout including the step indicator All five pages share a
     `<WizardStepper>` component (current step highlighted; steps are display-only, not interactive
     navigation).

2. **Step 1 — URL + agency name form.** Collects `site_url` (required; must begin with `https://`,
   validated client-side), `agency_name` (required, 2–100 characters), and `admin_email` (required,
   valid email). On submit: (a) writes a pending Redis key `onboarding:<email>:pending` with the URL
   and agency name (TTL 30 minutes) via the server action, (b) calls Supabase Auth
   `signInWithOtp({ email: admin_email, options: { emailRedirectTo: '<APP_URL>/onboarding/verify' } })`.
   On success, displays the Step 2 "Check your inbox" message in-place. On Auth error or duplicate
   email, shows an inline error without page navigation.

3. **Step 2 — magic link callback.** Route `GET /onboarding/verify` handles the Supabase Auth token
   exchange. On success: creates or upserts a `tenants` row with `status = 'pending'`, recovers
   `site_url` from the Redis pending key, and redirects to `/onboarding/detect?tenantId=<id>`. On
   failure (expired or already-used link): renders an error card with a "Send a new link" action
   that returns the user to Step 1.

4. **Step 3 — AI Vision analysis spinner.** Renders a full-page spinner with the message "Analyzing
   your site... this takes about 30 seconds." On mount, client-side fetches
   `POST /api/tenants/:id/schema-discover` with `{ url: tenant.site_url }` and consumes SSE progress
   events. Each `data: progress` event appends a status line below the spinner (e.g. "Fetching
   page...", "Running AI Vision...", "Validating selectors..."). On `data: done` event, navigates to
   `/onboarding/review?tenantId=<id>`. On `data: error` or timeout after 90 seconds, navigates to
   `/onboarding/review?tenantId=<id>&detection_failed=true`. If the schema-discover endpoint returns
   404 (TICKET-033 not merged), catches the error and shows "Detection queued — we will email you
   when ready" without crashing.

5. **Step 4 — schema preview + manual edits.** Reads the latest `tenant_site_schemas` row for the
   tenant and renders:
   - Template match name (e.g. "Idealista — 99% confidence") or "Custom detection" if no template
     matched.
   - A table of detected fields: `title`, `price`, `photos`, `features`, `location`, `description`.
     Each field row shows its CSS selector in an editable `<input>`. Changes stored in local state.
   - If `detection_failed=true` query param: all inputs empty, yellow warning banner reading "Auto-
     detection could not complete — enter selectors manually or activate with defaults and update
     later."
   - "Activate Estalara" primary button. "Re-run detection" secondary button that reloads Step 3.
     Clicking Activate: saves any edited selectors via `PATCH /api/detect` (AUTO-006 route, already
     exists from PR #77) then calls `PATCH /api/tenants/:id/status` to flip status to `active`.

6. **Activation outcome.** After status flip to `active`, the route calls
   `POST /api/tenants/:id/api-keys` to provision the public API key (TICKET-023 flow). The page
   renders the installation snippet in a `<pre>` block:

   ```html
   <script
     async
     src="https://cdn.estalara.io/sdk/v1/estalara.min.js"
     data-tenant="<api_key_public>"
     data-tier="observer"
   ></script>
   ```

   "Copy Code" button copies the snippet to clipboard via `navigator.clipboard.writeText`. "Email to
   Developer" renders a `mailto:` link with the snippet in the email body. If the tenant was already
   `active` (magic link clicked twice), shows "Already active" with a `/dashboard` link. No
   duplicate API key creation.

7. **`PATCH /api/tenants/:id/status` route.** Create this endpoint. Requires Bearer JWT with tenant
   ownership. Only permits `pending → active` transition; any other value or direction returns
   `400`.

8. **Auth guard on Steps 3–5.** A session-less GET to `/onboarding/detect`, `/onboarding/review`, or
   any activate action redirects to `/onboarding?session_required=true`. Step 1 surfaces this as a
   dismissible banner.

9. **`WizardStepper` component.** `src/components/WizardStepper.tsx` — accepts `steps: number` and
   `current: number` (1-based). Completed steps show a check icon; current step is highlighted in
   brand blue; future steps are muted. Pure display component, no click handlers.

10. **Responsive layout.** All pages render correctly at 375px mobile and 1280px desktop. Tailwind
    only; no new CSS files.

11. **Test coverage >= 70% for all new files.** See test expectations below.

12. **No TypeScript `any` without inline `// eslint-disable` + reason.**

13. **`pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` all pass locally before PR is
    opened.**

## Files to touch

| File                                                          | Action                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `apps/control-plane/src/app/onboarding/layout.tsx`            | NEW — wizard shell with WizardStepper                                     |
| `apps/control-plane/src/app/onboarding/page.tsx`              | NEW — Step 1: URL + agency name form                                      |
| `apps/control-plane/src/app/onboarding/verify/page.tsx`       | NEW — Step 2: token exchange + redirect                                   |
| `apps/control-plane/src/app/onboarding/detect/page.tsx`       | NEW — Step 3: spinner + SSE client                                        |
| `apps/control-plane/src/app/onboarding/review/page.tsx`       | NEW — Step 4: preview + editable selectors                                |
| `apps/control-plane/src/components/WizardStepper.tsx`         | NEW — step indicator component                                            |
| `apps/control-plane/src/app/api/tenants/[id]/status/route.ts` | NEW — PATCH tenant status                                                 |
| `apps/control-plane/src/lib/redis.ts`                         | EXTEND or CREATE — Upstash Redis client                                   |
| `apps/control-plane/src/app/api/registrations/route.ts`       | EXTEND — add Redis pending write                                          |
| `.env.example`                                                | ADD — `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` if not present |
| `apps/control-plane/src/__tests__/onboarding/`                | NEW — unit test directory                                                 |

## Implementation notes

- **Supabase client**: grep for `createClient` in `apps/control-plane/src/lib/` to find the existing
  Supabase singleton. Do not add a second instance.
- **Redis client**: if `src/lib/redis.ts` does not exist, create it with `@upstash/redis` (already a
  monorepo dependency — check root `package.json` before adding). Use `UPSTASH_REDIS_REST_URL` and
  `UPSTASH_REDIS_REST_TOKEN` from env.
- **SSE consumption in Step 3**: use the browser `EventSource` API. Wrap in a `useEffect` with
  cleanup (`source.close()` on unmount) to avoid memory leaks. The 90-second timeout is a
  `setTimeout` that closes the source and navigates.
- **Selector edits in Step 4**: reuse the `PATCH /api/detect` route from AUTO-006 (PR #77) rather
  than creating a duplicate schema patch endpoint.

## Test expectations

### Unit tests (required)

1. **URL validation.** `validateSiteUrl('')` and `validateSiteUrl('not-a-url')` return invalid;
   `validateSiteUrl('https://agency.com/properties')` returns valid.

2. **Redis pending write.** Mock Upstash client. POST to Step 1 server action with a valid payload.
   Assert `redis.set` was called with a key matching `onboarding:<email>:pending` and TTL 1800.

3. **WizardStepper states.** Given `steps={5} current={3}`: steps 1–2 render with a check class,
   step 3 renders with the active class, steps 4–5 render with the inactive class.

4. **SSE timeout.** Mock `EventSource` that never emits `done`. After 90 seconds (use fake timers),
   assert `router.push` was called with the `detection_failed=true` URL.

5. **Auth guard redirect.** Render Step 3 component with `session = null`. Assert `router.push` is
   called to `/onboarding?session_required=true` before any fetch is attempted.

6. **Status PATCH — invalid transition.** POST `{ status: 'suspended' }` to the status route. Assert
   `400` response.

### Integration test (required)

7. **Status PATCH — ownership enforcement.** JWT belonging to tenant B, target tenant A ID. Assert
   `403` response.

## Branch naming

`backend-engineer/TICKET-030-magic-link-onboarding-wizard`

## PR title format

`feat(control-plane): Magic Link onboarding wizard — 5-step agency onboarding flow [TICKET-030]`

## Definition of done

- PR opened, all local checks green.
- `gh pr checks <pr-number> --watch` returns all SUCCESS.
- PM-orchestrator validates AC items above.
- PM-orchestrator comments `PM-validated. CI green. Ready for human review and merge.`
- Ticket moved to `READY_FOR_REVIEW` in QUEUE.md.
