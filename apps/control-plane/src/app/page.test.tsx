/**
 * Tests for the root page (/) — permanently redirects to /sign-in.
 *
 * Next.js `permanentRedirect()` throws a NEXT_REDIRECT error during rendering.
 * The test verifies this behaviour by asserting the redirect is triggered.
 */
import { describe, expect, it, vi } from 'vitest';

// permanentRedirect throws in the Next.js runtime. Mock it so we can assert it's called.
vi.mock('next/navigation', () => ({
  permanentRedirect: (path: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${path}` });
  },
}));

import RootPage from './page';

describe('Root page (/) redirect', () => {
  it('throws a NEXT_REDIRECT to /sign-in', () => {
    expect(() => {
      RootPage();
    }).toThrow('NEXT_REDIRECT');
  });

  it('redirects to /sign-in path', () => {
    let digest: string | undefined;
    try {
      RootPage();
    } catch (e) {
      const err = e as { digest?: string };
      digest = err.digest;
    }
    expect(digest).toContain('/sign-in');
  });
});
