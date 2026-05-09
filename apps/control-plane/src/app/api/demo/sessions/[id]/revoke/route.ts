/**
 * POST /api/demo/sessions/:id/revoke — revoke a specific demo session.
 *
 * Auth: x-tenant-id required. Tenant must own the session.
 *
 * // TODO Sprint 5: update demo_sessions table via createAdminClient()
 *
 * @module apps/control-plane/src/app/api/demo/sessions/[id]/revoke/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { sessionStore } from '../../store.js';

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
  const session = sessionStore.get(sessionId);

  if (session?.tenantId !== tenantId) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Demo session not found' } },
      { status: 404 },
    );
  }

  let reason = 'user_stopped';
  try {
    const body = (await req.json()) as { reason?: string };
    if (body.reason) reason = body.reason;
  } catch {
    // body is optional
  }

  session.revokedAt = new Date().toISOString();
  session.revokeReason = reason;

  return NextResponse.json({ revoked: true, session_id: sessionId });
}
