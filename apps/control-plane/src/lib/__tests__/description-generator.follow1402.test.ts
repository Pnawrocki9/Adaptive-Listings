/**
 * FOLLOW-1402 — the description request names its output language.
 *
 * In the FOLLOW-1399 comparison Haiku 5.5 wrote Polish on 6 of the 16 English pages built from a
 * Polish original (FOLLOW-1384 stopped all six, none was served). The description prompt named the
 * page only by its locale code ("locale: en"), in the system prompt and once in the user prompt.
 * The user prompt now ends with the language by name, and says the sources may be in another
 * language — the FOLLOW-1382 treatment of the headline. The system prompt and every other byte of
 * the request are unchanged, for every model (corpus v9 pins that for every recorded case). The
 * paragraph is NOT repeated at the start: measured on Haiku 5.5, any change to the start of the
 * user prompt made it write its reasoning into the reply (see `descriptionLanguageInstruction`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

import type { DescriptionRequestedEvent } from '@estalara/shared';
import { generateDescription } from '@/lib/description-generator';

const EVENT: DescriptionRequestedEvent = {
  tenant_id: '00000000-0000-4000-8000-000000001402',
  listing_id: 'listing-1402',
  archetype: 'yield_hunter',
  locale: 'en',
  copy_template: 'Analytical.',
  original_description: 'Mieszkanie 48 m² na Mokotowie, wykończone i umeblowane.',
  listing_context: { listing_title: 'Mieszkanie 48 m², Warszawa' },
  cache_key: 'desc:t:listing-1402:yield_hunter:en:m:r0',
  listing_revision: 0,
  generation_model: 'claude-haiku-5-5',
};

interface Body {
  model: string;
  system: string;
  messages: { role: string; content: string }[];
}

async function descriptionRequest(event: DescriptionRequestedEvent): Promise<Body> {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text: '<adaptation_verdict>NEUTRAL</adaptation_verdict>' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 },
  });
  await generateDescription(event);
  return mockCreate.mock.calls[0]![0] as Body;
}

describe('FOLLOW-1402 — the description prompt names the output language', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-'.repeat(3));
    mockCreate.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ['en', 'English'],
    ['pl', 'Polish'],
    ['es', 'Spanish'],
  ] as const)('%s: the user prompt ends with the %s paragraph', async (locale, language) => {
    const body = await descriptionRequest({ ...EVENT, locale });
    const user = body.messages[0]!.content;
    const last = user.split('\n').at(-1)!;
    expect(
      last.startsWith(`LANGUAGE: write the description body in ${language} (locale: ${locale}).`),
    ).toBe(true);
    expect(last).toContain('may be in another language');
    expect(last).toContain(`compose the body natively in ${language}`);
    // The start is unchanged.
    expect(user.startsWith(`archetype: yield_hunter\nlocale: ${locale}\n`)).toBe(true);
  });

  it.each(['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-sonnet-5-5'])(
    '%s gets the same instruction (one prompt for every model)',
    async (model) => {
      const body = await descriptionRequest({ ...EVENT, generation_model: model });
      expect(body.messages[0]!.content).toContain(
        '\n\nLANGUAGE: write the description body in English (locale: en).',
      );
    },
  );
});
