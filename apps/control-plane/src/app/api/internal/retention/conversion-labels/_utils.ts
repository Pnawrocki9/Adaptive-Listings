/**
 * Utility helpers for the conversion_labels retention cron.
 *
 * Extracted from route.ts so Next.js App Router does not encounter unexpected
 * exports in the route segment (which would violate the `OmitWithTag` type gate
 * that Next.js generates for every route file).
 *
 * @module apps/control-plane/src/app/api/internal/retention/conversion-labels/_utils
 */

/**
 * Returns the cutoff Date: exactly 13 months before `now`.
 *
 * Uses calendar-month arithmetic (not a fixed millisecond constant) so the
 * boundary tracks leap-year and DST edge cases correctly.
 *
 * Exported for test assertions.
 */
export function thirteenMonthsAgo(now: Date = new Date()): Date {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - 13);
  return cutoff;
}
