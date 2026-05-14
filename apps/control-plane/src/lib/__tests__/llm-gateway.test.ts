/**
 * Unit tests for llm-gateway.ts
 *
 * All tests mock @anthropic-ai/sdk and ClickHouse fetch calls.
 * No real API calls are made.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { TextDirective } from '@estalara/shared';

// Mock @anthropic-ai/sdk before importing the module under test
vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn();
  const MockAnthropic = vi.fn(() => ({
    messages: {
      create: mockCreate,
    },
  }));
  // Attach mock to the class so tests can access it
  (MockAnthropic as unknown as Record<string, unknown>).__mockCreate = mockCreate;
  return { default: MockAnthropic };
});

import Anthropic from '@anthropic-ai/sdk';

const mockCreate = (Anthropic as unknown as Record<string, () => unknown>)
  .__mockCreate as ReturnType<typeof vi.fn>;

// Mock the global fetch for ClickHouse calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Helper to create a mock Anthropic response
function makeAnthropicResponse(text: string, inputTokens = 150, outputTokens = 50) {
  return {
    content: [{ type: 'text' as const, text }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

// Import after mocking
const { callLlmGateway } = await import('@/lib/llm-gateway');

// Mock playbook for tests
const MOCK_PLAYBOOK = {
  archetype: 'yield_hunter' as const,
  description: 'Long-term investor maximizing rental cashflow and ROI',
  slots: [{ slot: 'headline', en: 'Rental Yield: {yield}% | Gross Income: {income}/yr' }],
  listing_rules: {
    boost_if: ['has_rental_income'],
    suppress_if: [],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: ['rental_yield'],
  signals: ['views_yield_data', 'clicks_rental_calculator'],
  copy_template: { en: 'Yield-focused investment property with strong rental returns.' },
};

const BASE_INPUT = {
  archetypeId: 'yield_hunter' as const,
  confidence: 0.75,
  similarity: 0.75,
  basePlaybook: MOCK_PLAYBOOK,
};

describe('callLlmGateway — routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // ClickHouse spend check returns 0 by default
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ total: '0' }] }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when ANTHROPIC_API_KEY is not set', async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const result = await callLlmGateway(BASE_INPUT);
    expect(result).toBeNull();

    // Restore
    if (originalKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalKey;
    }
  });

  it('selects Haiku for medium similarity (0.6 < sim <= 0.85)', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-abc123';
    const mockDirectives: TextDirective[] = [
      {
        type: 'text',
        slot: 'headline',
        value: 'Tweaked headline',
        archetype: 'yield_hunter',
        confidence: 0.8,
      },
    ];
    mockCreate.mockResolvedValue(makeAnthropicResponse(JSON.stringify(mockDirectives)));

    const result = await callLlmGateway({ ...BASE_INPUT, similarity: 0.75 });
    expect(result).not.toBeNull();
    expect(result?.model).toBe('claude-haiku-4-5');

    delete process.env.ANTHROPIC_API_KEY;
  });

  it('selects Sonnet for low similarity (sim <= 0.6)', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-abc123';
    const mockDirectives: TextDirective[] = [
      {
        type: 'text',
        slot: 'headline',
        value: 'Full gen headline',
        archetype: 'yield_hunter',
        confidence: 0.75,
      },
    ];
    mockCreate.mockResolvedValue(makeAnthropicResponse(JSON.stringify(mockDirectives)));

    const result = await callLlmGateway({ ...BASE_INPUT, similarity: 0.5 });
    expect(result).not.toBeNull();
    expect(result?.model).toBe('claude-sonnet-4-6');

    delete process.env.ANTHROPIC_API_KEY;
  });
});

describe('callLlmGateway — circuit breaker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key-abc123';
    process.env.CLICKHOUSE_URL = 'http://localhost:8123';
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLICKHOUSE_URL;
    vi.restoreAllMocks();
  });

  it('returns null when rolling 24h spend >= $100', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ total: '101.5' }] }),
    });

    const result = await callLlmGateway(BASE_INPUT);
    expect(result).toBeNull();
    // Anthropic should NOT be called
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('proceeds when spend is $89 (below warn threshold)', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ total: '89' }] }),
      })
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

    const mockDirectives: TextDirective[] = [
      {
        type: 'text',
        slot: 'headline',
        value: 'Normal headline',
        archetype: 'yield_hunter',
        confidence: 0.75,
      },
    ];
    mockCreate.mockResolvedValue(makeAnthropicResponse(JSON.stringify(mockDirectives)));

    const result = await callLlmGateway(BASE_INPUT);
    expect(result).not.toBeNull();
  });
});

describe('callLlmGateway — listingContext injection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key-abc123';
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ total: '0' }] }),
    });
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.restoreAllMocks();
  });

  it('Haiku prompt contains listing context block when listingContext is non-empty', async () => {
    const mockDirectives: TextDirective[] = [
      {
        type: 'text',
        slot: 'headline',
        value: 'Yield headline',
        archetype: 'yield_hunter',
        confidence: 0.8,
      },
    ];
    mockCreate.mockResolvedValue(makeAnthropicResponse(JSON.stringify(mockDirectives)));

    await callLlmGateway({
      ...BASE_INPUT,
      similarity: 0.75,
      listingContext: { yield: '6.5%', location: 'Marbella' },
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    const callArg = mockCreate.mock.calls[0]?.[0] as { messages: { content: string }[] };
    const prompt: string = callArg.messages[0]?.content ?? '';
    expect(prompt).toContain('Listing context (agency-provided):');
    expect(prompt).toContain('yield: 6.5%');
    expect(prompt).toContain('location: Marbella');
    expect(prompt).toContain('Use this data to fill placeholder tokens');
  });

  it('Haiku prompt does NOT contain context block when listingContext is absent', async () => {
    const mockDirectives: TextDirective[] = [
      {
        type: 'text',
        slot: 'headline',
        value: 'Plain headline',
        archetype: 'yield_hunter',
        confidence: 0.8,
      },
    ];
    mockCreate.mockResolvedValue(makeAnthropicResponse(JSON.stringify(mockDirectives)));

    await callLlmGateway({ ...BASE_INPUT, similarity: 0.75 });

    const callArg = mockCreate.mock.calls[0]?.[0] as { messages: { content: string }[] };
    const prompt: string = callArg.messages[0]?.content ?? '';
    expect(prompt).not.toContain('Listing context (agency-provided):');
  });

  it('Haiku prompt does NOT contain context block when listingContext is empty object', async () => {
    const mockDirectives: TextDirective[] = [
      {
        type: 'text',
        slot: 'headline',
        value: 'Plain headline',
        archetype: 'yield_hunter',
        confidence: 0.8,
      },
    ];
    mockCreate.mockResolvedValue(makeAnthropicResponse(JSON.stringify(mockDirectives)));

    await callLlmGateway({ ...BASE_INPUT, similarity: 0.75, listingContext: {} });

    const callArg = mockCreate.mock.calls[0]?.[0] as { messages: { content: string }[] };
    const prompt: string = callArg.messages[0]?.content ?? '';
    expect(prompt).not.toContain('Listing context (agency-provided):');
  });

  it('Sonnet prompt contains listing context block when listingContext is non-empty', async () => {
    const mockDirectives: TextDirective[] = [
      {
        type: 'text',
        slot: 'headline',
        value: 'Full gen headline',
        archetype: 'yield_hunter',
        confidence: 0.75,
      },
    ];
    mockCreate.mockResolvedValue(makeAnthropicResponse(JSON.stringify(mockDirectives)));

    await callLlmGateway({
      ...BASE_INPUT,
      similarity: 0.5,
      listingContext: { yield: '7.2%', bedrooms: '3' },
    });

    const callArg = mockCreate.mock.calls[0]?.[0] as { messages: { content: string }[] };
    const prompt: string = callArg.messages[0]?.content ?? '';
    expect(prompt).toContain('Listing context (agency-provided):');
    expect(prompt).toContain('yield: 7.2%');
    expect(prompt).toContain('bedrooms: 3');
    expect(prompt).toContain('Use this data to fill placeholder tokens');
  });

  it('Sonnet prompt does NOT contain context block when listingContext is absent', async () => {
    const mockDirectives: TextDirective[] = [
      {
        type: 'text',
        slot: 'headline',
        value: 'Full gen headline',
        archetype: 'yield_hunter',
        confidence: 0.75,
      },
    ];
    mockCreate.mockResolvedValue(makeAnthropicResponse(JSON.stringify(mockDirectives)));

    await callLlmGateway({ ...BASE_INPUT, similarity: 0.5 });

    const callArg = mockCreate.mock.calls[0]?.[0] as { messages: { content: string }[] };
    const prompt: string = callArg.messages[0]?.content ?? '';
    expect(prompt).not.toContain('Listing context (agency-provided):');
  });
});

describe('callLlmGateway — response shape', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key-abc123';
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ total: '0' }] }),
    });
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.restoreAllMocks();
  });

  it('returns LlmGatewayOutput with correct shape on success', async () => {
    const mockDirectives: TextDirective[] = [
      {
        type: 'text',
        slot: 'headline',
        value: 'Investment opportunity',
        archetype: 'yield_hunter',
        confidence: 0.85,
      },
    ];
    mockCreate.mockResolvedValue(makeAnthropicResponse(JSON.stringify(mockDirectives), 200, 60));

    const result = await callLlmGateway(BASE_INPUT);
    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      directives: expect.arrayContaining([
        expect.objectContaining({ type: 'text', slot: 'headline' }),
      ]) as unknown,
      model: expect.stringMatching(/^claude-(haiku|sonnet)/) as unknown,
      tokens_in: expect.any(Number) as unknown,
      tokens_out: expect.any(Number) as unknown,
      cost_usd: expect.any(Number) as unknown,
      latency_ms: expect.any(Number) as unknown,
    });
  });

  it('returns null when LLM response contains no valid JSON array', async () => {
    mockCreate.mockResolvedValue(makeAnthropicResponse('I cannot help with that.'));

    const result = await callLlmGateway(BASE_INPUT);
    expect(result).toBeNull();
  });

  it('returns null on Anthropic API error (does not throw)', async () => {
    mockCreate.mockRejectedValue(new Error('API rate limit exceeded'));

    const result = await callLlmGateway(BASE_INPUT);
    expect(result).toBeNull();
  });
});
