// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { parsePrice } from '../utils/price-parser.js';
import { formatPrice } from '../utils/currency-formatter.js';

// ---------------------------------------------------------------------------
// Price parser
// ---------------------------------------------------------------------------
describe('parsePrice', () => {
  // European dot-thousands (Bazaraki)
  it('parses €335.000 as 335000 EUR (dot = thousands separator)', () => {
    const result = parsePrice('€335.000');
    expect(result).not.toBeNull();
    expect(result!.value).toBe(335000);
    expect(result!.currency).toBe('EUR');
    expect(result!.raw).toBe('€335.000');
  });

  // Comma-thousands
  it('parses €239,000 as 239000 EUR', () => {
    const result = parsePrice('€239,000');
    expect(result).not.toBeNull();
    expect(result!.value).toBe(239000);
    expect(result!.currency).toBe('EUR');
  });

  // Multi-comma large number
  it('parses £3,000,000 as 3000000 GBP', () => {
    const result = parsePrice('£3,000,000');
    expect(result).not.toBeNull();
    expect(result!.value).toBe(3000000);
    expect(result!.currency).toBe('GBP');
  });

  // USD large number
  it('parses $128,000,000 as 128000000 USD', () => {
    const result = parsePrice('$128,000,000');
    expect(result).not.toBeNull();
    expect(result!.value).toBe(128000000);
    expect(result!.currency).toBe('USD');
  });

  // AED currency code prefix (Bayut)
  it('parses AED 6,800,000 as 6800000 AED', () => {
    const result = parsePrice('AED 6,800,000');
    expect(result).not.toBeNull();
    expect(result!.value).toBe(6800000);
    expect(result!.currency).toBe('AED');
  });

  // PLN currency code prefix (Engelvoelkers Warsaw)
  it('parses PLN 12,836,054 as 12836054 PLN', () => {
    const result = parsePrice('PLN 12,836,054');
    expect(result).not.toBeNull();
    expect(result!.value).toBe(12836054);
    expect(result!.currency).toBe('PLN');
  });

  // POA variants
  it('parses "Price on request" as POA', () => {
    const result = parsePrice('Price on request');
    expect(result).not.toBeNull();
    expect(result!.value).toBe('POA');
    expect(result!.currency).toBe('');
  });

  it('parses "POA" as POA', () => {
    const result = parsePrice('POA');
    expect(result).not.toBeNull();
    expect(result!.value).toBe('POA');
  });

  it('parses "Anfrage" as POA (German)', () => {
    const result = parsePrice('Anfrage');
    expect(result).not.toBeNull();
    expect(result!.value).toBe('POA');
  });

  it('parses "Prix sur demande" as POA (French)', () => {
    const result = parsePrice('Prix sur demande');
    expect(result).not.toBeNull();
    expect(result!.value).toBe('POA');
  });

  it('parses "precio a consultar" as POA (Spanish)', () => {
    const result = parsePrice('precio a consultar');
    expect(result).not.toBeNull();
    expect(result!.value).toBe('POA');
  });

  it('returns null for strings that are not prices', () => {
    expect(parsePrice('not a price')).toBeNull();
    expect(parsePrice('Click here to buy')).toBeNull();
    expect(parsePrice('')).toBeNull();
  });

  it('preserves raw string in result', () => {
    const raw = '€239,000';
    const result = parsePrice(raw);
    expect(result!.raw).toBe(raw);
  });

  // Edge cases
  it('parses plain number with currency symbol', () => {
    const result = parsePrice('€500000');
    expect(result).not.toBeNull();
    expect(result!.value).toBe(500000);
    expect(result!.currency).toBe('EUR');
  });
});

// ---------------------------------------------------------------------------
// Currency formatter
// ---------------------------------------------------------------------------
describe('formatPrice', () => {
  it('formats POA as "Price on request"', () => {
    expect(formatPrice('POA', '')).toBe('Price on request');
    expect(formatPrice('POA', 'EUR')).toBe('Price on request');
  });

  it('formats EUR value with currency symbol', () => {
    const formatted = formatPrice(335000, 'EUR', 'en-GB');
    expect(formatted).toContain('335');
    expect(formatted).toContain('000');
    // Should include currency indicator
    expect(formatted.includes('€') || formatted.includes('EUR')).toBe(true);
  });

  it('formats GBP value', () => {
    const formatted = formatPrice(1500000, 'GBP', 'en-GB');
    expect(formatted).toContain('1');
    expect(formatted).toContain('500');
    expect(formatted.includes('£') || formatted.includes('GBP')).toBe(true);
  });

  it('formats USD value', () => {
    const formatted = formatPrice(128000000, 'USD', 'en-US');
    expect(formatted).toContain('128');
    expect(formatted.includes('$') || formatted.includes('USD')).toBe(true);
  });

  it('formats without currency when currency is empty string', () => {
    const formatted = formatPrice(500000, '');
    // Should be a plain number, no currency prefix
    expect(formatted).toContain('500');
    expect(formatted).not.toContain('€');
    expect(formatted).not.toContain('£');
    expect(formatted).not.toContain('$');
  });

  it('uses default locale when none provided', () => {
    // Should not throw
    expect(() => formatPrice(300000, 'EUR')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AI Vision — null when ANTHROPIC_API_KEY missing
// ---------------------------------------------------------------------------
describe('detectAiVision', () => {
  beforeEach(() => {
    // Ensure API key is not set in test environment.
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns null when ANTHROPIC_API_KEY is not set (no throw)', async () => {
    // Dynamic import to match real usage pattern.
    const { detectAiVision } = await import('../techniques/ai-vision.js');
    const result = await detectAiVision('<html><body></body></html>', 'https://example.com/');
    expect(result).toBeNull();
  });

  it('returns null gracefully — does not throw', async () => {
    const { detectAiVision } = await import('../techniques/ai-vision.js');
    await expect(
      detectAiVision('<html><body></body></html>', 'https://example.com/'),
    ).resolves.toBeNull();
  });

  it('returns null when ANTHROPIC_API_KEY is empty string', async () => {
    process.env.ANTHROPIC_API_KEY = '';
    const { detectAiVision } = await import('../techniques/ai-vision.js');
    const result = await detectAiVision('<html><body></body></html>', 'https://example.com/');
    // Empty string is falsy — should return null without calling API.
    expect(result).toBeNull();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns null when called with no API key after a previous null result (idempotent)', async () => {
    // Verify the module is safe to call multiple times with no key.
    delete process.env.ANTHROPIC_API_KEY;
    const { detectAiVision } = await import('../techniques/ai-vision.js');
    const result1 = await detectAiVision('<html><body></body></html>', 'https://example.com/');
    const result2 = await detectAiVision('<html><body></body></html>', 'https://example.com/');
    expect(result1).toBeNull();
    expect(result2).toBeNull();
  });
});
