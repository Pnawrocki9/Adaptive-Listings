/**
 * @estalara/auth — JWT claim extraction, RBAC guards, Supabase Auth helpers.
 *
 * Estalara staff is the only claim shape since FOLLOW-1335 (the agency tenant-user claims and
 * the per-request tenant context built from them were removed with the agency roles).
 *
 * @module @estalara/auth
 */

export * from './jwt.js';
export * from './middleware.js';

/** Current auth package version string. */
export const AUTH_VERSION = '0.0.0' as const;
