/**
 * Estalara staff per-tenant listings index — /admin/tenants/[id]/listings (FOLLOW-1334)
 *
 * The entry point to the per-listing FAQ answers manager
 * (`/admin/tenants/[id]/listings/[listingId]/answers`) that the agency `/dashboard` had and
 * `/admin` did not. A server component that validates `[id]` with the SAME existence check the
 * staff-override API path uses ({@link tenantExists}) and renders `notFound()` (404) for an
 * unknown/soft-deleted tenant. It lists the listings that already carry answers and offers an
 * open-by-id box for the rest.
 *
 * Rule K.2: a failed lookup renders a visible error banner (not an empty list).
 *
 * Staff gating: the existing `/admin/*` middleware already requires a valid staff session for this
 * route — no new middleware is added here. Reading is open to any staff rank; the writes on the
 * manager page need `estalara:ops` (enforced server-side by the answers API).
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/listings/page
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { tenantExists } from '@/lib/session-auth';
import { getListingAnswerSummaries } from './data';
import { OpenListingForm } from './open-listing-form';

interface StaffTenantListingsPageProps {
  params: Promise<{ id: string }>;
}

export default async function StaffTenantListingsPage({ params }: StaffTenantListingsPageProps) {
  const { id } = await params;

  // Fails closed: if validation cannot run, tenantExists throws and the error boundary owns it.
  const exists = await tenantExists(id);
  if (!exists) {
    notFound();
  }

  const result = await getListingAnswerSummaries(id);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Listing FAQ Answers</h1>
        <p className="mt-1 text-sm text-gray-500">
          Per-listing question/answer pairs retrieved at adapt time. Tenant:{' '}
          <span className="font-mono text-xs">{id}</span>
        </p>
      </div>

      <div className="mb-8 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
        <OpenListingForm tenantId={id} />
      </div>

      <h2 className="mb-3 text-sm font-semibold text-gray-700">Listings with answers</h2>

      {!result.ok && (
        <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <strong>Could not load listings:</strong> {result.error}
        </div>
      )}

      {result.ok && result.listings.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-8 text-center text-sm text-gray-600">
          No listing has FAQ answers yet. Enter a listing ID above to add the first one.
        </p>
      )}

      {result.ok && result.listings.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-2xl bg-white shadow-sm ring-1 ring-gray-200">
          {result.listings.map((l) => (
            <li key={l.listingId} className="flex items-center justify-between gap-4 px-5 py-3">
              <Link
                href={`/admin/tenants/${id}/listings/${encodeURIComponent(l.listingId)}/answers`}
                className="font-mono text-sm text-purple-600 underline hover:text-purple-800"
              >
                {l.listingId}
              </Link>
              <span className="text-xs text-gray-500">
                {l.answerCount} {l.answerCount === 1 ? 'answer' : 'answers'}
                {l.lastUpdatedAt
                  ? ` · updated ${new Date(l.lastUpdatedAt).toLocaleDateString()}`
                  : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
