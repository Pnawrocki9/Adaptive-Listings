/**
 * Integration test — K.3.6 tracer ClickHouse query builders (FOLLOW-316).
 *
 * Purpose: Submit every tracer query builder against a REAL ClickHouse engine
 * so a query-analysis error (Code 386 NO_COMMON_TYPE / alias-shadow shape fixed
 * by FOLLOW-315) fails CI rather than slipping through mock-only unit coverage.
 *
 * Why this spec exists:
 *   The tracer unit suite (`src/lib/clickhouse-tracer.test.ts`, CH-1..CH-21 +
 *   CH-315a–d) mocks `fetch` and asserts SQL on the wire — it cannot raise a
 *   ClickHouse query-analysis error. The existing DSR integration spec gated
 *   every case behind `test.skipIf(!CLICKHOUSE_URL)`, meaning CI never ran
 *   against a live engine. This spec closes that gap. (RETRO-078 §4c TG-1/TG-2)
 *
 * AC3 — hard-fail mode:
 *   - `REQUIRE_CLICKHOUSE=1` (set by the `tracer-query-smoke` CI job): if
 *     CLICKHOUSE_URL is absent or unreachable the spec FAILS — no silent skip.
 *   - Neither env var set (local `pnpm test` / unit CI): entire suite skips so
 *     it never blocks offline/unit runs.
 *   - CLICKHOUSE_URL set without REQUIRE_CLICKHOUSE: standard soft-skip behaviour
 *     (useful for dev environments with a local ClickHouse).
 *
 * Transport: these specs call the production helpers exported by
 * `@/lib/clickhouse-tracer` over the same ClickHouse HTTP interface the
 * tracer admin routes use. Using the real code path (not re-implementing it)
 * is what makes this a contract test.
 *
 * Table setup (AC4):
 *   The CI job runs `migrate.sh` before this spec, so all 0014–0016 migrations
 *   (intent_events + session_id column) are already applied. `beforeAll` seeds
 *   one deterministic row owned by SEED_TENANT_ID / SEED_SESSION_ID and removes
 *   it in `afterAll` via a lightweight DELETE mutation. The seed uses known UUIDs
 *   that are safe to use in an ephemeral CI container; they never collide because
 *   the container is created fresh per CI run.
 *
 * Auth contract (AC3 / CRITICAL):
 *   The tracer client sends `Authorization: Basic base64("<user>:<password>")` only
 *   when CLICKHOUSE_PASSWORD is non-empty. The `tracer-query-smoke` CI job boots
 *   ClickHouse with `CLICKHOUSE_SKIP_USER_SETUP=1` (passwordless default user)
 *   and passes `CLICKHOUSE_PASSWORD=""`, so no Authorization header is sent.
 *   When a password IS provided, CLICKHOUSE_USER (default: "default") is always
 *   included before the colon — the previous empty-username form
 *   `base64(":password")` was rejected by ClickHouse Cloud (Code 516
 *   AUTHENTICATION_FAILED) and is fixed in this PR.
 *
 * Negative control (AC2):
 *   A deliberate bare-`event_at` predicate (the FOLLOW-315 broken shape) is
 *   issued via `chTracerQuery` and must REJECT with Code 386 NO_COMMON_TYPE.
 *   This proves the guard catches the bug class, not just that happy paths pass.
 *
 * Env contract:
 *   CLICKHOUSE_URL       — HTTP endpoint, e.g. http://localhost:8123
 *   CLICKHOUSE_USER      — optional; defaults to "default" (passwordless CI: omit)
 *   CLICKHOUSE_PASSWORD  — optional; omit / leave empty for passwordless CH
 *   REQUIRE_CLICKHOUSE   — set to "1" in the CI job to hard-fail on missing CH
 *
 * @module apps/control-plane/src/__tests__/integration/clickhouse-tracer.integration
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  type ClickHouseTracerConfig,
  chTracerQuery,
  fetchIntentEventsForExport,
  fetchIntentEventsForSession,
  fetchIntentEventsHistory,
  fetchNewIntentEvents,
  resolveClickHouseTracerConfig,
} from '@/lib/clickhouse-tracer';
import { clickhouseAuthHeaders } from '@/lib/clickhouse-http';

// ─── POST helper for write operations (INSERT / ALTER … DELETE) ──────────────
//
// chTracerQuery uses GET (read-only HTTP interface). ClickHouse rejects
// INSERT and ALTER over GET with "Cannot execute query in readonly mode"
// (Code 164). Use POST for seed and teardown writes.

async function chPostSql(cfg: ClickHouseTracerConfig, sql: string): Promise<void> {
  const url = new URL(cfg.url);
  url.searchParams.set('database', cfg.database);

  const headers: Record<string, string> = {
    'Content-Type': 'text/plain',
    ...clickhouseAuthHeaders(cfg),
  };

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers,
    body: sql,
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '<no body>');
    throw new Error(`ClickHouse POST failed: HTTP ${String(res.status)}: ${body.slice(0, 400)}`);
  }
}

// ─── AC3 skip / hard-fail gate ──────────────────────────────────────────────

const HAS_CLICKHOUSE = Boolean(process.env.CLICKHOUSE_URL);
const REQUIRE_CLICKHOUSE = process.env.REQUIRE_CLICKHOUSE === '1';

/**
 * When REQUIRE_CLICKHOUSE=1 (CI job) and CLICKHOUSE_URL is absent, hard-fail
 * immediately — do not let the suite silently skip and produce a green badge
 * that hides a misconfigured job. (Guardrail: RETRO-007 FOLLOW-079 soft-skip
 * inception pattern.)
 */
if (REQUIRE_CLICKHOUSE && !HAS_CLICKHOUSE) {
  throw new Error(
    'REQUIRE_CLICKHOUSE=1 is set but CLICKHOUSE_URL is not. ' +
      'The tracer-query-smoke CI job MUST configure a live ClickHouse. ' +
      'A silent skip here is forbidden — fix the job or unset REQUIRE_CLICKHOUSE.',
  );
}

// ─── Config resolution ───────────────────────────────────────────────────────

const cfg = resolveClickHouseTracerConfig();

// ─── Seed constants ──────────────────────────────────────────────────────────

/**
 * Deterministic tenant / session IDs for the seed row. These values are safe
 * to use in an ephemeral CI container (fresh per run, no collision risk).
 * SEED_TENANT_ID is a UUID matching the intent_events.tenant_id UUID column type.
 */
const SEED_TENANT_ID = '00000000-0000-0000-0000-316316316316';
const SEED_SESSION_ID = 'follow-316-ci-guard-session';
/** ISO 8601 timestamps bracketing the seed row for from/to range queries. */
const SEED_FROM = '2026-01-01T00:00:00Z';
const SEED_TO = '2099-12-31T23:59:59Z';
/** A cursor well before the seed row so fetchNewIntentEvents returns it. */
const CURSOR_BEFORE_SEED = '2026-01-01T00:00:00Z';

// ─── beforeAll — seed one row owned by this test suite ──────────────────────

beforeAll(async () => {
  if (!cfg) return;

  // Insert a single deterministic row via POST (GET is readonly in ClickHouse).
  // Column order matches the 0014 DDL + 0015 session_id column. intent_session_id
  // uses the UUID zero-default (migration 0016 / FOLLOW-287 CB-1 — that column is
  // no longer written by the ingest handler, new rows carry all-zeros).
  // Values are inlined as literals (not external user input — safe here).
  await chPostSql(
    cfg,
    `INSERT INTO intent_events
       (intent_session_id, tenant_id, event_at, event_type,
        archetype_deltas, confidence_before, confidence_after,
        top_archetype, event_payload, session_id)
     VALUES
       ('00000000-0000-0000-0000-000000000000',
        '${SEED_TENANT_ID}',
        now64(3),
        'intent.snapshot',
        '{"yield_hunter":0.3}',
        0.4,
        0.7,
        'yield_hunter',
        '{"src":"follow-316-ci-guard"}',
        '${SEED_SESSION_ID}')`,
  );
}, 30_000);

// ─── afterAll — clean up seed row ────────────────────────────────────────────

afterAll(async () => {
  if (!cfg) return;
  // Issue a lightweight DELETE mutation via POST to remove the seed row.
  // On an ephemeral CI container this is belt-and-suspenders — the container
  // is discarded after the job anyway. catch() so a mutation failure never
  // masks a prior test assertion failure.
  await chPostSql(
    cfg,
    `ALTER TABLE intent_events DELETE
     WHERE tenant_id  = '${SEED_TENANT_ID}'
       AND session_id = '${SEED_SESSION_ID}'`,
  ).catch(() => {
    /* best-effort — CI container is ephemeral */
  });
}, 30_000);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('K.3.6 tracer query builders — live ClickHouse contract (FOLLOW-316)', () => {
  // ── AC1 happy-path tests ─────────────────────────────────────────────────

  test.skipIf(!HAS_CLICKHOUSE)(
    'AC1a — fetchIntentEventsForExport resolves without throwing (200 OK)',
    async () => {
      expect(cfg).not.toBeNull();
      if (!cfg) return;

      const rows = await fetchIntentEventsForExport(cfg, {
        tenantId: SEED_TENANT_ID,
        from: SEED_FROM,
        to: SEED_TO,
      });

      // Must not throw (Code 386 would have thrown before reaching here).
      // We seeded 1 row; the result may include it or be empty if the CH
      // mutation from afterAll of a previous run already deleted it — both
      // are acceptable. What matters is that the query didn't fail.
      expect(Array.isArray(rows)).toBe(true);
      // Specifically assert the seeded row is present with correct fields.
      const found = rows.find((r) => r.session_id === SEED_SESSION_ID);
      expect(found).toBeDefined();
      expect(found?.tenant_id).toBe(SEED_TENANT_ID);
      expect(found?.event_type).toBe('intent.snapshot');
    },
  );

  test.skipIf(!HAS_CLICKHOUSE)(
    'AC1b — fetchIntentEventsHistory resolves without throwing (200 OK)',
    async () => {
      expect(cfg).not.toBeNull();
      if (!cfg) return;

      const result = await fetchIntentEventsHistory(cfg, {
        tenantId: SEED_TENANT_ID,
        from: SEED_FROM,
        to: SEED_TO,
        limit: 10,
        offset: 0,
      });

      expect(result).toHaveProperty('events');
      expect(result).toHaveProperty('total');
      expect(Array.isArray(result.events)).toBe(true);
      expect(typeof result.total).toBe('number');
      // The seed row must appear.
      expect(result.total).toBeGreaterThanOrEqual(1);
      const found = result.events.find((r) => r.session_id === SEED_SESSION_ID);
      expect(found).toBeDefined();
    },
  );

  test.skipIf(!HAS_CLICKHOUSE)(
    'AC1c — fetchNewIntentEvents (stream-poll cursor) resolves without throwing (200 OK)',
    async () => {
      expect(cfg).not.toBeNull();
      if (!cfg) return;

      const rows = await fetchNewIntentEvents(
        cfg,
        SEED_TENANT_ID,
        SEED_SESSION_ID,
        CURSOR_BEFORE_SEED,
      );

      expect(Array.isArray(rows)).toBe(true);
      // Cursor is before the seed row — at least the seed row must be returned.
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]?.session_id).toBe(SEED_SESSION_ID);
    },
  );

  test.skipIf(!HAS_CLICKHOUSE)(
    'AC1d — fetchIntentEventsForSession resolves without throwing (200 OK)',
    async () => {
      expect(cfg).not.toBeNull();
      if (!cfg) return;

      const rows = await fetchIntentEventsForSession(cfg, SEED_TENANT_ID, SEED_SESSION_ID);

      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]?.session_id).toBe(SEED_SESSION_ID);
      expect(rows[0]?.top_archetype).toBe('yield_hunter');
    },
  );

  // ── AC2 negative-control test ────────────────────────────────────────────

  test.skipIf(!HAS_CLICKHOUSE)(
    'AC2 — bare event_at date predicate (FOLLOW-315 broken shape) REJECTS with Code 386 NO_COMMON_TYPE',
    async () => {
      expect(cfg).not.toBeNull();
      if (!cfg) return;

      /**
       * This is the exact broken SQL shape that FOLLOW-315 fixed:
       *   `toString(event_at) AS event_at` shadows the DateTime64 column
       *   with a String alias of the same name. A bare `event_at` in the
       *   WHERE clause then binds to the String alias, so the comparison
       *   `String >= DateTime` → Code 386 NO_COMMON_TYPE at query-analysis
       *   time — it fails even on an empty table.
       *
       * The fixed builders use `intent_events.event_at` (table-qualified)
       * in WHERE/ORDER BY so the comparison is always DateTime64 >= DateTime64.
       * This negative control proves that a regression to the bare form would
       * be caught by this spec.
       */
      const brokenSql = `
        SELECT
          toString(event_at) AS event_at
        FROM intent_events
        WHERE event_at >= parseDateTimeBestEffort({p_from:String})
      `;

      await expect(
        chTracerQuery(cfg, brokenSql, { p_from: '2026-01-01T00:00:00Z' }),
      ).rejects.toThrow(/Code: 386|NO_COMMON_TYPE|HTTP 500/);
    },
  );
});
