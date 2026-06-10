/**
 * GET/POST /api/quiz/config — quiz widget configuration per tenant.
 *
 * Auth: JWT-verified tenant claims required.
 *   GET  — requires valid JWT (getAuthClaims); falls back to defaults if missing.
 *   POST — requires agency:viewer or higher (requireTenantAccess).
 *
 * Persists to tenants.quiz_config JSONB column via createAdminClient().
 *
 * @module apps/control-plane/src/app/api/quiz/config/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { createAdminClient, tenants } from '@estalara/db';
import { getAuthClaims, requireTenantAccess } from '@estalara/auth';
import { eq } from 'drizzle-orm';

export interface QuizConfig {
  enabled: boolean;
  trigger_after_n_listings: number;
  sticky_widget: boolean;
  language: 'en' | 'pl' | 'es';
  accent_color: string;
  /** Whether to show micro-poll bottom-toast prompts as a quiz supplement (FOLLOW-209). */
  micro_polls_enabled: boolean;
}

const DEFAULT_CONFIG: QuizConfig = {
  enabled: false,
  trigger_after_n_listings: 3,
  sticky_widget: false,
  language: 'en',
  accent_color: '#2563EB',
  micro_polls_enabled: false,
};

const QuizConfigSchema = z.object({
  enabled: z.boolean().optional(),
  trigger_after_n_listings: z.number().int().min(1).max(10).optional(),
  sticky_widget: z.boolean().optional(),
  language: z.enum(['en', 'pl', 'es']).optional(),
  accent_color: z.string().optional(),
  micro_polls_enabled: z.boolean().optional(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const claims = await getAuthClaims(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tenantId = claims.tenant_id;
  if (!tenantId) {
    return NextResponse.json({ error: 'Unauthorized: no tenant_id in claims' }, { status: 401 });
  }

  try {
    const db = createAdminClient();
    const rows = await db
      .select({ quizConfig: tenants.quizConfig, quizEnabled: tenants.quizEnabled })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    const stored = (rows[0]?.quizConfig ?? {}) as Partial<QuizConfig>;
    const config = { ...DEFAULT_CONFIG, ...stored };
    // FOLLOW-102: also return the dedicated quiz_enabled column (boolean SoT for the ON/OFF toggle)
    // and tenant_id so the dashboard page can call PATCH /api/tenants/:id with the correct id.
    // quizEnabled defaults to true when the row is missing (DB unavailable path below).
    const quizEnabled: boolean = rows[0]?.quizEnabled ?? true;
    return NextResponse.json({ ...config, quiz_enabled: quizEnabled, tenant_id: tenantId });
  } catch {
    // Fallback to defaults if DB unavailable
    return NextResponse.json({ ...DEFAULT_CONFIG, quiz_enabled: true, tenant_id: tenantId });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let claims;
  try {
    claims = await requireTenantAccess(req, 'agency:viewer');
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tenantId = claims.tenant_id;

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
