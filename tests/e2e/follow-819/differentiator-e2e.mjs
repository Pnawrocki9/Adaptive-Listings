#!/usr/bin/env node
/**
 * FOLLOW-819 — the differentiator E2E on localhost.
 *
 * behavioral trace → ingest → intent → adapt → DOM → measured lift, as ONE scripted
 * session, with each acceptance criterion recorded as an INDEPENDENT assertion.
 *
 * This is the test §Snapshot.5 names in its own words: "Critical gap: no end-to-end test
 * of intent → archetype → adapt → DOM." It is the exit test for the localhost stage and
 * FOLLOW-820's condition 1.
 *
 * ─── THIS TEST IS ALLOWED TO FAIL ─────────────────────────────────────────────────────
 * A red AC(1)/AC(2) is a SUCCESSFUL outcome. It is the first real measurement this product
 * has taken, and calibration (FOLLOW-212) depends on knowing the true starting number
 * rather than assuming one. Do NOT "fix" a red by tuning the fixture until it passes — the
 * reachability finding IS the deliverable (FOLLOW-875 AC-5).
 *
 * ─── THE STANDING TRAP, guarded mechanically below ────────────────────────────────────
 * The pilot page has historically pointed at the `:9100` MOCK decision harness
 * (`scripts/dev/mock-decision-server.mjs`). A green run through the mock is NOT evidence
 * for AC(1)/(2)/(3): the mock fabricates `confidence: 0.1` on a neutral hint (:519) and
 * happily returns directives that production would never send. `assertRealControlPlane()`
 * hard-fails before any assertion runs. See memory `project_real_control_plane_on_localhost`.
 *
 * ─── WHY THIS IS AN .mjs SCRIPT AND NOT A *.spec.ts ───────────────────────────────────
 * Deliberate. It needs six external processes CI does not have (local ClickHouse, local
 * Postgres, the ingest Worker, the real control plane, a listing page, a static server).
 * Shipping it as a discoverable spec would make a CI runner collect it and report a SKIP
 * that reads as a pass — exactly the soft-skip Rule Q forbids and the failure mode that
 * gave four sequential half-wires a passing badge. It is AC(6)'s second branch: a
 * documented manual runbook (`tests/e2e/follow-819/README.md`), explicitly labelled MANUAL.
 *
 * NO ASSERTION IN THIS FILE MAY BE SKIPPED. An absent substrate is RED, never "skipped" —
 * every AC below fails loud when its dependency is missing, and the process exits non-zero.
 *
 * Usage (from repo root, after the §3 bring-up in the README):
 *   node tests/e2e/follow-819/differentiator-e2e.mjs
 *
 * @module tests/e2e/follow-819/differentiator-e2e
 */

import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { createHmac, randomUUID } from 'node:crypto';

// Playwright is a devDependency of `@estalara/sdk` (it owns the browser matrix), not of the
// repo root — resolving from there keeps this dev-only harness off every CI install.
const requireFromSdk = createRequire(
  new URL('../../../packages/sdk/package.json', import.meta.url),
);
const { chromium } = requireFromSdk('@playwright/test');

// ─── Configuration ──────────────────────────────────────────────────────────────────────

const LISTING_URL = process.env.LISTING_URL ?? 'http://localhost:9200/fixture-listing.html';
const INGEST_ORIGIN = process.env.INGEST_ORIGIN ?? 'http://localhost:8787';
/** MUST be the real control plane. `assertRealControlPlane()` refuses the :9100 mock. */
const DECISION_ORIGIN = process.env.DECISION_ORIGIN ?? 'http://localhost:3000';
const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL ?? 'http://localhost:8123';
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER ?? 'default';
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD ?? 'clickhouse';
const DATABASE_URL_ADMIN = process.env.DATABASE_URL_ADMIN ?? '';
const ADAPT_API_KEY = process.env.ADAPT_API_KEY ?? '';
const OPS_TENANT_ID = process.env.OPS_TENANT_ID ?? '';
/** Staff credential for the AC(5) rollup route — a DIFFERENT secret from ADAPT_API_KEY. */
const ADMIN_API_SECRET = process.env.ADMIN_API_SECRET ?? '';
const HEADLESS = process.env.HEADLESS !== 'false';
const SESSION_JSON = process.env.SESSION_JSON ?? 'tests/e2e/follow-819/last-run.json';

/** Consent key the SDK reads (`packages/sdk/src/core/session.ts` CONSENT_STORAGE_KEY). */
const CONSENT_STORAGE_KEY = 'estalara_consent';

/** The one file that defines whether a decision response carries directives at all. */
const ADAPT_ROUTE_PATH = new URL(
  '../../../apps/control-plane/src/app/api/adapt/route.ts',
  import.meta.url,
);

/**
 * The scoring-path vocabulary FOLLOW-560 shipped, mirrored from
 * `apps/control-plane/src/app/api/admin/analytics/rollup/data.ts` SCORING_PATHS.
 *
 * NAMING NOTE (reported, not silently reconciled): the FOLLOW-819 stub calls this
 * `score_function`. The column FOLLOW-560 actually shipped is `adaptation_decisions.
 * scoring_path` (migration 0022). Same instrument, different name; AC(3) asserts the
 * shipped one and this note records the discrepancy so a future reader is not left
 * hunting for a column that does not exist.
 */
const SCORING_PATHS = ['cosine', 'djb2_fallback', 'djb2_guard', 'not_applicable'];

// ─── Result recording ───────────────────────────────────────────────────────────────────

const results = [];

/**
 * Record one INDEPENDENT acceptance-criterion result.
 *
 * @param {string} ac   - Acceptance-criterion id, e.g. 'AC(1)'.
 * @param {string} name - What was asserted, in one line.
 * @param {boolean} ok  - Whether it held.
 * @param {unknown} evidence - The observation the verdict rests on.
 */
function record(ac, name, ok, evidence) {
  results.push({ ac, name, ok, evidence });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${ac} — ${name}`);
  console.log(`        ${typeof evidence === 'string' ? evidence : JSON.stringify(evidence)}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Preflight: the substrate is real, or nothing below means anything ──────────────────

/**
 * Read the server-side directive gate out of the control-plane source at run time.
 *
 * Read rather than hardcoded for the reason FOLLOW-875 exists: a threshold copied into a
 * test is a threshold that silently drifts away from the one the decider reads. BOTH the
 * value and the comparison are extracted, because the comparison is what makes the bar
 * strict — `route.ts` is `if (confidence <= CONFIDENCE_THRESHOLD) return { directives: [] }`,
 * so a session at exactly 0.6 gets `[]`.
 *
 * Throws rather than defaulting: a silent fallback would reproduce the exact defect this
 * reader exists to prevent.
 *
 * @returns {Promise<{value: number, comparison: string, source: string}>}
 */
async function readServerConfidenceGate() {
  const src = await readFile(ADAPT_ROUTE_PATH, 'utf8');
  const valueMatch = /const\s+CONFIDENCE_THRESHOLD\s*=\s*([0-9.]+)\s*;/.exec(src);
  const compareMatch = /if\s*\(\s*confidence\s*(<=|<)\s*CONFIDENCE_THRESHOLD\s*\)/.exec(src);
  if (!valueMatch || !compareMatch) {
    throw new Error(
      'Could not read CONFIDENCE_THRESHOLD / its comparison from route.ts. The server gate ' +
        'moved or was renamed — fix this reader before trusting AC(1) (FOLLOW-875).',
    );
  }
  return {
    value: Number(valueMatch[1]),
    comparison: compareMatch[1],
    source: 'apps/control-plane/src/app/api/adapt/route.ts',
  };
}

/**
 * Refuse to run against the `:9100` mock decision harness.
 *
 * This is the single most important guard in the file. Two independent discriminators,
 * because either alone could be spoofed by a future mock:
 *   1. the mock serves `GET /mock/status`; the control plane does not;
 *   2. the control plane serves `/api/adapt`; the mock serves `/adapt`.
 *
 * @throws if the decision origin is the mock, or is not answering at all.
 */
async function assertRealControlPlane() {
  let mockStatus = null;
  try {
    const res = await fetch(`${DECISION_ORIGIN}/mock/status`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) mockStatus = await res.text();
  } catch {
    /* not answering /mock/status is exactly what we want */
  }
  if (mockStatus !== null) {
    throw new Error(
      `DECISION_ORIGIN=${DECISION_ORIGIN} answered GET /mock/status — this is the :9100 MOCK ` +
        'decision harness, not the real control plane. A green run through the mock is NOT ' +
        'evidence for AC(1)/(2)/(3): the mock fabricates confidence 0.1 on a neutral hint and ' +
        'returns directives production would never send. Point DECISION_ORIGIN at the real ' +
        'control plane (README.md §3.4 for the safe `doppler run -c dev -- env …` form, :3000) ' +
        'and re-run.',
    );
  }

  // Positive control: the real route must exist. An unauthenticated POST is expected to be
  // rejected (401/403) or to answer 200 — what matters is that the PATH is served at all.
  // A 404 means we are pointed at something that does not implement the decision contract.
  const probe = await fetch(`${DECISION_ORIGIN}/api/adapt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(8000),
  }).catch((err) => {
    throw new Error(
      `DECISION_ORIGIN=${DECISION_ORIGIN} is not answering POST /api/adapt (${String(err)}). ` +
        'Start the real control plane before running this harness — an unreachable decision ' +
        'endpoint is a RED substrate, never a skip.',
    );
  });
  if (probe.status === 404) {
    throw new Error(
      `DECISION_ORIGIN=${DECISION_ORIGIN} returned 404 for POST /api/adapt — that path is the ` +
        'real control-plane decision route. Wrong origin.',
    );
  }
  return { probedStatus: probe.status };
}

// ─── Data-side helpers (the browser cannot see any of this) ─────────────────────────────

/**
 * Run a ClickHouse query over the HTTP interface.
 *
 * @param {string} sql - The query, without a FORMAT clause.
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function chQuery(sql) {
  const url = new URL(CLICKHOUSE_URL);
  const auth = Buffer.from(`${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}`).toString('base64');
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', Authorization: `Basic ${auth}` },
    body: `${sql} FORMAT JSONEachRow`,
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ClickHouse ${String(res.status)}: ${text.slice(0, 400)}`);
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

// ─── FOLLOW-1075: a real holdout arm + its diagnostics ───────────────────────────────────

/** Path to the fixture the SDK is actually served from. */
const FIXTURE_PATH = new URL('./fixture-listing.html', import.meta.url);

/** The SDK's own source — the ONE place that defines how long a CTA click may sit queued. */
const SDK_INDEX_PATH = new URL('../../../packages/sdk/src/index.ts', import.meta.url);

/**
 * Read the SDK's event-queue flush interval out of its source at run time.
 *
 * FOUND BY EXECUTION (FOLLOW-1075): the pre-existing comments elsewhere in this file say
 * "≥ the 2000ms batch flush interval" — that number was never read from the producer, and the
 * producer is actually 5000ms (`index.ts` `BATCH_INTERVAL_MS`, a fixed `setInterval` that does
 * NOT reset per-event). A 3000ms wait after a click can land in the dead zone just after a
 * flush cycle and silently observe zero rows — not a flake, a timing assumption that was never
 * verified against the source (the FOLLOW-875 lesson, applied here rather than repeated).
 *
 * @returns {Promise<number>}
 */
async function readSdkBatchIntervalMs() {
  const src = await readFile(SDK_INDEX_PATH, 'utf8');
  const match = /const\s+BATCH_INTERVAL_MS\s*=\s*([0-9_]+)\s*;/.exec(src);
  if (!match) {
    throw new Error('Could not read BATCH_INTERVAL_MS from packages/sdk/src/index.ts.');
  }
  return Number(match[1].replace(/_/g, ''));
}

/**
 * Read the SDK's `data-api-key` straight out of the fixture it is served from, rather than
 * hardcoding a second copy that could silently drift from the value the browser session
 * actually authenticates with. Same "read the source, don't duplicate it" reasoning as
 * `readServerConfidenceGate()` above.
 *
 * @returns {Promise<string>}
 */
async function readFixtureApiKey() {
  const src = await readFile(FIXTURE_PATH, 'utf8');
  const match = /data-api-key="([^"]+)"/.exec(src);
  if (!match) {
    throw new Error('Could not read data-api-key from fixture-listing.html.');
  }
  return match[1];
}

/**
 * The lift window `computeLift()`'s caller applies, mirrored from
 * `apps/control-plane/src/app/api/admin/analytics/rollup/data.ts` WINDOW_DAYS — same mirror
 * reasoning as SCORING_PATHS above: this script cannot import Next.js route internals, so the
 * value is copied and the copy is named so it can be diffed against the source on review.
 */
const ROLLUP_WINDOW_DAYS = 7;

/**
 * Diagnostic-only re-derivation of the SAME adapted/holdout conversion counts `computeLift()`
 * consumes (`rollup/data.ts:188-209`), queried directly against ClickHouse.
 *
 * NOT the AC(5) verdict source — that stays `data_source === 'clickhouse' && ctaLift !== null`
 * from the REAL `/api/admin/analytics/rollup` response (the anti-fixture guard, README §2).
 * This exists only so a RED AC(5) names WHICH of `computeLift()`'s null-conditions
 * (`holdoutN === 0`, `holdoutRate === 0`, i.e. `holdoutConversions === 0`) is unmet, without a
 * future reader re-deriving `computeLift()` from source (FOLLOW-1075).
 *
 * @returns {Promise<{adaptedN: number, adaptedConversions: number, holdoutN: number, holdoutConversions: number}>}
 */
async function measureConversionCounts() {
  const rows = await chQuery(
    `SELECT
       countDistinctIf(ad.session_id, ad.holdout_group = 0) AS adapted_n,
       countDistinctIf(ad.session_id, ad.holdout_group = 0 AND ev.session_id != '') AS adapted_conversions,
       countDistinctIf(ad.session_id, ad.holdout_group = 1) AS holdout_n,
       countDistinctIf(ad.session_id, ad.holdout_group = 1 AND ev.session_id != '') AS holdout_conversions
     FROM adaptation_decisions AS ad
     LEFT JOIN (
       SELECT DISTINCT tenant_id, session_id FROM events
       WHERE type = 'cta.clicked' AND ts >= now() - toIntervalDay(${String(ROLLUP_WINDOW_DAYS)})
     ) AS ev ON ad.tenant_id = ev.tenant_id AND ad.session_id = ev.session_id
     WHERE ad.ts >= now() - toIntervalDay(${String(ROLLUP_WINDOW_DAYS)})`,
  );
  const r = rows[0] ?? {};
  return {
    adaptedN: Number(r.adapted_n ?? 0),
    adaptedConversions: Number(r.adapted_conversions ?? 0),
    holdoutN: Number(r.holdout_n ?? 0),
    holdoutConversions: Number(r.holdout_conversions ?? 0),
  };
}

/**
 * Did the BROWSER session — the arm this harness calls "adapted" — actually land in the adapted
 * arm?
 *
 * FOLLOW-1098 (measured 2026-08-25, README §5.3): it does not always. `holdout_group` for the
 * browser session is decided by the real `assignHoldout()` (`packages/shared/src/ab-holdout.ts`,
 * HMAC-SHA-256 over the session id, keyed on tenant_id) at the tenant's default holdout
 * percentage, and the SDK mints its own session id — so on a minority of runs the "adapted" arm
 * IS the control arm. Every row it writes then carries `directive_count: 0`, and AC(1)
 * (`directivesTotal > 0`), AC(2) (no DOM change is possible) and AC(5) (`adaptedConversions`
 * never counts it) all go RED for a reason that has nothing to do with the differentiator.
 *
 * That is a false RED and the mirror image of the false GREEN this ticket removed. The harness
 * cannot PREVENT it in scope — choosing the session id is the SDK's, and adding a holdout knob to
 * the SDK is a public-API change (CLAUDE.md) — so it NAMES it instead: an affected run is
 * UNMEASURED on the adapted axis, not FAILED on it, exactly the distinction FOLLOW-1075 drew for
 * the quiz arm. Remedy tracked as its own stub.
 *
 * @param {string} sid the browser session's id
 * @returns {Promise<boolean|null>} true = drew holdout, false = adapted, null = not determinable
 */
async function measureAdaptedArmHoldout(sid) {
  const rows = await chQuery(
    `SELECT holdout_group FROM adaptation_decisions
     WHERE session_id = '${sid.replace(/'/g, '')}' ORDER BY ts LIMIT 1`,
  ).catch(() => []);
  if (rows.length === 0) return null;
  return Boolean(rows[0].holdout_group);
}

/**
 * The session-id prefix every synthetic control session this harness mints carries.
 *
 * FOLLOW-1098: this exists so the synthetic control arm is COUNTABLE. `driveHoldoutArm()` mints
 * exactly one such session per run and the rollup window is 7 whole days of the whole substrate,
 * so the number of these rows inside the window is the number of harness runs the reported lift
 * was pooled over — a fact the artefact previously did not carry and a reader could not recover.
 */
const SYNTHETIC_CONTROL_PREFIX = 'f1075hold-';

/**
 * How many synthetic control sessions this harness has left inside `computeLift()`'s window.
 *
 * FOLLOW-1098: `ctaLift` is NOT a per-run number. It is a rollup over `ROLLUP_WINDOW_DAYS` of
 * every row in the substrate, so consecutive runs accumulate: each adds one certainly-converting
 * synthetic control session and at least one structurally non-converting adapted session (the
 * `assertRealControlPlane()` preflight POST writes an `adaptation_decisions` row with
 * `holdout_group = 0` and never emits a `cta.clicked`). Reporting the pooled value as one
 * measurement is the defect; reporting the pool size alongside it is the remedy.
 *
 * @returns {Promise<number>} -1 when the count could not be taken.
 */
async function measureSyntheticControlRuns() {
  const rows = await chQuery(
    `SELECT countDistinct(session_id) AS n FROM adaptation_decisions
     WHERE ts >= now() - toIntervalDay(${String(ROLLUP_WINDOW_DAYS)})
       AND session_id LIKE '${SYNTHETIC_CONTROL_PREFIX}%'`,
  ).catch(() => []);
  return rows.length > 0 ? Number(rows[0].n ?? 0) : -1;
}

/**
 * Drive a SECOND, independent session into the real holdout arm and give it a real
 * `cta.clicked` conversion, so `computeLift()` has sessions in BOTH arms
 * (RETRO-301 §4a LG-2 / §4b BUG-1's "blocker B").
 *
 * NOT a browser session — the SDK exposes no config knob for `holdout_pct`, and adding one is
 * an SDK public-API change outside this ticket's scope (would need sdk-engineer + an
 * escalation, CLAUDE.md "public API surface"). Instead this calls the SAME two real
 * production endpoints the browser SDK calls (`POST /api/adapt`, `POST /v1/events`) directly —
 * exactly as AC(4) already does for `/adapt/feedback` — never a raw ClickHouse INSERT.
 * `holdout_pct` is a genuine field of `AdaptPostBodySchema` (route.ts:225), consumed by the
 * REAL `assignHoldout()` (packages/shared/src/ab-holdout.ts, HMAC-SHA-256 keyed on tenant_id).
 * Passing it supplies a real INPUT to real production code; the OUTPUT (`holdout_group`) is
 * computed by that code, never injected — the same distinction §2 draws for AC(1)'s quiz arm.
 *
 * @returns {Promise<Record<string, unknown>>} diagnostics — never throws.
 */
async function driveHoldoutArm() {
  const diag = { attempted: false };
  if (!OPS_TENANT_ID) {
    diag.error = 'OPS_TENANT_ID not set — cannot address the holdout POST at a real tenant.';
    return diag;
  }
  try {
    const apiKey = await readFixtureApiKey();
    // 32–64 chars, per EventEnvelopeBaseSchema.session_id (packages/shared/src/schemas/event.ts:65).
    const holdoutSessionId = `${SYNTHETIC_CONTROL_PREFIX}${randomUUID()}`.slice(0, 64);
    diag.attempted = true;
    diag.holdoutSessionId = holdoutSessionId;

    // holdout_pct: 1 → assignHoldout()'s HMAC ratio (always < 1, barring the ~1-in-4-billion
    // ratio === 1 edge case) resolves holdout_group to TRUE with certainty — the SAME
    // deterministic algorithm every real session goes through, just handed a real percentage
    // that forces the outcome instead of leaving it to the default 10%.
    const adaptRes = await fetch(`${DECISION_ORIGIN}/api/adapt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        tenant_id: OPS_TENANT_ID,
        session_id: holdoutSessionId,
        page_type: 'listing_detail',
        holdout_pct: 1,
      }),
      signal: AbortSignal.timeout(15000),
    });
    diag.adaptStatus = adaptRes.status;
    const adaptBody = await adaptRes.json().catch(() => null);
    diag.adaptDecisionId = adaptBody?.adapt_decision_id ?? null;

    // The ClickHouse write is fire-and-forget behind after() (route.ts ~:1652) — poll rather
    // than trust the 200, mirroring AC(4)'s poll for the identical reason.
    let rowFound = false;
    for (let i = 0; i < 15; i++) {
      await sleep(500);
      const rows = await chQuery(
        `SELECT holdout_group FROM adaptation_decisions WHERE session_id = ` +
          `'${holdoutSessionId.replace(/'/g, '')}' LIMIT 1`,
      ).catch(() => []);
      if (rows.length > 0) {
        rowFound = true;
        diag.loggedHoldoutGroup = rows[0].holdout_group;
        break;
      }
    }
    diag.decisionRowFound = rowFound;

    // Real ingest event over the REAL ingest Worker — mirrors packages/sdk/src/core/events.ts
    // dispatchEvents() exactly (same headers, same envelope shape), never a raw ClickHouse
    // INSERT. tenant_id is the SAME placeholder the SDK itself sends; the ingest Worker
    // overwrites it from the resolved API key (memory `project_real_control_plane_on_localhost`).
    const ingestRes = await fetch(`${INGEST_ORIGIN}/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Estalara-API-Key': apiKey,
        'x-session-id': holdoutSessionId,
      },
      body: JSON.stringify({
        events: [
          {
            event_id: randomUUID(),
            tenant_id: '00000000-0000-0000-0000-000000000000',
            session_id: holdoutSessionId,
            ts: Date.now(),
            region: 'eu',
            consent_state: 'consented',
            schema_version: 1,
            type: 'cta.clicked',
            payload: { cta_id: 'tour_request', href: '', text: 'Request a Tour' },
          },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });
    diag.ingestStatus = ingestRes.status;
    await sleep(2000); // give the ingest write time to land before AC(5) queries
  } catch (err) {
    diag.error = String(err);
  }
  return diag;
}

// ─── main ───────────────────────────────────────────────────────────────────────────────

async function main() {
  const serverGate = await readServerConfidenceGate();
  const preflight = await assertRealControlPlane();
  console.log(
    `[preflight] real control plane confirmed at ${DECISION_ORIGIN} ` +
      `(POST /api/adapt → ${String(preflight.probedStatus)}); server gate = confidence ` +
      `${serverGate.comparison === '<=' ? '>' : '>='} ${String(serverGate.value)} (${serverGate.source})\n`,
  );

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  const net = [];
  context.on('response', (res) => {
    net.push({ method: res.request().method(), url: res.url(), status: res.status() });
  });

  /** SDK POST request bodies — what the SDK actually emitted. */
  const emitted = [];
  context.on('request', (req) => {
    if (req.method() !== 'POST') return;
    if (!req.url().startsWith(INGEST_ORIGIN) && !req.url().startsWith(DECISION_ORIGIN)) return;
    let body = req.postData();
    try {
      body = JSON.parse(body ?? 'null');
    } catch {
      /* a non-JSON body is itself the finding */
    }
    emitted.push({ url: req.url(), body });
  });

  /** Decision RESPONSES — AC(1)'s verdict is a statement about what came back. */
  const decided = [];
  const pending = [];
  context.on('response', (res) => {
    if (res.request().method() !== 'POST') return;
    if (!res.url().startsWith(DECISION_ORIGIN) || !/\/adapt(\?|$)/.test(res.url())) return;
    const meta = { url: res.url(), status: res.status() };
    pending.push(
      res.text().then(
        (t) => {
          try {
            decided.push({ ...meta, body: JSON.parse(t.slice(0, 20000)) });
          } catch {
            decided.push({ ...meta, bodyRaw: t.slice(0, 20000) });
          }
        },
        (e) => decided.push({ ...meta, bodyError: String(e) }),
      ),
    );
  });

  const consoleLines = [];
  const page = await context.newPage();
  page.on('console', (m) => consoleLines.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => consoleLines.push(`pageerror: ${String(e)}`));

  // Consent-granted, per §9.1: four conditions empty `directives` BEFORE confidence is ever
  // consulted (AL off/suspended, profiling_opt_out, consent-skip, holdout arm). A session
  // that is not consent-granted never gets the confidence question asked at all.
  await context.addInitScript(
    ([key]) => {
      try {
        window.localStorage.setItem(key, 'granted');
      } catch {
        /* storage unavailable — the SDK shows the banner and the run fails loudly */
      }
    },
    [CONSENT_STORAGE_KEY],
  );

  await page.goto(LISTING_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});

  const readSlots = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-estalara-slot]')].map((el) => ({
        slot: el.getAttribute('data-estalara-slot'),
        text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 220),
      })),
    );
  const baseline = await readSlots();

  // ── ARM A: behavioral signals only ────────────────────────────────────────────────────
  // The question FOLLOW-875 left open and this ticket exists to answer: can behavior ALONE
  // clear the server gate? §9.2 predicts no (the 0.3655 cold-start prior out-masses anything
  // a listing-detail page emits under BEHAVIORAL_DAMPING = 0.3). This arm MEASURES it rather
  // than assuming it.
  const imgs = page.locator('img');
  const imgCount = await imgs.count();
  for (const y of [400, 900, 1500, 2200, 3000, 3800, 4600]) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
    await sleep(900);
  }
  for (let i = 0; i < Math.min(4, imgCount); i++) {
    await imgs
      .nth(i)
      .click({ timeout: 3000, force: true })
      .catch(() => {});
    await sleep(600);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await sleep(3000); // ≥ the 2000ms batch flush interval
  await Promise.all(pending);

  const armAResponses = decided.filter((d) => d.body).map((d) => d.body);
  const armAPeak = armAResponses.reduce((m, b) => Math.max(m, b.confidence ?? 0), 0);
  const armADirectives = armAResponses.reduce(
    (n, b) => n + (Array.isArray(b.directives) ? b.directives.length : 0),
    0,
  );
  const armACleared = armAPeak > serverGate.value && armADirectives > 0;

  // ── ARM B: the quiz — the real widget, driven by real clicks ──────────────────────────
  // §9.2's judgement is that quiz or chat is REQUIRED on this page. This arm drives the
  // REAL quiz widget through the DOM (Playwright pierces the SDK's Shadow DOM), so the
  // confidence that results is PRODUCED by the production intent path — never injected.
  // Injecting an archetype here would be the exact anti-pattern FOLLOW-875 forbids and
  // would make AC(1) a green over a dead wire.
  //
  // FOLLOW-1099 — THE LOCATOR THIS ARM USED COULD NEVER MATCH, AND THAT IS WHY THE ARM HAD
  // NEVER RUN. The previous selector was `[data-estalara-quiz-option], .estalara-quiz button`.
  // Measured against HEAD, both halves are unsatisfiable:
  //   * `data-estalara-quiz-option` appears NOWHERE in shipped code — the only occurrences in
  //     the repository are backlog prose and the selector string itself.
  //   * no element carries the class token `estalara-quiz`. A CSS class selector matches whole
  //     tokens, never prefixes, so `.estalara-quiz button` does not match a descendant of
  //     `.estalara-quiz-overlay` / `.estalara-quiz-card` (`packages/sdk/src/ui/quiz-widget.ts`).
  // So `quizOptions.count()` returned 0 on every run and the loop broke on its first iteration,
  // which is exactly the `quizWidgetFound: false` recorded on all three executions. The stub's
  // OTHER hypothesis — that `quiz_enabled` is false for this tenant — is REFUTED:
  // `apps/control-plane/scripts/seed-local-tenant.mts` seeds `quiz_enabled` TRUE; the `'{}'::jsonb`
  // it also seeds is `quiz_config`, the optional definition override, not the enable flag.
  //
  // THE INTERACTION MODEL IS TWO-SHAPED and the old single-locator loop could not have driven it
  // even with a correct selector (`quiz-widget.ts` buildStep()):
  //   * ROOT question — clicking an `.estalara-quiz-answer` applies the answer immediately.
  //   * NON-ROOT question — clicking an answer only SELECTS it (`selectedIndex`); the separate
  //     `.estalara-quiz-cta` button advances or finishes, and it is `disabled` until a selection
  //     exists. Clicking `.first()` six times would therefore re-select option 0 forever.
  // `.estalara-quiz-skip` is deliberately NEVER clicked: a skip resolves to `neutral`
  // (FOLLOW-554), which would hand AC(1) a neutral leaf and call it a measurement.
  const armBStartIndex = decided.length;
  let quizDriven = false;
  let quizCompleted = false;
  const quizSteps = [];
  const quizCard = page.locator('.estalara-quiz-card');
  const quizAnswers = page.locator('.estalara-quiz-answer');
  const quizCta = page.locator('.estalara-quiz-cta');

  // The widget auto-opens once consent + config resolve (FOLLOW-1015) — it is not click-summoned,
  // so the arm waits for it rather than assuming it is already painted. A timeout here is a real
  // measurement (the widget never mounted), recorded as `quizWidgetFound: false`, not an error.
  const quizWidgetFound = await quizCard
    .first()
    .waitFor({ state: 'visible', timeout: 20000 })
    .then(() => true)
    .catch(() => false);

  if (quizWidgetFound) {
    for (let step = 0; step < 8; step++) {
      const answers = await quizAnswers.count().catch(() => 0);
      if (answers === 0) break;
      await quizAnswers
        .first()
        .click({ timeout: 3000 })
        .catch(() => {});
      quizDriven = true;
      await sleep(400);

      // Non-root steps need the CTA to commit the selection. Its presence is what distinguishes
      // the two shapes, and `isEnabled()` is what proves the click above actually registered a
      // selection rather than silently missing.
      const ctaPresent = (await quizCta.count().catch(() => 0)) > 0;
      const ctaEnabled = ctaPresent
        ? await quizCta
            .first()
            .isEnabled()
            .catch(() => false)
        : false;
      if (ctaPresent && ctaEnabled) {
        await quizCta
          .first()
          .click({ timeout: 3000 })
          .catch(() => {});
      }
      quizSteps.push({ step, answers, ctaPresent, ctaEnabled });
      await sleep(1200);

      // The card is torn down by cleanup() on completion — its disappearance is the completion
      // signal, and it is read from the DOM rather than inferred from a step count.
      const stillOpen = await quizCard
        .first()
        .isVisible()
        .catch(() => false);
      if (!stillOpen) {
        quizCompleted = true;
        break;
      }
    }
  }
  await sleep(3000);
  await Promise.all(pending);

  const armBResponses = decided
    .slice(armBStartIndex)
    .filter((d) => d.body)
    .map((d) => d.body);
  const armBPeak = armBResponses.reduce((m, b) => Math.max(m, b.confidence ?? 0), 0);
  const armBDirectives = armBResponses.reduce(
    (n, b) => n + (Array.isArray(b.directives) ? b.directives.length : 0),
    0,
  );
  const armBCleared = armBPeak > serverGate.value && armBDirectives > 0;

  // ── AC(1): non-neutral archetype, confidence strictly > server gate, directives > 0 ────
  const allResponses = decided.filter((d) => d.body).map((d) => d.body);
  const best = allResponses.reduce(
    (acc, b) => ((b.confidence ?? 0) > (acc?.confidence ?? -1) ? b : acc),
    null,
  );
  const nonNeutral = Boolean(best && best.archetype && best.archetype !== 'neutral');
  const peak = best?.confidence ?? 0;
  const totalDirectives = allResponses.reduce(
    (n, b) => n + (Array.isArray(b.directives) ? b.directives.length : 0),
    0,
  );
  record(
    'AC(1)',
    `non-neutral archetype with confidence > ${String(serverGate.value)} AND directives.length > 0, on the real /adapt response`,
    nonNeutral && peak > serverGate.value && totalDirectives > 0,
    {
      serverGate,
      peakConfidence: peak,
      archetype: best?.archetype ?? null,
      nonNeutral,
      directivesTotal: totalDirectives,
      source: best?.source ?? null,
      REACHABILITY_FINDING: {
        behavioralSignalsAlone: {
          peakConfidence: armAPeak,
          directives: armADirectives,
          clearedGate: armACleared,
        },
        withQuizInput: {
          // FOLLOW-1099: three distinct facts that the single `quizWidgetFound: quizDriven`
          // field used to collapse into one. `quizWidgetFound` is whether the widget MOUNTED,
          // `quizDriven` is whether a real answer was clicked, `quizCompleted` is whether the
          // card resolved a leaf. Only the second is what "the arm ran" means for the verdict
          // below; the first is what tells a reader WHERE it stopped when it did not.
          quizWidgetFound,
          quizDriven,
          quizCompleted,
          quizSteps,
          peakConfidence: armBPeak,
          directives: armBDirectives,
          clearedGate: armBCleared,
        },
        // FOLLOW-1075 (RETRO-301 §4b BUG-1): an arm that never RAN (`quizWidgetFound: false`)
        // must not be reported as having cleared OR failed the gate — it is UNMEASURED, and
        // collapsing "unmeasured" into "failed" is a false red on the arm most likely to
        // succeed (a quiz leaf resolves at min(0.85 × 1.2, 1.0) = 1.0).
        verdict: armACleared
          ? 'behavior ALONE cleared the server gate'
          : armBCleared
            ? 'behavior alone did NOT clear the gate; quiz input was REQUIRED (confirms runbook §9.2)'
            : quizDriven
              ? 'NEITHER behavior nor quiz cleared the gate — report this as the measurement, do not tune the fixture'
              : quizWidgetFound
                ? 'behavior alone did NOT clear the gate; the quiz widget MOUNTED but no answer was ' +
                  'clickable, so the quiz arm is still UNMEASURED — report as "behaviour-only RED, quiz ' +
                  'UNMEASURED", NOT as "neither cleared" (FOLLOW-1075/1099)'
                : 'behavior alone did NOT clear the gate; the quiz widget never MOUNTED, so the quiz arm ' +
                  'is UNMEASURED — report as "behaviour-only RED, quiz UNMEASURED", NOT as "neither ' +
                  'cleared" (FOLLOW-1075/1099)',
      },
    },
  );

  // ── AC(2): an observably adapted DOM (hop 10) ─────────────────────────────────────────
  // Distinct from AC(1): this is the only assertion that catches directives that ARRIVE but
  // are never painted.
  const after = await readSlots();
  const changed = after.filter((a, i) => baseline[i] && baseline[i].text !== a.text);
  record(
    'AC(2)',
    'at least one [data-estalara-slot] observably changed in the live DOM',
    changed.length > 0,
    {
      before: baseline,
      after,
      changedSlots: changed.map((c) => c.slot),
    },
  );

  // Session identity for the data-side assertions — taken from what the SDK actually sent.
  const sessionId =
    emitted.flatMap((e) => e.body?.events ?? []).find((ev) => ev.session_id)?.session_id ??
    best?.session_id ??
    null;
  const tenantId =
    emitted.flatMap((e) => e.body?.events ?? []).find((ev) => ev.tenant_id)?.tenant_id ?? null;

  // ── FOLLOW-1075: click the REAL CTA in this (adapted/non-holdout) session ──────────────
  // AC(5)'s join needs a `cta.clicked` events row under THIS session_id/tenant_id. Clicking a
  // hand-authored selector would defeat the anti-fixture guard the same way an injected
  // archetype would (§2) — this drives the REAL collector (`[data-estalara-cta]`,
  // packages/sdk/src/core/observer.ts:547 `onCtaClick`), so the event is emitted by the
  // production SDK over the production ingest wire, never synthesized by this harness.
  const ctaButton = page.locator('[data-estalara-cta]').first();
  const ctaButtonFound = (await ctaButton.count().catch(() => 0)) > 0;
  let adaptedCtaClicked = false;
  let adaptedCtaClickError = null;
  if (ctaButtonFound) {
    try {
      // Deliberately NOT force:true. FOUND BY EXECUTION (FOLLOW-1075): `force: true` skips
      // Playwright's scroll-into-view/actionability checks, and the button sits below the
      // fold on this fixture — a forced click landed on whatever WAS in the (unscrolled)
      // viewport instead, dispatched no error (`.catch(() => {})` swallowed nothing because
      // Playwright itself reported success), and produced a boolean `adaptedCtaClicked: true`
      // over zero real `cta.clicked` rows — the exact "green over a dead wire" shape this
      // guardrail exists to prevent. A plain `.click()` (Playwright scrolls the element into
      // view first) reproduced a real row on the same fixture; verified by direct ClickHouse
      // query before and after, not by trusting the click call's return.
      await ctaButton.click({ timeout: 5000 });
      adaptedCtaClicked = true;
    } catch (err) {
      adaptedCtaClickError = String(err);
    }
    if (adaptedCtaClicked) {
      // The queue flush is a fixed setInterval, NOT reset per-event (index.ts), so a click can
      // land just after a flush fires — wait a FULL cycle plus margin, read from the real
      // producer (readSdkBatchIntervalMs() docblock), not the flat 3000ms other arms use.
      const batchIntervalMs = await readSdkBatchIntervalMs().catch(() => 5000);
      await sleep(batchIntervalMs + 2000);
    }
  }

  // ── AC(3): a logged adaptation_decisions row carrying the FOLLOW-560 scoring path ──────
  // Without this the test cannot tell real cosine ranking from a stable djb2 hash shuffle.
  // Requires SCORING_PATH_COLUMN_ENABLED=true on the control plane, or the INSERT omits the
  // column entirely and this reads a value the writer never wrote.
  try {
    const rows = await chQuery(
      `SELECT session_id, archetype, confidence, directive_count, holdout_group, variant,
              adapt_decision_id, scoring_path
       FROM adaptation_decisions
       WHERE session_id = '${String(sessionId ?? '').replace(/'/g, '')}'
       ORDER BY ts DESC LIMIT 10`,
    );
    const withPath = rows.filter((r) => SCORING_PATHS.includes(String(r.scoring_path)));
    record(
      'AC(3)',
      'adaptation_decisions row logged for this session, carrying a FOLLOW-560 scoring_path',
      rows.length > 0 && withPath.length > 0,
      {
        sessionId,
        rowCount: rows.length,
        scoringPaths: [...new Set(rows.map((r) => r.scoring_path))],
        cosineVsDjb2Distinguishable: withPath.some((r) => r.scoring_path !== 'not_applicable'),
        rows: rows.slice(0, 3),
        note: 'AC names this `score_function`; the shipped column (migration 0022) is `scoring_path`.',
      },
    );
  } catch (err) {
    // A failed query is RED, never a skip — an unreachable ClickHouse cannot report a pass.
    record('AC(3)', 'adaptation_decisions row logged with a FOLLOW-560 scoring_path', false, {
      error: String(err),
      hint:
        'ClickHouse unreachable or adaptation_decisions/scoring_path absent. Apply migration ' +
        '0022 and start the control plane with SCORING_PATH_COLUMN_ENABLED=true.',
    });
  }

  // ── AC(4): a feedback-driven ab_bandit_weights delta (hop 12, via FOLLOW-818) ──────────
  // The feedback ping carries the archetype/variant the REAL /adapt response served, so the
  // bandit arm that moves is the arm this session actually produced — not a synthetic one.
  if (!DATABASE_URL_ADMIN || !ADAPT_API_KEY || !OPS_TENANT_ID) {
    record('AC(4)', 'feedback ping moved a real ab_bandit_weights row', false, {
      error: 'DATABASE_URL_ADMIN / ADAPT_API_KEY / OPS_TENANT_ID not set',
      hint: 'See README §3.4 — this is a RED substrate, not a skip (Rule Q).',
    });
  } else {
    try {
      const { readBanditArm } = await import('./bandit-probe.mjs');
      const archetype = best?.archetype ?? 'neutral';
      const variant = best?.variant ?? 'default';
      const before = await readBanditArm(DATABASE_URL_ADMIN, OPS_TENANT_ID, archetype, variant);

      const bodyText = JSON.stringify({
        session_id: sessionId ?? 'follow-819-session',
        tenant_id: OPS_TENANT_ID,
        archetype,
        variant,
        converted: true,
      });
      const res = await fetch(`${DECISION_ORIGIN}/api/adapt/feedback`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${ADAPT_API_KEY}`,
          'X-Estalara-Signature': createHmac('sha256', ADAPT_API_KEY)
            .update(bodyText)
            .digest('hex'),
        },
        body: bodyText,
        signal: AbortSignal.timeout(15000),
      });

      // Poll — the write is fire-and-forget behind after(); a 202 alone proves nothing.
      let afterArm = null;
      let polls = 0;
      for (; polls < 20; polls++) {
        await sleep(500);
        afterArm = await readBanditArm(DATABASE_URL_ADMIN, OPS_TENANT_ID, archetype, variant);
        if (JSON.stringify(afterArm) !== JSON.stringify(before)) break;
      }
      record(
        'AC(4)',
        'feedback ping moved a real ab_bandit_weights row (Beta delta observed, not just a 202)',
        res.status === 202 && JSON.stringify(afterArm) !== JSON.stringify(before),
        { httpStatus: res.status, archetype, variant, before, after: afterArm, polls },
      );
    } catch (err) {
      record('AC(4)', 'feedback ping moved a real ab_bandit_weights row', false, {
        error: String(err),
      });
    }
  }

  // ── AC(5): a lift number from real substrate rows, by the EXISTING analytics path ──────
  // THE ANTI-FIXTURE GUARD IS THE POINT OF THIS ASSERTION.
  // `getPlatformAnalyticsRollup()` falls back to `buildMockRollup()` when either store is
  // unconfigured, and that mock FABRICATES a lift with `seededRandom()` (data.ts). So
  // asserting "ctaLift is a number" would go green over a completely dead wire — the single
  // worst test in this codebase. AC(5) therefore asserts the live discriminator FIRST and
  // treats a 'mock' source as RED no matter how plausible the number looks.
  //
  // THE LIVE VALUE IS `'clickhouse'`, NOT `'live'`. `data_source` is typed
  // `'clickhouse' | 'mock'` (data.ts); only the SECONDARY `scoring_path_source` and
  // `quiz_data_source` fields use the literal `'live'`. Asserting `=== 'live'` here would
  // pin AC(5) permanently RED for the wrong reason — which misleads exactly as much as a
  // false green, by reporting a dead analytics wire on a perfectly live substrate.
  // FOLLOW-1075: drive the holdout arm BEFORE reading the rollup, so computeLift() has
  // sessions (and a conversion) in both arms by the time AC(5) reads it — see
  // driveHoldoutArm()'s docblock above for why this is a real second session against real
  // endpoints, never an injected row.
  // FOLLOW-1098: read this BEFORE minting the synthetic control session, so the query cannot be
  // confused by it, and AFTER AC(3) has already polled the browser session's rows into existence.
  const adaptedArmDrewHoldout = await measureAdaptedArmHoldout(sessionId);
  if (adaptedArmDrewHoldout === true) {
    console.log(
      `\n[FOLLOW-1098] ⚠ THE ADAPTED ARM DREW HOLDOUT. The real assignHoldout() put the browser ` +
        `session (${sessionId}) in the CONTROL arm, so it received zero directives by design. ` +
        `AC(1)/AC(2)/AC(5) are UNMEASURED on the adapted axis for this run — NOT failed. Re-run.`,
    );
  }

  console.log('\n[FOLLOW-1075] driving a real holdout-arm session…');
  const holdoutArmDiag = await driveHoldoutArm();
  console.log(`[FOLLOW-1075] holdout arm: ${JSON.stringify(holdoutArmDiag)}`);

  try {
    // ADMIN_API_SECRET, not ADAPT_API_KEY. The rollup route is staff-gated by
    // `verifyTracerAdminAuth`, whose Bearer path compares against ADMIN_API_SECRET
    // (tracer-auth.ts Path 1); ADAPT_API_KEY is the ops-bypass credential for /adapt and
    // /adapt/feedback only (ADR-0015) and would 401/403 here — another false RED.
    const res = await fetch(`${DECISION_ORIGIN}/api/admin/analytics/rollup`, {
      headers: { Authorization: `Bearer ${ADMIN_API_SECRET}` },
      signal: AbortSignal.timeout(20000),
    });
    const body = await res.json().catch(() => null);
    const live = body?.data_source === 'clickhouse';
    const lift = body?.rollup?.ctaLift ?? null;

    // FOLLOW-1098: `conversionCounts` is now taken on EVERY run, not only on red ones. It stopped
    // being purely diagnostic the moment the verdict began depending on `adaptedConversions`, and
    // it was previously `null` exactly when a non-positive lift made the counts the story.
    const conversionCounts = await measureConversionCounts().catch((err) => ({
      error: String(err),
    }));
    const syntheticControlRuns = await measureSyntheticControlRuns();

    // ── FOLLOW-1098: THE VERDICT USED TO BE SATISFIABLE BY THIS HARNESS ALONE ──────────────
    // The old predicate was `res.ok && live && lift !== null`. `driveHoldoutArm()` creates a
    // control session AND converts it in one branchless function, so `holdoutN >= 1` and
    // `holdoutRate === 1` on every run, which makes BOTH of `computeLift()`'s null-branches
    // (`holdoutN === 0`, `holdoutRate === 0`) unreachable and `lift !== null` a tautology
    // wherever the substrate is up. `res.ok` and `live` are environment preconditions the
    // preflight already enforces. AC(5) therefore passed independently of the SDK, the CTA
    // button, the DOM and the adapt response: deleting `[data-estalara-cta]` from the fixture
    // left it green, and with `adaptedN === 0` it reported PASS on a lift of -100. That is a
    // Rule AU failure — asserting the PRESENCE OF A VALUE while meaning THE DIFFERENTIATOR
    // PRODUCED A LIFT — and the third on this artefact (RETRO-298 §LG-1, RETRO-301 §4a LG-1,
    // RETRO-309 §4a LG-1).
    //
    // The added conjunct is the one input the synthetic control cannot manufacture: a real
    // `cta.clicked` from the ADAPTED arm, emitted by the SDK's own collector in the browser
    // session. Remove `[data-estalara-cta]` from the fixture and `adaptedConversions` falls to 0
    // and AC(5) goes RED — which is the red-first proof this predicate exists to satisfy.
    //
    // WHAT AC(5) DOES NOT ASSERT, AND MUST NOT BE READ AS ASSERTING: that the lift is POSITIVE,
    // or that it is directional evidence of anything. The control arm is synthetic and converts
    // with certainty by construction, so `holdoutRate` is pinned at 1.0 and the formula collapses
    // to `ctaLift = (adaptedRate - 1) * 100` — non-positive for arithmetic reasons, not for
    // product reasons. FOLLOW-820 condition 1 needs a POSITIVE lift over a REAL control and this
    // harness cannot produce one (README §0).
    const countsUsable = Boolean(conversionCounts && !conversionCounts.error);
    const adaptedArmConverted =
      countsUsable && conversionCounts.adaptedN > 0 && conversionCounts.adaptedConversions > 0;
    const ok = res.ok && live && lift !== null && adaptedArmConverted;

    const unmetPreconditions = [];
    if (!res.ok) unmetPreconditions.push(`http_status=${String(res.status)}`);
    if (res.ok && !live) unmetPreconditions.push(`data_source=${String(body?.data_source)}`);
    if (countsUsable) {
      if (conversionCounts.holdoutN === 0) unmetPreconditions.push('holdoutN=0');
      if (conversionCounts.holdoutN > 0 && conversionCounts.holdoutConversions === 0) {
        unmetPreconditions.push('holdoutConversions=0');
      }
      // FOLLOW-1098: `adaptedN === 0` is the one input whose emptiness `computeLift()` silently
      // absorbs via `adaptedN > 0 ? … : 0`, turning a dead adapted arm into a -100 lift rather
      // than a null. It was missing from this list for exactly that reason.
      if (conversionCounts.adaptedN === 0) unmetPreconditions.push('adaptedN=0');
      if (conversionCounts.adaptedN > 0 && conversionCounts.adaptedConversions === 0) {
        unmetPreconditions.push('adaptedConversions=0');
      }
    } else if (conversionCounts) {
      unmetPreconditions.push('conversionCounts=unavailable');
    }
    // FOLLOW-1098: when the browser session drew holdout there IS no adapted arm this run, so
    // `adaptedConversions=0` above is a consequence, not a cause. Naming the cause is what stops
    // the next reader from filing a differentiator bug against a coin flip.
    if (adaptedArmDrewHoldout === true) unmetPreconditions.push('adaptedArmDrewHoldout=true');

    record(
      'AC(5)',
      "the existing analytics path computed a lift from real localhost-substrate rows (data_source='clickhouse', NOT the seededRandom mock) AND the ADAPTED arm produced at least one real cta.clicked — NOT an assertion that the lift is positive or directional (FOLLOW-1098)",
      ok,
      {
        httpStatus: res.status,
        data_source: body?.data_source ?? null,
        scoring_path_source: body?.scoring_path_source ?? null,
        ctaLift: lift,
        sessions: body?.rollup?.sessions ?? null,
        adapted: body?.rollup?.adapted ?? null,
        holdout: body?.rollup?.holdout ?? null,
        adaptedArm: {
          sessionId,
          ctaButtonFound,
          ctaClicked: adaptedCtaClicked,
          ctaClickError: adaptedCtaClickError,
          // FOLLOW-1098: null = not determinable. true = this run has NO adapted arm and every
          // adaptation-dependent AC is UNMEASURED rather than failed.
          drewHoldout: adaptedArmDrewHoldout,
        },
        holdoutArm: holdoutArmDiag,
        // FOLLOW-1075 AC-3: re-derivation of computeLift()'s own two inputs, so a red is readable
        // from THIS artefact without re-deriving computeLift() from source. FOLLOW-1098: taken on
        // GREEN runs too — it is now a verdict input, and it was previously withheld precisely
        // when a non-positive lift made the counts the story.
        conversionCounts,
        unmetPreconditions,
        // ── FOLLOW-1098: what produced this number, carried NEXT TO the number ──────────────
        // Everything a reader needs in order not to over-read `ctaLift`, in the same object as
        // `ctaLift`. Previously all of it lived only in retro prose, and the artefact read as a
        // clean experimental result.
        liftProvenance: {
          isDirectionalEvidence: false,
          controlArm:
            'SYNTHETIC — driveHoldoutArm() mints one control session per run via a real ' +
            'POST /api/adapt with holdout_pct: 1 and then converts it with a real cta.clicked. It ' +
            'is a real session through real production code, but it is not a sampled visitor.',
          holdoutRate: 1.0,
          holdoutRateNote:
            'Pinned at 1.0 BY CONSTRUCTION: every synthetic control session converts. computeLift() ' +
            'therefore collapses to ctaLift = (adaptedRate - 1) * 100, which is non-positive for ' +
            'arithmetic reasons and decays as runs accumulate — never a product signal.',
          windowDays: ROLLUP_WINDOW_DAYS,
          syntheticControlRunsInWindow: syntheticControlRuns,
          windowNote:
            `This lift is a ${String(ROLLUP_WINDOW_DAYS)}-day rollup over the WHOLE substrate, not a ` +
            'per-run experiment. syntheticControlRunsInWindow is how many harness runs are pooled ' +
            'into it (-1 = the count could not be taken). Consecutive runs change the value with no ' +
            'product change whatsoever.',
          nSupportsDirectionalClaim: false,
          nNote:
            'rollup.sessions counts an accumulated pool, not an experimental N. Do NOT run a ' +
            'significance test on it: the arms are not sampled from one population, the control is ' +
            'certain to convert, and a nominal p-value computed over these counts would be an ' +
            'artefact of the harness. FOLLOW-820 condition 1 requires a POSITIVE lift over a REAL ' +
            'control, which this harness cannot yet produce (README §0).',
        },
        antiFixtureGuard:
          body?.data_source === 'mock'
            ? 'RED BY DESIGN — data_source=mock means buildMockRollup() fabricated this lift with ' +
              'seededRandom(). This is NOT a measurement. Configure CLICKHOUSE_* and DATABASE_URL_ADMIN ' +
              'on the control plane.'
            : null,
        note:
          'computeLift() returns null when holdoutN === 0 or holdoutRate === 0, so a lift needs ' +
          'sessions in BOTH arms plus at least one holdout cta.clicked conversion. FOLLOW-1098: ' +
          'those three are all supplied by driveHoldoutArm() itself, so they can no longer carry ' +
          'the verdict alone — adaptedN > 0 AND adaptedConversions > 0 are now conjuncts of it, ' +
          'and they are the only inputs the synthetic control cannot manufacture. ' +
          'unmetPreconditions[] names whichever is 0 on THIS run, on green runs as well as red.',
      },
    );
  } catch (err) {
    record(
      'AC(5)',
      'lift computed from real substrate rows by the existing analytics path',
      false,
      {
        error: String(err),
        holdoutArm: holdoutArmDiag,
        liftProvenance: { isDirectionalEvidence: false },
      },
    );
  }

  // ── Supporting evidence: did the ingest path actually persist anything? ────────────────
  // Not an AC of its own, but AC(5)'s precondition: the lift join reads `events` WHERE
  // type = 'cta.clicked'. If the ingest→ClickHouse write is rejected, AC(5) cannot be
  // anything but null regardless of how the session behaved.
  try {
    const counts = {};
    for (const t of ['events', 'intent_events', 'adaptation_decisions']) {
      const r = await chQuery(`SELECT count() AS n FROM ${t}`);
      counts[t] = Number(r[0]?.n ?? 0);
    }
    console.log(`\n[substrate] ClickHouse row counts: ${JSON.stringify(counts)}`);
    if (counts.events === 0) {
      console.log(
        '[substrate] events = 0. Check the FOLLOW-822 drift: the ingest Worker serializes ' +
          'DateTime64 with a trailing `Z` (clickhouse-producer.ts, intent-snapshot.ts) which ' +
          "ClickHouse's default `date_time_input_format=basic` REJECTS post-ACK. The control " +
          'plane strips it (route.ts) and its writes land — which is why AC(3) can be green ' +
          'while AC(5) is structurally blocked.',
      );
    }
  } catch (err) {
    console.log(`[substrate] could not read ClickHouse counts: ${String(err)}`);
  }

  const summary = {
    ranAt: new Date().toISOString(),
    listingUrl: LISTING_URL,
    ingestOrigin: INGEST_ORIGIN,
    decisionOrigin: DECISION_ORIGIN,
    serverGate,
    sessionId,
    tenantId,
    // FOLLOW-1098: a run-level validity flag, deliberately ABOVE `results`. When true, the
    // adapted arm drew holdout and the AC tally below understates the differentiator by
    // construction — the run is UNMEASURED on that axis, not a failure of it.
    adaptedArmDrewHoldout,
    results,
    decided,
    emitted,
    // Every response the page saw. Consumed when triage needs to answer "did ingest ACK at
    // all, and with what status" — FOLLOW-876's finding was that the previous artifact
    // recorded requests only and so could not answer the question its verdict turned on.
    network: net,
    consoleLines: consoleLines.slice(-80),
  };
  await writeFile(SESSION_JSON, JSON.stringify(summary, null, 2));

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} acceptance criteria green`);
  if (failed.length > 0) {
    console.log(`RED: ${failed.map((f) => f.ac).join(', ')}`);
    console.log(
      '\nA RED result here is a legitimate outcome for FOLLOW-819 (see the header). Report the ' +
        'true number; do not tune the fixture until it passes.',
    );
    process.exitCode = 1;
  }
}

await main();
