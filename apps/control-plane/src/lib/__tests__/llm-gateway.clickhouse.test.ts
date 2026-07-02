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
 * FOLLOW-431: also asserts that logLlmCallAsync is registered via after() inside
 * callLlmGateway so it completes after the response on Vercel (AC-4).
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

// ─── next/server mock (must be before all imports) ───────────────────────────
// Mock after() as a synchronous pass-through spy so existing tests that rely on
// the fire-and-forget fetch completing synchronously continue to work, and new
// tests can assert after() was called (FOLLOW-431 / AC-4).
vi.mock('next/server', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('next/server');
  return {
    ...actual,
    after: vi.fn((fn: () => unknown) => {
      void fn();
    }),
  };
});

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
import { after } from 'next/server';
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

/**
 * Valid Anthropic response producing one parseable TextDirective.
 * FOLLOW-457 AC2: "Rental Yield" is grounded — "rental" is in MOCK_PLAYBOOK.description
 * and "yield" is in MOCK_PLAYBOOK.slots[0].en — so it passes the directive
 * fact-whitelist check unrelated tests in this file don't exercise.
 */
const ANTHROPIC_RESPONSE = {
  content: [
    {
      type: 'text' as const,
      text: '[{"type":"text","slot":"headline","value":"Rental Yield","archetype":"yield_hunter","confidence":0.75}]',
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

// ─── FOLLOW-431: after() registration ────────────────────────────────────────
//
// AC-1: logLlmCallAsync must be registered via after() inside callLlmGateway
// so its async work completes after the response is sent on Vercel.
// The after() mock is a synchronous pass-through (see top of file) so the
// existing fail-loud tests still work; this test asserts the registration itself.

describe('FOLLOW-431: logLlmCallAsync registered via after() inside callLlmGateway', () => {
  let mockAfter: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockAfter = vi.mocked(after);
    mockAfter.mockReset();
    mockAfter.mockImplementation((fn: () => unknown) => {
      void fn();
    });
    vi.stubEnv('CLICKHOUSE_URL', CLICKHOUSE_URL);
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-431');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('FOLLOW-431: callLlmGateway registers logLlmCallAsync via after() on the LLM path', async () => {
    mockCreate.mockResolvedValueOnce(ANTHROPIC_RESPONSE);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(SPEND_OK_RESPONSE) // getRolling24hSpend SELECT
        .mockResolvedValue({ ok: true, status: 200 }), // logLlmCallAsync INSERT
    );

    const result = await callLlmGateway(GATEWAY_INPUT);
    expect(result).not.toBeNull();

    // after() must have been called with a function (the logLlmCallAsync wrapper)
    expect(mockAfter).toHaveBeenCalledOnce();
    const [callback] = mockAfter.mock.calls[0] as [() => unknown];
    expect(typeof callback).toBe('function');
  });
});
