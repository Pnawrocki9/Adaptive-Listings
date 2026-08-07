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
import { FIRST_PARTY_BRAND_IDENTITY } from '@/lib/brand-identity';

// ─── TOS / consent-text versioning ────────────────────────────────────────────

/**
 * TOS version string for the platform registration consent shown to investors.
 * Matches the version in docs/compliance/PRIVACY_NOTICE_TEMPLATE.md §6.1
 * (v1.4, 2026-08-07).
 * Update this constant when the consent text changes and a new DPO-reviewed
 * version is published.
 *
 * v1.3 → v1.4 (FOLLOW-815, discharging FOLLOW-704 / FOLLOW-710 / FOLLOW-711 under the
 * FOLLOW-814 CEO+DPO ruling of 2026-08-07): the DISCLOSED MEANING changed in exactly two
 * places, so this is a real re-consent boundary and not a formatting pass —
 *   1. the Art. 7(3) withdrawal channel became a concrete monitored mailbox
 *      (`compliance@estalara.com`) instead of the un-actionable "the agency's DSR contact";
 *   2. the closing contact paragraph now names Estalara / Time2Show, Inc. as the PROCESSOR
 *      operating the service for `${brandName}`, instead of presenting an Estalara mailbox as
 *      the client brand's own documentation contact.
 * Both ride this ONE bump by design (FOLLOW-711 depends_on: "must ride the SAME TOS bump — do
 * not spend two").
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
export const PLATFORM_REGISTRATION_TOS_VERSION = 'platform-v1.4-2026-08-07' as const;

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
 * SUBSTITUTED: the brand display name and legal entity only.
 *
 * NOT substituted, and DELIBERATELY so since FOLLOW-815 (FOLLOW-711 AC-1 option (b), ruled by
 * the CEO in FOLLOW-814 item 3): the `compliance@estalara.com` address, and the words
 * "Estalara (Time2Show, Inc.)" in the closing paragraph. That paragraph now names Estalara as
 * the PROCESSOR operating the service for `${brandName}` and identifies the mailbox as
 * Estalara's own. The rejected alternative was rendering a per-brand address from
 * `brand_config` with a fail-loud when unprovisioned; the CEO declined it explicitly
 * ("honesty plus zero work over a speculative per-brand affordance; revisit at the first
 * external brand"), so nothing here reads `brand_config` for a contact.
 *
 * Rule AH reconciliation (FOLLOW-711 AC-3): the previous version of this paragraph claimed the
 * address is "changed by ops per-brand if a brand runs its own inbox — same boundary as the DSR
 * sending domain in leg 3", while leg 3's own docblock says the opposite of ITS value
 * (`apps/control-plane/src/lib/email/resend.ts` — `SENDER_MAILBOX`: "FIXED infrastructure — the
 * actual sending domain is an ops concern and does NOT change per brand"). Neither value is
 * ops-changeable without a code edit. The two docblocks now state the same boundary, and it is
 * the true one: both strings are FIXED, first-party Estalara infrastructure, and the consent
 * text says so out loud rather than letting a white-label reader assume otherwise.
 *
 * ONE OPERATIONAL COMMITMENT RIDES THIS TEXT: `compliance@estalara.com` is disclosed to every
 * data subject as the channel for withdrawing consent under GDPR Art. 7(3). It must actually be
 * monitored. That is an operator obligation, not something this module can enforce.
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
 * (or the reverse) turns CI red. When the text changes: edit both, and bump
 * {@link PLATFORM_REGISTRATION_TOS_VERSION} and both §6.1 sentinels if the
 * DISCLOSED MEANING changed (a data subject cannot be retro-bound to new text) —
 * all in the same PR. {@link CANONICAL_CONSENT_TEXT_HASH} needs no action: since
 * FOLLOW-815 it is DERIVED from this function, so it follows the text
 * automatically. A meaning-changing edit is also a deploy-ordering operation —
 * `docs/runbooks/BRAND_PROVISIONING.md` §Step 3b (the `tos_version` grace window,
 * FOLLOW-715) is not optional reading before merging one.
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

2. Chat analysis and message storage — Your messages in the ${brandName} AI chat are analyzed in real time to understand your buying intent (e.g., budget, urgency, preferred location). We extract a structured summary of your intent, which we hold for 24 hours, and we also store the text of the messages themselves for 13 months. Email addresses and phone numbers are automatically masked before that text is stored; anything else you type — including names and financial or family details — is stored as you wrote it. Please do not type information into chat that you would not want stored.

3. Transfer to agency/agent — Your inferred buyer profile (archetype, buying-intent score) is shared with the real estate agency or agent you interact with on this platform.

4. Buying-intent identification — We build a 12-dimensional profile of your buying intent from your behavioral and chat signals. This profile is held for up to 24 hours in our personalization system.

5. Lead ranking — You may be ranked alongside other investors by buying-intent strength. Agents use this ranking to prioritize follow-up. This ranking is advisory — the agent retains full discretion.

6. Chat-question summaries — A summary of questions you have asked in LIVE chat and in the ${brandName} AI chat may be shown to the agency's staff to help them prepare for a conversation with you.

This consent is required to use the platform. Without granting it, you cannot create an account or access chat features.

Your rights: You can withdraw this consent at any time by emailing compliance@estalara.com, a monitored mailbox for privacy requests; you can also contact the agency directly. Withdrawal stops new personalization processing. A data erasure request will result in deletion of your behavioral data from ${brandName}'s systems within 30 days. Withdrawal does not affect the lawfulness of processing before withdrawal.

For full details, see the agency privacy policy. The Adaptive Listings technology described above is operated by Estalara (Time2Show, Inc.), which processes your data for ${brandName} as a processor; compliance@estalara.com is Estalara's address and reaches Estalara's privacy team.`;
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

// ─── Canonical hash — DERIVED, never asserted (FOLLOW-815 / FOLLOW-704) ───────

/**
 * SHA-256 of the canonical English registration consent disclosure for the FIRST-PARTY
 * (Estalara) identity — used as the default `consent_text_hash` when the caller omits one on a
 * tenant that renders that identity, and as the reference value the `422
 * consent_text_hash_fabricated` refusals key on. A caller that displayed a translation MUST
 * supply its own hash.
 *
 * DERIVED, NOT ASSERTED (FOLLOW-704 AC-1, chosen option; FOLLOW-714 amendment item 2). This is
 * literally `computeConsentTextHash(renderPlatformConsentText(FIRST_PARTY_BRAND_IDENTITY))` —
 * the same two functions the GET leg calls to serve `consent_text` / `consent_text_hash` and
 * the same pair the POST leg's evidence check uses. There is no second expression that could
 * drift from it.
 *
 * What it replaced, and why "derived" rather than a re-pinned literal: from 2026-06-21
 * (FOLLOW-374, `f810f72e`) to FOLLOW-815 this was a HAND-TYPED 64-hex literal that was the
 * SHA-256 of no text at all — RETRO-227 §4a LG-1 hashed 60 normalisations of both candidate
 * texts and got zero matches. A re-pinned literal would have re-created the same failure mode
 * one text-change later, because nothing mechanical would tie the new literal to the renderer
 * either; the assertion test in `route.test.ts` ("CANONICAL_CONSENT_TEXT_HASH is DERIVED from
 * the renderer") plus the `consent-text-sync` gate's structural check together make the
 * derivation itself the thing under test.
 *
 * CANONICAL BYTES (FOLLOW-705 ruling, upheld by FOLLOW-814 item 1, recorded in
 * PRIVACY_NOTICE_TEMPLATE.md §6.1): the canonical text is the return value of
 * {@link renderPlatformConsentText} for the first-party identity — the exact string the data
 * subject reads before clicking "I agree" and the string `GET` serves as `consent_text` — NOT
 * the markdown of the published doc. The hash is lowercase-hex SHA-256 over that string's UTF-8
 * bytes with nothing appended: no trailing `\n`, no `\r\n`, no trimming beyond what the renderer
 * emits. The doc's §6.1 block maps onto those bytes under the normalization spec'd in §6.1.1
 * (steps N1–N8) and enforced by the `consent-text-sync` CI gate.
 *
 * To recompute:
 *   node scripts/check-consent-text-sync.mjs --print-hash
 *   node scripts/check-consent-text-sync.mjs --print-text | sha256sum
 *
 * VERIFYING AN OLDER ROW — read this before trying to re-derive a stored
 * `consent_records.consent_text_hash` (FOLLOW-714 amendment item 2; the alternatives considered
 * were a `tos_version → hash` map and waiting for FOLLOW-703's snapshot columns). Because this
 * value is derived from the CURRENT text, it tracks {@link PLATFORM_REGISTRATION_TOS_VERSION}:
 * it is the canonical hash for THAT version and no other. To verify a row written under an
 * earlier version, check the repo out at a commit where `PLATFORM_REGISTRATION_TOS_VERSION`
 * equals that row's `tos_version` and run the `--print-hash` command above. Git is the version
 * store; no map is maintained here, because a map would have to carry an entry that is a lie:
 * for `platform-v1.3-2026-06-21` the value written on the default path was the placeholder
 * described above, i.e. the digest of no text, so no v1.3 default-path row is verifiable against
 * any text at all. Those rows are FOLLOW-706's remediation population, and this comment is the
 * statement FOLLOW-714 AC-3 asks for: rows written under v1.4 and later are verifiable by
 * checkout-and-recompute; v1.3 default-path rows are not verifiable and never were.
 */
export const CANONICAL_CONSENT_TEXT_HASH: string = computeConsentTextHash(
  renderPlatformConsentText(FIRST_PARTY_BRAND_IDENTITY),
);

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
   * When not supplied, the route defaults it to the hash of the text IT renders for the
   * tenant — CANONICAL_CONSENT_TEXT_HASH for a first-party/fallback identity, the brand's own
   * rendered hash for a provisioned one (FOLLOW-707). One exception, added by FOLLOW-815: on
   * the FOLLOW-715 grace band (a caller still attesting the PREVIOUS tos_version) there is no
   * honest default, so the column is written NULL rather than defaulted — see route.ts step 9.
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
