/**
 * FOLLOW-427: fail-loud tests for logLlmCallAsync.
 *
 * Verifies that a non-2xx HTTP response from ClickHouse on the llm_calls
 * INSERT is captured to Sentry — NOT silently swallowed. Before FOLLOW-427,
 * logLlmCallAsync used only a `.catch()` handler and was completely blind to
 * HTTP-level rejection (fetch resolves — does NOT reject — on 4xx/5xx).
 *
 * Three tests per AC-3:
 *   (a) non-ok HTTP response → Sentry captured with kind='insert_rejected', table='llm_calls'
 *   (b) network / thrown error → Sentry captured with kind='network'
 *   (c) happy path (ok response) → Sentry NOT called, caller unaffected
 *
 * logLlmCallAsync is a private function; it is exercised via callLlmGateway.
 * Fetch call sequence per callLlmGateway:
 *   1. getRolling24hSpend() → SELECT query (returns ok + zero spend)
 *   2. logLlmCallAsync()   → INSERT query (the path under test)
 *
 * The Haiku path (0.6 < similarity ≤ 0.85) is used to avoid the
 * getGlobalGenerationModel() DB call and simplify the fetch sequence.
 *
 * @module apps/control-plane/src/lib/__tests__/llm-gateway.clickhouse.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ─── Sentry mock (must be hoisted before module import) ───────────────────────
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

// ─── Anthropic mock ───────────────────────────────────────────────────────────
vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn();
  const MockAnthropic = vi.fn(() => ({
    messages: { create: mockCreate },
  }));
  (MockAnthropic as unknown as Record<string, unknown>).__mockCreate = mockCreate;
  return { default: MockAnthropic };
});

// ─── Other dependency mocks ───────────────────────────────────────────────────
vi.mock('@/lib/global-config-store', () => ({
  getGlobalGenerationModel: vi.fn().mockResolvedValue('claude-haiku-4-5'),
}));

vi.mock('@/lib/clickhouse-http', () => ({
  clickhouseAuthHeaders: vi
    .fn()
    .mockReturnValue({ 'X-ClickHouse-User': 'default', 'X-ClickHouse-Key': '' }),
}));

import Anthropic from '@anthropic-ai/sdk';
import * as Sentry from '@sentry/nextjs';
import { callLlmGateway } from '@/lib/llm-gateway';

const mockCreate = (Anthropic as unknown as Record<string, () => unknown>)
  .__mockCreate as ReturnType<typeof vi.fn>;

// ─── Constants ────────────────────────────────────────────────────────────────

const CLICKHOUSE_URL = 'http://ch.test:8123';

/** Minimal playbook entry that satisfies the Haiku prompt builder. */
const MOCK_PLAYBOOK = {
  archetype: 'yield_hunter' as const,
  description: 'Long-term investor maximizing rental cashflow',
  slots: [
    {
      slot: 'headline',
      en: 'Rental Yield: {yield}%',
      pl: 'Rentowność: {yield}%',
      es: 'Rendimiento: {yield}%',
    },
  ],
  listing_rules: {
    boost_if: [],
    suppress_if: [],
    boost_class: 'b',
    suppress_class: 's',
  },
  feature_priority: [],
  signals: ['yield_data'],
  copy_template: {
    en: 'Yield-focused.',
    pl: 'Rentowność.',
    es: 'Rentabilidad.',
  },
};

/** Valid Anthropic response producing one parseable TextDirective. */
const ANTHROPIC_RESPONSE = {
  content: [
    {
      type: 'text' as const,
      text: '[{"type":"text","slot":"headline","value":"Top Yield","archetype":"yield_hunter","confidence":0.75}]',
    },
  ],
  usage: { input_tokens: 100, output_tokens: 30 },
};

/** Successful ClickHouse spend-check response (SELECT → 0 USD). */
const SPEND_OK_RESPONSE = {
  ok: true,
  status: 200,
  json: () => Promise.resolve({ data: [{ total: '0' }] }),
};

/**
 * Gateway input that takes the Haiku path (0.6 < similarity ≤ 0.85).
 * Avoids the getGlobalGenerationModel() DB call so only 2 fetch calls are made:
 *   fetch[0] → getRolling24hSpend() SELECT
 *   fetch[1] → logLlmCallAsync() INSERT  ← path under test
 */
const GATEWAY_INPUT = {
  archetypeId: 'yield_hunter' as const,
  confidence: 0.75,
  similarity: 0.75,
  basePlaybook: MOCK_PLAYBOOK,
  sessionId: 'sess-427-test',
  tenantId: 'tenant-427',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('logLlmCallAsync — FOLLOW-427 fail loud on ClickHouse INSERT rejection', () => {
  let captureException: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    captureException = vi.mocked(Sentry.captureException);
    captureException.mockReset();
    vi.stubEnv('CLICKHOUSE_URL', CLICKHOUSE_URL);
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-427');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('FOLLOW-427 (a): non-ok HTTP INSERT response → captureException with kind=insert_rejected, callLlmGateway does not throw', async () => {
    mockCreate.mockResolvedValueOnce(ANTHROPIC_RESPONSE);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(SPEND_OK_RESPONSE) // getRolling24hSpend SELECT
        .mockResolvedValue({
          ok: false,
          status: 516,
          text: () =>
            Promise.resolve('Authentication failed. Password is incorrect or there is no user.'),
        }), // logLlmCallAsync INSERT
    );

    // callLlmGateway must not throw — fire-and-forget guarantee preserved
    const result = await callLlmGateway(GATEWAY_INPUT);
    expect(result).not.toBeNull();

    // Allow the fire-and-forget logLlmCallAsync microtask chain to settle
    await new Promise((r) => setTimeout(r, 10));

    expect(captureException).toHaveBeenCalledOnce();
    const [capturedErr, capturedCtx] = captureException.mock.calls[0] as [
      Error,
      { tags: Record<string, string>; extra: Record<string, unknown> },
    ];
    expect(capturedErr).toBeInstanceOf(Error);
    expect(capturedErr.message).toContain('516');
    expect(capturedErr.message).toContain('Authentication failed');
    expect(capturedCtx.tags.kind).toBe('insert_rejected');
    expect(capturedCtx.tags.sink).toBe('clickhouse');
    expect(capturedCtx.tags.area).toBe('adapt');
    expect(capturedCtx.extra.status).toBe(516);
  });

  it('FOLLOW-427 (b): network-level INSERT rejection → captureException with kind=network, callLlmGateway does not throw', async () => {
    mockCreate.mockResolvedValueOnce(ANTHROPIC_RESPONSE);
    const networkErr = new Error('connect ECONNREFUSED 127.0.0.1:8123');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(SPEND_OK_RESPONSE).mockRejectedValue(networkErr),
    );

    const result = await callLlmGateway(GATEWAY_INPUT);
    expect(result).not.toBeNull();

    await new Promise((r) => setTimeout(r, 10));

    expect(captureException).toHaveBeenCalledOnce();
    const [capturedErr, capturedCtx] = captureException.mock.calls[0] as [
      Error,
      { tags: Record<string, string> },
    ];
    expect(capturedErr).toBeInstanceOf(Error);
    expect(capturedErr.message).toContain('ECONNREFUSED');
    expect(capturedCtx.tags.kind).toBe('network');
    expect(capturedCtx.tags.sink).toBe('clickhouse');
    expect(capturedCtx.tags.area).toBe('adapt');
  });

  it('FOLLOW-427 (c): successful HTTP 200 INSERT → captureException NOT called', async () => {
    mockCreate.mockResolvedValueOnce(ANTHROPIC_RESPONSE);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(SPEND_OK_RESPONSE).mockResolvedValue({ ok: true, status: 200 }),
    );

    const result = await callLlmGateway(GATEWAY_INPUT);
    expect(result).not.toBeNull();

    await new Promise((r) => setTimeout(r, 10));

    expect(captureException).not.toHaveBeenCalled();
  });
});
