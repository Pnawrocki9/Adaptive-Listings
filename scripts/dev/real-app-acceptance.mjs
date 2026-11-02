#!/usr/bin/env node
/**
 * FOLLOW-1344 — instrument N3: one buyer on the REAL Estalara app, real control plane, real clicks.
 *
 * Plan: docs/PLAN-LOCALHOST-COMPLETION-2026-10-17.md "Nowe instrumenty", K4b, K5. Runbook:
 * docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md §5.1 (preconditions, run command, how each hop fails).
 *
 * The principle is `local-pilot-session.mjs`'s: no degrade to skipped. A hop that cannot run is RED
 * or an explicit `UNMEASURED:<why>` with a reason, never green; a hop nobody recorded is RED
 * (`evaluateN3Run()`). Exit 0 only on `GREEN`. Every wait is bounded and a watchdog ends the run:
 * `al-real-up.sh` once hung 14 h.
 *
 * Reused, not copied, from the FOLLOW-819 harness (imported with its import-only flag): the control
 * plane and grounding probes, the served-quiz check, `quizPathToLeaf()`, the fold picker, the holdout
 * reader, `observeDescriptionCalls()`. The click walk is a small copy of `resolveAc9Quiz()`, which is
 * not exported: exporting it would edit a file in `HARNESS_TREE_PATHSPEC` and stale every artefact.
 *
 * Usage: `SESSION_JSON=<path> node scripts/dev/real-app-acceptance.mjs [--arms N | --durable-webhook]`
 * (exit 0 pass, 1 not a pass, 2 usage). Local seed first: `scripts/dev/seed-real-app-k5.mjs`.
 * Env the lift hops need: `ADMIN_API_SECRET` (the staff rollup; absent, `lift_reader_one_conversion`
 * is RED and says so) and `SUPABASE_JWT_SECRET` (the lift route). Others: see the runbook §5.1.
 *
 * @module scripts/dev/real-app-acceptance
 */

import { execFile } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  appSql,
  ensureSeed,
  LISTING_UUID,
  readSetupDefault,
  resetBuyer,
} from './seed-real-app-k5.mjs';

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
const CLICKHOUSE_URL = process.env.N3_CLICKHOUSE_URL ?? 'http://localhost:8123';
const CLICKHOUSE_USER = process.env.N3_CLICKHOUSE_USER ?? 'default';
const CLICKHOUSE_PASSWORD = process.env.N3_CLICKHOUSE_PASSWORD ?? 'clickhouse';
const AL_PG = process.env.N3_AL_PG_CONTAINER ?? 'al_pg_local';
const BACKEND_LOG =
  process.env.N3_BACKEND_LOG ?? nodePath.join(ESTALARA_ROOT, '.al-local/logs/backend.log');
const KEYCLOAK_ORIGIN = process.env.N3_KEYCLOAK_ORIGIN ?? 'http://localhost:8080';
const TENANT_ID = process.env.N3_TENANT_ID ?? '00000000-0000-0000-0000-0000000000e2';
const HOLDOUT_PCT = Number(process.env.HOLDOUT_PCT ?? 0.1);
/**
 * A checkout holding the build the running control plane serves, when this script runs from another
 * one (a worktree, with `packages/sdk/node_modules` linked in): the build freshness check reads
 * there. Unset is the K5 form.
 */
const BUILD_ROOT = process.env.N3_BUILD_ROOT ?? null;

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
/** The subtrees the Estalara tree hash covers (that repo has no git). `.env` stays out: it has keys. */
const ESTALARA_HASHED_DIRS = Object.freeze(['web-master/src', 'core-master/src']);
/** The only requests that may carry the session header (README-web-master.md, X1 front end). */
const CONVERSION_PATHS = Object.freeze({
  live: '/api/v1/calendar/event/live/enrollment',
  contact: '/api/v1/conversation',
  join: '/api/v1/livestream/join',
});
const CONVERSION_TYPES = Object.freeze({ live: 'live.signup', contact: 'inquiry.completed' });

const TARGET_LEAF = 'yield_hunter';
/** A trait the served `t_invest` screen offers and the store may keep (AC(9)'s persistable tick). */
const TARGET_TICKS = Object.freeze(['seasoned_investor']);
const MAX_DRAWS = 3;

const PAGE_MS = 120000; // first SSR compile of the listing route is slow (al-real-up.sh step 5)
const QUIZ_MOUNT_MS = 60000; // 15 s config budget plus a swapping box
const DWELL_MS = Number(process.env.N3_DWELL_MS ?? 30000); // the plan's "~30 s" of browsing
const ADAPT_MS = 120000; // an LLM decision on a cold plane
const SLOT_PAINT_MS = 20000;
const CTA_SETTLE_MS = 60000; // a decision after a host reload, on a loaded box
const INGEST_ACK_MS = 60000; // 22-25 s OPTIONS were measured on this box (2026-10-16)
const PROFILE_SETTLE_MS = 15000; // the profile is written in after(), past the response
// Each GET on a miss starts one more generation (`after()` has no dedupe), so the poll is sparse.
// In-process generation can take ~95 s (FOLLOW-819 README §6.13); 180 s / 40 s = at most 4 GETs.
const DESCRIPTION_BUDGET_MS = Number(process.env.N3_DESCRIPTION_BUDGET_MS ?? 180000);
const DESCRIPTION_POLL_MS = 40000;
const DEADLINE_MS = Number(process.env.N3_DEADLINE_MS ?? 50 * 60 * 1000);
const CLICK_MS = 30000; // a toast can cover a button for a few seconds after the previous click
const ROW_WAIT_MS = 30000; // conversions go out after commit, on a bounded pool; ClickHouse flushes
const NEGATIVE_SETTLE_MS = 8000; // a control waits this long for a row that must not come
const JOB_WAIT_MS = 60000; // a save's job is dispatched after its commit
const SAFETY_POLL_MS = 16.5 * 60 * 1000; // async-job.safety-net.poll-interval-ms is 15 min
const MIN_SAMPLE_PER_ARM = 30; // apps/control-plane/src/lib/pilot-stats.ts
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
  'host_cookie_click',
  'cta_slot',
  'feature_slot',
  'cta_still_works',
  'conversion_header',
  'conversion_backend_sent',
  'conversion_rows_signed',
  'lift_reader_one_conversion',
  'lift_route_http',
  'negative_consent_pending',
  'negative_consent_denied',
  'negative_analytics_refused',
  'negative_withdrawn_same_tab',
  'negative_withdrawn_second_tab',
  'backend_log_no_session_id',
  'listing_save_revision',
]);

/** Every hop of a `--arms N` run. */
export const N3_ARMS_HOPS = Object.freeze([
  'repo_identity',
  'substrate',
  'arms_sessions',
  'arms_conversions_landed',
  'arms_reader_lift',
  'arms_sample',
]);

/** The hop of a `--durable-webhook` run. */
export const N3_DURABLE_HOPS = Object.freeze(['webhook_durable_retry']);

/**
 * The run's verdict over its recorded hops.
 *
 * @param {ReadonlyArray<{hop: string, status: unknown, reason?: unknown}>} results
 * @param {ReadonlyArray<string>} [hops] - the mode's hop list.
 * @returns {{verdict: 'GREEN'|'UNMEASURED'|'RED', exitCode: 0|1, red: string[],
 *   unmeasured: string[]}}
 */
export function evaluateN3Run(results, hops = N3_HOPS) {
  const rows = Array.isArray(results) ? results : [];
  const red = [];
  const unmeasured = [];
  for (const row of rows) {
    if (!hops.includes(row?.hop)) red.push(`${String(row?.hop)}:unknown_hop`);
  }
  for (const hop of hops) {
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
      else unmeasured.push(`${hop}(${status})`);
    }
  }
  const verdict = red.length > 0 ? 'RED' : unmeasured.length > 0 ? 'UNMEASURED' : 'GREEN';
  return { verdict, exitCode: verdict === 'GREEN' ? 0 : 1, red, unmeasured };
}

const hop = (id, failures, evidence) => ({
  hop: id,
  status: failures.length === 0 ? 'GREEN' : 'RED',
  ...(failures.length === 0 ? {} : { reason: failures.join('; ') }),
  evidence,
});

const directivesOf = (b) => (Array.isArray(b?.directives) ? b.directives : []);
const servedSlots = (b) => directivesOf(b).filter((d) => d && d.type !== 'reorder');
const unmeasuredHop = (id, why, reason, evidence) => ({
  hop: id,
  status: `UNMEASURED:${why}`,
  reason,
  evidence,
});

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
 * The host's own cookie banner, clicked: the header helper requires `optional === true` from it.
 *
 * @param {{clicked: boolean, stored: string|null, error?: string|null}} f
 */
export function gradeHostCookie(f) {
  const out = [];
  if (!f.clicked) out.push(`the banner's accept was never clicked ${f.error ?? ''}`.trim());
  let parsed = null;
  try {
    parsed = JSON.parse(f.stored ?? 'null');
  } catch {
    out.push('localStorage.cookieConsent is not JSON');
  }
  if (parsed?.necessary !== true || parsed?.optional !== true) {
    out.push(`localStorage.cookieConsent=${String(f.stored)}`);
  }
  return hop('host_cookie_click', out, f);
}

/**
 * A marker on the rendered page; the SDK wrote it, into text a response served, or says why not. A
 * skip the SDK explains is no pass: the slot was not adapted, and it reads as not measured.
 *
 * @param {'cta_slot'|'feature_slot'} id
 * @param {{slot: string, markers: number, visibleMarkers: number, before: string|null,
 *   after: string|null, served: ReadonlyArray<string>, applied: boolean,
 *   skipped: ReadonlyArray<string>}} f
 */
export function gradeSlotMarker(id, f) {
  if (f.markers === 0) {
    return hop(id, [`no [data-estalara-slot="${f.slot}"] on the rendered page`], f);
  }
  if (f.visibleMarkers === 0) return hop(id, ['the marker exists, but none is visible'], f);
  const after = squash(f.after);
  const wrote = after !== squash(f.before) && after !== '';
  const fromServed = f.served.some((t) => squash(t) && after.includes(squash(t).slice(0, 40)));
  if (wrote && fromServed) return hop(id, [], f);
  if (wrote) return hop(id, ['the slot changed, but into no text a response served'], f);
  if (f.served.length === 0) {
    return unmeasuredHop(id, 'no_directive', `no response served a ${f.slot} directive`, f);
  }
  if (f.skipped.length > 0) {
    return unmeasuredHop(id, 'sdk_skipped', `the SDK skipped it: ${f.skipped.join(', ')}`, f);
  }
  return hop(id, ['a directive was served, the slot did not change, the SDK says nothing'], f);
}

/**
 * The adapted label still does the button's job: logged out it asks for a login, logged in it opens
 * the conversation with the agent. Grades the click, so a label nobody clicked cannot pass.
 *
 * @param {{adapted: boolean, anonymousOpensLogin: boolean, conversationStatus: number|null,
 *   messagesUrl: boolean, text: string|null, error?: string|null}} f
 */
export function gradeCtaWorks(f) {
  const out = [];
  if (!f.adapted) out.push('the button clicked was not carrying adapted copy');
  if (!f.anonymousOpensLogin) out.push('logged out, the click opened no login prompt');
  if (f.conversationStatus !== 200 && f.conversationStatus !== 201) {
    out.push(`logged in, POST conversation answered ${String(f.conversationStatus)}`);
  }
  if (!f.messagesUrl) out.push('logged in, the click did not reach the thread');
  if (f.error) out.push(`driver: ${f.error.split('\n')[0]}`);
  return hop('cta_still_works', out, f);
}

const isOk = (status) => typeof status === 'number' && status >= 200 && status < 300;

/**
 * The header on the conversion calls, with the SDK's session, and on no other request.
 *
 * @param {{sessionId: string|null, tabSessionId: string|null,
 *   headerRequests: ReadonlyArray<{method: string, path: string, value: string}>,
 *   conversionCalls: ReadonlyArray<{kind: string, value: string|null, status: number|null}>}} f
 */
export function gradeConversionHeader(f) {
  const out = [];
  if (!f.sessionId) out.push('no SDK session id was read');
  if (f.sessionId && f.tabSessionId !== f.sessionId) {
    out.push('the tab holds another session than /api/adapt saw');
  }
  for (const kind of ['live', 'contact']) {
    const calls = f.conversionCalls.filter((c) => c.kind === kind);
    if (calls.length === 0) out.push(`no ${kind} call was made`);
    for (const c of calls) {
      if (!isOk(c.status)) out.push(`${kind} call answered ${String(c.status)}`);
      if (c.value === null) out.push(`${kind} call carried no header`);
      else if (c.value !== f.sessionId) out.push(`${kind} call carried another session`);
    }
  }
  const allowed = Object.values(CONVERSION_PATHS);
  for (const r of f.headerRequests) {
    if (!allowed.includes(r.path) || r.method !== 'POST') {
      out.push(`the header went on ${r.method} ${r.path}`);
    }
  }
  return hop('conversion_header', out, f);
}

/**
 * The backend said it sent both. The line carries no session (by design), so this is a count over
 * the run, and it is only as good as the run being the only buyer on this stack.
 *
 * @param {{before: Record<string, number>|null, after: Record<string, number>|null}} f
 */
export function gradeBackendSent(f) {
  if (!f.before || !f.after) return hop('conversion_backend_sent', ['backend log unreadable'], f);
  const out = [];
  for (const type of Object.values(CONVERSION_TYPES)) {
    const key = `sent ${type}`;
    if (f.after[key] - f.before[key] !== 1) {
      out.push(`al_conversion_sent type=${type} moved by ${String(f.after[key] - f.before[key])}`);
    }
  }
  if (f.after.failed !== f.before.failed) out.push('an al_conversion_failed line appeared');
  return hop('conversion_backend_sent', out, f);
}

/**
 * Each conversion's row under the session, signed, and at or after the first decision.
 *
 * @param {{sessionId: string|null, rows: ReadonlyArray<{type: string, caller_signed: number,
 *   after_first_decision: number}>|null, tenantIds?: ReadonlyArray<string>}} f
 */
export function gradeRows(f) {
  const out = [];
  if (!f.sessionId) out.push('no session id');
  if (!f.rows) out.push('ClickHouse unreadable');
  else {
    for (const type of Object.values(CONVERSION_TYPES)) {
      const mine = f.rows.filter((r) => r.type === type);
      if (mine.length === 0) out.push(`no ${type} row`);
      if (mine.some((r) => Number(r.caller_signed) !== 1)) out.push(`${type} row not signed`);
      if (mine.length > 0 && !mine.some((r) => Number(r.after_first_decision) === 1)) {
        out.push(`${type} row precedes the first decision`);
      }
    }
    const unexpected = f.rows.filter((r) => !Object.values(CONVERSION_TYPES).includes(r.type));
    if (unexpected.length > 0) out.push('a row of another type came back');
  }
  // At-least-once on purpose (a re-send after a slow ACK) and the lift counts sessions, so a repeat
  // is not a failure here; it is reported, because any count of raw rows would read it double.
  const ids = (f.rows ?? []).map((r) => r.event_id).filter(Boolean);
  const repeatedRows = ids.length - new Set(ids).size;
  return hop('conversion_rows_signed', out, { ...f, repeatedRows });
}

const armCount = (body, arm, field) => body?.conversion_breakdown?.[arm]?.[field] ?? null;

/**
 * The reader counts the run's one adapted session as ONE conversion, with the two parts apart. It
 * reads a pool, so this grades its movement across the run. Over a window other sessions can leave
 * the pool at the far edge: an unexplained movement is RED, for a human to read.
 *
 * @param {{reader: string, before: any, after: any, rollup: any, rollupRead?: any,
 *   error?: string|null}} f
 */
export function gradeLiftReader(f) {
  const out = [];
  if (f.error) out.push(`reader: ${f.error}`);
  const { before, after } = f;
  if (after?.conversion_source !== 'signed_events') {
    out.push(`conversion_source=${String(after?.conversion_source)}`);
  }
  if (f.rollup?.conversion_source !== 'signed_events') {
    out.push(
      `rollup conversion_source=${String(f.rollup?.conversion_source)}${describeRollupRead(f.rollupRead)}`,
    );
  }
  const moved = (field, arm = 'adapted') => {
    const a = armCount(after, arm, field);
    const b = armCount(before, arm, field);
    return a === null || b === null ? null : a - b;
  };
  const summary = {
    conversions: moved('conversions'),
    live_signups: moved('live_signups'),
    agent_contacts: moved('agent_contacts'),
    holdout_conversions: moved('conversions', 'holdout'),
  };
  if (summary.conversions !== 1)
    out.push(`adapted conversions moved by ${String(summary.conversions)}`);
  if (summary.live_signups !== 1) out.push(`live_signups moved by ${String(summary.live_signups)}`);
  if (summary.agent_contacts !== 1) {
    out.push(`agent_contacts moved by ${String(summary.agent_contacts)}`);
  }
  if (summary.holdout_conversions !== 0) {
    out.push(`holdout conversions moved by ${String(summary.holdout_conversions)}`);
  }
  for (const field of ['live_signup_rate', 'agent_contact_rate']) {
    if (typeof armCount(after, 'adapted', field) !== 'number') out.push(`${field} is not a number`);
  }
  return hop('lift_reader_one_conversion', out, {
    reader: f.reader,
    moved: summary,
    adapted: after?.conversion_breakdown?.adapted ?? null,
    holdout: after?.conversion_breakdown?.holdout ?? null,
    summary: after?.summary ?? null,
    rollup: f.rollup?.rollup?.conversions ?? null,
    rollupRead: f.rollupRead ?? null,
  });
}

/**
 * Why the staff rollup gave no body, for the reason text: no secret, an HTTP status, or the fetch's
 * own error. Empty when nothing is known (a caller that has no read record) or the read was fine.
 *
 * @param {{secretPresent: boolean, status: number|null, error: string|null}|null|undefined} r
 */
export function describeRollupRead(r) {
  if (!r) return '';
  if (!r.secretPresent) return ' (ADMIN_API_SECRET absent: the rollup was not asked)';
  if (r.error) return ` (rollup request failed: ${r.error})`;
  if (r.status !== null && r.status !== 200) return ` (rollup HTTP ${String(r.status)})`;
  return '';
}

/**
 * The `/admin` reader over HTTP. The route takes a staff JWT only; with no secret to sign one the
 * running plane will accept, the route is not measured, whatever the functions behind it did.
 *
 * @param {{secretPresent: boolean, status: number|null, source: string|null}} f
 */
export function gradeLiftRoute(f) {
  if (!f.secretPresent) {
    return unmeasuredHop(
      'lift_route_http',
      'no_staff_jwt',
      'no SUPABASE_JWT_SECRET here, and the plane must hold the same one: the route refuses every ' +
        'locally-minted staff token (K3 gap). The numbers came from its functions, in process.',
      f,
    );
  }
  const out = [];
  if (f.status !== 200) out.push(`HTTP ${String(f.status)}`);
  if (f.source !== 'signed_events') out.push(`conversion_source=${String(f.source)}`);
  return hop('lift_route_http', out, f);
}

/**
 * One negative control. Each must have REACHED the backend with a call that would have converted,
 * or "no row" means nothing: that is what the 2xx and the `al_conversion_skipped` lines are for.
 *
 * @param {string} id
 * @param {{clicks: ReadonlyArray<{kind: string, status: number|null, value: string|null}>,
 *   headerRequests: ReadonlyArray<{path: string}>, rowsSince: number|null,
 *   skippedBefore: number|null, skippedAfter: number|null, stateAtClick: unknown,
 *   sessionId: string|null, error?: string|null}} f
 */
export function gradeNegativeControl(id, f) {
  const out = [];
  if (f.error) out.push(`driver: ${f.error.split('\n')[0]}`);
  for (const kind of ['live', 'contact']) {
    const c = f.clicks.find((x) => x.kind === kind);
    if (!c) out.push(`no ${kind} call: the control measured nothing`);
    else if (!isOk(c.status))
      out.push(`${kind} call answered ${String(c.status)}: not a new conversion`);
    if (c && c.value !== null) out.push(`${kind} call carried the header`);
  }
  if (f.headerRequests.length > 0) {
    out.push(`the header went on ${f.headerRequests.map((r) => r.path).join(', ')}`);
  }
  if (f.rowsSince === null) out.push('ClickHouse unreadable');
  else if (f.rowsSince !== 0) out.push(`${String(f.rowsSince)} conversion row(s) landed`);
  if (f.skippedBefore === null || f.skippedAfter === null) out.push('backend log unreadable');
  else if (f.skippedAfter - f.skippedBefore < 2) {
    out.push(
      `the backend logged ${String(f.skippedAfter - f.skippedBefore)} al_conversion_skipped, ` +
        'expected one per call: the event never reached the listener',
    );
  }
  return hop(id, out, f);
}

/**
 * The session id is not in the backend's log (ESC-091 M-3): a search over every id this run saw.
 *
 * @param {{ids: number, hits: number|null, error?: string|null}} f
 */
export function gradeBackendLog(f) {
  const out = [];
  if (f.ids === 0) out.push('no session id to search for');
  if (f.hits === null) out.push(`backend log unreadable: ${String(f.error)}`);
  else if (f.hits > 0) out.push(`${String(f.hits)} log line(s) hold a session id`);
  return hop('backend_log_no_session_id', out, f);
}

/**
 * X2: a save reached the webhook, read from the database the webhook writes.
 *
 * @param {{saveStatus: number|null, revisionBefore: number|null, revisionAfter: number|null,
 *   jobStatus: string|null, error?: string|null}} f
 */
export function gradeListingSave(f) {
  const out = [];
  if (f.error) out.push(`driver: ${f.error}`);
  if (!isOk(f.saveStatus)) out.push(`the save answered ${String(f.saveStatus)}`);
  if (f.jobStatus !== 'SUCCEEDED') out.push(`job status=${String(f.jobStatus)}`);
  if (f.revisionBefore === null || f.revisionAfter === null) out.push('revision unreadable');
  else if (f.revisionAfter <= f.revisionBefore) {
    out.push(`revision stayed at ${String(f.revisionAfter)}`);
  }
  return hop('listing_save_revision', out, f);
}

/**
 * The durable path: a delivery the plane refuses leaves the job waiting to retry, not lost.
 *
 * @param {{inserted: boolean, status: string|null, attempts: number|null, lastError: string|null,
 *   waitedMs: number, error?: string|null}} f
 */
export function gradeDurableRetry(f) {
  const out = [];
  if (f.error) out.push(`driver: ${f.error}`);
  if (!f.inserted) out.push('the probe job was not written');
  if (f.status !== 'RETRY_WAIT') out.push(`job status=${String(f.status)}`);
  if (!(f.attempts >= 1)) out.push(`attempts=${String(f.attempts)}`);
  if (!f.lastError) out.push('no last_error');
  return hop('webhook_durable_retry', out, f);
}

/**
 * The arm the server computes for an id: `assignHoldout()` in `packages/shared/src/ab-holdout.ts`.
 * A prediction only, to spare 90 % of the browser sessions a holdout arm would otherwise burn: the
 * server still decides, and a session it placed elsewhere reads RED in {@link gradeArmSessions}.
 *
 * @param {string} secret
 * @param {string} tenantId
 * @param {string} unit
 * @param {number} pct
 */
export function predictHoldout(secret, tenantId, unit, pct) {
  const mac = createHmac('sha256', secret).update(`${tenantId}\n${unit}`).digest();
  return mac.readUInt32BE(0) / 0xffffffff < pct;
}

/**
 * A session id and an xid that both land in the arm: the unit is the session before consent and the
 * xid after, so a pair that disagrees would put one session in both arms.
 *
 * @param {'adapted'|'holdout'} arm
 * @param {string} secret
 * @param {string} tenantId
 * @param {number} pct
 * @param {() => string} [draw]
 */
export function drawIdsForArm(arm, secret, tenantId, pct, draw = randomUUID) {
  const want = arm === 'holdout';
  const one = () => {
    for (let i = 0; i < 100000; i++) {
      const id = draw();
      if (predictHoldout(secret, tenantId, id, pct) === want) return id;
    }
    throw new Error(`no id drew arm ${arm} in 100000 tries (HOLDOUT_PCT ${String(pct)})`);
  };
  return { sessionId: one(), xid: one() };
}

/**
 * What a scripted session does. Arm-blind by construction: `arm` is not an input, so a lift on these
 * sessions can only come from a conversion that failed to land.
 *
 * @param {number} i - the session's index in its arm.
 * @returns {ReadonlyArray<'live'|'contact'>}
 */
export function conversionPlan(i) {
  return [['live', 'contact'], [], ['live'], [], ['contact'], []][i % 6];
}

/**
 * Both arms filled, by the server's own answer.
 *
 * @param {number} n
 * @param {ReadonlyArray<{arm: string, servedHoldout: boolean|null, decisions: number,
 *   servedBothArms?: boolean, error?: string|null}>} sessions
 */
export function gradeArmSessions(n, sessions) {
  const out = [];
  for (const arm of ['adapted', 'holdout']) {
    const mine = sessions.filter((s) => s.arm === arm);
    if (mine.length !== n) out.push(`${arm}: ${String(mine.length)} of ${String(n)} sessions ran`);
    const wrong = mine.filter((s) => s.servedHoldout !== (arm === 'holdout'));
    if (wrong.length > 0) out.push(`${arm}: ${String(wrong.length)} landed in the other arm`);
    const blank = mine.filter((s) => s.decisions === 0);
    if (blank.length > 0) out.push(`${arm}: ${String(blank.length)} got no decision`);
  }
  const both = sessions.filter((s) => s.servedBothArms);
  if (both.length > 0) out.push(`${String(both.length)} session(s) were served both arms`);
  const crashed = sessions.filter((s) => s.error);
  if (crashed.length > 0) out.push(`${String(crashed.length)} session(s) threw`);
  return hop('arms_sessions', out, { n, sessions });
}

/**
 * Every planned conversion is a signed row under its session, and no unplanned one is.
 *
 * @param {ReadonlyArray<{arm: string, sessionId: string, plan: ReadonlyArray<string>,
 *   rows: ReadonlyArray<{type: string, caller_signed: number}>|null}>} sessions
 */
export function gradeArmConversions(sessions) {
  const out = [];
  for (const s of sessions) {
    if (!s.rows) {
      out.push(`${s.sessionId}: ClickHouse unreadable`);
      continue;
    }
    for (const kind of ['live', 'contact']) {
      const type = CONVERSION_TYPES[kind];
      const signed = s.rows.filter((r) => r.type === type && Number(r.caller_signed) === 1);
      const landed = new Set(signed.map((r) => r.event_id ?? r)).size;
      const want = s.plan.includes(kind) ? 1 : 0;
      if (landed !== want) {
        out.push(
          `${s.arm} ${s.sessionId}: ${type} ${String(landed)} event(s), planned ${String(want)}`,
        );
      }
    }
  }
  return hop(
    'arms_conversions_landed',
    out,
    sessions.map((s) => ({ arm: s.arm, plan: s.plan, rows: s.rows?.length ?? null })),
  );
}

/**
 * The reader shows a percent and a class. It reads the whole window, so the run's own sessions are
 * computed beside it from the same counts. Which number a checkpoint may quote is in `poolIsRun`.
 *
 * @param {{reader: string, body: any, runScoped: {adaptedN: number, adaptedConversions: number,
 *   holdoutN: number, holdoutConversions: number}, error?: string|null}} f
 */
export function gradeArmsReader(f) {
  const out = [];
  if (f.error) out.push(`reader: ${f.error}`);
  const s = f.body?.summary ?? null;
  if (f.body?.conversion_source !== 'signed_events') {
    out.push(`conversion_source=${String(f.body?.conversion_source)}`);
  }
  if (!s) out.push('the reader returned no summary');
  else {
    if (s.holdout_cta_rate > 0 && typeof s.relative_lift_pct !== 'number') {
      out.push('relative_lift_pct is not a number');
    }
    if (typeof s.confidence !== 'string') out.push('no confidence class');
  }
  const b = f.body?.conversion_breakdown ?? null;
  const poolIsRun =
    b?.adapted?.sessions === f.runScoped.adaptedN && b?.holdout?.sessions === f.runScoped.holdoutN;
  return hop('arms_reader_lift', out, {
    reader: f.reader,
    summary: s,
    runScoped: f.runScoped,
    poolIsRun,
  });
}

/**
 * The sample the plan asks for, per arm, in this run, never borrowed from the pool.
 *
 * @param {number} n
 */
export function gradeArmsSample(n) {
  if (n >= MIN_SAMPLE_PER_ARM) return hop('arms_sample', [], { n });
  return unmeasuredHop(
    'arms_sample',
    'small_n',
    `${String(n)} per arm: under the ${String(MIN_SAMPLE_PER_ARM)} the confidence class needs`,
    { n },
  );
}

/**
 * @param {string[]} argv
 * @returns {{exitCode: 2|null, message: string|null, mode: 'run'|'arms'|'durable'|null,
 *   arms: number|null}}
 */
export function parseN3Args(argv) {
  const bad = (message) => ({ exitCode: 2, message, mode: null, arms: null });
  if (argv.length === 0) return { exitCode: null, message: null, mode: 'run', arms: null };
  if (argv.length === 1 && argv[0] === '--durable-webhook') {
    return { exitCode: null, message: null, mode: 'durable', arms: null };
  }
  if (argv[0] === '--arms') {
    const raw = argv[1] ?? '';
    if (argv.length !== 2 || !/^[1-9][0-9]*$/.test(raw)) {
      return bad('--arms needs one positive integer: nothing ran.');
    }
    return { exitCode: null, message: null, mode: 'arms', arms: Number(raw) };
  }
  return bad(`unknown arguments: ${argv.join(' ')}`);
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
  const build = h.evaluateBuildFreshness(
    await h.readBuildFreshnessFacts(BUILD_ROOT ? { repoRoot: BUILD_ROOT } : {}),
  );
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
      build: { ok: build.ok, reason: build.reason, buildRoot: BUILD_ROOT },
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
    headerRequests: [],
    conversionCalls: [],
    sdkEvents: [],
    silentSsoDone: false,
    consentText: null,
  };
  const callOf = new WeakMap();
  const conversionOf = new WeakMap();
  const consentTextOf = new WeakMap();
  context.on('request', (req) => {
    const url = req.url();
    if (req.method() === 'GET' && url.includes('/api/quiz/public-config')) {
      seen.configGet ??= { startedMono: performance.now(), finishedMono: null, req };
    }
    const path = new URL(url).pathname;
    if (req.method() === 'GET' && path === CONSENT_TEXT_PATH) {
      seen.consentText ??= { path, status: null, startedMono: performance.now(), durationMs: null };
      consentTextOf.set(req, seen.consentText);
    }
    const value = req.headers()['x-estalara-session-id'] ?? null;
    if (value !== null) seen.headerRequests.push({ method: req.method(), path, value });
    const kind = Object.keys(CONVERSION_PATHS).find((k) => CONVERSION_PATHS[k] === path);
    if (kind && req.method() === 'POST') {
      const call = { kind, value, status: null };
      conversionOf.set(req, call);
      seen.conversionCalls.push(call);
    }
    if (req.method() === 'POST' && url.startsWith(`${INGEST_ORIGIN}/v1/events`)) {
      try {
        for (const e of JSON.parse(req.postData() ?? '{}').events ?? []) {
          if (String(e?.type).startsWith('adapt.')) {
            seen.sdkEvents.push({
              type: e.type,
              slot: e.payload?.slot_or_selector ?? null,
              reason: e.payload?.reason ?? null,
            });
          }
        }
      } catch {
        /* a batch nobody can read says nothing */
      }
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
    const consentText = consentTextOf.get(res.request());
    if (consentText) consentText.status = res.status();
    const conversion = conversionOf.get(res.request());
    if (conversion) conversion.status = res.status();
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
    if (req.url().includes('silent-check-sso.html')) seen.silentSsoDone = true;
    if (seen.configGet?.req === req) seen.configGet.finishedMono ??= performance.now();
    const consentText = consentTextOf.get(req);
    if (consentText) {
      consentText.durationMs ??= Math.round(performance.now() - consentText.startedMono);
      consentText.failure ??= req.failure()?.errorText ?? null;
    }
    const call = callOf.get(req);
    if (call && !call.status) call.failure = req.failure()?.errorText ?? call.failure;
  };
  // A reload of the whole page starts a new silent SSO check, so the old answer no longer counts. The
  // check can also answer on the page itself, not in its iframe (`#error=login_required`).
  context.on('request', (req) => {
    if (req.isNavigationRequest() && req.frame().parentFrame() === null) seen.silentSsoDone = false;
  });
  context.on('page', (page) => {
    page.on('framenavigated', (frame) => {
      if (frame.parentFrame() === null && frame.url().includes('error=login_required')) {
        seen.silentSsoDone = true;
      }
    });
  });
  context.on('requestfinished', finished);
  context.on('requestfailed', finished);
  return seen;
}

/** The consent-text document's path (`CONSENT_TEXT_URL` in `@estalara/shared`, ADR-0021 §D3). */
const CONSENT_TEXT_PATH = '/consent-text.json';

/**
 * What the page did about the consent-text request, as one line. The SDK fails closed with no banner
 * when that fetch returns null (`consent-flow.ts`), so a missing banner needs this beside it.
 *
 * @param {{path: string, status: number|null, durationMs: number|null, failure?: string|null}|null} c
 */
export function describeConsentText(c) {
  if (!c) return `no ${CONSENT_TEXT_PATH} request was seen`;
  const outcome = c.failure ? `failed (${c.failure})` : `status ${String(c.status)}`;
  return `${c.path} ${outcome}, ${c.durationMs === null ? 'unfinished' : `${String(c.durationMs)} ms`}`;
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

/** The walk, its result screen and the confirmation. Returns the moment of the confirming click. */
async function completeQuiz(page, served, quiz, h) {
  await walkQuiz(page, served, quiz);
  await page.locator('.estalara-quiz-result').first().waitFor({ state: 'visible', timeout: 10000 });
  const leafText = await page
    .locator('.estalara-quiz-result strong')
    .first()
    .textContent({ timeout: 5000 });
  quiz.leafText = leafText;
  quiz.leaf = h.archetypeFromDisplayName(served.names, leafText);
  const resolveClickMono = performance.now();
  await page.locator('.estalara-quiz-confirm').first().click({ timeout: 5000 });
  quiz.confirmed = true;
  return resolveClickMono;
}

function readSlot(page, slot) {
  return page
    .evaluate(
      (s) => document.querySelector(`[data-estalara-slot="${s}"]`)?.textContent ?? null,
      slot,
    )
    .catch(() => null);
}

/** Every element a slot marks, not just the first: `cta` is on two buttons. */
function readSlotFacts(page, slot) {
  return page
    .evaluate((s) => {
      const els = [...document.querySelectorAll(`[data-estalara-slot="${s}"]`)];
      const visible = els.filter((el) => el.getBoundingClientRect().width > 0);
      return {
        markers: els.length,
        visibleMarkers: visible.length,
        text: visible[0]?.textContent ?? null,
        texts: els.map((el) => el.textContent?.trim() ?? ''),
      };
    }, slot)
    .catch(() => ({ markers: 0, visibleMarkers: 0, text: null, texts: [] }));
}

/**
 * The `window.Estalara` line of `sdk_loaded`: null when it was seen. `null` in the observation means
 * nobody read it (the run stopped first), and says that instead of claiming it never appeared.
 *
 * @param {{sdkGlobal: boolean|null, sdkGlobalRead?: string|null}} obs
 */
export function gradeSdkGlobal(obs) {
  if (obs.sdkGlobal === true) return null;
  if (obs.sdkGlobal === null)
    return 'window.Estalara was not measured: the run stopped before it was read';
  return obs.sdkGlobalRead
    ? `window.Estalara was absent, read ${obs.sdkGlobalRead}`
    : 'window.Estalara never appeared within 30 s of the consent click';
}

const HOST_CLICK_ATTEMPTS = 3;
const HOST_CLICK_MS = 15000;

/** The host's modal: a real click, on what `CookieConsent.svelte` renders once the app hydrated. */
async function clickHostCookieBanner(page, into, { optional = true } = {}) {
  // The modal flies in over 400 ms (`transition:fly`) and the node can be replaced while the app
  // hydrates, so Playwright's "stable, receives events" check can take longer than 5 s on a loaded
  // box. A buyer simply tries again when it settles: a bounded retry, each with a longer click wait.
  // A banner that never lets itself be clicked still ends with `into.clicked` false and the error.
  into.attempts = 0;
  const accept = page.getByRole('button', { name: 'Accept selected', exact: true });
  try {
    await accept.waitFor({ state: 'visible', timeout: PAGE_MS });
  } catch (err) {
    into.error = String(err).split('\n')[0]; // no banner in PAGE_MS: nothing to retry
    return;
  }
  for (let attempt = 1; attempt <= HOST_CLICK_ATTEMPTS; attempt += 1) {
    into.attempts = attempt;
    try {
      if (!optional) {
        await page
          .getByRole('checkbox', { name: /Optional cookies/ })
          .uncheck({ timeout: HOST_CLICK_MS });
      }
      await accept.click({ timeout: HOST_CLICK_MS });
      into.clicked = true;
      into.error = null;
      into.stored = await page.evaluate(() => window.localStorage.getItem('cookieConsent'));
      return;
    } catch (err) {
      into.error = String(err).split('\n')[0];
      if (!/Timeout/.test(into.error)) return;
    }
  }
}

const tabSession = (page) =>
  page
    .evaluate(() => {
      try {
        return JSON.parse(window.sessionStorage.getItem('__estalara_session__') ?? 'null')
          ?.sessionId;
      } catch {
        return null;
      }
    })
    .then(
      (id) => id ?? null,
      () => null,
    );

/** Answer Keycloak's form, then wait for the app to be back, hydrated and logged in. */
async function finishKeycloakLogin(page, popupLogin, buyer, seen) {
  // A login started while the app's own silent SSO check is in flight is lost (the check's redirect
  // answers `login_required`); that check took ~60 s on this box. See the K5 report.
  await pollUntil(() => seen.silentSsoDone, ADAPT_MS, 500);
  // No wait for the navigation inside the click: Keycloak's page can take longer than the click's
  // timeout on this box; the waitForURL below is the bound.
  await popupLogin.click({ timeout: 5000, noWaitAfter: true });
  await page.waitForURL((u) => u.origin === KEYCLOAK_ORIGIN, { timeout: 60000 });
  await page.locator('#username').fill(buyer.login, { timeout: 30000 });
  await page.locator('#password').fill(buyer.password, { timeout: 5000 });
  await page.locator('#kc-login').click({ timeout: 5000, noWaitAfter: true });
  await page.waitForURL((u) => u.origin === new URL(LISTING_URL).origin, { timeout: 60000 });
  await page.getByRole('button', { name: 'Book session' }).first().waitFor({
    state: 'visible',
    timeout: PAGE_MS,
  });
  await pollUntil(
    async () => (await page.getByRole('button', { name: 'Login', exact: true }).count()) === 0,
    60000,
    500,
  );
}

const responseTo = (page, path) =>
  page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === path,
    { timeout: 90000 }, // the backend stalled 50 s under memory pressure on this box
  );

/**
 * A click and the answer to the request it makes. Together, or a click that throws leaves the wait
 * rejecting with nobody listening, and that kills the run with no verdict line.
 */
const clickAndAnswer = (page, target, path) =>
  Promise.all([responseTo(page, path), target.click({ timeout: CLICK_MS })]);

/** Book the LIVE: a real click, and the answer it got. */
async function clickBook(page) {
  const book = page.getByRole('button', { name: 'Book session' }).first();
  await clickAndAnswer(page, book, CONVERSION_PATHS.live);
}

/** ClickHouse over HTTP, parameterless: every value interpolated is a local UUID or a constant. */
async function chQuery(sql) {
  const url = new URL(CLICKHOUSE_URL);
  url.searchParams.set('query', `${sql} FORMAT JSONEachRow`);
  const res = await fetch(url, {
    headers: {
      authorization: `Basic ${Buffer.from(`${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}`).toString('base64')}`,
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`ClickHouse HTTP ${String(res.status)}`);
  return (await res.text())
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const uuidOnly = (id) => String(id).replace(/[^0-9a-fA-F-]/g, '');

/** The conversion rows of one session, with "at or after its first decision" stated directly. */
function readConversionRows(sessionId) {
  const id = uuidOnly(sessionId);
  return chQuery(
    `SELECT type, caller_signed, tenant_id, event_id,
       ingest_received_at >= (SELECT min(ts) FROM adaptation_decisions WHERE session_id = '${id}')
         AS after_first_decision
     FROM events WHERE session_id = '${id}' AND type IN ('inquiry.completed', 'live.signup')`,
  ).catch(() => null);
}

/** Conversions of ANY session since a moment: a control leaves none, whatever its session was. */
async function countConversionsSince(isoSeconds) {
  const rows = await chQuery(
    `SELECT count() AS n FROM events WHERE type IN ('inquiry.completed', 'live.signup')
       AND ingest_received_at >= parseDateTimeBestEffort('${isoSeconds}')`,
  ).catch(() => null);
  return rows ? Number(rows[0]?.n ?? 0) : null;
}

/** Lines of the backend's log matching any fixed string. `null` when it cannot be read. */
async function countLogLines(fixedStrings) {
  try {
    const { stdout } = await execFileAsync('grep', [
      '-c',
      '-F',
      ...fixedStrings.flatMap((f) => ['-e', f]),
      BACKEND_LOG,
    ]);
    return Number(stdout.trim());
  } catch (err) {
    return err.code === 1 ? 0 : null;
  }
}

async function readBackendCounts() {
  const counts = {};
  for (const type of Object.values(CONVERSION_TYPES)) {
    counts[`sent ${type}`] = await countLogLines([`al_conversion_sent type=${type} `]);
    counts[`skipped ${type}`] = await countLogLines([
      `al_conversion_skipped type=${type} reason=no_session`,
    ]);
  }
  counts.failed = await countLogLines(['al_conversion_failed']);
  return Object.values(counts).includes(null) ? null : counts;
}

const SENT_SETTLE_MS = 30000;

/**
 * The backend writes `al_conversion_sent` on an executor, after the response the buyer saw, so a
 * read straight after the walk can miss lines that do land. Poll until both sent counters moved past
 * `before`, bounded; the LAST read is the verdict either way, so a send that never happens is still
 * a read of 0 and `gradeBackendSent` stays RED. An unreadable log stops the wait (null).
 *
 * @param {Record<string, number>|null} before
 * @param {{read?: () => Promise<Record<string, number>|null>, budgetMs?: number, pollMs?: number}} [o]
 */
export async function readBackendCountsSettled(before, o = {}) {
  const read = o.read ?? readBackendCounts;
  let last = await read();
  if (!before) return last;
  const moved = (c) =>
    c !== null &&
    Object.values(CONVERSION_TYPES).every((t) => c[`sent ${t}`] > before[`sent ${t}`]);
  const start = performance.now();
  while (
    last !== null &&
    !moved(last) &&
    performance.now() - start < (o.budgetMs ?? SENT_SETTLE_MS)
  ) {
    await sleep(o.pollMs ?? 500);
    last = await read();
  }
  return last;
}

const skippedTotal = (counts) =>
  counts
    ? counts[`skipped ${CONVERSION_TYPES.live}`] + counts[`skipped ${CONVERSION_TYPES.contact}`]
    : null;

/**
 * The lift numbers: the route when a staff JWT can be signed, else its functions in a child process.
 *
 * @returns {Promise<{reader: string, body: any, route: {secretPresent: boolean,
 *   status: number|null, source: string|null}, error: string|null}>}
 */
async function readLift() {
  const secret = process.env.SUPABASE_JWT_SECRET ?? '';
  const route = { secretPresent: secret !== '', status: null, source: null };
  if (secret !== '') {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const signing = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
      sub: randomUUID(),
      email: 'n3@localhost.example',
      estalara_staff: true,
      estalara_role: 'estalara:readonly',
      iat: now,
      exp: now + 300,
    })}`;
    const sig = createHmac('sha256', secret).update(signing).digest('base64url');
    const res = await fetch(
      `${DECISION_ORIGIN}/api/dashboard/analytics/lift?window_days=7&tenant_id=${TENANT_ID}`,
      {
        headers: { authorization: `Bearer ${signing}.${sig}` },
        signal: AbortSignal.timeout(30000),
      },
    ).catch(() => null);
    route.status = res?.status ?? null;
    const body = res ? await res.json().catch(() => null) : null;
    route.source = body?.conversion_source ?? null;
    if (res?.status === 200) return { reader: 'route', body, route, error: null };
  }
  try {
    const { stdout } = await execFileAsync(
      nodePath.join(REPO_ROOT, 'node_modules/.bin/tsx'),
      [
        '--tsconfig',
        nodePath.join(REPO_ROOT, 'apps/control-plane/tsconfig.json'),
        nodePath.join(REPO_ROOT, 'scripts/dev/n3-lift-reader.ts'),
        TENANT_ID,
        '7',
      ],
      {
        cwd: REPO_ROOT,
        timeout: 120000,
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          CLICKHOUSE_URL,
          CLICKHOUSE_USER,
          CLICKHOUSE_PASSWORD,
          CALLER_SIGNED_COLUMN_ENABLED: 'true',
        },
      },
    );
    return { reader: 'route_helpers_in_process', body: JSON.parse(stdout), route, error: null };
  } catch (err) {
    return {
      reader: 'route_helpers_in_process',
      body: null,
      route,
      error: String(err.message ?? err).slice(0, 400),
    };
  }
}

/** The staff rollup on the RUNNING plane, the one lift surface a local secret opens. */
async function readRollup() {
  const secret = process.env.ADMIN_API_SECRET ?? '';
  const read = { secretPresent: secret !== '', status: null, error: null };
  if (secret === '') return { body: null, read };
  try {
    const res = await fetch(`${DECISION_ORIGIN}/api/admin/analytics/rollup`, {
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(60000),
    });
    read.status = res.status;
    return { body: res.ok ? await res.json().catch(() => null) : null, read };
  } catch (err) {
    read.error = String(err?.message ?? err).slice(0, 200);
    return { body: null, read };
  }
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
async function driveSessionOne(page, seen, served, obs, h, buyer) {
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

  // The modal arrives with hydration and covers the page, so a buyer answers it first. Only then is
  // the page in its final shape: with a LIVE seeded, the `cta` button is the "sessions" variant.
  await clickHostCookieBanner(page, obs.hostCookie);
  await page.getByRole('button', { name: 'Book session' }).first().waitFor({
    state: 'visible',
    timeout: PAGE_MS,
  });
  obs.slots.before = {
    cta: await readSlotFacts(page, 'cta'),
    feature: await readSlotFacts(page, 'feature'),
  };

  const accept = page.locator('[data-estalara-consent="accept"]').first();
  try {
    await accept.waitFor({ state: 'visible', timeout: PAGE_MS });
  } catch (err) {
    // The global is read here, not skipped: without the banner nothing below waits for it.
    obs.sdkGlobal = await page.evaluate(() => window.Estalara != null).catch(() => null);
    obs.sdkGlobalRead = 'once, when the accept button never appeared';
    throw err;
  }
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

  const resolveClickMono = await completeQuiz(page, served, obs.quiz, h);

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

  // The host can re-render or reload here, which puts the seller's copy back until the next decision
  // lands (N3 run 3 of the K5 series clicked in that window). Graded on what a buyer about to click sees.
  if (buyer) {
    await pollUntil(
      async () => {
        const facts = await readSlotFacts(page, 'cta').catch(() => null);
        return facts !== null && squash(facts.text) !== squash(obs.slots.before?.cta?.text);
      },
      CTA_SETTLE_MS,
      500,
    );
  }
  obs.slots.after = {
    cta: await readSlotFacts(page, 'cta'),
    feature: await readSlotFacts(page, 'feature'),
  };
  if (buyer) await driveConversions(page, seen, obs, buyer);
}

/**
 * The buyer of the walk: the adapted button, logged out; the login it asks for; a LIVE registration;
 * the adapted button again, which opens the conversation with the agent. A throw is recorded here,
 * so a dead conversion path leaves the hops above it standing.
 */
async function driveConversions(page, seen, obs, buyer) {
  const c = obs.conversions;
  try {
    const cta = () => page.locator('[data-estalara-slot="cta"]:visible').first();
    c.ctaTextClicked = await cta().textContent({ timeout: 5000 });
    await cta().click({ timeout: 5000 });
    const popupLogin = page.getByRole('button', { name: 'Log in', exact: true });
    await popupLogin.waitFor({ state: 'visible', timeout: 15000 });
    c.anonymousOpensLogin = true;
    await finishKeycloakLogin(page, popupLogin, buyer, seen);
    c.tabSessionId = await tabSession(page);
    // The reload made a fresh decision, and which slots a decision fills varies per call. Graded on
    // this final state, as a buyer about to click sees it.
    await pollUntil(
      async () => {
        const facts = await readSlotFacts(page, 'feature');
        return squash(facts.text) !== squash(obs.slots.before?.feature?.text);
      },
      SLOT_PAINT_MS,
      500,
    );
    obs.slots.afterLogin = {
      cta: await readSlotFacts(page, 'cta'),
      feature: await readSlotFacts(page, 'feature'),
    };
    await clickBook(page);
    c.ctaTextAfterLogin = await cta().textContent({ timeout: 5000 });
    await clickAndAnswer(page, cta(), CONVERSION_PATHS.contact);
    c.messagesUrl = await page
      .waitForURL((u) => u.pathname.includes('/messages/'), { timeout: 60000 })
      .then(
        () => true,
        () => false,
      );
  } catch (err) {
    c.error = String(err && err.stack ? err.stack : err);
  }
}

function emptyObs(attempt) {
  return {
    attempt,
    error: null,
    loader: null,
    sdkGlobal: null,
    sdkGlobalRead: null,
    hookCount: 0,
    baseline: { headline: null, description: null },
    after: { headline: null, description: null },
    served: { headline: [], description: [] },
    consent: { clicked: false, stored: null },
    hostCookie: { clicked: false, stored: null, error: null },
    slots: { before: null, after: null, afterLogin: null },
    conversions: {
      ctaTextClicked: null,
      ctaTextAfterLogin: null,
      anonymousOpensLogin: false,
      messagesUrl: false,
      tabSessionId: null,
      error: null,
    },
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
async function runSessionOne(browser, served, h, buyer) {
  const draws = [];
  for (let attempt = 1; ; attempt++) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const seen = observeContext(context, h);
    const obs = emptyObs(attempt);
    const page = await context.newPage();
    try {
      await driveSessionOne(page, seen, served, obs, h, buyer);
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

/** The artefact and the verdict line, once. Also the watchdog's way out. */
function makeFinisher(state, hops = N3_HOPS) {
  let done = false;
  return async (extra = {}) => {
    if (done) return;
    done = true;
    const run = evaluateN3Run(state.results, hops);
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
        `unmeasured=${JSON.stringify(run.unmeasured)}`,
    );
    process.exitCode = run.exitCode;
  };
}

/** A control's staging, by the state its click must be made in. */
const NEGATIVE_CONTROLS = Object.freeze({
  negative_consent_pending: { sdk: 'none' },
  negative_consent_denied: { sdk: 'decline' },
  negative_analytics_refused: { sdk: 'accept', hostOptional: false },
  negative_withdrawn_same_tab: { sdk: 'accept', withdraw: 'same' },
  negative_withdrawn_second_tab: { sdk: 'accept', withdraw: 'second' },
});

const isDenied = (page) =>
  page
    .evaluate(() => window.localStorage.getItem('estalara_consent') === 'denied')
    .catch(() => false);

async function clickWithdraw(page) {
  const control = page.locator('[data-estalara-withdraw]').first();
  await control.waitFor({ state: 'visible', timeout: ADAPT_MS });
  await control.click({ timeout: 5000 });
  if (!(await pollUntil(() => isDenied(page), 15000)))
    throw new Error('withdrawal stored no denial');
}

/**
 * One negative control: the same buyer, a NEW registration and a NEW pair each time, in the state
 * under test. The clicks are the ones that convert in the positive, so a green here is the helper
 * holding the header back, not the call never having been made.
 */
async function runNegative(browser, id, seed, h) {
  const staging = NEGATIVE_CONTROLS[id];
  await resetBuyer(seed.accountId, seed.login);
  const since = new Date().toISOString().slice(0, 19);
  const skippedBefore = skippedTotal(await readBackendCounts());
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const seen = observeContext(context, h);
  const f = {
    staging,
    clicks: [],
    headerRequests: [],
    rowsSince: null,
    skippedBefore,
    skippedAfter: null,
    stateAtClick: null,
    sessionId: null,
    error: null,
  };
  try {
    const page = await context.newPage();
    await page.goto(LISTING_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_MS });
    const host = { clicked: false, stored: null, error: null };
    await clickHostCookieBanner(page, host, { optional: staging.hostOptional !== false });
    if (!host.clicked) throw new Error(`host banner: ${String(host.error)}`);
    if (staging.sdk !== 'none') {
      const button = page.locator(`[data-estalara-consent="${staging.sdk}"]`).first();
      await button.waitFor({ state: 'visible', timeout: PAGE_MS });
      await button.click({ timeout: 5000 });
    }
    if (staging.sdk === 'accept') await pollUntil(() => seen.calls.some(answered), ADAPT_MS);
    const book = page.getByRole('button', { name: 'Book session' }).first();
    await book.waitFor({ state: 'visible', timeout: PAGE_MS });
    await book.click({ timeout: 5000 });
    const popupLogin = page.getByRole('button', { name: 'Log in', exact: true });
    await popupLogin.waitFor({ state: 'visible', timeout: 15000 });
    await finishKeycloakLogin(page, popupLogin, seed, seen);
    if (staging.withdraw === 'same') await clickWithdraw(page);
    if (staging.withdraw === 'second') {
      const second = await context.newPage();
      await second.goto(LISTING_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_MS });
      await clickWithdraw(second);
      await second.close();
    }
    f.sessionId = await tabSession(page);
    f.stateAtClick = await page.evaluate(() => ({
      consent: window.localStorage.getItem('estalara_consent'),
      cookieConsent: window.localStorage.getItem('cookieConsent'),
      tabHasSession: window.sessionStorage.getItem('__estalara_session__') !== null,
    }));
    await clickBook(page);
    await clickAndAnswer(
      page,
      page.getByRole('button', { name: 'Message', exact: true }).first(),
      CONVERSION_PATHS.contact,
    );
  } catch (err) {
    f.error = String(err && err.stack ? err.stack : err);
  }
  await sleep(NEGATIVE_SETTLE_MS);
  await Promise.all(seen.pending);
  await context.close().catch(() => {});
  f.clicks = seen.conversionCalls;
  f.headerRequests = seen.headerRequests;
  f.rowsSince = await countConversionsSince(since);
  f.skippedAfter = skippedTotal(await readBackendCounts());
  return gradeNegativeControl(id, f);
}

const alSql = (sql) =>
  execFileAsync('docker', [
    'exec',
    AL_PG,
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-Atc',
    sql,
  ]).then((r) => r.stdout.trim());

const readRevision = () =>
  alSql(
    `select coalesce((select revision from listing_revisions where tenant_id = '${TENANT_ID}'
       and listing_id = '${LISTING_UUID}'), 0)`,
  ).then(Number, () => null);

/**
 * X2: a real save by the listing's agent, through the backend's own `PATCH /api/v1/listing`, with the
 * price it already has (a price in the body is what makes a PATCH a grounding change). Not the agent
 * UI: the save is under test, not the form. It advances the revision, so the next description is a
 * cold miss: this runs last, and every full run pays that generation.
 */
async function agentAccessToken() {
  const res = await fetch(
    `${KEYCLOAK_ORIGIN}/realms/web_application_realm/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'user-management-client',
        username: await readSetupDefault('TEST_USER_USERNAME'),
        password: await readSetupDefault('TEST_USER_PASSWORD'),
      }),
      signal: AbortSignal.timeout(90000),
    },
  );
  if (!res.ok) throw new Error(`the agent's token: HTTP ${String(res.status)}`);
  return (await res.json()).access_token;
}

async function driveListingSave() {
  const f = {
    saveStatus: null,
    revisionBefore: await readRevision(),
    revisionAfter: null,
    jobStatus: null,
    error: null,
  };
  try {
    const [price, status] = (
      await appSql(
        `select coalesce(price, price_usd), status from listing where uuid = '${LISTING_UUID}'`,
      )
    ).split('|');
    const lastJob = await appSql('select coalesce(max(id), 0) from async_job');
    const token = await agentAccessToken();
    const res = await fetch(`${GROUNDING_ORIGIN}/api/v1/listing?locale=EN`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ listingUuid: LISTING_UUID, status, price: Number(price) }),
      signal: AbortSignal.timeout(90000),
    });
    f.saveStatus = res.status;
    if (!res.ok) f.refusal = (await res.text()).slice(0, 400);
    const row = await pollUntil(
      async () => {
        const out = await appSql(
          `select status from async_job where type = 'LISTING_UPDATED_WEBHOOK'
             and aggregate_id = '${LISTING_UUID}' and id > ${lastJob} order by id desc limit 1`,
        );
        return out === 'SUCCEEDED' || out === 'DEAD_LETTER' || out === 'RETRY_WAIT' ? out : null;
      },
      JOB_WAIT_MS,
      1000,
    );
    f.jobStatus =
      row ??
      ((await appSql(
        `select status from async_job where type = 'LISTING_UPDATED_WEBHOOK'
           and aggregate_id = '${LISTING_UUID}' and id > ${lastJob} order by id desc limit 1`,
      )) ||
        null);
  } catch (err) {
    f.error = String(err && err.message ? err.message : err);
  }
  f.revisionAfter = await readRevision();
  return gradeListingSave(f);
}

/** `--durable-webhook`: a job the plane refuses (400, an over-long id) must wait to retry. */
async function runDurable(state) {
  const f = {
    inserted: false,
    status: null,
    attempts: null,
    lastError: null,
    waitedMs: 0,
    refusedBy: 'the running plane: listing_id over its 256-char limit',
    notCovered: 'an unreachable target: the URL is env on a backend this script must not restart',
    error: null,
  };
  let jobId = null;
  try {
    const payload = JSON.stringify({ listingUuid: 'n3-probe-'.repeat(40) });
    jobId = await appSql(
      `insert into async_job (id, uuid, type, status, aggregate_type, aggregate_id, payload_json,
         attempt_count, max_attempts, next_attempt_at, created_at, updated_at)
       values (nextval('seq_async_job_id'), gen_random_uuid(), 'LISTING_UPDATED_WEBHOOK', 'PENDING',
         'LISTING', 'n3-durable-probe', '${payload}', 0, 12, now() - interval '1 day',
         now() - interval '1 day', now() - interval '1 day')
       returning id`,
    ).then((out) => out.split('\n')[0]);
    f.inserted = true;
    const start = performance.now();
    await pollUntil(
      async () => {
        const [status, attempts, lastError] = (
          await appSql(
            `select status, attempt_count, left(coalesce(last_error, ''), 200)
               from async_job where id = ${jobId}`,
          )
        ).split('|');
        f.status = status;
        f.attempts = Number(attempts);
        f.lastError = lastError || null;
        return f.attempts >= 1;
      },
      SAFETY_POLL_MS,
      10000,
    );
    f.waitedMs = Math.round(performance.now() - start);
  } catch (err) {
    f.error = String(err && err.message ? err.message : err);
  } finally {
    // A probe left behind would dead-letter in hours and alert the admins.
    if (jobId) await appSql(`delete from async_job where id = ${jobId}`).catch(() => {});
  }
  state.results.push(gradeDurableRetry(f));
}

const ARMS_DWELL_MS = Number(process.env.N3_ARMS_DWELL_MS ?? 5000);
const ARMS_QUIZ_CARD_MS = 30000;

/** One scripted session. Same steps in both arms; only the server's answer differs. */
async function runArmSession(browser, served, h, { arm, i, secret, seed }) {
  const start = performance.now();
  const ids = drawIdsForArm(arm, secret, TENANT_ID, HOLDOUT_PCT);
  const plan = conversionPlan(i);
  if (plan.length > 0) await resetBuyer(seed.accountId, seed.login);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(
    ({ sessionId, xid, origin }) => {
      if (window.location.origin !== origin) return;
      if (!window.sessionStorage.getItem('__estalara_session__')) {
        window.sessionStorage.setItem(
          '__estalara_session__',
          JSON.stringify({ sessionId, startedAt: Date.now(), pageCount: 0 }),
        );
      }
      if (!window.localStorage.getItem('__estalara_xid__')) {
        window.localStorage.setItem(
          '__estalara_xid__',
          JSON.stringify({ id: xid, created_at: Date.now() }),
        );
      }
    },
    { ...ids, origin: new URL(LISTING_URL).origin },
  );
  const seen = observeContext(context, h);
  const row = {
    arm,
    i,
    sessionId: ids.sessionId,
    plan,
    servedHoldout: null,
    servedBothArms: false,
    decisions: 0,
    quizShown: false,
    source: null,
    seconds: null,
    error: null,
  };
  try {
    const page = await context.newPage();
    await page.goto(LISTING_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_MS });
    const host = { clicked: false, stored: null, error: null };
    await clickHostCookieBanner(page, host);
    const accept = page.locator('[data-estalara-consent="accept"]').first();
    await accept.waitFor({ state: 'visible', timeout: PAGE_MS });
    await accept.click({ timeout: 5000 });
    await pollUntil(() => seen.calls.some(answered), ADAPT_MS);
    const card = page.locator('.estalara-quiz-card').first();
    row.quizShown = await card.waitFor({ state: 'visible', timeout: ARMS_QUIZ_CARD_MS }).then(
      () => true,
      () => false,
    );
    await sleep(ARMS_DWELL_MS);
    if (row.quizShown) {
      const resolveClickMono = await completeQuiz(page, served, { walkedLabels: [] }, h);
      await pollUntil(
        () => seen.calls.find((c) => c.requestedMono > resolveClickMono && answered(c)),
        ADAPT_MS,
      );
    }
    if (plan.length > 0) {
      const book = page.getByRole('button', { name: 'Book session' }).first();
      await book.waitFor({ state: 'visible', timeout: PAGE_MS });
      await book.click({ timeout: 5000 });
      const popupLogin = page.getByRole('button', { name: 'Log in', exact: true });
      await popupLogin.waitFor({ state: 'visible', timeout: 15000 });
      await finishKeycloakLogin(page, popupLogin, seed, seen);
      if (plan.includes('live')) await clickBook(page);
      if (plan.includes('contact')) {
        await clickAndAnswer(
          page,
          page.getByRole('button', { name: 'Message', exact: true }).first(),
          CONVERSION_PATHS.contact,
        );
      }
    }
  } catch (err) {
    row.error = String(err && err.stack ? err.stack : err);
  }
  await Promise.all(seen.pending);
  await context.close().catch(() => {});
  const bodies = seen.calls.map((c) => c.body).filter(Boolean);
  const flags = bodies.map((b) => b.holdout_group === true);
  row.decisions = bodies.length;
  row.servedHoldout = flags.length > 0 ? flags.some(Boolean) : null;
  row.servedBothArms = flags.some(Boolean) && flags.some((x) => !x);
  row.source = bodies.at(-1)?.source ?? null;
  row.seconds = Math.round((performance.now() - start) / 1000);
  return row;
}

/** `--arms N`: N of each, one at a time. The reader is read over the window; the run beside it. */
async function runArms(browser, served, h, state, n) {
  const secret = process.env.HOLDOUT_ASSIGNMENT_SECRET ?? '';
  if (secret.length < 32) {
    state.results.push(
      hop(
        'arms_sessions',
        ['HOLDOUT_ASSIGNMENT_SECRET is not in this process: no arm to aim at'],
        {},
      ),
    );
    return;
  }
  const seed = await ensureSeed();
  const sessions = [];
  // Interleaved, so a stack that degrades over a long run degrades both arms alike.
  for (let i = 0; i < n; i++) {
    for (const arm of ['adapted', 'holdout']) {
      let row = await runArmSession(browser, served, h, { arm, i, secret, seed });
      // No decision means no row anywhere: a page that never got going. Replaced once, on the record.
      if (row.error && row.decisions === 0) {
        state.armsReplaced = [
          ...(state.armsReplaced ?? []),
          { arm, i, error: row.error.split('\n')[0] },
        ];
        row = await runArmSession(browser, served, h, { arm, i, secret, seed });
      }
      sessions.push(row);
      state.armSessions = sessions;
      console.log(
        `[N3 arms] ${arm} ${String(i + 1)}/${String(n)}: ${String(row.seconds)} s, plan=` +
          `${row.plan.join('+') || 'none'}, servedHoldout=${String(row.servedHoldout)}, ` +
          `source=${String(row.source)}${row.error ? `, threw: ${row.error.split('\n')[0]}` : ''}`,
      );
    }
  }
  state.results.push(gradeArmSessions(n, sessions));
  const wantsRows = sessions.some((s) => s.plan.length > 0);
  if (wantsRows) await sleep(ROW_WAIT_MS);
  for (const s of sessions) {
    s.rows = await readConversionRows(s.sessionId);
  }
  state.results.push(gradeArmConversions(sessions));
  const signedSessions = (arm) =>
    sessions.filter((s) => s.arm === arm && s.rows?.some((r) => Number(r.caller_signed) === 1))
      .length;
  const runScoped = {
    adaptedN: sessions.filter((s) => s.arm === 'adapted').length,
    adaptedConversions: signedSessions('adapted'),
    holdoutN: sessions.filter((s) => s.arm === 'holdout').length,
    holdoutConversions: signedSessions('holdout'),
  };
  const pooled = await readLift();
  state.results.push(
    gradeArmsReader({ reader: pooled.reader, body: pooled.body, runScoped, error: pooled.error }),
  );
  state.results.push(gradeArmsSample(n));
}

/** The whole walk: session 1 with its conversions, the restore, the controls, the save. */
async function runFull(browser, served, gate, h, state) {
  const seed = await ensureSeed();
  await resetBuyer(seed.accountId, seed.login);
  const countsBefore = await readBackendCounts();
  const liftBefore = await readLift();
  state.liftBefore = { reader: liftBefore.reader, error: liftBefore.error };

  const { obs, seen, draws } = await runSessionOne(browser, served, h, seed);
  state.draws = draws;
  const sessionId = seen.calls.find((c) => c.sessionId)?.sessionId ?? null;
  const countsAfter = await readBackendCountsSettled(countsBefore);
  state.sessionOne = {
    ...obs,
    seed: obs.seed ? '(three localStorage keys, not recorded)' : null,
    calls: seen.calls,
    descriptionCalls: seen.descriptions.calls,
    bundle: seen.bundle,
    ingest: { attempts: seen.ingestAttempts, acks: seen.ingestAcks },
    sdkEvents: seen.sdkEvents,
  };

  const sdkOut = [];
  if (!obs.loader) sdkOut.push('no script[data-estalara-loader]');
  if (seen.bundle?.status !== 200) sdkOut.push(`SDK bundle ${JSON.stringify(seen.bundle)}`);
  const globalLine = gradeSdkGlobal(obs);
  if (globalLine) sdkOut.push(globalLine);
  if (obs.hookCount < 3) sdkOut.push(`${String(obs.hookCount)} data-estalara-* hooks`);
  if (obs.loader && !obs.loader.decisionUrl?.startsWith(DECISION_ORIGIN)) {
    sdkOut.push(`the page decides at ${String(obs.loader.decisionUrl)}, not ${DECISION_ORIGIN}`);
  }
  if (obs.loader && !obs.loader.ingestUrl?.startsWith(INGEST_ORIGIN)) {
    sdkOut.push(`the page ingests at ${String(obs.loader.ingestUrl)}, not ${INGEST_ORIGIN}`);
  }
  state.results.push(hop('sdk_loaded', sdkOut, { loader: obs.loader, bundle: seen.bundle }));

  const consentOut = [];
  const consentTextLine = describeConsentText(seen.consentText);
  if (!obs.consent.clicked) {
    consentOut.push(`the accept button was never clicked; consent text: ${consentTextLine}`);
  }
  if (obs.consent.stored !== 'granted') {
    consentOut.push(`stored consent=${String(obs.consent.stored)}`);
  }
  state.results.push(
    hop('consent_click', consentOut, { ...obs.consent, consentText: seen.consentText ?? null }),
  );
  state.results.push(gradeHostCookie(obs.hostCookie));

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
      'cta_slot',
      'feature_slot',
      'cta_still_works',
      'conversion_header',
      'conversion_backend_sent',
      'conversion_rows_signed',
      'lift_reader_one_conversion',
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
            ? [`${String(debug.length)} element(s) with data-debug="true"`]
            : [],
        { debugElements: debug },
      ),
    );

    // The exact copy, recorded whatever the grade: FOLLOW-1453 asks what lands on these buttons.
    const servedText = (slot) => [
      ...new Set(
        seen.calls.flatMap((c) =>
          servedSlots(c.body)
            .filter((d) => d.slot === slot && typeof d.value === 'string')
            .map((d) => d.value),
        ),
      ),
    ];
    for (const [id, slot] of [
      ['cta_slot', 'cta'],
      ['feature_slot', 'feature'],
    ]) {
      const before = obs.slots.before?.[slot] ?? null;
      const after = obs.slots.afterLogin?.[slot] ?? obs.slots.after?.[slot] ?? null;
      const events = seen.sdkEvents.filter((e) => e.slot === slot);
      state.results.push(
        gradeSlotMarker(id, {
          slot,
          markers: after?.markers ?? before?.markers ?? 0,
          visibleMarkers: after?.visibleMarkers ?? before?.visibleMarkers ?? 0,
          before: before?.text ?? null,
          after: after?.text ?? null,
          texts: after?.texts ?? [],
          served: servedText(slot),
          applied: events.some((e) => e.type === 'adapt.applied'),
          skipped: events.filter((e) => e.type === 'adapt.skipped').map((e) => String(e.reason)),
        }),
      );
    }

    const c = obs.conversions;
    const contactCall = seen.conversionCalls.find((x) => x.kind === 'contact') ?? null;
    state.results.push(
      gradeCtaWorks({
        adapted:
          squash(c.ctaTextClicked) !== '' &&
          squash(c.ctaTextClicked) !== squash(obs.slots.before?.cta?.text),
        anonymousOpensLogin: c.anonymousOpensLogin,
        conversationStatus: contactCall?.status ?? null,
        messagesUrl: c.messagesUrl,
        text: c.ctaTextClicked,
        textAfterLogin: c.ctaTextAfterLogin,
        error: c.error,
      }),
    );
    state.results.push(
      gradeConversionHeader({
        sessionId,
        tabSessionId: c.tabSessionId,
        headerRequests: seen.headerRequests,
        conversionCalls: seen.conversionCalls,
      }),
    );
    state.results.push(gradeBackendSent({ before: countsBefore, after: countsAfter }));

    const wantsBoth = (rows) =>
      rows && Object.values(CONVERSION_TYPES).every((t) => rows.some((r) => r.type === t));
    let rows = null;
    await pollUntil(
      async () => {
        rows = sessionId ? await readConversionRows(sessionId) : null;
        return wantsBoth(rows);
      },
      ROW_WAIT_MS,
      2000,
    );
    state.results.push(gradeRows({ sessionId, rows }));

    const restore = obs.seed
      ? await runRestore(browser, obs, h)
      : { call: null, attempts: 0, lateConfigMs: null };
    state.sessionTwo = restore;
    state.results.push(gradeRestore({ sessionOneXidTag: obs.xidTag, ...restore }));
  }

  const ids = new Set(seen.calls.map((c) => c.sessionId).filter(Boolean));
  for (const id of Object.keys(NEGATIVE_CONTROLS)) {
    const graded = await runNegative(browser, id, seed, h);
    state.results.push(graded);
    if (graded.evidence?.sessionId) ids.add(graded.evidence.sessionId);
  }

  // After the controls on purpose: they must not have moved it either.
  if (obs.drewHoldout !== true) {
    const after = await readLift();
    const rollup = await readRollup();
    state.results.push(
      gradeLiftReader({
        reader: after.reader,
        before: liftBefore.body,
        after: after.body,
        rollup: rollup.body,
        rollupRead: rollup.read,
        error: after.error ?? liftBefore.error,
      }),
    );
  }
  state.results.push(gradeLiftRoute((await readLift()).route));

  const hits = ids.size > 0 ? await countLogLines([...ids]) : 0;
  state.results.push(
    gradeBackendLog({ ids: ids.size, hits, error: hits === null ? BACKEND_LOG : null }),
  );
  state.results.push(await driveListingSave());
}

async function main(args) {
  const state = {
    instrument: 'N3 real-app-acceptance (FOLLOW-1344)',
    mode: args.mode,
    startedAt: new Date().toISOString(),
    listingUrl: LISTING_URL,
    decisionOrigin: DECISION_ORIGIN,
    ingestOrigin: INGEST_ORIGIN,
    results: [],
  };
  const hops =
    args.mode === 'arms' ? N3_ARMS_HOPS : args.mode === 'durable' ? N3_DURABLE_HOPS : N3_HOPS;
  const finish = makeFinisher(state, hops);
  // A driver bug must still end in a verdict line, never in a crash with no artefact.
  process.on('unhandledRejection', (err) => {
    state.unhandled = [...(state.unhandled ?? []), String(err).split('\n')[0]];
  });
  let browser = null;
  const watchdog = setTimeout(() => {
    void finish({ aborted: `watchdog after ${String(DEADLINE_MS)} ms` }).then(async () => {
      if (browser) await Promise.race([browser.close().catch(() => {}), sleep(5000)]);
      process.exit(1);
    });
  }, DEADLINE_MS);
  try {
    if (args.mode === 'durable') {
      await runDurable(state);
      return;
    }
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
    if (args.mode === 'arms') await runArms(browser, served, h, state, args.arms);
    else await runFull(browser, served, gate, h, state);
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
    await main(args);
  }
}
