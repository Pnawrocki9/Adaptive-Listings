/**
 * FOLLOW-1390 — a leaked model-control tag is refused on BOTH paths.
 *
 * A Haiku 5.5 description body in the FOLLOW-1380 comparison opened with
 * `<reasoning_effort>8</reasoning_effort>`. The description contract only knew its own three tags
 * (`<adaptation_verdict`, `<verified_facts_used`, `<neutral_reason`), and `/api/adapt` knew none.
 * Both paths now refuse a text carrying an opening or closing `reasoning*`, `thinking*` or
 * `effort*` tag (`lib/model-control-tags.ts`): the description as `FAILED / residual_tag`, the
 * headline as suppressed `residual_tag`, an adapt slot as refused `residual_tag`. The words
 * themselves ("thinking about", "effortless") are not tags.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn(() => ({ messages: { create: mockCreate } }));
  return { default: MockAnthropic };
});
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import type { DescriptionRequestedEvent } from '@estalara/shared';
import { getPlaybook } from '@estalara/shared/playbooks';
import { bodyViolatesContract } from '@/lib/grounding-check';
import { generateDescription } from '@/lib/description-generator';
import { callLlmGateway } from '@/lib/llm-gateway';

const LEAKS = [
  '<reasoning_effort>8</reasoning_effort>',
  '<thinking>the buyer wants a garden</thinking>',
  '</thinking>',
  '<reasoning>',
  '<effort>low</effort>',
  '<thinking_budget>200</thinking_budget>',
  '<THINKING>',
];

const BODY = 'A three-bedroom house in Gdańsk with a garden.';

describe('FOLLOW-1390 — the description contract refuses a model-control tag', () => {
  it.each(LEAKS)('%j in the body is residual_tag', (tag) => {
    expect(bodyViolatesContract(`${tag}${BODY}`)).toBe('residual_tag');
    expect(bodyViolatesContract(`${BODY} ${tag}`)).toBe('residual_tag');
  });

  it.each([
    'Thinking about schools? Two are a short walk away.',
    'An effortless, low-maintenance garden.',
    'Reasoning aside, the numbers are the listing’s own.',
    'Rooms < 3 m apart and > 2 m wide.',
  ])('%j is not a tag', (body) => {
    expect(bodyViolatesContract(body)).toBeNull();
  });
});

const EVENT = {
  tenant_id: '00000000-0000-4000-8000-000000001390',
  listing_id: 'listing-1390',
  archetype: 'family_buyer',
  locale: 'en',
  copy_template: 'Warm and practical.',
  original_description: 'A three-bedroom house in Gdańsk with a garden.',
  listing_context: { listing_title: 'House in Gdańsk' },
  cache_key: 'desc:t:listing-1390:family_buyer:en:m:r0',
  listing_revision: 0,
  generation_model: 'claude-haiku-5-5',
} as DescriptionRequestedEvent;

function reply(text: string) {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

describe('FOLLOW-1390 — the generator', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-'.repeat(3));
    mockCreate.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('the study shape (a body opened by <reasoning_effort>) is FAILED / residual_tag', async () => {
    mockCreate.mockResolvedValueOnce(
      reply(
        '<adaptation_verdict>FIT</adaptation_verdict>\n<reasoning_effort>8</reasoning_effort>' +
          `${BODY}\n<verified_facts_used>\n[]\n</verified_facts_used>`,
      ),
    );
    const report = await generateDescription(EVENT);
    expect(report.outcome).toEqual({ verdict: 'FAILED', reason: 'residual_tag' });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('a headline carrying a tag is suppressed as residual_tag', async () => {
    mockCreate
      .mockResolvedValueOnce(
        reply(
          `<adaptation_verdict>FIT</adaptation_verdict>\n${BODY}\n` +
            '<verified_facts_used>\n[]\n</verified_facts_used>',
        ),
      )
      .mockResolvedValueOnce(reply('<thinking>short</thinking>Three-bedroom house in Gdańsk'));
    const report = await generateDescription(EVENT);
    expect(report.outcome.verdict).toBe('FIT');
    expect(report.headline).toBeNull();
    expect(report.headlineViolation).toBe('residual_tag');
  });
});

describe('FOLLOW-1390 — /api/adapt refuses the slot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockReset();
    process.env.ANTHROPIC_API_KEY = 'test-key-follow-1390';
    process.env.CLICKHOUSE_URL = 'http://localhost:8123';
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: '0', data: [{ total: '0' }] }),
      text: () => Promise.resolve(''),
    });
  });
  afterEach(() => {
    delete process.env.CLICKHOUSE_URL;
  });

  const refusedSources = (): string[] =>
    (mockFetch.mock.calls as unknown as [unknown][])
      .map(([url]) => {
        try {
          return new URL(String(url)).searchParams.get('param_p_source');
        } catch {
          return null;
        }
      })
      .filter((s): s is string => !!s && s.startsWith('fact_check_slot_refused_'));

  it.each(LEAKS)('a cta carrying %j is refused; the grounded headline is served', async (tag) => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify([
            {
              type: 'text',
              slot: 'headline',
              value: 'Two-bedroom apartment in Lisbon',
              archetype: 'yield_hunter',
              confidence: 0.8,
            },
            {
              type: 'text',
              slot: 'cta',
              value: `${tag}Two-bedroom apartment in Lisbon`,
              archetype: 'yield_hunter',
              confidence: 0.8,
            },
          ]),
        },
      ],
      usage: { input_tokens: 150, output_tokens: 50 },
    });
    const result = await callLlmGateway({
      archetypeId: 'yield_hunter',
      confidence: 0.75,
      similarity: 0.75,
      basePlaybook: getPlaybook('yield_hunter'),
      listingContext: {
        listing_title: 'apartment',
        listing_description: 'an apartment with two bedrooms',
        listing_location: 'Lisbon',
      },
    });
    expect(result?.directives.map((d) => d.slot)).toEqual(['headline']);
    expect(refusedSources()).toEqual(['fact_check_slot_refused_cta_residual_tag']);
    // Deterministic: no judge round trip.
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
