#!/usr/bin/env node
/**
 * FOLLOW-1344 — instrument N3: one buyer on the REAL Estalara app, real control plane, real clicks.
 *
 * Plan: docs/PLAN-LOCALHOST-COMPLETION-2026-10-17.md "Nowe instrumenty", K4b, K5. Runbook:
 * docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md §5.1 (preconditions, run command, how each hop fails).
 *
 * The principle is `local-pilot-session.mjs`'s: no degrade to skipped. A hop that cannot run is RED
 * or an explicit `UNMEASURED:<why>` with a reason, never green; a hop nobody recorded is RED
 * (`evaluateN3Run()`). Exit 0 only on `GREEN` or `GREEN_K4B`, and `GREEN_K4B` names the hops it did
 * not measure. Every wait is bounded and a watchdog ends the run: `al-real-up.sh` once hung 14 h.
 *
 * Reused, not copied, from the FOLLOW-819 harness (imported with its import-only flag): the control
 * plane and grounding probes, the served-quiz check, `quizPathToLeaf()`, the fold picker, the holdout
 * reader, `observeDescriptionCalls()`. The click walk is a small copy of `resolveAc9Quiz()`, which is
 * not exported: exporting it would edit a file in `HARNESS_TREE_PATHSPEC` and stale every artefact.
 *
 * Usage: `SESSION_JSON=<path> node scripts/dev/real-app-acceptance.mjs` (exit 0 pass, 1 not a pass,
 * 2 usage). `--arms N` and the two conversion paths are K5: not implemented, exit 2.
 *
 * @module scripts/dev/real-app-acceptance
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DEFAULT_LISTING_URL = 'http://localhost:5173/en/listing/9-blackberry-pl-palm-coast-fl-32137';
const LISTING_URL = process.env.LISTING_URL ?? DEFAULT_LISTING_URL;
const DECISION_ORIGIN = process.env.DECISION_ORIGIN ?? 'http://localhost:3000';
const INGEST_ORIGIN = process.env.INGEST_ORIGIN ?? 'http://localhost:8787';
const GROUNDING_ORIGIN = process.env.ESTALARA_BACKEND_URL ?? 'http://localhost:8081';
const ESTALARA_ROOT =
  process.env.ESTALARA_ROOT ?? nodePath.join(homedir(), 'Projects/Estalara-gitlab-2026-08-17');
const SESSION_JSON =
  process.env.SESSION_JSON ?? nodePath.join(tmpdir(), 'n3-real-app-acceptance.json');
const HEADLESS = process.env.HEADLESS !== 'false';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
/** The subtrees the Estalara tree hash covers (that repo has no git). `.env` stays out: it has keys. */
const ESTALARA_HASHED_DIRS = Object.freeze(['web-master/src', 'core-master/src']);
/** What an X1 emitter would have to contain; none of it is in the app today. */
const EMITTER_MARKERS = Object.freeze(['inquiry.completed', 'live.signup', '/v1/events']);

const TARGET_LEAF = 'yield_hunter';
/** A trait the served `t_invest` screen offers and the store may keep (AC(9)'s persistable tick). */
const TARGET_TICKS = Object.freeze(['seasoned_investor']);
const MAX_DRAWS = 3;

const PAGE_MS = 120000; // first SSR compile of the listing route is slow (al-real-up.sh step 5)
const QUIZ_MOUNT_MS = 60000; // 15 s config budget plus a swapping box
const DWELL_MS = Number(process.env.N3_DWELL_MS ?? 30000); // the plan's "~30 s" of browsing
const ADAPT_MS = 120000; // an LLM decision on a cold plane
const SLOT_PAINT_MS = 20000;
const INGEST_ACK_MS = 60000; // 22-25 s OPTIONS were measured on this box (2026-10-16)
const PROFILE_SETTLE_MS = 15000; // the profile is written in after(), past the response
// Each GET on a miss starts one more generation (`after()` has no dedupe), so the poll is sparse.
// In-process generation can take ~95 s (FOLLOW-819 README §6.13); 180 s / 40 s = at most 4 GETs.
const DESCRIPTION_BUDGET_MS = Number(process.env.N3_DESCRIPTION_BUDGET_MS ?? 180000);
const DESCRIPTION_POLL_MS = 40000;
const DEADLINE_MS = Number(process.env.N3_DEADLINE_MS ?? 25 * 60 * 1000);
const CONFIG_INIT_BUDGET_MS = 1000; // past this the SDK's first decision carries no xid, by design

// ─── The verdict: pure, pinned by tests/e2e/follow-819/real-app-acceptance-verdict.test.ts ─────

/** Every hop a run must record. Absent = RED. */
export const N3_HOPS = Object.freeze([
  'repo_identity',
  'substrate',
  'sdk_loaded',
  'consent_click',
  'quiz_yield_hunter',
  'adapt_llm_tweaked',
  'headline_dom_changed',
  'description_answered',
  'description_ai_cached',
  'description_dom_changed',
  'no_debug_attribute',
  'ingest_ack',
  'restored_first_adapt',
  'inquiry_signed_rollup',
]);

/** The only hops `UNMEASURED:phase5` may excuse (emitters are X1, Phase 5). */
export const N3_PHASE5_HOPS = Object.freeze(['inquiry_signed_rollup']);

/**
 * The run's verdict over its recorded hops.
 *
 * @param {ReadonlyArray<{hop: string, status: unknown, reason?: unknown}>} results
 * @returns {{verdict: 'GREEN'|'GREEN_K4B'|'UNMEASURED'|'RED', exitCode: 0|1, red: string[],
 *   unmeasured: string[], excused: string[]}}
 */
export function evaluateN3Run(results) {
  const rows = Array.isArray(results) ? results : [];
  const red = [];
  const unmeasured = [];
  const excused = [];
  for (const row of rows) {
    if (!N3_HOPS.includes(row?.hop)) red.push(`${String(row?.hop)}:unknown_hop`);
  }
  for (const hop of N3_HOPS) {
    const mine = rows.filter((r) => r?.hop === hop);
    if (mine.length === 0) red.push(`${hop}:not_recorded`);
    else if (mine.length > 1) red.push(`${hop}:recorded_twice`);
    else {
      const { status, reason } = mine[0];
      const hasReason = typeof reason === 'string' && reason.trim() !== '';
      if (status === 'GREEN') continue;
      if (status === 'RED') red.push(hop);
      else if (typeof status !== 'string' || !/^UNMEASURED:[a-z0-9_]+$/.test(status)) {
        red.push(`${hop}:bad_status(${String(status)})`);
      } else if (!hasReason) red.push(`${hop}:unmeasured_without_reason`);
      else if (status === 'UNMEASURED:phase5' && N3_PHASE5_HOPS.includes(hop)) excused.push(hop);
      else unmeasured.push(`${hop}(${status})`);
    }
  }
  const verdict =
    red.length > 0
      ? 'RED'
      : unmeasured.length > 0
        ? 'UNMEASURED'
        : excused.length > 0
          ? 'GREEN_K4B'
          : 'GREEN';
  return {
    verdict,
    exitCode: verdict === 'GREEN' || verdict === 'GREEN_K4B' ? 0 : 1,
    red,
    unmeasured,
    excused,
  };
}

const hop = (id, failures, evidence) => ({
  hop: id,
  status: failures.length === 0 ? 'GREEN' : 'RED',
  ...(failures.length === 0 ? {} : { reason: failures.join('; ') }),
  evidence,
});

const directivesOf = (b) => (Array.isArray(b?.directives) ? b.directives : []);
const servedSlots = (b) => directivesOf(b).filter((d) => d && d.type !== 'reorder');

/**
 * Is this the real app, on the real backend, behind the real control plane? See the runbook §5.1.
 * The fixture cannot pass: its page is no SvelteKit document and carries the fixture's listing id,
 * its `:8081` answers 404 for any other id and stamps `x-estalara-facts-source` on every 200.
 *
 * @param {{listing: {status: number|null, pathIsFixture: boolean, hasSvelteKit: boolean,
 *   listingId: string|null, fixtureListingId: string|null, error?: string|null},
 *   grounding: {ok: boolean, factsSource: string|null, reason: string},
 *   controlPlane: {ok: boolean, reason: string}, quiz: {ok: boolean, reason: string},
 *   walkFound: boolean, build: {ok: boolean, reason: string}}} f
 */
export function gradeSubstrate(f) {
  const out = [];
  const l = f.listing;
  if (l.pathIsFixture) out.push('LISTING_URL is the fixture page');
  if (l.status !== 200) out.push(`listing page HTTP ${String(l.status)} ${l.error ?? ''}`.trim());
  if (!l.hasSvelteKit) out.push('listing page is not a SvelteKit document');
  if (!l.listingId) out.push('listing page has no data-estalara-listing-id (SDK flag off?)');
  if (l.listingId && l.listingId === l.fixtureListingId) out.push('listing id is the fixture id');
  if (!f.grounding.ok) out.push(`grounding: ${f.grounding.reason}`);
  if (f.grounding.factsSource !== null) {
    out.push(`:8081 is the fixture server (facts source ${String(f.grounding.factsSource)})`);
  }
  if (!f.controlPlane.ok) out.push(`control plane: ${f.controlPlane.reason}`);
  if (!f.quiz.ok) out.push(`served quiz: ${f.quiz.reason}`);
  if (!f.walkFound) out.push(`the served tree has no walk to ${TARGET_LEAF}`);
  if (!f.build.ok) out.push(`build: ${f.build.reason}`);
  return hop('substrate', out, f);
}

/**
 * Both repos named, or the run is no evidence.
 *
 * @param {{alSha: string|null, alDirty: boolean|null, alDirtyPaths?: string[]|null,
 *   estalaraTree: {hash: string, files: number}|null}} f
 */
export function gradeRepoIdentity(f) {
  const out = [];
  if (!f.alSha) out.push('AL git SHA unreadable');
  if (f.alDirty !== false) {
    out.push(`AL tree ${f.alDirty === null ? 'unreadable' : 'dirty'}, the SHA names other bytes`);
  }
  if (!f.estalaraTree || f.estalaraTree.files === 0) out.push('Estalara tree hash unreadable');
  return hop('repo_identity', out, f);
}

/** @param {{status?: number|null, failure?: string|null, body?: any}|null} call */
export function gradeFollowUp(call, gate, leaf = TARGET_LEAF) {
  const out = [];
  const b = call?.body ?? null;
  if (!call) out.push('no /api/adapt after the fold');
  else {
    if (call.status !== 200) out.push(`HTTP ${String(call.status)} ${call.failure ?? ''}`.trim());
    if (b?.holdout_group === true) out.push('held out');
    if (b?.source !== 'llm_tweaked') {
      out.push(`source=${String(b?.source)} fallback=${String(b?.fallback_reason ?? null)}`);
    }
    if (b?.archetype !== leaf) out.push(`archetype=${String(b?.archetype)}`);
    const c = b?.confidence;
    const cleared =
      typeof c === 'number' && (gate.comparison === '<=' ? c > gate.value : c >= gate.value);
    if (!cleared) out.push(`confidence ${String(c)} did not clear the gate ${String(gate.value)}`);
    if (servedSlots(b).length === 0) out.push('no directive');
  }
  return hop('adapt_llm_tweaked', out, {
    gate,
    status: call?.status ?? null,
    source: b?.source ?? null,
    archetype: b?.archetype ?? null,
    confidence: b?.confidence ?? null,
    slots: servedSlots(b).map((d) => d.slot ?? d.type),
    fallback_reason: b?.fallback_reason ?? null,
  });
}

const squash = (s) => (typeof s === 'string' ? s.replace(/\s+/g, '') : '');

/**
 * A slot changed, AND into what a response served: a re-render of the host alone must not pass.
 *
 * @param {'headline_dom_changed'|'description_dom_changed'} id
 * @param {{before: string|null, after: string|null, served: ReadonlyArray<string>}} f
 */
export function gradeSlot(id, f) {
  const out = [];
  const after = squash(f.after);
  if (squash(f.before) === '') out.push('no baseline text was read');
  if (after === '') out.push('the slot is empty or gone');
  if (after === squash(f.before)) out.push('the slot did not change');
  else if (!f.served.some((t) => squash(t) && after.includes(squash(t).slice(0, 40)))) {
    out.push('the slot changed, but into no text a response served');
  }
  return hop(id, out, f);
}

/**
 * Two hops, so a cold miss that never warmed reads apart from a broken endpoint.
 *
 * @param {{calls: ReadonlyArray<{status: number|null, source: string|null,
 *   description: string|null, unreadable?: string|null}>,
 *   polls: ReadonlyArray<{status: number|null, source: string|null, description?: string|null}>,
 *   budgetMs: number, reloaded: boolean}} f
 * @returns {{answered: object, cached: object}}
 */
export function gradeDescription(f) {
  const known = (c) => c.source === 'ai_cached' || c.source === 'template_fallback';
  const answeredOk = f.calls.some((c) => c.status === 200 && known(c) && !c.unreadable);
  const isHit = (c) => c.status === 200 && c.source === 'ai_cached' && Boolean(c.description);
  const summary = {
    calls: f.calls.map((c) => ({ status: c.status, source: c.source, unreadable: c.unreadable })),
    polls: f.polls.map((p) => ({ status: p.status, source: p.source })),
    reloaded: f.reloaded,
  };
  const callHit = f.calls.some(isHit);
  const firstHit = f.calls.length > 0 && isHit(f.calls[0]);
  const path = firstHit ? 'first_call' : callHit || f.polls.some(isHit) ? 'after_cold_miss' : null;
  let cachedFailures = [];
  if (path === null) {
    cachedFailures = f.calls.length
      ? [`ai_cached_never_arrived in ${String(f.budgetMs / 1000)} s of polling`]
      : ['the SDK asked for no description, so nothing could arrive'];
  } else if (!callHit) {
    cachedFailures = ['the cache warmed, but the reloaded page was not served it'];
  }
  return {
    answered: hop(
      'description_answered',
      answeredOk ? [] : ['no 200 with a known source from /api/adapt/description'],
      summary,
    ),
    cached: hop('description_ai_cached', cachedFailures, { ...summary, path }),
  };
}

/** @param {{sessionOneXidTag: string|null, call: any, attempts: number, lateConfigMs?: number|null}} f */
export function gradeRestore(f, leaf = TARGET_LEAF) {
  const out = [];
  const c = f.call;
  const b = c?.body ?? null;
  if (!f.sessionOneXidTag) out.push('session 1 left no xid to return with');
  if (!c) out.push('no /api/adapt answered in the new context');
  else {
    if (!c.xidTag) out.push('the first call carried no xid');
    else if (c.xidTag !== f.sessionOneXidTag) out.push('the first call carried another xid');
    if (c.status !== 200) out.push(`HTTP ${String(c.status)} ${c.failure ?? ''}`.trim());
    if (b?.profile_restore !== 'restored') {
      out.push(`profile_restore=${String(b?.profile_restore ?? null)}`);
    }
    if (b?.source !== 'llm_tweaked') out.push(`source=${String(b?.source)}`);
    if (b?.archetype !== leaf) out.push(`archetype=${String(b?.archetype)}`);
    if (servedSlots(b).length === 0) out.push('no directive');
    if (b?.holdout_group === true) out.push('held out');
  }
  return hop('restored_first_adapt', out, {
    attempts: f.attempts,
    lateConfigMs: f.lateConfigMs ?? null,
    xidSent: Boolean(c?.xidTag),
    status: c?.status ?? null,
    profile_restore: b?.profile_restore ?? null,
    source: b?.source ?? null,
    archetype: b?.archetype ?? null,
    slots: servedSlots(b).map((d) => d.slot ?? d.type),
  });
}

/**
 * The inquiry hop reads the app's own source, so the excuse expires by itself: the day X1 lands an
 * emitter, this hop is RED until N3 grows the real measurement.
 *
 * @param {{readable: boolean, emitterFiles: ReadonlyArray<string>, error?: string|null}} f
 */
export function gradeInquiryHop(f) {
  if (!f.readable) {
    return hop('inquiry_signed_rollup', [`Estalara source unreadable: ${String(f.error)}`], f);
  }
  if (f.emitterFiles.length > 0) {
    return hop(
      'inquiry_signed_rollup',
      ['the app now has an emitter, but N3 does not measure it yet: implement the K5 hop'],
      f,
    );
  }
  return {
    hop: 'inquiry_signed_rollup',
    status: 'UNMEASURED:phase5',
    reason:
      'no signed emitter in the real app (X1, Phase 5): core-master and web-master hold no ' +
      `${EMITTER_MARKERS.join(' / ')}, and a browser event is excluded from the lift, so no ` +
      "signed inquiry.completed can reach CH and conversion_source='signed_events' cannot be read",
    evidence: f,
  };
}

/** @param {string[]} argv */
export function parseN3Args(argv) {
  if (argv.includes('--arms')) {
    return { exitCode: 2, message: '--arms N is K5 (FOLLOW-1344): not implemented, nothing ran.' };
  }
  if (argv.length > 0) return { exitCode: 2, message: `unknown arguments: ${argv.join(' ')}` };
  return { exitCode: null, message: null };
}

// ─── The driver: needs the live stack ──────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tagOf = (xid) => (xid ? createHash('sha256').update(xid).digest('hex').slice(0, 12) : null);

async function pollUntil(fn, budgetMs, pollMs = 250) {
  const start = performance.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (performance.now() - start >= budgetMs) return null;
    await sleep(pollMs);
  }
}

/** A stable hash of a tree with no git: sorted relative path + content hash of every file. */
async function hashTree(root, dirs) {
  const hash = createHash('sha256');
  let files = 0;
  for (const dir of dirs) {
    const names = await readdir(nodePath.join(root, dir), { recursive: true, withFileTypes: true });
    const paths = names
      .filter((e) => e.isFile())
      .map((e) => nodePath.relative(root, nodePath.join(e.parentPath ?? e.path, e.name)))
      .sort();
    for (const rel of paths) {
      const content = await readFile(nodePath.join(root, rel));
      hash.update(`${rel}\0${createHash('sha256').update(content).digest('hex')}\n`);
      files += 1;
    }
  }
  return { hash: hash.digest('hex'), files, dirs };
}

async function readRepoIdentity(h) {
  const git = (args) =>
    execFileAsync('git', ['-C', REPO_ROOT, ...args]).then(
      (r) => r.stdout.trim(),
      () => null,
    );
  const tree = await h.readHarnessTreeState();
  const own = await git(['status', '--porcelain', '--', 'scripts/dev/real-app-acceptance.mjs']);
  const estalaraTree = await hashTree(ESTALARA_ROOT, ESTALARA_HASHED_DIRS).catch(() => null);
  return {
    alSha: await git(['rev-parse', 'HEAD']),
    alDirty: own === null || tree.dirty === null ? null : tree.dirty || own !== '',
    alDirtyPaths: tree.dirtyPaths,
    estalaraRoot: ESTALARA_ROOT,
    estalaraIsGit: false,
    estalaraTree,
  };
}

async function readSubstrateFacts(h) {
  const listing = {
    url: LISTING_URL,
    pathIsFixture: new URL(LISTING_URL).pathname.includes('fixture-listing'),
    status: null,
    hasSvelteKit: false,
    listingId: null,
    fixtureListingId: await h.readFixtureListingId(),
    error: null,
  };
  try {
    const res = await fetch(LISTING_URL, { signal: AbortSignal.timeout(PAGE_MS) });
    const html = await res.text();
    listing.status = res.status;
    listing.hasSvelteKit = html.includes('__sveltekit') || html.includes('data-sveltekit');
    listing.listingId = /data-estalara-listing-id="([^"]+)"/.exec(html)?.[1] ?? null;
  } catch (err) {
    listing.error = String(err);
  }

  let grounding = { ok: false, factsSource: null, reason: 'no listing id to probe' };
  if (listing.listingId) {
    const req = h.buildGroundingProbeRequest({
      groundingOrigin: GROUNDING_ORIGIN,
      listingId: listing.listingId,
    });
    const probe = await fetch(req.url, { signal: AbortSignal.timeout(30000) }).then(
      async (res) => ({
        status: res.status,
        bodyText: await res.text().catch(() => null),
        factsSource: res.headers.get('x-estalara-facts-source'),
        networkError: null,
      }),
      (err) => ({ status: null, bodyText: null, factsSource: null, networkError: String(err) }),
    );
    grounding = h.evaluateGroundingProbe(probe, listing.listingId);
  }

  const controlPlane = await h.assertRealControlPlane().then(
    (r) => ({ ok: true, reason: r.reason }),
    (err) => ({ ok: false, reason: String(err.message ?? err) }),
  );
  const probe = await h.fetchServedQuizConfig();
  const quiz = h.evaluateServedQuizConfig(probe);
  const definition = probe.body?.quiz_definition ?? null;
  const path = h.quizPathToLeaf(definition, TARGET_LEAF, TARGET_TICKS);
  const build = h.evaluateBuildFreshness(await h.readBuildFreshnessFacts());
  return {
    facts: {
      listing,
      grounding: {
        ok: grounding.ok,
        factsSource: grounding.factsSource ?? null,
        reason: grounding.reason,
      },
      controlPlane,
      quiz: { ok: quiz.ok, reason: quiz.reason },
      walkFound: path !== null,
      build: { ok: build.ok, reason: build.reason },
    },
    served: { names: quiz.names, path },
  };
}

/** Record what one browser context did. Never asserts. The xid stays out: only its hash tag. */
function observeContext(context, h) {
  const seen = {
    calls: [],
    pending: [],
    ingestAcks: 0,
    ingestAttempts: 0,
    bundle: null,
    configGet: null,
    descriptions: h.observeDescriptionCalls(context, DECISION_ORIGIN),
  };
  const callOf = new WeakMap();
  context.on('request', (req) => {
    const url = req.url();
    if (req.method() === 'GET' && url.includes('/api/quiz/public-config')) {
      seen.configGet ??= { startedMono: performance.now(), finishedMono: null, req };
    }
    if (req.method() !== 'POST' || !url.startsWith(DECISION_ORIGIN) || !/\/adapt(\?|$)/.test(url)) {
      return;
    }
    let sent = null;
    try {
      sent = JSON.parse(req.postData() ?? 'null');
    } catch {
      /* recorded with no body */
    }
    const call = {
      seq: seen.calls.length + 1,
      requestedMono: performance.now(),
      sessionId: sent?.session_id ?? null,
      xidTag: typeof sent?.xid === 'string' ? tagOf(sent.xid) : null,
      traitsSent: Array.isArray(sent?.traits),
      status: null,
      body: null,
      failure: null,
    };
    callOf.set(req, call);
    seen.calls.push(call);
  });
  context.on('response', (res) => {
    const url = res.url();
    if (url.includes('estalara-sdk') && url.includes('.js'))
      seen.bundle = { url, status: res.status() };
    if (res.request().method() === 'POST' && url.startsWith(`${INGEST_ORIGIN}/v1/events`)) {
      seen.ingestAttempts += 1;
      if (res.status() >= 200 && res.status() < 300) seen.ingestAcks += 1;
    }
    const call = callOf.get(res.request());
    if (!call) return;
    call.status = res.status();
    seen.pending.push(
      res.text().then(
        (t) => {
          try {
            call.body = JSON.parse(t);
          } catch {
            call.failure = `non-JSON body: ${t.slice(0, 200)}`;
          }
        },
        (e) => {
          call.failure = String(e);
        },
      ),
    );
  });
  const finished = (req) => {
    if (seen.configGet?.req === req) seen.configGet.finishedMono ??= performance.now();
    const call = callOf.get(req);
    if (call && !call.status) call.failure = req.failure()?.errorText ?? call.failure;
  };
  context.on('requestfinished', finished);
  context.on('requestfailed', finished);
  return seen;
}

const answered = (c) => c.body !== null || c.failure !== null;

/** `.estalara-quiz-*` walk: resolveAc9Quiz()'s interaction model. Throws what a click throws. */
async function walkQuiz(page, served, obs) {
  for (const step of served.path) {
    const answers = page.locator('.estalara-quiz-answer');
    const texts = (await answers.allTextContents()).map((t) => t.trim());
    for (const labels of step.answers) {
      const index = texts.findIndex((t) => labels.includes(t));
      if (index === -1) {
        throw new Error(`no answer on ${step.questionId} reads ${JSON.stringify(labels)}`);
      }
      obs.walkedLabels.push(texts[index]);
      await answers.nth(index).click({ timeout: 5000 });
      await sleep(150);
    }
    await sleep(300);
    const cta = page.locator('.estalara-quiz-cta').first();
    if ((await cta.count().catch(() => 0)) > 0 && (await cta.isEnabled().catch(() => false))) {
      await cta.click({ timeout: 5000 }).catch(() => {});
    }
    await sleep(600);
  }
}

function readSlot(page, slot) {
  return page
    .evaluate(
      (s) => document.querySelector(`[data-estalara-slot="${s}"]`)?.textContent ?? null,
      slot,
    )
    .catch(() => null);
}

async function pollDescriptionCache(listingId, archetype, locale, apiKey) {
  const url =
    `${DECISION_ORIGIN}/api/adapt/description?listing_id=${encodeURIComponent(listingId)}` +
    `&archetype=${encodeURIComponent(archetype)}&locale=${encodeURIComponent(locale)}`;
  const polls = [];
  const start = performance.now();
  while (performance.now() - start < DESCRIPTION_BUDGET_MS) {
    await sleep(DESCRIPTION_POLL_MS);
    const poll = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Origin: new URL(LISTING_URL).origin },
      signal: AbortSignal.timeout(30000),
    }).then(
      async (res) => {
        const body = await res.json().catch(() => null);
        return {
          status: res.status,
          source: body?.source ?? null,
          description: body?.description ?? null,
        };
      },
      (err) => ({ status: null, source: null, description: null, error: String(err) }),
    );
    polls.push(poll);
    if (poll.source === 'ai_cached' && poll.description) break;
  }
  return polls;
}

/** One draw of session 1. Fills `obs`; a throw lands in `obs.error` and the grades read RED. */
async function driveSessionOne(page, seen, served, obs, h) {
  await page.goto(LISTING_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_MS });
  const loader = page.locator('script[data-estalara-loader]').first();
  await loader.waitFor({ state: 'attached', timeout: PAGE_MS });
  obs.loader = await loader.evaluate((s) => ({
    src: s.getAttribute('src'),
    tenantId: s.getAttribute('data-tenant-id'),
    decisionUrl: s.getAttribute('data-decision-url'),
    ingestUrl: s.getAttribute('data-ingest-url'),
  }));
  const apiKey = await loader.getAttribute('data-api-key');
  obs.hookCount = await page.evaluate(
    () =>
      [...document.querySelectorAll('*')]
        .flatMap((el) => [...el.attributes])
        .filter((a) => a.name.startsWith('data-estalara-') && a.name !== 'data-estalara-host')
        .length,
  );

  await pollUntil(async () => squash(await readSlot(page, 'headline')) !== '', PAGE_MS);
  await pollUntil(async () => squash(await readSlot(page, 'description')) !== '', 10000);
  obs.baseline = {
    headline: await readSlot(page, 'headline'),
    description: await readSlot(page, 'description'),
  };

  const accept = page.locator('[data-estalara-consent="accept"]').first();
  await accept.waitFor({ state: 'visible', timeout: PAGE_MS });
  await accept.click({ timeout: 5000 });
  const consentMono = performance.now();
  obs.consent.clicked = true;
  obs.sdkGlobal = await page
    .waitForFunction(() => window.Estalara != null, null, { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  const readConsent = () => page.evaluate(() => window.localStorage.getItem('estalara_consent'));
  await pollUntil(async () => (await readConsent()) !== null, 5000);
  obs.consent.stored = await readConsent();

  // The draw shows on the first answer past consent. A held-out session is replaced before the wait.
  await pollUntil(() => seen.calls.some((c) => answered(c)), ADAPT_MS);
  await Promise.all(seen.pending);
  obs.drewHoldout = h.holdoutFromResponses(
    seen.calls.filter((c) => c.body).map((c) => c.body),
  ).drewHoldout;
  if (obs.drewHoldout === true) return;

  const card = page.locator('.estalara-quiz-card').first();
  await card.waitFor({ state: 'visible', timeout: QUIZ_MOUNT_MS });
  obs.quiz.cardShown = true;
  obs.quiz.consentToCardMs = Math.round(performance.now() - consentMono);
  // The SDK has no 30 s timer since FOLLOW-1015: the card opens on the config. This is the buyer's
  // reading time from the plan's walk, scrolling, so ingest sees a real session.
  await page.evaluate(() => window.scrollTo({ top: 900, behavior: 'instant' }));
  await sleep(Math.max(0, DWELL_MS - (performance.now() - consentMono)));
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  obs.quiz.dwellMs = Math.round(performance.now() - consentMono);

  await walkQuiz(page, served, obs.quiz);
  await page.locator('.estalara-quiz-result').first().waitFor({ state: 'visible', timeout: 10000 });
  const leafText = await page
    .locator('.estalara-quiz-result strong')
    .first()
    .textContent({ timeout: 5000 });
  obs.quiz.leafText = leafText;
  obs.quiz.leaf = h.archetypeFromDisplayName(served.names, leafText);
  const resolveClickMono = performance.now();
  await page.locator('.estalara-quiz-confirm').first().click({ timeout: 5000 });
  obs.quiz.confirmed = true;

  const sessionId = seen.calls.find((c) => c.sessionId)?.sessionId ?? null;
  const folded = await pollUntil(
    () =>
      page
        .evaluate(
          (key) => JSON.parse(window.sessionStorage.getItem(key) ?? 'null')?.state ?? null,
          `estalara_intent_${String(sessionId)}`,
        )
        .then((state) => (state?.quiz_answered === true ? state : null))
        .catch(() => null),
    10000,
    50,
  );
  obs.quiz.foldedArchetype = folded?.archetype ?? null;
  const pickNow = () =>
    h.pickFirstRequestAfterQuizFold({
      calls: seen.calls,
      resolveClickMono,
      foldSeen: folded !== null,
    });
  const followUp = await pollUntil(() => pickNow().next, folded ? 10000 : 0);
  obs.followUpReason = followUp ? null : pickNow().reason;
  if (followUp) await pollUntil(() => answered(followUp), ADAPT_MS);
  await Promise.all(seen.pending);
  obs.followUp = followUp;
  // The bucket can differ past consent: the follow-up carries the xid. Same redraw.
  if (followUp?.body?.holdout_group === true) {
    obs.drewHoldout = true;
    return;
  }

  const directiveTexts = (slot) =>
    servedSlots(followUp?.body)
      .filter((d) => d.slot === slot && typeof d.value === 'string')
      .map((d) => d.value);
  const { calls: allDescriptionCalls, settle } = seen.descriptions;
  const leafAsks = () => allDescriptionCalls.filter((c) => c.archetype === TARGET_LEAF);
  const paintedText = async (slot) => {
    await pollUntil(
      async () => squash(await readSlot(page, slot)) !== squash(obs.baseline[slot]),
      SLOT_PAINT_MS,
    );
    return readSlot(page, slot);
  };
  await pollUntil(() => leafAsks().length > 0, SLOT_PAINT_MS);
  await settle(SLOT_PAINT_MS);
  obs.after.headline = await paintedText('headline');

  // Cold miss: the SDK does not ask twice on one page view, so wait for the cache, then come back.
  const hit = leafAsks().some((c) => c.source === 'ai_cached' && c.description);
  const firstAsk = leafAsks()[0] ?? null;
  if (!hit && firstAsk && apiKey) {
    obs.description.polls = await pollDescriptionCache(
      firstAsk.listingId,
      firstAsk.archetype,
      firstAsk.locale,
      apiKey,
    );
    if (obs.description.polls.some((p) => p.source === 'ai_cached' && p.description)) {
      const asked = leafAsks().length;
      await page.reload({ waitUntil: 'domcontentloaded', timeout: PAGE_MS });
      obs.description.reloaded = true;
      await pollUntil(() => leafAsks().length > asked, ADAPT_MS);
      await settle(SLOT_PAINT_MS);
    }
  }
  obs.after.description = await paintedText('description');
  obs.served.headline = [
    ...directiveTexts('headline'),
    ...leafAsks()
      .map((c) => c.headline)
      .filter(Boolean),
  ];
  obs.served.description = [
    ...directiveTexts('description'),
    ...leafAsks()
      .filter((c) => c.source === 'ai_cached')
      .map((c) => c.description),
  ].filter(Boolean);

  // On the document, whichever way the app set it: `setAttribute` on the loader, today.
  obs.debugElements = await page.evaluate(() =>
    [...document.querySelectorAll('[data-debug="true"]')].map((el) => ({
      tag: el.tagName.toLowerCase(),
      src: el.getAttribute('src'),
    })),
  );

  // The three keys AC(9) seeds. Not the whole storageState: `__estalara_quiz_*` and other tab
  // leftovers are no part of "same xid, zero behaviour", and the raw xid never leaves this function.
  const raw = await page.evaluate(() => ({
    xid: window.localStorage.getItem('__estalara_xid__'),
    consent: window.localStorage.getItem('estalara_consent'),
    version: window.localStorage.getItem('estalara_consent_text_version'),
  }));
  const xid = (() => {
    try {
      return JSON.parse(raw.xid ?? 'null')?.id ?? null;
    } catch {
      return null;
    }
  })();
  obs.xidTag = tagOf(xid);
  if (xid && raw.consent && raw.version) {
    obs.seed = [
      { name: '__estalara_xid__', value: raw.xid },
      { name: 'estalara_consent', value: raw.consent },
      { name: 'estalara_consent_text_version', value: raw.version },
    ];
  }
}

function emptyObs(attempt) {
  return {
    attempt,
    error: null,
    loader: null,
    sdkGlobal: false,
    hookCount: 0,
    baseline: { headline: null, description: null },
    after: { headline: null, description: null },
    served: { headline: [], description: [] },
    consent: { clicked: false, stored: null },
    drewHoldout: null,
    quiz: {
      cardShown: false,
      consentToCardMs: null,
      dwellMs: null,
      walkedLabels: [],
      leafText: null,
      leaf: null,
      confirmed: false,
      foldedArchetype: null,
    },
    followUp: null,
    followUpReason: null,
    description: { polls: [], reloaded: false },
    debugElements: null,
    xidTag: null,
    seed: null,
  };
}

/** Session 1, redrawing a held-out session, at most MAX_DRAWS. */
async function runSessionOne(browser, served, h) {
  const draws = [];
  for (let attempt = 1; ; attempt++) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const seen = observeContext(context, h);
    const obs = emptyObs(attempt);
    const page = await context.newPage();
    try {
      await driveSessionOne(page, seen, served, obs, h);
    } catch (err) {
      obs.error = String(err && err.stack ? err.stack : err);
    }
    await pollUntil(() => seen.ingestAcks > 0, INGEST_ACK_MS);
    await Promise.all(seen.pending);
    await seen.descriptions.settle(5000);
    await context.close().catch(() => {});
    draws.push({ attempt, drewHoldout: obs.drewHoldout, error: obs.error });
    if (obs.drewHoldout === true && attempt < MAX_DRAWS) continue;
    return { obs, seen, draws };
  }
}

/** Session 2: a new context, nothing driven; its FIRST `/api/adapt` is what is graded. */
async function runRestore(browser, obs, h) {
  let last = { call: null, attempts: 0, lateConfigMs: null };
  for (let attempt = 1; attempt <= MAX_DRAWS; attempt++) {
    await sleep(PROFILE_SETTLE_MS);
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      storageState: {
        cookies: [],
        origins: [{ origin: new URL(LISTING_URL).origin, localStorage: obs.seed }],
      },
    });
    const seen = observeContext(context, h);
    try {
      const page = await context.newPage();
      await page.goto(LISTING_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_MS });
      await pollUntil(() => seen.calls[0] && answered(seen.calls[0]), ADAPT_MS);
    } catch (err) {
      last.error = String(err);
    }
    await Promise.all(seen.pending);
    await context.close().catch(() => {});
    const first = seen.calls[0] ?? null;
    const get = seen.configGet;
    const late = get ? Math.round((get.finishedMono ?? performance.now()) - get.startedMono) : null;
    last = {
      ...last,
      call: first,
      attempts: attempt,
      lateConfigMs: !first?.xidTag && late > CONFIG_INIT_BUDGET_MS ? late : null,
    };
    // A late config (no xid, by design) or the write still in `after()` is a lost draw, not a verdict.
    const lost = last.lateConfigMs !== null || first?.body?.profile_restore === 'miss';
    if (!lost) break;
  }
  return last;
}

async function readInquiryFacts() {
  const roots = ['core-master/src', 'web-master/src'].map((d) => nodePath.join(ESTALARA_ROOT, d));
  const markers = EMITTER_MARKERS.flatMap((m) => ['-e', m]);
  try {
    const { stdout } = await execFileAsync('grep', ['-rIlF', ...markers, ...roots]);
    return { readable: true, emitterFiles: stdout.split('\n').filter(Boolean), error: null };
  } catch (err) {
    if (err.code === 1) return { readable: true, emitterFiles: [], error: null };
    return { readable: false, emitterFiles: [], error: String(err.message ?? err) };
  }
}

/** The artefact and the verdict line, once. Also the watchdog's way out. */
function makeFinisher(state) {
  let done = false;
  return async (extra = {}) => {
    if (done) return;
    done = true;
    const run = evaluateN3Run(state.results);
    for (const r of state.results) {
      console.log(`[${String(r.status)}] ${r.hop}${r.reason ? ` — ${r.reason}` : ''}`);
    }
    await writeFile(
      SESSION_JSON,
      JSON.stringify({ ...state, ...extra, finishedAt: new Date().toISOString(), run }, null, 2),
    ).catch((err) => console.error(`could not write ${SESSION_JSON}: ${String(err)}`));
    console.log(`SESSION_JSON=${SESSION_JSON}`);
    console.log(
      `RESULT: verdict=${run.verdict} red=${JSON.stringify(run.red)} ` +
        `unmeasured=${JSON.stringify(run.unmeasured)} excused=${JSON.stringify(run.excused)}`,
    );
    process.exitCode = run.exitCode;
  };
}

async function main() {
  const state = {
    instrument: 'N3 real-app-acceptance (FOLLOW-1344)',
    startedAt: new Date().toISOString(),
    listingUrl: LISTING_URL,
    decisionOrigin: DECISION_ORIGIN,
    ingestOrigin: INGEST_ORIGIN,
    results: [],
  };
  const finish = makeFinisher(state);
  let browser = null;
  const watchdog = setTimeout(() => {
    void finish({ aborted: `watchdog after ${String(DEADLINE_MS)} ms` }).then(async () => {
      if (browser) await Promise.race([browser.close().catch(() => {}), sleep(5000)]);
      process.exit(1);
    });
  }, DEADLINE_MS);
  try {
    // Harness env is read at its import. The flag keeps its main() from running.
    process.env.LISTING_URL = LISTING_URL;
    globalThis.FOLLOW1186_IMPORT_ONLY = true;
    const h = await import('../../tests/e2e/follow-819/differentiator-e2e.mjs');
    const { chromium } = createRequire(new URL('../../packages/sdk/package.json', import.meta.url))(
      '@playwright/test',
    );

    state.repos = await readRepoIdentity(h);
    state.results.push(gradeRepoIdentity(state.repos));
    const gate = await h.readServerConfidenceGate();
    const { facts, served } = await readSubstrateFacts(h);
    const substrate = gradeSubstrate(facts);
    state.results.push(substrate);
    // Not the substrate under test: no browser, no spend. The hops below stay `not_recorded` = RED.
    if (substrate.status !== 'GREEN') return;

    browser = await chromium.launch({ headless: HEADLESS });
    const { obs, seen, draws } = await runSessionOne(browser, served, h);
    state.draws = draws;
    state.sessionOne = {
      ...obs,
      seed: obs.seed ? '(three localStorage keys, not recorded)' : null,
      calls: seen.calls,
      descriptionCalls: seen.descriptions.calls,
      bundle: seen.bundle,
      ingest: { attempts: seen.ingestAttempts, acks: seen.ingestAcks },
    };

    const sdkOut = [];
    if (!obs.loader) sdkOut.push('no script[data-estalara-loader]');
    if (seen.bundle?.status !== 200) sdkOut.push(`SDK bundle ${JSON.stringify(seen.bundle)}`);
    if (!obs.sdkGlobal) sdkOut.push('window.Estalara never appeared');
    if (obs.hookCount < 3) sdkOut.push(`${String(obs.hookCount)} data-estalara-* hooks`);
    if (obs.loader && !obs.loader.decisionUrl?.startsWith(DECISION_ORIGIN)) {
      sdkOut.push(`the page decides at ${String(obs.loader.decisionUrl)}, not ${DECISION_ORIGIN}`);
    }
    if (obs.loader && !obs.loader.ingestUrl?.startsWith(INGEST_ORIGIN)) {
      sdkOut.push(`the page ingests at ${String(obs.loader.ingestUrl)}, not ${INGEST_ORIGIN}`);
    }
    state.results.push(hop('sdk_loaded', sdkOut, { loader: obs.loader, bundle: seen.bundle }));

    const consentOut = [];
    if (!obs.consent.clicked) consentOut.push('the accept button was never clicked');
    if (obs.consent.stored !== 'granted') {
      consentOut.push(`stored consent=${String(obs.consent.stored)}`);
    }
    state.results.push(hop('consent_click', consentOut, obs.consent));

    const ingestOut = seen.ingestAcks > 0 ? [] : ['no 2xx from ingest'];
    state.results.push(
      hop('ingest_ack', ingestOut, { attempts: seen.ingestAttempts, acks: seen.ingestAcks }),
    );

    if (obs.drewHoldout === true) {
      const reason = `${String(MAX_DRAWS)} fresh sessions all drew holdout (~10 % each): re-run`;
      for (const id of [
        'quiz_yield_hunter',
        'adapt_llm_tweaked',
        'headline_dom_changed',
        'description_answered',
        'description_ai_cached',
        'description_dom_changed',
        'no_debug_attribute',
        'restored_first_adapt',
      ]) {
        state.results.push({ hop: id, status: 'UNMEASURED:holdout', reason });
      }
    } else {
      const quizOut = [];
      if (!obs.quiz.cardShown) quizOut.push('the quiz card never opened');
      if (obs.quiz.leaf !== TARGET_LEAF) quizOut.push(`result screen=${String(obs.quiz.leaf)}`);
      if (!obs.quiz.confirmed) quizOut.push('the confirmation step was not clicked');
      if (obs.quiz.foldedArchetype !== TARGET_LEAF) {
        quizOut.push(`fold=${String(obs.quiz.foldedArchetype)}`);
      }
      if (obs.error) quizOut.push(`driver: ${obs.error.split('\n')[0]}`);
      state.results.push(hop('quiz_yield_hunter', quizOut, obs.quiz));

      state.results.push(gradeFollowUp(obs.followUp, gate));
      state.results.push(
        gradeSlot('headline_dom_changed', {
          before: obs.baseline.headline,
          after: obs.after.headline,
          served: obs.served.headline,
        }),
      );
      const description = gradeDescription({
        calls: seen.descriptions.calls.filter((c) => c.archetype === TARGET_LEAF),
        polls: obs.description.polls,
        budgetMs: DESCRIPTION_BUDGET_MS,
        reloaded: obs.description.reloaded,
      });
      state.results.push(description.answered, description.cached);
      state.results.push(
        gradeSlot('description_dom_changed', {
          before: obs.baseline.description,
          after: obs.after.description,
          served: obs.served.description,
        }),
      );
      const debug = obs.debugElements;
      state.results.push(
        hop(
          'no_debug_attribute',
          debug === null
            ? ['the page was never read']
            : debug.length > 0
              ? [
                  `${String(debug.length)} element(s) with data-debug="true" (today ` +
                    'web-master/src/routes/+layout.svelte:61, X4, Phase 5)',
                ]
              : [],
          { debugElements: debug },
        ),
      );

      const restore = obs.seed
        ? await runRestore(browser, obs, h)
        : { call: null, attempts: 0, lateConfigMs: null };
      state.sessionTwo = restore;
      state.results.push(gradeRestore({ sessionOneXidTag: obs.xidTag, ...restore }));
    }

    state.results.push(gradeInquiryHop(await readInquiryFacts()));
  } catch (err) {
    state.error = String(err && err.stack ? err.stack : err);
    console.error(`[N3] driver error: ${state.error}`);
  } finally {
    clearTimeout(watchdog);
    if (browser) await Promise.race([browser.close().catch(() => {}), sleep(5000)]);
    await finish();
  }
}

// Same opt-out shape as the harness: a direct `node` run cannot set it, so it cannot no-op.
if (globalThis.FOLLOW1344_IMPORT_ONLY !== true) {
  const args = parseN3Args(process.argv.slice(2));
  if (args.exitCode !== null) {
    console.error(args.message);
    process.exitCode = args.exitCode;
  } else {
    await main();
  }
}
