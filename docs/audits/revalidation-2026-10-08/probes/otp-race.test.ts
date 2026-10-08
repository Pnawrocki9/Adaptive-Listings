import { expect, it } from 'vitest';
import { PGlite } from '../../../../packages/db/node_modules/@electric-sql/pglite';
import { drizzle } from '../../../../packages/db/node_modules/drizzle-orm/pglite/index.js';
import { verifyAndConsumeOtp } from '../../../../apps/control-plane/src/lib/dsr-verify';
import { hashOtp } from '../../../../apps/control-plane/src/lib/dsr-otp';

// Defect reproduction, not a desired-behavior regression. Uses real helper and SQL.
it('R02: concurrent wrong guesses exceed the advertised five-attempt cap', async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`CREATE TABLE dsr_verifications (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, session_id text NOT NULL,
      email text NOT NULL, dsr_type text NOT NULL, otp_hash text NOT NULL,
      expires_at timestamptz NOT NULL, used_at timestamptz,
      durable_lead_id text, attempt_count int NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    const requestId = '11111111-1111-4111-8111-111111111111';
    await pg.query(
      `INSERT INTO dsr_verifications
      (id, tenant_id, session_id, email, dsr_type, otp_hash, expires_at)
      VALUES ($1, $1, 'fixture-session', 'fixture@example.invalid', 'access', $2, now()+interval '15 minutes')`,
      [requestId, hashOtp('123456')],
    );
    const db = drizzle(pg);
    const actualSelect = db.select.bind(db);
    let reads = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Only control scheduling: every SELECT executes against PGlite before any UPDATE.
    /* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-function-type -- The scheduling wrapper forwards Drizzle's overloaded generic builders unchanged. */
    db.select = ((...args: unknown[]) => {
      const query = (actualSelect as Function)(...args);
      const from = query.from.bind(query);
      query.from = (...fromArgs: unknown[]) => {
        const builder = from(...fromArgs);
        const limit = builder.limit.bind(builder);
        builder.limit = async (n: number) => {
          const rows = await limit(n);
          if (++reads === 8) release();
          await barrier;
          return rows;
        };
        return builder;
      };
      return query;
    }) as typeof db.select;
    /* eslint-enable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-function-type */
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        verifyAndConsumeOtp(db as never, {
          requestId,
          token: String(900000 + i),
          dsrType: 'access',
        }),
      ),
    );
    expect(results).toEqual(
      Array.from({ length: 8 }, () => ({ ok: false, reason: 'invalid_code' })),
    );
    const rows = await pg.query<{ attempt_count: number }>(
      'SELECT attempt_count FROM dsr_verifications',
    );
    expect(rows.rows[0]?.attempt_count).toBe(8);
    console.log('R02: eight real SQL-backed validations admitted; attempt_count=8, limit=5');
  } finally {
    await pg.close();
  }
}, 20000);
