#!/usr/bin/env node
/**
 * extract-fn-signature.cjs — FOLLOW-1070
 *
 * Extracts the FULL, whitespace-normalized signature of a top-level function
 * declaration — from `function <name>(` through (not including) the `{` that
 * opens the body — using the TypeScript compiler's parser, not a
 * line-bounded grep.
 *
 * scripts/check-mirror-files.sh previously extracted signatures with
 * `grep -E "^(export )?(async )?function ${fn}\(" "$file" | head -1`, which
 * reads exactly ONE PHYSICAL LINE. For a function whose parameter list or
 * return type spans multiple lines, that captures only `function fn(` on
 * BOTH sides of a mirror pair — identical text regardless of what the params
 * or return type actually say. PR #825 changed `affinityScore`'s return type
 * (`AffinityResult` in the canonical vs `number` in the mirror) and
 * `buildReorderDirective`'s arity (7 vs 6 params) and return type between
 * apps/control-plane/src/app/api/adapt/route.ts and
 * the Decision API Worker's lib/reorder.ts (Worker removed by FOLLOW-1262),
 * and the old extraction printed
 * "signatures match" on both. See RETRO-298 §4a LG-1.
 *
 * A parser is used rather than a brace-depth character scan because a TS
 * return-type position can itself be an object-type literal immediately
 * followed by the body's opening brace — exactly
 * `buildReorderDirective`'s canonical shape:
 *
 *   ): { directive: ReorderDirective | null; scoringPath: ScoringPath } {
 *
 * A naive `{`/`}` counter cannot tell "the return type's object literal
 * just closed, and now the body opens" from "the body itself just opened"
 * without also correctly skipping string/template-literal/comment content
 * that can contain unbalanced brace characters — real hazards in these
 * specific files (console.debug template literals). The compiler resolves
 * this exactly, by construction: `FunctionDeclaration.body` is a `Block`
 * node, and its start position IS the body's opening `{`, however the
 * return-type annotation before it is shaped.
 *
 * Output contract (exit codes chosen by FOLLOW-1087 — see below):
 *   - Found (top-level FunctionDeclaration with a body): the normalized
 *     signature on stdout (single line, leading `export ` stripped —
 *     export-ness was never part of "signature match" in the prior
 *     extraction either, since the canonical helpers are private), exit 0.
 *   - Read or parse error, or bad usage: message on stderr, no stdout,
 *     exit 2.
 *   - Not found (no top-level FunctionDeclaration with this name, or found
 *     but bodyless — an ambient overload signature has no `{` to bound
 *     against and was never compared by this gate): no stdout, exit 3.
 *
 * WHY "NOT FOUND" IS 3 AND NOT 1 (FOLLOW-1087, and this is the whole point
 * of the code)
 * ─────────────────────────────────────────────────────────────────────────
 * Exit 1 is *node's own* status for a bootstrap failure. All three of these
 * exited 1 under the previous contract:
 *
 *   node extract-fn-signature.cjs <file-without-that-fn> fn   # benign
 *   node /nonexistent/extract-fn-signature.cjs …              # helper missing
 *   node -e "require('typescript')"   # dependency unresolvable (MODULE_NOT_FOUND)
 *
 * One benign state and two "the machinery is broken" states collapsed onto
 * one code, and the caller (scripts/check-mirror-files.sh) resolved the
 * collision in the reassuring direction: it printed
 * `INFO: <fn> not found in canonical — skipping.` and then
 * `OK: all required helper functions present in mirror, signatures match.`
 * over a REAL divergence, exiting 0 — a required merge gate failing OPEN
 * (Rule Q clause 2: module-resolution failures MUST fail loud).
 *
 * Node never chooses 3 for itself, so 3 is unambiguously OURS. The caller's
 * contract is therefore: 0 = compared, 2 = this file is unreadable/unparsable,
 * 3 = genuinely absent, ANYTHING ELSE = the machinery is broken, fail closed.
 * Do not reuse 1 for a semantic outcome here, ever.
 *
 * "Top-level" = a direct statement of the source file, matching the prior
 * grep's `^` (column-0) anchor, which only matched unindented declarations.
 *
 * Run: node scripts/lib/extract-fn-signature.cjs <file> <functionName>
 */

'use strict';

const fs = require('fs');
const ts = require('typescript');

const [, , filePath, fnName] = process.argv;

if (!filePath || !fnName) {
  console.error('Usage: extract-fn-signature.cjs <file> <functionName>');
  process.exit(2);
}

let text;
try {
  text = fs.readFileSync(filePath, 'utf8');
} catch (err) {
  console.error(`ERROR: cannot read ${filePath}: ${err.message}`);
  process.exit(2);
}

let sourceFile;
try {
  sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
} catch (err) {
  console.error(`ERROR: cannot parse ${filePath}: ${err.message}`);
  process.exit(2);
}

const match = sourceFile.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name && node.name.text === fnName,
);

if (!match || !match.body) {
  // 3, not 1 — see "WHY NOT FOUND IS 3 AND NOT 1" above.
  process.exit(3);
}

const declStart = match.getStart(sourceFile);
const bodyStart = match.body.getStart(sourceFile);
const rawSignature = text.slice(declStart, bodyStart);

const normalized = rawSignature
  .replace(/^export\s+/, '')
  .replace(/\s+/g, ' ')
  .trim();

process.stdout.write(normalized);
