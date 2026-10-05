/**
 * GET /api/pilot/cta-lift — retired by FOLLOW-1289 (WP-2.4 of the audit-remediation plan).
 *
 * The pilot's primary metric (CTA lift) is now served by exactly ONE route,
 * `GET /api/dashboard/analytics/lift?window_days=<7|14|30>`, whose response carries the same
 * `summary`, `funnel`, `by_archetype` and `data_source` fields this route returned. This stub
 * answers 410 Gone with the new path so a stale caller fails loudly instead of reading a number
 * from a second, divergent implementation. It touches no data store and needs no auth: it returns
 * only a static pointer.
 *
 * @module apps/control-plane/src/app/api/pilot/cta-lift/route
 */

import { NextResponse } from 'next/server';

const MOVED_TO = '/api/dashboard/analytics/lift';

/**
 * @returns 410 `{ error: { code: 'gone', message, moved_to } }` for every request.
 */
export function GET(): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'gone',
        message: `GET /api/pilot/cta-lift was retired (FOLLOW-1289); use GET ${MOVED_TO}`,
        moved_to: MOVED_TO,
      },
    },
    { status: 410, headers: { Link: `<${MOVED_TO}>; rel="successor-version"` } },
  );
}
