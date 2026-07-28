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
 *
 * FOLLOW-715 grace window: bumping this constant makes `POST
 * /api/v1/consent/platform-registration` refuse (`422 tos_version_superseded`,
 * FOLLOW-712) every caller still sending the OLD value — including the live
 * out-of-repo caller (app.estalara.com), which shares no release train with this
 * repo. `PLATFORM_REGISTRATION_TOS_VERSION_PREVIOUS` (an env var read directly in
 * `route.ts`, not re-exported here) lets an operator set the immediately-previous
 * value of this constant so the route accepts it for a bounded, EXPLICITLY-
 * CONFIGURED grace window instead of hard-refusing on the very next deploy. The
 * grace window is a migration ramp (accept + `warning`-level alert), never an
 * amnesty: anything OLDER than that one previous value is still refused
 * unconditionally, and the accepted record is written under the version the
 * caller actually attested, never coerced to this constant. Ordered bump
 * procedure, and the (deliberately manual, not time-based) window-closing
 * decision: `docs/runbooks/BRAND_PROVISIONING.md` §Step 3b.
 */
export const PLATFORM_REGISTRATION_TOS_VERSION = 'platform-v1.3-2026-06-21' as const;

/**
 * Intended to be the SHA-256 of the canonical English registration consent
 * disclosure, used as the default `consent_text_hash` when the caller does not
 * supply one (i.e. the caller displayed the canonical EN text). A caller that
 * displayed a translation MUST supply its own hash.
 *
 * ⚠️ THE CURRENT LITERAL IS NOT THAT DIGEST. It is a hand-typed placeholder
 * introduced with the endpoint (FOLLOW-374, `f810f72e`, 2026-06-21) and never
 * recomputed; it is the SHA-256 of no text at all (RETRO-227 §4a LG-1 hashed 60
 * normalisations of both candidate texts — zero matches). Re-pinning it is
 * **FOLLOW-704** (P0), deliberately NOT done here: FOLLOW-705 only rules WHICH
 * bytes it must be pinned to. Until FOLLOW-704 lands, this constant is not
 * evidence that any particular text was displayed, and the 422
 * `consent_text_hash_fabricated` refusal keyed on it (route.ts:495, :609) fires
 * only on a value no honest or dishonest caller can derive.
 *
 * CANONICAL BYTES (FOLLOW-705 ruling, recorded in PRIVACY_NOTICE_TEMPLATE.md
 * §6.1): the canonical text is the return value of
 * {@link renderPlatformConsentText} for the first-party identity
 * (`ESTALARA_BRAND_NAME` / `ESTALARA_LEGAL_ENTITY`) — the exact string the data
 * subject reads before clicking "I agree" and the string `GET` serves as
 * `consent_text` — NOT the markdown of the published doc. The hash is
 * lowercase-hex SHA-256 over that string's UTF-8 bytes with nothing appended:
 * no trailing `\n`, no `\r\n`, no trimming beyond what the renderer emits. The
 * doc's §6.1 block maps onto those bytes under the normalization spec'd in
 * §6.1.1 (steps N1–N8) and enforced by the `consent-text-sync` CI gate.
 *
 * To recompute (both commands verified 2026-07-28 to print the same value):
 *   node scripts/check-consent-text-sync.mjs --print-hash
 *   node scripts/check-consent-text-sync.mjs --print-text | sha256sum
 * The previous instruction here — `echo -n "<exact text>" | sha256sum` — was not
 * reproducible: it named neither the markdown stripping nor the hard-wrap
 * treatment, which is how the placeholder survived six weeks and four hardening
 * PRs unnoticed.
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
 * CANONICAL (FOLLOW-705): this function's return value is the byte-canonical
 * consent text — what the data subject actually reads and what is hashed into
 * `consent_records.consent_text_hash`. `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md`
 * §6.1 is the PUBLISHED RENDERING of these bytes for the first-party identity,
 * not an independent source: it is markdown (hard-wrapped, `**`-emphasised) and
 * exists only for Estalara, so it cannot be the hash input for a white-label
 * brand. Before FOLLOW-705 the two also differed in wording — the doc carried
 * unfilled slots `[agency DSR contact]` / `[agency privacy policy]` this
 * renderer has never emitted — while this comment asserted byte-alignment with
 * nothing enforcing it (RETRO-227).
 *
 * SYNC: `N(§6.1 block) === renderPlatformConsentText(estalaraIdentity)`, where N
 * is the normalization spec'd in PRIVACY_NOTICE_TEMPLATE.md §6.1.1 (N1–N8:
 * sentinel-delimited block, paragraph unwrap, `**` strip, no trailing newline).
 * Enforced on every push by `scripts/check-consent-text-sync.mjs` (CI job
 * `consent-text-sync`, hard gate) — editing this template without editing §6.1
 * (or the reverse) turns CI red. When the text changes: edit both, bump
 * {@link PLATFORM_REGISTRATION_TOS_VERSION} and both §6.1 sentinels if the
 * DISCLOSED MEANING changed (a data subject cannot be retro-bound to new text),
 * and re-pin {@link CANONICAL_CONSENT_TEXT_HASH} — all in the same PR.
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
