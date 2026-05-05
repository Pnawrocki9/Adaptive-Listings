/**
 * Error-handling utilities for the ingest Worker.
 *
 * Exports two things that must be wired together in the router:
 *
 *   1. `errorHandler` middleware — generates `request_id` early and attaches
 *      it to the context + `X-Request-ID` response header.  Must be registered
 *      with `app.use('*', errorHandler)`.
 *
 *   2. `handleError` — Hono `onError` handler that formats any thrown error
 *      into the canonical `{ error: { code, message, request_id, details? } }`
 *      shape.  Must be registered with `app.onError(handleError)`.
 *
 * Why two separate exports? In Hono v4, errors thrown from route handlers are
 * intercepted by the compose() function and routed to `app.onError` BEFORE they
 * can propagate back to a middleware's `await next()` catch block.  The
 * middleware can still set `request_id` on the context; `handleError` reads it
 * back via `c.get('requestId')`.
 *
 * @module apps/ingest/src/middleware/error-handler
 */

import type { Context, MiddlewareHandler } from 'hono';

import type { ErrorCode, ErrorResponseBody } from '@estalara/shared';
import type { EstalaraError } from '@estalara/shared/observability';

/** Re-exported so other ingest modules can keep importing from this file. */
export type { ErrorCode, ErrorResponseBody };

/**
 * Duck-type guard for `EstalaraError`. Using `instanceof` fails across ESM
 * module instance boundaries (dual-package hazard). Checking the structural
 * shape is safer.
 */
function isEstalaraError(err: unknown): err is Pick<EstalaraError, 'code' | 'message' | 'details'> {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as Record<string, unknown>).code === 'string' &&
    typeof (err as Record<string, unknown>).message === 'string' &&
    'name' in err &&
    (err as Record<string, unknown>).name === 'EstalaraError'
  );
}

/** All error codes the ingest service can emit and their HTTP statuses. */
const ERROR_STATUS_MAP: Readonly<Record<string, number>> = {
  validation_failed: 400,
  unauthorized: 401,
  payload_too_large: 413,
  rate_limited: 429,
  redpanda_unavailable: 503,
  internal_error: 500,
};

/** Map an error code to its HTTP status. Falls back to 500. */
export function statusFromCode(code: string): number {
  return ERROR_STATUS_MAP[code] ?? 500;
}

/**
 * Middleware — generates `request_id` and attaches it to the Hono context
 * variable `requestId` and the `X-Request-ID` response header.
 *
 * Register with `app.use('*', errorHandler)`.
 */
export const errorHandler: MiddlewareHandler = async (c, next) => {
  const requestId = crypto.randomUUID();
  c.set('requestId' as never, requestId);
  c.header('X-Request-ID', requestId);
  await next();
};

/**
 * Hono `onError` handler — converts thrown errors into the canonical error JSON
 * shape.  Reads `requestId` from context (set by `errorHandler` middleware) so
 * the body and header stay in sync.
 *
 * Register with `app.onError(handleError)`.
 */
export function handleError(err: Error, c: Context): Response {
  const requestId = (c.get('requestId' as never) as string | undefined) ?? crypto.randomUUID();
  c.header('X-Request-ID', requestId);

  if (isEstalaraError(err)) {
    const body: ErrorResponseBody = {
      error: {
        code: err.code,
        message: err.message,
        request_id: requestId,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    };
    return c.json(body, statusFromCode(err.code) as Parameters<typeof c.json>[1]);
  }

  const e = err instanceof Error ? err : new Error(String(err));
  console.error(
    JSON.stringify({
      event: 'unhandled_error',
      request_id: requestId,
      message: e.message,
      stack: e.stack,
    }),
  );

  const body: ErrorResponseBody = {
    error: {
      code: 'internal_error',
      message: 'Internal server error',
      request_id: requestId,
    },
  };
  return c.json(body, 500);
}
