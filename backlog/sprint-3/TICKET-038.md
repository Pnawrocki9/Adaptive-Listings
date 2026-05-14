# TICKET-038 — SDK tsup Build + Bundle Size Gate (<40KB gzip)

**Sprint:** 3 **Agent:** sdk-engineer **Priority:** P0 **Estimated hours:** 4 **Status:** READY
**Depends on:** TICKET-031 (merged PR #50), TICKET-037 (Shadow DOM sidebar widget) **Unblocks:**
TICKET-039, TICKET-043

## Context

The SDK has a working `tsup.config.ts` with IIFE and ESM builds. The IIFE bundle at
`dist/estalara-sdk.iife.js` is what agencies embed via `<script>` tag. The CLAUDE.md quality bar
requires: **SDK bundle < 40KB gzip for Tier 1+2 combined.**

This ticket adds a CI gate that fails if the IIFE bundle exceeds the limit, and validates the
current bundle is already within budget after TICKET-037 (sidebar widget) is merged.

**References:**

- `packages/sdk/tsup.config.ts` — existing IIFE build config
- `packages/sdk/package.json` — scripts section
- `.github/workflows/ci.yml` — CI pipeline to add bundle-size step to
- `docs/MASTER_DESIGN.md` section B (SDK quality bars)

## What to build

### 1. Bundle size check script

New file: `packages/sdk/scripts/check-bundle-size.mjs`

```js
import { gzipSync } from 'zlib';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundlePath = path.resolve(__dirname, '../dist/estalara-sdk.iife.js');

const MAX_GZIP_BYTES = 40 * 1024; // 40KB

const raw = readFileSync(bundlePath);
const gzipped = gzipSync(raw, { level: 9 });
const kb = (gzipped.length / 1024).toFixed(1);

console.log(`Bundle size: ${kb} KB gzip (limit: 40 KB)`);

if (gzipped.length > MAX_GZIP_BYTES) {
  console.error(`❌ Bundle too large: ${kb} KB > 40 KB`);
  process.exit(1);
}

console.log(`✅ Bundle within limit`);
```

### 2. package.json script

Add to `packages/sdk/package.json`:

```json
"build:size": "node scripts/check-bundle-size.mjs"
```

### 3. CI gate

In `.github/workflows/ci.yml`, add a `bundle-size` job that runs after the SDK build step:

```yaml
- name: Check SDK bundle size
  run: pnpm --filter @estalara/sdk build:size
```

This job should fail the PR if the IIFE bundle exceeds 40KB gzip.

## Acceptance criteria

- [ ] `packages/sdk/scripts/check-bundle-size.mjs` exists and prints bundle size in KB gzip
- [ ] `packages/sdk/package.json` has `"build:size": "node scripts/check-bundle-size.mjs"`
- [ ] Running `pnpm --filter @estalara/sdk build && pnpm --filter @estalara/sdk build:size` succeeds
      (exit 0) with the current bundle
- [ ] CI pipeline in `.github/workflows/ci.yml` runs the bundle size check on every PR
- [ ] CI gate fails with exit code 1 if the bundle exceeds 40KB gzip (verified by temporarily
      setting MAX_GZIP_BYTES to 1 byte in a test run, then reverting)
- [ ] Current bundle (after TICKET-037 sidebar widget) is under 40KB gzip (log the measured size in
      the PR description)
- [ ] The check runs AFTER `pnpm build` (tsup must produce the dist file first)

## Implementation notes

- `gzipSync` from Node's built-in `zlib` module — no npm dependency needed
- The IIFE bundle at `dist/estalara-sdk.iife.js` is the one to check (the `<script>` tag embed)
- ESM build is NOT checked — it's tree-shaken by consumers and not subject to this gate
- If bundle exceeds 40KB after TICKET-037: investigate what grew (run
  `pnpm dlx source-map-explorer dist/estalara-sdk.iife.js --only-mapped`), write an ESCALATION entry
  if growth cannot be resolved within this ticket's scope
