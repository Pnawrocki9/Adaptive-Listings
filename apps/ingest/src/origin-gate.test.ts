/**
 * Unit tests for the ingest origin gate [FOLLOW-642, FOLLOW-1333]: one constant list
 * (`@estalara/shared/browser-origins`) keyed on `env.ENVIRONMENT`.
 *
 * The HTTP-level behaviour (preflight, 403 before any side effect, response header) is pinned in
 * `index.test.ts` ("CORS — …" describes); this file pins the environment switch itself.
 */

import { describe, expect, it } from 'vitest';

import { isOriginAllowed } from './origin-gate.js';

const PROD = ['https://app.estalara.com', 'https://admin.estalara.com'];
const LOCAL = ['http://localhost:5173', 'http://localhost:3000'];

describe('isOriginAllowed', () => {
  it.each(PROD)('production accepts %s', (origin) => {
    expect(isOriginAllowed(origin, 'production')).toBe(true);
  });

  it.each(LOCAL)('production refuses %s', (origin) => {
    expect(isOriginAllowed(origin, 'production')).toBe(false);
  });

  it.each(['development', 'staging', 'test', '', 'Production', 'prod'])(
    'any ENVIRONMENT other than the exact string "production" (%j) also accepts localhost',
    (environment) => {
      for (const origin of [...PROD, ...LOCAL]) {
        expect(isOriginAllowed(origin, environment)).toBe(true);
      }
    },
  );

  it.each([
    'https://evil.example.com',
    'https://listings.clientx.com',
    'http://localhost:9200',
    'http://localhost:8787',
    'null',
    'not-an-origin',
  ])('refuses %s in every environment', (origin) => {
    expect(isOriginAllowed(origin, 'production')).toBe(false);
    expect(isOriginAllowed(origin, 'development')).toBe(false);
  });

  it('canonicalises the request origin (case, default port)', () => {
    expect(isOriginAllowed('https://APP.estalara.com:443', 'production')).toBe(true);
  });
});
