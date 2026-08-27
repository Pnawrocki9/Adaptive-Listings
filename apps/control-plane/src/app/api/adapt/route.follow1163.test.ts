/**
 * FOLLOW-1163 / MASTER_DESIGN §E.7.0 (ESC-076) — a template may not assert a fact about a
 * property it has never read.
 *
 * WHAT THIS PINS. Branch 2 (`similarity > HIGH_SIMILARITY_THRESHOLD`) serves playbook copy
 * VERBATIM and deliberately never fetches the listing (`listing-facts-context.ts` skips the
 * fetch above its ceiling). `similarity` is confidence about the BUYER's archetype and says
 * nothing about the PROPERTY, so no threshold on it can make `'Golden Visa Eligible'`,
 * `'Tourist License, Near Beach'` or `'Near Top-Rated Schools'` true of THIS listing. The same
 * static copy is served by branch 3's `playbook_fallback_llm_unavailable` path, which is the
 * path a model outage takes.
 *
 * THE RULE, AND THE HALF OF IT THAT IS NOT OBVIOUS. §E.7.0 says a directive comes from the
 * listing's text or not at all — and that when we cannot ground, we do not adapt. It does NOT
 * say every directive dies: a CALL TO ACTION asserts nothing about the property. It is an offer
 * we make ("Request Investment Pack") or an invitation to the buyer ("Book a Viewing"), and it
 * stays true whatever the listing says. All seventeen shipped `cta` strings were enumerated
 * before this line was drawn and not one asserts a property fact.
 *
 * `headline` and `feature` are withheld. `headline` is where every property claim in the
 * playbook lives. `feature` is MIXED — most are section labels ("Family Essentials",
 * "Portfolio Metrics") but four are claims: `remote_worker`'s "Remote Work Ready",
 * `downsizer`'s "Downsizer Friendly", `vacation_rental_investor`'s "Short-Term Rental
 * Projections", `golden_visa_buyer`'s "Residency Requirements". A mechanical rule cannot tell
 * the label from the claim, so the slot is withheld whole; re-admitting the label-only ones is
 * FOLLOW-1164's job, once slots are briefs.
 *
 * RED-FIRST, executed before the change:
 *   - the branch-2 case failed with the full 3-directive playbook batch on the wire, headline
 *     included, and `fallback_reason` absent;
 *   - the branch-3 fallback case failed the same way.
 *
 * @module apps/control-plane/src/app/api/adapt/route.follow1163.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ── Mock external dependencies (mirrors route.follow1140.test.ts) ─────────────

vi.mock('@/lib/demo-jwt-verify', () => ({
  verifyDemoJwt: vi.fn().mockResolvedValue({}),
  DemoJwtSecretMissingError: class DemoJwtSecretMissingError extends Error {},
  DemoJwtInvalidError: class DemoJwtInvalidError extends Error {},
}));

// Null gateway = the model outage branch 3 falls back from. The `llm_*` returns are covered by
// llm-gateway.test.ts; what this file is about is what the route serves when they do NOT happen.
vi.mock('@/lib/llm-gateway', () => ({
  callLlmGateway: vi.fn().mockResolvedValue(null),
}));

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/rag-retrieval', () => ({
  retrieveListingContext: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/tenant-schema', () => ({
  getTenantSchema: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/bandit-query', () => ({
  SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
  getBanditArms: vi
    .fn()
    .mockResolvedValue([{ variant: 'control', alpha: 1, beta: 1, paused: false }]),
}));

import { getAllPlaybooks } from '@estalara/sdk/playbooks';

import { POST } from './route.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const LISTING_ID = 'follow-1163-fixture-listing';

/** A COMPLETE listing — so nothing below can be explained away as a missing fact. */
const LISTING_JSON = {
  uuid: '11111111-2222-3333-4444-555555555555',
  headline: 'Sunlit apartment with river views',
  description: 'A calm, well-connected home in the old town.',
  bedrooms: 3,
  livingArea: 128.5,
  district: 'Alfama',
  city: 'Lisbon',
  publicLocationLabel: 'Alfama, Lisbon',
  highlights: ['Renovated kitchen', 'River views'],
  price: 450000,
  currency: 'EUR',
};

interface AdaptBody {
  directives: { type: string; slot?: string; value?: string }[];
  source: string;
  fallback_reason?: string;
}

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/adapt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer demo_key' },
    body: JSON.stringify(body),
  });
}

/**
 * @param similarity 0.95 → branch 2 (playbook verbatim, no LLM).
 *                   0.85 → branch 3 (Haiku tweak; the mocked gateway returns null, so the
 *                          `playbook_fallback_llm_unavailable` path runs).
 *                   0.40 → branch 4 (full generation; same null, but its fallback is empty).
 */
async function adaptFor(archetype: string, similarity: number): Promise<AdaptBody> {
  const res = await POST(
    makePostRequest({
      tenant_id: 'est_demo_tenant',
      session_id: `sess-follow1163-${archetype}-${String(similarity)}`,
      page_type: 'listing_detail' as const,
      archetype_hint: archetype,
      confidence: 0.9,
      similarity,
      holdout_pct: 0.0,
      listing_id: LISTING_ID,
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as AdaptBody;
}

const slotsOf = (body: AdaptBody): string[] =>
  body.directives.map((d) => d.slot ?? 'unknown').sort();

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/adapt — FOLLOW-1163: an ungrounded template may not assert a property fact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CLICKHOUSE_URL', '');
    vi.stubEnv('ESTALARA_BACKEND_URL', 'http://listing-backend.test');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: unknown) => {
        const url = String(input);
        if (url.includes('/api/v1/listing/details')) {
          return Promise.resolve(
            new Response(JSON.stringify(LISTING_JSON), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        return Promise.resolve(new Response('', { status: 200 }));
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  // Enumerated from the registry rather than a literal list, so a 19th archetype is covered the
  // day it ships (Rule AC). The floor guards the guard: an empty registry would pass vacuously.
  it('branch 2 withholds headline and feature for EVERY archetype, and says so on the wire', async () => {
    const archetypes = [...getAllPlaybooks().keys()].filter((a) => a !== 'neutral');
    expect(archetypes.length).toBeGreaterThanOrEqual(17);

    for (const archetype of archetypes) {
      const body = await adaptFor(archetype, 0.95);
      expect(body.source, `archetype ${archetype}`).toBe('playbook');
      expect(
        slotsOf(body).filter((s) => s !== 'cta'),
        `archetype ${archetype} served a slot that asserts a property fact`,
      ).toEqual([]);
      expect(body.fallback_reason, `archetype ${archetype} withheld silently`).toBe(
        'ungrounded_directives_withheld',
      );
    }
  });

  it('the cta SURVIVES — it is an offer we make, not a claim about the property', async () => {
    const body = await adaptFor('yield_hunter', 0.95);
    expect(body.directives.map((d) => d.value)).toEqual(['Request Investment Pack']);
  });

  it('branch 3 fallback withholds the same slots — a model outage is not a licence to assert', async () => {
    const body = await adaptFor('golden_visa_buyer', 0.85);
    expect(body.source).toBe('playbook_fallback_llm_unavailable');
    // 'Golden Visa Eligible — Residency by Investment' is a claim about this property's legal
    // status. Nothing in the listing supports it and no model saw the listing on this path.
    expect(body.directives.map((d) => d.value)).not.toContain(
      'Golden Visa Eligible — Residency by Investment',
    );
    expect(slotsOf(body)).toEqual(['cta']);
  });

  it('the LLM diagnosis is NOT displaced on the fallback branches — the canary reads it', async () => {
    // FOLLOW-1056 / FOLLOW-1022: `fallback_reason` on a `playbook_fallback_*` response says WHY
    // the model did not serve. The withholding is reported through Sentry/logs instead, exactly
    // as FOLLOW-1140's token drop is. Overwriting this would blind the adapt canary.
    const body = await adaptFor('yield_hunter', 0.85);
    expect(body.fallback_reason).toBe('llm_unavailable');
  });

  it('branch 4 still serves nothing — its emptiness is about archetype FIT, not grounding', async () => {
    // `similarity <= LOW_SIMILARITY_THRESHOLD` means the archetype match is weak, so the
    // playbook is the wrong copy regardless of what the listing says. Pinned so that a later
    // change to the withholding rule cannot quietly start serving copy here.
    const body = await adaptFor('yield_hunter', 0.4);
    expect(body.source).toBe('playbook_fallback_llm_unavailable');
    expect(body.directives).toEqual([]);
  });
});
