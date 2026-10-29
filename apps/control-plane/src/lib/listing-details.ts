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
 * host), so this is not a user-controlled-host fetch. No SSRF guard on this fetch today (the
 * unused `lib/ssrf.ts` was removed by FOLLOW-1328); FOLLOW-1309 (plan Phase 6 S3) adds
 * private-IP / redirect-to-private / DNS-rebind protection here.
 *
 * @module apps/control-plane/src/lib/listing-details
 */

import * as Sentry from '@sentry/nextjs';

/** Matches a canonical UUID (same shape as the mock harness `_UUID_RE`). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Default backend URL for local dev — mirrors the mock harness `BACKEND_URL`. */
const DEFAULT_BACKEND_URL = 'http://localhost:8081';

/** Max time to wait for the listing-details fetch before failing open. */
const FETCH_TIMEOUT_MS = 2000;

/**
 * Tighter budget for {@link fetchListingPlaceholderFacts} (FOLLOW-1140).
 *
 * The other two callers sit on an LLM branch, where a 2 s upstream is a rounding error next to
 * the model call. Placeholder resolution also runs on the playbook-DIRECT branch, which does no
 * LLM call at all and is the fastest path the route has — so it gets a budget of its own rather
 * than inheriting one sized for a different branch. Exceeding it is not a failure mode with a
 * fabricated escape: a timeout resolves no token, and an unresolved token discards the
 * directive exactly as a 404 would.
 */
const PLACEHOLDER_FACTS_TIMEOUT_MS = 800;

/**
 * Fetch the raw listing-details JSON object from the Estalara backend.
 *
 * Shared by {@link fetchListingTextFields} (FOLLOW-567 embed self-fetch, and the grounding of
 * `/api/adapt` and — since FOLLOW-1314 — `/api/adapt/description`) and
 * {@link fetchListingPlaceholderFacts} (FOLLOW-1140 token resolution). Fail-open:
 * returns `null` on missing env, redirect (frontend/auth-gate misconfiguration),
 * non-2xx, timeout, or malformed JSON — callers decide their own empty default.
 *
 * @param listingId - The tenant's listing identifier (UUID or slug).
 * @param locale    - Locale ('en' | 'pl' | 'es'); upper-cased for the backend
 *                    `locale` query param (e.g. 'EN').
 * @param timeoutMs - Abort budget; defaults to {@link FETCH_TIMEOUT_MS}.
 */
async function fetchListingJson(
  listingId: string,
  locale: string,
  timeoutMs: number = FETCH_TIMEOUT_MS,
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
  }, timeoutMs);

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
    if (!res.ok) {
      // FOLLOW-1120: this exit used to be the only one of the three that reached `null` saying
      // NOTHING — no log, no capture, no counter. A non-OK from the listing backend therefore
      // produced ungrounded prompts with zero observability, and the symptom surfaced one layer
      // away as `playbook_fallback_llm_unavailable`, which names the LLM stack rather than this
      // fetch. The production measurement of that signature — the bimodal `tokens_in` and the
      // absent log line — is registered as [MP-017]; it is a live-environment claim with an owner
      // and an expiry, so it is not restated here. Loud now, and as loud as its two siblings.
      console.error(
        '[listing-details] non-OK response — grounding context will be empty:',
        res.status,
        url,
      );
      Sentry.captureException(
        new Error(`[listing-details] non-OK response: ${String(res.status)}`),
        {
          tags: { area: 'listing-details', kind: 'upstream_non_ok' },
          extra: { status: res.status, url },
        },
      );
      return null;
    }
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

/** Text fields used to build a listing's embedding (see /api/listings/embed). */
export interface ListingTextFields {
  title?: string;
  description?: string;
  price?: string;
  location?: string;
}

/** A non-empty, non-blank string, or undefined. */
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim().length > 0 ? v : undefined;

/** A finite number, or undefined. A price served as a STRING is deliberately not accepted here:
 * normalising `"$385,000"` would be this layer parsing a fact, and parsing guesses. */
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/**
 * The listing's price as ONE string carrying its unit (FOLLOW-1317).
 *
 * The backend's public detail DTO (`ListingResponseTO.kt:81-91`) carries FOUR price fields, and
 * any of them can be null on a real listing:
 *
 *   - `price` + `currency` — what the agent entered, in the listing's own currency. The source of
 *     truth (`PropertyDetailsEntity.kt:73-77`). `currency` can be null while `price` is not
 *     (scraped drafts — the backend documents that on `SimpleListingResponseTO.kt:17-22`).
 *   - `priceEur` / `priceUsd` — columns DERIVED from the pair by an FX job, kept for cross-currency
 *     sorting. Second-hand, but each carries its unit in its own name.
 *
 * Order of preference, fixed so the same listing always grounds the same figure (a price that
 * varied between runs would make a measurement series unreadable):
 *
 *   1. `price` + `currency` — the entered figure, with the unit the agent chose.
 *   2. `priceEur`, then 3. `priceUsd` — a derived figure, but one whose unit is known.
 *   4. `price` alone — the entered figure with NO unit. Last resort, kept because it is still the
 *      listing's own fact and dropping it would ground less than before FOLLOW-1317; a bare number
 *      is the weakest of the four, since the model is told to copy figures and units verbatim and
 *      there is no unit to copy.
 *
 * Returns undefined when the listing states no price at all. Nothing substitutes one: no FX
 * conversion of our own, no price-per-m² multiplied out, no "price on request" label. An absent
 * price means the prompt gets no `listing_price` line and the fact checker has no price to
 * validate — which is the whole point (ESC-076 / §E.7.0: a figure not on the listing does not
 * exist).
 */
function readPriceLabel(listing: Record<string, unknown>): string | undefined {
  const entered = num(listing.price);
  const currency = str(listing.currency);
  if (entered !== undefined && currency !== undefined) return `${String(entered)} ${currency}`;

  const eur = num(listing.priceEur);
  if (eur !== undefined) return `${String(eur)} EUR`;
  const usd = num(listing.priceUsd);
  if (usd !== undefined) return `${String(usd)} USD`;

  return entered !== undefined ? String(entered) : undefined;
}

/**
 * The listing's location, most specific part first (FOLLOW-1317).
 *
 * `publicLocationLabel` is the FIRST choice for the same reason
 * {@link fetchListingPlaceholderFacts} already gives below: the backend gates address precision
 * behind `locationDisclosureLevel` and this label is the value it has already decided is safe to
 * show. It is also where the street lives when the listing discloses one: production answers e.g.
 * `"1512 N 42ND Street, Fort Pierce, FL 34947"` there. The pre-FOLLOW-1317 reader looked for a
 * `streetAddress` field instead, which neither the DTO (`ListingResponseTO.kt:36-59`) nor the
 * production API has, so the street never reached the prompt. The street name itself
 * (`streetName`) is never on the public DTO; a listing whose label carries no street grounds
 * none, and nothing here reconstructs one.
 *
 * `district` is included because without it the label degrades to "city, region" — the symptom
 * FOLLOW-1317 was filed for, where every generated description could place the property no more
 * precisely than its city.
 *
 * A part the assembled label already contains as a whole word sequence is skipped: production's
 * `publicLocationLabel` usually already reads "District, City, Region", and "Palm Coast, FL, Palm
 * Coast, FL" in the prompt is a fact repeated, which the model is entitled to read as two places.
 * Whole words only, so a city "Lodz" is not dropped because the label names a "Lodzka" street.
 */
function readLocationLabel(listing: Record<string, unknown>): string | undefined {
  const candidates = [
    str(listing.publicLocationLabel),
    str(listing.district),
    str(listing.city),
    str(listing.region),
  ];

  const parts: string[] = [];
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    if (containsWholeWords(parts.join(', '), candidate.trim())) continue;
    parts.push(candidate.trim());
  }

  return parts.length > 0 ? parts.join(', ') : undefined;
}

/** True when `needle` occurs in `haystack` case-insensitively, bounded by non-letters/digits. */
function containsWholeWords(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(haystack);
}

/**
 * FOLLOW-567: fetch a listing's embed text fields from the Estalara backend, for
 * the Modal embed-seed path that sends only `{ tenant_id, listing_id }` (no
 * text_fields). Maps the backend listing shape to the embed endpoint's
 * `{ title, description, price, location }` contract.
 *
 * Since FOLLOW-1022 / FOLLOW-1314 this is ALSO the grounding source for `/api/adapt` and
 * `/api/adapt/description`, so what it fails to map is a fact the model is forbidden to state and
 * the fact checker cannot validate. FOLLOW-1317: the price and the location are therefore read
 * through {@link readPriceLabel} and {@link readLocationLabel}, which accept every shape the
 * backend's public detail DTO can answer with rather than one of them.
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

  const fields: ListingTextFields = {};

  const title = str(listing.headline);
  if (title) fields.title = title;

  const description = str(listing.description);
  if (description) fields.description = description;

  const price = readPriceLabel(listing);
  if (price !== undefined) fields.price = price;

  const location = readLocationLabel(listing);
  if (location !== undefined) fields.location = location;

  // Nothing usable on the listing → treat as a fetch miss so the caller 400s.
  return Object.keys(fields).length > 0 ? fields : null;
}

/**
 * The listing fields `POST /api/adapt` reads to fill playbook `{token}` placeholders
 * (FOLLOW-1140 / ESC-074 (b)).
 *
 * Deliberately NOT the same shape as {@link ListingTextFields}: that one is prose for an
 * embedding, this one is the structured facts a template substitutes. Every key here maps 1:1
 * onto a field of the backend's `ListingResponseTO` — nothing is derived, computed or inferred,
 * because a token filled with a guess is worse than a token that discards its directive.
 *
 * `publicLocationLabel` rather than `streetAddress` on purpose: the backend gates address
 * precision behind `locationDisclosureLevel`, and the public label is the value it has already
 * decided is safe to show. Adapted copy must never become the surface that leaks a withheld
 * address.
 */
export interface ListingPlaceholderFacts {
  /** `bedrooms` — bedroom count. */
  bedrooms?: number;
  /** `livingArea` — interior area in m². */
  livingArea?: number;
  /** `district` — the sub-city area, i.e. the neighbourhood. */
  district?: string;
  /** `city`. */
  city?: string;
  /** `publicLocationLabel` — the publicly disclosable location string. */
  publicLocationLabel?: string;
  /** `highlights` — the agent's own feature bullets, in their chosen order. */
  highlights?: string[];
}

/**
 * Fetch the structured facts used for server-side placeholder resolution.
 *
 * Fail-open in the same sense as its siblings — `null` on missing env, non-2xx, timeout or
 * malformed JSON — but the CALLER's handling of `null` is fail-CLOSED: no facts means no token
 * resolves, and an unresolved token discards its directive (FOLLOW-1018, reaffirmed by ESC-074).
 * Nothing downstream substitutes a default.
 *
 * @param listingId - The tenant's listing identifier (UUID or slug).
 * @param locale    - Locale ('en' | 'pl' | 'es').
 * @returns The subset of fields present on the listing, or `null` when it cannot be read.
 */
export async function fetchListingPlaceholderFacts(
  listingId: string,
  locale: string,
): Promise<ListingPlaceholderFacts | null> {
  const listing = await fetchListingJson(listingId, locale, PLACEHOLDER_FACTS_TIMEOUT_MS);
  if (!listing) return null;

  const facts: ListingPlaceholderFacts = {};

  if (typeof listing.bedrooms === 'number' && Number.isFinite(listing.bedrooms)) {
    facts.bedrooms = listing.bedrooms;
  }
  if (typeof listing.livingArea === 'number' && Number.isFinite(listing.livingArea)) {
    facts.livingArea = listing.livingArea;
  }
  if (typeof listing.district === 'string') facts.district = listing.district;
  if (typeof listing.city === 'string') facts.city = listing.city;
  if (typeof listing.publicLocationLabel === 'string') {
    facts.publicLocationLabel = listing.publicLocationLabel;
  }
  if (Array.isArray(listing.highlights)) {
    facts.highlights = listing.highlights.filter((h): h is string => typeof h === 'string');
  }

  return facts;
}
