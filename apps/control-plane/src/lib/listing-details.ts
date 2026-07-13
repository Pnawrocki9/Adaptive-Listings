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
 * Fetch the raw listing-details JSON object from the Estalara backend.
 *
 * Shared by {@link fetchListingOriginalDescription} (grounding) and
 * {@link fetchListingTextFields} (FOLLOW-567 embed self-fetch). Fail-open:
 * returns `null` on missing env, redirect (frontend/auth-gate misconfiguration),
 * non-2xx, timeout, or malformed JSON — callers decide their own empty default.
 *
 * @param listingId - The tenant's listing identifier (UUID or slug).
 * @param locale    - Locale ('en' | 'pl' | 'es'); upper-cased for the backend
 *                    `locale` query param (e.g. 'EN').
 */
async function fetchListingJson(
  listingId: string,
  locale: string,
): Promise<Record<string, unknown> | null> {
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
    const res = await fetch(url, { signal: controller.signal, redirect: 'manual' });
    // A redirect (3xx) means ESTALARA_BACKEND_URL points at a frontend proxy, not the
    // raw backend — the request hit an auth gate. Fail loud so misconfiguration is
    // visible in Sentry / Vercel logs rather than silently producing ungrounded copy.
    if (res.status >= 300 && res.status < 400) {
      console.error(
        '[listing-details] redirect received — ESTALARA_BACKEND_URL likely points at frontend, not backend:',
        res.status,
        url,
      );
      return null;
    }
    if (!res.ok) return null;
    const listing = (await res.json()) as unknown;
    if (typeof listing === 'object' && listing !== null) {
      return listing as Record<string, unknown>;
    }
    return null;
  } catch (err: unknown) {
    // Fail-open: the fetch is best-effort. Callers substitute their own empty default.
    console.error('[listing-details] fetch failed:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the original description text for a listing from the Estalara backend.
 *
 * @param listingId - The tenant's listing identifier (UUID or slug).
 * @param locale    - Description locale ('en' | 'pl' | 'es').
 * @returns The listing's `description` string, or '' when unavailable (fail-open).
 */
export async function fetchListingOriginalDescription(
  listingId: string,
  locale: string,
): Promise<string> {
  const listing = await fetchListingJson(listingId, locale);
  if (listing && typeof listing.description === 'string') {
    return listing.description;
  }
  return '';
}

/** Text fields used to build a listing's embedding (see /api/listings/embed). */
export interface ListingTextFields {
  title?: string;
  description?: string;
  price?: string;
  location?: string;
}

/**
 * FOLLOW-567: fetch a listing's embed text fields from the Estalara backend, for
 * the Modal embed-seed path that sends only `{ tenant_id, listing_id }` (no
 * text_fields). Maps the backend listing shape to the embed endpoint's
 * `{ title, description, price, location }` contract.
 *
 * Fail-open: returns `null` when the listing cannot be fetched; the caller then
 * returns a 400 (nothing to embed) rather than upserting an empty vector.
 *
 * @param listingId - The tenant's listing identifier (UUID or slug).
 * @param locale    - Locale ('en' | 'pl' | 'es'); default 'en' at the call site.
 * @returns Non-empty `{ title?, description?, price?, location? }`, or `null`.
 */
export async function fetchListingTextFields(
  listingId: string,
  locale: string,
): Promise<ListingTextFields | null> {
  const listing = await fetchListingJson(listingId, locale);
  if (!listing) return null;

  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim().length > 0 ? v : undefined;
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined;

  const fields: ListingTextFields = {};

  const title = str(listing.headline);
  if (title) fields.title = title;

  const description = str(listing.description);
  if (description) fields.description = description;

  const priceNum = num(listing.price);
  if (priceNum !== undefined) {
    const currency = str(listing.currency);
    fields.price = currency ? `${String(priceNum)} ${currency}` : String(priceNum);
  }

  const location = [str(listing.streetAddress), str(listing.city), str(listing.region)]
    .filter((s): s is string => Boolean(s))
    .join(', ');
  if (location) fields.location = location;

  // Nothing usable on the listing → treat as a fetch miss so the caller 400s.
  return Object.keys(fields).length > 0 ? fields : null;
}
