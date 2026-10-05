/**
 * `POST /api/adapt` — stage: A/B HOLDOUT.
 *
 * The holdout gate: the server-side arm assignment (`assignHoldout`, keyed on
 * `HOLDOUT_ASSIGNMENT_SECRET`), the configured rate and its ops-only override, what a held-out
 * session is served (nothing) and logged (the would-be archetype, variant `control`), and that
 * no caller-supplied field can choose the arm.
 *
 * FOLLOW-1287 merged the per-ticket suites below into this one file, one `describe` per original
 * file, every test kept verbatim (see the registry note under the imports for how their differing
 * mocks coexist).
 *
 * @module apps/control-plane/src/app/api/adapt/route.holdout.test
 */
import { describe, expect, it, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { getBanditArms } from '@/lib/bandit-query';
import { assignHoldout } from '@estalara/shared';
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
vi.mock('@estalara/shared', async (importOriginal) =>
  __H.proxy('@estalara/shared', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/demo-override-store', async (importOriginal) =>
  __H.proxy('@/lib/demo-override-store', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/adapt-get-auth', async (importOriginal) =>
  __H.proxy('@/lib/adapt-get-auth', await importOriginal<Record<string, unknown>>()),
);

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Origin: route.holdout.test.ts
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('route.holdout.test.ts — Smoke tests for holdout_group wiring into ClickHouse adaptation_decisions INSERT.', () => {
  /**
   * Smoke tests for holdout_group wiring into ClickHouse adaptation_decisions INSERT.
   * TICKET-AB-007
   *
   * These tests verify that every adaptation_decisions INSERT includes the holdout_group
   * field derived from the assignHoldout() result, so that analytics panels
   * (Adapted vs Holdout impressions, Conversion lift vs holdout) read correct data.
   *
   * Approach: stub CLICKHOUSE_URL env var, mock global.fetch to capture the INSERT
   * query body, and assert holdout_group is present with the expected value.
   *
   * @module apps/control-plane/src/app/api/adapt/route.holdout.test
   */

  const __reg = new Map<string, Record<string, unknown>>();
  // Bypass JWT verification — these tests focus on holdout wiring, not auth.
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

  // Mock dependencies — including workspace packages not built in test env

  // ─── Helpers ───────────────────────────────────────────────────────────────────

  /** Captures the body and URL of the most recent `adaptation_decisions` ClickHouse INSERT. */
  function captureFetchBody(): { getLastBody: () => string | null; getLastUrl: () => URL | null } {
    let lastBody: string | null = null;
    let lastUrl: URL | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: unknown, opts?: { body?: string }) => {
        // FOLLOW-1061: the route now writes TWO ClickHouse rows per treatment request —
        // the `adaptation_decisions` row and the `llm_calls` pre-LLM segment row. This
        // capture names the one this suite is about instead of trusting call order.
        if (!(opts?.body ?? '').includes('INSERT INTO adaptation_decisions')) {
          return Promise.resolve(new Response('', { status: 200 }));
        }
        lastBody = opts?.body ?? null;
        try {
          lastUrl = typeof url === 'string' ? new URL(url) : null;
        } catch {
          lastUrl = null;
        }
        return Promise.resolve(new Response('', { status: 200 }));
      }),
    );
    return {
      getLastBody: () => lastBody,
      getLastUrl: () => lastUrl,
    };
  }

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

  // FOLLOW-1201 / FOLLOW-1102: a body `holdout_pct` is honoured ONLY for the ADAPT_API_KEY caller.
  // The POST suite below forces arms with that knob, so it authenticates as ops. Built with
  // `.repeat()` so no token-shaped literal lands in the repo.
  const OPS_KEY = 'ops-key-'.repeat(6);

  function makeOpsPostRequest(body: Record<string, unknown>): NextRequest {
    return new NextRequest('http://localhost/api/adapt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPS_KEY}`,
      },
      body: JSON.stringify(body),
    });
  }

  const VALID_POST_BODY = {
    tenant_id: 'est_demo_tenant',
    session_id: 'sess-holdout-post-001',
    page_type: 'listing_list' as const,
    archetype_hint: 'yield_hunter',
    confidence: 0.8,
    similarity: 0.9,
  };

  // ─── Smoke tests — POST /api/adapt ────────────────────────────────────────────

  describe('POST /api/adapt — holdout_group wired into ClickHouse INSERT (TICKET-AB-007)', () => {
    // TICKET-AB-010 update: holdout_group is now computed server-side by assignHoldout().
    // The ClickHouse INSERT only fires for treatment-arm sessions (holdout_pct=0.0 → guaranteed
    // treatment). Holdout and skipped sessions return early without a ClickHouse INSERT.
    beforeEach(() => {
      vi.clearAllMocks();
      vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123/');
      // FOLLOW-1201: the body `holdout_pct` these tests drive the arm with is ops-only now.
      vi.stubEnv('ADAPT_API_KEY', OPS_KEY);
      vi.stubEnv('OPS_TENANT_ID', VALID_POST_BODY.tenant_id);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it('smoke: treatment arm (holdout_pct=0.0) → INSERT includes holdout_group=0 (FOLLOW-261: URL param)', async () => {
      const capture = captureFetchBody();

      // holdout_pct=0.0 → 100% treatment, consent_mode_enabled=false → no skip
      const res = await POST(
        makeOpsPostRequest({ ...VALID_POST_BODY, holdout_pct: 0.0, consent_mode_enabled: false }),
      );

      expect(res.status).toBe(200);
      const body = capture.getLastBody();
      expect(body).not.toBeNull();
      expect(body).toContain('holdout_group');
      // FOLLOW-261: treatment arm → URL param '0'
      const url = capture.getLastUrl();
      expect(url).not.toBeNull();
      expect(url!.searchParams.get('param_p_holdout_group')).toBe('0');
    });

    it('smoke: holdout arm (holdout_pct=1.0) → returns early with empty directives AND still logs to ClickHouse (FOLLOW-442)', async () => {
      const capture = captureFetchBody();

      // holdout_pct=1.0 → 100% holdout → route returns early with empty directives,
      // but (FOLLOW-442) MUST still call logDecisionAsync so the lift query's holdout
      // denominator is non-zero.
      const res = await POST(
        makeOpsPostRequest({ ...VALID_POST_BODY, holdout_pct: 1.0, consent_mode_enabled: false }),
      );

      expect(res.status).toBe(200);
      const resBody = (await res.json()) as Record<string, unknown>;
      // Response body to the held-out caller is UNCHANGED (locked-in product
      // behavior, FOLLOW-452): still 'neutral' with empty directives.
      expect(resBody.holdout_group).toBe(true);
      expect(resBody.archetype).toBe('neutral');
      expect(Array.isArray(resBody.directives)).toBe(true);
      expect((resBody.directives as unknown[]).length).toBe(0);

      // FOLLOW-442 / FOLLOW-988 stage B: the ab.assignment publish this comment used to
      // describe is gone (ADR-0022) — the ONLY fetch call on this path is the ClickHouse
      // INSERT from logDecisionAsync. Assert it fired
      // with holdout_group=1 (i.e. holdoutGroup=true) and the expected feature values.
      const fetchBody = capture.getLastBody() ?? '';
      expect(fetchBody).toMatch(/INSERT INTO adaptation_decisions/);
      expect(fetchBody).toContain('holdout_group');
      const url = capture.getLastUrl();
      expect(url).not.toBeNull();
      expect(url!.searchParams.get('param_p_holdout_group')).toBe('1');
      // variant='control' — bandit not consulted on the holdout path.
      expect(url!.searchParams.get('param_p_variant')).toBe('control');
      // FOLLOW-452 (audit F-08): the LOGGED row carries the WOULD-BE archetype/
      // confidence (VALID_POST_BODY.archetype_hint/confidence) — NOT the hardcoded
      // 'neutral'/0.5 that the RESPONSE body above still uses. This is the core
      // fix: without it, the per-archetype lift query's holdout arm was starved
      // for every real archetype.
      expect(url!.searchParams.get('param_p_archetype')).toBe(VALID_POST_BODY.archetype_hint);
      expect(url!.searchParams.get('param_p_confidence')).toBe(String(VALID_POST_BODY.confidence));
    });

    it('smoke: consent skipped → no ClickHouse INSERT (no holdout_group field)', async () => {
      const capture = captureFetchBody();

      const res = await POST(
        makeOpsPostRequest({
          ...VALID_POST_BODY,
          consent_state: 'opted_out',
          consent_mode_enabled: true,
        }),
      );

      expect(res.status).toBe(200);
      const resBody = (await res.json()) as Record<string, unknown>;
      expect(resBody.holdout_group).toBeUndefined();
      const fetchBody = capture.getLastBody() ?? '';
      expect(fetchBody).not.toMatch(/INSERT INTO adaptation_decisions/);
    });

    it('INSERT query contains the exact holdout_group field name (treatment arm)', async () => {
      const capture = captureFetchBody();

      await POST(
        makeOpsPostRequest({ ...VALID_POST_BODY, holdout_pct: 0.0, consent_mode_enabled: false }),
      );

      const body = capture.getLastBody() ?? '';
      // Column list
      expect(body).toContain('holdout_group');
      // The INSERT format is: INSERT INTO adaptation_decisions (col1, ..., holdout_group, ts)
      expect(body).toMatch(/INSERT INTO adaptation_decisions/);
      expect(body).toMatch(/holdout_group/);
    });

    it('INSERT carries Conversion Label Loop fields (FOLLOW-170): model_version + features_snapshot + lead_id', async () => {
      const capture = captureFetchBody();

      await POST(
        makeOpsPostRequest({ ...VALID_POST_BODY, holdout_pct: 0.0, consent_mode_enabled: false }),
      );

      const body = capture.getLastBody() ?? '';
      // Column names still present in the INSERT column list (query body).
      expect(body).toContain('model_version');
      expect(body).toContain('features_snapshot');
      expect(body).toContain('lead_id');

      // FOLLOW-261: values are now URL params, not interpolated into query body.
      const url = capture.getLastUrl();
      expect(url).not.toBeNull();
      // model_version scorer stamp is in the URL param.
      expect(url!.searchParams.get('param_p_model_version')).toBe('rulebased-bandit-v1');
      // features_snapshot is a PII-free JSON blob — parse it from the URL param.
      const snapshot = url!.searchParams.get('param_p_features_snapshot') ?? '';
      const parsed = JSON.parse(snapshot) as Record<string, unknown>;
      expect(parsed).toHaveProperty('archetype');
      expect(parsed).toHaveProperty('confidence');
      // PII check: session/lead IDs must NOT be in the snapshot.
      expect(snapshot).not.toMatch(/"session_id":/);
    });
  });

  // ─── No CLICKHOUSE_URL — fire-and-forget skips gracefully ─────────────────────

  describe('adapt route — no CLICKHOUSE_URL configured (fire-and-forget no-op)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.stubEnv('CLICKHOUSE_URL', '');
      vi.stubEnv('ADAPT_API_KEY', '');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it('POST returns 200 without throwing when CLICKHOUSE_URL is not set', async () => {
      const res = await POST(makePostRequest({ ...VALID_POST_BODY, holdout_group: true }));
      expect(res.status).toBe(200);
    });
  });

  __H.active = null;
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Origin: route.follow360.test.ts
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('route.follow360.test.ts — FOLLOW-360 / ESC-026 regression tests: the bandit gate for holdout sessions.', () => {
  /**
   * FOLLOW-360 / ESC-026 regression tests: the bandit gate for holdout sessions.
   *
   * Regression: before FOLLOW-360, the (since retired) GET handler sampled a bandit variant for
   * ALL requests including holdout ones, logging (holdout_group=1, variant=v1/v2) to ClickHouse.
   * That contaminated the holdout counterfactual baseline, which must stay control-only.
   *
   * FOLLOW-1287 retired `GET /api/adapt`; the same property is pinned here on `POST`, the only
   * method left: a holdout session is logged with variant='control' and the bandit is never
   * consulted for it, while a treatment session logs the sampled arm.
   *
   * Test strategy: mock thompsonSample to return 'v1' deterministically so we can distinguish
   * between "sampled" (v1) and "forced-control" (control) paths. The holdout arm is driven by a
   * per-test `assignHoldout` mock override.
   *
   * @module apps/control-plane/src/app/api/adapt/route.follow360.test
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
  // FOLLOW-1163 / ESC-077: the `cta` slot now carries variants TOO, and that is what keeps this
  // file testing what it was written to test.
  //
  // This file's subject is the holdout gate: a holdout session must be served CONTROL copy and must
  // not be credited to v1/v2. It observed that through the served HEADLINE — and under
  // MASTER_DESIGN §E.7.0 a GET response never serves a headline any more (GET passes no listing
  // context, so every property-asserting directive is withheld). Observing it through the `cta`,
  // which survives the withhold, keeps the assertion end-to-end instead of weakening it to "some
  // value came back".
  //
  // STATED PLAINLY SO THIS FIXTURE IS NOT MISREAD: **no shipped playbook has variants on `cta`**
  // — `headline` is the only slot with `variants.en` in all 18. This fixture exercises the
  // MECHANISM (a bandit index reaching served copy), not a configuration that ships today. That is
  // exactly why ESC-077's suppression keys on whether a SERVED slot has variants rather than on
  // whether anything was withheld: when FOLLOW-1164 turns slots into briefs and a surviving slot
  // gains arms, this fixture's shape becomes the real one and no code changes.
  __reg.set(
    '@estalara/sdk/playbooks',
    (() => ({
      getPlaybook: vi.fn(() => ({
        slots: [
          {
            slot: 'headline',
            en: 'Control headline',
            variants: { en: ['Control headline', 'Variant 1 headline', 'Variant 2 headline'] },
          },
          {
            slot: 'cta',
            en: 'Control CTA',
            variants: { en: ['Control CTA', 'Variant 1 CTA', 'Variant 2 CTA'] },
          },
        ],
      })),
    }))(),
  );
  // Return arms that include v1 and v2 — ensures that IF sampling runs, it can
  // return a non-control variant. Used with the thompsonSample mock below.
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
  // Mock thompsonSample to return 'v1' deterministically — this lets us assert that:
  //   - holdout=false path: param_p_variant='v1' (sampling ran)
  //   - holdout=true path:  param_p_variant='control' (sampling was bypassed)
  __reg.set(
    '@estalara/shared',
    (() => {
      const mod = __H.real('@estalara/shared');
      return {
        ...mod,
        // assignHoldout is only used by POST; stub it for completeness.
        assignHoldout: vi.fn().mockResolvedValue({
          holdout_group: false,
          skipped: false,
          assigned_at: new Date().toISOString(),
        }),
        // Deterministic 'v1' so non-holdout path is verifiable.
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

  // ── Mocks (hoisted before route import) ──────────────────────────────────────

  // FOLLOW-473: GET auth is now the shared two-step resolver (resolveAdaptGetAuth).
  // Mock it to the deterministic tenant this suite exercises — the real auth
  // mechanics are covered end-to-end in route.follow473.test.ts.

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  /** Captures the URL of the `adaptation_decisions` ClickHouse INSERT. */
  function captureClickhouseUrl(): { getLastUrl: () => URL | null } {
    let lastUrl: URL | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: unknown, opts?: { body?: string }) => {
        if (typeof url === 'string' && (opts?.body ?? '').includes('adaptation_decisions')) {
          lastUrl = new URL(url);
        }
        return Promise.resolve(new Response('', { status: 200 }));
      }),
    );
    return { getLastUrl: () => lastUrl };
  }

  function makePostRequest(body: Record<string, unknown>): NextRequest {
    return new NextRequest('http://localhost/api/adapt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer demo_key' },
      body: JSON.stringify(body),
    });
  }

  const BASE_BODY = {
    tenant_id: 'tenant-follow360',
    session_id: 'sess-follow360-001',
    page_type: 'listing_detail',
    archetype_hint: 'yield_hunter',
    confidence: 0.8,
    similarity: 0.9,
  };

  /** Let the fire-and-forget `afterResponse` sinks run. */
  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

  // FOLLOW-1286 (D3): this file pins the pre-freeze bandit behaviour, which now runs only with
  // BANDIT_ENABLED=true. The frozen default (flag off) is pinned by `lib/__tests__/bandit-flag.test.ts`,
  // `api/adapt/route.bandit-freeze.test.ts` and each frozen route's own `BANDIT_ENABLED off` block.
  beforeEach(() => {
    vi.stubEnv('BANDIT_ENABLED', 'true');
  });

  describe('POST /api/adapt — FOLLOW-360: holdout gate bypasses bandit sampling', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123/');
      vi.stubEnv('ADAPT_API_KEY', '');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it(
      'REGRESSION (fail-before, pass-after): a holdout session logs param_p_variant=control ' +
        '— must NOT sample v1/v2 for holdout sessions (FOLLOW-360 / ESC-026 / RETRO-095)',
      async () => {
        const capture = captureClickhouseUrl();
        vi.mocked(assignHoldout).mockResolvedValueOnce({
          skipped: false,
          holdout_group: true,
          holdout_pct: 0.1,
          assigned_at: new Date().toISOString(),
        });

        const res = await POST(makePostRequest(BASE_BODY));
        await flush();

        expect(res.status).toBe(200);
        const url = capture.getLastUrl();
        expect(url, 'ClickHouse INSERT URL must be present').not.toBeNull();
        expect(url!.searchParams.get('param_p_variant')).toBe('control');
        expect(url!.searchParams.get('param_p_holdout_group')).toBe('1');
      },
    );

    it(
      'positive control: assignHoldout()=false logs param_p_variant=v1 ' +
        '(bandit sampling runs normally for non-holdout sessions)',
      async () => {
        const capture = captureClickhouseUrl();

        // Default mock (from the module factory above) already resolves holdout_group=false.
        const res = await POST(makePostRequest(BASE_BODY));
        await flush();

        expect(res.status).toBe(200);
        const url = capture.getLastUrl();
        expect(url, 'ClickHouse INSERT URL must be present').not.toBeNull();
        // thompsonSample mock returns 'v1' — the non-holdout path must use the sampled value. The
        // served `cta` carries variants in this fixture, so ESC-077 does not suppress the credit.
        expect(url!.searchParams.get('param_p_variant')).toBe('v1');
        expect(url!.searchParams.get('param_p_holdout_group')).toBe('0');
      },
    );

    it('assignHoldout()=true does not call getBanditArms (sampling skipped entirely)', async () => {
      captureClickhouseUrl();
      vi.mocked(assignHoldout).mockResolvedValueOnce({
        skipped: false,
        holdout_group: true,
        holdout_pct: 0.1,
        assigned_at: new Date().toISOString(),
      });

      await POST(makePostRequest(BASE_BODY));

      expect(getBanditArms).not.toHaveBeenCalled();
    });
  });

  __H.active = null;
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Origin: route.follow452.test.ts
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('route.follow452.test.ts — FOLLOW-452 tests (audit F-08): per-archetype holdout logging + GET holdout', () => {
  /**
   * FOLLOW-452 tests (audit F-08): per-archetype holdout logging + GET holdout
   * server-side computation.
   *
   * Two independent defects fixed:
   *
   *   1. POST /api/adapt logged EVERY holdout row with a hardcoded
   *      archetype='neutral', confidence=0.5 — even when the session's would-be
   *      archetype (from body.archetype_hint / demo-override) was something
   *      else entirely. This starved the per-archetype lift query's holdout arm
   *      for every real archetype (it only ever populated 'neutral'), making
   *      lift structurally unmeasurable for any archetype other than neutral.
   *      Fix: resolve archetype/confidence/similarity (incl. demo-override)
   *      BEFORE the A/B holdout gate, and log the WOULD-BE values on the
   *      holdout row. The RESPONSE returned to the held-out caller is UNCHANGED
   *      — still 'neutral' with empty directives (locked-in product behavior).
   *
   *   2. The since-retired GET /api/adapt trusted a caller-supplied `holdout_group` query param
   *      instead of computing holdout server-side; it was fixed to call `assignHoldout()`.
   *      FOLLOW-1287 retired GET; the same property (the arm is the server's, never the
   *      caller's) is pinned below on POST, whose body still accepts a `holdout_group` field.
   *
   * @module apps/control-plane/src/app/api/adapt/route.follow452.test
   */

  const { mockGetDemoOverride } = (() => ({
    mockGetDemoOverride: vi.fn(),
  }))();
  // `assignHoldout` is spied (not fixed): the POST describe block below exercises
  // the REAL deterministic algorithm (holdout_pct=0.0/1.0 is deterministic
  // regardless of session/tenant); the GET describe block overrides it per-test
  // to prove the query param is ignored.
  const { mockAssignHoldout } = (() => ({ mockAssignHoldout: vi.fn() }))();
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
    '@/lib/demo-override-store',
    (() => ({
      getDemoOverride: mockGetDemoOverride,
      DEMO_OVERRIDE_CONFIDENCE: 0.95,
      DEMO_OVERRIDE_SIMILARITY: 0.75,
    }))(),
  );
  __reg.set(
    '@estalara/shared',
    (() => {
      const actual = __H.real('@estalara/shared');
      mockAssignHoldout.mockImplementation(actual.assignHoldout as (...args: unknown[]) => unknown);
      return {
        ...actual,
        assignHoldout: mockAssignHoldout,
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

  // ── Mocks (hoisted before route import) ──────────────────────────────────────

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /** Captures the body and URL of the most recent ClickHouse fetch call. */
  function captureFetch(): { getLastBody: () => string | null; getLastUrl: () => URL | null } {
    let lastBody: string | null = null;
    let lastUrl: URL | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: unknown, opts?: { body?: string }) => {
        // FOLLOW-1061: the route now writes TWO ClickHouse rows per treatment request —
        // the `adaptation_decisions` row and the `llm_calls` pre-LLM segment row. This
        // capture names the one this suite is about instead of trusting call order.
        if (!(opts?.body ?? '').includes('INSERT INTO adaptation_decisions')) {
          return Promise.resolve(new Response('', { status: 200 }));
        }
        lastBody = opts?.body ?? null;
        try {
          lastUrl = typeof url === 'string' ? new URL(url) : null;
        } catch {
          lastUrl = null;
        }
        return Promise.resolve(new Response('', { status: 200 }));
      }),
    );
    return { getLastBody: () => lastBody, getLastUrl: () => lastUrl };
  }

  // FOLLOW-1201 / FOLLOW-1102: a body `holdout_pct` is honoured ONLY for the ADAPT_API_KEY caller,
  // and the POST suite below forces the holdout arm with it — so it authenticates as ops.
  const OPS_KEY = 'ops-key-'.repeat(6);

  function makePostRequest(body: Record<string, unknown>): NextRequest {
    return new NextRequest('http://localhost/api/adapt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPS_KEY}` },
      body: JSON.stringify(body),
    });
  }

  const SYNTHETIC_ARCHETYPE_X = 'yield_hunter';

  const BASE_POST_BODY = {
    tenant_id: 'est_demo_tenant',
    session_id: 'sess-follow452-post-001',
    page_type: 'listing_list' as const,
    archetype_hint: SYNTHETIC_ARCHETYPE_X,
    confidence: 0.82,
    similarity: 0.91,
  };

  // ─── POST: holdout row logs the would-be archetype, not hardcoded 'neutral' ──

  describe('POST /api/adapt — FOLLOW-452: holdout row logs the would-be archetype/confidence', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123/');
      vi.stubEnv('ADAPT_API_KEY', OPS_KEY); // FOLLOW-1201: body holdout_pct is ops-only
      vi.stubEnv('OPS_TENANT_ID', BASE_POST_BODY.tenant_id);
      mockGetDemoOverride.mockResolvedValue({ enabled: false, overrideArchetype: null });
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it(
      `a synthetic archetype-X ('${SYNTHETIC_ARCHETYPE_X}') session assigned to holdout produces a ` +
        'ClickHouse adaptation_decisions row keyed to X, not to the hardcoded "neutral"',
      async () => {
        const capture = captureFetch();

        const res = await POST(
          makePostRequest({ ...BASE_POST_BODY, holdout_pct: 1.0, consent_mode_enabled: false }),
        );

        expect(res.status).toBe(200);

        // AC: response body to the held-out caller is UNCHANGED — still neutral.
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.holdout_group).toBe(true);
        expect(body.archetype).toBe('neutral');
        expect(body.confidence).toBe(0.5);
        expect((body.directives as unknown[]).length).toBe(0);

        // AC: the LOGGED ClickHouse row carries the would-be archetype/confidence.
        const url = capture.getLastUrl();
        expect(url, 'ClickHouse INSERT must have fired for the holdout row').not.toBeNull();
        expect(url!.searchParams.get('param_p_holdout_group')).toBe('1');
        expect(url!.searchParams.get('param_p_archetype')).toBe(SYNTHETIC_ARCHETYPE_X);
        expect(url!.searchParams.get('param_p_confidence')).toBe(String(BASE_POST_BODY.confidence));
        const insertBody = capture.getLastBody() ?? '';
        expect(insertBody).toMatch(/INSERT INTO adaptation_decisions/);
      },
    );

    it('holdout row reflects the DEMO-OVERRIDE archetype (not body.archetype_hint) when demo mode is active', async () => {
      mockGetDemoOverride.mockResolvedValue({
        enabled: true,
        overrideArchetype: 'luxury_buyer',
        overrideModel: 'claude-sonnet-4-6',
      });
      const capture = captureFetch();

      const res = await POST(
        makePostRequest({ ...BASE_POST_BODY, holdout_pct: 1.0, consent_mode_enabled: false }),
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      // Response contract unchanged — still neutral for the held-out caller.
      expect(body.archetype).toBe('neutral');

      const url = capture.getLastUrl();
      expect(url).not.toBeNull();
      expect(url!.searchParams.get('param_p_archetype')).toBe('luxury_buyer');
      expect(url!.searchParams.get('param_p_confidence')).toBe('0.95'); // DEMO_OVERRIDE_CONFIDENCE
    });

    it('treatment arm (non-holdout) is unaffected — logs its own archetype as before', async () => {
      const capture = captureFetch();

      const res = await POST(
        makePostRequest({ ...BASE_POST_BODY, holdout_pct: 0.0, consent_mode_enabled: false }),
      );

      expect(res.status).toBe(200);
      const url = capture.getLastUrl();
      expect(url).not.toBeNull();
      expect(url!.searchParams.get('param_p_holdout_group')).toBe('0');
      expect(url!.searchParams.get('param_p_archetype')).toBe(SYNTHETIC_ARCHETYPE_X);
    });
  });

  // ─── Holdout is computed server-side; a body `holdout_group` is ignored ──────
  //
  // FOLLOW-1287: these three cases pinned the since-retired GET handler, which used to trust a
  // caller-supplied `holdout_group` query param. POST's body schema still ACCEPTS a `holdout_group`
  // field (documented as a logged caller value) and the handler never reads it — so the same
  // property is pinned here on POST, the only method left: the arm is `assignHoldout()`'s, never
  // the caller's.

  const PUBLIC_POST_BODY = {
    tenant_id: 'tenant-follow452',
    session_id: 'sess-follow452-public-001',
    page_type: 'listing_detail' as const,
    archetype_hint: SYNTHETIC_ARCHETYPE_X,
    confidence: 0.8,
    similarity: 0.9,
  };

  /** A public (non-ops) caller: the demo-JWT mock above authenticates any bearer. */
  function makePublicPostRequest(body: Record<string, unknown>): NextRequest {
    return new NextRequest('http://localhost/api/adapt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer demo_key' },
      body: JSON.stringify(body),
    });
  }

  describe('POST /api/adapt — FOLLOW-452: holdout computed via assignHoldout(), caller field ignored', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123/');
      vi.stubEnv('ADAPT_API_KEY', '');
      mockGetDemoOverride.mockResolvedValue({ enabled: false, overrideArchetype: null });
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it('caller-supplied holdout_group=true is IGNORED when assignHoldout() resolves false', async () => {
      const capture = captureFetch();
      vi.mocked(assignHoldout).mockResolvedValueOnce({
        skipped: false,
        holdout_group: false,
        holdout_pct: 0.1,
        assigned_at: new Date().toISOString(),
      });

      const res = await POST(makePublicPostRequest({ ...PUBLIC_POST_BODY, holdout_group: true }));
      await new Promise((r) => setTimeout(r, 0));

      expect(res.status).toBe(200);
      const url = capture.getLastUrl();
      expect(url).not.toBeNull();
      // If the caller-supplied field were honored, this would be '1'.
      expect(url!.searchParams.get('param_p_holdout_group')).toBe('0');
    });

    it('caller-supplied holdout_group=false is IGNORED when assignHoldout() resolves true', async () => {
      const capture = captureFetch();
      vi.mocked(assignHoldout).mockResolvedValueOnce({
        skipped: false,
        holdout_group: true,
        holdout_pct: 0.1,
        assigned_at: new Date().toISOString(),
      });

      const res = await POST(makePublicPostRequest({ ...PUBLIC_POST_BODY, holdout_group: false }));
      await new Promise((r) => setTimeout(r, 0));

      expect(res.status).toBe(200);
      const url = capture.getLastUrl();
      expect(url).not.toBeNull();
      // If the caller-supplied field were honored, this would be '0'.
      expect(url!.searchParams.get('param_p_holdout_group')).toBe('1');
    });

    it('assignHoldout() is called with the request session_id/tenant_id (server-side computation)', async () => {
      captureFetch();
      vi.mocked(assignHoldout).mockResolvedValueOnce({
        skipped: false,
        holdout_group: false,
        holdout_pct: 0.1,
        assigned_at: new Date().toISOString(),
      });

      await POST(makePublicPostRequest(PUBLIC_POST_BODY));

      expect(assignHoldout).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: 'tenant-follow452',
          session_id: PUBLIC_POST_BODY.session_id,
        }),
      );
    });
  });

  __H.active = null;
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Origin: route.forgery-canary.test.ts
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('route.forgery-canary.test.ts — `forgery_canary` — the control-plane half of FOLLOW-1201 AC(5) (audit SEC-4, FOLLOW-1102).', () => {
  /**
   * `forgery_canary` — the control-plane half of FOLLOW-1201 AC(5) (audit SEC-4, FOLLOW-1102).
   *
   * CLAIM (Rule AU): a caller holding only a public tenant credential cannot choose the holdout
   * rate that is persisted as the experiment's configuration; only a caller authenticated with
   * `ADAPT_API_KEY` can override it (the FOLLOW-819 harness's control arm, FOLLOW-1102 AC3).
   *
   * ASSERTION: the real `POST` handler with a captured `adaptation_decisions` INSERT — the
   * `param_p_holdout_pct` the row is written with, and the arm in the response.
   *
   * Red-first (Rule AS §3): at the pre-fix commit `body.holdout_pct` is honoured for every caller,
   * so case 1 persists `0` (the caller's value) and reads red.
   *
   * Mocks mirror `route.holdout.test.ts` — the suites must exercise the same route surface.
   *
   * @module apps/control-plane/src/app/api/adapt/route.forgery-canary.test
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
          { slot: 'headline', en: 'High-yield investment property' },
          { slot: 'cta', en: 'View ROI Analysis' },
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
    '@/lib/adapt-get-auth',
    (() => ({
      resolveAdaptGetAuth: vi.fn().mockResolvedValue({ ok: true, tenantId: 'tenant-test' }),
    }))(),
  );
  __H.active = __reg;
  beforeAll(() => {
    __H.active = __reg;
  });
  afterAll(() => {
    __H.active = null;
  });

  const OPS_TENANT_ID = '22222222-2222-4222-8222-222222222222';
  // Built with `.repeat()` so no 40+ char token literal lands in the diff (gitleaks).
  const OPS_KEY = 'ops-key-'.repeat(6);
  const HOLDOUT_SECRET = 'holdout-secret-'.repeat(3);

  /** Captures the URL of the most recent `adaptation_decisions` INSERT (the params ride on it). */
  function captureDecisionInsert(): { lastUrl: () => URL | null } {
    let lastUrl: URL | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: unknown, opts?: { body?: string }) => {
        if ((opts?.body ?? '').includes('INSERT INTO adaptation_decisions')) {
          lastUrl = typeof url === 'string' ? new URL(url) : null;
        }
        return Promise.resolve(new Response('', { status: 200 }));
      }),
    );
    return { lastUrl: () => lastUrl };
  }

  function postRequest(body: Record<string, unknown>, bearer: string): NextRequest {
    return new NextRequest('http://localhost/api/adapt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
      body: JSON.stringify(body),
    });
  }

  const PUBLIC_BODY = {
    tenant_id: OPS_TENANT_ID,
    session_id: 'sess-forgery-canary-0001',
    page_type: 'listing_detail' as const,
    archetype_hint: 'yield_hunter',
    confidence: 0.8,
    similarity: 0.9,
    consent_mode_enabled: false,
  };

  describe('forgery_canary — client-chosen holdout rate [FOLLOW-1201 AC(3)/(5)]', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123/');
      vi.stubEnv('HOLDOUT_ASSIGNMENT_SECRET', HOLDOUT_SECRET);
      vi.stubEnv('HOLDOUT_PCT', '0.25');
      vi.stubEnv('ADAPT_API_KEY', OPS_KEY);
      vi.stubEnv('OPS_TENANT_ID', OPS_TENANT_ID);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it('case 1: a public-credential caller sending holdout_pct: 0 does NOT change the persisted rate', async () => {
      const capture = captureDecisionInsert();
      // `demo_key` is NOT the ops key — verifyDemoJwt is mocked to accept it as a demo session.
      const res = await POST(postRequest({ ...PUBLIC_BODY, holdout_pct: 0 }, 'demo_key'));
      expect(res.status).toBe(200);

      const url = capture.lastUrl();
      expect(url, 'expected an adaptation_decisions INSERT').not.toBeNull();
      // Pre-fix this reads '0' — the caller's number, persisted as if it were configuration.
      expect(url!.searchParams.get('param_p_holdout_pct')).toBe('0.25');
    });

    it('case 1b: a public-credential caller cannot choose its arm — holdout_pct 0 and 1 land in the SAME arm', async () => {
      captureDecisionInsert();
      // Pre-fix: `1` is holdout with certainty and `0` is treatment with certainty, so the two
      // responses differ. Post-fix both are the configured 25% draw for this session — identical.
      const forcedIn = await POST(postRequest({ ...PUBLIC_BODY, holdout_pct: 1 }, 'demo_key'));
      const forcedOut = await POST(postRequest({ ...PUBLIC_BODY, holdout_pct: 0 }, 'demo_key'));
      expect(forcedIn.status).toBe(200);
      expect(forcedOut.status).toBe(200);
      const a = (await forcedIn.json()) as { holdout_group?: boolean };
      const b = (await forcedOut.json()) as { holdout_group?: boolean };
      expect(a.holdout_group === true).toBe(b.holdout_group === true);
    });

    it('positive control: the ADAPT_API_KEY caller (FOLLOW-819 harness control arm) CAN set holdout_pct: 1', async () => {
      const capture = captureDecisionInsert();
      const res = await POST(postRequest({ ...PUBLIC_BODY, holdout_pct: 1 }, OPS_KEY));
      expect(res.status, await res.clone().text()).toBe(200);
      const json = (await res.json()) as { holdout_group?: boolean };
      expect(json.holdout_group).toBe(true);
      const url = capture.lastUrl();
      expect(url).not.toBeNull();
      expect(url!.searchParams.get('param_p_holdout_pct')).toBe('1');
      expect(url!.searchParams.get('param_p_holdout_group')).toBe('1');
    });

    it('positive control: with no body holdout_pct the configured rate is what is persisted', async () => {
      const capture = captureDecisionInsert();
      const res = await POST(postRequest(PUBLIC_BODY, 'demo_key'));
      expect(res.status).toBe(200);
      expect(capture.lastUrl()!.searchParams.get('param_p_holdout_pct')).toBe('0.25');
    });

    it('fails LOUD, not open, when HOLDOUT_ASSIGNMENT_SECRET is unset in a configured deployment', async () => {
      vi.stubEnv('HOLDOUT_ASSIGNMENT_SECRET', '');
      captureDecisionInsert();
      const res = await POST(postRequest(PUBLIC_BODY, 'demo_key'));
      expect(res.status).toBe(500);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe('holdout_secret_unconfigured');
    });
  });

  __H.active = null;
});
