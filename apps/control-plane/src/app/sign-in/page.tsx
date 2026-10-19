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

import { SIGN_IN_ERROR_MESSAGES } from './messages';
import SignInForm from './SignInForm';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}): Promise<React.JSX.Element> {
  const { error } = await searchParams;
  // hasOwn, not a bare index: `?error=__proto__` / `toString` / `constructor` must not resolve to
  // an inherited Object.prototype member.
  const notice =
    typeof error === 'string' && Object.hasOwn(SIGN_IN_ERROR_MESSAGES, error)
      ? SIGN_IN_ERROR_MESSAGES[error]
      : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm space-y-8">
        {/* Wordmark */}
        <div className="text-center">
          <span className="text-2xl font-bold tracking-tight">Estalara</span>
          <p className="mt-1 text-sm text-gray-500">Admin Panel</p>
        </div>

        {notice !== null && (
          <p role="alert" className="text-sm text-red-600">
            {notice}
          </p>
        )}

        <SignInForm />
      </div>
    </div>
  );
}
