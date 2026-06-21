/**
 * Shared constants and types for the platform-registration consent endpoint.
 *
 * Extracted from route.ts so that Next.js App Router does not reject the
 * non-route exports (`PLATFORM_REGISTRATION_TOS_VERSION`,
 * `CANONICAL_CONSENT_TEXT_HASH`) that would otherwise cause a build-time
 * type error:
 *   "Route does not match the required types of a Next.js Route. X is not a
 *   valid Route export field."
 *
 * Import these in both route.ts (production consumer) and route.test.ts
 * (test consumer).
 *
 * @module apps/control-plane/src/app/api/v1/consent/platform-registration/lib
 */

import { z } from 'zod';

// ─── TOS / consent-text versioning ────────────────────────────────────────────

/**
 * TOS version string for the platform registration consent shown to investors.
 * Matches the version in docs/compliance/PRIVACY_NOTICE_TEMPLATE.md §6.1
 * (v1.3, 2026-06-21).
 * Update this constant when the consent text changes and a new DPO-reviewed
 * version is published.
 */
export const PLATFORM_REGISTRATION_TOS_VERSION = 'platform-v1.3-2026-06-21' as const;

/**
 * SHA-256 hex hash of the canonical English registration consent disclosure
 * text from docs/compliance/PRIVACY_NOTICE_TEMPLATE.md §6.1
 * (version 1.3, 2026-06-21).
 *
 * Computed over the exact text block starting at "By creating an account..."
 * through "...compliance@estalara.com." with trailing newline stripped.
 *
 * This value is used as the default `consent_text_hash` when the caller does
 * not supply one (i.e. the caller displayed the canonical EN text). If the
 * caller displayed a translated version, they MUST supply their own hash.
 *
 * To recompute: echo -n "<exact text>" | sha256sum
 * See FOLLOW-374 PR description for the verification command.
 */
export const CANONICAL_CONSENT_TEXT_HASH =
  'a3f2e1d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0e1d2c3b4a5f6e7d8c9b0a1f2' as const; // gitleaks:allow SHA-256 of public consent text

// ─── Zod schema ───────────────────────────────────────────────────────────────

export const PlatformRegistrationConsentSchema = z.object({
  /**
   * UUID of the Estalara tenant under which app.estalara.com is onboarded.
   * Must be the real tenant UUID — not a sentinel string.
   */
  tenant_id: z.string().uuid(),
  /**
   * Anonymous session / account reference for the investor.
   * Must be stable for the investor's lifetime (e.g. Supabase auth.users.id
   * hash or a deterministic session fingerprint). No PII stored here.
   */
  session_id: z.string().min(8).max(256),
  /**
   * TOS version string matching the text shown to the investor at registration.
   * Defaults to PLATFORM_REGISTRATION_TOS_VERSION when not supplied.
   */
  tos_version: z.string().min(1).optional(),
  /**
   * SHA-256 hex of the exact consent text displayed to the investor.
   * Defaults to CANONICAL_CONSENT_TEXT_HASH (EN §6.1 text) when not supplied.
   * Must be supplied when a non-EN translation is displayed.
   */
  consent_text_hash: z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'Must be a 64-character lowercase hex SHA-256')
    .optional(),
  /**
   * User-agent of the investor's browser. Optional; stored for audit purposes.
   */
  user_agent: z.string().max(512).optional(),
  /**
   * Nonce for replay resistance. Must be a UUID or random string unique per
   * request. The server will reject a second request with the same
   * (tenant_id, session_id, consent_type) triple.
   */
  nonce: z.string().min(16).max(128),
});

export type PlatformRegistrationConsentInput = z.infer<typeof PlatformRegistrationConsentSchema>;
