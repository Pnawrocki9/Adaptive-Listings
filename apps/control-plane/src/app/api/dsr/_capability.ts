/**
 * Shared credential intake and completion rule for the two DSR disclosure routes,
 * `/api/dsr/access` and `/api/dsr/portability` (FOLLOW-1308).
 *
 * WHAT IT CHANGES
 *   - The xid (FOLLOW-1316 amendment, design review R32): a buyer's cross-visit id may be named on
 *     these routes by the `x-estalara-xid` header (GET) or the JSON body (POST), NEVER the query
 *     string, which lands in access logs and browser history (R3). A query-string `xid` is refused
 *     with 400 before the OTP is looked at. There is no xid-to-session mapping (R35): the xid only
 *     reads the returning-buyer profile stored under it.
 *   - Resumable export (Codex F-35): the OTP is spent only once the disclosure is complete. A
 *     truncated `events` export, a ClickHouse read failure, or a failed profile read leaves it
 *     unspent, and the response carries `resume_cursor` so the same `request_id` + `token` fetch
 *     the next page until `expires_at`. Before this, the capability was spent before the read, so
 *     a read failure or a truncated export could not be completed at all.
 *
 * @module apps/control-plane/src/app/api/dsr/_capability
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import type { createAdminClient, DsrVerification } from '@estalara/db';
import { isStrictXid, readBuyerProfileForSubject } from '@/lib/buyer-profile-store';
import {
  getClickHouseDisclosure,
  readClickHouseConfig,
  type ClickHouseDisclosure,
  type EventsExportCursor,
} from '@/lib/clickhouse-dsr';
import { consumeVerifiedOtp } from '@/lib/dsr-verify';

/** The header a GET names the xid in (FOLLOW-1308, R32). */
const DSR_XID_HEADER = 'x-estalara-xid';

const CursorSchema = z
  .object({
    after_ts: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,9})?$/),
    after_event_id: z.string().uuid(),
  })
  .strict();

const PostBodySchema = z
  .object({
    request_id: z.string().min(1),
    token: z.string().min(1),
    xid: z.string().refine(isStrictXid).optional(),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();

/** The credentials of one disclosure request. */
interface DsrCapabilityRequest {
  requestId: string;
  token: string;
  xid: string | null;
  cursor: EventsExportCursor | null;
}

function badRequest(code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status: 400 });
}

/** Opaque, URL-safe form of an `events` keyset cursor. */
function encodeCursor(cursor: EventsExportCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): EventsExportCursor | null {
  try {
    const parsed = CursorSchema.safeParse(
      JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Read `request_id`, `token`, the optional xid and the optional resume cursor.
 *
 * GET: `?request_id&token[&cursor]`, the xid in the `x-estalara-xid` header. POST: a JSON body
 * `{ request_id, token, xid?, cursor? }` (unknown keys refused). Either way a query-string `xid`
 * is refused.
 */
export async function readDsrCapabilityRequest(
  req: NextRequest,
): Promise<{ ok: true; value: DsrCapabilityRequest } | { ok: false; response: NextResponse }> {
  const query = req.nextUrl.searchParams;
  if (query.has('xid')) {
    return {
      ok: false,
      response: badRequest(
        'XID_IN_QUERY_REFUSED',
        `Never send the xid in the URL. Use the ${DSR_XID_HEADER} header or a POST body.`,
      ),
    };
  }

  let requestId: string | null;
  let token: string | null;
  let xid: string | null;
  let rawCursor: string | null;
  if (req.method === 'POST') {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return { ok: false, response: badRequest('VALIDATION_ERROR', 'Body is not valid JSON') };
    }
    const parsed = PostBodySchema.safeParse(body);
    if (!parsed.success) {
      return {
        ok: false,
        response: badRequest(
          'VALIDATION_ERROR',
          "Body 'request_id' and 'token' are required; 'xid' must be a v4 UUID",
        ),
      };
    }
    requestId = parsed.data.request_id;
    token = parsed.data.token;
    xid = parsed.data.xid ?? null;
    rawCursor = parsed.data.cursor ?? null;
  } else {
    requestId = query.get('request_id');
    token = query.get('token');
    rawCursor = query.get('cursor');
    xid = req.headers.get(DSR_XID_HEADER);
    if (!token || !requestId) {
      return {
        ok: false,
        response: badRequest(
          'VALIDATION_ERROR',
          "Query params 'request_id' and 'token' are required",
        ),
      };
    }
    if (xid !== null && !isStrictXid(xid)) {
      return {
        ok: false,
        response: badRequest('VALIDATION_ERROR', `${DSR_XID_HEADER} must be a v4 UUID`),
      };
    }
  }

  let cursor: EventsExportCursor | null = null;
  if (rawCursor !== null) {
    cursor = decodeCursor(rawCursor);
    if (!cursor) {
      return { ok: false, response: badRequest('VALIDATION_ERROR', 'cursor is not valid') };
    }
  }
  return { ok: true, value: { requestId, token, xid, cursor } };
}

/** The returning-buyer profile part of a disclosure. */
type BuyerProfileDisclosure = Awaited<ReturnType<typeof readBuyerProfileForSubject>>;

/** The ClickHouse and profile parts of a disclosure, and whether it is complete. */
interface DisclosureReads {
  clickhouse: ClickHouseDisclosure;
  buyerProfile: BuyerProfileDisclosure | { result: 'not_requested' };
  /** True when nothing failed and nothing was truncated: the OTP may be spent. */
  complete: boolean;
  /** Present when the `events` export was truncated: pass it back as `cursor`. */
  resumeCursor: string | null;
}

/**
 * Read the ClickHouse rows (from `cursor` on, for `events`) and, when an xid was named, the
 * returning-buyer profile stored under it.
 *
 * Complete means: ClickHouse read (or not configured: nothing held there), no table truncated,
 * and the profile read did not fail.
 */
export async function readDisclosureStores(
  record: DsrVerification,
  xid: string | null,
  cursor: EventsExportCursor | null,
  logTag: string,
): Promise<DisclosureReads> {
  let clickhouse: ClickHouseDisclosure = {
    available: false,
    note: 'clickhouse_not_configured',
    tables: [],
  };
  let clickhouseOk = true;
  const chConfig = readClickHouseConfig();
  if (chConfig) {
    try {
      clickhouse = await getClickHouseDisclosure(
        chConfig,
        record.tenantId,
        record.sessionId,
        cursor,
      );
    } catch {
      // A code only: a ClickHouse error body can quote the query.
      console.error(`[${logTag}] ClickHouse disclosure query failed: clickhouse_query_failed`);
      clickhouse = { available: false, note: 'clickhouse_query_failed', tables: [] };
      clickhouseOk = false;
    }
  }

  const buyerProfile = xid
    ? await readBuyerProfileForSubject(record.tenantId, xid)
    : ({ result: 'not_requested' } as const);

  const truncated = clickhouse.tables.find((t) => t.truncated);
  const resumeCursor = truncated?.next_cursor ? encodeCursor(truncated.next_cursor) : null;
  const complete =
    clickhouseOk && !clickhouse.tables.some((t) => t.truncated) && buyerProfile.result !== 'failed';
  return { clickhouse, buyerProfile, complete, resumeCursor };
}

/**
 * Spend the OTP when the disclosure is complete (FOLLOW-1308, F-35).
 *
 * @returns `consumed`, `kept` (incomplete: the same credentials resume it), or `already_used`
 *   (a concurrent request completed it first; this response must not be served as complete).
 */
export async function settleDisclosure(
  db: ReturnType<typeof createAdminClient>,
  record: DsrVerification,
  complete: boolean,
): Promise<'consumed' | 'kept' | 'already_used'> {
  if (!complete) return 'kept';
  return (await consumeVerifiedOtp(db, record.id)) ? 'consumed' : 'already_used';
}
