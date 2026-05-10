#!/usr/bin/env node
/**
 * Bundle size gate — ensures the SDK IIFE bundle stays under 40KB gzip.
 * Run after `pnpm build` in packages/sdk.
 */
import { readFileSync } from 'fs';
import { gzipSync } from 'zlib';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLE_PATH = join(__dirname, '../dist/estalara-sdk.iife.js');
const MAX_BYTES = 40 * 1024; // 40KB

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
