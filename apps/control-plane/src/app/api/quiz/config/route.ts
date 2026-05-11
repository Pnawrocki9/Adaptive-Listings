/**
 * GET/POST /api/quiz/config — quiz widget configuration per tenant.
 *
 * Auth: x-tenant-id header required for POST.
 * Persists to tenants.quiz_config JSONB column via createAdminClient().
 *
 * @module apps/control-plane/src/app/api/quiz/config/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createAdminClient, tenants } from '@estalara/db';
import { eq } from 'drizzle-orm';

export interface QuizConfig {
  enabled: boolean;
  trigger_after_n_listings: number;
  sticky_widget: boolean;
  language: 'en' | 'pl';
  accent_color: string;
}

const DEFAULT_CONFIG: QuizConfig = {
  enabled: false,
  trigger_after_n_listings: 3,
  sticky_widget: false,
  language: 'en',
  accent_color: '#2563EB',
};

const QuizConfigSchema = z.object({
  enabled: z.boolean().optional(),
  trigger_after_n_listings: z.number().int().min(1).max(10).optional(),
  sticky_widget: z.boolean().optional(),
  language: z.enum(['en', 'pl']).optional(),
  accent_color: z.string().optional(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const tenantId = req.headers.get('x-tenant-id') ?? 'default';

  try {
    const db = createAdminClient();
    const rows = await db
      .select({ quizConfig: tenants.quizConfig })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    const stored = (rows[0]?.quizConfig ?? {}) as Partial<QuizConfig>;
    const config = { ...DEFAULT_CONFIG, ...stored };
    return NextResponse.json(config);
  } catch {
    // Fallback to defaults if DB unavailable
    return NextResponse.json(DEFAULT_CONFIG);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'x-tenant-id header required' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = QuizConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const db = createAdminClient();

    // Read current config from DB
    const rows = await db
      .select({ quizConfig: tenants.quizConfig })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    const stored = (rows[0]?.quizConfig ?? {}) as Partial<QuizConfig>;
    const current = { ...DEFAULT_CONFIG, ...stored };
    // current fills all required fields; parsed.data overrides only the provided ones
    const updated = { ...current, ...parsed.data } as QuizConfig;

    // Persist to DB
    await db
      .update(tenants)
      .set({ quizConfig: updated, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: 'Failed to update quiz configuration' }, { status: 500 });
  }
}
