/**
 * Listing-details fetch helper — retrieves a listing's ORIGINAL agent-authored
 * description from the Estalara backend (ESC-018 / ADR-0009).
 *
 * There is no `listings` table in our Postgres — listing content lives on the
 * tenant's site and is served by the existing Estalara backend listing-details
 * API. This mirrors exactly what the local mock decision harness does
 * (`scripts/dev/mock-decision-server.mjs` → `fetchListing`), so the production
 * description pipeline grounds generation in the same source the demo proves out.
 *
 * Endpoint (from `ESTALARA_BACKEND_URL`, default dev `http://localhost:8081`):
 *   - UUID listing id → `GET /api/v1/listing/details?listing-uuid={id}&locale={LOC}`
 *   - anything else (slug) → `GET /api/v1/listing/details/slug?slug={id}&locale={LOC}`
 *
 * Fail-open: returns '' on any error (missing env, network failure, non-2xx,
 * malformed JSON, missing description field) and is bounded by a short timeout so
 * it never blocks the cache-miss response path. The Modal consumer accepts an
 * empty `original_description` (the v1.8 prompt has a thin-original exception); it
 * only drops messages where the key is entirely absent.
 *
 * SSRF note: the base URL comes from our own trusted `ESTALARA_BACKEND_URL` env,
 * and `listingId` is URL-encoded into a query-string value (it cannot alter the
 * host), so this is not a user-controlled-host fetch. We deliberately do NOT run
 * `checkSsrf` here — it would reject the loopback backend used in local dev.
 *
 * @module apps/control-plane/src/lib/listing-details
 */

/** Matches a canonical UUID (same shape as the mock harness `_UUID_RE`). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Default backend URL for local dev — mirrors the mock harness `BACKEND_URL`. */
const DEFAULT_BACKEND_URL = 'http://localhost:8081';

/** Max time to wait for the listing-details fetch before failing open. */
const FETCH_TIMEOUT_MS = 2000;

/**
 * Fetch the original description text for a listing from the Estalara backend.
 *
 * @param listingId - The tenant's listing identifier (UUID or slug).
 * @param locale    - Description locale ('en' | 'pl' | 'es'); upper-cased for the
 *                    backend `locale` query param (e.g. 'EN').
 * @returns The listing's `description` string, or '' when unavailable (fail-open).
 */
export async function fetchListingOriginalDescription(
  listingId: string,
  locale: string,
): Promise<string> {
  const base = (process.env.ESTALARA_BACKEND_URL ?? DEFAULT_BACKEND_URL).replace(/\/$/, '');
  const loc = encodeURIComponent(locale.toUpperCase());
  const id = encodeURIComponent(listingId);
  const url = UUID_RE.test(listingId)
    ? `${base}/api/v1/listing/details?listing-uuid=${id}&locale=${loc}`
    : `${base}/api/v1/listing/details/slug?slug=${id}&locale=${loc}`;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return '';
    const listing = (await res.json()) as unknown;
    if (
      typeof listing === 'object' &&
      listing !== null &&
      typeof (listing as Record<string, unknown>).description === 'string'
    ) {
      return (listing as Record<string, unknown>).description as string;
    }
    return '';
  } catch (err: unknown) {
    // Fail-open: grounding is best-effort. An empty original still produces a
    // (thinner) generation rather than dropping the job at consumer validation.
    console.error(
      '[listing-details] fetch failed (returning empty original_description):',
      err instanceof Error ? err.message : err,
    );
    return '';
  } finally {
    clearTimeout(timer);
  }
}
