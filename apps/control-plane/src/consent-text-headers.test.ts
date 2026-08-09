/**
 * FOLLOW-929 — the consent-text document must be readable CROSS-ORIGIN.
 *
 * WHY THIS TEST EXISTS, AND WHY IT IS NOT REDUNDANT WITH THE E2E. The SDK reads
 * `consent-text.json` with `fetch(..., { mode: 'cors' })` from the TENANT's origin, so the
 * response is discarded unless the control-plane sends `Access-Control-Allow-Origin`. ADR-0021
 * §D2 reasoned that the document is safe because it is *"served from the same origin as
 * `sdk.js`"* — but `sdk.js` is loaded by `<script src>`, which is not subject to CORS. The
 * substitution shipped, and every first-visit browser would have failed closed (§D4): no banner,
 * null `init()`.
 *
 * The SDK E2E cannot catch this. `packages/sdk/e2e/consent.spec.ts` fulfils the request through
 * `page.route` and SUPPLIES the header itself — a fixture standing in for the producer it is
 * supposed to be testing. That is exactly the class this test closes.
 *
 * The `source` is DERIVED from `CONSENT_TEXT_URL`, never hardcoded: changing the URL without
 * changing the header rule is the regression this file exists to fail on.
 */
import { describe, it, expect } from 'vitest';
import { CONSENT_TEXT_URL } from '@estalara/shared';
import nextConfig from '../next.config.mjs';

/** The §D2 wire contract, restated here so a silent weakening of the TTL fails. */
const EXPECTED_CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=60';

/** Shape declared in `src/next-config.d.ts`. */
interface HeaderRule { source: string; headers: { key: string; value: string }[] }

async function rules(): Promise<HeaderRule[]> {
  const headers = nextConfig.headers;
  expect(typeof headers, 'next.config.mjs defines no headers() at all').toBe('function');
  return await headers!();
}

function valueOf(rule: HeaderRule, key: string): string | undefined {
  return rule.headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;
}

describe('FOLLOW-929 — consent-text.json response headers', () => {
  it('has a header rule whose source matches the path the SDK actually fetches', async () => {
    const path = new URL(CONSENT_TEXT_URL).pathname;
    const rule = (await rules()).find((r) => r.source === path);
    expect(
      rule,
      `no header rule for ${path} — the SDK fetches it cross-origin and will fail closed`,
    ).toBeDefined();
  });

  it('sends Access-Control-Allow-Origin, or the browser discards the response', async () => {
    const path = new URL(CONSENT_TEXT_URL).pathname;
    const rule = (await rules()).find((r) => r.source === path)!;
    // Wildcard, not an allowlist: §D3 forbids the response varying by tenant, and the request
    // carries no credentials — the two conditions that make `*` correct rather than lax.
    expect(valueOf(rule, 'Access-Control-Allow-Origin')).toBe('*');
  });

  it('sends the §D2 Cache-Control contract', async () => {
    const path = new URL(CONSENT_TEXT_URL).pathname;
    const rule = (await rules()).find((r) => r.source === path)!;
    expect(valueOf(rule, 'Cache-Control')).toBe(EXPECTED_CACHE_CONTROL);
  });
});
