/**
 * POST /api/demo/sessions/:id/revoke — revoke a specific demo session.
 *
 * Auth: x-tenant-id required. Tenant must own the session.
 *
 * @module apps/control-plane/src/app/api/demo/sessions/[id]/revoke/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { and, eq } from 'drizzle-orm';

import { createAdminClient, demoSessions } from '@estalara/db';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'x-tenant-id header is required' } },
      { status: 401 },
    );
  }

  const { id: sessionId } = await params;

  let reason = 'user_stopped';
  try {
    const body = (await req.json()) as { reason?: string };
    if (body.reason) reason = body.reason;
  } catch {
    // body is optional
  }

  try {
    const db = createAdminClient();

    const updated = await db
      .update(demoSessions)
      .set({ revokedAt: new Date(), revokeReason: reason })
      .where(and(eq(demoSessions.id, sessionId), eq(demoSessions.tenantId, tenantId)))
      .returning({ id: demoSessions.id });

    if (updated.length === 0) {
      return NextResponse.json(
        { error: { code: 'not_found', message: 'Demo session not found' } },
        { status: 404 },
      );
    }

    return NextResponse.json({ revoked: true, session_id: sessionId });
  } catch {
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Failed to revoke demo session' } },
      { status: 500 },
    );
  }
}
