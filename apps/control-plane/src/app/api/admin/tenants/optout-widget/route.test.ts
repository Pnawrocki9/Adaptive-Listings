/**
 * FOLLOW-641 — tests for GET + PUT /api/admin/tenants/optout-widget (the audited, staff-only
 * write path for the per-brand profiling opt-out widget config).
 *
 * Same harness shape as the FOLLOW-639 quiz-definition sibling: auth is delegated to
 * `resolveTenantAccess` (covered elsewhere), so `@/lib/session-auth` is PARTIALLY mocked —
 * only `resolveTenantAccess` is a spy — while a fake `@estalara/db` + `drizzle-orm` drives
 * the route's REAL query shape.
 *
 * Coverage:
 *   - GET returns the stored config; an absent/garbage blob reads as `{}` (SDK defaults).
 *   - Staff ops SAVE: tenants row updated AND staff_audit_log written in ONE transaction,
 *     `action: 'optout_widget.update'`, payload carrying before/after.
 *   - Below-ops staff → 403, no mutation, no audit row.
 *   - Agency session → 403 staff_only (this is an operator control).
 *   - Invalid config (offset beyond the 200px bound) → 400, nothing written.
 *   - Unknown tenant → 404, nothing written.
 *   - Audit insert fails → whole tx rolls back → 500 audit_write_failed.
 *   - Tenant fence (invariant 5): the write is fenced to the resolved tenant only.
 *
 * @module apps/control-plane/src/app/api/admin/tenants/optout-widget/route.test
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SessionAuthModule from '@/lib/session-auth';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  tenants: { __table: 'tenants', id: 't.id', optoutWidgetConfig: 't.optout_widget_config' },
  staffAuditLog: { __table: 'staff_audit_log' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ kind: 'eq', col, val })),
}));

vi.mock('@/lib/session-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionAuthModule>();
  return { ...actual, resolveTenantAccess: vi.fn() };
});

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import { createAdminClient } from '@estalara/db';
import { resolveTenantAccess, type TenantAccess } from '@/lib/session-auth';
import { GET, PUT } from './route';

const mockResolve = vi.mocked(resolveTenantAccess);

const TENANT_A = '550e8400-e29b-41d4-a716-446655440042';

const VALID_CONFIG = {
  placement: { corner: 'bottom-right' as const, offset_x: 32, offset_y: 48 },
  labels: { on: { en: 'tailoring on' } },
};

// ─── Access fixtures ──────────────────────────────────────────────────────────

function staffAccess(
  role: 'estalara:superadmin' | 'estalara:ops' | 'estalara:readonly' = 'estalara:ops',
): TenantAccess {
  return {
    via: 'staff',
    tenantId: TENANT_A,
    canWrite: role !== 'estalara:readonly',
    staff: {
      sub: 'staff-uuid-777',
      email: 'staff@estalara.com',
      tenant_id: null,
      estalara_staff: true,
      estalara_role: role,
      mfa_verified: true,
    },
  } as TenantAccess;
}

function agencyAccess(): TenantAccess {
  return { via: 'agency', tenantId: TENANT_A, canWrite: true } as TenantAccess;
}

// ─── DB fake ──────────────────────────────────────────────────────────────────

interface DbFakeOptions {
  /** Stored JSONB for the tenant row. */
  stored?: unknown;
  /** No such tenant — the select returns zero rows (404 path). */
  tenantMissing?: boolean;
  /** Make the audit insert reject, to prove the whole tx rolls back. */
  failAudit?: boolean;
}

function makeDb({ stored = {}, tenantMissing = false, failAudit = false }: DbFakeOptions = {}) {
  const auditRows: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const whereArgs: unknown[] = [];

  const rows = tenantMissing ? [] : [{ optoutWidgetConfig: stored }];

  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn((cond: unknown) => {
        whereArgs.push(cond);
        return { limit: vi.fn(() => Promise.resolve(rows)) };
      }),
    })),
  }));

  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const staged: Record<string, unknown>[] = [];
    const stagedUpdates: Record<string, unknown>[] = [];
    const tx = {
      update: vi.fn(() => ({
        set: vi.fn((v: Record<string, unknown>) => {
          stagedUpdates.push(v);
          return {
            where: vi.fn((cond: unknown) => {
              whereArgs.push(cond);
              return Promise.resolve([]);
            }),
          };
        }),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((v: Record<string, unknown>) => {
          if (failAudit) return Promise.reject(new Error('audit sink down'));
          staged.push(v);
          return Promise.resolve([]);
        }),
      })),
    };
    await fn(tx);
    // Only "commit" the staged writes if the callback resolved — a rejection above
    // propagates and leaves auditRows/updates empty, which is the rollback assertion.
    auditRows.push(...staged);
    updates.push(...stagedUpdates);
    return undefined;
  });

  return { select, transaction, auditRows, updates, whereArgs };
}

function wireDb(db: ReturnType<typeof makeDb>): void {
  vi.mocked(createAdminClient).mockReturnValue(
    db as unknown as ReturnType<typeof createAdminClient>,
  );
}

function makeRequest(body?: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/admin/tenants/optout-widget?tenant_id=${TENANT_A}`, {
    method: body === undefined ? 'GET' : 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function parseBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── GET ──────────────────────────────────────────────────────────────────────

describe('GET /api/admin/tenants/optout-widget', () => {
  it('returns the stored config for the resolved tenant', async () => {
    mockResolve.mockResolvedValue(staffAccess());
    wireDb(makeDb({ stored: VALID_CONFIG }));

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await parseBody<{ tenant_id: string; config: typeof VALID_CONFIG }>(res);
    expect(body.tenant_id).toBe(TENANT_A);
    expect(body.config).toEqual(VALID_CONFIG);
  });

  it('reads an unparseable stored blob as empty (SDK defaults), not as an error', async () => {
    mockResolve.mockResolvedValue(staffAccess());
    wireDb(makeDb({ stored: { placement: { corner: 'nowhere' } } }));

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await parseBody<{ config: Record<string, unknown> }>(res);
    expect(body.config).toEqual({});
  });

  it('rejects an agency session — this is a staff-only operator control', async () => {
    mockResolve.mockResolvedValue(agencyAccess());
    wireDb(makeDb());

    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('staff_only');
  });
});

// ─── PUT ──────────────────────────────────────────────────────────────────────

describe('PUT /api/admin/tenants/optout-widget', () => {
  it('writes the config AND its audit row in ONE transaction', async () => {
    mockResolve.mockResolvedValue(staffAccess());
    const db = makeDb({ stored: {} });
    wireDb(db);

    const res = await PUT(makeRequest({ config: VALID_CONFIG }));
    expect(res.status).toBe(200);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]?.optoutWidgetConfig).toEqual(VALID_CONFIG);

    expect(db.auditRows).toHaveLength(1);
    const audit = db.auditRows[0];
    expect(audit?.action).toBe('optout_widget.update');
    expect(audit?.targetTenantId).toBe(TENANT_A);
    expect(audit?.adminUserId).toBe('staff-uuid-777');
    expect(audit?.payload).toEqual({ before: {}, after: VALID_CONFIG });
    expect(audit?.ipAddress).toBe('203.0.113.7');
  });

  it('fences every query to the resolved tenant (invariant 5)', async () => {
    mockResolve.mockResolvedValue(staffAccess());
    const db = makeDb({ stored: {} });
    wireDb(db);

    await PUT(makeRequest({ config: VALID_CONFIG }));

    expect(db.whereArgs.length).toBeGreaterThan(0);
    for (const cond of db.whereArgs) {
      expect(cond).toMatchObject({ kind: 'eq', val: TENANT_A });
    }
  });

  it('rejects staff below estalara:ops with 403 and writes nothing', async () => {
    mockResolve.mockResolvedValue(staffAccess('estalara:readonly'));
    const db = makeDb({ stored: {} });
    wireDb(db);

    const res = await PUT(makeRequest({ config: VALID_CONFIG }));
    expect(res.status).toBe(403);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.auditRows).toHaveLength(0);
  });

  it('rejects an out-of-bounds offset with 400 and writes nothing', async () => {
    mockResolve.mockResolvedValue(staffAccess());
    const db = makeDb({ stored: {} });
    wireDb(db);

    const res = await PUT(
      makeRequest({ config: { placement: { corner: 'top-left', offset_x: 9999, offset_y: 0 } } }),
    );
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_failed');
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('404s an unknown tenant and writes nothing', async () => {
    mockResolve.mockResolvedValue(staffAccess());
    const db = makeDb({ tenantMissing: true });
    wireDb(db);

    const res = await PUT(makeRequest({ config: VALID_CONFIG }));
    expect(res.status).toBe(404);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.auditRows).toHaveLength(0);
  });

  it('rolls the config change back when the audit insert fails (ADR-0018 §3a)', async () => {
    mockResolve.mockResolvedValue(staffAccess());
    const db = makeDb({ stored: {}, failAudit: true });
    wireDb(db);

    const res = await PUT(makeRequest({ config: VALID_CONFIG }));
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('audit_write_failed');
    // Nothing committed — neither the mutation nor the audit row.
    expect(db.auditRows).toHaveLength(0);
    expect(db.updates).toHaveLength(0);
  });
});
