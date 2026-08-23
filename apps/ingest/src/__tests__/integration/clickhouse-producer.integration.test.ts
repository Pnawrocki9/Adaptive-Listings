/**
 * Integration test — the ingest Worker's `events` write path against a REAL
 * ClickHouse engine. [FOLLOW-853 AC(2)]
 *
 * WHY THIS SPEC EXISTS
 *
 * Until this file, NOTHING in any suite drove `pushToClickHouse` against a
 * ClickHouse. The coverage that looked like it did, did not:
 *
 *   - `src/clickhouse-producer.test.ts` mocks `fetch`. A mock cannot raise a
 *     parse error, so it asserted the producer's bytes were correct by
 *     restating them.
 *   - `infra/clickhouse/scripts/smoke-test.sh` inserted an UNQUOTED NUMERIC
 *     EPOCH (`"ts":1750000000000`) — a byte shape no production writer has ever
 *     emitted. It exercised the table, never the writer.
 *   - `.github/workflows/e2e-smoke.yml` starts `wrangler dev` WITHOUT
 *     `CLICKHOUSE_URL`, so the producer's no-credentials guard fires and the
 *     assertion is satisfied without a single byte reaching ClickHouse.
 *
 * The gap those three left is not hypothetical. The producer emitted
 * `new Date(ts).toISOString()`, which ClickHouse's DEFAULT
 * `date_time_input_format=basic` rejects outright (Code 27
 * CANNOT_PARSE_INPUT_ASSERTION_FAILED). Production happens to run
 * `best_effort` so prod was never affected, but every container-local and CI
 * ClickHouse silently discarded the entire batch — and the discard is POST-ACK,
 * so the SDK still saw HTTP 200. That is why `events` never populated on
 * localhost and why FOLLOW-819's AC(5) lift query had nothing to read.
 *
 * THE THREE CASES, AND WHY EACH IS LOAD-BEARING
 *
 *   AC2-A  happy path under the container's DEFAULT setting (`basic`). Proves
 *          the fix works where the bug bit. Reads the row BACK and compares the
 *          instant, so a timestamp that parses but lands at the wrong moment
 *          (zone shift, truncated milliseconds) fails too — "the insert was
 *          accepted" is a weaker claim than "the instant round-trips".
 *
 *   AC2-B  NEGATIVE CONTROL. Re-injects the pre-FOLLOW-853 trailing-`Z` shape
 *          through the SAME production function (a `fetchImpl` wrapper rewrites
 *          only the timestamp bytes) and requires Code 27. Without this, a
 *          future server default change could make AC2-A pass for a reason
 *          unrelated to the fix and nobody would know the detector had gone
 *          blind. It also pins the exact class the fix targets.
 *
 *   AC2-C  PROD-PARSER PARITY. FOLLOW-853 changes the bytes production is
 *          currently parsing successfully, and no agent can execute against
 *          prod. This case reproduces prod's parser configuration
 *          (`date_time_input_format=best_effort`, read from the prod service on
 *          2026-08-07 — see docs/runbooks/CLICKHOUSE_DATETIME_INPUT_FORMAT.md)
 *          on the CI container and asserts the NEW bytes are accepted there
 *          too. That converts "this should not regress prod" from an argument
 *          into a measurement.
 *
 * HARD-FAIL, NEVER A SILENT SKIP (same contract as the `tracer-query-smoke`
 * spec):
 *   - `REQUIRE_CLICKHOUSE=1` (set by the `clickhouse-smoke` CI job): absent or
 *     unreachable `CLICKHOUSE_URL` FAILS the suite. A green run that quietly
 *     skipped this file is the exact failure mode the file exists to prevent.
 *   - Neither var set (offline `pnpm test`): the whole suite skips. It is also
 *     kept out of the unit config's `include` glob, so `pnpm test` never
 *     reaches it.
 *
 * Table setup: the CI job runs `migrate.sh` first, so the real 0001 `events`
 * DDL is live. Rows are owned by a per-run unique `tenant_id` and removed in
 * `afterAll`.
 *
 * @module apps/ingest/src/__tests__/integration/clickhouse-producer.integration
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  pushToClickHouse,
  toClickHouseDateTime64,
  type ClickHouseProducerEnv,
} from '../../clickhouse-producer.js';

const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL ?? '';
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER ?? 'default';
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD ?? '';
const REQUIRE_CLICKHOUSE = process.env.REQUIRE_CLICKHOUSE === '1';

const env: ClickHouseProducerEnv = {
  CLICKHOUSE_URL,
  CLICKHOUSE_DATABASE: 'default',
  CLICKHOUSE_USER,
  CLICKHOUSE_PASSWORD,
};

/** Unique per run so parallel executions cannot aggregate into each other. */
const TENANT_ID = `follow853-${String(Date.now())}-${String(Math.floor(Math.random() * 1e6))}`;
const SESSION_ID = 'follow853000000000000000000000000000000000000000000000000000001';

/**
 * A deliberately awkward instant: non-zero milliseconds that a second-precision
 * parser would truncate, and a date far enough in the past to be stable but well
 * inside the events table's 13-month TTL (a row outside it is deleted before the
 * SELECT, which is how a previous smoke test silently started reading 0 rows).
 */
const TS_MS = Date.now() - 3_600_000 - (Date.now() % 1000) + 123;
const EXPECTED_LITERAL = toClickHouseDateTime64(TS_MS);

function makeEvent(eventId: string, type: string): Record<string, unknown> {
  return {
    event_id: eventId,
    tenant_id: TENANT_ID,
    session_id: SESSION_ID,
    ts: TS_MS,
    ingest_received_at: TS_MS + 7,
    region: 'eu',
    type,
    schema_version: 1,
    consent_state: 'consented',
    listing_id: 'listing-follow853',
    archetype_hint: '',
    payload: { url: 'https://example.test/listing' },
  };
}

/** Run a SQL statement over the HTTP interface (POST — reads and writes alike). */
async function chSql(sql: string, settings: Record<string, string> = {}): Promise<string> {
  const url = new URL(CLICKHOUSE_URL.replace(/\/$/, ''));
  url.searchParams.set('database', 'default');
  for (const [key, value] of Object.entries(settings)) url.searchParams.set(key, value);
  const headers: Record<string, string> = { 'Content-Type': 'text/plain' };
  if (CLICKHOUSE_USER && CLICKHOUSE_PASSWORD) {
    headers.Authorization = `Basic ${Buffer.from(`${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}`).toString('base64')}`;
  }
  const res = await fetch(url.toString(), { method: 'POST', headers, body: sql });
  const text = await res.text();
  if (!res.ok) throw new Error(`ClickHouse ${String(res.status)}: ${text.slice(0, 400)}`);
  return text.trim();
}

const suite = REQUIRE_CLICKHOUSE || CLICKHOUSE_URL ? describe : describe.skip;

suite('FOLLOW-853 — ingest producer against a live ClickHouse', () => {
  beforeAll(async () => {
    if (REQUIRE_CLICKHOUSE && !CLICKHOUSE_URL) {
      throw new Error(
        'REQUIRE_CLICKHOUSE=1 but CLICKHOUSE_URL is unset — refusing to skip. ' +
          'This spec is the only live-engine proof of the ingest events write path.',
      );
    }
    // Fail loudly (not skip) if the engine is unreachable or the DDL is missing.
    // Scoped to `default` so a same-named table in another database cannot make this
    // read `2` and fail for a reason unrelated to the migration having run.
    const tables = await chSql(
      "SELECT count() FROM system.tables WHERE database = 'default' AND name = 'events'",
    );
    expect(tables).toBe('1');
  });

  afterAll(async () => {
    if (!CLICKHOUSE_URL) return;
    await chSql(`ALTER TABLE events DELETE WHERE tenant_id = '${TENANT_ID}'`).catch(
      () => undefined,
    );
  });

  // ── AC2-A ────────────────────────────────────────────────────────────────
  it("AC2-A: pushToClickHouse lands rows under the server's DEFAULT date_time_input_format", async () => {
    const result = await pushToClickHouse(
      [
        makeEvent('a0000001-0000-4000-8000-000000000001', 'page.view'),
        // Canonical vocabulary: `cta.clicked` is the event name FOLLOW-819's lift
        // query reads (`events WHERE type = 'cta.clicked'`). Writing it here means
        // this spec exercises the exact row that query depends on.
        makeEvent('a0000002-0000-4000-8000-000000000002', 'cta.clicked'),
      ],
      env,
    );

    // A 4xx here is the FOLLOW-853 bug re-appearing. Surface ClickHouse's own
    // error code in the failure message rather than a bare `false !== true`.
    expect(
      result.ok ? 'ok' : `REJECTED ${result.error} (attempts=${String(result.attempts)})`,
    ).toBe('ok');

    const count = await chSql(
      `SELECT count() FROM events WHERE tenant_id = '${TENANT_ID}' FORMAT TSV`,
    );
    expect(count).toBe('2');

    // The instant must round-trip, not merely parse. Compare against the exact
    // DateTime64(3) literal the encoder produced, including milliseconds.
    const stored = await chSql(
      `SELECT toString(ts) FROM events WHERE tenant_id = '${TENANT_ID}' AND type = 'cta.clicked' FORMAT TSV`,
    );
    expect(stored).toBe(EXPECTED_LITERAL);
    expect(stored).not.toContain('T');
    expect(stored).not.toContain('Z');

    // Milliseconds survived — a second-precision parse would land on `.000`.
    expect(EXPECTED_LITERAL.endsWith('.123')).toBe(true);
  });

  // ── AC2-B — negative control ─────────────────────────────────────────────
  it('AC2-B: the pre-FOLLOW-853 trailing-Z shape is REJECTED with Code 27 by the same path', async () => {
    // Drive the REAL producer, rewriting only the timestamp bytes on the wire back
    // to `.toISOString()`. Everything else — URL, headers, retry policy, error
    // classification — is production code. If this insert is accepted, the
    // detector has gone blind and AC2-A's green means nothing.
    const revertingFetch: typeof fetch = (input, init) => {
      // Narrow rather than coerce: the producer always passes an NDJSON string body.
      // If that ever changes, fail here loudly instead of silently rewriting
      // '[object Object]' and turning this negative control into a false green.
      if (typeof init?.body !== 'string') {
        throw new TypeError(
          `expected a string body from pushToClickHouse, got ${typeof init?.body}`,
        );
      }
      const reverted = init.body
        .split('\n')
        .map((line) => {
          const row = JSON.parse(line) as Record<string, unknown>;
          row.ts = new Date(TS_MS).toISOString();
          row.ingest_received_at = new Date(TS_MS + 7).toISOString();
          return JSON.stringify(row);
        })
        .join('\n');
      return fetch(input, { ...init, body: reverted });
    };

    const result = await pushToClickHouse(
      [makeEvent('a0000003-0000-4000-8000-000000000003', 'page.view')],
      env,
      { fetchImpl: revertingFetch, backoffMs: [0, 0, 0] },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return; // narrowing; the assertion above already failed
    expect(result.status).toBe(400);
    // 27 = CANNOT_PARSE_INPUT_ASSERTION_FAILED — the `basic` parser stopping at `Z`.
    expect(result.chErrorCode).toBe(27);
    expect(result.error).toContain('row_rejected');

    // And nothing landed: the rejection is whole-batch, which is what makes the
    // pre-fix behaviour a silent total loss rather than partial degradation.
    const count = await chSql(
      `SELECT count() FROM events WHERE tenant_id = '${TENANT_ID}' AND event_id = 'a0000003-0000-4000-8000-000000000003' FORMAT TSV`,
    );
    expect(count).toBe('0');
  });

  // ── AC2-C — prod-parser parity ───────────────────────────────────────────
  it("AC2-C: the new bytes are ALSO accepted under prod's date_time_input_format=best_effort", async () => {
    // Reproduce the prod service's parser configuration on this container. Prod
    // reads `best_effort` (2026-08-07, ClickHouse 26.4.1) — so this is the case
    // that shows FOLLOW-853's byte change cannot regress the live write path.
    const bestEffortFetch: typeof fetch = (input, init) => {
      // Same reasoning as AC2-B: the producer always passes a string URL. Narrow so a
      // future Request-object refactor fails here instead of silently dropping the
      // setting and re-running AC2-A under a different name.
      if (typeof input !== 'string') {
        throw new TypeError(`expected a string URL from pushToClickHouse, got ${typeof input}`);
      }
      const url = new URL(input);
      url.searchParams.set('date_time_input_format', 'best_effort');
      return fetch(url.toString(), init);
    };

    const result = await pushToClickHouse(
      [makeEvent('a0000004-0000-4000-8000-000000000004', 'cta.clicked')],
      env,
      { fetchImpl: bestEffortFetch },
    );

    expect(result.ok ? 'ok' : `REJECTED under best_effort: ${result.error}`).toBe('ok');

    const stored = await chSql(
      `SELECT toString(ts) FROM events WHERE tenant_id = '${TENANT_ID}' AND event_id = 'a0000004-0000-4000-8000-000000000004' FORMAT TSV`,
    );
    // Same instant as the `basic` path — both parsers agree, so the encoding is
    // genuinely setting-independent rather than merely accepted twice.
    expect(stored).toBe(EXPECTED_LITERAL);
  });

  // ── Guard on the assumption the other three rest on ───────────────────────
  it("records the container's actual date_time_input_format (documents the substrate)", async () => {
    const value = await chSql(
      "SELECT value FROM system.settings WHERE name = 'date_time_input_format' FORMAT TSV",
    );
    // Printed so the CI log carries positive proof of WHICH parser AC2-A ran under.
    console.log(`[FOLLOW-853] container date_time_input_format = ${value}`);
    // If this container ever ships `best_effort` as its default, AC2-B's negative
    // control would stop detecting the bug class — fail loudly instead.
    expect(value).toBe('basic');
  });
});
