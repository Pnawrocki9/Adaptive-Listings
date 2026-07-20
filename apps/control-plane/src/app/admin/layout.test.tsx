/**
 * Tests for AdminLayout — FOLLOW-332 AC1.
 *
 * Verifies the v1 single-tenant sidebar:
 *   AC1-a: Exactly 3 nav links are rendered (Live Monitor, Session History, Weight Editor).
 *   AC1-b: "Live Monitor" and "Session History" hrefs contain PILOT_TENANT_ID.
 *   AC1-c: Multi-tenant screens (Registrations, Tenants, Demo Sessions) are absent.
 *
 * The `href` values asserted are NOT hand-authored in this test.  They are built
 * from `PILOT_TENANT_ID` imported from the REAL `@/lib/pilot-tenant` module —
 * the same module `layout.tsx` imports.  This proves the PRODUCTION PATH supplies
 * the correct tenant-scoped URLs, not a test-side inject.
 *
 * Evidence (guardrail — no value inject):
 *   line 58  — `PILOT_TENANT_ID` sourced from `@/lib/pilot-tenant` (production path)
 *   line 59  — expected hrefs built from that same production constant
 *   The test would FAIL if layout.tsx stopped importing pilot-tenant or used a
 *   different constant, because the rendered hrefs would no longer match.
 *
 * Server Component constraints:
 *   AdminLayout is a Next.js Server Component whose `signOut` Server Action calls
 *   `createServerSupabaseClient()` and `redirect()`.  In the jsdom test environment
 *   neither Next.js server context nor Supabase cookies are available, so we mock
 *   both at the module boundary before importing the component.
 *
 * @module apps/control-plane/src/app/admin/layout.test
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// ─── Mock next/navigation ─────────────────────────────────────────────────────
// `redirect` is used inside the `signOut` Server Action.  Mock it so jsdom
// rendering does not throw when the action is constructed.
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
}));

// ─── Mock next/link ───────────────────────────────────────────────────────────
// next/link uses the Next.js App Router context which is unavailable in jsdom.
// We render it as a plain <a> so href values are queryable in the DOM.
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// ─── Mock @/lib/supabase/server ───────────────────────────────────────────────
// The `signOut` Server Action calls `createServerSupabaseClient()` which reads
// Next.js cookies — unavailable in jsdom.  Mock the entire server module so the
// component can be rendered synchronously without a real Supabase project.
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn().mockResolvedValue({
    auth: { signOut: vi.fn().mockResolvedValue({ error: null }) },
  }),
}));

// ─── Import production modules ────────────────────────────────────────────────
//
// PILOT_TENANT_ID is sourced from the REAL production module, not hand-authored.
// This is the same import that `layout.tsx` uses; the assertion below is that the
// rendered hrefs MATCH what the production path computes, not that we injected
// the right value.
import { PILOT_TENANT_ID } from '@/lib/pilot-tenant';

// Import the component under test AFTER mocks are registered.
import AdminLayout from './layout';

// ─── Derived expectations (built from the production constant) ────────────────
const LIVE_MONITOR_HREF = `/admin/tenants/${PILOT_TENANT_ID}/tracer`;
const SESSION_HISTORY_HREF = `/admin/tenants/${PILOT_TENANT_ID}/tracer/history`;
const WEIGHT_EDITOR_HREF = '/admin/tracer/weights';

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('AdminLayout sidebar — v1 single-tenant navigation (FOLLOW-332 AC1)', () => {
  function renderLayout() {
    return render(
      <AdminLayout>
        <div data-testid="slot">children</div>
      </AdminLayout>,
    );
  }

  it('AC1-a: renders exactly 4 nav links (3 tracer + platform Settings)', () => {
    renderLayout();

    // All three tracer link labels must be present (FOLLOW-332 AC1)...
    expect(screen.getByText('Live Monitor')).toBeDefined();
    expect(screen.getByText('Session History')).toBeDefined();
    expect(screen.getByText('Weight Editor')).toBeDefined();
    // ...plus the Platform section's Settings link (Phase 0 superadmin-access,
    // 2026-07-20 — global generation-model selector, staff-writable FOLLOW-456).
    const settingsLink = screen.getByText('Settings').closest('a');
    expect(settingsLink?.getAttribute('href')).toBe('/admin/settings');

    // Count every <a> inside the <nav> element — must be exactly 4.
    const nav = document.querySelector('nav');
    expect(nav).not.toBeNull();
    const navLinks = nav?.querySelectorAll('a') ?? [];
    expect(navLinks.length).toBe(4);
  });

  it('AC1-b: "Live Monitor" href contains PILOT_TENANT_ID', () => {
    renderLayout();

    const liveMonitorLink = screen.getByText('Live Monitor').closest('a');
    expect(liveMonitorLink).not.toBeNull();
    // The href is derived from the production PILOT_TENANT_ID, not injected.
    expect(liveMonitorLink?.getAttribute('href')).toBe(LIVE_MONITOR_HREF);
    expect(liveMonitorLink?.getAttribute('href')).toContain(PILOT_TENANT_ID);
  });

  it('AC1-b: "Session History" href contains PILOT_TENANT_ID', () => {
    renderLayout();

    const historyLink = screen.getByText('Session History').closest('a');
    expect(historyLink).not.toBeNull();
    expect(historyLink?.getAttribute('href')).toBe(SESSION_HISTORY_HREF);
    expect(historyLink?.getAttribute('href')).toContain(PILOT_TENANT_ID);
  });

  it('AC1-b: "Weight Editor" href is global (no tenant id)', () => {
    renderLayout();

    const weightLink = screen.getByText('Weight Editor').closest('a');
    expect(weightLink).not.toBeNull();
    expect(weightLink?.getAttribute('href')).toBe(WEIGHT_EDITOR_HREF);
    // Weight Editor is global — it must NOT contain any tenant UUID.
    expect(weightLink?.getAttribute('href')).not.toContain(PILOT_TENANT_ID);
  });

  it('AC1-c: nav does NOT contain text "Registrations"', () => {
    renderLayout();

    const nav = document.querySelector('nav');
    expect(nav?.textContent).not.toContain('Registrations');
  });

  it('AC1-c: nav does NOT contain text "Tenants"', () => {
    renderLayout();

    const nav = document.querySelector('nav');
    expect(nav).not.toBeNull();
    // "Tenants" as a standalone nav label must be absent (Tracer is fine).
    // The nav section heading says "Tracer" not "Tenants".
    const allNavText = nav!.textContent || '';
    // Check that no link whose label is exactly "Tenants" exists.
    const tenantLabelLink = Array.from(nav!.querySelectorAll('a')).find(
      (a) => a.textContent.trim() === 'Tenants',
    );
    expect(tenantLabelLink).toBeUndefined();
    // The nav heading must not be "Tenants" (it is "Tracer").
    expect(allNavText).not.toMatch(/^Tenants$/m);
  });

  it('AC1-c: nav does NOT contain text "Demo Sessions"', () => {
    renderLayout();

    const nav = document.querySelector('nav');
    expect(nav?.textContent).not.toContain('Demo Sessions');
  });

  it('renders children in the main content area', () => {
    renderLayout();

    expect(screen.getByTestId('slot')).toBeDefined();
  });

  it('renders the "Staff Only" badge', () => {
    renderLayout();

    expect(screen.getByText('Staff Only')).toBeDefined();
  });

  it('renders the "Sign out" button', () => {
    renderLayout();

    expect(screen.getByText('Sign out')).toBeDefined();
  });

  it('the four nav link hrefs are distinct (no duplicate routes)', () => {
    renderLayout();

    const nav = document.querySelector('nav');
    const hrefs = Array.from(nav?.querySelectorAll('a') ?? []).map(
      (a) => a.getAttribute('href') ?? '',
    );
    const uniqueHrefs = new Set(hrefs);
    expect(uniqueHrefs.size).toBe(4);
  });
});
