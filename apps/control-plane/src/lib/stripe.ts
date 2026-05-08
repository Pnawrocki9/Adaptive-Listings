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

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set');
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2026-04-22.dahlia',
  typescript: true,
});

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
  return stripe.webhooks.constructEvent(payload, signature, secret);
}
