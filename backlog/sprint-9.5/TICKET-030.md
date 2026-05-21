# TICKET-030 — Magic Link onboarding wizard UI (paste URL → detect → preview → snippet)

**Sprint:** 9.5 **Agent:** backend-engineer **Priority:** P0 **Estimated hours:** 5 **Status:**
BLOCKED (on TICKET-033) **Depends on:** TICKET-033 **Unblocks:** TICKET-AUTO-006-POLISH, FOLLOW-018

## Context

This ticket was originally Sprint 2.5 READY but was blocked because the tenant-authenticated Schema
Discovery API (TICKET-033) did not exist. With TICKET-033 merged, this is the primary UI work for
the MVP demo.

**Demo narrative (Piotr Q4 decision, 2026-05-21):** The demo target is `app.estalara.com`. An admin
(Piotr) will paste the URL into the wizard, the system will auto-detect the schema using the Sprint
7.5 engine (detection_source=`data_estalara`, confidence ≥0.99, zero AI Vision cost because the
`000-app-estalara` corpus fixture is already in the 11-technique cascade), preview the detected
fields, click "Save & Activate" (TICKET-AUTO-006-POLISH), and receive a copyable SDK snippet.

**State machine** for the wizard:

```
idle → (user submits URL) → analyzing → (API returns non-null schema) → detected
                                       → (API returns null schema)      → needs_review
                                       → (API error / network failure)  → failed
failed → (user clicks retry) → analyzing
needs_review → (static message, no retry loop)
```

The `detected` state hands off to the `<DetectionPreview>` component (TICKET-AUTO-006-POLISH).

**What is NOT in scope for this ticket:**

- The `<DetectionPreview>` component itself — that is TICKET-AUTO-006-POLISH
- The "Save & Activate" action — that is TICKET-AUTO-006-POLISH
- Backend API changes — that is TICKET-033

**References:**

- `apps/control-plane/src/app/api/detect/route.ts` — the endpoint this wizard calls
- `apps/control-plane/src/app/` — Next.js App Router conventions used in this codebase
- `docs/MASTER_DESIGN.md` §B.4, §Q (user stories)

## Acceptance criteria

All of the following must be met before the PR may be merged:

1. **Page routing.** A new page exists at `/onboarding/detect` within the control-plane app (or the
   nearest equivalent path within the authenticated tenant area — check existing routing in
   `apps/control-plane/src/app/` for the right parent layout). The page is only accessible to
   authenticated tenants. Unauthenticated visitors are redirected to `/login` by the existing auth
   middleware.

2. **URL input.** A text input field accepts a URL. The "Detect" submit button is disabled until the
   field contains a syntactically valid `http://` or `https://` URL (client-side validation via the
   browser's native URL API or a simple regex — no Zod on the client input). Empty string → button
   disabled.

3. **Analyzing state.** On form submit: (a) set state to `analyzing`, (b) disable the input and
   button to prevent double-submission, (c) show a spinner or progress indicator with label
   "Detecting your site schema…".

4. **API call.** Call `POST /api/detect` with `{ url }` body. Send `Authorization: Bearer <token>`
   using the active session token (Next.js session / Supabase auth — use whichever pattern the
   existing dashboard pages use; read `apps/control-plane/src/app/` for examples). Do not pass
   `tenant_id` in the body — TICKET-033 extracts it from the JWT.

5. **Detected state.** On a `200` response with `schema !== null`: set state to `detected` and
   render the `<DetectionPreview>` component, passing `schema`, `fields`, `detection_source`, and
   `detection_confidence` from the API response. The `<DetectionPreview>` component is provided by
   TICKET-AUTO-006-POLISH; import it from the same components directory.

6. **Needs-review state.** On a `200` response with `schema === null`: set state to `needs_review`
   and show: "We couldn't automatically detect your site's schema. Please contact
   support@estalara.com for manual setup." No retry button.

7. **Failed state.** On a non-`2xx` response or network error: set state to `failed` and show a
   brief error message (include the API `error.message` if available) plus a "Try again" button that
   resets state to `idle`.

8. **No mock data.** No hardcoded fixture schemas, no `if (process.env.NODE_ENV === 'test')` forks
   in the component logic. All data flows from the real API. Tests mock at the `fetch` level.

9. **Accessibility.** The spinner has `aria-label` or `role="status"`. The error message is in an
   `aria-live` region. The URL input has an associated `<label>`.

10. **`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass locally before PR is
    opened.**

## Files to touch (expected)

| File                                                                 | Action                                                                                        |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `apps/control-plane/src/app/(tenant)/onboarding/detect/page.tsx`     | New page — Server Component wrapper + auth check                                              |
| `apps/control-plane/src/components/onboarding/DetectWizard.tsx`      | New Client Component — URL input + state machine                                              |
| `apps/control-plane/src/components/onboarding/DetectWizard.test.tsx` | Unit tests                                                                                    |
| `apps/control-plane/src/components/onboarding/DetectionPreview.tsx`  | Import point for TICKET-AUTO-006-POLISH component (create stub if that ticket not yet merged) |

If the `(tenant)` layout doesn't exist, read how the existing `/admin/*` pages are structured and
follow the same pattern.

## Test expectations

### Unit tests (required)

1. **Idle → analyzing on submit.** Render `<DetectWizard>`, type a valid URL, click "Detect". Assert
   the spinner is present and the submit button is disabled.

2. **Detecting state → detected.** Mock `fetch` to return a `200` with a non-null `schema` and
   `fields`. Assert `<DetectionPreview>` is rendered with the correct props.

3. **Null schema → needs_review.** Mock `fetch` to return `200` with `schema: null`. Assert the
   needs-review message is shown and no preview component is rendered.

4. **API error → failed.** Mock `fetch` to return `400`. Assert the failed state message is shown
   and a "Try again" button is present.

5. **Double-submit prevention.** While in `analyzing` state, assert the submit button is disabled
   and a second click does not trigger a second `fetch` call.

6. **Invalid URL → button disabled.** Type `not-a-url` into the input. Assert the submit button
   remains disabled.

## Branch naming

`backend-engineer/TICKET-030-magic-link-wizard-ui`

## PR title format

`feat(control-plane): Magic Link onboarding wizard UI — URL detect → preview → snippet [TICKET-030]`

## Definition of done

- PR opened, all local checks green.
- `gh pr checks <pr-number> --watch` returns all SUCCESS.
- PM-orchestrator validates AC items above.
- PM-orchestrator comments `PM-validated. CI green. Ready for human review and merge.`
- Ticket moved to `READY_FOR_REVIEW` in QUEUE.md.
