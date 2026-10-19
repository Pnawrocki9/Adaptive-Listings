/**
 * Global 404 — rendered for any URL that matches no route. [FOLLOW-1336]
 *
 * Before this file an unknown URL showed Next's raw default page. Static markup only: it renders
 * inside the root layout and reads no session, so it works for signed-out visitors too.
 *
 * @module apps/control-plane/src/app/not-found
 */

import type React from 'react';
import Link from 'next/link';

export default function NotFound(): React.JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <span className="text-2xl font-bold tracking-tight">Estalara</span>
          <p className="mt-1 text-sm text-gray-500">Admin Panel</p>
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-gray-900">Page not found</h1>
          <p className="text-sm text-gray-600">
            The page you asked for does not exist or has moved.
          </p>
        </div>
        <p className="text-sm">
          <Link
            href="/admin"
            className="font-medium text-gray-900 underline-offset-4 hover:underline"
          >
            Back to the admin panel
          </Link>
          <span className="mx-2 text-gray-400">·</span>
          <Link href="/sign-in" className="text-gray-500 underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
