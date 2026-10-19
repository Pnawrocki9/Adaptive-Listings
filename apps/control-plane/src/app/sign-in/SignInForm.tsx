'use client';

/**
 * SignInForm — client component that handles Supabase email/password sign-in.
 *
 * Uses the browser Supabase client (`createClient`) to call signInWithPassword(). The client is
 * created ONCE per mounted form (FOLLOW-1336) — on mount, not only inside the submit handler — so
 * a session handed back in the URL (a recovery link that landed here instead of /auth/callback) is
 * picked up and a PASSWORD_RECOVERY event sends the user to /reset-password rather than leaving
 * them on a dead-end form.
 * On success, redirects to /admin via Next.js router.
 * On failure, surfaces the error inline and retains field values.
 *
 * @module apps/control-plane/src/app/sign-in/SignInForm
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const supabaseRef = useRef<SupabaseClient | null>(null);

  /** The form's single browser client; throws when Supabase is unconfigured (see createClient). */
  const getSupabase = useCallback((): SupabaseClient => {
    supabaseRef.current ??= createClient();
    return supabaseRef.current;
  }, []);

  useEffect(() => {
    try {
      const { data } = getSupabase().auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY') router.replace('/reset-password');
      });
      return () => {
        data.subscription.unsubscribe();
      };
    } catch {
      // Supabase is not configured in this environment; submitting the form surfaces the error.
      return undefined;
    }
  }, [getSupabase, router]);

  async function doSignIn() {
    setError(null);
    setIsLoading(true);

    try {
      const { error: signInError } = await getSupabase().auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError('Invalid email or password');
        return;
      }

      router.push('/admin');
    } catch {
      setError('Invalid email or password');
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(e: SyntheticEvent) {
    e.preventDefault();
    void doSignIn();
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

      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
          placeholder="••••••••"
          disabled={isLoading}
        />
      </div>

      {error !== null && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? 'Signing in…' : 'Sign in'}
      </Button>

      <p className="text-center text-sm">
        <Link href="/forgot-password" className="text-gray-500 underline-offset-4 hover:underline">
          Forgot password?
        </Link>
      </p>
    </form>
  );
}
