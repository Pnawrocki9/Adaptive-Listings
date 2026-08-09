/**
 * Consent-banner text document — the wire contract for ADR-0021 §D7.
 *
 * WHY THIS EXISTS. ESC-051 ruled that the consent-banner copy leaves the SDK bundle:
 * "consent text grows from regulation, not from engineering, and must never compete with
 * code for a performance budget." The strings are served as ONE identifier-free static
 * document from the control-plane origin and fetched before the banner renders
 * (ADR-0021 §D2), so a regulator-driven text change never costs SDK bytes again.
 *
 * This schema locks the document's SHAPE. It deliberately does NOT — and cannot — express
 * the countersign's byte-identity obligation on the DPIA §13.1/§13.2 mandated sentences;
 * that is `docs/compliance/consent-disclosures.canonical.json`, enforced by
 * `scripts/check-adr-0021-conditions.mjs` (FOLLOW-925). Two artefacts, two jobs.
 *
 * Locale-entry fields are derived FIELD-FOR-FIELD from the `COPY` constant that shipped in
 * `packages/sdk/src/ui/consent-banner.ts` before FOLLOW-915 — the state compliance signed on
 * 2026-06-12 and countersigned in PR #703. Adding a field here is a copy change, which is a
 * compliance change.
 *
 * Forward-compatibility (ADR-0021 §D7): unknown fields are IGNORED rather than rejected, so
 * the served document can gain keys before every deployed SDK understands them. A missing
 * required field or a wrong `schema_version` fails validation and the SDK fails CLOSED (§D4).
 */

import { z } from 'zod';

import { QuizLanguageSchema } from './quiz-config.js';

/** Structural guard. Bumped only by a breaking change to the locale-entry shape. */
export const CONSENT_TEXT_SCHEMA_VERSION = 1 as const;

/**
 * One locale's banner copy.
 *
 * `disclosure13_1` / `disclosure13_2` are DPIA-mandated disclosure sentences (§13.1
 * denial-log retention, §13.2 cross-session identifier). They are legally required text,
 * not product copy — see the canonical byte record referenced in the module docstring
 * before editing either one.
 */
export const ConsentTextLocaleSchema = z.object({
  /** Main banner sentence. */
  text: z.string().min(1),
  /** DPIA §13.1 — denial-logging audit retention. */
  disclosure13_1: z.string().min(1),
  /** DPIA §13.2 — cross-session pseudonymous identifier. */
  disclosure13_2: z.string().min(1),
  /** DPIA §13.4 / FOLLOW-373 — platform-wide consent umbrella (registered investors). */
  disclosurePlatform: z.string().min(1),
  /** Label of the privacy-policy link, shown only when the snippet sets `data-privacy-url`. */
  learnMore: z.string().min(1),
  /** Primary button label. */
  accept: z.string().min(1),
  /** Secondary button label. */
  decline: z.string().min(1),
});

export type ConsentTextLocale = z.infer<typeof ConsentTextLocaleSchema>;

/**
 * The served document.
 *
 * `locales` must carry every {@link QuizLanguageSchema} member, enforced by an explicit
 * refinement below — `z.record` with an enum key rejects unknown keys but does not require the
 * known ones. The SDK selects a locale with the existing level-2/3/4 chain (`data-language` →
 * `navigator.language` → `'en'`) and has no fallback of its own, so a document missing a locale
 * would fail closed for exactly the visitors who need it — a silent, jurisdiction-shaped
 * outage. The refinement turns that into a validation error at build time instead.
 */
export const ConsentTextDocumentSchema = z
  .object({
    schema_version: z.literal(CONSENT_TEXT_SCHEMA_VERSION),
    /** Bumped on every copy change; the audit trail for what text a visitor was shown. */
    text_version: z.string().min(1),
    locales: z.record(QuizLanguageSchema, ConsentTextLocaleSchema),
  })
  // `z.record` with an enum key REJECTS unknown keys but does NOT require every known one —
  // measured against zod 3.23, not assumed. Without this refinement a document carrying only
  // `en` validates, and the SDK then fails closed for pl/es visitors only: a silent outage
  // shaped like a jurisdiction. The locale set is read from QuizLanguageSchema rather than
  // repeated here (FOLLOW-273 — never restate the canonical language union).
  .superRefine((doc, ctx) => {
    for (const locale of QuizLanguageSchema.options) {
      if (doc.locales[locale] === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['locales', locale],
          message: `consent-text document is missing required locale '${locale}'`,
        });
      }
    }
  });

export type ConsentTextDocument = z.infer<typeof ConsentTextDocumentSchema>;
