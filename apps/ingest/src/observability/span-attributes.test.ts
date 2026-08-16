/**
 * AC8: Verifies that `POST /v1/events` sets the expected OTel span attributes.
 *
 * In production the active span is created by `@microlabs/otel-cf-workers` at
 * Worker entry-point level. In unit tests we mock `@opentelemetry/api` so that
 * `trace.getActiveSpan()` returns a controllable `MockSpan`. We then verify the
 * handler sets the required attributes per TICKET-018 AC2.
 *
 * @module apps/ingest/src/observability/span-attributes.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let _mockSpan: MockSpan;

class MockSpan {
  readonly attributes: Record<string, unknown> = {};

  setAttribute(key: string, value: unknown): this {
    this.attributes[key] = value;
    return this;
  }
  setAttributes(attrs: Record<string, unknown>): this {
    Object.assign(this.attributes, attrs);
    return this;
  }
  addEvent(): this {
    return this;
  }
  addLink(): this {
    return this;
  }
  setStatus(): this {
    return this;
  }
  updateName(): this {
    return this;
  }
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  end(): void {}
  isRecording(): boolean {
    return true;
  }
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  recordException(): void {}
  spanContext() {
    return { traceId: '0'.repeat(32), spanId: '0'.repeat(16), traceFlags: 1 };
  }
}

vi.mock('@opentelemetry/api', () => ({
  trace: {
    getActiveSpan: () => _mockSpan,
    setSpan: (_ctx: unknown, span: unknown) => span,
    getTracerProvider: () => ({}),
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    setGlobalTracerProvider: () => {},
  },
  context: {
    active: () => ({}),
    with: (_ctx: unknown, fn: () => unknown) => fn(),
  },
  SpanStatusCode: { OK: 1, ERROR: 2, UNSET: 0 },
}));

import { createApp } from '../router.js';
import type { Env } from '../types.js';

function mockKv(store: Record<string, string | null> = {}): Env['KV_API_KEYS'] {
  return {
    get(key: string) {
      return Promise.resolve(store[key] ?? null);
    },
    put: () => Promise.resolve(),
    delete: () => Promise.resolve(),
    list: () => Promise.resolve({ keys: [], list_complete: true } as never),
    getWithMetadata: () => Promise.resolve({ value: null, metadata: null } as never),
  } as unknown as Env['KV_API_KEYS'];
}

function mockIdempotencyKv(): Env['KV_IDEMPOTENCY'] {
  return {
    get: () => Promise.resolve(null),
    put: () => Promise.resolve(),
    delete: () => Promise.resolve(),
    list: () => Promise.resolve({ keys: [], list_complete: true } as never),
    getWithMetadata: () => Promise.resolve({ value: null, metadata: null } as never),
  } as unknown as Env['KV_IDEMPOTENCY'];
}

function mockRateLimiterAllow(): Env['RATE_LIMITER'] {
  const stub = {
    fetch: () => {
      const body = {
        allowed: true,
        remaining: 49_999,
        reset_at: Date.now() + 60_000,
        limit: 50_000,
      };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    },
  };
  return {
    idFromName: () => ({ toString: () => 'mock-id' }),
    get: () => stub,
  } as unknown as Env['RATE_LIMITER'];
}

const VALID_KEY_RECORD = JSON.stringify({ tenant_id: 'tenant-uuid-1', scopes: ['write:events'] });

const validEvent = {
  event_id: '01928f00-7000-7000-8000-123456789abc',
  tenant_id: '01928f00-7000-7000-8000-aaaaaaaaaaaa',
  session_id: 'a'.repeat(40),
  ts: 1714180000000,
  region: 'eu' as const,
  consent_state: 'legitimate-interest' as const,
  schema_version: 1 as const,
  type: 'page.view',
  payload: {
    url: 'https://example.com/listing/1',
    viewport: { width: 1440, height: 900 },
    device_class: 'desktop' as const,
  },
};

describe('events handler — OTel span attributes (AC2)', () => {
  beforeEach(() => {
    _mockSpan = new MockSpan();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('sets estalara.tenant_id, batch_size, region, validation_failures, rate_limited on happy path', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ offsets: [{ partition: 0, offset: 0 }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/vnd.kafka.v2+json' },
        }),
      );

    try {
      const app = createApp();
      const env: Env = {
        ENVIRONMENT: 'test',
        KV_API_KEYS: mockKv({ 'api_key:k1': VALID_KEY_RECORD }),
        KV_IDEMPOTENCY: mockIdempotencyKv(),
        RATE_LIMITER: mockRateLimiterAllow(),
      };

      const res = await app.fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Estalara-API-Key': 'k1',
            'CF-IPCountry': 'DE',
          },
          body: JSON.stringify({ events: [validEvent, validEvent] }),
        }),
        env,
      );

      expect(res.status).toBe(200);
      expect(_mockSpan.attributes['estalara.tenant_id']).toBe('tenant-uuid-1');
      expect(_mockSpan.attributes['estalara.batch_size']).toBe(2);
      expect(_mockSpan.attributes['estalara.region']).toBe('eu');
      expect(_mockSpan.attributes['estalara.validation_failures']).toBe(0);
      expect(_mockSpan.attributes['estalara.rate_limited']).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('sets rate_limited=true and batch_size when rate limited', async () => {
    const stub = {
      fetch: () => {
        const body = {
          allowed: false,
          remaining: 0,
          reset_at: Date.now() + 30_000,
          limit: 50_000,
        };
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      },
    };
    const rateLimiterDeny = {
      idFromName: () => ({ toString: () => 'mock-id' }),
      get: () => stub,
    } as unknown as Env['RATE_LIMITER'];

    const app = createApp();
    const env: Env = {
      ENVIRONMENT: 'test',
      KV_API_KEYS: mockKv({ 'api_key:k1': VALID_KEY_RECORD }),
      KV_IDEMPOTENCY: mockIdempotencyKv(),
      RATE_LIMITER: rateLimiterDeny,
    };

    const res = await app.fetch(
      new Request('http://test/v1/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Estalara-API-Key': 'k1' },
        body: JSON.stringify({ events: [validEvent] }),
      }),
      env,
    );

    expect(res.status).toBe(429);
    expect(_mockSpan.attributes['estalara.rate_limited']).toBe(true);
    expect(_mockSpan.attributes['estalara.batch_size']).toBe(1);
    expect(_mockSpan.attributes['estalara.tenant_id']).toBe('tenant-uuid-1');
  });

  it('sets validation_failures count when some events fail schema validation', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ offsets: [{ partition: 0, offset: 0 }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/vnd.kafka.v2+json' },
        }),
      );

    try {
      const app = createApp();
      const env: Env = {
        ENVIRONMENT: 'test',
        KV_API_KEYS: mockKv({ 'api_key:k1': VALID_KEY_RECORD }),
        KV_IDEMPOTENCY: mockIdempotencyKv(),
        RATE_LIMITER: mockRateLimiterAllow(),
      };

      const badEvent = { ...validEvent, type: 'totally-unknown-type' };
      const res = await app.fetch(
        new Request('http://test/v1/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Estalara-API-Key': 'k1' },
          body: JSON.stringify({ events: [validEvent, badEvent, validEvent] }),
        }),
        env,
      );

      expect(res.status).toBe(200);
      expect(_mockSpan.attributes['estalara.validation_failures']).toBe(1);
      expect(_mockSpan.attributes['estalara.batch_size']).toBe(3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
