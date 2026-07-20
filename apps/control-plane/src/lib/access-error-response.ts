/**
 * Map an {@link AccessError} thrown by `resolveTenantAccess` (ADR-0018 §2) to a
 * uniform `NextResponse` error body across every route that opts into the staff
 * override. Keeps the `{ error: { code, message } }` envelope the existing
 * analytics routes already return, so the agency-path 401 shape is byte-identical
 * (its `code` stays `'unauthorized'`).
 *
 * Non-`AccessError` throwables are re-thrown so the caller's own catch (Sentry +
 * 500) still owns genuine bugs — this helper never swallows unexpected errors.
 *
 * @module apps/control-plane/src/lib/access-error-response
 */

import { NextResponse } from 'next/server';
import { AccessError } from '@/lib/session-auth';

/** HTTP status → stable machine-readable error code. */
const STATUS_CODE: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  500: 'access_error',
};

/**
 * @param err - The value caught around a `resolveTenantAccess` call.
 * @returns A `NextResponse` when `err` is an {@link AccessError}.
 * @throws the original `err` when it is NOT an `AccessError` (a real bug).
 */
export function accessErrorToResponse(err: unknown): NextResponse {
  if (err instanceof AccessError) {
    return NextResponse.json(
      { error: { code: STATUS_CODE[err.status] ?? 'access_error', message: err.message } },
      { status: err.status },
    );
  }
  throw err;
}
