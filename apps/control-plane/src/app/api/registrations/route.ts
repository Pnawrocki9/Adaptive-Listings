/**
 * POST /api/registrations — public agency registration endpoint.
 *
 * No auth required. Validates form data, checks for duplicate email,
 * inserts into tenant_registrations, and notifies ops team (stub).
 *
 * @module apps/control-plane/src/app/api/registrations/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createAdminClient, tenantRegistrations } from '@estalara/db';
import { eq } from 'drizzle-orm';

const RegistrationSchema = z.object({
  agency_name: z.string().min(2).max(100),
  website_url: z.string().url(),
  contact_name: z.string().min(2).max(100),
  contact_email: z.string().email(),
  contact_phone: z.string().optional(),
  country: z.string().min(2).max(100),
  listings_volume: z.enum(['<100', '100-1000', '1000+']).optional(),
  referral_source: z.string().optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Parse + validate
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = RegistrationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const data = parsed.data;

  try {
    const db = createAdminClient();

    // 2. Duplicate email check
    const existing = await db
      .select({ id: tenantRegistrations.id })
      .from(tenantRegistrations)
      .where(eq(tenantRegistrations.contactEmail, data.contact_email))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json(
        { error: 'A registration with this email already exists' },
        { status: 409 },
      );
    }

    // 3. Insert
    const ipAddress = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? null;
    const userAgent = req.headers.get('user-agent') ?? null;

    const inserted = await db
      .insert(tenantRegistrations)
      .values({
        agencyName: data.agency_name,
        websiteUrl: data.website_url,
        contactName: data.contact_name,
        contactEmail: data.contact_email,
        contactPhone: data.contact_phone,
        country: data.country,
        listingsVolume: data.listings_volume,
        referralSource: data.referral_source,
        ...(ipAddress !== null ? { ipAddress } : {}),
        ...(userAgent !== null ? { userAgent } : {}),
      })
      .returning({ id: tenantRegistrations.id });

    const registrationId = inserted[0]?.id ?? 'unknown';

    // 4. Notify ops (TODO Sprint 5: replace with Slack notification)
    console.log(`[Registration] New: ${data.agency_name} (${data.contact_email})`);

    // 5. Respond
    return NextResponse.json(
      {
        registration_id: registrationId,
        status: 'pending',
        message: 'Your registration has been received. We will review it within 2 business days.',
      },
      { status: 201 },
    );
  } catch {
    return NextResponse.json({ error: 'Registration failed. Please try again.' }, { status: 500 });
  }
}
