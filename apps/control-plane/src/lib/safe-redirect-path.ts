/**
 * Open-redirect guard for the post-authentication `next` parameter. [FOLLOW-1336]
 *
 * `/auth/callback?code=…&next=<path>` ends in a redirect to `next`. An attacker can craft a
 * password-recovery link whose `next` points at their own site, so `next` is accepted ONLY when it
 * is a same-origin relative path. Everything else falls back to the default landing page.
 *
 * @module apps/control-plane/src/lib/safe-redirect-path
 */

/** Where an authenticated browser lands when `next` is absent or refused. */
const DEFAULT_AFTER_AUTH_PATH = '/admin';

/** ASCII control characters (the URL parser silently strips tab/CR/LF, turning `/\t/host` into `//host`). */
// eslint-disable-next-line no-control-regex -- the point of the check is to refuse these bytes
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * Return `next` when it is a same-origin relative path, otherwise `/admin`.
 *
 * Refused: a missing/empty value, anything not starting with exactly one `/` (absolute URLs,
 * `//host`, `javascript:`), any backslash (browsers read `/\host` as `//host`), any control
 * character, and any value that does not resolve to the same origin once parsed.
 *
 * @param next - the raw `next` query parameter, or `null` when absent.
 */
export function safeRedirectPath(next: string | null): string {
  if (next === null || next.length === 0) return DEFAULT_AFTER_AUTH_PATH;
  if (!next.startsWith('/') || next.startsWith('//')) return DEFAULT_AFTER_AUTH_PATH;
  if (next.includes('\\') || CONTROL_CHARACTERS.test(next)) return DEFAULT_AFTER_AUTH_PATH;

  // Belt and braces: resolve against a throwaway origin and require that it did not change.
  const probeOrigin = 'http://redirect-probe.invalid';
  try {
    if (new URL(next, probeOrigin).origin !== probeOrigin) return DEFAULT_AFTER_AUTH_PATH;
  } catch {
    return DEFAULT_AFTER_AUTH_PATH;
  }
  return next;
}
