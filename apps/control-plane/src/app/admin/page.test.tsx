/**
 * Tests for /admin (AdminIndexPage) — FOLLOW-332 AC2, reworked by FOLLOW-1322.
 *
 * The landing resolves the Estalara tenant server-side and issues a 307 `redirect`
 * (never `permanentRedirect`, which browsers cache across environments). A missing
 * tenant renders an explicit "not configured" page instead of an empty tracer.
 *
 * The expected URL is built from the REAL `ESTALARA_TENANT_ID` production export.
 *
 * @module apps/control-plane/src/app/admin/page.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const permanentRedirect = vi.fn<(path: string) => void>();
vi.mock('next/navigation', () => ({
  permanentRedirect: (path: string) => {
    permanentRedirect(path);
  },
  redirect: (path: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), {
      digest: `NEXT_REDIRECT;replace;${path};307;`,
    });
  },
}));

vi.mock('./tenants/[id]/data', () => ({ getTenantById: vi.fn() }));

import { ESTALARA_TENANT_ID } from '@/lib/estalara-tenant';
import { getTenantById } from './tenants/[id]/data';
import AdminIndexPage from './page';

const mockGetTenantById = vi.mocked(getTenantById);
const EXPECTED_PATH = `/admin/tenants/${ESTALARA_TENANT_ID}/tracer`;

const row = {
  id: ESTALARA_TENANT_ID,
  name: 'Estalara',
  plan: 'free',
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  profileModeEnabled: false,
};

async function digestOf(): Promise<string | undefined> {
  try {
    await AdminIndexPage();
  } catch (e) {
    return (e as { digest?: string }).digest;
  }
  return undefined;
}

describe('/admin landing (FOLLOW-1322)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('307-redirects to the existing Estalara tenant tracer, never permanentRedirect', async () => {
    mockGetTenantById.mockResolvedValue({ dataSource: 'live', tenant: row });
    const digest = await digestOf();
    expect(mockGetTenantById).toHaveBeenCalledWith(ESTALARA_TENANT_ID);
    expect(digest).toContain(EXPECTED_PATH);
    expect(digest).toContain(';307;');
    expect(digest).not.toContain('/tracer/history');
    expect(permanentRedirect).not.toHaveBeenCalled();
  });

  it('renders "Estalara tenant not configured" when the tenant is missing or soft-deleted', async () => {
    mockGetTenantById.mockResolvedValue({ dataSource: 'live', tenant: null });
    const result = await AdminIndexPage();
    const html = renderToStaticMarkup(result as React.ReactElement);
    expect(html).toContain('Estalara tenant not configured');
    expect(html).toContain('NEXT_PUBLIC_ESTALARA_TENANT_ID');
    expect(permanentRedirect).not.toHaveBeenCalled();
  });

  it('fails loud (no redirect) when the tenant lookup itself errored', async () => {
    mockGetTenantById.mockResolvedValue({
      dataSource: 'error',
      tenant: null,
      errorMessage: 'db down',
    });
    const html = renderToStaticMarkup((await AdminIndexPage()) as React.ReactElement);
    expect(html).toContain('Tenant lookup failed');
    expect(html).toContain('data_source: error');
  });
});
