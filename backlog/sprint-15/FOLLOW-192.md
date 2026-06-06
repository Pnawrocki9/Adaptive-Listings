# FOLLOW-192 — ~~ESC-019: provision internal listing-details URL~~ [CLOSED — resolved by PR #196]

**Sprint:** 15 **Agent:** — **Priority:** — **Estimated hours:** 0 **Status:** CLOSED **Source:**
ESC-019 **Promoted:** 2026-06-05 **Closed:** 2026-06-06

---

## Resolution

**ESC-019 is resolved by PR #196 (merged 2026-06-04).**

Root cause: `ESTALARA_BACKEND_URL` was pointing at `app.estalara.com` (SvelteKit frontend with auth
guard), not at `api.estalara.com` (Spring Boot backend with `permitAll()`).

PR #196 corrected `ESTALARA_BACKEND_URL` to `https://api.estalara.com` in Doppler production. Spring
Boot listing-details endpoint does NOT require user authentication (Spring Security `permitAll()` is
correctly configured). Local dev uses `http://localhost:8081` (direct Spring Boot) which behaves
identically.

No further action required. Verified: `listing-details.ts` with `redirect: 'manual'` guard (added in
PR #196) will return 200 from `api.estalara.com`.
