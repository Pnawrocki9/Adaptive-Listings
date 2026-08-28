/**
 * FOLLOW-1173 — the fact checker learns the class the withhold rule already defined.
 *
 * THE DISAGREEMENT THIS CLOSES. After #871, `withholdUngroundedDirectives` serves the `cta` slot
 * unconditionally on the template paths, and the argument written into
 * `lib/ungrounded-directives.ts` is precise: a call to action asserts no fact about the property —
 * it is an offer we make or an invitation to the buyer, and it is exactly as true whatever the
 * listing turns out to contain (MASTER_DESIGN §E.7.0). All seventeen shipped CTA strings were
 * enumerated before that line was drawn. Meanwhile `checkDirectiveFacts` flagged that SAME string
 * as `hallucinated_proper_name`. Two controls, one slot, opposite verdicts, neither aware of the
 * other — and on the LLM path the disagreement cost one judge round trip on EVERY request
 * (measured 12/12 in both arms of #873's live run).
 *
 * THE REMEDY IS THE EXISTING CLASS, NOT A NEW WORD. `FACT_CHECK_STOP_CAPS` is untouched. AC(2)
 * required a rule about a class of slot; the class already existed, module-private, with its
 * evidence enumerated. It is now exported as {@link isNonAssertiveSlot} and has exactly two
 * consumers — the withhold rule and this fact check — so the two controls cannot drift apart
 * without one definition changing under both.
 *
 * WHAT IS DELIBERATELY *NOT* EXEMPTED, pinned here so a later change has to argue with a test:
 *
 *   - `hallucinated_number` is untouched for every slot, `cta` included. `Get 6.2% Yield Report`
 *     is a CTA that DOES assert a fact about the property. The exemption is about proper nouns,
 *     which is the half with the unbounded false-positive class (MP-012), not about figures,
 *     which are the compliance-critical half and have no false-positive class left.
 *   - `feature` stays checked and stays judged. The ticket's AC(1) asked for it; it is refused
 *     here on the withhold module's own measured evidence — `feature` is MIXED, and four shipped
 *     strings (`Remote Work Ready`, `Downsizer Friendly`, `Short-Term Rental Projections`,
 *     `Residency Requirements`) are claims about the property. Exempting the slot would let a
 *     model-invented proper name ship in the one slot already measured to carry property claims,
 *     which inverts ESC-076 on the LLM path. See the PR body for the full argument.
 *
 * The REAL playbook is used throughout, never `MOCK_PLAYBOOK` (RETRO-316 §4c).
 *
 * @module apps/control-plane/src/lib/__tests__/llm-gateway.follow1173.test
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

const mockCreate = (Anthropic as unknown as Record<string, () => unknown>)
  .__mockCreate as ReturnType<typeof vi.fn>;

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { callLlmGateway } = await import('@/lib/llm-gateway');
const { isNonAssertiveSlot } = await import('@/lib/ungrounded-directives');
const { getPlaybook } = await import('@estalara/sdk/playbooks');

const YIELD_HUNTER = getPlaybook('yield_hunter');

/** Read from the playbook, not retyped — a re-authoring must fail this file loudly. */
const SHIPPED_CTA = YIELD_HUNTER.slots.find((s) => s.slot === 'cta')?.en ?? '';

/**
 * Deliberately disjoint from the template's vocabulary: it contains neither `Pack` nor
 * `Performance`, so anything the model carries over from the playbook is unbacked.
 */
const LISTING_CONTEXT: Record<string, string> = {
  headline: 'Sunlit apartment with river views',
  description: 'A calm, well-connected home in the old town.',
  bedrooms: '3',
  living_area: '128.5',
  location: 'Alfama, Lisbon',
};

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

describe('FOLLOW-1173 — a fixed non-property label no longer buys a judge round trip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key-follow-1173';
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ total: '0' }] }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('red-first: the shipped CTA costs ONE Anthropic call, not two, and is served', async () => {
    // Before this change: 2 calls (generation + judge). `Request` and `Investment` are in
    // FACT_CHECK_STOP_CAPS; `Pack` is not, and is not segment-initial.
    expect(SHIPPED_CTA).toBe('Request Investment Pack');
    mockCreate.mockResolvedValueOnce(anthropicResponse(directives(['cta', SHIPPED_CTA])));

    const result = await callLlmGateway(BASE_INPUT);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result?.directives[0]?.value).toBe(SHIPPED_CTA);
  });

  it('red-first: with no judge available the same CTA is served instead of discarding the batch', async () => {
    // This is the availability half. Pre-change, a judge outage turned the CTA into a dropped
    // batch — the whole response fell back to playbook copy because of a button label.
    mockCreate
      .mockResolvedValueOnce(
        anthropicResponse(
          directives(['cta', SHIPPED_CTA], ['headline', 'A calm home in Alfama, Lisbon']),
        ),
      )
      .mockRejectedValue(new Error('judge unavailable'));

    const result = await callLlmGateway(BASE_INPUT);

    expect(result).not.toBeNull();
    expect(result?.directives.map((d) => d.slot)).toEqual(['cta', 'headline']);
  });

  it('the exemption is the withhold rule’s class, shared — not a word added to a list', () => {
    // AC(2). One definition, two consumers: if this predicate changes, both controls move.
    expect(isNonAssertiveSlot('cta')).toBe(true);
    expect(isNonAssertiveSlot('headline')).toBe(false);
    expect(isNonAssertiveSlot('feature')).toBe(false);
  });

  it('a CTA that asserts a FIGURE is still rejected deterministically — numbers are not exempt', async () => {
    // The line the exemption must not cross. `6.2%` appears nowhere in the listing context, and
    // no slot buys an exemption from the canonical-digit check.
    mockCreate.mockResolvedValueOnce(
      anthropicResponse(directives(['cta', 'Get the 6.2% Yield Report'])),
    );

    const result = await callLlmGateway(BASE_INPUT);

    expect(result).toBeNull();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('PINNED REFUSAL: `feature` is NOT exempted, and still costs its judge round trip', async () => {
    // The ticket's AC(1) asked for this slot too. Refused on the withhold module's own measured
    // evidence: `feature` is MIXED and four shipped strings are property claims, so exempting it
    // would let a model-invented proper name ship in the slot already known to carry claims.
    // If a later change exempts `feature`, this test goes red and that argument must be answered.
    mockCreate
      .mockResolvedValueOnce(anthropicResponse(directives(['feature', 'Investment Performance'])))
      .mockResolvedValueOnce(anthropicResponse('{"grounded": true}'));

    const result = await callLlmGateway(BASE_INPUT);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result?.directives[0]?.value).toBe('Investment Performance');
  });

  it('the CTA exemption does not spend the judge budget the other slots need', async () => {
    // Pre-change the CTA consumed one of the two judge calls, so a batch with a genuinely
    // ambiguous headline could exhaust `judgeCallBudget` because of a button label. This runs at
    // the default `similarity`, i.e. the HAIKU band, where FOLLOW-1178 left that budget at 2.
    mockCreate
      .mockResolvedValueOnce(
        anthropicResponse(
          directives(
            ['cta', SHIPPED_CTA],
            ['headline', 'Riverside Quarter apartment'],
            ['feature', 'Investment Performance'],
          ),
        ),
      )
      .mockResolvedValue(anthropicResponse('{"grounded": true}'));

    const result = await callLlmGateway(BASE_INPUT);

    // 1 generation + 2 judges (headline, feature). The CTA no longer takes a slot in that budget,
    // so both genuinely-flagged values get adjudicated instead of one hitting the cap.
    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(result?.directives).toHaveLength(3);
  });
});
