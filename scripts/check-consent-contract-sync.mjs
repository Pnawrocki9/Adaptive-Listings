#!/usr/bin/env node
/**
 * check-consent-contract-sync.mjs — FOLLOW-716
 *
 * Asserts that the caller-facing contract documented in `backlog/HANDOFFS.md`'s FOLLOW-374
 * section — the set of HTTP status codes and `code` string literals
 * `GET /api/v1/consent/platform-registration` and `POST /api/v1/consent/platform-registration`
 * can return — matches what `route.ts` can ACTUALLY emit, per HTTP method.
 *
 * WHY (RETRO-226 §4d DG-2 → RETRO-227 §4d DG-4 → RETRO-228 §4d DG-1 → RETRO-229 §4 DG-2 — four
 * consecutive retros, same shape): the only consumer of this endpoint,
 * app.estalara.com, is out of this repo and shares no release train with it. Its only spec is
 * English prose in HANDOFFS.md, unlinked to the route's source. A PR that changes the route's
 * emittable status/`code` set and forgets the doc drifts the contract silently — this has
 * happened four times, caught only by a human retrospective after the fact, never by CI.
 *
 * This is scripts/check-consent-text-sync.mjs's pattern (PR #633, FOLLOW-705) applied one level
 * up: to the STATUS/CODE CONTRACT rather than the rendered disclosure text. Same shape: a repo
 * script, zero dependencies, self-testing, wired as a hard CI gate.
 *
 * WHAT COUNTS AS THE CONTRACT (derived from source, not hand-maintained):
 *   For each of the GET and POST handlers in `route.ts`, every `NextResponse.json(body, {
 *   status: N })` call site is extracted, and — if the `body` object literal has a `code: '...'`
 *   property — paired with it. The de-duplicated set of `(status, code | null)` tuples per
 *   method is the derived contract. `code: null` means "this status is returned with no `code`
 *   discriminator" (e.g. generic 400/401/500s) — that is itself a fact the doc must state
 *   correctly, so a doc that invents a `code` for an uncoded status is caught too.
 *
 * GET and POST are DISJOINT NAMESPACES, checked separately (FOLLOW-716 AC-5): FOLLOW-685 found a
 * real bug where "409 means safe, proceed" — true of the POST's uncoded 409 (duplicate-nonce
 * replay) — was applied to the GET's `409 brand_identity_not_provisioned` (refuse, do NOT
 * proceed), which means the opposite. This script never unions the two methods' tuples into one
 * set; every comparison below is scoped to one method, so a status shared by both methods (409 on
 * both, with different meanings) cannot silently satisfy one method's row with the other's entry.
 *
 * Both directions are checked (FOLLOW-716 AC-2): a tuple the route can emit that the doc does not
 * list is exactly as wrong as a tuple the doc lists that the route provably cannot emit — a stale
 * removal misleads the out-of-repo caller into thinking a code path is gone when it is not, and a
 * stale addition misleads it into building error-handling for a response it will never receive.
 *
 * Modes:
 *   (no args)      check; exit 0 on match, 1 on drift
 *   --self-test    prove the gate actually catches drift, in both directions and per method
 *
 * Run: node scripts/check-consent-contract-sync.mjs
 * Wired into: .github/workflows/ci.yml (consent-contract-sync job)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ROUTE_PATH = 'apps/control-plane/src/app/api/v1/consent/platform-registration/route.ts';
const DOC_PATH = 'backlog/HANDOFFS.md';

const METHODS = /** @type {const} */ (['GET', 'POST']);

const DOC_SENTINELS = {
  GET: {
    begin: '<!-- BEGIN MACHINE-CHECKED CONTRACT: GET /api/v1/consent/platform-registration -->',
    end: '<!-- END MACHINE-CHECKED CONTRACT: GET /api/v1/consent/platform-registration -->',
  },
  POST: {
    begin: '<!-- BEGIN MACHINE-CHECKED CONTRACT: POST /api/v1/consent/platform-registration -->',
    end: '<!-- END MACHINE-CHECKED CONTRACT: POST /api/v1/consent/platform-registration -->',
  },
};

// ── Route-side extraction ──────────────────────────────────────────────────────

/**
 * Scans forward from `openIdx` (the index of the `(` that opens a call's argument list) and
 * returns the index of the MATCHING `)`, string-aware: parens inside `'...'`, `"..."` and
 * `` `...` `` literals (this route's error messages contain plenty, e.g. "(GET " / "§6.1)") do
 * not count toward depth. `${...}` template-expression interiors are treated as code again so a
 * parenthesized expression inside one would still balance correctly (none exist in this route
 * today, but the scanner must not silently mis-scan if one is added).
 *
 * Fails loud (throws) on unbalanced input rather than returning a guessed index — a contract gate
 * that silently mis-extracts a call is worse than one that refuses to run.
 *
 * @param {string} text
 * @param {number} openIdx
 * @returns {number}
 */
function findMatchingParen(text, openIdx) {
  let depth = 0;
  let state = 'code';
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (state === 'code') {
      if (c === "'") state = 'squote';
      else if (c === '"') state = 'dquote';
      else if (c === '`') state = 'template';
      else if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) return i;
      }
    } else if (state === 'squote') {
      if (c === '\\') i++;
      else if (c === "'") state = 'code';
    } else if (state === 'dquote') {
      if (c === '\\') i++;
      else if (c === '"') state = 'code';
    } else if (state === 'template') {
      if (c === '\\') i++;
      else if (c === '`') state = 'code';
      else if (c === '$' && text[i + 1] === '{') {
        state = 'templateExpr';
        i++;
      }
    } else if (state === 'templateExpr') {
      if (c === '}') state = 'template';
    }
  }
  throw new Error(
    `Unbalanced parentheses scanning a NextResponse.json(...) call starting at offset ${openIdx}. ` +
      `The contract gate cannot extract calls it cannot balance-scan — fix the gate in the same ` +
      `PR as whatever syntax change broke this assumption.`,
  );
}

/**
 * @param {string} body - the source text of one handler function
 * @returns {{ status: number, code: string | null }[]}
 */
function extractCalls(body) {
  const calls = [];
  let i = 0;
  const NEEDLE = 'NextResponse.json(';
  while (true) {
    const idx = body.indexOf(NEEDLE, i);
    if (idx === -1) break;
    const openIdx = idx + NEEDLE.length - 1; // index of the '('
    const closeIdx = findMatchingParen(body, openIdx);
    const callText = body.slice(openIdx + 1, closeIdx);

    const statusMatch = callText.match(/status:\s*(\d+)/);
    if (!statusMatch) {
      throw new Error(
        `A NextResponse.json(...) call in ${ROUTE_PATH} has no literal "status: <number>". ` +
          `Every response this route sends must carry an explicit status for this gate to see it: ` +
          `${JSON.stringify(callText.slice(0, 80))}...`,
      );
    }
    const codeMatch = callText.match(/code:\s*'([a-zA-Z0-9_]+)'/);
    calls.push({ status: Number(statusMatch[1]), code: codeMatch ? codeMatch[1] : null });
    i = closeIdx + 1;
  }
  return calls;
}

/**
 * Slices out the source text of one HTTP method's handler. Relies on `route.ts`'s established
 * shape — GET defined first, POST defined second and last in the file (see the `// ─── GET
 * handler` / `// ─── POST handler` section banners) — rather than a full JS parse. Fails loud if
 * that shape changes so this gate does not silently scan the wrong text.
 *
 * @param {string} src
 * @param {'GET' | 'POST'} method
 * @returns {string}
 */
function extractMethodBody(src, method) {
  const marker = `export async function ${method}(`;
  const occurrences = src.split(marker).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Expected exactly one "${marker}" in ${ROUTE_PATH}, found ${occurrences}. This gate assumes ` +
        `one GET and one POST handler per file — update the gate in the same PR if that changes.`,
    );
  }
  const start = src.indexOf(marker);
  if (method === 'GET') {
    const postMarker = 'export async function POST(';
    const end = src.indexOf(postMarker);
    if (end === -1) {
      throw new Error(
        `Could not find "${postMarker}" after GET in ${ROUTE_PATH} — this gate assumes GET is ` +
          `defined before POST in the same file.`,
      );
    }
    return src.slice(start, end);
  }
  return src.slice(start);
}

/**
 * @param {string} routeSrc
 * @returns {Record<'GET' | 'POST', { status: number, code: string | null }[]>}
 */
function extractRouteContract(routeSrc) {
  /** @type {any} */
  const out = {};
  for (const method of METHODS) {
    out[method] = extractCalls(extractMethodBody(routeSrc, method));
  }
  return out;
}

// ── Doc-side extraction ────────────────────────────────────────────────────────

/**
 * Parses the fenced, sentinel-delimited contract block for one method out of `HANDOFFS.md`.
 * Format (one entry per non-blank, non-comment line): `STATUS` or `STATUS code_literal`.
 * `#`-prefixed lines are comments; blank lines are ignored. This is the "smaller structured
 * block" FOLLOW-716 AC-3 asks for in place of hand-checking the surrounding prose tables — the
 * prose tables stay, for humans; this block is what the gate reads.
 *
 * @param {string} docSrc
 * @param {'GET' | 'POST'} method
 * @returns {{ status: number, code: string | null }[]}
 */
function extractDocContract(docSrc, method) {
  const { begin, end } = DOC_SENTINELS[method];
  const lines = docSrc.split('\n');
  const beginIdx = lines.findIndex((l) => l.trim() === begin);
  const endIdx = lines.findIndex((l) => l.trim() === end);
  const beginCount = lines.filter((l) => l.trim() === begin).length;
  const endCount = lines.filter((l) => l.trim() === end).length;

  if (beginCount !== 1 || endCount !== 1) {
    throw new Error(
      `${DOC_PATH} must contain exactly one\n  "${begin}"\nand one\n  "${end}"\n` +
        `line (found ${beginCount} / ${endCount}). Without them the ${method} contract block ` +
        `boundary is a guess.`,
    );
  }
  if (endIdx < beginIdx) {
    throw new Error(`${DOC_PATH}: END sentinel for ${method} appears before its BEGIN sentinel.`);
  }

  const block = lines.slice(beginIdx + 1, endIdx);
  const entries = [];
  for (const rawLine of block) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('```')) continue;
    const m = line.match(/^(\d{3})(?:\s+([a-zA-Z0-9_]+))?$/);
    if (!m) {
      throw new Error(
        `${DOC_PATH}: unparseable line inside the ${method} contract block: ${JSON.stringify(rawLine)}. ` +
          `Expected "STATUS" or "STATUS code_literal" (e.g. "409 brand_identity_not_provisioned").`,
      );
    }
    entries.push({ status: Number(m[1]), code: m[2] ?? null });
  }
  return entries;
}

/**
 * @param {string} docSrc
 * @returns {Record<'GET' | 'POST', { status: number, code: string | null }[]>}
 */
function extractDocContractAll(docSrc) {
  /** @type {any} */
  const out = {};
  for (const method of METHODS) {
    out[method] = extractDocContract(docSrc, method);
  }
  return out;
}

// ── Compare ───────────────────────────────────────────────────────────────────

const tupleKey = (t) => `${t.status}:${t.code ?? '<no-code>'}`;

/**
 * Compares ONE method's route-derived tuples against ONE method's doc-derived tuples. Never
 * receives or merges the other method's tuples — the caller is responsible for scoping (FOLLOW-716
 * AC-5).
 *
 * @param {'GET' | 'POST'} method
 * @param {{ status: number, code: string | null }[]} routeTuples
 * @param {{ status: number, code: string | null }[]} docTuples
 * @returns {string[]} errors, empty when in sync
 */
function compareMethod(method, routeTuples, docTuples) {
  const errors = [];
  const routeSet = new Map(routeTuples.map((t) => [tupleKey(t), t]));
  const docSet = new Map(docTuples.map((t) => [tupleKey(t), t]));

  for (const [key, t] of routeSet) {
    if (!docSet.has(key)) {
      errors.push(
        `${method} ${ROUTE_PATH} can emit ${t.status}${t.code ? ` (code: '${t.code}')` : ' (no code)'} ` +
          `but ${DOC_PATH}'s ${method} contract block does not document it. Undocumented emission ` +
          `— the out-of-repo caller has no spec for a response it can actually receive.`,
      );
    }
  }
  for (const [key, t] of docSet) {
    if (!routeSet.has(key)) {
      errors.push(
        `${DOC_PATH}'s ${method} contract block documents ${t.status}` +
          `${t.code ? ` (code: '${t.code}')` : ' (no code)'} but ${method} ${ROUTE_PATH} cannot ` +
          `emit it. Stale documentation — the out-of-repo caller may build handling for a response ` +
          `it will never receive, or worse, believe a removed status/code still applies.`,
      );
    }
  }
  return errors;
}

/**
 * @param {{ routeSrc: string, docSrc: string }} sources
 * @returns {{ ok: boolean, errors: string[] }}
 */
function runCheck({ routeSrc, docSrc }) {
  try {
    const routeContract = extractRouteContract(routeSrc);
    const docContract = extractDocContractAll(docSrc);
    const errors = [];
    for (const method of METHODS) {
      errors.push(...compareMethod(method, routeContract[method], docContract[method]));
    }
    return { ok: errors.length === 0, errors };
  } catch (err) {
    return { ok: false, errors: [err.message] };
  }
}

function readSources() {
  return {
    routeSrc: fs.readFileSync(path.join(REPO_ROOT, ROUTE_PATH), 'utf8'),
    docSrc: fs.readFileSync(path.join(REPO_ROOT, DOC_PATH), 'utf8'),
  };
}

// ── Self-test fixture helpers (FOLLOW-720) ─────────────────────────────────────
//
// RETRO-230 §4c TG-1: every case below used to mutate a fixture via `String.replace(anchor, ...)`
// where `anchor` was either a whole fenced block's full literal content or an exact current-value
// literal. `String.replace` silently no-ops when `anchor` is not found, so the FIRST legitimate,
// correctly-done change that touches that literal (e.g. adding a new status to the same block)
// makes the "mutated" fixture byte-identical to the original — the case's `ok === false` assertion
// then fails for the WRONG reason, and the misleading `the gate does not detect drift` message
// blames the gate instead of the stale fixture anchor. The helpers below (a) make a no-op anchor
// throw loudly with a message that names the fixture as stale, not the gate as broken, and (b)
// let cases (b)/(c) mutate the doc's PARSED structure (insert/remove one row inside a
// sentinel-bounded block) instead of matching the block's full current content, so unrelated
// legitimate additions elsewhere in the block cannot invalidate them.

class FixtureStaleError extends Error {
  constructor(where) {
    super(
      `SELF-TEST FIXTURE STALE — the anchor for "${where}" no longer appears verbatim in the ` +
        `current source. This does NOT mean the gate failed to detect drift; it means this ` +
        `self-test case's fixture predates a later, legitimate change and needs a new anchor. ` +
        `Update the anchor at ${where}.`,
    );
    this.name = 'FixtureStaleError';
  }
}

/**
 * `String.replace` with a literal anchor silently no-ops if the anchor is not found. This wrapper
 * makes that a loud, correctly-attributed failure instead of a silent no-op mutation.
 *
 * @param {string} str
 * @param {string} anchor
 * @param {string} replacement
 * @param {string} where - human-readable pointer to the anchor's source location
 * @returns {string}
 */
function mustReplace(str, anchor, replacement, where) {
  if (!str.includes(anchor)) throw new FixtureStaleError(where);
  return str.replace(anchor, replacement);
}

/**
 * Inserts `line` as a new row inside `method`'s sentinel-delimited doc contract block, immediately
 * before its closing fence. Anchored on the BEGIN/END sentinel comments — the same small, stable
 * token pair `extractDocContract` itself requires to be unique — rather than on the block's full
 * current line sequence, so a legitimate addition anywhere else in the block cannot invalidate it.
 *
 * @param {string} docSrc
 * @param {'GET' | 'POST'} method
 * @param {string} line
 * @returns {string}
 */
function insertDocContractLine(docSrc, method, line) {
  const { begin, end } = DOC_SENTINELS[method];
  const lines = docSrc.split('\n');
  const beginIdx = lines.findIndex((l) => l.trim() === begin);
  const endIdx = lines.findIndex((l) => l.trim() === end);
  const beginCount = lines.filter((l) => l.trim() === begin).length;
  const endCount = lines.filter((l) => l.trim() === end).length;
  // FOLLOW-723: mirror extractDocContract's own uniqueness invariant (lines 224-230 above) —
  // a bare findIndex would silently match the FIRST occurrence of a duplicated sentinel line
  // (e.g. if it were ever quoted in prose elsewhere) instead of failing loud on the ambiguity.
  if (beginCount !== 1 || endCount !== 1 || beginIdx === -1 || endIdx === -1) {
    throw new FixtureStaleError(
      `${method} BEGIN/END sentinel pair in ${DOC_PATH} (found ${beginCount} BEGIN / ${endCount} END)`,
    );
  }
  let fenceIdx = -1;
  for (let i = endIdx - 1; i > beginIdx; i--) {
    if (lines[i].trim() === '```') {
      fenceIdx = i;
      break;
    }
  }
  if (fenceIdx === -1) {
    throw new FixtureStaleError(`closing fence of the ${method} contract block in ${DOC_PATH}`);
  }
  const out = lines.slice();
  out.splice(fenceIdx, 0, line);
  return out.join('\n');
}

/**
 * Removes the first row whose trimmed text equals `line` from inside `method`'s sentinel-delimited
 * doc contract block. Anchored on that one row's exact text — the smallest stable token for what
 * this case tests — rather than on the block's full current content.
 *
 * @param {string} docSrc
 * @param {'GET' | 'POST'} method
 * @param {string} line
 * @returns {string}
 */
function removeDocContractLine(docSrc, method, line) {
  const { begin, end } = DOC_SENTINELS[method];
  const lines = docSrc.split('\n');
  const beginIdx = lines.findIndex((l) => l.trim() === begin);
  const endIdx = lines.findIndex((l) => l.trim() === end);
  const beginCount = lines.filter((l) => l.trim() === begin).length;
  const endCount = lines.filter((l) => l.trim() === end).length;
  // FOLLOW-723: mirror extractDocContract's own uniqueness invariant (lines 224-230 above) —
  // a bare findIndex would silently match the FIRST occurrence of a duplicated sentinel line
  // (e.g. if it were ever quoted in prose elsewhere) instead of failing loud on the ambiguity.
  if (beginCount !== 1 || endCount !== 1 || beginIdx === -1 || endIdx === -1) {
    throw new FixtureStaleError(
      `${method} BEGIN/END sentinel pair in ${DOC_PATH} (found ${beginCount} BEGIN / ${endCount} END)`,
    );
  }
  let targetIdx = -1;
  for (let i = beginIdx + 1; i < endIdx; i++) {
    if (lines[i].trim() === line) {
      targetIdx = i;
      break;
    }
  }
  if (targetIdx === -1) {
    throw new FixtureStaleError(
      `the row ${JSON.stringify(line)} inside the ${method} contract block in ${DOC_PATH}`,
    );
  }
  const out = lines.slice();
  out.splice(targetIdx, 1);
  return out.join('\n');
}

/**
 * Runs one self-test case. `fn` returns the assertion result, or throws `FixtureStaleError` if its
 * fixture mutation could not be applied to the current source — the two outcomes are reported
 * distinctly by `selfTest()` below instead of both surfacing as "the gate does not detect drift".
 *
 * @param {{ name: string, status: 'PASS' | 'FAIL' | 'STALE', detail?: string }[]} results
 * @param {string} name
 * @param {() => boolean} fn
 */
function runCase(results, name, fn) {
  try {
    results.push({ name, status: fn() ? 'PASS' : 'FAIL' });
  } catch (err) {
    if (err instanceof FixtureStaleError) {
      results.push({ name, status: 'STALE', detail: err.message });
    } else {
      throw err;
    }
  }
}

// ── Self-test (validates the gate itself; red-first proof) ────────────────────

function selfTest() {
  const sources = readSources();
  /** @type {{ name: string, status: 'PASS' | 'FAIL' | 'STALE', detail?: string }[]} */
  const results = [];

  runCase(results, 'unmodified repo state PASSES', () => runCheck(sources).ok === true);

  // (a) route emits a status/code the doc does not document — undocumented ADDITION.
  //     FOLLOW-723 AC3 audit: this `mustReplace` targets `routeSrc` file-wide (`str.includes` /
  //     `.replace()` over the whole file), while the real check slices per-method via
  //     `extractMethodBody` before `extractCalls` runs. Verdict: SAFE TODAY, NOT STRUCTURALLY —
  //     the anchor line is unique in `route.ts` (`grep -c` → 1), so the file-wide replace lands in
  //     POST's body, the only place it exists. This is the same class of region-blindness FOLLOW-723
  //     fixed in `check-consent-text-sync.mjs`'s `docSrc` cases, just not (yet) manufactured here —
  //     `route.ts` carries no append-only changelog that quotes return statements verbatim, so
  //     nothing regenerates a duplicate the way `PRIVACY_NOTICE_TEMPLATE.md` did for the doc gate.
  //     If a future change ever produces a second literal match of this anchor across GET/POST, this
  //     case must be re-scoped to `extractMethodBody(routeSrc, 'POST')` first, mirroring
  //     `mustReplaceInDocBlock` — do not assume file-wide uniqueness holds by construction.
  runCase(results, 'route-side undocumented addition (POST 201 + new code) FAILS', () => {
    const anchor = 'return NextResponse.json({ consent_record_id: recordId }, { status: 201 });';
    const mutated = {
      ...sources,
      routeSrc: mustReplace(
        sources.routeSrc,
        anchor,
        "return NextResponse.json({ consent_record_id: recordId, code: 'brand_new_undocumented_code' }, { status: 201 });",
        `${ROUTE_PATH} — POST's 201 return statement`,
      ),
    };
    return runCheck(mutated).ok === false;
  });

  // (b) doc documents a status/code the route cannot emit — stale/phantom addition. Inserted as a
  //     new row anchored on the POST block's sentinels (see insertDocContractLine), not on the
  //     block's full current content, so an unrelated legitimate addition elsewhere in the block
  //     cannot no-op this mutation.
  runCase(results, 'doc-side stale/phantom entry (POST 418 never emitted) FAILS', () => {
    const mutated = {
      ...sources,
      docSrc: insertDocContractLine(sources.docSrc, 'POST', '418 teapot_never_emitted'),
    };
    return runCheck(mutated).ok === false;
  });

  // (c) GET/POST disjointness: the GET's coded 409 must NOT be treated as satisfying the POST's
  //     uncoded 409, and vice versa. Simulate by removing ONLY the GET contract block's 409 row
  //     (anchored on that row's exact text, not the whole fenced block) so ONLY the POST block
  //     still lists a 409 (uncoded) — this must still fail, because GET's 409 must be documented
  //     in GET's OWN block, not "covered" by POST's 409 entry existing somewhere in the file.
  //     FOLLOW-723: if this row's anchor (`409 brand_identity_not_provisioned`) ever needs
  //     replacing, the replacement's STATUS must have this exact shape for the case to still mean
  //     anything — CODED in one method's block (e.g. GET's `409 <code>`) and the SAME BARE STATUS,
  //     UNCODED, in the other method's block (e.g. POST's plain `409`). Without that pairing,
  //     removing the row only exercises "a documented tuple went missing", not the cross-method
  //     bleed-through this case exists to catch, and a future STALE here would not be actionable
  //     without re-deriving that property from scratch.
  runCase(
    results,
    'GET contract block missing its own 409 row FAILS even though POST documents a 409 (methods scoped separately)',
    () => {
      const mutated = {
        ...sources,
        docSrc: removeDocContractLine(sources.docSrc, 'GET', '409 brand_identity_not_provisioned'),
      };
      const result = runCheck(mutated);
      return result.ok === false && result.errors.some((e) => e.startsWith('GET '));
    },
  );

  // Sentinel-removal fail-closed check, same shape as check-consent-text-sync.mjs. Anchored on the
  // sentinel text itself — the exact thing being removed — which is inherently stable.
  // FOLLOW-723 AC3 audit: this `mustReplace` targets `docSrc` (`backlog/HANDOFFS.md`) file-wide.
  // Verdict: SAFE — `DOC_SENTINELS.GET.begin` is a full unique HTML-comment token
  // (`grep -c` → 1 in `backlog/HANDOFFS.md` today), unlike a short prose phrase, so there is no
  // append-only-changelog-style mechanism in this doc that could regenerate a duplicate of a full
  // sentinel line the way `PRIVACY_NOTICE_TEMPLATE.md`'s changelog regenerated bracketDrift's
  // anchor. No region-scoping needed here.
  runCase(results, 'removed GET BEGIN sentinel FAILS', () => {
    const mutated = {
      ...sources,
      docSrc: mustReplace(
        sources.docSrc,
        DOC_SENTINELS.GET.begin,
        '<!-- BEGIN machine-checked contract: get -->',
        `${DOC_PATH} — DOC_SENTINELS.GET.begin`,
      ),
    };
    return runCheck(mutated).ok === false;
  });

  let failed = 0;
  let stale = 0;
  for (const r of results) {
    if (r.status === 'PASS') {
      console.log(`PASS  [self-test] ${r.name}`);
    } else if (r.status === 'FAIL') {
      console.log(`FAIL  [self-test] ${r.name}`);
      failed++;
    } else {
      console.log(`STALE [self-test] ${r.name}`);
      console.log(`      ${r.detail}`);
      stale++;
    }
  }
  console.log('');
  if (failed > 0) {
    console.log(
      `=== SELF-TEST FAILED (${failed}/${results.length}) — the gate does not detect drift ===`,
    );
  }
  if (stale > 0) {
    console.log(
      `=== SELF-TEST FIXTURE STALE (${stale}/${results.length}) — one or more self-test fixture ` +
        'anchors predate a later, legitimate change; the gate itself is UNPROVEN either way — ' +
        'update the named anchor(s) above to match the current source, then re-run ===',
    );
  }
  if (failed > 0 || stale > 0) {
    process.exit(1);
  }
  console.log(`=== SELF-TEST PASSED (${results.length}/${results.length}) ===`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const mode = process.argv[2] ?? '';

if (mode === '--self-test') {
  selfTest();
} else {
  console.log('=== Consent Contract Sync Check (FOLLOW-716) ===');
  console.log(`Route (source of truth): ${ROUTE_PATH}`);
  console.log(`Doc (caller-facing spec): ${DOC_PATH} — FOLLOW-374 section, per-method blocks`);
  console.log('');

  const result = runCheck(readSources());
  if (result.ok) {
    console.log('PASS  GET and POST status/code contracts match, in both directions.');
    console.log('');
    console.log('=== CONSENT CONTRACT IN SYNC — PASS ===');
    process.exit(0);
  }

  for (const e of result.errors) console.log(`FAIL  ${e}`);
  console.log('');
  console.log('=== CONSENT CONTRACT OUT OF SYNC — FAIL ===');
  console.log('');
  console.log('To fix: edit BOTH artifacts in the same PR so they agree —');
  console.log(`  1. what the route emits: ${ROUTE_PATH} (GET and POST handlers)`);
  console.log(
    `  2. what the doc promises: ${DOC_PATH} FOLLOW-374 section's MACHINE-CHECKED CONTRACT blocks`,
  );
  console.log(
    "  GET and POST are separate blocks — do not add an entry to the wrong method's block.",
  );
  process.exit(1);
}
