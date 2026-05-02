/**
 * Unit tests for the ingest error-handler.
 *
 * Covers:
 * - Every defined error code → correct HTTP status + canonical body shape
 * - Unknown errors → 500 internal_error
 * - EstalaraError with details → details forwarded
 * - X-Request-ID header set on every response
 * - request_id in body matches X-Request-ID header
 *
 * Design note: in Hono v4, errors thrown from route handlers are caught by the
 * compose() function and routed to app.onError BEFORE they can bubble back to a
 * middleware's `await next()` catch block.  Each test therefore registers BOTH
 * `app.use('*', errorHandler)` (for requestId) AND `app.onError(handleError)`
 * (for error formatting).
 */

import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Handler } from 'hono';

import { EstalaraError } from '@estalara/shared/observability';

import { errorHandler, handleError, statusFromCode } from './error-handler.js';
import type { ErrorResponseBody } from './error-handler.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a test Hono app with full error-handling wiring. */
function buildApp(routeHandler: Handler) {
  const app = new Hono();
  app.use('*', errorHandler);
  app.onError(handleError);
  app.get('/test', routeHandler);
  return app;
}

async function getBody(res: Response): Promise<ErrorResponseBody> {
  return await res.json();
}

// ---------------------------------------------------------------------------
// statusFromCode
// ---------------------------------------------------------------------------

describe('statusFromCode', () => {
  it.each([
    ['validation_failed', 400],
    ['unauthorized', 401],
    ['payload_too_large', 413],
    ['rate_limited', 429],
    ['redpanda_unavailable', 503],
    ['internal_error', 500],
    ['unknown_code_xyz', 500],
  ])('maps %s → %i', (code, expected) => {
    expect(statusFromCode(code)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Error code → HTTP status mapping
// ---------------------------------------------------------------------------

describe('errorHandler — EstalaraError codes', () => {
  it('returns 400 for validation_failed', async () => {
    const app = buildApp(() => {
      throw new EstalaraError({ code: 'validation_failed', message: 'bad input' });
    });
    const res = await app.fetch(new Request('http://test/test'));
    expect(res.status).toBe(400);
    const body = await getBody(res);
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.message).toBe('bad input');
    expect(body.error.request_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns 401 for unauthorized', async () => {
    const app = buildApp(() => {
      throw new EstalaraError({ code: 'unauthorized', message: 'missing key' });
    });
    const res = await app.fetch(new Request('http://test/test'));
    expect(res.status).toBe(401);
    const body = await getBody(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('returns 413 for payload_too_large', async () => {
    const app = buildApp(() => {
      throw new EstalaraError({ code: 'payload_too_large', message: 'too big' });
    });
    const res = await app.fetch(new Request('http://test/test'));
    expect(res.status).toBe(413);
    const body = await getBody(res);
    expect(body.error.code).toBe('payload_too_large');
  });

  it('returns 429 for rate_limited', async () => {
    const app = buildApp(() => {
      throw new EstalaraError({ code: 'rate_limited', message: 'slow down' });
    });
    const res = await app.fetch(new Request('http://test/test'));
    expect(res.status).toBe(429);
    const body = await getBody(res);
    expect(body.error.code).toBe('rate_limited');
  });

  it('returns 503 for redpanda_unavailable', async () => {
    const app = buildApp(() => {
      throw new EstalaraError({ code: 'redpanda_unavailable', message: 'broker down' });
    });
    const res = await app.fetch(new Request('http://test/test'));
    expect(res.status).toBe(503);
    const body = await getBody(res);
    expect(body.error.code).toBe('redpanda_unavailable');
  });

  it('returns 500 for internal_error', async () => {
    const app = buildApp(() => {
      throw new EstalaraError({ code: 'internal_error', message: 'uh oh' });
    });
    const res = await app.fetch(new Request('http://test/test'));
    expect(res.status).toBe(500);
    const body = await getBody(res);
    expect(body.error.code).toBe('internal_error');
  });
});

// ---------------------------------------------------------------------------
// Unknown / non-EstalaraError errors
// ---------------------------------------------------------------------------

describe('errorHandler — unknown errors', () => {
  it('returns 500 with internal_error code for generic Error', async () => {
    const app = buildApp(() => {
      throw new Error('something broke');
    });
    const res = await app.fetch(new Request('http://test/test'));
    expect(res.status).toBe(500);
    const body = await getBody(res);
    expect(body.error.code).toBe('internal_error');
    expect(body.error.message).toBe('Internal server error');
  });

  it('does not leak internal error message to client', async () => {
    const app = buildApp(() => {
      throw new Error('SECRET: db password is hunter2');
    });
    const res = await app.fetch(new Request('http://test/test'));
    const body = await getBody(res);
    expect(body.error.message).not.toContain('hunter2');
  });

  // Note: Hono v4 #handleError only routes Error instances to app.onError. Non-Error throws
  // (raw strings, numbers) propagate as unhandled rejections. The Worker runtime handles those
  // at the edge; clients see a 500. This edge case is not tested at the unit level.
});

// ---------------------------------------------------------------------------
// Details forwarding
// ---------------------------------------------------------------------------

describe('errorHandler — details forwarding', () => {
  it('includes details when EstalaraError has them', async () => {
    const app = buildApp(() => {
      throw new EstalaraError({
        code: 'validation_failed',
        message: 'bad field',
        details: { field: 'email', reason: 'invalid format' },
      });
    });
    const res = await app.fetch(new Request('http://test/test'));
    const body = await getBody(res);
    expect(body.error.details).toEqual({ field: 'email', reason: 'invalid format' });
  });

  it('omits details key when EstalaraError has no details', async () => {
    const app = buildApp(() => {
      throw new EstalaraError({ code: 'unauthorized', message: 'bad key' });
    });
    const res = await app.fetch(new Request('http://test/test'));
    const body = await getBody(res);
    expect(body.error.details).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// X-Request-ID header
// ---------------------------------------------------------------------------

describe('errorHandler — X-Request-ID', () => {
  it('sets X-Request-ID on error responses', async () => {
    const app = buildApp(() => {
      throw new EstalaraError({ code: 'unauthorized', message: 'no key' });
    });
    const res = await app.fetch(new Request('http://test/test'));
    expect(res.headers.get('X-Request-ID')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('request_id in body matches X-Request-ID header', async () => {
    const app = buildApp(() => {
      throw new EstalaraError({ code: 'internal_error', message: 'boom' });
    });
    const res = await app.fetch(new Request('http://test/test'));
    const body = await getBody(res);
    expect(body.error.request_id).toBe(res.headers.get('X-Request-ID'));
  });

  it('sets X-Request-ID even on successful responses (passthrough)', async () => {
    const app = buildApp((c: Parameters<Handler>[0]) => c.json({ ok: true }));
    const res = await app.fetch(new Request('http://test/test'));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Request-ID')).toMatch(/^[0-9a-f-]{36}$/);
  });
});
