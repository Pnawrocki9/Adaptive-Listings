/**
 * FOLLOW-1001 — every env-reading server-component page under /admin must opt out
 * of static prerendering with `export const dynamic = 'force-dynamic'`.
 *
 * Why this is load-bearing: the Vercel build runs `turbo run build` with no
 * `env` declared in turbo.json, so Turborepo's strict env mode strips every
 * non-NEXT_PUBLIC var from the build environment. A page that Next statically
 * prerenders therefore evaluates its data function with `DATABASE_URL_ADMIN`/
 * `DATABASE_URL_DIRECT` absent, takes the "DB unconfigured → mock" branch, and
 * BAKES `data_source: mock` into static HTML that runtime env can never fix.
 * Observed live on the /admin list pages — measurement registered as [MP-009]
 * in docs/ops/MEASURED_PREMISES.md, which these assertions rely on.
 *
 * Lexical (file-read) assertions, matching the register-test idiom: importing
 * the page modules here would execute their module graphs for no gain.
 *
 * If a NEW env-reading server page is added under /admin, add it to PAGES.
 * A client page ('use client') or a purely static page does not belong here.
 *
 * @module apps/control-plane/src/app/admin/admin-pages-dynamic.test
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/** Server pages under /admin whose render reads env-gated data sources. */
const PAGES = [
  'tenants/page.tsx',
  'registrations/page.tsx',
  'demo-sessions/page.tsx',
  'analytics/page.tsx',
] as const;

describe('FOLLOW-1001 — /admin env-reading pages force request-time rendering', () => {
  for (const rel of PAGES) {
    it(`${rel} exports dynamic = 'force-dynamic'`, () => {
      const src = readFileSync(join(__dirname, rel), 'utf8');
      expect(src).toMatch(/export const dynamic = 'force-dynamic';/);
      // Sanity: it is a server component (a 'use client' page cannot export
      // route segment config and would make this assertion meaningless).
      expect(src.startsWith("'use client'")).toBe(false);
    });
  }
});
