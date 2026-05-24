# FOLLOW-069 — HMAC Compat Test SDK↔Server + Bearer-Only Rejection Regression

**Sprint:** 11 **Agent:** qa-engineer + backend-engineer **Priority:** P1 (closes LG-3) **Estimated
hours:** 2 **Status:** IN_PROGRESS **Source retro:** RETRO-006 §3 LG-3 **Source PR:** FOLLOW-051
(#133)

---

## Context

FOLLOW-051 (PR #133) hardened `POST /api/adapt/feedback` to require HMAC-SHA256 signing:

- SDK side (`packages/sdk/src/core/adapt.ts`): `crypto.subtle.sign('HMAC', ...)` (Web Crypto API)
- Server side (`apps/control-plane/src/app/api/adapt/feedback/route.ts`):
  `crypto.createHmac('sha256', ...)` (Node Crypto)

Both produce hex digests of `HMAC-SHA256(apiKey, rawBody)` and the server does
`crypto.timingSafeEqual()` comparison. **Per-side unit tests pass.**

**The gap:** there is no cross-runtime test that asserts these two implementations produce
**byte-identical** signatures for the same `(key, body)` pairs. Web Crypto expects `Uint8Array`
inputs; Node Crypto accepts strings or buffers. Encoding mismatches (UTF-8 vs Latin-1, BOM
stripping, trailing whitespace) could cause silent rejection of legitimate signatures in production
with no test catching it.

**The second gap (LG-3 regression risk):** there's a 16-hour window 2026-05-22 → 2026-05-23 where
`POST /api/adapt/feedback` accepted **presence-only Bearer tokens** in production `main` (between PR
#127 shipping the SDK ping and PR #133 hardening the auth). No CI regression test exists to guard
against a future change accidentally reintroducing this.

**This ticket adds two tests:**

1. **Cross-runtime HMAC compatibility:** a shared fixture suite asserting byte-identical hex digests
   across N (key, body) input pairs, exercising both Web Crypto and Node Crypto code paths.
2. **Bearer-only rejection regression:** a server-side test that posts a presence-only Bearer token
   (no `X-Estalara-Signature` header) and asserts 401. Guards against accidental re-introduction of
   the LG-3 vulnerability window.

Per CONVENTIONS_PATCH.md Rule H amendment (2026-05-23), this regression test is the structural
enforcement mechanism for the mutation-endpoint-auth rule on this specific endpoint.

---

## Acceptance Criteria

- [ ] New test file `packages/shared/__tests__/cross-runtime/hmac-feedback.test.ts` (or equivalent
      path per existing convention) that: - Generates N ≥ 10 `(key, body)` fixture pairs (varying
      body sizes, UTF-8 content, edge cases: empty body, very long body, body with newlines, body
      with non-ASCII) - Computes HMAC via SDK code path (`packages/sdk/src/core/adapt.ts` exported
      helper if exists, else replicate) - Computes HMAC via server code path
      (`apps/control-plane/src/app/api/adapt/feedback/route.ts` helper) - Asserts hex digests are
      byte-identical for every pair
- [ ] If SDK/server HMAC helpers are inlined and not exported, extract them to a shared module
      (`packages/shared/src/crypto/hmac.ts` or similar) so the test can import both. Update SDK +
      server to use the extracted helper. Maintain mirror manifest entry per Rule J if a
      cross-runtime duplicate is created.
- [ ] New regression test in `apps/control-plane/src/app/api/adapt/feedback/route.test.ts` that: -
      POSTs with valid `Authorization: Bearer <api_key>` header but NO `X-Estalara-Signature` -
      Asserts response status is 401 (or whatever the spec mandates; check the route's current
      behavior — must be a reject, not a silent accept) - Test name:
      `"rejects presence-only Bearer (LG-3 regression guard)"` so future readers see the intent
- [ ] Both tests added to the default test run (no env-flag gating).
- [ ] All CI checks green except the explicitly-ignored ones (Doppler verify, Rule I, Python tests).

---

## What NOT to do

- Do not change the HMAC algorithm or rotate keys.
- Do not extend the threat model beyond what's already in Master Design §V.3.2.
- Do not weaken the existing test coverage; only ADD tests.
- Do not bundle ADAPT_API_KEY ops-fallback testing here (that's covered by FOLLOW-051's existing
  tests).

---

## Files to read first

1. `apps/control-plane/src/app/api/adapt/feedback/route.ts` — server HMAC implementation
2. `apps/control-plane/src/app/api/adapt/feedback/route.test.ts` — existing server tests
3. `packages/sdk/src/core/adapt.ts` — SDK HMAC implementation (search for `crypto.subtle`)
4. `packages/sdk/src/__tests__/adapt.test.ts` — existing SDK tests
5. `docs/MASTER_DESIGN.md` §V.3.2 — threat model
6. `backlog/RETROSPECTIVES.md` RETRO-006 §3 LG-3 — full context
7. `CONVENTIONS_PATCH.md` Rule H amendment (2026-05-23) — the rule this test enforces

---

## Files to create / edit

1. `packages/shared/__tests__/cross-runtime/hmac-feedback.test.ts` — new cross-runtime test
2. Possibly `packages/shared/src/crypto/hmac.ts` — extracted helper (if needed)
3. `apps/control-plane/src/app/api/adapt/feedback/route.test.ts` — add LG-3 regression case
4. Possibly `apps/control-plane/src/app/api/adapt/feedback/route.ts` +
   `packages/sdk/src/core/adapt.ts` — refactor to use shared helper
5. Possibly `scripts/mirror-files.json` — if a Rule J mirror pair is needed

---

## CI watch + autonomous fix policy

After pushing PR:

1. Run `gh pr checks <pr> --watch` until critical checks complete.
2. Fix real failures: TypeScript, lint, format, test, build, Rule H, Rule J.
3. **Ignore** these checks (pre-existing): Doppler verify, Rule I, Python tests.
4. If QUEUE.md conflict on rebase: keep both sides + run prettier.
5. Loop until critical CI green, then post PM-validation comment: "PM-validated: critical CI green,
   ignored Doppler/Rule-I/Python per Sprint 11 policy"
6. Mark READY_FOR_REVIEW in QUEUE.md and stop.

---

## References

- `backlog/QUEUE.md` Sprint 11 yaml block
- `backlog/RETROSPECTIVES.md` RETRO-006 §3 LG-3 + §6a (Rule H amendment)
- `backlog/FOLLOW_UPS.md` FOLLOW-069 stub
- `docs/MASTER_DESIGN.md` §V.3.2 — feedback endpoint threat model
- `CONVENTIONS_PATCH.md` Rule H amendment (2026-05-23)
- `backlog/sprint-10/FOLLOW-051.md` — predecessor ticket
