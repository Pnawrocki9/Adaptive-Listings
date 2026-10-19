'use client';

/**
 * ForgotPasswordForm — asks Supabase to e-mail a recovery link. [FOLLOW-1336]
 *
 * `resetPasswordForEmail(email, { redirectTo })` sends the link to `<origin>/auth/callback?next=
 * /reset-password`; the callback route trades the code for a session and lands on /reset-password.
 * The origin must be on the Supabase project's redirect-URL allowlist (CTO handover row 11).
 *
 * NO ACCOUNT ENUMERATION: whatever Supabase answers — unknown address, rate limit, error — the
 * visitor sees the same confirmation. Only a missing Supabase configuration is not hidden, since
 * that is an operator fault and not a fact about any account.
 *
 * @module apps/control-plane/src/app/forgot-password/ForgotPasswordForm
 */

import { useState } from 'react';
import type { SyntheticEvent } from 'react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Shown for every submission that reached Supabase, whatever it answered. */
const FORGOT_PASSWORD_CONFIRMATION =
  'If an account exists for that e-mail address, a password reset link is on its way.';

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [configError, setConfigError] = useState(false);

  async function requestReset() {
    setIsLoading(true);
    setConfigError(false);

    let supabase;
    try {
      supabase = createClient();
    } catch {
      setConfigError(true);
      setIsLoading(false);
      return;
    }

    try {
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
      });
    } catch {
      // Deliberately swallowed: the answer must not depend on the account (see header).
    }
    setDone(true);
    setIsLoading(false);
  }

  function handleSubmit(e: SyntheticEvent) {
    e.preventDefault();
    void requestReset();
  }

  if (done) {
    return (
      <p role="status" className="text-sm text-gray-700">
        {FORGOT_PASSWORD_CONFIRMATION}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
          placeholder="you@estalara.com"
          disabled={isLoading}
        />
      </div>

      {configError && (
        <p role="alert" className="text-sm text-red-600">
          Password reset is not available right now. Contact an administrator.
        </p>
      )}

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? 'Sending…' : 'Send reset link'}
      </Button>
    </form>
  );
}
