---
id: TICKET-023
title: API key model (public + secret keys, HMAC-SHA256, rotation)
sprint: 2
priority: P0
agent: backend-engineer
status: BLOCKED
estimated_hours: 5
depends_on: [TICKET-021]
produces: [TICKET-024]
affects_files:
  - 'packages/db/src/schema/api_keys.ts'
  - 'packages/db/migrations/0003_create_api_keys.sql'
  - 'packages/auth/src/api-keys.ts'
  - 'packages/auth/src/index.ts'
  - 'packages/auth/tests/api-keys.test.ts'
context_files:
  - docs/MASTER_DESIGN.md (section J.2 — API key model)
  - apps/ingest/src/auth.ts (TICKET-012, currently uses KV — to be migrated to Postgres)
  - .claude/agents/backend-engineer.md
labels: [sprint-2, p0, backend, security, auth]
---

# TICKET-023: API key model

## Summary

Implement the per-tenant API key model in Postgres + library functions in `packages/auth`. Two key
types: `pk_live_*` (public, for SDK ingest) and `sk_live_*` (secret, for server-side). Plain key
shown ONCE at generation; only HMAC-SHA256 hash stored. Per-key scopes and origin restrictions.
Library functions: generate, verify, rotate, revoke, list. Used by ingest worker and control-plane.

## Context

Master Design J.2 specifies HMAC SHA-256 for keys. Public keys are origin-locked (CORS-style
allowlist). Secret keys are not sent from browser — server-side only. Both have scopes:
`read:events`, `write:adaptations`, `admin:config`.

This is a security-critical ticket. Get it right.

## Scope

### In scope

- `packages/db/src/schema/api_keys.ts` — Drizzle schema:
  - `id UUID PK`
  - `tenant_id UUID FK NOT NULL`
  - `key_type TEXT NOT NULL CHECK (key_type IN ('public','secret'))`
  - `key_prefix TEXT NOT NULL UNIQUE` (e.g., `pk_live_abc12345` first 12 chars after type, used for
    fast lookup)
  - `key_hash TEXT NOT NULL` (HMAC-SHA256 hex of full key)
  - `scopes TEXT[] NOT NULL DEFAULT '{}'`
  - `allowed_origins TEXT[]` (only for public keys)
  - `name TEXT` (human-readable, e.g., "Production SDK")
  - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
  - `last_used_at TIMESTAMPTZ`
  - `expires_at TIMESTAMPTZ`
  - `revoked_at TIMESTAMPTZ`
- `packages/db/migrations/0003_create_api_keys.sql` — DDL + RLS (admin/editor of tenant can manage;
  viewer can list with `key_hash` redacted)
- `packages/auth/src/api-keys.ts`:
  - `generatePublicKey(tenantId, opts): { key: string, record: ApiKey }` — returns plaintext ONCE
  - `generateSecretKey(tenantId, opts): { key: string, record: ApiKey }` — same
  - `verifyKey(plaintextKey): { valid: boolean, tenantId?: string, scopes?: string[] }` — looks up
    by prefix, compares hash
  - `revokeKey(keyId): void`
  - `rotateKey(keyId): { newKey: string, oldRevokedAt: Date }`
- HMAC secret stored in env var `API_KEY_HMAC_SECRET` (32+ random bytes)
- Tests: generate keys, verify valid key, verify invalid key, verify revoked key, verify expired
  key, rotation produces new key + revokes old, scope checks work

### Out of scope

- Origin enforcement at runtime (TICKET-012 ingest does that — update in Sprint 3 if needed)
- Key usage analytics dashboard (Sprint 8)
- IP allowlisting (Sprint 9 if requested)

## Acceptance criteria

- [ ] AC1: Migration creates `api_keys` table with all columns + RLS
- [ ] AC2: Public key format: `pk_live_<32 chars>` (alphanumeric); secret format:
      `sk_live_<48 chars>`
- [ ] AC3: `key_prefix` stored is full key minus last 16 chars (first 16-32 chars after type
      prefix); enables fast lookup with low collision risk
- [ ] AC4: `generatePublicKey` returns plaintext key + DB record; subsequent calls cannot retrieve
      plaintext (only hash stored)
- [ ] AC5: `verifyKey` compares HMAC hash in constant time (`crypto.timingSafeEqual`); returns
      `{ valid, tenantId, scopes }` on success
- [ ] AC6: Key with `revoked_at` set returns `{ valid: false }`
- [ ] AC7: Key with `expires_at` in past returns `{ valid: false }`
- [ ] AC8: `verifyKey` updates `last_used_at` async (non-blocking) — important for analytics
- [ ] AC9: Tests cover at least 12 cases covering generation, verification (valid, expired, revoked,
      wrong tenant, wrong type), rotation, scope filtering
- [ ] AC10: HMAC secret rotation documented in runbook (out of scope to implement, but note where it
      lives)
- [ ] AC11: PR title `feat(auth): api key model with hmac [TICKET-023]`

## Implementation guidance

```typescript
// packages/auth/src/api-keys.ts
import { createHmac, randomBytes } from 'node:crypto';
import { eq, and, isNull, gt, sql } from 'drizzle-orm';
import { apiKeys, type Database } from '@estalara/db';

const PREFIX_LEN = { public: 16, secret: 24 }; // chars after pk_live_/sk_live_

export type GenerateOptions = {
  scopes: string[];
  name?: string;
  allowedOrigins?: string[];
  expiresAt?: Date;
};

export async function generatePublicKey(
  db: Database,
  tenantId: string,
  opts: GenerateOptions,
): Promise<{ key: string; id: string }> {
  const random = randomBytes(24).toString('base64url'); // 32 chars
  const key = `pk_live_${random}`;
  const prefix = key.slice(0, 8 + PREFIX_LEN.public);
  const hash = hmacSha256(key);

  const [record] = await db
    .insert(apiKeys)
    .values({
      tenantId,
      keyType: 'public',
      keyPrefix: prefix,
      keyHash: hash,
      scopes: opts.scopes,
      allowedOrigins: opts.allowedOrigins,
      name: opts.name,
      expiresAt: opts.expiresAt,
    })
    .returning({ id: apiKeys.id });

  return { key, id: record.id };
}

export async function verifyKey(
  db: Database,
  plaintextKey: string,
): Promise<
  | { valid: false }
  | { valid: true; tenantId: string; scopes: string[]; keyType: 'public' | 'secret' }
> {
  if (!plaintextKey.startsWith('pk_live_') && !plaintextKey.startsWith('sk_live_')) {
    return { valid: false };
  }

  const keyType = plaintextKey.startsWith('pk_live_') ? 'public' : 'secret';
  const prefixLen = 8 + PREFIX_LEN[keyType];
  const prefix = plaintextKey.slice(0, prefixLen);

  const found = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyPrefix, prefix), isNull(apiKeys.revokedAt)))
    .limit(1);

  if (found.length === 0) return { valid: false };
  const record = found[0]!;

  // Expiration check
  if (record.expiresAt && record.expiresAt < new Date()) return { valid: false };

  // Constant-time hash comparison
  const computed = hmacSha256(plaintextKey);
  if (!constantTimeEqual(computed, record.keyHash)) return { valid: false };

  // Update last_used_at non-blocking
  void db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, record.id));

  return {
    valid: true,
    tenantId: record.tenantId,
    scopes: record.scopes,
    keyType: record.keyType as 'public' | 'secret',
  };
}

function hmacSha256(input: string): string {
  const secret = process.env.API_KEY_HMAC_SECRET;
  if (!secret) throw new Error('API_KEY_HMAC_SECRET not set');
  return createHmac('sha256', secret).update(input).digest('hex');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
```

## Test plan

- Unit: 12+ tests as per AC9
- Property test: 1000 random keys, none collide on prefix, all verify correctly, none decrypted to
  wrong tenant
- Performance: verify operation < 5ms p95 (includes one Postgres lookup)

## Definition of Done

- [ ] Branch `backend-engineer/TICKET-023-api-keys-hmac`
- [ ] PR title above
- [ ] All ACs verified
- [ ] CI green via `gh pr checks <pr> --watch`
- [ ] Prettier clean
- [ ] HANDOFF: TICKET-023 → TICKET-024 (auth middleware)

## Notes

- The HMAC secret rotation (changing `API_KEY_HMAC_SECRET`) invalidates ALL existing keys. Document
  this clearly. Real rotation requires a key-by-key re-issuance flow which is out of MVP scope.
- For ingest Worker, this Postgres-backed model replaces the KV-based stub from TICKET-012.
  Migration of ingest happens in a follow-up small ticket (or as part of TICKET-024).
