/**
 * Tests for tracer schemas in packages/shared/src/schemas/tracer.ts.
 *
 * Focus: IntentConfigResponseSchema data_source enum widening (FOLLOW-299, RETRO-070 CB-1).
 *
 * Coverage:
 *   ENUM-1: data_source: 'live' accepted
 *   ENUM-2: data_source: 'mock' accepted
 *   ENUM-3: data_source: 'error' accepted (FOLLOW-299 widening)
 *   ENUM-4: unknown data_source value rejected
 *   OPTIONAL-1: weights field is optional (absent on error path)
 *   OPTIONAL-2: effective_at field is optional (absent on error path)
 *   OPTIONAL-3: is_tenant_specific field is optional (absent on error path)
 *   DISTINCT-1: 'error' and 'mock' are distinct — SDK can branch for telemetry (RETRO-070 CB-1)
 *   COMPAT-1: error-path body (no weights) safeParsed successfully → data_source readable
 *   COMPAT-2: live-path body (with weights) safeParsed successfully → data_source readable
 *
 * Rule H: non-test consumer is apps/control-plane/src/app/api/intent/config/route.ts
 * (imports IntentConfigResponseSchema indirectly via the IntentConfigResponse type from
 * @estalara/shared).
 *
 * @module @estalara/shared/schemas/tracer.test
 */

import { describe, it, expect } from 'vitest';

import { IntentConfigResponseSchema } from './tracer.js';

describe('IntentConfigResponseSchema — data_source enum (FOLLOW-299)', () => {
  it("ENUM-1: accepts data_source: 'live' with full body", () => {
    const result = IntentConfigResponseSchema.safeParse({
      weights: { behavioral_damping: 0.3 },
      effective_at: '2026-06-13T10:00:00.000Z',
      is_tenant_specific: true,
      data_source: 'live',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data_source).toBe('live');
    }
  });

  it("ENUM-2: accepts data_source: 'mock' with empty weights", () => {
    const result = IntentConfigResponseSchema.safeParse({
      weights: {},
      effective_at: '2026-06-13T10:00:00.000Z',
      is_tenant_specific: false,
      data_source: 'mock',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data_source).toBe('mock');
    }
  });

  it("ENUM-3: accepts data_source: 'error' (FOLLOW-299 widening — previously missing from enum)", () => {
    // This is the value the route emits on HTTP 500 (configured-but-failed DB).
    // Before FOLLOW-299 this value was NOT in the enum, so safeParse would reject
    // the 500 response body and the SDK could not observe the degraded signal.
    const result = IntentConfigResponseSchema.safeParse({
      data_source: 'error',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data_source).toBe('error');
    }
  });

  it('ENUM-4: rejects unknown data_source value', () => {
    const result = IntentConfigResponseSchema.safeParse({
      data_source: 'degraded',
      weights: {},
    });
    expect(result.success).toBe(false);
  });

  it('OPTIONAL-1: weights field is optional — absent on error path', () => {
    const result = IntentConfigResponseSchema.safeParse({
      data_source: 'error',
      // no weights field
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.weights).toBeUndefined();
    }
  });

  it('OPTIONAL-2: effective_at field is optional — absent on error path', () => {
    const result = IntentConfigResponseSchema.safeParse({
      data_source: 'error',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.effective_at).toBeUndefined();
    }
  });

  it('OPTIONAL-3: is_tenant_specific field is optional — absent on error path', () => {
    const result = IntentConfigResponseSchema.safeParse({
      data_source: 'error',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.is_tenant_specific).toBeUndefined();
    }
  });

  it("DISTINCT-1: 'error' and 'mock' are distinct values — SDK can branch for telemetry (RETRO-070 CB-1)", () => {
    // Regression guard: before FOLLOW-299, the SDK could not distinguish a DB outage
    // (configured-but-failed, route returns 'error') from a clean no-config state
    // (unconfigured DB or no active row, route returns 'mock'). Both MUST be parseable
    // AND distinguishable from the same schema so the SDK can emit different telemetry.
    const errorResult = IntentConfigResponseSchema.safeParse({ data_source: 'error' });
    const mockResult = IntentConfigResponseSchema.safeParse({
      data_source: 'mock',
      weights: {},
      effective_at: new Date().toISOString(),
      is_tenant_specific: false,
    });

    expect(errorResult.success).toBe(true);
    expect(mockResult.success).toBe(true);

    if (errorResult.success && mockResult.success) {
      expect(errorResult.data.data_source).toBe('error');
      expect(mockResult.data.data_source).toBe('mock');
      expect(errorResult.data.data_source).not.toBe(mockResult.data.data_source);
    }
  });

  it('COMPAT-1: HTTP 500 error body (with extra error field) safeParsed successfully — data_source readable', () => {
    // Simulate the exact JSON body the route emits on DB failure:
    // { error: { code: 'db_error', message: '...' }, data_source: 'error' }
    // The schema does NOT declare an 'error' field, but Zod strips unknown keys by default
    // (without .strict()), so safeParse succeeds and data_source is readable.
    const http500Body = {
      error: { code: 'db_error', message: 'Postgres query failed — see Sentry for details' },
      data_source: 'error',
    };
    const result = IntentConfigResponseSchema.safeParse(http500Body);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data_source).toBe('error');
      expect(result.data.weights).toBeUndefined();
    }
  });

  it('COMPAT-2: HTTP 200 live body safeParsed successfully — data_source and weights readable', () => {
    const http200Body = {
      weights: { behavioral_damping: 0.22, priors: { neutral: 0.5, family_buyer: 0.07 } },
      effective_at: '2026-06-13T10:00:00.000Z',
      is_tenant_specific: true,
      data_source: 'live',
    };
    const result = IntentConfigResponseSchema.safeParse(http200Body);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data_source).toBe('live');
      expect(result.data.weights?.behavioral_damping).toBe(0.22);
      expect(result.data.is_tenant_specific).toBe(true);
    }
  });
});
