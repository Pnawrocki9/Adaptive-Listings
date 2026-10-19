'use client';

/**
 * OpenListingForm — jump to a listing's FAQ answers by its external id (FOLLOW-1334).
 *
 * The tenant's listings live in the Estalara app, not in this database, so there is no list to pick
 * from for a listing that has no answers yet; staff type the id once and land on the manager.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/listings/open-listing-form
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function OpenListingForm({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [listingId, setListingId] = useState('');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const id = listingId.trim();
        if (id)
          router.push(`/admin/tenants/${tenantId}/listings/${encodeURIComponent(id)}/answers`);
      }}
      className="flex items-end gap-3"
    >
      <label className="flex-1 text-sm font-medium text-gray-700">
        Listing ID
        <input
          type="text"
          required
          value={listingId}
          maxLength={256}
          onChange={(e) => {
            setListingId(e.target.value);
          }}
          placeholder="the listing’s external id in the Estalara app"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
        />
      </label>
      <button
        type="submit"
        className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700"
      >
        Open FAQ answers
      </button>
    </form>
  );
}
