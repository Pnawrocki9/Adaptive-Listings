/**
 * GET/POST /api/quiz/config — quiz widget configuration per tenant.
 *
 * Auth: x-tenant-id header required for POST.
 * MVP stub — config stored in-memory per tenant.
 * TODO Sprint 5: persist to tenants.quiz_config JSONB via createAdminClient().
 *
 * @module apps/control-plane/src/app/api/quiz/config/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

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

// In-memory store keyed by tenant_id
const configStore = new Map<string, QuizConfig>();

const QuizConfigSchema = z.object({
  enabled: z.boolean().optional(),
  trigger_after_n_listings: z.number().int().min(1).max(10).optional(),
  sticky_widget: z.boolean().optional(),
  language: z.enum(['en', 'pl']).optional(),
  accent_color: z.string().optional(),
});

export function GET(req: NextRequest): NextResponse {
  const tenantId = req.headers.get('x-tenant-id') ?? 'default';
  const config = configStore.get(tenantId) ?? DEFAULT_CONFIG;
  return NextResponse.json(config);
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

  const current = configStore.get(tenantId) ?? { ...DEFAULT_CONFIG };
  // current fills all required fields; parsed.data overrides only the provided ones
  const updated = { ...current, ...parsed.data } as QuizConfig;
  configStore.set(tenantId, updated);

  return NextResponse.json(updated);
}
