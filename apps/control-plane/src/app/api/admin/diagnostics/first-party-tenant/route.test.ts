/**
 * Unit tests for GET /api/admin/diagnostics/first-party-tenant — FOLLOW-973.
 *
 * The route exists to answer ONE question that three sessions could not settle from outside
 * the running process: what is the STATUS of `FIRST_PARTY_TENANT_ID` in this instance? These
 * tests pin the two properties that make the answer trustworthy:
 *
 *   1. every world-state is DISTINGUISHABLE — `unset`, `malformed`, valid-but-unknown-tenant,
 *      valid-and-known, and "the lookup broke" must not collapse into each other. The bug this
 *      guards against is a lookup failure reported as `resolves_to_known_tenant: false`, which
 *      reads as "the configured id is WRONG" when the truth is "we could not tell" (Rule K.2).
 *   2. the VALUE never leaves the process — in ANY branch, including `malformed`, where
 *      `resolveFirstPartyTenantId` does carry the raw text on its result variant.
 *
 * Coverage: auth (401/403 pass-through), the five world-states, and the no-leak invariant.
 *
 * @module apps/control-plane/src/app/api/admin/diagnostics/first-party-tenant/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { mockVerifyTracerAdminAuth, mockCreateAdminClient } = vi.hoisted(() => ({
  mockVerifyTracerAdminAuth: vi.fn(),
  mockCreateAdminClient: vi.fn(),
}));

vi.mock('@/lib/tracer-auth', () => ({ verifyTracerAdminAuth: mockVerifyTracerAdminAuth }));

vi.mock('@estalara/db', () => ({
  createAdminClient: mockCreateAdminClient,
  tenants: { id: 'id', status: 'status' },
}));

vi.mock('drizzle-orm', () => ({ eq: (a: unknown, b: unknown) => ({ a, b }) }));

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

import { GET } from './route';

/** A live-looking tenant UUID. Only ever compared against, never asserted in a response. */
const KNOWN_TENANT = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

function req(): NextRequest {
  return new NextRequest('https://app.estalara.com/api/admin/diagnostics/first-party-tenant');
}

/** Builds the `db.select().from().where().limit()` chain the route uses. */
function dbReturning(rows: { status: string }[]) {
  return {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
    }),
  };
}

const ORIGINAL_ENV = process.env.FIRST_PARTY_TENANT_ID;

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyTracerAdminAuth.mockResolvedValue({ ok: true, via: 'admin_secret', claims: null });
  mockCreateAdminClient.mockReturnValue(dbReturning([{ status: 'active' }]));
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.FIRST_PARTY_TENANT_ID;
  else process.env.FIRST_PARTY_TENANT_ID = ORIGINAL_ENV;
});

describe('GET /api/admin/diagnostics/first-party-tenant — auth', () => {
  it('passes a 401 through unchanged when the caller is unauthenticated', async () => {
    mockVerifyTracerAdminAuth.mockResolvedValue({ ok: false, status: 401, message: 'no auth' });
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it('passes a 403 through — a valid non-staff session must not read platform config', async () => {
    mockVerifyTracerAdminAuth.mockResolvedValue({ ok: false, status: 403, message: 'not staff' });
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/diagnostics/first-party-tenant — world-states', () => {
  it('reports `unset` and does not touch the DB when the var is absent', async () => {
    delete process.env.FIRST_PARTY_TENANT_ID;
    const body = await (await GET(req())).json();
    expect(body.env_status).toBe('unset');
    expect(body.resolves_to_known_tenant).toBeNull();
    expect(body.tenant_lookup_error).toBe(false);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it('reports `unset` for a blank value — blank is unset, not malformed', async () => {
    process.env.FIRST_PARTY_TENANT_ID = '   ';
    const body = await (await GET(req())).json();
    expect(body.env_status).toBe('unset');
  });

  it('reports `malformed` for a non-UUID, and does not look it up', async () => {
    process.env.FIRST_PARTY_TENANT_ID = 'not-a-uuid';
    const body = await (await GET(req())).json();
    expect(body.env_status).toBe('malformed');
    expect(body.resolves_to_known_tenant).toBeNull();
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it('reports a valid id that resolves to a real tenant, with that row status', async () => {
    process.env.FIRST_PARTY_TENANT_ID = KNOWN_TENANT;
    const body = await (await GET(req())).json();
    expect(body.env_status).toBe('valid');
    expect(body.resolves_to_known_tenant).toBe(true);
    expect(body.tenant_status).toBe('active');
    expect(body.tenant_lookup_error).toBe(false);
  });

  it('distinguishes a well-formed but WRONG uuid — the axis `vercel env ls` cannot reach', async () => {
    process.env.FIRST_PARTY_TENANT_ID = KNOWN_TENANT;
    mockCreateAdminClient.mockReturnValue(dbReturning([]));
    const body = await (await GET(req())).json();
    expect(body.env_status).toBe('valid');
    expect(body.resolves_to_known_tenant).toBe(false);
    expect(body.tenant_status).toBeNull();
    expect(body.tenant_lookup_error).toBe(false);
  });

  it('reports a broken lookup as UNKNOWN (null), never as `false` (Rule K.2)', async () => {
    process.env.FIRST_PARTY_TENANT_ID = KNOWN_TENANT;
    mockCreateAdminClient.mockImplementation(() => {
      throw new Error('connection refused');
    });
    const res = await GET(req());
    const body = await res.json();
    // Still 200: the ENV verdict is authoritative and was obtained; only the DB leg failed.
    expect(res.status).toBe(200);
    expect(body.env_status).toBe('valid');
    expect(body.tenant_lookup_error).toBe(true);
    expect(body.resolves_to_known_tenant).toBeNull();
    expect(body.resolves_to_known_tenant).not.toBe(false);
  });
});

describe('GET /api/admin/diagnostics/first-party-tenant — the value never leaves', () => {
  it.each([
    ['valid', KNOWN_TENANT],
    ['malformed', 'deadbeef-not-a-uuid-but-secret'],
  ])('never echoes the %s value anywhere in the response', async (_label, value) => {
    process.env.FIRST_PARTY_TENANT_ID = value;
    const res = await GET(req());
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain(value);
    // Guard the substring too: a truncated fingerprint would also be a leak.
    expect(raw).not.toContain(value.slice(0, 8));
  });

  it('marks the report uncacheable — it describes THIS instance, now', async () => {
    process.env.FIRST_PARTY_TENANT_ID = KNOWN_TENANT;
    const res = await GET(req());
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(typeof (await res.json()).checked_at).toBe('string');
  });
});
