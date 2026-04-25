import type { NextConfig } from 'next';

/**
 * Next.js configuration for the Estalara control plane.
 * Full configuration in TICKET-009 (backend-engineer).
 */
const nextConfig: NextConfig = {
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
};

export default nextConfig;
