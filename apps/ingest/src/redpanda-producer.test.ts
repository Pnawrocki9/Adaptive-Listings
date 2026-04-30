import { describe, expect, it } from 'vitest';

import { pushToRedpanda } from './redpanda-producer.js';
import type { RedpandaProducerEnv } from './redpanda-producer.js';

const env: RedpandaProducerEnv = {
  REDPANDA_REST_URL: 'http://mock',
  REDPANDA_TOPIC_EVENTS: 'events',
};

const NO_BACKOFF = [0, 0, 0] as const;

function fetchOk(): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify({ offsets: [{ partition: 0, offset: 0 }] }), {
        status: 200,
      }),
    );
}

function fetchSequence(statuses: number[]): { fetchImpl: typeof fetch; calls: () => number } {
  let i = 0;
  const calls = (): number => i;
  const fetchImpl = ((): Promise<Response> => {
    const status = statuses[i] ?? statuses[statuses.length - 1] ?? 500;
    i++;
    return Promise.resolve(new Response(`status=${String(status)}`, { status }));
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function fetchAlwaysThrows(): { fetchImpl: typeof fetch; calls: () => number } {
  let i = 0;
  const calls = (): number => i;
  const fetchImpl = ((): Promise<Response> => {
    i++;
    return Promise.reject(new Error('network_failure'));
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('pushToRedpanda', () => {
  it('returns ok with attempts=0 on empty batch (no fetch call)', async () => {
    let calls = 0;
    const result = await pushToRedpanda([], env, {
      fetchImpl: (): Promise<Response> => {
        calls++;
        return Promise.resolve(new Response('', { status: 200 }));
      },
      backoffMs: NO_BACKOFF,
    });
    expect(result).toEqual({ ok: true, attempts: 0 });
    expect(calls).toBe(0);
  });

  it('returns ok with attempts=1 on first-try success', async () => {
    const result = await pushToRedpanda([{ a: 1 }], env, {
      fetchImpl: fetchOk(),
      backoffMs: NO_BACKOFF,
    });
    expect(result).toEqual({ ok: true, attempts: 1 });
  });

  it('retries on 5xx and succeeds within budget', async () => {
    const seq = fetchSequence([503, 502, 200]);
    const result = await pushToRedpanda([{ a: 1 }], env, {
      fetchImpl: seq.fetchImpl,
      backoffMs: NO_BACKOFF,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attempts).toBe(3);
    expect(seq.calls()).toBe(3);
  });

  it('exhausts retries on persistent 5xx and returns 503-shaped failure', async () => {
    const seq = fetchSequence([500, 500, 500]);
    const result = await pushToRedpanda([{ a: 1 }], env, {
      fetchImpl: seq.fetchImpl,
      backoffMs: NO_BACKOFF,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.attempts).toBe(3);
      expect(result.status).toBe(500);
    }
    expect(seq.calls()).toBe(3);
  });

  it('returns terminal failure on 4xx without retrying', async () => {
    const seq = fetchSequence([400]);
    const result = await pushToRedpanda([{ a: 1 }], env, {
      fetchImpl: seq.fetchImpl,
      backoffMs: NO_BACKOFF,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.attempts).toBe(1);
      expect(result.status).toBe(400);
    }
    expect(seq.calls()).toBe(1);
  });

  it('retries on network failure and surfaces the error message', async () => {
    const seq = fetchAlwaysThrows();
    const result = await pushToRedpanda([{ a: 1 }], env, {
      fetchImpl: seq.fetchImpl,
      backoffMs: NO_BACKOFF,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.attempts).toBe(3);
      expect(result.error).toContain('network_failure');
      expect(result.status).toBeUndefined();
    }
    expect(seq.calls()).toBe(3);
  });

  it('includes basic auth header when REDPANDA_REST_USERNAME/PASSWORD are set', async () => {
    let observedAuth: string | null = null;
    const fetchImpl = ((_url: string, init?: RequestInit): Promise<Response> => {
      observedAuth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;
      return Promise.resolve(new Response('', { status: 200 }));
    }) as typeof fetch;

    const result = await pushToRedpanda(
      [{ a: 1 }],
      {
        ...env,
        REDPANDA_REST_USERNAME: 'user',
        REDPANDA_REST_PASSWORD: 'secret',
      },
      {
        fetchImpl,
        backoffMs: NO_BACKOFF,
      },
    );
    expect(result.ok).toBe(true);
    expect(observedAuth).toMatch(/^Basic /);
  });
});
