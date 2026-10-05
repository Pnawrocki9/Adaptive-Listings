/**
 * `POST /api/adapt` — stage: CONSENT and ENABLEMENT gates.
 *
 * The early returns that serve a neutral pass-through instead of an adaptation: the per-user
 * profiling opt-out (§H.9, FOLLOW-383), the consent-mode skip (TICKET-AB-010 / FOLLOW-369), the
 * per-tenant Adaptive Listings ON/OFF switch (FOLLOW-633), and the non-blocking pilot-freeze
 * warning (FOLLOW-117 / FOLLOW-263).
 *
 * FOLLOW-1287 merged the per-ticket suites below into this one file, one `describe` per original
 * file, every test kept verbatim (see the registry note under the imports for how their differing
 * mocks coexist).
 *
 * @module apps/control-plane/src/app/api/adapt/route.consent-and-enablement.test
 */
import { describe, expect, it, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { getBanditArms } from '@/lib/bandit-query';
import { thompsonSample } from '@estalara/shared';
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
vi.mock('@estalara/sdk/playbooks', async (importOriginal) =>
  __H.proxy('@estalara/sdk/playbooks', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/bandit-query', async (importOriginal) =>
  __H.proxy('@/lib/bandit-query', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/demo-override-store', async (importOriginal) =>
  __H.proxy('@/lib/demo-override-store', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@estalara/shared', async (importOriginal) =>
  __H.proxy('@estalara/shared', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/tenant-schema', async (importOriginal) =>
  __H.proxy('@/lib/tenant-schema', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/al-enablement', async (importOriginal) =>
  __H.proxy('@/lib/al-enablement', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/embedding-lookup', async (importOriginal) =>
  __H.proxy('@/lib/embedding-lookup', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@estalara/db', async (importOriginal) =>
  __H.proxy('@estalara/db', await importOriginal<Record<string, unknown>>()),
);
vi.mock('drizzle-orm', async (importOriginal) =>
  __H.proxy('drizzle-orm', await importOriginal<Record<string, unknown>>()),
);

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Origin: route.follow383.test.ts
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('route.follow383.test.ts — FOLLOW-383 tests: profiling opt-out gate for POST /api/adapt.', () => {
  /**
   * FOLLOW-383 tests: profiling opt-out gate for POST /api/adapt.
   *
   * The SDK appends ?profiling_opt_out=1 to the URL for opted-out sessions.
   * When present, the POST handler MUST:
   *   1. Return 200 with empty directives and source='default'.
   *   2. NOT log a ClickHouse variant row (logDecisionAsync is suppressed).
   *   3. Return BEFORE bandit sampling (getBanditArms / thompsonSample not called).
   *
   * @module apps/control-plane/src/app/api/adapt/route.follow383.test
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
    '@estalara/sdk/playbooks',
    (() => ({
      getPlaybook: vi.fn(() => ({
        slots: [
          {
            slot: 'headline',
            en: 'Control headline',
            variants: { en: ['Control headline', 'Variant 1 headline'] },
          },
        ],
      })),
    }))(),
  );
  // FOLLOW-397: include SEED_VARIANTS so VARIANT_INDEX is derived correctly at module load.
  __reg.set(
    '@/lib/bandit-query',
    (() => ({
      SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
      getBanditArms: vi.fn().mockResolvedValue([
        { variant: 'control', alpha: 1, beta: 1, paused: false },
        { variant: 'v1', alpha: 1, beta: 1, paused: false },
      ]),
    }))(),
  );
  __reg.set(
    '@/lib/demo-override-store',
    (() => ({
      getDemoOverride: vi.fn().mockResolvedValue({
        enabled: false,
        overrideArchetype: null,
        overrideModel: 'claude-sonnet-4-6',
      }),
      DEMO_OVERRIDE_CONFIDENCE: 0.95,
      DEMO_OVERRIDE_SIMILARITY: 0.75,
    }))(),
  );
  __reg.set(
    '@estalara/shared',
    (() => {
      const mod = __H.real('@estalara/shared');
      return {
        ...mod,
        assignHoldout: vi.fn().mockResolvedValue({
          holdout_group: false,
          skipped: false,
          assigned_at: new Date().toISOString(),
        }),
        // Deterministic 'v1' — on the opt-out path sampling must NEVER run
        thompsonSample: vi.fn().mockReturnValue('v1'),
      };
    })(),
  );
  __H.active = __reg;
  beforeAll(() => {
    __H.active = __reg;
  });
  afterAll(() => {
    __H.active = null;
  });

  // ── Mocks (hoisted before route import) ────────────────────────────────────

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  function makePostRequest(body: Record<string, unknown>, urlSuffix = ''): NextRequest {
    return new NextRequest(`http://localhost/api/adapt${urlSuffix}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test_key',
      },
      body: JSON.stringify(body),
    });
  }

  const BASE_BODY = {
    tenant_id: 'tenant-follow383',
    session_id: 'sess-follow383-post-001',
    page_type: 'listing_detail',
    archetype_hint: 'yield_hunter',
    confidence: 0.85,
    similarity: 0.9,
  };

  // ─── FOLLOW-383: profiling opt-out gate on POST ───────────────────────────────

  // FOLLOW-1286 (D3): this file pins the pre-freeze bandit behaviour, which now runs only with
  // BANDIT_ENABLED=true. The frozen default (flag off) is pinned by `lib/__tests__/bandit-flag.test.ts`,
  // `api/adapt/route.bandit-freeze.test.ts` and each frozen route's own `BANDIT_ENABLED off` block.
  beforeEach(() => {
    vi.stubEnv('BANDIT_ENABLED', 'true');
  });

  describe('POST /api/adapt — FOLLOW-383: profiling_opt_out=1 URL query param gate', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123/');
      vi.stubEnv('ADAPT_API_KEY', '');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it('AC-1: returns 200 with empty directives and source=default when profiling_opt_out=1', async () => {
      // Stub fetch so ClickHouse INSERT calls don't fail
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));

      const res = await POST(makePostRequest(BASE_BODY, '?profiling_opt_out=1'));

      expect(res.status).toBe(200);
      const resBody = (await res.json()) as {
        directives: unknown[];
        source: string;
        archetype: string;
      };
      expect(resBody.directives).toHaveLength(0);
      expect(resBody.source).toBe('default');
      expect(resBody.archetype).toBe('neutral');
    });

    it('AC-2: ClickHouse INSERT is NOT called when profiling_opt_out=1', async () => {
      let fetchCalled = false;
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() => {
          fetchCalled = true;
          return Promise.resolve(new Response('', { status: 200 }));
        }),
      );

      await POST(makePostRequest(BASE_BODY, '?profiling_opt_out=1'));

      // logDecisionAsync fires a fetch to ClickHouse — must NOT happen on opt-out path
      expect(fetchCalled).toBe(false);
    });

    it('AC-3: getBanditArms and thompsonSample are NOT called when profiling_opt_out=1', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));

      await POST(makePostRequest(BASE_BODY, '?profiling_opt_out=1'));

      expect(getBanditArms).not.toHaveBeenCalled();
      expect(thompsonSample).not.toHaveBeenCalled();
    });

    it('AC-4: response includes adapt_decision_id and session_id for client correlation', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));

      const res = await POST(makePostRequest(BASE_BODY, '?profiling_opt_out=1'));
      const resBody = (await res.json()) as {
        adapt_decision_id: string;
        session_id: string;
      };

      expect(resBody.adapt_decision_id).toBeTruthy();
      expect(typeof resBody.adapt_decision_id).toBe('string');
      expect(resBody.session_id).toBe(BASE_BODY.session_id);
    });

    it('positive control: profiling_opt_out absent → normal path, getBanditArms called', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));

      const res = await POST(makePostRequest(BASE_BODY));

      expect(res.status).toBe(200);
      // Normal path fires bandit sampling
      expect(getBanditArms).toHaveBeenCalled();
      expect(thompsonSample).toHaveBeenCalled();
    });

    it('positive control: profiling_opt_out=0 → normal path runs', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));

      const res = await POST(makePostRequest(BASE_BODY, '?profiling_opt_out=0'));

      expect(res.status).toBe(200);
      // Normal path fires
      expect(getBanditArms).toHaveBeenCalled();
    });
  });

  __H.active = null;
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Origin: route.ab010.test.ts
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('route.ab010.test.ts — Tests for TICKET-AB-010 — holdout gating + consent skip on control-plane POST /api/adapt.', () => {
  /**
   * Tests for TICKET-AB-010 — holdout gating + consent skip on control-plane POST /api/adapt.
   *
   * Coverage:
   *   - holdout_pct: 1.0 + consent granted → directives: [], holdout_group: true
   *   - consent_state: 'opted_out' + consent_mode_enabled → directives: [], no holdout_group
   *   - holdout_pct: 0.0 + consent granted → treatment arm, directives non-empty
   *   - holdout_pct absent → default 0.1 (neither guaranteed hold-out nor treatment)
   *
   * Approach:
   *   - holdout_pct: 1.0 guarantees every session lands in holdout (100% holdout rate).
   *   - holdout_pct: 0.0 guarantees every session lands in treatment (0% holdout rate).
   *   - consent_mode_enabled: true + opted_out → skipped.
   *
   * @module apps/control-plane/src/app/api/adapt/route.ab010.test
   */

  const __reg = new Map<string, Record<string, unknown>>();
  // Bypass JWT verification — these tests focus on holdout/consent gating, not auth.
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
    '@estalara/sdk/playbooks',
    (() => ({
      getPlaybook: vi.fn(() => ({
        slots: [
          { slot: 'headline', en: 'High-yield investment property' },
          { slot: 'cta', en: 'View ROI Analysis' },
        ],
      })),
    }))(),
  );
  // Mock tenant-schema to return a reorder-capable schema for est_demo_tenant
  __reg.set(
    '@/lib/tenant-schema',
    (() => ({
      getTenantSchema: vi.fn().mockResolvedValue({
        reorder_capable: true,
        container_selector: '[data-estalara-listings-grid]',
        item_selector: '[data-estalara-listing-id]',
      }),
    }))(),
  );
  // Mock bandit-query — POST handler now calls getBanditArms (FOLLOW-007)
  // FOLLOW-397: include SEED_VARIANTS so VARIANT_INDEX is derived correctly at module load.
  __reg.set(
    '@/lib/bandit-query',
    (() => ({
      SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
      getBanditArms: vi.fn().mockResolvedValue([
        { variant: 'control', alpha: 1, beta: 1, paused: false },
        { variant: 'v1', alpha: 1, beta: 1, paused: false },
        { variant: 'v2', alpha: 1, beta: 1, paused: false },
      ]),
    }))(),
  );
  __H.active = __reg;
  beforeAll(() => {
    __H.active = __reg;
  });
  afterAll(() => {
    __H.active = null;
  });

  // ── Mock all external dependencies ───────────────────────────────────────────

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  function makePostRequest(body: Record<string, unknown>): NextRequest {
    return new NextRequest('http://localhost/api/adapt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer demo_key',
      },
      body: JSON.stringify(body),
    });
  }

  // FOLLOW-1201 / FOLLOW-1102: a body `holdout_pct` is honoured ONLY for the ADAPT_API_KEY caller;
  // AC-2 below forces the holdout arm with it, so that one test authenticates as ops.
  const OPS_KEY = 'ops-key-'.repeat(6);

  function makeOpsPostRequest(body: Record<string, unknown>): NextRequest {
    return new NextRequest('http://localhost/api/adapt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPS_KEY}` },
      body: JSON.stringify(body),
    });
  }

  const BASE_BODY = {
    tenant_id: 'est_demo_tenant',
    session_id: 'sess-ab010-001',
    page_type: 'listing_list' as const,
    archetype_hint: 'yield_hunter',
    confidence: 0.8,
    similarity: 0.9,
    listing_ids: ['listing-a', 'listing-b'],
  };

  // ─── AB-010 tests ─────────────────────────────────────────────────────────────

  describe('POST /api/adapt — TICKET-AB-010: holdout gating', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.stubEnv('CLICKHOUSE_URL', '');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it('AC-2: holdout_pct=1.0 + consent granted → directives:[], holdout_group:true', async () => {
      vi.stubEnv('ADAPT_API_KEY', OPS_KEY); // FOLLOW-1201: body holdout_pct is ops-only
      vi.stubEnv('OPS_TENANT_ID', BASE_BODY.tenant_id);
      const res = await POST(
        makeOpsPostRequest({
          ...BASE_BODY,
          holdout_pct: 1.0,
          consent_state: 'granted',
          consent_mode_enabled: false,
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(Array.isArray(body.directives)).toBe(true);
      expect((body.directives as unknown[]).length).toBe(0);
      expect(body.source).toBe('default');
      expect(body.holdout_group).toBe(true);
    });

    it('AC-3: consent_state=opted_out + consent_mode_enabled → directives:[], no holdout_group', async () => {
      const res = await POST(
        makePostRequest({
          ...BASE_BODY,
          consent_state: 'opted_out',
          consent_mode_enabled: true,
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(Array.isArray(body.directives)).toBe(true);
      expect((body.directives as unknown[]).length).toBe(0);
      expect(body.source).toBe('default');
      // AC-3: holdout_group must NOT be present when skipped
      expect(body.holdout_group).toBeUndefined();
    });

    // ─── AC-2 / AC-3 / AC-5 RETIRED — their subject no longer exists ──────────────
    //
    // All three asserted `publishAbAssignmentEvent` was (or was not) called. That publisher is gone:
    // ADR-0022 (Accepted 2026-08-15), FOLLOW-988 stage B. It had emitted nothing since ADR-0016 —
    // the event-bus URL was `""` in every env block, so it returned on its first line — so these
    // three were asserting a call into a function that discarded its argument.
    //
    // NO BEHAVIOURAL COVERAGE IS LOST, and that was checked rather than assumed: each had a
    // response-level sibling in this same file asserting the identical fact, and those remain.
    //
    //   AC-2 (holdout emitted)      -> AC-1 asserts `body.holdout_group === true`, directives empty
    //   AC-3 (not emitted when opted out) -> the opted-out case asserts the same 200/empty/default shape
    //   AC-5 (treatment emitted)    -> AC-4 asserts `body.holdout_group` undefined, directives non-empty
    //
    // The one fact that had NO response-level sibling — `holdout_pct` reaching a sink — is now
    // covered in `route.clickhouse.test.ts`, which asserts it on the `adaptation_decisions` INSERT
    // (FOLLOW-988 step 5). Retired here rather than deleted silently, so the trade is on the record.

    it('AC-4: holdout_pct=0.0 + consent granted → treatment arm, directives non-empty', async () => {
      const res = await POST(
        makePostRequest({
          ...BASE_BODY,
          holdout_pct: 0.0,
          consent_state: 'granted',
          consent_mode_enabled: false,
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      // Treatment arm: directives should be present (either text or reorder)
      expect(Array.isArray(body.directives)).toBe(true);
      // source is not 'default' because confidence=0.8 > 0.6 threshold
      expect(body.source).not.toBe('default');
      // holdout_group should be false (not absent — treatment arm)
      expect(body.holdout_group).toBeUndefined();
    });

    it('consent_state=unknown + consent_mode_enabled → consent skipped', async () => {
      const res = await POST(
        makePostRequest({
          ...BASE_BODY,
          consent_state: 'unknown',
          consent_mode_enabled: true,
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect((body.directives as unknown[]).length).toBe(0);
      expect(body.holdout_group).toBeUndefined();
    });

    // FOLLOW-369 (ported from the retired GET handler's suite by FOLLOW-1287): the third skip
    // state, and the "no bandit on a skipped session" half of that ticket, on the only method left.
    it('consent_state=none + consent_mode_enabled → consent skipped (FOLLOW-369)', async () => {
      const res = await POST(
        makePostRequest({
          ...BASE_BODY,
          consent_state: 'none',
          consent_mode_enabled: true,
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect((body.directives as unknown[]).length).toBe(0);
      expect(body.source).toBe('default');
      expect(body.holdout_group).toBeUndefined();
    });

    it('consent skip → the bandit is never consulted, even with BANDIT_ENABLED=true (FOLLOW-369)', async () => {
      vi.stubEnv('BANDIT_ENABLED', 'true');
      await POST(
        makePostRequest({
          ...BASE_BODY,
          consent_state: 'opted_out',
          consent_mode_enabled: true,
        }),
      );
      // `thompsonSample` is gated by the same `banditLive` as this read, so no read ⇒ no draw.
      expect(getBanditArms).not.toHaveBeenCalled();

      // Positive control: the same request with consent granted DOES consult it.
      await POST(makePostRequest({ ...BASE_BODY, consent_state: 'granted' }));
      expect(getBanditArms).toHaveBeenCalled();
    });

    it('consent_mode_enabled=false → consent state ignored, assignment proceeds', async () => {
      const res = await POST(
        makePostRequest({
          ...BASE_BODY,
          holdout_pct: 0.0,
          consent_state: 'opted_out',
          consent_mode_enabled: false,
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      // With holdout_pct=0.0 and consent_mode_enabled=false, treatment arm runs
      expect(body.source).not.toBe('default');
    });

    it('missing consent fields → defaults to no consent gating (treatment proceeds)', async () => {
      const res = await POST(
        makePostRequest({
          ...BASE_BODY,
          holdout_pct: 0.0,
          // No consent_state, no consent_mode_enabled
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      // With holdout_pct=0.0, treatment arm runs
      expect(body.source).not.toBe('default');
    });
  });

  __H.active = null;
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Origin: route.follow633.test.ts
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('route.follow633.test.ts — FOLLOW-633 tests: per-tenant Adaptive Listings ON/OFF enforcement in the adapt', () => {
  /**
   * FOLLOW-633 tests: per-tenant Adaptive Listings ON/OFF enforcement in the adapt
   * path (GET + POST), the single shared point (resolveAlEnablement).
   *
   * Proves all four directions at the ROUTE level (the helper's own real-row
   * directions are covered in src/lib/al-enablement.test.ts):
   *   - OFF (al_enabled=false) → 200 neutral pass-through, NO adaptation, NO bandit,
   *     NO ClickHouse row, provenance `adaptive_listings_off`/`al_off_reason` present.
   *   - OFF via status suspended / canceled → same neutral pass-through.
   *   - ON (al_enabled=true + status active) → normal adaptation, directives present.
   *   - Enforced at the shared helper. FOLLOW-1287 retired GET /api/adapt, whose four cases here
   *     duplicated the POST ones below; the one GET-only assertion (no ClickHouse row on the OFF
   *     path) was folded into the POST OFF case.
   *
   * @module apps/control-plane/src/app/api/adapt/route.follow633.test
   */

  const { mockResolveAlEnablement } = (() => ({
    mockResolveAlEnablement: vi.fn(),
  }))();
  const __reg = new Map<string, Record<string, unknown>>();
  __reg.set(
    '@/lib/al-enablement',
    (() => ({
      resolveAlEnablement: mockResolveAlEnablement,
    }))(),
  );
  __reg.set(
    '@/lib/demo-jwt-verify',
    (() => ({
      verifyDemoJwt: vi.fn().mockResolvedValue({ tenant_id: 'tenant-633' }),
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
    '@/lib/demo-override-store',
    (() => ({
      getDemoOverride: vi.fn().mockResolvedValue({
        enabled: false,
        overrideArchetype: null,
        overrideModel: 'claude-sonnet-4-6',
      }),
      DEMO_OVERRIDE_CONFIDENCE: 0.9,
      DEMO_OVERRIDE_SIMILARITY: 0.75,
    }))(),
  );
  __reg.set(
    '@/lib/tenant-schema',
    (() => ({
      getTenantSchema: vi.fn().mockResolvedValue(null),
    }))(),
  );
  __reg.set(
    '@estalara/sdk/playbooks',
    (() => ({
      getPlaybook: vi.fn(() => ({
        slots: [
          { slot: 'headline', en: 'Control headline' },
          { slot: 'cta', en: 'View Details' },
        ],
      })),
    }))(),
  );
  __reg.set(
    '@/lib/bandit-query',
    (() => ({
      SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
      getBanditArms: vi.fn().mockResolvedValue([
        { variant: 'control', alpha: 1, beta: 1, paused: false },
        { variant: 'v1', alpha: 1, beta: 1, paused: false },
        { variant: 'v2', alpha: 1, beta: 1, paused: false },
      ]),
    }))(),
  );
  __reg.set(
    '@estalara/shared',
    (() => {
      const mod = __H.real('@estalara/shared');
      return {
        ...mod,
        assignHoldout: vi.fn().mockResolvedValue({
          holdout_group: false,
          skipped: false,
          assigned_at: new Date().toISOString(),
        }),
        thompsonSample: vi.fn().mockReturnValue('control'),
      };
    })(),
  );
  __H.active = __reg;
  beforeAll(() => {
    __H.active = __reg;
  });
  afterAll(() => {
    __H.active = null;
  });

  // ── Mocks (hoisted before route import) ────────────────────────────────────

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  /** Records whether a ClickHouse INSERT fetch fired. */
  function captureFetch(): { called: () => boolean } {
    let called = false;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        called = true;
        return Promise.resolve(new Response('', { status: 200 }));
      }),
    );
    return { called: () => called };
  }

  function makePostRequest(body: Record<string, unknown>): NextRequest {
    return new NextRequest(new URL('http://localhost/api/adapt'), {
      method: 'POST',
      headers: { Authorization: 'Bearer test_key', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  const POST_BODY = {
    tenant_id: 'tenant-633',
    session_id: 'sess-633-post',
    page_type: 'listing_detail' as const,
    archetype_hint: 'yield_hunter',
    confidence: 0.8,
    similarity: 0.9,
  };

  interface AdaptBody {
    archetype: string;
    directives: unknown[];
    source: string;
    adaptive_listings_off?: boolean;
    al_off_reason?: string | null;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123/');
    vi.stubEnv('DEMO_MODE_JWT_SECRET', 'test-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  // FOLLOW-1286 (D3): this file pins the pre-freeze bandit behaviour, which now runs only with
  // BANDIT_ENABLED=true. The frozen default (flag off) is pinned by `lib/__tests__/bandit-flag.test.ts`,
  // `api/adapt/route.bandit-freeze.test.ts` and each frozen route's own `BANDIT_ENABLED off` block.
  beforeEach(() => {
    vi.stubEnv('BANDIT_ENABLED', 'true');
  });

  // ─── POST enforcement ───────────────────────────────────────────────────────

  describe('POST /api/adapt — FOLLOW-633 AL on/off enforcement', () => {
    it('OFF (al_disabled) → 200 neutral, no adaptation, no bandit, no ClickHouse row, provenance present', async () => {
      mockResolveAlEnablement.mockResolvedValue({ off: true, reason: 'al_disabled' });
      const capture = captureFetch();

      const res = await POST(makePostRequest(POST_BODY));
      expect(res.status).toBe(200);
      const body = (await res.json()) as AdaptBody;

      expect(body.directives).toHaveLength(0);
      expect(body.source).toBe('default');
      expect(body.archetype).toBe('neutral');
      expect(body.adaptive_listings_off).toBe(true);
      expect(body.al_off_reason).toBe('al_disabled');
      expect(getBanditArms).not.toHaveBeenCalled();
      // No ClickHouse decision row on the OFF path (formerly asserted on the retired GET handler).
      await new Promise((r) => setTimeout(r, 0));
      expect(capture.called()).toBe(false);
    });

    it('OFF (status_suspended) → 200 neutral pass-through', async () => {
      mockResolveAlEnablement.mockResolvedValue({ off: true, reason: 'status_suspended' });
      captureFetch();
      const res = await POST(makePostRequest(POST_BODY));
      const body = (await res.json()) as AdaptBody;
      expect(res.status).toBe(200);
      expect(body.directives).toHaveLength(0);
      expect(body.al_off_reason).toBe('status_suspended');
    });

    it('OFF (status_canceled) → 200 neutral pass-through', async () => {
      mockResolveAlEnablement.mockResolvedValue({ off: true, reason: 'status_canceled' });
      captureFetch();
      const res = await POST(makePostRequest(POST_BODY));
      const body = (await res.json()) as AdaptBody;
      expect(res.status).toBe(200);
      expect(body.directives).toHaveLength(0);
      expect(body.al_off_reason).toBe('status_canceled');
    });

    it('ON (al_enabled=true, active) → normal adaptation, directives present, bandit runs', async () => {
      mockResolveAlEnablement.mockResolvedValue({ off: false, reason: null });
      captureFetch();

      const res = await POST(makePostRequest(POST_BODY));
      expect(res.status).toBe(200);
      const body = (await res.json()) as AdaptBody;

      expect(body.source).toBe('playbook');
      expect(body.directives.length).toBeGreaterThan(0);
      expect(body.adaptive_listings_off).toBeUndefined();
      expect(getBanditArms).toHaveBeenCalled();
    });
  });

  __H.active = null;
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Origin: route.pilot-frozen.test.ts
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('route.pilot-frozen.test.ts — Tests for the pilot_frozen Lane C guard in /api/adapt.', () => {
  /**
   * Tests for the pilot_frozen Lane C guard in /api/adapt.
   *
   * FOLLOW-265 (2026-06-11): AC5 contract-pinning tests added — ratifies quiz-only
   * contract (RETRO-051). The guard checks ONLY `tenants.quiz_enabled` (typed boolean
   * column). The three previously-documented JSONB keys (lane_c_active,
   * intent_engine_enabled, shadow_mode_override) are outside the runtime backstop by
   * design; no live producers existed for any of them. See PILOT_FREEZE_RULE.md
   * §Implementation for the forward-compat contract for new Lane C axes.
   *
   * FOLLOW-263 / RETRO-049: guard repointed from JSONB `quizConfig.enabled` to the
   * typed boolean column `tenants.quiz_enabled` (SoT per FOLLOW-102 / migration 0025).
   *
   * Original guard introduced by RETRO-012 / FOLLOW-117.
   *
   * The guard is non-blocking (fire-and-forget, per PILOT_FREEZE_RULE.md §Decision 3).
   * It emits a console.warn when pilot_frozen=true AND quiz_enabled=true. We assert
   * on the warn call to confirm the guard triggered.
   *
   * AC1: guard reads tenants.quiz_enabled (typed column), NOT quizConfig JSONB.
   * AC2: fires correctly for quiz_enabled=true AND quiz_enabled=false.
   * AC3: quiz_enabled changes during freeze window → guard reflects new state.
   * AC4: pilotFrozen=true + quiz_enabled=false → guard does NOT fire.
   * AC5 (FOLLOW-265): quiz-only contract pinned — non-quiz flags do NOT trigger guard.
   *
   * @module apps/control-plane/src/app/api/adapt/route.pilot-frozen.test
   */

  const __reg = new Map<string, Record<string, unknown>>();
  // Bypass JWT verification — these tests focus on pilot-frozen guard, not auth.
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
    '@estalara/sdk/playbooks',
    (() => ({
      getPlaybook: vi.fn(() => ({
        slots: [
          { slot: 'headline', en: 'High-yield investment property' },
          { slot: 'cta', en: 'View ROI Analysis' },
        ],
      })),
    }))(),
  );
  // FOLLOW-397: include SEED_VARIANTS so VARIANT_INDEX is derived correctly at module load.
  __reg.set(
    '@/lib/bandit-query',
    (() => ({
      SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
      getBanditArms: vi.fn().mockResolvedValue([
        { variant: 'control', alpha: 1, beta: 1, paused: false },
        { variant: 'v1', alpha: 1, beta: 1, paused: false },
        { variant: 'v2', alpha: 1, beta: 1, paused: false },
      ]),
    }))(),
  );
  __reg.set(
    '@/lib/tenant-schema',
    (() => ({
      getTenantSchema: vi.fn().mockResolvedValue(null),
    }))(),
  );
  __reg.set(
    '@/lib/embedding-lookup',
    (() => ({
      fetchListingEmbeddings: vi.fn().mockResolvedValue(new Map()),
      fetchArchetypeEmbedding: vi.fn().mockResolvedValue(null),
      LISTING_EMBEDDING_BATCH_LIMIT: 50,
    }))(),
  );
  __reg.set(
    '@estalara/db',
    (() => ({
      createAdminClient: vi.fn(() => ({
        select: mockDbSelect,
      })),
      tenants: {
        id: 'id',
        pilotFrozen: 'pilot_frozen',
        // FOLLOW-263: expose quizEnabled (typed boolean SoT), not quizConfig (JSONB legacy).
        quizEnabled: 'quiz_enabled',
      },
    }))(),
  );
  __reg.set(
    'drizzle-orm',
    (() => ({
      eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
    }))(),
  );
  __H.active = __reg;
  beforeAll(() => {
    __H.active = __reg;
  });
  afterAll(() => {
    __H.active = null;
  });

  // ── Mock all external deps ─────────────────────────────────────────────────────

  // ── DB mock — must be declared before import of route ─────────────────────────
  //
  // FOLLOW-263 (AC1): the DB mock now exposes `quizEnabled` (the typed boolean
  // column) rather than `quizConfig` (the JSONB column). This proves the guard reads
  // the typed column — if the route still selected `quizConfig`, the mock would
  // return undefined for it and the guard would silently fail to fire.

  const mockDbSelect = vi.fn();

  // ── Helpers ────────────────────────────────────────────────────────────────────

  function makePostRequest(body: Record<string, unknown>): NextRequest {
    return new NextRequest('http://localhost/api/adapt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test_token',
      },
      body: JSON.stringify(body),
    });
  }

  const FROZEN_PILOT_TENANT_ID = 'tenant-frozen-pilot-001';

  const VALID_POST_BODY = {
    tenant_id: FROZEN_PILOT_TENANT_ID,
    session_id: 'sess-frozen-001',
    page_type: 'listing_list' as const,
    archetype_hint: 'yield_hunter',
    confidence: 0.8,
    similarity: 0.9,
  };

  // ── DB mock factory ────────────────────────────────────────────────────────────

  /**
   * Configure the DB mock to return a tenant row with the given pilotFrozen flag
   * and quizEnabled boolean.
   *
   * FOLLOW-263 (AC1): mock uses `quizEnabled` (typed boolean), not `quizConfig`
   * (JSONB). The guard must select quizEnabled from the DB — if it still selected
   * quizConfig, this mock would return undefined and the guard would be silent.
   */
  function setupDbMock(pilotFrozen: boolean, quizEnabled: boolean): void {
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ pilotFrozen, quizEnabled }]),
        }),
      }),
    });
  }

  // ── Tests ──────────────────────────────────────────────────────────────────────

  describe('pilot_frozen Lane C guard — RETRO-012/FOLLOW-117 / FOLLOW-263 repoint / FOLLOW-265 quiz-only ratified', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.clearAllMocks();
      // Suppress CLICKHOUSE_URL so logDecisionAsync is a no-op in these tests
      vi.stubEnv('CLICKHOUSE_URL', '');
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      warnSpy.mockRestore();
    });

    // ── AC1 + AC2: guard reads typed column, fires when quiz_enabled=true ────────

    it('AC1/AC2: pilot_frozen=true + quiz_enabled=true → guard emits warn (typed column read)', async () => {
      // FOLLOW-263 (AC1): the mock exposes quizEnabled=true. If the route still
      // selected quizConfig (JSONB), it would get undefined and the guard would be
      // silent — this test would fail, proving the column was not repointed.
      setupDbMock(true, true);

      const res = await POST(makePostRequest(VALID_POST_BODY));

      // The guard is fire-and-forget — response must still be 200 (non-blocking)
      expect(res.status).toBe(200);

      // Allow the fire-and-forget async work to settle
      await new Promise((resolve) => setImmediate(resolve));

      // Assert the warn fired with the correct event name
      const warnCalls = warnSpy.mock.calls;
      const matchingCall = warnCalls.find((args) => {
        const msg = typeof args[0] === 'string' ? args[0] : JSON.stringify(args[0]);
        return msg.includes('pilot_frozen_lane_c_active');
      });
      expect(matchingCall).toBeDefined();

      // FOLLOW-263: the logged message must include quiz_enabled:true (the typed
      // column value), NOT the old active_lane_c_flags JSONB-key array format.
      const loggedMsg = matchingCall![0] as string;
      const parsed = JSON.parse(loggedMsg) as {
        quiz_enabled?: boolean;
        active_lane_c_flags?: string[];
      };
      expect(parsed.quiz_enabled).toBe(true);
      // Ensure the old JSONB-key array format is NOT present (guard was repointed)
      expect(parsed.active_lane_c_flags).toBeUndefined();
    });

    // ── AC2 + AC4: guard does NOT fire when quiz_enabled=false ──────────────────

    it('AC2/AC4: pilot_frozen=true + quiz_enabled=false → guard does NOT emit warn (quiz already off)', async () => {
      // AC4 acceptance: pilotFrozen=true + quiz_enabled=false should not trigger warn.
      // Quiz is already off — no Lane C contamination risk.
      setupDbMock(true, false);

      await POST(makePostRequest(VALID_POST_BODY));
      await new Promise((resolve) => setImmediate(resolve));

      const warnCalls = warnSpy.mock.calls;
      const matchingCall = warnCalls.find((args) => {
        const msg = typeof args[0] === 'string' ? args[0] : '';
        return msg.includes('pilot_frozen_lane_c_active');
      });
      expect(matchingCall).toBeUndefined();
    });

    // ── pilot not frozen → guard never fires ────────────────────────────────────

    it('pilot_frozen=false + quiz_enabled=true → guard does NOT emit warn', async () => {
      // Pilot NOT frozen — guard should never fire regardless of quiz state.
      setupDbMock(false, true);

      await POST(makePostRequest(VALID_POST_BODY));
      await new Promise((resolve) => setImmediate(resolve));

      const warnCalls = warnSpy.mock.calls;
      const matchingCall = warnCalls.find((args) => {
        const msg = typeof args[0] === 'string' ? args[0] : '';
        return msg.includes('pilot_frozen_lane_c_active');
      });
      expect(matchingCall).toBeUndefined();
    });

    // ── AC3: quiz_enabled changes during freeze window ──────────────────────────

    it('AC3: quiz_enabled changes from false→true during freeze window → guard fires on next read', async () => {
      // First call: quiz_enabled=false — guard should NOT fire.
      setupDbMock(true, false);

      await POST(makePostRequest(VALID_POST_BODY));
      await new Promise((resolve) => setImmediate(resolve));

      const warnCallsBefore = warnSpy.mock.calls.filter((args) => {
        const msg = typeof args[0] === 'string' ? args[0] : '';
        return msg.includes('pilot_frozen_lane_c_active');
      });
      expect(warnCallsBefore).toHaveLength(0);

      // Simulate quiz_enabled changing to true during the freeze window
      // (e.g. a PATCH /api/tenants/:id was called and flipped the column).
      // Reset mock to return quiz_enabled=true.
      vi.clearAllMocks();
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      setupDbMock(true, true);

      await POST(makePostRequest({ ...VALID_POST_BODY, session_id: 'sess-frozen-002' }));
      await new Promise((resolve) => setImmediate(resolve));

      // Guard MUST fire now that quiz_enabled is true
      const warnCallsAfter = warnSpy.mock.calls.filter((args) => {
        const msg = typeof args[0] === 'string' ? args[0] : '';
        return msg.includes('pilot_frozen_lane_c_active');
      });
      expect(warnCallsAfter).toHaveLength(1);

      const parsed = JSON.parse(warnCallsAfter[0]![0] as string) as { quiz_enabled?: boolean };
      expect(parsed.quiz_enabled).toBe(true);
    });

    it('AC3: quiz_enabled changes from true→false during freeze window → guard stops firing', async () => {
      // First call: quiz_enabled=true — guard fires.
      setupDbMock(true, true);

      await POST(makePostRequest(VALID_POST_BODY));
      await new Promise((resolve) => setImmediate(resolve));

      const warnCallsBefore = warnSpy.mock.calls.filter((args) => {
        const msg = typeof args[0] === 'string' ? args[0] : '';
        return msg.includes('pilot_frozen_lane_c_active');
      });
      expect(warnCallsBefore).toHaveLength(1);

      // Simulate quiz being disabled (tenant toggled quiz OFF via dashboard).
      vi.clearAllMocks();
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      setupDbMock(true, false);

      await POST(makePostRequest({ ...VALID_POST_BODY, session_id: 'sess-frozen-003' }));
      await new Promise((resolve) => setImmediate(resolve));

      // Guard must NOT fire — quiz is now off, no contamination risk.
      const warnCallsAfter = warnSpy.mock.calls.filter((args) => {
        const msg = typeof args[0] === 'string' ? args[0] : '';
        return msg.includes('pilot_frozen_lane_c_active');
      });
      expect(warnCallsAfter).toHaveLength(0);
    });

    // ── Non-blocking response guarantee ─────────────────────────────────────────

    it('guard never blocks the response — always returns 200 even when warn fires', async () => {
      setupDbMock(true, true);

      const res = await POST(makePostRequest(VALID_POST_BODY));
      // Non-blocking: HTTP response must be 200 regardless
      expect(res.status).toBe(200);
    });

    // ── Guard is silent for unknown tenant ──────────────────────────────────────

    it('pilot_frozen=true + quizEnabled missing (DB returns undefined) → guard does NOT emit warn', async () => {
      // Simulates a row where quiz_enabled column is null/undefined (e.g. old row
      // before migration 0025 backfill ran). Guard should treat undefined as false — safe.
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ pilotFrozen: true, quizEnabled: undefined }]),
          }),
        }),
      });

      await POST(makePostRequest(VALID_POST_BODY));
      await new Promise((resolve) => setImmediate(resolve));

      const warnCalls = warnSpy.mock.calls;
      const matchingCall = warnCalls.find((args) => {
        const msg = typeof args[0] === 'string' ? args[0] : '';
        return msg.includes('pilot_frozen_lane_c_active');
      });
      expect(matchingCall).toBeUndefined();
    });

    // ── AC5 (FOLLOW-265): contract-pinning — quiz-only ratified ──────────────────
    //
    // INTENTIONAL — FOLLOW-265 (ratified 2026-06-11):
    // The freeze guard checks ONLY `tenants.quiz_enabled`. The three previously-
    // documented JSONB-key flags (`lane_c_active`, `intent_engine_enabled`,
    // `shadow_mode_override`) were dropped from the runtime backstop because they
    // never had live producers. This test pins that contract: even if the DB row
    // carries a JSONB key that looks like a Lane C flag, the guard does NOT fire
    // solely because of that key — it only fires when `quizEnabled=true`.
    //
    // New Lane C axes MUST add a typed `tenants.*_enabled` column + migration and
    // wire it into checkPilotFrozenAsync() — NOT into quizConfig JSONB. See
    // docs/ops/PILOT_FREEZE_RULE.md §Implementation for the forward-compat contract.

    it('AC5 (FOLLOW-265 quiz-only contract): DB row with only quizEnabled=false does NOT trigger guard even if JSONB quizConfig.enabled=true were present', async () => {
      // This test verifies the quiz-only contract: the guard reads only the typed
      // `quizEnabled` boolean column, not any JSONB blob key. A hypothetical legacy
      // row that might have quizConfig.enabled=true in the JSONB but quizEnabled=false
      // in the typed column must NOT fire the guard.
      //
      // The mock returns pilotFrozen=true with quizEnabled=false. The guard must stay
      // silent — it does not inspect any JSONB blob for additional Lane C flags.
      // Intentional — FOLLOW-265 / RETRO-051.
      setupDbMock(true, false);

      await POST(makePostRequest(VALID_POST_BODY));
      await new Promise((resolve) => setImmediate(resolve));

      const warnCalls = warnSpy.mock.calls;
      const matchingCall = warnCalls.find((args) => {
        const msg = typeof args[0] === 'string' ? args[0] : '';
        return msg.includes('pilot_frozen_lane_c_active');
      });
      // Guard must NOT fire: the ONLY trigger is quizEnabled=true on the typed column.
      // Other Lane C axes (lane_c_active, intent_engine_enabled, shadow_mode_override)
      // are outside the runtime backstop by design — FOLLOW-265.
      expect(matchingCall).toBeUndefined();
    });

    it('AC5 (FOLLOW-265 quiz-only contract): guard log payload does NOT contain active_lane_c_flags (old JSONB array format has been retired)', async () => {
      // This test pins the log payload contract. After FOLLOW-263/FOLLOW-265, the
      // warn log must use `quiz_enabled: boolean`, NOT `active_lane_c_flags: string[]`.
      // The old format is permanently retired. Intentional — FOLLOW-265 / RETRO-051.
      setupDbMock(true, true);

      await POST(makePostRequest(VALID_POST_BODY));
      await new Promise((resolve) => setImmediate(resolve));

      const warnCalls = warnSpy.mock.calls;
      const matchingCall = warnCalls.find((args) => {
        const msg = typeof args[0] === 'string' ? args[0] : '';
        return msg.includes('pilot_frozen_lane_c_active');
      });
      expect(matchingCall).toBeDefined();

      const loggedMsg = matchingCall![0] as string;
      const parsed = JSON.parse(loggedMsg) as {
        quiz_enabled?: boolean;
        active_lane_c_flags?: string[];
      };
      // Must use new field
      expect(parsed.quiz_enabled).toBe(true);
      // Must NOT use old retired field
      expect(parsed.active_lane_c_flags).toBeUndefined();
    });
  });

  __H.active = null;
});
