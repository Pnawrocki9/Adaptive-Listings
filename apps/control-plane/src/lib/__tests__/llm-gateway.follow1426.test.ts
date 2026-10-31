/**
 * FOLLOW-1426 — the tweak band (0.6 < similarity <= 0.85) is decided from `similarity` once and
 * runs on the generation model. Before this, the band was INFERRED from the model
 * (`model === HAIKU_MODEL`): swapping the model silently turned every tweak response into
 * `llm_full` with the generation prompt. This file fails if the band's source or prompt follows the
 * model again, with the admin model, a Sonnet `forceModel` and a Haiku `forceModel`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
const { generationRequestFor } = await import('@/lib/generation-models');

const PLAYBOOK = {
  archetype: 'yield_hunter' as const,
  description: 'Long-term investor maximizing rental cashflow and ROI',
  slots: [{ slot: 'headline', en: 'Rental Yield: {yield}% | Gross Income: {income}/yr' }],
  listing_rules: {
    boost_if: [],
    suppress_if: [],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [],
  signals: [],
  copy_template: { en: 'Yield-focused.', pl: 'Rentowność.', es: 'Rentabilidad.' },
};

const DIRECTIVES: TextDirective[] = [
  {
    type: 'text',
    slot: 'headline',
    value: 'tweaked headline copy',
    archetype: 'yield_hunter',
    confidence: 0.8,
  },
];

const INPUT = { archetypeId: 'yield_hunter' as const, confidence: 0.95, basePlaybook: PLAYBOOK };

/** Markers that exist in exactly one prompt builder. */
const TWEAK_PROMPT_MARK = 'Current directives';
const GENERATION_PROMPT_MARK = 'Available slots';

const ADMIN_MODEL = 'claude-sonnet-5-5'; // the default global generation model

function bookedSources(): string[] {
  return (mockFetch.mock.calls as unknown as [string][])
    .map(([url]) => new URL(url).searchParams.get('param_p_source'))
    .filter((s): s is string => s !== null);
}

function sentPrompt(): string {
  const body = mockCreate.mock.calls[0]![0] as { messages: { content: string }[] };
  return body.messages[0]!.content;
}

/** `exactOptionalPropertyTypes`: an absent forceModel is an absent key. */
const forced = (m: string | undefined) => (m === undefined ? {} : { forceModel: m });

const MODELS: { label: string; forceModel: string | undefined; expectedModel: string }[] = [
  { label: 'admin model (no forceModel)', forceModel: undefined, expectedModel: ADMIN_MODEL },
  { label: 'forceModel Sonnet 5.5', forceModel: 'claude-sonnet-5-5', expectedModel: ADMIN_MODEL },
  {
    label: 'forceModel Haiku 4.5',
    forceModel: 'claude-haiku-4-5',
    expectedModel: 'claude-haiku-4-5',
  },
];

describe('callLlmGateway — the band follows similarity, never the model (FOLLOW-1426)', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-'.repeat(3));
    vi.stubEnv('CLICKHOUSE_URL', 'http://localhost:8123');
    mockCreate.mockReset();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [] }) });
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(DIRECTIVES) }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  for (const { label, forceModel, expectedModel } of MODELS) {
    it(`tweak band, ${label}: llm_tweaked source and the tweak prompt`, async () => {
      const out = await callLlmGateway({ ...INPUT, similarity: 0.75, ...forced(forceModel) });
      expect(out?.model).toBe(expectedModel);
      expect(mockCreate.mock.calls[0]![0]).toMatchObject({ model: expectedModel });
      expect(sentPrompt()).toContain(TWEAK_PROMPT_MARK);
      expect(sentPrompt()).not.toContain(GENERATION_PROMPT_MARK);
      expect(bookedSources()).toContain('llm_tweaked');
      expect(bookedSources()).not.toContain('llm_full');
    });

    it(`generation band, ${label}: llm_full source and the generation prompt`, async () => {
      await callLlmGateway({ ...INPUT, similarity: 0.5, ...forced(forceModel) });
      expect(sentPrompt()).toContain(GENERATION_PROMPT_MARK);
      expect(sentPrompt()).not.toContain(TWEAK_PROMPT_MARK);
      expect(bookedSources()).toContain('llm_full');
      expect(bookedSources()).not.toContain('llm_tweaked');
    });
  }

  it('the tweak band edges: 0.6 is generation, 0.85 is tweak, 0.86 is generation', async () => {
    await callLlmGateway({ ...INPUT, similarity: 0.6 });
    expect(sentPrompt()).toContain(GENERATION_PROMPT_MARK);
    mockCreate.mockClear();
    await callLlmGateway({ ...INPUT, similarity: 0.85 });
    expect(sentPrompt()).toContain(TWEAK_PROMPT_MARK);
    mockCreate.mockClear();
    await callLlmGateway({ ...INPUT, similarity: 0.86 });
    expect(sentPrompt()).toContain(GENERATION_PROMPT_MARK);
  });

  it('the tweak band on a 5.x model gets the catalog request profile, not a bare 512', async () => {
    await callLlmGateway({ ...INPUT, similarity: 0.75 });
    const expected = generationRequestFor(ADMIN_MODEL, 512);
    const body = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(body.max_tokens).toBe(expected.maxTokens);
    expect(expected.maxTokens).toBeGreaterThan(512);
    expect(body).toMatchObject(expected.extras);
    expect(expected.extras).toMatchObject({ output_config: { effort: 'low' } });
  });

  it('a failed tweak-band call books llm_tweaked_unavailable_error whatever the model', async () => {
    mockCreate.mockRejectedValue(new Error('boom'));
    await callLlmGateway({ ...INPUT, similarity: 0.75, forceModel: 'claude-sonnet-5-5' });
    expect(bookedSources()).toContain('llm_tweaked_unavailable_error');
  });
});
