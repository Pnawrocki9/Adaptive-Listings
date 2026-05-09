import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { formatPrice, getListingBySlug, regionLabel, MOCKUP_LISTINGS } from '@/lib/mockup-listings';

/** Pre-generate static params so Next.js knows all valid slugs at build time. */
export function generateStaticParams() {
  return MOCKUP_LISTINGS.map((l) => ({ slug: l.slug }));
}

export default async function MockupListingDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const listing = getListingBySlug(slug);

  if (!listing) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      {/* Demo banner */}
      <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        🎭 <strong>Demo Mode — Personalization active.</strong> This listing experience is adapted
        based on the detected visitor archetype.
      </div>

      {/* Back button */}
      <Link
        href="/dashboard/demo/mockup"
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-800"
      >
        ← Back to listings
      </Link>

      {/* Hero image */}
      <div className="relative mb-8 h-72 overflow-hidden rounded-2xl bg-gray-100 sm:h-96">
        <Image
          src={`https://images.unsplash.com/photo-${listing.unsplash_id}?w=1200&h=800&fit=crop&auto=format&q=80`}
          alt={listing.title}
          fill
          className="object-cover"
          sizes="(max-width: 768px) 100vw, 896px"
          priority
        />
        <span className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1 text-sm font-semibold text-gray-800 backdrop-blur-sm">
          {regionLabel(listing.region)}
        </span>
      </div>

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">{listing.title}</h1>
          <p className="mt-1 text-sm capitalize text-gray-500">
            {listing.type} · {regionLabel(listing.region)}
          </p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-gray-900">{formatPrice(listing.price)}</div>
          {listing.yield_pct && (
            <div className="text-sm font-medium text-green-600">
              {listing.yield_pct}% rental yield
            </div>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="mb-8 flex flex-wrap gap-6 rounded-xl bg-gray-50 px-6 py-4">
        {listing.bedrooms > 0 ? (
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-900">{listing.bedrooms}</div>
            <div className="text-xs text-gray-500">Bedrooms</div>
          </div>
        ) : (
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-900">Studio</div>
            <div className="text-xs text-gray-500">Type</div>
          </div>
        )}
        <div className="text-center">
          <div className="text-2xl font-bold text-gray-900">{listing.bathrooms}</div>
          <div className="text-xs text-gray-500">Bathrooms</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-gray-900">{listing.area_m2}</div>
          <div className="text-xs text-gray-500">m²</div>
        </div>
        {listing.schools_nearby && (
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-900">{listing.schools_nearby}</div>
            <div className="text-xs text-gray-500">Schools nearby</div>
          </div>
        )}
      </div>

      {/* Description */}
      <div className="mb-8">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">About this property</h2>
        <p className="leading-relaxed text-gray-600">{listing.description}</p>
      </div>

      {/* Features */}
      <div className="mb-8">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Key features</h2>
        <ul className="space-y-2">
          {listing.features.map((f) => (
            <li key={f} className="flex items-start gap-2 text-gray-600">
              <span className="mt-0.5 shrink-0 text-green-500">✓</span>
              {f}
            </li>
          ))}
        </ul>
      </div>

      {/* Tags */}
      <div className="mb-8">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Property highlights</h2>
        <div className="flex flex-wrap gap-2">
          {listing.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-gray-100 px-3 py-1 text-sm capitalize text-gray-700"
            >
              {tag.replaceAll('_', ' ')}
            </span>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="rounded-xl bg-gray-900 px-6 py-6 text-center">
        <h3 className="mb-2 text-lg font-semibold text-white">Interested in this property?</h3>
        <p className="mb-4 text-sm text-gray-300">
          Our team is ready to arrange a private viewing at your convenience.
        </p>
        <button
          type="button"
          className="rounded-lg bg-white px-6 py-2.5 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-100"
        >
          Book a Viewing
        </button>
        <p className="mt-3 text-xs text-gray-500">🎭 Demo Mode — This button is a placeholder</p>
      </div>
    </main>
  );
}
