/**
 * POST /api/internal/description-cache
 *
 * Internal callback endpoint — called by the Modal Python job
 * (`apps/llm-gateway/src/jobs/generate_description.py`) after a description +
 * headline are generated, to write the result to `description_cache_persistent`.
 *
 * The Python job already writes to Upstash Redis directly (hot-path cache).
 * This endpoint writes to the permanent Postgres table so the description
 * survives Redis eviction (FOLLOW-204, Master Design §E.7.3 v4.0).
 *
 * Auth:
 *   Bearer <DESCRIPTION_CACHE_INTERNAL_SECRET> (HMAC-grade shared secret),
 *   compared constant-time via `secretEquals`.
 *
 *   Fail-closed (FOLLOW-456 / audit F-13): when the env var is unset, every
 *   request is rejected with 401 — previously an unset secret accepted ANY
 *   non-empty bearer token, letting anyone write into the permanent
 *   description cache. `DESCRIPTION_CACHE_INTERNAL_SECRET` is the real secret
 *   the Modal `generate_description.py` callback (FOLLOW-460) authenticates
 *   with — the env var name is unchanged, so a correctly-configured Modal
 *   caller is unaffected.
 *
 * This is an internal-only endpoint: it must NEVER be called by tenants or the SDK.
 * The secret must be rotated on any suspected compromise.
 *
 * Body fields:
 *   tenant_id   — Tenant UUID (string)
 *   listing_id  — Listing external identifier
 *   archetype   — Archetype ID (e.g. 'yield_hunter')
 *   locale      — Locale code ('en' | 'pl' | 'es')
 *   description — AI-generated description text. Only required to be non-empty when
 *                 `verdict` is absent or `'FIT'` — a `'NEUTRAL'` negative-cache marker
 *                 (FOLLOW-465) carries `''`.
 *   headline    — AI-generated headline (string | null)
 *   model       — Anthropic model id used
 *   verdict     — Optional archetype-fit verdict (ADR-0010): `'FIT' | 'NEUTRAL'`.
 *                 Absent ⇒ implicit `'FIT'` (full back-compat with every pre-FOLLOW-465
 *                 caller). `'NEUTRAL'` negative-caches the archetype-fit gate's decision
 *                 to decline adaptation so the read path stops re-enqueuing Sonnet.
 *
 * Responses:
 *   201 { written: true }
 *   400 on validation failure
 *   401 when auth fails
 *   500 on DB error (fail-loud per K.2 — the caller should retry)
 *
 * @module apps/control-plane/src/app/api/internal/description-cache/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { secretEquals } from '@/lib/secret-compare';
// Note: insertPgCachedDescription (fail-open) is intentionally not used here.
// This internal endpoint uses insertPgCachedDescriptionStrict (defined below)
// which re-throws on configured-DB errors so the Modal job can retry.

// ─── Request body schema ──────────────────────────────────────────────────────

const BodySchema = z
  .object({
    tenant_id: z.string().uuid(),
    listing_id: z.string().min(1).max(256),
    archetype: z.string().min(1).max(64),
    locale: z.enum(['en', 'pl', 'es']),
    description: z.string(),
    headline: z.string().max(200).nullable().optional(),
    model: z.string().min(1).max(128),
    // FOLLOW-465: archetype-fit verdict (ADR-0010). Absent ⇒ implicit 'FIT'.
    verdict: z.enum(['FIT', 'NEUTRAL']).optional(),
  })
  .superRefine((val, ctx) => {
    // `description` must be non-empty UNLESS this is a NEUTRAL negative-cache marker
    // (FOLLOW-465) — relaxing `.min(1)` unconditionally would let a genuine caller
    // silently write an empty description; scoping the relaxation to verdict==='NEUTRAL'
    // keeps '' from becoming an undocumented sentinel for every caller.
    if (val.verdict !== 'NEUTRAL' && val.description.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_small,
        minimum: 1,
        type: 'string',
        inclusive: true,
        path: ['description'],
        message: 'description must be non-empty unless verdict is NEUTRAL',
      });
    }
  });

// ─── POST handler ─────────────────────────────────────────────────────────────

/**
 * POST /api/internal/description-cache
 *
 * Writes a generated description to description_cache_persistent.
 * Called by the Modal llm-gateway Python job after successful generation.
 *
 * @returns 201 { written: true } on success.
 * @returns 400 on invalid body.
 * @returns 401 when auth header is missing or invalid.
 * @returns 500 on DB write failure.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth gate ─────────────────────────────────────────────────────────────
  // Bearer <DESCRIPTION_CACHE_INTERNAL_SECRET>. This is a high-entropy shared
  // secret exchanged between the Modal job and the control-plane via Doppler.
  // Fail CLOSED: an unset secret denies every request rather than accepting
  // any non-empty token (FOLLOW-456 / audit F-13).
  const auth = req.headers.get('Authorization') ?? req.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const expectedSecret = process.env.DESCRIPTION_CACHE_INTERNAL_SECRET;
  if (!token || !expectedSecret || !secretEquals(expectedSecret, token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { tenant_id, listing_id, archetype, locale, description, headline, model, verdict } =
    parsed.data;

  // ── Write to Postgres permanent cache ─────────────────────────────────────
  // insertPgCachedDescription is fail-open (logs internally) — but for this
  // internal write path we want the caller to know if the write failed so it
  // can retry. We therefore call a thin wrapper that re-throws on configured-DB
  // errors while preserving the fail-open behaviour when DB is not configured.
  //
  // If DATABASE_URL is not set (dev/CI) insertPgCachedDescription is a no-op
  // and we return 201 (not configured ≠ configured-but-failed per K.2).
  try {
    await insertPgCachedDescriptionStrict(
      tenant_id,
      listing_id,
      archetype,
      locale,
      description,
      headline ?? null,
      model,
      verdict ?? null,
    );
  } catch (err: unknown) {
    console.error(
      '[internal/description-cache] DB write failed — Modal job should retry:',
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: 'Database write failed', written: false }, { status: 500 });
  }

  return NextResponse.json({ written: true }, { status: 201 });
}

// ─── Strict write wrapper ─────────────────────────────────────────────────────

/**
 * Like insertPgCachedDescription but throws on configured-DB error (fail-loud).
 *
 * Used only by this internal endpoint where the caller (Modal job) needs to know
 * about failures so it can retry. The standard insertPgCachedDescription is
 * fail-open for the route's fire-and-forget backfill path.
 */
async function insertPgCachedDescriptionStrict(
  tenantId: string,
  listingId: string,
  archetype: string,
  locale: string,
  description: string,
  headline: string | null,
  model: string,
  verdict: 'FIT' | 'NEUTRAL' | null = null,
): Promise<void> {
  if (!process.env.DATABASE_URL) return; // Not configured — dev/CI OK

  // Re-import the helper to call insert; if it throws, propagate to the caller.
  const { createTenantClient, descriptionCachePersistent } = await import('@estalara/db');
  const { eq, and, isNull } = await import('drizzle-orm');

  const db = createTenantClient();

  // Before inserting, invalidate any prior active row for this combination
  // (idempotent: if the Modal job retries, we want a fresh row not a unique-constraint error).
  await db
    .update(descriptionCachePersistent)
    .set({ invalidatedAt: new Date() })
    .where(
      and(
        eq(descriptionCachePersistent.tenantId, tenantId),
        eq(descriptionCachePersistent.listingId, listingId),
        eq(descriptionCachePersistent.archetype, archetype),
        eq(descriptionCachePersistent.locale, locale),
        isNull(descriptionCachePersistent.invalidatedAt),
      ),
    );

  await db.insert(descriptionCachePersistent).values({
    tenantId,
    listingId,
    archetype,
    locale,
    description,
    headline,
    model,
    // FOLLOW-465: NULL (the default) is the implicit 'FIT' verdict.
    verdict,
  });
}
