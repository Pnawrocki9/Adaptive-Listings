/**
 * Consent-banner text transport — ADR-0021 §D2/§D3/§D4, FOLLOW-915.
 *
 * ESC-051 ruled the banner copy out of the SDK bundle: **consent text grows from regulation,
 * not from engineering, and must never compete with code for a performance budget.** The
 * strings are served as one identifier-free static document and fetched before the banner
 * renders, so the next regulator-driven text change costs zero SDK bytes.
 *
 * ORDERING (§D2). The fetch runs only on the `pending` path — a returning visitor whose
 * consent is already `granted` or `denied` pays no extra request. It MUST be awaited before
 * the banner renders. Everything that could profile is sequenced behind it, so a slow fetch
 * delays the banner and the product equally, never the banner alone.
 *
 * WHY THIS IS LAWFUL PRE-CONSENT (§D3, compliance-countersigned 2026-08-09). The request
 * carries no tenant id, no api key, no session or visitor id, no query string and no
 * credentials, and its URL is byte-identical for every tenant and every visitor. Delivering
 * the consent mechanism itself is the paradigm ePrivacy Art. 5(3) strictly-necessary case — a
 * notice whose display required consent would be circular. **That analysis collapses the
 * moment the request carries any identifier**, which is why the shape below is asserted
 * byte-exactly by `scripts/check-adr-0021-conditions.mjs` and why §D3 requires a new ADR plus
 * compliance review before anyone parameterizes it.
 *
 * FAIL-CLOSED (§D4). On network error, non-2xx, timeout or validation failure this returns
 * `null` and the caller halts the page view: no banner, zero events, zero storage writes,
 * consent stays `pending` and is retried on the next page load. **No fallback text ships in
 * the bundle** — a trimmed fallback is exactly the ESC-051 defect (disclosure content degraded
 * by an engineering constraint), and consent obtained on an incomplete disclosure is not
 * "informed" under GDPR Art. 4(11)/Art. 7, which would invalidate everything downstream. The
 * failure mode of a consent surface must be LESS processing, never more.
 */

import {
  CONSENT_TEXT_URL,
  ConsentTextDocumentSchema,
  type ConsentTextLocale,
  type QuizLanguage,
} from '@estalara/shared';

/**
 * §D4 budget. Beyond this the fetch is abandoned and the page view fails closed.
 *
 * Module-local by Rule I: nothing outside this file consumes it, and an exported constant with
 * no non-test importer is dead surface. The 3000 ms figure is asserted by the AC(2) hang case.
 */
const CONSENT_TEXT_TIMEOUT_MS = 3000;

/**
 * Fetch and validate the consent-banner copy for one locale.
 *
 * @param language - locale chosen by the existing level-2/3/4 chain (`data-language` →
 *   `navigator.language` → `'en'`). Selection is client-side by contract: the document ships
 *   every locale so the URL cannot leak one (§D3).
 * @returns the locale's copy, or `null` for EVERY failure mode — the caller must fail closed.
 */
export async function fetchConsentText(language: QuizLanguage): Promise<ConsentTextLocale | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, CONSENT_TEXT_TIMEOUT_MS);

  try {
    // §D3 request shape — no headers, no credentials, no query string, no interpolation.
    const response = await fetch(CONSENT_TEXT_URL, {
      method: 'GET',
      credentials: 'omit',
      mode: 'cors',
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const parsed = ConsentTextDocumentSchema.safeParse(await response.json());
    if (!parsed.success) return null;

    return parsed.data.locales[language] ?? null;
  } catch {
    // Network error, abort, or malformed JSON — all one outcome by design (§D4).
    return null;
  } finally {
    clearTimeout(timer);
  }
}
