/**
 * Supabase browser client for use in 'use client' components.
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY from the
 * Next.js public runtime environment.
 *
 * @module apps/control-plane/src/lib/supabase/client
 */

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Create a Supabase browser client for client-side auth operations.
 * Safe to call multiple times — each call creates a new client instance.
 *
 * @throws if NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY are
 *   absent at runtime (indicates misconfiguration, not a caller error).
 */
export function createClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.',
    );
  }

  return createBrowserClient(url, anonKey) as SupabaseClient;
}
