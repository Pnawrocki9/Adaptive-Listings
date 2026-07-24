/**
 * Tests for the ADR-0019 unified presentation-config wire contract (FOLLOW-623 — brand slice).
 *
 * ADR-0019 "On acceptance" guardrail: ≥5 cases per new schema. Covers:
 *   - valid brand slice;
 *   - `logo_url` null vs url (ADR-0019 D-nullability: `string | null`, never `undefined`);
 *   - invalid `primary_color` (non-hex) rejection;
 *   - invalid `logo_url` (non-url) rejection;
 *   - backward-compat parse of an ADR-0011-subset response (no brand slice);
 *   - forward-compat: unknown future slices are stripped, not rejected;
 *   - the shipped wire examples validate.
 *
 * @module @estalara/shared/schemas/presentation-config.test
 */

import { describe, expect, it } from 'vitest';

import { BrandConfigSchema, PresentationConfigResponseSchema } from './presentation-config.js';
import {
  EXAMPLE_PRESENTATION_BRAND_NO_LOGO,
  EXAMPLE_PRESENTATION_CONFIG_FULL,
  EXAMPLE_PRESENTATION_CONFIG_MINIMAL,
} from '../examples/presentation-config.js';

// ─── BrandConfigSchema ──────────────────────────────────────────────────────

describe('BrandConfigSchema', () => {
  it('accepts a valid brand with an https logo_url', () => {
    const result = BrandConfigSchema.safeParse({
      primary_color: '#1a73e8',
      logo_url: 'https://cdn.example.com/logo.svg',
      white_label: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts logo_url === null (never undefined — D-nullability)', () => {
    const result = BrandConfigSchema.safeParse({
      primary_color: '#abcdef',
      logo_url: null,
      white_label: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // The parsed value keeps null explicitly — it is not coerced to undefined.
      expect(result.data.logo_url).toBeNull();
    }
  });

  it('rejects a non-hex primary_color', () => {
    const result = BrandConfigSchema.safeParse({
      primary_color: 'blue',
      logo_url: null,
      white_label: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a 3-digit hex primary_color (must be 6-digit)', () => {
    const result = BrandConfigSchema.safeParse({
      primary_color: '#abc',
      logo_url: null,
      white_label: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a logo_url that is not a URL', () => {
    const result = BrandConfigSchema.safeParse({
      primary_color: '#1a73e8',
      logo_url: 'not-a-url',
      white_label: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing white_label field', () => {
    const result = BrandConfigSchema.safeParse({
      primary_color: '#1a73e8',
      logo_url: null,
    });
    expect(result.success).toBe(false);
  });
});

// ─── PresentationConfigResponseSchema ───────────────────────────────────────

describe('PresentationConfigResponseSchema', () => {
  it('parses a full response including the brand slice', () => {
    const result = PresentationConfigResponseSchema.safeParse(EXAMPLE_PRESENTATION_CONFIG_FULL);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.brand?.primary_color).toBe('#1a73e8');
      expect(result.data.brand?.white_label).toBe(true);
    }
  });

  it('parses a branded response with logo_url null', () => {
    const result = PresentationConfigResponseSchema.safeParse(EXAMPLE_PRESENTATION_BRAND_NO_LOGO);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.brand?.logo_url).toBeNull();
    }
  });

  it('backward-compat: parses an ADR-0011-subset response with NO brand slice', () => {
    const result = PresentationConfigResponseSchema.safeParse(EXAMPLE_PRESENTATION_CONFIG_MINIMAL);
    expect(result.success).toBe(true);
    if (result.success) {
      // Absent brand slice → undefined, so the SDK falls back to hardcoded widget defaults (D4).
      expect(result.data.brand).toBeUndefined();
    }
  });

  it('preserves the inherited data_source provenance flag (Rule K.2)', () => {
    const result = PresentationConfigResponseSchema.safeParse({
      quiz_enabled: true,
      micro_polls_enabled: false,
      language: 'en',
      accent_color: '#2563EB',
      data_source: 'fallback',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data_source).toBe('fallback');
    }
  });

  it('forward-compat: strips unknown future slices instead of rejecting', () => {
    const result = PresentationConfigResponseSchema.safeParse({
      quiz_enabled: true,
      micro_polls_enabled: false,
      language: 'en',
      accent_color: '#2563EB',
      data_source: 'db',
      // A future ADR-0019 slice a shipped SDK does not yet know about.
      quiz_placement: { corner: 'top-right', offset_x: 10, offset_y: 10 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).quiz_placement).toBeUndefined();
    }
  });

  it('rejects a response whose brand slice has an invalid primary_color', () => {
    const result = PresentationConfigResponseSchema.safeParse({
      quiz_enabled: true,
      micro_polls_enabled: false,
      language: 'en',
      accent_color: '#2563EB',
      data_source: 'db',
      brand: { primary_color: 'red', logo_url: null, white_label: false },
    });
    expect(result.success).toBe(false);
  });
});
