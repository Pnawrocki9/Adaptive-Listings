#!/usr/bin/env node
/**
 * Bundle size gate — ensures the SDK IIFE bundle stays under 42KB gzip.
 * Budget raised 40KB→42KB (ESC-028, CEO-approved 2026-06-21) to absorb the
 * legally-mandated platform consent disclosures (FOLLOW-373, DPIA §13.4) +
 * the FOLLOW-372 opt-out toggle. Durable trim tracked as a lazy-load FOLLOW.
 * Run after `pnpm build` in packages/sdk.
 */
import { readFileSync } from 'fs';
import { gzipSync } from 'zlib';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLE_PATH = join(__dirname, '../dist/estalara-sdk.iife.js');
const MAX_BYTES = 42 * 1024; // 42KB (ESC-028, CEO-approved 2026-06-21)

const bundle = readFileSync(BUNDLE_PATH);
const gzipped = gzipSync(bundle);
const sizeKB = (gzipped.length / 1024).toFixed(2);
const maxKB = (MAX_BYTES / 1024).toFixed(0);

console.log(`Bundle size: ${sizeKB}KB gzip (limit: ${maxKB}KB)`);

if (gzipped.length > MAX_BYTES) {
  console.error(`Bundle too large: ${sizeKB}KB > ${maxKB}KB limit`);
  process.exit(1);
} else {
  console.log(`Bundle size OK: ${sizeKB}KB`);
}
