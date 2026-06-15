/**
 * Supabase server client for use in Server Components and Server Actions.
 *
 * Uses `createServerClient` from `@supabase/ssr` with the Next.js 15 App Router
 * cookie API (`cookies()` from `next/headers`). In Next.js 15, `cookies()` is
 * async — this helper `await`s it before constructing the client.
 *
 * @module apps/control-plane/src/lib/supabase/server
 */

import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

/**
 * Create a Supabase server client bound to the current request's cookie store.
 *
 * Must be called from a Server Component, Server Action, or Route Handler —
 * NOT from a 'use client' component.
 *
 * @throws if NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY are absent.
 */
export async function createServerSupabaseClient(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.',
    );
  }

  // In Next.js 15, cookies() returns a Promise — must be awaited before use.
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // setAll can throw inside a Server Component (read-only context).
          // This is safe to ignore — the auth token is written by the browser
          // client via signInWithPassword(), not by server helpers.
        }
      },
    },
  });
}
