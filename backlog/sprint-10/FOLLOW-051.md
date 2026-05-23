# FOLLOW-051: Replace presence-only Bearer on POST /api/adapt/feedback with tenant-scoped HMAC auth

**Sprint:** 10 **Priority:** P1 **Agent:** compliance-engineer + backend-engineer **Status:**
IN_PROGRESS **Estimated:** 3h **Ticket:** TICKET-102

## Context

`POST /api/adapt/feedback` accepts presence-only Bearer auth: when `ADAPT_API_KEY` is unset (dev/stg
Doppler configs), any non-empty Bearer token is accepted. This endpoint mutates `ab_bandit_weights`
directly — an attacker hitting it from any origin can flood `converted: false` for a
`(tenant, archetype, variant)` triple to bias Thompson sampling against the control arm (adversarial
bandit poisoning).

## What to build

Replace the presence-only Bearer check with a **tenant-scoped HMAC-SHA256 signature** using the
tenant's public API key as the shared secret.

**Scheme:**

1. SDK computes `HMAC-SHA256(JSON.stringify(body), config.apiKey)` → hex digest.
2. SDK sends the digest in an `X-Estalara-Signature` header.
3. Server: extracts the raw Bearer token (= tenant public key) → recomputes HMAC over the raw body →
   constant-time compare.

**Ops fallback:** when `ADAPT_API_KEY` env var is set, a matching Bearer token is accepted directly
(no HMAC needed). Preserves existing integration tests.

## Threat model

- **Blocked:** external adversaries without the tenant API key; cross-tenant poisoning.
- **Not blocked:** a malicious tenant manipulating their own weights — accepted risk (scoped).
- **Documented in:** `docs/MASTER_DESIGN.md` §V.3.2.

## Acceptance criteria

- [ ] `POST /api/adapt/feedback` with no `X-Estalara-Signature` and no `ADAPT_API_KEY` → 401.
- [ ] Valid HMAC-signed request (SDK-generated) → 202.
- [ ] `ADAPT_API_KEY` fallback: correct key → 202, wrong key → 401.
- [ ] Tampered body (signature mismatch) → 401.
- [ ] Malformed signature (not 64 hex chars) → 401.
- [ ] SDK `postFeedbackPing` sends `X-Estalara-Signature` header.
- [ ] Master Design §V.3.2 updated with feedback endpoint threat model.
- [ ] All existing tests pass (ADAPT_API_KEY fallback tests updated, not removed).

## Files changed

- `apps/control-plane/src/app/api/adapt/feedback/route.ts` — HMAC auth gate
- `apps/control-plane/src/app/api/adapt/feedback/route.test.ts` — new adversarial + HMAC tests
- `packages/sdk/src/core/adapt.ts` — HMAC signing in `postFeedbackPing`
- `docs/MASTER_DESIGN.md` §V.3.2 — threat model note
- `backlog/sprint-10/FOLLOW-051.md` — this file
