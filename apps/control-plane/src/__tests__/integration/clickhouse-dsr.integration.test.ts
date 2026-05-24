/**
 * Integration test — ClickHouse DSR mutation-poll contract.
 *
 * FOLLOW-081 (RETRO-007 TG-1). The unit suite
 * (`src/lib/__tests__/clickhouse-dsr.test.ts`) mocks the ClickHouse HTTP
 * response and therefore cannot exercise the part of the DSR-erase contract
 * that actually breaks in production: the *asynchronous* `system.mutations`
 * semantics. `ALTER TABLE ... DELETE WHERE` is a mutation, not a synchronous
 * DELETE — ClickHouse returns 200 immediately while `is_done` flips from 0 to
 * 1 seconds later. The `/api/dsr/mutation-poll` route's correctness hinges on
 * three live facts:
 *
 *   1. After issuing the mutation, polling `system.mutations` eventually
 *      yields `is_done = 1` and the rows are gone (happy path).
 *   2. `resolveMutationIdByMarker` can find the mutation row by the embedded
 *      `/* DSR:<marker> *\/` comment — the only link the poller has between a
 *      Postgres `dsr_clickhouse_mutations` row and the ClickHouse mutation.
 *   3. `system.mutations` exposes the `is_done` + `latest_failed_reason`
 *      columns the poller reads (route.ts:223, route.ts:224). A ClickHouse
 *      upgrade that renames/removes either column would silently break erase
 *      and only surface during a real EU DSR — the worst possible time. This
 *      canary fails loudly instead.
 *
 * Transport: these specs reuse the *production* `fetch`-based helpers from
 * `@/lib/clickhouse-dsr` (`executeClickHouseSql`, `queryClickHouseJson`,
 * `issueEraseMutation`, `pollMutationStatus`, `resolveMutationIdByMarker`,
 * `readClickHouseConfig`). That module talks to ClickHouse over the HTTP
 * interface — it does NOT use `@clickhouse/client` (no such dependency exists
 * in the repo). Driving the test through the same code path the cron poller
 * uses is what makes this a contract test rather than a re-implementation.
 *
 * Safety:
 *   - These specs NEVER touch production tables (`events`,
 *     `adaptation_decisions`, `llm_calls`, `session_quality`). They create
 *     and drop isolated tables suffixed `_int_test` with a per-run random
 *     token so concurrent CI runs don't collide.
 *   - `afterAll` drops the test table even on assertion failure.
 *
 * Skip behaviour:
 *   - Every spec uses `test.skipIf(!process.env.CLICKHOUSE_URL)`. In any
 *     environment without a live ClickHouse instance (local dev, standard CI),
 *     the whole suite reports as *skipped*, never *failed*. This matches the
 *     soft-skip pattern used by `readClickHouseConfig()` (returns null when
 *     CLICKHOUSE_URL is unset) and the no-op branch in the mutation-poll route.
 *
 * Env contract (same as readClickHouseConfig + the poller):
 *   - CLICKHOUSE_URL       — HTTP endpoint, e.g. https://abc.clickhouse.cloud:8443
 *   - CLICKHOUSE_PASSWORD  — optional; basic-auth password (user is implicit)
 *
 * @module apps/control-plane/src/__tests__/integration/clickhouse-dsr.integration
 */

import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  executeClickHouseSql,
  issueEraseMutation,
  pollMutationStatus,
  queryClickHouseJson,
  readClickHouseConfig,
  resolveMutationIdByMarker,
} from '@/lib/clickhouse-dsr';

const HAS_CLICKHOUSE = Boolean(process.env.CLICKHOUSE_URL);

// Resolve config exactly the way the production poller does. When
// CLICKHOUSE_URL is unset this is null and every spec self-skips.
const cfg = readClickHouseConfig();

// Per-run isolated table name. The `_int_test` suffix is the agreed marker for
// "safe to drop"; the random token prevents collisions between concurrent CI
// runs against a shared instance.
const RUN_TOKEN = randomUUID().replace(/-/g, '').slice(0, 12);
const TEST_TABLE = `dsr_int_test_${RUN_TOKEN}`;

// A unique session_id this run owns, so we never delete another run's rows.
const ERASE_SESSION_ID = `int-test-erase-${RUN_TOKEN}`;
const KEEP_SESSION_ID = `int-test-keep-${RUN_TOKEN}`;

/** Poll until predicate true or timeout. Mirrors the cron poll cadence. */
async function pollUntil<T>(
  fn: () => Promise<T>,
  done: (v: T) => boolean,
  { timeoutMs = 30_000, intervalMs = 1_000 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  // First attempt is immediate; subsequent attempts wait `intervalMs`.
  let value = await fn();
  while (!done(value) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    value = await fn();
  }
  return value;
}

async function countRows(sessionId: string): Promise<number> {
  if (!cfg) return 0;
  const rows = await queryClickHouseJson<{ c: string }>(
    cfg,
    `SELECT count() AS c FROM ${TEST_TABLE} WHERE session_id = '${sessionId.replace(/'/g, "''")}'`,
  );
  // ClickHouse JSON encodes count() as a string.
  return Number(rows[0]?.c ?? '0');
}

beforeAll(async () => {
  if (!cfg) return;

  // Isolated MergeTree mirroring the session-scoped shape of the real PII
  // tables (session_id String + a couple of payload columns). Never the real
  // tables.
  await executeClickHouseSql(
    cfg,
    `CREATE TABLE IF NOT EXISTS ${TEST_TABLE} (
       session_id String,
       tenant_id String,
       ts DateTime64(3, 'UTC') DEFAULT now64(3)
     ) ENGINE = MergeTree ORDER BY (session_id, ts)`,
  );

  // Seed: 3 rows for the session we will erase, 2 rows for a session we keep.
  await executeClickHouseSql(
    cfg,
    `INSERT INTO ${TEST_TABLE} (session_id, tenant_id) VALUES
       ('${ERASE_SESSION_ID}', 'int-test-tenant'),
       ('${ERASE_SESSION_ID}', 'int-test-tenant'),
       ('${ERASE_SESSION_ID}', 'int-test-tenant'),
       ('${KEEP_SESSION_ID}', 'int-test-tenant'),
       ('${KEEP_SESSION_ID}', 'int-test-tenant')`,
  );
}, 60_000);

afterAll(async () => {
  if (!cfg) return;
  // Always clean up — even if a spec above failed mid-run.
  await executeClickHouseSql(cfg, `DROP TABLE IF EXISTS ${TEST_TABLE}`).catch(() => {
    /* best-effort cleanup; CI sandboxes are ephemeral anyway */
  });
}, 60_000);

describe('ClickHouse DSR mutation-poll contract (integration)', () => {
  test.skipIf(!HAS_CLICKHOUSE)(
    'happy path: ALTER TABLE DELETE WHERE mutation completes (is_done=1) and rows are erased',
    async () => {
      expect(cfg).not.toBeNull();
      if (!cfg) return;

      // Sanity: seed rows present before erase.
      expect(await countRows(ERASE_SESSION_ID)).toBe(3);
      expect(await countRows(KEEP_SESSION_ID)).toBe(2);

      // Issue the erase through the SAME helper the /api/dsr/erase route uses.
      const result = await issueEraseMutation(cfg, {
        table: TEST_TABLE,
        column: 'session_id',
        sessionIds: [ERASE_SESSION_ID],
      });
      expect(result.alterSql).toContain(`ALTER TABLE ${TEST_TABLE} DELETE WHERE session_id IN`);
      expect(result.markerToken).toMatch(/^[a-f0-9]+$/);

      // mutation_id may be null on the issue-race; recover it by marker the
      // way the poller does when row.mutationId is empty (route.ts:121-135).
      const mutationId =
        result.mutationId ??
        (await pollUntil(
          () => resolveMutationIdByMarker(cfg, TEST_TABLE, result.markerToken),
          (id) => id !== null,
          { timeoutMs: 10_000, intervalMs: 1_000 },
        ));
      expect(mutationId).not.toBeNull();

      // Poll system.mutations until is_done flips — mutations are async, so we
      // must NOT assert immediately after issuing. Max 30s, 1s intervals.
      const status = await pollUntil(
        () => pollMutationStatus(cfg, TEST_TABLE, mutationId!),
        (s) => s !== null && (s.is_done === 1 || s.is_done === '1'),
        { timeoutMs: 30_000, intervalMs: 1_000 },
      );

      expect(status).not.toBeNull();
      // is_done is consumed at route.ts:223 with both numeric and string forms.
      expect(status?.is_done === 1 || status?.is_done === '1').toBe(true);
      expect(status?.latest_failed_reason ?? '').toBe('');

      // The mutation is done — the targeted session's rows are gone, the other
      // session's rows are untouched.
      expect(await countRows(ERASE_SESSION_ID)).toBe(0);
      expect(await countRows(KEEP_SESSION_ID)).toBe(2);
    },
  );

  test.skipIf(!HAS_CLICKHOUSE)(
    'resolveMutationIdByMarker returns a non-null mutation_id for an issued mutation',
    async () => {
      expect(cfg).not.toBeNull();
      if (!cfg) return;

      // Issue a fresh mutation against the (now-keep-only) test table targeting
      // a session that does not exist — the mutation is still created in
      // system.mutations regardless of how many rows it matches.
      const result = await issueEraseMutation(cfg, {
        table: TEST_TABLE,
        column: 'session_id',
        sessionIds: [`marker-probe-${RUN_TOKEN}`],
      });

      // The poller's fallback lookup path must resolve a non-null id by marker.
      const resolved = await pollUntil(
        () => resolveMutationIdByMarker(cfg, TEST_TABLE, result.markerToken),
        (id) => id !== null,
        { timeoutMs: 10_000, intervalMs: 1_000 },
      );

      expect(resolved).not.toBeNull();
      expect(typeof resolved).toBe('string');
      expect(resolved!.length).toBeGreaterThan(0);
    },
  );

  test.skipIf(!HAS_CLICKHOUSE)(
    'system.mutations column-shape canary: is_done + latest_failed_reason exist',
    async () => {
      expect(cfg).not.toBeNull();
      if (!cfg) return;

      // Directly assert the column contract the poller depends on. If a
      // ClickHouse upgrade renames/removes either column this query fails and
      // the canary goes red BEFORE a real DSR erase silently breaks.
      const rows = await queryClickHouseJson<{ name: string }>(
        cfg,
        `SELECT name FROM system.columns WHERE database = 'system' AND table = 'mutations'`,
      );
      const columns = rows.map((r) => r.name);
      expect(columns).toContain('is_done');
      expect(columns).toContain('latest_failed_reason');
      // Also assert the columns the helpers select alongside them.
      expect(columns).toContain('mutation_id');
      expect(columns).toContain('command');
      expect(columns).toContain('create_time');
    },
  );
});
