/**
 * GET /api/audit
 *
 * Returns paginated audit log entries for the authenticated tenant.
 * MVP stub: returns deterministic mock entries.
 *
 * // TODO Sprint 5: query staff_audit_log table via createTenantClient()
 *
 * Query params:
 *   page:   number (default: 1)
 *   limit:  number (default: 20, max: 100)
 *   action: string (optional filter by action type)
 *
 * @module apps/control-plane/src/app/api/audit/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  action: string;
  user_id: string;
  user_email: string;
  ip_address: string;
  created_at: string;
  details: Record<string, unknown>;
}

export interface AuditResponse {
  tenant_id: string;
  page: number;
  limit: number;
  total: number;
  entries: AuditEntry[];
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_ENTRIES: AuditEntry[] = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    action: 'sdk.installed',
    user_id: 'user-00000001',
    user_email: 'owner@tenant.example',
    ip_address: '203.0.113.1',
    created_at: '2026-05-01T10:00:00.000Z',
    details: { snippet_version: '1.0.0', domain: 'listings.example.com' },
  },
  {
    id: '00000000-0000-0000-0000-000000000002',
    action: 'config.updated',
    user_id: 'user-00000001',
    user_email: 'owner@tenant.example',
    ip_address: '203.0.113.1',
    created_at: '2026-05-02T14:30:00.000Z',
    details: { field: 'brand.primary_color', old: '#000000', new: '#1a73e8' },
  },
  {
    id: '00000000-0000-0000-0000-000000000003',
    action: 'demo.started',
    user_id: 'user-00000002',
    user_email: 'admin@tenant.example',
    ip_address: '203.0.113.42',
    created_at: '2026-05-03T09:15:00.000Z',
    details: { demo_id: 'demo-abc123', archetype: 'investor' },
  },
  {
    id: '00000000-0000-0000-0000-000000000004',
    action: 'api_key.created',
    user_id: 'user-00000001',
    user_email: 'owner@tenant.example',
    ip_address: '203.0.113.1',
    created_at: '2026-05-04T16:00:00.000Z',
    details: { key_prefix: 'est_live_', scopes: ['write:events'] },
  },
  {
    id: '00000000-0000-0000-0000-000000000005',
    action: 'quiz.enabled',
    user_id: 'user-00000002',
    user_email: 'admin@tenant.example',
    ip_address: '203.0.113.42',
    created_at: '2026-05-05T11:45:00.000Z',
    // trigger_after_n_listings removed from audit fixture — FOLLOW-264 AC2 (LG-2).
    // Dead field cleared after FOLLOW-257 removed the SDK consumer.
    details: { language: 'en' },
  },
];

// ─── Route handler ────────────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

export function GET(req: NextRequest): NextResponse {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'x-tenant-id header is required' } },
      { status: 401 },
    );
  }

  const { searchParams } = req.nextUrl;
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const limit = clamp(Number(searchParams.get('limit') ?? '20') || 20, 1, 100);
  const actionFilter = searchParams.get('action');

  const filtered = actionFilter
    ? MOCK_ENTRIES.filter((e) => e.action === actionFilter)
    : MOCK_ENTRIES;

  const body: AuditResponse = {
    tenant_id: tenantId,
    page,
    limit,
    total: filtered.length,
    entries: filtered,
  };

  return NextResponse.json(body, { status: 200 });
}
