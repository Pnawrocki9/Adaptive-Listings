/**
 * PostCSS configuration for Tailwind CSS v4.
 *
 * Tailwind v4 uses a PostCSS plugin (@tailwindcss/postcss) instead of
 * the old CLI-based approach. No tailwind.config.ts needed — configuration
 * lives in CSS via @theme directive in globals.css.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
