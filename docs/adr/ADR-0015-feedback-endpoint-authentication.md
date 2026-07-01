# ADR-0015 — Feedback endpoint authentication: permanent fix for ESC-035 / F-09

**Status:** ACCEPTED — 2026-07-01 **Tickets:** FOLLOW-443 (P0 design), FOLLOW-444 (interim 503
already merged PR #397) **Cross-references:** ESC-035, ADR-0006, ADR-0013, Master Design §V.3.2,
§V.3.5, `apps/control-plane/src/app/api/adapt/feedback/route.ts`,
`apps/control-plane/src/app/api/quiz/public-config/route.ts` (existing `resolveApiKey` pattern),
`packages/db/src/schema/api_keys.ts`

---

## Context

### The vulnerability (verified, ESC-035)

`apps/control-plane/src/app/api/adapt/feedback/route.ts:143` computes:

```ts
const expectedHex = await hmacSha256Hex(bearerToken, rawBody);
```

where `bearerToken` is the **caller-supplied** `Authorization: Bearer <value>`, with NO lookup
against `api_keys`. Because the HMAC key is the same string the caller supplies as the "credential,"
any caller can produce a valid HMAC over any crafted payload and pass signature verification. There
is no check that the bearer corresponds to a real registered key.

`tenantId` is then taken from `parsed.data.tenant_id` (request body, lines 374 and 395), not from a
server-resolved row. Any caller can therefore write `ab_bandit_weights` and `conversion_labels` for
**any** `tenant_id` they name.

The `ADAPT_API_KEY` ops fallback (lines 130–134) is a string comparison against a server env var; it
only protects the ops bypass path. The HMAC branch is entirely unprotected.

**Impact:** Forgeable pilot A/B results; adversarial poisoning of Thompson sampling Beta parameters
and the conversion-label fine-tuning corpus for any tenant.

### The hashed_key column is SHA-256, not argon2id (correction to ESC-035 framing)

The ESC-035 filing and the schema docstring (`/** argon2id hash of the raw key. */`) both state that
`api_keys.hashed_key` is an argon2id hash, implying you cannot do an O(1) indexed lookup against it.
**This is incorrect in the live implementation:**

`apps/control-plane/scripts/seed-local-tenant.mts:73`:

```ts
const HASHED_API_KEY = createHash('sha256').update(RAW_API_KEY, 'utf8').digest('hex');
```

`apps/control-plane/src/app/api/quiz/public-config/route.ts:156`:

```ts
const keyHash = await sha256Hex(bearerToken);
// …
const rows = await db.select(…).from(apiKeys).where(eq(apiKeys.hashedKey, keyHash), …)
```

The column is `SHA-256(rawKey)` stored as a hex string, with a unique index
(`api_keys_hashed_key_idx`). Other routes (`GET /api/quiz/public-config`, `GET /api/intent/config`)
already resolve bearer tokens to tenant rows in O(1) via this exact pattern using `resolveApiKey()`.

This means the permanent fix requires **no schema migration** and **no new column**. The existing
infrastructure is complete; the feedback route simply needs to use it.

### Current mitigation

FOLLOW-444 (PR #397, merged 2026-06-30) ships an interim secure-by-default 503:

```ts
if (process.env.FEEDBACK_ENDPOINT_ENABLED !== 'true') {
  return NextResponse.json({ error: 'SERVICE_TEMPORARILY_UNAVAILABLE', … }, { status: 503 });
}
```

The endpoint remains **disabled in production** until this ADR's fix ships and all prerequisites in
§Lifting the 503 are met.

### CEO ruling (2026-07-01, ESC-035)

`ADAPT_API_KEY` ops bypass is **retained but permanently scoped** to a single designated ops tenant
via `OPS_TENANT_ID` env var (already partially wired in FOLLOW-444). Any feedback request carrying
`ADAPT_API_KEY` that names a `body.tenant_id` other than `OPS_TENANT_ID` is rejected 403. This is
the permanent disposition — not a temporary measure.

---

## Decision

**Use the existing `resolveApiKey()` pattern from `quiz/public-config/route.ts` inside the feedback
route.** No schema migration, no new env var, no new column, no SDK changes.

The fix is confined to `apps/control-plane/src/app/api/adapt/feedback/route.ts`:

1. Extract `resolveApiKey()` into a shared location (`apps/control-plane/src/lib/api-key-auth.ts`)
   so both the existing routes and the feedback route import from one canonical implementation.
2. Call `resolveApiKey(req)` as the first auth step in the feedback route — before any HMAC body
   signature check.
3. Use `resolvedTenantId` from the returned row for ALL downstream writes.
4. Verify `body.tenant_id === resolvedTenantId` (cross-tenant rejection).
5. Retain HMAC body signature (`X-Estalara-Signature`) verification as defense-in-depth, keyed by
   the same `bearerToken` the SDK already signs with.

---

## Wire contract (no change to SDK)

The SDK (`packages/sdk/src/core/adapt.ts:postFeedbackPing`) currently sends:

```
Authorization: Bearer {config.apiKey}
X-Estalara-Signature: HMAC_SHA256(config.apiKey, rawBodyText)
Content-Type: application/json

Body: { session_id, tenant_id, archetype, variant, converted, [prediction_id], [lead_id] }
```

**This contract does not change.** No SDK re-deployment is required. No `backlog/HANDOFFS.md` entry
to sdk-engineer is needed.

`body.tenant_id` stays in the body schema for backward compat and for the cross-tenant enforcement
check. The server uses `resolvedTenantId` from the DB row for writes; `body.tenant_id` is only
compared against it.

---

## Shared `resolveApiKey()` — canonical implementation

Extract this function from `quiz/public-config/route.ts` into:

**`apps/control-plane/src/lib/api-key-auth.ts`** (new file)

```ts
/**
 * Resolve a tenant from `Authorization: Bearer <raw-key>` header.
 *
 * Computes SHA-256(bearerToken), looks up `api_keys.hashed_key` via unique index (O(1)).
 * Constant-time belt-and-suspenders comparison prevents timing oracle.
 *
 * @returns `{ ok: true, tenantId }` on success.
 * @returns `{ ok: false, status, error }` on failure (missing/invalid bearer, key not
 *          found, key revoked or expired).
 *
 * @see packages/db/src/schema/api_keys.ts — hashed_key = SHA-256(rawKey), unique index
 * @see ADR-0015 — canonical auth for tenant-scoped API endpoints
 */
export async function resolveApiKey(req: NextRequest): Promise<ApiKeyAuthResult>;

type ApiKeyAuthResult =
  | { ok: true; tenantId: string }
  | { ok: false; status: 401 | 404; error: string };
```

The existing `quiz/public-config/route.ts` is updated to import from this shared lib (instead of a
local copy). The `intent/config/route.ts` is also updated if it duplicates the same logic (Rule K.1
— no intra-runtime logic duplication).

---

## Verification algorithm (step-by-step, feedback/route.ts)

```
Step 1 — Guard: endpoint enabled
  if (FEEDBACK_ENDPOINT_ENABLED !== 'true') → 503

Step 2 — Ops bypass (ADAPT_API_KEY path)
  if (ADAPT_API_KEY is set):
    extract bearerToken
    if (bearerToken === ADAPT_API_KEY):
      if (OPS_TENANT_ID is not set) → 500 (server misconfiguration)
      resolvedTenantId = OPS_TENANT_ID
      goto Step 6 (body parse + tenant enforcement)

Step 3 — resolveApiKey(req)
  Extracts bearerToken from Authorization header.
  Computes keyHash = SHA256(bearerToken).
  SELECT tenant_id, hashed_key FROM api_keys
    WHERE hashed_key = $keyHash
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1.
  Belt-and-suspenders: constantTimeEqual(row.hashed_key, keyHash).
  if (no match or check fails) → 401 AUTH_REQUIRED / FORBIDDEN

Step 4 — resolvedTenantId = row.tenantId

Step 5 — HMAC body signature (defense-in-depth)
  Read raw body text (req.text() — must be called once, before JSON.parse).
  signatureHeader = X-Estalara-Signature header.
  if (!signatureHeader) → 401 FORBIDDEN (missing signature)
  if (!/^[0-9a-f]{64}$/.test(signatureHeader)) → 401 FORBIDDEN (malformed)
  expectedSig = HMAC_SHA256(bearerToken, rawBody)
  if (!constantTimeEqual(expectedSig, signatureHeader)) → 401 FORBIDDEN (invalid sig)
  // At this point: bearer is a registered non-revoked key AND caller knows the raw
  // key value (proven by valid HMAC).

Step 6 — Parse body JSON
  parsed = FeedbackBodySchema.safeParse(JSON.parse(rawBody))
  if (!parsed.success) → 400 VALIDATION_ERROR

Step 7 — Cross-tenant enforcement
  if (parsed.data.tenant_id !== resolvedTenantId):
    → 403 FORBIDDEN
       body: { error: 'FORBIDDEN',
               message: 'tenant_id in body does not match the API key tenant' }
  // Use resolvedTenantId for all downstream writes.

Step 8 — Fire-and-forget writes
  afterResponse(() => updateArmAsync({ tenantId: resolvedTenantId, … }))
  if (parsed.data.prediction_id):
    afterResponse(() => upsertConversionLabelAsync({ tenantId: resolvedTenantId, … }))
  return 202 Accepted
```

### Why HMAC body signature is retained (Step 5)

Dropping the HMAC check and relying solely on SHA-256 bearer lookup (Step 3) would accept any caller
who presents a valid API key for ANY body — including bodies crafted to maximize `converted: true`
noise. The HMAC body signature proves the caller computed a keyed digest over the exact body being
submitted, tying the auth credential to the payload content. This defense-in-depth layer has no cost
(the SDK already computes it) and is consistent with the existing threat model in Master Design
§V.3.2.

### Constant-time guarantees

- Step 3: `keyHash = SHA256(bearerToken)` is computed deterministically; the DB lookup is by indexed
  equality (timing depends only on DB I/O, not on key matching). The belt-and-suspenders
  `constantTimeEqual(row.hashed_key, keyHash)` prevents any residual timing oracle on the hash
  comparison.
- Step 5: `constantTimeEqual(expectedSig, signatureHeader)` XOR-accumulates over all bytes without
  short-circuiting. No change required from the existing implementation.
- Step 2 (ops bypass): `bearerToken === ADAPT_API_KEY` is JavaScript strict equality
  (short-circuits). Acceptable: `ADAPT_API_KEY` is a server-side env var, never in the SDK snippet;
  rate-limit guessing via the API is infeasible.

### Replay protection

Not added. The bandit update is idempotent (`converted: true` replay just increments `alpha` by 1
again). Replay protection via Redis nonce would require storing `Idempotency-Key` per-request with a
TTL and add latency to a fire-and-forget path; deferred to post-MVP per the existing threat model in
Master Design §V.3.2.

---

## ADAPT_API_KEY ops bypass — permanent disposition (CEO ruling 2026-07-01)

```
if ADAPT_API_KEY is set AND bearerToken === ADAPT_API_KEY:
  if OPS_TENANT_ID is not set → 500 (misconfigured server)
  resolvedTenantId = OPS_TENANT_ID
  skip Steps 3-5 (SHA-256 lookup + HMAC body sig)
  goto Step 6 (body parse + tenant enforcement)
  In Step 7: body.tenant_id must equal OPS_TENANT_ID; reject 403 otherwise
```

**Threat model for the ops path (permanent):** `ADAPT_API_KEY` is a Doppler secret, never sent to
the browser, never visible in the page source. A leak exposes only `OPS_TENANT_ID` writes, not
arbitrary tenants. Rotation via Doppler + re-deploy closes the leak immediately.

This is a permanent documented exception to Rule H's "production-grade auth in the same PR"
requirement, consistent with the Rule H amendment that allows internal-only endpoints with an
ADR-documented threat model.

---

## Schema change

**None required.** `api_keys.hashed_key` already stores `SHA-256(rawKey)` with a unique index
(`api_keys_hashed_key_idx`). The schema comment (`/** argon2id hash of the raw key. */`) is
incorrect and must be fixed as part of this ticket:

```ts
// packages/db/src/schema/api_keys.ts — CHANGE comment only:
- /** argon2id hash of the raw key. */
+ /** SHA-256(rawKey) hex digest. Used for O(1) bearer→row resolution. See ADR-0015. */
  hashedKey: text('hashed_key').notNull().unique(),
```

No migration SQL is needed.

---

## Migration and key-rotation story

Because the schema does not change, no DB migration is required and all existing API keys already
work with the new verification path. The key-rotation 24h grace period (Master Design §V.3.5) and
the `rotated_at` / `revoked_at` lifecycle are unaffected.

---

## Lifting the interim 503

The `FEEDBACK_ENDPOINT_ENABLED=true` flag (FOLLOW-444) may be set in production only after ALL of
the following are satisfied:

1. `apps/control-plane/src/lib/api-key-auth.ts` exists and exports `resolveApiKey`.
2. `feedback/route.ts` calls `resolveApiKey(req)` and uses the returned `tenantId` for all writes
   (Steps 3–4 of the verification algorithm).
3. `feedback/route.ts` cross-tenant check (Step 7) is in place.
4. HMAC body signature check (Step 5) is in place.
5. Ops bypass is scoped to `OPS_TENANT_ID` (Step 2 above; already partially wired by FOLLOW-444).
6. All 12 acceptance-criteria tests (see §Acceptance Criteria) are green in CI.
7. The PR has been reviewed and merged; `main` CI is green.

This is the same deploy as the fix itself — no separate rotation step is needed.

---

## Consequences

### Positive

- No schema migration, no new env var, no SDK change, no tenant re-deployment.
- Leverages the same `resolveApiKey()` pattern already proven in two other routes; the pattern is
  understood, tested, and consistent across the control plane.
- Cross-tenant write-poisoning is closed at Step 7 — the tenant is server-derived from the SHA-256
  lookup, never from the request body.
- The schema comment inaccuracy (argon2 vs SHA-256) is fixed in the same PR, preventing future
  implementors from designing incorrect "O(n) argon2 scan" workarounds.
- Extraction of `resolveApiKey()` into `lib/api-key-auth.ts` eliminates a current K.1 intra-runtime
  duplication (the same logic is currently copy-pasted between `quiz/public-config/route.ts` and
  `intent/config/route.ts`).

### Negative

- The feedback route must read `req.text()` for the raw body before calling `JSON.parse()` (to
  support HMAC verification on the same text). This is the existing pattern in the route; no change
  needed.
- Extracting `resolveApiKey()` to a shared lib touches two additional route files
  (`quiz/public-config`, `intent/config`). These are low-risk changes (import path only); tests
  should confirm no behavioral change.

### Risks

- **Shared lib divergence:** If `api-key-auth.ts` is later modified (e.g. to add scope checks), all
  three consuming routes pick up the change simultaneously. This is a feature (consistency), but
  requires that scope additions be backward-compatible. Mitigation: Rule I CI gate ensures importers
  exist; any breakage surfaces immediately in the test suite.
- **Timing oracle on SHA-256 lookup:** The indexed DB lookup timing is dominated by I/O, not by key
  matching. The constant-time `hashedKey` comparison after the lookup removes any residual
  in-process oracle. No new attack surface introduced.

### Reversibility

HIGH. The fix adds one new shared lib file and modifies one route file. Reverting to the interim 503
state is a `git revert` + re-deploy. No data is changed.

---

## Alternatives considered

### Option A — per-key HMAC signing secret (new column, new SDK field)

Store a separate `signing_secret` column per key; SDK is configured with both the public `apiKey`
and a `signingSecret`; server looks up by key prefix/ID header and verifies
`HMAC(signing_secret, body)`.

**Rejected:** Requires distributing a second secret to the SDK (`config.signingSecret`), meaning all
existing SDK deployments must be re-configured. Also requires UI to display and rotate
`signing_secret` separately from the API key. The existing SHA-256 `hashed_key`

- `resolveApiKey()` pattern achieves the same result with zero SDK changes.

### Option B as originally framed — new `lookup_hash` column (HMAC_SHA256 with pepper)

Add `lookup_hash = HMAC_SHA256(LOOKUP_KEY_PEPPER, rawKey)` as a new column with unique index; add
`LOOKUP_KEY_PEPPER` env var; add migration; require key rotation before re-enabling the endpoint.

**Rejected (superseded by code audit):** The ESC-035 filing assumed `hashed_key` was argon2id (from
the schema comment). Code audit reveals it is SHA-256 with a unique index already. A new
`lookup_hash` column would duplicate the existing `hashed_key` with no additional security benefit.
The pepper adds protection against offline preimage attacks on the hash column, but since SHA-256 of
a high-entropy random key is already preimage- resistant, and the column is not directly accessible
to external attackers (DB is not public), the pepper provides marginal additional security at the
cost of a migration, a new secret, and a mandatory key-rotation window.

### Option C — signed short-lived token from /api/adapt

Issue a tenant-scoped JWT at adapt time; SDK reuses it for feedback.

**Rejected:** Requires a new token issuance endpoint, a token store with TTL management, two network
round-trips per feedback event, and SDK changes. More infrastructure than a shared lib function. The
SHA-256 `resolveApiKey()` pattern is sufficient.

---

## Implementation guidance for backend-engineer (FOLLOW-443 implementation ticket)

### Files to create

**`apps/control-plane/src/lib/api-key-auth.ts`** (new) — extract `resolveApiKey()`, `sha256Hex()`,
`constantTimeEqual()` from `quiz/public-config/route.ts` into this shared module. Export
`resolveApiKey` and the two helpers. Keep the existing docstring.

### Files to modify

1. **`apps/control-plane/src/app/api/adapt/feedback/route.ts`**:
   - Import `resolveApiKey` from `@/lib/api-key-auth`.
   - Replace the body of `verifyFeedbackAuth` with the algorithm in §Verification Algorithm. The
     function signature may change; callers (only the POST handler) update accordingly.
   - Remove the local `hmacSha256Hex` declaration that currently serves as the broken auth key (the
     HMAC helper can stay but must NOT be used as the auth key).
   - Step 7 cross-tenant check uses `resolvedTenantId` from Step 4.
   - The interim 503 block (lines 296–307) STAYS. Backend-engineer does NOT remove it; it is removed
     in a separate ops step (setting `FEEDBACK_ENDPOINT_ENABLED=true` in Vercel after the PR merges
     and CI is green).

2. **`apps/control-plane/src/app/api/quiz/public-config/route.ts`**: Remove local `resolveApiKey`,
   `sha256Hex`, `constantTimeEqual` declarations; import from `@/lib/api-key-auth`. No behavioral
   change.

3. **`apps/control-plane/src/app/api/intent/config/route.ts`**: Same — remove local duplicates;
   import from `@/lib/api-key-auth`. The comment in this file already says "same as
   quiz/public-config/route.ts" — this extraction fulfils that intent.

4. **`apps/control-plane/src/app/api/quiz/completion/route.ts`** and
   **`apps/control-plane/src/app/api/crm/outcome/route.ts`**: also contain copies of `sha256Hex`.
   Remove local copies; import from `@/lib/api-key-auth`. (Rule K.1 — all four copies are
   intra-runtime duplicates of the same function.)

5. **`packages/db/src/schema/api_keys.ts`**: Fix the schema comment (argon2 → SHA-256). No column
   changes.

### Acceptance criteria and test matrix

| #   | Scenario                                                                                          | Expected                   |
| --- | ------------------------------------------------------------------------------------------------- | -------------------------- |
| T1  | Valid registered key (in `api_keys`, not revoked), matching `body.tenant_id`, valid HMAC body sig | 202 Accepted               |
| T2  | Bearer token not in `api_keys` (SHA-256 lookup returns empty)                                     | 401 FORBIDDEN              |
| T3  | Valid key but `body.tenant_id` is a different tenant's ID                                         | 403 FORBIDDEN              |
| T4  | Valid key but HMAC body sig invalid (body tampered or wrong key)                                  | 401 FORBIDDEN              |
| T5  | Valid key but `X-Estalara-Signature` header absent                                                | 401 FORBIDDEN              |
| T6  | Valid key but revoked (`revoked_at IS NOT NULL`)                                                  | 401 FORBIDDEN              |
| T7  | Valid key but expired (`expires_at < now()`)                                                      | 401 FORBIDDEN              |
| T8  | Ops path: `bearerToken === ADAPT_API_KEY`, `body.tenant_id === OPS_TENANT_ID`                     | 202 Accepted               |
| T9  | Ops path: `bearerToken === ADAPT_API_KEY`, `body.tenant_id !== OPS_TENANT_ID`                     | 403 FORBIDDEN              |
| T10 | `ADAPT_API_KEY` set but `OPS_TENANT_ID` not set                                                   | 500                        |
| T11 | `FEEDBACK_ENDPOINT_ENABLED` not set (interim 503)                                                 | 503 (retain existing test) |
| T12 | `resolveApiKey` shared lib: same result as existing `quiz/public-config` test fixtures            | pass (parity test)         |

Tests for T1–T10 replace or extend the existing HMAC-path tests in `route.test.ts`. Test mocks that
construct `api_keys` rows MUST use the `ApiKey` Drizzle type from `@estalara/db` (no hand-authored
plain objects — ADR-0013 §3 test-integrity constraint).

### No HANDOFFS.md entry to sdk-engineer

The SDK request shape is unchanged. No sdk-engineer coordination is needed.

---

## Master Design update required

§V.3.2 currently describes the broken HMAC scheme as the intended design:

```
// Server (apps/control-plane/src/app/api/adapt/feedback/route.ts):
const bearerToken = authHeader.slice(7);           // raw API key
const rawBody     = await req.text();
const expected    = HMAC-SHA256(bearerToken, rawBody);
assert constantTimeEqual(provided, expected);
```

After ADR-0015 ships, §V.3.2 must be updated to describe the fixed scheme:

1. SHA-256(bearerToken) lookup in `api_keys` via `resolveApiKey()` → `resolvedTenantId`.
2. HMAC body signature as defense-in-depth (keyed by `bearerToken`, verified after row resolution).
3. `body.tenant_id` enforced against `resolvedTenantId`.

Also fix §V.3.5 schema block: comment says `hashed_key: bcrypt or argon2id` — correct to
`SHA-256(rawKey) hex digest`.

The backend-engineer implementation ticket DOES NOT update Master Design — that is a separate
architect-owned update after the PR merges. Filed as an action item below.

---

## References

- `apps/control-plane/src/app/api/adapt/feedback/route.ts` — vulnerable route (HMAC bug at line 143;
  tenant-ID source at lines 374, 395; interim 503 at lines 296–307)
- `apps/control-plane/src/app/api/quiz/public-config/route.ts:137-188` — existing `resolveApiKey()`
  implementation (canonical pattern to extract)
- `apps/control-plane/scripts/seed-local-tenant.mts:73` — confirms SHA-256 hashing
- `packages/db/src/schema/api_keys.ts` — `hashed_key` column + `api_keys_hashed_key_idx`
- `packages/sdk/src/core/adapt.ts:postFeedbackPing` — SDK sender (no changes)
- `backlog/ESCALATIONS.md` ESC-035 — vulnerability description and CEO ruling
- `CONVENTIONS_PATCH.md` Rule H (auth ratchet) — this fix closes the ratchet
- `CONVENTIONS_PATCH.md` Rule K.1 — intra-runtime logic duplication; extracting `resolveApiKey` to
  shared lib is a Rule K.1 compliance action
- Master Design §V.3.2, §V.3.5 — update required after implementation
- ADR-0013 §3 — test-integrity constraint applied to T1–T12 test fixtures
