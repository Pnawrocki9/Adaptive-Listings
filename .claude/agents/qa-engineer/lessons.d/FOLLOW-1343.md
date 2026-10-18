## 2026-10-18 · FOLLOW-1343 — N2 backoffice smoke (nav reachability + Playwright admin smoke)

**What I tested:** /admin nav graph built from source (layout manifests, landing redirect, hub,
tracer, fleet rows) with 0-1 BFS; 11 hub sub-pages are 3 hops (HIDDEN_BY_DESIGN ratchet). Live
:3000: sign-in form, `/admin` 307, every inventory page gated, unknown routes, FOLLOW-1321 matrix
for the `ADMIN_API_SECRET` bearer. 9 pass / 5 skip.

**Where a test could have passed over a dead wire:** a readonly/ops JWT matrix minted in the spec
looks like rank coverage, but the server holds no `SUPABASE_JWT_SECRET` on localhost, so the
`staff_jwt` layer refuses every JWT; those rows are skip-with-reason, and a 401 row pins the
fail-secure behaviour instead. Also: `tests/e2e` vitest collects `**/*.spec.ts`, so a Playwright
spec there would have broken e2e-smoke CI; excluded.

**A guardrail I'd add:** an auth-matrix row counts only if the server process holds the verifying
secret; check the listener's env names (`/proc/<pid>/environ`, names only) before writing it.
