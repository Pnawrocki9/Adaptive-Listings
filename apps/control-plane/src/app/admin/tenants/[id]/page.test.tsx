/**
 * Tests for /admin/tenants/[id] — per-tenant landing page (FOLLOW-593).
 *
 * Coverage:
 *   T1: valid tenant id (live) — renders name/id + Tracer links built from the real id
 *   T2: valid tenant id (mock fallback) — renders with "data_source: mock" badge
 *   T3: unknown tenant id — calls next/navigation notFound(), not a broken page
 *   T4: DB configured but lookup throws — renders visible error banner (Rule K.2),
 *       does NOT call notFound() (a lookup failure isn't "tenant doesn't exist")
 *   T5: renders hub links to all 8 per-tenant staff surfaces (FOLLOW-606 AC +
 *       FOLLOW-599 Audit Log + FOLLOW-600 Settings)
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/page.test
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// next/navigation's notFound() throws in the real Next.js runtime.
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw Object.assign(new Error('NEXT_NOT_FOUND'), { digest: 'NEXT_NOT_FOUND' });
  }),
}));

vi.mock('../data', () => ({
  getTenantById: vi.fn(),
}));

import { notFound } from 'next/navigation';
import { getTenantById } from '../data';

const mockGetTenantById = vi.mocked(getTenantById);
const mockNotFound = vi.mocked(notFound);

import TenantLandingPage from './page';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

describe('TenantLandingPage — FOLLOW-593', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T1 (live): renders tenant name/id + Tracer links built from the real id', async () => {
    mockGetTenantById.mockResolvedValue({
      dataSource: 'live',
      tenant: {
        id: TENANT_ID,
        name: 'Real Tenant Co',
        plan: 'growth',
        status: 'active',
        createdAt: '2026-07-01T00:00:00.000Z',
        profileModeEnabled: false,
      },
    });

    const page = await TenantLandingPage({ params: Promise.resolve({ id: TENANT_ID }) });
    render(page);

    expect(screen.getByText('Real Tenant Co')).toBeDefined();
    expect(screen.getByText(TENANT_ID)).toBeDefined();
    expect(screen.getByText('data_source: live')).toBeDefined();

    const liveMonitorLink = screen.getByText('Live Monitor').closest('a');
    expect(liveMonitorLink?.getAttribute('href')).toBe(`/admin/tenants/${TENANT_ID}/tracer`);

    const historyLink = screen.getByText('Session History').closest('a');
    expect(historyLink?.getAttribute('href')).toBe(`/admin/tenants/${TENANT_ID}/tracer/history`);

    const exportLink = screen.getByText('Export').closest('a');
    expect(exportLink?.getAttribute('href')).toBe(`/admin/tenants/${TENANT_ID}/tracer/export`);
  });

  it('T2 (mock fallback): renders with a visible "data_source: mock" badge', async () => {
    mockGetTenantById.mockResolvedValue({
      dataSource: 'mock',
      tenant: {
        id: 'tenant-001',
        name: 'Costa Sol Properties',
        plan: 'growth',
        status: 'active',
        createdAt: '2026-04-15T10:00:00.000Z',
        profileModeEnabled: false,
      },
    });

    const page = await TenantLandingPage({ params: Promise.resolve({ id: 'tenant-001' }) });
    render(page);

    expect(screen.getByText('data_source: mock')).toBeDefined();
    expect(screen.getByText('Costa Sol Properties')).toBeDefined();
  });

  it('T3: unknown tenant id calls notFound() instead of rendering a broken page', async () => {
    mockGetTenantById.mockResolvedValue({ dataSource: 'live', tenant: null });

    await expect(
      TenantLandingPage({ params: Promise.resolve({ id: 'unknown-id' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it('T5: renders hub links to all 8 per-tenant staff surfaces (FOLLOW-606 + FOLLOW-599 + FOLLOW-600)', async () => {
    mockGetTenantById.mockResolvedValue({
      dataSource: 'live',
      tenant: {
        id: TENANT_ID,
        name: 'Real Tenant Co',
        plan: 'growth',
        status: 'active',
        createdAt: '2026-07-01T00:00:00.000Z',
        profileModeEnabled: false,
      },
    });

    const page = await TenantLandingPage({ params: Promise.resolve({ id: TENANT_ID }) });
    render(page);

    const analyticsLink = screen.getByText('Analytics').closest('a');
    expect(analyticsLink?.getAttribute('href')).toBe(`/admin/tenants/${TENANT_ID}/analytics`);

    const quizLink = screen.getByText('Quiz Config').closest('a');
    expect(quizLink?.getAttribute('href')).toBe(`/admin/tenants/${TENANT_ID}/quiz`);

    const demoLink = screen.getByText('Demo Mode').closest('a');
    expect(demoLink?.getAttribute('href')).toBe(`/admin/tenants/${TENANT_ID}/demo`);

    const labelsLink = screen.getByText('Labels').closest('a');
    expect(labelsLink?.getAttribute('href')).toBe(`/admin/tenants/${TENANT_ID}/labels`);

    const intentLink = screen.getByText('Intent Weights').closest('a');
    expect(intentLink?.getAttribute('href')).toBe(`/admin/tenants/${TENANT_ID}/intent`);

    const auditLink = screen.getByText('Audit Log').closest('a');
    expect(auditLink?.getAttribute('href')).toBe(`/admin/tenants/${TENANT_ID}/audit`);

    const settingsLink = screen.getByText('Settings').closest('a');
    expect(settingsLink?.getAttribute('href')).toBe(`/admin/tenants/${TENANT_ID}/settings`);

    // FOLLOW-633: Adaptive Listings on/off staff surface.
    const alStateLink = screen.getByText('Adaptive Listings On/Off').closest('a');
    expect(alStateLink?.getAttribute('href')).toBe(`/admin/tenants/${TENANT_ID}/al-state`);
  });

  it('T4 (fail loud): DB configured-but-throws renders an error banner, never calls notFound()', async () => {
    mockGetTenantById.mockResolvedValue({
      dataSource: 'error',
      tenant: null,
      errorMessage: 'connection reset',
    });

    const page = await TenantLandingPage({ params: Promise.resolve({ id: TENANT_ID }) });
    render(page);

    expect(screen.getByText(/Error looking up tenant/i)).toBeDefined();
    expect(screen.getByText(/connection reset/i)).toBeDefined();
    expect(mockNotFound).not.toHaveBeenCalled();
  });
});
