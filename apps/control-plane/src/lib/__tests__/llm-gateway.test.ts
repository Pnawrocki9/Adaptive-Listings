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
