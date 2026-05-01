import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

// Mock next/link for tests
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Mock next/font/google for layout tests
vi.mock('next/font/google', () => ({
  Inter: () => ({ variable: '--font-inter', className: 'inter' }),
}));

// Mock next-themes
vi.mock('next-themes', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import Landing from './page';

describe('Landing page', () => {
  it('renders the main headline', () => {
    render(<Landing />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Adaptive Listings')).toBeInTheDocument();
  });

  it('renders Sign in CTA button', () => {
    render(<Landing />);
    const signInLinks = screen.getAllByRole('link', { name: /sign in/i });
    expect(signInLinks.length).toBeGreaterThanOrEqual(1);
    expect(signInLinks[0]).toHaveAttribute('href', '/sign-in');
  });

  it('renders Try demo CTA button', () => {
    render(<Landing />);
    const demoLinks = screen.getAllByRole('link', { name: /try demo/i });
    expect(demoLinks.length).toBeGreaterThanOrEqual(1);
    expect(demoLinks[0]).toHaveAttribute('href', '/onboarding');
  });

  it('renders footer with copyright', () => {
    render(<Landing />);
    expect(screen.getByText(/2026 Time2Show Inc/i)).toBeInTheDocument();
  });

  it('renders navigation header', () => {
    render(<Landing />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    // "Estalara" appears in both the nav brand span and the h1 — getAllByText handles multiple
    const estalaraElements = screen.getAllByText(/^Estalara$/);
    expect(estalaraElements.length).toBeGreaterThanOrEqual(1);
  });

  it('renders feature highlights section', () => {
    render(<Landing />);
    expect(screen.getByText('60s')).toBeInTheDocument();
    expect(screen.getByText('Time to embed')).toBeInTheDocument();
    expect(screen.getByText(/80ms/)).toBeInTheDocument();
    expect(screen.getByText('Decision latency')).toBeInTheDocument();
  });

  it('renders privacy and terms links in footer', () => {
    render(<Landing />);
    expect(screen.getByRole('link', { name: /privacy/i })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: /terms/i })).toHaveAttribute('href', '/terms');
  });
});
