/**
 * Server-side data access for /admin/registrations (FOLLOW-593).
 *
 * The `tenant_registrations` table exists and already has a real writer
 * (`POST /api/registrations`, the public onboarding form) — the mapping from
 * columns to the page's existing display shape is a direct 1:1, so this is
 * wired to real data rather than deferred (see PR notes: registrations vs
 * demo-sessions disposition).
 *
 * Rule K.2: mock (`MOCK_REGISTRATIONS`) renders ONLY when the admin DB is
 * unconfigured; a configured-but-failing query fails loud
 * (`data_source: 'error'` + Sentry capture), never falls back to mock.
 *
 * @module apps/control-plane/src/app/admin/registrations/data
 */

import { eq } from 'drizzle-orm';
import * as Sentry from '@sentry/nextjs';

import { createAdminClient, tenantRegistrations } from '@estalara/db';

import { MOCK_REGISTRATIONS } from './mock-data';

export type RegistrationsDataSource = 'live' | 'mock' | 'error';

export interface RegistrationRow {
  id: string;
  agency_name: string;
  website_url: string;
  contact_email: string;
  contact_name: string;
  country: string;
  listings_volume: string;
  created_at: string;
}

export interface PendingRegistrationsResult {
  dataSource: RegistrationsDataSource;
  registrations: RegistrationRow[];
  errorMessage?: string;
}

function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT);
}

/** Pending agency registrations awaiting staff approval/rejection. */
export async function getPendingRegistrations(): Promise<PendingRegistrationsResult> {
  if (!isDbConfigured()) {
    return {
      dataSource: 'mock',
      registrations: MOCK_REGISTRATIONS.filter((r) => r.status === 'pending').map((r) => ({
        id: r.id,
        agency_name: r.agency_name,
        website_url: r.website_url,
        contact_email: r.contact_email,
        contact_name: r.contact_name,
        country: r.country,
        listings_volume: r.listings_volume,
        created_at: r.created_at,
      })),
    };
  }

  try {
    const db = createAdminClient();
    const rows = await db
      .select({
        id: tenantRegistrations.id,
        agencyName: tenantRegistrations.agencyName,
        websiteUrl: tenantRegistrations.websiteUrl,
        contactEmail: tenantRegistrations.contactEmail,
        contactName: tenantRegistrations.contactName,
        country: tenantRegistrations.country,
        listingsVolume: tenantRegistrations.listingsVolume,
        createdAt: tenantRegistrations.createdAt,
      })
      .from(tenantRegistrations)
      .where(eq(tenantRegistrations.status, 'pending'))
      .orderBy(tenantRegistrations.createdAt);

    return {
      dataSource: 'live',
      registrations: rows.map((r) => ({
        id: r.id,
        agency_name: r.agencyName,
        website_url: r.websiteUrl,
        contact_email: r.contactEmail,
        contact_name: r.contactName,
        country: r.country,
        listings_volume: r.listingsVolume ?? '—',
        created_at: r.createdAt.toISOString(),
      })),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, { tags: { admin_registrations_list_error: 'true' } });
    return { dataSource: 'error', registrations: [], errorMessage: message };
  }
}
