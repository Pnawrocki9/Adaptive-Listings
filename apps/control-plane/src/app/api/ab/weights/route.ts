/**
 * GET /api/ab/weights
 *
 * Returns the current Thompson sampling bandit weights for the authenticated tenant.
 * Provides visibility into per-(archetype, variant) Beta distribution parameters (alpha, beta)
 * and the auto-pause state for the analytics dashboard.
 *
 * Used by the TICKET-AB-004 analytics dashboard (Anomaly feed panel).
 *
 * Auth: reads x-tenant-id header injected by Next.js middleware for /dashboard/* routes.
 *
 * Query params:
 *   archetype: filter by archetype label (optional)
 *
 * MVP stub: returns deterministic mock data keyed on tenant_id.
 * Real Drizzle DB queries (packages/db abBanditWeights table) will replace this in TICKET-AB-004.
 *
 * @module apps/control-plane/src/app/api/ab/weights/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ─── Response types ───────────────────────────────────────────────────────────

export interface BanditWeightRow {
  tenant_id: string;
  archetype: string;
  variant: string;
  /** Beta distribution alpha parameter (successes + 1). */
  alpha: number;
  /** Beta distribution beta parameter (failures + 1). */
  beta: number;
  /** Estimated conversion rate: alpha / (alpha + beta). */
  estimated_rate: number;
  /** Whether this (archetype, variant) is auto-paused due to regression detection. */
  paused: boolean;
  updated_at: string;
}

export interface AbWeightsResponse {
  tenant_id: string;
  rows: BanditWeightRow[];
  total: number;
  generated_at: string;
}

// ─── Mock data generation ─────────────────────────────────────────────────────

const MOCK_ARCHETYPES = ['investor', 'family_buyer', 'yield_hunter', 'neutral'] as const;
const MOCK_VARIANTS = ['control', 'headline_v1', 'photo_order_v2'] as const;

/** Deterministic integer hash of a string. */
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + (s.charCodeAt(i) | 0)) | 0;
  }
  return Math.abs(h);
}

/** Seeded pseudo-random in [0, 1). */
function seededRandom(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

function buildMockWeights(tenantId: string, archetypeFilter?: string): BanditWeightRow[] {
  const seed = hash(tenantId);
  const rows: BanditWeightRow[] = [];
  let idx = 0;

  for (const archetype of MOCK_ARCHETYPES) {
    if (archetypeFilter && archetype !== archetypeFilter) {
      idx += MOCK_VARIANTS.length;
      continue;
    }
    for (const variant of MOCK_VARIANTS) {
      const rowSeed = seed + idx;
      const alpha = 1 + Math.floor(seededRandom(rowSeed) * 99);
      const beta = 1 + Math.floor(seededRandom(rowSeed + 1) * 99);
      const paused = seededRandom(rowSeed + 2) < 0.05; // 5% chance of being paused
      rows.push({
        tenant_id: tenantId,
        archetype,
        variant,
        alpha,
        beta,
        estimated_rate: Math.round((alpha / (alpha + beta)) * 10000) / 10000,
        paused,
        updated_at: new Date(
          Date.now() - Math.floor(seededRandom(rowSeed + 3) * 86400000),
        ).toISOString(),
      });
      idx++;
    }
  }

  return rows;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export function GET(req: NextRequest): NextResponse {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'x-tenant-id header is required' } },
      { status: 401 },
    );
  }

  const archetypeFilter = req.nextUrl.searchParams.get('archetype') ?? undefined;

  const rows = buildMockWeights(tenantId, archetypeFilter);

  const response: AbWeightsResponse = {
    tenant_id: tenantId,
    rows,
    total: rows.length,
    generated_at: new Date().toISOString(),
  };

  return NextResponse.json(response, { status: 200 });
}
