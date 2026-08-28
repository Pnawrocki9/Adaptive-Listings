/**
 * FOLLOW-1176 — the `cta` exemption is bounded by the population its evidence covers.
 *
 * WHAT #875 GOT RIGHT, AND WHERE IT OVERREACHED. `isNonAssertiveSlot` is justified by an
 * enumeration: `lib/ungrounded-directives.ts` reads all seventeen shipped `cta` strings, argues
 * the two hardest ones, and concludes that a call to action asserts no fact about the property
 * (MASTER_DESIGN §E.7.0). That argument is sound — about those seventeen strings. #875 gave the
 * predicate a second consumer, `checkDirectiveFacts`, whose one call site sits inside
 * `callLlmGateway`'s directive loop, where **every value is written by the model**. Seventeen
 * authored strings cannot bound what a model will write, and the exemption removed the judge tier
 * too, so `judgeNameGrounding` — the control built to ask exactly this question — became
 * unreachable for that slot (RETRO-319 §4a LG-1, Rule BC).
 *
 * THE FIX IS PROVENANCE, NOT A NARROWER SLOT LIST. A `cta` whose value IS this archetype's own
 * authored copy is inside the enumerated population and keeps the exemption; anything else is
 * model-authored, falls through to the judge, and is adjudicated rather than assumed. The
 * classification of the SLOT is untouched — `withholdUngroundedDirectives` still serves the `cta`
 * on the template branches, because there the value is authored by construction.
 *
 * WHAT THIS FILE PINS, in the order the ticket's ACs ask for it:
 *
 *   1. the three strings RETRO-319 measured — a real agency, an invented development, an invented
 *      scheme — are adjudicated again instead of served unchecked;
 *   2. the shipped CTA still costs no judge round trip, so #875's measured win survives;
 *   3. both CONTROL rows hold: an ungrounded FIGURE in a `cta` is still rejected deterministically,
 *      and the same invented name in a `headline` is still judged.
 *
 * The REAL playbook is used throughout, never `MOCK_PLAYBOOK` (RETRO-316 §4c).
 *
 * @module apps/control-plane/src/lib/__tests__/llm-gateway.follow1176.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { TextDirective } from '@estalara/shared';

vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn();
  const MockAnthropic = vi.fn(() => ({ messages: { create: mockCreate } }));
  (MockAnthropic as unknown as Record<string, unknown>).__mockCreate = mockCreate;
  return { default: MockAnthropic };
});

import Anthropic from '@anthropic-ai/sdk';

const mockCreate = (Anthropic as unknown as { __mockCreate: ReturnType<typeof vi.fn> })
  .__mockCreate;

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { callLlmGateway } = await import('@/lib/llm-gateway');
const { getPlaybook } = await import('@estalara/sdk/playbooks');

const YIELD_HUNTER = getPlaybook('yield_hunter');

/** Read from the playbook, not retyped — a re-authoring must fail this file loudly. */
const SHIPPED_CTA = YIELD_HUNTER.slots.find((s) => s.slot === 'cta')?.en ?? '';

/**
 * Vocabulary deliberately disjoint from the template's: it contains none of the proper names the
 * probes below smuggle, so anything the model invents is unbacked and the scan sees it.
 */
const LISTING_CONTEXT: Record<string, string> = {
  headline: 'Sunlit apartment with river views',
  description: 'A calm, well-connected home in the old town.',
  bedrooms: '3',
  living_area: '128.5',
  location: 'Alfama, Lisbon',
};

/**
 * The population #875's six committed cases never touch: every one of them feeds either the
 * shipped CTA or a figure (RETRO-319 §4c TG-1). These are what a model actually smuggles into a
 * button label — a real agency, an invented development, an invented financial product.
 */
const MODEL_INVENTED_CTAS = [
  'Book a Viewing with Knight Frank',
  'Download the Marina Heights Yield Report',
  'Enquire about the Guaranteed Rental Income scheme',
];

function anthropicResponse(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    usage: { input_tokens: 150, output_tokens: 50 },
  };
}

function directives(...pairs: [slot: string, value: string][]): string {
  const list: TextDirective[] = pairs.map(([slot, value]) => ({
    type: 'text',
    slot,
    value,
    archetype: 'yield_hunter',
    confidence: 0.8,
  }));
  return JSON.stringify(list);
}

const BASE_INPUT = {
  archetypeId: 'yield_hunter' as const,
  confidence: 0.75,
  similarity: 0.75,
  basePlaybook: YIELD_HUNTER,
  listingContext: LISTING_CONTEXT,
};

describe('FOLLOW-1176 — the exemption covers authored copy, not whatever the model writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key-follow-1176';
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ total: '0' }] }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('red-first: a proper name the model invented reaches the judge again', () => {
    for (const invented of MODEL_INVENTED_CTAS) {
      it(`adjudicates ${JSON.stringify(invented)} instead of serving it unchecked`, async () => {
        // The judge REFUSES. Post-#875 it was never consulted, so this batch was served; the
        // control built to answer this question was unreachable for the slot.
        mockCreate
          .mockResolvedValueOnce(anthropicResponse(directives(['cta', invented])))
          .mockResolvedValueOnce(anthropicResponse('{"grounded": false}'));

        const result = await callLlmGateway(BASE_INPUT);

        expect(mockCreate).toHaveBeenCalledTimes(2);
        expect(result).toBeNull();
      });
    }

    it('serves an invented CTA when the judge GROUNDS it — the verdict decides, not the slot', async () => {
      // The other half of "adjudicated": the exemption is replaced by a judgement, not by a
      // blanket rejection. A CTA the judge can ground still ships.
      mockCreate
        .mockResolvedValueOnce(anthropicResponse(directives(['cta', MODEL_INVENTED_CTAS[0] ?? ''])))
        .mockResolvedValueOnce(anthropicResponse('{"grounded": true}'));

      const result = await callLlmGateway(BASE_INPUT);

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result?.directives[0]?.value).toBe(MODEL_INVENTED_CTAS[0]);
    });
  });

  it("#875's win survives: the archetype's OWN shipped CTA still costs no judge round trip", async () => {
    // This is the population the seventeen-string enumeration actually covers, and it is what
    // the model returned on 12 of 12 live runs. Losing this would undo FOLLOW-1173.
    expect(SHIPPED_CTA).toBe('Request Investment Pack');
    mockCreate.mockResolvedValueOnce(anthropicResponse(directives(['cta', SHIPPED_CTA])));

    const result = await callLlmGateway(BASE_INPUT);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result?.directives[0]?.value).toBe(SHIPPED_CTA);
  });

  it('matches authored copy on whitespace and case, not on byte equality', async () => {
    // A model that re-emits the authored string with different casing has still authored
    // nothing new. Anything beyond that — a paraphrase, an added clause — is not this string.
    mockCreate.mockResolvedValueOnce(
      anthropicResponse(directives(['cta', `  ${SHIPPED_CTA.toUpperCase()}  `])),
    );

    const result = await callLlmGateway(BASE_INPUT);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
  });

  it('a paraphrase of the shipped CTA is NOT authored copy and is judged', async () => {
    // The boundary. `Request the Investment Pack Today` is close to the template and still
    // model-written, so it is adjudicated rather than assumed.
    mockCreate
      .mockResolvedValueOnce(
        anthropicResponse(directives(['cta', 'Request the Investment Pack Today'])),
      )
      .mockResolvedValueOnce(anthropicResponse('{"grounded": true}'));

    const result = await callLlmGateway(BASE_INPUT);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result?.directives[0]?.value).toBe('Request the Investment Pack Today');
  });

  describe('CONTROL rows — neither is allowed to regress', () => {
    it('an ungrounded FIGURE in a `cta` is still rejected deterministically, unjudged', async () => {
      mockCreate.mockResolvedValueOnce(
        anthropicResponse(directives(['cta', 'Get the 7.4% Yield Report'])),
      );

      const result = await callLlmGateway(BASE_INPUT);

      expect(result).toBeNull();
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('the same invented name in a `headline` is still adjudicated and still discarded', async () => {
      mockCreate
        .mockResolvedValueOnce(
          anthropicResponse(directives(['headline', MODEL_INVENTED_CTAS[0] ?? ''])),
        )
        .mockResolvedValueOnce(anthropicResponse('{"grounded": false}'));

      const result = await callLlmGateway(BASE_INPUT);

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result).toBeNull();
    });
  });
});
