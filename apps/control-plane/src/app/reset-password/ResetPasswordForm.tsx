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

      // The password is already changed; failing to end the OTHER sessions must not strand the
      // user on this page, so the result is not awaited as a gate.
      await supabase.auth.signOut({ scope: 'others' }).catch(() => undefined);

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
