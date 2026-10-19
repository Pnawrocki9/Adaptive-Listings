'use client';

/**
 * Route-segment error boundary — rendered when a page throws while rendering. [FOLLOW-1336]
 *
 * Shows a fixed message and a retry button. It never prints `error.message` or a stack: in
 * production Next replaces a server error's message with a generic one and a `digest`, and in
 * development the message can name internals. The digest is shown so staff can quote it when
 * looking the failure up in the server logs.
 *
 * No `Sentry.captureException` here: the app has no error-boundary capture pattern, and a
 * boundary-level capture site would be a new line in the FOLLOW-965 register for an exception the
 * server runtime already reports. The root-level `global-error.tsx` carries the one capture the
 * Sentry advisory asks for.
 *
 * @module apps/control-plane/src/app/error
 */

import type React from 'react';
import Link from 'next/link';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <span className="text-2xl font-bold tracking-tight">Estalara</span>
          <p className="mt-1 text-sm text-gray-500">Admin Panel</p>
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-gray-900">Something went wrong</h1>
          <p className="text-sm text-gray-600">
            This page could not be shown. Try again; if it keeps happening, tell an administrator.
          </p>
          {error.digest !== undefined && (
            <p className="text-xs text-gray-400">Reference: {error.digest}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            reset();
          }}
          className="inline-flex h-9 items-center justify-center rounded-md bg-gray-900 px-4 text-sm font-medium text-white hover:bg-gray-800"
        >
          Try again
        </button>
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
