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

// Hoisted so a test can pause every arm but one, which makes `thompsonSample` deterministic —
// the technique route.variant.test.ts established.
const mockGetBanditArms = vi.hoisted(() => vi.fn());
vi.mock('@/lib/bandit-query', () => ({
  SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
  getBanditArms: mockGetBanditArms,
}));

/** Only `v2` is active, so the bandit MUST sample it. */
const ONLY_V2_ACTIVE = [
  { variant: 'control', alpha: 1, beta: 1, paused: true },
  { variant: 'v1', alpha: 1, beta: 1, paused: true },
  { variant: 'v2', alpha: 1, beta: 1, paused: false },
];

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
  variant?: string;
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
    mockGetBanditArms.mockResolvedValue([{ variant: 'control', alpha: 1, beta: 1, paused: false }]);
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

describe('POST /api/adapt — ESC-077 option 2: a withheld response must not credit the sampled arm', () => {
  /**
   * WHY THIS BLOCK EXISTS. Only `headline` carries `variants.en` — `cta` and `feature` have none,
   * across all 18 playbooks. So once §E.7.0 withholds the headline, control / v1 / v2 serve
   * byte-identical copy, while the arm is still sampled, still written to
   * `adaptation_decisions.variant`, and still echoed by the SDK into
   * `POST /api/adapt/feedback`, which updates the `(tenant_id, archetype, variant)` posteriors.
   * The experiment would accrue evidence for a difference no buyer could see.
   *
   * This is the mismatch FOLLOW-362 already ruled on for non-`en` locales, and the remedy is the
   * same: record `control`. Not a white lie — the copy served on a withheld response IS the
   * control copy, because `cta` falls through to `s.en` for every arm.
   *
   * The last test in this block is the one that stops the remedy from being too broad.
   */
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBanditArms.mockResolvedValue(ONLY_V2_ACTIVE);
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

  it('branch 2: the bandit samples v2, but the response credits control', async () => {
    const body = await adaptFor('yield_hunter', 0.95);
    expect(body.source).toBe('playbook');
    expect(body.fallback_reason).toBe('ungrounded_directives_withheld');
    // Red-first: this returned 'v2' before ESC-077 option 2.
    expect(body.variant).toBe('control');
  });

  it('branch 3 fallback: same — a model outage does not license crediting v2 either', async () => {
    const body = await adaptFor('golden_visa_buyer', 0.85);
    expect(body.source).toBe('playbook_fallback_llm_unavailable');
    expect(body.variant).toBe('control');
  });

  it('the ClickHouse row carries control too, not just the response body', async () => {
    // The response field is what the SDK echoes into feedback; the ClickHouse column is what an
    // analyst reads. Both have to agree or the correction is only half applied.
    let insert: string | null = null;
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123/');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: unknown, opts?: { body?: string }) => {
        const url = String(input);
        if ((opts?.body ?? '').includes('INSERT INTO adaptation_decisions')) {
          insert = url;
        }
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

    await adaptFor('yield_hunter', 0.95);
    expect(insert).not.toBeNull();
    expect(insert).toContain('param_p_variant=control');
  });

  it('a response that DID keep a variant-differentiated slot still credits the sampled arm', async () => {
    // THE LIMIT OF THE REMEDY, and the reason it is not simply "always control". When the LLM
    // path serves, nothing is withheld and the arm genuinely influenced the copy the model was
    // asked to improve upon — so v2 must still be credited. Without this case, suppressing the
    // variant everywhere would pass every other test in this block.
    const { callLlmGateway } = await import('@/lib/llm-gateway');
    vi.mocked(callLlmGateway).mockResolvedValueOnce({
      directives: [
        {
          type: 'text',
          slot: 'headline',
          value: 'A calm, well-connected home in the old town',
          archetype: 'yield_hunter',
          confidence: 0.9,
        },
      ],
      model: 'claude-haiku-4-5',
      tokens_in: 100,
      tokens_out: 20,
      cost_usd: 0,
      latency_ms: 1,
    });

    const body = await adaptFor('yield_hunter', 0.85);
    expect(body.source).toBe('llm_tweaked');
    expect(body.fallback_reason).toBeUndefined();
    expect(body.variant).toBe('v2');
  });
});
