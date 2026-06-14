/**
 * Tests for /admin/tenants (Tenant Fleet, FOLLOW-311).
 *
 * FOLLOW-311 fix: the three tenant-scoped tracer pages were nav-orphaned — reachable
 * only by hand-typing a URL with a tenant UUID. This test asserts that the tenants list
 * now renders per-tenant Tracer links (Live Monitor, History, Export) for each tenant row
 * with hrefs that resolve to the correct /admin/tenants/<id>/tracer paths.
 *
 * Coverage:
 *   T1: renders the Tenant Fleet heading
 *   T2: renders "Live Monitor" tracer link for each tenant with correct href
 *   T3: renders "History" tracer link for each tenant with correct href
 *   T4: renders "Export" tracer link for each tenant with correct href
 *
 * @module apps/control-plane/src/app/admin/tenants/page.test
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import AdminTenantsPage from './page';
import { MOCK_TENANTS } from './mock-data';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AdminTenantsPage — FOLLOW-311 per-tenant tracer nav links', () => {
  it('T1: renders the Tenant Fleet heading', () => {
    render(<AdminTenantsPage />);
    expect(screen.getByText(/Tenant Fleet/i)).toBeDefined();
  });

  it('T2: renders "Live Monitor" tracer link for each tenant with correct /tracer href', () => {
    render(<AdminTenantsPage />);

    const links = screen.getAllByText(/Live Monitor/i);
    expect(links.length).toBe(MOCK_TENANTS.length);

    for (let i = 0; i < MOCK_TENANTS.length; i++) {
      const tenant = MOCK_TENANTS[i]!;
      const link = links[i] as HTMLAnchorElement;
      // The href must resolve to /admin/tenants/<tenant.id>/tracer (not hand-typed UUID).
      expect(link.getAttribute('href')).toBe(`/admin/tenants/${tenant.id}/tracer`);
    }
  });

  it('T3: renders "History" tracer link for each tenant with correct /tracer/history href', () => {
    render(<AdminTenantsPage />);

    const links = screen.getAllByText(/^History$/i);
    expect(links.length).toBe(MOCK_TENANTS.length);

    for (let i = 0; i < MOCK_TENANTS.length; i++) {
      const tenant = MOCK_TENANTS[i]!;
      const link = links[i] as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe(`/admin/tenants/${tenant.id}/tracer/history`);
    }
  });

  it('T4: renders "Export" tracer link for each tenant with correct /tracer/export href', () => {
    render(<AdminTenantsPage />);

    const links = screen.getAllByText(/^Export$/i);
    expect(links.length).toBe(MOCK_TENANTS.length);

    for (let i = 0; i < MOCK_TENANTS.length; i++) {
      const tenant = MOCK_TENANTS[i]!;
      const link = links[i] as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe(`/admin/tenants/${tenant.id}/tracer/export`);
    }
  });
});
