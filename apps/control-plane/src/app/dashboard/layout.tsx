/**
 * Dashboard layout — wraps all dashboard pages with a sidebar navigation.
 *
 * The sidebar links reflect the current dashboard sections:
 *   - Investor Quiz     /dashboard/quiz
 *   - Demo Mode         /dashboard/demo/mockup
 *   - Site Detection    /dashboard/detection   (AUTO-006)
 *   - Analytics         /dashboard/analytics
 *   - Pilot Dashboard   /dashboard/pilot       (TICKET-PILOT-003)
 *
 * @module apps/control-plane/src/app/dashboard/layout
 */

import type React from 'react';
import Link from 'next/link';

const NAV_LINKS = [
  {
    href: '/dashboard/quiz',
    label: 'Investor Quiz',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
  {
    href: '/dashboard/demo/mockup',
    label: 'Demo Mode',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
        <path
          fillRule="evenodd"
          d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
  {
    href: '/dashboard/detection',
    label: 'Site Detection',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
  {
    href: '/dashboard/analytics',
    label: 'Analytics',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <path d="M15.5 2A1.5 1.5 0 0014 3.5v13a1.5 1.5 0 003 0v-13A1.5 1.5 0 0015.5 2zM9.5 6A1.5 1.5 0 008 7.5v9a1.5 1.5 0 003 0v-9A1.5 1.5 0 009.5 6zM3.5 10A1.5 1.5 0 002 11.5v5a1.5 1.5 0 003 0v-5A1.5 1.5 0 003.5 10z" />
      </svg>
    ),
  },
  {
    href: '/dashboard/pilot',
    label: 'Pilot Dashboard',
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M10 1a1 1 0 011 1v1.07A7.002 7.002 0 0116.93 9H18a1 1 0 110 2h-1.07A7.002 7.002 0 0111 16.93V18a1 1 0 11-2 0v-1.07A7.002 7.002 0 013.07 11H2a1 1 0 110-2h1.07A7.002 7.002 0 019 3.07V2a1 1 0 011-1zm0 5a4 4 0 100 8 4 4 0 000-8zm0 2.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-gray-200 bg-white">
        <div className="flex h-full flex-col">
          <div className="border-b border-gray-200 px-4 py-4">
            <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">
              Estalara
            </span>
            <h1 className="mt-0.5 text-sm font-bold text-gray-900">Dashboard</h1>
          </div>

          <nav className="flex-1 px-2 py-4">
            <ul className="space-y-0.5">
              {NAV_LINKS.map(({ href, label, icon }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900"
                  >
                    {icon}
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="border-t border-gray-200 px-4 py-3">
            <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800">
              Agency
            </span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
