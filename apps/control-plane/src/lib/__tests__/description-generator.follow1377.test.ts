/**
 * FOLLOW-1377 — the 5.x generation models through `generateDescription()`.
 *
 * Measured 2026-10-22 on the real path: at the 4.x budget every 5.x reply spent `max_tokens`
 * thinking and carried no text, and the generator read `content[0]`, which on a 5.x reply is the
 * `thinking` block. These tests pin the per-model request (budget and thinking fields) and the
 * text-block read, and that a 4.x request is unchanged.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('@/lib/description-pg-cache', () => ({
  publishPgCachedDescription: vi.fn().mockResolvedValue('published'),
}));
vi.mock('@/lib/description-cache', () => ({ setCachedDescription: vi.fn() }));
vi.mock('@/lib/description-generation-audit', () => ({
  writeDescriptionGenerationAudit: vi.fn().mockResolvedValue('written'),
}));
vi.mock('@/lib/llm-calls-register', () => ({
  logLlmCallAsync: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/llm-spend-counter', () => ({
  DAILY_SPEND_CAP_USD: 100,
  getDailySpend: vi.fn().mockResolvedValue(0),
}));

import type { DescriptionRequestedEvent } from '@estalara/shared';
import { generateDescription } from '@/lib/description-generator';

const EVENT: DescriptionRequestedEvent = {
  tenant_id: '00000000-0000-4000-8000-000000001377',
  listing_id: 'listing-1377',
  archetype: 'yield_hunter',
  locale: 'en',
  copy_template: 'Numbers first.',
  // 8 words: `_max_tokens_for` is the 450 floor.
  original_description: 'An apartment with two bedrooms and no pool.',
  listing_context: { price: '400000', location: 'Lisbon' },
  cache_key: 'desc:t:listing-1377:yield_hunter:en:m:r0',
  listing_revision: 0,
};

const FIT_RAW =
  '<adaptation_verdict>FIT</adaptation_verdict>\n' +
  'A two-bedroom apartment in Lisbon, a straightforward option for a rental buyer.\n' +
  '<verified_facts_used>\n["bedrooms: 2"]\n</verified_facts_used>';
const HEADLINE_RAW = 'Apartment in Lisbon with two bedrooms';

/** A 5.x reply: a thinking block first, then the text. */
function thinkingReply(text: string) {
  return {
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text },
    ],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 40 },
  };
}

function textReply(text: string) {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 40 },
  };
}

function bodies(): Record<string, unknown>[] {
  return mockCreate.mock.calls.map((c) => c[0] as Record<string, unknown>);
}

describe('generateDescription — 5.x generation models (FOLLOW-1377)', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-'.repeat(3));
    mockCreate.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('a 4.x model: the request body is exactly the four fields, 450 and 60', async () => {
    mockCreate
      .mockResolvedValueOnce(textReply(FIT_RAW))
      .mockResolvedValueOnce(textReply(HEADLINE_RAW));
    await generateDescription({ ...EVENT, generation_model: 'claude-sonnet-4-6' });
    const [desc, head] = bodies();
    expect(Object.keys(desc!)).toEqual(['model', 'max_tokens', 'system', 'messages']);
    expect(desc!.max_tokens).toBe(450);
    expect(Object.keys(head!)).toEqual(['model', 'max_tokens', 'system', 'messages']);
    expect(head!.max_tokens).toBe(60);
  });

  it('Haiku 5.5: thinking disabled, budget scaled 1.6x plus the 300-token headroom', async () => {
    mockCreate
      .mockResolvedValueOnce(textReply(FIT_RAW))
      .mockResolvedValueOnce(textReply(HEADLINE_RAW));
    const report = await generateDescription({ ...EVENT, generation_model: 'claude-haiku-5-5' });
    expect(report.outcome.verdict).toBe('FIT');
    const [desc, head] = bodies();
    expect(desc).toMatchObject({
      model: 'claude-haiku-5-5',
      max_tokens: 1020, // ceil(450 * 1.6) + 300
      thinking: { type: 'disabled' },
    });
    expect(desc).not.toHaveProperty('output_config');
    expect(head).toMatchObject({ max_tokens: 396, thinking: { type: 'disabled' } }); // 96 + 300
  });

  it('Sonnet 5.5: between_tools at low effort, with the thinking reserve', async () => {
    mockCreate
      .mockResolvedValueOnce(textReply(FIT_RAW))
      .mockResolvedValueOnce(textReply(HEADLINE_RAW));
    await generateDescription({ ...EVENT, generation_model: 'claude-sonnet-5-5' });
    expect(bodies()[0]).toMatchObject({
      max_tokens: 2720, // ceil(450 * 1.6) + 2000
      thinking: { type: 'between_tools' },
      output_config: { effort: 'low' },
    });
  });

  it.each(['claude-opus-5-5', 'claude-fable-5-1'])(
    '%s: always thinks — low effort, the thinking reserve, no thinking field',
    async (model) => {
      mockCreate
        .mockResolvedValueOnce(thinkingReply(FIT_RAW))
        .mockResolvedValueOnce(thinkingReply(HEADLINE_RAW));
      const report = await generateDescription({ ...EVENT, override_model: model });
      const [desc, head] = bodies();
      expect(desc).toMatchObject({ model, max_tokens: 2720, output_config: { effort: 'low' } });
      expect(desc).not.toHaveProperty('thinking');
      expect(head).toMatchObject({ max_tokens: 2096, output_config: { effort: 'low' } });
      // The text after the thinking block is what is read (it was `content[0]`, the thinking).
      expect(report.outcome).toMatchObject({ verdict: 'FIT' });
      expect(report.headline).toBe(HEADLINE_RAW);
    },
  );

  it('a 5.x reply that spent the budget thinking is FAILED, never served', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'thinking', thinking: '', signature: 'sig' }],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 100, output_tokens: 2720 },
    });
    const report = await generateDescription({ ...EVENT, generation_model: 'claude-opus-5-5' });
    expect(report.outcome.verdict).toBe('FAILED');
    expect(report.writes).toEqual({ pg: 'skipped', redis: 'skipped', audit: 'skipped' });
  });
});
