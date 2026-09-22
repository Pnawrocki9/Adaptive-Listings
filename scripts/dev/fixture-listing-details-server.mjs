#!/usr/bin/env node
/**
 * FOLLOW-1225 — the localhost GROUNDING source for the FOLLOW-819 differentiator E2E.
 *
 * ─── WHAT IT SERVES, AND WHY THAT IS THE ONLY DEFENSIBLE ANSWER ────────────────────────
 * A stand-in for the Estalara product backend's listing-details API, on the same path and
 * the same default port the control plane already reads
 * (`apps/control-plane/src/lib/listing-details.ts`: `ESTALARA_BACKEND_URL ?? http://localhost:8081`,
 * `GET /api/v1/listing/details?listing-uuid={id}&locale={LOC}`). Nothing in the control plane
 * changes: it is the same fetch, to the same URL shape, and the real Spring backend can replace
 * this process on the same port with no other edit.
 *
 * It serves EXACTLY the facts the fixture page publishes, read out of
 * `tests/e2e/follow-819/fixture-listing.html`, and nothing else:
 *   - the headline slot's text and the description slot's text (FOLLOW-1225);
 *   - the structured facts the page publishes as `data-estalara-fact="<field>"` elements: `price`,
 *     `currency`, `streetAddress`, `city`, `region` (FOLLOW-1249).
 *
 * Together those are the whole field set `fetchListingTextFields()` reads into the `/api/adapt`
 * prompt (`listing_title`, `listing_description`, `listing_price`, `listing_location`). CEO ruling
 * 2026-09-22 (FOLLOW-820 condition 1): a fixture-grounded run is GO evidence only once the fixture
 * serves the grounding fields production uses. `tests/e2e/follow-819/grounding-source.test.ts`
 * derives that field set from the production reader at run time and fails if this server drifts
 * from it.
 *
 * Restricting the server to what the page publishes is deliberate and load-bearing:
 *
 *   - **ESC-076 / MASTER_DESIGN §E.7.0**: a directive must derive from the listing. The listing
 *     under test IS that page; a grounding source that knows a price, a district or a bedroom
 *     count the page never shows would let the model write copy the page cannot support. That
 *     is the prompt injection this harness exists to catch (FOLLOW-1225: "do not hand-write facts
 *     into the prompt path to make AC(1) go green"), and it is exactly the failure RETRO-009 /
 *     RETRO-011 recorded when a fixture hand-wrote the value a producer was supposed to emit.
 *   - It is therefore IMPOSSIBLE to widen the grounding without editing the page the harness
 *     snapshots and diffs. Facts and page cannot drift apart.
 *
 * **Known, deliberate gap, stated rather than papered over.** The page publishes no bedroom count,
 * no living area, no district, no `publicLocationLabel` and no `highlights`. Those feed
 * `fetchListingPlaceholderFacts()`, not the prompt, so FOLLOW-1249 left them out. `fetchListingPlaceholderFacts()`
 * (FOLLOW-1140) therefore resolves no `{bedrooms}` / `{sqm}` / `{key_feature}` token, and a
 * directive carrying one is discarded exactly as it would be against a thin real listing
 * (FOLLOW-1018, ESC-074). Do NOT "fix" that here by parsing "3 bed, 2 bath" out of the headline:
 * derived facts are invented facts, and `listing-details.ts` says so in its own docblock. If a
 * fact must be groundable, publish it on the fixture page first.
 *
 * ─── WHY THIS EXISTS AT ALL ────────────────────────────────────────────────────────────
 * Measured 2026-09-20 at `241e762b` (README §5.10, FOLLOW-1185): no step of the FOLLOW-819
 * bring-up starts anything on `:8081`, so the control plane logged
 * `[listing-details] fetch failed: fetch failed` and the adapted arm came back
 * `source: playbook_fallback_llm_unavailable`, `fallback_reason: listing_context_unavailable`,
 * `outcomes.adapted: 0` — FOLLOW-820 condition 1 clause 1 unreachable by construction.
 *
 * The real backend is not an option on this substrate and that is measured, not assumed: neither
 * local Estalara app database holds the fixture UUID
 * (`select count(*) from listing where uuid='839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c'` → `0` in both
 * `estalara_postgres` and `estnew_postgres`, 2026-09-20 — the seed generates a fresh UUID per
 * load), so a running Spring Boot would answer the harness's listing id with a 404. There is no
 * `listings` table in our own Postgres either (`packages/db/src/schema`: `listing_embeddings`
 * holds vectors, no text). The fixture page is the only thing on this machine that knows what
 * the fixture listing IS.
 *
 * ─── FAIL LOUD, NEVER FABRICATE (Rule K.2) ─────────────────────────────────────────────
 * Every miss is an explicit status with a named error code, never a partial listing:
 *   - unknown `listing-uuid`      → 404 `unknown_listing`
 *   - a locale the page does not publish → 404 `unsupported_locale`
 *   - the fixture file unreadable, or a slot missing from it → 500 `fixture_unreadable`
 * Every 200 carries `x-estalara-facts-source: <absolute path of the page it was read from>`, so
 * a consumer can name its grounding provenance on the wire (the harness preflight prints it).
 *
 * Run (from the repo root):
 *   node scripts/dev/fixture-listing-details-server.mjs
 * Env: `PORT` (8081), `FIXTURE_PATH` (`tests/e2e/follow-819/fixture-listing.html`).
 *
 * Local-only. Not part of any app build or deploy; nothing in `apps/` or `packages/` imports it.
 *
 * @module scripts/dev/fixture-listing-details-server
 */

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

/** The page the FOLLOW-819 harness drives the browser against. */
const DEFAULT_FIXTURE_PATH = fileURLToPath(
  new URL('../../tests/e2e/follow-819/fixture-listing.html', import.meta.url),
);

/** `DEFAULT_BACKEND_URL` in `apps/control-plane/src/lib/listing-details.ts` is `:8081`. */
const DEFAULT_PORT = 8081;

/** The only locale the fixture page publishes copy in. */
const FIXTURE_LOCALE = 'EN';

/** Names the file a 200's facts were read from. */
const FACTS_SOURCE_HEADER = 'x-estalara-facts-source';

/** Raised when the fixture page cannot answer for itself. Never downgraded to a default. */
class FixtureUnreadableError extends Error {}

/**
 * The inner text of the element carrying `data-estalara-slot="<slot>"`.
 *
 * Regex rather than a DOM parser on purpose: this reads ONE file, in this repo, whose exact
 * markup is reviewed alongside it, and adding a parser dependency to a dev script that must run
 * from a bare `node` invocation is not worth it. The backreference pins the closing tag to the
 * opening one, and nested markup is refused rather than served as prose.
 *
 * @param {string} html - The fixture page source.
 * @param {string} slot - The `data-estalara-slot` value.
 * @returns {string} The slot's text, whitespace-collapsed.
 * @throws {FixtureUnreadableError} when the slot is absent or holds markup.
 */
function readSlotText(html, slot) {
  return readElementText(html, 'data-estalara-slot', slot);
}

/**
 * The inner text of the element carrying `<attribute>="<value>"`. Same rules as
 * {@link readSlotText}, which is this function for `data-estalara-slot`.
 *
 * @param {string} html - The fixture page source.
 * @param {string} attribute - The attribute name.
 * @param {string} value - The attribute value.
 * @returns {string} The element's text, whitespace-collapsed.
 * @throws {FixtureUnreadableError} when the element is absent, empty or holds markup.
 */
function readElementText(html, attribute, value) {
  const selector = `[${attribute}="${value}"]`;
  const re = new RegExp(`<(\\w+)[^>]*${attribute}="${value}"[^>]*>([\\s\\S]*?)</\\1>`);
  const match = re.exec(html);
  if (!match) {
    throw new FixtureUnreadableError(
      `the fixture page has no ${selector} element — there is nothing to ground on`,
    );
  }
  const text = match[2];
  if (text.includes('<')) {
    throw new FixtureUnreadableError(
      `${selector} contains nested markup; this server serves text, never HTML`,
    );
  }
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) {
    throw new FixtureUnreadableError(`${selector} is empty`);
  }
  return collapsed;
}

/**
 * The structured facts the fixture page publishes as `data-estalara-fact="<field>"` elements
 * (FOLLOW-1249), with the JSON type the backend serves each one in.
 *
 * The names are the backend's (`ListingResponseTO`) because `fetchListingTextFields()` reads them
 * by those names. The types matter as much as the names: `price` must be a finite number, or the
 * reader drops it and `listing_price` never reaches the prompt. This list is typed in, but it is not
 * trusted: `grounding-source.test.ts` compares the served field set with the set the production
 * reader actually reads, and fails on any difference.
 *
 * Every entry is required. A page that stops publishing one is a 500 `fixture_unreadable`, never a
 * thinner listing, because a thinner listing is the non-production-shaped grounding this list
 * exists to rule out.
 */
const STRUCTURED_FACTS = /** @type {const} */ ([
  { field: 'price', type: 'number' },
  { field: 'currency', type: 'string' },
  { field: 'streetAddress', type: 'string' },
  { field: 'city', type: 'string' },
  { field: 'region', type: 'string' },
]);

/**
 * Read one published structured fact and give it the backend's JSON type.
 *
 * A number is accepted only when the page states it as a plain decimal (`385000`). `$385,000` is
 * refused rather than normalised, because converting a formatted string is parsing, and parsing
 * guesses. The page states the value the way the backend would serve it, or the server fails.
 *
 * @param {string} html - The fixture page source.
 * @param {{field: string, type: 'number' | 'string'}} fact
 * @returns {number | string}
 * @throws {FixtureUnreadableError}
 */
function readStructuredFact(html, { field, type }) {
  const text = readElementText(html, 'data-estalara-fact', field);
  if (type === 'string') return text;
  if (!/^\d+(?:\.\d+)?$/.test(text)) {
    throw new FixtureUnreadableError(
      `[data-estalara-fact="${field}"] reads "${text}", which is not a plain decimal number; the ` +
        'backend serves this field as a number, so the page must publish it as one',
    );
  }
  return Number(text);
}

/**
 * The facts the fixture page publishes about itself.
 *
 * Key names are the backend's (`ListingResponseTO`), because `fetchListingTextFields()` reads
 * `headline`, `description`, `price`, `currency`, `streetAddress`, `city` and `region` by those
 * names. Every value is read from the page. Nothing the page does not publish is emitted; see the
 * module docblock on why serving more would be fabrication.
 *
 * @param {string} html - The fixture page source.
 * @returns {{uuid: string, headline: string, description: string, price: number,
 *   currency: string, streetAddress: string, city: string, region: string}}
 * @throws {FixtureUnreadableError}
 */
export function extractFixtureFacts(html) {
  const idMatch = /data-estalara-listing-id="([^"]+)"/.exec(html);
  if (!idMatch) {
    throw new FixtureUnreadableError(
      'the fixture page carries no data-estalara-listing-id — this server cannot say which listing it serves',
    );
  }
  const facts = {
    uuid: idMatch[1],
    headline: readSlotText(html, 'headline'),
    description: readSlotText(html, 'description'),
  };
  for (const fact of STRUCTURED_FACTS) {
    facts[fact.field] = readStructuredFact(html, fact);
  }
  return facts;
}

/**
 * Build the listing-details stand-in.
 *
 * The fixture is read on EVERY request, not cached: the real backend's `details/slug` endpoint is
 * Caffeine-cached for 5 minutes and that cache has already produced one false measurement matrix
 * (FOLLOW-1035 AC(1a)). A dev server has no reason to inherit that hazard — edit the page, re-run,
 * see the new grounding.
 *
 * @param {{fixturePath?: string}} [options]
 * @returns {import('node:http').Server}
 */
export function createFixtureListingDetailsServer({ fixturePath = DEFAULT_FIXTURE_PATH } = {}) {
  return createServer((req, res) => {
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
      console.log(
        `[fixture-listing-details] ${String(status)} ${req.method ?? '?'} ${req.url ?? ''}`,
      );
    };

    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method !== 'GET' || url.pathname !== '/api/v1/listing/details') {
      // The slug form (`/api/v1/listing/details/slug`) lands here too: the fixture page declares a
      // UUID and no slug, so answering a slug lookup would mean inventing one.
      send(404, {
        error: 'not_served',
        detail:
          'this stand-in serves GET /api/v1/listing/details?listing-uuid=…&locale=EN only ' +
          '(scripts/dev/fixture-listing-details-server.mjs)',
      });
      return;
    }

    const requestedId = url.searchParams.get('listing-uuid');
    const requestedLocale = (url.searchParams.get('locale') ?? FIXTURE_LOCALE).toUpperCase();

    readFile(fixturePath, 'utf8')
      .then((html) => {
        const facts = extractFixtureFacts(html);
        if (requestedId !== facts.uuid) {
          send(404, {
            error: 'unknown_listing',
            requested: requestedId,
            served: facts.uuid,
            detail: `${fixturePath} publishes exactly one listing`,
          });
          return;
        }
        if (requestedLocale !== FIXTURE_LOCALE) {
          send(404, {
            error: 'unsupported_locale',
            requested: requestedLocale,
            served: FIXTURE_LOCALE,
            detail: 'the fixture page publishes English copy only; it has no other locale to serve',
          });
          return;
        }
        send(200, facts, { [FACTS_SOURCE_HEADER]: fixturePath });
      })
      .catch((err) => {
        // A configured source that FAILED. Loud, with the cause, and never a default listing.
        console.error(
          `[fixture-listing-details] cannot serve ${fixturePath}:`,
          err instanceof Error ? err.message : err,
        );
        send(500, {
          error: 'fixture_unreadable',
          fixturePath,
          detail: err instanceof Error ? err.message : String(err),
        });
      });
  });
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────
// Only when run directly, so the test can import the factory without binding a port.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const fixturePath = process.env.FIXTURE_PATH ?? DEFAULT_FIXTURE_PATH;
  const server = createFixtureListingDetailsServer({ fixturePath });
  server.listen(port, () => {
    console.log(
      `[fixture-listing-details] listening on http://localhost:${String(port)} — serving the facts ` +
        `published by ${fixturePath}\n` +
        `  probe: curl -s "http://localhost:${String(port)}/api/v1/listing/details?listing-uuid=<the page's data-estalara-listing-id>&locale=EN"\n` +
        '  point the control plane at it with ESTALARA_BACKEND_URL (tests/e2e/follow-819/README.md §3.3b).',
    );
  });
  server.on('error', (err) => {
    // EADDRINUSE most often means the real Spring backend already owns :8081 — which is a BETTER
    // grounding source, not a conflict to work around. Say so instead of exiting silently.
    console.error(`[fixture-listing-details] cannot listen on :${String(port)}: ${err.message}`);
    process.exitCode = 1;
  });
}
