/**
 * FOLLOW-1408 — (a) a negated guarantee is a disclaimer, not a guarantee, on both paths; (b) the
 * first_time_buyer headline persona no longer asks for "move-in readiness".
 *
 * (a) `GUARANTEE_RE` had no negation guard, so "There is no guarantee of rental income", "bez
 * gwarancji dochodu" and "sin garantía de rentabilidad" — the honest disclaimer an investor copy
 * should carry — were refused `unsupported_guarantee`. `assertsGuarantee` reads a guarantee as
 * negated only when a negator stands DIRECTLY before it, with at most a few closed filler words
 * ("no guarantee", "is not guaranteed", "cannot be guaranteed", "nie ma żadnej gwarancji", "no se
 * garantiza", "sin ninguna garantía"). A phrase that is itself negative ("risk-free", "no risk",
 * "bez ryzyka", "sin riesgo") stays a claim, and a negator further away ("No other flat offers
 * guaranteed rent") negates nothing. The listing side is read the same way: a listing's own
 * disclaimer no longer grounds a guarantee.
 *
 * (b) "move-in readiness" in the persona asked the headline for a condition claim the listing
 * rarely makes (refused by `checkHeadlineFacts` as `unsupported_guarantee`).
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
import { checkBodyClaims } from '@/lib/grounding-check';
import { buildClaimGrounding, checkUnsupportedClaims } from '@/lib/claim-containment';
import { assertsNoWorkClaim } from '@/lib/condition-lexicon';
import { generateDescription } from '@/lib/description-generator';

const KRK = 'Bright two-bedroom apartment in Krakow, Podgorze. A balcony. The building has a lift.';

function bothPaths(text: string, original: string) {
  return {
    description: checkBodyClaims(text, original, {}),
    adapt: checkUnsupportedClaims(text, buildClaimGrounding({ listing_description: original })),
  };
}

const OK = { description: null, adapt: null };
const GUARANTEE = { description: 'unsupported_guarantee', adapt: 'unsupported_guarantee' };

describe('FOLLOW-1408 (a) — a negated guarantee is a disclaimer', () => {
  it.each([
    // en
    'There is no guarantee of rental income.',
    'Rental income is not guaranteed.',
    "Returns aren't guaranteed and depend on the market.",
    'Rental demand cannot be guaranteed.',
    'This is not a guarantee of future yield.',
    'It comes without any guarantee of income.',
    'Past rents are no guarantee of future rents.',
    // pl
    'Bez gwarancji dochodu z najmu.',
    'Nie ma żadnej gwarancji przychodu z najmu.',
    'Brak gwarancji zwrotu z inwestycji.',
    'Ogłoszenie nie gwarantuje rentowności.',
    'Dochód nie jest gwarantowany.',
    // es
    'Sin garantía de rentabilidad.',
    'No hay garantía de ingresos por alquiler.',
    'La rentabilidad no está garantizada.',
    'No se garantiza ningún rendimiento.',
    'Sin ninguna garantía de alquiler.',
  ])('%j passes', (text) => {
    expect(bothPaths(text, KRK)).toEqual(OK);
  });
});

describe('FOLLOW-1408 (a) — the guarantee check stays fail-closed', () => {
  it.each([
    'Guaranteed rental income from day one.',
    'A guaranteed 6% yield.',
    'Risk-free investment.',
    'No risk, steady demand.',
    'No other flat offers guaranteed rent.',
    'Not only guaranteed income but capital growth.',
    'There is no garage, and the income is guaranteed.',
    'There is no doubt: income is guaranteed.',
    'Gwarantowany dochód z najmu.',
    'Inwestycja bez ryzyka.',
    'Nie ma garażu, ale zysk jest gwarantowany.',
    'Rentabilidad garantizada.',
    'Inversión sin riesgo.',
    'Ingresos de alquiler asegurados.',
  ])('%j is still refused', (text) => {
    expect(bothPaths(text.replace('6%', 'six percent'), KRK)).toEqual(GUARANTEE);
  });

  it("the listing's own disclaimer does not ground a guarantee", () => {
    expect(
      bothPaths('Guaranteed rental income.', `${KRK} There is no guarantee of rental income.`),
    ).toEqual(GUARANTEE);
    expect(bothPaths('Gwarantowany dochód.', `${KRK} Bez gwarancji dochodu.`)).toEqual(GUARANTEE);
  });

  it("the listing's own guarantee still grounds one", () => {
    expect(
      bothPaths('Guaranteed rental income.', `${KRK} The developer guarantees rental income.`),
    ).toEqual(OK);
  });
});

function event(archetype: string): DescriptionRequestedEvent {
  return {
    tenant_id: '00000000-0000-4000-8000-000000001408',
    listing_id: 'listing-1408',
    archetype,
    locale: 'en',
    copy_template: 'Warm and practical.',
    original_description: KRK,
    listing_context: {},
    cache_key: `desc:t:listing-1408:${archetype}:en:m:r0`,
    listing_revision: 0,
    generation_model: 'claude-sonnet-5-5',
  } as DescriptionRequestedEvent;
}

function reply(text: string) {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

describe('FOLLOW-1408 (b) — the first_time_buyer persona asks for no condition claim', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-'.repeat(3));
    mockCreate.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('neither the headline persona nor the description prompt says "move-in"', async () => {
    mockCreate
      .mockResolvedValueOnce(
        reply(
          '<adaptation_verdict>FIT</adaptation_verdict>\nA bright two-bedroom apartment in Krakow, Podgorze, with a balcony.\n<verified_facts_used>\n[]\n</verified_facts_used>',
        ),
      )
      .mockResolvedValueOnce(reply('Two-bedroom apartment in Krakow with a balcony'));
    const report = await generateDescription(event('first_time_buyer'));
    expect(report.outcome.verdict).toBe('FIT');
    const [descUser, headUser] = [0, 1].map(
      (i) =>
        (mockCreate.mock.calls[i]![0] as { messages: { content: string }[] }).messages[0]!.content,
    );
    const persona = /Persona guidance \(tone only — it adds no facts\): ([^\n]*)/u.exec(
      headUser!,
    )![1]!;
    expect(persona).toMatch(/affordability/u);
    expect(persona).toMatch(/only as the listing states/u);
    for (const prompt of [persona, descUser!]) {
      expect(prompt).not.toMatch(/move-in|readiness/iu);
      expect(assertsNoWorkClaim(prompt)).toBe(false);
    }
  });
});
