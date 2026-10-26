/**
 * The generation-model catalog (FOLLOW-1377): for every model staff can pick in Platform Settings,
 * how a request to it is shaped, and what one description costs and takes, as measured. One typed
 * table, read by the description generator, the `/api/adapt` gateway and the settings UI. Prices
 * are NOT here: `llm-pricing.ts` is the billing source of truth, and the per-description cost below
 * is derived from it.
 *
 * Why the 5.x models need a request profile. Measured 2026-10-22 through the real generator path
 * (the FOLLOW-819 fixture listing, `yield_hunter` / `family_buyer`, EN and PL): Haiku 5.5, Sonnet
 * 5.5, Opus 5.5 and Fable 5.1 think by default, and thinking tokens count against `max_tokens`. At
 * the 4.x budget every 5.x description and `/api/adapt` call spent the whole budget thinking and
 * returned no text (`stop_reason: max_tokens`). They also use a different tokenizer: the same
 * prompt counts ~1.4–1.6x more tokens. So, per model:
 *   - Haiku 5.5 accepts `thinking: {type: 'disabled'}`. Sonnet 5.5 takes `between_tools` instead,
 *     at `effort: 'low'`: at its default `high` effort it still thought 2,498 tokens on a 220-word
 *     original and ran out; at `low` it thought 0 on 4 calls. Sonnet 5.5 rejects `disabled` at
 *     every effort level and `between_tools` + `low` is the least thinking the API offers
 *     (platform docs, "Troubleshooting thinking", checked 2026-10-26), yet on 5 of 60 FOLLOW-1399
 *     calls it still thought, and 2 exhausted the 2,000-token reserve (no text / a truncated audit
 *     block). FOLLOW-1403 gives it its own, larger reserve.
 *   - Opus 5.5 and Fable 5.1 cannot turn thinking off; they run at `effort: 'low'` and get a
 *     thinking reserve on top of the text budget.
 *   - Every 5.x text budget is scaled by the tokenizer factor.
 * The 4.x models have an empty profile: their requests are byte-identical to before (the parity
 * corpus pins their `max_tokens`).
 *
 * Client-safe: no server-only import (the settings panel renders from this table).
 *
 * @module apps/control-plane/src/lib/generation-models
 */

import type { AllowedGenerationModel } from '@/lib/global-config-store';
import { computeCost } from '@/lib/llm-pricing';

/** Extra Messages API fields for a 5.x model. Absent on every 4.x model. */
export interface GenerationRequestExtras {
  thinking?: { type: 'disabled' } | { type: 'between_tools' };
  output_config?: { effort: 'low' | 'medium' | 'high' };
}

/** Measured on the real generator path; the method and date are in the table's comment. */
interface MeasuredGeneration {
  /** Mean `usage.input_tokens` of the description call (system + user prompt). */
  descriptionTokensIn: number;
  /** Mean `usage.output_tokens` of the description call, thinking included (it is billed). */
  descriptionTokensOut: number;
  /** Mean input / output tokens of the headline call. */
  headlineTokensIn: number;
  headlineTokensOut: number;
  /** Median wall time of the description call plus the headline call, ms. */
  p50Ms: number;
}

interface GenerationModelEntry {
  label: string;
  /** One short line for staff: what the model is for. */
  note: string;
  /** Output tokens per word relative to the 4.x tokenizer; scales the text budget. */
  tokenizerFactor: number;
  /**
   * Output tokens added after scaling: room for thinking on a model that thinks, headroom for the
   * longer Polish token count on Haiku 5.5. Billed only when used; `max_tokens` is a cap.
   */
  reserveTokens: number;
  extras: GenerationRequestExtras;
  measured: MeasuredGeneration;
}

const NO_PROFILE = { tokenizerFactor: 1, reserveTokens: 0, extras: {} } as const;

/** The 5.x tokenizer counts ~1.58x the tokens for the same text (PM bench, 2026-10-22). */
const TOKENIZER_5X = 1.6;
/**
 * Covers the measured thinking of Opus 5.5 / Fable 5.1 at `effort: 'low'` (322–1449 tokens) with
 * room to spare; a reply that still runs out is `truncated` and never served.
 */
const THINKING_RESERVE = 2000;
/**
 * Sonnet 5.5 at `between_tools` + `low` (FOLLOW-1403). FOLLOW-1399 saw it think on 5 of 60 calls,
 * 1,487 to more than 2,720 output tokens per call; the reserve covers that with room for the text.
 * A cap, not a charge: a call that does not think bills only its text; a call that thinks now
 * completes (about USD 0.03 more than the failed call it replaces) instead of failing.
 */
const SONNET_55_THINKING_RESERVE = 6000;
/** Haiku 5.5, thinking off: a Polish description used 566 of the scaled 720-token floor. */
const HEADROOM_RESERVE = 300;

/**
 * The catalog. `measured`: 2026-10-22, FOLLOW-1377. `generateDescription()` called directly with the
 * Doppler dev Anthropic key and every sink unconfigured (no cache or DB write), on the FOLLOW-819
 * fixture listing (`839ecbd1-…`, 31-word original) × {`yield_hunter`, `family_buyer`} × {EN, PL}:
 * 4 description calls per model, each with its headline call when the verdict was FIT. Tokens are
 * the means over those calls (every call is billed, whatever its outcome); `p50Ms` is the median
 * description wall time plus the median headline wall time. The 4.x rows were measured with their
 * unchanged requests, the 5.x rows with the profiles below. One machine, sequential calls: a guide
 * for staff, not an SLA.
 */
export const GENERATION_MODELS: Readonly<Record<AllowedGenerationModel, GenerationModelEntry>> = {
  'claude-haiku-4-5-20251001': {
    label: 'Haiku 4.5',
    note: 'Fast, low cost',
    ...NO_PROFILE,
    measured: {
      descriptionTokensIn: 5682,
      descriptionTokensOut: 274,
      headlineTokensIn: 721,
      headlineTokensOut: 17,
      p50Ms: 4810,
    },
  },
  'claude-haiku-5-5': {
    label: 'Haiku 5.5',
    note: 'Cheapest and fastest; thinking off',
    tokenizerFactor: TOKENIZER_5X,
    reserveTokens: HEADROOM_RESERVE,
    extras: { thinking: { type: 'disabled' } },
    measured: {
      descriptionTokensIn: 7896,
      descriptionTokensOut: 494,
      headlineTokensIn: 1027,
      headlineTokensOut: 31,
      p50Ms: 4127,
    },
  },
  'claude-sonnet-4-6': {
    label: 'Sonnet 4.6',
    note: 'Previous default; balanced',
    ...NO_PROFILE,
    measured: {
      descriptionTokensIn: 5683,
      descriptionTokensOut: 440,
      headlineTokensIn: 719,
      headlineTokensOut: 23,
      p50Ms: 13192,
    },
  },
  'claude-sonnet-5-5': {
    label: 'Sonnet 5.5',
    note: 'Default; low effort, rarely thinks',
    tokenizerFactor: TOKENIZER_5X,
    reserveTokens: SONNET_55_THINKING_RESERVE,
    extras: { thinking: { type: 'between_tools' }, output_config: { effort: 'low' } },
    measured: {
      descriptionTokensIn: 7896,
      descriptionTokensOut: 479,
      headlineTokensIn: 1026,
      headlineTokensOut: 36,
      p50Ms: 5380,
    },
  },
  'claude-opus-4-8': {
    label: 'Opus 4.8',
    note: 'High quality',
    ...NO_PROFILE,
    measured: {
      descriptionTokensIn: 7895,
      descriptionTokensOut: 422,
      headlineTokensIn: 1022,
      headlineTokensOut: 31,
      p50Ms: 8807,
    },
  },
  'claude-opus-5-5': {
    label: 'Opus 5.5',
    note: 'Newer Opus; always thinks (low effort)',
    tokenizerFactor: TOKENIZER_5X,
    reserveTokens: THINKING_RESERVE,
    extras: { output_config: { effort: 'low' } },
    measured: {
      descriptionTokensIn: 7897,
      descriptionTokensOut: 1302,
      headlineTokensIn: 1028,
      headlineTokensOut: 98,
      p50Ms: 14438,
    },
  },
  'claude-fable-5-1': {
    label: 'Fable 5.1',
    note: 'Most capable; slowest, most expensive; always thinks (low effort)',
    tokenizerFactor: TOKENIZER_5X,
    reserveTokens: THINKING_RESERVE,
    extras: { output_config: { effort: 'low' } },
    measured: {
      descriptionTokensIn: 7897,
      descriptionTokensOut: 1357,
      headlineTokensIn: 1028,
      headlineTokensOut: 36,
      p50Ms: 17851,
    },
  },
};

function entryFor(model: string): GenerationModelEntry | undefined {
  return Object.prototype.hasOwnProperty.call(GENERATION_MODELS, model)
    ? GENERATION_MODELS[model as AllowedGenerationModel]
    : undefined;
}

/**
 * The `max_tokens` and extra request fields for one generation call. `baseMaxTokens` is the 4.x
 * budget the caller already computes; a 4.x model (or any id not in the catalog) gets it back
 * unchanged with no extras.
 */
export function generationRequestFor(
  model: string,
  baseMaxTokens: number,
): { maxTokens: number; extras: GenerationRequestExtras } {
  const entry = entryFor(model);
  if (!entry || (entry.tokenizerFactor === 1 && entry.reserveTokens === 0)) {
    return { maxTokens: baseMaxTokens, extras: entry?.extras ?? {} };
  }
  return {
    maxTokens: Math.ceil(baseMaxTokens * entry.tokenizerFactor) + entry.reserveTokens,
    extras: entry.extras,
  };
}

/** The settings panel's hint for one model, or `null` for an id the catalog does not know. */
export function generationModelHint(model: string): {
  label: string;
  note: string;
  /** USD for one description + headline at today's list price (`llm-pricing.ts`). */
  costPerDescriptionUsd: number;
  /** Median seconds for one description + headline. */
  seconds: number;
} | null {
  const entry = entryFor(model);
  if (!entry) return null;
  const m = entry.measured;
  return {
    label: entry.label,
    note: entry.note,
    costPerDescriptionUsd:
      computeCost(model, m.descriptionTokensIn, m.descriptionTokensOut) +
      computeCost(model, m.headlineTokensIn, m.headlineTokensOut),
    seconds: Math.round(m.p50Ms / 1000),
  };
}
