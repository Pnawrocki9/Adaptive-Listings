/**
 * FOLLOW-1140 (b) / ESC-074 — POST /api/adapt resolves playbook `{token}` placeholders
 * SERVER-SIDE, from the listing's own facts, before the response leaves the route.
 *
 * WHAT THIS PINS, AND WHY IT IS A ROUTE TEST AND NOT A UNIT TEST. Playbook `slots[].en` copy
 * carries `{token}` placeholders. The SDK resolves them from a `data-estalara-<token>`
 * attribute on the matched slot element, and since FOLLOW-1018 a single unresolved token
 * discards the WHOLE directive — so a token no page can satisfy does not degrade the
 * adaptation, it DELETES it. ESC-074 ruled that `/api/adapt` must fill those tokens from the
 * facts it already holds so no unresolved token leaves the server. That is a property of the
 * RESPONSE BODY, so the response body is what is asserted here.
 *
 * RED-FIRST. Before the change every assertion below failed the same way: the route shipped
 * the template verbatim, e.g. `Easy Living — {bedrooms}BR with Lift & No Garden Maintenance`,
 * and the `{...}` run was still on the wire.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * **FOLLOW-1163 / MASTER_DESIGN §E.7.0 MOVED MOST OF THIS FILE, and the reason matters more than
 * the move.** Every surviving `{token}` in every shipped playbook is on a `headline`
 * (RETRO-315, confirmed by extraction), and §E.7.0 withholds the headline on both paths that
 * serve template copy — branch 2 and branch 3's fallback. `resolvePlaceholderDirectives` still
 * RUNS there; its output is simply no longer served. **So ESC-074 (b)'s server-side resolution
 * has no served consumer left, one session after it shipped**, and the route can no longer show
 * that a token was filled correctly — only that none reached the wire, which is now true by
 * construction rather than by resolution.
 *
 * The coverage was MOVED, not deleted: every per-token case now runs against the exported
 * resolver in `src/lib/__tests__/placeholder-tokens.follow1140.test.ts`, still against the REAL
 * playbooks. What stays here is the wire-level net — the one assertion whose subject is still
 * the response body — plus the new shape of the response, so that re-admitting a headline
 * without resolution cannot pass unnoticed.
 *
 * If FOLLOW-1164 puts tokens on a slot that survives the withhold, these cases become
 * route-observable again and should move back.
 *
 * THE TWO HALVES ARE BOTH THE CONTRACT.
 *   1. A token the listing facts CAN satisfy is substituted (downsizer, upsizer,
 *      lifestyle_expat, second_home_buyer below).
 *   2. A token they CANNOT satisfy still DISCARDS the directive — ESC-074 reaffirms
 *      FOLLOW-1018 rather than relaxing it, so partial render stays refused. `yield_hunter`
 *      is the case: no data the route holds yields a rental yield or a gross income, so its
 *      headline is dropped and the response says so via `fallback_reason`.
 *
 * The playbooks are NOT mocked here on purpose: the defect is a property of the copy that
 * actually ships, and a mocked slot would prove nothing about it.
 *
 * @module apps/control-plane/src/app/api/adapt/route.follow1140.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ── Mock external dependencies (mirrors route.follow796.test.ts) ─────────────

vi.mock('@/lib/demo-jwt-verify', () => ({
  verifyDemoJwt: vi.fn().mockResolvedValue({}),
  DemoJwtSecretMissingError: class DemoJwtSecretMissingError extends Error {},
  DemoJwtInvalidError: class DemoJwtInvalidError extends Error {},
}));

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

// A single unpaused arm makes `thompsonSample` deterministic, so the assertions below read
// `variants.en[0]` (identical to `s.en`) on every run rather than a random arm.
vi.mock('@/lib/bandit-query', () => ({
  SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
  getBanditArms: vi
    .fn()
    .mockResolvedValue([{ variant: 'control', alpha: 1, beta: 1, paused: false }]),
}));

import { getAllPlaybooks } from '@estalara/sdk/playbooks';

import { POST } from './route.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const LISTING_ID = 'follow-1140-fixture-listing';

/**
 * A listing-details payload in the shape the Estalara backend actually returns
 * (`ListingResponseTO`) — only the fields the token resolver reads are populated.
 */
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

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/adapt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer demo_key' },
    body: JSON.stringify(body),
  });
}

interface AdaptBody {
  directives: { type: string; slot?: string; value?: string }[];
  source: string;
  fallback_reason?: string;
}

async function adaptFor(archetype: string, listingId: string | null = LISTING_ID) {
  const res = await POST(
    makePostRequest({
      tenant_id: 'est_demo_tenant',
      session_id: `sess-follow1140-${archetype}`,
      page_type: 'listing_detail' as const,
      archetype_hint: archetype,
      confidence: 0.9,
      // > HIGH_SIMILARITY_THRESHOLD (0.85) → branch 2, playbook served directly, no LLM.
      similarity: 0.95,
      holdout_pct: 0.0,
      ...(listingId ? { listing_id: listingId } : {}),
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as AdaptBody;
}

function headlineOf(body: AdaptBody): string | undefined {
  return body.directives.find((d) => d.slot === 'headline')?.value;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/adapt — FOLLOW-1140 (b): server-side placeholder interpolation', () => {
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

  // ESC-075 turned this from a spot-check over eight hand-listed archetypes into the whole
  // registry, because the ruling makes the STRONGER claim available: no shipped copy carries a
  // token the server cannot fill, so no archetype may drop a directive against a complete
  // listing. Enumerated from `getAllPlaybooks()` rather than a literal list — a 19th archetype
  // must be covered by this the day it ships, without anyone remembering to add it (Rule AC).
  //
  // SCOPE, narrowed by FOLLOW-1155 AC(4). Every case in this file pins `similarity: 0.95`, so it
  // exercises BRANCH 2 only (`similarity > HIGH_SIMILARITY_THRESHOLD` at `route.ts:386` — the
  // playbook served verbatim with no LLM call). `resolvePlaceholderDirectives` has exactly two
  // call sites, both inside `resolvePlaybook()`, so branch 2 and the
  // `playbook_fallback_llm_unavailable` fallback are the only paths it covers at all — the
  // `llm_*` returns bypass it entirely (FOLLOW-1149). Read the assertion below as "no archetype
  // drops a directive on the playbook path against a complete listing", never as a claim about
  // every response the route can emit.
  // The wire-level net, and the only assertion in this file whose subject is still the response
  // body. Post-FOLLOW-1163 it holds because no token-BEARING slot is served at all, not because
  // every token resolved — so it is kept as a REGRESSION net rather than as evidence for
  // ESC-074 (b): if a future change re-admits a headline on this path without resolving its
  // tokens, this is what goes red. The evidence for ESC-074 (b) itself now lives in
  // `src/lib/__tests__/placeholder-tokens.follow1140.test.ts`.
  it('no directive on the wire carries an unresolved {token}, for EVERY archetype', async () => {
    const archetypes = [...getAllPlaybooks().keys()];
    // Guards the guard: if the registry ever resolves empty the loop below passes vacuously.
    expect(archetypes.length).toBeGreaterThanOrEqual(18);

    for (const archetype of archetypes) {
      const body = await adaptFor(archetype);
      const withBraces = body.directives.filter((d) => /\{[a-z][a-z0-9_]*\}/i.test(d.value ?? ''));
      expect(withBraces, `archetype ${archetype} shipped an unresolved token`).toEqual([]);
    }
  });

  it('the token-bearing slot is not served at all, and the response says why', async () => {
    // The mechanism that makes the net above true. Stated explicitly so the two are not confused:
    // the headline is absent because §E.7.0 withheld it, NOT because a token failed to resolve.
    const body = await adaptFor('downsizer');
    expect(headlineOf(body)).toBeUndefined();
    expect(body.directives.map((d) => d.slot).sort()).toEqual(['cta']);
    expect(body.source).toBe('playbook');
    expect(body.fallback_reason).toBe('ungrounded_directives_withheld');
  });

  it('`unresolved_placeholder_tokens` is now UNREACHABLE on this branch', async () => {
    // Not a curiosity — a consequence worth pinning. Every shipped token is on a headline, and
    // the headline never survives the withhold, so the token signal cannot fire on branch 2 even
    // for a listing that lacks the fact. Its own runbook row still describes it as reachable
    // here; that row is about the branches this response is not on.
    const withoutBedrooms = Object.fromEntries(
      Object.entries(LISTING_JSON).filter(([key]) => key !== 'bedrooms'),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn((input: unknown) =>
        Promise.resolve(
          String(input).includes('/api/v1/listing/details')
            ? new Response(JSON.stringify(withoutBedrooms), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              })
            : new Response('', { status: 200 }),
        ),
      ),
    );

    const body = await adaptFor('downsizer');
    expect(body.fallback_reason).toBe('ungrounded_directives_withheld');
    expect(body.fallback_reason).not.toBe('unresolved_placeholder_tokens');
  });
});
