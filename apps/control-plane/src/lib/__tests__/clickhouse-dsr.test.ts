/**
 * Unit tests for the ClickHouse DSR helper module.
 *
 * Coverage:
 *   - buildEraseMutationSql:
 *       * generates ALTER TABLE DELETE WHERE session_id IN (...) with
 *         `{dsr_id_N:String}` placeholders (FOLLOW-462 parameter binding —
 *         session id VALUES never appear in the SQL text)
 *       * binds session IDs containing a trailing backslash, an embedded
 *         quote, and an embedded backslash as safe param values (FOLLOW-462
 *         regression: quote-only escaping was defeated by a trailing
 *         backslash, which re-opened the ClickHouse string literal)
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
 *   - resolveMutationIdByMarker / pollMutationStatus /
 *     updateDsrAuditLogClickHouseStatus (FOLLOW-462):
 *       * golden-query SQL-shape regression — canonical `{name:Type}`
 *         placeholders present, raw id values absent from the SQL text,
 *         values instead sent as `param_<name>` query args
 *       * invalid table names rejected before any SQL is built
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
  pollMutationStatus,
  resolveMutationIdByMarker,
  updateDsrAuditLogClickHouseStatus,
} from '../clickhouse-dsr.js';

// ─── buildEraseMutationSql ────────────────────────────────────────────────────

describe('buildEraseMutationSql', () => {
  it('generates ALTER TABLE DELETE WHERE with a param placeholder for a single session_id', () => {
    const { sql, params } = buildEraseMutationSql('events', 'session_id', ['abc123'], 'marker001');
    expect(sql).toContain('ALTER TABLE events DELETE WHERE session_id IN');
    expect(sql).toContain('{dsr_id_0:String}');
    expect(sql).not.toContain('abc123'); // the value must never appear in the SQL text
    expect(params).toEqual({ dsr_id_0: 'abc123' });
    expect(sql).toContain('/* DSR:marker001 */');
  });

  it('binds multiple session IDs as separate named params', () => {
    const { sql, params } = buildEraseMutationSql(
      'adaptation_decisions',
      'session_id',
      ['s1', 's2', 's3'],
      'm',
    );
    expect(sql).toContain('IN ({dsr_id_0:String}, {dsr_id_1:String}, {dsr_id_2:String})');
    expect(params).toEqual({ dsr_id_0: 's1', dsr_id_1: 's2', dsr_id_2: 's3' });
  });

  // ─── FOLLOW-462: backslash-safe parameter binding ──────────────────────────
  //
  // Audit F-14: quote-only escaping (`s.replace(/'/g, "''")`) was defeated by
  // a trailing backslash — `'...\'` re-opens the ClickHouse string literal
  // because backslash is itself an escape character in ClickHouse SQL string
  // syntax, silently malforming the DELETE (or making it match nothing) while
  // the DSR erase route still reported success. Parameter binding removes
  // the id value from the SQL text entirely, so the value can never
  // influence the statement's shape regardless of its content.

  it('never embeds a session id containing a trailing backslash in the SQL text', () => {
    const trailingBackslashId = 'abc\\';
    const { sql, params } = buildEraseMutationSql(
      'events',
      'session_id',
      [trailingBackslashId],
      'marker',
    );
    // The SQL text is well-formed regardless of the id's content: it only
    // ever contains the placeholder, never the raw value.
    expect(sql).toBe(
      'ALTER TABLE events DELETE WHERE session_id IN ({dsr_id_0:String}) /* DSR:marker */',
    );
    // The bound param, once decoded by ClickHouse's "Escaped" param format,
    // reconstructs the exact original value — the backslash is doubled so it
    // round-trips instead of being consumed as an (incomplete) escape.
    expect(params.dsr_id_0).toBe('abc\\\\');
  });

  it('never embeds a session id containing an embedded single quote in the SQL text', () => {
    const quoteId = "it's-a-session";
    const { sql, params } = buildEraseMutationSql('events', 'session_id', [quoteId], 'marker');
    expect(sql).not.toContain("'");
    expect(sql).toContain('{dsr_id_0:String}');
    // Quotes are plain data in the param-value "Escaped" format (not a
    // delimiter there), so no escaping is needed or applied.
    expect(params.dsr_id_0).toBe(quoteId);
  });

  it('never embeds a session id containing an embedded backslash in the SQL text', () => {
    const backslashId = 'sess\\with\\backslashes';
    const { sql, params } = buildEraseMutationSql('events', 'session_id', [backslashId], 'marker');
    expect(sql).not.toContain('\\');
    expect(params.dsr_id_0).toBe('sess\\\\with\\\\backslashes');
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
      const { sql } = buildEraseMutationSql(table, column, ['sess-001'], 'abc123');
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

  it('binds tenant_id/session_id as ClickHouse params, never as raw SQL text (FOLLOW-462)', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ cnt: '0', first_at: '', last_at: '' }] }), {
          status: 200,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await getSessionEventSummary(cfg, 'tenant\\evil', 'sess\\evil');

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const url = new URL(calledUrl);
    expect(url.searchParams.get('param_tenant_id')).toBe('tenant\\\\evil');
    expect(url.searchParams.get('param_session_id')).toBe('sess\\\\evil');
    const body = typeof calledInit.body === 'string' ? calledInit.body : '';
    expect(body).toContain('{tenant_id:String}');
    expect(body).toContain('{session_id:String}');
    expect(body).not.toContain('tenant\\evil');
    expect(body).not.toContain('sess\\evil');
  });
});

// ─── resolveMutationIdByMarker / pollMutationStatus / updateDsrAuditLogClickHouseStatus (FOLLOW-462) ──

describe('resolveMutationIdByMarker (FOLLOW-462 golden-query shape)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const cfg = { url: 'http://clickhouse.test:8123', user: 'default', password: '' };

  it('sends the marker as a param, never interpolated into the SQL text', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await resolveMutationIdByMarker(cfg, 'events', 'marker-abc123');

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const url = new URL(calledUrl);
    expect(url.searchParams.get('param_marker')).toBe('marker-abc123');
    const body = typeof calledInit.body === 'string' ? calledInit.body : '';
    expect(body).toContain("concat('%DSR:', {marker:String}, '%')");
    expect(body).not.toContain('marker-abc123');
  });

  it('rejects an invalid table name before issuing any query', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveMutationIdByMarker(cfg, 'events; DROP TABLE x', 'marker')).rejects.toThrow(
      'invalid table name',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('pollMutationStatus (FOLLOW-462 golden-query shape)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const cfg = { url: 'http://clickhouse.test:8123', user: 'default', password: '' };

  it('sends mutation_id as a param, never interpolated into the SQL text', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await pollMutationStatus(cfg, 'events', "mut'id\\evil");

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const url = new URL(calledUrl);
    expect(url.searchParams.get('param_mutation_id')).toBe("mut'id\\\\evil");
    const body = typeof calledInit.body === 'string' ? calledInit.body : '';
    expect(body).toContain('{mutation_id:String}');
    expect(body).not.toContain("mut'id");
  });

  it('rejects an invalid table name before issuing any query', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(pollMutationStatus(cfg, "events' OR '1'='1", 'mut-1')).rejects.toThrow(
      'invalid table name',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('updateDsrAuditLogClickHouseStatus (FOLLOW-462 golden-query shape)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const cfg = { url: 'http://clickhouse.test:8123', user: 'default', password: '' };

  it('binds every id/value as a ClickHouse param, never as raw SQL text', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response('', { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await updateDsrAuditLogClickHouseStatus(cfg, {
      tenant_id: 'tenant\\1',
      session_id: 'sess\\1',
      clickhouse_mutation_id: 'mut_1,mut_2', // comma-joined composite (_finalise.ts)
      clickhouse_mutation_status: 'done',
      completed: true,
    });

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const url = new URL(calledUrl);
    expect(url.searchParams.get('param_tenant_id')).toBe('tenant\\\\1');
    expect(url.searchParams.get('param_session_id')).toBe('sess\\\\1');
    expect(url.searchParams.get('param_mutation_id')).toBe('mut_1,mut_2');
    expect(url.searchParams.get('param_status')).toBe('done');
    const body = typeof calledInit.body === 'string' ? calledInit.body : '';
    expect(body).toContain('{tenant_id:String}');
    expect(body).toContain('{session_id:String}');
    expect(body).toContain('{mutation_id:String}');
    expect(body).toContain('{status:String}');
    expect(body).not.toContain('tenant\\1');
    expect(body).not.toContain('sess\\1');
    expect(body).not.toContain('mut_1,mut_2');
  });
});
