/**
 * Zod schemas for tenant compliance records.
 *
 * `LiaRecordSchema` — validates the payload for creating a Legitimate Interest
 * Assessment (LIA) record. GDPR Art. 6(1)(f) requires a three-part test:
 *   1. Purpose test (purpose_statement)
 *   2. Necessity test (necessity_justification)
 *   3. Balancing test (balancing_conclusion)
 *
 * Used by:
 *   - POST /api/tenants/:id/lia (apps/control-plane)
 *   - PATCH /api/tenants/:id/lia/:recordId (apps/control-plane)
 *   - Frontend LIA wizard form validation (apps/control-plane dashboard)
 *
 * TICKET-GDPR-003
 *
 * @module @estalara/shared/schemas/tenant-compliance
 */

import { z } from 'zod';

/**
 * Schema for creating a Legitimate Interest Assessment (LIA) record.
 *
 * All text fields have minimum length requirements that enforce meaningful
 * compliance documentation (not token checkbox answers). purpose_statement and
 * necessity_justification require at least 50 characters to deter placeholder text.
 *
 * @example
 * {
 *   purpose_statement: "We process visitor behavioral data to adapt property listings to buyer intent...",
 *   necessity_justification: "Behavioral data is essential to distinguish between investor and family buyer intent...",
 *   balancing_conclusion: "Our interest in serving relevant listings outweighs minimal privacy impact...",
 *   optout_mechanism: "Users may opt out via the consent banner on every page.",
 *   signed_by_name: "Piotr Nawrocki",
 *   signed_by_email: "piotr@agency.com",
 *   signed_at: "2026-05-15T12:00:00.000Z"
 * }
 */
export const LiaRecordSchema = z.object({
  /**
   * Description of the legitimate interest being pursued.
   * Minimum 50 characters — must articulate a genuine business interest,
   * not just "analytics" or similar vague terms.
   */
  purpose_statement: z
    .string()
    .min(50, 'purpose_statement must be at least 50 characters to satisfy the purpose test'),

  /**
   * Justification for why processing is necessary to achieve the stated purpose.
   * Minimum 50 characters — must explain why less privacy-intrusive means cannot
   * achieve the same result.
   */
  necessity_justification: z
    .string()
    .min(
      50,
      'necessity_justification must be at least 50 characters to satisfy the necessity test',
    ),

  /**
   * Conclusion of the balancing test weighing the legitimate interest against
   * the fundamental rights and freedoms of data subjects.
   */
  balancing_conclusion: z.string().min(1, 'balancing_conclusion is required'),

  /**
   * Description of the opt-out / objection mechanism made available to data subjects
   * under GDPR Art. 21.
   */
  optout_mechanism: z.string().min(1, 'optout_mechanism is required'),

  /** Full legal name of the person who signed/executed this assessment. */
  signed_by_name: z.string().min(1, 'signed_by_name is required'),

  /** Email address of the signatory. Used for audit trail and confirmation emails. */
  signed_by_email: z.string().email('signed_by_email must be a valid email address'),

  /**
   * ISO 8601 datetime string of when the signatory executed this assessment.
   * Stored as timestamptz in Postgres.
   *
   * @example "2026-05-15T12:00:00.000Z"
   */
  signed_at: z.string().datetime({ message: 'signed_at must be a valid ISO 8601 datetime string' }),
});

/** Inferred TypeScript type for a validated LIA creation payload. */
export type LiaRecord = z.infer<typeof LiaRecordSchema>;
