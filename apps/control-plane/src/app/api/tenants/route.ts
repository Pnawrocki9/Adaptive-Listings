/**
 * POST /api/tenants — internal admin endpoint to create a new tenant.
 *
 * Creates a tenant row in Postgres and immediately seeds 18 `ab_bandit_weights`
 * rows (one per canonical archetype × variant='default') so the Thompson sampling
 * bandit always has arms to sample on first request. — TICKET-AB-006.
 *
 * Auth: admin-only. Requires `x-admin-secret` header matching `ADMIN_API_SECRET`
 * env var. Not exposed to tenant dashboard users.
 *
 * @module apps/control-plane/src/app/api/tenants/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient, tenants } from '@estalara/db';
import { seedBanditWeightsForTenant } from '@/lib/bandit-seed';

// ─── Request schema ────────────────────────────────────────────────────────────

const CreateTenantSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric + -'),
  plan: z.enum(['free', 'observer', 'augment', 'native']).default('free'),
  registration_id: z.string().uuid().optional(),
  approved_by: z.string().uuid().optional(),
});

// ─── POST handler ─────────────────────────────────────────────────────────────

/**
 * POST /api/tenants
 *
 * Creates a tenant + seeds Thompson sampling bandit weights.
 *
 * @returns 201 `{ id, slug, name, plan }` on success.
 * @returns 400 on validation failure.
 * @returns 401 if admin secret is missing or invalid.
 * @returns 409 if slug already exists.
 * @returns 500 on DB error.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Admin auth ────────────────────────────────────────────────────────────
  const adminSecret = process.env.ADMIN_API_SECRET;
  if (adminSecret) {
    const provided = req.headers.get('x-admin-secret');
    if (provided !== adminSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = CreateTenantSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const body = parsed.data;

  // ── Create tenant ─────────────────────────────────────────────────────────
  // No DB configured in dev/test without DATABASE_URL_ADMIN — return mock.
  if (!process.env.DATABASE_URL_ADMIN && !process.env.DATABASE_URL_DIRECT) {
    const mockId = crypto.randomUUID();
    return NextResponse.json(
      {
        id: mockId,
        slug: body.slug,
        name: body.name,
        plan: body.plan,
        mock: true,
      },
      { status: 201 },
    );
  }

  try {
    const db = createAdminClient();

    const inserted = await db
      .insert(tenants)
      .values({
        name: body.name,
        slug: body.slug,
        plan: body.plan,
        status: 'active',
        ...(body.registration_id ? { registrationId: body.registration_id } : {}),
        ...(body.approved_by ? { approvedBy: body.approved_by, approvedAt: new Date() } : {}),
      })
      .returning({ id: tenants.id, slug: tenants.slug, name: tenants.name, plan: tenants.plan });

    const tenant = inserted[0];
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant creation failed' }, { status: 500 });
    }

    // Seed 18 archetype rows for Thompson sampling — TICKET-AB-006.
    // Fire-and-forget: seeding failure must not block tenant creation.
    await seedBanditWeightsForTenant(tenant.id).catch((err: unknown) => {
      console.error(
        '[tenants/POST] bandit seed failed for tenant',
        tenant.id,
        ':',
        err instanceof Error ? err.message : err,
      );
    });

    return NextResponse.json(
      {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        plan: tenant.plan,
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return NextResponse.json({ error: 'Slug already exists' }, { status: 409 });
    }
    console.error('[tenants/POST] DB error:', msg);
    return NextResponse.json({ error: 'Tenant creation failed' }, { status: 500 });
  }
}
