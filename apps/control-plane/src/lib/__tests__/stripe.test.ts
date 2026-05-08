/**
 * Tests for Stripe client helpers.
 * Stripe module is mocked — no real API calls are made.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock stripe before importing the module under test ───────────────────────

const mockConstructEvent = vi.fn();

vi.mock('stripe', () => {
  const MockStripe = vi.fn().mockImplementation(() => ({
    webhooks: {
      constructEvent: mockConstructEvent,
    },
  }));
  return { default: MockStripe };
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('constructWebhookEvent', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // Provide required env vars for all tests
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_fake');
  });

  it('returns the event when signature is valid', async () => {
    const fakeEvent = { id: 'evt_123', type: 'invoice.payment_succeeded' };
    mockConstructEvent.mockReturnValueOnce(fakeEvent);

    const { constructWebhookEvent } = await import('../stripe.js');
    const result = constructWebhookEvent('payload', 't=123,v1=abc');

    expect(result).toBe(fakeEvent);
    expect(mockConstructEvent).toHaveBeenCalledWith('payload', 't=123,v1=abc', 'whsec_fake');
  });

  it('throws when Stripe rejects the signature', async () => {
    mockConstructEvent.mockImplementationOnce(() => {
      throw new Error('No signatures found matching the expected signature');
    });

    const { constructWebhookEvent } = await import('../stripe.js');
    expect(() => constructWebhookEvent('tampered', 'bad-sig')).toThrow('No signatures found');
  });

  it('throws when STRIPE_WEBHOOK_SECRET is not set', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');

    const { constructWebhookEvent } = await import('../stripe.js');
    expect(() => constructWebhookEvent('payload', 'sig')).toThrow(
      'STRIPE_WEBHOOK_SECRET is not set',
    );
  });
});

describe('stripePriceToPlan', () => {
  beforeEach(() => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_fake');
    vi.stubEnv('STRIPE_PRICE_OBSERVER', 'price_observer_abc');
    vi.stubEnv('STRIPE_PRICE_AUGMENT', 'price_augment_xyz');
    vi.stubEnv('STRIPE_PRICE_NATIVE', 'price_native_def');
  });

  it('maps known price IDs to the correct plan', async () => {
    const { stripePriceToPlan } = await import('../../app/api/webhooks/stripe/route.js');
    expect(stripePriceToPlan('price_observer_abc')).toBe('observer');
    expect(stripePriceToPlan('price_augment_xyz')).toBe('augment');
    expect(stripePriceToPlan('price_native_def')).toBe('native');
  });

  it('defaults to observer for an unknown price ID', async () => {
    const { stripePriceToPlan } = await import('../../app/api/webhooks/stripe/route.js');
    expect(stripePriceToPlan('price_unknown_999')).toBe('observer');
  });
});
