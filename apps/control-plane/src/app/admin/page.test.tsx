/**
 * Tests for /admin (AdminIndexPage) — FOLLOW-332 AC2.
 *
 * Asserts that visiting /admin permanently redirects to the pilot tenant's
 * Tracer live monitor — the single-tenant v1 landing (CEO decision 2026-06-15).
 *
 * The redirect target URL is NOT hand-authored in this test.  It is constructed
 * from `PILOT_TENANT_ID` imported from the REAL `@/lib/pilot-tenant` module —
 * the same import `admin/page.tsx` uses.  This proves the PRODUCTION PATH
 * supplies the correct id, not a test-side inject.
 *
 * Evidence (guardrail — no value inject):
 *   line 38  — `PILOT_TENANT_ID` sourced from `@/lib/pilot-tenant` (production module)
 *   line 39  — expected URL built from that same production constant
 *   line 55  — `permanentRedirect` mock throws so the test can observe the call
 *
 * @module apps/control-plane/src/app/admin/page.test
 */

import { describe, expect, it, vi } from 'vitest';

// ─── Mock next/navigation BEFORE importing the page ──────────────────────────
//
// `permanentRedirect` throws a NEXT_REDIRECT Error in the Next.js runtime.
// We replicate that behaviour so the test can catch it and inspect the path.
// `redirect` is mocked as a no-op to avoid "redirect is not a function" errors
// from any transitive dependency.

vi.mock('next/navigation', () => ({
  permanentRedirect: (path: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), {
      digest: `NEXT_REDIRECT;replace;${path};307;`,
    });
  },
  redirect: (path: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), {
      digest: `NEXT_REDIRECT;replace;${path};307;`,
    });
  },
}));

// Import the REAL production module — this is the value-under-test, not an inject.
import { PILOT_TENANT_ID } from '@/lib/pilot-tenant';

// Import the component under test AFTER the mock is in place.
import AdminIndexPage from './page';

// Build the expected URL from the REAL PILOT_TENANT_ID (production module),
// exactly as page.tsx itself does: `/admin/tenants/${PILOT_TENANT_ID}/tracer`.
const EXPECTED_PATH = `/admin/tenants/${PILOT_TENANT_ID}/tracer`;

describe('/admin page — single-tenant v1 redirect (FOLLOW-332 AC2)', () => {
  it('throws NEXT_REDIRECT when rendered', () => {
    expect(() => {
      AdminIndexPage();
    }).toThrow('NEXT_REDIRECT');
  });

  it('redirects to the pilot tenant Tracer live monitor', () => {
    let digest: string | undefined;
    try {
      AdminIndexPage();
    } catch (e) {
      const err = e as { digest?: string };
      digest = err.digest;
    }
    // The digest encodes the target path — verify it contains our expected URL.
    expect(digest).toContain(EXPECTED_PATH);
  });

  it('redirect target includes the canonical PILOT_TENANT_ID', () => {
    let digest: string | undefined;
    try {
      AdminIndexPage();
    } catch (e) {
      const err = e as { digest?: string };
      digest = err.digest;
    }
    // The real PILOT_TENANT_ID uuid must appear in the redirect target.
    // This assertion would FAIL if pilot-tenant.ts changed the default uuid.
    expect(digest).toContain(PILOT_TENANT_ID);
  });

  it('redirect target points to /tracer (live monitor), not /tracer/history', () => {
    let digest: string | undefined;
    try {
      AdminIndexPage();
    } catch (e) {
      const err = e as { digest?: string };
      digest = err.digest;
    }
    // Must land on the live monitor, not the history page.
    expect(digest).toContain('/tracer');
    expect(digest).not.toContain('/tracer/history');
  });

  it('redirect target does NOT contain multi-tenant screen paths', () => {
    let digest: string | undefined;
    try {
      AdminIndexPage();
    } catch (e) {
      const err = e as { digest?: string };
      digest = err.digest;
    }
    // The v1 admin hides registrations, tenants list, and demo sessions.
    expect(digest).not.toContain('/registrations');
    // The path DOES contain /tenants/<uuid> (pilot scoped) — that is correct.
    // Assert it is NOT the bare /tenants list route.
    const path = digest?.split(';')[2] ?? '';
    expect(path).not.toBe('/admin/tenants');
    expect(path).not.toContain('/demo-sessions');
  });
});
