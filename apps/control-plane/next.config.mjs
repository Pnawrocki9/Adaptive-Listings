/**
 * Next.js configuration for the Estalara control plane.
 *
 * Transpiles monorepo packages so they can be imported in the App Router.
 * Turbopack is enabled via the `--turbo` flag in the dev script.
 *
 * @type {import('next').NextConfig}
 */
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

export default nextConfig;
