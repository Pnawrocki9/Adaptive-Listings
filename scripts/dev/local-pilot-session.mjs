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
 * FOLLOW-875 — WHAT HOP 10 IS ASSERTED AGAINST, AND WHY IT CHANGED:
 *   The first version of this script asserted peak REQUEST confidence against the SDK's
 *   `DOM_ADAPT_CONFIDENCE_FLOOR` (0.5). Both halves of that were the wrong subject:
 *     (a) the SDK gate is a DISJUNCTION (`index.ts:827-829`) — `signal_count >= 2` alone opens
 *         it, and the init-time `device_type.*` prior already spends one count, so the second
 *         branch is true after a single scroll milestone. The floor suppressed nothing;
 *     (b) the gate that decides whether directives EXIST is server-side and higher:
 *         `route.ts:275` returns `directives: []` for `confidence <= CONFIDENCE_THRESHOLD`
 *         (0.6, `route.ts:86`) over the CLIENT-SENT `body.confidence`. The bar is strictly
 *         greater than 0.6.
 *   A run at confidence 0.55 therefore cleared the old assertion, mutated this mock's DOM, and
 *   would still have received `[]` from production — a green this harness could not honour.
 *   Hop 10 now asserts the RESPONSE, against the server threshold read out of `route.ts` at
 *   run time, plus the directive count the response actually carried.
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
import { readFile, writeFile } from 'node:fs/promises';

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

/** Cap on a captured response body, so a large `/adapt` payload cannot bloat SESSION_JSON. */
const MAX_CAPTURED_BODY_CHARS = 20_000;

/** The one file that defines whether a decision response carries directives at all. */
const ADAPT_ROUTE_PATH = new URL(
  '../../apps/control-plane/src/app/api/adapt/route.ts',
  import.meta.url,
);

/**
 * Read the server-side directive gate out of the control-plane source at run time.
 *
 * Read rather than hardcoded for the same reason the SDK floor is read off `window.Estalara`:
 * a constant copied into this script is a constant that silently drifts. Both the VALUE and the
 * COMPARISON are extracted, because the comparison is what makes the bar strict — `route.ts:275`
 * is `if (confidence <= CONFIDENCE_THRESHOLD) return { directives: [], source: 'default' }`, so
 * a session at exactly 0.6 gets `[]`.
 *
 * Throws rather than defaulting: a silent fallback here would reproduce the exact defect
 * FOLLOW-875 exists to fix — an assertion measured against a number the decider does not read.
 *
 * @returns {Promise<{ value: number, comparison: string, source: string }>}
 */
async function readServerConfidenceGate() {
  const src = await readFile(ADAPT_ROUTE_PATH, 'utf8');
  const valueMatch = /const\s+CONFIDENCE_THRESHOLD\s*=\s*([0-9.]+)\s*;/.exec(src);
  const compareMatch = /if\s*\(\s*confidence\s*(<=|<)\s*CONFIDENCE_THRESHOLD\s*\)/.exec(src);
  if (!valueMatch || !compareMatch) {
    throw new Error(
      `Could not read CONFIDENCE_THRESHOLD / its comparison from ${ADAPT_ROUTE_PATH.pathname}. ` +
        'The server gate moved or was renamed — fix this reader before trusting hop 10 ' +
        '(FOLLOW-875).',
    );
  }
  return {
    value: Number(valueMatch[1]),
    comparison: compareMatch[1],
    source: 'apps/control-plane/src/app/api/adapt/route.ts',
  };
}

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

  /**
   * Bodies of the decision endpoint's RESPONSES (FOLLOW-875 AC-2).
   *
   * Hop 10's verdict is a statement about what the decision endpoint DECIDED, and that lives in
   * the response — `resp.confidence` and `resp.directives`. The request-only capture above
   * cannot answer it: it sees the SDK's own hint, which on this stack is echoed back but is not
   * the same value in general. `resp.confidence` is also the value `index.ts:828` reads.
   *
   * Bounded by MAX_CAPTURED_BODY_CHARS. A body that cannot be read is RECORDED as an error, not
   * dropped — an unreadable decision response is itself a hop-10 finding.
   *
   * NOTE: FOLLOW-876 AC-1 broadens this to the ingest responses as well and documents the
   * artifact schema. This is deliberately the narrow slice hop 10 needs; do not treat 876 as
   * done because this exists.
   */
  const decided = [];
  const pendingBodies = [];
  context.on('response', (res) => {
    if (res.request().method() !== 'POST') return;
    if (!res.url().startsWith(DECISION_ORIGIN)) return;
    if (!/\/adapt(\?|$)/.test(res.url())) return;
    const meta = { url: res.url(), status: res.status() };
    pendingBodies.push(
      res.text().then(
        (text) => {
          const clipped = text.slice(0, MAX_CAPTURED_BODY_CHARS);
          try {
            decided.push({ ...meta, body: JSON.parse(clipped) });
          } catch {
            decided.push({ ...meta, bodyRaw: clipped });
          }
        },
        (err) => {
          decided.push({ ...meta, bodyError: String(err) });
        },
      ),
    );
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

  // ── the measurement hop 10 depends on: did the DECISION clear the gate that decides? ─────
  // FOLLOW-875. Three numbers, three different owners — keep them apart:
  //   • DOM_ADAPT_CONFIDENCE_FLOOR / DOM_ADAPT_MIN_SIGNAL_COUNT — the SDK's DISJUNCTIVE apply
  //     gate. Reported below, never asserted on: either branch alone opens it, so "the floor
  //     was not cleared" says nothing about whether the DOM was adapted.
  //   • CONFIDENCE_THRESHOLD (route.ts) — the gate that decides whether directives EXIST.
  //     This is the bar, and it is `> threshold`, not `>=`.
  //   • directives.length in the decision RESPONSE — the ground truth, which needs no
  //     threshold arithmetic at all. If this is 0 the DOM cannot have been adapted, whatever
  //     the confidence was.
  // Do not "fix" hop 10 by injecting an archetype: the SDK's DOM-apply path is separately
  // covered green by packages/sdk/e2e/adapt-dom-mutations.spec.ts.
  await Promise.all(pendingBodies);

  const serverGate = await readServerConfidenceGate();
  const floors = await page.evaluate(() => ({
    confidence: window.Estalara?.DOM_ADAPT_CONFIDENCE_FLOOR ?? null,
    signalCount: window.Estalara?.DOM_ADAPT_MIN_SIGNAL_COUNT ?? null,
  }));

  const adaptRequests = emitted
    .filter((e) => e.url.endsWith('/adapt') && typeof e.body === 'object' && e.body !== null)
    .map((e) => ({ archetype_hint: e.body.archetype_hint, confidence: e.body.confidence }));
  const adaptResponses = decided.filter((d) => d.body && typeof d.body === 'object');
  const peakRequest = adaptRequests.reduce((m, r) => Math.max(m, r.confidence ?? 0), 0);
  const peakResponse = adaptResponses.reduce((m, d) => Math.max(m, d.body.confidence ?? 0), 0);
  const totalDirectives = adaptResponses.reduce(
    (n, d) => n + (Array.isArray(d.body.directives) ? d.body.directives.length : 0),
    0,
  );

  // Which of the two `aboveFloor` branches was true? `signal_count` is not in the /adapt
  // contract, so it is read from the ONE place the SDK publishes it: the `intent.snapshot`
  // payload (core/intent-snapshot.ts:70), captured in the ingest batches above. It is only
  // observable at multiples of 5, so this is a LOWER BOUND — which is all the branch check
  // needs, since the branch opens at 2.
  const observedSignalCounts = emitted
    .flatMap((e) => e.body?.events ?? [])
    .filter((evt) => evt.type === 'intent.snapshot')
    .map((evt) => evt.payload?.signal_count)
    .filter((n) => typeof n === 'number');
  const maxSignalCount = observedSignalCounts.reduce((m, n) => Math.max(m, n), 0);
  const aboveFloorBranch = {
    'confidence >= DOM_ADAPT_CONFIDENCE_FLOOR':
      floors.confidence !== null ? peakResponse >= floors.confidence : null,
    'signal_count >= DOM_ADAPT_MIN_SIGNAL_COUNT':
      floors.signalCount !== null ? maxSignalCount >= floors.signalCount : null,
    maxObservedSignalCount: maxSignalCount,
    note: 'signal_count is observable only at multiples of 5 — this is a lower bound',
  };

  // BOTH sides of the exchange are asserted, and the reason is a fidelity gap this script found
  // by being run (2026-08-07, FOLLOW-875):
  //   • production `route.ts:275` evaluates the CLIENT-SENT `body.confidence ?? 0.5` and then
  //     echoes it back, so on production the two are the same number and the REQUEST side is
  //     what actually decides;
  //   • the local mock does NOT echo it — with a `neutral` hint it answers a fabricated
  //     `confidence: 0.1` (mock-decision-server.mjs:519). Observed on a real run:
  //     request 0.3655, response 0.1.
  // Asserting only the response would measure the mock's fiction; asserting only the request
  // would ignore the value `index.ts:828` reads. Requiring BOTH is strictly stronger than either
  // and cannot go green where production returns [].
  const requestCleared = peakRequest > serverGate.value;
  const responseCleared = peakResponse > serverGate.value;
  record(
    10,
    `decision confidence cleared the SERVER gate (${serverGate.comparison === '<=' ? '>' : '>='} ${String(serverGate.value)}, ${serverGate.source}) from behavior alone`,
    requestCleared && responseCleared,
    {
      serverGate,
      peakRequestConfidence: peakRequest,
      requestCleared,
      peakResponseConfidence: peakResponse,
      responseCleared,
      echoDivergence:
        peakRequest !== peakResponse
          ? 'the endpoint did NOT echo the client confidence — production route.ts does, so this ' +
            'endpoint is not confidence-faithful (expected against the local mock)'
          : null,
      hints: [...new Set(adaptRequests.map((r) => r.archetype_hint))],
      sdkApplyGate: { ...floors, disjunction: true, branchTruth: aboveFloorBranch },
    },
  );

  // The assertion that needs no threshold arithmetic, and the one a mock cannot manufacture a
  // green for: production returns `directives: []` below the server gate, so a response with
  // zero directives IS the red — regardless of what any floor says.
  record(10, 'the decision endpoint returned at least one directive', totalDirectives > 0, {
    responses: adaptResponses.length,
    directivesTotal: totalDirectives,
    perResponse: adaptResponses.map((d) => ({
      status: d.status,
      archetype: d.body.archetype,
      confidence: d.body.confidence,
      directives: Array.isArray(d.body.directives) ? d.body.directives.length : null,
      source: d.body.source,
    })),
    unreadable: decided.filter((d) => d.bodyError || d.bodyRaw !== undefined),
  });

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
    serverGate,
    sdkApplyGate: { ...floors, disjunction: true, branchTruth: aboveFloorBranch },
    results,
    eventTypes,
    ingestPosts,
    decisionCalls,
    emitted,
    // FOLLOW-875: decision RESPONSES. `emitted` above is requests only; hop 10's verdict is a
    // statement about what came back, so both directions are now in the artifact.
    decided,
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
