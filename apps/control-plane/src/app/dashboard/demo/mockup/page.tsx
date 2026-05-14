'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';

import {
  MOCKUP_LISTINGS,
  formatPrice,
  regionLabel,
  type ListingRegion,
  type PriceSegment,
} from '@/lib/mockup-listings';

const REGIONS: { value: ListingRegion | 'all'; label: string }[] = [
  { value: 'all', label: 'All Regions' },
  { value: 'costa-del-sol', label: 'Costa del Sol' },
  { value: 'algarve', label: 'Algarve' },
  { value: 'tuscany', label: 'Tuscany' },
  { value: 'dubai-marina', label: 'Dubai Marina' },
];

const PRICE_SEGMENTS: { value: PriceSegment | 'all'; label: string }[] = [
  { value: 'all', label: 'All Prices' },
  { value: 'budget', label: 'Under €500k' },
  { value: 'mid', label: '€500k – €1M' },
  { value: 'luxury', label: 'Over €1M' },
];

const REGION_COLORS: Record<ListingRegion, string> = {
  'costa-del-sol': 'bg-orange-100 text-orange-800',
  algarve: 'bg-blue-100 text-blue-800',
  tuscany: 'bg-green-100 text-green-800',
  'dubai-marina': 'bg-purple-100 text-purple-800',
};

export default function MockupListingsPage() {
  const [region, setRegion] = useState<ListingRegion | 'all'>('all');
  const [priceSegment, setPriceSegment] = useState<PriceSegment | 'all'>('all');

  const filtered = MOCKUP_LISTINGS.filter(
    (l) =>
      (region === 'all' || l.region === region) &&
      (priceSegment === 'all' || l.price_segment === priceSegment),
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Demo Mode banner */}
      <div className="mb-6 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
        🎭 <strong>Demo Mode</strong> — Mock-up listings page. This is not a real agency site.
        Personalization directives are applied to this content based on the active archetype.
      </div>

      <h1 className="mb-2 text-2xl font-bold text-gray-900">Property Listings</h1>
      <p className="mb-6 text-gray-500">
        Browse our curated selection of premium properties across Europe and the Middle East.
      </p>

      {/* Filters */}
      <div className="mb-8 flex flex-wrap gap-4">
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
            Region
          </label>
          <div className="flex flex-wrap gap-2">
            {REGIONS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => {
                  setRegion(value);
                }}
                className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                  region === value
                    ? 'bg-gray-900 text-white'
                    : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
            Price Range
          </label>
          <div className="flex flex-wrap gap-2">
            {PRICE_SEGMENTS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => {
                  setPriceSegment(value);
                }}
                className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                  priceSegment === value
                    ? 'bg-gray-900 text-white'
                    : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Results count */}
      <p className="mb-4 text-sm text-gray-500">
        {filtered.length} {filtered.length === 1 ? 'property' : 'properties'} found
      </p>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center text-gray-400">
          No listings match your filters. Try broadening your search.
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" data-estalara-listings-grid>
          {filtered.map((listing) => (
            <Link
              key={listing.slug}
              href={`/dashboard/demo/mockup/listings/${listing.slug}`}
              className="group overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200 transition-all hover:shadow-md hover:ring-gray-300"
              data-estalara-listing
              data-estalara-listing-id={listing.slug}
              data-listing-id={listing.slug}
              data-estalara-cta="view-details"
            >
              {/* Image */}
              <div className="relative h-52 overflow-hidden bg-gray-100">
                <Image
                  src={`https://images.unsplash.com/photo-${listing.unsplash_id}?w=600&h=400&fit=crop&auto=format&q=75`}
                  alt={listing.title}
                  fill
                  className="object-cover transition-transform duration-300 group-hover:scale-105"
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                />
                {/* Region badge */}
                <span
                  className={`absolute left-3 top-3 rounded-full px-2 py-0.5 text-xs font-semibold ${REGION_COLORS[listing.region]}`}
                >
                  {regionLabel(listing.region)}
                </span>
              </div>

              {/* Content */}
              <div className="p-4">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <h2
                    data-estalara-slot="headline"
                    data-estalara-yield={String(listing.yield_pct ?? '')}
                    data-estalara-bedrooms={String(listing.bedrooms)}
                    data-estalara-area={String(listing.area_m2)}
                    className="line-clamp-2 text-sm font-semibold text-gray-900 group-hover:text-blue-600"
                  >
                    {listing.title}
                  </h2>
                  <span className="shrink-0 text-base font-bold text-gray-900">
                    {formatPrice(listing.price)}
                  </span>
                </div>

                {/* Stats */}
                <div className="mb-3 flex items-center gap-3 text-xs text-gray-500">
                  {listing.bedrooms > 0 && <span>🛏 {listing.bedrooms} bed</span>}
                  {listing.bedrooms === 0 && <span>🏠 Studio</span>}
                  <span>🚿 {listing.bathrooms} bath</span>
                  <span>📐 {listing.area_m2} m²</span>
                </div>

                {/* Tags */}
                <div className="flex flex-wrap gap-1">
                  {listing.tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                    >
                      {tag.replaceAll('_', ' ')}
                    </span>
                  ))}
                  {listing.yield_pct && (
                    <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                      {listing.yield_pct}% yield
                    </span>
                  )}
                </div>

                {/* Feature section slot — adapted by Estalara personalization engine */}
                <div data-estalara-slot="feature-section" className="mt-2 text-xs text-gray-400">
                  Property Highlights
                </div>

                {/* CTA slot */}
                <button
                  data-estalara-slot="cta"
                  className="mt-3 w-full rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                  onClick={(e) => {
                    e.preventDefault();
                  }}
                >
                  View Listing
                </button>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
