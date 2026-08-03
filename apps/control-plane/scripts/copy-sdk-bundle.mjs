/**
 * Copy the freshly-built @estalara/sdk IIFE bundles into `public/` so Vercel serves
 * them as static assets (ESC-015: `admin.estalara.com/sdk.js`, CDN deferred to Phase 2).
 *
 * WHY THIS EXISTS (ESC-047 / FOLLOW-808). These two files used to be hand-built and
 * committed. `public/sdk.js` was last refreshed 2026-05-29 (`4bdaf58c`) and
 * `public/estalara-detect.iife.js` 2026-06-17 (`43ad8496`), while ~76 tickets touching
 * `packages/sdk` merged in the meantime — so every one of them was green in CI, DONE in
 * the queue, and absent from production. Nothing regenerated the artifacts: the
 * control-plane build was a bare `next build`, and `release.yml` is quarantined
 * (FOLLOW-626). CEO ruling 2026-08-03: build them in CI on merge instead.
 *
 * The bundles are produced by `@estalara/sdk`'s own build, which Turbo already runs
 * before this package (`turbo.json` → `build.dependsOn: ["^build"]`) because
 * `apps/control-plane` depends on `@estalara/sdk` via the workspace protocol. So this
 * script only has to move bytes — it never builds anything itself.
 *
 * FAIL LOUD, NEVER SILENTLY. A missing source means the SDK build did not run or its
 * output moved. Copying nothing would leave `public/` either empty (tenants get a 404 on
 * their `<script src>`) or holding a stale bundle — the exact failure this script exists
 * to end. Both cases are silent in production, so a missing source is a hard build
 * failure here.
 */

import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const repoRoot = resolve(appRoot, '../..');

const sdkDist = resolve(repoRoot, 'packages/sdk/dist');
const publicDir = resolve(appRoot, 'public');

/** `[built artifact] → [name tenants request]`. Served URLs are pinned in `@estalara/shared` */
/** as `SDK_SERVE_URL` / `DETECT_SERVE_URL` — renaming a target here breaks live `<script>` tags. */
const BUNDLES = [
  { from: 'estalara-sdk.iife.js', to: 'sdk.js' },
  { from: 'estalara-detect.iife.js', to: 'estalara-detect.iife.js' },
];

mkdirSync(publicDir, { recursive: true });

const missing = BUNDLES.filter(({ from }) => !existsSync(resolve(sdkDist, from)));

if (missing.length > 0) {
  console.error(
    `[control-plane] SDK bundle(s) missing from ${sdkDist}: ${missing.map((b) => b.from).join(', ')}.\n` +
      `  These are built by @estalara/sdk and Turbo should have run that first.\n` +
      `  Build the workspace from the repo root (\`pnpm turbo run build --filter=@estalara/control-plane\`)\n` +
      `  rather than invoking \`next build\` directly. Refusing to deploy without them: tenants load\n` +
      `  these over a <script> tag, so an absent or stale copy fails silently in production.`,
  );
  process.exit(1);
}

for (const { from, to } of BUNDLES) {
  const src = resolve(sdkDist, from);
  copyFileSync(src, resolve(publicDir, to));
  console.log(
    `[control-plane] public/${to} ← packages/sdk/dist/${from} (${statSync(src).size} bytes)`,
  );
}
