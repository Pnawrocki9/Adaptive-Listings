import { describe, expect, it, vi, afterEach } from 'vitest';

import { DEFAULT_CONFIG, readConfig } from '../core/config.js';

/** Minimal mock of a script element's dataset */
function makeDataset(attrs: Record<string, string>): Record<string, string | undefined> {
  return attrs;
}

describe('readConfig', () => {
  it('reads data-api-key from the script dataset', () => {
    const dataset = makeDataset({ apiKey: 'EXAMPLE_api_key_abc123' });
    const cfg = readConfig({ dataset });
    expect(cfg.apiKey).toBe('EXAMPLE_api_key_abc123');
  });

  it('uses DEFAULT_CONFIG values for missing attributes', () => {
    const dataset = makeDataset({ apiKey: 'EXAMPLE_api_key_xyz' });
    const cfg = readConfig({ dataset });
    expect(cfg.ingestUrl).toBe(DEFAULT_CONFIG.ingestUrl);
    expect(cfg.tier).toBe(DEFAULT_CONFIG.tier);
    expect(cfg.debug).toBe(false);
    expect(cfg.consentState).toBe(DEFAULT_CONFIG.consentState);
  });

  it('reads data-tier, data-debug, data-ingest-url when provided', () => {
    const dataset = makeDataset({
      apiKey: 'EXAMPLE_api_key_xyz',
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

  it('reads data-inquiry-submit-selector when provided', () => {
    const dataset = makeDataset({
      apiKey: 'EXAMPLE_api_key_xyz',
      inquirySubmitSelector: "[data-estalara-slot='inquiry-submit']",
    });
    const cfg = readConfig({ dataset });
    expect(cfg.inquirySubmitSelector).toBe("[data-estalara-slot='inquiry-submit']");
  });

  it('omits inquirySubmitSelector from config when attribute is absent', () => {
    const dataset = makeDataset({ apiKey: 'EXAMPLE_api_key_xyz' });
    const cfg = readConfig({ dataset });
    expect(cfg.inquirySubmitSelector).toBeUndefined();
  });
});

describe('readConfig — language resolution (4-level priority chain)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * AC1: No data-language attr + navigator.language = 'pl-PL' → 'pl'
   * Level 3 (navigator.language) kicks in when data-language is absent.
   */
  it('AC1: uses navigator.language primary subtag when data-language is absent (pl-PL → pl)', () => {
    vi.stubGlobal('navigator', { language: 'pl-PL' });
    const dataset = makeDataset({ apiKey: 'EXAMPLE_api_key_xyz' });
    const cfg = readConfig({ dataset });
    expect(cfg.language).toBe('pl');
  });

  /**
   * AC2: No data-language attr + navigator.language = 'de-DE' (unsupported) → 'en'
   * Level 3 produces unsupported lang; falls through to level 4 ('en').
   */
  it('AC2: falls back to en when navigator.language is unsupported (de-DE → en)', () => {
    vi.stubGlobal('navigator', { language: 'de-DE' });
    const dataset = makeDataset({ apiKey: 'EXAMPLE_api_key_xyz' });
    const cfg = readConfig({ dataset });
    expect(cfg.language).toBe('en');
  });

  /**
   * AC3: data-language="en" takes priority over navigator.language regardless of browser setting.
   * Level 2 wins; level 3 is never consulted.
   */
  it('AC3: data-language attr takes priority over navigator.language', () => {
    vi.stubGlobal('navigator', { language: 'pl-PL' });
    const dataset = makeDataset({ apiKey: 'EXAMPLE_api_key_xyz', language: 'en' });
    const cfg = readConfig({ dataset });
    expect(cfg.language).toBe('en');
  });

  it('data-language="es" takes priority over navigator.language', () => {
    vi.stubGlobal('navigator', { language: 'pl-PL' });
    const dataset = makeDataset({ apiKey: 'EXAMPLE_api_key_xyz', language: 'es' });
    const cfg = readConfig({ dataset });
    expect(cfg.language).toBe('es');
  });

  it('data-language="pl" takes priority over navigator.language=en', () => {
    vi.stubGlobal('navigator', { language: 'en-US' });
    const dataset = makeDataset({ apiKey: 'EXAMPLE_api_key_xyz', language: 'pl' });
    const cfg = readConfig({ dataset });
    expect(cfg.language).toBe('pl');
  });

  it('navigator.language=es-ES (supported) → es when data-language absent', () => {
    vi.stubGlobal('navigator', { language: 'es-ES' });
    const dataset = makeDataset({ apiKey: 'EXAMPLE_api_key_xyz' });
    const cfg = readConfig({ dataset });
    expect(cfg.language).toBe('es');
  });

  it('falls back to en when navigator is not available (SSR/worker context)', () => {
    // Simulate environment where navigator is undefined
    vi.stubGlobal('navigator', undefined);
    const dataset = makeDataset({ apiKey: 'EXAMPLE_api_key_xyz' });
    const cfg = readConfig({ dataset });
    expect(cfg.language).toBe('en');
  });
});
