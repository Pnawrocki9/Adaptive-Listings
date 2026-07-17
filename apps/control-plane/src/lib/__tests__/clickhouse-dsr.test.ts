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
 *   - getClickHouseDisclosure (FOLLOW-574 — full-row ClickHouse disclosure,
 *     supersedes the FOLLOW-455 aggregate this file used to cover):
 *       * discloses exactly one export per DSR_CLICKHOUSE_TABLES entry (derived
 *         set, anti-drift), incl. intent_events on its authoritative
 *         (tenant_id, session_id) key
 *       * events export: param-bound + table-qualified WHERE/ORDER BY,
 *         keyset-paginates, truncates + returns a continuation cursor once it
 *         exceeds the internal cap
 *       * lower-volume table export: param-bound SELECT *, truncates past its cap
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
  getClickHouseDisclosure,
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

  it('every entry — including intent_events (FOLLOW-581) — uses session_id as the filter column', () => {
    for (const t of DSR_CLICKHOUSE_TABLES) {
      expect(t.column).toBe('session_id');
    }
  });

  // FOLLOW-581: intent_events erase targets the SDK `session_id` fingerprint,
  // NOT the zero-default `intent_session_id` UUID. Real intent_events rows are
  // written with session_id populated and intent_session_id at zero-UUID
  // (migrations 0015/0016; ingest writer omits it), so the pre-FOLLOW-581
  // filter on intent_session_id matched no real row — a latent Art. 17 no-op.
  // This asserts the built DELETE-WHERE now targets session_id.
  it('builds an intent_events DELETE-WHERE on session_id (FOLLOW-581, not intent_session_id)', () => {
    const intentEntry = DSR_CLICKHOUSE_TABLES.find((t) => t.table === 'intent_events');
    expect(intentEntry?.column).toBe('session_id');
    const { sql, params } = buildEraseMutationSql(
      'intent_events',
      intentEntry!.column,
      ['sdk-fingerprint-abc'],
      'marker581',
    );
    expect(sql).toContain('ALTER TABLE intent_events DELETE WHERE session_id IN');
    expect(sql).not.toContain('intent_session_id');
    // The subject's SDK session_id is bound as the delete filter value.
    expect(params.dsr_id_0).toBe('sdk-fingerprint-abc');
  });
});

// getSessionEventSummary (FOLLOW-455 / audit F-20) was removed as part of
// FOLLOW-574's Rule I cleanup: its own route callers were replaced by the
// full-row `getClickHouseDisclosure` export above, which orphaned it (zero
// non-test importers). See clickhouse-dsr.ts's "DSR disclosure" section header
// comment for the removal rationale. Its coverage (real count from ClickHouse,
// zero-row case, no-fabrication regression, param binding) is superseded by
// the `getClickHouseDisclosure` tests above, whose `events` export is a strict
// superset (full rows, not just count/first/last).

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

// ─── FOLLOW-574: full-row ClickHouse disclosure (Art. 15/20) ──────────────────

const DISCLOSURE_CFG = { url: 'http://clickhouse.test:8123', user: 'default', password: '' };

/** Build a ClickHouse FORMAT JSON response body. */
function chJson(rows: unknown[]): Response {
  return new Response(JSON.stringify({ data: rows }), { status: 200 });
}

// FOLLOW-574 Rule I remediation: `exportSessionEvents` / `exportSessionTableRows`
// and their supporting constants/types are module-internal (only
// `getClickHouseDisclosure` calls them). Every test below drives that public
// function with a mocked ClickHouse client instead of importing the internals
// directly — remediation option 2 ("import through its consumer").
//
// Two internal branches are NOT reachable this way and are intentionally left
// untested rather than re-exported for testability alone:
//   1. `exportSessionEvents`'s `opts.cursor` INITIAL-cursor override (as
//      opposed to the auto-advancing inter-page cursor, which IS covered
//      below) — `getClickHouseDisclosure` never supplies an initial cursor;
//      there is no consumer yet that resumes a previously-truncated export.
//      Forward design for the CEO ruling's "continuation token", not wired to
//      anything in this ticket's scope.
//   2. `exportSessionTableRows`'s `assertValidIdentifier` invalid-table-name
//      rejection — the `table` argument always comes from the hardcoded
//      `DSR_CLICKHOUSE_TABLES` constant when called via `getClickHouseDisclosure`,
//      never from arbitrary/user-controlled input, so the throw branch cannot
//      be hit from the public surface. Defense-in-depth for any future direct
//      caller, matching `buildEraseMutationSql`'s identical guard pattern.

/** DSR_EVENTS_EXPORT_PAGE_SIZE mirror — see clickhouse-dsr.ts (module-internal). */
const MIRRORED_EVENTS_PAGE_SIZE = 10_000;
/** DSR_EVENTS_EXPORT_MAX_ROWS mirror — see clickhouse-dsr.ts (module-internal). */
const MIRRORED_EVENTS_MAX_ROWS = 50_000;
/** DSR_TABLE_EXPORT_MAX_ROWS mirror — see clickhouse-dsr.ts (module-internal). */
const MIRRORED_TABLE_MAX_ROWS = 10_000;

/** Build a full page of synthetic `events` rows for pagination/truncation tests. */
function makeEventsPage(size: number, pageIndex: number): { event_id: string; ts: string }[] {
  return Array.from({ length: size }, (_, i) => {
    const n = pageIndex * size + i;
    return {
      event_id: `e${String(n)}`,
      ts: `2026-06-01 10:00:${String(n % 60).padStart(2, '0')}.000`,
    };
  });
}

describe('getClickHouseDisclosure (FOLLOW-574 — derived from DSR_CLICKHOUSE_TABLES)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('discloses EXACTLY one export per DSR_CLICKHOUSE_TABLES entry (derived set, anti-drift)', async () => {
    // Return an empty page for every query so exportSessionEvents stops after
    // one page and each table issues exactly one query.
    const bodies: string[] = [];
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      bodies.push(typeof init?.body === 'string' ? init.body : '');
      return Promise.resolve(chJson([]));
    });
    vi.stubGlobal('fetch', fetchMock);

    const disclosure = await getClickHouseDisclosure(DISCLOSURE_CFG, 'tenant-1', 'sess-1');

    expect(disclosure.available).toBe(true);
    // One disclosed table object per canonical erase-set entry — the SET is
    // derived from the constant, so a 6th erase table is disclosed with no edit.
    expect(disclosure.tables.map((t) => t.table)).toEqual(
      DSR_CLICKHOUSE_TABLES.map((t) => t.table),
    );
    // Every canonical table name appears in the issued SQL.
    for (const { table } of DSR_CLICKHOUSE_TABLES) {
      expect(bodies.some((b) => b.includes(`FROM ${table}`) || b.includes(`FROM ${table} `))).toBe(
        true,
      );
    }
  });

  it('discloses intent_events on the authoritative (tenant_id, session_id) key, not intent_session_id', async () => {
    const intentRow = { session_id: 'sess-1', tenant_id: 'tenant-1', event_type: 'chat_turn' };
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      if (body.includes('FROM intent_events')) return Promise.resolve(chJson([intentRow]));
      return Promise.resolve(chJson([]));
    });
    vi.stubGlobal('fetch', fetchMock);

    const disclosure = await getClickHouseDisclosure(DISCLOSURE_CFG, 'tenant-1', 'sess-1');
    const intent = disclosure.tables.find((t) => t.table === 'intent_events');

    expect(intent?.rows).toEqual([intentRow]);
    // The intent_events query must NOT filter on the defunct intent_session_id.
    const intentCall = (fetchMock.mock.calls as [string, RequestInit][]).find(([, init]) =>
      (typeof init.body === 'string' ? init.body : '').includes('FROM intent_events'),
    );
    const intentBody = intentCall ? (intentCall[1].body as string) : '';
    expect(intentBody).toContain('{session_id:String}');
    expect(intentBody).not.toContain('intent_session_id');
  });

  it('uses the keyset-paginated exporter for events (ORDER BY e.ts) — one small page, no truncation', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      if (body.includes('FROM events AS e'))
        return Promise.resolve(chJson([{ event_id: 'e1', ts: '2026-06-01 10:00:00.000' }]));
      return Promise.resolve(chJson([]));
    });
    vi.stubGlobal('fetch', fetchMock);

    const disclosure = await getClickHouseDisclosure(DISCLOSURE_CFG, 'tenant-1', 'sess-1');
    const events = disclosure.tables.find((t) => t.table === 'events');
    expect(events?.rows).toHaveLength(1);
    expect(events?.truncated).toBe(false);
    expect(events?.next_cursor).toBeNull();
  });

  it('binds tenant/session as ClickHouse params and table-qualifies the events WHERE/ORDER BY (alias-shadow safe)', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(chJson([])));
    vi.stubGlobal('fetch', fetchMock);

    await getClickHouseDisclosure(DISCLOSURE_CFG, 'tenant\\evil', 'sess\\evil');

    const eventsCall = (fetchMock.mock.calls as [string, RequestInit][]).find(([, init]) =>
      (typeof init.body === 'string' ? init.body : '').includes('FROM events AS e'),
    );
    expect(eventsCall).toBeDefined();
    const [calledUrl, calledInit] = eventsCall!;
    const url = new URL(calledUrl);
    expect(url.searchParams.get('param_tenant_id')).toBe('tenant\\\\evil');
    expect(url.searchParams.get('param_session_id')).toBe('sess\\\\evil');
    const body = typeof calledInit.body === 'string' ? calledInit.body : '';
    expect(body).toContain('{tenant_id:String}');
    expect(body).toContain('{session_id:String}');
    expect(body).toContain('e.ts ASC, e.event_id ASC'); // table-qualified ORDER BY
    expect(body).toContain('WHERE e.tenant_id'); // table-qualified WHERE
    expect(body).not.toContain('tenant\\evil');
  });

  it('paginates the events export by keyset, truncates once it exceeds the internal cap, and returns a continuation cursor', async () => {
    // Mirrors clickhouse-dsr.ts's private DSR_EVENTS_EXPORT_PAGE_SIZE (10,000)
    // and DSR_EVENTS_EXPORT_MAX_ROWS (50,000): 6 full pages (60,000 rows)
    // exceeds the 50,000 cap, forcing truncation + a continuation cursor.
    // Every OTHER table returns an empty page (single query each).
    let eventsPageCalls = 0;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      if (body.includes('FROM events AS e')) {
        const page = makeEventsPage(MIRRORED_EVENTS_PAGE_SIZE, eventsPageCalls);
        eventsPageCalls += 1;
        return Promise.resolve(chJson(page));
      }
      return Promise.resolve(chJson([]));
    });
    vi.stubGlobal('fetch', fetchMock);

    const disclosure = await getClickHouseDisclosure(DISCLOSURE_CFG, 'tenant-1', 'sess-1');
    const events = disclosure.tables.find((t) => t.table === 'events');

    expect(events?.truncated).toBe(true);
    expect(events?.rows).toHaveLength(MIRRORED_EVENTS_MAX_ROWS);
    expect(events?.next_cursor).not.toBeNull();
    expect(eventsPageCalls).toBe(6); // 5 full pages (50,000) not yet over cap, 6th (60,000) trips it

    // The 2nd events fetch carries the keyset cursor advanced from page 1's last row.
    const eventsCalls = (fetchMock.mock.calls as [string, RequestInit][]).filter(([, init]) =>
      (typeof init.body === 'string' ? init.body : '').includes('FROM events AS e'),
    );
    const secondEventsCall = eventsCalls[1];
    expect(secondEventsCall).toBeDefined();
    if (!secondEventsCall) throw new Error('unreachable — asserted above');
    const secondCallUrl = new URL(secondEventsCall[0]);
    expect(secondCallUrl.searchParams.get('param_after_event_id')).not.toBeNull();
    expect(secondCallUrl.searchParams.get('param_after_ts')).not.toBeNull();
    const secondCallBody = secondEventsCall[1].body as string;
    expect(secondCallBody).toContain('toDateTime64({after_ts:String}');
    expect(secondCallBody).toContain('toUUID({after_event_id:String})');
  });

  it('discloses a lower-volume table (adaptation_decisions) via a param-bound SELECT *', async () => {
    const row = { session_id: 's', tenant_id: 't', archetype: 'yield_hunter' };
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      if (body.includes('FROM adaptation_decisions')) return Promise.resolve(chJson([row]));
      return Promise.resolve(chJson([]));
    });
    vi.stubGlobal('fetch', fetchMock);

    const disclosure = await getClickHouseDisclosure(DISCLOSURE_CFG, 't', 's');
    const adaptation = disclosure.tables.find((t) => t.table === 'adaptation_decisions');

    expect(adaptation?.rows).toEqual([row]);
    expect(adaptation?.truncated).toBe(false);
    const call = (fetchMock.mock.calls as [string, RequestInit][]).find(([, init]) =>
      (typeof init.body === 'string' ? init.body : '').includes('FROM adaptation_decisions'),
    );
    const body = call ? (call[1].body as string) : '';
    expect(body).toContain('SELECT');
    expect(body).toContain('{tenant_id:String}');
    expect(body).toContain('{session_id:String}');
  });

  it('flags a lower-volume table (llm_calls) as truncated when it returns more than the internal cap', async () => {
    const rows = Array.from({ length: MIRRORED_TABLE_MAX_ROWS + 1 }, (_, i) => ({ id: i }));
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      if (body.includes('FROM llm_calls')) return Promise.resolve(chJson(rows));
      return Promise.resolve(chJson([]));
    });
    vi.stubGlobal('fetch', fetchMock);

    const disclosure = await getClickHouseDisclosure(DISCLOSURE_CFG, 't', 's');
    const llm = disclosure.tables.find((t) => t.table === 'llm_calls');

    expect(llm?.rows).toHaveLength(MIRRORED_TABLE_MAX_ROWS);
    expect(llm?.truncated).toBe(true);
  });
});
