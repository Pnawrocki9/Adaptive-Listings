/**
 * /forgot-password — request a password-recovery e-mail. [FOLLOW-1336]
 *
 * Server Component shell; publicly reachable (no session exists yet). The form is client-side so
 * the PKCE `code_verifier` cookie is written by the browser that will open the e-mail link.
 *
 * @module apps/control-plane/src/app/forgot-password/page
 */

import type React from 'react';
import Link from 'next/link';

import ForgotPasswordForm from './ForgotPasswordForm';

export default function ForgotPasswordPage(): React.JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <span className="text-2xl font-bold tracking-tight">Estalara</span>
          <p className="mt-1 text-sm text-gray-500">Reset your password</p>
        </div>

        <ForgotPasswordForm />

        <p className="text-center text-sm">
          <Link href="/sign-in" className="text-gray-500 underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
