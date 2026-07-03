/**
 * POST /api/demo/sessions/:id/revoke — revoke a specific demo session.
 *
 * Auth: Bearer JWT required (agency:viewer minimum — same minimum as the sibling
 * POST/GET /api/demo/sessions handlers). `tenant_id` is derived from the VERIFIED
 * JWT claims via `requireTenantAccess`, never from the caller-supplied
 * `x-tenant-id` header (FOLLOW-456 / audit F-13 — the header was previously
 * trusted outright, letting any caller revoke another tenant's session by
 * spoofing it).
 *
 * `x-tenant-id` is no longer used for authorization at all; if present it is
 * only checked as a defense-in-depth signal — a value that disagrees with the
 * JWT-derived tenant is rejected with 403 rather than silently ignored, so a
 * spoofing attempt is observable instead of blending into an ambiguous 404.
 *
 * @module apps/control-plane/src/app/api/demo/sessions/[id]/revoke/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { and, eq } from 'drizzle-orm';

import { createAdminClient, demoSessions } from '@estalara/db';
import { requireTenantAccess } from '@estalara/auth';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let claims;
  try {
    claims = await requireTenantAccess(req, 'agency:viewer');
  } catch {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Valid JWT with tenant access is required' } },
      { status: 401 },
    );
  }

  const tenantId = claims.tenant_id;

  // Defense-in-depth: x-tenant-id is NOT used for authorization (tenantId above
  // comes only from the verified JWT), but a mismatching header is an explicit
  // spoofing signal worth rejecting loudly rather than letting it silently
  // no-op into a 404 further down.
  const headerTenantId = req.headers.get('x-tenant-id');
  if (headerTenantId && headerTenantId !== tenantId) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'x-tenant-id does not match the authenticated tenant',
        },
      },
      { status: 403 },
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
