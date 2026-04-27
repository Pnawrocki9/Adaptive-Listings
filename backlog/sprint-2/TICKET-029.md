---
id: TICKET-029
title: Stripe billing webhook stub + usage_metering table
sprint: 2
priority: P1
agent: backend-engineer
status: BLOCKED
estimated_hours: 4
depends_on: [TICKET-021]
produces: []
affects_files:
  - 'packages/db/src/schema/usage_metering.ts'
  - 'packages/db/src/schema/subscriptions.ts'
  - 'packages/db/migrations/0004_create_billing.sql'
  - 'apps/control-plane/src/app/api/v1/webhooks/stripe/route.ts'
  - 'apps/control-plane/src/lib/stripe.ts'
  - 'apps/control-plane/tests/api/webhooks-stripe.test.ts'
  - 'docs/runbooks/billing.md'
context_files:
  - packages/db/src/schema/tenants.ts (TICKET-021)
  - docs/MASTER_DESIGN.md (section M — pricing)
  - .claude/agents/backend-engineer.md
labels: [sprint-2, p1, backend, billing]
---

# TICKET-029: Stripe billing webhook stub + usage_metering

## Summary

Two related foundational pieces for the billing path:

1. **Database tables** for `subscriptions` (one row per tenant linking to Stripe
   customer/subscription IDs) and `usage_metering` (event-level usage records: tenant_id, metric,
   value, period, recorded_at — supports per-tenant usage aggregation for billing).
2. **Stripe webhook endpoint stub** at `/api/v1/webhooks/stripe`: verifies Stripe signature, parses
   event, logs the event type, persists customer/subscription state changes for
   `customer.subscription.created/updated/deleted` and `invoice.payment_succeeded`. No real
   reconciliation logic yet — that's Sprint 7.

This ticket sets up the wiring so when we wire real billing in Sprint 7, the table schema and
webhook signature verification are already proven. **No real Stripe customer creation in this
ticket.**

## Context

Master Design M mentions tier-based pricing (Observer, Augment, Native) with usage-based components
(events/month, AI calls/month). Stripe is the chosen billing provider.

For MVP, we won't run real billing — pilot tenants use complimentary access. But we want the
structure in place so when we flip the switch in Sprint 7, it's a wiring change not an architecture
change.

## Scope

### In scope

- New tables:
  - `subscriptions`:
    - `id UUID PK`
    - `tenant_id UUID FK NOT NULL UNIQUE` (one subscription per tenant)
    - `stripe_customer_id TEXT`
    - `stripe_subscription_id TEXT`
    - `stripe_price_id TEXT`
    - `tier TEXT CHECK (tier IN ('observer','augment','native'))`
    - `status TEXT CHECK (status IN ('trialing','active','past_due','canceled','unpaid','incomplete'))`
    - `current_period_start TIMESTAMPTZ`
    - `current_period_end TIMESTAMPTZ`
    - `cancel_at_period_end BOOLEAN DEFAULT false`
    - `trial_end TIMESTAMPTZ`
    - `created_at`, `updated_at`, `deleted_at`
  - `usage_metering`:
    - `id UUID PK DEFAULT gen_random_uuid()`
    - `tenant_id UUID FK NOT NULL`
    - `metric TEXT NOT NULL` (e.g., `'events_ingested'`, `'ai_calls_haiku'`, `'ai_calls_sonnet'`,
      `'mb_stored'`)
    - `value DOUBLE PRECISION NOT NULL`
    - `period DATE NOT NULL` (the day this usage applies to)
    - `recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()`
    - `metadata JSONB DEFAULT '{}'`
- RLS on both: admin role can read/write own tenant's data
- Indexes:
  - `subscriptions(stripe_customer_id)` for webhook lookup
  - `usage_metering(tenant_id, period, metric)` for billing aggregation
- `apps/control-plane/src/lib/stripe.ts`: Stripe client factory (lazy, only when STRIPE_SECRET_KEY
  present)
- Webhook route `POST /api/v1/webhooks/stripe`:
  - Reads raw body
  - Verifies signature with `stripe.webhooks.constructEvent` using `STRIPE_WEBHOOK_SECRET`
  - Returns 400 on invalid sig
  - Logs event type + id for audit
  - Handles 4 event types (stub logic, just upsert subscription row):
    `customer.subscription.created`, `customer.subscription.updated`,
    `customer.subscription.deleted`, `invoice.payment_succeeded`
  - Returns 200 (Stripe expects 200 quickly to avoid retries)
- Tests
- `docs/runbooks/billing.md`: how Stripe webhook works, where the secret is stored, how to test
  locally with Stripe CLI

### Out of scope

- Real customer creation on tenant signup (Sprint 7)
- Usage aggregation cron (Sprint 7)
- Pricing UI / plan upgrade UI (Sprint 7)
- Invoice generation / dunning emails (Stripe handles those)
- Tax calculation (Stripe Tax — Sprint 9 maybe)

## Acceptance criteria

- [ ] AC1: `subscriptions` table with all columns and constraints listed
- [ ] AC2: `usage_metering` table with all columns and indexes
- [ ] AC3: RLS policies prevent cross-tenant access
- [ ] AC4: Webhook route verifies Stripe signature; returns 400 with
      `{ error: { code: 'invalid_signature' } }` on failure
- [ ] AC5: Webhook handles 4 listed event types: upserts to `subscriptions` table; logs event_id +
      type
- [ ] AC6: Webhook handler is idempotent: re-delivering same event (Stripe retries) does not create
      duplicate rows; uses `stripe_subscription_id` as unique key for upserts
- [ ] AC7: Webhook returns 200 within 200ms (Stripe times out at 10s but we want fast)
- [ ] AC8: Tests:
  - Unit: signature verification (valid sig → 200, invalid → 400, missing → 400)
  - Unit: each handled event type upserts correctly
  - Unit: idempotency (same event delivered twice → one row)
  - Unit: unhandled event type → 200 (don't error, just log)
  - At least 8 tests
- [ ] AC9: `docs/runbooks/billing.md` covers Stripe CLI local testing, secret rotation, error
      scenarios; minimum 250 words
- [ ] AC10: All previous CI checks pass
- [ ] AC11: PR title `feat(billing): stripe webhook stub + usage_metering [TICKET-029]`

## Implementation guidance

```typescript
// apps/control-plane/src/lib/stripe.ts
import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (_stripe) return _stripe;
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return null;
  _stripe = new Stripe(secret, { apiVersion: '2025-08-27.basil' });
  return _stripe;
}
```

```typescript
// apps/control-plane/src/app/api/v1/webhooks/stripe/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { createClient, subscriptions } from '@estalara/db';
import { eq } from 'drizzle-orm';

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: { code: 'billing_disabled' } }, { status: 503 });
  }

  const sig = req.headers.get('stripe-signature');
  if (!sig) {
    return NextResponse.json({ error: { code: 'invalid_signature' } }, { status: 400 });
  }

  const body = await req.text();
  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: { code: 'invalid_signature' } }, { status: 400 });
  }

  const db = createClient(process.env.DATABASE_URL!);
  console.log({ stripe_event_id: event.id, type: event.type }, 'stripe webhook received');

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as any;
      // tenant_id read from Stripe customer's metadata (set when we create customer in Sprint 7)
      const tenantId = sub.metadata?.tenant_id;
      if (!tenantId) {
        console.warn({ stripe_subscription_id: sub.id }, 'no tenant_id in metadata; skipping');
        break;
      }
      await db
        .insert(subscriptions)
        .values({
          tenantId,
          stripeCustomerId: sub.customer,
          stripeSubscriptionId: sub.id,
          stripePriceId: sub.items.data[0]?.price.id,
          status: sub.status,
          currentPeriodStart: new Date(sub.current_period_start * 1000),
          currentPeriodEnd: new Date(sub.current_period_end * 1000),
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
        })
        .onConflictDoUpdate({
          target: subscriptions.stripeSubscriptionId,
          set: {
            status: sub.status,
            currentPeriodStart: new Date(sub.current_period_start * 1000),
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            updatedAt: new Date(),
          },
        });
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as any;
      await db
        .update(subscriptions)
        .set({ status: 'canceled', updatedAt: new Date() })
        .where(eq(subscriptions.stripeSubscriptionId, sub.id));
      break;
    }
    case 'invoice.payment_succeeded': {
      // Just log for now; usage reset handled in Sprint 7
      break;
    }
    default:
      // Unhandled types — log and 200
      console.log({ type: event.type }, 'stripe webhook unhandled');
  }

  return NextResponse.json({ received: true });
}
```

## Test plan

- Unit: signature verification, each event type, idempotency, unhandled type
- Manual local test using Stripe CLI:
  `stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe`, then
  `stripe trigger customer.subscription.created` — verify row appears in subscriptions table

## Definition of Done

- [ ] Branch `backend-engineer/TICKET-029-stripe-webhook-stub`
- [ ] PR title above
- [ ] All ACs verified
- [ ] CI green via `gh pr checks <pr> --watch`
- [ ] Prettier clean
- [ ] `docs/runbooks/billing.md` linked from CONVENTIONS.md or a billing index

## Notes

- We use Stripe API version `2025-08-27.basil` (current LTS-ish). Pin in `stripe.ts` so future SDK
  updates don't break us.
- The webhook is idempotent because Stripe retries up to 3 days on non-200. Our upsert by
  `stripe_subscription_id` handles dupes.
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` go in Doppler. Document in runbook how to obtain
  (Stripe dashboard).
