/**
 * Unit tests for the ClickHouse DSR helper module.
 *
 * Coverage:
 *   - buildEraseMutationSql:
 *       * generates ALTER TABLE DELETE WHERE session_id IN (...)
 *       * escapes single-quotes in session IDs
 *       * embeds DSR marker comment
 *       * rejects empty session list, invalid table/column/marker names
 *   - aggregateMutationStatus:
 *       * empty input → 'no_data'
 *       * pending dominates
 *       * in_progress dominates over failed and done
 *       * failed dominates over done
 *       * all done → 'done'
 *   - computeNextRetryAt:
 *       * exponential backoff schedule
 *       * null after MAX retries
 *   - DSR_CLICKHOUSE_TABLES inventory:
 *       * contains the canonical PII tables (incl. intent_events, FOLLOW-455)
 *   - getSessionEventSummary (FOLLOW-455 / audit F-20):
 *       * returns the real count/first_at/last_at from ClickHouse
 *       * returns count:0 with null timestamps when no rows match
 *
 * @module apps/control-plane/src/lib/__tests__/clickhouse-dsr.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aggregateMutationStatus,
  buildEraseMutationSql,
  computeNextRetryAt,
  DSR_CLICKHOUSE_TABLES,
  getSessionEventSummary,
  MAX_MUTATION_RETRIES,
} from '../clickhouse-dsr.js';

// ─── buildEraseMutationSql ────────────────────────────────────────────────────

describe('buildEraseMutationSql', () => {
  it('generates ALTER TABLE DELETE WHERE for a single session_id', () => {
    const sql = buildEraseMutationSql('events', 'session_id', ['abc123'], 'marker001');
    expect(sql).toContain('ALTER TABLE events DELETE WHERE session_id IN');
    expect(sql).toContain("'abc123'");
    expect(sql).toContain('/* DSR:marker001 */');
  });

  it('joins multiple session IDs with comma-space separator', () => {
    const sql = buildEraseMutationSql(
      'adaptation_decisions',
      'session_id',
      ['s1', 's2', 's3'],
      'm',
    );
    expect(sql).toContain("'s1', 's2', 's3'");
  });

  it('escapes embedded single quotes in session IDs (ANSI doubling)', () => {
    // SHA-256 hex never contains quotes; defensive test.
    const sql = buildEraseMutationSql('events', 'session_id', ["it's"], 'marker');
    expect(sql).toContain("'it''s'");
  });

  it('throws on empty session ID list', () => {
    expect(() => buildEraseMutationSql('events', 'session_id', [], 'marker')).toThrow(
      'sessionIds must be non-empty',
    );
  });

  it('rejects invalid table name (SQL injection guard)', () => {
    expect(() =>
      buildEraseMutationSql('events; DROP TABLE x', 'session_id', ['s'], 'marker'),
    ).toThrow('invalid table name');
  });

  it('rejects invalid column name', () => {
    expect(() => buildEraseMutationSql('events', 'session_id; DROP', ['s'], 'marker')).toThrow(
      'invalid column name',
    );
  });

  it('rejects invalid marker token', () => {
    expect(() =>
      buildEraseMutationSql('events', 'session_id', ['s'], 'marker with spaces'),
    ).toThrow('marker token must be alphanumeric');
  });

  it('builds SQL for each canonical DSR table', () => {
    for (const { table, column } of DSR_CLICKHOUSE_TABLES) {
      const sql = buildEraseMutationSql(table, column, ['sess-001'], 'abc123');
      expect(sql).toContain(`ALTER TABLE ${table}`);
      expect(sql).toContain(`WHERE ${column} IN`);
    }
  });
});

// ─── aggregateMutationStatus ──────────────────────────────────────────────────

describe('aggregateMutationStatus', () => {
  it('returns no_data for empty input', () => {
    expect(aggregateMutationStatus([])).toBe('no_data');
  });

  it('returns pending when any row is pending', () => {
    expect(aggregateMutationStatus(['pending'])).toBe('pending');
    expect(aggregateMutationStatus(['pending', 'done'])).toBe('pending');
    expect(aggregateMutationStatus(['pending', 'failed', 'done'])).toBe('pending');
  });

  it('returns in_progress when any in_progress and no pending', () => {
    expect(aggregateMutationStatus(['in_progress'])).toBe('in_progress');
    expect(aggregateMutationStatus(['in_progress', 'done'])).toBe('in_progress');
    expect(aggregateMutationStatus(['in_progress', 'failed'])).toBe('in_progress');
  });

  it('returns failed when any failed and no pending/in_progress', () => {
    expect(aggregateMutationStatus(['failed'])).toBe('failed');
    expect(aggregateMutationStatus(['failed', 'done'])).toBe('failed');
    expect(aggregateMutationStatus(['done', 'failed', 'done'])).toBe('failed');
  });

  it('returns done only when every row is done', () => {
    expect(aggregateMutationStatus(['done', 'done', 'done', 'done'])).toBe('done');
  });
});

// ─── computeNextRetryAt ───────────────────────────────────────────────────────

describe('computeNextRetryAt', () => {
  const baseTime = new Date('2026-05-24T00:00:00.000Z');

  it('returns +1 minute for retry_count = 0', () => {
    const t = computeNextRetryAt(0, baseTime);
    expect(t).toEqual(new Date(baseTime.getTime() + 60_000));
  });

  it('returns +5 minutes for retry_count = 1', () => {
    const t = computeNextRetryAt(1, baseTime);
    expect(t).toEqual(new Date(baseTime.getTime() + 5 * 60_000));
  });

  it('returns +30 minutes for retry_count = 2', () => {
    const t = computeNextRetryAt(2, baseTime);
    expect(t).toEqual(new Date(baseTime.getTime() + 30 * 60_000));
  });

  it('returns null at retry_count >= MAX_MUTATION_RETRIES', () => {
    expect(computeNextRetryAt(MAX_MUTATION_RETRIES, baseTime)).toBeNull();
    expect(computeNextRetryAt(MAX_MUTATION_RETRIES + 1, baseTime)).toBeNull();
  });
});

// ─── DSR_CLICKHOUSE_TABLES inventory ──────────────────────────────────────────

describe('DSR_CLICKHOUSE_TABLES', () => {
  it('contains the canonical PII-bearing tables', () => {
    const names = DSR_CLICKHOUSE_TABLES.map((t) => t.table);
    expect(names).toContain('events');
    expect(names).toContain('adaptation_decisions');
    expect(names).toContain('llm_calls');
    expect(names).toContain('session_quality');
    // FOLLOW-455 / audit F-20: K.3.6 tracer per-signal event trail.
    expect(names).toContain('intent_events');
  });

  it('does NOT include dsr_audit_log (legal-claims retention)', () => {
    const names = DSR_CLICKHOUSE_TABLES.map((t) => t.table);
    expect(names).not.toContain('dsr_audit_log');
  });

  it('does NOT include description_generations (listing-scoped, no session_id)', () => {
    const names = DSR_CLICKHOUSE_TABLES.map((t) => t.table);
    expect(names).not.toContain('description_generations');
  });

  it('every entry uses session_id as the filter column, EXCEPT intent_events which uses intent_session_id', () => {
    for (const t of DSR_CLICKHOUSE_TABLES) {
      if (t.table === 'intent_events') {
        expect(t.column).toBe('intent_session_id');
        expect(t.idSource).toBe('intent_session_id');
      } else {
        expect(t.column).toBe('session_id');
        expect(t.idSource).toBeUndefined();
      }
    }
  });
});

// ─── getSessionEventSummary (FOLLOW-455 / audit F-20) ─────────────────────────

describe('getSessionEventSummary', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const cfg = { url: 'http://clickhouse.test:8123', user: 'default', password: '' };

  it('returns the real count and first/last timestamps from ClickHouse', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: [
              {
                cnt: '7',
                first_at: '2026-06-01 10:00:00.000',
                last_at: '2026-06-02 12:30:00.000',
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const summary = await getSessionEventSummary(cfg, 'tenant-1', 'sess-1');

    expect(summary.count).toBe(7);
    expect(summary.firstAt).toBe(new Date('2026-06-01T10:00:00.000Z').toISOString());
    expect(summary.lastAt).toBe(new Date('2026-06-02T12:30:00.000Z').toISOString());
  });

  it('returns count 0 and null timestamps when no events match', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ cnt: '0', first_at: '', last_at: '' }] }), {
          status: 200,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const summary = await getSessionEventSummary(cfg, 'tenant-1', 'sess-empty');

    expect(summary.count).toBe(0);
    expect(summary.firstAt).toBeNull();
    expect(summary.lastAt).toBeNull();
  });

  it('never fabricates a count — this is a real ClickHouse query, not a stub', async () => {
    // Regression guard for audit F-20: events_summary.count must never be a
    // hardcoded literal. This test asserts the count on the wire is exactly
    // what the mocked ClickHouse HTTP response says, proving no stub path exists.
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ cnt: '42', first_at: '2026-01-01 00:00:00', last_at: '2026-01-02 00:00:00' }],
          }),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const summary = await getSessionEventSummary(cfg, 'tenant-1', 'sess-42');
    expect(summary.count).toBe(42);
  });
});
