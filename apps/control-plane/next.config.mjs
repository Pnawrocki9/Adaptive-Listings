/**
 * Next.js configuration for the Estalara control plane.
 *
 * Transpiles monorepo packages so they can be imported in the App Router.
 * Turbopack is enabled via the `--turbo` flag in the dev script.
 *
 * Wrapped with withSentryConfig for source-map upload and tunnel route.
 * Sentry initialises only when SENTRY_DSN_CONTROL_PLANE is present (graceful no-op otherwise).
 *
 * @type {import('next').NextConfig}
 */

import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Strict mode for React 19
  reactStrictMode: true,
  // TypeScript errors fail the build
  typescript: {
    ignoreBuildErrors: false,
  },
  // ESLint errors fail the build
  eslint: {
    ignoreDuringBuilds: false,
  },
  // Transpile monorepo packages for App Router
  transpilePackages: ['@estalara/shared', '@estalara/auth', '@estalara/db'],
  /**
   * Response headers for statically served `public/` assets.
   *
   * `consent-text.json` (ADR-0021 §D2/§D7, FOLLOW-915) is the only entry, and it exists because
   * of a defect worth stating plainly: the ADR justified the transport as *"served from the same
   * origin as `sdk.js`"*, but `sdk.js` is loaded by `<script src>` — which is NOT subject to CORS
   * — while the consent text is read by `fetch(..., { mode: 'cors' })`, which is. The SDK executes
   * on the TENANT's origin, so this is the estate's first genuinely cross-origin fetch of a
   * control-plane static asset. Without `Access-Control-Allow-Origin` the browser discards the
   * response, §D4 fails closed exactly as designed, and every FIRST-VISIT browser gets no banner
   * and a null `init()` — the SDK behaving correctly on top of a missing header. (FOLLOW-929)
   *
   * WILDCARD IS THE CORRECT VALUE HERE, not a concession. §D3 requires the request to carry no
   * credentials and no identifiers, and the document is byte-identical for every tenant and every
   * visitor; an origin allowlist would break the embedding model AND make the response vary by
   * origin, which is precisely the tenant-distinguishing behaviour §D3 forbids. `/api/adapt` keeps
   * its reflected-origin allowlist in `middleware.ts` because that route IS tenant-identified.
   *
   * `Cache-Control` is the §D2 wire contract; before this it had no producer either.
   */
  async headers() {
    return [
      {
        source: '/consent-text.json',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=300, stale-while-revalidate=60' },
          { key: 'Content-Type', value: 'application/json; charset=utf-8' },
        ],
      },
    ];
  },
  // Allow Unsplash images for demo mockup listings
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        pathname: '/**',
      },
    ],
  },
};

export default withSentryConfig(nextConfig, {
  // Sentry organisation and project slugs — from env vars, resolved at build time.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Silent to keep build output clean; errors are non-fatal.
  silent: true,

  // Upload source maps only when auth token is present (skipped gracefully in local dev).
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Disable Sentry telemetry to Sentry about our Sentry usage.
  telemetry: false,

  // Tunnel route avoids ad-blockers.
  tunnelRoute: '/monitoring',

  // Hide source maps from the browser bundle.
  hideSourceMaps: true,

  // Disable the automatic tree-shaking of Sentry logger statements.
  disableLogger: true,
});
