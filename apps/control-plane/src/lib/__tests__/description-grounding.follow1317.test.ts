/**
 * FOLLOW-1317 — the price the backend states reaches the MODEL, with its unit, on both shapes.
 *
 * The reader-level cases live in `listing-details.test.ts`. This file closes the wiring question
 * those cannot answer: that the mapped fields travel the whole production path —
 * `fetchDescriptionGrounding()` → `DescriptionRequestedEvent.listing_context` (assembled exactly as
 * `apps/control-plane/src/app/api/adapt/description/route.ts:474` assembles it) →
 * `generateDescription()` → the prompt bytes handed to the model, in BOTH the description call and
 * the headline call. A mapping that is correct in isolation and never reaches the prompt grounds
 * nothing, and a price in the prompt without its unit cannot be fact-checked as a price.
 *
 * Only the network and the generator's sinks are stubbed; the reader, the grounding assembly and
 * both prompt builders are the production ones.
 *
 * @module apps/control-plane/src/lib/__tests__/description-grounding.follow1317.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreate, mockPublishPg, mockSetCached, mockAudit, mockLogLlmCall, mockGetDailySpend } =
  vi.hoisted(() => ({
    mockCreate: vi.fn(),
    mockPublishPg: vi.fn(),
    mockSetCached: vi.fn(),
    mockAudit: vi.fn(),
    mockLogLlmCall: vi.fn().mockResolvedValue(undefined),
    mockGetDailySpend: vi.fn().mockResolvedValue(0),
  }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('@/lib/description-pg-cache', () => ({ publishPgCachedDescription: mockPublishPg }));
vi.mock('@/lib/description-cache', () => ({ setCachedDescription: mockSetCached }));
vi.mock('@/lib/description-generation-audit', () => ({
  writeDescriptionGenerationAudit: mockAudit,
}));
vi.mock('@/lib/llm-calls-register', () => ({ logLlmCallAsync: mockLogLlmCall }));
vi.mock('@/lib/llm-spend-counter', () => ({
  DAILY_SPEND_CAP_USD: 100,
  getDailySpend: mockGetDailySpend,
}));

import type { DescriptionRequestedEvent } from '@estalara/shared';

import { generateDescription } from '@/lib/description-generator';
import { fetchDescriptionGrounding } from '@/lib/listing-facts-context';

const LISTING_ID = '839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c';

/** The real-backend shape: `priceEur`/`priceUsd` + `publicLocationLabel`, no `price`, no address. */
const REAL_SHAPE = {
  uuid: LISTING_ID,
  headline: 'Two-bedroom apartment with a sea-facing terrace',
  description: 'A two-bedroom apartment in a 1910 building, with a terrace facing the sea.',
  priceEur: 285000,
  priceUsd: 310000,
  publicLocationLabel: 'Carrer de la Mar',
  district: 'Centro',
  city: 'Javea',
  region: 'Valencia',
};

/** The shape the FOLLOW-819 fixture serves: the agent-entered `price` + `currency` pair. */
const ENTERED_PAIR_SHAPE = {
  uuid: LISTING_ID,
  headline: '9 Blackberry Pl, Palm Coast, FL 32137 — 3 bed, 2 bath',
  description: 'A three-bedroom, two-bathroom single-family home on a quiet residential street.',
  price: 385000,
  currency: 'USD',
  publicLocationLabel: '9 Blackberry Pl',
  city: 'Palm Coast',
  region: 'FL',
};

function stubBackend(body: Record<string, unknown>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })),
  );
}

function modelResponse(text: string) {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 40 },
  };
}

/**
 * Drive the production path for one backend payload and return the prompt text of every model
 * call, in order (`[description, headline]`).
 */
async function promptsFor(body: Record<string, unknown>, locale: 'en' | 'pl'): Promise<string[]> {
  stubBackend(body);
  const grounding = await fetchDescriptionGrounding(LISTING_ID, locale);

  // route.ts:474 — `{ ...grounding.fields, ...ragContext }`, with no agency FAQ rows for this
  // listing (the endpoint has no intent_vector, so `retrieveListingContext` returns {}).
  const event: DescriptionRequestedEvent = {
    tenant_id: '00000000-0000-4000-8000-000000001317',
    listing_id: LISTING_ID,
    archetype: 'yield_hunter',
    locale,
    copy_template: 'Numbers first.',
    original_description: grounding.originalDescription,
    listing_context: { ...grounding.fields },
    cache_key: `desc:t:${LISTING_ID}:yield_hunter:${locale}:claude-sonnet-4-6:r1`,
    listing_revision: 1,
    generation_model: 'claude-sonnet-4-6',
  };

  mockCreate
    .mockResolvedValueOnce(
      modelResponse(
        '<adaptation_verdict>FIT</adaptation_verdict>\nA bright apartment.\n' +
          '<verified_facts_used>\n["bedrooms: 2"]\n</verified_facts_used>',
      ),
    )
    .mockResolvedValueOnce(modelResponse('Bright apartment'));

  await generateDescription(event);

  return mockCreate.mock.calls.map((call) => JSON.stringify(call[0]));
}

describe('FOLLOW-1317 — the grounded price reaches the prompt with its unit', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-'.repeat(3));
    vi.stubEnv('UPSTASH_REDIS_URL', 'https://redis.test');
    vi.stubEnv('ESTALARA_BACKEND_URL', 'https://backend.test');
    mockCreate.mockReset();
    mockPublishPg.mockReset().mockResolvedValue('published');
    mockSetCached.mockReset().mockResolvedValue(true);
    mockAudit.mockReset().mockResolvedValue('written');
    mockLogLlmCall.mockClear();
    mockGetDailySpend.mockReset().mockResolvedValue(0);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('real backend shape: both prompts carry the EUR figure and the full location', async () => {
    const [descriptionPrompt, headlinePrompt] = await promptsFor(REAL_SHAPE, 'en');

    expect(descriptionPrompt).toContain('285000 EUR');
    expect(descriptionPrompt).toContain('Carrer de la Mar, Centro, Javea, Valencia');
    // The headline whitelist is `- <key>: <value>` lines (renderHeadlinePrompt).
    expect(headlinePrompt).toContain('listing_price: 285000 EUR');
    expect(headlinePrompt).toContain('listing_location: Carrer de la Mar');
    // The USD column exists on this listing too; exactly one price figure is grounded, so the
    // model cannot pick a second one for the same property.
    expect(descriptionPrompt).not.toContain('310000');
    expect(headlinePrompt).not.toContain('310000');
  });

  it('entered price + currency shape: both prompts carry the USD figure', async () => {
    const [descriptionPrompt, headlinePrompt] = await promptsFor(ENTERED_PAIR_SHAPE, 'en');

    expect(descriptionPrompt).toContain('385000 USD');
    expect(headlinePrompt).toContain('listing_price: 385000 USD');
  });

  it('a listing with no price states none: no listing_price line in either prompt', async () => {
    const { priceEur, priceUsd, ...noPrice } = REAL_SHAPE;
    expect(priceEur).toBeDefined();
    expect(priceUsd).toBeDefined();

    const [descriptionPrompt, headlinePrompt] = await promptsFor(noPrice, 'en');

    expect(descriptionPrompt).not.toContain('listing_price');
    expect(headlinePrompt).not.toContain('listing_price');
    // Fail-safe, not fail-empty: the rest of the grounding still reaches the model.
    expect(headlinePrompt).toContain('listing_location: Carrer de la Mar');
  });
});
