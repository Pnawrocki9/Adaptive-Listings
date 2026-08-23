/**
 * FOLLOW-819 AC(4) — direct reader for `ab_bandit_weights`.
 *
 * Reads the Beta parameters of ONE `(tenant_id, archetype, variant)` arm straight out of
 * Postgres, so AC(4) can assert a real state delta rather than trusting the feedback
 * endpoint's HTTP 202. A 202 only proves the request was accepted: the bandit write is
 * fire-and-forget behind `after()`, so the endpoint answers before `updateBanditArm()` has
 * run — and used to answer 202 in environments where that write could never land at all
 * (audit F-06).
 *
 * Deliberately a raw SQL read rather than a Drizzle import: this file is plain ESM invoked
 * by an `.mjs` harness, and pulling the TS admin client in would drag a build step into a
 * test whose entire point is to observe the substrate as it actually is.
 *
 * POOL DISCIPLINE (FOLLOW-818 / PR #826): every helper here closes its connection. Until
 * that PR, `db:migrate`, `seed:local-tenant` and `feedback:canary` all left the driver's
 * idle socket open and never exited on the success path — a `timeout`-wrapped run then
 * reported exit 124 for work that had already PASSED. An unclosed pool turns a green run
 * into a hang that reads as a failure.
 *
 * @module tests/e2e/follow-819/bandit-probe
 */

import { createRequire } from 'node:module';

// `postgres` (postgres-js v3) is a dependency of @estalara/db, not of the repo root.
const requireFromDb = createRequire(new URL('../../../packages/db/package.json', import.meta.url));
const postgres = requireFromDb('postgres');

/**
 * Read one bandit arm's Beta parameters.
 *
 * @param {string} databaseUrl - `DATABASE_URL_ADMIN` for the LOCAL Postgres (:5433).
 * @param {string} tenantId    - The seeded `local-e2e` tenant.
 * @param {string} archetype   - Archetype the real /adapt response served.
 * @param {string} variant     - Variant the real /adapt response served.
 * @returns {Promise<{alpha: number, beta: number} | null>} `null` when the arm has no row
 *   yet — which is NOT the same as Beta(1,1), and the caller must keep them distinct: a
 *   missing row becoming a Beta(2,1) row IS the delta AC(4) is looking for.
 */
export async function readBanditArm(databaseUrl, tenantId, archetype, variant) {
  const sql = postgres(databaseUrl, { max: 1, idle_timeout: 5, connect_timeout: 10 });
  try {
    const rows = await sql`
      SELECT alpha, beta
      FROM ab_bandit_weights
      WHERE tenant_id = ${tenantId}::uuid
        AND archetype = ${archetype}
        AND variant   = ${variant}
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    return { alpha: Number(rows[0].alpha), beta: Number(rows[0].beta) };
  } finally {
    // Always, on every path — see the pool-discipline note above.
    await sql.end({ timeout: 5 });
  }
}
