# FOLLOW-075 — Require VERCEL_CRON_SECRET on /api/dsr/mutation-poll

**Sprint:** 12  
**Lane:** A (pilot-critical hardening — gates Lane B)  
**Agent:** backend-engineer  
**Model:** sonnet-4.6  
**Priority:** P1  
**Estimated hours:** 1  
**Branch:** `backend-engineer/FOLLOW-075-cron-secret`  
**Depends on:** FOLLOW-039 (merged PR #139)

---

## Context

The `/api/dsr/mutation-poll` Vercel Cron endpoint (shipped by FOLLOW-039, PR #139) currently
validates the `CRON_SECRET` env var like this:

```ts
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // unconfigured — local dev / CI
  const authHeader = req.headers.get('authorization');
  return authHeader === `Bearer ${secret}`;
}
```

**Problem:** `CRON_SECRET` is the generic Vercel environment variable name. The route comment says
"protected by `CRON_SECRET` header" but the actual Vercel Cron documentation uses `CRON_SECRET`.
However, the Sprint 12 pilot decision provisioned `VERCEL_CRON_SECRET` in both Vercel and Doppler
(2026-05-24).

There are two issues:

1. The `if (!secret) return true` fallback allows unauthenticated callers in any environment where
   the env var isn't set — this includes staging and any future region where the secret isn't
   propagated
2. The variable name may not match the provisioned secret name (`VERCEL_CRON_SECRET` vs
   `CRON_SECRET`)

Any unauthenticated caller can trigger a poll cycle, wasting ClickHouse queries and potentially
causing unintended state transitions during a DSR audit.

---

## Acceptance Criteria

1. **Validate the env var name:** Check whether Vercel injects the secret as `CRON_SECRET` or
   whether the project uses `VERCEL_CRON_SECRET`. The route comment says "Vercel injects
   `Authorization: Bearer ${CRON_SECRET}` automatically for cron-triggered invocations" — read the
   actual Vercel cron docs to confirm the correct variable name. If the provisioned name is
   `VERCEL_CRON_SECRET`, update the env var read accordingly.

2. **Remove the `if (!secret) return true` fallback.** Replace with: if the secret env var is not
   set, return 401 (not 200). The rationale: an unconfigured CRON_SECRET is an infrastructure
   misconfiguration, not a "local dev" exemption. For local development, set `CRON_SECRET=dev-local`
   in `.env.local`.

3. **Update `.env.example`** to document the `CRON_SECRET` (or `VERCEL_CRON_SECRET`) variable with a
   note that it must be set in all environments.

4. **Add or update the unit test** for `isAuthorized()` (or the GET handler) to cover:
   - Missing env var → 401 (not 200)
   - Correct Bearer token → 200
   - Wrong Bearer token → 401

5. **Update the route JSDoc comment** to reflect the hardened behavior: "Returns 401 if CRON_SECRET
   is not configured (env misconfiguration) or if the Authorization header does not match."

6. **No ClickHouse schema changes** — this is an authentication hardening change only.

---

## Key files to read first

- `apps/control-plane/src/app/api/dsr/mutation-poll/route.ts` — current `isAuthorized()`
  implementation (lines 68-73)
- `apps/control-plane/vercel.json` — cron configuration; confirm the path matches
- `apps/control-plane/src/app/api/dsr/dsr-routes.test.ts` — existing DSR test patterns to follow

---

## Implementation notes

- **Vercel cron secret name:** Vercel's documentation states the header is
  `Authorization: Bearer <CRON_SECRET>` where `CRON_SECRET` is the environment variable name set in
  Vercel project settings. The provisioned name from the Sprint 12 AI Council decision was
  `VERCEL_CRON_SECRET` — check whether that needs to be the env var name in code or whether it maps
  to `CRON_SECRET` in Vercel. Read the Vercel cron docs carefully.
- For test isolation, extract `isAuthorized` into a separately testable function (it already is —
  just add the missing test cases).
- The change is backwards-compatible for CI (the test workflow does NOT call this endpoint; it's a
  Vercel-invoked cron).

---

## Definition of Done

- [ ] `isAuthorized()` returns 401 when secret env var is unset
- [ ] `isAuthorized()` returns 401 with wrong Bearer token
- [ ] `isAuthorized()` returns 200 with correct Bearer token
- [ ] `.env.example` documents the secret variable
- [ ] Unit tests updated (≥3 cases for the auth logic)
- [ ] PR description confirms which env var name matches the provisioned secret
- [ ] Standard CI green (test-node, lint, typecheck, build, format)
