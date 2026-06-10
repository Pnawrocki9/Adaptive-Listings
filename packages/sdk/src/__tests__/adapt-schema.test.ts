// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';

import { adaptResponseSchema } from '../core/adapt-schema.js';
import { fetchDirectives, resetAdaptState } from '../core/adapt.js';
import type { SdkConfig } from '../core/config.js';
import type { SessionState } from '../core/session.js';

/**
 * FOLLOW-105 §F.5 / ADR-0006 §Decision 5A — runtime validation of the adapt
 * response against the canonical AdaptationDirectives contract.
 *
 * Two surfaces are covered:
 *   1. `adaptResponseSchema.parse()` directly (valid / missing / mismatch / enum / passthrough).
 *   2. `fetchDirectives()` end-to-end: a parse failure must report to Sentry (when
 *      available) and resolve to `null` — never throw.
 */

// ── A valid canonical response (every required field present, valid enum) ──────
const VALID_RESPONSE = {
  adapt_decision_id: '11111111-1111-4111-8111-111111111111',
  session_id: 'sess-001',
  archetype: 'yield_hunter',
  confidence: 0.87,
  similarity: 0.91,
  tier: 1 as const,
  directives: [
    {
      type: 'text' as const,
      slot: 'hero_headline',
      value: 'High-yield investment opportunities',
      archetype: 'yield_hunter',
      confidence: 0.87,
    },
  ],
  source: 'playbook' as const,
  generated_at: '2026-05-25T00:00:00.000Z',
};

const BASE_CONFIG: SdkConfig = {
  apiKey: 'EXAMPLE_api_key',
  ingestUrl: 'https://ingest.estalara.com/v1/events',
  tier: 'observer',
  debug: false,
  consentState: 'legitimate_interest',
  language: 'en',
  accentColor: '#6c5ce7',
  decisionApiUrl: 'https://admin.estalara.com/api',
  tenantId: '550e8400-e29b-41d4-a716-446655440000',
};

const SESSION: SessionState = {
  sessionId: 'sess-001',
  startedAt: Date.now(),
  pageCount: 1,
};

// ─────────────────────────────────────────────────────────────────────────────
// adaptResponseSchema.parse — direct
// ─────────────────────────────────────────────────────────────────────────────

describe('adaptResponseSchema.parse', () => {
  it('parses a fully valid canonical response', () => {
    const parsed = adaptResponseSchema.parse(VALID_RESPONSE);
    expect(parsed.adapt_decision_id).toBe('11111111-1111-4111-8111-111111111111');
    expect(parsed.archetype).toBe('yield_hunter');
    expect(parsed.directives).toHaveLength(1);
  });

  it('throws when a required field is missing (adapt_decision_id)', () => {
    const { adapt_decision_id: _omit, ...withoutId } = VALID_RESPONSE;
    void _omit;
    expect(() => adaptResponseSchema.parse(withoutId)).toThrow();
  });

  it('throws when a required field is missing (generated_at)', () => {
    const { generated_at: _omit, ...withoutTs } = VALID_RESPONSE;
    void _omit;
    expect(() => adaptResponseSchema.parse(withoutTs)).toThrow();
  });

  it('throws on a type mismatch (confidence as string)', () => {
    expect(() => adaptResponseSchema.parse({ ...VALID_RESPONSE, confidence: 'high' })).toThrow();
  });

  it('throws on an out-of-enum archetype value', () => {
    expect(() => adaptResponseSchema.parse({ ...VALID_RESPONSE, archetype: 'investor' })).toThrow();
  });

  it('throws on an invalid tier (4 is not 1|2|3)', () => {
    expect(() => adaptResponseSchema.parse({ ...VALID_RESPONSE, tier: 4 })).toThrow();
  });

  it('allows unknown / extra fields (passthrough — forward-compatible)', () => {
    const withExtra = {
      ...VALID_RESPONSE,
      holdout_group: true,
      explainability_id: 'future-field-not-yet-modelled',
      some_brand_new_field: { nested: 'value' },
    };
    const parsed = adaptResponseSchema.parse(withExtra) as Record<string, unknown>;
    // Extra fields are preserved, not stripped.
    expect(parsed.holdout_group).toBe(true);
    expect(parsed.explainability_id).toBe('future-field-not-yet-modelled');
    expect(parsed.some_brand_new_field).toEqual({ nested: 'value' });
  });

  it("accepts the 'neutral' fallback archetype", () => {
    const parsed = adaptResponseSchema.parse({ ...VALID_RESPONSE, archetype: 'neutral' });
    expect(parsed.archetype).toBe('neutral');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fetchDirectives — Sentry + null path on parse failure
// ─────────────────────────────────────────────────────────────────────────────

describe('fetchDirectives — Zod validation path', () => {
  beforeEach(() => {
    resetAdaptState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { Sentry?: unknown }).Sentry;
    resetAdaptState();
  });

  it('returns a validated response on a valid body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(VALID_RESPONSE) })),
    );
    const { adaptResponse: result } = await fetchDirectives(BASE_CONFIG, SESSION, 'listing_list');
    expect(result).not.toBeNull();
    expect(result?.archetype).toBe('yield_hunter');
  });

  it('returns null when a required field is missing', async () => {
    const { similarity: _omit, ...invalid } = VALID_RESPONSE;
    void _omit;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(invalid) })),
    );
    const { adaptResponse: result } = await fetchDirectives(BASE_CONFIG, SESSION, 'listing_list');
    expect(result).toBeNull();
  });

  it('returns null on a type mismatch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...VALID_RESPONSE, tier: 'one' }),
        }),
      ),
    );
    const { adaptResponse: result } = await fetchDirectives(BASE_CONFIG, SESSION, 'listing_list');
    expect(result).toBeNull();
  });

  it('returns null on an out-of-enum archetype value', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...VALID_RESPONSE, archetype: 'investor' }),
        }),
      ),
    );
    const { adaptResponse: result } = await fetchDirectives(BASE_CONFIG, SESSION, 'listing_list');
    expect(result).toBeNull();
  });

  it('accepts a body with extra/unknown fields (passthrough)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...VALID_RESPONSE, holdout_group: false, future: 42 }),
        }),
      ),
    );
    const { adaptResponse: result } = await fetchDirectives(BASE_CONFIG, SESSION, 'listing_list');
    expect(result).not.toBeNull();
    expect(result?.archetype).toBe('yield_hunter');
  });

  it('reports the parse failure to Sentry when available, then returns null', async () => {
    const captureException = vi.fn();
    (globalThis as { Sentry?: { captureException: (e: unknown) => void } }).Sentry = {
      captureException,
    };
    const { archetype: _omit, ...invalid } = VALID_RESPONSE;
    void _omit;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(invalid) })),
    );

    const { adaptResponse: result } = await fetchDirectives(BASE_CONFIG, SESSION, 'listing_list');
    expect(result).toBeNull();
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('does not throw when Sentry is absent and the body is invalid', async () => {
    delete (globalThis as { Sentry?: unknown }).Sentry;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ garbage: true }) })),
    );
    const { adaptResponse } = await fetchDirectives(BASE_CONFIG, SESSION, 'listing_list');
    expect(adaptResponse).toBeNull();
  });
});
