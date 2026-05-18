/**
 * POST /api/demo/sessions — activate Demo Mode (create new session)
 * GET  /api/demo/sessions — list demo sessions for tenant (last 30 days)
 *
 * Auth: JWT-verified tenant claims required for both endpoints (agency:viewer minimum).
 *
 * JWT signing uses Node.js built-in crypto (HS256) — no external JWT library.
 * Secret: DEMO_MODE_JWT_SECRET env var.
 *
 * @module apps/control-plane/src/app/api/demo/sessions/route
 */

import crypto from 'node:crypto';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { and, desc, gt } from 'drizzle-orm';

import type { DemoDuration, DemoScope, DemoVisibility } from '@estalara/shared';
import { createAdminClient, demoSessions } from '@estalara/db';
import { requireTenantAccess } from '@estalara/auth';
import { eq } from 'drizzle-orm';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActivateBody {
  scope: DemoScope;
  visibility: DemoVisibility;
  duration: DemoDuration;
  production_domain?: string;
}

// ─── JWT helpers (HS256, Node.js crypto) ─────────────────────────────────────

function b64url(buf: Buffer | string): string {
  const s = typeof buf === 'string' ? Buffer.from(buf) : buf;
  return s.toString('base64url');
}

function signDemoJwt(payload: Record<string, unknown>): string {
  const secret = process.env.DEMO_MODE_JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DEMO_MODE_JWT_SECRET must be set in production');
    }
    // Development/test fallback — NOT safe for production
    console.warn(
      '[demo] DEMO_MODE_JWT_SECRET not set — using dev fallback. Set this env var before deploying.',
    );
  }
  const jwtSecret = secret ?? 'dev-demo-secret-not-for-production';
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', jwtSecret).update(signingInput).digest();
  return `${signingInput}.${b64url(sig)}`;
}

function sha256hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// ─── Duration helpers ─────────────────────────────────────────────────────────

function expiresAtForDuration(duration: DemoDuration): Date {
  const now = new Date();
  if (duration === '24h') now.setHours(now.getHours() + 24);
  else if (duration === '7d') now.setDate(now.getDate() + 7);
  else now.setHours(now.getHours() + 2); // 'session' ≈ 2h
  return now;
}

// ─── Validation ───────────────────────────────────────────────────────────────

const VALID_SCOPES: DemoScope[] = ['mockup', 'production'];
const VALID_VISIBILITIES: DemoVisibility[] = ['self', 'shareable'];
const VALID_DURATIONS: DemoDuration[] = ['session', '24h', '7d'];

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
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

  // Use x-user-id from middleware (set by dashboard auth); fall back to a placeholder
  const createdBy = req.headers.get('x-user-id') ?? '00000000-0000-0000-0000-000000000000';

  let body: ActivateBody;
  try {
    body = (await req.json()) as ActivateBody;
  } catch {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'Request body must be valid JSON' } },
      { status: 400 },
    );
  }

  const { scope, visibility, duration, production_domain } = body;

  if (!VALID_SCOPES.includes(scope)) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: `scope must be one of: ${VALID_SCOPES.join(', ')}`,
        },
      },
      { status: 400 },
    );
  }
  if (!VALID_VISIBILITIES.includes(visibility)) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: `visibility must be one of: ${VALID_VISIBILITIES.join(', ')}`,
        },
      },
      { status: 400 },
    );
  }
  if (!VALID_DURATIONS.includes(duration)) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: `duration must be one of: ${VALID_DURATIONS.join(', ')}`,
        },
      },
      { status: 400 },
    );
  }
  if (scope === 'production' && !production_domain) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'production_domain is required when scope is production',
        },
      },
      { status: 400 },
    );
  }

  const sessionId = crypto.randomUUID();
  const exp = expiresAtForDuration(duration);

  const token = signDemoJwt({
    tenant_id: tenantId,
    session_id: sessionId,
    scope,
    exp: Math.floor(exp.getTime() / 1000),
  });
  const tokenHash = sha256hex(token);

  const shareableUrl =
    visibility === 'shareable'
      ? `https://listings.example.com?demo=${encodeURIComponent(token)}`
      : undefined;

  try {
    const db = createAdminClient();
    await db.insert(demoSessions).values({
      id: sessionId,
      tenantId,
      scope,
      visibility,
      duration,
      tokenHash,
      shareableLink: shareableUrl ?? null,
      createdBy,
      expiresAt: exp,
      productionDomain: production_domain ?? null,
    });
  } catch {
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Failed to create demo session' } },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      session_id: sessionId,
      token,
      ...(shareableUrl ? { shareable_url: shareableUrl } : {}),
      expires_at: exp.toISOString(),
      scope,
      visibility,
    },
    { status: 201 },
  );
}

export async function GET(req: NextRequest): Promise<NextResponse> {
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

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  try {
    const db = createAdminClient();
    const rows = await db
      .select({
        id: demoSessions.id,
        scope: demoSessions.scope,
        visibility: demoSessions.visibility,
        duration: demoSessions.duration,
        shareableLink: demoSessions.shareableLink,
        createdAt: demoSessions.createdAt,
        expiresAt: demoSessions.expiresAt,
        revokedAt: demoSessions.revokedAt,
      })
      .from(demoSessions)
      .where(and(eq(demoSessions.tenantId, tenantId), gt(demoSessions.createdAt, thirtyDaysAgo)))
      .orderBy(desc(demoSessions.createdAt));

    const sessions = rows.map((s) => ({
      id: s.id,
      scope: s.scope,
      visibility: s.visibility,
      duration: s.duration,
      created_at: s.createdAt.toISOString(),
      expires_at: s.expiresAt.toISOString(),
      revoked_at: s.revokedAt?.toISOString() ?? null,
      is_active: s.revokedAt === null && s.expiresAt > new Date(),
      shareable_link: s.shareableLink,
    }));

    return NextResponse.json({ tenant_id: tenantId, sessions });
  } catch {
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Failed to list demo sessions' } },
      { status: 500 },
    );
  }
}
