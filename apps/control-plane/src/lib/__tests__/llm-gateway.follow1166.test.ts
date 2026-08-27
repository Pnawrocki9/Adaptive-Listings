/**
 * FOLLOW-1166 — the prompt must stop offering the template as a source of facts.
 *
 * THE ASYMMETRY THIS CLOSES. FOLLOW-1162 (#869) removed the playbook from the grounding corpus
 * under MASTER_DESIGN §E.7.0: a template cannot know a property, so template text is not evidence
 * about one. It removed the CORPUS half of FOLLOW-1034 and left the PROMPT half — `GROUNDING_RULE`
 * still said "Reuse the wording of the context **and the current directives**", and
 * `buildHaikuPrompt` supplies those current directives as the playbook's own slot copy. So the
 * model was instructed to reuse wording the checker had just stopped accepting. That is [MP-010]'s
 * failure class — rule enforced ≠ rule stated — with the polarity flipped, and MP-010 is the one
 * that cost 100% of the LLM path.
 *
 * WHAT THESE CASES CAN AND CANNOT PROVE, stated up front because the ticket's AC(1) reads as
 * though a prompt edit could move the fact check:
 *
 *   - A prompt edit changes what the model is ASKED for. It cannot change what
 *     `checkDirectiveFacts` does with a value it is handed, and this ticket is explicitly
 *     read-only on the grounding corpus (re-widening it would invert ESC-076). So the shipped
 *     headline is flagged before this change AND after it — `pins the contradiction` below
 *     asserts exactly that, in both directions, so a later change that "fixes" the flag by
 *     re-admitting template copy to the corpus turns this file red.
 *   - What IS falsifiable, and is the ticket's actual subject: the prompt no longer presents
 *     that copy as material to reuse. `red-first` below fails against the pre-FOLLOW-1166
 *     `GROUNDING_RULE`.
 *
 * The REAL playbook is used throughout, never `MOCK_PLAYBOOK`. RETRO-316 §4c is the reason: the
 * fixture's copy is a two-line stub with no shipped string in it, which is precisely why this
 * class was invisible to the suite that already covered the grounding rule.
 *
 * @module apps/control-plane/src/lib/__tests__/llm-gateway.follow1166.test
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
const { getPlaybook } = await import('@estalara/sdk/playbooks');

/** The REAL playbook, not a fixture — the whole point of this file. */
const YIELD_HUNTER = getPlaybook('yield_hunter');

/**
 * The exact string ESC-075 shipped as `yield_hunter`'s headline, read from the playbook rather
 * than retyped, so a future re-authoring of the copy fails this file loudly instead of silently
 * asserting a string nothing serves.
 */
const SHIPPED_HEADLINE = YIELD_HUNTER.slots.find((s) => s.slot === 'headline')?.en ?? '';

/**
 * A listing context in the shape `withListingFacts` produces. It deliberately does NOT contain
 * the words `Rental`, `Yield` or `Profile`: the shipped headline's vocabulary comes from the
 * template, which is the situation FOLLOW-1162 created and this ticket is about.
 */
const LISTING_CONTEXT: Record<string, string> = {
  headline: 'Sunlit apartment with river views',
  description: 'A calm, well-connected home in the old town.',
  bedrooms: '3',
  living_area: '128.5',
  location: 'Alfama, Lisbon',
};

function makeAnthropicResponse(text: string, inputTokens = 150, outputTokens = 50) {
  return {
    content: [{ type: 'text' as const, text }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

function directiveJson(value: string): string {
  const directives: TextDirective[] = [
    { type: 'text', slot: 'headline', value, archetype: 'yield_hunter', confidence: 0.8 },
  ];
  return JSON.stringify(directives);
}

const BASE_INPUT = {
  archetypeId: 'yield_hunter' as const,
  confidence: 0.75,
  similarity: 0.75,
  basePlaybook: YIELD_HUNTER,
  listingContext: LISTING_CONTEXT,
};

/** The prompt actually sent to the model on the first Anthropic call. */
function firstPrompt(): string {
  const callArg = mockCreate.mock.calls[0]?.[0] as { messages: { content: string }[] };
  return callArg.messages[0]?.content ?? '';
}

describe('FOLLOW-1166 — the prompt no longer offers the template as a source of facts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key-follow-1166';
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ total: '0' }] }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('red-first: the grounding rule no longer names the current directives as a wording source', async () => {
    mockCreate.mockResolvedValue(
      makeAnthropicResponse(directiveJson('a calm home near the river')),
    );

    await callLlmGateway(BASE_INPUT);

    const prompt = firstPrompt();
    // The pre-FOLLOW-1166 sentence, verbatim. This is the assertion that was red before the change.
    expect(prompt).not.toContain('Reuse the wording of the context and the current directives');
    // The constraint itself survives — it is FOLLOW-1034's second half and [MP-012] maps it onto a
    // measured false-positive class. Only its second source is gone.
    expect(prompt).toContain('Reuse the wording of the context.');
    expect(prompt).toContain('Do not coin new capitalised');
  });

  it('red-first: the base directives are labelled framing-only, with the listing named as the sole fact source', async () => {
    mockCreate.mockResolvedValue(
      makeAnthropicResponse(directiveJson('a calm home near the river')),
    );

    await callLlmGateway(BASE_INPUT);

    const prompt = firstPrompt();
    // Cutting the clause is not enough on its own: the block is still in the prompt, still headed
    // `Current directives`, and the tail still asks the model to "improve upon" it. Without a label
    // the model has no way to know the difference between framing and evidence.
    expect(prompt).toContain("the archetype's ANGLE, not facts about this property");
    expect(prompt).toContain('written before this property was known');
  });

  it('the shipped headline is still IN the prompt as framing — this ticket does not remove it', async () => {
    mockCreate.mockResolvedValue(
      makeAnthropicResponse(directiveJson('a calm home near the river')),
    );

    await callLlmGateway(BASE_INPUT);

    // Removing the base directives entirely would take the archetype's angle away with them and is
    // FOLLOW-1164's decision, not this one's. What changes is how they are LABELLED.
    expect(SHIPPED_HEADLINE).toBe('Rental Investment — Attractive Yield Profile');
    expect(firstPrompt()).toContain(SHIPPED_HEADLINE);
  });

  it('pins the contradiction: the shipped headline costs a judge round trip, before AND after this change', async () => {
    // THE MEASURED FACT FROM RETRO-316 §4a, executed here rather than quoted — and pinned in BOTH
    // directions on purpose. `Rental`, `Yield` and `Profile` are not in `FACT_CHECK_STOP_CAPS` and
    // are absent from the listing context, so AL's own shipped copy does not survive AL's own fact
    // check. A prompt edit cannot change that and this ticket must not claim to: the fix is that
    // the model is no longer told to reuse this wording. If a future change makes this assertion
    // fail, the corpus has been re-widened and ESC-076 has been inverted.
    mockCreate
      .mockResolvedValueOnce(makeAnthropicResponse(directiveJson(SHIPPED_HEADLINE)))
      .mockResolvedValueOnce(makeAnthropicResponse('{"grounded": true}'));

    const result = await callLlmGateway(BASE_INPUT);

    // Two calls: the generation, then the judge adjudicating `hallucinated_proper_name`.
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const judgePrompt = (mockCreate.mock.calls[1]?.[0] as { messages: { content: string }[] })
      .messages[0]?.content;
    expect(judgePrompt).toContain('strict grounding auditor');
    // The judge rescued it, at the price of a second Anthropic call on a request the buyer waits on.
    expect(result?.directives[0]?.value).toBe(SHIPPED_HEADLINE);
  });

  it('without a judge the same string is DISCARDED — the cost of the asymmetry is availability, not a leak', async () => {
    mockCreate
      .mockResolvedValueOnce(makeAnthropicResponse(directiveJson(SHIPPED_HEADLINE)))
      .mockResolvedValueOnce(makeAnthropicResponse('{"grounded": false}'));

    const result = await callLlmGateway(BASE_INPUT);

    // Fail-closed: the batch is dropped and the caller serves template copy instead.
    expect(result).toBeNull();
  });

  it('the Sonnet prompt never carried a `Current directives` block, so the cut clause named a block half its readers never had', async () => {
    // Recorded because it is the sharpest evidence that the clause was carried rather than
    // maintained: `GROUNDING_RULE` is shared by both builders, but only `buildHaikuPrompt` supplies
    // base directives. On the Sonnet path the model was told to reuse the wording of something the
    // prompt did not contain.
    mockCreate.mockResolvedValue(
      makeAnthropicResponse(directiveJson('a calm home near the river')),
    );

    await callLlmGateway({ ...BASE_INPUT, similarity: 0.4 });

    const prompt = firstPrompt();
    expect(prompt).toContain('Generate 2-3 TextDirective objects');
    expect(prompt).not.toContain('Current directives');
    expect(prompt).not.toContain('Reuse the wording of the context and the current directives');
  });
});
