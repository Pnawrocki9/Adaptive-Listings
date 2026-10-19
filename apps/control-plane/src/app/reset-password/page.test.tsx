/**
 * /reset-password (FOLLOW-1336) — the Server Component requires the recovery session; the form
 * sets the password, ends the other sessions and goes to /admin.
 */
import type React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRedirect, mockGetUser, mockUpdateUser, mockSignOut, mockPush } = vi.hoisted(() => ({
  mockRedirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
  mockGetUser: vi.fn(),
  mockUpdateUser: vi.fn(),
  mockSignOut: vi.fn(),
  mockPush: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
  useRouter: () => ({ push: mockPush }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(() => Promise.resolve({ auth: { getUser: mockGetUser } })),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({ auth: { updateUser: mockUpdateUser, signOut: mockSignOut } })),
}));

import ResetPasswordPage from './page';
import ResetPasswordForm from './ResetPasswordForm';

beforeEach(() => {
  vi.clearAllMocks();
  mockSignOut.mockResolvedValue({ error: null });
});

describe('ResetPasswordPage (server component)', () => {
  it('no session → redirects to /sign-in', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(ResetPasswordPage()).rejects.toThrow('NEXT_REDIRECT:/sign-in?error=invalid_link');
  });

  it('Supabase throws → redirects to /sign-in (no form without a verifiable session)', async () => {
    mockGetUser.mockRejectedValue(new Error('unreachable'));

    await expect(ResetPasswordPage()).rejects.toThrow('NEXT_REDIRECT:/sign-in');
  });

  it('recovery session present → renders the form, no redirect', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });

    render(await ResetPasswordPage());

    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^new password/i)).toBeDefined();
  });
});

describe('ResetPasswordForm', () => {
  function fill(password: string, confirm: string) {
    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: password } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: confirm },
    });
    fireEvent.submit(screen.getByLabelText(/^new password/i).closest('form')!);
  }

  it('password shorter than 12 → inline error, Supabase not called', async () => {
    render(<ResetPasswordForm />);
    fill('short-pw', 'short-pw');

    expect((await screen.findByRole('alert')).textContent).toMatch(/at least 12/);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('mismatched confirmation → inline error, Supabase not called', async () => {
    render(<ResetPasswordForm />);
    fill('a-long-enough-password', 'a-different-password');

    expect((await screen.findByRole('alert')).textContent).toMatch(/do not match/i);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('success → updateUser, signs out OTHER sessions, then goes to /admin', async () => {
    mockUpdateUser.mockResolvedValue({ data: {}, error: null });
    render(<ResetPasswordForm />);
    fill('a-long-enough-password', 'a-long-enough-password');

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/admin');
    });
    expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'a-long-enough-password' });
    expect(mockSignOut).toHaveBeenCalledWith({ scope: 'others' });
  });

  it('updateUser error → fixed message, no raw provider text, no navigation', async () => {
    mockUpdateUser.mockResolvedValue({ data: null, error: { message: 'raw detail', code: 'x' } });
    render(<ResetPasswordForm />);
    fill('a-long-enough-password', 'a-long-enough-password');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toContain('raw detail');
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('sign-out-others returns an error → password kept, neutral notice, link on to /admin, no redirect', async () => {
    mockUpdateUser.mockResolvedValue({ data: {}, error: null });
    mockSignOut.mockResolvedValue({ error: { message: 'raw detail' } });
    render(<ResetPasswordForm />);
    fill('a-long-enough-password', 'a-long-enough-password');

    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch(/other devices may still be signed in/i);
    expect(status.textContent).not.toContain('raw detail');
    expect(
      screen
        .getByText(/continue to the admin panel/i)
        .closest('a')
        ?.getAttribute('href'),
    ).toBe('/admin');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('sign-out-others throws → the same notice and link', async () => {
    mockUpdateUser.mockResolvedValue({ data: {}, error: null });
    mockSignOut.mockRejectedValue(new Error('boom'));
    render(<ResetPasswordForm />);
    fill('a-long-enough-password', 'a-long-enough-password');

    expect((await screen.findByRole('status')).textContent).toMatch(/may still be signed in/i);
    expect(mockPush).not.toHaveBeenCalled();
  });
});
