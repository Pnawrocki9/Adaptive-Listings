/**
 * Root error boundary (FOLLOW-1336). Own file: it roots React at `document` (the boundary renders
 * `<html>`), which breaks click delegation for any test that shares the module's earlier roots.
 */
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { mockCaptureException } = vi.hoisted(() => ({ mockCaptureException: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureException: mockCaptureException }));

import GlobalError from './global-error';

describe('global-error boundary', () => {
  it('reports the error to Sentry once, shows only a fixed message and offers reset()', () => {
    const error = Object.assign(new Error('layout exploded: secret'), { digest: 'dg-9' });
    const reset = vi.fn();
    // The boundary owns <html>, so React must be rooted at the document itself.
    render(<GlobalError error={error} reset={reset} />, {
      container: document,
      baseElement: document.documentElement,
    });

    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect(mockCaptureException).toHaveBeenCalledWith(error);
    expect(document.body.textContent).not.toContain('secret');

    act(() => {
      screen.getByRole('button', { name: /try again/i }).click();
    });
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
