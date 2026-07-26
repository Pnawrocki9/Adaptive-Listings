/**
 * Unit tests for the pure helpers in scripts/project-allowed-origins.mts (FOLLOW-658).
 *
 * The script itself talks to a real Postgres and shells out to `wrangler` — an operator tool CI
 * cannot run end to end. These tests cover the decision logic that CI *can* protect: the PG→KV
 * semantics translation (where `[]` means opposite things on the two sides — the defect that would
 * black-hole a brand's browser traffic), the origin validation, and the read-modify-write merge
 * that must never clobber `hmac_secret` or cross-wire a key onto another tenant.
 *
 * The top-level `isMain` guard in the script checks `process.argv[1]`, so importing its pure
 * exports here does NOT run `main()` (which would open a DB connection).
 *
 * @module apps/control-plane/scripts/__tests__/project-allowed-origins.test
 */

import { describe, expect, it } from 'vitest';
import {
  mergeKvRecord,
  parseArgs,
  planKvAllowedOrigins,
  reconcileOperatorOrigins,
  toCanonicalOrigin,
} from '../project-allowed-origins.mts';

describe('toCanonicalOrigin', () => {
  it('strips path, query and fragment', () => {
    expect(toCanonicalOrigin('https://listings.clientx.com/embed?a=1#x')).toBe(
      'https://listings.clientx.com',
    );
  });

  it('drops default ports and lower-cases the host', () => {
    expect(toCanonicalOrigin('https://ClientX.COM:443')).toBe('https://clientx.com');
  });

  it('keeps a non-default port', () => {
    expect(toCanonicalOrigin('http://localhost:5173')).toBe('http://localhost:5173');
  });

  it('rejects a bare host and non-http(s) schemes', () => {
    expect(toCanonicalOrigin('clientx.com')).toBeNull();
    expect(toCanonicalOrigin('javascript:alert(1)')).toBeNull();
    expect(toCanonicalOrigin('  ')).toBeNull();
  });
});

describe('planKvAllowedOrigins — the PG `[]` vs KV `[]` trap', () => {
  it('REFUSES by default when Postgres has no configured origins', () => {
    // This is the case that would black-hole a brand: PG `[]` = "not configured" but a mechanical
    // copy would land KV `[]` = deny-all.
    const plan = planKvAllowedOrigins({ keyOrigins: null, tenantOrigins: [], onEmpty: 'refuse' });
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.reason).toMatch(/DENY-ALL/);
      expect(plan.reason).toMatch(/REFUSING to guess/);
    }
  });

  it('never emits KV `[]` from an empty Postgres column, whatever the precedence path', () => {
    for (const input of [
      { keyOrigins: null, tenantOrigins: [] },
      { keyOrigins: [], tenantOrigins: [] },
    ]) {
      const plan = planKvAllowedOrigins({ ...input, onEmpty: 'refuse' });
      expect(plan.ok).toBe(false);
    }
  });

  it('emits `[]` (deny-all) ONLY on an explicit operator decision', () => {
    const plan = planKvAllowedOrigins({ keyOrigins: null, tenantOrigins: [], onEmpty: 'deny-all' });
    expect(plan).toMatchObject({ ok: true, value: [], source: 'operator_deny_all' });
  });

  it('emits `null` (inherit) ONLY on an explicit operator decision, and says whose list that is', () => {
    const plan = planKvAllowedOrigins({
      keyOrigins: null,
      tenantOrigins: [],
      onEmpty: 'inherit-env',
    });
    expect(plan).toMatchObject({ ok: true, value: null, source: 'operator_inherit_env' });
    if (plan.ok) expect(plan.effect).toMatch(/ESTALARA's own domains/);
  });
});

describe('planKvAllowedOrigins — configured origins', () => {
  it('projects the tenant column, canonicalized and de-duped', () => {
    const plan = planKvAllowedOrigins({
      keyOrigins: null,
      tenantOrigins: ['https://listings.clientx.com/embed', 'https://listings.clientx.com:443'],
      onEmpty: 'refuse',
    });
    expect(plan).toMatchObject({
      ok: true,
      value: ['https://listings.clientx.com'],
      source: 'tenant_column',
    });
  });

  it('prefers the per-key column over the tenant column', () => {
    const plan = planKvAllowedOrigins({
      keyOrigins: ['https://staging.clientx.com'],
      tenantOrigins: ['https://listings.clientx.com'],
      onEmpty: 'refuse',
    });
    expect(plan).toMatchObject({
      ok: true,
      value: ['https://staging.clientx.com'],
      source: 'api_key_column',
    });
  });

  it('REFUSES the whole projection on an unparseable stored origin (never silently drops it)', () => {
    const plan = planKvAllowedOrigins({
      keyOrigins: null,
      tenantOrigins: ['clientx.com', 'https://listings.clientx.com'],
      onEmpty: 'refuse',
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toMatch(/not a parseable http\(s\) origin/);
  });
});

describe('reconcileOperatorOrigins', () => {
  it('uses Postgres verbatim when no --origins is supplied', () => {
    expect(reconcileOperatorOrigins(['https://listings.clientx.com'], null)).toMatchObject({
      ok: true,
      action: 'noop',
      origins: ['https://listings.clientx.com'],
    });
  });

  it('establishes the empty column from --origins (the only writer that exists today)', () => {
    expect(reconcileOperatorOrigins([], ['https://listings.clientx.com/'])).toMatchObject({
      ok: true,
      action: 'write_pg',
      origins: ['https://listings.clientx.com'],
    });
  });

  it('is idempotent when --origins matches the configured column', () => {
    expect(
      reconcileOperatorOrigins(['https://listings.clientx.com'], ['https://listings.clientx.com']),
    ).toMatchObject({ ok: true, action: 'noop' });
  });

  it('REFUSES to overwrite a configured allow-list from the command line', () => {
    const result = reconcileOperatorOrigins(
      ['https://listings.clientx.com'],
      ['https://evil.example.com'],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Refusing to overwrite/);
  });

  it('rejects an unparseable or empty --origins value', () => {
    expect(reconcileOperatorOrigins([], ['clientx.com']).ok).toBe(false);
    expect(reconcileOperatorOrigins([], []).ok).toBe(false);
  });
});

describe('mergeKvRecord', () => {
  it('preserves hmac_secret and every other field when updating', () => {
    const existing = JSON.stringify({
      tenant_id: 't-1',
      scopes: ['write:events'],
      hmac_secret: 'deadbeef',
      label: 'Client X',
    });
    const merged = mergeKvRecord(existing, ['https://listings.clientx.com'], {
      tenant_id: 't-1',
      scopes: ['ignored-on-update'],
    });
    expect(merged).toMatchObject({
      ok: true,
      created: false,
      record: {
        tenant_id: 't-1',
        scopes: ['write:events'],
        hmac_secret: 'deadbeef',
        label: 'Client X',
        allowed_origins: ['https://listings.clientx.com'],
      },
    });
  });

  it('creates a record from the Postgres fallback when the KV key is absent', () => {
    const merged = mergeKvRecord(null, [], {
      tenant_id: 't-2',
      scopes: ['write:events'],
      label: 'Client Y',
    });
    expect(merged).toMatchObject({
      ok: true,
      created: true,
      record: { tenant_id: 't-2', scopes: ['write:events'], allowed_origins: [] },
    });
  });

  it('refuses when the existing record belongs to a different tenant', () => {
    const existing = JSON.stringify({ tenant_id: 'someone-else', scopes: [] });
    const merged = mergeKvRecord(existing, null, { tenant_id: 't-1', scopes: [] });
    expect(merged.ok).toBe(false);
    if (!merged.ok) expect(merged.reason).toMatch(/disagree about key ownership/);
  });

  it('refuses to overwrite a record that is not valid JSON', () => {
    const merged = mergeKvRecord('{not json', null, { tenant_id: 't-1', scopes: [] });
    expect(merged.ok).toBe(false);
  });
});

describe('parseArgs', () => {
  it('accepts both `--flag value` and `--flag=value`', () => {
    const parsed = parseArgs([
      '--tenant-id',
      't-1',
      '--api-key=est_pub_x',
      '--namespace-id',
      'ns1',
      '--apply',
    ]);
    expect(parsed).toMatchObject({
      tenantId: 't-1',
      apiKey: 'est_pub_x',
      namespaceId: 'ns1',
      onEmpty: 'refuse',
      origins: null,
      apply: true,
    });
  });

  it('splits a comma-separated --origins list', () => {
    const parsed = parseArgs([
      '--tenant-id',
      't',
      '--api-key',
      'k',
      '--namespace-id',
      'n',
      '--origins',
      'https://a.com, https://b.com',
    ]);
    expect(parsed).toMatchObject({ origins: ['https://a.com', 'https://b.com'] });
  });

  it('defaults to a dry run and to --on-empty=refuse', () => {
    const parsed = parseArgs(['--tenant-id', 't', '--api-key', 'k', '--namespace-id', 'n']);
    expect(parsed).toMatchObject({ apply: false, onEmpty: 'refuse', origins: null });
  });

  it('rejects a missing required flag and an unknown --on-empty value', () => {
    expect(parseArgs(['--tenant-id', 't'])).toHaveProperty('error');
    expect(
      parseArgs([
        '--tenant-id',
        't',
        '--api-key',
        'k',
        '--namespace-id',
        'n',
        '--on-empty',
        'yolo',
      ]),
    ).toHaveProperty('error');
  });
});
