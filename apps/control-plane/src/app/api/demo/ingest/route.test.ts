import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { POST } from './route';

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/demo/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/demo/ingest', () => {
  it('returns 200 with count when events array is provided', async () => {
    const req = makePostRequest({
      events: [
        { type: 'page.view', payload: {}, ts: Date.now() },
        { type: 'scroll.depth', payload: { depth_percent: 25 }, ts: Date.now() },
        { type: 'cta.clicked', payload: { cta_id: 'view-details' }, ts: Date.now() },
      ],
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await parseBody<{ received: boolean; count: number }>(res);
    expect(body.received).toBe(true);
    expect(body.count).toBe(3);
  });

  it('returns 200 with count 0 when events array is empty', async () => {
    const req = makePostRequest({ events: [] });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await parseBody<{ received: boolean; count: number }>(res);
    expect(body.received).toBe(true);
    expect(body.count).toBe(0);
  });

  it('returns 200 with count 0 when body has no events field', async () => {
    const req = makePostRequest({ session_id: 'abc123' });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await parseBody<{ received: boolean; count: number }>(res);
    expect(body.received).toBe(true);
    expect(body.count).toBe(0);
  });

  it('returns 200 gracefully when body is malformed JSON', async () => {
    const req = new NextRequest('http://localhost/api/demo/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-valid-json{{{',
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await parseBody<{ received: boolean; count: number }>(res);
    expect(body.received).toBe(true);
    expect(body.count).toBe(0);
  });
});
