import { propagation } from '@opentelemetry/api';
import { describe, expect, it, vi } from 'vitest';

import { pushToRedpanda } from './redpanda-producer.js';
import type { RedpandaProducerEnv } from './redpanda-producer.js';

const env: RedpandaProducerEnv = {
  REDPANDA_REST_URL: 'http://mock',
  REDPANDA_TOPIC_EVENTS: 'events',
};

/** Env with no Redpanda URL — simulates Phase 1 Supabase-only mode. */
const envNoBus: RedpandaProducerEnv = {
  REDPANDA_REST_URL: '',
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

describe('pushToRedpanda — no-bus guard (Phase 1 mode)', () => {
  it('returns ok with attempts=0 when REDPANDA_REST_URL is empty string', async () => {
    let fetchCalled = false;
    const result = await pushToRedpanda([{ type: 'page.view' }], envNoBus, {
      fetchImpl: (): Promise<Response> => {
        fetchCalled = true;
        return Promise.resolve(new Response('', { status: 200 }));
      },
      backoffMs: [0, 0, 0],
    });
    expect(result).toEqual({ ok: true, attempts: 0 });
    expect(fetchCalled).toBe(false);
  });

  it('returns ok with attempts=0 when REDPANDA_REST_URL is absent (undefined)', async () => {
    const envUndefined: RedpandaProducerEnv = {
      REDPANDA_TOPIC_EVENTS: 'events',
      // REDPANDA_REST_URL intentionally omitted
    };
    let fetchCalled = false;
    const result = await pushToRedpanda([{ type: 'scroll.depth' }], envUndefined, {
      fetchImpl: (): Promise<Response> => {
        fetchCalled = true;
        return Promise.resolve(new Response('', { status: 200 }));
      },
    });
    expect(result).toEqual({ ok: true, attempts: 0 });
    expect(fetchCalled).toBe(false);
  });

  it('still returns ok with attempts=0 on empty batch even when URL is absent', async () => {
    const result = await pushToRedpanda([], envNoBus, {});
    expect(result).toEqual({ ok: true, attempts: 0 });
  });
});

describe('pushToRedpanda — OTel trace context propagation', () => {
  const TRACEPARENT = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

  it('injects traceparent into every Kafka record header when a span is active', async () => {
    const injectSpy = vi.spyOn(propagation, 'inject').mockImplementation((_ctx, carrier) => {
      (carrier as Record<string, string>).traceparent = TRACEPARENT;
    });

    let capturedBody = '';
    const fetchImpl = ((_url: string, init?: RequestInit): Promise<Response> => {
      capturedBody = (init?.body as string | null | undefined) ?? '';
      return Promise.resolve(
        new Response(JSON.stringify({ offsets: [{ partition: 0, offset: 0 }] }), { status: 200 }),
      );
    }) as typeof fetch;

    await pushToRedpanda([{ type: 'page.view' }, { type: 'scroll.depth' }], env, {
      fetchImpl,
      backoffMs: NO_BACKOFF,
    });
    injectSpy.mockRestore();

    const parsed = JSON.parse(capturedBody) as {
      records: { value: unknown; headers?: { key: string; value: string }[] }[];
    };

    // Both records must carry the header
    for (const record of parsed.records) {
      const tp = record.headers?.find((h) => h.key === 'traceparent');
      expect(tp).toBeDefined();
      expect(atob(tp?.value ?? '')).toBe(TRACEPARENT);
    }
  });

  it('omits headers entirely when no span context is injected (OTel no-op)', async () => {
    // Default propagation.inject with no SDK registered is a no-op → empty carrier
    let capturedBody = '';
    const fetchImpl = ((_url: string, init?: RequestInit): Promise<Response> => {
      capturedBody = (init?.body as string | null | undefined) ?? '';
      return Promise.resolve(
        new Response(JSON.stringify({ offsets: [{ partition: 0, offset: 0 }] }), { status: 200 }),
      );
    }) as typeof fetch;

    await pushToRedpanda([{ type: 'page.view' }], env, {
      fetchImpl,
      backoffMs: NO_BACKOFF,
    });

    const parsed = JSON.parse(capturedBody) as {
      records: { value: unknown; headers?: unknown[] }[];
    };
    expect(parsed.records[0]?.headers).toBeUndefined();
  });
});
