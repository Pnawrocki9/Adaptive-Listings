/**
 * Unit tests for the negative-cache NEUTRAL verdict extension to
 * `DescriptionCacheValueSchema` (FOLLOW-465 / audit F-18).
 *
 * @module @estalara/shared/schemas/description.test
 */

import { describe, expect, it } from 'vitest';

import { DescriptionCacheValueSchema, DescriptionVerdictSchema } from './description.js';

describe('DescriptionVerdictSchema', () => {
  it('accepts FIT and NEUTRAL', () => {
    expect(DescriptionVerdictSchema.safeParse('FIT').success).toBe(true);
    expect(DescriptionVerdictSchema.safeParse('NEUTRAL').success).toBe(true);
  });

  it('rejects an unknown verdict', () => {
    expect(DescriptionVerdictSchema.safeParse('MAYBE').success).toBe(false);
  });
});

describe('DescriptionCacheValueSchema', () => {
  it('accepts a normal FIT entry with non-empty text and no verdict field (implicit FIT)', () => {
    const result = DescriptionCacheValueSchema.safeParse({
      text: 'A lovely property in a quiet area.',
      headline: 'Quiet living, close to everything',
      generated_at: '2026-05-14T12:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty text when verdict is absent (implicit FIT)', () => {
    const result = DescriptionCacheValueSchema.safeParse({
      text: '',
      generated_at: '2026-05-14T12:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty text when verdict is explicitly FIT', () => {
    const result = DescriptionCacheValueSchema.safeParse({
      text: '',
      generated_at: '2026-05-14T12:00:00.000Z',
      verdict: 'FIT',
    });
    expect(result.success).toBe(false);
  });

  it('accepts an empty text (negative-cache marker) when verdict is NEUTRAL', () => {
    const result = DescriptionCacheValueSchema.safeParse({
      text: '',
      headline: null,
      generated_at: '2026-05-14T12:00:00.000Z',
      verdict: 'NEUTRAL',
    });
    expect(result.success).toBe(true);
  });

  it('still accepts a non-empty text with verdict NEUTRAL (not required to be empty)', () => {
    const result = DescriptionCacheValueSchema.safeParse({
      text: 'ignored',
      generated_at: '2026-05-14T12:00:00.000Z',
      verdict: 'NEUTRAL',
    });
    expect(result.success).toBe(true);
  });
});
