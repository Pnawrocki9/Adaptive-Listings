/**
 * FOLLOW-623 / ADR-0019 — SDK consumption of the per-tenant `brand` slice.
 *
 * These are the Rule L "consumer" unit tests for the brand slice: they assert that the SDK
 * actually READS `PresentationConfigResponse.brand` from the runtime `/api/quiz/public-config`
 * fetch and overlays it onto `SdkConfig.brand` (snake_case wire → camelCase SdkConfig). The
 * REAL end-to-end init path (fetch → merge → rendered widget color/logo) is covered by
 * `packages/sdk/e2e/brand.spec.ts` (per the evidence requirement — not a value-injecting test).
 *
 * D4 defaults invariant: an absent brand slice leaves `SdkConfig.brand` undefined, so the
 * widget renderers fall back to their hardcoded defaults (byte-identical to pre-ADR-0019).
 *
 * @module packages/sdk/__tests__/follow-623
 */

import { describe, expect, it } from 'vitest';

import { mergeQuizConfig } from '../index.js';
import { readConfig } from '../core/config.js';
import type { PresentationConfigResponse } from '@estalara/shared';

const baseConfig = readConfig({
  dataset: { apiKey: 'EXAMPLE_api_key_brand', decisionUrl: 'https://admin.estalara.com/api' },
});

describe('FOLLOW-623 — mergeQuizConfig() overlays the brand slice onto SdkConfig', () => {
  it('maps a full brand slice (snake_case wire → camelCase SdkConfig)', () => {
    const fetched: PresentationConfigResponse = {
      quiz_enabled: true,
      micro_polls_enabled: false,
      language: 'en',
      accent_color: '#2563EB',
      data_source: 'db',
      brand: {
        primary_color: '#1a73e8',
        logo_url: 'https://cdn.example.com/logo.svg',
        white_label: true,
      },
    };
    const merged = mergeQuizConfig(baseConfig, fetched);
    expect(merged.brand).toEqual({
      primaryColor: '#1a73e8',
      logoUrl: 'https://cdn.example.com/logo.svg',
      whiteLabel: true,
    });
  });

  it('keeps logoUrl === null (never undefined — D-nullability) when the brand has no logo', () => {
    const fetched: PresentationConfigResponse = {
      quiz_enabled: true,
      micro_polls_enabled: false,
      language: 'en',
      accent_color: '#2563EB',
      data_source: 'db',
      brand: { primary_color: '#c026d3', logo_url: null, white_label: false },
    };
    const merged = mergeQuizConfig(baseConfig, fetched);
    expect(merged.brand?.logoUrl).toBeNull();
    expect(merged.brand?.primaryColor).toBe('#c026d3');
  });

  it('D4 default: leaves brand undefined when the response has no brand slice', () => {
    const fetched: PresentationConfigResponse = {
      quiz_enabled: true,
      micro_polls_enabled: false,
      language: 'en',
      accent_color: '#2563EB',
      data_source: 'db',
    };
    const merged = mergeQuizConfig(baseConfig, fetched);
    expect(merged.brand).toBeUndefined();
  });

  it('D4 default: leaves brand undefined when the fetch returned null (network error)', () => {
    const merged = mergeQuizConfig(baseConfig, null);
    expect(merged.brand).toBeUndefined();
  });

  it('does not disturb the inherited ADR-0011 fields while overlaying brand', () => {
    const fetched: PresentationConfigResponse = {
      quiz_enabled: false,
      micro_polls_enabled: true,
      language: 'pl',
      accent_color: '#ff6600',
      data_source: 'db',
      brand: { primary_color: '#1a73e8', logo_url: null, white_label: false },
    };
    const merged = mergeQuizConfig(baseConfig, fetched);
    expect(merged.quiz?.enabled).toBe(false);
    expect(merged.microPollsEnabled).toBe(true);
    expect(merged.language).toBe('pl');
    expect(merged.accentColor).toBe('#ff6600');
    expect(merged.brand?.primaryColor).toBe('#1a73e8');
  });
});
