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

---

## 2026-07-18 / FOLLOW-583

**What I tested:** Extended the archetype-ID parity guard (FOLLOW-561) to a 4th hand-maintained
full-parity copy (`generate_description.py` `_ARCHETYPE_GUIDANCE`, feeds the live Modal
AI-description prompt) and 2 subset copies (`demo-override-store.ts` `REACHABLE_ARCHETYPES`,
legitimate; `route-helpers.ts`/`export/route.ts` mock archetype fixtures, which had an already-live
invalid id `family_upsizer`).

**Where a test could have passed over a dead wire:** if I'd hand-typed the 18 keys expected in
`_ARCHETYPE_GUIDANCE` into a fixture array instead of parsing the real `.py` file, the test would
have passed forever regardless of what the file actually contains — the multi-line, nested-quote
dict values made that shortcut tempting (a naive line-based split risks matching a substring inside
a value string, e.g. any prose line that happens to end `": ("`... though in practice no value line
does). Anchoring the key regex to `^\s{4}"([a-z_]+)":\s*\(` with the `m` flag and verifying it
matched exactly 18 (not more, not fewer) against the real checked-in file before wiring it into the
suite was the check that made this a real test rather than a restated fixture.

**A guardrail I'd add:** when a "subset-validity" guard covers two files that logically describe one
fixture set (here: `MOCK_ARCHETYPES` array + `buildMockExportRows()`'s inline literals), union them
into one assertion rather than two — otherwise a future drift where one file is fixed and the other
isn't goes undetected by whichever half-guard runs first. Did this here; worth calling out
explicitly as the pattern for any future "two files, one dataset" guard.
