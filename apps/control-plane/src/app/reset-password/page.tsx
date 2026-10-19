/**
 * /reset-password — set a new password after following a recovery link. [FOLLOW-1336]
 *
 * Reachable without a STAFF session (middleware) but not without ANY session: this Server
 * Component requires the session `/auth/callback` created from the recovery code, verified with
 * `getUser()` (a round-trip to Supabase Auth, not a cookie read), and otherwise sends the visitor
 * to `/sign-in?error=invalid_link`.
 *
 * @module apps/control-plane/src/app/reset-password/page
 */

import type React from 'react';
import { redirect } from 'next/navigation';

import { createServerSupabaseClient } from '@/lib/supabase/server';

import ResetPasswordForm from './ResetPasswordForm';

export default async function ResetPasswordPage(): Promise<React.JSX.Element> {
  let hasSession = false;
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    hasSession = user !== null;
  } catch {
    // Unconfigured or unreachable Supabase: no verifiable session, so no password form.
    hasSession = false;
  }
  // redirect() throws NEXT_REDIRECT, so it stays outside the try block above.
  if (!hasSession) redirect('/sign-in?error=invalid_link');

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <span className="text-2xl font-bold tracking-tight">Estalara</span>
          <p className="mt-1 text-sm text-gray-500">Choose a new password</p>
        </div>

        <ResetPasswordForm />
      </div>
    </div>
  );
}
