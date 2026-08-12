/**
 * FOLLOW-941 — the control plane must authorise browser origins PER TENANT, from Postgres.
 *
 * The bug: `CORS_PROD_ORIGINS` was two hardcoded Estalara domains while external brands run on
 * the client's own domain (`BRAND_PROVISIONING.md:16`). Ingest already resolved per tenant, so
 * the two halves of one request path disagreed about who may call them.
 *
 * The subtlety these cases pin down is the `[]` trap: Postgres `tenants.allowed_origins` is
 * `NOT NULL DEFAULT []` where `[]` means NOT CONFIGURED, the opposite of the KV `[]` the ingest
 * gate reads as deny-all. Reading Postgres with KV semantics would lock out every unprovisioned
 * tenant; reading KV with Postgres semantics would silently open a deliberate lock-down.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { classifyFirstPartyTenant } from './brand-identity';
import { resolveOriginDecision } from './origin-policy';

const PLATFORM = ['https://app.estalara.com', 'https://admin.estalara.com'] as const;

const base = {
  keyOrigins: null as string[] | null,
  tenantOrigins: [] as string[],
  firstPartyStatus: 'external' as const,
  platformOrigins: PLATFORM,
};

describe('FOLLOW-941 — per-tenant origin policy (Postgres semantics)', () => {
  it('admits an external brand on its OWN domain — the whole point of the ticket', () => {
    const d = resolveOriginDecision({
      ...base,
      requestOrigin: 'https://homes.clientbrand.com',
      tenantOrigins: ['https://homes.clientbrand.com'],
    });
    expect(d.verdict).toBe('allow');
  });

  it('refuses an origin the configured tenant did not list', () => {
    const d = resolveOriginDecision({
      ...base,
      requestOrigin: 'https://evil.example.com',
      tenantOrigins: ['https://homes.clientbrand.com'],
    });
    expect(d).toEqual({ verdict: 'deny', reason: 'forbidden_origin' });
  });

  it('lets a per-key list OVERRIDE the tenant list', () => {
    const d = resolveOriginDecision({
      ...base,
      requestOrigin: 'https://staging.clientbrand.com',
      keyOrigins: ['https://staging.clientbrand.com'],
      tenantOrigins: ['https://homes.clientbrand.com'],
    });
    expect(d).toMatchObject({ verdict: 'allow', source: 'api_key' });
  });

  // ── the `[]` trap, both directions ─────────────────────────────────────────
  it('treats an EMPTY tenant array as NOT CONFIGURED, never as deny-all', () => {
    // Under KV semantics this would be deny-all. Under Postgres semantics it must fall through —
    // otherwise every tenant that has simply never been provisioned is locked out.
    const d = resolveOriginDecision({
      ...base,
      requestOrigin: 'https://app.estalara.com',
      tenantOrigins: [],
      firstPartyStatus: 'confirmed',
    });
    expect(d).toMatchObject({ verdict: 'allow', source: 'platform' });
  });

  it('treats an EMPTY per-key array as "no override", falling through to the tenant list', () => {
    const d = resolveOriginDecision({
      ...base,
      requestOrigin: 'https://homes.clientbrand.com',
      keyOrigins: [],
      tenantOrigins: ['https://homes.clientbrand.com'],
    });
    expect(d).toMatchObject({ verdict: 'allow', source: 'tenant' });
  });

  it('FOLLOW-946: a POPULATED tenant list does not lock the FIRST PARTY out of the platform list', () => {
    // The trap: `tenants.allowed_origins` exists to be populated for the ingest KV projection
    // (BRAND_PROVISIONING §Step 6). Before this, doing that documented thing for Estalara's own
    // tenant would have refused Estalara's own control-plane origins.
    const d = resolveOriginDecision({
      ...base,
      requestOrigin: 'https://app.estalara.com',
      tenantOrigins: ['https://something-else.estalara.com'],
      firstPartyStatus: 'confirmed',
    });
    expect(d).toMatchObject({ verdict: 'allow', source: 'platform' });
  });

  it('FOLLOW-946: a tenant classified EXTERNAL gets no such fallback (policy function only)', () => {
    // Rule AU, and RETRO-267 was right to flag the old name for it: this asserts the POLICY
    // FUNCTION given a literal verdict, so it says nothing about how that verdict is derived.
    // The system-level claim is the FOLLOW-951 block below, which drives the real derivation.
    const d = resolveOriginDecision({
      ...base,
      requestOrigin: 'https://app.estalara.com',
      tenantOrigins: ['https://homes.clientbrand.com'],
      firstPartyStatus: 'external',
    });
    expect(d).toEqual({ verdict: 'deny', reason: 'forbidden_origin' });
  });

  it('refuses an UNCONFIGURED non-first-party tenant distinctly, rather than inheriting', () => {
    // Inheriting here would hand an external brand Estalara's own allow-list — the FOLLOW-658
    // failure one layer up. It must be its own verdict so the operator sees a provisioning gap
    // rather than a mysterious CORS refusal.
    const d = resolveOriginDecision({ ...base, requestOrigin: 'https://homes.clientbrand.com' });
    expect(d).toEqual({ verdict: 'unconfigured', reason: 'origin_policy_unconfigured' });
  });

  it('does not let the first party inherit an origin outside the platform list', () => {
    const d = resolveOriginDecision({
      ...base,
      requestOrigin: 'https://evil.example.com',
      firstPartyStatus: 'confirmed',
    });
    expect(d).toEqual({ verdict: 'deny', reason: 'forbidden_origin' });
  });

  // ── shape handling ─────────────────────────────────────────────────────────
  it('allows a server-side caller that sends no Origin at all', () => {
    const d = resolveOriginDecision({ ...base, requestOrigin: null });
    expect(d.verdict).toBe('allow');
  });

  it('normalises a full URL in the stored list to its origin before comparing', () => {
    const d = resolveOriginDecision({
      ...base,
      requestOrigin: 'https://homes.clientbrand.com',
      tenantOrigins: ['https://homes.clientbrand.com/listings?a=1'],
    });
    expect(d.verdict).toBe('allow');
  });

  it('DROPS an unparseable stored entry instead of failing the whole list open or shut', () => {
    const d = resolveOriginDecision({
      ...base,
      requestOrigin: 'https://homes.clientbrand.com',
      tenantOrigins: ['not a url', 'https://homes.clientbrand.com'],
    });
    expect(d.verdict).toBe('allow');
  });

  it('refuses an unparseable REQUEST origin', () => {
    const d = resolveOriginDecision({ ...base, requestOrigin: 'javascript:alert(1)' });
    expect(d).toEqual({ verdict: 'deny', reason: 'origin_unparseable' });
  });

  it('refuses a non-http(s) scheme, and normalises a default port away', () => {
    // Asserted through the public function rather than the helper: Rule H, and it is the
    // behaviour that matters rather than the helper's existence.
    expect(resolveOriginDecision({ ...base, requestOrigin: 'ftp://example.com' })).toEqual({
      verdict: 'deny',
      reason: 'origin_unparseable',
    });
    expect(
      resolveOriginDecision({
        ...base,
        requestOrigin: 'https://example.com',
        tenantOrigins: ['https://example.com:443/x'],
      }).verdict,
    ).toBe('allow');
  });
});

describe('FOLLOW-951 — the fallback is fail-CLOSED on unknowable first-party identity', () => {
  // RETRO-267's sharpest finding. `isFirstPartyTenant` returns `true` for EVERY tenant when
  // `FIRST_PARTY_TENANT_ID` is unset/blank/malformed, and the CORS consumer inherited that
  // fail-open without FOLLOW-660's tenant-count net. These cases drive the REAL derivation
  // (`classifyFirstPartyTenant`) rather than passing a literal, which is why the old
  // 'an EXTERNAL brand gets no such fallback' test could never have caught it.

  const ESTALARA = '11111111-1111-4111-8111-111111111111';
  const BRAND = '22222222-2222-4222-8222-222222222222';

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Statically imported and called per-assertion, NOT re-imported per case: the status is derived
  // from `process.env` at CALL time (`firstPartyTenantIdStatus`), so `vi.stubEnv` alone is the
  // whole mechanism — the same shape `brand-identity.test.ts` already uses. A dynamic
  // `await import()` here additionally paid the module graph's cold transform inside the 5s test
  // timeout, which is what made the first case flake.
  const classify = classifyFirstPartyTenant;

  it('env UNSET derives `unverified`, and a populated list then grants NO platform origin', () => {
    vi.stubEnv('FIRST_PARTY_TENANT_ID', '');
    const status = classify(BRAND);
    expect(status, 'the fail-open under test').toBe('unverified');

    // The defect: via `isFirstPartyTenant` this read as first-party, so an external brand with a
    // populated list additionally inherited Estalara's two origins — FOLLOW-658, one layer up.
    const d = resolveOriginDecision({
      ...base,
      requestOrigin: 'https://app.estalara.com',
      tenantOrigins: ['https://homes.clientbrand.com'],
      firstPartyStatus: status,
    });
    // Still a refusal — but with its OWN reason since FOLLOW-957. The effect is identical to a
    // wrong-origin refusal and the CAUSE is the opposite: the origin IS a platform origin and the
    // caller may well be the first party; the environment simply cannot say. Reported identically,
    // this surfaced as a 401 on a correct API key (FOLLOW-943) with nothing naming the cause.
    expect(d).toEqual({ verdict: 'deny', reason: 'first_party_unverified' });
  });

  it('FOLLOW-957: the two refusals on this branch are DISTINGUISHABLE, which is the whole point', () => {
    vi.stubEnv('FIRST_PARTY_TENANT_ID', '');
    const populated = { ...base, tenantOrigins: ['https://homes.clientbrand.com'] };

    // Cause A — cannot verify identity, on an origin that IS ours.
    expect(
      resolveOriginDecision({
        ...populated,
        requestOrigin: 'https://app.estalara.com',
        firstPartyStatus: classify(ESTALARA),
      }),
    ).toEqual({ verdict: 'deny', reason: 'first_party_unverified' });

    // Cause B — an origin that is nobody's. Same verdict, different reason, and it must stay so.
    expect(
      resolveOriginDecision({
        ...populated,
        requestOrigin: 'https://evil.example.com',
        firstPartyStatus: classify(ESTALARA),
      }),
    ).toEqual({ verdict: 'deny', reason: 'forbidden_origin' });
  });

  it('FOLLOW-957: an EXTERNAL brand keeps `forbidden_origin` — that refusal is CORRECT, not a diagnostic gap', () => {
    vi.stubEnv('FIRST_PARTY_TENANT_ID', ESTALARA);
    expect(
      resolveOriginDecision({
        ...base,
        requestOrigin: 'https://app.estalara.com',
        tenantOrigins: ['https://homes.clientbrand.com'],
        firstPartyStatus: classify(BRAND),
      }),
    ).toEqual({ verdict: 'deny', reason: 'forbidden_origin' });
  });

  it('env MALFORMED is folded into `unverified` too (FOLLOW-678), not into a match', () => {
    vi.stubEnv('FIRST_PARTY_TENANT_ID', 'not-a-uuid');
    expect(classify(BRAND)).toBe('unverified');
  });

  it('env SET derives `confirmed` for the match and `external` for everyone else', () => {
    vi.stubEnv('FIRST_PARTY_TENANT_ID', ESTALARA);
    expect(classify(ESTALARA)).toBe('confirmed');
    // canonicalisation on BOTH sides: case and surrounding whitespace must not cause a
    // false mismatch, which would silently demote the real first party to 'external'.
    expect(classify(ESTALARA.toUpperCase())).toBe('confirmed');
    expect(classify(`  ${ESTALARA}  `)).toBe('confirmed');
    expect(classify(BRAND)).toBe('external');
  });

  it('a CONFIRMED first party with a populated list still keeps the platform list', () => {
    vi.stubEnv('FIRST_PARTY_TENANT_ID', ESTALARA);
    const d = resolveOriginDecision({
      ...base,
      requestOrigin: 'https://app.estalara.com',
      tenantOrigins: ['https://something-else.estalara.com'],
      firstPartyStatus: classify(ESTALARA),
    });
    expect(d).toMatchObject({ verdict: 'allow', source: 'platform' });
  });

  it('`unverified` must NOT lock the live first party out of the UNCONFIGURED path', () => {
    // The asymmetry, and the reason this fix is two different defaults rather than one strict
    // flag. Prod runs one tenant with `allowed_origins = []`, so EVERY live request takes this
    // branch; requiring `confirmed` here would turn an unset env var into a total outage.
    vi.stubEnv('FIRST_PARTY_TENANT_ID', '');
    const d = resolveOriginDecision({
      ...base,
      requestOrigin: 'https://app.estalara.com',
      tenantOrigins: [],
      firstPartyStatus: classify(ESTALARA),
    });
    expect(d).toMatchObject({ verdict: 'allow', source: 'platform' });
  });
});
