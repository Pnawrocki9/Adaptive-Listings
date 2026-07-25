/**
 * Unit tests for the per-tenant origin gate [FOLLOW-642]: origin normalization + the
 * inherit / deny-all / explicit policy semantics + the matcher.
 */

import { describe, expect, it } from 'vitest';

import {
  allowedOriginsForEnv,
  isOriginAllowed,
  normalizeToOrigin,
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
