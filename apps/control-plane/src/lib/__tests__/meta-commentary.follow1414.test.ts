/**
 * FOLLOW-1414 — a body that reports what the listing says, instead of saying it about the home, is
 * meta-commentary; and the prompts ask for copy about the home and for correct Polish room counts.
 *
 * Seen live in FOLLOW-1411: "The listing says the home is close to schools." talks about the
 * advert, not the home (the FOLLOW-1411 personas say "schools … only as the listing states them",
 * and the model echoed it). A POSITIVE attribution to the listing — "the listing says / states /
 * mentions / notes …", "according to the listing", "ogłoszenie podaje / wspomina …", "według
 * ogłoszenia", "el anuncio dice / indica …", "según el anuncio" — is now refused as
 * `meta_commentary` on both paths. A statement of what the listing LEAVES OUT ("The listing states
 * no rent or yield figure" — the system prompt's own example — "The listing says nothing about
 * renovation", "Ogłoszenie nie wymienia szkół", "El anuncio no menciona colegios") is a disclosure
 * to the buyer and passes, as FOLLOW-1392 decided.
 *
 * Prompt side (not a detector): the description user prompt ends with a paragraph asking for copy
 * about the home, never about the listing; on a Polish page it and the headline prompt also spell
 * the room-count adjectives ("dwupokojowe", never the live typo "dwuipokojowe").
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
import { bodyViolatesContract } from '@/lib/grounding-check';
import { generateDescription } from '@/lib/description-generator';
import { hasMetaCommentary } from '@/lib/meta-commentary';

const REPORTED: readonly string[] = [
  // the live body (FOLLOW-1411)
  'The listing says the home is close to schools.',
  'A three-bedroom house. The listing says it is close to schools and a park.',
  'The listing states that the garden is south-facing.',
  'The listing also mentions a playground nearby.',
  'The description notes a quiet street.',
  'According to the listing, the flat was renovated in 2021.',
  'The advert describes the kitchen as new.',
  // pl
  'Ogłoszenie podaje, że w pobliżu jest szkoła.',
  'Ogłoszenie wspomina o placu zabaw.',
  'Według ogłoszenia mieszkanie jest po remoncie.',
  'Zgodnie z ogłoszeniem do szkoły jest pięć minut.',
  'Jak podaje ogłoszenie, okolica jest cicha.',
  'W ogłoszeniu podano, że budynek ma windę.',
  // es
  'El anuncio dice que hay un colegio cerca.',
  'El anuncio indica que la vivienda está reformada.',
  'Según el anuncio, el piso tiene terraza.',
  'La descripción menciona un parque infantil.',
];

const DISCLOSURES: readonly string[] = [
  // the system prompt's own example
  'The listing states no rent or yield figure, so the numbers are a question for the agent.',
  // the recorded corpus body (live.031, FIT)
  'The listing says nothing about recent updates or renovation.',
  'The listing does not mention schools, nurseries or playgrounds.',
  'The listing names two items: the upstairs windows and the electrics.',
  'The listing price is $385,000.',
  'Ogłoszenie nie wymienia szkół, przedszkoli ani placów zabaw.',
  'Ogłoszenie nie podaje czynszu.',
  'El anuncio no menciona colegios.',
  'El anuncio no indica la orientación.',
  'A home that says "welcome" from the front door.',
  'The street notes are quiet: a bakery, a café and a bus stop.',
];

describe('FOLLOW-1414 — reported speech about the listing is meta-commentary', () => {
  it.each(REPORTED)('%j is refused as meta_commentary', (text) => {
    expect(hasMetaCommentary(text)).toBe(true);
    expect(bodyViolatesContract(text)).toBe('meta_commentary');
  });

  it.each(DISCLOSURES)('%j passes', (text) => {
    expect(hasMetaCommentary(text)).toBe(false);
  });
});

function event(locale: 'en' | 'pl' | 'es'): DescriptionRequestedEvent {
  return {
    tenant_id: '00000000-0000-4000-8000-000000001414',
    listing_id: 'listing-1414',
    archetype: 'family_buyer',
    locale,
    copy_template: 'Warm and practical.',
    original_description: 'Dwupokojowe mieszkanie 48 m² na Mokotowie, Warszawa. Balkon.',
    listing_context: { listing_location: 'Warszawa, Mokotów' },
    cache_key: `desc:t:listing-1414:family_buyer:${locale}:m:r0`,
    listing_revision: 0,
    generation_model: 'claude-sonnet-5-5',
  };
}

function reply(text: string) {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

async function prompts(locale: 'en' | 'pl' | 'es'): Promise<[string, string]> {
  mockCreate.mockReset();
  mockCreate
    .mockResolvedValueOnce(
      reply(
        '<adaptation_verdict>FIT</adaptation_verdict>\nMieszkanie na Mokotowie z balkonem.\n<verified_facts_used>\n[]\n</verified_facts_used>',
      ),
    )
    .mockResolvedValueOnce(reply('Mieszkanie na Mokotowie z balkonem'));
  await generateDescription(event(locale));
  const user = (i: number) =>
    (mockCreate.mock.calls[i]![0] as { messages: { content: string }[] }).messages[0]!.content;
  return [user(0), user(1)];
}

describe('FOLLOW-1414 — the prompts', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-'.repeat(3));
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(['en', 'pl', 'es'] as const)(
    '%s: the description prompt asks for copy about the home, not the listing',
    async (locale) => {
      const [description] = await prompts(locale);
      expect(description).toMatch(/ABOUT THE HOME/u);
      expect(description).toMatch(/the listing says/u);
    },
  );

  it('pl: both prompts spell the room-count adjectives; en and es do not', async () => {
    const [description, headline] = await prompts('pl');
    for (const p of [description, headline]) {
      expect(p).toMatch(/dwupokojowe/u);
      expect(p).toMatch(/trzypokojowe/u);
      expect(p).not.toMatch(/dwuipokojowe/u);
    }
    for (const locale of ['en', 'es'] as const) {
      const [d, h] = await prompts(locale);
      expect(d).not.toMatch(/trzypokojowe/u);
      expect(h).not.toMatch(/trzypokojowe/u);
    }
  });
});
