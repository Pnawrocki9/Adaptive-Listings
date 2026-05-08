/**
 * Stripe client singleton for server-side use only.
 * Never import this in client components or Edge Runtime middleware.
 *
 * Usage:
 *   import { stripe } from '@/lib/stripe';
 *   const customer = await stripe.customers.retrieve(customerId);
 *
 * @module apps/control-plane/src/lib/stripe
 */

import Stripe from 'stripe';

// Lazy singleton — do NOT initialize at module load time.
// next build imports route modules without env vars present; throwing here
// breaks the build. The client is created on first use instead.
let _stripe: Stripe | undefined;

/**
 * Return the Stripe client, initializing it on first call.
 * Throws if STRIPE_SECRET_KEY is missing at call time.
 */
export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    _stripe = new Stripe(key, { apiVersion: '2026-04-22.dahlia', typescript: true });
  }
  return _stripe;
}

/**
 * Verify a Stripe webhook signature and return the typed event.
 * Throws if the signature is invalid — prevents replay attacks.
 *
 * @param payload  - Raw request body string or Buffer (must not be parsed)
 * @param signature - Value of the `Stripe-Signature` request header
 */
export function constructWebhookEvent(payload: string | Buffer, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  return getStripe().webhooks.constructEvent(payload, signature, secret);
}

/**
 * Map a Stripe price ID to an Estalara plan name.
 * Falls back to 'observer' for unrecognised price IDs.
 * Env vars: STRIPE_PRICE_OBSERVER, STRIPE_PRICE_AUGMENT, STRIPE_PRICE_NATIVE
 */
export function stripePriceToPlan(priceId: string): string {
  const map: Record<string, string> = {
    [process.env.STRIPE_PRICE_OBSERVER ?? '']: 'observer',
    [process.env.STRIPE_PRICE_AUGMENT ?? '']: 'augment',
    [process.env.STRIPE_PRICE_NATIVE ?? '']: 'native',
  };
  return map[priceId] ?? 'observer';
}
