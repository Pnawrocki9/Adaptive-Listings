/**
 * /admin/tenants/[id] — per-tenant landing page (FOLLOW-593, ADR-0018 §1).
 *
 * The URL-scoped entry point for every per-tenant staff surface
 * (`/admin/tenants/[id]/<feature>`). Validates `[id]` against the real
 * `tenants` table (`getTenantById`, mirroring the `tenantExists` shape used
 * by `resolveTenantAccess` in `lib/session-auth.ts`, FOLLOW-592) — an unknown
 * id renders Next's `notFound()` page, not a broken page with empty fields.
 *
 * Rule K.2: a configured-but-failing DB lookup renders a visible error
 * banner (distinct from "not found") instead of silently treating the
 * tenant as missing or fabricating its data.
 *
 * Hub-links every per-tenant staff surface shipped so far (Analytics, Quiz
 * config, Demo Mode, Labels, Intent Weights, Audit Log, Settings [FOLLOW-600])
 * alongside the K.3.6 Tracer surfaces (FOLLOW-606). Bandit weights live inside
 * the Analytics resume action, not as a standalone page. New per-tenant
 * surfaces should add their landing link here in the same PR (FOLLOW-606 AC).
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/page
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getTenantById } from '../data';

interface TenantLandingPageProps {
  params: Promise<{ id: string }>;
}

/** Provenance badge — mirrors the badge used across admin/tracer surfaces. */
function DataSourceBadge({ source }: { source: 'live' | 'mock' | 'error' }) {
  const color =
    source === 'live'
      ? 'bg-green-100 text-green-800'
      : source === 'mock'
        ? 'bg-yellow-100 text-yellow-800'
        : 'bg-red-100 text-red-800';
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${color}`}>
      data_source: {source}
    </span>
  );
}

export default async function TenantLandingPage({ params }: TenantLandingPageProps) {
  const { id } = await params;
  const { dataSource, tenant, errorMessage } = await getTenantById(id);

  // Rule K.2: a lookup failure is NOT the same as "tenant does not exist" —
  // render a visible error banner instead of notFound() or fabricated data.
  if (dataSource === 'error') {
    return (
      <div>
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <strong>Error looking up tenant:</strong> {errorMessage ?? 'unknown error'}
        </div>
      </div>
    );
  }

  if (!tenant) {
    notFound();
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{tenant.name}</h2>
          <p className="mt-1 font-mono text-xs text-gray-500">{tenant.id}</p>
        </div>
        <DataSourceBadge source={dataSource} />
      </div>

      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-sm font-semibold text-gray-900">{tenant.plan}</div>
          <div className="mt-0.5 text-xs text-gray-500">Plan</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-sm font-semibold text-gray-900">{tenant.status}</div>
          <div className="mt-0.5 text-xs text-gray-500">Status</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-sm font-semibold text-gray-900">
            {new Date(tenant.createdAt).toLocaleDateString()}
          </div>
          <div className="mt-0.5 text-xs text-gray-500">Created</div>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-800">Staff Surfaces</h3>
        <div className="flex flex-wrap gap-4 text-sm">
          <Link
            href={`/admin/tenants/${tenant.id}/analytics`}
            className="text-purple-600 underline hover:text-purple-800"
          >
            Analytics
          </Link>
          <Link
            href={`/admin/tenants/${tenant.id}/quiz`}
            className="text-purple-600 underline hover:text-purple-800"
          >
            Quiz Config
          </Link>
          <Link
            href={`/admin/tenants/${tenant.id}/demo`}
            className="text-purple-600 underline hover:text-purple-800"
          >
            Demo Mode
          </Link>
          <Link
            href={`/admin/tenants/${tenant.id}/labels`}
            className="text-purple-600 underline hover:text-purple-800"
          >
            Labels
          </Link>
          <Link
            href={`/admin/tenants/${tenant.id}/intent`}
            className="text-purple-600 underline hover:text-purple-800"
          >
            Intent Weights
          </Link>
          <Link
            href={`/admin/tenants/${tenant.id}/audit`}
            className="text-purple-600 underline hover:text-purple-800"
          >
            Audit Log
          </Link>
          <Link
            href={`/admin/tenants/${tenant.id}/settings`}
            className="text-purple-600 underline hover:text-purple-800"
          >
            Settings
          </Link>
          <Link
            href={`/admin/tenants/${tenant.id}/al-state`}
            className="text-purple-600 underline hover:text-purple-800"
          >
            Adaptive Listings On/Off
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-800">K.3.6 Archetype Tracer</h3>
        <div className="flex flex-wrap gap-4 text-sm">
          <Link
            href={`/admin/tenants/${tenant.id}/tracer`}
            className="text-purple-600 underline hover:text-purple-800"
          >
            Live Monitor
          </Link>
          <Link
            href={`/admin/tenants/${tenant.id}/tracer/history`}
            className="text-purple-600 underline hover:text-purple-800"
          >
            Session History
          </Link>
          <Link
            href={`/admin/tenants/${tenant.id}/tracer/export`}
            className="text-purple-600 underline hover:text-purple-800"
          >
            Export
          </Link>
        </div>
      </div>
    </div>
  );
}
