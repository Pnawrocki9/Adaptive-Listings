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
