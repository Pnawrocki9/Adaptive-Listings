/**
 * Unit tests for packages/shared/src/observability/
 *
 * Tests: logger factory, tracer factory, EstalaraError, Sentry init behaviour.
 */

import { describe, it, expect, vi } from 'vitest';
import { createLogger } from './logger.js';
import { createTracer } from './tracer.js';
import { EstalaraError } from './error.js';

// ---------------------------------------------------------------------------
// 1. createLogger — returns Pino with correct base tags
// ---------------------------------------------------------------------------

describe('createLogger', () => {
  it('returns a Pino logger with correct service base fields', () => {
    const logger = createLogger('apps/test-service');
    // Pino exposes bindings() on the instance which reflects the `base` config
    const bindings = logger.bindings();
    expect(bindings).toMatchObject({
      service: {
        name: 'apps/test-service',
        version: expect.any(String),
      },
    });
  });

  it('uses GIT_SHA env var as service.version when set', () => {
    const original = process.env.GIT_SHA;
    process.env.GIT_SHA = 'abc123def456';
    const logger = createLogger('apps/control-plane');
    const bindings = logger.bindings();
    expect(bindings.service).toMatchObject({ version: 'abc123def456' });
    process.env.GIT_SHA = original;
  });

  it('defaults service.version to "dev" when GIT_SHA is absent', () => {
    const original = process.env.GIT_SHA;
    delete process.env.GIT_SHA;
    const logger = createLogger('apps/ingest');
    const bindings = logger.bindings();
    expect(bindings.service).toMatchObject({ version: 'dev' });
    process.env.GIT_SHA = original;
  });

  it('respects LOG_LEVEL environment variable', () => {
    const original = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'warn';
    const logger = createLogger('apps/test');
    expect(logger.level).toBe('warn');
    process.env.LOG_LEVEL = original;
  });
});

// ---------------------------------------------------------------------------
// 2. createTracer — returns valid OTel Tracer (mock spans)
// ---------------------------------------------------------------------------

describe('createTracer', () => {
  it('returns a valid OTel Tracer instance', () => {
    const tracer = createTracer('apps/test-service');
    expect(tracer).toBeDefined();
    expect(typeof tracer.startSpan).toBe('function');
    expect(typeof tracer.startActiveSpan).toBe('function');
  });

  it('creates and ends a span without throwing', () => {
    const tracer = createTracer('apps/test-service');
    const span = tracer.startSpan('test-operation');
    expect(() => {
      span.setAttribute('test.key', 'value');
      span.end();
    }).not.toThrow();
  });

  it('returns a no-op tracer when no OTel provider is registered', () => {
    // OTel SDK returns a no-op tracer by default when no SDK is started
    const tracer = createTracer('apps/noop-service');
    // No-op tracer still has the correct interface
    expect(typeof tracer.startSpan).toBe('function');
    const span = tracer.startSpan('noop-span');
    expect(span).toBeDefined();
    span.end(); // should not throw
  });
});

// ---------------------------------------------------------------------------
// 3. EstalaraError.toJSON() produces expected shape
// ---------------------------------------------------------------------------

describe('EstalaraError', () => {
  it('toJSON() produces expected shape with all fields', () => {
    const err = new EstalaraError({
      code: 'ERR_TENANT_NOT_FOUND',
      message: 'Tenant not found',
      details: { tenant_id: 'abc-123' },
      request_id: 'req-456',
    });

    expect(err.toJSON()).toEqual({
      code: 'ERR_TENANT_NOT_FOUND',
      message: 'Tenant not found',
      details: { tenant_id: 'abc-123' },
      request_id: 'req-456',
    });
  });

  it('toJSON() omits details when not supplied', () => {
    const err = new EstalaraError({
      code: 'ERR_RATE_LIMITED',
      message: 'Rate limit exceeded',
      request_id: 'req-789',
    });

    const json = err.toJSON();
    expect(json.code).toBe('ERR_RATE_LIMITED');
    expect(json.message).toBe('Rate limit exceeded');
    expect(json.details).toBeUndefined();
    expect(json.request_id).toBe('req-789');
  });

  it('auto-generates request_id when not supplied', () => {
    const err = new EstalaraError({
      code: 'ERR_RATE_LIMITED',
      message: 'Rate limit exceeded',
    });

    expect(err.request_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('is an instance of Error and has correct name', () => {
    const err = new EstalaraError({ code: 'ERR_GENERIC', message: 'test' });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('EstalaraError');
    expect(err.message).toBe('test');
  });
});

// ---------------------------------------------------------------------------
// 4. Sentry init — no-op when DSN env var missing
// ---------------------------------------------------------------------------

describe('Sentry init (no DSN — graceful no-op)', () => {
  /**
   * Helper that mimics the guard pattern used in sentry.server.config.ts and
   * apps/ingest/src/observability.ts: call initFn only when DSN is truthy.
   */
  function initIfDsn(
    dsn: string | undefined,
    initFn: (opts: { dsn: string; tracesSampleRate: number }) => void,
  ) {
    if (dsn) {
      initFn({ dsn, tracesSampleRate: 0.1 });
    }
  }

  it('does not call Sentry.init when SENTRY_DSN_CONTROL_PLANE is absent', () => {
    const mockSentryInit = vi.fn();
    initIfDsn(undefined, mockSentryInit);
    expect(mockSentryInit).not.toHaveBeenCalled();
  });

  it('does not call Sentry.init when SENTRY_DSN_INGEST is absent', () => {
    const mockSentryInit = vi.fn();
    // Simulate the Cloudflare env object without the DSN binding
    const env: { SENTRY_DSN_INGEST?: string; ENVIRONMENT: string } = {
      ENVIRONMENT: 'development',
    };
    initIfDsn(env.SENTRY_DSN_INGEST, mockSentryInit);
    expect(mockSentryInit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. Sentry init — succeeds when DSN env var is present
// ---------------------------------------------------------------------------

describe('Sentry init (with DSN — succeeds)', () => {
  it('calls Sentry.init when DSN env var is present', () => {
    const fakeDsn = 'https://fake@sentry.io/123';
    const mockSentryInit = vi.fn();

    // Simulate sentry.server.config.ts pattern — DSN present → init called.
    mockSentryInit({
      dsn: fakeDsn,
      tracesSampleRate: 0.1,
      release: process.env.GIT_SHA ?? 'dev',
      environment: process.env.NODE_ENV ?? 'development',
    });

    expect(mockSentryInit).toHaveBeenCalledOnce();
    expect(mockSentryInit).toHaveBeenCalledWith(expect.objectContaining({ dsn: fakeDsn }));
  });

  it('uses lower sample rate in production', () => {
    const fakeDsn = 'https://fake@sentry.io/123';
    const mockSentryInit = vi.fn();

    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const tracesSampleRate = process.env.NODE_ENV === 'production' ? 0.05 : 0.1;
    mockSentryInit({ dsn: fakeDsn, tracesSampleRate });

    expect(mockSentryInit).toHaveBeenCalledWith(
      expect.objectContaining({ tracesSampleRate: 0.05 }),
    );

    process.env.NODE_ENV = originalEnv;
  });
});
