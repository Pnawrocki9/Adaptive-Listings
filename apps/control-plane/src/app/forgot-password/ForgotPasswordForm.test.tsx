/**
 * ForgotPasswordForm (FOLLOW-1336) — recovery e-mail request, no account enumeration.
 *
 * The Supabase client is mocked at the `@/lib/supabase/client` boundary the form imports; the REAL
 * form runs. Unknown e-mail, rate limit and thrown errors must all produce the SAME confirmation.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReset = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({ auth: { resetPasswordForEmail: mockReset } })),
}));

import { createClient } from '@/lib/supabase/client';
import ForgotPasswordForm from './ForgotPasswordForm';

async function submit(email: string): Promise<string> {
  render(<ForgotPasswordForm />);
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } });
  fireEvent.submit(screen.getByLabelText(/email/i).closest('form')!);
  const status = await screen.findByRole('status');
  return status.textContent;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ForgotPasswordForm', () => {
  it('requests a reset with redirectTo = <origin>/auth/callback?next=/reset-password', async () => {
    mockReset.mockResolvedValue({ data: {}, error: null });

    await submit('staff@estalara.com');

    expect(mockReset).toHaveBeenCalledWith('staff@estalara.com', {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
  });

  it('shows the SAME confirmation for a known address, an unknown address, an error and a throw', async () => {
    mockReset.mockResolvedValueOnce({ data: {}, error: null });
    const known = await submit('staff@estalara.com');
    document.body.innerHTML = '';

    mockReset.mockResolvedValueOnce({
      data: null,
      error: { message: 'User not found', status: 400 },
    });
    const unknown = await submit('nobody@example.com');
    document.body.innerHTML = '';

    mockReset.mockResolvedValueOnce({ data: null, error: { message: 'rate limit', status: 429 } });
    const limited = await submit('staff@estalara.com');
    document.body.innerHTML = '';

    mockReset.mockRejectedValueOnce(new Error('network'));
    const thrown = await submit('staff@estalara.com');

    expect(known).toMatch(/if an account exists/i);
    expect(unknown).toBe(known);
    expect(limited).toBe(known);
    expect(thrown).toBe(known);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Supabase unconfigured → an operator-facing alert, no confirmation, no request', async () => {
    vi.mocked(createClient).mockImplementationOnce(() => {
      throw new Error('Supabase is not configured');
    });

    render(<ForgotPasswordForm />);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.co' } });
    fireEvent.submit(screen.getByLabelText(/email/i).closest('form')!);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    expect(screen.queryByRole('status')).toBeNull();
    expect(mockReset).not.toHaveBeenCalled();
  });
});
