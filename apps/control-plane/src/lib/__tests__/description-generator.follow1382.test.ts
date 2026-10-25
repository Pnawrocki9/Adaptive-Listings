/**
 * FOLLOW-1382 — the headline request carries the page's locale.
 *
 * The FOLLOW-1380 comparison found 12 of 31 headlines in the wrong language: the description
 * prompt names `locale`, the headline prompt did not, so the headline followed the original's
 * language. The headline user prompt now ends with a language instruction built from the same
 * `event.locale` the description prompt uses. The system prompt and every other byte of the
 * request are unchanged (corpus v5 pins that for every recorded case).
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
  tenant_id: '00000000-0000-4000-8000-000000001382',
  listing_id: 'listing-1382',
  archetype: 'family_buyer',
  locale: 'en',
  copy_template: 'Warm and practical.',
  original_description: 'Dom z trzema sypialniami i ogrodem w Gdańsku.',
  listing_context: { listing_title: 'Dom w Gdańsku' },
  cache_key: 'desc:t:listing-1382:family_buyer:en:m:r0',
  listing_revision: 0,
  generation_model: 'claude-sonnet-4-6',
};

const FIT_RAW =
  '<adaptation_verdict>FIT</adaptation_verdict>\n' +
  'A three-bedroom house in Gdańsk.\n' +
  '<verified_facts_used>\n["bedrooms: 3"]\n</verified_facts_used>';

function reply(text: string) {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

interface Body {
  model: string;
  max_tokens: number;
  system: string;
  messages: { role: string; content: string }[];
}

async function headlineRequest(event: DescriptionRequestedEvent): Promise<{
  desc: Body;
  head: Body;
}> {
  mockCreate
    .mockResolvedValueOnce(reply(FIT_RAW))
    .mockResolvedValueOnce(reply('Gdańsk house with three bedrooms'));
  await generateDescription(event);
  const [desc, head] = mockCreate.mock.calls.map((c) => c[0] as Body);
  return { desc: desc!, head: head! };
}

describe('generateDescription — the headline request names the locale (FOLLOW-1382)', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-'.repeat(3));
    mockCreate.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ['en', 'English'],
    ['pl', 'Polish'],
    ['es', 'Spanish'],
  ] as const)(
    'locale %s: the headline prompt tells the model to write in %s',
    async (locale, name) => {
      const { desc, head } = await headlineRequest({ ...EVENT, locale });
      const user = head.messages[0]!.content;
      expect(user).toContain(`write the headline in ${name} (locale: ${locale})`);
      // The same locale source as the description request.
      expect(desc.messages[0]!.content).toContain(`locale: ${locale}`);
      // Only one language is named.
      for (const other of ['English', 'Polish', 'Spanish'].filter((n) => n !== name)) {
        expect(user).not.toContain(`in ${other}`);
      }
    },
  );

  it('the instruction is the LAST paragraph of the user prompt and the system prompt is unchanged', async () => {
    const en = (await headlineRequest({ ...EVENT, locale: 'en' })).head;
    mockCreate.mockReset();
    const pl = (await headlineRequest({ ...EVENT, locale: 'pl' })).head;
    const enUser = en.messages[0]!.content;
    const plUser = pl.messages[0]!.content;
    expect(enUser.lastIndexOf('\n\nLANGUAGE:')).toBeGreaterThan(0);
    expect(plUser.lastIndexOf('\n\nLANGUAGE:')).toBeGreaterThan(0);
    const cut = (s: string) => s.slice(0, s.lastIndexOf('\n\nLANGUAGE:'));
    expect(cut(enUser)).toBe(cut(plUser));
    expect(cut(enUser).length).toBeGreaterThan(0);
    expect(cut(enUser)).toContain('Original description (factual source of truth):');
    expect(en.system).toBe(pl.system);
  });

  it('a 4.x request body keeps exactly its four fields and the 60-token budget', async () => {
    const { head } = await headlineRequest({ ...EVENT, locale: 'pl' });
    expect(Object.keys(head)).toEqual(['model', 'max_tokens', 'system', 'messages']);
    expect(head.max_tokens).toBe(60);
    expect(head.messages).toHaveLength(1);
  });
});
