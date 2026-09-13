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
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

// Playwright is a devDependency of `@estalara/sdk` (it owns the browser matrix), not of the
// repo root — resolving from there keeps this dev-only harness off every CI install.
const requireFromSdk = createRequire(
  new URL('../../../packages/sdk/package.json', import.meta.url),
);
const { chromium } = requireFromSdk('@playwright/test');

// ─── Configuration ──────────────────────────────────────────────────────────────────────

/**
 * FOLLOW-1200: `:5173` is the fixture origin the README's §3.3 bring-up actually serves
 * (`npx serve -l 5173 …`) and the one origin `CORS_DEV_EXTRA_ORIGINS` allowlists alongside `:3000`
 * itself (`origin-policy.ts`). The old `:9200` default was CORS-refused (README §6.2): the server
 * still answers 200 and logs a decision row, so AC(3) could look green while the browser never saw
 * the response body and AC(1)/AC(2) went red for a reason that had nothing to do with confidence.
 * `assertListingOriginAllowed()` below is the hard stop for any OTHER misconfiguration of this
 * variable — it does not depend on the default alone being right.
 */
const LISTING_URL = process.env.LISTING_URL ?? 'http://localhost:5173/fixture-listing.html';
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

/**
 * `holdout_pct` handed to the CONTROL arm's real `/api/adapt` call. 1 in every normal run.
 *
 * FOLLOW-1131 AC(3) requires a red-first control in which the "control" session is ADAPTED, so the
 * arms do not separate and AC(7) must go red. Forcing that by editing this file would leave the
 * proof unreproducible and the edit itself unrecorded; an env knob makes it a one-command run.
 *
 * The knob is deliberately NOT silent: the value reaches `last-run.json` twice — `holdoutArm
 * .holdoutPctRequested` and AC(7)'s own evidence — and AC(7) refuses to report PASS on anything
 * other than 1 (`redFirstKnobEngaged`). A run that quietly forced separation off therefore cannot
 * be mistaken for a clean one, which is the failure mode Rule AU keeps catching in this harness.
 */
const CONTROL_ARM_HOLDOUT_PCT = Number(process.env.FOLLOW1131_CONTROL_HOLDOUT_PCT ?? '1');

/** Consent key the SDK reads (`packages/sdk/src/core/session.ts` CONSENT_STORAGE_KEY). */
const CONSENT_STORAGE_KEY = 'estalara_consent';

/** The one file that defines whether a decision response carries directives at all. */
const ADAPT_ROUTE_PATH = new URL(
  '../../../apps/control-plane/src/app/api/adapt/route.ts',
  import.meta.url,
);

/** The one file that defines which browser origins get a readable `/api/adapt` response body. */
const ORIGIN_POLICY_PATH = new URL(
  '../../../apps/control-plane/src/lib/origin-policy.ts',
  import.meta.url,
);

/** Repo root, so git subcommands work regardless of the caller's cwd (FOLLOW-1200). */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

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
 * The live Chromium handle, hoisted to module scope by FOLLOW-1125.
 *
 * `main()` has no try/finally around its body, so ANY throw between `chromium.launch()` and the
 * closing `browser.close()` used to leak the browser process AND skip `last-run.json` entirely —
 * leaving a run that is neither green, red, nor skipped. Rule Q's posture is that a soft-skip must
 * not masquerade as a pass; an ABORT that leaves no artefact at all is the same failure wearing a
 * different hat, because the next reader sees only a stale file from the previous run. The
 * bottom-of-file handler uses this to guarantee teardown on every path.
 */
let activeBrowser = null;

/**
 * The run's start timestamp and the harness's own HEAD SHA, hoisted so the ABORT handler at the
 * foot of this file can write them into its partial artefact too (FOLLOW-1200 — a staleness check
 * needs these on every artefact, not only on a clean run). Set at the top of `main()`, before
 * anything that can throw.
 */
let startedAt = null;
let harnessSha = null;

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

// ─── AC(1)'s verdict, as a pure function (FOLLOW-1186) ──────────────────────────────────

/**
 * The `source` values that mean a MODEL wrote the served copy and FOLLOW-457's fact check let it
 * through. Mirrored from `AdaptationDirectives['source']` in `packages/shared/src/directives.ts`
 * and the two `return { directives: gatewayResult.directives, source: … }` sites in
 * `apps/control-plane/src/app/api/adapt/route.ts` `runDecisionTree()`.
 */
const ADAPTED_SOURCES = new Set(['llm_tweaked', 'llm_full']);

/**
 * Evaluate AC(1) over every `/api/adapt` response body the adapted session received.
 *
 * CLAIM: the real control plane ADAPTED this listing for this buyer — a non-neutral archetype
 * cleared the server confidence gate AND a model-written, fact-check-approved directive came
 * back on that same response.
 *
 * A TEMPLATE `cta` ALONE IS NOT ADAPTATION. Since FOLLOW-1163 (§E.7.0) the two paths that serve
 * playbook copy verbatim — branch 2 (`source: 'playbook'`) and branch 3's gateway-null fallback
 * (`source: 'playbook_fallback_llm_unavailable'`, `fallback_reason` `fact_check_refused` or
 * `llm_unavailable`) — withhold every assertive slot and still serve the authored `cta`
 * (`NON_ASSERTIVE_SLOTS` in `lib/ungrounded-directives.ts`). Those responses carry a non-neutral
 * archetype, a confidence above the gate and `directives.length === 1`. The predicate this
 * function replaced — `nonNeutral && peak > gate && totalDirectives > 0` — therefore passed on a
 * batch the fact check REFUSED, and on one the LLM never answered at all. It is kept below as
 * reporting (`legacy`) and is not the verdict.
 *
 * WHAT COUNTS, and why each conjunct is on the SAME response rather than pooled across them:
 *   - `source` ∈ {`llm_tweaked`, `llm_full`} — the only proof a model adapted the copy;
 *   - `archetype` present and not `neutral`, `confidence` strictly above `serverGate.value` (the
 *     route's `if (confidence <= CONFIDENCE_THRESHOLD)`, read from source by the caller);
 *   - at least one NON-`reorder` directive. A `reorder` directive is appended by the POST handler
 *     after `runDecisionTree()` returns, on every source including `default` — the 2026-08-25
 *     run's neutral `default` response carried one — so it says nothing about adaptation. An
 *     `llm_*` response whose text directives `filterDirectivesByPageType()` stripped is not an
 *     adapted listing either.
 * The old predicate took its confidence from the highest-confidence response and its directive
 * count from ALL responses, so a neutral response's `reorder` could supply the count for a
 * template response's confidence.
 *
 * WHAT FOLLOW-820 CONDITION 1 GRADES: `outcomes.adapted` only. `refused`, `outage` (every other
 * `playbook_fallback_*` reason), `template` and `default` are REPORTED so a red names its cause,
 * and none of them can turn AC(1) green. An empty population is RED (Rule Q amendment 1 clause 5).
 *
 * @param {ReadonlyArray<Record<string, any>>} responses - Parsed `/api/adapt` bodies, in order.
 * @param {{value: number}} serverGate - From `readServerConfidenceGate()`.
 * @returns {{ok: boolean, summary: string, evidence: Record<string, unknown>}} `summary` is built
 *          from the counted population, never a literal — it is what the PASS/FAIL line prints.
 */
export function evaluateAc1(responses, serverGate) {
  const bodies = responses.filter((b) => b !== null && typeof b === 'object');
  const directivesOf = (b) => (Array.isArray(b.directives) ? b.directives : []);
  const nonReorderSlots = (b) =>
    directivesOf(b)
      .filter((d) => d && d.type !== 'reorder')
      .map((d) => d.slot ?? d.type ?? '?');

  const outcomes = { adapted: 0, refused: 0, outage: 0, template: 0, default: 0, other: 0 };
  const sourcesObserved = {};
  for (const b of bodies) {
    const key = b.fallback_reason
      ? `${String(b.source)}/${String(b.fallback_reason)}`
      : String(b.source);
    sourcesObserved[key] = (sourcesObserved[key] ?? 0) + 1;
    if (ADAPTED_SOURCES.has(b.source)) outcomes.adapted += 1;
    else if (typeof b.source === 'string' && b.source.startsWith('playbook_fallback_')) {
      if (b.fallback_reason === 'fact_check_refused') outcomes.refused += 1;
      else outcomes.outage += 1;
    } else if (b.source === 'playbook') outcomes.template += 1;
    else if (b.source === 'default') outcomes.default += 1;
    else outcomes.other += 1;
  }

  const qualifying = bodies.filter(
    (b) =>
      ADAPTED_SOURCES.has(b.source) &&
      Boolean(b.archetype) &&
      b.archetype !== 'neutral' &&
      (b.confidence ?? 0) > serverGate.value &&
      nonReorderSlots(b).length > 0,
  );
  const ok = qualifying.length > 0;

  // The pre-FOLLOW-1186 fields, unchanged in meaning, so earlier artefacts stay comparable and
  // AC(7)'s `directivesServed` keeps reading the same number.
  const best = bodies.reduce(
    (acc, b) => ((b.confidence ?? 0) > (acc?.confidence ?? -1) ? b : acc),
    null,
  );
  const nonNeutral = Boolean(best && best.archetype && best.archetype !== 'neutral');
  const peak = best?.confidence ?? 0;
  const totalDirectives = bodies.reduce((n, b) => n + directivesOf(b).length, 0);

  const observed =
    Object.entries(sourcesObserved)
      .map(([k, n]) => `${k}×${String(n)}`)
      .join(', ') || 'none';
  const first = qualifying[0];
  const summary =
    `${String(qualifying.length)} of ${String(bodies.length)} responses adapted ` +
    `(source ∈ {llm_tweaked, llm_full}, non-neutral, confidence > ${String(serverGate.value)}, ` +
    `≥1 non-reorder directive)` +
    (first
      ? `; first: ${String(first.source)} ${String(first.archetype)} @ ${String(first.confidence)} ` +
        `slots [${nonReorderSlots(first).join(', ')}]`
      : '') +
    `; sources observed: ${observed}`;

  return {
    ok,
    summary,
    evidence: {
      serverGate,
      GRADED_BY_FOLLOW_820_CONDITION_1: 'outcomes.adapted',
      outcomes,
      sourcesObserved,
      adaptedResponses: qualifying.map((b) => ({
        source: b.source,
        archetype: b.archetype,
        confidence: b.confidence,
        similarity: b.similarity ?? null,
        slots: nonReorderSlots(b),
      })),
      nonAdaptedWithDirectives: bodies
        .filter((b) => !qualifying.includes(b) && directivesOf(b).length > 0)
        .map((b) => ({
          source: b.source,
          fallback_reason: b.fallback_reason ?? null,
          archetype: b.archetype ?? null,
          confidence: b.confidence ?? null,
          slots: directivesOf(b).map((d) => d?.slot ?? d?.type ?? '?'),
        })),
      legacy: {
        NOT_THE_VERDICT:
          'pre-FOLLOW-1186 predicate nonNeutral && peakConfidence > gate && directivesTotal > 0 — ' +
          'passes on a template cta, which is not adaptation',
        wouldHavePassed: nonNeutral && peak > serverGate.value && totalDirectives > 0,
        peakConfidence: peak,
        archetype: best?.archetype ?? null,
        nonNeutral,
        directivesTotal: totalDirectives,
        source: best?.source ?? null,
      },
    },
  };
}

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
 * Read `CORS_DEV_EXTRA_ORIGINS` out of the control-plane source at run time — the ONE list that
 * decides whether the browser can read an `/api/adapt` response body at all (README §6.2). A
 * hardcoded copy here would drift from the real allowlist exactly the way a copied confidence
 * threshold would (`readServerConfidenceGate()`'s reasoning, applied to CORS).
 *
 * Throws rather than defaulting — same posture as `readServerConfidenceGate()`.
 *
 * @returns {Promise<string[]>}
 */
async function readDevAllowedOrigins() {
  const src = await readFile(ORIGIN_POLICY_PATH, 'utf8');
  const match = /CORS_DEV_EXTRA_ORIGINS\s*:\s*readonly string\[\]\s*=\s*\[([^\]]*)\]/.exec(src);
  const origins = match ? [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
  if (!match || origins.length === 0) {
    throw new Error(
      'Could not read CORS_DEV_EXTRA_ORIGINS from origin-policy.ts. It moved or was renamed — ' +
        'fix this reader before trusting the LISTING_URL preflight (FOLLOW-1200).',
    );
  }
  return origins;
}

/**
 * Evaluate whether `LISTING_URL`'s origin is one the control plane's CORS policy will actually
 * answer, as a pure function (FOLLOW-1200 — the same red-first pattern as `evaluateAc1()`).
 *
 * A configured origin outside this list is not a soft warning: the control plane still writes an
 * `adaptation_decisions` row and returns 200, so AC(3) can look green while the BROWSER never sees
 * the response body and AC(1)/AC(2) go red for a reason that has nothing to do with confidence —
 * README §6.2 calls this "the nastiest of the four defects" (L-12, audit 2026-09-13 remark 11).
 *
 * @param {string} listingUrl
 * @param {readonly string[]} allowedOrigins
 * @returns {{ok: boolean, origin: string, reason: string}}
 */
export function evaluateListingOrigin(listingUrl, allowedOrigins) {
  let origin;
  try {
    origin = new URL(listingUrl).origin;
  } catch {
    return {
      ok: false,
      origin: listingUrl,
      reason: `LISTING_URL is not a parseable URL: ${listingUrl}`,
    };
  }
  const ok = allowedOrigins.includes(origin);
  return {
    ok,
    origin,
    reason: ok
      ? `origin ${origin} is in CORS_DEV_EXTRA_ORIGINS [${allowedOrigins.join(', ')}]`
      : `origin ${origin} is NOT in CORS_DEV_EXTRA_ORIGINS [${allowedOrigins.join(', ')}] — the ` +
        'control plane will 200 and log a decision row while the browser is refused the response ' +
        'body (README §6.2). Serve the fixture from an allowlisted origin (:5173).',
  };
}

/**
 * Hard-fail before any session starts when `LISTING_URL`'s origin cannot receive a real response.
 *
 * @returns {Promise<{origin: string, reason: string}>}
 * @throws if the origin is not CORS-allowlisted.
 */
async function assertListingOriginAllowed() {
  const allowedOrigins = await readDevAllowedOrigins();
  const verdict = evaluateListingOrigin(LISTING_URL, allowedOrigins);
  if (!verdict.ok) {
    throw new Error(`LISTING_URL preflight failed: ${verdict.reason}`);
  }
  return { origin: verdict.origin, reason: verdict.reason };
}

/**
 * Evaluate the `/api/adapt` preflight probe's verdict, as a pure function (FOLLOW-1200 — the same
 * red-first pattern as `evaluateAc1()`).
 *
 * The pre-fix predicate checked only `probe.status === 404`, so a 500 `demo_auth_misconfigured` —
 * Turbo silently stripping the Doppler env, README §6.5 — passed as a healthy real control plane
 * (L-1/L-12, audit 2026-09-13 remark 11).
 *
 * @param {{status: number|null, bodyText: string|null, networkError: string|null}} probe
 * @returns {{ok: boolean, reason: string}}
 */
export function evaluateControlPlaneProbe(probe) {
  if (probe.networkError) {
    return { ok: false, reason: `probe network error / timeout: ${probe.networkError}` };
  }
  if (probe.status === 404) {
    return {
      ok: false,
      reason: `404 for POST /api/adapt (status ${probe.status}) — not the real decision route`,
    };
  }
  if (typeof probe.status === 'number' && probe.status >= 500) {
    return {
      ok: false,
      reason:
        `${probe.status} for POST /api/adapt — a server error is not a healthy real control ` +
        `plane (body: ${(probe.bodyText ?? '').slice(0, 200)})`,
    };
  }
  const bodyHasDemoAuthMisconfigured =
    typeof probe.bodyText === 'string' && probe.bodyText.includes('demo_auth_misconfigured');
  const isNon2xx = typeof probe.status === 'number' && (probe.status < 200 || probe.status >= 300);
  if (bodyHasDemoAuthMisconfigured && isNon2xx) {
    return {
      ok: false,
      reason:
        `non-2xx (status ${probe.status}) body carries demo_auth_misconfigured — Turbo stripped ` +
        'DEMO_MODE_JWT_SECRET (README §6.5); this is L-1, not a healthy control plane',
    };
  }
  return {
    ok: true,
    reason: `status ${probe.status} — path served, no demo_auth_misconfigured body`,
  };
}

/**
 * Refuse to run against the `:9100` mock decision harness, and refuse a real control plane that is
 * up but misconfigured (L-1's 500 `demo_auth_misconfigured`).
 *
 * Two independent discriminators against the mock, because either alone could be spoofed by a
 * future mock:
 *   1. the mock serves `GET /mock/status`; the control plane does not;
 *   2. the control plane serves `/api/adapt`; the mock serves `/adapt`.
 *
 * @throws if the decision origin is the mock, is not answering at all, or fails
 *   `evaluateControlPlaneProbe()`.
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

  // Positive control: the real route must exist and be usable. An unauthenticated POST is
  // expected to be rejected (401/403) or to answer 200 — a bounded timeout below so a slow/dead
  // origin fails loud rather than hanging.
  const probe = await fetch(`${DECISION_ORIGIN}/api/adapt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(8000),
  })
    .then(async (res) => ({
      status: res.status,
      bodyText: await res.text().catch(() => null),
      networkError: null,
    }))
    .catch((err) => ({ status: null, bodyText: null, networkError: String(err) }));

  const verdict = evaluateControlPlaneProbe(probe);
  if (!verdict.ok) {
    throw new Error(
      `DECISION_ORIGIN=${DECISION_ORIGIN} failed the real-control-plane probe: ${verdict.reason}. ` +
        'Start (or restart) the real control plane with its Doppler env intact before running ' +
        'this harness — an unhealthy decision endpoint is a RED substrate, never a skip.',
    );
  }
  return { probedStatus: probe.status, probeReason: verdict.reason };
}

// ─── FOLLOW-1200: artefact staleness ─────────────────────────────────────────────────────
//
// `last-run.json` used to carry no notion of WHEN or AT WHAT COMMIT it was produced, so a stale
// artefact from a checkout 27 commits behind could not be told apart from a fresh one (audit
// 2026-09-13 §2 remark 1, A1-9). `startedAt`/`harnessSha` (written into `summary` in `main()`,
// and into the abort handler's partial artefact) are the fix for RECORDING it; the functions
// below are the fix for CHECKING it.

/**
 * The current HEAD SHA, read at run time. `null` when git is unavailable — recorded as-is rather
 * than guessed, so a reader is never told the run happened at a commit it did not.
 *
 * @returns {Promise<string|null>}
 */
async function readHarnessGitSha() {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * `true` iff `sha` is a real ancestor of (or equal to) the current HEAD — `git merge-base
 * --is-ancestor` exit 0. `false` on any other outcome (not an ancestor, unknown SHA, git
 * unavailable); `null` only when `sha` itself is not a usable string, so there is nothing to ask
 * git at all.
 *
 * @param {string|null} sha
 * @returns {Promise<boolean|null>}
 */
async function isGitAncestorOfHead(sha) {
  if (typeof sha !== 'string' || sha.length === 0) return null;
  try {
    await execFileAsync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd: REPO_ROOT });
    return true;
  } catch {
    return false;
  }
}

/**
 * Evaluate artefact staleness, as a pure function (FOLLOW-1200 — the AC(3) staleness gate, the
 * same red-first pattern as `evaluateAc1()`). `isAncestorOfHead` is passed in already resolved,
 * so this stays a predicate over data rather than a live git call.
 *
 * @param {string|null} harnessSha
 * @param {boolean|null} isAncestorOfHead
 * @returns {{ok: boolean, reason: string}}
 */
export function evaluateArtefactStaleness(harnessSha, isAncestorOfHead) {
  if (typeof harnessSha !== 'string' || harnessSha.length === 0) {
    return {
      ok: false,
      reason: 'artefact carries no harnessSha — cannot verify which commit produced it; STALE',
    };
  }
  if (isAncestorOfHead !== true) {
    return {
      ok: false,
      reason:
        `harnessSha ${harnessSha} is not a verified ancestor of HEAD ` +
        `(isAncestorOfHead=${String(isAncestorOfHead)}) — STALE, refusing to grade`,
    };
  }
  return { ok: true, reason: `harnessSha ${harnessSha} is a verified ancestor of HEAD` };
}

/**
 * Read an artefact and print a loud STALE banner — or a FRESH one — per
 * `evaluateArtefactStaleness()`. Invoked via `--check-staleness [path]` (see the foot of this
 * file). Never throws: a grader always gets a verdict line rather than an uncaught rejection.
 *
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function checkArtefactStaleness(path) {
  const raw = await readFile(path, 'utf8').catch((err) => {
    console.error(`[STALE] could not read ${path}: ${String(err)}`);
    return null;
  });
  if (raw === null) return false;
  let artefact;
  try {
    artefact = JSON.parse(raw);
  } catch (err) {
    console.error(`[STALE] ${path} is not valid JSON: ${String(err)}`);
    return false;
  }
  const sha = artefact.harnessSha ?? null;
  const ancestor = await isGitAncestorOfHead(sha);
  const verdict = evaluateArtefactStaleness(sha, ancestor);
  if (verdict.ok) {
    console.log(`[FRESH] ${path}: ${verdict.reason}`);
  } else {
    console.error(
      `\n[STALE] ${path}: ${verdict.reason}. Re-run the harness at HEAD before grading.\n`,
    );
  }
  return verdict.ok;
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
 * FOLLOW-1125 rewrote three things about this function, none of them cosmetic:
 *
 *  1. **It used to CRASH the whole harness.** `sid` is `… ?? … ?? null` at the call site — null
 *     whenever the SDK emitted no event carrying a session id and no adapt response returned one
 *     (SDK failed to boot, consent denied, fixture server dead). `sid.replace()` is evaluated
 *     while BUILDING the argument, so it throws before `chQuery` is ever called and the
 *     `.catch()` on its promise never sees it. `main()` then rejected: no artefact, no
 *     `browser.close()`, no AC tally. That state used to produce a normal RED artefact, so the
 *     regression made it neither red nor skipped — worse than either under this file's Rule Q
 *     posture. It is now an explicit indeterminate.
 *  2. **It used to read `ORDER BY ts LIMIT 1`** — the EARLIEST row — while AC(3) reads the latest
 *     ten. One group per session is true today (`assignHoldout()` is deterministic on
 *     `(tenant_id, session_id)`, the SDK sends no `holdout_pct`, and the consent-skip branch
 *     returns before writing a row), but nothing ASSERTED it, and FOLLOW-1121's own remedy (b) —
 *     a per-tenant `holdout_pct` — is the first change that would break it. It now aggregates and
 *     reports a violation instead of silently picking a row. `ORDER BY ts` was also
 *     non-deterministic among DateTime64 ties.
 *  3. **`null` is now CONSUMED.** It reaches `unmetPreconditions` as an explicit indeterminate and
 *     carries the reason it is indeterminate, so it can no longer be skim-read as "not held out".
 *
 * @param {string|null} sid the browser session's id, or null when the SDK never produced one
 * @returns {Promise<{drewHoldout: boolean|null, reason: string|null, groups: number[], rows: number}>}
 *   `drewHoldout` true = drew holdout, false = adapted, null = not determinable (`reason` says why).
 */
async function measureAdaptedArmHoldout(sid) {
  if (typeof sid !== 'string' || sid.length === 0) {
    return { drewHoldout: null, reason: 'no_session_id', groups: [], rows: 0 };
  }
  const rows = await chQuery(
    `SELECT groupUniqArray(holdout_group) AS groups, count() AS n
     FROM adaptation_decisions
     WHERE session_id = '${sid.replace(/'/g, '')}'`,
  ).catch(() => null);
  if (rows === null) {
    return { drewHoldout: null, reason: 'clickhouse_unreachable', groups: [], rows: 0 };
  }
  const r = rows[0] ?? {};
  const n = Number(r.n ?? 0);
  const groups = (Array.isArray(r.groups) ? r.groups : []).map(Number).sort();
  // Zero rows is NOT "adapted" — it is "the decision row has not landed yet, or never will".
  // The ClickHouse write is fire-and-forget; driveHoldoutArm() polls 15 x 500ms for exactly this.
  if (n === 0)
    return { drewHoldout: null, reason: 'no_decision_rows_for_session', groups, rows: 0 };
  if (groups.length !== 1) {
    return { drewHoldout: null, reason: 'mixed_holdout_group_within_session', groups, rows: n };
  }
  return { drewHoldout: groups[0] === 1, reason: null, groups, rows: n };
}

/**
 * The session-id prefix every synthetic control session this harness mints carries.
 *
 * FOLLOW-1098: this exists so the synthetic control arm is COUNTABLE. `driveHoldoutArm()` mints
 * exactly one such session per run and the rollup window is 7 whole days of the whole substrate,
 * so the number of these rows inside the window is the number of harness runs the reported lift
 * was pooled over — a fact the artefact previously did not carry and a reader could not recover.
 *
 * FOLLOW-1124 — THIS PREFIX IS AN OWNED NAMESPACE, and it is load-bearing rather than cosmetic.
 * Any session id beginning with it is claimed by this harness and COUNTED as one of its synthetic
 * control runs. Nothing enforces that: a hand-run `curl` against the local ingest endpoint with a
 * session id starting `f1075hold-` silently moves a number that appears in a reported artefact.
 * Do not reuse the prefix for anything else, and do not shorten it to something a real session id
 * could collide with. It is deliberately not a UUID prefix for that reason.
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
 * Did THIS RUN's adapted arm convert? — the question AC(5) means, asked about the run under test.
 *
 * ── FOLLOW-1124: WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────────
 * FOLLOW-1098 removed a real tautology (`lift !== null`) and put
 * `adaptedN > 0 && adaptedConversions > 0` in its place. Those counts come from
 * `measureConversionCounts()`, whose ENTIRE filter is `WHERE ad.ts >= now() - toIntervalDay(7)` —
 * no session filter, no tenant filter. So the conjunct asserted *"some adapted session somewhere
 * in the substrate converted in the last seven days"* while MEANING *"this run's adapted arm
 * converted"*. Same shape as the tautology it replaced, one level up: an assertion about a POOL
 * standing in for an assertion about a RUN (Rule AU on region, Rule AV on point-in-time).
 *
 * It was not theoretical. The red-first control that graded FOLLOW-1098 specified a FRESH
 * ClickHouse *"so the 7-day window carried no debris"* — and the §3 runbook never truncates, so
 * the documented substrate is a persistent container. On the recorded green run `adaptedN: 7` and
 * `adaptedConversions: 3` over 7 pooled runs, meaning at least two of the three conversions
 * satisfying the conjunct were produced by EARLIER runs. Compose that with FOLLOW-1122 (a
 * `cta.clicked` batch that left the browser and never arrived, silently) and a run whose own
 * conversion is dropped still reported AC(5) GREEN off its predecessors' rows.
 *
 * Scoping to `session_id` (+ `tenant_id` when known) is what makes AC(5) falsifiable on a
 * substrate that already contains prior runs — i.e. what makes it a gate at all. Per ESC-073
 * FOLLOW-820 condition 1 is the TECHNICAL gate, and a gate that cannot be failed is not a gate.
 *
 * Deliberately NOT windowed by time: the run under test is happening now, and adding a time bound
 * would re-introduce a second way for the assertion to drift away from the run.
 *
 * ⚠️ DELIBERATELY NOT FILTERED BY TENANT — measured 2026-08-25, README §5.5. The first draft
 * added `AND tenant_id = '<tid>'` and it made AC(5) RED on a run that had genuinely converted.
 * The reason is a real property of the system, not a typo: **the SDK reports `tenant_id` as an
 * all-zero UUID**. It does not know the tenant's UUID — the ingest Worker RESOLVES the real tenant
 * from the API key and writes THAT to ClickHouse. So the harness's `tenantId`, which is read back
 * out of the SDK's own emitted events, is `00000000-0000-0000-0000-000000000000`, while every row
 * in `adaptation_decisions` and `events` carries the real `…00e2`. A tenant clause built from the
 * former matches nothing. `session_id` alone is the correct key here, and it is the same key AC(3)
 * and `measureAdaptedArmHoldout()` already use — this function was the outlier.
 *
 * @param {string|null} sid this run's browser session id
 * @returns {Promise<{determinable: boolean, reason: string|null, adaptedDecisions: number,
 *   conversions: number}>}
 */
async function measureThisRunAdaptedArm(sid) {
  const base = { determinable: false, reason: null, adaptedDecisions: 0, conversions: 0 };
  if (typeof sid !== 'string' || sid.length === 0) {
    return { ...base, reason: 'no_session_id' };
  }
  const esc = (v) => String(v).replace(/'/g, '');

  const decisionRows = await chQuery(
    `SELECT count() AS n FROM adaptation_decisions
     WHERE session_id = '${esc(sid)}' AND holdout_group = 0`,
  ).catch(() => null);
  const conversionRows = await chQuery(
    `SELECT count() AS n FROM events
     WHERE session_id = '${esc(sid)}' AND type = 'cta.clicked'`,
  ).catch(() => null);

  if (decisionRows === null || conversionRows === null) {
    return { ...base, reason: 'clickhouse_unreachable' };
  }
  return {
    determinable: true,
    reason: null,
    adaptedDecisions: Number(decisionRows[0]?.n ?? 0),
    conversions: Number(conversionRows[0]?.n ?? 0),
  };
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
 * FOLLOW-1131 — `profile` mirrors the ADAPTED arm's winning archetype onto this control call, and
 * it is load-bearing rather than cosmetic. Without it this session carries no signals at all, so
 * `/adapt` resolves it `neutral` below the confidence gate and returns **zero directives whether or
 * not it drew holdout**. Measured, not assumed: the first red-first run of AC(7)
 * (`holdout_pct: 0`, so the session was NOT held out) still reported `directivesServed: 0`. An
 * assertion that the control arm received nothing would therefore have been satisfied by a session
 * in the ADAPTED arm — vacuous in exactly the way Rule AU names. Mirroring the profile makes
 * holdout assignment the ONLY difference between the two arms, which is what ESC-073 clause 2 says.
 *
 * These are real INPUT fields of `AdaptPostBodySchema`, the same standing the scope note above
 * gives `holdout_pct`; the outputs (`holdout_group`, `directives`) stay computed by production code.
 *
 * @param {{archetype: string|null, confidence: number, similarity: number}|null} profile
 *   the adapted arm's winning state, or null when it never produced one.
 * @returns {Promise<Record<string, unknown>>} diagnostics — never throws.
 */
async function driveHoldoutArm(profile) {
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
    diag.holdoutPctRequested = CONTROL_ARM_HOLDOUT_PCT;
    diag.profileMirrored = profile?.archetype
      ? {
          archetype: profile.archetype,
          confidence: profile.confidence,
          similarity: profile.similarity,
        }
      : null;

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
        holdout_pct: CONTROL_ARM_HOLDOUT_PCT,
        // FOLLOW-1131: mirror the adapted arm so holdout assignment is the ONLY difference.
        ...(profile && profile.archetype
          ? {
              archetype_hint: profile.archetype,
              confidence: profile.confidence,
              similarity: profile.similarity,
            }
          : {}),
      }),
      signal: AbortSignal.timeout(15000),
    });
    diag.adaptStatus = adaptRes.status;
    const adaptBody = await adaptRes.json().catch(() => null);
    diag.adaptDecisionId = adaptBody?.adapt_decision_id ?? null;

    // FOLLOW-1131: the control arm's directive count, straight off the response the harness
    // already had in hand. ESC-073 clause 2 — "a control session receives no directives and an
    // adapted session does" — is HALF of FOLLOW-820 condition 1, and until now this line was the
    // one thing standing between the harness and asserting it: `adaptBody` was parsed and only
    // `adapt_decision_id` was read out of it. `null` (not 0) when the body did not parse, so
    // "the response was unreadable" cannot masquerade as "the response carried no directives".
    diag.adaptDirectiveCount = Array.isArray(adaptBody?.directives)
      ? adaptBody.directives.length
      : null;

    // The ClickHouse write is fire-and-forget behind after() (route.ts ~:1652) — poll rather
    // than trust the 200, mirroring AC(4)'s poll for the identical reason.
    //
    // FOLLOW-1131: `directive_count` is selected alongside `holdout_group` because it is a column
    // of THIS row. A second query would be a second chance to race the after() write and could
    // read a different row than the one that produced `loggedHoldoutGroup`.
    let rowFound = false;
    for (let i = 0; i < 15; i++) {
      await sleep(500);
      const rows = await chQuery(
        `SELECT holdout_group, directive_count FROM adaptation_decisions WHERE session_id = ` +
          `'${holdoutSessionId.replace(/'/g, '')}' LIMIT 1`,
      ).catch(() => []);
      if (rows.length > 0) {
        rowFound = true;
        diag.loggedHoldoutGroup = rows[0].holdout_group;
        diag.loggedDirectiveCount = Number(rows[0].directive_count);
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
  // FOLLOW-1200: captured before anything that can throw, so the abort handler can carry them.
  startedAt = new Date().toISOString();
  harnessSha = await readHarnessGitSha();

  const originPreflight = await assertListingOriginAllowed();
  const serverGate = await readServerConfidenceGate();
  const preflight = await assertRealControlPlane();
  console.log(
    `[preflight] LISTING_URL origin ${originPreflight.origin} is CORS-allowlisted; real control ` +
      `plane confirmed at ${DECISION_ORIGIN} (POST /api/adapt → ${String(preflight.probedStatus)}, ` +
      `${preflight.probeReason}); server gate = confidence ` +
      `${serverGate.comparison === '<=' ? '>' : '>='} ${String(serverGate.value)} (${serverGate.source})\n`,
  );

  const browser = await chromium.launch({ headless: HEADLESS });
  activeBrowser = browser; // FOLLOW-1125: teardown must not depend on reaching the end of main()
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

  // ── AC(1): an LLM-ADAPTED response — see evaluateAc1(); a template cta is not adaptation ──
  const allResponses = decided.filter((d) => d.body).map((d) => d.body);
  const best = allResponses.reduce(
    (acc, b) => ((b.confidence ?? 0) > (acc?.confidence ?? -1) ? b : acc),
    null,
  );
  const totalDirectives = allResponses.reduce(
    (n, b) => n + (Array.isArray(b.directives) ? b.directives.length : 0),
    0,
  );
  // FOLLOW-1186: the verdict is evaluateAc1()'s, over the same population the locals above read.
  // Those locals stay because AC(2)/AC(7) and the holdout arm consume them; they are not AC(1).
  const ac1 = evaluateAc1(allResponses, serverGate);
  record(
    'AC(1)',
    `LLM-adapted /adapt response on the real control plane — counted: ${ac1.summary}`,
    ac1.ok,
    {
      ...ac1.evidence,
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
  //
  // FOLLOW-1138: a red here used to conflate two unrelated causes -- low confidence (AC(1))
  // and a page-type misclassification stripping the headline directive server-side -- and a
  // future reader had to re-derive which one from `changedSlots` alone. `resolvedPageType` and
  // `servedSlots` name the cause directly: `page_context` (1 = listing_list/search/home, 2 =
  // listing_detail -- `directives.ts`) is what `filterDirectivesByPageType()`
  // (`route.ts:1269`) actually gated the `headline` slot on, and `servedSlots` is every slot
  // the real responses carried, independent of whether the fixture's DOM changed.
  const after = await readSlots();
  const changed = after.filter((a, i) => baseline[i] && baseline[i].text !== a.text);
  const pageContextsSeen = [...new Set(allResponses.map((b) => b.page_context))];
  const resolvedPageType =
    pageContextsSeen.length === 1
      ? pageContextsSeen[0] === 2
        ? 'listing_detail'
        : pageContextsSeen[0] === 1
          ? 'listing_list_or_home_or_search'
          : null
      : 'MIXED_ACROSS_CALLS';
  const servedSlots = [
    ...new Set(
      allResponses.flatMap((b) =>
        Array.isArray(b.directives) ? b.directives.map((d) => d.slot ?? d.type) : [],
      ),
    ),
  ];
  record(
    'AC(2)',
    'at least one [data-estalara-slot] observably changed in the live DOM',
    changed.length > 0,
    {
      before: baseline,
      after,
      changedSlots: changed.map((c) => c.slot),
      // FOLLOW-1138: names the cause of a red directly instead of leaving it to be re-derived.
      resolvedPageType,
      pageContextsSeen,
      servedSlots,
      fixtureSlots: [...new Set(baseline.map((s) => s.slot))],
    },
  );

  // Session identity for the data-side assertions — taken from what the SDK actually sent.
  const sessionId =
    emitted.flatMap((e) => e.body?.events ?? []).find((ev) => ev.session_id)?.session_id ??
    best?.session_id ??
    null;
  // ⚠️ This is what the SDK CLAIMS, and the SDK does not know the tenant's UUID — it reports an
  // all-zero one and the ingest Worker resolves the real tenant from the API key (README §5.5).
  // Kept in the artefact because that contradiction is how the §5.5 defect was diagnosed; do NOT
  // build a ClickHouse predicate from it.
  const tenantId =
    emitted.flatMap((e) => e.body?.events ?? []).find((ev) => ev.tenant_id)?.tenant_id ?? null;

  // ── FOLLOW-1075: click the REAL CTA in this (adapted/non-holdout) session ──────────────
  // AC(5)'s join needs a `cta.clicked` events row under THIS session_id. Clicking a
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
  // FOLLOW-1125 — BOTH RATIONALES THAT USED TO BE WRITTEN HERE WERE FALSE, and are removed
  // rather than reworded, because a false reason for a call site is worse than none:
  //   * "AFTER AC(3) has already POLLED the browser session's rows into existence" — AC(3) does
  //     not poll. It is a single `chQuery`. So the indeterminate branch below is reachable
  //     exactly when the fire-and-forget ClickHouse write is merely SLOW — which is the case
  //     driveHoldoutArm() polls 15 x 500ms for, and this call site does not.
  //   * "read this BEFORE minting the synthetic control session, so the query cannot be confused
  //     by it" — inert. The query filters on the browser session_id and could not be confused by
  //     the synthetic session in ANY ordering.
  // What IS true about the position: it must run after the adapt call that writes the row, and
  // the indeterminate case is real rather than hypothetical. Both are handled explicitly now.
  const adaptedArmHoldout = await measureAdaptedArmHoldout(sessionId);
  const adaptedArmDrewHoldout = adaptedArmHoldout.drewHoldout;
  if (adaptedArmDrewHoldout === true) {
    console.log(
      `\n[FOLLOW-1098] ⚠ THE ADAPTED ARM DREW HOLDOUT. The real assignHoldout() put the browser ` +
        `session (${String(sessionId)}) in the CONTROL arm, so it received zero directives by ` +
        `design. AC(1)/AC(2)/AC(5) are UNMEASURED on the adapted axis for this run — NOT failed. ` +
        `Re-run.`,
    );
  } else if (adaptedArmDrewHoldout === null) {
    console.log(
      `\n[FOLLOW-1125] ⚠ ADAPTED-ARM ASSIGNMENT INDETERMINATE (${String(adaptedArmHoldout.reason)}). ` +
        `This is NOT "the arm was adapted" — it is "the harness could not tell". AC(5) records it ` +
        `as an explicit indeterminate rather than letting it read as false.`,
    );
  }

  // FOLLOW-1124: the run-scoped answer to the question AC(5) actually means. Taken BEFORE
  // driveHoldoutArm() mints the synthetic control session — not because that session could be
  // confused with this one (it could not), but so the ordering of the two reads is fixed and a
  // future reader does not have to reason about it.
  const thisRunAdaptedArm = await measureThisRunAdaptedArm(sessionId);

  console.log('\n[FOLLOW-1075] driving a real holdout-arm session…');
  // FOLLOW-1131: hand the control call the adapted arm's own winning profile — see the docblock.
  // `similarity` is not echoed on the response, so it is taken from the same place the SDK takes
  // it (the archetype's own probability) and defaults below HIGH_SIMILARITY_THRESHOLD (0.85) so the
  // call takes the generate/tweak branch the real adapted session took, not the playbook-direct one.
  const controlProfile = best?.archetype
    ? {
        archetype: best.archetype,
        confidence: best.confidence ?? 0,
        similarity: typeof best.similarity === 'number' ? best.similarity : 0.5,
      }
    : null;
  const holdoutArmDiag = await driveHoldoutArm(controlProfile);
  console.log(`[FOLLOW-1075] holdout arm: ${JSON.stringify(holdoutArmDiag)}`);

  // ── AC(7) — ESC-073 clause 2: the holdout MECHANISM demonstrably separates the two arms ──────
  //
  // This is the artefact FOLLOW-820 condition 1's SECOND clause is graded on, in the CEO's words:
  // "a control session receives no directives and an adapted session does". Until FOLLOW-1131 the
  // harness measured both halves and asserted neither — `driveHoldoutArm()` parsed the control
  // response and read only `adapt_decision_id` from it, and `directive_count` sat unread in a row
  // the poll already returned. A 5/5 run therefore did not discharge condition 1.
  //
  // It is NOT the business proof (that is FOLLOW-1130, which deliberately does not gate GO) and it
  // says nothing about lift. It answers one question: if we split traffic tomorrow, do the two
  // arms actually differ? A broken assignment makes every post-GO measurement garbage silently.
  //
  // Both directions are asserted, because either alone is satisfiable by a broken system: a
  // control arm with no directives is what a TOTALLY dead adapt path also looks like.
  const controlDirectivesServed = holdoutArmDiag.adaptDirectiveCount;
  const controlDirectivesLogged = holdoutArmDiag.loggedDirectiveCount;
  const separationUnmet = [];

  if (holdoutArmDiag.attempted !== true) separationUnmet.push('controlArmNotAttempted');
  if (holdoutArmDiag.error !== undefined)
    separationUnmet.push(`controlArmError=${String(holdoutArmDiag.error)}`);
  if (holdoutArmDiag.adaptStatus !== 200)
    separationUnmet.push(`controlAdaptStatus=${String(holdoutArmDiag.adaptStatus)}`);
  // Rule Q: an unreachable ClickHouse or a row that never landed is RED, never a soft skip and
  // never "the control session received no directives" — those are different facts.
  if (holdoutArmDiag.decisionRowFound !== true) separationUnmet.push('controlDecisionRowAbsent');
  if (typeof controlDirectivesServed !== 'number')
    separationUnmet.push('controlServedDirectivesUnreadable');
  if (typeof controlDirectivesLogged !== 'number' || Number.isNaN(controlDirectivesLogged)) {
    separationUnmet.push('controlLoggedDirectiveCountUnreadable');
  }
  // Without this the assertion is vacuous: if the "control" session did not actually draw holdout,
  // then whatever it received says nothing about arm SEPARATION. This is also the conjunct the
  // red-first control trips.
  if (holdoutArmDiag.loggedHoldoutGroup !== true) {
    separationUnmet.push(
      `controlArmDidNotDrawHoldout=${String(holdoutArmDiag.loggedHoldoutGroup)}`,
    );
  }
  if (CONTROL_ARM_HOLDOUT_PCT !== 1) {
    separationUnmet.push(`redFirstKnobEngaged:holdout_pct=${String(CONTROL_ARM_HOLDOUT_PCT)}`);
  }
  // The anti-vacuity conjunct, and the reason the profile is mirrored at all. If the control call
  // went out with no adaptable archetype, it would have received zero directives REGARDLESS of its
  // arm, and "the control arm received zero" would assert nothing about separation. Measured on the
  // first red-first run — see driveHoldoutArm()'s docblock. RED, not skipped: an assertion that
  // cannot fail must not be allowed to pass.
  if (!controlProfile || !controlProfile.archetype || controlProfile.archetype === 'neutral') {
    separationUnmet.push('controlProfileNotAdaptable:separationWouldBeVacuous');
  }

  const armsSeparated =
    separationUnmet.length === 0 &&
    controlDirectivesServed === 0 &&
    controlDirectivesLogged === 0 &&
    totalDirectives > 0;

  record(
    'AC(7)',
    'the holdout mechanism SEPARATES the arms: the control session received ZERO directives and the adapted session received > 0 (ESC-073 clause 2 / FOLLOW-820 condition 1)',
    armsSeparated,
    {
      DISCHARGES: 'ESC-073 clause 2 — the second half of FOLLOW-820 condition 1',
      NOT_A_LIFT_CLAIM:
        'This asserts arm SEPARATION, not efficacy. It says nothing about whether adaptation ' +
        'converts better — that is FOLLOW-1130, which does not gate GO.',
      controlArm: {
        sessionId: holdoutArmDiag.holdoutSessionId ?? null,
        holdoutPctRequested: CONTROL_ARM_HOLDOUT_PCT,
        // Mirrored from the adapted arm so holdout assignment is the ONLY difference between them.
        profileMirrored: holdoutArmDiag.profileMirrored ?? null,
        drewHoldout: holdoutArmDiag.loggedHoldoutGroup ?? null,
        directivesServed: controlDirectivesServed ?? null,
        directiveCountLogged: controlDirectivesLogged ?? null,
      },
      adaptedArm: {
        sessionId,
        // AC(1)'s own count, referenced rather than re-derived, so the two cannot drift.
        directivesServed: totalDirectives,
      },
      unmetPreconditions: separationUnmet,
    },
  );

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
    // product reasons. FOLLOW-1139: this comment used to add "FOLLOW-820 condition 1 needs a
    // POSITIVE lift over a REAL control and this harness cannot produce one" — ESC-073 (CEO
    // ruling, merged 4dbff0aa) abolished that requirement in as many words: "Condition 1 does
    // NOT require a positive lift, and never did." FOLLOW-1133 corrected README §0 and was
    // scoped to §0; the same superseded claim survived here and in `nNote` below, which lands
    // in every `last-run.json` the FOLLOW-820 grader reads. The rest of this paragraph stands:
    // `ctaLift` is still non-positive by construction and still must not be graded.
    const countsUsable = Boolean(conversionCounts && !conversionCounts.error);

    // ── FOLLOW-1124: THE CONJUNCT IS SCOPED TO THIS RUN, NOT TO THE POOL ───────────────────
    // FOLLOW-1098's version read the 7-day whole-substrate counts, so it asserted "some adapted
    // session somewhere converted this week" while meaning "this run's adapted arm converted" —
    // and on the documented (persistent) substrate a run whose own conversion was dropped stayed
    // green off its predecessors' rows. `measureThisRunAdaptedArm()` asks the question about the
    // session under test. `determinable` is a conjunct too: "could not read ClickHouse" and
    // "no session id" are NOT evidence that the arm converted.
    const adaptedArmConverted =
      thisRunAdaptedArm.determinable &&
      thisRunAdaptedArm.adaptedDecisions > 0 &&
      thisRunAdaptedArm.conversions > 0;
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
    // ── FOLLOW-1124: the run-scoped conjuncts, which are the ones the verdict now turns on ──
    // The pooled entries above stay because they explain `ctaLift`'s VALUE. These explain the
    // VERDICT, and they are named separately so a reader can tell which is which.
    if (!thisRunAdaptedArm.determinable) {
      unmetPreconditions.push(`thisRun=indeterminate(${String(thisRunAdaptedArm.reason)})`);
    } else {
      if (thisRunAdaptedArm.adaptedDecisions === 0) {
        unmetPreconditions.push('thisRunAdaptedDecisions=0');
      }
      if (thisRunAdaptedArm.adaptedDecisions > 0 && thisRunAdaptedArm.conversions === 0) {
        unmetPreconditions.push('thisRunConversions=0');
      }
    }
    // FOLLOW-1098: when the browser session drew holdout there IS no adapted arm this run, so
    // a zero conversion count above is a consequence, not a cause. Naming the cause is what stops
    // the next reader from filing a differentiator bug against a coin flip.
    if (adaptedArmDrewHoldout === true) unmetPreconditions.push('adaptedArmDrewHoldout=true');
    // FOLLOW-1125: `null` used to be produced and never consumed — it rendered above `results` as
    // `"adaptedArmDrewHoldout": null`, which skim-reads as "not held out". It is an explicit
    // indeterminate now, and it carries WHY.
    if (adaptedArmDrewHoldout === null) {
      unmetPreconditions.push(
        `adaptedArmDrewHoldout=indeterminate(${String(adaptedArmHoldout.reason)})`,
      );
    }
    // FOLLOW-1125: the -1 sentinel was produced and never consumed either.
    if (syntheticControlRuns === -1)
      unmetPreconditions.push('syntheticControlRunsInWindow=unavailable');

    record(
      'AC(5)',
      "the existing analytics path computed a lift from real localhost-substrate rows (data_source='clickhouse', NOT the seededRandom mock) AND THIS RUN's adapted session produced at least one real cta.clicked (FOLLOW-1124 — scoped to this session_id, not to the 7-day pool) — NOT an assertion that the lift is positive or directional",
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
          // FOLLOW-1125: why it is null, and the evidence the one-group-per-session invariant
          // still holds. `groups` with more than one entry means FOLLOW-1121's remedy (b) landed
          // and this read needs revisiting — it is reported, never silently resolved.
          drewHoldoutDetail: adaptedArmHoldout,
          // ── FOLLOW-1124: the verdict's actual subject ────────────────────────────────────
          // What THIS run's session did, as opposed to what the 7-day pool did. `conversions` is
          // the number the artefact previously could not supply: how many of the pooled
          // `adaptedConversions` belong to the run being reported.
          thisRun: thisRunAdaptedArm,
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
          syntheticControlRunsCountable: syntheticControlRuns !== -1,
          windowNote:
            `This lift is a ${String(ROLLUP_WINDOW_DAYS)}-day rollup over the WHOLE substrate, not a ` +
            'per-run experiment. syntheticControlRunsInWindow is how many harness runs are pooled ' +
            'into it; -1 means the count could not be taken, syntheticControlRunsCountable says so ' +
            'without the reader having to know the sentinel, and it is surfaced in ' +
            'unmetPreconditions (FOLLOW-1125). Consecutive runs change the value with no product ' +
            'change whatsoever. FOLLOW-1124: the VERDICT no longer reads this pool at all — see ' +
            'adaptedArm.thisRun for the run-scoped counts the verdict turns on.',
          verdictSubject:
            'FOLLOW-1124: AC(5) passes on adaptedArm.thisRun (session-scoped), NOT on ' +
            'conversionCounts (7-day whole-substrate pool). The pooled counts remain to explain ' +
            "ctaLift's VALUE; they no longer carry the verdict.",
          nSupportsDirectionalClaim: false,
          nNote:
            'rollup.sessions counts an accumulated pool, not an experimental N. Do NOT run a ' +
            'significance test on it: the arms are not sampled from one population, the control is ' +
            'certain to convert, and a nominal p-value computed over these counts would be an ' +
            'artefact of the harness. FOLLOW-820 condition 1 does NOT require a positive lift and ' +
            'never did (ESC-073) — it is the TECHNICAL gate: the chain runs on real data (AC(1)-' +
            'AC(5)) and the holdout mechanism separates the arms (AC(7)). The business proof is ' +
            'FOLLOW-1130 and does not gate GO. Do not grade this number (README §0).',
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
    // FOLLOW-1200: the DateTime64-trailing-`Z` hint that used to sit here (audit 2026-09-13
    // remark 1 A1-9) named a defect FOLLOW-853 already fixed — both ingest writers encode via
    // `toClickHouseDateTime64()` (`clickhouse-producer.ts`), which strips `T`/`Z`, and no file
    // named `intent-snapshot.ts` exists at the path the hint cited. Deleted rather than
    // corrected: a wrong "check X" pointer is worse than none once X is fixed.
  } catch (err) {
    console.log(`[substrate] could not read ClickHouse counts: ${String(err)}`);
  }

  const summary = {
    ranAt: new Date().toISOString(),
    // FOLLOW-1200: so a stale artefact can be told apart from a fresh one — see
    // `evaluateArtefactStaleness()` / `checkArtefactStaleness()` below.
    startedAt,
    harnessSha,
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

// ── FOLLOW-1125: the harness must produce an artefact on EVERY path ────────────────────────────
// The specific regression this closes: `measureAdaptedArmHoldout(sessionId)` was awaited at the
// top level of main() with a `sessionId` that is `… ?? null`, so a run in which the SDK emitted
// nothing (failed to boot, consent denied, fixture server dead) threw inside main() — producing no
// artefact, no AC tally, no `RED:` line and a leaked Chromium. That state used to yield a normal
// RED artefact. The null-safety in measureAdaptedArmHoldout() fixes the specific cause; this
// handler fixes the CLASS, because the next such call site would otherwise fail the same way.
//
// It deliberately does NOT swallow the failure: the abort is recorded as a failed pseudo-AC so it
// appears in the tally, and the exit code stays non-zero.
//
// FOLLOW-1186: `ac1-verdict.test.ts` imports `evaluateAc1` from this file, so an import must not
// launch a browser or overwrite `last-run.json`. The opt-out is a global the importer sets BEFORE
// importing, never a guess about `process.argv[1]`: a direct `node` run cannot set it, so this
// line cannot silently turn the manual run into a no-op that exits 0 (Rule Q amendment 1 cl. 7).
//
// FOLLOW-1200: `--check-staleness [path]` is a second entry point into this SAME file (never a
// second guard mechanism — it still respects FOLLOW1186_IMPORT_ONLY) so a grader can ask "is this
// artefact still real?" without running the browser session at all.
if (globalThis.FOLLOW1186_IMPORT_ONLY !== true) {
  if (process.argv[2] === '--check-staleness') {
    const ok = await checkArtefactStaleness(process.argv[3] ?? SESSION_JSON);
    process.exitCode = ok ? 0 : 1;
  } else {
    try {
      await main();
    } catch (err) {
      console.error(
        `\n[FOLLOW-1125] HARNESS ABORTED: ${String(err && err.stack ? err.stack : err)}`,
      );
      record('HARNESS', 'the harness ran to completion without throwing', false, {
        error: String(err),
        stack: String(err && err.stack ? err.stack : ''),
        note:
          'The run ABORTED before its normal artefact write, so every AC below this point was ' +
          'never evaluated — they are UNMEASURED, not green and not red. Do not read the tally ' +
          'as a result.',
      });
      await writeFile(
        SESSION_JSON,
        JSON.stringify(
          {
            aborted: true,
            abortedAt: new Date().toISOString(),
            startedAt,
            harnessSha,
            error: String(err),
            results,
            note:
              'FOLLOW-1125: partial artefact written by the abort handler. It exists so that a ' +
              'crashed run cannot leave a STALE artefact from a previous run looking like this ' +
              'run’s result.',
          },
          null,
          2,
        ),
      ).catch((writeErr) => {
        console.error(`[FOLLOW-1125] could not write the abort artefact: ${String(writeErr)}`);
      });
      process.exitCode = 1;
    } finally {
      if (activeBrowser) await activeBrowser.close().catch(() => {});
    }
  }
}
