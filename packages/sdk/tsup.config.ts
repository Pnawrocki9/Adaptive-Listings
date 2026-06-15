import { defineConfig } from 'tsup';

export default defineConfig([
  // Main IIFE bundle — for <script> tag embed on agency websites.
  // FOLLOW-324: auto-detect pipeline is NOT bundled here (it adds ~17 KB gzip).
  // Tenants who want cold-start archetype hints load estalara-detect.iife.js
  // separately BEFORE this script (see the detect-bundle entry below).
  // The main SDK reads window.__EStalaraDetect opportunistically; missing detect
  // script is non-fatal — the Decision API's server-side schema is used instead.
  {
    entry: { 'estalara-sdk': 'src/index.ts' },
    format: ['iife'],
    globalName: 'Estalara',
    outDir: 'dist',
    minify: true,
    sourcemap: false,
    clean: true,
    target: 'es2020',
    platform: 'browser',
    bundle: true,
    tsconfig: './tsconfig.dts.json',
    outExtension: () => ({ js: '.iife.js' }),
    // FOLLOW-324: drop console.* calls from the production IIFE.
    // All console.log/warn/error calls in SDK source are behind a `config.debug`
    // guard that is false in production. Dropping them lets esbuild eliminate
    // the now-unreachable debug strings, shaving the gzip budget.
    // The ESM build (used by SDK integrators in dev) retains console calls.
    esbuildOptions: (opts) => {
      opts.drop = ['console'];
    },
  },
  // Auto-detect IIFE bundle — separate script for client-side site detection.
  // Exposes window.__EStalaraDetect = { detectSiteSchema, extractArchetypeHints }.
  // Loaded by tenants who want cold-start archetype hints (FOLLOW-324).
  {
    entry: { 'estalara-detect': 'src/auto-detect/detect-bundle.ts' },
    format: ['iife'],
    globalName: '__EStalaraDetectBundle',
    outDir: 'dist',
    minify: true,
    sourcemap: false,
    clean: false,
    target: 'es2020',
    platform: 'browser',
    bundle: true,
    tsconfig: './tsconfig.dts.json',
    outExtension: () => ({ js: '.iife.js' }),
  },
  // ESM build — for npm consumers (SDK core, unbundled tree-shakeable)
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    outDir: 'dist',
    dts: true,
    sourcemap: true,
    clean: false,
    target: 'es2020',
    platform: 'browser',
    bundle: false,
    splitting: false,
    tsconfig: './tsconfig.dts.json',
  },
  // Playbooks subpath export — bundled so all archetype imports are resolved
  {
    entry: { 'core/playbooks/index': 'src/core/playbooks/index.ts' },
    format: ['esm'],
    outDir: 'dist',
    dts: true,
    sourcemap: true,
    clean: false,
    target: 'es2020',
    platform: 'browser',
    bundle: true,
    tsconfig: './tsconfig.dts.json',
  },
  // Auto-detect subpath export — detection pipeline + types
  {
    entry: { 'auto-detect/pipeline': 'src/auto-detect/pipeline.ts' },
    format: ['esm'],
    outDir: 'dist',
    dts: true,
    sourcemap: true,
    clean: false,
    target: 'es2020',
    // node — server-side usage (Next.js API route); DOMParser injected by jsdom in tests
    platform: 'node',
    bundle: true,
    tsconfig: './tsconfig.dts.json',
  },
  // AI Vision subpath export — SERVER-SIDE ONLY, never bundled with browser SDK.
  // Loaded via dynamic import from POST /api/detect in apps/control-plane.
  // @anthropic-ai/sdk is marked external — provided by control-plane at runtime.
  {
    entry: {
      'auto-detect/techniques/ai-vision': 'src/auto-detect/techniques/ai-vision.ts',
    },
    format: ['esm'],
    outDir: 'dist',
    dts: true,
    sourcemap: true,
    clean: false,
    target: 'es2022',
    platform: 'node',
    bundle: true,
    // @anthropic-ai/sdk is NOT a dep of packages/sdk — mark as external so tsup
    // does not attempt to bundle it. The control-plane provides it at runtime.
    external: ['@anthropic-ai/sdk'],
    tsconfig: './tsconfig.dts.json',
  },
]);
