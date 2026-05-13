import { defineConfig } from 'tsup';

export default defineConfig([
  // IIFE bundle — for <script> tag embed on agency websites
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
