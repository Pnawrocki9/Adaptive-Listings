/**
 * Lightweight PII scrubber for free-text chat messages.
 * Replaces email addresses and phone numbers with safe placeholders before the
 * message is stored in ClickHouse. Does NOT claim exhaustive coverage — it
 * reduces accidental PII leakage from buyers who type contact info in chat.
 *
 * @module @estalara/sdk/core/pii-scrub
 */

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.]+\.[a-zA-Z]{2,}/g;

// Matches common phone formats: +1-555-555-5555, 07911 123456, (555) 555-5555, etc.
// Requires at least 7 digits to avoid false positives on short numeric strings.
const PHONE_RE = /(?:\+?\d[\d\s\-.()]{6,}\d)/g;

const MAX_MESSAGE_LENGTH = 4000;

/**
 * Scrub obvious PII patterns (email, phone) from a buyer chat message, then
 * truncate to 4000 chars (the ClickHouse column / Zod schema limit).
 */
export function scrubMessagePii(text: string): string {
  return text
    .replace(EMAIL_RE, '[email]')
    .replace(PHONE_RE, '[phone]')
    .slice(0, MAX_MESSAGE_LENGTH);
}
