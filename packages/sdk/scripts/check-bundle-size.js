#!/usr/bin/env node
/**
 * Bundle size gate — ensures the SDK IIFE bundle stays within 43,136 B gzip.
 * Budget raised 40KB→42KB (ESC-028, CEO-approved 2026-06-21) to absorb the
 * legally-mandated platform consent disclosures (FOLLOW-373, DPIA §13.4) +
 * the FOLLOW-372 opt-out toggle. Durable trim tracked as a lazy-load FOLLOW.
 * Raised again by +128 B (ESC-080, CEO-approved 2026-09-21) for the FOLLOW-1242
 * event-batch retry, so a failed ingest flush no longer loses conversions.
 * Run after `pnpm build` in packages/sdk.
 */
import { readFileSync } from 'fs';
import { gzipSync } from 'zlib';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLE_PATH = join(__dirname, '../dist/estalara-sdk.iife.js');
const MAX_BYTES = 42 * 1024 + 128; // 43,136 B (ESC-028 42KB + ESC-080 +128 B, CEO-approved 2026-09-21)

const bundle = readFileSync(BUNDLE_PATH);
const gzipped = gzipSync(bundle);
const sizeKB = (gzipped.length / 1024).toFixed(2);
const maxKB = (MAX_BYTES / 1024).toFixed(2);
// Headroom is signed so an over-budget run reports a negative deficit instead
// of a misleadingly-positive-looking number (FOLLOW-932 / RETRO-264 — three
// honest gzip measurements of one artefact, taken with three instruments,
// differed by up to 164 bytes; report bytes here, not just two decimals of KB).
const headroomBytes = MAX_BYTES - gzipped.length;

console.log(
  `Bundle size: ${sizeKB}KB gzip (${gzipped.length.toLocaleString('en-US')} B) — ` +
    `limit ${maxKB}KB (${MAX_BYTES.toLocaleString('en-US')} B) — ` +
    `headroom ${headroomBytes.toLocaleString('en-US')} B`,
);

// FOLLOW-1469 — a shippable bundle reads the consent text from production. A dist built with
// ESTALARA_LOCAL_CONSENT_TEXT_URL (scripts/dev/localhost-up.sh only) carries a local host and must
// never pass this gate. In the default build the fetch argument is the minified identifier of
// `@estalara/shared`'s CONSENT_TEXT_URL, a template chain (`https://${"admin.estalara.com"}` +
// `/consent-text.json`); the local build inlines a string literal at the call site instead. So:
// the production parts must be present, no fetch may take a consent-text string literal, and the
// default bundle contains no `localhost` / `127.0.0.1` at all, so their absence is exact.
const text = bundle.toString('utf8');
const consentProblems = [];
if (!text.includes('"admin.estalara.com"')) consentProblems.push('no admin.estalara.com host');
if (!/\$\{\w+\}\/consent-text\.json`/.test(text)) consentProblems.push('no consent-text template');
if (/fetch\(\s*["'`][^"'`]*consent-text\.json/.test(text)) {
  consentProblems.push('fetch() of a consent-text string literal');
}
for (const local of ['localhost', '127.0.0.1']) {
  if (text.includes(local)) consentProblems.push(`contains '${local}'`);
}
if (consentProblems.length > 0) {
  console.error(
    `Consent-text URL gate FAILED (${consentProblems.join('; ')}). This is not the production ` +
      `bundle - rebuild with ESTALARA_LOCAL_CONSENT_TEXT_URL unset (FOLLOW-1469).`,
  );
  process.exit(1);
}
console.log('Consent-text URL OK: production host, no local host (FOLLOW-1469)');

if (gzipped.length > MAX_BYTES) {
  console.error(`Bundle too large: ${sizeKB}KB > ${maxKB}KB limit`);
  process.exit(1);
} else {
  console.log(`Bundle size OK: ${sizeKB}KB`);
}
