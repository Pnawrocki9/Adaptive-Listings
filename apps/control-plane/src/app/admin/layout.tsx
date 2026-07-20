/**
 * Admin layout — sidebar navigation for all /admin/* pages.
 *
 * Includes a "Sign out" Server Action that calls supabase.auth.signOut()
 * and redirects to /sign-in (AC6).
 *
 * @module apps/control-plane/src/app/admin/layout
 */

import type React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { PILOT_TENANT_ID } from '@/lib/pilot-tenant';

/**
 * K.3.6 Archetype Tracer navigation (staff-only) — single-tenant v1.
 *
 * Scoped to the pilot tenant: the live monitor and session history live under
 * /admin/tenants/[id]/tracer, so we link them directly with PILOT_TENANT_ID
 * instead of routing through a tenants list. Weight Editor is global.
 *
 * De-pinning these links from PILOT_TENANT_ID to the new Tenants hub is a
 * later ticket (ADR-0018 §6 Phase 1+) — left as-is here per FOLLOW-593 scope.
 */
const TRACER_NAV_LINKS = [
  { href: `/admin/tenants/${PILOT_TENANT_ID}/tracer`, label: 'Live Monitor' },
  { href: `/admin/tenants/${PILOT_TENANT_ID}/tracer/history`, label: 'Session History' },
  { href: '/admin/tracer/weights', label: 'Weight Editor' },
];

/**
 * Multi-tenant admin screens — un-hidden per ADR-0018 §Decision 0
 * (CEO-ratified 2026-07-20), reversing the 2026-06-15 "single-tenant v1" hide.
 * `/admin/tenants` is the entry point for every per-tenant staff surface
 * (`/admin/tenants/[id]/<feature>`, ADR-0018 §1).
 */
const TENANTS_NAV_LINKS = [
  { href: '/admin/tenants', label: 'Tenants' },
  { href: '/admin/registrations', label: 'Registrations' },
  { href: '/admin/demo-sessions', label: 'Demo Sessions' },
];

/**
 * Platform-global staff settings (Phase 0 of the superadmin-access work,
 * 2026-07-20). Currently: the global generation-model selector (FOLLOW-161 /
 * FOLLOW-456 — staff are the only accounts that can write it).
 */
const PLATFORM_NAV_LINKS = [{ href: '/admin/settings', label: 'Settings' }];

/**
 * Server Action: sign out the current user and redirect to /sign-in.
 * Called by the sidebar footer form submission.
 */
async function signOut() {
  'use server';
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect('/sign-in');
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-gray-200 bg-white">
        <div className="flex h-full flex-col">
          <div className="border-b border-gray-200 px-4 py-4">
            <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">
              Estalara
            </span>
            <h1 className="mt-0.5 text-sm font-bold text-gray-900">Admin Panel</h1>
          </div>

          <nav className="flex-1 px-2 py-4">
            {/* K.3.6 Archetype Tracer — the v1 single-tenant admin surface. */}
            <div>
              <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
                Tracer
              </p>
              <ul className="space-y-0.5">
                {TRACER_NAV_LINKS.map(({ href, label }) => (
                  <li key={href}>
                    <Link
                      href={href}
                      className="block rounded-md px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Multi-tenant hub — un-hidden per ADR-0018 §Decision 0. */}
            <div className="mt-6">
              <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
                Tenants
              </p>
              <ul className="space-y-0.5">
                {TENANTS_NAV_LINKS.map(({ href, label }) => (
                  <li key={href}>
                    <Link
                      href={href}
                      className="block rounded-md px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Platform-global settings (staff-writable; see PLATFORM_NAV_LINKS doc). */}
            <div className="mt-6">
              <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
                Platform
              </p>
              <ul className="space-y-0.5">
                {PLATFORM_NAV_LINKS.map(({ href, label }) => (
                  <li key={href}>
                    <Link
                      href={href}
                      className="block rounded-md px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </nav>

          <div className="border-t border-gray-200 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-800">
                Staff Only
              </span>
              <form action={signOut}>
                <button
                  type="submit"
                  className="text-xs text-gray-500 transition-colors hover:text-gray-900"
                >
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  );
}
