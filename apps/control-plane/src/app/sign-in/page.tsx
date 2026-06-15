/**
 * /sign-in — Estalara admin sign-in page.
 *
 * Server Component root. Publicly accessible — no auth required.
 * Contains the SignInForm client component which handles Supabase
 * email/password authentication.
 *
 * AC1: GET /sign-in → 200, renders wordmark + email + password + "Sign in" button.
 *
 * @module apps/control-plane/src/app/sign-in/page
 */

import type React from 'react';

import SignInForm from './SignInForm';

export default function SignInPage(): React.JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm space-y-8">
        {/* Wordmark */}
        <div className="text-center">
          <span className="text-2xl font-bold tracking-tight">Estalara</span>
          <p className="mt-1 text-sm text-gray-500">Admin Panel</p>
        </div>

        <SignInForm />
      </div>
    </div>
  );
}
