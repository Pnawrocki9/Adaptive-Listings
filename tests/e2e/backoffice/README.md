# Backoffice smoke — plan instrument N2 (FOLLOW-1343)

Two halves, per `docs/PLAN-LOCALHOST-COMPLETION-2026-10-17.md` (N2, control I4, checkpoints K1/K3):

| Half                | File                                                                        | Runs where                       |
| ------------------- | --------------------------------------------------------------------------- | -------------------------------- |
| Nav reachability    | `apps/control-plane/src/app/admin/__tests__/admin-nav-reachability.test.ts` | CI (control-plane vitest), < 2 s |
| Browser + API smoke | `tests/e2e/backoffice/admin-smoke.spec.ts` (Playwright, Chromium)           | **local only** — no CI job       |

## Run the browser smoke

Needs only a running control plane (`scripts/dev/localhost-up.sh`; PG + `:3000`). It starts and
stops nothing. Check `free -m` first (available >= 900 MB); one headless Chromium, one worker.

```bash
cd tests/e2e
export ADMIN_API_SECRET=...   # the local value scripts/dev/localhost-up.sh passes to :3000
pnpm run test:backoffice      # BACKOFFICE_ORIGIN defaults to http://localhost:3000
```

`@playwright/test` and its Chromium are reused from `packages/sdk` (the browser-matrix owner), so
this package gains no dependency. `N2_REPORT_DIR` moves the JSON report and failure traces (default
`tests/e2e/test-results/backoffice`, gitignored). Vitest in `tests/e2e` excludes `backoffice/**`.

## What it proves (v0, checkpoint K1)

- `/sign-in` renders the email + password form; `/admin` answers **307** (not 308) to
  `/sign-in?redirect=%2Fadmin`; every page in the `app/admin/**/page.tsx` inventory is gated the
  same way (never 2xx/5xx to an anonymous caller).
- `/admin/<unknown>` is gated before routing (307); a public unknown route is a 404 status.
- FOLLOW-1321 rank matrix on the live API: anonymous 401; `ADMIN_API_SECRET` bearer GET 200 with
  `x-estalara-staff-can-write: false`, POST intent config 403, PUT generation-model 403; a staff JWT
  signed with a key the server does not hold 401.
- Any HTTP >= 500 or Next error-overlay text on a visited page fails.

## Auth limitation (the gap K3 closes)

- **Pages:** `middleware.ts` gates `/admin/*` only through `checkAdminSession` — `@supabase/ssr`
  `getUser()` against the production Supabase project (one account, the CEO's). There is no
  bearer/JWT branch for pages, so no local credential opens an admin page. Landing-on-tenant, pinned
  sidebar, Live Monitor `tenant_id` and "every sidebar page < 500" are covered from source by the
  reachability test and the FOLLOW-1322 unit tests, and appear as the skipped `K3 gap` test.
- **API staff JWT:** `lib/tracer-auth.ts` `via: 'staff_jwt'` verifies HS256 with
  `SUPABASE_JWT_SECRET`, which is in neither Doppler `dev` nor `localhost-up.sh`, so the path
  refuses every JWT on localhost. The readonly/ops rows run only when the same `SUPABASE_JWT_SECRET`
  is set for both this process and the control plane; otherwise they are skipped with that reason.

## What K3 adds (FOLLOW-1336 and the full N2)

A local staff page session (decision needed: local Supabase Auth, or a localhost-only session path
that cannot exist in a production build), then: `/admin` lands on
`/admin/tenants/<NEXT_PUBLIC_ESTALARA_TENANT_ID>/tracer`, sidebar links pinned to it, the Live
Monitor request carries `tenant_id`, every kept function opens without `error.tsx`, one staff role
opens everything, and the branded `not-found` page (TODO in the spec).
