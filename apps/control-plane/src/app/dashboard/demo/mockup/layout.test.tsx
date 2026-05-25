/**
 * MockupLayout — FOLLOW-105 §F.2 demo-mockup data-decision-url test.
 *
 * Asserts the demo mockup SDK <script> renders an ABSOLUTE control-plane
 * data-decision-url (https://admin.estalara.com/api), not the pre-FOLLOW-105
 * relative "/api". A relative path resolves against whatever origin the SDK
 * loads on; only an absolute host is a safe canonical target.
 *
 * @module apps/control-plane/src/app/dashboard/demo/mockup/layout.test
 */

import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CONTROL_PLANE_URL } from '@estalara/shared';

// next/script defers DOM injection (afterInteractive) and does not render a
// <script> synchronously in jsdom. Mock it to a pass-through <script> so the
// data-* attributes the layout sets are inspectable in the rendered tree.
vi.mock('next/script', () => ({
  default: (props: Record<string, unknown>) => <script {...props} />,
}));

import MockupLayout from './layout';

describe('MockupLayout — FOLLOW-105 §F.2 data-decision-url', () => {
  it('renders an absolute https:// data-decision-url on the SDK script', () => {
    const { container } = render(
      <MockupLayout>
        <div>child</div>
      </MockupLayout>,
    );

    // next/script (afterInteractive) renders a <script> with the data-* attrs.
    const script = container.querySelector('script[data-decision-url]');
    expect(script).not.toBeNull();

    const decisionUrl = script?.getAttribute('data-decision-url') ?? '';
    expect(decisionUrl).toBe(`${CONTROL_PLANE_URL}/api`);
    expect(decisionUrl).toBe('https://admin.estalara.com/api');
    // Absolute — never a relative "/api".
    expect(decisionUrl.startsWith('https://')).toBe(true);
    expect(decisionUrl.startsWith('/')).toBe(false);
    // SDK appends "/adapt" → canonical endpoint.
    expect(`${decisionUrl}/adapt`).toBe('https://admin.estalara.com/api/adapt');
  });
});
