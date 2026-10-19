'use client';

/**
 * ResetPasswordForm — sets the new password for the recovery session. [FOLLOW-1336]
 *
 * `updateUser({ password })` on the browser client, then `signOut({ scope: 'others' })` so a stolen
 * older session does not survive the reset, then navigates to /admin.
 *
 * @module apps/control-plane/src/app/reset-password/ResetPasswordForm
 */

import { useState } from 'react';
import type { SyntheticEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { createClient } from '@/lib/supabase/client';
import { MIN_PASSWORD_LENGTH } from '@/lib/password-policy';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionsNotice, setSessionsNotice] = useState(false);

  async function doReset() {
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${String(MIN_PASSWORD_LENGTH)} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(
          updateError.code === 'weak_password'
            ? 'That password does not meet the strength requirements.'
            : 'Could not update the password. The link may have expired — request a new one.',
        );
        return;
      }

      // The password is already changed, so a failure to end the OTHER sessions must not block
      // the user or undo it. The call IS awaited; when it fails (an error result or a throw) the
      // user is told neutrally that other sessions may still be signed in and continues to /admin
      // from a link instead of being redirected past the notice.
      let othersEnded = true;
      try {
        const { error: signOutError } = await supabase.auth.signOut({ scope: 'others' });
        othersEnded = !signOutError;
      } catch {
        othersEnded = false;
      }
      if (!othersEnded) {
        setSessionsNotice(true);
        return;
      }

      router.push('/admin');
    } catch {
      setError('Could not update the password. Try again.');
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(e: SyntheticEvent) {
    e.preventDefault();
    void doReset();
  }

  if (sessionsNotice) {
    return (
      <div className="w-full space-y-4">
        <p role="status" className="text-sm text-gray-700">
          Your password was changed. Other devices may still be signed in.
        </p>
        <Link href="/admin" className="block text-center text-sm font-medium underline">
          Continue to the admin panel
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="new-password">New password</Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
          disabled={isLoading}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirm-password">Confirm new password</Label>
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
          }}
          disabled={isLoading}
        />
      </div>

      {error !== null && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? 'Saving…' : 'Set new password'}
      </Button>
    </form>
  );
}
