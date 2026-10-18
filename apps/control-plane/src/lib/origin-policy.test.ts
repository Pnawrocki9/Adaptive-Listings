/**
 * FOLLOW-1333 — the control plane's browser-origin decision is one constant list, keyed on
 * `NODE_ENV`, shared with the ingest Worker (`@estalara/shared/browser-origins`).
 *
 * Replaces the FOLLOW-941 per-tenant cases (key list ?? tenant list, first-party platform
 * fallback, the Postgres `[]` = "not configured" trap): with one tenant there is no per-tenant
 * input left, and these tests pin that none is read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveOriginDecision } from './origin-policy';

afterEach(() => {
  vi.unstubAllEnvs();
});

const PROD = ['https://app.estalara.com', 'https://admin.estalara.com'];
const LOCAL = ['http://localhost:5173', 'http://localhost:3000'];

describe('resolveOriginDecision — NODE_ENV=production', () => {
  it.each(PROD)('allows %s', (origin) => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(resolveOriginDecision(origin)).toEqual({ verdict: 'allow' });
  });

  it.each(LOCAL)('refuses %s with forbidden_origin', (origin) => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(resolveOriginDecision(origin)).toEqual({ verdict: 'deny', reason: 'forbidden_origin' });
  });
});

describe('resolveOriginDecision — outside production', () => {
  it.each(['development', 'test'])('NODE_ENV=%s allows the prod and localhost origins', (env) => {
    vi.stubEnv('NODE_ENV', env);
    for (const origin of [...PROD, ...LOCAL]) {
      expect(resolveOriginDecision(origin), origin).toEqual({ verdict: 'allow' });
    }
  });
});

describe('resolveOriginDecision — refusals and the server-side caller', () => {
  it.each([
    'https://homes.clientbrand.com',
    'http://localhost:9200',
    'https://app.estalara.com.evil.example',
    'javascript:alert(1)',
    'ftp://app.estalara.com',
    'null',
  ])('refuses %s in every build', (origin) => {
    for (const env of ['production', 'development']) {
      vi.stubEnv('NODE_ENV', env);
      expect(resolveOriginDecision(origin)).toEqual({
        verdict: 'deny',
        reason: 'forbidden_origin',
      });
    }
  });

  it('allows a request with no Origin (a server-side caller; the API key is the gate)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(resolveOriginDecision(null)).toEqual({ verdict: 'allow' });
    expect(resolveOriginDecision('')).toEqual({ verdict: 'allow' });
  });
});
