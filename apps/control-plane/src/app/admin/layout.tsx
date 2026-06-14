import type React from 'react';
import Link from 'next/link';

const NAV_LINKS = [
  { href: '/admin/registrations', label: 'Registrations' },
  { href: '/admin/tenants', label: 'Tenants' },
  { href: '/admin/demo-sessions', label: 'Demo Sessions' },
];

/** K.3.6 Archetype Tracer navigation links (staff-only). */
const TRACER_NAV_LINKS = [{ href: '/admin/tracer/weights', label: 'Weight Editor' }];

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
            <ul className="space-y-0.5">
              {NAV_LINKS.map(({ href, label }) => (
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

            {/* K.3.6 Archetype Tracer */}
            <div className="mt-4 border-t border-gray-100 pt-4">
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
          </nav>

          <div className="border-t border-gray-200 px-4 py-3">
            <span className="inline-flex items-center rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-800">
              Staff Only
            </span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-8">{children}</main>
    </div>
  );
}
