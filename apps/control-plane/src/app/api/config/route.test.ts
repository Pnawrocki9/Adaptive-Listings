/**
 * Tests for GET + PATCH /api/config — spoofable-header auth hole closed
 * (FOLLOW-614, ADR-0018 §2).
 *
 * Core security assertion: a request carrying spoofed `x-tenant-id` / `x-agency-role`
 * headers but a VERIFIED session for tenant A operates ONLY on tenant A's config —
 * the headers are ignored (they are no longer read by the route). Auth + role + tenant
 * all come from the verified claim via `resolveTenantAccess`.
 *
 * Coverage:
 *   - Spoof closed: verified tenant A + spoofed victim headers → tenant A's config.
 *   - GET agency viewer → 200 own tenant.
 *   - PATCH agency viewer → 403 (below admin floor, from the verified claim).
 *   - PATCH agency admin → 200.
 *   - No auth → 401 (via accessErrorToResponse / AccessError).
 *   - Staff `?tenant_id` → 200 (tenant from the validated param, not a header).
 *   - Option-wiring: resolveTenantAccess called with the expected opts.
 *
 * @module apps/control-plane/src/app/api/config/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { TenantConfig } from './route';
import type * as SessionAuthModule from '@/lib/session-auth';

// ─── Constants ────────────────────────────────────────────────────────────────

const TENANT_A = '550e8400-e29b-41d4-a716-446655440042';
const VICTIM_TENANT = '660e8400-e29b-41d4-a716-446655440099';

// ─── Mock modules ─────────────────────────────────────────────────────────────

// Partial mock: ONLY resolveTenantAccess is a spy; AccessError and everything else
// stay real (mirrors audit/route.test.ts + labels/route.test.ts).
vi.mock('@/lib/session-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionAuthModule>();
  return { ...actual, resolveTenantAccess: vi.fn() };
});

import { resolveTenantAccess, AccessError, type TenantAccess } from '@/lib/session-auth';

const mockResolve = vi.mocked(resolveTenantAccess);

// ─── Access fixtures ──────────────────────────────────────────────────────────

function agencyAccess(tenantId: string, role: 'agency:viewer' | 'agency:admin'): TenantAccess {
  return {
    via: 'agency',
    tenantId,
    claims: {
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: tenantId,
      agency_role: role,
      estalara_staff: false,
      mfa_verified: true,
    },
    rawToken: 'agency-jwt',
  };
}

function staffAccess(tenantId: string): TenantAccess {
  return {
    via: 'staff',
    tenantId,
    staff: {
      sub: 'staff-uuid',
      email: 'staff@estalara.com',
      tenant_id: null,
      estalara_staff: true,
      estalara_role: 'estalara:ops',
      mfa_verified: true,
    },
    role: 'estalara:ops',
    canWrite: true,
    isSuperadmin: false,
  };
}

/**
 * Build a request. `spoofHeaders` intentionally injects the OLD (now-ignored)
 * `x-tenant-id` / `x-agency-role` headers to prove the route no longer trusts them.
 */
function makeRequest(opts?: {
  method?: string;
  body?: unknown;
  query?: Record<string, string>;
  spoofHeaders?: Record<string, string>;
}): NextRequest {
  const url = new URL('http://localhost/api/config');
  if (opts?.query) {
    for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = {
    Authorization: 'Bearer mock-token',
    ...(opts?.body ? { 'Content-Type': 'application/json' } : {}),
    ...(opts?.spoofHeaders ?? {}),
  };
  return new NextRequest(url.toString(), {
    method: opts?.method ?? 'GET',
    headers,
    ...(opts?.body ? { body: JSON.stringify(opts.body) } : {}),
  });
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('agency viewer → 200 with own tenant config', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A, 'agency:viewer'));
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await parseBody<TenantConfig>(res);
    expect(body.tenant_id).toBe(TENANT_A);
    expect(typeof body.plan).toBe('string');
    expect(typeof body.brand.primary_color).toBe('string');
    expect(typeof body.quiz.enabled).toBe('boolean');
    expect(Array.isArray(body.sdk.allowed_origins)).toBe(true);
  });

  it('SPOOF CLOSED: verified tenant A + spoofed victim headers → tenant A config, never the victim', async () => {
    // The verified session is tenant A; the request also carries spoofed headers
    // pointing at the victim tenant with an owner role. The headers must be IGNORED.
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A, 'agency:viewer'));
    const { GET } = await import('./route.js');
    const res = await GET(
      makeRequest({
        spoofHeaders: { 'x-tenant-id': VICTIM_TENANT, 'x-agency-role': 'agency:owner' },
      }),
    );
    expect(res.status).toBe(200);
    const body = await parseBody<TenantConfig>(res);
    // Config is keyed on the VERIFIED tenant, never the spoofed victim.
    expect(body.tenant_id).toBe(TENANT_A);
    expect(body.tenant_id).not.toBe(VICTIM_TENANT);
  });

  it('no auth → 401 (via accessErrorToResponse)', async () => {
    mockResolve.mockRejectedValue(new AccessError(401, 'Unauthorized'));
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('staff with ?tenant_id → 200; tenant resolved from the validated param, not a header', async () => {
    mockResolve.mockResolvedValue(staffAccess(VICTIM_TENANT));
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ query: { tenant_id: VICTIM_TENANT } }));
    expect(res.status).toBe(200);
    const body = await parseBody<TenantConfig>(res);
    expect(body.tenant_id).toBe(VICTIM_TENANT);
  });

  it('option-wiring: calls resolveTenantAccess with allowStaffOverride + minAgencyRole viewer', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A, 'agency:viewer'));
    const { GET } = await import('./route.js');
    await GET(makeRequest({ query: { tenant_id: TENANT_A } }));
    expect(mockResolve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        allowStaffOverride: true,
        minAgencyRole: 'agency:viewer',
        tenantId: TENANT_A,
      }),
    );
  });
});

describe('PATCH /api/config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('agency admin → 200 with updated quiz.enabled', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A, 'agency:admin'));
    const { PATCH } = await import('./route.js');
    const res = await PATCH(makeRequest({ method: 'PATCH', body: { quiz: { enabled: true } } }));
    expect(res.status).toBe(200);
    const body = await parseBody<TenantConfig>(res);
    expect(body.quiz.enabled).toBe(true);
    expect(body.tenant_id).toBe(TENANT_A);
  });

  it('agency viewer → 403 (below the admin floor, enforced from the verified claim)', async () => {
    // resolveTenantAccess throws AccessError(403) when the verified role is below
    // minAgencyRole — the route no longer reads a spoofable role header.
    mockResolve.mockRejectedValue(new AccessError(403, 'Access denied: insufficient agency role'));
    const { PATCH } = await import('./route.js');
    const res = await PATCH(makeRequest({ method: 'PATCH', body: { quiz: { enabled: true } } }));
    expect(res.status).toBe(403);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('forbidden');
  });

  it('SPOOF CLOSED: verified tenant A admin + spoofed victim headers → mutates tenant A, never the victim', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A, 'agency:admin'));
    const { PATCH } = await import('./route.js');
    const res = await PATCH(
      makeRequest({
        method: 'PATCH',
        body: { quiz: { enabled: true } },
        spoofHeaders: { 'x-tenant-id': VICTIM_TENANT, 'x-agency-role': 'agency:owner' },
      }),
    );
    expect(res.status).toBe(200);
    const body = await parseBody<TenantConfig>(res);
    expect(body.tenant_id).toBe(TENANT_A);
    expect(body.tenant_id).not.toBe(VICTIM_TENANT);
  });

  it('no auth → 401 (via accessErrorToResponse)', async () => {
    mockResolve.mockRejectedValue(new AccessError(401, 'Unauthorized'));
    const { PATCH } = await import('./route.js');
    const res = await PATCH(makeRequest({ method: 'PATCH', body: { quiz: { enabled: true } } }));
    expect(res.status).toBe(401);
  });

  it('staff (ops) with ?tenant_id → 200; tenant resolved from the validated param', async () => {
    mockResolve.mockResolvedValue(staffAccess(VICTIM_TENANT));
    const { PATCH } = await import('./route.js');
    const res = await PATCH(
      makeRequest({
        method: 'PATCH',
        body: { brand: { white_label: true } },
        query: { tenant_id: VICTIM_TENANT },
      }),
    );
    expect(res.status).toBe(200);
    const body = await parseBody<TenantConfig>(res);
    expect(body.tenant_id).toBe(VICTIM_TENANT);
    expect(body.brand.white_label).toBe(true);
  });

  it('option-wiring: calls resolveTenantAccess with allowStaffOverride + minAgencyRole admin', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_A, 'agency:admin'));
    const { PATCH } = await import('./route.js');
    await PATCH(makeRequest({ method: 'PATCH', body: { quiz: { enabled: true } } }));
    expect(mockResolve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        allowStaffOverride: true,
        minAgencyRole: 'agency:admin',
      }),
    );
  });
});
