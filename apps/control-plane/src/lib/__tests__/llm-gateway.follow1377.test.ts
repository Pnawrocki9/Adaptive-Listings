/**
 * FOLLOW-1377 — the `/api/adapt` generation call with a 5.x model (the global generation model, or
 * a DEMO MODE `forceModel`). Measured 2026-10-22: at `max_tokens: 512` every 5.x call spent the
 * budget thinking and the gateway fell back with `llm_unavailable`. The request now carries the
 * model's catalog profile; a 4.x request is unchanged.
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

vi.stubGlobal(
  'fetch',
  vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: [{ total: '0' }] }) }),
);

const { callLlmGateway } = await import('@/lib/llm-gateway');

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
    value: 'full generation headline copy',
    archetype: 'yield_hunter',
    confidence: 0.75,
  },
];

const INPUT = {
  archetypeId: 'yield_hunter' as const,
  confidence: 0.95,
  similarity: 0.5,
  basePlaybook: PLAYBOOK,
};

describe('callLlmGateway — 5.x request profile (FOLLOW-1377)', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-'.repeat(3));
    mockCreate.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('a 4.x model: max_tokens 512 and no extra field', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(DIRECTIVES) }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    await callLlmGateway({ ...INPUT, forceModel: 'claude-opus-4-8' });
    const body = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['model', 'max_tokens', 'messages']);
    expect(body.max_tokens).toBe(512);
  });

  it('Opus 5.5: the thinking reserve and low effort; reads the text after the thinking block', async () => {
    mockCreate.mockResolvedValue({
      content: [
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'text', text: JSON.stringify(DIRECTIVES) },
      ],
      usage: { input_tokens: 100, output_tokens: 600 },
    });
    const out = await callLlmGateway({ ...INPUT, forceModel: 'claude-opus-5-5' });
    const body = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 2820, // ceil(512 * 1.6) + 2000
      output_config: { effort: 'low' },
    });
    expect(out?.directives.map((d) => d.slot)).toEqual(['headline']);
  });

  it('Haiku 5.5: thinking disabled', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(DIRECTIVES) }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    await callLlmGateway({ ...INPUT, forceModel: 'claude-haiku-5-5' });
    expect(mockCreate.mock.calls[0]![0]).toMatchObject({
      max_tokens: 1120, // ceil(512 * 1.6) + 300
      thinking: { type: 'disabled' },
    });
  });
});
