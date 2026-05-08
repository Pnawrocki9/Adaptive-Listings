/**
 * @estalara/auth — JWT claim extraction, RBAC guards, Supabase Auth helpers.
 *
 * @module @estalara/auth
 */

export * from './jwt.js';
export * from './middleware.js';
export * from './tenant-context.js';

/** Current auth package version string. */
export const AUTH_VERSION = '0.0.0' as const;
