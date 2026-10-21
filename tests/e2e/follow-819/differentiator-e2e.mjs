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
 * DEPENDS ON FOLLOW-1201 (PR #902): the control arm sends the `ADAPT_API_KEY` ops bearer (the only
 * caller whose `holdout_pct` #902 honours) and its ingest call carries `Origin` (#902 refuses an
 * unsigned caller without one). `main()` refuses to start without `ADAPT_API_KEY`. Against a `main`
 * without #902 the control arm's `/api/adapt` call answers 401 and AC(7) is red; see
 * `driveHoldoutArm()`.
 *
 * NO ASSERTION IN THIS FILE MAY BE SKIPPED. An absent substrate is RED, never "skipped" —
 * every AC below fails loud when its dependency is missing, and the process exits non-zero.
 *
 * Usage (from repo root, after the §3 bring-up in the README):
 *   node tests/e2e/follow-819/differentiator-e2e.mjs
 * Before grading any artefact (README §3.6; exit 0 = FRESH, 1 = anything else):
 *   node tests/e2e/follow-819/differentiator-e2e.mjs --check-staleness [path] [--allow-stale]
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
 * (`npx serve -l 5173 …`) and the one origin the constant browser-origin list accepts outside
 * production alongside `:3000` itself (`packages/shared/src/browser-origins.ts`, FOLLOW-1333). The old `:9200` default was CORS-refused (README §6.2): the server
 * still answers 200 and logs a decision row, so AC(3) could look green while the browser never saw
 * the response body and AC(1)/AC(2) went red for a reason that had nothing to do with confidence.
 * `assertRealControlPlane()` below is the hard stop for any OTHER misconfiguration of this variable:
 * since FOLLOW-1206 its probe carries this origin and requires the running control plane to echo it
 * in `access-control-allow-origin`, so it does not depend on the default alone being right.
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
/**
 * The artefact path. FOLLOW-1205: the default is resolved against THIS file, not the caller's cwd,
 * so `--check-staleness` with no path reads the same `last-run.json` a run wrote wherever it is
 * invoked from (RETRO-326 §4a LG-1 item 3). An explicit `SESSION_JSON` is taken as given.
 */
const SESSION_JSON =
  process.env.SESSION_JSON ?? fileURLToPath(new URL('./last-run.json', import.meta.url));

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

/**
 * FOLLOW-1203 red-first knob, same standing as `FOLLOW1131_CONTROL_HOLDOUT_PCT` above. `1` makes
 * the adapted session's conversion a BROWSER-class `inquiry.completed` (page key + `Origin`, no
 * signature — what the SDK itself emits and what any visitor can forge) instead of the signed one
 * the fixture host backend emits. Ingest accepts it (ESC-084 ruling 2) and the lift must NOT count
 * it, so AC(5) must go RED with `thisRunConversionLoss=only_unsigned_conversion`. Never silent: the
 * mode is in `adaptedArm.confirmedConversion.mode` and AC(5) refuses to pass under it.
 */
const REDFIRST_UNSIGNED_CONVERSION = process.env.FOLLOW1203_REDFIRST_UNSIGNED_CONVERSION === '1';

/** Consent key the SDK reads (`packages/sdk/src/core/session.ts` CONSENT_STORAGE_KEY). */
const CONSENT_STORAGE_KEY = 'estalara_consent';

/** The one file that defines whether a decision response carries directives at all. */
const ADAPT_ROUTE_PATH = new URL(
  '../../../apps/control-plane/src/app/api/adapt/route.ts',
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
/** FOLLOW-1240: the verdict word each AC's line printed, so a later reclassification is announced. */
const printedVerdicts = new Map();

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
/** FOLLOW-1205: `{dirty, dirtyPaths}` at run start — see `readHarnessTreeState()`. */
let harnessTree = null;
/**
 * FOLLOW-1225: what the preflight found at the grounding origin, so `last-run.json` records WHICH
 * facts the LLM branch could see. A reader of §5.10's artefact could not tell a run with grounding
 * from a run without it except by inference from `fallback_reason`.
 */
let groundingSource = null;

/**
 * Record one INDEPENDENT acceptance-criterion result.
 *
 * @param {string} ac   - Acceptance-criterion id, e.g. 'AC(1)'.
 * @param {string} name - What was asserted, in one line.
 * @param {boolean} ok  - Whether it held.
 * @param {unknown} evidence - The observation the verdict rests on.
 * @param {'holdout'|'window'|'config'|null} [unmeasured] - FOLLOW-1240: when the predicate failed for a reason
 *        already known at record time, the line prints `[UNMEASURED]` instead of `[FAIL]`. `ok` is
 *        stored unchanged; the final grade is `gradeRun()`'s, over the same facts.
 */
function record(ac, name, ok, evidence, unmeasured = null) {
  results.push({ ac, name, ok, evidence });
  const label = ok ? 'PASS' : unmeasured ? `UNMEASURED:${unmeasured}` : 'FAIL';
  printedVerdicts.set(ac, ok ? 'PASS' : unmeasured ? 'UNMEASURED' : 'FAIL');
  console.log(`[${label}] ${ac} — ${name}`);
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

/** A response body's directives, `[]` when absent or malformed. */
const directivesOf = (b) => (Array.isArray(b?.directives) ? b.directives : []);

/** The slots of every directive that is not the POST handler's `reorder`. */
const nonReorderSlots = (b) =>
  directivesOf(b)
    .filter((d) => d && d.type !== 'reorder')
    .map((d) => d.slot ?? d.type ?? '?');

/**
 * AC(1)'s qualifying predicate over ONE response — the single definition. `evaluateAc1()`,
 * `evaluateAc7()`, `selectProfileResponse()` and `attributePaintedSlots()` all call it, so "an
 * adapted response" cannot mean one thing in AC(1) and another in AC(7) (FOLLOW-1196). The
 * conjuncts and the reason each one binds to the same response are in `evaluateAc1()`'s docblock.
 *
 * @param {unknown} b - One parsed `/api/adapt` body.
 * @param {{value: number}} serverGate
 * @returns {boolean}
 */
function isAdaptedResponse(b, serverGate) {
  return (
    b !== null &&
    typeof b === 'object' &&
    ADAPTED_SOURCES.has(b.source) &&
    Boolean(b.archetype) &&
    b.archetype !== 'neutral' &&
    (b.confidence ?? 0) > serverGate.value &&
    nonReorderSlots(b).length > 0
  );
}

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
 *     run's neutral `default` response carried one — so it says nothing about adaptation (since
 *     FOLLOW-1202 it is appended only when every listing has a cosine score, and withheld
 *     otherwise, so its ABSENCE says nothing about adaptation either). An
 *     `llm_*` response whose text directives `filterDirectivesByPageType()` stripped is not an
 *     adapted listing either.
 * The old predicate took its confidence from the highest-confidence response and its directive
 * count from ALL responses, so a neutral response's `reorder` could supply the count for a
 * template response's confidence.
 *
 * WHAT FOLLOW-820 CONDITION 1 GRADES: `outcomes.adapted` only, and it is the count of responses that
 * pass `isAdaptedResponse()` — the same count as `adaptedResponses.length`, so
 * `ok === (outcomes.adapted > 0)` by construction. FOLLOW-1205 (architect finding): it used to count
 * every `llm_*` source, so the field `docs/MASTER_DESIGN.md` and README §0 name as the grade could
 * read 1 on a run whose verdict was RED (an `llm_tweaked` response left with only a `reorder`). The
 * FIELD was changed rather than the pointer because those two documents cite it by name. An `llm_*`
 * response that fails any conjunct is now `llmNotQualifying`. `refused`, `outage` (every other
 * `playbook_fallback_*` reason), `template` and `default` are REPORTED so a red names its cause, and
 * none of them can turn AC(1) green. An empty population is RED (Rule Q amendment 1 clause 5).
 *
 * @param {ReadonlyArray<Record<string, any>>} responses - Parsed `/api/adapt` bodies, in order.
 * @param {{value: number}} serverGate - From `readServerConfidenceGate()`.
 * @returns {{ok: boolean, summary: string, evidence: Record<string, unknown>}} `summary` is built
 *          from the counted population, never a literal — it is what the PASS/FAIL line prints.
 */
export function evaluateAc1(responses, serverGate) {
  const bodies = responses.filter((b) => b !== null && typeof b === 'object');

  const outcomes = {
    adapted: 0,
    llmNotQualifying: 0,
    refused: 0,
    outage: 0,
    template: 0,
    default: 0,
    other: 0,
  };
  const sourcesObserved = {};
  for (const b of bodies) {
    const key = b.fallback_reason
      ? `${String(b.source)}/${String(b.fallback_reason)}`
      : String(b.source);
    sourcesObserved[key] = (sourcesObserved[key] ?? 0) + 1;
    if (ADAPTED_SOURCES.has(b.source)) {
      if (isAdaptedResponse(b, serverGate)) outcomes.adapted += 1;
      else outcomes.llmNotQualifying += 1;
    } else if (typeof b.source === 'string' && b.source.startsWith('playbook_fallback_')) {
      if (b.fallback_reason === 'fact_check_refused') outcomes.refused += 1;
      else outcomes.outage += 1;
    } else if (b.source === 'playbook') outcomes.template += 1;
    else if (b.source === 'default') outcomes.default += 1;
    else outcomes.other += 1;
  }

  const qualifying = bodies.filter((b) => isAdaptedResponse(b, serverGate));
  const ok = qualifying.length > 0;

  // The pre-FOLLOW-1186 fields, unchanged in meaning, so earlier artefacts stay comparable.
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
      // FOLLOW-1196 (RETRO-325 TG-3): the population THIS verdict graded. `decided[]` keeps growing
      // after AC(1) runs, so replaying the artefact's `decided[]` can grade more bodies than the
      // live verdict saw; this number is what the live verdict saw.
      evaluatedResponseCount: bodies.length,
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

// ─── FOLLOW-1196: the other consumers of "an adapted response", as pure functions ───────

/**
 * Pick the ONE response that AC(4)'s feedback ping credits and AC(7)'s control call mirrors.
 *
 * Before FOLLOW-1196 this was the highest-confidence response, whatever its `source`. A template
 * or refused response at confidence 1 that arrived first therefore won, so AC(1) cited response B
 * while AC(4) moved the bandit arm of response A (post-FOLLOW-1163 a withheld response records
 * `variant: 'control'`) and AC(7) mirrored A's profile (a branch-2 `similarity 0.8552` sends the
 * control call down branch 2). RETRO-325 §4a LG-2.
 *
 * SELECTION RULE AND TIE-BREAK:
 *   1. When any response passes `isAdaptedResponse()`, the FIRST such response in arrival order.
 *      That is the body AC(1)'s summary cites as `first:`, so all three ACs name one response.
 *      Arrival order is the tie-break: two adapted responses at equal confidence resolve to the
 *      earlier one, and a later, higher-confidence adapted response does not displace it.
 *   2. Otherwise `highest_confidence_fallback`: the pre-FOLLOW-1196 rule, unchanged. Strict `>`
 *      keeps the EARLIEST response among equal confidences. This branch is reachable only on a
 *      run in which AC(1) and AC(7) are already RED, and `basis` records that it was taken.
 *   3. `no_responses` when the population is empty.
 *
 * @param {ReadonlyArray<unknown>} responses - Parsed `/api/adapt` bodies, in arrival order.
 * @param {{value: number}} serverGate
 * @returns {{response: Record<string, any>|null, index: number,
 *   basis: 'first_adapted_response'|'highest_confidence_fallback'|'no_responses'}}
 */
export function selectProfileResponse(responses, serverGate) {
  const adaptedIndex = responses.findIndex((b) => isAdaptedResponse(b, serverGate));
  if (adaptedIndex !== -1) {
    return {
      response: responses[adaptedIndex],
      index: adaptedIndex,
      basis: 'first_adapted_response',
    };
  }
  let index = -1;
  responses.forEach((b, i) => {
    if (b === null || typeof b !== 'object') return;
    if (index === -1 || (b.confidence ?? 0) > (responses[index].confidence ?? 0)) index = i;
  });
  return index === -1
    ? { response: null, index: -1, basis: 'no_responses' }
    : { response: responses[index], index, basis: 'highest_confidence_fallback' };
}

/**
 * The profile the control call is sent with, derived from ONE response. `main()` uses this to
 * build the control call and `evaluateAc7()` uses it to check that the call mirrored the response
 * AC(1) counted, so the derivation cannot drift between the two.
 *
 * `similarity` IS echoed on the POST response (`route.ts` `response: AdaptationDirectives`
 * literal), so it is read from the response. The `0.5` default applies only to a body that carries
 * none.
 *
 * @param {Record<string, any>|null} b
 * @returns {{archetype: string, confidence: number, similarity: number}|null}
 */
function toControlProfile(b) {
  return b?.archetype
    ? {
        archetype: b.archetype,
        confidence: b.confidence ?? 0,
        similarity: typeof b.similarity === 'number' ? b.similarity : 0.5,
      }
    : null;
}

/**
 * The REACHABILITY_FINDING numbers for one arm (arm A: behaviour alone, arm B: with the quiz).
 *
 * `clearedGate` is `peakConfidence > serverGate.value` and nothing else. It used to also require
 * `directives > 0`, summed over the arm. The POST handler appends a `reorder` to every non-holdout
 * response on a reorder-capable tenant, whatever the source, so that conjunct was true whenever the
 * confidence one was (RETRO-325 §4a LG-3). It is dropped rather than bound per response because
 * the claim this field feeds ("behaviour alone did / did not clear the gate", "quiz input was
 * REQUIRED") is a claim about CONFIDENCE. Whether a model adapted anything is AC(1)'s claim.
 * `directives` stays as reporting and still includes `reorder`s.
 *
 * @param {ReadonlyArray<Record<string, any>>} responses
 * @param {{value: number}} serverGate
 * @returns {{peakConfidence: number, directives: number, clearedGate: boolean}}
 */
export function evaluateArmReachability(responses, serverGate) {
  const peakConfidence = responses.reduce((m, b) => Math.max(m, b?.confidence ?? 0), 0);
  const directives = responses.reduce((n, b) => n + directivesOf(b).length, 0);
  return { peakConfidence, directives, clearedGate: peakConfidence > serverGate.value };
}

/**
 * AC(2) reporting only (RETRO-325 §4a LG-7): for each slot that changed in the DOM, which
 * responses served that slot, and whether the one that painted it was an adapted response.
 *
 * AC(2) asserts that a served directive was PAINTED, and it is honest under that name. A withheld
 * batch still paints the template `cta`, though, so AC(2) can be green with nothing adapted. This
 * names the difference so nobody reads a green AC(2) as adaptation.
 *
 * ATTRIBUTION RULE: the SDK applies each response's directives as that response arrives
 * (`packages/sdk/src/index.ts`, `applyDirectives(nonDescriptionDirectives, …)` per response), so
 * the LAST response to serve a slot is the one whose copy the DOM shows. The SDK's own floor
 * (`DOM_ADAPT_CONFIDENCE_FLOOR`) could skip a response, but a text slot is only ever served above
 * the server gate, which is higher. A changed slot that no response served is reported with
 * `lastServedBy: null` and is not attributed to adaptation.
 *
 * @param {ReadonlyArray<string>} changedSlots - `data-estalara-slot` names whose text changed.
 * @param {ReadonlyArray<Record<string, any>>} responses - Parsed bodies, in arrival order.
 * @param {{value: number}} serverGate
 * @returns {{fromAdaptedResponse: string[], notFromAdaptedResponse: string[],
 *   perSlot: Array<{slot: string, servedBy: string[], lastServedBy: string|null,
 *   fromAdaptedResponse: boolean}>}}
 */
export function attributePaintedSlots(changedSlots, responses, serverGate) {
  const perSlot = changedSlots.map((slot) => {
    const servers = responses.filter((b) => nonReorderSlots(b).includes(slot));
    const last = servers.length > 0 ? servers[servers.length - 1] : null;
    return {
      slot,
      servedBy: servers.map((b) => String(b.source)),
      lastServedBy: last ? String(last.source) : null,
      fromAdaptedResponse: last !== null && isAdaptedResponse(last, serverGate),
    };
  });
  return {
    fromAdaptedResponse: perSlot.filter((s) => s.fromAdaptedResponse).map((s) => s.slot),
    notFromAdaptedResponse: perSlot.filter((s) => !s.fromAdaptedResponse).map((s) => s.slot),
    perSlot,
  };
}

/**
 * Evaluate AC(7), ESC-073 clause 2, as a pure function (FOLLOW-1196).
 *
 * CLAIM, in the CEO's words: "a control session receives no directives and an adapted session
 * does". Both halves are needed, because each alone is satisfiable by a broken system. A control
 * arm with zero directives is also what a totally dead adapt path looks like. An adapted arm that
 * "received directives" is what a dead LLM path looks like too, because the POST handler appends a
 * `reorder` after `runDecisionTree()` returns on EVERY non-holdout source, `default` included
 * (`route.ts`, `allDirectives.push(reorderResult.directive)`; since FOLLOW-1202 only on an
 * all-cosine batch).
 *
 * THE ADAPTED HALF, and why it changed. Until FOLLOW-1196 it was `totalDirectives > 0`, a sum of
 * `directives.length` over every response in the run. On the fixture tenant that sum is positive
 * for any non-holdout session. The on-disk artefact of 2026-08-25T22:37:59Z recorded AC(7) green
 * with `directivesServed: 4` over bodies in which `evaluateAc1()` counts 0 adapted (RETRO-325 §4a
 * LG-1). It is now "at least one response in the adapted session passes `isAdaptedResponse()`",
 * AC(1)'s own predicate, called rather than re-derived. The old sum is kept under `legacy`.
 *
 * THE CONTROL HALF is unchanged: the control call was attempted, answered 200, logged a row, drew
 * holdout, was not run with the red-first knob, served 0 directives and logged 0.
 *
 * ANTI-VACUITY, two conjuncts:
 *   - `controlProfileNotAdaptable`: a control call with no archetype, or a neutral one, gets zero
 *     directives whatever its arm, so its zero proves nothing (measured on FOLLOW-1131's first
 *     red-first run).
 *   - `controlProfileNotFromAdaptedResponse` (new): the control call must carry the
 *     profile of the FIRST adapted response (`selectProfileResponse()`), not of a template or
 *     refused response that happened to be the most confident. Otherwise "the same profile would
 *     have been adapted" is not what the pair shows.
 *
 * WHAT THE RED-FIRST CONTROL COMPARES (FOLLOW-1142 AC(1)). `FOLLOW1131_CONTROL_HOLDOUT_PCT=0`
 * compares the same synthetic control session with `holdout_pct` 0 versus 1. It does NOT compare
 * the browser session with the control session, which differ on the axes listed in
 * `driveHoldoutArm()`'s docblock.
 *
 * @param {{
 *   control: Record<string, any>,
 *   controlHoldoutPct: number,
 *   adaptedResponses: ReadonlyArray<unknown>,
 *   adaptedSessionId?: string|null,
 *   serverGate: {value: number},
 * }} input - `control` is `driveHoldoutArm()`'s diagnostics object, as returned.
 * @returns {{ok: boolean, name: string, summary: string, evidence: Record<string, unknown>}}
 *   `summary` is built from the counted population (Rule Q amendment 1 cl. 5), and `name`, the
 *   PASS/FAIL line, embeds it.
 */
export function evaluateAc7({
  control,
  controlHoldoutPct,
  adaptedResponses,
  adaptedSessionId = null,
  serverGate,
}) {
  const diag = control ?? {};
  const bodies = adaptedResponses.filter((b) => b !== null && typeof b === 'object');
  const served = diag.adaptDirectiveCount;
  const logged = diag.loggedDirectiveCount;
  const profile = diag.profileMirrored ?? null;
  const unmet = [];

  if (diag.attempted !== true) unmet.push('controlArmNotAttempted');
  if (diag.error !== undefined) unmet.push(`controlArmError=${String(diag.error)}`);
  if (diag.adaptStatus !== 200) unmet.push(`controlAdaptStatus=${String(diag.adaptStatus)}`);
  // Rule Q: an unreachable ClickHouse or a row that never landed is RED, never a soft skip and
  // never "the control session received no directives". Those are different facts.
  if (diag.decisionRowFound !== true) unmet.push('controlDecisionRowAbsent');
  if (typeof served !== 'number') unmet.push('controlServedDirectivesUnreadable');
  if (typeof logged !== 'number' || Number.isNaN(logged)) {
    unmet.push('controlLoggedDirectiveCountUnreadable');
  }
  // If the "control" session did not actually draw holdout, whatever it received says nothing
  // about arm SEPARATION. This is also the conjunct the red-first control trips.
  if (diag.loggedHoldoutGroup !== true) {
    unmet.push(`controlArmDidNotDrawHoldout=${String(diag.loggedHoldoutGroup)}`);
  }
  if (controlHoldoutPct !== 1) {
    unmet.push(`redFirstKnobEngaged:holdout_pct=${String(controlHoldoutPct)}`);
  }
  if (!profile || !profile.archetype || profile.archetype === 'neutral') {
    unmet.push('controlProfileNotAdaptable:separationWouldBeVacuous');
  }

  // The pre-FOLLOW-1196 verdict, kept as reporting so earlier artefacts stay comparable.
  const directivesServedIncludingReorder = bodies.reduce((n, b) => n + directivesOf(b).length, 0);
  const legacyWouldHavePassed =
    unmet.length === 0 && served === 0 && logged === 0 && directivesServedIncludingReorder > 0;

  const adapted = bodies.filter((b) => isAdaptedResponse(b, serverGate));
  const first = adapted[0] ?? null;
  if (first === null) {
    unmet.push('adaptedArmHasNoAdaptedResponse');
  } else {
    const expected = toControlProfile(first);
    const mirrored =
      profile !== null &&
      profile.archetype === expected.archetype &&
      profile.confidence === expected.confidence &&
      profile.similarity === expected.similarity;
    if (!mirrored) unmet.push('controlProfileNotFromAdaptedResponse');
  }

  const ok = unmet.length === 0 && served === 0 && logged === 0;

  const summary =
    `adapted arm: ${String(adapted.length)} of ${String(bodies.length)} responses adapted ` +
    `(AC(1)'s predicate)` +
    (first
      ? `; first: ${String(first.source)} ${String(first.archetype)} @ ${String(first.confidence)}`
      : '') +
    `; control arm: served ${String(served)}, logged ${String(logged)}, ` +
    `drewHoldout ${String(diag.loggedHoldoutGroup)}, holdout_pct ${String(controlHoldoutPct)}` +
    `; unmet: [${unmet.join(', ')}]`;

  return {
    ok,
    name:
      'the holdout mechanism SEPARATES the arms: the control session received zero directives ' +
      'and the adapted session received at least one LLM-adapted response (ESC-073 clause 2 / ' +
      `FOLLOW-820 condition 1) — counted: ${summary}`,
    summary,
    evidence: {
      DISCHARGES: 'ESC-073 clause 2 — the second half of FOLLOW-820 condition 1',
      NOT_A_LIFT_CLAIM:
        'This asserts arm SEPARATION, not efficacy. It says nothing about whether adaptation ' +
        'converts better — that is FOLLOW-1130, which does not gate GO.',
      controlArm: {
        sessionId: diag.holdoutSessionId ?? null,
        holdoutPctRequested: controlHoldoutPct,
        // The profile the control call was actually sent with (`driveHoldoutArm()` records it).
        profileMirrored: profile,
        drewHoldout: diag.loggedHoldoutGroup ?? null,
        directivesServed: served ?? null,
        directiveCountLogged: logged ?? null,
      },
      adaptedArm: {
        sessionId: adaptedSessionId,
        evaluatedResponseCount: bodies.length,
        adaptedResponseCount: adapted.length,
        firstAdaptedResponse: first
          ? {
              source: first.source,
              archetype: first.archetype,
              confidence: first.confidence,
              similarity: first.similarity ?? null,
              slots: nonReorderSlots(first),
            }
          : null,
      },
      unmetPreconditions: unmet,
      legacy: {
        NOT_THE_VERDICT:
          'pre-FOLLOW-1196 adapted side: directives summed over every response > 0. True for any ' +
          'non-holdout session on a reorder-capable tenant, because the POST handler appends a ' +
          'reorder on every source.',
        wouldHavePassed: legacyWouldHavePassed,
        directivesServedIncludingReorder,
      },
    },
  };
}

// ─── FOLLOW-1239: the post-quiz settle is a CONDITION, not a duration ───────────────────

/**
 * How long the post-quiz wait may keep polling. Sized against the MEASURED post-quiz turnaround on
 * this substrate: **5.3 s** on 2026-09-20 (README §5.11 run 2 — route pre-LLM 540 ms + Haiku
 * 2225 ms + fact check + paint), against the 3000 ms fixed sleep that preceded it. 30 s is ~5.7× the
 * measurement, and it costs nothing on a healthy run because the wait ends on the RESPONSE, not on
 * the clock. Anyone widening this should widen it against a newer measurement, not a hunch.
 */
const POST_QUIZ_SETTLE_BUDGET_MS = 30000;
/**
 * The floor the wait never ends before: the SDK's event queue flush is a 2000 ms `setInterval`, and
 * the pre-FOLLOW-1239 `sleep(3000)` was sized for it. Keeping it means this change can only ever
 * ADD observation time.
 */
const POST_QUIZ_SETTLE_FLOOR_MS = 3000;
/**
 * Between a `/api/adapt` response being read and the SDK painting it there is a real gap. Measured
 * on 2026-09-20: response 18:33:24.805 → `adapt.applied` ×3 at 18:33:24.826, i.e. **21 ms**. 1500 ms
 * is ~70× that, and it is what keeps AC(2) reading a DOM the directives have landed in rather than
 * one snapshotted between arrival and paint.
 */
const POST_QUIZ_PAINT_GRACE_MS = 1500;

/**
 * Wait for the QUIZ TURN'S OWN `/api/adapt` response, identified by the request that carried it.
 *
 * WHAT THIS CLOSES, TWICE.
 *   - FOLLOW-1239 (measured at `62ac28f0`, README §5.11 run 2). The harness used to do
 *     `await sleep(3000); await Promise.all(pending)` after the quiz loop and then snapshot
 *     `decided[]` for AC(1)/AC(2). The post-quiz turnaround on that run was 5.3 s, so the
 *     `llm_tweaked` response with three text directives was pushed into `decided[]` 1.05 s AFTER
 *     `evaluateAc1()` had read the array. A fixed constant cannot bound an LLM call.
 *   - FOLLOW-1240 + its RETRO-340 amendment. #919 replaced the sleep with a wait whose subject was
 *     an ARRAY POSITION: `startIndex = decided.length`, taken after the quiz loop's final
 *     `sleep(1200)`. A FAST quiz-turn response (259–785 ms on the holdout runs) was already before
 *     the index, so when it was not adapted — holdout, template, `default`, an error — neither exit
 *     fired, the wait burned the 30 s budget, and the cause printed "NO /api/adapt response from the
 *     quiz turn", naming three causes none of which had happened. Conversely ANY later `/api/adapt`
 *     (a behavioural refresh, the CTA click) satisfied the wait whether the quiz caused it or not.
 *
 * HOW THE QUIZ TURN IS IDENTIFIED. `main()` timestamps each quiz click immediately BEFORE dispatching
 * it; when the card disappears, the last click's timestamp is `quizCompletedAt`. The SDK's
 * quiz-completion callback calls `refreshDirectives()` synchronously (`packages/sdk/src/index.ts`,
 * `renderQuizWidget(…, (resolvedArchetype) => { … void refreshDirectives(); })`), so the quiz turn's
 * request is the FIRST `/api/adapt` request in `adaptRequests[]` whose `requestedAt` is at or after
 * `quizCompletedAt`. Its response is the `decided[]` entry whose `requestSeq` is that request's
 * `seq` (the harness maps Playwright's `Request` object to its `seq`). Where either sits in its array
 * does not matter, and nothing else can stand in for it. Both are recorded on the result
 * (`quizRequest`, `quizResponse`) and so on `last-run.json`.
 *
 * WHY THIS CANNOT MANUFACTURE A GREEN. The wait only decides WHEN to look. Every conjunct AC(1)
 * grades is still `isAdaptedResponse()`'s over bodies the real control plane sent (FOLLOW-1186).
 * Nothing here is injected into the population, and every response that arrives is still in it.
 *
 * THE FIVE WAYS IT CAN END, all recorded on `last-run.json`:
 *   - `quiz-response` — the quiz turn's response was read (the normal path, fast or slow). Waits for
 *     the floor, then the paint grace.
 *   - `quiz-response-holdout` — the quiz turn's response carries `holdout_group: true`: the session
 *     drew holdout and is served no adaptation by design (`route.ts` holdout branch). Ends the moment
 *     it is seen, with no floor and no paint grace: there is nothing to observe on the adapted axis,
 *     and the run is UNMEASURED on it (`gradeRun()`), not failed.
 *   - `quiz-request-failed` — the quiz turn's request failed at the network layer (`requestfailed`).
 *     No response will come. Ends at the floor.
 *   - `no-quiz-turn` — the quiz did not complete (`quizCompletedAt` null), so there is no quiz turn to
 *     wait for. Ends at the floor, the pre-FOLLOW-1239 window.
 *   - `budget` — the quiz turn's response did not arrive in `budgetMs`. A RED cause, and `cause` says
 *     which of three things was seen: no request at or after the click, a request with no response
 *     while other responses DID arrive, or nothing at all after the click. Only the last may say "NO
 *     /api/adapt response".
 *
 * @param {object} args
 * @param {Array<{body?: unknown, bodyError?: string, status?: number, requestSeq?: number|null,
 *   receivedAt?: number}>} args.decided - The live array the `response` handler pushes into.
 * @param {Promise<unknown>[]} args.pending - The live array of in-flight `res.text()` promises.
 * @param {Array<{seq: number, requestedAt: number, archetypeHint?: string|null,
 *   confidence?: number|null, failure?: string|null}>} args.adaptRequests - The live array the
 *   `request` handler pushes into; `requestfailed` stamps `failure`.
 * @param {number|null} args.quizCompletedAt - Timestamp (same clock as `now`) taken just before the
 *        click that completed the quiz; null when the quiz did not complete.
 * @param {{value: number}} args.serverGate
 * @param {number} [args.budgetMs]
 * @param {number} [args.floorMs]
 * @param {number} [args.paintGraceMs]
 * @param {number} [args.pollMs]
 * @param {() => number} [args.now] - Injected for the unit test's virtual clock; never in the run.
 * @param {(ms: number) => Promise<void>} [args.sleepFn] - Likewise.
 * @returns {Promise<{endedBy: 'quiz-response'|'quiz-response-holdout'|'quiz-request-failed'|
 *   'no-quiz-turn'|'budget', timedOut: boolean, waitedMs: number, quizCompletedAt: number|null,
 *   quizRequest: object|null, quizResponse: object|null, responsesAfterCompletingClick: number,
 *   adaptedResponseCount: number, budgetMs: number, floorMs: number, paintGraceMs: number,
 *   cause: string}>}
 */
export async function settleForAdaptResponse({
  decided,
  pending,
  adaptRequests,
  quizCompletedAt,
  serverGate,
  budgetMs = POST_QUIZ_SETTLE_BUDGET_MS,
  floorMs = POST_QUIZ_SETTLE_FLOOR_MS,
  paintGraceMs = POST_QUIZ_PAINT_GRACE_MS,
  pollMs = 250,
  now = () => Date.now(),
  sleepFn = sleep,
}) {
  const quizTurnKnown = typeof quizCompletedAt === 'number';
  const findQuizRequest = () =>
    quizTurnKnown ? (adaptRequests.find((r) => r.requestedAt >= quizCompletedAt) ?? null) : null;
  const findQuizResponse = (req) =>
    req === null ? -1 : decided.findIndex((d) => d && d.requestSeq === req.seq);
  const countAdapted = () =>
    decided.filter((d) => d && d.body && isAdaptedResponse(d.body, serverGate)).length;

  const started = now();
  const decidedAtStart = decided.length;
  let endedBy = 'budget';
  for (;;) {
    const elapsed = now() - started;
    const req = findQuizRequest();
    const idx = findQuizResponse(req);
    if (idx !== -1 && decided[idx].body?.holdout_group === true) {
      endedBy = 'quiz-response-holdout';
      break;
    }
    if (elapsed >= floorMs) {
      if (!quizTurnKnown) {
        endedBy = 'no-quiz-turn';
        break;
      }
      if (idx !== -1) {
        endedBy = 'quiz-response';
        break;
      }
      if (req !== null && typeof req.failure === 'string') {
        endedBy = 'quiz-request-failed';
        break;
      }
    }
    if (elapsed >= budgetMs) break;
    await sleepFn(pollMs);
  }

  // The response is read; the SDK has not necessarily painted it yet. Only `quiz-response` has
  // anything to paint.
  if (endedBy === 'quiz-response') await sleepFn(paintGraceMs);
  // A snapshot, deliberately: bodies that start arriving during this await land in `decided[]` and
  // are counted by `responsesArrivedAfterVerdict`, not silently awaited forever.
  await Promise.all([...pending]);

  const req = findQuizRequest();
  const idx = findQuizResponse(req);
  const entry = idx === -1 ? null : decided[idx];
  const quizRequest =
    req === null
      ? null
      : {
          seq: req.seq,
          requestedAt: req.requestedAt,
          msAfterCompletingClick: req.requestedAt - quizCompletedAt,
          archetypeHint: req.archetypeHint ?? null,
          confidence: req.confidence ?? null,
          failure: req.failure ?? null,
        };
  const quizResponse =
    entry === null
      ? null
      : {
          requestSeq: entry.requestSeq,
          decidedIndex: idx,
          status: entry.status ?? null,
          receivedAt: entry.receivedAt ?? null,
          msAfterRequest:
            typeof entry.receivedAt === 'number' ? entry.receivedAt - req.requestedAt : null,
          arrivedBeforeSettleStarted: idx < decidedAtStart,
          source: entry.body?.source ?? null,
          archetype: entry.body?.archetype ?? null,
          confidence: entry.body?.confidence ?? null,
          holdoutGroup: entry.body?.holdout_group === true,
        };
  const afterClick = quizTurnKnown
    ? decided.filter((d) => typeof d?.receivedAt === 'number' && d.receivedAt >= quizCompletedAt)
    : [];
  const responsesAfterCompletingClick = afterClick.length;
  const waitedMs = now() - started;
  const budget = `BUDGET EXPIRED after ${String(budgetMs)} ms`;

  let cause;
  if (endedBy === 'quiz-response') {
    cause =
      `ended on the quiz turn's own response (request #${String(req.seq)}, ` +
      `${String(quizResponse.source)}, ${String(quizResponse.msAfterRequest)} ms after the request` +
      (quizResponse.arrivedBeforeSettleStarted ? ', already read when the wait began' : '') +
      `) after ${String(waitedMs)} ms (budget ${String(budgetMs)} ms)`;
  } else if (endedBy === 'quiz-response-holdout') {
    cause =
      `the quiz turn's own response (request #${String(req.seq)}) carries holdout_group: true — ` +
      'this browser session drew HOLDOUT and is served no adaptation by design. The adapted axis ' +
      '(AC(1), AC(2), AC(5), AC(7)) is UNMEASURED on this run, not failed. Re-run.';
  } else if (endedBy === 'quiz-request-failed') {
    cause =
      `the quiz turn's request #${String(req.seq)} FAILED at the network layer ` +
      `(${String(req.failure)}); no response will come. AC(1) is RED for THIS cause.`;
  } else if (endedBy === 'no-quiz-turn') {
    cause =
      'the quiz did not complete (quizCompleted false), so there is no quiz turn to wait for; the ' +
      `population was read after the ${String(floorMs)} ms floor.`;
  } else if (req === null) {
    cause =
      `${budget}: the SDK issued NO /api/adapt REQUEST at or after the quiz's completing click, so ` +
      'the quiz-completion callback never re-fetched directives.' +
      (responsesAfterCompletingClick > 0
        ? ` ${String(responsesAfterCompletingClick)} response(s) to earlier requests arrived after ` +
          'the click; none is the quiz turn.'
        : '') +
      ' AC(1) is RED for THIS cause.';
  } else if (responsesAfterCompletingClick > 0) {
    cause =
      `${budget}: the quiz turn's request #${String(req.seq)} (issued ` +
      `${String(quizRequest.msAfterCompletingClick)} ms after the completing click) got no response. ` +
      `${String(responsesAfterCompletingClick)} other /api/adapt response(s) arrived after the click ` +
      `(request #${afterClick.map((d) => String(d.requestSeq)).join(', #')}); they are in AC(1)'s ` +
      'population and did not end the wait. AC(1) is RED for THIS cause.';
  } else {
    cause =
      `${budget}: NO /api/adapt response arrived at or after the completing click. The quiz turn's ` +
      `request #${String(req.seq)} went out ${String(quizRequest.msAfterCompletingClick)} ms after ` +
      'it and never answered — an LLM/control-plane hang or a turnaround longer than the budget. ' +
      'AC(1) is RED for THIS cause.';
  }

  return {
    endedBy,
    timedOut: endedBy === 'budget',
    waitedMs,
    quizCompletedAt: quizTurnKnown ? quizCompletedAt : null,
    quizRequest,
    quizResponse,
    responsesAfterCompletingClick,
    adaptedResponseCount: countAdapted(),
    budgetMs,
    floorMs,
    paintGraceMs,
    cause,
  };
}

// ─── FOLLOW-1240: UNMEASURED is a verdict, and the tally says so ────────────────────────

/**
 * Whether the browser session drew holdout, read off the `/api/adapt` BODIES it received — the
 * route's holdout branch returns `holdout_group: true` on every one, the treatment arm returns no
 * `holdout_group` field. Available at settle time, ~35 s before `measureAdaptedArmHoldout()` can ask
 * ClickHouse, which is what lets the `[FOLLOW-1098]` warning be printed ABOVE the AC(1) line.
 *
 * `true` only when EVERY body says holdout (assignment is per session); `false` when none does;
 * `null` when there are no bodies, or when they disagree — the one-group-per-session invariant
 * broke, which is reported and never resolved silently.
 *
 * @param {ReadonlyArray<unknown>} bodies
 * @returns {{drewHoldout: boolean|null, holdoutBodies: number, total: number}}
 */
export function holdoutFromResponses(bodies) {
  const objs = bodies.filter((b) => b !== null && typeof b === 'object');
  const holdoutBodies = objs.filter((b) => b.holdout_group === true).length;
  const total = objs.length;
  const drewHoldout =
    total === 0 ? null : holdoutBodies === total ? true : holdoutBodies === 0 ? false : null;
  return { drewHoldout, holdoutBodies, total };
}

/**
 * AC(7)'s unmet preconditions that are CONSEQUENCES of the adapted arm having nothing adapted, rather
 * than facts about the control arm. On a holdout draw the profile `toControlProfile(best)` mirrors is
 * the holdout body's `neutral`, so the first two follow from the draw; the third is a mirror of an
 * adapted response that does not exist.
 */
const AC7_ADAPTED_ARM_CONSEQUENCES = new Set([
  'adaptedArmHasNoAdaptedResponse',
  'controlProfileNotAdaptable:separationWouldBeVacuous',
  'controlProfileNotFromAdaptedResponse',
]);

/**
 * FOLLOW-1300 — AC(4)'s verdict while the bandit is FROZEN (FOLLOW-1286, D3), as a pure function.
 *
 * Green needs all of: the ping refused as 404 `bandit_disabled`, no `ab_bandit_weights` arm moved,
 * every served `/api/adapt` body carries `variant: 'control'`, every logged row is `control`. A
 * session that drew HOLDOUT is served bodies with NO `variant` field at all (the route's holdout
 * branch), so the variant conjuncts cannot hold by construction: that is UNMEASURED (series rule
 * (2), CEO 2026-09-22), never RED. Only the variant conjuncts are waived: a ping that was not
 * refused as `bandit_disabled`, or a moved arm, stays RED on a holdout draw too. A NON-holdout
 * response with a missing / `v1` / `v2` variant stays RED. `drewHoldout` is the SAME holdout
 * detection AC(1)/AC(7)/AC(8) use (`holdoutFromResponses()` / ClickHouse), passed in, never re-derived.
 *
 * @param {{httpStatus: number, reason: string|null, armMoved: boolean, servedBodies: unknown[],
 *   loggedVariants: string[], drewHoldout: boolean|null}} i
 * @returns {{ok: boolean, unmeasured: 'holdout'|null, refused: boolean, servedVariants: (string|null)[],
 *   servedAllControl: boolean, loggedAllControl: boolean}}
 */
export function evaluateAc4Frozen({
  httpStatus,
  reason,
  armMoved,
  servedBodies,
  loggedVariants,
  drewHoldout,
}) {
  const refused = httpStatus === 404 && reason === 'bandit_disabled';
  const servedVariants = [...new Set(servedBodies.map((b) => b?.variant ?? null))];
  const servedAllControl =
    servedVariants.length > 0 && servedVariants.every((v) => v === 'control');
  const loggedAllControl =
    loggedVariants.length > 0 && loggedVariants.every((v) => v === 'control');
  const ok = refused && !armMoved && servedAllControl && loggedAllControl;
  const unmeasured = !ok && refused && !armMoved && drewHoldout === true ? 'holdout' : null;
  return { ok, unmeasured, refused, servedVariants, servedAllControl, loggedAllControl };
}

/**
 * Whether one FAILED result is unmeasurable on the adapted axis for THIS run, and why — or null when
 * its failure stands. A PASS is never passed in; a FAIL is never turned into a PASS.
 *
 * - AC(1), AC(2): the adapted axis itself. Holdout → `holdout`; a response passing AC(1)'s own
 *   predicate that arrived after the verdict (`adaptedResponsesArrivedAfterVerdict > 0`) → `window`.
 * - AC(7): same two reasons, but only when every unmet precondition is an adapted-arm consequence
 *   AND the control arm served and logged zero directives. A control arm that served directives is
 *   the arms not separating, on any run.
 * - AC(5): holdout only, and only when the analytics path itself answered (`httpStatus` 200,
 *   `data_source` `clickhouse`, a non-null `ctaLift`) — i.e. the one failing conjunct is "THIS run's
 *   adapted arm converted", which a held-out session cannot satisfy. A rollup 500 stays RED.
 *
 * @param {{ac: string, evidence?: any}} result
 * @param {{adaptedArmDrewHoldout: boolean|null, adaptedResponsesArrivedAfterVerdict: number,
 *   chatArmDrewHoldout?: boolean|null}} facts
 * @returns {'holdout'|'window'|'config'|null}
 */
function unmeasuredBecause(result, facts) {
  const holdout = facts.adaptedArmDrewHoldout === true;
  const windowed = facts.adaptedResponsesArrivedAfterVerdict > 0;
  const reason = holdout ? 'holdout' : windowed ? 'window' : null;
  const ev = result.evidence ?? {};
  switch (result.ac) {
    case 'AC(1)':
    case 'AC(2)':
      return reason;
    case 'AC(7)': {
      const unmet = Array.isArray(ev.unmetPreconditions) ? ev.unmetPreconditions : [];
      const onlyAdaptedArm =
        unmet.length > 0 && unmet.every((u) => AC7_ADAPTED_ARM_CONSEQUENCES.has(u));
      const controlClean =
        ev.controlArm?.directivesServed === 0 && ev.controlArm?.directiveCountLogged === 0;
      return onlyAdaptedArm && controlClean ? reason : null;
    }
    case 'AC(5)': {
      const analyticsAnswered =
        ev.httpStatus === 200 && ev.data_source === 'clickhouse' && ev.ctaLift !== null;
      return holdout && analyticsAnswered ? 'holdout' : null;
    }
    case 'AC(4)':
      // FOLLOW-1300: frozen mode only; the ping must have been refused and the arm unmoved, so only
      // the variant conjuncts (absent on a holdout body by construction) are what the draw excuses.
      return ev.mode === 'bandit_frozen' &&
        ev.httpStatus === 404 &&
        ev.reason === 'bandit_disabled' &&
        ev.armMoved === false &&
        holdout
        ? 'holdout'
        : null;
    case 'AC(8)': {
      // FOLLOW-1299: the chat arm is its OWN browser session with its own holdout draw. The arm
      // stops at the baseline when that session drew holdout, so the draw is then the ONLY unmet
      // precondition. Any other unmet entry (a broken hop, a failed negative control) stays RED.
      const unmet = Array.isArray(ev.unmetPreconditions) ? ev.unmetPreconditions : [];
      const onlyTheDraw = unmet.length === 1 && unmet[0] === 'chatArmDrewHoldout';
      return facts.chatArmDrewHoldout === true && onlyTheDraw ? 'holdout' : null;
    }
    case 'AC(10)': {
      // FOLLOW-1361: (a) and (b) each redraw up to AC10_MAX_DRAWS sessions; a sub-session whose last
      // draw was still holdout is the only excusable entry. Anything else unmet stays RED.
      // FOLLOW-1369: a sub-session whose served config never reached the browser (no card since
      // FOLLOW-1370, no completed public-config GET) is an UNMET PRECONDITION, not an SDK verdict.
      const unmet = Array.isArray(ev.unmetPreconditions) ? ev.unmetPreconditions : [];
      const excusable = (u) => AC10_HOLDOUT_UNMET.includes(u) || AC10_CONFIG_UNMET_RE.test(u);
      if (unmet.length === 0 || !unmet.every(excusable)) return null;
      return unmet.some((u) => AC10_HOLDOUT_UNMET.includes(u)) ? 'holdout' : 'config';
    }
    default:
      return null;
  }
}

/**
 * Every AC a full run grades, in record order (FOLLOW-1361: AC(10) makes it eight; AC(6) is the
 * manual-runbook criterion and is never recorded, AC(9) does not exist). `main()` records any of
 * these that a run did not evaluate as RED (`missingGradedAcs()`), so `TALLY total=8` cannot be
 * reached by a run that silently skipped one, and a TALLY with another total is not a full run.
 */
export const GRADED_ACS = Object.freeze([
  'AC(1)',
  'AC(2)',
  'AC(3)',
  'AC(4)',
  'AC(5)',
  'AC(7)',
  'AC(8)',
  'AC(10)',
]);

/**
 * The graded ACs absent from `results`, in `GRADED_ACS` order. Pure.
 *
 * @param {ReadonlyArray<{ac: string}>} results
 * @returns {string[]}
 */
export function missingGradedAcs(results) {
  const seen = new Set(results.map((r) => r.ac));
  return GRADED_ACS.filter((ac) => !seen.has(ac));
}

/**
 * The run's grade: every result's `verdict` (`PASS` / `FAIL` / `UNMEASURED`) and the TALLY line.
 * This is the machine grader FOLLOW-1240 asks for — it consumes `adaptedArmDrewHoldout` and
 * `adaptedResponsesArrivedAfterVerdict`, which until now only a human reading README §3.6 acted on.
 *
 * `ok` is left as the AC's raw predicate outcome; `verdict` is the grade. The run verdict is `RED`
 * when any AC is FAIL, else `UNMEASURED` when any is UNMEASURED, else `GREEN`.
 *
 * THE TALLY FORMAT (README §3.6), one line, always printed, always first:
 *   `TALLY green=<n> red=<n> unmeasured=<n> total=<n> run=<GREEN|RED|UNMEASURED>`
 * followed by a human line: the legacy `<g>/<n> acceptance criteria green` ONLY when nothing is
 * UNMEASURED (so a fully measured run reads exactly as every run in README §5 did), otherwise a line
 * that names the UNMEASURED ACs and never has the `N/M … green` shape.
 *
 * @param {ReadonlyArray<{ac: string, name: string, ok: boolean, evidence?: unknown}>} results
 * @param {{adaptedArmDrewHoldout: boolean|null, adaptedResponsesArrivedAfterVerdict: number}} facts
 * @returns {{results: Array<object>, tally: {green: number, red: number, unmeasured: number,
 *   total: number}, runVerdict: 'GREEN'|'RED'|'UNMEASURED', tallyLine: string,
 *   summaryLine: string}}
 */
export function gradeRun(results, facts) {
  const graded = results.map((r) => {
    const because = r.ok ? null : unmeasuredBecause(r, facts);
    return {
      ...r,
      verdict: r.ok ? 'PASS' : because ? 'UNMEASURED' : 'FAIL',
      unmeasuredBecause: because,
    };
  });
  const count = (v) => graded.filter((r) => r.verdict === v).length;
  const tally = {
    green: count('PASS'),
    red: count('FAIL'),
    unmeasured: count('UNMEASURED'),
    total: graded.length,
  };
  const runVerdict = tally.red > 0 ? 'RED' : tally.unmeasured > 0 ? 'UNMEASURED' : 'GREEN';
  const tallyLine =
    `TALLY green=${String(tally.green)} red=${String(tally.red)} ` +
    `unmeasured=${String(tally.unmeasured)} total=${String(tally.total)} run=${runVerdict}`;
  const unmeasuredList = graded
    .filter((r) => r.verdict === 'UNMEASURED')
    .map((r) => `${r.ac}[${String(r.unmeasuredBecause)}]`)
    .join(', ');
  const summaryLine =
    tally.unmeasured === 0
      ? `${String(tally.green)}/${String(tally.total)} acceptance criteria green`
      : `NOT a graded run: ${String(tally.unmeasured)} of ${String(tally.total)} acceptance ` +
        `criteria UNMEASURED (${unmeasuredList}); ${String(tally.green)} green, ` +
        `${String(tally.red)} red. Re-run before grading.`;
  return { results: graded, tally, runVerdict, tallyLine, summaryLine };
}

/**
 * The `[FOLLOW-1098]` holdout warning. Called from the settle-time evidence (the response bodies)
 * BEFORE the AC(1) line, and from the ClickHouse read only when the bodies did not already say so.
 *
 * @param {string|null} sessionId
 * @param {string} evidence - What the draw was read from, printed verbatim.
 */
function printHoldoutWarning(sessionId, evidence) {
  console.log(
    `\n[FOLLOW-1098] ⚠ THE ADAPTED ARM DREW HOLDOUT (${evidence}). The real assignHoldout() put the ` +
      `browser session (${String(sessionId)}) in the CONTROL arm, so it received zero directives by ` +
      'design. AC(1)/AC(2)/AC(5)/AC(7) are UNMEASURED on the adapted axis for this run — NOT failed; ' +
      'the TALLY below counts them so. Re-run.',
  );
}

// ─── FOLLOW-1299: the chat arm — AC(8), FOLLOW-820 condition 1b ─────────────────────────
//
// One scripted buyer message travels the real chain and the NEXT `/api/adapt` reflects it:
//
//   hop 1  the host page dispatches `estalara:chat:message-sent` on `document` (what Estalara-app's
//          chat does) and the SDK's own listener (packages/sdk/src/index.ts) queues and POSTs
//          `chat.message.sent` — the harness never POSTs to ingest itself
//   hop 2  ingest `:8787` answers that batch 2xx
//   hop 3  the intent-engine shim `:8090` is reachable
//   hop 4  the shim wrote `shadow:{tenant}:{session}:chat_intent` (Redis, read through SRH `:8079`)
//   hop 5  a `/api/adapt` response for the session carries `chat_intent_dimensions` with the
//          record's own `detected_at` stamp (the control plane read the key)
//   hop 6  the SDK folded it: the next `/api/adapt` REQUEST carries the expected `archetype_hint`
//   hop 7  and that request's RESPONSE carries the expected `archetype`
//
// Hops 1–7 move the LABEL; one message from a cold start lands at ~0.37, under the server's 0.6
// directive gate, so they serve nothing a buyer sees. FOLLOW-1302 (CEO ruling 2026-10-05,
// proposal 1) grades condition 1b on a SECOND consistent message that changes a dimension:
//
//   hop 8  the second message is POSTed and ingest answers 2xx
//   hop 9  the shim wrote a NEW record (a later `detected_at` than the first message's)
//   hop 10 an `/api/adapt` response carries that record's stamp
//   hop 11 the SDK's own follow-up call (FOLLOW-1306) sends a confidence above the gate
//   hop 12 a response to a call after that carrier passes AC(1)'s `isAdaptedResponse()`
//
// and the page is never navigated after the baseline view (no reload).
//
// "NEXT" IS DRAWN BY THE SDK ITSELF, ON ONE PAGE VIEW (FOLLOW-1301). The folded archetype only
// travels as `archetype_hint` on the call AFTER the one that delivers the dimensions. Until
// FOLLOW-1301 the SDK made no such call (`runChatRefresh()` stopped on the delivering call) and this
// arm drew it with a page reload (README §5.18). It no longer reloads anywhere: a buyer who only
// chats must see the effect, so hop 6 is the first request the SDK issues after the carrier, and
// the negative control is graded on the SDK's own chat-refresh calls after the neutral message.
//
// THE SESSION IS ITS OWN. A fresh browser context with no quiz answer, so the baseline archetype is
// whatever behaviour-free init yields and the message is the only archetype-bearing input. Running
// it inside the quiz session would start from the confirmed quiz leaf at 0.90 (FOLLOW-1359: the
// leaf folds at 0.72 when completed, 0.90 when confirmed or corrected; chat is tempered by τ = 0.5
// against a confirmed leaf) and could not show a change.

const CHAT_NLP_ORIGIN = (process.env.CHAT_NLP_ORIGIN ?? 'http://localhost:8090').replace(/\/$/, '');
const SHADOW_REDIS_URL = (process.env.SHADOW_REDIS_URL ?? 'http://localhost:8079').replace(
  /\/$/,
  '',
);
const SHADOW_REDIS_TOKEN = process.env.SHADOW_REDIS_TOKEN ?? 'local-dev-token';

/**
 * The one harness number in the chat arm's waits: time allowed, beyond the SDK's own chat-refresh
 * cycle, for the shim's live Haiku extraction and the adapt calls' own latency.
 */
const CHAT_ARM_SLACK_MS = 20000;
/** The chat listener is registered after init's first `await refreshDirectives()` returns. */
const CHAT_LISTENER_SETTLE_MS = 2000;
/** How long a loaded page may take to issue and receive its first `/api/adapt`. */
const CHAT_ARM_PAGE_BUDGET_MS = 30000;

/**
 * What the chat arm says, and what it must resolve. The positive message is a rental-yield question
 * (the §P.0 item 1b example), fixed before FOLLOW-1299's first run and not tuned since; the
 * negative one carries no intent. None contains a digit, an `@` or a phone-like run, so the SDK's
 * PII scrub leaves the text byte-identical and hops 1 and 8 can match it exactly.
 *
 * FOLLOW-1302 (CEO ruling 2026-10-05, proposal 1): condition 1b is graded on an ADAPTED response
 * after a SECOND consistent message. The second message is a rental-yield question too, and it
 * must CHANGE a dimension, not repeat one: the shim extracts each message on its own and the SDK
 * folds each new extraction once (`applyChatIntentPrior`), so the first message's extraction
 * (`finance_complexity: standard_mortgage`, README §5.18) folded twice stays under the 0.6 gate
 * (README §5.21: the recorded negative case), while the second message's buying vehicle
 * (`finance_complexity: investment_vehicle`, with `purchase_purpose: investment`) crosses it. What
 * the extraction must contain to cross is pinned by `ac8-verdict.test.ts` (gap candidate G-04).
 */
export const CHAT_ARM_SCRIPT = Object.freeze({
  eventName: 'estalara:chat:message-sent',
  neutralMessage: 'hello, is anyone there?',
  positiveMessage:
    'I want to buy this flat as a buy-to-let investment and rent it out straight away. ' +
    'What gross rental yield does it bring, and how is the rental income taxed?',
  secondMessage:
    'I would buy it through my property investment company, a limited company I use for ' +
    'buy-to-let. What net rental yield would the company get after costs?',
  expectedArchetype: 'yield_hunter',
});

/**
 * How long one chat message may take to show up in an `/api/adapt` response, derived from the SDK's
 * own retry schedule (`scheduleChatRefresh()` / `runChatRefresh()`): the first refresh fires
 * `CHAT_REFRESH_DEBOUNCE_MS` after the message, then up to `CHAT_REFRESH_MAX_ATTEMPTS - 1` retries
 * `CHAT_REFRESH_RETRY_MS` apart. Past `cycleMs` the SDK has stopped asking. Pure, so a test can
 * hand it the real source with one constant edited. Throws when the source no longer has the shape.
 *
 * @param {{indexSrc: string, slackMs?: number}} args
 * @returns {{debounceMs: number, retryMs: number, maxAttempts: number, cycleMs: number,
 *   slackMs: number, budgetMs: number, source: string}}
 */
export function deriveChatRefreshBudget({ indexSrc, slackMs = CHAT_ARM_SLACK_MS }) {
  const read = (name) => {
    const m = new RegExp(`const\\s+${name}\\s*=\\s*([0-9_]+)\\s*;`).exec(indexSrc);
    if (!m) throw new Error(`Could not read ${name} from packages/sdk/src/core/adapt-loop.ts.`);
    return Number(m[1].replace(/_/g, ''));
  };
  const debounceMs = read('CHAT_REFRESH_DEBOUNCE_MS');
  const retryMs = read('CHAT_REFRESH_RETRY_MS');
  const maxAttempts = read('CHAT_REFRESH_MAX_ATTEMPTS');
  const cycleMs = debounceMs + (maxAttempts - 1) * retryMs;
  return {
    debounceMs,
    retryMs,
    maxAttempts,
    cycleMs,
    slackMs,
    budgetMs: cycleMs + slackMs,
    source:
      'packages/sdk/src/core/adapt-loop.ts CHAT_REFRESH_DEBOUNCE_MS / _RETRY_MS / _MAX_ATTEMPTS',
  };
}

/**
 * FOLLOW-1352: which request is "the SDK's follow-up after the carrier" for hops 6 and 11.
 *
 * The first version took the first call whose `seq` exceeded the carrier's — the next request by SEQUENCE.
 * `seq` is assigned when a request goes OUT, so a request sent while the carrier was still in flight
 * (a second chat-refresh chain; K3 run 2: #11 sent 1889 ms before #10 was answered) has a higher
 * `seq` and was graded as the follow-up although it carried the PRE-fold confidence (0.367) while
 * the SDK's own state had already folded to 0.664. A follow-up is a request the SDK sent once it
 * HAD folded the carrier's intent, so a request is eligible only when it was sent
 *   (a) at or after the carrier was ANSWERED, and
 *   (b) at or after the SDK's persisted intent state first showed `chatPriorAppliedAt === <the
 *       carrier's stamp>` (`foldSeenMono`).
 * (b) matters because a fold is dropped when a newer request supersedes the carrier (latest-wins,
 * adapt-loop.ts), and then (a) alone would admit a request that still carries the old state.
 *
 * Both clocks are MONOTONIC (`performance.now()`: `requestedMono` / `receivedMono` on each call,
 * `foldSeenMono` from the harness poll) — the wall-clock `requestedAt` / `receivedAt` stamps stay as
 * evidence only, because this machine's wall clock steps (FOLLOW-1255; README §5.18 run 3).
 * `foldSeenMono` is the poll that FIRST saw the stamp, so a request sent in the one poll interval
 * (250 ms) before it is conservatively not graded; the real follow-up is at least one chat-refresh
 * debounce (`CHAT_REFRESH_DEBOUNCE_MS`, adapt-loop.ts:35) after the fold.
 *
 * Pure: returns `next: null` plus a `reason` naming the timing rather than guessing, so the hop is
 * BROKEN with the cause, never a silent pass on the wrong request.
 *
 * @param {{calls: Array<{seq: number, requestedMono?: number|null}>,
 *   carrier: {seq: number, receivedMono?: number|null}|null,
 *   foldSeenMono: number|null|undefined}} args
 * @returns {{next: object|null, reason: 'no_carrier'|'carrier_answer_time_unknown'|
 *   'fold_not_observed'|'none_sent_after_fold'|null, notGradedSeqs: number[],
 *   floorMono: number|null}}
 */
export function pickFollowUpAfterCarrier({ calls, carrier, foldSeenMono }) {
  if (!carrier) return { next: null, reason: 'no_carrier', notGradedSeqs: [], floorMono: null };
  if (typeof carrier.receivedMono !== 'number') {
    return {
      next: null,
      reason: 'carrier_answer_time_unknown',
      notGradedSeqs: [],
      floorMono: null,
    };
  }
  if (typeof foldSeenMono !== 'number') {
    return { next: null, reason: 'fold_not_observed', notGradedSeqs: [], floorMono: null };
  }
  const floorMono = Math.max(carrier.receivedMono, foldSeenMono);
  const later = calls.filter((c) => c.seq > carrier.seq);
  const eligible = later.filter(
    (c) => typeof c.requestedMono === 'number' && c.requestedMono >= floorMono,
  );
  const notGradedSeqs = later.filter((c) => !eligible.includes(c)).map((c) => c.seq);
  return {
    next: eligible[0] ?? null,
    reason: eligible.length > 0 ? null : 'none_sent_after_fold',
    notGradedSeqs,
    floorMono,
  };
}

/**
 * The BROKEN-hop text for "no follow-up was graded" (hops 6 and 11): names the timing so a red run
 * says WHICH wait failed — never the bare "no request was issued" when a request WAS issued, just
 * too early to be the follow-up (FOLLOW-1352). Falls back to `legacy` when the run recorded no
 * `followUp` evidence (older artefacts, hand-built observations).
 *
 * @param {{reason?: string|null, notGradedSeqs?: number[], foldWaitMs?: number|null,
 *   windowMs?: number|null, stamp?: string|null}|null|undefined} followUp
 * @param {string} legacy
 * @returns {string}
 */
function noFollowUpDetail(followUp, legacy) {
  if (!followUp || !followUp.reason) return legacy;
  const early =
    Array.isArray(followUp.notGradedSeqs) && followUp.notGradedSeqs.length > 0
      ? ` Request(s) #${followUp.notGradedSeqs.join(', #')} went out before the carrier was answered ` +
        'or before the SDK had applied its fold, so they carried pre-fold state and are not graded.'
      : '';
  switch (followUp.reason) {
    case 'fold_not_observed':
      return (
        `TIMING: the SDK's persisted state never showed chatPriorAppliedAt === ` +
        `${String(followUp.stamp ?? null)} within ${String(followUp.foldWaitMs ?? null)} ms of ` +
        `the carrier being answered, so no request can be shown to follow the fold.${early}`
      );
    case 'none_sent_after_fold':
      return (
        `TIMING: no /api/adapt request was sent after the SDK applied its fold (chatPriorAppliedAt ` +
        `=== ${String(followUp.stamp ?? null)}) within ${String(followUp.windowMs ?? null)} ms ` +
        `(the chat-refresh debounce plus slack).${early}`
      );
    default:
      return `TIMING: the follow-up could not be selected (${followUp.reason}).${early}`;
  }
}

const is2xx = (status) => typeof status === 'number' && status >= 200 && status < 300;

/**
 * AC(8)'s verdict, as a pure function over what `driveChatArm()` observed.
 *
 * GREEN needs all four:
 *   1. every hop held (the first one that did not is `brokenHop`): hops 1–7 are the FIRST
 *      message's chain, kept as intermediate hops (it moves the label); hops 8–12 are the SECOND
 *      message's, ending in hop 12 — a response, on the same page view, that passes AC(1)'s own
 *      `isAdaptedResponse()` (FOLLOW-1302, CEO ruling 2026-10-05: condition 1b is NOT met by a
 *      moved label);
 *   2. the baseline archetype, read BEFORE any message, was not already the expected one — a
 *      predicate reading only "the archetype after is `yield_hunter`" passes on a session that was
 *      `yield_hunter` all along, with the chat chain dead;
 *   3. the negative control held AND was proven live: the neutral message reached the shim (its
 *      cold-key record exists), the SDK's own chat refresh after it was answered, and every archetype served after
 *      it equals the baseline. A control whose message never reached the shim proves nothing;
 *   4. no reload: the page was not navigated after the baseline view, so every call graded was one
 *      the SDK chose to make for a buyer who only chats.
 *
 * A session that drew holdout stops at the baseline: `unmetPreconditions` is then exactly
 * `['chatArmDrewHoldout']`, which `gradeRun()` grades UNMEASURED. Nothing else is ever neutral.
 *
 * @param {object} obs - `driveChatArm()`'s return value.
 * @param {{value: number}} serverGate - the route's directive gate, read from source by the caller.
 * @returns {{ok: boolean, name: string, summary: string, brokenHop: string|null,
 *   evidence: object}}
 */
export function evaluateAc8(obs, serverGate) {
  const expected = obs.expectedArchetype;
  const name =
    `chat arm: one real chat.message.sent moved the next /api/adapt archetype to ${expected} ` +
    'through every hop (SDK → ingest → shim → shadow key → control plane → SDK hint → response), ' +
    'a second consistent message drew an ADAPTED response on the same page view, ' +
    'and a neutral message left the archetype unchanged';
  const baselineArchetype = obs.baseline?.archetype ?? null;

  if (obs.drewHoldout === true) {
    return {
      ok: false,
      name,
      summary: 'the chat session drew holdout — no chat intent is served to a control session',
      brokenHop: null,
      evidence: {
        GRADED_BY_FOLLOW_820_CONDITION_1B: AC8_GRADED_BY,
        expectedArchetype: expected,
        sessionId: obs.sessionId ?? null,
        baseline: obs.baseline ?? null,
        unmetPreconditions: ['chatArmDrewHoldout'],
      },
    };
  }

  const p = obs.positive ?? {};
  const record = p.record ?? null;
  const carrierDims =
    p.carrier?.dimensions !== null && typeof p.carrier?.dimensions === 'object'
      ? Object.keys(p.carrier.dimensions)
      : [];
  const hops = [
    {
      hop: 1,
      name: 'sdk_emitted_chat_message_sent',
      ok: p.emitted === true,
      detail:
        p.emitted === true
          ? 'the SDK POSTed a chat.message.sent carrying the scripted text for this session'
          : `no ingest POST carried the scripted text — is the SDK still listening for ` +
            `'${String(obs.eventName)}' on document?`,
    },
    {
      hop: 2,
      name: 'ingest_acked_2xx',
      ok: is2xx(p.ingestStatus),
      detail: `ingest status ${String(p.ingestStatus ?? null)}${p.ingestFailure ? ` (${String(p.ingestFailure)})` : ''}`,
    },
    {
      hop: 3,
      name: 'intent_engine_shim_reachable',
      ok: p.shimHealthStatus === 200,
      detail: `GET ${String(obs.shimOrigin)}/health → ${String(p.shimHealthStatus ?? 'no answer')}`,
    },
    {
      hop: 4,
      name: 'shadow_key_written_by_this_message',
      ok: p.shadowAdvanced === true && typeof record?.detected_at === 'string',
      detail:
        p.shadowReadable === false
          ? `the shadow store could not be read: ${String(p.shadowError)}`
          : p.shadowAdvanced === true
            ? `key ${String(p.shadowKey)} detected_at ${String(record?.detected_at)}`
            : 'no record with a new detected_at appeared under this session — the dispatch never ' +
              'reached the shim, the extraction failed, or it carried no usable dimension',
    },
    {
      hop: 5,
      name: 'adapt_response_carries_chat_intent',
      ok:
        p.carrier != null &&
        carrierDims.length > 0 &&
        typeof record?.detected_at === 'string' &&
        p.carrier.detectedAt === record.detected_at,
      detail:
        p.carrier != null
          ? `request #${String(p.carrier.requestSeq)} answered chat_intent_dimensions ` +
            `[${carrierDims.join(', ')}] stamped ${String(p.carrier.detectedAt)}`
          : "no /api/adapt response carried the record's detected_at within the SDK's chat-refresh " +
            'budget — the control plane is not reading the store the shim writes',
    },
    {
      hop: 6,
      name: 'sdk_sent_folded_archetype_hint',
      ok: p.next != null && p.next.sameSession === true && p.next.archetypeHint === expected,
      detail:
        p.next != null
          ? `request #${String(p.next.requestSeq)} archetype_hint ${String(p.next.archetypeHint)}` +
            (p.next.sameSession === true ? '' : ' — under a DIFFERENT session_id')
          : noFollowUpDetail(
              p.followUp,
              'no /api/adapt request was issued after the response that carried the chat intent',
            ),
    },
    {
      hop: 7,
      name: 'adapt_response_archetype',
      ok: p.next != null && p.next.responseArchetype === expected,
      detail: `response archetype ${String(p.next?.responseArchetype ?? null)}`,
    },
    ...secondMessageHops(obs, serverGate),
  ];
  const broken = hops.find((h) => !h.ok) ?? null;
  const brokenHop = broken ? `${String(broken.hop)}:${broken.name}` : null;

  const baselineDiffers = baselineArchetype !== null && baselineArchetype !== expected;

  const n = obs.negative ?? {};
  const archetypesAfter = Array.isArray(n.archetypesAfter) ? n.archetypesAfter : [];
  const moved = archetypesAfter.filter((a) => a !== baselineArchetype);
  const negativeNotProven = !(n.emitted === true && is2xx(n.ingestStatus))
    ? 'neutralMessageNotAcceptedByIngest'
    : n.shadowSeen !== true
      ? 'neutralMessageNeverReachedTheShim'
      : !(n.responsesAfterMessage > 0)
        ? 'noAdaptResponseAfterNeutralMessage'
        : archetypesAfter.length === 0
          ? 'noArchetypeAfterNeutralMessage'
          : null;
  const negativeControl = {
    ok: negativeNotProven === null && moved.length === 0 && baselineArchetype !== null,
    proven: negativeNotProven === null,
    notProvenBecause: negativeNotProven,
    baselineArchetype,
    archetypesAfter,
    movedTo: [...new Set(moved)],
    observed: n,
  };

  // FOLLOW-1302: "without a reload" is a conjunct, not an assumption — `driveChatArm()` counts
  // main-frame navigations after the baseline view; absent (`undefined`) is not zero.
  const reloaded = obs.navigationsAfterBaseline !== 0;

  const unmetPreconditions = [];
  if (brokenHop) unmetPreconditions.push(`brokenHop=${brokenHop}`);
  if (reloaded) {
    unmetPreconditions.push(
      `pageNavigatedAfterBaseline=${String(obs.navigationsAfterBaseline ?? 'unrecorded')}`,
    );
  }
  if (baselineArchetype === null) unmetPreconditions.push('noBaselineArchetype');
  else if (!baselineDiffers) unmetPreconditions.push('baselineAlreadyExpectedArchetype');
  if (negativeNotProven) unmetPreconditions.push(`negativeControlNotProven:${negativeNotProven}`);
  else if (moved.length > 0) {
    unmetPreconditions.push(
      `neutralMessageChangedArchetype:${String(baselineArchetype)}→${negativeControl.movedTo.join('|')}`,
    );
  }

  const ok = unmetPreconditions.length === 0;
  const s = obs.second ?? {};
  const adapted = adaptedAfterSecond(obs, serverGate);
  const summary = ok
    ? `${String(baselineArchetype)} → ${expected} after the first message; after the second, ` +
      `request #${String(adapted?.requestSeq)} was ADAPTED (${String(adapted?.source)}, ` +
      `confidence ${String(adapted?.confidence)}, ${String(adapted?.nonReorderSlots.length)} ` +
      `non-reorder directive(s)), no reload; neutral message left ` +
      `${String(baselineArchetype)} on ${String(archetypesAfter.length)} response(s)`
    : unmetPreconditions.join('; ');
  return {
    ok,
    name,
    summary,
    brokenHop,
    evidence: {
      GRADED_BY_FOLLOW_820_CONDITION_1B: AC8_GRADED_BY,
      expectedArchetype: expected,
      sessionId: obs.sessionId ?? null,
      baseline: obs.baseline ?? null,
      baselineDiffers,
      hops,
      brokenHop,
      navigationsAfterBaseline: obs.navigationsAfterBaseline ?? null,
      negativeControl,
      shadowRecord: record,
      secondShadowRecord: s.record ?? null,
      secondExtractionChanged: changedDimensions(record, s.record ?? null),
      adaptedAfterSecondMessage: adapted,
      sdkIntent: obs.sdkIntent ?? null,
      unmetPreconditions,
    },
  };
}

/** What AC(8) grades, in one line, for the artefact. */
const AC8_GRADED_BY =
  'hops[1..12] all ok (hop 12 = a response after the SECOND message passing isAdaptedResponse) ' +
  'AND no navigation after the baseline AND baselineDiffers AND negativeControl.ok';

/**
 * The dimensions whose value differs between two shadow records' `intent_dimensions` (null-safe).
 * Evidence only: AC(8) grades the outcome (an adapted response), not the input — but a second
 * extraction identical to the first is the recorded negative case (README §5.21), so the artefact
 * names it.
 *
 * @param {any} first
 * @param {any} second
 * @returns {Array<{dimension: string, first: unknown, second: unknown}>|null}
 */
function changedDimensions(first, second) {
  const a = first?.intent_dimensions;
  const b = second?.intent_dimensions;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return null;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((k) => (a[k] ?? null) !== (b[k] ?? null))
    .map((k) => ({ dimension: k, first: a[k] ?? null, second: b[k] ?? null }));
}

/**
 * Hops 8–12: the SECOND message (FOLLOW-1302). Hops 1–7 move the label; these are what the buyer
 * sees. Hop 11 is the SDK's own follow-up call (FOLLOW-1306: drawn when the fold crosses the
 * directive gate) and is RED when no call follows — the shape of an extraction too weak to cross
 * (G-04); hop 12 is AC(1)'s predicate over a response to a call issued after the carrier.
 *
 * @param {any} obs
 * @param {{value: number}} serverGate
 */
function secondMessageHops(obs, serverGate) {
  const s = obs.second ?? {};
  const firstStamp = obs.positive?.record?.detected_at ?? null;
  const record = s.record ?? null;
  const carrierDims =
    s.carrier?.dimensions !== null && typeof s.carrier?.dimensions === 'object'
      ? Object.keys(s.carrier.dimensions)
      : [];
  const gate = serverGate?.value;
  const after = Array.isArray(s.responsesAfterCarrier) ? s.responsesAfterCarrier : [];
  const adapted = adaptedAfterSecond(obs, serverGate);
  return [
    {
      hop: 8,
      name: 'second_message_emitted_and_acked',
      ok: s.emitted === true && is2xx(s.ingestStatus),
      detail:
        s.emitted === true
          ? `the SDK POSTed the second chat.message.sent; ingest status ${String(s.ingestStatus ?? null)}`
          : 'no ingest POST carried the second message',
    },
    {
      hop: 9,
      name: 'second_shadow_record_written',
      ok:
        s.shadowAdvanced === true &&
        typeof record?.detected_at === 'string' &&
        record.detected_at !== firstStamp,
      detail:
        s.shadowAdvanced === true
          ? `detected_at ${String(record?.detected_at)} (first message ${String(firstStamp)})`
          : 'no record with a new detected_at appeared after the second message',
    },
    {
      hop: 10,
      name: 'adapt_response_carries_second_intent',
      ok:
        s.carrier != null &&
        carrierDims.length > 0 &&
        typeof record?.detected_at === 'string' &&
        s.carrier.detectedAt === record.detected_at,
      detail:
        s.carrier != null
          ? `request #${String(s.carrier.requestSeq)} answered chat_intent_dimensions ` +
            `[${carrierDims.join(', ')}] stamped ${String(s.carrier.detectedAt)}`
          : "no /api/adapt response carried the second record's detected_at",
    },
    {
      hop: 11,
      name: 'sdk_drew_follow_up_above_gate',
      ok:
        s.next != null &&
        s.next.sameSession === true &&
        typeof s.next.confidenceSent === 'number' &&
        typeof gate === 'number' &&
        s.next.confidenceSent > gate,
      detail:
        s.next != null
          ? `request #${String(s.next.requestSeq)} sent archetype_hint ${String(s.next.archetypeHint)} ` +
            `confidence ${String(s.next.confidenceSent)} (gate > ${String(gate)})` +
            (s.next.sameSession === true ? '' : ' — under a DIFFERENT session_id')
          : noFollowUpDetail(
              s.followUp,
              'no /api/adapt request was issued after the response that carried the second ' +
                "message's intent — the fold did not change a decision input (hint or the gate side)",
            ),
    },
    {
      hop: 12,
      name: 'adapted_response_after_second_message',
      ok: adapted != null,
      detail:
        adapted != null
          ? `request #${String(adapted.requestSeq)} ${String(adapted.source)} ` +
            `${String(adapted.archetype)} confidence ${String(adapted.confidence)} ` +
            `slots [${adapted.nonReorderSlots.join(', ')}]`
          : `none of ${String(after.length)} response(s) after the carrier passed AC(1)'s ` +
            `predicate — sources ${JSON.stringify(after.map((r) => r.body?.source ?? null))}, ` +
            `confidences ${JSON.stringify(after.map((r) => r.body?.confidence ?? null))}`,
    },
  ];
}

/**
 * The first response to a call issued after the second message's carrier, in this session, that
 * passes AC(1)'s `isAdaptedResponse()` — the single definition, so "adapted" cannot mean one thing
 * in AC(1) and another in AC(8). `null` when none does.
 *
 * @param {any} obs
 * @param {{value: number}} serverGate
 */
function adaptedAfterSecond(obs, serverGate) {
  const s = obs.second ?? {};
  const after = Array.isArray(s.responsesAfterCarrier) ? s.responsesAfterCarrier : [];
  const hit = after.find(
    (r) =>
      r.sessionId === obs.sessionId &&
      (s.carrier == null || r.requestSeq > s.carrier.requestSeq) &&
      isAdaptedResponse(r.body, serverGate),
  );
  return hit
    ? {
        requestSeq: hit.requestSeq,
        source: hit.body.source,
        archetype: hit.body.archetype,
        confidence: hit.body.confidence,
        nonReorderSlots: nonReorderSlots(hit.body),
      }
    : null;
}

/**
 * One command against the Redis that holds the shadow key, through SRH's POST-body form. Never
 * throws: an unreadable store is a fact the verdict names, not an abort.
 *
 * @param {ReadonlyArray<string>} cmd
 * @returns {Promise<{ok: true, result: any} | {ok: false, error: string}>}
 */
async function shadowCommand(cmd) {
  try {
    const res = await fetch(SHADOW_REDIS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SHADOW_REDIS_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(cmd),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${String(res.status)} from ${SHADOW_REDIS_URL}` };
    const json = await res.json();
    return { ok: true, result: json?.result ?? null };
  } catch (err) {
    return { ok: false, error: `${SHADOW_REDIS_URL}: ${String(err)}` };
  }
}

/**
 * The shadow chat-intent record for one session, found by SESSION id under any tenant
 * (`shadow:*:{session}:chat_intent`): the SDK does not know the tenant UUID (README §5.5) and the
 * key is written under the one ingest resolved from the API key, which the record's key then names.
 *
 * @param {string} sessionId
 * @returns {Promise<{readable: boolean, error?: string, key: string|null, record: any}>}
 */
async function readShadowRecord(sessionId) {
  const keys = await shadowCommand(['KEYS', `shadow:*:${sessionId}:chat_intent`]);
  if (!keys.ok) return { readable: false, error: keys.error, key: null, record: null };
  const list = Array.isArray(keys.result) ? keys.result : [];
  if (list.length === 0) return { readable: true, key: null, record: null };
  const got = await shadowCommand(['GET', list[0]]);
  if (!got.ok) return { readable: false, error: got.error, key: list[0], record: null };
  let record = null;
  try {
    record = JSON.parse(got.result);
  } catch {
    /* a non-JSON value is recorded as no record */
  }
  return { readable: true, key: list[0], record };
}

/** Poll `fn` until it returns something truthy or `budgetMs` has passed; `null` on the budget. */
async function pollUntil(fn, budgetMs, pollMs = 250) {
  // Monotonic, not `Date.now()`: this machine's wall clock steps (FOLLOW-1255).
  const start = performance.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (performance.now() - start >= budgetMs) return null;
    await sleep(pollMs);
  }
}

/**
 * Drive the chat arm in a fresh browser context and return what was observed. Asserts nothing:
 * `evaluateAc8()` grades the return value.
 *
 * Order: baseline → neutral message (the negative control) → positive message → second message
 * (FOLLOW-1302), on ONE page view —
 * no reload anywhere (FOLLOW-1301): every `/api/adapt` after the baseline is one the SDK chose to make.
 * The neutral message goes FIRST so its shadow record is the cold-key `SET … NX` write (ADR-0020
 * D3), which is what shows the shim processed it; sent after a signal-bearing message it would be a
 * no-op against the existing key and indistinguishable from a dead shim.
 *
 * ORDER IS BY SEQUENCE NUMBER, NEVER BY WALL CLOCK. "The first request after the carrier", "the
 * responses after the neutral message" and "the ingest POST after the dispatch" are all decided by
 * `seq` (assigned as each request goes out), and every wait runs on `performance.now()`. FOUND BY
 * EXECUTION (README §5.18, run 3 at `14bbe8ba`): the first version compared `requestedAt` stamps
 * from `Date.now()`, the wall clock stepped back ~2 s between the carrying response and the reload
 * (FOLLOW-1255's phenomenon), the already-answered carrier satisfied "requested at or after the
 * reload", and hop 6 graded the carrier's own `archetype_hint: neutral` — a false RED over a
 * session whose real next request sent and received `yield_hunter`. The stamps stay as evidence.
 * FOLLOW-1352 refines the follow-up pick (hops 6 and 11): "the request after the carrier" is not
 * "the next `seq`" — a parallel chain's request sent while the carrier was in flight has a higher
 * `seq` but pre-fold state — so it is the first request SENT after the carrier was answered and the
 * fold applied, on MONOTONIC stamps (`pickFollowUpAfterCarrier()`), never the wall clock.
 *
 * @param {import('playwright').Browser} browser
 * @returns {Promise<object>}
 */
async function driveChatArm(browser) {
  const budget = deriveChatRefreshBudget({ indexSrc: await readFile(SDK_ADAPT_LOOP_PATH, 'utf8') });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const calls = [];
  const callOf = new WeakMap();
  const posts = [];
  const postOf = new WeakMap();
  const pending = [];

  context.on('request', (req) => {
    if (req.method() !== 'POST') return;
    let sent = null;
    try {
      sent = JSON.parse(req.postData() ?? 'null');
    } catch {
      /* recorded with no body */
    }
    if (req.url().startsWith(DECISION_ORIGIN) && /\/adapt(\?|$)/.test(req.url())) {
      const entry = {
        seq: calls.length + 1,
        requestedAt: Date.now(),
        requestedMono: performance.now(),
        sessionId: sent?.session_id ?? null,
        archetypeHint: sent?.archetype_hint ?? null,
        confidence: sent?.confidence ?? null,
        status: null,
        receivedAt: null,
        receivedMono: null,
        body: null,
        failure: null,
      };
      callOf.set(req, entry);
      calls.push(entry);
    } else if (req.url().startsWith(`${INGEST_ORIGIN}/v1/events`)) {
      const events = Array.isArray(sent?.events) ? sent.events : [];
      const entry = {
        seq: posts.length + 1,
        requestedAt: Date.now(),
        sessionIds: [...new Set(events.map((e) => e.session_id))],
        types: events.map((e) => e.type),
        chatMessages: events
          .filter((e) => e.type === 'chat.message.sent')
          .map((e) => e.payload?.message ?? null),
        status: null,
        failure: null,
      };
      postOf.set(req, entry);
      posts.push(entry);
    }
  });
  context.on('response', (res) => {
    const post = postOf.get(res.request());
    if (post) post.status = res.status();
    const call = callOf.get(res.request());
    if (!call) return;
    call.status = res.status();
    pending.push(
      res.text().then(
        (t) => {
          try {
            call.body = JSON.parse(t.slice(0, 20000));
          } catch {
            call.failure = `non-JSON body: ${t.slice(0, 200)}`;
          }
          call.receivedAt = Date.now();
          call.receivedMono = performance.now();
        },
        (e) => {
          call.failure = String(e);
          call.receivedAt = Date.now();
          call.receivedMono = performance.now();
        },
      ),
    );
  });
  context.on('requestfailed', (req) => {
    const entry = callOf.get(req) ?? postOf.get(req);
    if (entry) entry.failure = req.failure()?.errorText ?? 'request failed';
  });

  await context.addInitScript(
    ([key]) => {
      try {
        window.localStorage.setItem(key, 'granted');
      } catch {
        /* storage unavailable — the run fails loudly at the baseline */
      }
    },
    [CONSENT_STORAGE_KEY],
  );
  const page = await context.newPage();
  // FOLLOW-1302: "without a reload" is graded — every main-frame navigation is counted.
  let navigations = 0;
  let navigationsAtBaseline = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });
  /**
   * The SDK's own persisted intent state (`persistIntentState()`, `estalara_intent_{session}` in
   * sessionStorage) — read, never written. Evidence only: it is how a run records the confidence
   * a fold reached when no follow-up call carries it (the negative case: nothing crosses the gate,
   * so nothing is sent).
   */
  const readSdkIntent = async (sid) =>
    page
      .evaluate(
        (key) => {
          try {
            const env = JSON.parse(window.sessionStorage.getItem(key) ?? 'null');
            const st = env?.state ?? null;
            return st
              ? {
                  archetype: st.archetype ?? null,
                  confidence: st.confidence ?? null,
                  chatPriorAppliedAt: st.chatPriorAppliedAt ?? null,
                }
              : null;
          } catch {
            return null;
          }
        },
        `estalara_intent_${String(sid)}`,
      )
      .catch(() => null);

  const answered = () => calls.filter((c) => c.body !== null);
  const firstAnswered = (pred, budgetMs) =>
    pollUntil(() => answered().find(pred) ?? null, budgetMs);
  /**
   * FOLLOW-1352: wait until the SDK's own persisted state shows the carrier's stamp as applied
   * (`chatPriorAppliedAt === stamp`) and return the monotonic time of the poll that saw it, or null.
   */
  const waitForFold = async (sid, stamp, budgetMs) => {
    const hit = await pollUntil(async () => {
      const st = await readSdkIntent(sid);
      return st?.chatPriorAppliedAt === stamp ? { mono: performance.now() } : null;
    }, budgetMs);
    return hit?.mono ?? null;
  };
  /**
   * The follow-up the SDK sent AFTER the fold, graded by `pickFollowUpAfterCarrier()` (FOLLOW-1352).
   * The page stays open for `debounceMs + slackMs` measured from the fold — the real follow-up is
   * drawn one chat-refresh debounce (adapt-loop.ts:35) after it, so a wait that started at the
   * carrier's answer could close the page before the call it exists to observe.
   */
  const followUpAfterFold = async (carrier, stamp, sid) => {
    const foldWaitMs = budget.budgetMs;
    const foldSeenMono = await waitForFold(sid, stamp, foldWaitMs);
    const windowMs = budget.debounceMs + budget.slackMs;
    const found = await pollUntil(
      () => pickFollowUpAfterCarrier({ calls, carrier, foldSeenMono }).next,
      foldSeenMono === null ? 0 : windowMs,
    );
    const picked = pickFollowUpAfterCarrier({ calls, carrier, foldSeenMono });
    return {
      next: found ?? null,
      followUp: {
        stamp,
        reason: found ? null : picked.reason,
        notGradedSeqs: picked.notGradedSeqs,
        foldWaitMs,
        windowMs,
        foldSeenMono,
        foldSeenAfterCarrierMs:
          foldSeenMono !== null && typeof carrier.receivedMono === 'number'
            ? Math.round(foldSeenMono - carrier.receivedMono)
            : null,
      },
    };
  };
  const summarize = (c) => ({
    seq: c.seq,
    requestedAt: c.requestedAt,
    receivedAt: c.receivedAt,
    requestedMono: c.requestedMono,
    receivedMono: c.receivedMono,
    sessionId: c.sessionId,
    archetypeHint: c.archetypeHint,
    confidenceSent: c.confidence,
    status: c.status,
    failure: c.failure,
    archetype: c.body?.archetype ?? null,
    confidence: c.body?.confidence ?? null,
    source: c.body?.source ?? null,
    holdoutGroup: c.body?.holdout_group ?? null,
    directives: Array.isArray(c.body?.directives) ? c.body.directives.length : null,
    chatIntentDimensions: c.body?.chat_intent_dimensions ?? null,
    chatIntentDetectedAt: c.body?.chat_intent_detected_at ?? null,
  });
  /** Load the page and wait for its first answered `/api/adapt` plus the listener settle. */
  const view = async () => {
    await page.goto(LISTING_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const first = await firstAnswered(() => true, CHAT_ARM_PAGE_BUDGET_MS);
    if (first) await sleep(CHAT_LISTENER_SETTLE_MS);
  };
  /** Dispatch the host page's chat event and wait for the SDK's own ingest POST carrying it. */
  const say = async (text) => {
    const sentAt = performance.now();
    const afterCallSeq = calls.length;
    const afterPostSeq = posts.length;
    await page.evaluate(
      ([eventName, message]) => {
        document.dispatchEvent(
          new CustomEvent(eventName, {
            detail: { message, char_count: message.length, is_agent: false },
          }),
        );
      },
      [CHAT_ARM_SCRIPT.eventName, text],
    );
    const carrying = () =>
      posts.filter((p) => p.seq > afterPostSeq && p.chatMessages.includes(text));
    await pollUntil(() => carrying().some((p) => is2xx(p.status)), budget.budgetMs);
    const all = carrying();
    const accepted = all.find((p) => is2xx(p.status)) ?? null;
    const last = all[all.length - 1] ?? null;
    return {
      sentAt,
      afterCallSeq,
      emitted: all.length > 0,
      ingestStatus: accepted?.status ?? last?.status ?? null,
      ingestFailure: accepted ? null : (last?.failure ?? null),
      ingestPosts: all.map((p) => ({ seq: p.seq, status: p.status, failure: p.failure })),
    };
  };

  const obs = {
    expectedArchetype: CHAT_ARM_SCRIPT.expectedArchetype,
    eventName: CHAT_ARM_SCRIPT.eventName,
    shimOrigin: CHAT_NLP_ORIGIN,
    shadowStore: SHADOW_REDIS_URL,
    budget,
    sessionId: null,
    drewHoldout: null,
    baseline: null,
    negative: null,
    positive: null,
    second: null,
    navigationsAfterBaseline: null,
    sdkIntent: { baseline: null, afterFirst: null, afterSecond: null },
    calls: [],
  };
  try {
    // ── baseline: what this session is served before anyone says anything ──
    await view();
    await Promise.all(pending);
    const baselineCalls = answered().slice();
    const sessionId = calls.find((c) => c.sessionId)?.sessionId ?? null;
    obs.sessionId = sessionId;
    obs.drewHoldout = holdoutFromResponses(baselineCalls.map((c) => c.body)).drewHoldout;
    obs.baseline = {
      archetype: baselineCalls[baselineCalls.length - 1]?.body?.archetype ?? null,
      archetypes: baselineCalls.map((c) => c.body?.archetype ?? null),
      responses: baselineCalls.length,
      shadowBefore: sessionId ? await readShadowRecord(sessionId) : null,
    };
    navigationsAtBaseline = navigations;
    obs.sdkIntent.baseline = sessionId ? await readSdkIntent(sessionId) : null;
    if (!sessionId || baselineCalls.length === 0 || obs.drewHoldout === true) return obs;

    // ── negative control: a neutral message; graded on the SDK's own chat-refresh calls ──
    const nSaid = await say(CHAT_ARM_SCRIPT.neutralMessage);
    let nShadow = { readable: true, key: null, record: null };
    if (is2xx(nSaid.ingestStatus)) {
      await pollUntil(async () => {
        nShadow = await readShadowRecord(sessionId);
        return !nShadow.readable || nShadow.record !== null;
      }, budget.budgetMs);
    }
    // Let the SDK's own chat-refresh attempts run out: they are the responses the control grades.
    const nWaitLeft = nSaid.sentAt + budget.cycleMs + 3000 - performance.now();
    if (nShadow.record !== null && nWaitLeft > 0) await sleep(nWaitLeft);
    await Promise.all(pending);
    const nAfter = answered().filter((c) => c.seq > nSaid.afterCallSeq);
    obs.negative = {
      message: CHAT_ARM_SCRIPT.neutralMessage,
      emitted: nSaid.emitted,
      ingestStatus: nSaid.ingestStatus,
      ingestPosts: nSaid.ingestPosts,
      shadowSeen: nShadow.record !== null,
      shadowReadable: nShadow.readable,
      shadowError: nShadow.error ?? null,
      shadowKey: nShadow.key,
      shadowRecord: nShadow.record,
      responsesAfterMessage: nAfter.length,
      archetypesAfter: nAfter.map((c) => c.body?.archetype ?? null),
      responsesCarryingChatIntent: nAfter.filter((c) => c.body?.chat_intent_dimensions).length,
    };

    // ── positive: the rental-yield question ──
    const priorStamp = nShadow.record?.detected_at ?? null;
    const shimHealthStatus = await fetch(`${CHAT_NLP_ORIGIN}/health`, {
      signal: AbortSignal.timeout(3000),
    }).then(
      (r) => r.status,
      () => null,
    );
    const pSaid = await say(CHAT_ARM_SCRIPT.positiveMessage);
    let pShadow = { readable: true, key: null, record: null };
    let shadowAdvanced = false;
    if (is2xx(pSaid.ingestStatus)) {
      await pollUntil(async () => {
        pShadow = await readShadowRecord(sessionId);
        shadowAdvanced =
          typeof pShadow.record?.detected_at === 'string' &&
          pShadow.record.detected_at !== priorStamp;
        return !pShadow.readable || shadowAdvanced;
      }, budget.budgetMs);
    }
    const stamp = shadowAdvanced ? pShadow.record.detected_at : null;
    const carrier = stamp
      ? await firstAnswered(
          (c) => c.seq > pSaid.afterCallSeq && c.body?.chat_intent_detected_at === stamp,
          budget.budgetMs,
        )
      : null;
    // "The NEXT /api/adapt" is the first request the SDK issues after the carrier, on the same page
    // (FOLLOW-1301: the fold schedules it one chat-refresh debounce later). No reload, no harness
    // trigger: if the SDK draws no call, hop 6 reads "no /api/adapt request was issued".
    // FOLLOW-1352: "after" means SENT after the carrier was answered AND the fold was applied —
    // not "the next sequence number" (a parallel chain's request can sit between them).
    const { next: nextSent, followUp: firstFollowUp } = carrier
      ? await followUpAfterFold(carrier, stamp, sessionId)
      : { next: null, followUp: null };
    if (nextSent) {
      await pollUntil(
        () => nextSent.body !== null || nextSent.failure !== null,
        CHAT_ARM_PAGE_BUDGET_MS,
      );
    }
    await Promise.all(pending);
    const next = nextSent;
    obs.positive = {
      message: CHAT_ARM_SCRIPT.positiveMessage,
      emitted: pSaid.emitted,
      ingestStatus: pSaid.ingestStatus,
      ingestFailure: pSaid.ingestFailure,
      ingestPosts: pSaid.ingestPosts,
      shimHealthStatus,
      shadowReadable: pShadow.readable,
      shadowError: pShadow.error ?? null,
      shadowKey: pShadow.key,
      shadowAdvanced,
      priorStamp,
      record: shadowAdvanced ? pShadow.record : null,
      recordSeen: pShadow.record,
      carrier: carrier
        ? {
            requestSeq: carrier.seq,
            dimensions: carrier.body.chat_intent_dimensions ?? null,
            detectedAt: carrier.body.chat_intent_detected_at ?? null,
          }
        : null,
      next: next
        ? {
            requestSeq: next.seq,
            sameSession: next.sessionId === sessionId,
            archetypeHint: next.archetypeHint,
            responseStatus: next.status,
            responseArchetype: next.body?.archetype ?? null,
          }
        : null,
      followUp: firstFollowUp,
    };
    obs.sdkIntent.afterFirst = await readSdkIntent(sessionId);

    // ── second message (FOLLOW-1302): a consistent rental-yield question that CHANGES a dimension.
    // Graded on what the buyer sees: a response passing AC(1)'s predicate, drawn by the SDK itself
    // on this page view. Sent only once the first message's follow-up has settled, so its carrier
    // and follow-up cannot be confused with the first message's.
    const secondHealth = await fetch(`${CHAT_NLP_ORIGIN}/health`, {
      signal: AbortSignal.timeout(3000),
    }).then(
      (r) => r.status,
      () => null,
    );
    const firstStamp = stamp;
    const sSaid = await say(CHAT_ARM_SCRIPT.secondMessage);
    let sShadow = { readable: true, key: null, record: null };
    let sAdvanced = false;
    if (is2xx(sSaid.ingestStatus) && firstStamp) {
      await pollUntil(async () => {
        sShadow = await readShadowRecord(sessionId);
        sAdvanced =
          typeof sShadow.record?.detected_at === 'string' &&
          sShadow.record.detected_at !== firstStamp;
        return !sShadow.readable || sAdvanced;
      }, budget.budgetMs);
    }
    const sStamp = sAdvanced ? sShadow.record.detected_at : null;
    const sCarrier = sStamp
      ? await firstAnswered(
          (c) => c.seq > sSaid.afterCallSeq && c.body?.chat_intent_detected_at === sStamp,
          budget.budgetMs,
        )
      : null;
    // The SDK's own follow-up (FOLLOW-1306: drawn when the fold crosses the directive gate). Its
    // response is where the model-written copy arrives, so it gets the page budget twice over.
    const { next: sNext, followUp: secondFollowUp } = sCarrier
      ? await followUpAfterFold(sCarrier, sStamp, sessionId)
      : { next: null, followUp: null };
    if (sNext) {
      await pollUntil(
        () => sNext.body !== null || sNext.failure !== null,
        2 * CHAT_ARM_PAGE_BUDGET_MS,
      );
    }
    await Promise.all(pending);
    obs.sdkIntent.afterSecond = await readSdkIntent(sessionId);
    obs.second = {
      message: CHAT_ARM_SCRIPT.secondMessage,
      emitted: sSaid.emitted,
      ingestStatus: sSaid.ingestStatus,
      ingestFailure: sSaid.ingestFailure,
      ingestPosts: sSaid.ingestPosts,
      shimHealthStatus: secondHealth,
      shadowReadable: sShadow.readable,
      shadowError: sShadow.error ?? null,
      shadowAdvanced: sAdvanced,
      record: sAdvanced ? sShadow.record : null,
      recordSeen: sShadow.record,
      carrier: sCarrier
        ? {
            requestSeq: sCarrier.seq,
            dimensions: sCarrier.body.chat_intent_dimensions ?? null,
            detectedAt: sCarrier.body.chat_intent_detected_at ?? null,
            confidenceSent: sCarrier.confidence,
          }
        : null,
      next: sNext
        ? {
            requestSeq: sNext.seq,
            sameSession: sNext.sessionId === sessionId,
            archetypeHint: sNext.archetypeHint,
            confidenceSent: sNext.confidence,
            responseStatus: sNext.status,
            responseArchetype: sNext.body?.archetype ?? null,
          }
        : null,
      followUp: secondFollowUp,
      // Every answered call issued after the carrier: hop 12 runs `isAdaptedResponse()` over these.
      responsesAfterCarrier: sCarrier
        ? answered()
            .filter((c) => c.seq > sCarrier.seq)
            .map((c) => ({ requestSeq: c.seq, sessionId: c.sessionId, body: c.body }))
        : [],
    };
    obs.navigationsAfterBaseline = navigations - navigationsAtBaseline;
    return obs;
  } finally {
    obs.calls = calls.map(summarize);
    obs.ingestPosts = posts;
    await context.close().catch(() => {});
  }
}

// ─── FOLLOW-1367: AC(5)'s CTA click must not land on the quiz card ──────────────────────────

/**
 * Make sure no quiz card overlays the page before AC(5) clicks the fixture CTA (FOLLOW-1367).
 *
 * In one Q5-series run the served v2 card (616 px tall on this viewport) was still open and
 * `[data-estalara-cta]` never became clickable within 5 s → `cta_not_clicked`. The SDK e2e spec hit
 * the same overlay and fixed it by seeding the dismissed cooldown (#1055); this session needs its
 * quiz, so the card is closed instead, the way a buyer closes it: first a short wait for its own
 * unmount (the AC(1) loop's confirm may still be resolving), then the card's own `×`
 * (`.estalara-quiz-close`), then a wait for it to be gone. Never `force: true` (FOLLOW-1075: a
 * forced click lands on whatever covers the target and reports success). A `×` on the result screen
 * resolves it as `unconfirmed`; that is after AC(1)/AC(2) were graded, and the request it draws is
 * counted in `responsesArrivedAfterVerdict` like any other.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<{visibleBefore: boolean, screen: 'result'|'question'|null,
 *   action: 'none'|'waited'|'closed_with_x', cleared: boolean}>}
 */
async function closeQuizCardBeforeCta(page) {
  const card = page.locator('.estalara-quiz-card').first();
  if (!(await card.isVisible().catch(() => false))) {
    return { visibleBefore: false, screen: null, action: 'none', cleared: true };
  }
  const onResult = await page
    .locator('.estalara-quiz-result')
    .first()
    .isVisible()
    .catch(() => false);
  const screen = onResult ? 'result' : 'question';
  const gone = (timeout) =>
    card
      .waitFor({ state: 'hidden', timeout })
      .then(() => true)
      .catch(() => false);
  if (await gone(2000)) return { visibleBefore: true, screen, action: 'waited', cleared: true };
  await page
    .locator('.estalara-quiz-close')
    .first()
    .click({ timeout: 3000 })
    .catch(() => {});
  return { visibleBefore: true, screen, action: 'closed_with_x', cleared: await gone(10000) };
}

// ─── FOLLOW-1361: AC(10), the quiz confirmation path (Faza Q package Q6, MASTER_DESIGN §E.4.10) ──
//
// Three sub-sessions, each in its own fresh browser context, walk the SERVED quiz tree to its result
// screen (`.estalara-quiz-result`) through real clicks and then close it three ways:
//
//   (a) confirm — `.estalara-quiz-confirm`: a `quiz_runs` row `confirmed` on the served hash, the
//       SDK state at the leaf at the confirmed mass (0.90), the first `/api/adapt` request after the
//       fold carrying the leaf at 0.90 and the capped similarity (0.85, ESC-087) and answered
//       ADAPTED by AC(1)'s own predicate; then two contrary behaviour signals, dispatched the way a
//       host page dispatches them, leave the leaf and its 0.90 unchanged;
//   (b) correct — `.estalara-quiz-reject` ("Not quite"), then an alternative read off the DOM: a row
//       `corrected` with the walked leaf and the chosen alternative, and the first request after the
//       correction folded carrying the CHOSEN archetype at 0.90, answered ADAPTED for it;
//   (c) × on the result screen — the negative control: a row `unconfirmed`, no
//       `confirmed_archetype`, the SDK state at the completed mass (0.72).
//
// NOTHING IS INJECTED. The leaf, the offered alternatives and the chosen one are read from the
// widget's own text and mapped to archetype ids through the served definition's `confirm.names_i18n`;
// the row is read from Postgres (`quiz_runs`, written by `POST /api/quiz/run` from the SDK's pings);
// the state is the SDK's own persisted envelope (read-only, the way AC(8) reads it); the request and
// the response are what crossed the wire. The fold masses and the similarity cap are read from the
// SDK source (`readQuizFoldConstants()`), never typed in here.
//
// WHICH REQUEST IS "THE FIRST AFTER THE FOLD" — the FOLLOW-1352 rule, adapted to what the code does.
// `intent-loop.ts` `onComplete` folds the result (`applyQuizLeaf`), persists it, and calls
// `adapt.refresh()` UNCONDITIONALLY, in the same click task, for every outcome (confirmed,
// corrected, ×). There is no chat-style follow-up and no hint-change condition: the refresh is
// drawn because the quiz resolved. A harness poll of the persisted state can therefore never see
// the fold BEFORE that request leaves (FOLLOW-1352's `foldSeenMono` floor would exclude the very
// request it exists to find). The state stamp the request itself carries is used instead: the fold
// writes `quiz_traits` into the state, and `fetchDirectives()` sends `traits` iff the state has it,
// so `traits` on a request body is a field only a post-fold state can produce. The pick
// (`pickFirstRequestAfterQuizFold()`) takes the first request SENT at or after the decisive click
// that carries it, and refuses (reason, never a guess) when the fold was not observed in the
// persisted state or when a request sent BEFORE the click already carried `traits` (the marker would
// then prove nothing). It never selects on the hint or the confidence it is about to grade, so "the
// follow-up carries the pre-correction hint" stays a reachable RED.
//
// HOLDOUT. (a) and (b) need an ADAPTED response, which a held-out session cannot receive by design.
// The draw is read off the page-load `/api/adapt` response BEFORE the quiz is walked, and such a
// session is replaced by a fresh context, at most `AC10_MAX_DRAWS` sessions per sub-session; every
// draw is recorded. Only when the last one drew holdout too is the sub-session UNMEASURED (as AC(8)
// is), and only if nothing else failed. (c) grades no adaptation and keeps its first session.

/** How many fresh sessions (a) and (b) may draw before a holdout draw is graded UNMEASURED. */
export const AC10_MAX_DRAWS = 3;
/** How long the auto-opening quiz card may take to mount (the config request has 15 s). */
const AC10_QUIZ_MOUNT_MS = 30000;
/** How long the decisive click may take to show up as the fold in the persisted state. */
const AC10_FOLD_WAIT_MS = 10000;
/** How long the `quiz_runs` row may take to reach its terminal status (fire-and-forget ping). */
const AC10_ROW_WAIT_MS = 15000;
/** How long the contrary signals may take to reach ingest (the SDK flushes every 2 s). */
const AC10_CONTRARY_WAIT_MS = 8000;
/** Equality for the fold masses: they are assigned as literals, never computed. */
const MASS_EPSILON = 1e-9;

const SDK_INTENT_PATH = new URL('../../../packages/sdk/src/core/intent.ts', import.meta.url);
const SDK_ADAPT_PATH = new URL('../../../packages/sdk/src/core/adapt.ts', import.meta.url);

/**
 * The quiz fold masses and the sent-similarity cap, read out of the SDK source — the same "read,
 * don't copy" rule as `readServerConfidenceGate()`. Pure over the two sources so a test can hand it
 * an edited copy; throws when a constant is no longer there.
 *
 * @param {{intentSrc: string, adaptSrc: string}} src
 * @returns {{completed: number, confirmed: number, similarityCap: number, source: string}}
 */
export function readQuizFoldConstants({ intentSrc, adaptSrc }) {
  const read = (src, name, file) => {
    const m = new RegExp(`const\\s+${name}\\s*=\\s*([0-9.]+)\\s*;`).exec(src);
    if (!m) throw new Error(`Could not read ${name} from packages/sdk/src/core/${file}.`);
    return Number(m[1]);
  };
  return {
    completed: read(intentSrc, 'QUIZ_COMPLETED_MASS', 'intent.ts'),
    confirmed: read(intentSrc, 'QUIZ_CONFIRMED_MASS', 'intent.ts'),
    similarityCap: read(adaptSrc, 'SENT_SIMILARITY_CAP', 'adapt.ts'),
    source:
      'packages/sdk/src/core/intent.ts QUIZ_COMPLETED_MASS / QUIZ_CONFIRMED_MASS; ' +
      'packages/sdk/src/core/adapt.ts SENT_SIMILARITY_CAP',
  };
}

/** `readQuizFoldConstants()` over the files on disk. */
export async function readQuizFoldConstantsFromSdk() {
  return readQuizFoldConstants({
    intentSrc: await readFile(SDK_INTENT_PATH, 'utf8'),
    adaptSrc: await readFile(SDK_ADAPT_PATH, 'utf8'),
  });
}

/**
 * The archetype id whose display name (any language) in the served `confirm.names_i18n` is `text`,
 * or null. The widget renders `names_i18n[id]` in the active language; matching every language
 * keeps the read independent of the EN | PL switcher.
 *
 * @param {Record<string, Record<string, string>>|null|undefined} names
 * @param {string|null|undefined} text
 * @returns {string|null}
 */
export function archetypeFromDisplayName(names, text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!names || t === '') return null;
  const hits = Object.entries(names).filter(([, bag]) =>
    Object.values(bag ?? {}).some((v) => typeof v === 'string' && v.trim() === t),
  );
  return hits.length === 1 ? hits[0][0] : null;
}

/**
 * The two contrary behaviour signals for a confirmed leaf: a 3-bedroom bookmark pushes
 * `family_buyer` / `upsizer` (`applyBehavioralSignal`, intent.ts), so it is contrary to every
 * other leaf; for those two it would be concordant, and a commercial bookmark is used instead.
 * Sent as the host page's `estalara:listing:favorited` detail (`intent-loop.ts` listener).
 *
 * @param {string|null} leaf
 * @returns {{bedroomCount?: number, listingType?: string}}
 */
export function contrarySignalFor(leaf) {
  return leaf === 'family_buyer' || leaf === 'upsizer'
    ? { listingType: 'commercial' }
    : { bedroomCount: 3 };
}

/**
 * The first `/api/adapt` request the SDK sent after the quiz result folded — see the section header
 * for why the marker is `traits` on the request body and the floor is the decisive click. Pure.
 *
 * @param {{calls: Array<{seq: number, requestedMono?: number|null, traitsSent?: boolean}>,
 *   resolveClickMono: number|null|undefined, foldSeen: boolean}} args
 * @returns {{next: object|null, reason: 'resolve_click_not_recorded'|'fold_not_observed'|
 *   'fold_marker_not_unique'|'none_sent_after_fold'|null, notGradedSeqs: number[]}}
 */
export function pickFirstRequestAfterQuizFold({ calls, resolveClickMono, foldSeen }) {
  if (typeof resolveClickMono !== 'number') {
    return { next: null, reason: 'resolve_click_not_recorded', notGradedSeqs: [] };
  }
  if (foldSeen !== true) return { next: null, reason: 'fold_not_observed', notGradedSeqs: [] };
  const sentAfter = (c) =>
    typeof c.requestedMono === 'number' && c.requestedMono >= resolveClickMono;
  const before = calls.filter((c) => !sentAfter(c));
  if (before.some((c) => c.traitsSent === true)) {
    return {
      next: null,
      reason: 'fold_marker_not_unique',
      notGradedSeqs: before.filter((c) => c.traitsSent === true).map((c) => c.seq),
    };
  }
  const after = calls.filter(sentAfter);
  const eligible = after.filter((c) => c.traitsSent === true);
  return {
    next: eligible[0] ?? null,
    reason: eligible.length > 0 ? null : 'none_sent_after_fold',
    notGradedSeqs: after.filter((c) => c.traitsSent !== true).map((c) => c.seq),
  };
}

/**
 * The served quiz definition, as the SDK fetches it: `GET /api/quiz/public-config` with the
 * fixture's own key and the fixture page's `Origin`. Never throws.
 *
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<{status: number|null, body: any, error: string|null, ms: number}>}
 */
export async function fetchServedQuizConfig({ timeoutMs = 30000 } = {}) {
  const started = performance.now();
  try {
    const apiKey = await readFixtureApiKey();
    const res = await fetch(`${DECISION_ORIGIN}/api/quiz/public-config`, {
      headers: { Authorization: `Bearer ${apiKey}`, Origin: new URL(LISTING_URL).origin },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body, error: null, ms: Math.round(performance.now() - started) };
  } catch (err) {
    return {
      status: null,
      body: null,
      error: String(err),
      ms: Math.round(performance.now() - started),
    };
  }
}

/**
 * Whether a public-config answer serves the tree AC(10) walks: 200, `data_source: 'db'` (a
 * `fallback` answer carries no definition and the SDK then shows no card, FOLLOW-1370), a sha-256
 * `definition_hash` (not a label), and a `confirm` block (no block = no result screen). Pure.
 *
 * @param {{status: number|null, body: any, error?: string|null}} probe
 * @returns {{ok: boolean, reason: string, definitionHash: string|null,
 *   names: Record<string, Record<string, string>>|null}}
 */
export function evaluateServedQuizConfig(probe) {
  const b = probe?.body ?? null;
  const hash = typeof b?.definition_hash === 'string' ? b.definition_hash : null;
  const names = b?.quiz_definition?.confirm?.names_i18n ?? null;
  const fail = (reason) => ({ ok: false, reason, definitionHash: hash, names });
  if (probe?.status !== 200) {
    return fail(`HTTP ${String(probe?.status)}${probe?.error ? ` (${probe.error})` : ''}`);
  }
  if (b?.data_source !== 'db') return fail(`data_source=${String(b?.data_source)}`);
  if (hash === null || !/^[0-9a-f]{64}$/.test(hash)) {
    return fail(`definition_hash=${String(hash)} is not a served sha-256`);
  }
  if (!names || Object.keys(names).length === 0) {
    return fail('the served definition has no confirm block (no result screen)');
  }
  return {
    ok: true,
    reason: `200, data_source db, definition_hash ${hash}`,
    definitionHash: hash,
    names,
  };
}

/**
 * Bring-up and preflight form (FOLLOW-1367): throws unless public-config serves the tree.
 *
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<{definitionHash: string, ms: number, reason: string}>}
 */
export async function assertServedQuizConfig(options) {
  const probe = await fetchServedQuizConfig(options);
  const v = evaluateServedQuizConfig(probe);
  if (!v.ok) {
    throw new Error(
      `GET ${DECISION_ORIGIN}/api/quiz/public-config does not serve the quiz tree: ${v.reason}. ` +
        'The SDK would show no quiz card (it has no built-in tree, FOLLOW-1370) and AC(10) is RED.',
    );
  }
  return { definitionHash: v.definitionHash, ms: probe.ms, reason: v.reason };
}

/** The AC(1) predicate's archetype must also be the one the request asked for (STOP rule). */
const adaptedFor = (body, archetype, serverGate) =>
  isAdaptedResponse(body, serverGate) && body.archetype === archetype;

const near = (x, y) =>
  typeof x === 'number' && typeof y === 'number' && Math.abs(x - y) < MASS_EPSILON;

/** Unmet entries that are the holdout draw itself — the only ones `gradeRun()` may excuse. */
export const AC10_HOLDOUT_UNMET = Object.freeze(['a:drewHoldout', 'b:drewHoldout']);

/** FOLLOW-1369: an unmet entry saying the served config never reached the browser (`a:`..`c:`). */
export const AC10_CONFIG_UNMET_RE = /^[abc]:servedConfigNeverReachedBrowser\(/;

/**
 * FOLLOW-1369: did the served quiz config fail to reach the browser? Since FOLLOW-1370 the SDK has
 * no built-in tree: without the served definition it shows NO card. True (as the timings string)
 * only when the card never mounted (`quizShown !== true`) AND the page's `/api/quiz/public-config`
 * GET never completed with a 200. A GET that DID complete while no card mounted is an SDK defect
 * and stays RED (`quizNotShown`, returns null). No network record (`configNet` absent) is not
 * classified.
 *
 * @param {object} s - one sub-session's observations
 * @returns {string|null} the OPTIONS/GET timings when unserved, else null
 */
export function servedConfigNeverReachedBrowser(s) {
  const net = s?.configNet ?? null;
  if (net === null || typeof net !== 'object') return null;
  if (s.quizShown === true) return null;
  const gets = Array.isArray(net.get) ? net.get : [];
  if (gets.some((g) => g.finishedMono !== null && g.failure === null && g.status === 200)) {
    return null;
  }
  const fmt = (e) =>
    `${e.method} ${e.status === null ? 'no-response' : String(e.status)} ` +
    (e.finishedMono === null
      ? 'pending'
      : `${String(Math.round(e.finishedMono - e.startedMono))}ms`) +
    (e.failure ? ` ${e.failure}` : '');
  const opts = Array.isArray(net.options) ? net.options : [];
  const all = [...opts, ...gets].map(fmt);
  return all.length > 0 ? all.join('; ') : 'no public-config request seen';
}

/**
 * The conjuncts every sub-session shares: the widget ran on the served tree and a row exists.
 *
 * @returns {string[]} unmet entries, prefixed
 */
function ac10CommonUnmet(p, s, served) {
  const unmet = [];
  // FOLLOW-1369: the served config never reached the page — no card (FOLLOW-1370), so every other
  // conjunct (and a throw waiting for it) is meaningless; it is the ONLY entry.
  const unreached = servedConfigNeverReachedBrowser(s);
  if (unreached !== null) return [`${p}:servedConfigNeverReachedBrowser(${unreached})`];
  if (s.error) return [`${p}:threw`];
  if (s.quizShown !== true) unmet.push(`${p}:quizNotShown`);
  if (s.resultShown !== true) unmet.push(`${p}:resultScreenNotShown`);
  if (!s.leaf || s.leaf === 'neutral') unmet.push(`${p}:leafNotReadFromResultScreen`);
  const row = s.row ?? null;
  if (row === null) {
    unmet.push(s.rowError ? `${p}:quizRunRowUnreadable` : `${p}:quizRunRowMissing`);
    return unmet;
  }
  if (served.ok && row.definition_hash !== served.definitionHash) {
    unmet.push(`${p}:definitionHashNotServed=${String(row.definition_hash)}`);
  }
  if (row.resolved_archetype !== s.leaf) {
    unmet.push(`${p}:rowResolvedArchetype=${String(row.resolved_archetype)}`);
  }
  const steps = Array.isArray(row.answer_path) ? row.answer_path.length : null;
  if (!Array.isArray(row.step_ms) || row.step_ms.length === 0 || row.step_ms.length !== steps) {
    unmet.push(`${p}:stepMs=${JSON.stringify(row.step_ms)}/answerPath=${String(steps)}`);
  }
  return unmet;
}

/**
 * The follow-up conjuncts for (a) and (b): the first request after the fold carries `archetype` at
 * the confirmed mass and the capped similarity, and its response is ADAPTED for `archetype`.
 */
function ac10FollowUpUnmet(p, s, archetype, preFoldLeaf, fold, serverGate) {
  const unmet = [];
  const req = s.followUp?.request ?? null;
  if (req === null) return [`${p}:noFollowUp(${String(s.followUp?.reason ?? 'not_observed')})`];
  if (req.archetypeHint !== archetype) {
    unmet.push(
      preFoldLeaf !== null && req.archetypeHint === preFoldLeaf && archetype !== preFoldLeaf
        ? `${p}:followUpCarriesPreCorrectionHint=${String(req.archetypeHint)}`
        : `${p}:followUpHint=${String(req.archetypeHint)}`,
    );
  }
  if (!near(req.confidence, fold.confirmed)) {
    unmet.push(`${p}:followUpConfidence=${String(req.confidence)}`);
  }
  if (!near(req.similarity, fold.similarityCap)) {
    unmet.push(`${p}:followUpSimilarity=${String(req.similarity)}`);
  }
  if (s.drewHoldout === true) {
    unmet.push(`${p}:drewHoldout`);
  } else if (!adaptedFor(s.followUp?.body ?? null, archetype, serverGate)) {
    const b = s.followUp?.body ?? null;
    unmet.push(
      `${p}:followUpNotAdapted(${String(b?.source ?? null)}/${String(b?.fallback_reason ?? '')}` +
        ` ${String(b?.archetype ?? null)} @ ${String(b?.confidence ?? null)})`,
    );
  }
  return unmet;
}

/**
 * AC(10)'s verdict, as a pure function over what `driveAc10()` observed (FOLLOW-1361).
 *
 * GREEN needs every conjunct of all three sub-sessions (see the section header): (a) and (b) are
 * the paths the plan grades, (c) is their negative control — a × must NOT read as a confirmation.
 * Each unmet conjunct is one entry, prefixed `a:` / `b:` / `c:`, so a red names its sub-session.
 * `served:*` entries say the served tree was not available to grade against at all.
 *
 * UNMEASURED only when every unmet entry is a holdout draw of (a) or (b) (`AC10_HOLDOUT_UNMET`) —
 * the run then drew `AC10_MAX_DRAWS` held-out sessions in a row for that sub-session.
 *
 * @param {object} obs - `driveAc10()`'s return value.
 * @param {{value: number}} serverGate
 * @returns {{ok: boolean, name: string, summary: string, evidence: object}}
 */
export function evaluateAc10(obs, serverGate) {
  const fold = obs.fold;
  const served = evaluateServedQuizConfig(obs.servedConfig ?? null);
  const unmet = [];
  if (!served.ok) unmet.push(`served:${served.reason}`);
  const a = obs.sessions?.confirm ?? { error: 'not run' };
  const b = obs.sessions?.correct ?? { error: 'not run' };
  const c = obs.sessions?.dismiss ?? { error: 'not run' };

  // (a) confirm
  const ua = ac10CommonUnmet('a', a, served);
  if (!a.error && servedConfigNeverReachedBrowser(a) === null) {
    if (a.row) {
      if (a.row.status !== 'confirmed') ua.push(`a:rowStatus=${String(a.row.status)}`);
      if (a.row.confirmed_archetype !== a.leaf) {
        ua.push(`a:rowConfirmedArchetype=${String(a.row.confirmed_archetype)}`);
      }
    }
    const st = a.stateAtFold ?? null;
    if (
      !st ||
      st.archetype !== a.leaf ||
      !near(st.confidence, fold.confirmed) ||
      !st.quiz_confirmed
    ) {
      ua.push(
        `a:stateAtFold=${JSON.stringify(st && { archetype: st.archetype, confidence: st.confidence, quiz_confirmed: st.quiz_confirmed ?? null })}`,
      );
    }
    ua.push(...ac10FollowUpUnmet('a', a, a.leaf, null, fold, serverGate));
    const k = a.contrary ?? null;
    const applied =
      k !== null &&
      k.bookmarkEventsEmitted >= 2 &&
      typeof k.signalCountBefore === 'number' &&
      typeof k.stateAfter?.signal_count === 'number' &&
      k.stateAfter.signal_count - k.signalCountBefore >= 2;
    if (!applied) {
      ua.push(
        `a:contrarySignalsNotApplied(emitted=${String(k?.bookmarkEventsEmitted ?? null)}, ` +
          `signal_count ${String(k?.signalCountBefore ?? null)}→${String(k?.stateAfter?.signal_count ?? null)})`,
      );
    } else {
      if (k.stateAfter.archetype !== a.leaf)
        ua.push(`a:leafDrifted=${String(k.stateAfter.archetype)}`);
      if (!near(k.stateAfter.confidence, fold.confirmed)) {
        ua.push(`a:leafLostMass=${String(k.stateAfter.confidence)}`);
      }
    }
  }
  unmet.push(...ua);

  // (b) correct
  const ub = ac10CommonUnmet('b', b, served);
  if (!b.error && servedConfigNeverReachedBrowser(b) === null) {
    const chosen = b.chosen ?? null;
    if (!chosen || chosen === b.leaf || chosen === 'neutral') {
      ub.push(`b:noAlternativeChosen=${String(chosen)}`);
    }
    if (!Array.isArray(b.offered) || b.offered.length === 0 || !b.offered.includes(chosen)) {
      ub.push(`b:offeredFromDom=${JSON.stringify(b.offered ?? null)}`);
    }
    if (b.row) {
      if (b.row.status !== 'corrected') ub.push(`b:rowStatus=${String(b.row.status)}`);
      if (b.row.confirmed_archetype !== chosen) {
        ub.push(`b:rowConfirmedArchetype=${String(b.row.confirmed_archetype)}`);
      }
      if (JSON.stringify(b.row.offered ?? null) !== JSON.stringify(b.offered ?? null)) {
        ub.push(`b:rowOffered=${JSON.stringify(b.row.offered ?? null)}`);
      }
    }
    const st = b.stateAtFold ?? null;
    if (
      !st ||
      st.archetype !== chosen ||
      !near(st.confidence, fold.confirmed) ||
      !st.quiz_confirmed
    ) {
      ub.push(
        `b:stateAtFold=${JSON.stringify(st && { archetype: st.archetype, confidence: st.confidence, quiz_confirmed: st.quiz_confirmed ?? null })}`,
      );
    }
    ub.push(...ac10FollowUpUnmet('b', b, chosen, b.leaf ?? null, fold, serverGate));
  }
  unmet.push(...ub);

  // (c) × on the result screen — the negative control
  const uc = ac10CommonUnmet('c', c, served);
  if (!c.error && servedConfigNeverReachedBrowser(c) === null) {
    if (c.row) {
      if (c.row.status !== 'unconfirmed') uc.push(`c:rowStatus=${String(c.row.status)}`);
      if (c.row.confirmed_archetype !== null) {
        uc.push(`c:rowConfirmedArchetype=${String(c.row.confirmed_archetype)}`);
      }
    }
    const st = c.stateAtFold ?? null;
    if (
      !st ||
      st.archetype !== c.leaf ||
      !near(st.confidence, fold.completed) ||
      st.quiz_confirmed
    ) {
      uc.push(
        `c:stateAtFold=${JSON.stringify(st && { archetype: st.archetype, confidence: st.confidence, quiz_confirmed: st.quiz_confirmed ?? null })}`,
      );
    }
  }
  unmet.push(...uc);

  const ok = unmet.length === 0;
  const line = (p, s, extra) =>
    s.error
      ? `${p}: threw`
      : `${p}: ${String(s.leaf)}${extra}, row ${String(s.row?.status ?? 'none')}, follow-up ` +
        String(s.followUp?.body?.source ?? s.followUp?.reason ?? '—');
  const summary =
    `${line('(a) confirm', a, '')}; ${line('(b) correct', b, ` → ${String(b.chosen ?? null)}`)}; ` +
    `${line('(c) ×', c, '')}; served hash ${String(served.definitionHash)}; ` +
    `unmet: [${unmet.join(', ')}]`;
  return {
    ok,
    name:
      'quiz confirmation path on the served tree: (a) confirm → quiz_runs confirmed, SDK state ' +
      `${String(fold.confirmed)}, the first /api/adapt after the fold ADAPTED, two contrary signals ` +
      'leave the leaf; (b) correct → corrected, the first request after the correction folded ' +
      `serves the chosen archetype; (c) × → unconfirmed at ${String(fold.completed)}`,
    summary,
    evidence: {
      fold,
      servedConfig: { ok: served.ok, reason: served.reason, definitionHash: served.definitionHash },
      unmetPreconditions: unmet,
      sessions: { confirm: a, correct: b, dismiss: c },
    },
  };
}

/**
 * One AC(10) sub-session: a fresh context, the page, and every request the grade needs. Asserts
 * nothing; `evaluateAc10()` grades what it returns.
 *
 * @param {import('playwright').Browser} browser
 * @param {'confirm'|'correct'|'dismiss'} kind
 * @param {{names: Record<string, Record<string, string>>|null}} served
 * @returns {Promise<object>}
 */
async function driveAc10Session(browser, kind, served) {
  const draws = [];
  for (let attempt = 1; ; attempt++) {
    const s = await openAc10Session(browser);
    draws.push({ sessionId: s.obs.sessionId, drewHoldout: s.obs.drewHoldout });
    const redraw = kind !== 'dismiss' && s.obs.drewHoldout === true && attempt < AC10_MAX_DRAWS;
    if (redraw) {
      await s.close();
      continue;
    }
    try {
      await resolveAc10Session(s, kind, served);
    } catch (err) {
      s.obs.error = String(err && err.stack ? err.stack : err);
    } finally {
      await s.close();
    }
    // FOLLOW-1369: the served config never reached this page → UNMEASURED for this draw; redraw.
    const unreached = servedConfigNeverReachedBrowser(s.obs);
    draws[draws.length - 1].servedConfigNeverReachedBrowser = unreached;
    if (unreached !== null && attempt < AC10_MAX_DRAWS) continue;
    return { ...s.obs, draws };
  }
}

/** Open a fresh context on the fixture page and record its first `/api/adapt` answer. */
async function openAc10Session(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const calls = [];
  const callOf = new WeakMap();
  const ingest = [];
  const pings = [];
  const pending = [];
  // FOLLOW-1369: the page's /api/quiz/public-config OPTIONS + GET with timings, from network events.
  const configNet = { options: [], get: [] };
  const configOf = new WeakMap();
  context.on('request', (req) => {
    const m = req.method();
    if ((m === 'GET' || m === 'OPTIONS') && req.url().includes('/api/quiz/public-config')) {
      const e = {
        method: m,
        startedMono: performance.now(),
        finishedMono: null,
        status: null,
        failure: null,
      };
      configOf.set(req, e);
      (m === 'GET' ? configNet.get : configNet.options).push(e);
      return;
    }
    if (m !== 'POST') return;
    let sent = null;
    try {
      sent = JSON.parse(req.postData() ?? 'null');
    } catch {
      /* recorded with no body */
    }
    const url = req.url();
    if (url.startsWith(DECISION_ORIGIN) && /\/adapt(\?|$)/.test(url)) {
      const entry = {
        seq: calls.length + 1,
        requestedAt: Date.now(),
        requestedMono: performance.now(),
        sessionId: sent?.session_id ?? null,
        archetypeHint: sent?.archetype_hint ?? null,
        confidence: sent?.confidence ?? null,
        similarity: sent?.similarity ?? null,
        traitsSent: Array.isArray(sent?.traits),
        status: null,
        receivedMono: null,
        body: null,
        failure: null,
      };
      callOf.set(req, entry);
      calls.push(entry);
    } else if (url.startsWith(`${INGEST_ORIGIN}/v1/events`)) {
      const events = Array.isArray(sent?.events) ? sent.events : [];
      ingest.push({ requestedMono: performance.now(), types: events.map((e) => e.type) });
    } else if (url.startsWith(DECISION_ORIGIN) && url.includes('/api/quiz/run')) {
      pings.push({
        event: sent?.event ?? null,
        quiz_run_id: sent?.quiz_run_id ?? null,
        definition_hash: sent?.definition_hash ?? null,
        resolved_archetype: sent?.resolved_archetype ?? null,
        confirmed_archetype: sent?.confirmed_archetype ?? null,
        offered: sent?.offered ?? null,
      });
    }
  });
  context.on('response', (res) => {
    const net = configOf.get(res.request());
    if (net) net.status = res.status();
    const call = callOf.get(res.request());
    if (!call) return;
    call.status = res.status();
    pending.push(
      res.text().then(
        (t) => {
          try {
            call.body = JSON.parse(t.slice(0, 20000));
          } catch {
            call.failure = `non-JSON body: ${t.slice(0, 200)}`;
          }
          call.receivedMono = performance.now();
        },
        (e) => {
          call.failure = String(e);
          call.receivedMono = performance.now();
        },
      ),
    );
  });
  context.on('requestfinished', (req) => {
    const net = configOf.get(req);
    if (net) net.finishedMono = performance.now();
  });
  context.on('requestfailed', (req) => {
    const net = configOf.get(req);
    if (net) {
      net.finishedMono = performance.now();
      net.failure = req.failure()?.errorText ?? 'request failed';
    }
    const entry = callOf.get(req);
    if (entry) entry.failure = req.failure()?.errorText ?? 'request failed';
  });
  await context.addInitScript(
    ([key]) => {
      try {
        window.localStorage.setItem(key, 'granted');
      } catch {
        /* storage unavailable — the quiz never opens and the sub-session is RED */
      }
    },
    [CONSENT_STORAGE_KEY],
  );
  let page;
  try {
    page = await context.newPage();
    await page.goto(LISTING_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (err) {
    await context.close().catch(() => {});
    throw err;
  }
  await pollUntil(() => calls.some((c) => c.body !== null), CHAT_ARM_PAGE_BUDGET_MS);
  await Promise.all(pending);
  const loadBodies = calls.filter((c) => c.body !== null).map((c) => c.body);
  const obs = {
    sessionId: calls.find((c) => c.sessionId)?.sessionId ?? null,
    drewHoldout: holdoutFromResponses(loadBodies).drewHoldout,
    quizShown: false,
    resultShown: false,
    walk: [],
    leafText: null,
    leaf: null,
    offeredTexts: null,
    offered: null,
    chosenText: null,
    chosen: null,
    resolveAction: null,
    stateAtFold: null,
    followUp: null,
    contrary: null,
    row: null,
    rows: null,
    rowError: null,
    pings,
    configNet,
    calls: [],
  };
  const readState = async () =>
    page
      .evaluate(
        (key) => {
          try {
            return JSON.parse(window.sessionStorage.getItem(key) ?? 'null')?.state ?? null;
          } catch {
            return null;
          }
        },
        `estalara_intent_${String(obs.sessionId)}`,
      )
      .catch(() => null);
  return {
    page,
    calls,
    ingest,
    pending,
    obs,
    readState,
    close: async () => {
      obs.calls = calls.map((c) => ({
        seq: c.seq,
        requestedMono: c.requestedMono,
        receivedMono: c.receivedMono,
        archetypeHint: c.archetypeHint,
        confidenceSent: c.confidence,
        similaritySent: c.similarity,
        traitsSent: c.traitsSent,
        status: c.status,
        failure: c.failure,
        archetype: c.body?.archetype ?? null,
        confidence: c.body?.confidence ?? null,
        source: c.body?.source ?? null,
        holdoutGroup: c.body?.holdout_group ?? null,
      }));
      await context.close().catch(() => {});
    },
  };
}

/**
 * Walk the quiz to its result screen with real clicks (the AC(1) loop's interaction model: a root
 * click commits; a non-root answer selects and `.estalara-quiz-cta` commits; a trait screen ticks
 * its first option), resolve it as `kind` says, and record the fold, the follow-up, the row.
 */
async function resolveAc10Session(s, kind, served) {
  const { page, obs } = s;
  const card = page.locator('.estalara-quiz-card').first();
  const result = page.locator('.estalara-quiz-result').first();
  obs.quizShown = await card
    .waitFor({ state: 'visible', timeout: AC10_QUIZ_MOUNT_MS })
    .then(() => true)
    .catch(() => false);
  if (!obs.quizShown) return;
  for (let step = 0; step < 8; step++) {
    if (await result.isVisible().catch(() => false)) break;
    const answers = page.locator('.estalara-quiz-answer');
    const n = await answers.count().catch(() => 0);
    if (n === 0) break;
    await answers
      .first()
      .click({ timeout: 3000 })
      .catch(() => {});
    await sleep(300);
    const cta = page.locator('.estalara-quiz-cta').first();
    const ctaEnabled =
      (await cta.count().catch(() => 0)) > 0 && (await cta.isEnabled().catch(() => false));
    if (ctaEnabled) {
      await cta.click({ timeout: 3000 }).catch(() => {});
    }
    obs.walk.push({ step, answers: n, ctaEnabled });
    await sleep(600);
  }
  obs.resultShown = await result.isVisible().catch(() => false);
  if (!obs.resultShown) return;
  obs.leafText = await page
    .locator('.estalara-quiz-result strong')
    .first()
    .textContent({ timeout: 3000 })
    .catch(() => null);
  obs.leaf = archetypeFromDisplayName(served.names, obs.leafText);

  let resolveClickMono = null;
  if (kind === 'confirm') {
    resolveClickMono = performance.now();
    await page.locator('.estalara-quiz-confirm').first().click({ timeout: 3000 });
    obs.resolveAction = 'confirm';
  } else if (kind === 'dismiss') {
    resolveClickMono = performance.now();
    await page.locator('.estalara-quiz-close').first().click({ timeout: 3000 });
    obs.resolveAction = 'close_x';
  } else {
    await page.locator('.estalara-quiz-reject').first().click({ timeout: 3000 });
    const options = page.locator('.estalara-quiz-option');
    await options.first().waitFor({ state: 'visible', timeout: 5000 });
    const texts = (await options.allTextContents()).map((t) => t.trim());
    const ids = texts.map((t) => archetypeFromDisplayName(served.names, t));
    // The chrome "None of these — show me everything" is the one option with no archetype name.
    obs.offeredTexts = texts.filter((_, i) => ids[i] !== null);
    obs.offered = ids.filter((id) => id !== null);
    const pick = ids.findIndex((id) => id !== null && id !== obs.leaf);
    if (pick === -1) return;
    obs.chosenText = texts[pick];
    obs.chosen = ids[pick];
    resolveClickMono = performance.now();
    await options.nth(pick).click({ timeout: 3000 });
    obs.resolveAction = 'correct';
  }

  // The fold, as the SDK persisted it: the first snapshot with `quiz_answered`.
  const folded = await pollUntil(
    async () => {
      const st = await s.readState();
      return st?.quiz_answered === true ? st : null;
    },
    AC10_FOLD_WAIT_MS,
    50,
  );
  obs.stateAtFold = folded
    ? {
        archetype: folded.archetype ?? null,
        confidence: folded.confidence ?? null,
        quiz_confirmed: folded.quiz_confirmed ?? null,
        quiz_traits: folded.quiz_traits ?? null,
        signal_count: folded.signal_count ?? null,
      }
    : null;

  // The first request after the fold, and its answer (the LLM branch gets the page budget twice).
  const pickNow = () =>
    pickFirstRequestAfterQuizFold({ calls: s.calls, resolveClickMono, foldSeen: folded !== null });
  const found = await pollUntil(() => pickNow().next, folded ? AC10_FOLD_WAIT_MS : 0);
  if (found) {
    await pollUntil(
      () => found.body !== null || found.failure !== null,
      2 * CHAT_ARM_PAGE_BUDGET_MS,
    );
  }
  await Promise.all(s.pending);
  const picked = pickNow();
  obs.followUp = {
    reason: found ? null : picked.reason,
    notGradedSeqs: picked.notGradedSeqs,
    request: found
      ? {
          seq: found.seq,
          archetypeHint: found.archetypeHint,
          confidence: found.confidence,
          similarity: found.similarity,
          traitsSent: found.traitsSent,
          status: found.status,
          sentAfterClickMs: Math.round(found.requestedMono - resolveClickMono),
        }
      : null,
    body: found?.body ?? null,
  };

  // (a) only: two contrary behaviour signals, the host page's own event, after the follow-up.
  if (kind === 'confirm' && folded) {
    const before = await s.readState();
    const detail = contrarySignalFor(obs.leaf);
    const sentMono = performance.now();
    for (let i = 1; i <= 2; i++) {
      await page.evaluate(
        (d) => window.dispatchEvent(new CustomEvent('estalara:listing:favorited', { detail: d })),
        { listingId: `ac10-contrary-${String(i)}`, ...detail },
      );
      await sleep(300);
    }
    const bookmarks = () =>
      s.ingest
        .filter((p) => p.requestedMono >= sentMono)
        .reduce((n, p) => n + p.types.filter((t) => t === 'listing.bookmarked').length, 0);
    await pollUntil(() => bookmarks() >= 2, AC10_CONTRARY_WAIT_MS);
    const after = await s.readState();
    obs.contrary = {
      detail,
      bookmarkEventsEmitted: bookmarks(),
      signalCountBefore: before?.signal_count ?? null,
      stateAfter: after
        ? {
            archetype: after.archetype ?? null,
            confidence: after.confidence ?? null,
            quiz_confirmed: after.quiz_confirmed ?? null,
            signal_count: after.signal_count ?? null,
          }
        : null,
    };
  }

  // The row, as `POST /api/quiz/run` wrote it; polled until its terminal status lands.
  const want = { confirm: 'confirmed', correct: 'corrected', dismiss: 'unconfirmed' }[kind];
  const runId = obs.pings.find((p) => p.quiz_run_id)?.quiz_run_id ?? null;
  if (!DATABASE_URL_ADMIN || !obs.sessionId) {
    obs.rowError = !DATABASE_URL_ADMIN ? 'DATABASE_URL_ADMIN not set' : 'no session id';
    return;
  }
  const { readQuizRunsForSession } = await import('./bandit-probe.mjs');
  const pick = (rows) => rows.find((r) => r.id === runId) ?? (rows.length === 1 ? rows[0] : null);
  await pollUntil(
    async () => {
      try {
        obs.rows = await readQuizRunsForSession(DATABASE_URL_ADMIN, obs.sessionId);
        obs.rowError = null;
      } catch (err) {
        obs.rowError = String(err);
        return false;
      }
      const r = pick(obs.rows);
      return r !== null && r.status === want;
    },
    AC10_ROW_WAIT_MS,
    500,
  );
  obs.row = obs.rows ? pick(obs.rows) : null;
}

/**
 * Drive AC(10): the served definition first (the names the DOM is read against, and the hash the
 * rows must carry), then (a), (b), (c), each in its own fresh context.
 *
 * @param {import('playwright').Browser} browser
 * @returns {Promise<object>}
 */
async function driveAc10(browser) {
  const fold = await readQuizFoldConstantsFromSdk();
  const servedConfig = await fetchServedQuizConfig();
  const served = evaluateServedQuizConfig(servedConfig);
  const sessions = {};
  for (const kind of ['confirm', 'correct', 'dismiss']) {
    sessions[kind] = await driveAc10Session(browser, kind, served).catch((err) => ({
      error: String(err && err.stack ? err.stack : err),
    }));
  }
  return {
    fold,
    // The body is large; the artefact keeps what the grade reads.
    servedConfig: {
      status: servedConfig.status,
      error: servedConfig.error,
      ms: servedConfig.ms,
      body: servedConfig.body
        ? {
            data_source: servedConfig.body.data_source ?? null,
            definition_hash: servedConfig.body.definition_hash ?? null,
            definition_version: servedConfig.body.definition_version ?? null,
            quiz_definition: servedConfig.body.quiz_definition
              ? { confirm: servedConfig.body.quiz_definition.confirm ?? null }
              : null,
          }
        : null,
    },
    sessions,
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
export async function readServerConfidenceGate() {
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
 * The `/api/adapt` preflight probe's REQUEST, as a pure function (FOLLOW-1205), so a test can hand
 * the real `POST` handler and the real `middleware()` byte-for-byte the request
 * `assertRealControlPlane()` puts on the wire (Rule AI amendment 4 item 3, Rule AV).
 *
 * WHY IT CARRIES THE FIXTURE KEY. The pre-FOLLOW-1205 probe sent `content-type` and `{}` and
 * nothing else. `route.ts` `POST` returns `401 invalid_demo_token` on a missing bearer
 * (`if (!token)`) BEFORE `verifyDemoJwt()` reads `DEMO_MODE_JWT_SECRET`, so a control plane whose
 * secret Turbo stripped (README §6.5, L-1) and a healthy one answered it identically. The probe
 * could not see L-1, and it never received L-1's 500 either (RETRO-326 §4b BUG-1, executed).
 * `readFixtureApiKey()` is the credential the SDK in the browser session authenticates with, so the
 * probe now walks the SDK's own auth path: `verifyDemoJwt()` reads the secret first (a missing one
 * is `500 demo_auth_misconfigured`), finds the key is not a JWT, and falls back to `resolveApiKey()`.
 *
 * WHY IT CARRIES `Origin`. It is the one header every browser request from `LISTING_URL` carries.
 * Middleware echoes it in `access-control-allow-origin`, and `resolveApiKey()` admits it, only when
 * it is on the constant browser-origin list for the running process (FOLLOW-1333,
 * `packages/shared/src/browser-origins.ts`: `https://app.estalara.com` and
 * `https://admin.estalara.com` alone under `NODE_ENV=production`; plus `http://localhost:5173` and
 * `http://localhost:3000` otherwise). An unlisted origin is refused with 403. FOLLOW-1206 replaced a
 * regex over `origin-policy.ts`, which could not see `NODE_ENV`, with this probe of the real code.
 *
 * The body is `{}`, so a healthy handler stops at `AdaptPostBodySchema` with
 * `400 Validation failed`: auth passed, nothing was assigned and no decision row was written.
 *
 * @param {{decisionOrigin: string, listingUrl: string, apiKey: string}} input
 * @returns {{url: string, listingOrigin: string, credentialClass: string,
 *   init: {method: string, headers: Record<string, string>, body: string}}}
 * @throws if `listingUrl` is not a parseable URL — the probe has no origin to send.
 */
export function buildControlPlaneProbeRequest({ decisionOrigin, listingUrl, apiKey }) {
  let listingOrigin;
  try {
    listingOrigin = new URL(listingUrl).origin;
  } catch {
    throw new Error(`LISTING_URL is not a parseable URL: ${listingUrl}`);
  }
  return {
    url: `${decisionOrigin}/api/adapt`,
    listingOrigin,
    credentialClass: 'fixture data-api-key (the SDK credential)',
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        Origin: listingOrigin,
      },
      body: JSON.stringify({}),
    },
  };
}

/**
 * Evaluate the `/api/adapt` preflight probe's RESPONSE, as a pure function (FOLLOW-1200, rewritten by
 * FOLLOW-1205/1206). It accepts exactly one answer: the healthy answer to the probe
 * `buildControlPlaneProbeRequest()` builds.
 *
 * Every status below was read off the real handler for that request, not taken from a ticket
 * (`control-plane-probe.test.ts` imports `route.ts` `POST` and `middleware.ts`):
 *
 * | answer                                   | what it means                                          |
 * | ---------------------------------------- | ------------------------------------------------------ |
 * | `400 Validation failed` + ACAO = origin  | HEALTHY: secret present, key authenticated, origin allowed |
 * | `400 Validation failed`, ACAO absent     | CORS: the browser will not read the body (`NODE_ENV=production`, or origin not listed) |
 * | `500 demo_auth_misconfigured`            | L-1: `DEMO_MODE_JWT_SECRET` absent (README §6.5)      |
 * | `401 invalid_demo_token`                 | the key did not authenticate — see below              |
 * | `403 <reason>`                           | the origin is not on the constant list for this build |
 * | `404`                                    | not the real decision route                            |
 * | anything else, or no answer              | not a healthy real control plane                       |
 *
 * WHAT THIS PROBE CANNOT SEPARATE. `401` is one answer for four states: the fixture key is not
 * registered in `api_keys` (README §6.3), `DATABASE_URL_ADMIN` is unset or points at another database
 * (§6.1), Postgres is unreachable, or its pool is exhausted (§6.7). `route.ts` collapses the
 * `resolveApiKey()` "not found", "no DB configured" and "DB threw" results into the same body. It
 * also cannot see anything the handler reads AFTER body validation: `HOLDOUT_ASSIGNMENT_SECRET`
 * (FOLLOW-1201), ClickHouse, the LLM gateway, `SCORING_PATH_COLUMN_ENABLED`, or whether AL is
 * enabled for the tenant. Those surface as ACs going red, not as a preflight failure.
 *
 * @param {{status: number|null, bodyText: string|null, allowOrigin: string|null,
 *   networkError: string|null}} probe
 * @param {string} listingOrigin - The `Origin` the probe sent.
 * @returns {{ok: boolean, failureClass: string|null, bodyCode: string|null, reason: string}}
 */
export function evaluateControlPlaneProbe(probe, listingOrigin) {
  let bodyCode = null;
  try {
    const parsed = JSON.parse(probe.bodyText ?? '');
    if (parsed && typeof parsed.error === 'string') bodyCode = parsed.error;
  } catch {
    /* a non-JSON body keeps bodyCode null; the status still decides */
  }
  const observed =
    `status ${String(probe.status)}, body code ${String(bodyCode)}, ` +
    `access-control-allow-origin ${String(probe.allowOrigin)} (Origin sent: ${listingOrigin})`;
  const fail = (failureClass, why) => ({
    ok: false,
    failureClass,
    bodyCode,
    reason: `${why} — observed ${observed}`,
  });

  if (probe.networkError) {
    return fail('unreachable', `probe network error / timeout: ${probe.networkError}`);
  }
  if (probe.status === 404) {
    return fail('not_the_decision_route', '404 for POST /api/adapt — not the real decision route');
  }
  if (probe.status === 500 && bodyCode === 'demo_auth_misconfigured') {
    return fail(
      'demo_secret_missing',
      'L-1: DEMO_MODE_JWT_SECRET is absent from the control-plane process (README §6.5 — Turbo ' +
        'strips it under `pnpm dev`; start it with `pnpm --filter @estalara/control-plane dev`)',
    );
  }
  if (typeof probe.status === 'number' && probe.status >= 500) {
    return fail('server_error', 'a server error is not a healthy real control plane');
  }
  if (probe.status === 401) {
    return fail(
      'fixture_key_not_authenticated',
      "the fixture's data-api-key did not authenticate: it is not registered in api_keys " +
        '(README §6.3), DATABASE_URL_ADMIN is unset or points at another database (§6.1), or ' +
        'Postgres is unreachable or out of connections (§6.7). The handler answers all four with ' +
        'the same 401, so this probe cannot say which',
    );
  }
  if (probe.status === 403) {
    return fail(
      'origin_not_listed',
      `${listingOrigin} is not on the constant browser-origin list for this control plane ` +
        '(packages/shared/src/browser-origins.ts, FOLLOW-1333); the SDK request from that origin ' +
        'will be refused the same way — serve the fixture from :5173',
    );
  }
  if (probe.status !== 400 || bodyCode !== 'Validation failed') {
    return fail(
      'unexpected_answer',
      'the real handler answers this probe with 400 Validation failed once auth passes; any other ' +
        'answer is not the real control plane in a healthy state',
    );
  }
  if (probe.allowOrigin !== listingOrigin) {
    return fail(
      'cors_origin_not_echoed',
      `auth passed, but the control plane did not echo ${listingOrigin} in ` +
        'access-control-allow-origin, so the browser will be refused every response body while ' +
        'the server still logs decisions (README §6.2). Under `next start` (NODE_ENV=production) ' +
        'only the two production origins are echoed; under `next dev` serve the fixture from :5173',
    );
  }
  return {
    ok: true,
    failureClass: null,
    bodyCode,
    reason: `auth passed and the origin is echoed — observed ${observed}`,
  };
}

/**
 * Refuse to run against the `:9100` mock decision harness, and refuse a real control plane that is
 * up but cannot serve this run (see `evaluateControlPlaneProbe()` for what it can and cannot tell).
 *
 * Two independent discriminators against the mock, because either alone could be spoofed by a
 * future mock:
 *   1. the mock serves `GET /mock/status`; the control plane does not;
 *   2. the control plane serves `/api/adapt` and answers the probe as the real handler does.
 *
 * @returns {Promise<{credentialClass: string, listingOrigin: string, status: number|null,
 *   bodyCode: string|null, allowOrigin: string|null, reason: string}>}
 * @throws if the decision origin is the mock, is not answering at all, or fails
 *   `evaluateControlPlaneProbe()`.
 */
export async function assertRealControlPlane() {
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

  const request = buildControlPlaneProbeRequest({
    decisionOrigin: DECISION_ORIGIN,
    listingUrl: LISTING_URL,
    apiKey: await readFixtureApiKey(),
  });
  // Bounded, so a slow or dead origin fails loud rather than hanging (README §6.6: warm the route
  // first after a cold `next dev` start).
  const probe = await fetch(request.url, { ...request.init, signal: AbortSignal.timeout(8000) })
    .then(async (res) => ({
      status: res.status,
      bodyText: await res.text().catch(() => null),
      allowOrigin: res.headers.get('access-control-allow-origin'),
      networkError: null,
    }))
    .catch((err) => ({
      status: null,
      bodyText: null,
      allowOrigin: null,
      networkError: String(err),
    }));

  const verdict = evaluateControlPlaneProbe(probe, request.listingOrigin);
  if (!verdict.ok) {
    throw new Error(
      `DECISION_ORIGIN=${DECISION_ORIGIN} failed the real-control-plane probe ` +
        `[${String(verdict.failureClass)}]: ${verdict.reason}. An unhealthy decision endpoint is a ` +
        'RED substrate, never a skip.',
    );
  }
  return {
    credentialClass: request.credentialClass,
    listingOrigin: request.listingOrigin,
    status: probe.status,
    bodyCode: verdict.bodyCode,
    allowOrigin: probe.allowOrigin,
    reason: verdict.reason,
  };
}

// ─── FOLLOW-1288: the control arm's ops caller needs DEMO_MODE=1 on the control plane ──────────
//
// Since FOLLOW-1288 (WP-2.3) the `ADAPT_API_KEY` ops caller of `POST /api/adapt` — the ONLY caller
// whose body `holdout_pct` is honoured, i.e. this harness's control arm — exists only when the
// control plane runs with `DEMO_MODE=1` (`apps/control-plane/src/lib/demo/demo-mode.ts`). Without
// it the ops bearer is an ordinary unknown key: every control-arm call 401s, AC(4)/(7) go red and
// the run looks like a broken differentiator. This probe names that state before the browser
// launches (the README §6.5 shape: a misconfigured flag must not look like a product failure).

/**
 * The ops-caller probe's REQUEST, as a pure function: `POST /api/adapt` with the ops bearer and an
 * empty body. With DEMO_MODE=1 the ops variant authenticates and the handler stops at
 * `AdaptPostBodySchema` with `400 Validation failed` — nothing is assigned, no row is written.
 *
 * @param {{decisionOrigin: string, opsKey: string}} input
 * @returns {{url: string, init: {method: string, headers: Record<string, string>, body: string}}}
 */
export function buildOpsCallerProbeRequest({ decisionOrigin, opsKey }) {
  return {
    url: `${decisionOrigin}/api/adapt`,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${opsKey}` },
      body: JSON.stringify({}),
    },
  };
}

/**
 * Evaluate the ops-caller probe's RESPONSE (`control-plane-probe.test.ts` reads the rows off the
 * real handler):
 *
 * | answer                       | meaning                                                         |
 * | ---------------------------- | --------------------------------------------------------------- |
 * | `400 Validation failed`      | HEALTHY: DEMO_MODE=1, the ops caller authenticated              |
 * | `401 invalid_demo_token`     | DEMO_MODE is not `1` on the control plane (or ADAPT_API_KEY differs between this shell and it) |
 * | `500 ops_auth_misconfigured` | ADAPT_API_KEY matched but OPS_TENANT_ID is unset on the control plane |
 * | anything else, or no answer  | not a healthy real control plane                                |
 *
 * @param {{status: number|null, bodyText: string|null, networkError: string|null}} probe
 * @returns {{ok: boolean, failureClass: string|null, bodyCode: string|null, reason: string}}
 */
export function evaluateOpsCallerProbe(probe) {
  let bodyCode = null;
  try {
    const parsed = JSON.parse(probe.bodyText ?? '');
    if (parsed && typeof parsed.error === 'string') bodyCode = parsed.error;
  } catch {
    /* a non-JSON body keeps bodyCode null; the status still decides */
  }
  const observed = `status ${String(probe.status)}, body code ${String(bodyCode)}`;
  const fail = (failureClass, why) => ({
    ok: false,
    failureClass,
    bodyCode,
    reason: `${why} — observed ${observed}`,
  });
  if (probe.networkError) {
    return fail('unreachable', `probe network error / timeout: ${probe.networkError}`);
  }
  if (probe.status === 401) {
    return fail(
      'demo_mode_off',
      'the ADAPT_API_KEY ops bearer did not authenticate on POST /api/adapt. Since FOLLOW-1288 the ' +
        'ops caller exists only when the control plane runs with DEMO_MODE=1 (README §3; ' +
        'scripts/dev/localhost-up.sh sets it). Restart the control plane with DEMO_MODE=1 — or, ' +
        'if it is set, ADAPT_API_KEY differs between this shell and the control plane',
    );
  }
  if (probe.status === 500 && bodyCode === 'ops_auth_misconfigured') {
    return fail('ops_tenant_missing', 'OPS_TENANT_ID is unset on the control plane');
  }
  if (probe.status !== 400 || bodyCode !== 'Validation failed') {
    return fail(
      'unexpected_answer',
      'with DEMO_MODE=1 the ops caller authenticates and the handler answers 400 Validation failed',
    );
  }
  return {
    ok: true,
    failureClass: null,
    bodyCode,
    reason: `ops caller authenticated — ${observed}`,
  };
}

/**
 * Refuse a control plane that does not recognise the control arm's ops caller (DEMO_MODE off).
 *
 * @returns {Promise<{status: number|null, bodyCode: string|null, reason: string}>}
 * @throws when `evaluateOpsCallerProbe()` rejects the answer.
 */
export async function assertDemoModeOn() {
  const request = buildOpsCallerProbeRequest({
    decisionOrigin: DECISION_ORIGIN,
    opsKey: ADAPT_API_KEY,
  });
  const probe = await fetch(request.url, { ...request.init, signal: AbortSignal.timeout(8000) })
    .then(async (res) => ({
      status: res.status,
      bodyText: await res.text().catch(() => null),
      networkError: null,
    }))
    .catch((err) => ({ status: null, bodyText: null, networkError: String(err) }));
  const verdict = evaluateOpsCallerProbe(probe);
  if (!verdict.ok) {
    throw new Error(
      `DECISION_ORIGIN=${DECISION_ORIGIN} failed the ops-caller probe ` +
        `[${String(verdict.failureClass)}]: ${verdict.reason}. A control plane without ` +
        'DEMO_MODE=1 is a RED substrate, never a broken differentiator.',
    );
  }
  return { status: probe.status, bodyCode: verdict.bodyCode, reason: verdict.reason };
}

// ─── FOLLOW-1225: the grounding source ──────────────────────────────────────────────────
//
// `assertRealControlPlane()` names the `:9100` mock when the decision endpoint is the wrong thing.
// Nothing named the GROUNDING input, and on 2026-09-20 (§5.10) that cost a full session: the run
// was 4/6 with `fallback_reason: listing_context_unavailable`, and the cause — no process on
// `:8081` — was three layers away from any assertion the harness made. These two functions are the
// probe that names it up front.

/**
 * Where the control plane reads listing facts from, mirrored from
 * `apps/control-plane/src/lib/listing-details.ts` (`ESTALARA_BACKEND_URL ?? DEFAULT_BACKEND_URL`,
 * `http://localhost:8081`). A mirror, like `SCORING_PATHS` above, and for the same reason: this
 * script cannot import Next.js route internals. `grounding-source.test.ts` drives the REAL reader
 * and the probe at one server and asserts they request the same URL, so the mirror cannot drift
 * silently.
 */
const GROUNDING_ORIGIN = (process.env.ESTALARA_BACKEND_URL ?? 'http://localhost:8081').replace(
  /\/$/,
  '',
);

/**
 * The grounding probe's REQUEST — the listing-details URL `fetchListingJson()` builds for the
 * fixture's own listing id.
 *
 * @param {{groundingOrigin: string, listingId: string, locale?: string}} input
 * @returns {{url: string, listingId: string, groundingOrigin: string}}
 */
export function buildGroundingProbeRequest({ groundingOrigin, listingId, locale = 'en' }) {
  const base = groundingOrigin.replace(/\/$/, '');
  const id = encodeURIComponent(listingId);
  const loc = encodeURIComponent(locale.toUpperCase());
  return {
    url: `${base}/api/v1/listing/details?listing-uuid=${id}&locale=${loc}`,
    listingId,
    groundingOrigin: base,
  };
}

/**
 * Evaluate the grounding probe's RESPONSE.
 *
 * `factsKeys` is the set of `listingContext` keys `withListingFacts()`
 * (`apps/control-plane/src/lib/listing-facts-context.ts`) would attach from this body, and
 * `hasListingFacts()` — the predicate `route.ts:2008` turns into `groundingMissing` — is true iff
 * that set is non-empty. So a `ok: true` here is a statement about the flag the run's
 * `fallback_reason` comes from, not about HTTP.
 *
 * WHAT THIS PROBE CANNOT SEE. It reads the grounding origin THIS PROCESS was given
 * (`ESTALARA_BACKEND_URL`, else `:8081`). The control plane is a separate process with its own
 * environment: if the two were started with different values, this probe can be green while the
 * control plane still fetches nothing, and the only surviving signal is the adapted response's
 * `fallback_reason: listing_context_unavailable`. Pass the same `ESTALARA_BACKEND_URL` to both
 * (README §3.3b / §3.4). It also says nothing about whether the facts are RICH enough for a given
 * directive: a page that publishes no price grounds the prompt and still discards a directive that
 * needs one (FOLLOW-1018 / ESC-074), which surfaces as a red AC, not as a preflight failure.
 *
 * @param {{status: number|null, bodyText: string|null, factsSource: string|null,
 *   networkError: string|null}} probe
 * @param {string} listingId - The listing the probe asked about.
 * @returns {{ok: boolean, failureClass: string|null, factsKeys: string[], factsSource: string|null,
 *   reason: string}}
 */
export function evaluateGroundingProbe(probe, listingId) {
  const observed = `status ${String(probe.status)} for listing ${listingId}`;
  const fail = (failureClass, why) => ({
    ok: false,
    failureClass,
    factsKeys: [],
    factsSource: probe.factsSource,
    reason: `${why} — observed ${observed}`,
  });

  if (probe.networkError) {
    return fail(
      'unreachable',
      `nothing answered the listing-details URL (${probe.networkError}). This is the §5.10 state: ` +
        'the control plane logs `[listing-details] fetch failed`, every LLM call goes out ungrounded ' +
        'and the adapted arm comes back `listing_context_unavailable`',
    );
  }
  if (probe.status === 404) {
    return fail(
      'listing_not_served',
      'the grounding source does not know this listing, so the prompt would carry no facts about ' +
        'the page under test',
    );
  }
  if (probe.status !== 200) {
    return fail(
      'upstream_non_ok',
      'a non-200 leaves `fetchListingJson()` with null and the prompt ungrounded',
    );
  }

  let listing = null;
  try {
    const parsed = JSON.parse(probe.bodyText ?? '');
    if (parsed && typeof parsed === 'object') listing = parsed;
  } catch {
    /* handled below */
  }
  if (!listing) {
    return fail(
      'not_json',
      'the body is not a JSON object; `fetchListingJson()` returns null for it',
    );
  }

  // Mirrors `fetchListingTextFields()` → `withListingFacts()`, key for key.
  const str = (v) => (typeof v === 'string' && v.trim().length > 0 ? v : undefined);
  const factsKeys = [];
  if (str(listing.headline)) factsKeys.push('listing_title');
  if (str(listing.description)) factsKeys.push('listing_description');
  if (typeof listing.price === 'number' && Number.isFinite(listing.price)) {
    factsKeys.push('listing_price');
  }
  if (str(listing.streetAddress) || str(listing.city) || str(listing.region)) {
    factsKeys.push('listing_location');
  }
  if (factsKeys.length === 0) {
    return fail(
      'no_usable_fields',
      'the listing answered 200 but carries none of headline / description / price / location, so ' +
        '`hasListingFacts()` is false and `groundingMissing` is true exactly as if nothing answered',
    );
  }

  return {
    ok: true,
    failureClass: null,
    factsKeys,
    factsSource: probe.factsSource,
    reason: `${observed}: grounds ${factsKeys.join(', ')}`,
  };
}

/**
 * Refuse to run a session whose LLM branch would be ungrounded.
 *
 * A red substrate, never a skip: with no facts the adapted arm can only answer
 * `playbook_fallback_llm_unavailable` / `listing_context_unavailable`, AC(1) is unreachable by
 * construction and AC(7) clause 2 with it (§5.10). Ten minutes of browser session cannot discover
 * anything this one request cannot.
 *
 * @returns {Promise<{groundingOrigin: string, listingId: string, factsKeys: string[],
 *   factsSource: string|null, reason: string}>}
 * @throws if the grounding source is absent, does not know the fixture listing, or carries no facts.
 */
export async function assertGroundingSource() {
  const request = buildGroundingProbeRequest({
    groundingOrigin: GROUNDING_ORIGIN,
    listingId: await readFixtureListingId(),
  });
  const probe = await fetch(request.url, { signal: AbortSignal.timeout(5000) })
    .then(async (res) => ({
      status: res.status,
      bodyText: await res.text().catch(() => null),
      factsSource: res.headers.get('x-estalara-facts-source'),
      networkError: null,
    }))
    .catch((err) => ({
      status: null,
      bodyText: null,
      factsSource: null,
      networkError: String(err),
    }));

  const verdict = evaluateGroundingProbe(probe, request.listingId);
  if (!verdict.ok) {
    throw new Error(
      `The grounding source at ${GROUNDING_ORIGIN} failed the probe ` +
        `[${String(verdict.failureClass)}]: ${verdict.reason}. Start one and point BOTH this ` +
        'harness and the control plane at it with ESTALARA_BACKEND_URL — ' +
        "`node scripts/dev/fixture-listing-details-server.mjs` serves the fixture page's own facts " +
        '(README §3.3b). An ungrounded LLM branch is a RED substrate, never a skip: AC(1) cannot ' +
        'pass without facts (FOLLOW-1225).',
    );
  }
  return {
    groundingOrigin: request.groundingOrigin,
    listingId: request.listingId,
    factsKeys: verdict.factsKeys,
    factsSource: verdict.factsSource,
    reason: verdict.reason,
  };
}

/**
 * The control arm's credential, checked before anything runs (FOLLOW-1201 handoff). Since #902 the
 * control arm's `holdout_pct` is honoured only for the `ADAPT_API_KEY` ops bearer, so a run without
 * it cannot force a control session and AC(7) would grade a randomly assigned one. Refusing here
 * names the cause; letting the run proceed would surface it as an AC(7) red many minutes later.
 *
 * @param {string} adaptApiKey - `ADAPT_API_KEY` as the harness read it.
 * @returns {{ok: boolean, reason: string}}
 */
/**
 * Classify what `GET ${INGEST_ORIGIN}/health` answered. Pure, so the classes are testable without
 * a Worker (FOLLOW-1238's preflight half; the per-hop `driveHoldoutArm()` split stays in that
 * ticket).
 *
 * THE FAILURE MODE THIS EXISTS FOR, measured 2026-09-20 (README §3.5 / §5.11): a `wrangler dev`
 * whose esbuild bundle FAILED still binds `:8787` and accepts TCP connections while answering
 * nothing at all. Every request hangs to the caller's own timeout, ClickHouse gets zero `events`
 * rows, and the run reds AC(5) and AC(7) ten minutes later with no mention of ingest — AC(7)'s
 * single `controlArmError` read "the arms did not separate". One request up front says it in 2 s.
 *
 * @param {{status: number|null, bodyText: string|null, networkError: string|null}} probe
 * @returns {{ok: boolean, failureClass: string|null, reason: string}}
 */
export function evaluateIngestProbe(probe) {
  if (probe.networkError) {
    const timedOut = /timeout|abort/i.test(probe.networkError);
    return {
      ok: false,
      failureClass: timedOut ? 'bound_but_silent' : 'unreachable',
      reason: timedOut
        ? `the ingest origin accepted the connection and never answered (${probe.networkError}) — ` +
          'this is the failed-build-still-holding-the-port state (README §3.5); check the wrangler ' +
          'log for `Could not resolve`, and that `apps/ingest/node_modules` exists'
        : `nothing answered the ingest health URL (${probe.networkError})`,
    };
  }
  if (probe.status !== 200) {
    return {
      ok: false,
      failureClass: 'health_non_ok',
      reason: `the ingest origin answered ${String(probe.status)}, not 200`,
    };
  }
  return {
    ok: true,
    failureClass: null,
    reason: `200 ${String(probe.bodyText ?? '').slice(0, 160)}`,
  };
}

/**
 * Refuse to run a session whose ingest wire is dead. AC(5) counts a `cta.clicked` row and AC(7)
 * mirrors one; both are unmeasurable without it, and both currently report the outage as a product
 * result. A red substrate, never a skip.
 *
 * @returns {Promise<{ingestOrigin: string, reason: string}>}
 * @throws if the ingest origin is unreachable, silent, or not 200.
 */
export async function assertIngestReachable() {
  const url = `${INGEST_ORIGIN}/health`;
  const probe = await fetch(url, { signal: AbortSignal.timeout(5000) })
    .then(async (res) => ({
      status: res.status,
      bodyText: await res.text().catch(() => null),
      networkError: null,
    }))
    .catch((err) => ({ status: null, bodyText: null, networkError: String(err) }));

  const verdict = evaluateIngestProbe(probe);
  if (!verdict.ok) {
    throw new Error(
      `The ingest Worker at ${INGEST_ORIGIN} failed the health probe ` +
        `[${String(verdict.failureClass)}]: ${verdict.reason}. Bring it up per README §3.5 and ` +
        'verify it ANSWERS before re-running — a bound port is not a running Worker (FOLLOW-1238).',
    );
  }
  return { ingestOrigin: INGEST_ORIGIN, reason: verdict.reason };
}

/**
 * Where the localhost host-backend stand-in lives: the same process that serves listing facts
 * (`scripts/dev/fixture-listing-details-server.mjs`, `:8081`). CEO ruling of 2026-10-13 (ESC-084,
 * ruling 3): on localhost it emits the signed conversion and this harness triggers it.
 */
const CONVERSION_EMITTER_URL = `${GROUNDING_ORIGIN}/fixture/confirmed-conversion`;

/**
 * Classify what `GET /fixture/confirmed-conversion` answered (FOLLOW-1203). Pure. The state this
 * exists for: a fixture server started without its signing env (an older bring-up left running, or
 * a hand-started one) answers every conversion request 503, and AC(5) would red many minutes later.
 *
 * @param {{status: number|null, body: any, networkError: string|null}} probe
 * @returns {{ok: boolean, reason: string}}
 */
export function evaluateConversionEmitterProbe(probe) {
  if (probe.networkError) {
    return { ok: false, reason: `nothing answered the conversion emitter (${probe.networkError})` };
  }
  if (probe.status !== 200 || probe.body?.configured !== true || probe.body?.signed !== true) {
    return {
      ok: false,
      reason:
        `the conversion emitter answered ${String(probe.status)} ` +
        `${JSON.stringify(probe.body ?? null).slice(0, 200)} — it has no signing key ` +
        '(FIXTURE_SERVER_API_KEY / FIXTURE_SERVER_HMAC_SECRET), or the process on that port is ' +
        'not the fixture server',
    };
  }
  return { ok: true, reason: `configured; signed events go to ${String(probe.body.ingestUrl)}` };
}

/**
 * Refuse to run when no server-confirmed conversion can be emitted: AC(5) grades one.
 *
 * @returns {Promise<{emitterUrl: string, reason: string}>}
 * @throws if the emitter is unreachable or not configured to sign.
 */
export async function assertConversionEmitter() {
  const probe = await fetch(CONVERSION_EMITTER_URL, { signal: AbortSignal.timeout(5000) })
    .then(async (res) => ({
      status: res.status,
      body: await res.json().catch(() => null),
      networkError: null,
    }))
    .catch((err) => ({ status: null, body: null, networkError: String(err) }));
  const verdict = evaluateConversionEmitterProbe(probe);
  if (!verdict.ok) {
    throw new Error(
      `The conversion emitter at ${CONVERSION_EMITTER_URL} failed its probe: ${verdict.reason}. ` +
        'Bring the fixture server up with scripts/dev/localhost-up.sh (README §3.3c) — it ' +
        'generates the LOCAL signing secret, seeds the Worker KV and passes both by env.',
    );
  }
  return { emitterUrl: CONVERSION_EMITTER_URL, reason: verdict.reason };
}

export function evaluateControlArmCredential(adaptApiKey) {
  if (typeof adaptApiKey === 'string' && adaptApiKey.trim().length > 0) {
    return { ok: true, reason: 'ADAPT_API_KEY is set; the control arm sends it as the ops bearer' };
  }
  return {
    ok: false,
    reason:
      'ADAPT_API_KEY is unset. Since FOLLOW-1201 (#902) POST /api/adapt honours a body holdout_pct ' +
      'only for the ADAPT_API_KEY ops bearer, so without it the control arm cannot be forced into ' +
      'holdout and AC(7) is not measurable. Set it to the value the control plane was started with ' +
      '(README §3.4 / §3.6).',
  };
}

// ─── FOLLOW-1200: artefact staleness ─────────────────────────────────────────────────────
//
// `last-run.json` used to carry no notion of WHEN or AT WHAT COMMIT it was produced, so a stale
// artefact from a checkout 27 commits behind could not be told apart from a fresh one (audit
// 2026-09-13 §2 remark 1, A1-9). `startedAt`/`harnessSha`/`harnessTree` (written into `summary` in
// `main()`, and into the abort handler's partial artefact) are the fix for RECORDING it; the
// functions below are the fix for CHECKING it.

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
 * THE MEASURED PATH SET (FOLLOW-1208), named here once and read by both git questions freshness
 * asks: `git status --porcelain` at run start (`readHarnessTreeState()`) and
 * `git diff --quiet <harnessSha> HEAD` at grading time (`readMeasuredPathDiff()`). It is every
 * tracked path whose bytes a run executes, or that decides which bytes run:
 *   - `apps`, `packages`: the control plane (tenant seeder included), the ingest Worker, the SDK
 *     bundle, the `@estalara/db` migrations, shared code;
 *   - `infra/clickhouse`: the ClickHouse migrations README §3.1 applies;
 *   - `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`: which dependency
 *     versions run, and which env `pnpm dev` passes through (README §6.5);
 *   - the harness, the one local module it imports (`bandit-probe.mjs`), and the fixture page;
 *   - `scripts/dev/fixture-listing-details-server.mjs`: README §3.3b starts it manually (a separate
 *     `node` process, never `import()`ed), and its `extractFixtureFacts()` decides which facts
 *     ground every prompt — editing it graded `[FRESH] … clean tree` before FOLLOW-1244 (RETRO-339);
 *   - `scripts/dev/mock-decision-server.mjs`: README §3.3 starts it as the `:9100` static host for
 *     the SDK bundle and sets its response headers, also never `import()`ed (FOLLOW-1216);
 *   - `scripts/dev/localhost-up.sh` / `localhost-down.sh`: the one-command bring-up (FOLLOW-1261)
 *     that decides which processes, env and build outputs the run executes against.
 * NOT in it: the rest of `tests/e2e/follow-819` (the README, the vitest files), `docs/`, `backlog/`,
 * and every other file no run executes. A commit touching only those cannot change a result; before
 * FOLLOW-1208 it staled every artefact graded after it (RETRO-327 §4a LG-3). `node_modules` is
 * excluded because a symlinked install shows as untracked without changing any tracked byte.
 * Editing this list edits the harness, which is itself in the list, so an artefact produced under
 * an older list reads STALE on the diff axis with no extra bookkeeping.
 */
export const HARNESS_TREE_PATHSPEC = [
  'apps',
  'packages',
  'infra/clickhouse',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'turbo.json',
  'tests/e2e/follow-819/differentiator-e2e.mjs',
  'tests/e2e/follow-819/bandit-probe.mjs',
  'tests/e2e/follow-819/fixture-listing.html',
  'scripts/dev/fixture-listing-details-server.mjs',
  'scripts/dev/mock-decision-server.mjs',
  'scripts/dev/upstash-rest-path-adapter.mjs',
  'scripts/dev/localhost-up.sh',
  'scripts/dev/localhost-down.sh',
  ':(exclude,glob)**/node_modules',
];

/**
 * Whether the working tree differed from `harnessSha` when the run started (FOLLOW-1205, from the
 * RETRO-326 amendment to FOLLOW-1196). `git status --porcelain` over `HARNESS_TREE_PATHSPEC`, untracked
 * files included, ignored files (`last-run.json`, `.next/`, `.wrangler/`, `dist/`) excluded by
 * `.gitignore`. A run with uncommitted edits stamps a SHA whose bytes it did not execute.
 * `{dirty: null, dirtyPaths: null}` when git is unavailable — unknown, never a silent "clean".
 *
 * @param {{cwd?: string}} [options] - `cwd` exists for the temp-repository test; `main()` passes
 *   nothing and reads `REPO_ROOT`.
 * @returns {Promise<{dirty: boolean|null, dirtyPaths: string[]|null}>}
 */
export async function readHarnessTreeState({ cwd = REPO_ROOT } = {}) {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['status', '--porcelain', '--', ...HARNESS_TREE_PATHSPEC],
      { cwd },
    );
    const dirtyPaths = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3));
    return { dirty: dirtyPaths.length > 0, dirtyPaths };
  } catch {
    return { dirty: null, dirtyPaths: null };
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
 * How many commits HEAD is ahead of `sha` — `git rev-list --count <sha>..HEAD`. `null` when the
 * count cannot be taken (unknown SHA, shallow clone, git unavailable), never a guessed 0.
 *
 * It is a DISTANCE only when `sha` is an ancestor of HEAD. For a non-ancestor (a squash-merged
 * branch commit) it counts HEAD's commits back to the merge base, which says nothing about how far
 * `sha` is from HEAD, so `evaluateArtefactStaleness()` never reports it for one (FOLLOW-1208).
 *
 * @param {string|null} sha
 * @returns {Promise<number|null>}
 */
async function readCommitsBehind(sha) {
  if (typeof sha !== 'string' || sha.length === 0) return null;
  try {
    const { stdout } = await execFileAsync('git', ['rev-list', '--count', `${sha}..HEAD`], {
      cwd: REPO_ROOT,
    });
    const n = Number(stdout.trim());
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Whether any `HARNESS_TREE_PATHSPEC` path differs between `sha` and HEAD (FOLLOW-1208). The verdict is
 * `git diff --quiet <sha> HEAD -- <HARNESS_TREE_PATHSPEC>`: exit 0 → unchanged, exit 1 → changed, and
 * only then a `--name-only` call lists which, for the reason line. Any other outcome (a SHA this
 * clone does not have, git unavailable) is `{changed: null}`, never a silent "unchanged". It
 * compares COMMITS, never the grader's working tree: the artefact's own `harnessTree` already says
 * whether the run executed its commit's bytes.
 *
 * @param {string|null} sha
 * @returns {Promise<{changed: boolean|null, changedPaths: string[]|null}>}
 */
async function readMeasuredPathDiff(sha) {
  const unknown = { changed: null, changedPaths: null };
  if (typeof sha !== 'string' || sha.length === 0) return unknown;
  const range = [sha, 'HEAD', '--', ...HARNESS_TREE_PATHSPEC];
  try {
    await execFileAsync('git', ['diff', '--quiet', ...range], { cwd: REPO_ROOT });
    return { changed: false, changedPaths: [] };
  } catch (err) {
    if (err?.code !== 1) return unknown;
  }
  try {
    const { stdout } = await execFileAsync('git', ['diff', '--name-only', ...range], {
      cwd: REPO_ROOT,
    });
    return { changed: true, changedPaths: stdout.split('\n').filter(Boolean) };
  } catch {
    return { changed: true, changedPaths: null };
  }
}

/**
 * Evaluate artefact freshness, as a pure function. Every git fact is passed in already resolved, so
 * this stays a predicate over data rather than a live git call.
 *
 * FRESH IS DEFINED HERE, ONCE, over every axis (FOLLOW-1200, FOLLOW-1196, FOLLOW-1205,
 * FOLLOW-1208). An artefact is FRESH iff ALL of:
 *   1. SHA — it carries a `harnessSha`;
 *   2. COMPLETION — it is not an abort artefact (`aborted !== true`). An abort artefact carries a
 *      current SHA and every AC in it is UNMEASURED, so "is this artefact a result?" is no. Verdict
 *      `ABORTED`, distinct from STALE;
 *   3. TREE — it records `harnessTree.dirty === false`. A dirty run stamped a SHA whose bytes it did
 *      not execute (verdict `DIRTY`). An artefact with no tree record (every artefact written before
 *      FOLLOW-1205) or an unknown one is STALE, never a silent clean;
 *   4. CONTENT — no `HARNESS_TREE_PATHSPEC` path differs between `harnessSha` and HEAD
 *      (`measuredPaths.changed === false`). Unknown is STALE.
 *
 * Axis 4 replaced "ancestor of HEAD and `commitsBehind === 0`" (FOLLOW-1208, RETRO-327 §4a LG-3).
 * That rule was path-blind (a docs-only commit staled a run made one commit earlier) and
 * squash-blind (this repository squash-merges, so a run made on a PR branch is never an ancestor of
 * `main`, and was refused with no override). The question is whether the bytes that ran changed; a
 * commit graph answers it only by proxy. Ancestry still decides two things:
 *   - WORDING. An ancestor whose measured paths are unchanged is FRESH and prints `commitsBehind`
 *     next to `measuredPathsChanged=0`. A NON-ancestor whose measured-path tree equals HEAD's is
 *     FRESH-by-content, and never prints `commitsBehind`: for a non-ancestor that rev-list count
 *     runs back to the merge base and is not a distance from `harnessSha`.
 *   - THE ESCAPE HATCH. `allowStale` (the CLI's `--allow-stale`) relaxes axis 4 for an ANCESTOR of
 *     HEAD only, loudly (`allowedStale: true`, verdict `ALLOW_STALE`): the grade is of an older
 *     commit of this history, and is quoted as such. It never relaxes axes 1-3, and never a
 *     non-ancestor whose paths differ: that run executed bytes this history never contained.
 *
 * AGE IS NOT AN AXIS, deliberately. `startedAt` is written on every artefact and PRINTED by the CLI,
 * but it is not graded: freshness here is "which bytes ran, and did the run finish", and wall-clock
 * age changes neither. Substrate state (database rows, Doppler values) is not captured by age
 * either; a time bound would need its own ticket and its own input.
 *
 * @param {{harnessSha: string|null, isAncestorOfHead: boolean|null, commitsBehind: number|null,
 *   measuredPaths?: {changed: boolean|null, changedPaths: string[]|null}|null,
 *   aborted?: boolean, harnessTree?: {dirty: boolean|null, dirtyPaths: string[]|null}|null}} facts
 * @param {{allowStale?: boolean}} [options]
 * @returns {{ok: boolean, verdict: 'FRESH'|'ALLOW_STALE'|'STALE'|'ABORTED'|'DIRTY',
 *   allowedStale: boolean, commitsBehind: number|null, measuredPathsChanged: number|null,
 *   reason: string}} `commitsBehind` is `null` unless `harnessSha` is a verified ancestor of HEAD.
 */
export function evaluateArtefactStaleness(
  {
    harnessSha,
    isAncestorOfHead,
    commitsBehind,
    measuredPaths = null,
    aborted = false,
    harnessTree = null,
  },
  { allowStale = false } = {},
) {
  const ancestor = isAncestorOfHead === true;
  const counted = ancestor && Number.isInteger(commitsBehind) && commitsBehind >= 0;
  const changedPaths = Array.isArray(measuredPaths?.changedPaths)
    ? measuredPaths.changedPaths
    : null;
  const verdictOf = (ok, verdict, reason) => ({
    ok,
    verdict,
    allowedStale: verdict === 'ALLOW_STALE',
    commitsBehind: counted ? commitsBehind : null,
    measuredPathsChanged:
      measuredPaths?.changed === false
        ? 0
        : measuredPaths?.changed === true
          ? (changedPaths?.length ?? null)
          : null,
    reason,
  });
  const refuse = (verdict, reason) => verdictOf(false, verdict, reason);
  if (typeof harnessSha !== 'string' || harnessSha.length === 0) {
    return refuse(
      'STALE',
      'artefact carries no harnessSha — cannot verify which commit produced it; STALE',
    );
  }
  if (aborted === true) {
    return refuse(
      'ABORTED',
      `artefact at harnessSha ${harnessSha} is an ABORT artefact — the run never finished, every AC ` +
        'in it is UNMEASURED; it is not a result at any commit',
    );
  }
  if (harnessTree?.dirty === true) {
    const paths = Array.isArray(harnessTree.dirtyPaths) ? harnessTree.dirtyPaths : [];
    return refuse(
      'DIRTY',
      `run at harnessSha ${harnessSha} started with uncommitted changes in ` +
        `[${paths.join(', ')}] — the SHA does not name the bytes that ran; refusing to grade`,
    );
  }
  if (harnessTree?.dirty !== false) {
    return refuse(
      'STALE',
      `artefact at harnessSha ${harnessSha} records no working-tree state ` +
        `(harnessTree=${JSON.stringify(harnessTree)}) — cannot verify the SHA names the bytes ` +
        'that ran; STALE',
    );
  }
  // Where the SHA sits relative to HEAD, worded so a non-ancestor's rev-list count is never
  // presented as a distance (FOLLOW-1208).
  const position = !ancestor
    ? `is not a verified ancestor of HEAD (isAncestorOfHead=${String(isAncestorOfHead)}: a ` +
      'squash-merged branch commit or another line of history, so no commit distance applies)'
    : counted
      ? `is an ancestor of HEAD, commitsBehind=${commitsBehind}`
      : `is an ancestor of HEAD but commitsBehind=${String(commitsBehind)} could not be counted`;
  if (measuredPaths?.changed === false) {
    return verdictOf(
      true,
      'FRESH',
      ancestor
        ? `harnessSha ${harnessSha} ${position}, measuredPathsChanged=0 — no measured path ` +
            'changed since it; clean tree, run completed'
        : `harnessSha ${harnessSha} ${position}, but its measured-path tree equals HEAD's ` +
            '(measuredPathsChanged=0) — FRESH-by-content; clean tree, run completed',
    );
  }
  if (measuredPaths?.changed !== true) {
    return refuse(
      'STALE',
      `harnessSha ${harnessSha} ${position}, and whether a measured path changed since it could ` +
        'not be read (a commit this clone does not have, or git unavailable) — STALE, refusing to ' +
        'grade',
    );
  }
  const changed =
    changedPaths === null
      ? 'measuredPathsChanged=unknown'
      : `measuredPathsChanged=${changedPaths.length} [${changedPaths.slice(0, 10).join(', ')}` +
        `${changedPaths.length > 10 ? ', …' : ''}]`;
  if (!ancestor) {
    return refuse(
      'STALE',
      `harnessSha ${harnessSha} ${position}, and its measured paths differ from HEAD's ` +
        `(${changed}) — STALE, refusing to grade; --allow-stale does not apply to a non-ancestor`,
    );
  }
  if (!counted) {
    return refuse(
      'STALE',
      `harnessSha ${harnessSha} ${position}, ${changed} — STALE, refusing to grade`,
    );
  }
  if (!allowStale) {
    return refuse(
      'STALE',
      `harnessSha ${harnessSha} ${position}, ${changed} — STALE, refusing to grade (pass ` +
        '--allow-stale to grade it anyway, loudly)',
    );
  }
  return verdictOf(
    true,
    'ALLOW_STALE',
    `harnessSha ${harnessSha} ${position}, ${changed} — STALE, graded ONLY because --allow-stale ` +
      'was given',
  );
}

/**
 * Read an artefact and print one verdict banner per `evaluateArtefactStaleness()`. Invoked via
 * `--check-staleness [path] [--allow-stale]` (see the foot of this file). Never throws: a grader
 * always gets a verdict line rather than an uncaught rejection.
 *
 * EXIT-CODE CONTRACT (set at the foot of this file): 0 for `FRESH`, and for `ALLOW_STALE` when
 * `--allow-stale` was given; 1 for `STALE`, `ABORTED`, `DIRTY`, and an unreadable or non-JSON file.
 * The printed verdict word, not the exit code, is what separates those.
 *
 * @param {string} path
 * @param {{allowStale?: boolean}} [options]
 * @returns {Promise<boolean>}
 */
async function checkArtefactStaleness(path, { allowStale = false } = {}) {
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
  const verdict = evaluateArtefactStaleness(
    {
      harnessSha: sha,
      isAncestorOfHead: await isGitAncestorOfHead(sha),
      commitsBehind: await readCommitsBehind(sha),
      measuredPaths: await readMeasuredPathDiff(sha),
      aborted: artefact.aborted === true,
      harnessTree: artefact.harnessTree ?? null,
    },
    { allowStale },
  );
  const started = `startedAt ${String(artefact.startedAt ?? null)}`;
  if (verdict.allowedStale) {
    const bar = '!'.repeat(96);
    console.error(
      `\n${bar}\n[ALLOW-STALE] ${path}: ${verdict.reason}; ${started}.\n` +
        `[ALLOW-STALE] This artefact was produced ${String(verdict.commitsBehind)} commit(s) before ` +
        `HEAD, and ${String(verdict.measuredPathsChanged)} measured path(s) changed since. Any ` +
        'grade taken from it is a grade of THAT commit, not of HEAD. Say so wherever the grade ' +
        `is quoted.\n${bar}\n`,
    );
  } else if (verdict.ok) {
    console.log(`[FRESH] ${path}: ${verdict.reason}; ${started}`);
  } else {
    console.error(
      `\n[${verdict.verdict}] ${path}: ${verdict.reason}; ${started}. Re-run the harness at HEAD ` +
        'on a clean tree before grading.\n',
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
 * The SDK's adapt loop — where the chat-refresh schedule (`CHAT_REFRESH_*`) lives since FOLLOW-1296
 * split `init()` out of `index.ts`.
 */
const SDK_ADAPT_LOOP_PATH = new URL(
  '../../../packages/sdk/src/core/adapt-loop.ts',
  import.meta.url,
);

/** The SDK's event dispatcher — the ONE place that defines when a refused batch is re-sent. */
const SDK_EVENTS_PATH = new URL('../../../packages/sdk/src/core/events.ts', import.meta.url);

/**
 * Harness margin between an ingest 2xx and the row being readable in ClickHouse, plus the send's
 * own round trip. Measured 2026-09-22 (README §5.16 run 6, ingest log): `events_accepted` →
 * `clickhouse_push_ok_post_ack` took 26 ms. 5000 ms is two orders of magnitude of headroom. This is
 * the ONE number in the budget that is not read from the SDK, because it is not the SDK's.
 */
const INGEST_TO_CLICKHOUSE_SLACK_MS = 5000;

/**
 * How long AC(5) may wait for this run's `cta.clicked` row, derived from the SDK's own source
 * (FOLLOW-1252). Pure, so a test can hand it the real source text with one constant edited.
 *
 * FOUND BY EXECUTION twice. FOLLOW-1075: the flush interval is 5000 ms (`index.ts`
 * `BATCH_INTERVAL_MS`, a fixed `setInterval` that does NOT reset per event), not the 2000 ms older
 * comments assumed, so a click can sit queued a full interval before its first send. FOLLOW-1252
 * (README §5.16): since FOLLOW-1242 a refused batch is re-sent, and a single read one interval +
 * 2000 ms after the click graded two DELIVERED conversions (7.9 s, 8.15 s) `thisRunConversions=0`.
 *
 * The schedule (`dispatchEvents()`, `events.ts`): a batch formed at a flush is sent on every flush
 * `n` that is a power of two (`!(++b.n & (b.n - 1))`), and a failed send at `n >= MAX_FLUSHES`
 * drops it. So the last send is on the smallest power of two `>= MAX_FLUSHES`. A click just after a
 * tick is first sent one interval later, so send `n` goes out at most `n × BATCH_INTERVAL_MS` after
 * the click. The budget covers every timed send the SDK will ever make, plus
 * `INGEST_TO_CLICKHOUSE_SLACK_MS`. Past it the SDK has given up, so a missing row is a real loss.
 *
 * Throws, never guesses, when the source no longer has the shape it knows how to read.
 *
 * @param {{indexSrc: string, eventsSrc: string, slackMs?: number}} args
 * @returns {{batchIntervalMs: number, maxFlushes: number, sendFlushes: number[],
 *   lastSendAfterClickMs: number, slackMs: number, budgetMs: number, source: string[]}}
 */
export function deriveAc5PollBudget({
  indexSrc,
  eventsSrc,
  slackMs = INGEST_TO_CLICKHOUSE_SLACK_MS,
}) {
  const interval = /const\s+BATCH_INTERVAL_MS\s*=\s*([0-9_]+)\s*;/.exec(indexSrc);
  if (!interval) {
    throw new Error('Could not read BATCH_INTERVAL_MS from packages/sdk/src/index.ts.');
  }
  const cap = /const\s+MAX_FLUSHES\s*=\s*([0-9_]+)\s*;/.exec(eventsSrc);
  if (!cap) throw new Error('Could not read MAX_FLUSHES from packages/sdk/src/core/events.ts.');
  const flat = eventsSrc.replace(/\s+/g, '');
  if (!flat.includes('!(++b.n&(b.n-1))') || !flat.includes('if(b.n>=MAX_FLUSHES)return;')) {
    throw new Error(
      'The re-send schedule in packages/sdk/src/core/events.ts is no longer the power-of-two ' +
        'predicate + MAX_FLUSHES drop this budget is derived from. Re-derive deriveAc5PollBudget().',
    );
  }
  const batchIntervalMs = Number(interval[1].replace(/_/g, ''));
  const maxFlushes = Number(cap[1].replace(/_/g, ''));
  const sendFlushes = [1];
  while (sendFlushes[sendFlushes.length - 1] < maxFlushes) {
    sendFlushes.push(sendFlushes[sendFlushes.length - 1] * 2);
  }
  const lastSendAfterClickMs = sendFlushes[sendFlushes.length - 1] * batchIntervalMs;
  return {
    batchIntervalMs,
    maxFlushes,
    sendFlushes,
    lastSendAfterClickMs,
    slackMs,
    budgetMs: lastSendAfterClickMs + slackMs,
    source: [
      'packages/sdk/src/index.ts BATCH_INTERVAL_MS',
      'packages/sdk/src/core/events.ts MAX_FLUSHES',
    ],
  };
}

/**
 * `deriveAc5PollBudget()` over the SDK source files on disk at run time.
 *
 * @returns {Promise<ReturnType<typeof deriveAc5PollBudget>>}
 */
export async function readAc5PollBudget() {
  const [indexSrc, eventsSrc] = await Promise.all([
    readFile(SDK_INDEX_PATH, 'utf8'),
    readFile(SDK_EVENTS_PATH, 'utf8'),
  ]);
  return deriveAc5PollBudget({ indexSrc, eventsSrc });
}

/**
 * Poll this run's `cta.clicked` count until it is ≥ 1 or `budgetMs` has passed since the click
 * (FOLLOW-1252). Replaces a single read at a fixed offset. `null` from `countConversions` is an
 * unreadable ClickHouse: counted in `unreadableReads`, never read as a landed row.
 *
 * `waitedMs` and `landedAtMs` are measured from `clickAt`. `landedAtMs` is when the poll first SAW
 * the row, an upper bound on when it landed (at most `pollMs` late).
 *
 * @param {{countConversions: () => Promise<number|null>, budgetMs: number, clickAt: number,
 *   pollMs?: number, now?: () => number, sleepFn?: (ms: number) => Promise<void>}} args
 * @returns {Promise<{landed: boolean, attempts: number, waitedMs: number, budgetMs: number,
 *   landedAtMs: number|null, conversions: number, unreadableReads: number}>}
 */
export async function pollThisRunConversion({
  countConversions,
  budgetMs,
  clickAt,
  pollMs = 500,
  now = Date.now,
  sleepFn = sleep,
}) {
  let attempts = 0;
  let unreadableReads = 0;
  for (;;) {
    const n = await countConversions();
    attempts += 1;
    if (n === null) unreadableReads += 1;
    const waitedMs = now() - clickAt;
    const landed = n !== null && n > 0;
    if (landed || waitedMs >= budgetMs) {
      return {
        landed,
        attempts,
        waitedMs,
        budgetMs,
        landedAtMs: landed ? waitedMs : null,
        conversions: landed ? n : 0,
        unreadableReads,
      };
    }
    await sleepFn(Math.min(pollMs, budgetMs - waitedMs));
  }
}

/**
 * What the browser saw of the ingest POSTs, and of the ones that carried this session's
 * `cta.clicked` in particular (FOLLOW-1252). `ingestPosts` is the harness's per-request record
 * (status from `response`, errorText from `requestfailed`). A 503 whose response has no CORS header
 * never reaches `response`: the browser reports it as `requestfailed` `net::ERR_FAILED`, so it is
 * counted in `ingestFailedAtNetwork`, not `ingest5xx` (§5.16: only the Worker log shows the 503).
 * `resent` is read off `emitted[]`: the same first `event_id` in two ingest POSTs.
 *
 * @param {{ingestPosts: object[], emitted: object[], ingestOrigin: string, sessionId: string}} args
 */
export function summarizeCtaIngest({ ingestPosts, emitted, ingestOrigin, sessionId }) {
  const ctaPosts = ingestPosts
    .filter((p) => p.types.includes('cta.clicked') && p.sessionIds.includes(sessionId))
    .map((p) => ({
      seq: p.seq,
      key: p.key,
      firstEventId: p.firstEventId,
      status: p.status,
      failure: p.failure,
    }));
  const seen = new Map();
  for (const e of emitted) {
    if (typeof e.url !== 'string' || !e.url.startsWith(ingestOrigin)) continue;
    const first = e.body?.events?.[0]?.event_id;
    if (typeof first === 'string') seen.set(first, (seen.get(first) ?? 0) + 1);
  }
  const resentFirstEventIds = [...seen].filter(([, n]) => n > 1).map(([id]) => id);
  return {
    ctaPosts,
    ctaBatchAccepted: ctaPosts.some((p) => p.status !== null && p.status >= 200 && p.status < 300),
    ingestPosts: ingestPosts.length,
    ingest5xx: ingestPosts.filter((p) => p.status !== null && p.status >= 500).length,
    ingestFailedAtNetwork: ingestPosts.filter((p) => p.failure !== null).length,
    resent: resentFirstEventIds.length > 0,
    resentFirstEventIds,
  };
}

/**
 * Why this run's conversion is missing once the poll budget has run out (FOLLOW-1252). Three
 * causes a grader must not confuse: the SDK never sent it (the §5.5 negative control), ingest never
 * accepted it (every send refused), or ingest accepted it and the row never reached ClickHouse.
 *
 * @param {{ctaIngest: ReturnType<typeof summarizeCtaIngest>, budgetMs: number}} args
 * @returns {{lossKind: string, cause: string}}
 */
export function classifyConversionLoss({ ctaIngest, budgetMs }) {
  const sends = ctaIngest.ctaPosts
    .map((p) => `#${String(p.seq)}:${String(p.status ?? p.failure ?? 'no response')}`)
    .join(', ');
  if (ctaIngest.ctaPosts.length === 0) {
    return {
      lossKind: 'cta_not_sent',
      cause:
        `no ingest POST carried this session's cta.clicked within the ${String(budgetMs)} ms ` +
        'budget: the click emitted nothing, or the SDK never flushed it',
    };
  }
  if (!ctaIngest.ctaBatchAccepted) {
    return {
      lossKind: 'no_ingest_2xx_for_cta_batch',
      cause:
        `ingest never answered 2xx to the batch carrying cta.clicked within the ${String(budgetMs)} ` +
        `ms budget (sends: ${sends}), so the conversion was lost before ingest`,
    };
  }
  return {
    lossKind: 'ingest_accepted_row_never_landed',
    cause:
      `ingest answered 2xx to the batch carrying cta.clicked (sends: ${sends}) but no row for this ` +
      `session reached ClickHouse within the ${String(budgetMs)} ms budget`,
  };
}

/**
 * Why this run has no SERVER-CONFIRMED conversion although its `cta.clicked` landed (FOLLOW-1203).
 * Read off what was requested and what ClickHouse holds for the session; pure.
 *
 * @param {{request: {requested: boolean, skipped?: string, mode?: string, ok?: boolean,
 *   status?: number|null, error?: string|null}, thisRun: {signedConversions?: number,
 *   unsignedConversions?: number}}} args
 * @returns {{lossKind: string, cause: string}}
 */
export function classifyConfirmedConversionLoss({ request, thisRun }) {
  const signed = thisRun.signedConversions ?? 0;
  const unsigned = thisRun.unsignedConversions ?? 0;
  if (signed > 0) {
    return {
      lossKind: 'signed_conversion_before_first_decision',
      cause:
        `${String(signed)} signed conversion row(s) exist for this session but none was received ` +
        'at or after its first decision, so the lift counts it as pre-exposure, not as a conversion',
    };
  }
  if (unsigned > 0) {
    return {
      lossKind: 'only_unsigned_conversion',
      cause:
        `this session's only conversion event(s) (${String(unsigned)}) are unsigned — emitted by a ` +
        'browser-class caller. Ingest accepts them and the lift does not count them (ESC-084)',
    };
  }
  if (!request.requested) {
    return {
      lossKind: 'confirmed_conversion_not_requested',
      cause: `the harness never asked the host backend to confirm a conversion (${String(request.skipped)})`,
    };
  }
  if (request.ok !== true) {
    return {
      lossKind: 'conversion_emitter_failed',
      cause:
        `the fixture host backend did not get the signed event accepted (emitter status ` +
        `${String(request.status ?? request.error ?? 'no response')})`,
    };
  }
  return {
    lossKind: 'signed_conversion_row_never_landed',
    cause: 'ingest accepted the signed event but no signed row for this session reached ClickHouse',
  };
}

/**
 * The run-scoped conjunct of AC(5) (FOLLOW-1124), with the loss kind attached when the conversion
 * is missing (FOLLOW-1252). `thisRunConversions=0` is kept verbatim: graders search for it.
 *
 * FOLLOW-1203: `thisRun.conversions` is the session's SERVER-CONFIRMED conversions (a signed
 * `inquiry.completed` / `live.signup` received at or after its first decision), no longer its
 * `cta.clicked` rows. The click is the hop BEFORE it: `main()` asks the host backend to confirm
 * only once the click's row has landed, so a missing click still reds the run, with the click's own
 * loss kind (`classifyConversionLoss()`), and a click with no confirmed conversion reds it with one
 * of `classifyConfirmedConversionLoss()`'s.
 *
 * @param {{determinable: boolean, reason: string|null, treatmentArmDecisions: number,
 *   conversions: number}} thisRun
 * @param {{lossKind: string}|null} loss
 * @returns {{converted: boolean, unmet: string[]}}
 */
export function evaluateThisRunConversion(thisRun, loss) {
  const unmet = [];
  if (!thisRun.determinable) {
    unmet.push(`thisRun=indeterminate(${String(thisRun.reason)})`);
  } else {
    if (thisRun.treatmentArmDecisions === 0) unmet.push('thisRunTreatmentArmDecisions=0');
    if (thisRun.treatmentArmDecisions > 0 && thisRun.conversions === 0) {
      unmet.push('thisRunConversions=0');
      if (loss) unmet.push(`thisRunConversionLoss=${loss.lossKind}`);
    }
  }
  return {
    converted: thisRun.determinable && thisRun.treatmentArmDecisions > 0 && thisRun.conversions > 0,
    unmet,
  };
}

/**
 * Read the SDK's `data-api-key` straight out of the fixture it is served from, rather than
 * hardcoding a second copy that could silently drift from the value the browser session
 * actually authenticates with. Same "read the source, don't duplicate it" reasoning as
 * `readServerConfidenceGate()` above.
 *
 * @returns {Promise<string>}
 */
export async function readFixtureApiKey() {
  const src = await readFile(FIXTURE_PATH, 'utf8');
  const match = /data-api-key="([^"]+)"/.exec(src);
  if (!match) {
    throw new Error('Could not read data-api-key from fixture-listing.html.');
  }
  return match[1];
}

/**
 * The listing id the SDK will send in every `/api/adapt` body, read out of the fixture for the
 * same reason `readFixtureApiKey()` is — a second hardcoded copy could drift from the id the
 * browser session actually asks about, and the grounding probe below would then vouch for a
 * listing nobody requested.
 *
 * @returns {Promise<string>}
 */
export async function readFixtureListingId() {
  const src = await readFile(FIXTURE_PATH, 'utf8');
  const match = /data-estalara-listing-id="([^"]+)"/.exec(src);
  if (!match) {
    throw new Error('Could not read data-estalara-listing-id from fixture-listing.html.');
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
 * The lift's own inputs, as the rollup that computed it reports them (`rollup.conversions`,
 * FOLLOW-1203): per-arm denominators, the server-confirmed numerators, and the three classes the
 * lift leaves out. Before FOLLOW-1203 this was a second SQL statement in the harness, a hand copy
 * of the reader's join that counted `cta.clicked`; the reader now publishes the counts next to the
 * number, so there is no copy to drift.
 *
 * NOT the AC(5) verdict source (that is `adaptedArm.thisRun`, session-scoped). It exists so a RED
 * names WHICH of `computeLift()`'s null-conditions is unmet (FOLLOW-1075).
 *
 * @param {any} body the rollup response body
 * @returns {{adaptedN: number, adaptedConversions: number|null, holdoutN: number,
 *   holdoutConversions: number|null, preExposureConversions: number|null,
 *   unsignedConversions: number|null, ctaClickedSessions: number}|{error: string}}
 */
export function readRollupConversionCounts(body) {
  const c = body?.rollup?.conversions;
  if (!c || typeof c.adaptedN !== 'number' || typeof c.holdoutN !== 'number') {
    return { error: 'the rollup response carries no rollup.conversions (pre-FOLLOW-1203 plane?)' };
  }
  return {
    adaptedN: c.adaptedN,
    adaptedConversions: c.adaptedConversions ?? null,
    holdoutN: c.holdoutN,
    holdoutConversions: c.holdoutConversions ?? null,
    preExposureConversions: c.preExposureConversions ?? null,
    unsignedConversions: c.unsignedConversions ?? null,
    ctaClickedSessions: c.ctaClickedSessions ?? 0,
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
 * `measureConversionCounts()` (a harness SQL copy, removed by FOLLOW-1203), whose ENTIRE filter was `WHERE ad.ts >= now() - toIntervalDay(7)` —
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
 * FOLLOW-1196 (RETRO-325 §4a LG-4): the decision count is `treatmentArmDecisions`, not
 * `adaptedDecisions` (its name in artefacts before FOLLOW-1196). It counts `holdout_group = 0`
 * rows whatever their `source`, which is ARM MEMBERSHIP. A treatment session served template copy
 * is still treatment, so this is the right population for AC(5)'s claim and the verdict does not
 * change. Only the old name over-claimed adaptation. Whether anything was adapted is AC(1)'s claim.
 *
 * FOLLOW-1203: `conversions` is the session's SERVER-CONFIRMED conversions (signed, at/after its
 * first decision) — the class the lift counts. `ctaClicks` is the funnel hop before it, and
 * `signedConversions` / `unsignedConversions` say what else the session holds, so a RED can tell
 * "nothing was emitted" from "a browser-class conversion was, and was rightly not counted".
 *
 * @param {string|null} sid this run's browser session id
 * @returns {Promise<{determinable: boolean, reason: string|null, treatmentArmDecisions: number,
 *   conversions: number, ctaClicks: number, signedConversions: number,
 *   unsignedConversions: number}>}
 */
async function measureThisRunAdaptedArm(sid) {
  const base = {
    determinable: false,
    reason: null,
    treatmentArmDecisions: 0,
    conversions: 0,
    ctaClicks: 0,
    signedConversions: 0,
    unsignedConversions: 0,
  };
  if (typeof sid !== 'string' || sid.length === 0) {
    return { ...base, reason: 'no_session_id' };
  }
  const esc = (v) => String(v).replace(/'/g, '');

  const decisionRows = await chQuery(
    `SELECT count() AS n FROM adaptation_decisions
     WHERE session_id = '${esc(sid)}' AND holdout_group = 0`,
  ).catch(() => null);
  const ctaClicks = await countThisRunConversions(sid);
  const confirmed = await countThisRunConfirmedConversions(sid);

  if (decisionRows === null || ctaClicks === null || confirmed === null) {
    return { ...base, reason: 'clickhouse_unreachable' };
  }
  return {
    determinable: true,
    reason: null,
    treatmentArmDecisions: Number(decisionRows[0]?.n ?? 0),
    conversions: confirmed.attributed,
    ctaClicks,
    signedConversions: confirmed.signed,
    unsignedConversions: confirmed.unsigned,
  };
}

/**
 * This session's conversion-event rows by class (FOLLOW-1203), keyed by `session_id` only.
 *
 * Written independently of the control plane's reader (`conversionEventsSubquery()` in
 * `lift/route-helpers.ts`) on purpose: it states the CEO's rule directly — a conversion is a signed
 * `inquiry.completed` / `live.signup` received at or after the session's FIRST decision — so a
 * reader that drifted from the rule would disagree with this count on the run's own session.
 * `attributed` needs a decision row to exist: with none, `min(ts)` over the empty set is the epoch
 * and every row would pass.
 *
 * @param {string} sid
 * @returns {Promise<{signed: number, attributed: number, unsigned: number}|null>} `null` when
 *   ClickHouse could not be read (including a database without `events.caller_signed`).
 */
async function countThisRunConfirmedConversions(sid) {
  const id = String(sid).replace(/'/g, '');
  const isConversion = "type IN ('inquiry.completed', 'live.signup')";
  const rows = await chQuery(
    `SELECT
       countIf(${isConversion} AND caller_signed = 1) AS signed,
       countIf(${isConversion} AND caller_signed = 1
         AND (SELECT count() FROM adaptation_decisions WHERE session_id = '${id}') > 0
         AND ingest_received_at >= (SELECT min(ts) FROM adaptation_decisions WHERE session_id = '${id}')
       ) AS attributed,
       countIf(${isConversion} AND caller_signed = 0) AS unsigned
     FROM events WHERE session_id = '${id}'`,
  ).catch(() => null);
  if (rows === null) return null;
  return {
    signed: Number(rows[0]?.signed ?? 0),
    attributed: Number(rows[0]?.attributed ?? 0),
    unsigned: Number(rows[0]?.unsigned ?? 0),
  };
}

/**
 * Ask the localhost host-backend stand-in to confirm a conversion for `sessionId` (FOLLOW-1203,
 * ESC-084 ruling 3). The fixture server signs ONE `inquiry.completed` and POSTs it to the real
 * ingest Worker; this harness holds no signing secret and writes nothing itself.
 *
 * @param {string} sessionId
 * @param {string|null} listingId
 * @returns {Promise<Record<string, unknown>>} diagnostics — never throws.
 */
async function requestConfirmedConversion(sessionId, listingId) {
  const diag = { requested: true, mode: 'signed_by_fixture_host_backend', requestedAt: Date.now() };
  try {
    const res = await fetch(CONVERSION_EMITTER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        type: 'inquiry.completed',
        ...(listingId ? { listing_id: listingId } : {}),
      }),
      signal: AbortSignal.timeout(60000),
    });
    const body = await res.json().catch(() => null);
    diag.status = res.status;
    diag.ok = res.status === 200 && body?.ok === true;
    diag.eventId = body?.eventId ?? null;
    diag.ingestStatus = body?.ingestStatus ?? null;
    diag.sends = body?.sends ?? null;
    if (!diag.ok) diag.error = body?.error ?? `emitter answered ${String(res.status)}`;
  } catch (err) {
    diag.ok = false;
    diag.status = null;
    diag.error = String(err);
  }
  return diag;
}

/**
 * RED-FIRST ONLY (`FOLLOW1203_REDFIRST_UNSIGNED_CONVERSION=1`): emit the conversion the way a
 * browser does — the page-visible key and an `Origin`, no signature. This is the pre-FOLLOW-1203
 * shape of a conversion, and the one any visitor can forge.
 *
 * @param {string} sessionId
 * @returns {Promise<Record<string, unknown>>} diagnostics — never throws.
 */
async function emitUnsignedBrowserConversion(sessionId) {
  const diag = { requested: true, mode: 'redfirst_unsigned_browser', requestedAt: Date.now() };
  try {
    const res = await fetch(`${INGEST_ORIGIN}/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: new URL(LISTING_URL).origin,
        'X-Estalara-API-Key': await readFixtureApiKey(),
        'x-session-id': sessionId,
      },
      body: JSON.stringify({
        events: [
          {
            event_id: randomUUID(),
            tenant_id: '00000000-0000-0000-0000-000000000000',
            session_id: sessionId,
            ts: Date.now(),
            region: 'eu',
            consent_state: 'consented',
            schema_version: 1,
            type: 'inquiry.completed',
            payload: { channel: 'email' },
          },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });
    diag.status = res.status;
    // `ok` here means "ingest ACCEPTED the unsigned event" — which it must (ESC-084 ruling 2).
    diag.ok = res.status >= 200 && res.status < 300;
  } catch (err) {
    diag.ok = false;
    diag.status = null;
    diag.error = String(err);
  }
  return diag;
}

/**
 * This session's `cta.clicked` rows in ClickHouse, keyed by `session_id` only (see
 * `measureThisRunAdaptedArm()` for why never by tenant). The one query both AC(5)'s click poll
 * (FOLLOW-1252) and its `ctaClicks` evidence read, so they cannot disagree about what "landed"
 * means. Since FOLLOW-1203 the click is the funnel hop before the conversion, not the conversion.
 *
 * @param {string} sid
 * @returns {Promise<number|null>} `null` when ClickHouse could not be read.
 */
async function countThisRunConversions(sid) {
  const rows = await chQuery(
    `SELECT count() AS n FROM events
     WHERE session_id = '${String(sid).replace(/'/g, '')}' AND type = 'cta.clicked'`,
  ).catch(() => null);
  return rows === null ? null : Number(rows[0]?.n ?? 0);
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
 * FOLLOW-1131 — `profile` mirrors the ADAPTED arm's archetype onto this control call, and it is
 * load-bearing rather than cosmetic. Without it this session carries no signals at all, so
 * `/adapt` resolves it `neutral` below the confidence gate and returns **zero directives whether or
 * not it drew holdout**. Measured, not assumed: the first red-first run of AC(7)
 * (`holdout_pct: 0`, so the session was NOT held out) still reported `directivesServed: 0`. An
 * assertion that the control arm received nothing would therefore have been satisfied by a session
 * in the ADAPTED arm — vacuous in exactly the way Rule AU names.
 *
 * FOLLOW-1196: the profile is taken from `selectProfileResponse()`, which is AC(1)'s first adapted
 * response when one exists. Before that it came from the most confident response, which could be a
 * template.
 *
 * WHAT MIRRORING DOES AND DOES NOT EQUALISE (FOLLOW-1142). An earlier version of this docblock said
 * mirroring makes holdout assignment "the ONLY difference between the two arms". That was false.
 * What the red-first control (`FOLLOW1131_CONTROL_HOLDOUT_PCT=0`) actually compares is **the same
 * synthetic control session with `holdout_pct` 0 versus 1**, and that is the comparison ESC-073
 * clause 2 needs. The browser session and this control session still differ on four axes:
 *   1. Session identity and history. This is a fresh synthetic session with zero ingest events.
 *      The browser session carries the whole scripted behavioural trace.
 *   2. `listing_id` / `listing_ids`. This POST sends neither. The SDK sends them when the page declares
 *      them (`core/adapt.ts`, `index.ts`), and `/api/adapt`
 *      uses them for per-listing RAG context, the archetype-fit gate and the `reorder` append.
 *   3. Call count. AC(7)'s adapted half asks whether ANY of the browser session's adapt calls was
 *      adapted. The control half reads this ONE call.
 *   4. Source branch. `similarity` is mirrored from the chosen response (echoed on the POST
 *      response), so an `llm_tweaked` profile sends this call down branch 3 and an `llm_full` one
 *      down branch 4. On the fallback profile (no adapted response) it can be a template's `0.8552`,
 *      which takes branch 2 (strict `>` 0.85). The `0.5` default applies only when the chosen
 *      response carried no `similarity`.
 *
 * These are real INPUT fields of `AdaptPostBodySchema`, the same standing the scope note above
 * gives `holdout_pct`; the outputs (`holdout_group`, `directives`) stay computed by production code.
 *
 * DEPENDS ON FOLLOW-1201 (PR #902), for both calls below:
 *   - `POST /api/adapt` is sent with `Bearer ${ADAPT_API_KEY}`, the ops credential. After #902 a body
 *     `holdout_pct` is honoured ONLY when the bearer constant-time-equals `ADAPT_API_KEY` (the POST
 *     ops resolver, tenant pinned to `OPS_TENANT_ID`); a tenant key's `holdout_pct` is ignored and
 *     the arm is drawn at the configured rate, so the "control" session would be treatment ~90% of
 *     the time. On a `main` WITHOUT #902 this bearer is not a tenant key and the call answers 401,
 *     so AC(7) goes red. That is accepted: #902 also makes `/api/adapt` 500 without
 *     `HOLDOUT_ASSIGNMENT_SECRET`, so the harness cannot run against either side of it unchanged.
 *   - `POST /v1/events` carries `Origin: <LISTING_URL origin>`, the header every browser request
 *     from the fixture page carries and the one thing the harness's copy of `dispatchEvents()` was
 *     missing. After #902 the ingest Worker refuses a caller with no `Origin` and no signature
 *     (`401 unsigned_server_caller`). With `Origin` it takes the browser path, gated by the
 *     constant origin list, which accepts `:5173` outside production (FOLLOW-1333). Harmless
 *     before #902.
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
    const listingOrigin = new URL(LISTING_URL).origin;
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
    //
    // FOLLOW-1201 (#902): the OPS bearer, not the tenant key — only the ops caller's `holdout_pct`
    // is honoured (see the docblock). `main()` refuses to start without ADAPT_API_KEY.
    const adaptRes = await fetch(`${DECISION_ORIGIN}/api/adapt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${ADAPT_API_KEY}` },
      body: JSON.stringify({
        tenant_id: OPS_TENANT_ID,
        session_id: holdoutSessionId,
        page_type: 'listing_detail',
        holdout_pct: CONTROL_ARM_HOLDOUT_PCT,
        // FOLLOW-1131: mirror the adapted arm's profile (the four axes it does NOT equalise are
        // listed in the docblock above).
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
    // dispatchEvents() (same headers, same envelope shape), never a raw ClickHouse INSERT.
    // tenant_id is the SAME placeholder the SDK itself sends; the ingest Worker overwrites it from
    // the resolved API key (memory `project_real_control_plane_on_localhost`).
    //
    // FOLLOW-1201 (#902): `Origin` is the header the BROWSER adds to `dispatchEvents()`'s request,
    // so without it this call was not a mirror. After #902 it is also what keeps the call off the
    // signed-server-caller path (`401 unsigned_server_caller`).
    const ingestRes = await fetch(`${INGEST_ORIGIN}/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: listingOrigin,
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

    // FOLLOW-1203: the click above is a funnel stage now. What gives `computeLift()` a holdout
    // conversion is a SERVER-CONFIRMED one, emitted by the fixture host backend after this
    // session's decision (the row was polled into existence above, and its `ts` precedes this).
    diag.confirmedConversion = await requestConfirmedConversion(holdoutSessionId, null);
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
  harnessTree = await readHarnessTreeState();
  if (harnessTree.dirty !== false) {
    console.log(
      `[FOLLOW-1205] ⚠ working tree is ${harnessTree.dirty === null ? 'UNREADABLE' : 'DIRTY'} ` +
        `(${JSON.stringify(harnessTree.dirtyPaths)}). This run's artefact will read ` +
        `${harnessTree.dirty === null ? 'STALE' : 'DIRTY'} under --check-staleness, because ` +
        `harnessSha ${String(harnessSha)} does not name the bytes that run.`,
    );
  }

  const controlArmCredential = evaluateControlArmCredential(ADAPT_API_KEY);
  if (!controlArmCredential.ok) {
    throw new Error(`Control-arm credential preflight failed: ${controlArmCredential.reason}`);
  }

  const serverGate = await readServerConfidenceGate();
  const preflight = await assertRealControlPlane();
  // Rule Q amendment 1 cl. 5: every value on this line is read off the probe's own response.
  console.log(
    `[preflight] real control plane confirmed at ${DECISION_ORIGIN}: probe with ` +
      `${preflight.credentialClass} and Origin ${preflight.listingOrigin} → POST /api/adapt ` +
      `${String(preflight.status)} ${String(preflight.bodyCode)}, access-control-allow-origin ` +
      `${String(preflight.allowOrigin)}; server gate = confidence ` +
      `${serverGate.comparison === '<=' ? '>' : '>='} ${String(serverGate.value)} (${serverGate.source})`,
  );

  // FOLLOW-1288: the control arm's ops caller exists only under DEMO_MODE=1.
  const demoMode = await assertDemoModeOn();
  console.log(`[preflight] DEMO_MODE=1 confirmed: ${demoMode.reason}`);

  // FOLLOW-1225: name the grounding input, the way the line above names the decision endpoint.
  groundingSource = await assertGroundingSource();
  console.log(
    `[preflight] grounding source confirmed at ${groundingSource.groundingOrigin}: listing ` +
      `${groundingSource.listingId} grounds ${groundingSource.factsKeys.join(', ')}; facts read ` +
      `from ${String(groundingSource.factsSource ?? 'an upstream that did not name itself')}`,
  );

  // FOLLOW-1238 (preflight half): a bound-but-silent `:8787` is exactly the state the two probes
  // above exist to make impossible, and it costs AC(5) and AC(7) ten minutes later.
  const ingestProbe = await assertIngestReachable();
  console.log(`[preflight] ingest confirmed at ${ingestProbe.ingestOrigin}: ${ingestProbe.reason}`);

  // FOLLOW-1203: AC(5) grades a server-confirmed conversion; without an emitter that can sign, the
  // run would learn it ten minutes from now.
  const conversionEmitter = await assertConversionEmitter();
  console.log(
    `[preflight] conversion emitter confirmed at ${conversionEmitter.emitterUrl}: ` +
      `${conversionEmitter.reason}${REDFIRST_UNSIGNED_CONVERSION ? ' — ⚠ RED-FIRST: the adapted session will convert UNSIGNED' : ''}\n`,
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

  // FOLLOW-1252: every ingest POST with the status it got (`response`) or why it failed
  // (`requestfailed`), so "ingest refused the cta.clicked batch" and "ingest accepted it, the row
  // never landed" are told apart from the artefact alone. `net[]` cannot: it has no request body
  // and a CORS-less 503 never reaches `response` (§5.16 run 6: 5 POSTs, 4 responses).
  const ingestPosts = [];
  const ingestPostOf = new WeakMap();
  context.on('request', (req) => {
    if (req.method() !== 'POST' || !req.url().startsWith(`${INGEST_ORIGIN}/v1/events`)) return;
    let events = [];
    try {
      events = JSON.parse(req.postData() ?? 'null')?.events ?? [];
    } catch {
      /* recorded with no events; the status still says what ingest did */
    }
    const entry = {
      seq: ingestPosts.length + 1,
      requestedAt: Date.now(),
      key: req.headers()['idempotency-key'] ?? null,
      firstEventId: events[0]?.event_id ?? null,
      types: events.map((e) => e.type),
      sessionIds: [...new Set(events.map((e) => e.session_id))],
      status: null,
      failure: null,
    };
    ingestPostOf.set(req, entry);
    ingestPosts.push(entry);
  });
  context.on('response', (res) => {
    const entry = ingestPostOf.get(res.request());
    if (entry) entry.status = res.status();
  });
  context.on('requestfailed', (req) => {
    const entry = ingestPostOf.get(req);
    if (entry) entry.failure = req.failure()?.errorText ?? 'request failed';
  });

  // FOLLOW-1240: every browser `/api/adapt` REQUEST, numbered as it goes out, so each response can
  // be matched to the request it answers — the post-quiz settle waits for the quiz turn's request,
  // not for whatever lands next in `decided[]` (settleForAdaptResponse()'s docblock). The `Request`
  // object Playwright hands to `request`, `requestfailed` and `response.request()` is the same
  // instance, so a WeakMap keyed on it is the identity.
  const isAdaptPost = (req) =>
    req.method() === 'POST' &&
    req.url().startsWith(DECISION_ORIGIN) &&
    /\/adapt(\?|$)/.test(req.url());
  const adaptRequests = [];
  const adaptRequestSeq = new WeakMap();
  context.on('request', (req) => {
    if (!isAdaptPost(req)) return;
    let sent = null;
    try {
      sent = JSON.parse(req.postData() ?? 'null');
    } catch {
      /* the body is recorded as absent; the identity does not depend on it */
    }
    const entry = {
      seq: adaptRequests.length + 1,
      requestedAt: Date.now(),
      url: req.url(),
      archetypeHint: sent?.archetype_hint ?? null,
      confidence: sent?.confidence ?? null,
      failure: null,
    };
    adaptRequestSeq.set(req, entry.seq);
    adaptRequests.push(entry);
  });
  context.on('requestfailed', (req) => {
    const seq = adaptRequestSeq.get(req);
    const entry = seq === undefined ? undefined : adaptRequests[seq - 1];
    if (entry) entry.failure = req.failure()?.errorText ?? 'request failed';
  });

  /** Decision RESPONSES — AC(1)'s verdict is a statement about what came back. */
  const decided = [];
  const pending = [];
  context.on('response', (res) => {
    if (!isAdaptPost(res.request())) return;
    const meta = {
      url: res.url(),
      status: res.status(),
      requestSeq: adaptRequestSeq.get(res.request()) ?? null,
    };
    // `receivedAt` is stamped when the body has been read, i.e. when the entry lands in `decided[]`
    // (FOLLOW-1240: the settle's budget cause counts responses at or after the completing click).
    pending.push(
      res.text().then(
        (t) => {
          try {
            decided.push({ ...meta, receivedAt: Date.now(), body: JSON.parse(t.slice(0, 20000)) });
          } catch {
            decided.push({ ...meta, receivedAt: Date.now(), bodyRaw: t.slice(0, 20000) });
          }
        },
        (e) => decided.push({ ...meta, receivedAt: Date.now(), bodyError: String(e) }),
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
  // FOLLOW-1196: `clearedGate` is the confidence claim only — see evaluateArmReachability().
  const armA = evaluateArmReachability(armAResponses, serverGate);

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

  // FOLLOW-1240: each click is timestamped immediately BEFORE it is dispatched. When the card
  // disappears, the last one is the click that completed the quiz, and the first `/api/adapt`
  // request at or after it is the quiz turn's (settleForAdaptResponse()'s docblock).
  let lastQuizClickAt = null;
  let quizCompletedAt = null;
  if (quizWidgetFound) {
    for (let step = 0; step < 8; step++) {
      const answers = await quizAnswers.count().catch(() => 0);
      if (answers === 0) break;
      lastQuizClickAt = Date.now();
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
        lastQuizClickAt = Date.now();
        await quizCta
          .first()
          .click({ timeout: 3000 })
          .catch(() => {});
      }
      quizSteps.push({ step, answers, ctaPresent, ctaEnabled });
      await sleep(1200);

      // FOLLOW-1357: with a served confirmation block the leaf click opens the result screen
      // instead of closing the card. That screen IS the completion (the leaf click stays
      // `quizCompletedAt`); the buyer then confirms. The correction and × paths are AC(10), Q6.
      const resultShown = await page
        .locator('.estalara-quiz-result')
        .first()
        .isVisible()
        .catch(() => false);
      if (resultShown) {
        quizCompleted = true;
        quizCompletedAt = lastQuizClickAt;
        await page
          .locator('.estalara-quiz-confirm')
          .first()
          .click({ timeout: 3000 })
          .catch(() => {});
        break;
      }

      // The card is torn down by cleanup() on completion — its disappearance is the completion
      // signal, and it is read from the DOM rather than inferred from a step count.
      const stillOpen = await quizCard
        .first()
        .isVisible()
        .catch(() => false);
      if (!stillOpen) {
        quizCompleted = true;
        quizCompletedAt = lastQuizClickAt;
        break;
      }
    }
  }
  // FOLLOW-1239: the post-quiz wait is a CONDITION on the real response, not a fixed 3 s.
  // FOLLOW-1240: and its subject is the quiz turn's REQUEST, not a position in `decided[]` — see
  // settleForAdaptResponse()'s docblock for how it is matched and why a longer wait cannot
  // manufacture a green.
  const postQuizSettle = await settleForAdaptResponse({
    decided,
    pending,
    adaptRequests,
    quizCompletedAt,
    serverGate,
  });
  console.log(
    `[settle] post-quiz wait ended on ${postQuizSettle.endedBy} after ` +
      `${String(postQuizSettle.waitedMs)} ms — ${postQuizSettle.cause}`,
  );

  const armBResponses = decided
    .slice(armBStartIndex)
    .filter((d) => d.body)
    .map((d) => d.body);
  const armB = evaluateArmReachability(armBResponses, serverGate);

  // ── AC(1): an LLM-ADAPTED response — see evaluateAc1(); a template cta is not adaptation ──
  const allResponses = decided.filter((d) => d.body).map((d) => d.body);
  // FOLLOW-1239: the artefact must be able to say whether a body landed in `decided[]` after the
  // verdict read it — the 18:32Z run's file disagreed with its own AC(1) and nothing said so.
  const gradedDecidedCount = decided.length;
  // FOLLOW-1196: ONE response for AC(4)'s bandit credit and AC(7)'s mirrored profile — AC(1)'s
  // first adapted response when one exists, else the highest-confidence fallback. The rule and
  // its tie-break are in selectProfileResponse()'s docblock; `profileSelection` records which
  // rule chose on this run.
  const profileSelection = selectProfileResponse(allResponses, serverGate);
  const best = profileSelection.response;
  const profileSelectionEvidence = {
    basis: profileSelection.basis,
    responseIndex: profileSelection.index,
    source: best?.source ?? null,
    archetype: best?.archetype ?? null,
    confidence: best?.confidence ?? null,
    variant: best?.variant ?? null,
  };
  // FOLLOW-1240: whether this session drew holdout, read off the bodies it was served — known NOW,
  // so the warning is printed ABOVE the AC(1) line instead of ~35 s later from ClickHouse, and AC(1)
  // can print UNMEASURED rather than FAIL. The final grade is gradeRun()'s, over the same facts.
  const holdoutByResponse = holdoutFromResponses(allResponses);
  if (holdoutByResponse.drewHoldout === true) {
    printHoldoutWarning(
      allResponses[0]?.session_id ?? null,
      `all ${String(holdoutByResponse.total)} /api/adapt bodies carry holdout_group: true`,
    );
  } else if (holdoutByResponse.drewHoldout === null && holdoutByResponse.total > 0) {
    console.log(
      `\n[FOLLOW-1240] ⚠ MIXED holdout_group across this session's bodies ` +
        `(${String(holdoutByResponse.holdoutBodies)} of ${String(holdoutByResponse.total)}): the ` +
        'one-group-per-session invariant broke. Nothing is reclassified on this evidence.',
    );
  }
  // FOLLOW-1186: the verdict is evaluateAc1()'s, over the same population AC(7) reads below.
  const ac1 = evaluateAc1(allResponses, serverGate);
  const recordTimeFacts = {
    adaptedArmDrewHoldout: holdoutByResponse.drewHoldout,
    adaptedResponsesArrivedAfterVerdict: 0,
  };
  record(
    'AC(1)',
    `LLM-adapted /adapt response on the real control plane — counted: ${ac1.summary}` +
      (postQuizSettle.timedOut || postQuizSettle.endedBy === 'quiz-response-holdout'
        ? ` — ⚠ ${postQuizSettle.cause}`
        : ''),
    ac1.ok,
    {
      ...ac1.evidence,
      // FOLLOW-1239/1240: WHEN this population was snapshotted and ON WHAT, next to WHAT it
      // contains. `quizRequest`/`quizResponse` name the quiz turn's own call; a red whose `endedBy`
      // is `budget` says in `cause` whether that call was never made, never answered, or answered
      // nothing at all after the click.
      POST_QUIZ_SETTLE: postQuizSettle,
      REACHABILITY_FINDING: {
        behavioralSignalsAlone: armA,
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
          ...armB,
        },
        // FOLLOW-1075 (RETRO-301 §4b BUG-1): an arm that never RAN (`quizWidgetFound: false`)
        // must not be reported as having cleared OR failed the gate — it is UNMEASURED, and
        // collapsing "unmeasured" into "failed" is a false red on the arm most likely to
        // succeed (FOLLOW-1359: a quiz leaf folds at 0.72 when completed and 0.90 once the buyer
        // confirms it, which this loop does; both clear the > 0.6 gate. The request carries
        // similarity min(posterior, 0.85), ESC-087, so it stays on the LLM branch).
        verdict: armA.clearedGate
          ? 'behavior ALONE cleared the server gate'
          : armB.clearedGate
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
    ac1.ok ? null : unmeasuredBecause({ ac: 'AC(1)' }, recordTimeFacts),
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
      // FOLLOW-1196 (reporting only, not the verdict): a withheld batch still paints the template
      // `cta`, so a green AC(2) is not adaptation. This names which changed slots an ADAPTED
      // response painted — see attributePaintedSlots() for the attribution rule.
      paintedSlotAttribution: attributePaintedSlots(
        changed.map((c) => c.slot),
        allResponses,
        serverGate,
      ),
    },
    changed.length > 0 ? null : unmeasuredBecause({ ac: 'AC(2)' }, recordTimeFacts),
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
  // FOLLOW-1367: the quiz card (616 px on this 900 px viewport) can still be open over the CTA —
  // the AC(1) loop's confirm click is best-effort, and a late-config card opens after its wait.
  // It is closed deterministically first, never clicked through with `force: true`.
  const quizOverlayBeforeCta = ctaButtonFound ? await closeQuizCardBeforeCta(page) : null;
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
  }
  // FOLLOW-1252: poll for the row instead of reading once at a fixed offset. The budget is the
  // SDK's own retry schedule plus slack (deriveAc5PollBudget() docblock), so a batch ingest refused
  // and the SDK re-sent (§5.16 runs 3 and 6, 7.9 s and 8.15 s) is counted, while a conversion the
  // SDK itself gave up on stays RED. Green runs return as soon as the row is seen.
  const clickAt = Date.now();
  let ac5Poll = { skipped: adaptedCtaClicked ? 'no_session_id' : 'cta_not_clicked' };
  if (adaptedCtaClicked && sessionId) {
    const budget = await readAc5PollBudget();
    const poll = await pollThisRunConversion({
      countConversions: () => countThisRunConversions(sessionId),
      budgetMs: budget.budgetMs,
      clickAt,
    });
    ac5Poll = { ...poll, budget };
    console.log(
      `[FOLLOW-1252] cta.clicked ${poll.landed ? `seen after ${String(poll.landedAtMs)} ms` : 'NOT seen'} ` +
        `(${String(poll.attempts)} reads, budget ${String(budget.budgetMs)} ms)`,
    );
  }

  // ── FOLLOW-1203: the SERVER-CONFIRMED conversion (CEO decision #4; ESC-084 ruling 3) ────
  // The click above is a funnel stage. The conversion is what the host backend confirms: here the
  // fixture server on `:8081`, which signs an `inquiry.completed` for THIS session and sends it to
  // the real ingest Worker. It is asked only once the click's own row has landed — the buyer
  // clicked, then the backend confirmed — so a run whose click emitted nothing (the §5.5 negative
  // control) never gets a conversion and AC(5) stays RED on it, as before.
  let confirmedConversion = {
    requested: false,
    skipped:
      ac5Poll.landed === true
        ? 'no_session_id'
        : `cta_clicked_row_not_seen(${String(ac5Poll.skipped ?? 'poll_budget_spent')})`,
  };
  if (ac5Poll.landed === true && sessionId) {
    confirmedConversion = REDFIRST_UNSIGNED_CONVERSION
      ? await emitUnsignedBrowserConversion(sessionId)
      : await requestConfirmedConversion(sessionId, await readFixtureListingId());
    // The emitter answers after ingest's 2xx; the row is written post-ACK (26 ms measured, §5.16).
    const landing = await pollThisRunConversion({
      countConversions: async () => {
        const c = await countThisRunConfirmedConversions(sessionId);
        if (c === null) return null;
        return REDFIRST_UNSIGNED_CONVERSION ? c.unsigned : c.signed;
      },
      budgetMs: 2 * INGEST_TO_CLICKHOUSE_SLACK_MS,
      clickAt: confirmedConversion.requestedAt,
    });
    confirmedConversion.rowPoll = landing;
    console.log(
      `[FOLLOW-1203] ${confirmedConversion.mode} conversion: emitter ${String(confirmedConversion.status)}, ` +
        `row ${landing.landed ? `seen after ${String(landing.landedAtMs)} ms` : 'NOT seen'}`,
    );
  } else {
    console.log(`[FOLLOW-1203] no conversion requested: ${confirmedConversion.skipped}`);
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
  //
  // FOLLOW-1286 (CEO ruling D3, ESC-077 amendment): the bandit is FROZEN unless the control plane
  // runs with BANDIT_ENABLED=true. Hop 12 then does not exist by ruling, and the route answers
  // 404 `error.details.reason = 'bandit_disabled'`. In that state AC(4) asserts the FREEZE
  // instead of a delta, and every conjunct is read from the real substrate, not inferred from the
  // status code alone: (a) the ping is refused with exactly that 404 + reason; (b) the arm did NOT
  // move (polled the way the live branch polls for a move); (c) every /adapt response this run
  // served `variant: 'control'`; (d) every adaptation_decisions row this session logged has
  // variant = 'control'. Anything else — a 202, a 503, a moved arm, a v1/v2 anywhere — is RED.
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
      let resBody = null;
      try {
        resBody = await res.json();
      } catch {
        resBody = null;
      }
      const banditFrozen =
        res.status === 404 && resBody?.error?.details?.reason === 'bandit_disabled';

      // Poll — the write is fire-and-forget behind after(); a 202 alone proves nothing. On the
      // frozen branch the same poll is the evidence that NOTHING moved.
      let afterArm = null;
      let polls = 0;
      for (; polls < (banditFrozen ? 6 : 20); polls++) {
        await sleep(500);
        afterArm = await readBanditArm(DATABASE_URL_ADMIN, OPS_TENANT_ID, archetype, variant);
        if (JSON.stringify(afterArm) !== JSON.stringify(before)) break;
      }
      const armMoved = JSON.stringify(afterArm) !== JSON.stringify(before);

      if (banditFrozen) {
        const loggedRows = await chQuery(
          `SELECT variant, count() AS n FROM adaptation_decisions
           WHERE session_id = '${String(sessionId ?? '').replace(/'/g, '')}'
           GROUP BY variant`,
        );
        const loggedVariants = loggedRows.map((r) => String(r.variant));
        // FOLLOW-1300: the verdict is evaluateAc4Frozen()'s; the holdout draw is the bodies' (same
        // detection as AC(1)), so a held-out session is UNMEASURED rather than RED.
        const ac4 = evaluateAc4Frozen({
          httpStatus: res.status,
          reason: resBody?.error?.details?.reason ?? null,
          armMoved,
          servedBodies: allResponses,
          loggedVariants,
          drewHoldout: holdoutByResponse.drewHoldout,
        });
        const servedVariants = ac4.servedVariants;
        record(
          'AC(4)',
          'bandit frozen (D3, FOLLOW-1286): feedback refused as bandit_disabled, no ' +
            'ab_bandit_weights row moved, every served and logged variant is control',
          ac4.ok,
          {
            mode: 'bandit_frozen',
            httpStatus: res.status,
            reason: resBody?.error?.details?.reason ?? null,
            archetype,
            variant,
            creditedResponse: profileSelectionEvidence,
            before,
            after: afterArm,
            armMoved,
            polls,
            servedVariants,
            loggedVariants: loggedRows,
            drewHoldout: holdoutByResponse.drewHoldout,
          },
          ac4.ok ? null : ac4.unmeasured,
        );
      } else {
        record(
          'AC(4)',
          'feedback ping moved a real ab_bandit_weights row (Beta delta observed, not just a 202)',
          res.status === 202 && armMoved,
          {
            mode: 'bandit_live',
            httpStatus: res.status,
            archetype,
            variant,
            // FOLLOW-1196: which response this arm was taken from, and by which rule.
            creditedResponse: profileSelectionEvidence,
            before,
            after: afterArm,
            polls,
          },
        );
      }
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
  // FOLLOW-1240: the warning is printed above AC(1) when the bodies already said so. ClickHouse
  // only repeats it when they did not (no bodies, or mixed), and says it is late.
  if (adaptedArmDrewHoldout === true && holdoutByResponse.drewHoldout !== true) {
    printHoldoutWarning(
      sessionId,
      'ClickHouse adaptation_decisions; LATE — not visible in the bodies',
    );
  } else if (adaptedArmDrewHoldout === false && holdoutByResponse.drewHoldout === true) {
    console.log(
      `\n[FOLLOW-1240] ⚠ CONTRADICTION: the bodies said holdout, ClickHouse says the session ` +
        `(${String(sessionId)}) was NOT held out. The run is graded on the bodies' evidence.`,
    );
  } else if (adaptedArmDrewHoldout === null) {
    console.log(
      `\n[FOLLOW-1125] ⚠ ADAPTED-ARM ASSIGNMENT INDETERMINATE (${String(adaptedArmHoldout.reason)}). ` +
        `This is NOT "the arm was adapted" — it is "the harness could not tell". AC(5) records it ` +
        `as an explicit indeterminate rather than letting it read as false.`,
    );
  }

  // FOLLOW-1240: the draw the tally grades on. Either source saying `true` is enough — the bodies
  // are what the arm was actually served, ClickHouse is what the route logged; `null` only when
  // neither can say.
  const runDrewHoldout =
    holdoutByResponse.drewHoldout === true || adaptedArmDrewHoldout === true
      ? true
      : (holdoutByResponse.drewHoldout ?? adaptedArmDrewHoldout);

  // FOLLOW-1124: the run-scoped answer to the question AC(5) actually means. Taken BEFORE
  // driveHoldoutArm() mints the synthetic control session — not because that session could be
  // confused with this one (it could not), but so the ordering of the two reads is fixed and a
  // future reader does not have to reason about it.
  const thisRunAdaptedArm = await measureThisRunAdaptedArm(sessionId);
  // FOLLOW-1252: what ingest did with the batches that carried this run's cta.clicked, and how
  // many ingest POSTs the run saw refused, so a grader can see when the SDK's re-send was needed.
  const ctaIngest = summarizeCtaIngest({
    ingestPosts,
    emitted,
    ingestOrigin: INGEST_ORIGIN,
    sessionId: sessionId ?? '',
  });

  console.log('\n[FOLLOW-1075] driving a real holdout-arm session…');
  // FOLLOW-1131: hand the control call the adapted arm's profile — see driveHoldoutArm()'s
  // docblock. FOLLOW-1196: `best` is AC(1)'s first adapted response when one exists, and
  // toControlProfile() is the same derivation evaluateAc7() checks the mirrored profile against.
  const controlProfile = toControlProfile(best);
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
  // Both directions are asserted, because either alone is satisfiable by a broken system. A control
  // arm with no directives is what a TOTALLY dead adapt path also looks like, and an adapted arm
  // that merely "received directives" is what a dead LLM path looks like, because the POST handler
  // appends a `reorder` to every non-holdout response whose batch is all-cosine (FOLLOW-1202).
  // FOLLOW-1196 binds the adapted half to AC(1)'s
  // own predicate — see evaluateAc7().
  const ac7 = evaluateAc7({
    control: holdoutArmDiag,
    controlHoldoutPct: CONTROL_ARM_HOLDOUT_PCT,
    adaptedResponses: allResponses,
    adaptedSessionId: sessionId,
    serverGate,
  });
  record('AC(7)', ac7.name, ac7.ok, {
    ...ac7.evidence,
    profileSelection: profileSelectionEvidence,
  });

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
    // FOLLOW-1203: read off the rollup itself (`rollup.conversions`) — see readRollupConversionCounts().
    const conversionCounts = readRollupConversionCounts(body);
    const conversionSource = body?.conversion_source ?? null;
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
    // FOLLOW-1252: the conjunct lives in evaluateThisRunConversion() so its loss rows are tested.
    // A missing conversion names WHERE it was lost — the SDK never sent it, ingest never said
    // 2xx, or ingest said 2xx and no row landed — read off this run's own ingest records.
    // FOLLOW-1203: `thisRunAdaptedArm.conversions` is the session's SERVER-CONFIRMED conversions.
    // A missing one is lost either at the click (the hop before it: the three kinds above) or after
    // it (classifyConfirmedConversionLoss(): not requested, the emitter failed, the row never
    // landed, it predates the first decision, or only an UNSIGNED one exists).
    const conversionLoss =
      thisRunAdaptedArm.conversions !== 0
        ? null
        : ac5Poll.landed === false
          ? classifyConversionLoss({ ctaIngest, budgetMs: ac5Poll.budgetMs })
          : classifyConfirmedConversionLoss({
              request: confirmedConversion,
              thisRun: thisRunAdaptedArm,
            });
    const thisRunConversion = evaluateThisRunConversion(thisRunAdaptedArm, conversionLoss);
    const adaptedArmConverted = thisRunConversion.converted;
    // FOLLOW-1203: the lift must have been computed from the caller class. A rollup that answers
    // `conversion_source: 'disabled'` has no numerator (its `ctaLift` is null by construction).
    const signedSource = conversionSource === 'signed_events';
    const ok =
      res.ok &&
      live &&
      signedSource &&
      lift !== null &&
      adaptedArmConverted &&
      !REDFIRST_UNSIGNED_CONVERSION;

    const unmetPreconditions = [];
    if (!res.ok) unmetPreconditions.push(`http_status=${String(res.status)}`);
    if (res.ok && !live) unmetPreconditions.push(`data_source=${String(body?.data_source)}`);
    if (res.ok && live && !signedSource) {
      unmetPreconditions.push(`conversion_source=${String(conversionSource)}`);
    }
    if (REDFIRST_UNSIGNED_CONVERSION) unmetPreconditions.push('redFirstUnsignedConversion=engaged');
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
    unmetPreconditions.push(...thisRunConversion.unmet);
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
      "the existing analytics path computed a lift from real localhost-substrate rows (data_source='clickhouse', NOT the seededRandom mock; conversion_source='signed_events') AND THIS RUN's adapted session has a SERVER-CONFIRMED conversion: its real cta.clicked landed, then the fixture host backend's SIGNED inquiry.completed was received at or after the session's first decision (FOLLOW-1203; FOLLOW-1124 — scoped to this session_id, not to the 7-day pool) — NOT an assertion that the lift is positive or directional",
      ok,
      {
        httpStatus: res.status,
        data_source: body?.data_source ?? null,
        // FOLLOW-1203: 'signed_events' or the lift was not computed from the caller class.
        conversion_source: conversionSource,
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
          // FOLLOW-1367: whether a quiz card was open over the page before the click, and how it
          // was closed (`waited` for its own unmount, or `closed_with_x`).
          quizOverlayBeforeCta,
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
          // ── FOLLOW-1252: how long the read waited, and what ingest did with the batch ──────
          // `ac5Poll.budget` shows the SDK constants the budget came from. `ctaIngest.resent`
          // with `ctaBatchAccepted` true is a conversion delivered by the SDK's re-send.
          // `conversionLoss` is set only when the row never landed, and says where it was lost.
          ac5Poll,
          ctaIngest,
          // ── FOLLOW-1203: the conversion itself ─────────────────────────────────────────────
          // What was asked of the host backend, what it answered, and when the signed row was
          // seen. `mode` is `signed_by_fixture_host_backend` on every graded run;
          // `redfirst_unsigned_browser` only under the red-first knob, where AC(5) cannot pass.
          confirmedConversion,
          conversionLoss,
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
            'POST /api/adapt with holdout_pct: 1 and then converts it: a cta.clicked (funnel ' +
            'stage) and a signed inquiry.completed from the fixture host backend (the conversion, ' +
            'FOLLOW-1203). It is a real session through real production code, but it is not a ' +
            'sampled visitor.',
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
          'sessions in BOTH arms plus at least one holdout server-confirmed conversion ' +
          '(FOLLOW-1203: a signed inquiry.completed / live.signup after the first decision; a ' +
          'cta.clicked or an unsigned conversion is reported in conversionCounts and never ' +
          'counted). FOLLOW-1098: ' +
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

  // ── AC(8) — FOLLOW-1299, FOLLOW-820 condition 1b: the chat arm ─────────────────────────
  // Its own browser context and session (see the section header above evaluateAc8()), run after the
  // quiz session's ACs so its `/api/adapt` responses cannot enter AC(1)'s population or the
  // `adaptedResponsesArrivedAfterVerdict` window. A throw inside the arm is AC(8) RED, not an abort.
  console.log('\n[FOLLOW-1299] driving the chat arm in a fresh session…');
  let chatArm = null;
  try {
    chatArm = await driveChatArm(browser);
  } catch (err) {
    chatArm = { error: String(err && err.stack ? err.stack : err) };
  }
  if (chatArm.error) {
    record('AC(8)', 'chat arm (FOLLOW-820 condition 1b)', false, {
      error: chatArm.error,
      unmetPreconditions: ['chatArmThrew'],
    });
  } else {
    const ac8 = evaluateAc8(chatArm, serverGate);
    for (const h of ac8.evidence.hops ?? []) {
      console.log(
        `[chat-arm] hop ${String(h.hop)} ${h.name}: ${h.ok ? 'ok' : 'BROKEN'} — ${h.detail}`,
      );
    }
    // FOLLOW-1302: the record each run must carry — both extractions, what changed, and the
    // confidence the SDK's own fold reached at each step (sessionStorage, read-only).
    const dimsOf = (r) => JSON.stringify(r?.intent_dimensions ?? null);
    console.log(
      `[chat-arm] extraction 1: ${dimsOf(chatArm.positive?.record)}\n` +
        `[chat-arm] extraction 2: ${dimsOf(chatArm.second?.record)}\n` +
        `[chat-arm] changed: ${JSON.stringify(ac8.evidence.secondExtractionChanged ?? null)}\n` +
        `[chat-arm] sdk intent: ${JSON.stringify(chatArm.sdkIntent ?? null)}\n` +
        `[chat-arm] navigations after baseline: ${String(chatArm.navigationsAfterBaseline)}`,
    );
    if (ac8.evidence.negativeControl) {
      const nc = ac8.evidence.negativeControl;
      console.log(
        `[chat-arm] negative control: ${nc.ok ? 'ok' : 'FAILED'} — baseline ` +
          `${String(nc.baselineArchetype)}, after the neutral message ` +
          `${JSON.stringify(nc.archetypesAfter)}` +
          (nc.notProvenBecause ? ` — NOT PROVEN: ${nc.notProvenBecause}` : ''),
      );
    }
    if (chatArm.drewHoldout === true) {
      console.log(
        `\n[FOLLOW-1299] ⚠ THE CHAT SESSION DREW HOLDOUT (${String(chatArm.sessionId)}): the ` +
          'holdout branch serves no chat intent by design. AC(8) is UNMEASURED for this run — NOT ' +
          'failed. Re-run.',
      );
    }
    record(
      'AC(8)',
      `${ac8.name} — ${ac8.summary}`,
      ac8.ok,
      ac8.evidence,
      ac8.ok
        ? null
        : unmeasuredBecause(
            { ac: 'AC(8)', evidence: ac8.evidence },
            { chatArmDrewHoldout: chatArm.drewHoldout },
          ),
    );
  }

  // ── AC(10) — FOLLOW-1361, the quiz confirmation path (Faza Q, checkpoint KQ1) ─────────────
  // Three fresh contexts after the chat arm, for the same reason the chat arm has its own: none of
  // their `/api/adapt` responses may enter AC(1)'s population. A throw is AC(10) RED, not an abort.
  console.log('\n[FOLLOW-1361] driving the quiz confirmation path (confirm, correct, ×)…');
  let ac10Obs = null;
  try {
    ac10Obs = await driveAc10(browser);
  } catch (err) {
    ac10Obs = { error: String(err && err.stack ? err.stack : err) };
  }
  if (ac10Obs.error) {
    record('AC(10)', 'quiz confirmation path (FOLLOW-1361)', false, {
      error: ac10Obs.error,
      unmetPreconditions: ['ac10Threw'],
    });
  } else {
    const ac10 = evaluateAc10(ac10Obs, serverGate);
    for (const [kind, sub] of Object.entries(ac10Obs.sessions)) {
      console.log(
        `[quiz-confirm] ${kind}: session ${String(sub.sessionId ?? null)} (draws ` +
          `${JSON.stringify(sub.draws ?? null)}), leaf ${String(sub.leaf ?? null)}` +
          (kind === 'correct'
            ? ` → ${String(sub.chosen ?? null)} of ${JSON.stringify(sub.offered ?? null)}`
            : '') +
          `, row ${JSON.stringify(sub.row ? { status: sub.row.status, hash: sub.row.definition_hash } : null)}` +
          `, state at fold ${JSON.stringify(sub.stateAtFold ?? null)}` +
          `, follow-up ${JSON.stringify(sub.followUp?.request ?? sub.followUp?.reason ?? null)} → ` +
          `${String(sub.followUp?.body?.source ?? null)} ${String(sub.followUp?.body?.archetype ?? null)}`,
      );
    }
    record(
      'AC(10)',
      `${ac10.name} — ${ac10.summary}`,
      ac10.ok,
      ac10.evidence,
      ac10.ok ? null : unmeasuredBecause({ ac: 'AC(10)', evidence: ac10.evidence }, {}),
    );
  }

  // FOLLOW-1361: a graded AC this run never recorded is RED, never a smaller total.
  for (const ac of missingGradedAcs(results)) {
    record(ac, `${ac} was not evaluated by this run`, false, {
      unmetPreconditions: ['notEvaluated'],
      gradedAcs: GRADED_ACS,
    });
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

  // FOLLOW-1240: the run's grade — gradeRun() consumes the holdout draw and
  // `adaptedResponsesArrivedAfterVerdict`, so a FOLLOW-820 grader reading `grade` / the TALLY line
  // gets UNMEASURED where the adapted axis was not measured, never a bare FAIL.
  const adaptedResponsesArrivedAfterVerdict = decided
    .slice(gradedDecidedCount)
    .filter((d) => d.body && isAdaptedResponse(d.body, serverGate)).length;
  const gradeFacts = {
    adaptedArmDrewHoldout: runDrewHoldout,
    adaptedResponsesArrivedAfterVerdict,
    // FOLLOW-1299: the chat arm's own session's draw; consumed only by AC(8).
    chatArmDrewHoldout: chatArm.drewHoldout ?? null,
  };
  const grade = gradeRun(results, gradeFacts);

  const summary = {
    ranAt: new Date().toISOString(),
    // FOLLOW-1200: so a stale artefact can be told apart from a fresh one — see
    // `evaluateArtefactStaleness()` / `checkArtefactStaleness()` below.
    startedAt,
    harnessSha,
    // FOLLOW-1205: the tree-state axis of `evaluateArtefactStaleness()`.
    harnessTree,
    listingUrl: LISTING_URL,
    ingestOrigin: INGEST_ORIGIN,
    decisionOrigin: DECISION_ORIGIN,
    // FOLLOW-1225: the grounding input, named on the artefact next to the decision endpoint.
    groundingSource,
    serverGate,
    sessionId,
    tenantId,
    // FOLLOW-1098: a run-level validity flag, deliberately ABOVE `results`. When true, the
    // adapted arm drew holdout and the AC tally below understates the differentiator by
    // construction — the run is UNMEASURED on that axis, not a failure of it.
    adaptedArmDrewHoldout,
    // FOLLOW-1240: the same draw read off the served bodies at settle time (`holdoutFromResponses()`),
    // and the grade both feed. `grade.runVerdict` is GREEN / RED / UNMEASURED; `results[].verdict`
    // is each AC's grade and `results[].ok` stays the raw predicate outcome.
    adaptedArmDrewHoldoutByResponse: holdoutByResponse,
    grade: {
      runVerdict: grade.runVerdict,
      tally: grade.tally,
      tallyLine: grade.tallyLine,
      summaryLine: grade.summaryLine,
      facts: gradeFacts,
    },
    // FOLLOW-1239: READ THESE BEFORE GRADING A RED AC(1) OR AC(2). `postQuizSettle` says what ended
    // the observation window. `gradedResponseCount` is `decided.length` at the moment of the
    // verdict; `responsesArrivedAfterVerdict` is how many bodies landed after it. A non-zero count
    // is NORMAL — the session keeps calling `/api/adapt` after the verdict (the CTA click on the
    // 19:14Z run drew a third, `playbook`, response). The number that matters is the next one:
    // `adaptedResponsesArrivedAfterVerdict` > 0 next to a RED AC(1) IS the 18:32Z false RED
    // (README §5.11), because it means a response that PASSES AC(1)'s own predicate is sitting in
    // the file the verdict was taken from.
    postQuizSettle,
    gradedResponseCount: gradedDecidedCount,
    responsesArrivedAfterVerdict: decided.length - gradedDecidedCount,
    adaptedResponsesArrivedAfterVerdict,
    results: grade.results,
    decided,
    // FOLLOW-1240: every browser `/api/adapt` request, numbered; `decided[].requestSeq` points here,
    // and `postQuizSettle.quizRequest.seq` names the quiz turn's.
    adaptRequests,
    emitted,
    // FOLLOW-1252: every ingest POST with its status or network failure, and AC(5)'s poll.
    ingestPosts,
    ac5Poll,
    // FOLLOW-1203: the server-confirmed conversion request and its row poll.
    confirmedConversion,
    // FOLLOW-1299: everything the chat arm observed — its own session's `/api/adapt` calls
    // (`calls[]`, request hint next to response archetype), its ingest POSTs, both shadow records.
    chatArm,
    // FOLLOW-1361: the served quiz config AC(10) read its names and hash from (its sub-sessions
    // are in AC(10)'s evidence), and the list of ACs a full run grades (`TALLY total` = its length).
    ac10ServedConfig: ac10Obs?.servedConfig ?? null,
    gradedAcs: GRADED_ACS,
    // Every response the page saw. Consumed when triage needs to answer "did ingest ACK at
    // all, and with what status" — FOLLOW-876's finding was that the previous artifact
    // recorded requests only and so could not answer the question its verdict turned on.
    network: net,
    consoleLines: consoleLines.slice(-80),
  };
  await writeFile(SESSION_JSON, JSON.stringify(summary, null, 2));

  await browser.close();

  // FOLLOW-1239: the 18:32Z run printed nothing about this and the disagreement between the verdict
  // and the file went unnoticed for a session. It cannot go unnoticed silently again.
  if (summary.adaptedResponsesArrivedAfterVerdict > 0) {
    console.log(
      `\n[FOLLOW-1239] ⚠ ${String(summary.adaptedResponsesArrivedAfterVerdict)} response(s) ` +
        "passing AC(1)'s predicate arrived AFTER the verdict was taken. If AC(1) or AC(2) reads " +
        "RED below, that red is this harness's observation window, not the product — the settle " +
        `ended on ${postQuizSettle.endedBy} (${postQuizSettle.cause}).`,
    );
  }

  // FOLLOW-1240: a verdict that changed after its line was printed is announced, never silent.
  for (const g of grade.results) {
    const printed = printedVerdicts.get(g.ac);
    if (printed !== undefined && printed !== g.verdict) {
      console.log(
        `[RECLASSIFIED] ${g.ac}: ${printed} → ${g.verdict}` +
          (g.unmeasuredBecause ? ` (${g.unmeasuredBecause})` : ''),
      );
    }
  }

  // FOLLOW-1240: the machine line first (format in README §3.6), then the human one. The legacy
  // `N/M acceptance criteria green` line is printed ONLY when nothing is UNMEASURED.
  console.log(`\n${grade.tallyLine}`);
  console.log(grade.summaryLine);
  const red = grade.results.filter((r) => r.verdict === 'FAIL');
  const unmeasured = grade.results.filter((r) => r.verdict === 'UNMEASURED');
  if (red.length > 0) console.log(`RED: ${red.map((f) => f.ac).join(', ')}`);
  if (unmeasured.length > 0) {
    console.log(
      `UNMEASURED: ${unmeasured.map((f) => `${f.ac}[${String(f.unmeasuredBecause)}]`).join(', ')}`,
    );
  }
  if (red.length > 0) {
    console.log(
      '\nA RED result here is a legitimate outcome for FOLLOW-819 (see the header). Report the ' +
        'true number; do not tune the fixture until it passes.',
    );
  }
  // An UNMEASURED run is not a pass either: it exits non-zero like a red one.
  if (grade.runVerdict !== 'GREEN') process.exitCode = 1;
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
    // FOLLOW-1196: `--allow-stale` may appear before or after the optional path.
    const args = process.argv.slice(3);
    const ok = await checkArtefactStaleness(args.find((a) => !a.startsWith('--')) ?? SESSION_JSON, {
      allowStale: args.includes('--allow-stale'),
    });
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
            harnessTree,
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
