#!/usr/bin/env node
'use strict';

/**
 * Rule K.2 consumer-side swallow guard — FOLLOW-625 (mechanises RETRO-205 §6 P-2,
 * scope-amended by RETRO-206 §4a LG-2).
 *
 * WHY THIS GUARD EXISTS
 * ─────────────────────
 * CONVENTIONS_PATCH.md Rule K.2 already states the consumer-side obligation ("A
 * producer that fails loud paired with a consumer that swallows the failure … is
 * the same defect one layer up") AND already ships the detecting grep in its
 * Verification block — but nothing runs it. The exact defect it describes shipped
 * FOUR times in a row (FOLLOW-595 → 596 → 600, then the twins fixed in FOLLOW-630)
 * and was caught only by post-merge retros, several merges late. The class is:
 *
 *     a CLIENT component GETs its editable config, populates form state from the
 *     response, and SWALLOWS a failed load (empty / comment-only / log-only catch)
 *     — so a subsequent Save writes DEFAULTS back over the tenant's real config.
 *
 * FOLLOW-624 tried to close the class with a NARROWED grep (`grep …/app/admin`)
 * instead of Rule K.2's repo-wide `apps/` grep and missed three byte-identical
 * twins (RETRO-206) — one of them OUTSIDE `src/app/**`
 * (`components/generation-model-settings.tsx`). This guard therefore scans BOTH
 * `apps/control-plane/src/app/**` AND `apps/control-plane/src/components/**`.
 *
 * WHAT IS DETECTED (the COVERED shapes) — Rule AE discipline
 * ─────────────────────────────────────────────────────────
 * A VIOLATION is a `.catch(<handler>)` on a `fetch(...)` PROMISE CHAIN, inside a
 * `'use client'` component under the covered scope, where:
 *   (1) the chain populates editable state — some `.then(...)` in the same chain
 *       calls a React setter (`/^set[A-Z]/`), i.e. the failed load feeds form
 *       state that a later Save writes back; AND
 *   (2) the `<handler>` is a SWALLOW — it neither surfaces the error nor re-throws:
 *         .catch(() => {})                    empty arrow body
 *         .catch(() => { <comment only> })    comment-only body
 *         .catch(() => undefined)             returns undefined
 *         .catch(() => void 0)                returns void
 *         .catch(console.error) / .catch(console.warn) / .catch(console.log)
 *         .catch(noop) / .catch(ignore) / .catch(ignoreError) / .catch(swallow)
 *                                             a named no-op alias
 *         .catch((e) => { console.error(e); })  log-only body (no state, no throw)
 *
 * A handler is ACCEPTED (NOT a swallow) when its body:
 *   - calls a React setter `/^set[A-Z]/` (e.g. `setLoadStatus('error')`,
 *     `setLoadError(...)`) — this is exactly the shape the six FOLLOW-624/630
 *     fixes landed, so all six PASS; OR
 *   - contains a `throw` (re-throws / converts to an error boundary); OR
 *   - calls anything other than `console.*` (e.g. `captureException(err)` →
 *     Sentry) — an observable sink is not a swallow.
 *
 * WHAT IS **NOT** DETECTED (DOCUMENTED RESIDUALS, not silent gaps) — Rule AE
 * ─────────────────────────────────────────────────────────────────────────
 *   - `try { const r = await fetch(...); setX(...) } catch { }` — the block-form
 *     `catch {}` (as opposed to the promise `.catch()`). None of the four shipped
 *     instances nor the copy-forward chain used it; the reproduced/negative-control
 *     shape is the `.catch()` chain form. Tracked as a residual; add coverage if a
 *     block-form instance ever appears.
 *   - `X.json().catch(() => ({}))` — a defensive JSON-parse fallback on `res.json()`
 *     (NOT on the fetch terminal). Excluded structurally (the `.catch` object is a
 *     `.json()` call). These parse an ERROR BODY, they do not populate config.
 *   - A `.catch()` whose handler is an arbitrary NAMED identifier we cannot
 *     introspect (other than the small no-op alias set above) — accepted; a named
 *     handler almost always does real work. Residual by design.
 *   - Fetch chains with NO state setter (pure fire-and-forget writes) — out of
 *     scope here (that is Rule K.2's fire-and-forget amendment / the
 *     check-fire-and-forget-sinks.sh guard's territory).
 *
 * ALLOW-LIST (explicit, annotated — AC requirement)
 * ─────────────────────────────────────────────────
 * A legitimate swallow (a read-only display panel whose state is NEVER saved back,
 * so a failed load cannot clobber config) is exempted via an explicit entry in
 * ALLOWLIST below: { file, marker, reason }. The entry matches ONLY a swallow whose
 * handler source contains `marker`, so it exempts the SPECIFIC known-safe shape and
 * does NOT blanket-exempt a future config swallow added to the same file.
 *
 * EXIT CODES
 * ──────────
 *   0 = pass (no un-allow-listed consumer-side swallows found)
 *   1 = violation (one or more found)
 *
 * Run: node scripts/check-k2-consumer-swallow.cjs [scanRoot ...]
 * Default scan roots: apps/control-plane/src/app  apps/control-plane/src/components
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ts = require('typescript');

const ROOT = execSync('git rev-parse --show-toplevel').toString().trim();

const DEFAULT_SCAN_ROOTS = ['apps/control-plane/src/app', 'apps/control-plane/src/components'];

// ─── Explicit, annotated allow-list (read-only surfaces, never saved back) ──────
// Each entry exempts ONLY a swallow whose handler text contains `marker`, in `file`.
const ALLOWLIST = [
  {
    file: 'apps/control-plane/src/app/dashboard/analytics/page.tsx',
    marker: 'Panel shows empty state',
    reason:
      'read-only bandit-weights display panel; state is rendered, never POSTed back — a failed load cannot clobber config.',
  },
  {
    file: 'apps/control-plane/src/app/dashboard/analytics/page.tsx',
    marker: 'Resume failed silently',
    reason: 'per-archetype resume affordance (user can retry); does not save loaded config back.',
  },
  {
    file: 'apps/control-plane/src/components/analytics/analytics-view.tsx',
    marker: 'Panel shows empty state',
    reason: 'read-only bandit-weights display panel; state is rendered, never PUT/POSTed back.',
  },
  {
    file: 'apps/control-plane/src/components/analytics/analytics-view.tsx',
    marker: 'Resume failed silently',
    reason: 'per-archetype resume affordance (user can retry); does not save loaded config back.',
  },
];

const NOOP_ALIASES = new Set(['noop', 'ignore', 'ignoreError', 'swallow']);

// ─── File discovery ────────────────────────────────────────────────────────────

function findTsxFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findTsxFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) {
      results.push(full);
    }
  }
  return results;
}

function parse(absPath) {
  const text = fs.readFileSync(absPath, 'utf8');
  return {
    text,
    sourceFile: ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
  };
}

// ─── AST helpers ────────────────────────────────────────────────────────────────

/** Is this file a client component? (has a 'use client' / "use client" directive) */
function isClientComponent(text) {
  return /^\s*['"]use client['"]/m.test(text);
}

/** Walk the object chain LEFT of a `.catch(...)` back to its base; true iff the
 *  base is a `fetch(...)` call. Handles `fetch(u).then(...).then(...).catch(...)`. */
function chainStartsWithFetch(catchCall) {
  // catchCall.expression is a PropertyAccessExpression `<obj>.catch`
  let node = catchCall.expression.expression; // the <obj> the .catch is called on
  while (node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && callee.text === 'fetch') return true;
      if (ts.isPropertyAccessExpression(callee)) {
        node = callee.expression; // step left: `x.then(...)` -> `x`
        continue;
      }
      // e.g. fetch(...) where callee is a member of something else — step into callee
      node = callee;
      continue;
    }
    if (ts.isPropertyAccessExpression(node)) {
      node = node.expression;
      continue;
    }
    if (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node)) {
      node = node.expression;
      continue;
    }
    break;
  }
  return false;
}

/** True iff the `.catch`'s immediate object is a `.json()` call — i.e. this is a
 *  defensive `res.json().catch(...)` body-parse, NOT a fetch-terminal swallow. */
function isJsonParseCatch(catchCall) {
  const obj = catchCall.expression.expression;
  return (
    ts.isCallExpression(obj) &&
    ts.isPropertyAccessExpression(obj.expression) &&
    obj.expression.name.text === 'json'
  );
}

/** True iff any descendant of `node` is a call to a React setter `/^set[A-Z]/`. */
function chainPopulatesState(node) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (ts.isCallExpression(n)) {
      const c = n.expression;
      if (ts.isIdentifier(c) && /^set[A-Z]/.test(c.text)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function isConsoleCall(callExpr) {
  const c = callExpr.expression;
  return (
    ts.isPropertyAccessExpression(c) &&
    ts.isIdentifier(c.expression) &&
    c.expression.text === 'console'
  );
}

/**
 * Classify the argument to `.catch(...)`. Returns true iff it SWALLOWS the error
 * (does not surface it via a setter, does not re-throw, does not call any
 * non-console sink).
 */
function handlerSwallows(handler) {
  // Bare identifier: `.catch(noop)`
  if (ts.isIdentifier(handler)) {
    return NOOP_ALIASES.has(handler.text);
  }
  // `.catch(console.error)` / `.catch(console.warn)` etc.
  if (ts.isPropertyAccessExpression(handler)) {
    return ts.isIdentifier(handler.expression) && handler.expression.text === 'console';
  }
  if (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler)) {
    // Anything else we cannot introspect — treat as NON-swallow (documented residual).
    return false;
  }

  const body = handler.body;

  // Expression-bodied arrow: `() => undefined`, `() => void 0`, `() => ({})`, `() => setX()`
  if (!ts.isBlock(body)) {
    if (body.kind === ts.SyntaxKind.UndefinedKeyword) return true;
    if (ts.isIdentifier(body) && body.text === 'undefined') return true;
    if (ts.isVoidExpression(body)) return true;
    if (ts.isCallExpression(body)) {
      const c = body.expression;
      if (ts.isIdentifier(c) && /^set[A-Z]/.test(c.text)) return false; // sets state
      if (isConsoleCall(body)) return true; // log-only
      return false; // some other call — observable sink
    }
    // returns a literal / object / member — no error surfacing => swallow
    return true;
  }

  // Block-bodied arrow / function.
  let swallows = true;
  const visit = (n) => {
    if (!swallows) return;
    if (ts.isThrowStatement(n)) {
      swallows = false;
      return;
    }
    if (ts.isCallExpression(n)) {
      const c = n.expression;
      if (ts.isIdentifier(c) && /^set[A-Z]/.test(c.text)) {
        swallows = false; // surfaces via a setter
        return;
      }
      if (!isConsoleCall(n)) {
        swallows = false; // a non-console call = an observable sink (e.g. Sentry)
        return;
      }
      // console.* call: keep scanning (log-only stays a swallow unless something else)
    }
    ts.forEachChild(n, visit);
  };
  visit(body);
  return swallows;
}

function relPath(absPath) {
  return path.relative(ROOT, absPath);
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
}

function isAllowlisted(fileRel, handlerText) {
  // K2_GUARD_NO_ALLOWLIST=1 disables the allow-list. Used ONLY by the fixture
  // proof to demonstrate the allow-listed analytics swallows ARE detected (the
  // allow-list is load-bearing, not masking a detector that sees nothing).
  if (process.env.K2_GUARD_NO_ALLOWLIST === '1') return false;
  return ALLOWLIST.some((e) => e.file === fileRel && handlerText.includes(e.marker));
}

// ─── Scan ────────────────────────────────────────────────────────────────────

function scanFile(absPath, findings) {
  const { text, sourceFile } = parse(absPath);
  if (!isClientComponent(text)) return;
  const fileRel = relPath(absPath);

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'catch' &&
      node.arguments.length === 1
    ) {
      const isFetch = chainStartsWithFetch(node);
      const isJson = isJsonParseCatch(node);
      if (isFetch && !isJson && chainPopulatesState(node.expression.expression)) {
        const handler = node.arguments[0];
        if (handlerSwallows(handler)) {
          const handlerText = handler.getText(sourceFile);
          if (!isAllowlisted(fileRel, handlerText)) {
            findings.push({
              file: fileRel,
              line: lineOf(sourceFile, node),
              handler: handlerText.replace(/\s+/g, ' ').slice(0, 80),
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function main() {
  const scanRoots = process.argv.slice(2);
  const roots = scanRoots.length > 0 ? scanRoots : DEFAULT_SCAN_ROOTS;

  console.log('=== Rule K.2 consumer-side swallow guard (FOLLOW-625) ===');
  console.log(`Scanning: ${roots.join('  ')}`);
  console.log('');

  const files = [];
  for (const r of roots) {
    files.push(...findTsxFiles(path.join(ROOT, r)));
  }

  const findings = [];
  for (const f of files) {
    scanFile(f, findings);
  }

  console.log(`Scanned ${files.length} .tsx file(s).`);
  console.log('');

  if (findings.length === 0) {
    console.log('PASS: No consumer-side fetch-load swallows found.');
    console.log('');
    console.log('Every client component that GETs editable config and populates form state');
    console.log('surfaces a failed load (error state / re-throw), not a silent default.');
    process.exit(0);
  }

  console.log('FAIL: consumer-side swallow of a failed config load (Rule K.2):');
  console.log('');
  for (const v of findings) {
    console.log(`  ${v.file}:${v.line}`);
    console.log(`      .catch handler: ${v.handler}`);
  }
  console.log('');
  console.log('Each site above GETs editable state on a fetch(...) chain but its .catch');
  console.log('handler DISCARDS the error (empty / comment-only / log-only / no-op).');
  console.log('On a failed load the component keeps DEFAULTS looking like real config; the');
  console.log("next Save then clobbers the tenant's stored config (FOLLOW-595→596→600→630).");
  console.log('');
  console.log('FIX: on a failed GET (`!r.ok` OR reject), set a visible error state');
  console.log("     (e.g. setLoadStatus('error')) and DISABLE the Save control — do");
  console.log('     not silently substitute defaults. See the six editors fixed by');
  console.log('     FOLLOW-624 (PR #608) / FOLLOW-630 (PR #609) for the shape.');
  console.log('');
  console.log('ALLOW-LIST: if the swallow is a read-only panel never saved back, add an');
  console.log('     annotated entry to ALLOWLIST in scripts/check-k2-consumer-swallow.cjs.');
  console.log('');
  console.log('See CONVENTIONS_PATCH.md Rule K.2 (consumer-side clause).');
  process.exit(1);
}

main();
