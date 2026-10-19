/**
 * Tests for SignInForm.tsx (FOLLOW-336, RETRO-083 TG-2).
 *
 * Coverage:
 *   SIGN-IN-1: signInWithPassword() succeeds → router.push('/admin') called
 *   SIGN-IN-2: signInWithPassword() returns an error → error message displayed,
 *              email and password fields retain their entered values
 *   SIGN-IN-3: signInWithPassword() throws (network error) → error message displayed
 *
 * The Supabase client is mocked via @/lib/supabase/client (the production module that
 * SignInForm imports). We mock the module boundary — not the form logic — so the REAL
 * SignInForm code runs end-to-end, including the handleSubmit → doSignIn call chain.
 *
 * Rule Q guardrail: signInWithPassword's return value (success or error) is NOT
 * injected into SignInForm directly. It comes from the mocked Supabase client that
 * SignInForm calls through its production import path (@/lib/supabase/client →
 * createClient() → supabase.auth.signInWithPassword). The test controls what
 * signInWithPassword() returns — it does NOT bypass the call.
 *
 * @module apps/control-plane/src/app/sign-in/SignInForm.test
 */

import type React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock next/navigation ─────────────────────────────────────────────────────
// useRouter is called inside SignInForm to push to /admin on success.

const mockRouterPush = vi.fn();
const mockRouterReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: mockRouterPush, replace: mockRouterReplace })),
}));

// next/link needs the App Router context, absent in jsdom — render a plain anchor.
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// ─── Mock @/lib/supabase/client ───────────────────────────────────────────────
// SignInForm imports createClient() from this module. We mock the module so
// signInWithPassword() is controllable per test. The REAL SignInForm calls
// createClient() → supabase.auth.signInWithPassword() on submit — no bypass.

const mockSignInWithPassword = vi.fn();
const mockUnsubscribe = vi.fn();
let authStateListener: ((event: string) => void) | null = null;
const mockOnAuthStateChange = vi.fn((cb: (event: string) => void) => {
  authStateListener = cb;
  return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
      onAuthStateChange: mockOnAuthStateChange,
    },
  })),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────
// vi.mock calls are hoisted; the import must come after the mock declarations.

import { createClient } from '@/lib/supabase/client';
import SignInForm from './SignInForm';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SignInForm (FOLLOW-336)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouterPush.mockReset();
    mockRouterReplace.mockReset();
    authStateListener = null;
  });

  it('SIGN-IN-1: signInWithPassword success → router.push("/admin") called', async () => {
    // The success path: signInWithPassword() resolves with no error.
    // The REAL doSignIn() in SignInForm reads this and calls router.push('/admin').
    mockSignInWithPassword.mockResolvedValue({ data: {}, error: null });

    render(<SignInForm />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'staff@estalara.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'correct-password' },
    });
    fireEvent.submit(screen.getByLabelText(/email/i).closest('form')!);

    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledWith('/admin');
    });

    // No error message should be visible.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('SIGN-IN-2: signInWithPassword error → error message displayed, fields retain values', async () => {
    // The error path: signInWithPassword() resolves with an error object.
    // The REAL doSignIn() catches this and calls setError('Invalid email or password').
    mockSignInWithPassword.mockResolvedValue({
      data: {},
      error: { message: 'Invalid login credentials', status: 400 },
    });

    render(<SignInForm />);

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);

    fireEvent.change(emailInput, { target: { value: 'wrong@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'bad-password' } });

    act(() => {
      fireEvent.submit(emailInput.closest('form')!);
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });

    // Error message text matches the literal string set by SignInForm.
    expect(screen.getByRole('alert').textContent).toMatch(/invalid email or password/i);

    // Field values are retained (form does not reset on error).
    expect((emailInput as HTMLInputElement).value).toBe('wrong@example.com');
    expect((passwordInput as HTMLInputElement).value).toBe('bad-password');

    // router.push must NOT be called on error.
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it('SIGN-IN-3: signInWithPassword throws (network error) → error message displayed', async () => {
    // The catch path: a thrown error (network failure, etc.).
    // SignInForm's catch block also calls setError('Invalid email or password').
    mockSignInWithPassword.mockRejectedValue(new Error('Network error'));

    render(<SignInForm />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'staff@estalara.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'any-password' },
    });

    act(() => {
      fireEvent.submit(screen.getByLabelText(/email/i).closest('form')!);
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });

    expect(screen.getByRole('alert').textContent).toMatch(/invalid email or password/i);
    expect(mockRouterPush).not.toHaveBeenCalled();
  });
  it('RESET-1 (FOLLOW-1336): the browser client is created once on mount and reused by submit', async () => {
    mockSignInWithPassword.mockResolvedValue({ data: {}, error: null });
    vi.mocked(createClient).mockClear();

    render(<SignInForm />);
    expect(createClient).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'staff@estalara.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'pw' } });
    fireEvent.submit(screen.getByLabelText(/email/i).closest('form')!);

    await waitFor(() => {
      expect(mockRouterPush).toHaveBeenCalledWith('/admin');
    });
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it('RESET-2 (FOLLOW-1336): a PASSWORD_RECOVERY auth event sends the user to /reset-password', () => {
    render(<SignInForm />);
    expect(authStateListener).not.toBeNull();

    act(() => {
      authStateListener?.('SIGNED_OUT');
    });
    expect(mockRouterReplace).not.toHaveBeenCalled();

    act(() => {
      authStateListener?.('PASSWORD_RECOVERY');
    });
    expect(mockRouterReplace).toHaveBeenCalledWith('/reset-password');
  });

  it('RESET-3 (FOLLOW-1336): "Forgot password?" links to /forgot-password', () => {
    render(<SignInForm />);
    expect(screen.getByText('Forgot password?').closest('a')?.getAttribute('href')).toBe(
      '/forgot-password',
    );
  });
});
