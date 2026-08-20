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
  copy_template: {
    en: 'VOICE PATTERN:\nYield-focused. Lead with cashflow.\n\nHARD RULES:\nNo invented yield %.',
    pl: 'VOICE PATTERN:\nRentowność. Cashflow na pierwszym miejscu.\n\nHARD RULES:\nBez wymyślonej rentowności.',
    es: 'VOICE PATTERN:\nRentabilidad. Cashflow primero.\n\nHARD RULES:\nSin rentabilidad inventada.',
  },
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
        // Lowercase, no proper nouns/digits: these routing tests only assert
        // which model was selected, not fact grounding (FOLLOW-457 AC2).
        value: 'tweaked headline copy',
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
        value: 'full generation headline copy',
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
        value: 'normal headline copy',
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

  // FOLLOW-1022: the fact check was enforced but never stated to the model, so it kept writing
  // figures the playbook templates ask for ("7.2% Cap Rate") and every batch was discarded.
  // Both prompts must carry the rule, regardless of whether a listing context exists.
  it.each([
    ['Haiku', 0.75],
    ['Sonnet', 0.4],
  ])('%s prompt states the grounding rule the fact check enforces', async (_model, similarity) => {
    mockCreate.mockResolvedValue(
      makeAnthropicResponse(
        JSON.stringify([
          {
            type: 'text',
            slot: 'headline',
            value: 'plain grounded copy',
            archetype: 'yield_hunter',
            confidence: 0.8,
          },
        ] satisfies TextDirective[]),
      ),
    );

    await callLlmGateway({ ...BASE_INPUT, similarity });

    const callArg = mockCreate.mock.calls[0]?.[0] as { messages: { content: string }[] };
    const prompt: string = callArg.messages[0]?.content ?? '';
    expect(prompt).toContain('Grounding rule (enforced');
    expect(prompt).toContain('must appear in the listing context above');
    expect(prompt).toContain('Never estimate, extrapolate or invent');
    // FOLLOW-1034 second half: the checker is a TOKEN check, so the prompt must state the
    // token-level consequences — exact typography, no new capitalised coinages, no
    // translation of a foreign-language context's nouns. Without these lines the model
    // fails the check in good faith (prod 2026-08-19: "SF", "Income-Generating",
    // "Outbuildings" vs a French context's "hangar").
    expect(prompt).toContain('EXACTLY as the context writes it');
    expect(prompt).toContain('Do not coin new capitalised');
    expect(prompt).toContain('translate its nouns');
    // Anti-priming (MP-012): quoting a forbidden coinage in the rule made the model WRITE it.
    // The rule must carry no concrete counterexample tokens, and it must forbid the model's
    // own real-world knowledge of the property explicitly.
    expect(prompt).not.toContain('Income-Generating');
    expect(prompt).not.toContain('Multi-Unit');
    expect(prompt).toContain('do not use that knowledge');
  });

  it('Haiku prompt does NOT contain context block when listingContext is absent', async () => {
    const mockDirectives: TextDirective[] = [
      {
        type: 'text',
        slot: 'headline',
        value: 'plain headline copy',
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
        value: 'plain headline copy',
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
        value: 'full generation headline copy',
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
        value: 'full generation headline copy',
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

describe('callLlmGateway — FOLLOW-457 AC2/AC3: directive fact-whitelist grounding check', () => {
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

  it('POISONED CONTEXT: rejects a hallucinated price that only coincidentally overlaps a grounded number (fails safe -> null, caller falls back to playbook)', async () => {
    // Poisoned context: listingContext genuinely contains "1,200" (rent_pcm), but
    // the model hallucinates a DIFFERENT, similar-looking price "1,500". A naive
    // substring check would wrongly "verify" 1,500 via the "1,200" digits; the
    // numeric-boundary check must reject it.
    const mockDirectives: TextDirective[] = [
      {
        type: 'text',
        slot: 'headline',
        value: 'Prime rental at $1,500/mo — strong demand',
        archetype: 'yield_hunter',
        confidence: 0.75,
      },
    ];
    mockCreate.mockResolvedValue(makeAnthropicResponse(JSON.stringify(mockDirectives)));

    const result = await callLlmGateway({
      ...BASE_INPUT,
      similarity: 0.75,
      listingContext: { rent_pcm: '1,200', currency: 'USD' },
    });

    // Rejected -> whole gateway call fails safe (caller falls back to playbook copy).
    expect(result).toBeNull();
  });

  it('POISONED CONTEXT: rejects a hallucinated area/sqm figure absent from grounding', async () => {
    const mockDirectives: TextDirective[] = [
      {
        type: 'text',
        slot: 'headline',
        value: 'Spacious 120m² apartment with private terrace',
        archetype: 'yield_hunter',
        confidence: 0.5,
      },
    ];
    mockCreate.mockResolvedValue(makeAnthropicResponse(JSON.stringify(mockDirectives)));

    // Low similarity -> full-generation (Sonnet) path.
    const result = await callLlmGateway({
      ...BASE_INPUT,
      similarity: 0.5,
      listingContext: { bedrooms: '3', location: 'Marbella' },
    });

    expect(result).toBeNull();
  });

  it('rejects a hallucinated proper name (school/agent/developer) absent from grounding', async () => {
    const mockDirectives: TextDirective[] = [
      {
        type: 'text',
        slot: 'feature',
        // "Close" is grounded (via listingContext.notes below); "Redland" is not
        // grounded anywhere — the invented school name must trip the check.
        value: 'Close to Redland Primary',
        archetype: 'yield_hunter',
        confidence: 0.75,
      },
    ];
    mockCreate.mockResolvedValue(makeAnthropicResponse(JSON.stringify(mockDirectives)));

    const result = await callLlmGateway({
      ...BASE_INPUT,
      similarity: 0.75,
      listingContext: { location: 'Bristol', notes: 'close to primary schools' },
    });

    expect(result).toBeNull();
  });

  it('GREEN SIDE: a number present verbatim in listingContext passes the check', async () => {
    const mockDirectives: TextDirective[] = [
      {
        type: 'text',
        slot: 'headline',
        value: 'Rental Yield: 6.5% | Gross Income: 12000',
        archetype: 'yield_hunter',
        confidence: 0.75,
      },
    ];
    mockCreate.mockResolvedValue(makeAnthropicResponse(JSON.stringify(mockDirectives)));

    // The digit token extracted from the directive value must appear as an
    // exact, complete numeric unit in the grounding — so listingContext carries
    // the same literal strings ("6.5%" including the percent sign, "12000" with
    // no thousands separator) the directive echoes back.
    const result = await callLlmGateway({
      ...BASE_INPUT,
      similarity: 0.75,
      listingContext: { yield: '6.5%', income: '12000' },
    });

    expect(result).not.toBeNull();
    expect(result?.directives[0]?.value).toBe('Rental Yield: 6.5% | Gross Income: 12000');
  });

  it('GREEN SIDE: a proper name present in listingContext (e.g. location) passes the check', async () => {
    const mockDirectives: TextDirective[] = [
      {
        type: 'text',
        slot: 'headline',
        value: 'Marbella investment with strong rental demand',
        archetype: 'yield_hunter',
        confidence: 0.75,
      },
    ];
    mockCreate.mockResolvedValue(makeAnthropicResponse(JSON.stringify(mockDirectives)));

    const result = await callLlmGateway({
      ...BASE_INPUT,
      similarity: 0.75,
      listingContext: { location: 'Marbella' },
    });

    expect(result).not.toBeNull();
  });

  it('GREEN SIDE: generic descriptive copy with no digits/proper nouns always passes', async () => {
    const mockDirectives: TextDirective[] = [
      {
        type: 'text',
        slot: 'cta',
        // Every capitalised word here is a generic stop-cap opener/framing word
        // (see FACT_CHECK_STOP_CAPS) — no proper noun, no digit.
        value: 'Ideal Investment For Your Portfolio',
        archetype: 'yield_hunter',
        confidence: 0.75,
      },
    ];
    mockCreate.mockResolvedValue(makeAnthropicResponse(JSON.stringify(mockDirectives)));

    const result = await callLlmGateway({ ...BASE_INPUT, similarity: 0.75 });

    expect(result).not.toBeNull();
  });
});

describe('callLlmGateway — FOLLOW-261 parameterized ClickHouse INSERT (logLlmCallAsync)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key-abc123';
    process.env.CLICKHOUSE_URL = 'http://localhost:8123';
    // First fetch call = spend check (returns 0), second = INSERT
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ total: '0' }] }),
      })
      .mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLICKHOUSE_URL;
    vi.restoreAllMocks();
  });

  it('FOLLOW-261: INSERT query body uses {p_*:Type} placeholders, not interpolated values', async () => {
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
      sessionId: 'sess-inject-test',
      tenantId: 'tenant-inject-test',
    });

    // Second fetch call is the ClickHouse INSERT (first is the spend check)
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [, options] = mockFetch.mock.calls[1] as [string, RequestInit];
    const body = options.body as string;

    expect(body).toContain('{p_session_id:String}');
    expect(body).toContain('{p_tenant_id:String}');
    expect(body).toContain('{p_model:String}');
    expect(body).toContain('{p_cost_usd:Float64}');
    // Literal values must NOT be interpolated into the query body
    expect(body).not.toContain('sess-inject-test');
    expect(body).not.toContain('tenant-inject-test');
  });

  it('FOLLOW-261: values appear as URL query params on the ClickHouse INSERT URL', async () => {
    const sessionId = 'sess-param-verify';
    const tenantId = 'tenant-param-verify';
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

    await callLlmGateway({ ...BASE_INPUT, similarity: 0.75, sessionId, tenantId });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [fetchUrl] = mockFetch.mock.calls[1] as [string];
    const parsedUrl = new URL(fetchUrl);

    expect(parsedUrl.searchParams.get('param_p_session_id')).toBe(sessionId);
    expect(parsedUrl.searchParams.get('param_p_tenant_id')).toBe(tenantId);
    expect(parsedUrl.searchParams.get('param_p_model')).toBe('claude-haiku-4-5');
    expect(parsedUrl.origin).toBe('http://localhost:8123');
  });

  it('FOLLOW-261 (F-30): single-quote in tenantId goes to URL param, not query body', async () => {
    const maliciousTenant = "t'); DROP TABLE llm_calls; --";
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
      tenantId: maliciousTenant,
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [fetchUrl, options] = mockFetch.mock.calls[1] as [string, RequestInit];
    const body = options.body as string;
    const parsedUrl = new URL(fetchUrl);

    expect(body).not.toContain('DROP TABLE');
    expect(body).not.toContain(maliciousTenant);
    expect(parsedUrl.searchParams.get('param_p_tenant_id')).toBe(maliciousTenant);
  });
});

describe('callLlmGateway — FOLLOW-1034 / ESC-063: the fact check must not reject GROUNDED copy', () => {
  // Every `value` in this block is a verbatim production rejection captured in the
  // control-plane logs on 2026-08-18 while diagnosing ESC-063 (listing
  // d3a81d0a-2652-4ab2-91e5-a82d24c0ada4, archetype yield_hunter). Each one was
  // grounded — the facts were in the context and in some cases the words were the
  // playbook's OWN copy — and each was discarded, which is where the ~50% production
  // fallback rate came from: whether a generation survived depended on whether the
  // model happened to reuse exact playbook tokens and exact number typography.

  /** Prod-shaped playbook: cta slot + headline variants, like the real yieldHunterPlaybook. */
  const PROD_SHAPE_PLAYBOOK = {
    ...MOCK_PLAYBOOK,
    slots: [
      {
        slot: 'headline',
        en: 'Rental Yield: {yield}% | Gross Income: {income}/yr',
        variants: {
          en: [
            'Rental Yield: {yield}% | Gross Income: {income}/yr',
            'Investment Property — {yield}% Gross Yield, Tenant in Place',
            'Passive Income: {income}/yr — Cash-Flow Positive from Day One',
          ],
        },
      },
      { slot: 'cta', en: 'Request Investment Pack' },
    ],
  };

  /** The listing facts exactly as withListingFacts shapes them for d3a81d0a. */
  const LISTING_FACTS = {
    listing_title: 'Maison de caractère 4 chambres avec jardin',
    listing_description: 'A 4 bedroom detached house of 158 m² with 7 rooms and 2 bathrooms.',
    listing_price: '97200 EUR',
    listing_location: 'Saint-Dizier-les-Domaines',
  };

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

  const gatewayWith = async (value: string, slot = 'headline') => {
    const mockDirectives: TextDirective[] = [
      { type: 'text', slot, value, archetype: 'yield_hunter', confidence: 0.75 },
    ];
    mockCreate.mockResolvedValue(makeAnthropicResponse(JSON.stringify(mockDirectives)));
    return callLlmGateway({
      ...BASE_INPUT,
      basePlaybook: PROD_SHAPE_PLAYBOOK,
      similarity: 0.75,
      listingContext: LISTING_FACTS,
    });
  };

  it('accepts grounded numbers regardless of typography (€97,200 vs "97200 EUR", 158m² vs "158 m²")', async () => {
    // Rejected in prod as hallucinated_number: every figure here IS in the context,
    // the model merely formatted them the way humans write them.
    const result = await gatewayWith(
      '4-Bed Income Property | 158m² | €97,200 | Saint-Dizier-les-Domaines',
    );
    expect(result).not.toBeNull();
  });

  it('accepts the playbook\'s own CTA vocabulary with a generic verb swap ("Get Investment Pack")', async () => {
    // Rejected in prod as hallucinated_proper_name — on "Get". The other two words are
    // verbatim from the playbook's own cta slot. A generic imperative is not a proper name.
    const result = await gatewayWith('Get Investment Pack', 'cta');
    expect(result).not.toBeNull();
  });

  it('accepts inflection of grounded vocabulary ("Maximize" vs description\'s "maximizing")', async () => {
    // Rejected in prod as hallucinated_proper_name. "Strong" and "Your" are stop-capped,
    // "Rental"/"Yield"/"Cashflow" are in the playbook — the batch died on morphology.
    const result = await gatewayWith('Strong Rental Yield | Maximize Your Cashflow');
    expect(result).not.toBeNull();
  });

  it("accepts vocabulary from the playbook's bandit VARIANTS, not only the base slot copy", async () => {
    // The served copy can BE a variant (FOLLOW-342 bandit), so variant vocabulary is
    // authored copy and must ground — before FOLLOW-1034 only `s.en` was in the grounding text.
    const result = await gatewayWith('Tenant in Place — Passive Income from Day One');
    expect(result).not.toBeNull();
  });

  it('STILL rejects an invented proper name in the same shape that used to leak (Redland-class)', async () => {
    // The guard this loosening must not lose: an entity absent from every grounding
    // source. "Beaumont" is nowhere in the playbook, variants, or listing facts.
    const result = await gatewayWith('Near Beaumont Academy | 158m²');
    expect(result).toBeNull();
  });

  it('STILL rejects a number absent from the context even in human typography (€120,000)', async () => {
    // Canonicalisation must compare digits, not loosen the check: 120000 is not a fact
    // of this listing in any format.
    const result = await gatewayWith('Priced at €120,000 | Saint-Dizier-les-Domaines');
    expect(result).toBeNull();
  });
});

describe('callLlmGateway — FOLLOW-1034 / MP-012: segment-initial capitals are not proper-name evidence', () => {
  const LISTING_FACTS_FR = {
    listing_title: 'Maison de caractère 4 chambres avec jardin',
    listing_description:
      'Maison de campagne individuelle de caractère. La propriété offre 158 m², 7 pièces, 4 chambres et 2 salles de bains.',
    listing_price: '97200 EUR',
    listing_location: 'Saint-Dizier-les-Domaines',
  };

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

  const gatewayWithFr = async (value: string) => {
    const mockDirectives: TextDirective[] = [
      { type: 'text', slot: 'headline', value, archetype: 'yield_hunter', confidence: 0.75 },
    ];
    mockCreate.mockResolvedValue(makeAnthropicResponse(JSON.stringify(mockDirectives)));
    return callLlmGateway({
      ...BASE_INPUT,
      similarity: 0.75,
      listingContext: LISTING_FACTS_FR,
    });
  };

  it('accepts a fully obedient French headline whose segments open with generic capitals', async () => {
    // Verbatim prod rejection (2026-08-19, post-#785): exact typography, untranslated nouns —
    // and still discarded, because "Potentiel" opens a "|" segment and the stop-caps list is
    // English. Position, not vocabulary, is the tell: segment-initial capitals are style.
    const result = await gatewayWithFr(
      'Maison de caractère 158 m² | 97200 EUR | Potentiel locatif campagne',
    );
    expect(result).not.toBeNull();
  });

  it('STILL rejects a mid-segment invented entity, in the same sentence shape', async () => {
    // "Santa Maria" mid-segment must stay caught — the building name is real-world true and
    // absent from the context, which is exactly what the policy forbids.
    const result = await gatewayWithFr(
      'Maison de caractère 158 m² | residence at Santa Maria with jardin',
    );
    expect(result).toBeNull();
  });
});

describe('callLlmGateway — FOLLOW-1034 judge tier: name flags are adjudicated, numbers are not', () => {
  const LISTING_FACTS_FR = {
    listing_title: 'Maison de caractère 4 chambres avec jardin',
    listing_description:
      'Maison de campagne. La propriété offre 158 m², 7 pièces, avec grange et hangar.',
    listing_price: '97200 EUR',
    listing_location: 'Saint-Dizier-les-Domaines',
  };

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

  /** A value the token scan flags on a MID-segment capital that is a translation, not a name. */
  const TRANSLATED_VALUE = 'Country house with converted Barn and outbuildings';

  const directivesFor = (value: string): TextDirective[] => [
    { type: 'text', slot: 'feature', value, archetype: 'yield_hunter', confidence: 0.75 },
  ];

  it('accepts a token-flagged value when the judge rules it grounded (translation class)', async () => {
    // "Barn" is the French context's "grange" — a translation the token scan can never see.
    // First mocked call = generation, second = the judge verdict.
    mockCreate
      .mockResolvedValueOnce(makeAnthropicResponse(JSON.stringify(directivesFor(TRANSLATED_VALUE))))
      .mockResolvedValueOnce(makeAnthropicResponse('{"grounded": true}'));

    const result = await callLlmGateway({
      ...BASE_INPUT,
      similarity: 0.75,
      listingContext: LISTING_FACTS_FR,
    });

    expect(result).not.toBeNull();
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('keeps the rejection when the judge rules it ungrounded', async () => {
    mockCreate
      .mockResolvedValueOnce(makeAnthropicResponse(JSON.stringify(directivesFor(TRANSLATED_VALUE))))
      .mockResolvedValueOnce(makeAnthropicResponse('{"grounded": false}'));

    const result = await callLlmGateway({
      ...BASE_INPUT,
      similarity: 0.75,
      listingContext: LISTING_FACTS_FR,
    });

    expect(result).toBeNull();
  });

  it('fails CLOSED when the judge errors: the token rejection stands', async () => {
    mockCreate
      .mockResolvedValueOnce(makeAnthropicResponse(JSON.stringify(directivesFor(TRANSLATED_VALUE))))
      .mockRejectedValueOnce(new Error('judge down'));

    const result = await callLlmGateway({
      ...BASE_INPUT,
      similarity: 0.75,
      listingContext: LISTING_FACTS_FR,
    });

    expect(result).toBeNull();
  });

  it('never consults the judge for a number violation — figures are deterministic', async () => {
    // 175 m² is not a fact of this listing in any typography. Were the judge consulted,
    // the mocked second call would approve it — the assertion that only ONE Anthropic
    // call happened proves numbers bypass adjudication entirely.
    mockCreate
      .mockResolvedValueOnce(
        makeAnthropicResponse(JSON.stringify(directivesFor('Country house of 175 m² with garden'))),
      )
      .mockResolvedValueOnce(makeAnthropicResponse('{"grounded": true}'));

    const result = await callLlmGateway({
      ...BASE_INPUT,
      similarity: 0.75,
      listingContext: LISTING_FACTS_FR,
    });

    expect(result).toBeNull();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

describe('callLlmGateway — FOLLOW-1040: the judge is bounded in time and in count', () => {
  const LISTING_FACTS_FR = {
    listing_title: 'Maison de caractère 4 chambres avec jardin',
    listing_description:
      'Maison de campagne. La propriété offre 158 m², 7 pièces, avec grange et hangar.',
    listing_price: '97200 EUR',
    listing_location: 'Saint-Dizier-les-Domaines',
  };

  /** Mirrors the private JUDGE_DEADLINE_MS in llm-gateway.ts — kept private per Rule I. */
  const JUDGE_DEADLINE_MS = 2000;

  /** A value the token scan flags on a MID-segment capital that is a translation, not a name. */
  const TRANSLATED_VALUE = 'Country house with converted Barn and outbuildings';

  const directivesFor = (slots: string[]): TextDirective[] =>
    slots.map((slot) => ({
      type: 'text' as const,
      slot,
      value: TRANSLATED_VALUE,
      archetype: 'yield_hunter' as const,
      confidence: 0.75,
    }));

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key-abc123';
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ total: '0' }] }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.ANTHROPIC_API_KEY;
    vi.restoreAllMocks();
  });

  it('fails CLOSED when the judge exceeds its deadline (a hung judge cannot hang /adapt)', async () => {
    vi.useFakeTimers();
    mockCreate
      .mockResolvedValueOnce(makeAnthropicResponse(JSON.stringify(directivesFor(['feature']))))
      // The judge never answers. Without a deadline this await never settles.
      .mockImplementationOnce(() => new Promise<never>(() => undefined));

    const pending = callLlmGateway({
      ...BASE_INPUT,
      similarity: 0.75,
      listingContext: LISTING_FACTS_FR,
    });

    await vi.advanceTimersByTimeAsync(JUDGE_DEADLINE_MS + 50);

    // Fails closed: the token rejection stands, so the whole batch is discarded.
    await expect(pending).resolves.toBeNull();
  });

  it('aborts the in-flight judge request on deadline expiry, so an abandoned call stops costing tokens', async () => {
    vi.useFakeTimers();
    let judgeSignal: AbortSignal | undefined;
    mockCreate
      .mockResolvedValueOnce(makeAnthropicResponse(JSON.stringify(directivesFor(['feature']))))
      .mockImplementationOnce((_params: unknown, options?: { signal?: AbortSignal }) => {
        judgeSignal = options?.signal;
        return new Promise<never>(() => undefined);
      });

    const pending = callLlmGateway({
      ...BASE_INPUT,
      similarity: 0.75,
      listingContext: LISTING_FACTS_FR,
    });

    await vi.advanceTimersByTimeAsync(JUDGE_DEADLINE_MS + 50);
    await pending;

    expect(judgeSignal).toBeInstanceOf(AbortSignal);
    expect(judgeSignal?.aborted).toBe(true);
  });

  it('caps judge invocations per request: the third flagged slot falls through to the token rejection', async () => {
    // Three flagged directives, a judge that would approve every one of them. The cap is
    // what stops the third round trip — and the un-adjudicated flag still rejects the batch,
    // so the cap never silently skips the fact check.
    mockCreate
      .mockResolvedValueOnce(
        makeAnthropicResponse(JSON.stringify(directivesFor(['headline', 'cta', 'feature']))),
      )
      .mockResolvedValue(makeAnthropicResponse('{"grounded": true}'));

    const result = await callLlmGateway({
      ...BASE_INPUT,
      similarity: 0.75,
      listingContext: LISTING_FACTS_FR,
    });

    expect(result).toBeNull();
    // 1 generation + exactly 2 judge calls. Uncapped this would be 1 + 3 and non-null.
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it('does NOT cap below the realistic recovery case: two flagged slots are both adjudicated', async () => {
    mockCreate
      .mockResolvedValueOnce(
        makeAnthropicResponse(JSON.stringify(directivesFor(['headline', 'cta']))),
      )
      .mockResolvedValue(makeAnthropicResponse('{"grounded": true}'));

    const result = await callLlmGateway({
      ...BASE_INPUT,
      similarity: 0.75,
      listingContext: LISTING_FACTS_FR,
    });

    expect(result).not.toBeNull();
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });
});

describe('callLlmGateway — FOLLOW-1041: the judge verdict is countable on the ClickHouse row', () => {
  const LISTING_FACTS_FR = {
    listing_title: 'Maison de caractère 4 chambres avec jardin',
    listing_description:
      'Maison de campagne. La propriété offre 158 m², 7 pièces, avec grange et hangar.',
    listing_price: '97200 EUR',
    listing_location: 'Saint-Dizier-les-Domaines',
  };

  /** Mirrors the private JUDGE_DEADLINE_MS in llm-gateway.ts — kept private per Rule I. */
  const JUDGE_DEADLINE_MS = 2000;

  /** A value the token scan flags on a MID-segment capital that is a translation, not a name. */
  const TRANSLATED_VALUE = 'Country house with converted Barn and outbuildings';

  const directivesFor = (slots: string[]): TextDirective[] =>
    slots.map((slot) => ({
      type: 'text' as const,
      slot,
      value: TRANSLATED_VALUE,
      archetype: 'yield_hunter' as const,
      confidence: 0.75,
    }));

  /** Every `param_p_source` value on ClickHouse INSERT calls that names a judge verdict. */
  const judgeSourcesFromFetch = (): string[] =>
    (mockFetch.mock.calls as unknown as [string][])
      .map(([url]) => {
        try {
          return new URL(url).searchParams.get('param_p_source');
        } catch {
          return null;
        }
      })
      .filter((s: string | null): s is string => !!s && s.startsWith('fact_check_judge_'));

  /**
   * The FULL judge row, not just its `source` [FOLLOW-1049]. `judgeSourcesFromFetch` reads one
   * param, which is why half of BUG-1 (a parse throw booking real tokens as 0,0 against the
   * $100/day breaker) was invisible to a green suite — the label was wrong AND the cost was
   * wrong, and only the label was ever asserted.
   */
  const judgeRowsFromFetch = (): { source: string; tokensIn: string; costUsd: string }[] =>
    (mockFetch.mock.calls as unknown as [string][])
      .map(([url]) => {
        try {
          return new URL(url).searchParams;
        } catch {
          return null;
        }
      })
      .filter((q): q is URLSearchParams => {
        const src = q?.get('param_p_source');
        return !!src && src.startsWith('fact_check_judge_');
      })
      .map((q) => ({
        source: q.get('param_p_source') ?? '',
        tokensIn: q.get('param_p_tokens_in') ?? '',
        costUsd: q.get('param_p_cost_usd') ?? '',
      }));

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key-abc123';
    process.env.CLICKHOUSE_URL = 'http://localhost:8123';
    // fetch[0] = spend-check SELECT; every later call = an INSERT (generation row and/or
    // judge row(s)) — all accepted with a bare ok:true, matching the FOLLOW-261 block's pattern.
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ total: '0' }] }),
      })
      .mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLICKHOUSE_URL;
    vi.restoreAllMocks();
  });

  it('records `fact_check_judge_override` when the judge overrides the token-scan flag', async () => {
    mockCreate
      .mockResolvedValueOnce(makeAnthropicResponse(JSON.stringify(directivesFor(['feature']))))
      .mockResolvedValueOnce(makeAnthropicResponse('{"grounded": true}'));

    const result = await callLlmGateway({
      ...BASE_INPUT,
      similarity: 0.75,
      listingContext: LISTING_FACTS_FR,
    });

    expect(result).not.toBeNull();
    expect(judgeSourcesFromFetch()).toEqual(['fact_check_judge_override']);
  });

  it('records `fact_check_judge_flag_confirmed` when the judge upholds the token-scan flag', async () => {
    mockCreate
      .mockResolvedValueOnce(makeAnthropicResponse(JSON.stringify(directivesFor(['feature']))))
      .mockResolvedValueOnce(makeAnthropicResponse('{"grounded": false}'));

    const result = await callLlmGateway({
      ...BASE_INPUT,
      similarity: 0.75,
      listingContext: LISTING_FACTS_FR,
    });

    expect(result).toBeNull();
    expect(judgeSourcesFromFetch()).toEqual(['fact_check_judge_flag_confirmed']);
  });

  it('records `fact_check_judge_unavailable_timeout`, distinct from a non-timeout error, on deadline expiry', async () => {
    vi.useFakeTimers();
    mockCreate
      .mockResolvedValueOnce(makeAnthropicResponse(JSON.stringify(directivesFor(['feature']))))
      // The judge never answers — the deadline timer is what settles the race.
      .mockImplementationOnce(() => new Promise<never>(() => undefined));

    const pending = callLlmGateway({
      ...BASE_INPUT,
      similarity: 0.75,
      listingContext: LISTING_FACTS_FR,
    });

    await vi.advanceTimersByTimeAsync(JUDGE_DEADLINE_MS + 50);
    const result = await pending;

    expect(result).toBeNull();
    expect(judgeSourcesFromFetch()).toEqual(['fact_check_judge_unavailable_timeout']);
  });

  it('records `fact_check_judge_unavailable_error`, distinct from a timeout, on a non-deadline judge failure', async () => {
    mockCreate
      .mockResolvedValueOnce(makeAnthropicResponse(JSON.stringify(directivesFor(['feature']))))
      .mockRejectedValueOnce(new Error('judge down'));

    const result = await callLlmGateway({
      ...BASE_INPUT,
      similarity: 0.75,
      listingContext: LISTING_FACTS_FR,
    });

    expect(result).toBeNull();
    expect(judgeSourcesFromFetch()).toEqual(['fact_check_judge_unavailable_error']);
  });

  it('does NOT record any judge-verdict source when the token scan never flags anything (the negative half)', async () => {
    // No capitalised word absent from grounding: nothing trips checkDirectiveFacts, so
    // judgeNameGrounding is never called and must write zero rows — before FOLLOW-1041
    // nothing asserted this, only that a verdict existed once the judge already ran.
    const mockDirectives: TextDirective[] = [
      {
        type: 'text',
        slot: 'headline',
        value: 'plain grounded copy',
        archetype: 'yield_hunter',
        confidence: 0.75,
      },
    ];
    mockCreate.mockResolvedValue(makeAnthropicResponse(JSON.stringify(mockDirectives)));

    const result = await callLlmGateway({
      ...BASE_INPUT,
      similarity: 0.75,
      listingContext: LISTING_FACTS_FR,
    });

    expect(result).not.toBeNull();
    expect(mockCreate).toHaveBeenCalledTimes(1); // generation only — judge never invoked
    expect(judgeSourcesFromFetch()).toEqual([]);
  });

  it('writes exactly one judge-verdict row per ADJUDICATED flag, not per flagged directive — a cap-exceeded flag writes none', async () => {
    // Three flagged directives, cap = 2 (MAX_JUDGE_CALLS_PER_REQUEST, mirrored from FOLLOW-1040's
    // block). The third flag falls through to the deterministic rejection without ever calling
    // judgeNameGrounding, so it must contribute zero rows — a cap-exceeded flag is a fourth
    // outcome that must not be counted as a judge verdict.
    mockCreate
      .mockResolvedValueOnce(
        makeAnthropicResponse(JSON.stringify(directivesFor(['headline', 'cta', 'feature']))),
      )
      .mockResolvedValue(makeAnthropicResponse('{"grounded": true}'));

    const result = await callLlmGateway({
      ...BASE_INPUT,
      similarity: 0.75,
      listingContext: LISTING_FACTS_FR,
    });

    expect(result).toBeNull();
    expect(mockCreate).toHaveBeenCalledTimes(3); // 1 generation + 2 judge calls (capped)
    expect(judgeSourcesFromFetch()).toEqual([
      'fact_check_judge_override',
      'fact_check_judge_override',
    ]);
  });

  // ── FOLLOW-1049 — a JSON.parse throw is a MALFORMED reply, not a network error ──────────
  //
  // #793 moved the ClickHouse write to AFTER the parse (that reordering is what made the
  // verdict countable) and left `JSON.parse` unguarded inside the `try`. The judge's own
  // regex matches Python-style `True`, a trailing comma and a bare word — all of which throw.

  it.each([
    ['python-style True', '{"grounded": True}'],
    ['a trailing comma', '{"grounded":true,}'],
    ['a bare word', 'Answer: {"grounded": yes}'],
  ])(
    'records `_unavailable_malformed`, NOT `_unavailable_error`, when the reply matches but %s does not parse',
    async (_label, reply) => {
      mockCreate
        .mockResolvedValueOnce(makeAnthropicResponse(JSON.stringify(directivesFor(['feature']))))
        .mockResolvedValueOnce(makeAnthropicResponse(reply));

      const result = await callLlmGateway({
        ...BASE_INPUT,
        similarity: 0.75,
        listingContext: LISTING_FACTS_FR,
      });

      expect(result).toBeNull();
      // Before FOLLOW-1049 this recorded 'fact_check_judge_unavailable_error' — the NETWORK
      // bucket — contradicting unavailableMalformed's own docblock.
      expect(judgeSourcesFromFetch()).toEqual(['fact_check_judge_unavailable_malformed']);
    },
  );

  it('books the REAL tokens and cost on a parse-throw row, not 0,0 against the $100/day breaker', async () => {
    mockCreate
      .mockResolvedValueOnce(makeAnthropicResponse(JSON.stringify(directivesFor(['feature']))))
      // 150 in / 50 out are makeAnthropicResponse's defaults — tokens Anthropic billed for a
      // reply we could not parse. The spend is real whether or not the JSON was.
      .mockResolvedValueOnce(makeAnthropicResponse('{"grounded": True}'));

    await callLlmGateway({
      ...BASE_INPUT,
      similarity: 0.75,
      listingContext: LISTING_FACTS_FR,
    });

    const rows = judgeRowsFromFetch();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.source).toBe('fact_check_judge_unavailable_malformed');
    expect(rows[0]?.tokensIn).toBe('150');
    expect(Number(rows[0]?.costUsd)).toBeGreaterThan(0);
  });

  it('records `_unavailable_malformed` on a reply containing no JSON at all (the fifth value, previously untested)', async () => {
    mockCreate
      .mockResolvedValueOnce(makeAnthropicResponse(JSON.stringify(directivesFor(['feature']))))
      .mockResolvedValueOnce(makeAnthropicResponse('I cannot determine whether this is grounded.'));

    const result = await callLlmGateway({
      ...BASE_INPUT,
      similarity: 0.75,
      listingContext: LISTING_FACTS_FR,
    });

    expect(result).toBeNull();
    expect(judgeSourcesFromFetch()).toEqual(['fact_check_judge_unavailable_malformed']);
  });
});

describe('callLlmGateway — FOLLOW-1042: the grounding is tokenised with Unicode word semantics', () => {
  // The grounding side was compared with ASCII-lowercase-only word semantics, in two places:
  // the stem set (`grounding.split(/[^a-z0-9-]+/)`) and the exact-token probe (`\b…\b`). Every
  // character outside `[a-z0-9-]` was a delimiter, so each accented grounded word entered the
  // comparison as FRAGMENTS: `caractère` → `caract` + `re`, `propriété` → `propri` + `t`,
  // `pièces` → `pi` + `ces`. That breaks the check in both directions on exactly the languages
  // this estate serves (fr/pl/es — [MP-012]'s third act was a French headline), and the judge
  // tier cannot rescue the second direction because the judge only ever sees values the scan
  // REJECTS.
  //
  // The facts below are the pilot listing d3a81d0a's own (same fixture as the FOLLOW-1034
  // block); `caractère`, `propriété` and `pièces` are its real vocabulary, not invented probes.
  const LISTING_FACTS_FR = {
    listing_title: 'Maison de caractère 4 chambres avec jardin',
    listing_description:
      'Maison de campagne individuelle de caractère. La propriété offre 158 m², 7 pièces, 4 chambres et 2 salles de bains.',
    listing_price: '97200 EUR',
    listing_location: 'Saint-Dizier-les-Domaines',
  };

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

  /**
   * Generation + a judge that always says UNGROUNDED. The judge's answer is held constant so
   * every assertion below measures the TOKEN SCAN alone: `toHaveBeenCalledTimes(1)` means the
   * scan passed the value on its own, `(2)` means the scan flagged it.
   */
  const gatewayWith = async (value: string, listingContext: Record<string, string>) => {
    mockCreate
      .mockResolvedValueOnce(
        makeAnthropicResponse(
          JSON.stringify([
            { type: 'text', slot: 'headline', value, archetype: 'yield_hunter', confidence: 0.75 },
          ] satisfies TextDirective[]),
        ),
      )
      .mockResolvedValue(makeAnthropicResponse('{"grounded": false}'));
    return callLlmGateway({ ...BASE_INPUT, similarity: 0.75, listingContext });
  };

  it.each([
    ['Pièce', 'pièces', 'Maison de campagne avec grande Pièce et jardin'],
    ['Caractères', 'caractère', 'Maison de campagne aux Caractères authentiques'],
  ])(
    'accepts "%s" — an inflection of the listing\'s OWN accented word "%s" (the ESC-063 class, in French)',
    async (_word, _grounded, value) => {
      const result = await gatewayWith(value, LISTING_FACTS_FR);

      expect(result).not.toBeNull();
      expect(mockCreate).toHaveBeenCalledTimes(1); // the scan passed it; no judge, no cost
    },
  );

  it.each([
    ['Vian', 'Évian-les-Bains', 'Maison de campagne proche de Vian'],
    ['Vila', 'Ávila', 'Casa de campo cerca de Vila'],
  ])(
    'rejects "%s" — a grounded name (%s) minus its accented first letter is not a grounded name',
    async (_invented, location, value) => {
      const result = await gatewayWith(value, { ...LISTING_FACTS_FR, listing_location: location });

      expect(result).toBeNull();
      expect(mockCreate).toHaveBeenCalledTimes(2); // the scan flagged it and the judge adjudicated
    },
  );

  it('STILL rejects an invented accented name absent from every grounding source (Bézier)', async () => {
    const result = await gatewayWith('Maison de campagne proche de Bézier', LISTING_FACTS_FR);

    expect(result).toBeNull();
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  // FOLLOW-1054: the VALUE side's candidate selector. `\p{Lu}` replaced `[A-Z]`, so a word
  // whose first character is an accented capital is now compared against the grounding at
  // all. Before this, `!/^[A-Z]/.test(clean)` `continue`d it — the word was not "checked and
  // passed", it was never checked, and the judge tier cannot recover that because it only
  // ever adjudicates values the scan REJECTS.
  it.each([
    ['Évian', 'Maison de campagne proche de Évian'],
    ['Łódź', 'Maison de campagne proche de Łódź'],
  ])(
    'rejects "%s" — a fabricated MID-SEGMENT accented capital absent from every grounding source',
    async (_invented, value) => {
      const result = await gatewayWith(value, LISTING_FACTS_FR);

      expect(result).toBeNull();
      expect(mockCreate).toHaveBeenCalledTimes(2); // the scan flagged it and the judge adjudicated
    },
  );

  it('STILL accepts "Évian" when the listing IS in Évian-les-Bains — the negative control', async () => {
    // Without this the rejection above could pass for the wrong reason: a candidate selector
    // that admitted accented capitals but compared them against nothing would also reject a
    // GROUNDED accented name, which is the ESC-063 false-rejection class in a new alphabet.
    const result = await gatewayWith('Maison de campagne proche de Évian', {
      ...LISTING_FACTS_FR,
      listing_location: 'Évian-les-Bains',
    });

    expect(result).not.toBeNull();
    expect(mockCreate).toHaveBeenCalledTimes(1); // the scan passed it; no judge, no cost
  });

  it('STILL accepts a generic accented adjective that OPENS a segment (Élégant) — the pin on the mitigation', async () => {
    // Widening the selector makes generic accented adjectives flaggable, and the stop-caps set
    // is ASCII English so it does not cover them. The reason that is acceptable rather than a
    // new false-rejection class is the segment-initial exemption above — which is a claim, so
    // it is asserted here rather than only stated in the comment.
    const result = await gatewayWith(
      'Élégant maison de campagne | Jardin et grange',
      LISTING_FACTS_FR,
    );

    expect(result).not.toBeNull();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('STILL accepts a component of a hyphenated grounded name (Saint) — the no-regression pin', async () => {
    // `-` is a word character to the stem tokeniser and a boundary to the exact probe, so
    // "Saint" is grounded by "Saint-Dizier-les-Domaines". Any rewrite that replaced the probe
    // with a whole-token lookup would lose this and invent a new false-rejection class.
    const result = await gatewayWith('Maison de campagne à Saint', LISTING_FACTS_FR);

    expect(result).not.toBeNull();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
