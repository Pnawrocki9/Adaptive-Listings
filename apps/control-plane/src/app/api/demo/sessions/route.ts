/**
 * POST /api/demo/sessions — activate Demo Mode (create new session)
 * GET  /api/demo/sessions — list demo sessions for tenant (last 30 days)
 *
 * Auth: x-tenant-id header required for both endpoints.
 *
 * JWT signing uses Node.js built-in crypto (HS256) — no external JWT library.
 * Secret: DEMO_MODE_JWT_SECRET env var.
 *
 * // TODO Sprint 5: persist sessions to demo_sessions table via createAdminClient()
 *
 * @module apps/control-plane/src/app/api/demo/sessions/route
 */

import crypto from 'node:crypto';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import type { DemoDuration, DemoScope, DemoVisibility } from '@estalara/shared';

import { sessionStore } from './store.js';

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
  const secret = process.env.DEMO_MODE_JWT_SECRET ?? 'demo_jwt_secret_dev';
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', secret).update(signingInput).digest();
  return `${signingInput}.${b64url(sig)}`;
}

export function sha256hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// ─── Duration helpers ─────────────────────────────────────────────────────────

export function expiresAtForDuration(duration: DemoDuration): Date {
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
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'x-tenant-id header is required' } },
      { status: 401 },
    );
  }

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

  sessionStore.set(sessionId, {
    id: sessionId,
    tenantId,
    scope,
    visibility,
    duration,
    tokenHash,
    shareableLink: shareableUrl ?? null,
    createdAt: new Date().toISOString(),
    expiresAt: exp.toISOString(),
    revokedAt: null,
    revokeReason: null,
    productionDomain: production_domain ?? null,
  });

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

export function GET(req: NextRequest): NextResponse {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'x-tenant-id header is required' } },
      { status: 401 },
    );
  }

  const sessions = [...sessionStore.values()]
    .filter((s) => s.tenantId === tenantId)
    .map((s) => ({
      id: s.id,
      scope: s.scope,
      visibility: s.visibility,
      duration: s.duration,
      created_at: s.createdAt,
      expires_at: s.expiresAt,
      revoked_at: s.revokedAt,
      is_active: s.revokedAt === null && new Date(s.expiresAt) > new Date(),
      shareable_link: s.shareableLink,
    }));

  return NextResponse.json({ tenant_id: tenantId, sessions });
}
