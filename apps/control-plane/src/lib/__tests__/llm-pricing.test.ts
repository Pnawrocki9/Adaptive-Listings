/**
 * FOLLOW-1297 (ADR-0023 §3): every id in `ALLOWED_GENERATION_MODELS` carries an explicit price.
 * FOLLOW-1377: the prices are Anthropic's base list prices (read 2026-10-22). Two ids were billed
 * off-list before: Haiku 4.5 at 0.00025 / 0.00125 (4x under) and Opus 4.8 at 0.015 / 0.075 (3x
 * over). These rows feed the daily spend cap, so each one is pinned.
 */
import { describe, expect, it } from 'vitest';
import { computeCost } from '@/lib/llm-pricing';
import { ALLOWED_GENERATION_MODELS } from '@/lib/global-config-store';

/** USD per MILLION tokens `[input, output]`, as the pricing page states them. */
const LIST_PRICE_PER_MTOK: Record<string, readonly [number, number]> = {
  'claude-haiku-4-5': [1, 5],
  'claude-haiku-4-5-20251001': [1, 5],
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-sonnet-4-6': [3, 15],
  'claude-sonnet-5-5': [2, 10],
  'claude-opus-4-8': [5, 25],
  'claude-opus-5-5': [4, 20],
  'claude-fable-5-1': [10, 50],
};

describe('llm-pricing', () => {
  it('bills every priced id at its list price, input and output separately', () => {
    for (const [id, [inPerM, outPerM]] of Object.entries(LIST_PRICE_PER_MTOK)) {
      expect(computeCost(id, 1_000_000, 0), id).toBe(inPerM);
      expect(computeCost(id, 0, 1_000_000), id).toBe(outPerM);
    }
  });

  it('prices every allow-listed generation model explicitly', () => {
    for (const id of ALLOWED_GENERATION_MODELS) {
      expect(LIST_PRICE_PER_MTOK[id], id).toBeDefined();
    }
  });

  it('corrects the two off-list rates (FOLLOW-1377)', () => {
    // Haiku 4.5 was 0.0015 per 1k in + 1k out (4x under); Opus 4.8 was 0.09 (3x over).
    expect(computeCost('claude-haiku-4-5-20251001', 1000, 1000)).toBe(0.006);
    expect(computeCost('claude-haiku-4-5', 1000, 1000)).toBe(0.006);
    expect(computeCost('claude-opus-4-8', 1000, 1000)).toBe(0.03);
    expect(computeCost('claude-sonnet-4-6', 1000, 1000)).toBe(0.018);
  });

  it('bills an unknown id at the historical default', () => {
    expect(computeCost('some-other-model', 1000, 1000)).toBe(0.006);
  });

  it('rounds to 6 decimals', () => {
    expect(computeCost('claude-sonnet-4-6', 3, 7)).toBe(0.000114);
  });
});
