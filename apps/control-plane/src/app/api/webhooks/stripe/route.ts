/**
 * Stripe webhook endpoint.
 * POST /api/webhooks/stripe
 *
 * Handles:
 *   - customer.subscription.created  → sync plan + status to tenants
 *   - customer.subscription.updated  → sync plan + status to tenants
 *   - customer.subscription.deleted  → downgrade to free plan
 *   - invoice.payment_succeeded      → acknowledged, no action needed
 *   - invoice.payment_failed         → suspend tenant
 *
 * Security: Stripe-Signature header is verified via HMAC before any processing.
 * Return 500 on handler errors so Stripe retries delivery.
 *
 * @module apps/control-plane/src/app/api/webhooks/stripe/route
 */

import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type Stripe from 'stripe';

import { createAdminClient, tenants } from '@estalara/db';

import { constructWebhookEvent, stripePriceToPlan } from '@/lib/stripe';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Raw body is required for Stripe signature verification — do not parse as JSON.
  const payload = await req.text();
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(payload, signature);
  } catch (err) {
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${String(err)}` },
      { status: 400 },
    );
  }

  const db = createAdminClient();

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        await handleSubscriptionChange(db, subscription);
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await handleSubscriptionDeleted(db, subscription);
        break;
      }
      case 'invoice.payment_succeeded': {
        // Successful payment — acknowledged. Billing UI surfaces history in Sprint 4.
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await handlePaymentFailed(db, invoice);
        break;
      }
      default:
        // Unrecognised event type — acknowledge receipt, take no action.
        break;
    }
  } catch (err) {
    // Return 500 so Stripe retries the delivery.
    return NextResponse.json({ error: `Handler failed: ${String(err)}` }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type AdminDb = ReturnType<typeof createAdminClient>;

async function handleSubscriptionChange(db: AdminDb, subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;
  const priceId = subscription.items.data[0]?.price.id ?? '';
  const plan = stripePriceToPlan(priceId);
  const status = subscription.status === 'active' ? 'active' : 'suspended';

  await db
    .update(tenants)
    .set({
      stripeSubscriptionId: subscription.id,
      plan,
      status,
      updatedAt: new Date(),
    })
    .where(eq(tenants.stripeCustomerId, customerId));
}

async function handleSubscriptionDeleted(db: AdminDb, subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;
  await db
    .update(tenants)
    .set({
      plan: 'free',
      status: 'active',
      stripeSubscriptionId: null,
      updatedAt: new Date(),
    })
    .where(eq(tenants.stripeCustomerId, customerId));
}

async function handlePaymentFailed(db: AdminDb, invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;
  await db
    .update(tenants)
    .set({ status: 'suspended', updatedAt: new Date() })
    .where(eq(tenants.stripeCustomerId, customerId));
}
