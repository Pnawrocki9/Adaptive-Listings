/**
 * Per-1k-token USD list prices for every model id the control plane can bill (FOLLOW-1297, ADR-0023
 * §3). One table for the adapt path (`llm-gateway.ts`) and the description path
 * (`description-generator.ts`), so the daily spend cap sees the same price for the same call.
 *
 * Every id in `ALLOWED_GENERATION_MODELS` (`global-config-store.ts`) has an explicit entry. Before
 * this table lived here, `claude-opus-4-8` and `claude-haiku-4-5-20251001` fell through to the
 * `computeCost` default (0.001 / 0.005), which under-billed Opus against the cap; the Python job
 * priced any unknown id at the Sonnet rate. Opus is priced at its list rate, which is above that.
 *
 * @module apps/control-plane/src/lib/llm-pricing
 */

/** USD per 1,000 tokens, `[input, output]`. */
const COST_PER_1K_USD: Readonly<Record<string, readonly [number, number]>> = {
  'claude-haiku-4-5': [0.00025, 0.00125],
  'claude-haiku-4-5-20251001': [0.00025, 0.00125],
  'claude-sonnet-4-6': [0.003, 0.015],
  'claude-opus-4-8': [0.015, 0.075],
};

/** The rate for a model id not in the table (unchanged from the gateway's historical default). */
const DEFAULT_RATE: readonly [number, number] = [0.001, 0.005];

/**
 * The USD cost of one call, rounded to 6 decimals (the `llm_calls.cost_usd` precision in use).
 *
 * @param model - The Anthropic model id as sent to the API.
 * @param tokensIn - `usage.input_tokens`.
 * @param tokensOut - `usage.output_tokens`.
 */
export function computeCost(model: string, tokensIn: number, tokensOut: number): number {
  const [rateIn, rateOut] = COST_PER_1K_USD[model] ?? DEFAULT_RATE;
  const cost = (tokensIn / 1000) * rateIn + (tokensOut / 1000) * rateOut;
  return Math.round(cost * 1e6) / 1e6;
}
