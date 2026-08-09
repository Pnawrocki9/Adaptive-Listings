/**
 * Minimal typing for the untyped `next.config.mjs`.
 *
 * `src/consent-text-headers.test.ts` (FOLLOW-929) asserts the `headers()` output, and importing a
 * plain `.mjs` from TypeScript is `TS7016` — "implicitly has an 'any' type". Declaring the one
 * shape the test consumes keeps the repo's zero-`any` bar without converting the config to
 * `next.config.ts` (a Next 15 feature, but a larger change than this fix warrants).
 *
 * The pattern carries a single `*` so it matches ONLY specifiers ending in `next.config.mjs` —
 * it does not loosen `.mjs` imports generally.
 */
declare module '*next.config.mjs' {
  /** One entry of Next's `headers()` return value. */
  interface NextHeaderRule {
    source: string;
    headers: { key: string; value: string }[];
  }

  const config: {
    headers?: () => Promise<NextHeaderRule[]>;
  };
  export default config;
}
