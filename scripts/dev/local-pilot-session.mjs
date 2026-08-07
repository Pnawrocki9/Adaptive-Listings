#!/usr/bin/env node
/**
 * FOLLOW-816 — scripted behavioral session against the LOCAL pilot listing page.
 *
 * Drives a real Chromium against the locally-running Estalara-app listing page (the SvelteKit
 * `web-master` dev server) with the Adaptive Listings SDK loaded from a local server, and
 * asserts the critical-path hops that the 2026-08-04 audit could only mark "unvalidated":
 *
 *   hop 1  — the page renders `data-estalara-*` hooks AND fetches the SDK bundle (HTTP 200)
 *   hop 4  — the SDK POSTs a real event batch to the ingest endpoint and gets a 2xx ACK
 *   hop 10 — at least one adaptation directive is observably applied to the live DOM
 *
 * NOT a CI test, deliberately. It needs four external processes that do not exist on a CI
 * runner (SvelteKit dev server, Spring backend, a decision endpoint, an ingest endpoint), so
 * it lives in `scripts/dev/` next to `mock-decision-server.mjs`. `docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md`
 * is the bring-up procedure; run this last.
 *
 * EVERY assertion below can fail, and the failure modes are named in `docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md`
 * §"How each hop can fail". A run that reports all-green without those processes up is a bug in
 * this script, not a pass — hence: no try/catch that downgrades a hop to "skipped", and a
 * non-zero exit whenever a required hop is red.
 *
 * Usage:
 *   node scripts/dev/local-pilot-session.mjs
 *   LISTING_URL=... INGEST_ORIGIN=... DECISION_ORIGIN=... node scripts/dev/local-pilot-session.mjs
 *
 * Env overrides:
 *   LISTING_URL      (http://localhost:5173/en/listing/9-blackberry-pl-palm-coast-fl-32137)
 *   INGEST_ORIGIN    (http://localhost:8787)   — the ingest endpoint the page's data-ingest-url points at
 *   DECISION_ORIGIN  (http://localhost:9100)   — the decision endpoint the page's data-decision-url points at
 *   HEADLESS         (true)
 *   SESSION_JSON     (path to write the machine-readable run summary)
 *
 * @module scripts/dev/local-pilot-session
 */

import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';

// Playwright is a devDependency of `@estalara/sdk` (it owns the browser matrix), not of the repo
// root — resolving from there keeps this dev-only script out of the root lockfile and off every
// CI install. `@playwright/test` re-exports the `chromium` browser type.
const requireFromSdk = createRequire(new URL('../../packages/sdk/package.json', import.meta.url));
const { chromium } = requireFromSdk('@playwright/test');

const LISTING_URL =
  process.env.LISTING_URL ?? 'http://localhost:5173/en/listing/9-blackberry-pl-palm-coast-fl-32137';
const INGEST_ORIGIN = process.env.INGEST_ORIGIN ?? 'http://localhost:8787';
const DECISION_ORIGIN = process.env.DECISION_ORIGIN ?? 'http://localhost:9100';
const HEADLESS = process.env.HEADLESS !== 'false';
/** Number of scroll+gallery passes. Raising it lengthens the behavioral session (FOLLOW-819). */
const PASSES = Number(process.env.PASSES ?? 1);
const SESSION_JSON = process.env.SESSION_JSON ?? '';

/** Consent key the SDK reads (`packages/sdk/src/core/session.ts` CONSENT_STORAGE_KEY). */
const CONSENT_STORAGE_KEY = 'estalara_consent';

const results = [];
function record(hop, name, ok, evidence) {
  results.push({ hop, name, ok, evidence });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] hop ${hop} — ${name}`);
  console.log(`        ${typeof evidence === 'string' ? evidence : JSON.stringify(evidence)}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  /** Every request the page made, so hop assertions read observed traffic, not hopes. */
  const net = [];
  context.on('request', (req) => {
    net.push({ phase: 'request', method: req.method(), url: req.url(), status: null });
  });
  context.on('response', (res) => {
    net.push({
      phase: 'response',
      method: res.request().method(),
      url: res.url(),
      status: res.status(),
    });
  });

  /**
   * Bodies of the SDK's own POSTs, so "what did the SDK actually emit" is answerable from a run
   * artifact instead of from a re-read of the SDK source. This is the input FOLLOW-818/819 need.
   */
  const emitted = [];
  context.on('request', (req) => {
    if (req.method() !== 'POST') return;
    if (!req.url().startsWith(INGEST_ORIGIN) && !req.url().startsWith(DECISION_ORIGIN)) return;
    let body = req.postData();
    try {
      body = JSON.parse(body ?? 'null');
    } catch {
      /* keep the raw string — a non-JSON body is itself the finding */
    }
    emitted.push({ url: req.url(), body });
  });

  const consoleLines = [];
  const page = await context.newPage();
  page.on('console', (m) => consoleLines.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => consoleLines.push(`pageerror: ${String(e)}`));

  // Pre-grant consent so the behavioral session is the thing under test, not the banner.
  // The banner path itself is covered by packages/sdk/e2e/consent.spec.ts.
  await context.addInitScript(
    ([key]) => {
      try {
        window.localStorage.setItem(key, 'granted');
      } catch {
        /* storage unavailable — the SDK will show the banner and the run will fail loudly */
      }
    },
    [CONSENT_STORAGE_KEY],
  );

  await page.goto(LISTING_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});

  // ── hop 1a: the DOM hooks ────────────────────────────────────────────────────────────────
  const hooks = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('*')) {
      for (const a of el.attributes) {
        if (a.name.startsWith('data-estalara-')) {
          out.push({ tag: el.tagName.toLowerCase(), attr: a.name, value: a.value });
        }
      }
    }
    return out;
  });
  // The SDK creates its own `data-estalara-host` shadow host; that is OUR node, not a page
  // hook, so it must not count toward the ≥3 page-hook bar.
  const pageHooks = hooks.filter((h) => h.attr !== 'data-estalara-host');
  record(1, 'listing page renders ≥3 data-estalara-* hooks', pageHooks.length >= 3, pageHooks);

  // ── hop 1b: the SDK bundle actually loaded ───────────────────────────────────────────────
  const bundleRes = net.find(
    (n) => n.phase === 'response' && n.url.includes('estalara-sdk') && n.url.endsWith('.js'),
  );
  record(
    1,
    'SDK bundle fetched with HTTP 200',
    bundleRes?.status === 200,
    bundleRes ?? 'no request for an estalara-sdk*.js was observed',
  );

  const sdkGlobal = await page.evaluate(() => ({
    present: typeof window.Estalara === 'object' && window.Estalara !== null,
    api: window.Estalara ? Object.keys(window.Estalara).sort() : [],
  }));
  record(1, 'SDK global initialised (window.Estalara)', sdkGlobal.present, sdkGlobal);

  // ── baseline copy, captured BEFORE the behavioral session ────────────────────────────────
  const readSlots = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-estalara-slot]')].map((el) => ({
        slot: el.getAttribute('data-estalara-slot'),
        text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 220),
      })),
    );
  const baseline = await readSlots();

  // ── the behavioral session ───────────────────────────────────────────────────────────────
  // ≥5 distinct behavioral signals: the SDK emits an `intent.snapshot` every 5 signals
  // (packages/sdk/src/index.ts, K.3.6 FOLLOW-266 Phase 3), and `intent.snapshot` is the ONLY
  // event that reaches ClickHouse `intent_events` (apps/ingest/src/handlers/intent-snapshot.ts).
  // Fewer than 5 → zero intent_events rows → hop 11 red. That is a real, reachable failure.
  const imgs = page.locator('img');
  const imgCount = await imgs.count();
  for (let pass = 0; pass < PASSES; pass++) {
    for (const y of [400, 900, 1500, 2200, 3000, 3800, 4600]) {
      await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
      await sleep(900); // dwell — the observers are dwell/visibility driven
    }
    // Photo interaction: the gallery is the strongest non-chat behavioral discriminator.
    for (let i = 0; i < Math.min(4, imgCount); i++) {
      await imgs
        .nth(i)
        .click({ timeout: 3_000, force: true })
        .catch(() => {});
      await sleep(600);
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await sleep(1_000);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await sleep(2_500); // ≥ the 2000ms batch flush interval

  // Force the pagehide flush (sendBeacon) as well, without navigating away.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await sleep(2_000);

  // ── hop 4: real events reached the ingest endpoint ───────────────────────────────────────
  const ingestPosts = net.filter(
    (n) => n.phase === 'response' && n.method === 'POST' && n.url.startsWith(INGEST_ORIGIN),
  );
  const ingestOk = ingestPosts.filter((n) => n.status >= 200 && n.status < 300);
  record(
    4,
    `SDK POSTed an event batch to ingest (${INGEST_ORIGIN}) and got 2xx`,
    ingestOk.length > 0,
    { attempted: ingestPosts.length, accepted: ingestOk.length, sample: ingestPosts.slice(0, 5) },
  );

  // ── hop 5: the decision endpoint was called ──────────────────────────────────────────────
  const decisionCalls = net.filter(
    (n) => n.phase === 'response' && n.url.startsWith(DECISION_ORIGIN) && !n.url.includes('.js'),
  );
  record(
    5,
    `SDK called the decision endpoint (${DECISION_ORIGIN})`,
    decisionCalls.length > 0,
    decisionCalls.slice(0, 6),
  );

  // ── the measurement hop 10 depends on: did the archetype ever clear the adapt floor? ─────
  // `DOM_ADAPT_CONFIDENCE_FLOOR` (packages/sdk/src/core/adapt-floor.ts, re-exported on the SDK
  // global) is the gate below which the decision endpoint is asked with a `neutral` hint and
  // correctly answers `directives: []`. If this stays under the floor, hop 10 CANNOT go green and
  // the cause is upstream of the SDK's DOM-apply path — which is separately covered green by
  // packages/sdk/e2e/adapt-dom-mutations.spec.ts. Do not "fix" hop 10 by injecting an archetype.
  const floor = await page.evaluate(() => window.Estalara?.DOM_ADAPT_CONFIDENCE_FLOOR ?? null);
  const adaptRequests = emitted
    .filter((e) => e.url.endsWith('/adapt') && typeof e.body === 'object' && e.body !== null)
    .map((e) => ({ archetype_hint: e.body.archetype_hint, confidence: e.body.confidence }));
  const peak = adaptRequests.reduce((m, r) => Math.max(m, r.confidence ?? 0), 0);
  record(
    10,
    `archetype confidence cleared DOM_ADAPT_CONFIDENCE_FLOOR (${String(floor)}) from behavior alone`,
    floor !== null && peak >= floor,
    {
      floor,
      peakConfidence: peak,
      hints: [...new Set(adaptRequests.map((r) => r.archetype_hint))],
    },
  );

  // ── hop 10: a directive is observably applied to the DOM ─────────────────────────────────
  const after = await readSlots();
  const changed = after.filter((a, i) => baseline[i] && baseline[i].text !== a.text);
  record(10, 'at least one directive observably applied to the local DOM', changed.length > 0, {
    before: baseline,
    after,
    changedSlots: changed.map((c) => c.slot),
  });

  // Event-type census — what the SDK emitted, by name. `intent.snapshot` is called out because it
  // is the ONLY event that reaches ClickHouse `intent_events`; its absence is a distinct finding
  // from "no events at all".
  const eventTypes = {};
  for (const e of emitted) {
    for (const evt of e.body?.events ?? []) {
      eventTypes[evt.type] = (eventTypes[evt.type] ?? 0) + 1;
    }
  }
  record(
    11,
    'SDK emitted at least one intent.snapshot (the only writer of ClickHouse intent_events)',
    (eventTypes['intent.snapshot'] ?? 0) > 0,
    eventTypes,
  );

  const summary = {
    ranAt: new Date().toISOString(),
    listingUrl: LISTING_URL,
    ingestOrigin: INGEST_ORIGIN,
    decisionOrigin: DECISION_ORIGIN,
    results,
    eventTypes,
    ingestPosts,
    decisionCalls,
    emitted,
    consoleLines: consoleLines.slice(-80),
  };
  if (SESSION_JSON) await writeFile(SESSION_JSON, JSON.stringify(summary, null, 2));

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} hops green`);
  if (failed.length > 0) {
    console.log(`RED: ${failed.map((f) => `hop ${f.hop} (${f.name})`).join(', ')}`);
    process.exitCode = 1;
  }
}

await main();
