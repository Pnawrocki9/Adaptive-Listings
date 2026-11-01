/**
 * FOLLOW-1427 — a refused description sets a short repeat guard so the next cache miss makes no
 * model call; the guard is keyed on everything that changes the text and fails open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreate, mockPublishPg, mockSetCached, mockAudit, mockLogLlmCall } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockPublishPg: vi.fn(),
  mockSetCached: vi.fn(),
  mockAudit: vi.fn(),
  mockLogLlmCall: vi.fn().mockResolvedValue(undefined),
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
  getDailySpend: vi.fn().mockResolvedValue(0),
}));

import type { DescriptionRequestedEvent } from '@estalara/shared';
import { generateDescription } from '@/lib/description-generator';
import { isRefusalGuarded, setRefusalGuard } from '@/lib/description-refusal-guard';

const TTL_SECONDS = 3600;

const EVENT: DescriptionRequestedEvent = {
  tenant_id: '00000000-0000-4000-8000-000000001427',
  listing_id: 'listing-1427',
  archetype: 'yield_hunter',
  locale: 'en',
  copy_template: 'Numbers first.',
  original_description: 'An apartment with two bedrooms and no pool.',
  listing_context: { price: '400000', location: 'Lisbon' },
  cache_key: 'desc:t:listing-1427:yield_hunter:en:claude-sonnet-4-6:r3',
  listing_revision: 3,
  generation_model: 'claude-sonnet-4-6',
};

const reply = (text: string) => ({
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 100, output_tokens: 40 },
});
const REFUSED_RAW =
  '<adaptation_verdict>FIT</adaptation_verdict>\nA two-bedroom apartment in Lisbon offering a 9.9% yield.\n<verified_facts_used>\n[]\n</verified_facts_used>';
const FIT_RAW =
  '<adaptation_verdict>FIT</adaptation_verdict>\n' +
  'A two-bedroom apartment in Lisbon, a straightforward option for a rental buyer.\n' +
  '<verified_facts_used>\n["bedrooms: 2"]\n</verified_facts_used>';

/** In-memory Upstash REST stand-in: GET /get/{key}, GET /set/{key}/1/ex/{ttl}. */
function fakeRedis(opts: { fail?: boolean } = {}) {
  const store = new Map<string, { expiresAt: number }>();
  const calls: string[] = [];
  const fn = vi.fn((url: string) => {
    calls.push(url);
    if (opts.fail) return Promise.reject(new Error('redis down'));
    const [cmd, key, , , ttl] = url
      .replace('https://redis.test/', '')
      .split('/')
      .map(decodeURIComponent);
    if (cmd === 'set') {
      store.set(key!, { expiresAt: Date.now() + Number(ttl) * 1000 });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ result: 'OK' }) });
    }
    const hit = store.get(key!);
    const live = hit !== undefined && hit.expiresAt > Date.now();
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ result: live ? '1' : null }),
    });
  });
  return { fn, calls };
}

describe('refused-description repeat guard (FOLLOW-1427)', () => {
  let redis: ReturnType<typeof fakeRedis>;
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-'.repeat(3));
    vi.stubEnv('UPSTASH_REDIS_URL', 'https://redis.test');
    mockCreate.mockReset();
    mockPublishPg.mockReset().mockResolvedValue('published');
    mockSetCached.mockReset().mockResolvedValue(true);
    mockAudit.mockReset().mockResolvedValue('written');
    redis = fakeRedis();
    vi.stubGlobal('fetch', redis.fn);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('refused, then a second miss: no model call, SKIPPED/refused_guard, nothing written', async () => {
    mockCreate.mockResolvedValue(reply(REFUSED_RAW));
    expect((await generateDescription(EVENT)).outcome.verdict).toBe('REFUSED');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(redis.calls.some((c) => c.includes(`/ex/${String(TTL_SECONDS)}`))).toBe(true);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const second = await generateDescription(EVENT);
    expect(second.outcome).toEqual({ verdict: 'SKIPPED', reason: 'refused_guard' });
    expect(second.writes).toEqual({ pg: 'skipped', redis: 'skipped', audit: 'skipped' });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('refused_guard_hit'))).toBe(true);
    warn.mockRestore();
  });

  it('after the TTL expires the model is called again', async () => {
    vi.useFakeTimers();
    mockCreate.mockResolvedValue(reply(REFUSED_RAW));
    await generateDescription(EVENT);
    vi.advanceTimersByTime((TTL_SECONDS + 1) * 1000);
    await generateDescription(EVENT);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['archetype', { archetype: 'family_buyer' }],
    ['language', { locale: 'pl' }],
    ['listing revision', { listing_revision: 4 }],
    ['model', { generation_model: 'claude-haiku-4-5' }],
  ] as const)('a different %s is not blocked by the refusal', async (_n, patch) => {
    mockCreate.mockResolvedValue(reply(REFUSED_RAW));
    await generateDescription(EVENT);
    await generateDescription({ ...EVENT, ...patch });
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('the key carries the claims version, so a new version is not blocked', async () => {
    const scope = {
      tenantId: 't',
      listingId: 'l',
      archetype: 'a',
      locale: 'en',
      model: 'm',
      listingRevision: 1,
      claimsVersion: 'claims-v9',
    };
    await setRefusalGuard(scope);
    expect(await isRefusalGuarded(scope)).toBe(true);
    expect(await isRefusalGuarded({ ...scope, claimsVersion: 'claims-v10' })).toBe(false);
  });

  it('store failure: the model is called every time, never a refusal for the buyer', async () => {
    redis = fakeRedis({ fail: true });
    vi.stubGlobal('fetch', redis.fn);
    mockCreate.mockResolvedValue(reply(REFUSED_RAW));
    await generateDescription(EVENT);
    const second = await generateDescription(EVENT);
    expect(second.outcome.verdict).toBe('REFUSED');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('store not configured: behaves as today (regenerates)', async () => {
    vi.stubEnv('UPSTASH_REDIS_URL', '');
    mockCreate.mockResolvedValue(reply(REFUSED_RAW));
    await generateDescription(EVENT);
    await generateDescription(EVENT);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(redis.fn).not.toHaveBeenCalled();
  });

  it('a successful generation sets no guard and is cached', async () => {
    mockCreate.mockResolvedValue(reply(FIT_RAW));
    mockCreate.mockResolvedValueOnce(reply(FIT_RAW)).mockResolvedValueOnce(reply('Lisbon flat'));
    const report = await generateDescription(EVENT);
    expect(report.outcome.verdict).toBe('FIT');
    expect(redis.calls.some((c) => c.includes('/set/'))).toBe(false);
    expect(mockSetCached).toHaveBeenCalledTimes(1);
  });

  it('a truncated (FAILED) reply sets no guard', async () => {
    mockCreate.mockResolvedValue({ ...reply(FIT_RAW), stop_reason: 'max_tokens' });
    await generateDescription(EVENT);
    expect(redis.calls.some((c) => c.includes('/set/'))).toBe(false);
  });
});
