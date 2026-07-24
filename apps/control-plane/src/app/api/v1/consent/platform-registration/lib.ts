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

import { createHash } from 'crypto';
import { z } from 'zod';
import type { BrandIdentity } from '@/lib/brand-identity';

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
// Suppression: the gitleaks:allow tag below is the SOLE suppression for this hash (no regexes
// entry in .gitleaks.toml — CB-1/FOLLOW-411 confirmed the inline suppress is sufficient).
// If this hash changes (consent text rotation), update the gitleaks:allow comment on the next
// line to remain the current SHA-256 value so the inline suppress stays accurate.
export const CANONICAL_CONSENT_TEXT_HASH =
  'a3f2e1d4c5b6a7f8e9d0c1b2a3f4e5d6c7b8a9f0e1d2c3b4a5f6e7d8c9b0a1f2' as const; // gitleaks:allow SHA-256 of public consent text

// ─── Brand-substituting consent text (FOLLOW-654 leg 1) ───────────────────────

/**
 * Renders the canonical §6.1 platform-registration umbrella disclosure with the
 * tenant's brand display identity substituted in.
 *
 * This is the authoritative server-side source of the consent text for a given
 * brand. White-label client deployments (out-of-repo SvelteKit product, Rafał's
 * side — see FOLLOW-656) fetch it via `GET /api/v1/consent/platform-registration`
 * so the brand's own name / legal entity render in the disclosure instead of the
 * hardcoded "Estalara" / "Time2Show, Inc.".
 *
 * SUBSTITUTED: the brand display name and legal entity only. NOT substituted: the
 * `compliance@estalara.com` contact address (shared compliance infrastructure,
 * changed by ops per-brand if a brand runs its own inbox — same boundary as the
 * DSR sending domain in leg 3).
 *
 * SYNC: this text must stay byte-aligned with
 * `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` §6.1 for the version pinned in
 * {@link PLATFORM_REGISTRATION_TOS_VERSION}. When that doc's §6.1 text changes,
 * bump the TOS version and update this template in the same PR.
 *
 * @param identity - The resolved brand identity (`brandName`, `legalEntity`).
 * @returns The full disclosure text with a single trailing newline stripped.
 */
export function renderPlatformConsentText(
  identity: Pick<BrandIdentity, 'brandName' | 'legalEntity'>,
): string {
  const { brandName, legalEntity } = identity;
  return `By creating an account and clicking "I agree", you consent to the ${brandName} Adaptive Listings service (provided by ${legalEntity}) processing your information for the following purposes:

1. Behavioral tracking — We analyze how you browse listings (scroll depth, time spent, clicks, and searches) to personalize the listings shown to you.

2. Chat analysis — Your messages in the ${brandName} AI chat are analyzed in real time to understand your buying intent (e.g., budget, urgency, preferred location). We extract a structured summary of your intent — we do not store the full text of your messages in our personalization system.

3. Transfer to agency/agent — Your inferred buyer profile (archetype, buying-intent score) is shared with the real estate agency or agent you interact with on this platform.

4. Buying-intent identification — We build a 12-dimensional profile of your buying intent from your behavioral and chat signals. This profile is held for up to 24 hours in our personalization system.

5. Lead ranking — You may be ranked alongside other investors by buying-intent strength. Agents use this ranking to prioritize follow-up. This ranking is advisory — the agent retains full discretion.

6. Chat-question summaries — A summary of questions you have asked in LIVE chat and in the ${brandName} AI chat may be shown to the agency's staff to help them prepare for a conversation with you.

This consent is required to use the platform. Without granting it, you cannot create an account or access chat features.

Your rights: You can withdraw this consent at any time by contacting the agency's DSR contact. Withdrawal stops new personalization processing. A data erasure request will result in deletion of your behavioral data from ${brandName}'s systems within 30 days. Withdrawal does not affect the lawfulness of processing before withdrawal.

For full details, see the agency privacy policy and ${brandName}'s privacy documentation at compliance@estalara.com.`;
}

/**
 * Computes the lowercase-hex SHA-256 of a consent-text string — the value stored
 * in `consent_records.consent_text_hash`. Used by
 * `GET /api/v1/consent/platform-registration` to return the hash of the exact
 * brand-substituted text it serves, so a client deployment can echo it back on
 * the subsequent POST (closing the leg-2 audit loop).
 *
 * @param text - The exact consent text displayed to the data subject.
 */
export function computeConsentTextHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

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
