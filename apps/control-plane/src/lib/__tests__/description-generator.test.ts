/**
 * FOLLOW-1297 — `generateDescription()`'s I/O half: the spend gate, the Anthropic budget (G-03),
 * the write order and the per-write results (G-02), the `llm_calls` rows and their `source`
 * names. The pure halves are pinned by the frozen corpus in `description-parity.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreate, mockPublishPg, mockSetCached, mockAudit, mockLogLlmCall, mockGetDailySpend } =
  vi.hoisted(() => ({
    mockCreate: vi.fn(),
    mockPublishPg: vi.fn(),
    mockSetCached: vi.fn(),
    mockAudit: vi.fn(),
    mockLogLlmCall: vi.fn().mockResolvedValue(undefined),
    mockGetDailySpend: vi.fn().mockResolvedValue(0),
  }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('@/lib/description-pg-cache', () => ({ publishPgCachedDescription: mockPublishPg }));
vi.mock('@/lib/description-cache', () => ({ setCachedDescription: mockSetCached }));
vi.mock('@/lib/description-generation-audit', () => ({
  writeDescriptionGenerationAudit: mockAudit,
}));
vi.mock('@/lib/llm-calls-register', () => ({ logLlmCallAsync: mockLogLlmCall }));
vi.mock('@/lib/llm-spend-counter', () => ({
  DAILY_SPEND_CAP_USD: 100,
  getDailySpend: mockGetDailySpend,
}));

import * as Sentry from '@sentry/nextjs';
import { CLAIMS_VALIDATION_VERSION, generateDescription } from '@/lib/description-generator';

/** The G-03 description deadline (`DESCRIPTION_DEADLINE_MS` in the generator, 75 s total). */
const DESCRIPTION_DEADLINE_MS = 75_000;
import type { DescriptionRequestedEvent } from '@estalara/shared';

const EVENT: DescriptionRequestedEvent = {
  tenant_id: '00000000-0000-4000-8000-000000001297',
  listing_id: 'listing-1297',
  archetype: 'yield_hunter',
  locale: 'en',
  copy_template: 'Numbers first.',
  original_description: 'An apartment with two bedrooms and no pool.',
  listing_context: { price: '400000', location: 'Lisbon' },
  cache_key: 'desc:t:listing-1297:yield_hunter:en:claude-sonnet-4-6:r3',
  listing_revision: 3,
  generation_model: 'claude-sonnet-4-6',
};

function response(text: string, stopReason = 'end_turn') {
  return {
    content: [{ type: 'text', text }],
    stop_reason: stopReason,
    usage: { input_tokens: 100, output_tokens: 40 },
  };
}

const FIT_RAW =
  '<adaptation_verdict>FIT</adaptation_verdict>\n' +
  'A two-bedroom apartment in Lisbon, a straightforward option for a rental buyer.\n' +
  '<verified_facts_used>\n["bedrooms: 2"]\n</verified_facts_used>';
const HEADLINE_RAW = 'Apartment in Lisbon with two bedrooms';

describe('generateDescription', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-'.repeat(3));
    vi.stubEnv('UPSTASH_REDIS_URL', 'https://redis.test');
    mockCreate.mockReset();
    mockPublishPg.mockReset().mockResolvedValue('published');
    mockSetCached.mockReset().mockResolvedValue(true);
    mockAudit.mockReset().mockResolvedValue('written');
    mockLogLlmCall.mockClear();
    mockGetDailySpend.mockReset().mockResolvedValue(0);
    vi.mocked(Sentry.captureException).mockClear();
    vi.mocked(Sentry.captureMessage).mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('FIT: PG first, then Redis, then the audit row; rows description + headline; stamped', async () => {
    mockCreate
      .mockResolvedValueOnce(response(FIT_RAW))
      .mockResolvedValueOnce(response(HEADLINE_RAW));

    const report = await generateDescription(EVENT);

    expect(report.outcome.verdict).toBe('FIT');
    expect(report.headline).toBe(HEADLINE_RAW);
    expect(report.claimsValidation).toBe(CLAIMS_VALIDATION_VERSION);
    expect(report.writes).toEqual({ pg: 'published', redis: 'written', audit: 'written' });

    // Write order: Postgres before Redis (G-02).
    expect(mockPublishPg.mock.invocationCallOrder[0]!).toBeLessThan(
      mockSetCached.mock.invocationCallOrder[0]!,
    );
    expect(mockPublishPg).toHaveBeenCalledWith(
      expect.objectContaining({
        verdict: 'FIT',
        claimsValidation: CLAIMS_VALIDATION_VERSION,
        listingRevision: 3,
        headline: HEADLINE_RAW,
        model: 'claude-sonnet-4-6',
      }),
    );
    // Redis value: the Python shape — claims_validation present, verdict absent on FIT.
    const [key, value] = mockSetCached.mock.calls[0] as [string, Record<string, unknown>];
    expect(key).toBe(EVENT.cache_key);
    expect(value).toMatchObject({
      text: expect.stringContaining('two-bedroom'),
      headline: HEADLINE_RAW,
      verified_facts_used: ['bedrooms: 2'],
      claims_validation: CLAIMS_VALIDATION_VERSION,
    });
    expect(value).not.toHaveProperty('verdict');

    const sources = mockLogLlmCall.mock.calls.map((c) => (c[0] as { source: string }).source);
    expect(sources).toEqual(['description', 'headline']);
    expect(mockLogLlmCall.mock.calls[0]![0]).toMatchObject({
      sessionId: 'listing-1297',
      tenantId: EVENT.tenant_id,
      archetypeId: 'yield_hunter',
      model: 'claude-sonnet-4-6',
      tokensIn: 100,
      tokensOut: 40,
    });
    // G-03: the SDK call carries an abort signal and a single retry.
    const [, options] = mockCreate.mock.calls[0] as [
      unknown,
      { maxRetries: number; signal: AbortSignal },
    ];
    expect(options.maxRetries).toBe(1);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('G-02: a Redis failure is isolated — pg published, redis failed, audit still written', async () => {
    mockCreate
      .mockResolvedValueOnce(response(FIT_RAW))
      .mockResolvedValueOnce(response(HEADLINE_RAW));
    mockSetCached.mockResolvedValue(false);

    const report = await generateDescription(EVENT);

    expect(report.writes).toEqual({ pg: 'published', redis: 'failed', audit: 'written' });
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('G-02: a stale PG fence skips Redis and the audit row; a PG throw still attempts Redis', async () => {
    mockCreate
      .mockResolvedValueOnce(response(FIT_RAW))
      .mockResolvedValueOnce(response(HEADLINE_RAW));
    mockPublishPg.mockResolvedValue('stale');
    let report = await generateDescription(EVENT);
    expect(report.writes).toEqual({ pg: 'stale', redis: 'skipped', audit: 'skipped' });
    expect(mockSetCached).not.toHaveBeenCalled();

    mockCreate
      .mockResolvedValueOnce(response(FIT_RAW))
      .mockResolvedValueOnce(response(HEADLINE_RAW));
    mockPublishPg.mockRejectedValue(new Error('pg down'));
    report = await generateDescription(EVENT);
    expect(report.writes).toEqual({ pg: 'failed', redis: 'written', audit: 'skipped' });
  });

  it('NEUTRAL: negative-cache marker to both caches, no headline call, no audit row', async () => {
    mockCreate.mockResolvedValueOnce(
      response(
        '<adaptation_verdict>NEUTRAL</adaptation_verdict>\n<neutral_reason>core_need_contradiction</neutral_reason>',
      ),
    );
    const report = await generateDescription(EVENT);
    expect(report.outcome).toEqual({
      verdict: 'NEUTRAL',
      neutralReason: 'core_need_contradiction',
    });
    expect(report.claimsValidation).toBeNull();
    expect(report.writes).toEqual({ pg: 'published', redis: 'written', audit: 'skipped' });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockPublishPg).toHaveBeenCalledWith(
      expect.objectContaining({
        verdict: 'NEUTRAL',
        description: '',
        headline: null,
        claimsValidation: null,
      }),
    );
    const [, value] = mockSetCached.mock.calls[0] as [string, Record<string, unknown>];
    expect(value).toMatchObject({ text: '', headline: null, verdict: 'NEUTRAL' });
    expect(value).not.toHaveProperty('claims_validation');
  });

  it('REFUSED: no cache write, the zero-cost description_claim_refused row after the cost row', async () => {
    mockCreate.mockResolvedValueOnce(
      response(
        '<adaptation_verdict>FIT</adaptation_verdict>\nA two-bedroom apartment in Lisbon offering a 9.9% yield.\n<verified_facts_used>\n[]\n</verified_facts_used>',
      ),
    );
    const report = await generateDescription(EVENT);
    expect(report.outcome).toEqual({ verdict: 'REFUSED', violation: 'hallucinated_number' });
    expect(report.writes).toEqual({ pg: 'skipped', redis: 'skipped', audit: 'skipped' });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const rows = mockLogLlmCall.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(rows.map((r) => r.source)).toEqual(['description', 'description_claim_refused']);
    expect(rows[1]).toMatchObject({ tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0 });
  });

  it('FAILED (truncated): nothing written, the cost row kept', async () => {
    mockCreate.mockResolvedValueOnce(response(FIT_RAW, 'max_tokens'));
    const report = await generateDescription(EVENT);
    expect(report.outcome).toEqual({ verdict: 'FAILED', reason: 'truncated' });
    expect(report.writes).toEqual({ pg: 'skipped', redis: 'skipped', audit: 'skipped' });
    expect(mockLogLlmCall).toHaveBeenCalledTimes(1);
  });

  it('spend cap: SKIPPED before any call, captured with kind=spend_cap', async () => {
    mockGetDailySpend.mockResolvedValue(100);
    const report = await generateDescription(EVENT);
    expect(report.outcome).toEqual({ verdict: 'SKIPPED', reason: 'spend_cap' });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ tags: { kind: 'spend_cap', area: 'description' } }),
    );
  });

  it('G-03: the description deadline yields FAILED/timeout, no row, a Sentry capture', async () => {
    vi.useFakeTimers();
    mockCreate.mockImplementation(
      (_params: unknown, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    );
    const pending = generateDescription(EVENT);
    await vi.advanceTimersByTimeAsync(DESCRIPTION_DEADLINE_MS + 1);
    const report = await pending;
    expect(report.outcome).toEqual({ verdict: 'FAILED', reason: 'timeout' });
    expect(mockLogLlmCall).not.toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({
          area: 'description',
          kind: 'description_generation_failed',
        }),
      }),
    );
  });

  it('API error: FAILED/api_error, no row; a headline error is non-fatal (headline null)', async () => {
    mockCreate.mockRejectedValueOnce(new Error('529 overloaded'));
    let report = await generateDescription(EVENT);
    expect(report.outcome).toEqual({ verdict: 'FAILED', reason: 'api_error' });
    expect(mockLogLlmCall).not.toHaveBeenCalled();

    mockCreate.mockResolvedValueOnce(response(FIT_RAW)).mockRejectedValueOnce(new Error('boom'));
    report = await generateDescription(EVENT);
    expect(report.outcome.verdict).toBe('FIT');
    expect(report.headline).toBeNull();
    expect(report.writes.pg).toBe('published');
    expect(mockPublishPg).toHaveBeenLastCalledWith(expect.objectContaining({ headline: null }));
  });

  it('invalid event: FAILED/invalid_event with no I/O; no API key: FAILED/api_error with no I/O', async () => {
    const bad = { ...EVENT, tenant_id: 'not-a-uuid' };
    let report = await generateDescription(bad);
    expect(report.outcome).toEqual({ verdict: 'FAILED', reason: 'invalid_event' });
    expect(mockGetDailySpend).not.toHaveBeenCalled();

    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.resetModules();
    const fresh = await import('@/lib/description-generator');
    report = await fresh.generateDescription(EVENT);
    expect(report.outcome).toEqual({ verdict: 'FAILED', reason: 'api_error' });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockPublishPg).not.toHaveBeenCalled();
  });
});
