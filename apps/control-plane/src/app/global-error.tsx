'use client';

/**
 * Root error boundary — rendered when the ROOT LAYOUT itself throws. [FOLLOW-1336]
 *
 * `next build` advises a global error handler when `@sentry/nextjs` is installed without one. This
 * replaces the root layout, so it brings its own `<html>`/`<body>` and — `globals.css` not being
 * loaded — plain inline styles. It is the one boundary that reports to Sentry (a no-op while the
 * DSN is unset; see the FOLLOW-965 register in `observability-signals.test.ts`). Like `error.tsx`
 * it never prints the message or a stack.
 *
 * @module apps/control-plane/src/app/global-error
 */

import * as Sentry from '@sentry/nextjs';
import type React from 'react';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: 360, padding: 16 }}>
          <p style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Estalara</p>
          <h1 style={{ fontSize: 20, margin: '16px 0 8px' }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: '#4b5563' }}>
            The page could not be shown. Try again; if it keeps happening, tell an administrator.
          </p>
          {error.digest !== undefined && (
            <p style={{ fontSize: 12, color: '#9ca3af' }}>Reference: {error.digest}</p>
          )}
          <button
            type="button"
            onClick={() => {
              reset();
            }}
            style={{
              marginTop: 16,
              padding: '8px 16px',
              borderRadius: 6,
              border: 0,
              background: '#111827',
              color: '#fff',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          <p style={{ fontSize: 14, marginTop: 16 }}>
            <a href="/admin">Back to the admin panel</a> · <a href="/sign-in">Sign in</a>
          </p>
        </div>
      </body>
    </html>
  );
}
