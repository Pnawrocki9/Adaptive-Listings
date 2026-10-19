/**
 * Tests for OpenListingForm (FOLLOW-1334): submitting a listing id navigates to that listing’s
 * answers manager under the tenant, with the id percent-encoded; a blank id navigates nowhere.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/listings/open-listing-form.test
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { OpenListingForm } from './open-listing-form';

const TENANT = '11111111-1111-4111-8111-111111111111';

describe('OpenListingForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('navigates to the tenant’s answers page for the typed listing id (percent-encoded)', () => {
    render(<OpenListingForm tenantId={TENANT} />);

    fireEvent.change(screen.getByLabelText(/Listing ID/), { target: { value: ' a/b c ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open FAQ answers' }));

    expect(push).toHaveBeenCalledWith(`/admin/tenants/${TENANT}/listings/a%2Fb%20c/answers`);
  });

  it('does not navigate on a whitespace-only id', () => {
    render(<OpenListingForm tenantId={TENANT} />);

    fireEvent.change(screen.getByLabelText(/Listing ID/), { target: { value: '   ' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Open FAQ answers' }).closest('form')!);

    expect(push).not.toHaveBeenCalled();
  });
});
