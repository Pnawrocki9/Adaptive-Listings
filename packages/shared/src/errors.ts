/**
 * Canonical API error format shared across all Estalara services.
 *
 * Every HTTP error response — from the ingest Worker, the Control Plane API, the Decision API,
 * and any future tenant-facing service — MUST conform to {@link ErrorResponseBody}. This keeps the
 * error contract stable for SDK consumers and makes Sentry / Grafana correlation by `request_id`
 * a single-grep operation.
 *
 * @module @estalara/shared/errors
 */

/**
 * Canonical error response body. Every non-2xx HTTP response from an Estalara API
 * MUST serialize to this shape so SDK consumers can rely on a single contract.
 *
 * @example
 * {
 *   error: {
 *     code: 'VALIDATION_ERROR',
 *     message: 'Request body is not valid JSON',
 *     request_id: '01928f00-7000-7000-8000-aaaaaaaaaaaa',
 *     details: { field: 'events' }
 *   }
 * }
 */
export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    request_id: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Canonical error codes used across all Estalara services.
 *
 * Service-specific codes (e.g. `redpanda_unavailable`, `payload_too_large`) are still allowed —
 * `ErrorResponseBody.error.code` is typed as `string`. These constants are the canonical set that
 * SDK consumers should branch on; everything else maps to {@link ErrorCode.INTERNAL_ERROR} for
 * the purposes of generic error UX.
 */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  CONFLICT: 'CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

/** Union of canonical {@link ErrorCode} values. */
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Build a canonical {@link ErrorResponseBody}.
 *
 * `details` is omitted from the result when not provided — the property is absent rather than set
 * to `undefined`, which keeps JSON serialization clean and complies with the project's
 * `exactOptionalPropertyTypes` setting.
 *
 * @param args.code      - One of the canonical {@link ErrorCode} values.
 * @param args.message   - Human-readable message; safe to surface in client UI.
 * @param args.requestId - Correlation ID for logs / tracing. Echoed back in the response body.
 * @param args.details   - Optional structured context (e.g. failing field, retry-after window).
 */
export function errorBody(args: {
  code: ErrorCode;
  message: string;
  requestId: string;
  details?: Record<string, unknown>;
}): ErrorResponseBody {
  return {
    error: {
      code: args.code,
      message: args.message,
      request_id: args.requestId,
      ...(args.details !== undefined ? { details: args.details } : {}),
    },
  };
}

/**
 * Build a canonical {@link ErrorResponseBody} for database operation failures.
 *
 * Extracts the error message from the caught value (if it is an `Error` instance)
 * or falls back to a generic message. Uses {@link ErrorCode.INTERNAL_ERROR} so
 * callers do not need to import `ErrorCode` separately.
 *
 * @param err       - The caught value from a try/catch block.
 * @param requestId - Optional correlation ID (defaults to 'unknown').
 */
export function dbErrorResponse(err: unknown, requestId = 'unknown'): ErrorResponseBody {
  const message = err instanceof Error ? err.message : 'Database operation failed';
  return {
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: `Internal database error: ${message}`,
      request_id: requestId,
    },
  };
}
