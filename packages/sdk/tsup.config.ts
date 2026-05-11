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
]);
