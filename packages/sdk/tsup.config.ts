import { defineConfig } from 'tsup';

export default defineConfig([
  // Main IIFE bundle — for <script> tag embed on agency websites.
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
]);
