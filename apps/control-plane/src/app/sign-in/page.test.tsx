/**
 * /sign-in page (FOLLOW-1336) — maps the fixed `?error=` codes from /auth/callback and
 * /reset-password to messages; unknown codes render nothing.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./SignInForm', () => ({ default: () => <div data-testid="form" /> }));

import SignInPage from './page';

describe('SignInPage', () => {
  it('renders the invalid-link message for ?error=invalid_link', async () => {
    render(await SignInPage({ searchParams: Promise.resolve({ error: 'invalid_link' }) }));
    expect(screen.getByRole('alert').textContent).toMatch(/invalid or has expired/i);
  });

  it('renders no alert for an unknown code (never echoes the query)', async () => {
    render(await SignInPage({ searchParams: Promise.resolve({ error: '<script>x</script>' }) }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders no alert without an error param', async () => {
    render(await SignInPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
