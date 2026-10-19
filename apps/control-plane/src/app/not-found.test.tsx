/**
 * Global 404 and error boundaries render (FOLLOW-1336).
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import ErrorBoundary from './error';
import NotFound from './not-found';

describe('not-found', () => {
  it('renders the branded 404 with links back to /admin and /sign-in', () => {
    render(<NotFound />);

    expect(screen.getByRole('heading', { name: /page not found/i })).toBeDefined();
    expect(
      screen
        .getByText(/back to the admin panel/i)
        .closest('a')
        ?.getAttribute('href'),
    ).toBe('/admin');
    expect(screen.getByText('Sign in').closest('a')?.getAttribute('href')).toBe('/sign-in');
  });
});

describe('error boundary', () => {
  const error = Object.assign(new Error('db password is hunter2'), { digest: 'dg-123' });

  it('shows a fixed message and the digest, never the error message or stack', () => {
    const { container } = render(<ErrorBoundary error={error} reset={vi.fn()} />);

    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeDefined();
    expect(screen.getByText(/dg-123/)).toBeDefined();
    expect(container.textContent).not.toContain('hunter2');
    expect(container.textContent).not.toContain('at ');
  });

  it('"Try again" calls reset()', () => {
    const reset = vi.fn();
    render(<ErrorBoundary error={error} reset={reset} />);

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('links back to /admin and /sign-in', () => {
    render(<ErrorBoundary error={error} reset={vi.fn()} />);

    expect(
      screen
        .getByText(/back to the admin panel/i)
        .closest('a')
        ?.getAttribute('href'),
    ).toBe('/admin');
    expect(screen.getByText('Sign in').closest('a')?.getAttribute('href')).toBe('/sign-in');
  });
});
