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

const DEFAULT_FROM = 'Estalara <noreply@contact.estalara.com>';

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
