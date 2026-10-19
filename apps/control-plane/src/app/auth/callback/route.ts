/**
 * GET /auth/callback — exchanges the Supabase `code` for a session. [FOLLOW-1336]
 *
 * The landing point of a Supabase e-mail link (password recovery, magic link). With the PKCE flow
 * `@supabase/ssr` uses, the link returns `?code=…`; this route trades it for a session with
 * `exchangeCodeForSession` (the matching `code_verifier` cookie was set by the browser that
 * requested the e-mail), writes the session cookies onto the redirect, and sends the browser on to
 * `next` — a SAME-ORIGIN RELATIVE PATH only (`safeRedirectPath`; default `/admin`).
 *
 * Failure never echoes Supabase's message: every failure redirects to `/sign-in?error=invalid_link`.
 *
 * Public by design (see `PUBLIC_PREFIXES` in `middleware.ts`): it is what CREATES the session. It
 * grants nothing by itself — `/admin/*` still requires an Estalara staff user.
 *
 * @module apps/control-plane/src/app/auth/callback/route
 */

import { createServerClient } from '@supabase/ssr';
import type { CookieOptions } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { safeRedirectPath } from '@/lib/safe-redirect-path';

/** The one fixed error code the sign-in page maps to a message. */
const INVALID_LINK = 'invalid_link';

function failureRedirect(origin: string): NextResponse {
  return NextResponse.redirect(new URL(`/sign-in?error=${INVALID_LINK}`, origin));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // A provider-reported error (`?error=access_denied&error_code=otp_expired`) arrives without a code.
  if (!code || !url || !anonKey) return failureRedirect(origin);

  const cookiesToSet: { name: string; value: string; options: CookieOptions }[] = [];
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookies) {
        cookiesToSet.push(...cookies);
      },
    },
  });

  let exchangeFailed = false;
  try {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    exchangeFailed = error !== null;
  } catch {
    exchangeFailed = true;
  }
  if (exchangeFailed) return failureRedirect(origin);

  const response = NextResponse.redirect(
    new URL(safeRedirectPath(searchParams.get('next')), origin),
  );
  for (const { name, value, options } of cookiesToSet) {
    response.cookies.set(name, value, options);
  }
  return response;
}
