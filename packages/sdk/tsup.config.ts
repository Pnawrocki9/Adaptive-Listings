import { readFileSync } from 'node:fs';
import { defineConfig, type Options } from 'tsup';

/**
 * FOLLOW-1469 — the consent-text URL of a LOCALHOST build (ADR-0021 amendment 2026-11-04).
 *
 * `scripts/dev/localhost-up.sh` sets `ESTALARA_LOCAL_CONSENT_TEXT_URL` so the local SDK reads the
 * consent text from the local control plane instead of production. Unset (CI, `pnpm build`, the
 * published bundle) no plugin is installed and the IIFE is byte-identical to a build without this
 * code. Set, the plugin below replaces the one `fetch(CONSENT_TEXT_URL,` in `core/consent-text.ts`
 * with the allow-listed literal AT BUILD TIME — the §D3 request shape is otherwise untouched and
 * nothing on the page can change the URL at runtime. Any other value fails the build, so a typo
 * can never ship an arbitrary host. Declared in `packages/sdk/turbo.json` `env`, so it is part of
 * the build's cache key; `scripts/check-bundle-size.js` (build:check) rejects a local dist.
 */
const LOCAL_CONSENT_TEXT_URLS = [
  'http://localhost:3000/consent-text.json',
  'http://127.0.0.1:3000/consent-text.json',
];

type EsbuildPlugin = NonNullable<Options['esbuildPlugins']>[number];

function localConsentTextPlugins(): EsbuildPlugin[] {
  const url = process.env.ESTALARA_LOCAL_CONSENT_TEXT_URL;
  if (url === undefined || url === '') return [];
  if (!LOCAL_CONSENT_TEXT_URLS.includes(url)) {
    throw new Error(
      `ESTALARA_LOCAL_CONSENT_TEXT_URL='${url}' is not allowed. Accepted: ` +
        `${LOCAL_CONSENT_TEXT_URLS.join(', ')} (or unset for the production URL).`,
    );
  }
  console.warn(`[FOLLOW-1469] LOCAL SDK build: consent text from ${url} - never ship this dist.`);
  const callSite = 'fetch(CONSENT_TEXT_URL,';
  return [
    {
      name: 'estalara-local-consent-text-url',
      setup(build) {
        build.onLoad({ filter: /[\\/]src[\\/]core[\\/]consent-text\.ts$/ }, (args) => {
          const src = readFileSync(args.path, 'utf8');
          const parts = src.split(callSite);
          if (parts.length !== 2) {
            throw new Error(
              `FOLLOW-1469: expected exactly one '${callSite}' in ${args.path}, ` +
                `found ${String(parts.length - 1)}; the local consent-text URL cannot be applied.`,
            );
          }
          return { contents: parts.join(`fetch(${JSON.stringify(url)},`), loader: 'ts' };
        });
      },
    },
  ];
}

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
    // FOLLOW-1469: empty unless ESTALARA_LOCAL_CONSENT_TEXT_URL is set (localhost-up.sh only).
    esbuildPlugins: localConsentTextPlugins(),
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
