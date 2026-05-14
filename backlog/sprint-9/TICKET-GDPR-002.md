# TICKET-GDPR-002 — DSR (Data Subject Rights) Endpoints

**Sprint:** 9 **Agent:** backend-engineer **Priority:** P0 **Estimated hours:** 8 **Status:**
BACKLOG **Depends on:** TICKET-GDPR-001 (ROPA retention table defines deletion scope), TICKET-AB-001
(merged PR #80 — `ab_bandit_weights` table exists) **Unblocks:** TICKET-GDPR-004 (consent
propagation references DSR erasure flow)

## Context

GDPR Arts. 15, 17, and 20 grant data subjects the rights of access, erasure ("right to be
forgotten"), and portability respectively. Master Design H.1 notes: "API endpoint
`DELETE /v1/sessions/{session_id}` + bulk export — buyer może żądać deletion przez tenant." CCPA
Section 1798.105 grants similar deletion rights. UAE PDPL Art. 17 grants erasure rights.

In the Estalara model the data subject is the anonymous buyer — identified only by `session_id` (a
session-scoped HMAC hash, never PII). The tenant (real estate agency) acts as data controller;
Estalara acts as data processor. A buyer wishing to exercise rights contacts the tenant; the tenant
issues a DSR request to Estalara on behalf of the buyer.

All DSR endpoints require a one-time-use token issued via email OTP confirmation to prevent abuse (a
rogue actor cannot call `POST /api/dsr/erase` with any `session_id`). The OTP flow: the tenant admin
(or buyer via the tenant's own UI) triggers an email to the buyer; the buyer clicks the link, which
contains a signed DSR token; the token is submitted to the Estalara DSR endpoint.

**Cross-reference:** TICKET-AB-001 (Sprint 8) already implements `consent_state`-aware skip in the
Decision API. TICKET-GDPR-004 (this sprint) extends that pattern to gate entire sessions. The DSR
erasure here is the hard delete that TICKET-GDPR-004's consent gating anticipates.

**References:**

- `docs/MASTER_DESIGN.md` section H.1 (GDPR obligations, right to erasure)
- `docs/MASTER_DESIGN.md` section H.3 (CCPA right to deletion)
- `docs/compliance/ropa.md` (TICKET-GDPR-001 output) — retention table defines which tables DSR
  deletion must cascade to
- `packages/db/src/schema/consent_records.ts` — `revokedAt` column to set on erasure
- `packages/db/src/schema/session_embeddings.ts` — primary Postgres erasure target
- `packages/db/src/schema/ab_bandit_weights.ts` — anonymize, do not delete (see AC item 4)
- GDPR Art. 17 (erasure), Art. 15 (access), Art. 20 (portability)

## Acceptance criteria

All of the following must be met before the PR may be merged:

1. **`POST /api/dsr/initiate` — token issuance.** A tenant admin (authenticated via Bearer JWT)
   calls this endpoint with
   `{ session_id: string, email: string, dsr_type: 'access' | 'erase' | 'portability' }`. The
   endpoint:
   - Validates the JWT and confirms the session belongs to the requesting tenant (query
     `session_embeddings` by `tenant_id + session_id`).
   - Generates a signed, one-time-use DSR token (HMAC-SHA256, 32-byte entropy, 24-hour TTL) and
     stores it in a new Postgres table `dsr_tokens` (see AC item 6).
   - Sends an email to `email` via the existing email provider (check existing code for the mailer;
     do not introduce a new email provider). Email body: "A data subject rights request for your
     session has been initiated. Click the link below to confirm: [link with token]."
   - Returns `202 Accepted` with `{ request_id: uuid, expires_at: ISO }`.
   - Returns `404` if `session_id` is not found for the tenant, `401` if JWT invalid, `422` if
     `dsr_type` is invalid.

2. **`POST /api/dsr/access` — export all data for a session_id.** Accepts `{ token: string }`. The
   endpoint:
   - Validates the DSR token (not expired, not previously used, `dsr_type === 'access'`).
   - Marks the token as used (set `used_at = now()` in `dsr_tokens`).
   - Queries and returns a JSON object with all personal data held for the `session_id`:
     ```json
     {
       "session_id": "<hash>",
       "tenant_id": "<uuid>",
       "events_summary": { "count": 142, "first_at": "...", "last_at": "..." },
       "matched_archetype": "yield_hunter",
       "consent_records": [{ "consent_type": "...", "granted": true, "granted_at": "..." }],
       "quiz_answers": { "purpose": "investment", "horizon": ">1yr" }
     }
     ```
   - ClickHouse `adaptation_decisions` count is queried and included in `events_summary.count`.
   - Returns `200` with the JSON payload. Returns `401` if token invalid/expired/already used.

3. **`POST /api/dsr/erase` — cascade delete.** Accepts `{ token: string }`. The endpoint:
   - Validates the DSR token (`dsr_type === 'erase'`), marks as used.
   - Deletes from Postgres (in a single transaction): `session_embeddings` WHERE `session_id`,
     `consent_records` WHERE `session_id`, `answers` rows are NOT deleted (they belong to tenants,
     not buyers). Quiz answers stored in `session_embeddings.quizArchetype` are deleted as part of
     the row.
   - For `ab_bandit_weights`: does NOT delete — these are per `(tenant_id, archetype, variant)` and
     contain no session_id. Anonymization is already structural. No action needed.
   - Emits a `dsr.erasure_requested` event to Redpanda topic `estalara.dsr` with payload
     `{ session_id, tenant_id, requested_at, delay_hours: 24 }`. A separate retention worker (out of
     scope for this ticket — note as follow-up) consumes this event and hard-deletes the ClickHouse
     `adaptation_decisions` rows after a 24-hour revocation window.
   - Emits a Redis `DEL session:{session_id}:*` to clear any cached intent/session state.
   - Returns `200 { deleted_at: ISO, clickhouse_deletion: "scheduled_in_24h" }`.
   - Returns `401` if token invalid/expired/already used.

4. **`POST /api/dsr/portability` — JSON export.** Accepts `{ token: string }`. The endpoint:
   - Validates the DSR token (`dsr_type === 'portability'`), marks as used.
   - Returns the same JSON shape as `POST /api/dsr/access` but as a downloadable file via
     `Content-Disposition: attachment; filename="estalara-data-export-{session_id}.json"` and
     `Content-Type: application/json`.
   - Returns `200` with the file. Same error responses as access endpoint.

5. **DSR token one-time-use is enforced.** If a token is submitted a second time (to any DSR
   endpoint), the response is `401 { error: "token_already_used" }`. Tokens that have passed their
   24-hour TTL return `401 { error: "token_expired" }`. These two error codes are distinct and
   testable.

6. **`dsr_tokens` Postgres table.** A new Drizzle table with:
   - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
   - `tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`
   - `session_id text NOT NULL`
   - `dsr_type text NOT NULL` — `'access' | 'erase' | 'portability'`
   - `token_hash text NOT NULL UNIQUE` — SHA-256 of the raw token (never store raw token)
   - `email text NOT NULL` — who was emailed (for audit trail)
   - `expires_at timestamptz NOT NULL`
   - `used_at timestamptz` — null until consumed
   - `created_at timestamptz NOT NULL DEFAULT now()`
   - RLS: tenant can only read its own rows.
   - Migration generated via `pnpm --filter @estalara/db drizzle-kit generate`.

7. **All routes require bearer JWT auth scoped to tenant.** Except `POST /api/dsr/access`,
   `POST /api/dsr/erase`, and `POST /api/dsr/portability` which accept an anonymous DSR token
   instead of a JWT (the token itself proves authorization). The initiate endpoint requires JWT.

8. **Test coverage ≥70% for all new routes.** Coverage for new Drizzle table must meet ≥80% bar
   (`packages/db` is a library).

9. **No TypeScript `any` without inline `// eslint-disable` + reason.**

10. **`pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` all pass locally before PR is
    opened.**

## Files to touch

| File                                                      | Action                                            |
| --------------------------------------------------------- | ------------------------------------------------- |
| `packages/db/src/schema/dsr_tokens.ts`                    | NEW — Drizzle table definition                    |
| `packages/db/src/schema/index.ts`                         | Export new `dsr_tokens` table                     |
| `packages/db/migrations/`                                 | New Drizzle migration for `dsr_tokens` table      |
| `apps/control-plane/src/app/api/dsr/initiate/route.ts`    | NEW — POST handler (JWT-authed)                   |
| `apps/control-plane/src/app/api/dsr/access/route.ts`      | NEW — POST handler (token-authed)                 |
| `apps/control-plane/src/app/api/dsr/erase/route.ts`       | NEW — POST handler (token-authed)                 |
| `apps/control-plane/src/app/api/dsr/portability/route.ts` | NEW — POST handler (token-authed)                 |
| `apps/control-plane/src/lib/dsr-token.ts`                 | NEW — token generation, hashing, validation logic |
| `apps/control-plane/src/lib/__tests__/dsr-token.test.ts`  | NEW — unit tests for token lib                    |
| `apps/control-plane/src/lib/__tests__/dsr-routes.test.ts` | NEW — integration tests for routes                |

Read `packages/db/src/schema/session_embeddings.ts`, `packages/db/src/schema/consent_records.ts`,
and `packages/db/src/schema/ab_bandit_weights.ts` before implementing. The erasure transaction must
reference exact column names from those schemas.

## Test expectations

### Unit tests (required)

1. **Token generation is unique.** Generate 1,000 tokens. Assert no two share the same `token_hash`.

2. **Token expiry is enforced.** Create a token with `expires_at = now() - 1s`. Call
   `validateToken()`. Assert result is `{ valid: false, reason: 'token_expired' }`.

3. **Token one-time-use is enforced.** Create and mark a token as used (`used_at = now()`). Call
   `validateToken()`. Assert result is `{ valid: false, reason: 'token_already_used' }`.

4. **Erasure transaction rolls back on failure.** Mock the `consent_records` delete to throw. Assert
   the `session_embeddings` delete is also rolled back (row still present).

### Integration tests (required)

5. **Full DSR flow — erase.** Call `POST /api/dsr/initiate` with valid JWT + valid `session_id`.
   Assert `202`. Extract token. Call `POST /api/dsr/erase` with token. Assert `200`, assert
   `session_embeddings` row is gone, assert Redpanda emit was called with correct payload.

6. **Full DSR flow — access.** Same setup. Call `POST /api/dsr/access`. Assert `200` and response
   shape includes `session_id`, `matched_archetype`, `consent_records`.

7. **Token reuse returns 401.** Complete the erase flow. Submit the same token again. Assert
   `401 { error: "token_already_used" }`.

8. **Tenant isolation.** Create a token for tenant A. Submit it from a route handler that resolves
   to tenant B's context. Assert `401`.

## Branch naming

`backend-engineer/TICKET-GDPR-002-dsr-endpoints`

## PR title format

`feat(control-plane,db): DSR endpoints — access, erase, portability with OTP token gate [TICKET-GDPR-002]`

## Definition of done

- PR opened, all local checks green.
- `gh pr checks <pr-number> --watch` returns all SUCCESS.
- PM-orchestrator validates AC items 1–10 above.
- PM-orchestrator comments `PM-validated. CI green. Ready for human review and merge.`
- Ticket moved to `READY_FOR_REVIEW` in QUEUE.md.
