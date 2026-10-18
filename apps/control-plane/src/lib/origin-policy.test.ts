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
import { describe, it, expect } from 'vitest';

import { ESTALARA_TENANT_ID, isEstalaraTenant } from './estalara-tenant';
import { resolveOriginDecision } from './origin-policy';

const PLATFORM = ['https://app.estalara.com', 'https://admin.estalara.com'] as const;

const base = {
  keyOrigins: null as string[] | null,
  tenantOrigins: [] as string[],
  isEstalaraTenant: false,
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
      isEstalaraTenant: true,
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
      isEstalaraTenant: true,
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
      isEstalaraTenant: false,
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
      isEstalaraTenant: true,
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

describe('FOLLOW-1332 — the platform list is granted to the Estalara tenant only', () => {
  // Drives the REAL predicate (`isEstalaraTenant`) rather than a literal boolean, so a change to
  // how the Estalara tenant is recognised is caught here, not only in `estalara-tenant.test.ts`.
  // Replaces the FOLLOW-951/957 tri-state cases: the `'unverified'` state (first-party env unset)
  // and its `first_party_unverified` refusal no longer exist.
  const OTHER = '22222222-2222-4222-8222-222222222222';

  it('the Estalara tenant with a populated list still keeps the platform list (FOLLOW-946)', () => {
    const d = resolveOriginDecision({
      ...base,
      requestOrigin: 'https://app.estalara.com',
      tenantOrigins: ['https://something-else.estalara.com'],
      isEstalaraTenant: isEstalaraTenant(ESTALARA_TENANT_ID),
    });
    expect(d).toMatchObject({ verdict: 'allow', source: 'platform' });
  });

  it('the Estalara tenant with nothing configured is allowed the platform list — the live path', () => {
    const d = resolveOriginDecision({
      ...base,
      requestOrigin: 'https://app.estalara.com',
      tenantOrigins: [],
      isEstalaraTenant: isEstalaraTenant(ESTALARA_TENANT_ID),
    });
    expect(d).toEqual({ verdict: 'allow', origin: 'https://app.estalara.com', source: 'platform' });
  });

  it('the Estalara tenant is still refused an origin on neither list', () => {
    const d = resolveOriginDecision({
      ...base,
      requestOrigin: 'https://evil.example.com',
      tenantOrigins: [],
      isEstalaraTenant: isEstalaraTenant(ESTALARA_TENANT_ID),
    });
    expect(d).toEqual({ verdict: 'deny', reason: 'forbidden_origin' });
  });

  it('any other tenant id never inherits the platform list', () => {
    expect(
      resolveOriginDecision({
        ...base,
        requestOrigin: 'https://app.estalara.com',
        tenantOrigins: ['https://homes.clientbrand.com'],
        isEstalaraTenant: isEstalaraTenant(OTHER),
      }),
    ).toEqual({ verdict: 'deny', reason: 'forbidden_origin' });
    expect(
      resolveOriginDecision({
        ...base,
        requestOrigin: 'https://app.estalara.com',
        tenantOrigins: [],
        isEstalaraTenant: isEstalaraTenant(OTHER),
      }),
    ).toEqual({ verdict: 'unconfigured', reason: 'origin_policy_unconfigured' });
  });
});
