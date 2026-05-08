/**
 * GET /api/analytics
 *
 * Returns aggregated analytics for the authenticated tenant.
 * MVP stub: returns deterministic mock data keyed on tenant_id.
 *
 * Auth: reads x-tenant-id header injected by Next.js middleware for /dashboard/* routes.
 * For direct /api/* calls, clients must include the header from their JWT claims.
 *
 * Query params:
 *   period: '7d' | '30d' | '90d'  (default: '30d')
 *
 * // TODO Sprint 4: replace with real ClickHouse queries (TICKET-032)
 *
 * @module apps/control-plane/src/app/api/analytics/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ─── Response types ───────────────────────────────────────────────────────────

export interface DailyStat {
  date: string;
  sessions: number;
  events: number;
}

export interface ArchetypeStat {
  name: string;
  count: number;
  conversion_rate: number;
}

export interface AnalyticsResponse {
  tenant_id: string;
  period: string;
  summary: {
    total_sessions: number;
    total_events: number;
    adaptation_rate: number;
    avg_dwell_ms: number;
    top_archetype: string;
  };
  archetypes: ArchetypeStat[];
  daily: DailyStat[];
  generated_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Period = '7d' | '30d' | '90d';

function parsePeriod(raw: string | null): Period {
  if (raw === '7d' || raw === '90d') return raw;
  return '30d';
}

function periodDays(p: Period): number {
  return p === '7d' ? 7 : p === '90d' ? 90 : 30;
}

/** Deterministic integer hash of a string. Same input always yields same output. */
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + (s.charCodeAt(i) | 0)) | 0;
  }
  return Math.abs(h);
}

/** Seeded pseudo-random in [0, 1). Deterministic for given seed. */
function seededRandom(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

// ─── Mock data generation ─────────────────────────────────────────────────────

const ARCHETYPES = ['investor', 'family', 'neutral', 'professional'] as const;

function buildMockData(tenantId: string, period: Period): AnalyticsResponse {
  const seed = hash(tenantId);
  const days = periodDays(period);

  const totalSessions = 1000 + Math.floor(seededRandom(seed) * 9000);
  const totalEvents = totalSessions * (3 + Math.floor(seededRandom(seed + 1) * 7));
  const adaptationRate = 0.4 + seededRandom(seed + 2) * 0.4;
  const avgDwellMs = 3000 + Math.floor(seededRandom(seed + 3) * 12000);

  const archetypes: ArchetypeStat[] = ARCHETYPES.map((name, i) => ({
    name,
    count: Math.floor(totalSessions * seededRandom(seed + 10 + i) * 0.35),
    conversion_rate: Math.round(seededRandom(seed + 20 + i) * 100) / 1000,
  }));

  const topArchetype = archetypes.reduce((a, b) => (a.count > b.count ? a : b)).name;

  // Daily breakdown — go back `days` days from today
  const now = new Date();
  const daily: DailyStat[] = Array.from({ length: days }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (days - 1 - i));
    const daySeed = seed + 100 + i;
    const sessionShare = seededRandom(daySeed);
    const daySessions = Math.floor((totalSessions * sessionShare) / (days * 0.5));
    return {
      date: d.toISOString().slice(0, 10),
      sessions: daySessions,
      events: Math.floor(daySessions * (3 + seededRandom(daySeed + 1) * 7)),
    };
  });

  return {
    tenant_id: tenantId,
    period,
    summary: {
      total_sessions: totalSessions,
      total_events: totalEvents,
      adaptation_rate: Math.round(adaptationRate * 1000) / 1000,
      avg_dwell_ms: avgDwellMs,
      top_archetype: topArchetype,
    },
    archetypes,
    daily,
    generated_at: new Date().toISOString(),
  };
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

  const period = parsePeriod(req.nextUrl.searchParams.get('period'));
  const data = buildMockData(tenantId, period);

  return NextResponse.json(data, { status: 200 });
}
