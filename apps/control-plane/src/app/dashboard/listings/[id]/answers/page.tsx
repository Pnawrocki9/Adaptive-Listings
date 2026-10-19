'use client';

/**
 * /dashboard/listings/:id/answers — agency FAQ answer management. The UI lives in
 * `components/listing-answers-manager` and is shared with
 * `/admin/tenants/[id]/listings/[listingId]/answers` (FOLLOW-1334); this route only supplies the
 * agency's tenant. The tenant comes from the `x-tenant-id` meta tag, exactly as before this page
 * was split (the agency zone is removed by FOLLOW-1335, M2).
 *
 * @module apps/control-plane/src/app/dashboard/listings/[id]/answers/page
 */

import { use, useEffect, useState } from 'react';

import { ListingAnswersManager } from '@/components/listing-answers-manager';

function readTenantIdMeta(): string {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="x-tenant-id"]');
  return meta?.content ?? '';
}

export default function AnswersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: listingId } = use(params);
  // null until mounted (the meta tag only exists in the browser) so the manager fetches once. A
  // missing tag yields '' and the API answers 403, as it always did.
  const [tenantId, setTenantId] = useState<string | null>(null);
  useEffect(() => {
    setTenantId(readTenantIdMeta());
  }, []);

  if (tenantId === null) return null;
  return <ListingAnswersManager tenantId={tenantId} listingId={listingId} />;
}
