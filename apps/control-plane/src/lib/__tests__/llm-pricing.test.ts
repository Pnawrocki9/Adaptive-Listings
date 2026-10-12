/**
 * FOLLOW-1297 (ADR-0023 §3): every id in `ALLOWED_GENERATION_MODELS` carries an explicit price no
 * lower than the rate the Python job billed it at (Haiku 0.00025/0.00125, Sonnet 0.003/0.015,
 * unknown ids at the Sonnet rate), so `claude-opus-4-8` is no longer under-billed against the cap.
 */
import { describe, expect, it } from 'vitest';
import { computeCost } from '@/lib/llm-pricing';
import { ALLOWED_GENERATION_MODELS } from '@/lib/global-config-store';

/** Per-1k USD the Python job billed each id at (`_llm_cost_usd`: substring match, else Sonnet). */
const PYTHON_RATE: Record<string, readonly [number, number]> = {
  'claude-haiku-4-5-20251001': [0.00025, 0.00125],
  'claude-sonnet-4-6': [0.003, 0.015],
  'claude-opus-4-8': [0.003, 0.015], // the Python's "unknown ⇒ Sonnet" fallback
};
/** The gateway's historical default for an id with no explicit price. */
const DEFAULT_RATE: readonly [number, number] = [0.001, 0.005];

describe('llm-pricing', () => {
  it('prices every allow-listed generation model explicitly, at or above the Python rate', () => {
    for (const id of ALLOWED_GENERATION_MODELS) {
      const [pyIn, pyOut] = PYTHON_RATE[id]!;
      const inputOnly = computeCost(id, 1000, 0);
      const outputOnly = computeCost(id, 0, 1000);
      // Explicit: not the default rate for either direction.
      expect([inputOnly, outputOnly], id).not.toEqual(DEFAULT_RATE);
      expect(inputOnly, id).toBeGreaterThanOrEqual(pyIn);
      expect(outputOnly, id).toBeGreaterThanOrEqual(pyOut);
    }
  });

  it('keeps the adapt path prices for Haiku and Sonnet unchanged', () => {
    expect(computeCost('claude-haiku-4-5', 1000, 1000)).toBe(0.0015);
    expect(computeCost('claude-sonnet-4-6', 1000, 1000)).toBe(0.018);
  });

  it('bills Opus above the Sonnet rate, and an unknown id at the historical default', () => {
    expect(computeCost('claude-opus-4-8', 1000, 1000)).toBeGreaterThan(
      computeCost('claude-sonnet-4-6', 1000, 1000),
    );
    expect(computeCost('some-other-model', 1000, 1000)).toBe(0.006);
  });

  it('rounds to 6 decimals', () => {
    expect(computeCost('claude-sonnet-4-6', 3, 7)).toBe(0.000114);
  });
});
