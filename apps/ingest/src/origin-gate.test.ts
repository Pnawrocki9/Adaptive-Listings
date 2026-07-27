/**
 * Unit tests for the per-tenant origin gate [FOLLOW-642]: origin normalization + the
 * inherit / deny-all / explicit policy semantics + the matcher.
 */

import { describe, expect, it } from 'vitest';

import {
  allowedOriginsForEnv,
  isOriginAllowed,
  isUnprovisionedExternalTenant,
  normalizeToOrigin,
  resolveFirstPartyTenantId,
  resolveOriginPolicy,
} from './origin-gate.js';

describe('normalizeToOrigin', () => {
  it('returns a bare origin unchanged', () => {
    expect(normalizeToOrigin('https://app.estalara.com')).toBe('https://app.estalara.com');
  });

  it('strips path / query / fragment (the z.string().url() bug)', () => {
    expect(normalizeToOrigin('https://clientx.com/listings?ref=a#top')).toBe('https://clientx.com');
  });

  it('drops the default https port 443', () => {
    expect(normalizeToOrigin('https://clientx.com:443')).toBe('https://clientx.com');
  });

  it('drops the default http port 80 but keeps a non-default port', () => {
    expect(normalizeToOrigin('http://localhost:80')).toBe('http://localhost');
    expect(normalizeToOrigin('http://localhost:5173')).toBe('http://localhost:5173');
  });

  it('lower-cases the host', () => {
    expect(normalizeToOrigin('https://ClientX.COM')).toBe('https://clientx.com');
  });

  it('strips userinfo', () => {
    expect(normalizeToOrigin('https://user:pass@clientx.com/x')).toBe('https://clientx.com');
  });

  it('returns null for a value with no scheme (fails safe, not a wildcard)', () => {
    expect(normalizeToOrigin('clientx.com')).toBeNull();
  });

  it('returns null for a non-http(s) scheme', () => {
    expect(normalizeToOrigin('ftp://clientx.com')).toBeNull();
    expect(normalizeToOrigin('javascript:alert(1)')).toBeNull();
  });

  it('returns null for empty / whitespace', () => {
    expect(normalizeToOrigin('')).toBeNull();
    expect(normalizeToOrigin('   ')).toBeNull();
  });
});

describe('resolveOriginPolicy', () => {
  const env = ['https://app.estalara.com', 'http://localhost:5173'];

  it('null → inherit (env allow-list, normalized)', () => {
    const p = resolveOriginPolicy(null, env);
    expect(p.mode).toBe('inherit');
    expect(p.allowList).toEqual(['https://app.estalara.com', 'http://localhost:5173']);
  });

  it('undefined → inherit', () => {
    expect(resolveOriginPolicy(undefined, env).mode).toBe('inherit');
  });

  it('empty array → deny-all (empty allow-list)', () => {
    const p = resolveOriginPolicy([], env);
    expect(p.mode).toBe('deny-all');
    expect(p.allowList).toEqual([]);
  });

  it('non-empty → explicit (normalized, path stripped, de-duped)', () => {
    const p = resolveOriginPolicy(
      ['https://clientx.com/listings', 'https://clientx.com', 'https://sub.clientx.com'],
      env,
    );
    expect(p.mode).toBe('explicit');
    expect(p.allowList).toEqual(['https://clientx.com', 'https://sub.clientx.com']);
  });

  it('explicit list drops unparseable entries (fail safe)', () => {
    const p = resolveOriginPolicy(['not a url', 'https://clientx.com'], env);
    expect(p.allowList).toEqual(['https://clientx.com']);
  });
});

describe('isOriginAllowed', () => {
  it('matches a listed origin', () => {
    expect(isOriginAllowed('https://clientx.com', ['https://clientx.com'])).toBe(true);
  });

  it('matches when the request origin carries a default port', () => {
    expect(isOriginAllowed('https://clientx.com:443', ['https://clientx.com'])).toBe(true);
  });

  it('rejects an unlisted origin', () => {
    expect(isOriginAllowed('https://evil.com', ['https://clientx.com'])).toBe(false);
  });

  it('rejects against an empty (deny-all) allow-list', () => {
    expect(isOriginAllowed('https://clientx.com', [])).toBe(false);
  });

  it('rejects an unparseable request origin', () => {
    expect(isOriginAllowed('not-an-origin', ['https://clientx.com'])).toBe(false);
  });
});

describe('allowedOriginsForEnv', () => {
  it('production → prod origins only (no localhost)', () => {
    const list = allowedOriginsForEnv('production');
    expect(list).toContain('https://app.estalara.com');
    expect(list).toContain('https://admin.estalara.com');
    expect(list).not.toContain('http://localhost:5173');
  });

  it('non-production → prod origins + localhost', () => {
    const list = allowedOriginsForEnv('development');
    expect(list).toContain('https://app.estalara.com');
    expect(list).toContain('http://localhost:5173');
    expect(list).toContain('http://localhost:3000');
  });
});

// ─── FOLLOW-658 — un-provisioned external tenant guard ───────────────────────
//
// `inherit` resolves to ESTALARA's own env allow-list, so it is only ever correct for the
// first-party tenant. Any other tenant on `inherit` has a KV api-key record that was never seeded
// with `allowed_origins` — a provisioning defect, not a default.
describe('isUnprovisionedExternalTenant', () => {
  // Contain hex letters (a/b/c/d/e/f) deliberately, not just digits, so a `.toUpperCase()` /
  // `.toLowerCase()` transform below is a real case-fold, not a no-op [FOLLOW-678].
  const FIRST_PARTY = 'aaaaaaaa-1111-4111-8111-111111111111';
  const EXTERNAL = 'bbbbbbbb-2222-4222-8222-222222222222';

  it('flags an external tenant left on the inherit policy', () => {
    expect(isUnprovisionedExternalTenant('inherit', EXTERNAL, FIRST_PARTY)).toBe(true);
  });

  it('never flags the configured first-party tenant (its traffic must not break)', () => {
    expect(isUnprovisionedExternalTenant('inherit', FIRST_PARTY, FIRST_PARTY)).toBe(false);
  });

  it('never flags a tenant that HAS an explicit policy', () => {
    expect(isUnprovisionedExternalTenant('explicit', EXTERNAL, FIRST_PARTY)).toBe(false);
    expect(isUnprovisionedExternalTenant('deny-all', EXTERNAL, FIRST_PARTY)).toBe(false);
  });

  it('is disabled when FIRST_PARTY_TENANT_ID is unset or blank — a forgotten env cannot black-hole traffic', () => {
    expect(isUnprovisionedExternalTenant('inherit', EXTERNAL, undefined)).toBe(false);
    expect(isUnprovisionedExternalTenant('inherit', EXTERNAL, '')).toBe(false);
    expect(isUnprovisionedExternalTenant('inherit', EXTERNAL, '   ')).toBe(false);
  });

  it('tolerates surrounding whitespace on either side of the comparison', () => {
    expect(isUnprovisionedExternalTenant('inherit', ` ${FIRST_PARTY} `, ` ${FIRST_PARTY} `)).toBe(
      false,
    );
  });

  // ─── FOLLOW-678 — canonicalization + malformed-value handling ────────────────
  //
  // The 5 cases above all pass unchanged with the pre-FOLLOW-678 defect (exact-string `!==`,
  // no case-folding, no UUID-shape validation) still in place. The cases below would FAIL
  // without the fix.
  it('matches case-insensitively: upper-case env vs lower-case tenant id [would FAIL pre-fix]', () => {
    expect(isUnprovisionedExternalTenant('inherit', FIRST_PARTY, FIRST_PARTY.toUpperCase())).toBe(
      false,
    );
  });

  it('matches case-insensitively: lower-case env vs upper-case tenant id [would FAIL pre-fix]', () => {
    expect(isUnprovisionedExternalTenant('inherit', FIRST_PARTY.toUpperCase(), FIRST_PARTY)).toBe(
      false,
    );
  });

  it('still flags a genuinely external tenant when the first-party env has different case', () => {
    expect(isUnprovisionedExternalTenant('inherit', EXTERNAL, FIRST_PARTY.toUpperCase())).toBe(
      true,
    );
  });

  it(
    'a malformed (non-UUID) FIRST_PARTY_TENANT_ID degrades the guard to OFF, not deny-all — ' +
      'the pre-fix defect would instead 403 EVERY tenant, including the real first-party one, ' +
      'because a garbled string never equals any real tenant id under raw `!==` [would FAIL pre-fix]',
    () => {
      expect(isUnprovisionedExternalTenant('inherit', EXTERNAL, 'not-a-real-uuid')).toBe(false);
      expect(isUnprovisionedExternalTenant('inherit', FIRST_PARTY, 'not-a-real-uuid')).toBe(false);
    },
  );
});

// ─── FOLLOW-678 — FIRST_PARTY_TENANT_ID env classification ───────────────────
describe('resolveFirstPartyTenantId', () => {
  it('unset for undefined, empty, and whitespace-only', () => {
    expect(resolveFirstPartyTenantId(undefined)).toEqual({ status: 'unset' });
    expect(resolveFirstPartyTenantId(null)).toEqual({ status: 'unset' });
    expect(resolveFirstPartyTenantId('')).toEqual({ status: 'unset' });
    expect(resolveFirstPartyTenantId('   ')).toEqual({ status: 'unset' });
  });

  it('valid: trims and lower-cases a well-formed UUID', () => {
    expect(resolveFirstPartyTenantId(' ABCDEF01-1111-4111-8111-111111111111 ')).toEqual({
      status: 'valid',
      value: 'abcdef01-1111-4111-8111-111111111111',
    });
  });

  it('malformed: present but not a well-formed UUID', () => {
    expect(resolveFirstPartyTenantId('not-a-real-uuid')).toEqual({
      status: 'malformed',
      raw: 'not-a-real-uuid',
    });
  });
});
