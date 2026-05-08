/**
 * GET  /api/config  — return current tenant configuration
 * PATCH /api/config — partial update of tenant configuration
 *
 * MVP stub: deterministic mock config keyed on tenant_id.
 *
 * // TODO Sprint 5: read/write tenants table via createTenantClient()
 *
 * Auth:
 *   GET   — agency:viewer minimum (x-tenant-id header required)
 *   PATCH — agency:admin or agency:owner (x-agency-role header checked)
 *
 * @module apps/control-plane/src/app/api/config/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TenantConfig {
  tenant_id: string;
  plan: string;
  brand: {
    primary_color: string;
    logo_url: string | null;
    white_label: boolean;
  };
  quiz: {
    enabled: boolean;
    trigger_after_n_listings: number | null;
    language: string;
  };
  sdk: {
    allowed_origins: string[];
    active_domains: string[];
  };
  updated_at: string;
}

export interface ConfigPatch {
  brand?: Partial<TenantConfig['brand']>;
  quiz?: Partial<TenantConfig['quiz']>;
}

// ─── Mock data ────────────────────────────────────────────────────────────────

/** Per-tenant in-memory state for the stub (survives within a single server process). */
const configStore = new Map<string, TenantConfig>();

function defaultConfig(tenantId: string): TenantConfig {
  return {
    tenant_id: tenantId,
    plan: 'observer',
    brand: {
      primary_color: '#1a73e8',
      logo_url: null,
      white_label: false,
    },
    quiz: {
      enabled: false,
      trigger_after_n_listings: null,
      language: 'en',
    },
    sdk: {
      allowed_origins: ['https://listings.example.com'],
      active_domains: ['listings.example.com'],
    },
    updated_at: new Date().toISOString(),
  };
}

function getConfig(tenantId: string): TenantConfig {
  if (!configStore.has(tenantId)) {
    configStore.set(tenantId, defaultConfig(tenantId));
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return configStore.get(tenantId)!;
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

const ADMIN_ROLES = new Set(['agency:owner', 'agency:admin']);

// ─── Route handlers ───────────────────────────────────────────────────────────

export function GET(req: NextRequest): NextResponse {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'x-tenant-id header is required' } },
      { status: 401 },
    );
  }

  return NextResponse.json(getConfig(tenantId), { status: 200 });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'x-tenant-id header is required' } },
      { status: 401 },
    );
  }

  const role = req.headers.get('x-agency-role');
  if (!role || !ADMIN_ROLES.has(role)) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'agency:admin or agency:owner role required' } },
      { status: 403 },
    );
  }

  let patch: ConfigPatch;
  try {
    patch = (await req.json()) as ConfigPatch;
  } catch {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'Request body must be valid JSON' } },
      { status: 400 },
    );
  }

  const current = getConfig(tenantId);
  const updated: TenantConfig = {
    ...current,
    brand: patch.brand ? { ...current.brand, ...patch.brand } : current.brand,
    quiz: patch.quiz ? { ...current.quiz, ...patch.quiz } : current.quiz,
    updated_at: new Date().toISOString(),
  };
  configStore.set(tenantId, updated);

  return NextResponse.json(updated, { status: 200 });
}
