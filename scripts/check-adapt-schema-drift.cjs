#!/usr/bin/env node
/**
 * Rule H gate (adapt sub-case, FOLLOW-105 / ADR-0006 §Decision 4, gate 1).
 *
 * Asserts the SDK adapt-response validator stays in lock-step with the canonical
 * response contract:
 *
 *   packages/sdk/src/core/adapt-schema.ts  → `adaptResponseSchema` (z.object keys)
 *   packages/shared/src/directives.ts      → `AdaptationDirectives` (interface fields)
 *
 * The top-level field SETS must be identical. A missing/extra/renamed field means
 * the SDK either rejects valid live responses or silently accepts a shape the
 * server no longer sends — exactly the drift the FOLLOW-105 audit (§D/§F.5) found.
 *
 * Structural only — value types are validated at runtime by Zod. This gate guards
 * the field set, not the types.
 *
 * Exit codes: 0 = field sets match, 1 = drift.
 * Run: node scripts/check-adapt-schema-drift.cjs   (from the repo root)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = execSync('git rev-parse --show-toplevel').toString().trim();

const DIRECTIVES_FILE = 'packages/shared/src/directives.ts';
const SCHEMA_FILE = 'packages/sdk/src/core/adapt-schema.ts';
const INTERFACE_NAME = 'AdaptationDirectives';
const SCHEMA_NAME = 'adaptResponseSchema';

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Top-level field names of `export interface <name> { ... }`. */
function interfaceFields(src, name) {
  const re = new RegExp(`export interface ${name}\\s*\\{`);
  const m = re.exec(src);
  if (!m) throw new Error(`interface ${name} not found in ${DIRECTIVES_FILE}`);
  let i = m.index + m[0].length;
  let depth = 1;
  let body = '';
  for (; i < src.length && depth > 0; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) break;
    }
    body += ch;
  }
  body = stripComments(body);
  const fields = [];
  let d = 0;
  for (const ch of body) {
    if (ch === '{' || ch === '(' || ch === '[' || ch === '<') d++;
    else if (ch === '}' || ch === ')' || ch === ']' || ch === '>') d--;
  }
  // Walk line by line, capturing `name:` / `name?:` only at brace depth 0.
  d = 0;
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (d === 0) {
      const fm = /^([A-Za-z_][A-Za-z0-9_]*)\??\s*:/.exec(trimmed);
      if (fm) fields.push(fm[1]);
    }
    for (const ch of line) {
      if (ch === '{' || ch === '(' || ch === '[') d++;
      else if (ch === '}' || ch === ')' || ch === ']') d--;
    }
  }
  return fields;
}

/** Top-level keys of `export const <name> = z.object({ ... })`. */
function zodObjectKeys(src, name) {
  const clean = stripComments(src);
  const start = clean.indexOf(`export const ${name}`);
  if (start < 0) throw new Error(`const ${name} not found in ${SCHEMA_FILE}`);
  const objIdx = clean.indexOf('.object(', start);
  if (objIdx < 0) throw new Error(`${name} is not a z.object(...) in ${SCHEMA_FILE}`);
  let i = objIdx;
  while (clean[i] !== '{') i++;
  let cdepth = 0;
  let buf = '';
  for (; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '{' || ch === '(' || ch === '[') {
      cdepth++;
      continue;
    }
    if (ch === '}' || ch === ')' || ch === ']') {
      cdepth--;
      if (cdepth === 0) break;
      continue;
    }
    if (cdepth === 1) buf += ch; // only chars directly inside the object literal
  }
  const keys = [];
  for (const chunk of buf.split(',')) {
    const km = /([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(chunk);
    if (km) keys.push(km[1]);
  }
  return keys;
}

const interfaceSet = new Set(interfaceFields(read(DIRECTIVES_FILE), INTERFACE_NAME));
const schemaSet = new Set(zodObjectKeys(read(SCHEMA_FILE), SCHEMA_NAME));

const missingInSchema = [...interfaceSet].filter((f) => !schemaSet.has(f)).sort();
const extraInSchema = [...schemaSet].filter((f) => !interfaceSet.has(f)).sort();

console.log('=== Rule H (adapt sub-case): SDK adapt-schema vs AdaptationDirectives ===');
console.log(`  ${INTERFACE_NAME} (${DIRECTIVES_FILE}): ${[...interfaceSet].sort().join(', ')}`);
console.log(`  ${SCHEMA_NAME} (${SCHEMA_FILE}): ${[...schemaSet].sort().join(', ')}`);

if (missingInSchema.length === 0 && extraInSchema.length === 0) {
  console.log('OK:   adapt-response field sets match — no contract drift.');
  process.exit(0);
}

if (missingInSchema.length > 0) {
  console.error(
    `FAIL: fields in ${INTERFACE_NAME} but MISSING from ${SCHEMA_NAME}: ${missingInSchema.join(', ')}`,
  );
}
if (extraInSchema.length > 0) {
  console.error(
    `FAIL: fields in ${SCHEMA_NAME} but NOT in ${INTERFACE_NAME}: ${extraInSchema.join(', ')}`,
  );
}
console.error(
  'Reconcile the SDK Zod schema with the canonical contract (live wins per ADR-0006 §Decision 5).',
);
process.exit(1);
