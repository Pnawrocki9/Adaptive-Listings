#!/usr/bin/env node
'use strict';

/**
 * Staff-write audit atomicity guard — ADR-0018 §3a / FOLLOW-607, tightened to be
 * SCOPE-AWARE by FOLLOW-608.
 *
 * Every staff-audited WRITE — a route that both performs a data mutation and
 * records it in staff_audit_log — MUST commit the mutation and the audit row in
 * ONE db.transaction(), so a mutation can never outlive a missing/failed audit
 * row (RETRO-190 §4a). Reference implementation (FOLLOW-605):
 *   apps/control-plane/src/app/api/quiz/config/route.ts
 *
 * FOLLOW-607 shipped a file-level PRESENCE check (".transaction( appears
 * SOMEWHERE in the file"). RETRO-192/193 found this is blind to three
 * constructible bypasses that all pass while violating ADR-0018 §3a:
 *   1. An unrelated db.transaction() elsewhere in the file, with the real
 *      mutation + audit insert sitting OUTSIDE any transaction.
 *   2. The staffAuditLog insert factored into a shared helper (possibly in
 *      another file) — the route file no longer contains the literal insert,
 *      so the presence check silently treats it as agency-only (no audit).
 *   3. A raw-SQL mutation (`db.execute(sql\`UPDATE ...\`)`) that the
 *      `.update(`/`.delete(`/`.insert(` regex never recognised as a mutation
 *      at all, so the file is misclassified as "audit-of-a-read" and SKIPped.
 *
 * FOLLOW-608 replaces the bash regex heuristic with a TypeScript-AST walk (the
 * `typescript` package is already a repo devDependency — no new dependency
 * added) that proves the audited mutation and the `insert(staffAuditLog)` call
 * are lexically INSIDE THE SAME `.transaction(async (tx) => { ... })` callback,
 * not just present somewhere in the file. Using the real AST also means:
 *   - whitespace inside a call (`.insert( staffAuditLog )`) and qualified forms
 *     (`.insert(schema.staffAuditLog)`) are matched correctly (no more brittle
 *     literal-substring/regex matching that a formatter or refactor can dodge).
 *   - comments never masquerade as code (the parser only sees real tokens; no
 *     separate comment-stripping pass is needed).
 *   - a raw-SQL `.execute(sql\`...\`)` call is recognised as a mutation when its
 *     leading SQL keyword is UPDATE/INSERT/DELETE.
 *   - an audit insert factored into an imported local helper (relative or `@/`
 *     alias import, resolved on disk, bounded recursion) is detected and BANS
 *     the pattern — an audit insert that lives in a separate module opens its
 *     own DB client and can never be proven to commit atomically with the
 *     route's own mutation, so this is always a FAIL, never a silent SKIP.
 *
 * Exemption: a route may still opt out (a genuinely single-store single-write
 * path where a transaction wrapper is meaningless) with an inline comment
 * anywhere in the raw file text:
 *   // staff-write-atomicity-exempt: <reason>
 * NEW (FOLLOW-608, AC 5): the exemption is DISALLOWED on any route that gates on
 * `access.isSuperadmin` (rank-3/superadmin-only) — the highest-blast-radius
 * staff writes (e.g. the future FOLLOW-598 bandit-weight route) must not be able
 * to silently opt out of atomicity enforcement. Such a file still FAILs.
 *
 * Scan set: <scan_root>/**\/route.ts, default apps/control-plane/src/app/api
 * (full scan, not diff-scoped — the route set is small and this is more robust
 * than tracking which files changed).
 *
 * This is still file-level in the sense that it does not require EVERY
 * mutation/audit pair in a file to share a scope — it requires at least one
 * matching (mutation, audit) pair sharing a transaction scope for the file to
 * pass. That matches the granularity of the routes this guard protects today
 * (one mutation + one audit insert per staff-write branch).
 *
 * Exit codes: 0 = pass, 1 = violation found.
 * Run: node scripts/check-staff-write-atomicity.cjs [scan_root]
 * Default scan_root: apps/control-plane/src/app/api
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ts = require('typescript');

const ROOT = execSync('git rev-parse --show-toplevel').toString().trim();
const scanRootRel = process.argv[2] || 'apps/control-plane/src/app/api';
const scanRootAbs = path.join(ROOT, scanRootRel);

// ─── File discovery ────────────────────────────────────────────────────────

function findRouteFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findRouteFiles(full));
    } else if (entry.isFile() && entry.name === 'route.ts') {
      results.push(full);
    }
  }
  return results;
}

// ─── AST helpers ───────────────────────────────────────────────────────────

function parse(absPath) {
  const text = fs.readFileSync(absPath, 'utf8');
  return {
    text,
    sourceFile: ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
  };
}

/** True iff `argNode` refers to `staffAuditLog`, bare or qualified (`x.staffAuditLog`). */
function isStaffAuditLogRef(argNode) {
  if (!argNode) return false;
  if (ts.isIdentifier(argNode)) return argNode.text === 'staffAuditLog';
  if (ts.isPropertyAccessExpression(argNode)) return argNode.name.text === 'staffAuditLog';
  return false;
}

/** Reconstructs the raw SQL template text of a `sql\`...\`` tagged template. */
function rawSqlText(taggedTemplate) {
  return taggedTemplate.template.getText().replace(/^`/, '').trimStart();
}

/** True iff `callNode` is `.execute(sql\`UPDATE|INSERT|DELETE ...\`)`. */
function isRawSqlMutationCall(callNode) {
  const arg = callNode.arguments[0];
  if (!arg || !ts.isTaggedTemplateExpression(arg)) return false;
  if (arg.tag.getText() !== 'sql') return false;
  return /^(UPDATE|DELETE|INSERT)\b/i.test(rawSqlText(arg));
}

/**
 * Walks the whole file collecting:
 *   - auditCalls:    CallExpression nodes that insert into staffAuditLog
 *   - mutationCalls: CallExpression nodes that are .update(/.delete(/a non-audit
 *                     .insert(/a raw-SQL mutation .execute(sql\`...\`)
 *   - txScopeNodes:  the ArrowFunction/FunctionExpression callback argument of
 *                     every `.transaction(...)` call
 */
function collectFileFacts(sourceFile) {
  const auditCalls = [];
  const mutationCalls = [];
  const txScopeNodes = new Set();

  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;

      if (method === 'transaction') {
        const fnArg = node.arguments.find(
          (a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a),
        );
        if (fnArg) txScopeNodes.add(fnArg);
      } else if (method === 'insert') {
        if (isStaffAuditLogRef(node.arguments[0])) {
          auditCalls.push(node);
        } else {
          mutationCalls.push(node);
        }
      } else if (method === 'update' || method === 'delete') {
        mutationCalls.push(node);
      } else if (method === 'execute' && isRawSqlMutationCall(node)) {
        mutationCalls.push(node);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { auditCalls, mutationCalls, txScopeNodes };
}

/** The innermost recorded tx-scope function node enclosing `node`, or null. */
function findContainingTxScope(node, txScopeNodes) {
  let cur = node.parent;
  while (cur) {
    if (txScopeNodes.has(cur)) return cur;
    cur = cur.parent;
  }
  return null;
}

// ─── Local-import resolution (bypass 2: helper-factored audit insert) ─────

function findSrcRoot(startDir) {
  let dir = startDir;
  for (;;) {
    if (path.basename(dir) === 'src') return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolveFileCandidates(basePath) {
  const candidates = [
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx'),
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

/** Local (relative or `@/`-alias) import targets of a file, resolved to real paths on disk. */
function collectLocalImports(fileAbsPath, sourceFile) {
  const dir = path.dirname(fileAbsPath);
  const results = [];

  function visit(node) {
    if (
      ts.isImportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const spec = node.moduleSpecifier.text;
      let basePath = null;
      if (spec.startsWith('./') || spec.startsWith('../')) {
        basePath = path.resolve(dir, spec);
      } else if (spec.startsWith('@/')) {
        const srcRoot = findSrcRoot(dir);
        if (srcRoot) basePath = path.join(srcRoot, spec.slice(2));
      }
      if (basePath) {
        const resolved = resolveFileCandidates(basePath);
        if (resolved) results.push(resolved);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return results;
}

/**
 * Bounded (depth 3) search of a route file's local import graph for a module
 * that itself performs a staffAuditLog insert. Returns the resolved absolute
 * path of the first such module found, or null.
 */
function findHelperFactoredAudit(routeAbsPath, routeSourceFile) {
  const MAX_DEPTH = 3;
  const visited = new Set([routeAbsPath]);
  const queue = collectLocalImports(routeAbsPath, routeSourceFile).map((p) => ({
    path: p,
    depth: 1,
  }));

  while (queue.length > 0) {
    const { path: candidatePath, depth } = queue.shift();
    if (visited.has(candidatePath)) continue;
    visited.add(candidatePath);
    if (!fs.existsSync(candidatePath)) continue;

    const { sourceFile } = parse(candidatePath);
    const facts = collectFileFacts(sourceFile);
    if (facts.auditCalls.length > 0) return candidatePath;

    if (depth < MAX_DEPTH) {
      for (const next of collectLocalImports(candidatePath, sourceFile)) {
        queue.push({ path: next, depth: depth + 1 });
      }
    }
  }
  return null;
}

// ─── Main scan ─────────────────────────────────────────────────────────────

console.log(
  '=== Staff-write audit atomicity check (ADR-0018 §3a / FOLLOW-607, scope-aware FOLLOW-608) ===',
);
console.log(`Scanning: ${scanRootRel}/**/route.ts`);
console.log('');

const routeFiles = findRouteFiles(scanRootAbs).sort();

if (routeFiles.length === 0) {
  console.log(`No route.ts files found under ${scanRootRel} — nothing to check.`);
  process.exit(0);
}

let failures = 0;
const exemptionSightings = [];

for (const absPath of routeFiles) {
  const relPath = path.relative(ROOT, absPath);
  const { text, sourceFile } = parse(absPath);
  const facts = collectFileFacts(sourceFile);

  // Bypass 2: no local audit insert, but a real mutation exists — check whether
  // the audit insert was factored into an imported local helper instead.
  let helperFactoredAudit = null;
  if (facts.auditCalls.length === 0 && facts.mutationCalls.length > 0) {
    helperFactoredAudit = findHelperFactoredAudit(absPath, sourceFile);
  }

  if (facts.auditCalls.length === 0 && !helperFactoredAudit) {
    continue; // not a staff-audited write at all — nothing to check
  }

  if (helperFactoredAudit) {
    console.log(`FAIL: ${relPath} performs a data mutation and records it via a`);
    console.log(
      `      staffAuditLog insert factored into ${path.relative(ROOT, helperFactoredAudit)},`,
    );
    console.log(`      not inside this route's own db.transaction(). An audit insert factored`);
    console.log(`      into a separate module opens its own DB client and can never be proven`);
    console.log(`      to commit/roll back atomically with the mutation (FOLLOW-608 bypass 2).`);
    console.log(`      Inline the staffAuditLog insert directly inside this route's`);
    console.log(`      db.transaction(async (tx) => { ... }).`);
    failures += 1;
    continue;
  }

  if (facts.mutationCalls.length === 0) {
    console.log(`SKIP: ${relPath} — insert(staffAuditLog) present but no other data mutation`);
    console.log(`      (audit-of-a-read/export, not a mutate+audit shape).`);
    continue;
  }

  // Both an audit insert and a mutation exist locally — scope-aware check: is
  // there at least one (mutation, audit) pair sharing the SAME tx-scope node?
  const auditScopes = new Set(
    facts.auditCalls.map((n) => findContainingTxScope(n, facts.txScopeNodes)).filter(Boolean),
  );
  const hasMatchingPair = facts.mutationCalls.some((m) => {
    const scope = findContainingTxScope(m, facts.txScopeNodes);
    return scope !== null && auditScopes.has(scope);
  });

  if (hasMatchingPair) {
    console.log(
      `OK:   ${relPath} — mutation + insert(staffAuditLog), both inside the SAME db.transaction().`,
    );
    continue;
  }

  const isExempt = /staff-write-atomicity-exempt:/.test(text);
  const isSuperadminGated = /\bisSuperadmin\b/.test(text);

  if (isExempt && isSuperadminGated) {
    console.log(`FAIL: ${relPath} carries a 'staff-write-atomicity-exempt:' comment but also`);
    console.log(`      gates on access.isSuperadmin (rank-3/superadmin-only). FOLLOW-608`);
    console.log(`      DISALLOWS this exemption on superadmin-gated routes — the`);
    console.log(`      highest-blast-radius staff writes must not silently opt out of`);
    console.log(`      atomicity enforcement. Wrap the mutation + insert(staffAuditLog) in`);
    console.log(`      ONE db.transaction() instead of exempting.`);
    exemptionSightings.push({ relPath, disallowed: true });
    failures += 1;
    continue;
  }

  if (isExempt) {
    console.log(`EXEMPT: ${relPath} — documented opt-out present, not counted as a failure.`);
    exemptionSightings.push({ relPath, disallowed: false });
    continue;
  }

  console.log(`FAIL: ${relPath} contains a data mutation + insert(staffAuditLog) but they are`);
  console.log(`      NOT both inside the SAME db.transaction().`);
  console.log(`      ADR-0018 §3a requires the mutation and its staff_audit_log row to`);
  console.log(`      commit or roll back TOGETHER in one db.transaction() (reference`);
  console.log(`      impl: apps/control-plane/src/app/api/quiz/config/route.ts,`);
  console.log(`      FOLLOW-605). Wrap both in db.transaction(async (tx) => { ... }),`);
  console.log(`      or add an inline '// staff-write-atomicity-exempt: <reason>'`);
  console.log(`      comment if this route is a genuinely single-store single-write`);
  console.log(`      path where a transaction wrapper would be meaningless (disallowed`);
  console.log(`      on superadmin-gated routes).`);
  failures += 1;
}

// ─── Exemption audit (FOLLOW-608 AC 5) ─────────────────────────────────────
// Repo-wide sweep for the marker (defense in depth beyond the scan_root loop
// above, which only inspects route.ts files) so the audit trail is complete.
console.log('');
console.log('=== Exemption audit (staff-write-atomicity-exempt: usages repo-wide) ===');
let repoWideLines = [];
try {
  const out = execSync('git grep -n "staff-write-atomicity-exempt:" -- "*.ts" "*.tsx"', {
    cwd: ROOT,
  }).toString();
  repoWideLines = out
    .trim()
    .split('\n')
    .filter(Boolean)
    // Exclude this guard's own doc-comment and the committed test fixtures —
    // neither is a production usage of the exemption.
    .filter((line) => !line.startsWith('scripts/'));
} catch {
  repoWideLines = []; // git grep exits 1 when there are zero matches
}
if (repoWideLines.length === 0) {
  console.log('No staff-write-atomicity-exempt: usages found in production routes today.');
} else {
  for (const line of repoWideLines) console.log(`  ${line}`);
}
console.log(
  `Superadmin-gated exemption attempts disallowed by this run: ${exemptionSightings.filter((e) => e.disallowed).length}`,
);

console.log('');
if (failures > 0) {
  console.log(`Staff-write atomicity check FAILED: ${failures} violation(s) found.`);
  process.exit(1);
} else {
  console.log(
    'Staff-write atomicity check passed — all staff-audited writes are transaction-scoped.',
  );
  process.exit(0);
}
