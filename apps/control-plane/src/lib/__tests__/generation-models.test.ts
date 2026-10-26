/**
 * FOLLOW-1377 — the generation-model catalog: one entry per allow-listed id (both allow-lists),
 * 4.x requests unchanged, and the settings hint derived from the billing prices.
 */
import { describe, expect, it } from 'vitest';
import {
  GENERATION_MODELS,
  generationModelHint,
  generationRequestFor,
} from '@/lib/generation-models';
import { ALLOWED_GENERATION_MODELS } from '@/lib/global-config-store';
import { DEMO_ALLOWED_MODELS } from '@/lib/demo-override-store';
import { computeCost } from '@/lib/llm-pricing';

describe('generation-models', () => {
  it('has exactly one entry per id in both allow-lists', () => {
    expect(Object.keys(GENERATION_MODELS).sort()).toEqual([...ALLOWED_GENERATION_MODELS].sort());
    expect([...DEMO_ALLOWED_MODELS].sort()).toEqual([...ALLOWED_GENERATION_MODELS].sort());
  });

  it('carries the four 5.x ids and keeps the three 4.x ids', () => {
    expect(ALLOWED_GENERATION_MODELS).toEqual([
      'claude-haiku-4-5-20251001',
      'claude-haiku-5-5',
      'claude-sonnet-4-6',
      'claude-sonnet-5-5',
      'claude-opus-4-8',
      'claude-opus-5-5',
      'claude-fable-5-1',
    ]);
  });

  it.each(['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-8', 'unknown-id'])(
    '%s: the 4.x budget comes back unchanged, with no extra field',
    (model) => {
      for (const base of [60, 450, 512, 2000]) {
        expect(generationRequestFor(model, base)).toEqual({ maxTokens: base, extras: {} });
      }
    },
  );

  it('scales a 5.x budget by the tokenizer factor and adds the reserve', () => {
    expect(generationRequestFor('claude-haiku-5-5', 450).maxTokens).toBe(1020);
    // FOLLOW-1403: Sonnet 5.5 still thinks on some calls at between_tools + low; its own reserve.
    expect(generationRequestFor('claude-sonnet-5-5', 450).maxTokens).toBe(6720);
    expect(generationRequestFor('claude-sonnet-5-5', 60).maxTokens).toBe(6096);
    expect(generationRequestFor('claude-opus-5-5', 2000).maxTokens).toBe(5200);
    expect(generationRequestFor('claude-fable-5-1', 60).maxTokens).toBe(2096);
  });

  it('derives the per-description cost from llm-pricing, not from a hard-coded figure', () => {
    for (const model of ALLOWED_GENERATION_MODELS) {
      const m = GENERATION_MODELS[model].measured;
      expect(m.descriptionTokensIn, model).toBeGreaterThan(0);
      expect(m.p50Ms, model).toBeGreaterThan(0);
      expect(generationModelHint(model)?.costPerDescriptionUsd, model).toBeCloseTo(
        computeCost(model, m.descriptionTokensIn, m.descriptionTokensOut) +
          computeCost(model, m.headlineTokensIn, m.headlineTokensOut),
        6,
      );
    }
    expect(generationModelHint('unknown-id')).toBeNull();
  });

  it('orders the hints the way the measurements did (cheapest Haiku 5.5, dearest Fable 5.1)', () => {
    const cost = (m: string) => generationModelHint(m)!.costPerDescriptionUsd;
    for (const m of ALLOWED_GENERATION_MODELS) {
      expect(cost('claude-haiku-5-5')).toBeLessThanOrEqual(cost(m));
      expect(cost('claude-fable-5-1')).toBeGreaterThanOrEqual(cost(m));
    }
  });
});
