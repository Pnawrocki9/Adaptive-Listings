/**
 * Typed error class for Estalara services.
 *
 * Every thrown error in the platform extends `EstalaraError` so that:
 * - HTTP boundaries can serialise errors uniformly with `toJSON()`
 * - Sentry context tagging can attach `code` and `request_id`
 * - Clients receive a stable, machine-readable `code` field
 *
 * @module @estalara/shared/observability/error
 */

/** JSON-serialisable shape returned by `EstalaraError.toJSON()`. */
export interface EstalaraErrorJSON {
  code: string;
  message: string;
  details: Record<string, unknown> | undefined;
  request_id: string;
}

/** Constructor arguments for `EstalaraError`. */
export interface EstalaraErrorArgs {
  /** Stable machine-readable error code, e.g. `ERR_TENANT_NOT_FOUND`. */
  code: string;
  /** Human-readable message. Never include PII. */
  message: string;
  /** Optional structured context. Never include secrets. */
  details?: Record<string, unknown>;
  /**
   * Caller-supplied request correlation ID.
   * When omitted a new UUID is generated via `crypto.randomUUID()`.
   */
  request_id?: string;
}

/**
 * Base error class for all Estalara platform errors.
 *
 * @example
 * ```ts
 * throw new EstalaraError({
 *   code: 'ERR_TENANT_NOT_FOUND',
 *   message: 'Tenant not found',
 *   details: { tenant_id: id },
 *   request_id: requestId,
 * });
 * ```
 */
export class EstalaraError extends Error {
  /** Stable machine-readable error code. */
  readonly code: string;
  /** Optional structured context (no secrets, no PII). */
  readonly details: Record<string, unknown> | undefined;
  /** Request correlation ID — auto-generated if not supplied. */
  readonly request_id: string;

  constructor(args: EstalaraErrorArgs) {
    super(args.message);
    this.name = 'EstalaraError';
    this.code = args.code;
    this.details = args.details;
    this.request_id = args.request_id ?? crypto.randomUUID();
  }

  /**
   * Serialises the error to a plain object safe for HTTP responses.
   *
   * @returns `EstalaraErrorJSON` — `{ code, message, details, request_id }`.
   */
  toJSON(): EstalaraErrorJSON {
    return {
      code: this.code,
      message: this.message,
      details: this.details ?? undefined,
      request_id: this.request_id,
    };
  }
}
