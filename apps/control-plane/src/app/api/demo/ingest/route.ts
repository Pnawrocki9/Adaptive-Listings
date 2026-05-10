/**
 * POST /api/demo/ingest — receives SDK events during Demo Mode.
 *
 * Accepts events from the SDK embedded on the mock-up page.
 * Logs them for analytics (stub — real processing in Sprint 5).
 * Returns 200 so SDK doesn't retry.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as { events?: unknown[] };
    const count = body.events?.length ?? 0;
    // TODO Sprint 5: store events in ClickHouse demo_events table
    return NextResponse.json({ received: true, count });
  } catch {
    return NextResponse.json({ received: true, count: 0 });
  }
}
