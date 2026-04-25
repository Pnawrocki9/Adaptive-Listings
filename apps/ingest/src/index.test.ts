import { describe, expect, it } from 'vitest';

import handler from './index.js';

describe('estalara-ingest', () => {
  it('exports a fetch handler', () => {
    expect(typeof handler.fetch).toBe('function');
  });

  it('returns 200 with service metadata for any request', async () => {
    const request = new Request('https://ingest.estalara.io/v1/events', {
      method: 'POST',
    });

    const env = { ENVIRONMENT: 'test' };
    // The placeholder handler ignores ExecutionContext; cast to satisfy the type signature
    const ctx = {
      waitUntil(_promise: Promise<unknown>): void {
        /* no-op in tests */
      },
      passThroughOnException(): void {
        /* no-op in tests */
      },
    } as unknown as ExecutionContext;

    const response = await handler.fetch(request, env, ctx);
    const body: unknown = await response.json();
    const meta = body as Record<string, string>;

    expect(response.status).toBe(200);
    expect(meta.service).toBe('estalara-ingest');
    expect(meta.status).toBe('placeholder');
  });
});
