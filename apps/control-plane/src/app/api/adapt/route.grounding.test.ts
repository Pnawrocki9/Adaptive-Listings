/**
 * `POST /api/adapt` — stage: GROUNDING (MASTER_DESIGN §E.7.0, ESC-076).
 *
 * A template may not assert a fact about a property it has never read: playbook `{token}`
 * placeholders are filled from the listing's own facts or dropped (FOLLOW-1140), and on the
 * branches no model reads the listing, property-asserting directives are withheld and the bandit
 * arm is not credited for copy identical to control's (FOLLOW-1163 / ESC-077).
 *
 * FOLLOW-1287 merged the per-ticket suites below into this one file, one `describe` per original
 * file, every test kept verbatim (see the registry note under the imports for how their differing
 * mocks coexist).
 *
 * @module apps/control-plane/src/app/api/adapt/route.grounding.test
 */
import { describe, expect, it, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { getAllPlaybooks } from '@estalara/sdk/playbooks';
import { NextRequest } from 'next/server';
import { POST } from './route';

// ─── Per-origin mock registry ─────────────────────────────────────────────────
//
// FOLLOW-1287: this file merges several per-ticket suites. Each of them used to declare its own
// module-level `vi.mock` factories, and those factories DIFFER (one suite's gateway returns null,
// another's returns directives; one fixes the playbook, another uses the real registry), so they
// cannot simply be concatenated. Instead every module any merged suite mocked is mocked ONCE
// below with a proxy, and each suite's original factories — verbatim — fill a per-suite registry
// (`__reg`) inside that suite's `describe`. While a suite runs (and while it is collected, so a
// top-level `vi.mocked(x)` binds to that suite's own mock), the proxy serves its registry; a
// module the suite never mocked falls through to the real implementation, exactly as it did when
// the suite was its own file.
const __H = vi.hoisted(() => {
  const h = {
    active: null as Map<string, Record<string, unknown>> | null,
    actual: {} as Record<string, Record<string, unknown>>,
    /** The real module, as the suite's `vi.importActual` / `importOriginal` returned it. */
    real(id: string): Record<string, unknown> {
      const mod = h.actual[id];
      if (!mod) throw new Error(`[FOLLOW-1287 registry] ${id} was not loaded before collection`);
      return mod;
    },
    proxy(id: string, actual: Record<string, unknown>): Record<string, unknown> {
      h.actual[id] = actual;
      // The suite's own mock when it mocked this module, else the real module. Resolved on every
      // access, so an export a suite's factory did not define is missing exactly as it was.
      const source = (): Record<string | symbol, unknown> => h.active?.get(id) ?? actual;
      return new Proxy<Record<string, unknown>>(
        {},
        {
          get: (_target, key) => source()[key],
          has: (_target, key) => key in source(),
          ownKeys: () => Reflect.ownKeys(source()),
          getOwnPropertyDescriptor: (_target, key) =>
            key in source()
              ? { enumerable: true, configurable: true, value: source()[key] }
              : undefined,
        },
      );
    },
  };
  return h;
});

vi.mock('@/lib/demo-jwt-verify', async (importOriginal) =>
  __H.proxy('@/lib/demo-jwt-verify', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/llm-gateway', async (importOriginal) =>
  __H.proxy('@/lib/llm-gateway', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@estalara/auth', async (importOriginal) =>
  __H.proxy('@estalara/auth', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/rag-retrieval', async (importOriginal) =>
  __H.proxy('@/lib/rag-retrieval', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/tenant-schema', async (importOriginal) =>
  __H.proxy('@/lib/tenant-schema', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/bandit-query', async (importOriginal) =>
  __H.proxy('@/lib/bandit-query', await importOriginal<Record<string, unknown>>()),
);

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Origin: route.follow1140.test.ts
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('route.follow1140.test.ts — FOLLOW-1140 (b) / ESC-074 — POST /api/adapt resolves playbook `{token}` placeholders', () => {
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

  const __reg = new Map<string, Record<string, unknown>>();
  __reg.set(
    '@/lib/demo-jwt-verify',
    (() => ({
      verifyDemoJwt: vi.fn().mockResolvedValue({}),
      DemoJwtSecretMissingError: class DemoJwtSecretMissingError extends Error {},
      DemoJwtInvalidError: class DemoJwtInvalidError extends Error {},
    }))(),
  );
  __reg.set(
    '@/lib/llm-gateway',
    (() => ({
      callLlmGateway: vi.fn().mockResolvedValue(null),
    }))(),
  );
  __reg.set(
    '@estalara/auth',
    (() => ({
      getAuthClaims: vi.fn().mockResolvedValue(null),
    }))(),
  );
  __reg.set(
    '@/lib/rag-retrieval',
    (() => ({
      retrieveListingContext: vi.fn().mockResolvedValue({}),
    }))(),
  );
  __reg.set(
    '@/lib/tenant-schema',
    (() => ({
      getTenantSchema: vi.fn().mockResolvedValue(null),
    }))(),
  );
  // A single unpaused arm makes `thompsonSample` deterministic, so the assertions below read
  // `variants.en[0]` (identical to `s.en`) on every run rather than a random arm.
  __reg.set(
    '@/lib/bandit-query',
    (() => ({
      SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
      getBanditArms: vi
        .fn()
        .mockResolvedValue([{ variant: 'control', alpha: 1, beta: 1, paused: false }]),
    }))(),
  );
  __H.active = __reg;
  beforeAll(() => {
    __H.active = __reg;
  });
  afterAll(() => {
    __H.active = null;
  });

  // ── Mock external dependencies (mirrors route.follow796.test.ts) ─────────────

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
        const withBraces = body.directives.filter((d) =>
          /\{[a-z][a-z0-9_]*\}/i.test(d.value ?? ''),
        );
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

  __H.active = null;
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Origin: route.follow1163.test.ts
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('route.follow1163.test.ts — FOLLOW-1163 / MASTER_DESIGN §E.7.0 (ESC-076) — a template may not assert a fact about a', () => {
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

  // Hoisted so a test can pause every arm but one, which makes `thompsonSample` deterministic —
  // the technique route.variant.test.ts established.
  const mockGetBanditArms = (() => vi.fn())();
  const __reg = new Map<string, Record<string, unknown>>();
  __reg.set(
    '@/lib/demo-jwt-verify',
    (() => ({
      verifyDemoJwt: vi.fn().mockResolvedValue({}),
      DemoJwtSecretMissingError: class DemoJwtSecretMissingError extends Error {},
      DemoJwtInvalidError: class DemoJwtInvalidError extends Error {},
    }))(),
  );
  // Null gateway = the model outage branch 3 falls back from. The `llm_*` returns are covered by
  // llm-gateway.test.ts; what this file is about is what the route serves when they do NOT happen.
  __reg.set(
    '@/lib/llm-gateway',
    (() => ({
      callLlmGateway: vi.fn().mockResolvedValue(null),
    }))(),
  );
  __reg.set(
    '@estalara/auth',
    (() => ({
      getAuthClaims: vi.fn().mockResolvedValue(null),
    }))(),
  );
  __reg.set(
    '@/lib/rag-retrieval',
    (() => ({
      retrieveListingContext: vi.fn().mockResolvedValue({}),
    }))(),
  );
  __reg.set(
    '@/lib/tenant-schema',
    (() => ({
      getTenantSchema: vi.fn().mockResolvedValue(null),
    }))(),
  );
  __reg.set(
    '@/lib/bandit-query',
    (() => ({
      SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
      getBanditArms: mockGetBanditArms,
    }))(),
  );
  __H.active = __reg;
  beforeAll(() => {
    __H.active = __reg;
  });
  afterAll(() => {
    __H.active = null;
  });

  // ── Mock external dependencies (mirrors route.follow1140.test.ts) ─────────────

  /** Only `v2` is active, so the bandit MUST sample it. */
  const ONLY_V2_ACTIVE = [
    { variant: 'control', alpha: 1, beta: 1, paused: true },
    { variant: 'v1', alpha: 1, beta: 1, paused: true },
    { variant: 'v2', alpha: 1, beta: 1, paused: false },
  ];

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

  // FOLLOW-1286 (D3): this file pins the pre-freeze bandit behaviour, which now runs only with
  // BANDIT_ENABLED=true. The frozen default (flag off) is pinned by `lib/__tests__/bandit-flag.test.ts`,
  // `api/adapt/route.bandit-freeze.test.ts` and each frozen route's own `BANDIT_ENABLED off` block.
  beforeEach(() => {
    vi.stubEnv('BANDIT_ENABLED', 'true');
  });

  describe('POST /api/adapt — FOLLOW-1163: an ungrounded template may not assert a property fact', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockGetBanditArms.mockResolvedValue([
        { variant: 'control', alpha: 1, beta: 1, paused: false },
      ]);
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

  __H.active = null;
});
