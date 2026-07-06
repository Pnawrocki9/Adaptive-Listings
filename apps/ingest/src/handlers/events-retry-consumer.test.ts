import { describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/cloudflare', () => ({ captureException: vi.fn() }));

import * as Sentry from '@sentry/cloudflare';

import type { ClickHouseProducerEnv } from '../clickhouse-producer.js';
import type { EventsRetryMessage } from '../events-retry-queue.js';
import { handleEventsRetryQueue } from './events-retry-consumer.js';

function makeMessage(
  body: unknown,
  overrides: Partial<{ id: string; attempts: number }> = {},
): {
  message: { id: string; timestamp: Date; body: unknown; attempts: number };
  ack: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
} {
  const ack = vi.fn();
  const retry = vi.fn();
  return {
    message: {
      id: overrides.id ?? 'msg-1',
      timestamp: new Date(),
      body,
      attempts: overrides.attempts ?? 1,
      ack,
      retry,
    } as unknown as { id: string; timestamp: Date; body: unknown; attempts: number },
    ack,
    retry,
  };
}

function makeBatch(messages: ReturnType<typeof makeMessage>['message'][]): { messages: unknown[] } {
  return { messages };
}

const validMessageBody: EventsRetryMessage = {
  schema_version: 1,
  batch_id: '11111111-1111-4111-8111-111111111111',
  tenant_id: 'cbc51cfa-1056-40aa-b0a9-6e982b52b1de',
  first_failed_at: 1_748_539_000_000,
  attempt: 0,
  records: [
    {
      event_id: '01928f00-7000-7000-8000-deadbeefcafe',
      tenant_id: 'cbc51cfa-1056-40aa-b0a9-6e982b52b1de',
      session_id: 'a'.repeat(40),
      ts: 1748538900000,
      region: 'eu',
      type: 'page.view',
      schema_version: 1,
      consent_state: 'legitimate-interest',
      payload: { url: 'https://app.estalara.com/listings' },
    },
  ],
};

const env: ClickHouseProducerEnv = {
  CLICKHOUSE_URL: 'https://ch.example.com:8443',
  CLICKHOUSE_DATABASE: 'default',
  CLICKHOUSE_USER: 'ingest_worker',
  CLICKHOUSE_PASSWORD: 'pw',
};

describe('handleEventsRetryQueue — successful re-insert acks the message', () => {
  it('calls ack() when pushToClickHouse succeeds', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(new Response('', { status: 200 }));
    try {
      const { message, ack, retry } = makeMessage(validMessageBody);
      await handleEventsRetryQueue(makeBatch([message]) as never, env as never);
      expect(ack).toHaveBeenCalledTimes(1);
      expect(retry).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('handleEventsRetryQueue — re-insert failure calls retry(), not ack()', () => {
  it('calls retry() and captures Sentry when pushToClickHouse exhausts retries', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(new Response('still down', { status: 503 }));
    const captureSpy = vi.mocked(Sentry.captureException);
    captureSpy.mockClear();
    try {
      const { message, ack, retry } = makeMessage(validMessageBody);
      await handleEventsRetryQueue(makeBatch([message]) as never, env as never);
      expect(retry).toHaveBeenCalledTimes(1);
      expect(ack).not.toHaveBeenCalled();
      expect(captureSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('events_retry_reinsert_failed'),
        }),
        expect.objectContaining({
          tags: expect.objectContaining({ kind: 'retry_reinsert_failed' }),
        }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 20_000); // pushToClickHouse's 3-attempt backoff (100+500+2500ms) runs per message
});

describe('handleEventsRetryQueue — malformed message', () => {
  it('acks (drops) a message whose body fails schema validation, without calling ClickHouse', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = () => {
      fetchCalls++;
      return Promise.resolve(new Response('', { status: 200 }));
    };
    const captureSpy = vi.mocked(Sentry.captureException);
    captureSpy.mockClear();
    try {
      const { message, ack, retry } = makeMessage({ not: 'a valid retry message' });
      await handleEventsRetryQueue(makeBatch([message]) as never, env as never);
      expect(ack).toHaveBeenCalledTimes(1);
      expect(retry).not.toHaveBeenCalled();
      expect(fetchCalls).toBe(0);
      expect(captureSpy).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'events_retry_message_malformed' }),
        expect.objectContaining({
          tags: expect.objectContaining({ kind: 'malformed_retry_message' }),
        }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('handleEventsRetryQueue — batch with multiple messages', () => {
  it('processes each message independently (one ack, one retry)', async () => {
    const originalFetch = globalThis.fetch;
    let call = 0;
    globalThis.fetch = () => {
      call++;
      // First message's CH call (attempt 1) succeeds; second message's 3 attempts all fail.
      return call === 1
        ? Promise.resolve(new Response('', { status: 200 }))
        : Promise.resolve(new Response('boom', { status: 503 }));
    };
    try {
      const good = makeMessage(validMessageBody, { id: 'good' });
      const bad = makeMessage(
        { ...validMessageBody, batch_id: '22222222-2222-4222-8222-222222222222' },
        { id: 'bad' },
      );
      await handleEventsRetryQueue(makeBatch([good.message, bad.message]) as never, env as never);
      expect(good.ack).toHaveBeenCalledTimes(1);
      expect(good.retry).not.toHaveBeenCalled();
      expect(bad.retry).toHaveBeenCalledTimes(1);
      expect(bad.ack).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 20_000);
});
