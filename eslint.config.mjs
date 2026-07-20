// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * ESLint flat config for the Estalara monorepo.
 * TypeScript strict rules + import ordering + Prettier compatibility.
 */
export default tseslint.config(
  // Global ignores
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/*.config.js',
      '**/*.config.cjs',
      '**/*.config.mjs',
      'scripts/check-bundle-size.ts',
      // Fixture routes for scripts/check-staff-write-atomicity.sh (FOLLOW-607).
      // Deliberately fake/never-compiled TS text fixtures the guard greps as
      // strings — not real source, not built or imported by any app.
      'scripts/__fixtures__/**',
      'apps/control-plane/scripts/**',
      'packages/sdk/scripts/**',
      'packages/sdk/e2e/*.js',
      'apps/control-plane/next.config.ts',
      // SDK IIFE bundle served as a Vercel static asset (ESC-015).
      // Built artifact, not source — linting it makes no sense.
      'apps/control-plane/public/sdk.js',
      // Auto-detect companion IIFE served as a Vercel static asset (FOLLOW-325).
      // Built artifact from packages/sdk/dist/estalara-detect.iife.js — not source.
      'apps/control-plane/public/estalara-detect.iife.js',
    ],
  },

  // Base JS rules
  js.configs.recommended,

  // TypeScript rules for all .ts/.tsx files
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // No any without explicit disable comment + reason
      '@typescript-eslint/no-explicit-any': 'error',
      // Unused vars: allow underscore-prefixed
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Prefer type imports for type-only imports
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      // Public API boundaries don't require explicit return types (too noisy at placeholder stage)
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },

  // Relax some rules in test files
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      // DOM types (DOMParser, Document, HTMLElement) are error-typed in test files
      // that use jsdom environment without explicit dom lib in tsconfig.
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },

  // Disable type-checked rules for JS config files that can't have tsconfig
  {
    files: ['**/*.mjs', '**/*.cjs', '**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },

  // Prettier disables conflicting formatting rules — must be last
  prettier,
);
