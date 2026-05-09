import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, readConfig } from '../core/config.js';

/** Minimal mock of a script element's dataset */
function makeDataset(attrs: Record<string, string>): Record<string, string | undefined> {
  return attrs;
}

describe('readConfig', () => {
  it('reads data-api-key from the script dataset', () => {
    const dataset = makeDataset({ apiKey: 'est_live_abc123' });
    const cfg = readConfig({ dataset });
    expect(cfg.apiKey).toBe('est_live_abc123');
  });

  it('uses DEFAULT_CONFIG values for missing attributes', () => {
    const dataset = makeDataset({ apiKey: 'est_live_xyz' });
    const cfg = readConfig({ dataset });
    expect(cfg.ingestUrl).toBe(DEFAULT_CONFIG.ingestUrl);
    expect(cfg.tier).toBe(DEFAULT_CONFIG.tier);
    expect(cfg.debug).toBe(false);
    expect(cfg.consentState).toBe(DEFAULT_CONFIG.consentState);
  });

  it('reads data-tier, data-debug, data-ingest-url when provided', () => {
    const dataset = makeDataset({
      apiKey: 'est_live_xyz',
      tier: 'augment',
      debug: 'true',
      ingestUrl: 'https://custom.ingest.example.com/v1/events',
    });
    const cfg = readConfig({ dataset });
    expect(cfg.tier).toBe('augment');
    expect(cfg.debug).toBe(true);
    expect(cfg.ingestUrl).toBe('https://custom.ingest.example.com/v1/events');
  });

  it('throws if data-api-key is missing', () => {
    const dataset = makeDataset({});
    expect(() => readConfig({ dataset })).toThrow('data-api-key is required');
  });

  it('falls back to default tier for invalid tier value', () => {
    const dataset = makeDataset({ apiKey: 'k', tier: 'invalid_tier' });
    const cfg = readConfig({ dataset });
    expect(cfg.tier).toBe(DEFAULT_CONFIG.tier);
  });
});
