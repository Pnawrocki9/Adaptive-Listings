/**
 * Minimum length the reset-password form enforces before it calls Supabase. [FOLLOW-1336]
 *
 * Supabase's own minimum is a project setting the repo cannot read (default 6); the form applies
 * the stricter 12 so a staff password is never weaker than the project's setting allows.
 *
 * @module apps/control-plane/src/lib/password-policy
 */
export const MIN_PASSWORD_LENGTH = 12;
