/**
 * GET /auth/callback (FOLLOW-1336) — code exchange, cookie hand-off, open-redirect guard.
 *
 * `@supabase/ssr` is mocked at the module boundary; the REAL route and the REAL
 * `safeRedirectPath` run. The mocked client's `exchangeCodeForSession` invokes the `setAll` the
 * route passed in, as the real client does, so the cookie hand-off is observable.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExchange = vi.fn();
let capturedSetAll: ((c: { name: string; value: string; options: object }[]) => void) | null = null;

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(
    (
      _url: string,
      _key: string,
      opts: {
        cookies: { setAll: (c: { name: string; value: string; options: object }[]) => void };
      },
    ) => {
      capturedSetAll = opts.cookies.setAll;
      return { auth: { exchangeCodeForSession: mockExchange } };
    },
  ),
}));

import { GET } from './route';

function callback(query: string): NextRequest {
  return new NextRequest(`https://admin.estalara.com/auth/callback${query}`);
}

function location(res: Response): string {
  return res.headers.get('location') ?? '';
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-test');
  mockExchange.mockReset();
  mockExchange.mockImplementation(() => {
    capturedSetAll?.([
      { name: 'sb-test-auth-token', value: 'session-value', options: { path: '/' } },
    ]);
    return Promise.resolve({ data: {}, error: null });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /auth/callback', () => {
  it('valid code → exchanges it, sets the session cookie and redirects to `next`', async () => {
    const res = await GET(callback('?code=abc&next=/reset-password'));

    expect(mockExchange).toHaveBeenCalledWith('abc');
    expect(res.status).toBe(307);
    expect(location(res)).toBe('https://admin.estalara.com/reset-password');
    expect(res.headers.get('set-cookie')).toContain('sb-test-auth-token=session-value');
  });

  it('valid code, no `next` → /admin', async () => {
    const res = await GET(callback('?code=abc'));
    expect(location(res)).toBe('https://admin.estalara.com/admin');
  });

  it.each([
    ['absolute URL', 'https://evil.example'],
    ['protocol-relative', '//evil.example'],
    ['backslash host', '/\\evil'],
  ])('`next` = %s → /admin (never off-origin)', async (_label, next) => {
    const res = await GET(callback(`?code=abc&next=${encodeURIComponent(next)}`));

    expect(location(res)).toBe('https://admin.estalara.com/admin');
    expect(new URL(location(res)).origin).toBe('https://admin.estalara.com');
  });

  it('exchange returns an error → /sign-in?error=invalid_link, no cookie, no raw message', async () => {
    mockExchange.mockResolvedValue({ data: {}, error: { message: 'secret provider detail' } });

    const res = await GET(callback('?code=bad&next=/reset-password'));

    expect(location(res)).toBe('https://admin.estalara.com/sign-in?error=invalid_link');
    expect(location(res)).not.toContain('secret');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('exchange throws → /sign-in?error=invalid_link', async () => {
    mockExchange.mockRejectedValue(new Error('network'));

    const res = await GET(callback('?code=abc'));

    expect(location(res)).toBe('https://admin.estalara.com/sign-in?error=invalid_link');
  });

  it('missing code → /sign-in?error=invalid_link without calling Supabase', async () => {
    const res = await GET(callback('?next=/reset-password'));

    expect(location(res)).toBe('https://admin.estalara.com/sign-in?error=invalid_link');
    expect(mockExchange).not.toHaveBeenCalled();
  });

  it('provider-reported error without a code → /sign-in?error=invalid_link', async () => {
    const res = await GET(callback('?error=access_denied&error_code=otp_expired'));

    expect(location(res)).toBe('https://admin.estalara.com/sign-in?error=invalid_link');
    expect(location(res)).not.toContain('otp_expired');
  });

  it('Supabase env absent → /sign-in?error=invalid_link', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');

    const res = await GET(callback('?code=abc'));

    expect(location(res)).toBe('https://admin.estalara.com/sign-in?error=invalid_link');
    expect(mockExchange).not.toHaveBeenCalled();
  });
});
