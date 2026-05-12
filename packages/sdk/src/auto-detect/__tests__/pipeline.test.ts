// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { detectSiteSchema } from '../pipeline.js';

describe('detectSiteSchema pipeline', () => {
  it('returns null schema with ai_vision technique when no pattern matches', async () => {
    const result = await detectSiteSchema(
      '<html><body><p>hello</p></body></html>',
      'https://example.com',
      'tenant-1',
    );
    expect(result.schema).toBeNull();
    expect(result.technique).toBe('ai_vision');
    expect(result.confidence).toBe(0);
    expect(result.warnings.some((w) => w.includes('AUTO-004'))).toBe(true);
  });

  it('injects tenantId into the detected schema', async () => {
    const html = `<html><body>
      <div data-estalara-listing-id="1">
        <span data-estalara-slot="price">€200,000</span>
        <img src="/photo.jpg" />
      </div>
      <div data-estalara-listing-id="2">
        <span data-estalara-slot="price">€250,000</span>
        <img src="/photo2.jpg" />
      </div>
    </body></html>`;
    const result = await detectSiteSchema(html, 'https://app.estalara.com/listings', 'my-tenant');
    expect(result.schema).not.toBeNull();
    expect(result.schema!.tenant_id).toBe('my-tenant');
  });

  it('accumulates warnings from failed techniques', async () => {
    // A page with no detectable patterns.
    const result = await detectSiteSchema(
      '<html><body><div class="nothing-relevant"></div></body></html>',
      'https://unknown.com',
      't1',
    );
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
