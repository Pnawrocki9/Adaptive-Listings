import { describe, expect, it } from 'vitest';

import handler from './index.js';

const ctx = {
  waitUntil(_promise: Promise<unknown>): void {
    /* no-op in tests */
  },
  passThroughOnException(): void {
    /* no-op in tests */
  },
} as unknown as ExecutionContext;

const env = { ENVIRONMENT: 'test' };

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

describe('estalara-decision-api', () => {
  it('exports a fetch handler', () => {
    expect(typeof handler.fetch).toBe('function');
  });

  it('GET /api/health returns 200', async () => {
    const req = new Request('https://api.estalara.com/api/health');
    const res = await handler.fetch(req, env, ctx);
    expect(res.status).toBe(200);
    const body = await parseBody<{ status: string }>(res);
    expect(body.status).toBe('ok');
  });

  it('unknown route returns 404', async () => {
    const req = new Request('https://api.estalara.com/v1/adapt', { method: 'POST' });
    const res = await handler.fetch(req, env, ctx);
    expect(res.status).toBe(404);
  });
});
