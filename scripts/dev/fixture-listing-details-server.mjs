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
 * ─── THE SECOND THING THE HOST BACKEND DOES: CONFIRM A CONVERSION (FOLLOW-1203) ───────
 * CEO ruling of 2026-10-13 (ESC-084, ruling 3): on localhost THIS process — the stand-in for the
 * Estalara host backend — emits the server-confirmed conversion, and the FOLLOW-819 harness
 * triggers it. Emission from the real host backend is a post-GO deployment step.
 *
 *   POST /fixture/confirmed-conversion   {"session_id": "...", "type"?: "inquiry.completed" |
 *                                         "live.signup", "listing_id"?: "..."}
 *   GET  /fixture/confirmed-conversion   → whether the emitter is configured (no event is sent)
 *
 * The POST builds ONE event and sends it to the real ingest Worker (`POST /v1/events`) the way a
 * server-side caller must since FOLLOW-1201: no `Origin`, `X-Estalara-API-Key` = a SERVER key, and
 * `X-Estalara-Signature: hmac-sha256:<hex>` over `timestamp + "\n" + nonce + "\n" + body`, keyed
 * on that key's `hmac_secret` (`apps/ingest/src/auth.ts`). Ingest stamps such a row
 * `caller_signed = 1`, the only class the lift counts. Nothing is written to ClickHouse from here.
 *
 * The secret is a LOCAL dev value: `scripts/dev/localhost-up.sh` generates it once into the
 * gitignored `.localhost-up/`, seeds it into the Worker's LOCAL KV under the server key, and hands
 * both to this process by env. It is never a production secret and is in no committed file.
 * Unconfigured (either env var missing) → `503 conversion_emitter_unconfigured`, never a 200.
 * Ingest refusing or not accepting the event → `502 ingest_refused` with ingest's own status and
 * body. A 5xx / network failure is re-sent with a FRESH timestamp and nonce (README §6.10:
 * `wrangler dev`'s proxy answers some POSTs 503 before the Worker sees them).
 *
 * Run (from the repo root):
 *   node scripts/dev/fixture-listing-details-server.mjs
 * Env: `PORT` (8081), `FIXTURE_PATH` (`tests/e2e/follow-819/fixture-listing.html`); for the
 * conversion emitter `INGEST_URL` (`http://localhost:8787`), `FIXTURE_SERVER_API_KEY`,
 * `FIXTURE_SERVER_HMAC_SECRET` (hex).
 *
 * Local-only. Not part of any app build or deploy; nothing in `apps/` or `packages/` imports it.
 *
 * @module scripts/dev/fixture-listing-details-server
 */

import { createHmac, randomUUID } from 'node:crypto';
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

/** Where the conversion emitter is served (FOLLOW-1203). */
const CONVERSION_PATH = '/fixture/confirmed-conversion';

/** The two events the CEO ruled are the conversion (ESC-084). */
const CONVERSION_TYPES = ['inquiry.completed', 'live.signup'];

/** Sends per conversion: the first, plus re-sends after a 5xx / network failure (README §6.10). */
const CONVERSION_MAX_SENDS = 4;
const CONVERSION_RESEND_DELAY_MS = 750;

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
 * The signed `POST /v1/events` request a server-side caller sends for one conversion event
 * (FOLLOW-1201's scheme, `apps/ingest/src/auth.ts`). Pure: `tests/e2e/follow-819/
 * confirmed-conversion.test.ts` hands its output to the REAL `authenticateRequest()`.
 *
 * @param {{apiKey: string, hmacSecretHex: string, sessionId: string, type?: string,
 *   listingId?: string|null, now?: number, nonce?: string, eventId?: string}} args
 * @returns {{headers: Record<string, string>, body: string, event: Record<string, unknown>}}
 */
export function buildSignedConversionRequest({
  apiKey,
  hmacSecretHex,
  sessionId,
  type = 'inquiry.completed',
  listingId = null,
  now = Date.now(),
  nonce = randomUUID().replace(/-/g, ''),
  eventId = randomUUID(),
}) {
  if (!CONVERSION_TYPES.includes(type)) {
    throw new Error(`not a conversion event type: ${String(type)}`);
  }
  const event = {
    event_id: eventId,
    // The Worker overwrites this from the api key's KV record; the SDK sends the same placeholder.
    tenant_id: '00000000-0000-0000-0000-000000000000',
    session_id: sessionId,
    ts: now,
    region: 'eu',
    consent_state: 'consented',
    schema_version: 1,
    type,
    ...(listingId ? { listing_id: listingId } : {}),
    payload:
      type === 'inquiry.completed'
        ? { channel: 'email' }
        : { slot_uuid: randomUUID(), source_surface: 'listing_detail' },
  };
  const body = JSON.stringify({ events: [event] });
  const timestamp = String(now);
  const signature = createHmac('sha256', Buffer.from(hmacSecretHex, 'hex'))
    .update(`${timestamp}\n${nonce}\n${body}`)
    .digest('hex');
  return {
    headers: {
      'Content-Type': 'application/json',
      'X-Estalara-API-Key': apiKey,
      'X-Estalara-Signature': `hmac-sha256:${signature}`,
      'X-Estalara-Timestamp': timestamp,
      'X-Estalara-Nonce': nonce,
    },
    body,
    event,
  };
}

/**
 * Emit one signed conversion to ingest, re-sending (freshly signed) after a 5xx or a network
 * failure. Never throws; the caller turns the result into a status.
 *
 * @param {{ingestUrl: string, apiKey: string, hmacSecretHex: string}} emitter
 * @param {{sessionId: string, type?: string, listingId?: string|null}} conversion
 * @param {{fetchImpl?: typeof fetch, delayMs?: number}} [deps]
 */
export async function emitConfirmedConversion(emitter, conversion, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const delayMs = deps.delayMs ?? CONVERSION_RESEND_DELAY_MS;
  const eventId = randomUUID();
  const sends = [];
  for (let attempt = 1; attempt <= CONVERSION_MAX_SENDS; attempt++) {
    // Same event_id on every send, fresh timestamp + nonce: a re-send is the same conversion, and a
    // replayed nonce would be refused.
    const request = buildSignedConversionRequest({ ...emitter, ...conversion, eventId });
    let status = null;
    let ingestBody = null;
    let failure = null;
    try {
      const res = await fetchImpl(`${emitter.ingestUrl}/v1/events`, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        signal: AbortSignal.timeout(10000),
      });
      status = res.status;
      ingestBody = await res.json().catch(() => null);
    } catch (err) {
      failure = String(err);
    }
    sends.push({ attempt, status, failure });
    const accepted = status !== null && status >= 200 && status < 300 && ingestBody?.accepted === 1;
    if (accepted) {
      return { ok: true, eventId, type: request.event.type, sends, ingestStatus: status };
    }
    // A 4xx, or a 2xx that did not accept the event, is an answer: re-sending cannot change it.
    if (status !== null && status < 500) {
      return {
        ok: false,
        eventId,
        type: request.event.type,
        sends,
        ingestStatus: status,
        ingestBody,
      };
    }
    if (attempt < CONVERSION_MAX_SENDS) await new Promise((r) => setTimeout(r, delayMs));
  }
  const last = sends[sends.length - 1];
  return {
    ok: false,
    eventId,
    type: conversion.type ?? 'inquiry.completed',
    sends,
    ingestStatus: last.status,
  };
}

/** The conversion emitter's configuration, read from env; `null` when it is not configured. */
export function readConversionEmitterEnv(env = process.env) {
  const apiKey = env.FIXTURE_SERVER_API_KEY;
  const hmacSecretHex = env.FIXTURE_SERVER_HMAC_SECRET;
  if (!apiKey || !hmacSecretHex || !/^([0-9a-f]{2})+$/i.test(hmacSecretHex)) return null;
  return {
    ingestUrl: (env.INGEST_URL ?? 'http://localhost:8787').replace(/\/$/, ''),
    apiKey,
    hmacSecretHex,
  };
}

/** Read a small JSON request body. Rejects on malformed JSON or more than 4 kB. */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 4096) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

/**
 * Build the listing-details stand-in.
 *
 * The fixture is read on EVERY request, not cached: the real backend's `details/slug` endpoint is
 * Caffeine-cached for 5 minutes and that cache has already produced one false measurement matrix
 * (FOLLOW-1035 AC(1a)). A dev server has no reason to inherit that hazard — edit the page, re-run,
 * see the new grounding.
 *
 * @param {{fixturePath?: string, conversionEmitter?: ReturnType<typeof readConversionEmitterEnv>,
 *   fetchImpl?: typeof fetch}} [options] `conversionEmitter: null` (the default) leaves the
 *   FOLLOW-1203 emitter unconfigured: it answers 503 and sends nothing.
 * @returns {import('node:http').Server}
 */
export function createFixtureListingDetailsServer({
  fixturePath = DEFAULT_FIXTURE_PATH,
  conversionEmitter = null,
  fetchImpl = fetch,
} = {}) {
  return createServer((req, res) => {
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
      console.log(
        `[fixture-listing-details] ${String(status)} ${req.method ?? '?'} ${req.url ?? ''}`,
      );
    };

    const url = new URL(req.url ?? '/', 'http://localhost');

    // ── FOLLOW-1203: the host backend confirms a conversion ──────────────────────────────
    if (url.pathname === CONVERSION_PATH && (req.method === 'GET' || req.method === 'POST')) {
      if (conversionEmitter === null) {
        send(503, {
          error: 'conversion_emitter_unconfigured',
          detail:
            'FIXTURE_SERVER_API_KEY and FIXTURE_SERVER_HMAC_SECRET (hex) must be set; ' +
            'scripts/dev/localhost-up.sh sets both',
        });
        return;
      }
      if (req.method === 'GET') {
        // Never echoes the secret or the key: only that both exist and where events would go.
        send(200, { configured: true, ingestUrl: conversionEmitter.ingestUrl, signed: true });
        return;
      }
      readJsonBody(req)
        .then(async (body) => {
          const sessionId = body?.session_id;
          const type = body?.type ?? 'inquiry.completed';
          if (typeof sessionId !== 'string' || sessionId.length < 32 || sessionId.length > 64) {
            send(400, { error: 'invalid_session_id', detail: 'session_id: string, 32-64 chars' });
            return;
          }
          if (!CONVERSION_TYPES.includes(type)) {
            send(400, { error: 'invalid_type', allowed: CONVERSION_TYPES });
            return;
          }
          const result = await emitConfirmedConversion(
            conversionEmitter,
            {
              sessionId,
              type,
              listingId: typeof body?.listing_id === 'string' ? body.listing_id : null,
            },
            { fetchImpl },
          );
          send(result.ok ? 200 : 502, {
            ...(result.ok ? {} : { error: 'ingest_refused' }),
            session_id: sessionId,
            signed: true,
            ...result,
          });
        })
        .catch((err) => {
          send(400, {
            error: 'invalid_body',
            detail: err instanceof Error ? err.message : String(err),
          });
        });
      return;
    }

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
  const conversionEmitter = readConversionEmitterEnv();
  const server = createFixtureListingDetailsServer({ fixturePath, conversionEmitter });
  server.listen(port, () => {
    console.log(
      `[fixture-listing-details] listening on http://localhost:${String(port)} — serving the facts ` +
        `published by ${fixturePath}\n` +
        `  probe: curl -s "http://localhost:${String(port)}/api/v1/listing/details?listing-uuid=<the page's data-estalara-listing-id>&locale=EN"\n` +
        '  point the control plane at it with ESTALARA_BACKEND_URL (tests/e2e/follow-819/README.md §3.3b).\n' +
        (conversionEmitter
          ? `  conversion emitter: signed events → ${conversionEmitter.ingestUrl}/v1/events (FOLLOW-1203)`
          : '  conversion emitter: NOT configured (FIXTURE_SERVER_API_KEY / FIXTURE_SERVER_HMAC_SECRET unset)'),
    );
  });
  server.on('error', (err) => {
    // EADDRINUSE most often means the real Spring backend already owns :8081 — which is a BETTER
    // grounding source, not a conflict to work around. Say so instead of exiting silently.
    console.error(`[fixture-listing-details] cannot listen on :${String(port)}: ${err.message}`);
    process.exitCode = 1;
  });
}
