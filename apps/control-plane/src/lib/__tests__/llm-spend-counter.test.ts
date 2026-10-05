/**
 * FOLLOW-1290 — the Upstash daily LLM spend counter (`llm-spend-counter.ts`) and its wiring into
 * the `llm_calls` register (`logLlmCallAsync`), the single point every billed row passes through.
 *
 * A tiny in-memory fake of the Upstash REST surface (URL-path `GET`, `POST /pipeline`) stands in
 * for Redis so the assertions are about observable state: the value under the key, and whether a
 * TTL was set once.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import * as Sentry from '@sentry/nextjs';
import {
  SPEND_KEY_TTL_SECONDS,
  getDailySpend,
  recordLlmSpend,
  spendKeyFor,
} from '@/lib/llm-spend-counter';
import { logLlmCallAsync } from '@/lib/llm-calls-register';

interface FakeRedis {
  values: Map<string, number>;
  ttls: Map<string, number>;
  expireCalls: number;
  fetch: ReturnType<typeof vi.fn>;
}

function makeFakeRedis(): FakeRedis {
  const values = new Map<string, number>();
  const ttls = new Map<string, number>();
  const fake: FakeRedis = { values, ttls, expireCalls: 0, fetch: vi.fn() };
  fake.fetch.mockImplementation((url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === '/pipeline') {
      const cmds = JSON.parse(init?.body as string) as string[][];
      const out = cmds.map(([op, key, arg, flag]) => {
        if (op === 'INCRBYFLOAT') {
          const next = (values.get(key!) ?? 0) + Number(arg);
          values.set(key!, next);
          return { result: String(next) };
        }
        if (op === 'EXPIRE') {
          fake.expireCalls += 1;
          if (flag === 'NX' && ttls.has(key!)) return { result: 0 };
          ttls.set(key!, Number(arg));
          return { result: 1 };
        }
        return { error: 'ERR unknown command' };
      });
      return Promise.resolve({ ok: true, json: () => Promise.resolve(out) });
    }
    const [, , key] = path.split('/').map(decodeURIComponent);
    const v = values.get(key!);
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ result: v === undefined ? null : String(v) }),
    });
  });
  return fake;
}

const DAY_1 = new Date('2026-10-05T23:59:30Z');
const DAY_2 = new Date('2026-10-06T00:00:30Z');

describe('llm-spend-counter (FOLLOW-1290)', () => {
  let redis: FakeRedis;

  beforeEach(() => {
    vi.stubEnv('UPSTASH_REDIS_URL', 'http://redis.test');
    vi.stubEnv('UPSTASH_REDIS_TOKEN', 'tok');
    vi.mocked(Sentry.captureException).mockReset();
    redis = makeFakeRedis();
    vi.stubGlobal('fetch', redis.fetch);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('keys by UTC day', () => {
    expect(spendKeyFor(DAY_1)).toBe('llm:spend:2026-10-05');
    expect(spendKeyFor(DAY_2)).toBe('llm:spend:2026-10-06');
  });

  it('increments: successive billed calls sum under one key and the gate reads the total', async () => {
    await recordLlmSpend(0.25, DAY_1);
    await recordLlmSpend(0.5, DAY_1);
    expect(redis.values.get('llm:spend:2026-10-05')).toBeCloseTo(0.75, 6);
    expect(await getDailySpend(DAY_1)).toBeCloseTo(0.75, 6);
  });

  it('day rollover: a new UTC day starts from zero on a new key', async () => {
    await recordLlmSpend(40, DAY_1);
    expect(await getDailySpend(DAY_2)).toBe(0);
    await recordLlmSpend(1, DAY_2);
    expect(redis.values.get('llm:spend:2026-10-06')).toBe(1);
    expect(redis.values.get('llm:spend:2026-10-05')).toBe(40);
  });

  it('TTL: EXPIRE 48h is sent NX and takes effect once, on the first write', async () => {
    await recordLlmSpend(1, DAY_1);
    await recordLlmSpend(1, DAY_1);
    await recordLlmSpend(1, DAY_1);
    expect(SPEND_KEY_TTL_SECONDS).toBe(172800);
    expect(redis.ttls.get('llm:spend:2026-10-05')).toBe(172800);
    // every write asks, only the first one is applied (NX): the TTL is never pushed out.
    expect(redis.expireCalls).toBe(3);
    const bodies = redis.fetch.mock.calls.map(
      ([, init]) => JSON.parse((init as RequestInit).body as string) as string[][],
    );
    expect(bodies[0]![1]).toEqual(['EXPIRE', 'llm:spend:2026-10-05', '172800', 'NX']);
  });

  it('zero or negative cost writes nothing (judge/segment rows with costUsd 0)', async () => {
    await recordLlmSpend(0, DAY_1);
    await recordLlmSpend(-1, DAY_1);
    expect(redis.fetch).not.toHaveBeenCalled();
  });

  it('unconfigured Redis: read is 0, write is a no-op, no Sentry noise', async () => {
    vi.stubEnv('UPSTASH_REDIS_URL', '');
    expect(await getDailySpend(DAY_1)).toBe(0);
    await recordLlmSpend(5, DAY_1);
    expect(redis.fetch).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('fail-open on read: HTTP error → 0, logged and captured (never throws, never fail-closed)', async () => {
    redis.fetch.mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await getDailySpend(DAY_1)).toBe(0);
    expect(Sentry.captureException).toHaveBeenCalledOnce();
    expect(vi.mocked(Sentry.captureException).mock.calls[0]![1]).toMatchObject({
      tags: { kind: 'spend_counter', op: 'read' },
    });
  });

  it('fail-open on read: network throw → 0 and captured', async () => {
    redis.fetch.mockRejectedValue(new Error('ECONNREFUSED'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await getDailySpend(DAY_1)).toBe(0);
    expect(Sentry.captureException).toHaveBeenCalledOnce();
  });

  it('fail-open on write: a throwing Redis resolves and is captured', async () => {
    redis.fetch.mockRejectedValue(new Error('ECONNREFUSED'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(recordLlmSpend(1, DAY_1)).resolves.toBeUndefined();
    expect(vi.mocked(Sentry.captureException).mock.calls[0]![1]).toMatchObject({
      tags: { kind: 'spend_counter', op: 'write' },
    });
  });

  it('write surfaces a per-command Redis error (a 200 whose body carries `error`)', async () => {
    redis.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ error: 'ERR value is not a valid float' }]),
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await recordLlmSpend(1, DAY_1);
    expect(Sentry.captureException).toHaveBeenCalledOnce();
  });

  it('wiring: logLlmCallAsync (the llm_calls register) bumps the counter with the row cost', async () => {
    vi.stubEnv('CLICKHOUSE_URL', '');
    await logLlmCallAsync({
      sessionId: 's',
      tenantId: 't',
      archetypeId: 'yield_hunter',
      model: 'claude-haiku-4-5',
      tokensIn: 100,
      tokensOut: 30,
      costUsd: 0.0123,
      latencyMs: 400,
      source: 'test',
    });
    const key = spendKeyFor(new Date());
    expect(redis.values.get(key)).toBeCloseTo(0.0123, 6);
  });
});
