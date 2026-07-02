/**
 * PGlite-driven tests for `verifyAndConsumeOtp` (FOLLOW-455 / audit F-20).
 *
 * Drives the ACTUAL production function against a real PGlite (in-memory
 * Postgres) engine — not a mocked `db.select()`/`db.update()` chain — so the
 * request-scoped lookup, attempt-cap/lockout, and atomic mark-used behaviour
 * are proven against real SQL, not against a mock that would happily accept
 * a divergent implementation.
 *
 * ACs covered (FOLLOW-455):
 *   1. Request-scoped lookup: a correct OTP submitted against the WRONG
 *      request_id (a different pending request's id) does NOT verify, even
 *      though the code itself might coincidentally match a global hash scan.
 *      This is the direct regression test for audit F-20's "brute-forceable
 *      across tenants" finding — request_id is now required.
 *   2. Attempt cap + lockout: MAX_OTP_ATTEMPTS wrong guesses against ONE
 *      request lock that request; a subsequent CORRECT guess is rejected
 *      with reason 'locked'.
 *   3. Atomic mark-used: two concurrent verify calls with the correct code
 *      — only one succeeds, the other reports 'already_used'. No double-
 *      erasure race.
 *   4. dsr_type isolation: a valid (request_id, token) for capability 'access'
 *      does not verify against dsrType 'erase'.
 *   5. Expired / already-used / not-found — unchanged behaviour vs pre-455.
 *
 * @vitest-environment node
 *
 * Why node environment?
 *   PGlite (WebAssembly Postgres) requires the Node.js WebAssembly runtime.
 *   The `@vitest-environment node` directive overrides the package default
 *   (jsdom) for this file only.
 *
 * @module apps/control-plane/src/lib/__tests__/dsr-verify.test
 */

import { createHash } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import type { createAdminClient } from '@estalara/db';

import { MAX_OTP_ATTEMPTS, verifyAndConsumeOtp } from '../dsr-verify.js';

// The fns under test are typed against the production admin client; the pglite
// engine is structurally compatible at runtime, so we cast the test db to it.
type TestDb = ReturnType<typeof createAdminClient>;

const FIXTURE_DDL = /* sql */ `
  CREATE TABLE IF NOT EXISTS tenants (
    id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    slug text NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS dsr_verifications (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id      text NOT NULL,
    email           text NOT NULL DEFAULT 'test@example.com',
    dsr_type        text NOT NULL DEFAULT 'erase',
    otp_hash        text NOT NULL,
    expires_at      timestamptz NOT NULL,
    used_at         timestamptz,
    durable_lead_id text,
    attempt_count   integer NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now()
  );
`;

function hashOtpLocal(otp: string): string {
  return createHash('sha256').update(otp).digest('hex');
}

let pg: PGlite;
let db: TestDb;
let TENANT_ID: string;

beforeAll(async () => {
  pg = new PGlite();
  await pg.waitReady;
  await pg.exec(FIXTURE_DDL);
  db = drizzlePglite(pg) as unknown as TestDb;

  const row = await pg.query<{ id: string }>(
    `INSERT INTO tenants (name, slug) VALUES ('DSR Verify Test Tenant', 'dsr-verify-pglite') RETURNING id`,
  );
  const t = row.rows[0];
  if (!t) throw new Error('Failed to insert test tenant');
  TENANT_ID = t.id;
});

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec('DELETE FROM dsr_verifications');
});

/** Seed a dsr_verifications row and return its id + raw OTP. */
async function seedVerification(
  opts: {
    sessionId?: string;
    dsrType?: 'access' | 'erase' | 'portability';
    otp?: string;
    expiresInMs?: number;
    attemptCount?: number;
    usedAt?: Date | null;
  } = {},
): Promise<{ requestId: string; otp: string }> {
  const otp = opts.otp ?? '123456';
  const otpHash = hashOtpLocal(otp);
  const expiresAt = new Date(Date.now() + (opts.expiresInMs ?? 15 * 60 * 1000)).toISOString();

  const res = await pg.query<{ id: string }>(
    `INSERT INTO dsr_verifications
       (tenant_id, session_id, email, dsr_type, otp_hash, expires_at, attempt_count, used_at)
     VALUES ($1, $2, 'subject@example.com', $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      TENANT_ID,
      opts.sessionId ?? 'sess-verify-001',
      opts.dsrType ?? 'erase',
      otpHash,
      expiresAt,
      opts.attemptCount ?? 0,
      opts.usedAt ? opts.usedAt.toISOString() : null,
    ],
  );
  const row = res.rows[0];
  if (!row) throw new Error('Failed to insert dsr_verifications');
  return { requestId: row.id, otp };
}

// ─── AC1: request-scoped lookup ────────────────────────────────────────────

describe('AC1 (FOLLOW-455): request-scoped lookup — not global-by-hash', () => {
  it('verifies successfully when (request_id, token, dsr_type) all match', async () => {
    const { requestId, otp } = await seedVerification({ dsrType: 'erase' });

    const result = await verifyAndConsumeOtp(db, { requestId, token: otp, dsrType: 'erase' });

    expect(result.ok).toBe(true);
  });

  it('rejects a correct OTP submitted against a DIFFERENT pending request_id', async () => {
    // Two DIFFERENT pending requests happen to share the SAME OTP value —
    // a plausible coincidence at scale (1e6 code space). Under the OLD
    // global-by-hash lookup this would have matched EITHER row. Under the
    // request-scoped lookup, presenting request A's id with a token that
    // matches request B's hash must NOT verify.
    const SHARED_OTP = '555555';
    const { requestId: requestIdA } = await seedVerification({
      sessionId: 'sess-victim',
      otp: SHARED_OTP,
    });
    const { requestId: requestIdB } = await seedVerification({
      sessionId: 'sess-attacker-own-request',
      otp: '999999',
    });

    // Attacker knows their OWN request_id (requestIdB) but guesses the code
    // that happens to match victim A's hash. Must fail — the lookup is
    // scoped to requestIdB, whose stored hash is for '999999', not '555555'.
    const result = await verifyAndConsumeOtp(db, {
      requestId: requestIdB,
      token: SHARED_OTP,
      dsrType: 'erase',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_code');

    // The victim's request must remain fully valid and unaffected.
    const victimResult = await verifyAndConsumeOtp(db, {
      requestId: requestIdA,
      token: SHARED_OTP,
      dsrType: 'erase',
    });
    expect(victimResult.ok).toBe(true);
  });

  it('returns not_found for a request_id that does not exist', async () => {
    const result = await verifyAndConsumeOtp(db, {
      requestId: '00000000-0000-0000-0000-000000000000',
      token: '123456',
      dsrType: 'erase',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_found');
  });

  it('AC4: does not verify when dsr_type does not match the capability (isolation)', async () => {
    const { requestId, otp } = await seedVerification({ dsrType: 'access' });

    const result = await verifyAndConsumeOtp(db, { requestId, token: otp, dsrType: 'erase' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not_found');
  });
});

// ─── AC2: attempt cap + lockout ─────────────────────────────────────────────

describe('AC2 (FOLLOW-455): per-capability attempt cap + lockout', () => {
  it(`locks the request after ${String(MAX_OTP_ATTEMPTS)} wrong guesses, even for the CORRECT code afterward`, async () => {
    const { requestId, otp } = await seedVerification();

    for (let i = 0; i < MAX_OTP_ATTEMPTS; i++) {
      const wrongResult = await verifyAndConsumeOtp(db, {
        requestId,
        token: '000000',
        dsrType: 'erase',
      });
      expect(wrongResult.ok).toBe(false);
      if (!wrongResult.ok) expect(wrongResult.reason).toBe('invalid_code');
    }

    // The (MAX_OTP_ATTEMPTS + 1)th attempt — even with the CORRECT code — is locked.
    const lockedResult = await verifyAndConsumeOtp(db, { requestId, token: otp, dsrType: 'erase' });
    expect(lockedResult.ok).toBe(false);
    if (!lockedResult.ok) expect(lockedResult.reason).toBe('locked');
  });

  it('does not increment the attempt counter on a correct guess', async () => {
    const { requestId, otp } = await seedVerification();

    const result = await verifyAndConsumeOtp(db, { requestId, token: otp, dsrType: 'erase' });
    expect(result.ok).toBe(true);

    const row = await pg.query<{ attempt_count: number }>(
      'SELECT attempt_count FROM dsr_verifications WHERE id = $1',
      [requestId],
    );
    expect(row.rows[0]?.attempt_count).toBe(0);
  });

  it('a request under the cap still accepts the correct code after some wrong guesses', async () => {
    const { requestId, otp } = await seedVerification();

    await verifyAndConsumeOtp(db, { requestId, token: '111111', dsrType: 'erase' });
    await verifyAndConsumeOtp(db, { requestId, token: '222222', dsrType: 'erase' });

    const result = await verifyAndConsumeOtp(db, { requestId, token: otp, dsrType: 'erase' });
    expect(result.ok).toBe(true);
  });
});

// ─── AC3: atomic mark-used ──────────────────────────────────────────────────

describe('AC3 (FOLLOW-455): atomic mark-used — no double-consume race', () => {
  it('only one of two concurrent correct-code verifications succeeds', async () => {
    const { requestId, otp } = await seedVerification();

    const [first, second] = await Promise.all([
      verifyAndConsumeOtp(db, { requestId, token: otp, dsrType: 'erase' }),
      verifyAndConsumeOtp(db, { requestId, token: otp, dsrType: 'erase' }),
    ]);

    const oks = [first, second].filter((r) => r.ok);
    const failures = [first, second].filter((r) => !r.ok);

    expect(oks).toHaveLength(1);
    expect(failures).toHaveLength(1);
    const failure = failures[0];
    if (failure) expect(failure.reason).toBe('already_used');
  });

  it('a second sequential verification of an already-used request reports already_used', async () => {
    const { requestId, otp } = await seedVerification();

    const first = await verifyAndConsumeOtp(db, { requestId, token: otp, dsrType: 'erase' });
    expect(first.ok).toBe(true);

    const second = await verifyAndConsumeOtp(db, { requestId, token: otp, dsrType: 'erase' });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('already_used');
  });
});

// ─── AC5: expired / already-used / not-found (unchanged semantics) ────────

describe('AC5 (FOLLOW-455): expiry and pre-used semantics unchanged', () => {
  it('returns expired for a request past expires_at', async () => {
    const { requestId, otp } = await seedVerification({ expiresInMs: -1000 });

    const result = await verifyAndConsumeOtp(db, { requestId, token: otp, dsrType: 'erase' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('expired');
  });

  it('returns already_used for a request with used_at already set', async () => {
    const { requestId, otp } = await seedVerification({ usedAt: new Date(Date.now() - 60_000) });

    const result = await verifyAndConsumeOtp(db, { requestId, token: otp, dsrType: 'erase' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('already_used');
  });
});
