/**
 * FOLLOW-1333 — the one browser-origin list both the control plane and the ingest Worker read.
 *
 * The property that matters most is the negative one: a production build accepts NO localhost
 * origin. It is asserted over every loopback spelling and every port the local stack uses, not
 * only over the two origins the non-production list happens to name today.
 */
import { describe, expect, it } from 'vitest';

import { isAllowedBrowserOrigin } from './browser-origins.js';

const PROD = ['https://app.estalara.com', 'https://admin.estalara.com'];
const NON_PROD_EXTRA = ['http://localhost:5173', 'http://localhost:3000'];

/** Every loopback host spelling × scheme × every port the local stack binds (and the defaults). */
const LOOPBACK_CANDIDATES = ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].flatMap((host) =>
  ['http', 'https'].flatMap((scheme) =>
    ['', ':80', ':443', ':3000', ':5173', ':8081', ':8787', ':9100', ':9200'].map(
      (port) => `${scheme}://${host}${port}`,
    ),
  ),
);

describe('isAllowedBrowserOrigin — production', () => {
  it.each(PROD)('accepts %s', (origin) => {
    expect(isAllowedBrowserOrigin(origin, true)).toBe(true);
  });

  it('accepts NO loopback origin, in any spelling or port', () => {
    const accepted = LOOPBACK_CANDIDATES.filter((o) => isAllowedBrowserOrigin(o, true));
    expect(accepted).toEqual([]);
  });

  it.each(NON_PROD_EXTRA)('refuses the non-production origin %s', (origin) => {
    expect(isAllowedBrowserOrigin(origin, true)).toBe(false);
  });
});

describe('isAllowedBrowserOrigin — outside production', () => {
  it.each([...PROD, ...NON_PROD_EXTRA])('accepts %s', (origin) => {
    expect(isAllowedBrowserOrigin(origin, false)).toBe(true);
  });

  it('accepts no loopback origin beyond :5173 and :3000 over http', () => {
    const accepted = LOOPBACK_CANDIDATES.filter((o) => isAllowedBrowserOrigin(o, false));
    expect(accepted.sort()).toEqual([...NON_PROD_EXTRA].sort());
  });
});

describe('isAllowedBrowserOrigin — canonicalisation and refusal', () => {
  it('canonicalises case and the default port before comparing', () => {
    expect(isAllowedBrowserOrigin('https://APP.Estalara.com', true)).toBe(true);
    expect(isAllowedBrowserOrigin('https://app.estalara.com:443', true)).toBe(true);
    expect(isAllowedBrowserOrigin('  https://admin.estalara.com  ', true)).toBe(true);
  });

  it.each([
    'https://evil.example',
    'https://app.estalara.com.evil.example',
    'https://estalara.com',
    'http://app.estalara.com',
    'https://app.estalara.com:8443',
    'null',
    '',
    'app.estalara.com',
    'javascript:alert(1)',
    'ftp://app.estalara.com',
  ])('refuses %j in both environments', (origin) => {
    expect(isAllowedBrowserOrigin(origin, true)).toBe(false);
    expect(isAllowedBrowserOrigin(origin, false)).toBe(false);
  });
});
