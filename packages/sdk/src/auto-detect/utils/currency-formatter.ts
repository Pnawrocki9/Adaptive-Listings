/**
 * Currency formatter for adaptation directives.
 *
 * Formats parsed price values for display in UI adaptation directives.
 *
 * Sprint 8 will add real exchange rates and buyer-locale formatting; for now,
 * this module returns the price formatted in the detected currency using the
 * standard `Intl.NumberFormat` API.
 *
 * @module @estalara/sdk/auto-detect/utils/currency-formatter
 */

/** Fallback locale to use when none is specified. */
const DEFAULT_LOCALE = 'en-GB';

/**
 * Format a parsed price value for display.
 *
 * - When `value` is `'POA'`, returns the string `'Price on request'` regardless
 *   of locale. (Sprint 8 TODO: localise this string per buyer locale.)
 * - When `currency` is empty or unrecognised, formats `value` as a plain
 *   number without a currency symbol.
 * - Uses `Intl.NumberFormat` for locale-aware digit grouping and decimal
 *   placement. Falls back to a simple `toLocaleString` if the currency code
 *   is not a valid ISO 4217 code.
 *
 * @param value    - Numeric price or the literal `'POA'`.
 * @param currency - ISO 4217 currency code (e.g. `'EUR'`, `'GBP'`, `'AED'`).
 *                   Pass an empty string when the currency is unknown.
 * @param locale   - BCP 47 locale tag for formatting (e.g. `'en-GB'`, `'pl-PL'`).
 *                   Defaults to `'en-GB'`.
 * @returns A formatted price string suitable for display.
 *
 * @example
 * formatPrice(335000, 'EUR')          // '€335,000'
 * formatPrice(6800000, 'AED', 'ar-AE') // 'AED 6,800,000'
 * formatPrice('POA', '')              // 'Price on request'
 * formatPrice(128000000, 'USD', 'en-US') // '$128,000,000'
 */
export function formatPrice(value: number | 'POA', currency: string, locale?: string): string {
  if (value === 'POA') {
    return 'Price on request';
  }

  const resolvedLocale = locale ?? DEFAULT_LOCALE;

  if (!currency) {
    // No currency code — format as a plain integer.
    try {
      return new Intl.NumberFormat(resolvedLocale, {
        maximumFractionDigits: 0,
      }).format(value);
    } catch {
      return value.toLocaleString(resolvedLocale);
    }
  }

  try {
    return new Intl.NumberFormat(resolvedLocale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    // Fallback for unrecognised currency codes: prefix the code manually.
    try {
      const formatted = new Intl.NumberFormat(resolvedLocale, {
        maximumFractionDigits: 0,
      }).format(value);
      return `${currency} ${formatted}`;
    } catch {
      return `${currency} ${value.toString()}`;
    }
  }
}
