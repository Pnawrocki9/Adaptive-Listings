/**
 * Estalara staff per-listing FAQ answers — /admin/tenants/[id]/listings/[listingId]/answers
 * (FOLLOW-1334)
 *
 * The staff port of the agency `/dashboard/listings/[id]/answers` page: the FAQ question/answer
 * pairs stored with embeddings and retrieved by cosine similarity at adapt time. A server component
 * that validates the URL `[id]` with the SAME existence check the staff-override API path uses
 * ({@link tenantExists}) and renders `notFound()` (404) for an unknown/soft-deleted tenant.
 *
 * On a known tenant it mounts the shared {@link ListingAnswersManager} with explicit `tenantId` and
 * `listingId`, so every call goes to `/api/tenants/:id/answers`, whose staff path validates `:id`
 * against `tenants`. Staff writes below `estalara:ops` rank are rejected server-side (403);
 * successful staff writes append a `staff_audit_log` row in the same transaction (ADR-0018 §3a) —
 * both enforced in the routes, not this page.
 *
 * Staff gating: the existing `/admin/*` middleware already requires a valid staff session for this
 * route — no new middleware is added here.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/listings/[listingId]/answers/page
 */

import { notFound } from 'next/navigation';

import { ListingAnswersManager } from '@/components/listing-answers-manager';
import { tenantExists } from '@/lib/session-auth';

interface StaffListingAnswersPageProps {
  params: Promise<{ id: string; listingId: string }>;
}

/** Dynamic segments may arrive percent-encoded; a malformed escape is used as typed, not a 500. */
function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default async function StaffListingAnswersPage({ params }: StaffListingAnswersPageProps) {
  const { id, listingId: rawListingId } = await params;

  // Fails closed: if validation cannot run, tenantExists throws and the error boundary owns it.
  const exists = await tenantExists(id);
  if (!exists) {
    notFound();
  }

  const listingId = safeDecode(rawListingId);

  return <ListingAnswersManager tenantId={id} listingId={listingId} />;
}
