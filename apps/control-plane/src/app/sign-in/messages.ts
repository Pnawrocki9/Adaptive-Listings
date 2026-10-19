/**
 * Fixed messages for the `?error=<code>` values `/auth/callback` and `/reset-password` redirect to
 * `/sign-in` with. A code, never a raw provider message. [FOLLOW-1336]
 *
 * @module apps/control-plane/src/app/sign-in/messages
 */

/** `error` query code → text. An unknown code renders nothing. */
export const SIGN_IN_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  invalid_link: 'That link is invalid or has expired. Request a new password reset e-mail.',
};
