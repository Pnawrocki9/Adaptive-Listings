# QA Engineer — Lessons Log

---

## 2026-06-18 / FOLLOW-336

**What I tested:** SSR admin auth — `checkStaffSession` (tracer-auth), `checkAdminSession`
(middleware admin gate), `SignInForm` sign-in form.

**Where a test could have passed over a dead wire:**

- `makeRequest` with a plain `headers` object created `NextRequest` that satisfies the TypeScript
  type but fails at runtime when `NextResponse.next({ request: req })` does
  `req.headers instanceof Headers`. A test using that helper would have thrown before ever reaching
  the assertions — so the tests were failing loud, not silently. But if someone had mocked
  `NextResponse.next` to skip the check, the admin gate tests would have passed over a dead wire
  (never exercising the real `checkAdminSession` path).

**Root cause of E119 (`request.headers must be an instance of Headers`):** jsdom patches
`globalThis.Headers` with its own implementation, breaking the `instanceof` check in
`NextResponse.next({ request: req })`. The fix is `@vitest-environment node` for any middleware test
file that exercises `NextResponse.next({ request })`.
`new NextRequest(url, { headers: new Headers() })` alone is insufficient in jsdom — the `Headers`
class used by `NextRequest.headers` (from Node.js's native fetch) is not the same as jsdom's shimmed
`Headers`.

**A guardrail I'd add:** For any test file that exercises Next.js middleware directly (not just
route handlers), document that `@vitest-environment node` is required when the middleware calls
`NextResponse.next({ request: req })`. A comment in the vitest.config.ts explaining this would
prevent the next engineer from spending time on the same diagnosis.
