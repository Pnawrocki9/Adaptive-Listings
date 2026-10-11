/**
 * FOLLOW-1251 — our own authored `feature` section label is grounded by construction.
 *
 * THE RECORDED REFUSAL (tests/e2e/follow-819/README.md §5.15 run 2):
 * `[llm-gateway] directive fact-check violation: hallucinated_proper_name archetype=yield_hunter
 * slot=feature value="Investment Performance"`. `buildHaikuPrompt` shows the model the playbook's
 * `feature` label as a base directive, the model repeats it, neither word is in the listing, the
 * judge correctly finds it ungrounded IN THE LISTING, and one rejection discards the whole batch.
 * The label comes from us — not from the model and not from the seller — so it is exempt on
 * provenance (`isAuthoredSectionLabel`), exactly as the archetype's own `cta` is (FOLLOW-1176).
 *
 * WHAT MUST NOT LOOSEN. Every negative below is a value the exemption must NOT reach: a label with
 * a name or a figure appended, the label's words in another slot (the label is a heading, never a
 * source of property facts), another archetype's label, the four `feature` strings that are
 * property claims, a re-authored label nobody reviewed, and invented Title-Case amenities and
 * names.
 *
 * The judge stub answers `grounded: false` to everything, so any value that reaches it is refused:
 * "served with one Anthropic call" therefore proves the exemption fired, and "refused with two"
 * proves the value was adjudicated rather than assumed safe. The REAL playbooks are used
 * throughout (RETRO-316 §4c).
 *
 * @module apps/control-plane/src/lib/__tests__/llm-gateway.follow1251.test
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
const { isAuthoredSectionLabel } = await import('@/lib/ungrounded-directives');
const { getPlaybook, getAllPlaybooks } = await import('@estalara/sdk/playbooks');

const YIELD_HUNTER = getPlaybook('yield_hunter');

/** Read from the playbook, not retyped — a re-authoring must fail this file loudly. */
const shipped = (slot: string): string => YIELD_HUNTER.slots.find((s) => s.slot === slot)?.en ?? '';
const SHIPPED_FEATURE = shipped('feature');
const SHIPPED_CTA = shipped('cta');

/** Vocabulary disjoint from every playbook label, so the label's words are not grounded. */
const LISTING_CONTEXT: Record<string, string> = {
  headline: 'Sunlit apartment with river views',
  description: 'A calm, well-connected home in the old town.',
  bedrooms: '3',
  living_area: '128.5',
  location: 'Alfama, Lisbon',
};

/** A headline the scan passes on its own (segment-initial capital, the rest lower-case). */
const GROUNDED_HEADLINE = 'Sunlit apartment with river views';

function anthropicResponse(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    usage: { input_tokens: 150, output_tokens: 50 },
  };
}

function directives(archetype: string, ...pairs: [slot: string, value: string][]): string {
  const list = pairs.map(([slot, value]) => ({
    type: 'text',
    slot,
    value,
    archetype,
    confidence: 0.8,
  })) as TextDirective[];
  return JSON.stringify(list);
}

/** Haiku tweak band (0.6 < similarity ≤ 0.85) — the band the recorded refusal was on. */
const BASE_INPUT = {
  archetypeId: 'yield_hunter' as const,
  confidence: 0.75,
  similarity: 0.75,
  basePlaybook: YIELD_HUNTER,
  listingContext: LISTING_CONTEXT,
};

const JUDGE_REFUSES = anthropicResponse('{"grounded": false}');

/** The four shipped `feature` strings that are property claims (`ungrounded-directives.ts`). */
const CLAIM_LABEL_ARCHETYPES = [
  'remote_worker',
  'downsizer',
  'vacation_rental_investor',
  'golden_visa_buyer',
] as const;

describe('FOLLOW-1251 — authored section labels are grounded by construction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key-follow-1251';
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ total: '0' }] }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('red-first: the recorded batch (cta, headline, feature="Investment Performance") is SERVED', async () => {
    expect(SHIPPED_FEATURE).toBe('Investment Performance');
    // Every judge call refuses: pre-fix the feature reached the judge and took the batch down.
    mockCreate
      .mockResolvedValueOnce(
        anthropicResponse(
          directives(
            'yield_hunter',
            ['cta', SHIPPED_CTA],
            ['headline', GROUNDED_HEADLINE],
            ['feature', SHIPPED_FEATURE],
          ),
        ),
      )
      .mockResolvedValue(JUDGE_REFUSES);

    const result = await callLlmGateway(BASE_INPUT);

    // The real `buildHaikuPrompt` is what showed the model the label as a base directive.
    const prompt = JSON.stringify(mockCreate.mock.calls[0]?.[0]);
    expect(prompt).toContain(SHIPPED_FEATURE);
    // The label is NOT in the listing, so the exemption — not the grounding — cleared it.
    expect(JSON.stringify(LISTING_CONTEXT).toLowerCase()).not.toContain('performance');

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result?.directives.map((d) => [d.slot, d.value])).toEqual([
      ['cta', SHIPPED_CTA],
      ['headline', GROUNDED_HEADLINE],
      ['feature', SHIPPED_FEATURE],
    ]);
  });

  it('matches the label on whitespace and case only', async () => {
    mockCreate.mockResolvedValueOnce(
      anthropicResponse(
        directives('yield_hunter', ['feature', `  ${SHIPPED_FEATURE.toUpperCase()} `]),
      ),
    );

    const result = await callLlmGateway(BASE_INPUT);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
  });

  describe('negatives — the exemption must not reach any of these', () => {
    const judgedAndRefused: [why: string, slot: string, value: string][] = [
      ['label + an invented name appended', 'feature', `${SHIPPED_FEATURE} at Marina Heights`],
      ['an invented amenity in the feature slot', 'feature', 'Private Pool and Sea View'],
      ['an invented agency in the feature slot', 'feature', 'Managed by Knight Frank'],
      // The label is a heading, never a source of property facts: its words do not ground a
      // headline, so the headline is flagged and judged on its own.
      ['label words reused mid-headline', 'headline', `Strong ${SHIPPED_FEATURE} in Alfama`],
      ['the exact label in the WRONG slot', 'headline', `Rental ${SHIPPED_FEATURE}`],
      ["another archetype's label", 'feature', 'Portfolio Metrics'],
    ];
    for (const [why, slot, value] of judgedAndRefused) {
      it(`${why}: ${JSON.stringify(value)} is judged and refused`, async () => {
        mockCreate
          .mockResolvedValueOnce(anthropicResponse(directives('yield_hunter', [slot, value])))
          .mockResolvedValue(JUDGE_REFUSES);

        const result = await callLlmGateway(BASE_INPUT);

        expect(mockCreate).toHaveBeenCalledTimes(2);
        expect(result).toBeNull();
      });
    }

    it('a figure appended to the label is refused deterministically, unjudged', async () => {
      mockCreate.mockResolvedValueOnce(
        anthropicResponse(
          directives('yield_hunter', ['feature', `${SHIPPED_FEATURE}: 9.9% yield`]),
        ),
      );

      const result = await callLlmGateway(BASE_INPUT);

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(result).toBeNull();
    });

    it('one invented name still discards the batch that carries the exempt label', async () => {
      // Element 1 only: the label is exempt, the whole-batch refusal is unchanged.
      mockCreate
        .mockResolvedValueOnce(
          anthropicResponse(
            directives(
              'yield_hunter',
              ['headline', 'Riverside apartment near Marina Heights'],
              ['feature', SHIPPED_FEATURE],
            ),
          ),
        )
        .mockResolvedValue(JUDGE_REFUSES);

      const result = await callLlmGateway(BASE_INPUT);

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result).toBeNull();
    });

    for (const archetype of CLAIM_LABEL_ARCHETYPES) {
      it(`${archetype}'s feature is a property CLAIM and stays judged`, async () => {
        const playbook = getPlaybook(archetype);
        const claim = playbook.slots.find((s) => s.slot === 'feature')?.en ?? '';
        expect(isAuthoredSectionLabel(playbook, 'feature', claim)).toBe(false);

        mockCreate
          .mockResolvedValueOnce(anthropicResponse(directives(archetype, ['feature', claim])))
          .mockResolvedValue(JUDGE_REFUSES);

        const result = await callLlmGateway({
          ...BASE_INPUT,
          archetypeId: archetype,
          basePlaybook: playbook,
        });

        // Each claim carries at least one mid-segment capital the listing lacks, so it is
        // flagged, reaches the judge, and the refusing judge discards it.
        expect(mockCreate).toHaveBeenCalledTimes(2);
        expect(result).toBeNull();
      });
    }

    it('a re-authored label nobody reviewed is not exempt (fails closed)', async () => {
      const reauthored = {
        ...YIELD_HUNTER,
        slots: YIELD_HUNTER.slots.map((s) =>
          s.slot === 'feature' ? { ...s, en: 'Guaranteed Investment Performance' } : s,
        ),
      };
      expect(
        isAuthoredSectionLabel(reauthored, 'feature', 'Guaranteed Investment Performance'),
      ).toBe(false);
      expect(isAuthoredSectionLabel(reauthored, 'feature', SHIPPED_FEATURE)).toBe(false);

      mockCreate
        .mockResolvedValueOnce(
          anthropicResponse(directives('yield_hunter', ['feature', SHIPPED_FEATURE])),
        )
        .mockResolvedValue(JUDGE_REFUSES);

      const result = await callLlmGateway({ ...BASE_INPUT, basePlaybook: reauthored });

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result).toBeNull();
    });
  });

  it('the reviewed map matches the shipped playbooks: 13 labels, no figures, no claims', () => {
    const exempt: string[] = [];
    for (const [archetype, playbook] of getAllPlaybooks()) {
      const feature = playbook.slots.find((s) => s.slot === 'feature')?.en;
      if (feature === undefined) continue;
      if (isAuthoredSectionLabel(playbook, 'feature', feature)) {
        exempt.push(archetype);
        expect(feature).not.toMatch(/\d|\{/);
      }
    }
    expect(exempt).toHaveLength(13);
    for (const claim of CLAIM_LABEL_ARCHETYPES) expect(exempt).not.toContain(claim);
    expect(exempt).not.toContain('neutral');
  });
});
