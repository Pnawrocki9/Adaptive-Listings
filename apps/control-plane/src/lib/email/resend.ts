/**
 * Resend email delivery helper.
 *
 * Thin wrapper around the Resend SDK. All email sending in the control plane
 * routes through this module so the API key check and default-from logic are
 * centralised and testable.
 *
 * The RESEND_API_KEY environment variable must be set in production. When the
 * key is absent the function throws, so callers can handle the error and surface
 * an appropriate response without silently swallowing the failure.
 *
 * @module apps/control-plane/src/lib/email/resend
 */

import { Resend } from 'resend';

/**
 * The transactional sending mailbox. FIXED infrastructure — the actual sending
 * domain is an ops concern and does NOT change per brand (FOLLOW-654 leg 3).
 * Only the display name in front of it is parameterized per brand.
 */
const SENDER_MAILBOX = 'noreply@contact.estalara.com';

/** First-party display name used when no brand identity is supplied. */
const DEFAULT_SENDER_DISPLAY_NAME = 'Estalara';

const DEFAULT_FROM = `${DEFAULT_SENDER_DISPLAY_NAME} <${SENDER_MAILBOX}>`;

/**
 * Builds a Resend `from` value that shows a brand's display name in front of the
 * fixed {@link SENDER_MAILBOX}. Used to make client-brand DSR emails display the
 * brand's identity rather than "Estalara" while keeping the sending
 * domain/infrastructure unchanged (FOLLOW-654 leg 3).
 *
 * Fail-honest: an empty / whitespace-only display name falls back to
 * "Estalara" — never an empty display name.
 *
 * @param displayName - The brand display name (e.g. "Costa Sol Properties").
 */
export function brandSenderFrom(displayName: string): string {
  const name = displayName.trim() || DEFAULT_SENDER_DISPLAY_NAME;
  return `${name} <${SENDER_MAILBOX}>`;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

/**
 * Send a transactional email via Resend.
 *
 * @param opts - Recipient, subject, HTML body, and optional sender override.
 * @throws {Error} when RESEND_API_KEY is not set.
 * @throws {Error} when the Resend API returns an error.
 */
export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not set — email sending is disabled');
  }
  const client = new Resend(apiKey);
  await client.emails.send({
    from: opts.from ?? DEFAULT_FROM,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
}
