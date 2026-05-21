/**
 * POST /api/listings/embed
 *
 * Listing embedding ingest endpoint (FOLLOW-019).
 *
 * Concatenates the supplied text_fields (title, description, price, location),
 * calls OpenAI `text-embedding-3-small` at 1024 dimensions (Matryoshka), and
 * upserts the vector into `listing_embeddings` keyed by (tenant_id, listing_id).
 *
 * This is the seeding path used to populate listing vectors before the demo —
 * the adapt route reads from `listing_embeddings` to compute real cosine
 * archetype-listing affinity (FOLLOW-019).
 *
 * Auth:
 *   - Bearer JWT via `getAuthClaims()` — tenant in JWT must match body
 *     `tenant_id` (cross-tenant writes forbidden). OR
 *   - `x-internal-api-secret: <INTERNAL_API_SECRET>` header for service-to-
 *     service callers (Modal ingest, demo seed scripts).
 *
 * Body:
 *   {
 *     "tenant_id": "uuid",
 *     "listing_id": "string",
 *     "text_fields": { "title": "...", "description": "...", "price": "...", "location": "..." }
 *   }
 *
 * Responses:
 *   200 { ok: true, listing_id } — upserted successfully
 *   400 — validation error / invalid JSON
 *   401 — missing / invalid auth
 *   403 — JWT tenant mismatch
 *   500 — DB write failed
 *   503 — OPENAI_API_KEY not configured or OpenAI call failed
 *
 * @module apps/control-plane/src/app/api/listings/embed/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sql } from 'drizzle-orm';

import { createAdminClient, listingEmbeddings } from '@estalara/db';
import { getAuthClaims } from '@estalara/auth';
import { embedTextWithDimensions } from '@/lib/openai-client';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Estalara-standard embedding dimensionality for listing + archetype vectors. */
const LISTING_EMBEDDING_DIM = 1024;

// ─── Body schema ──────────────────────────────────────────────────────────────

const TextFieldsSchema = z
  .object({
    title: z.string().max(2000).optional(),
    description: z.string().max(20000).optional(),
    price: z.string().max(200).optional(),
    location: z.string().max(500).optional(),
  })
  .refine(
    (fields) =>
      Boolean(
        (fields.title ?? '') ||
        (fields.description ?? '') ||
        (fields.price ?? '') ||
        (fields.location ?? ''),
      ),
    { message: 'text_fields must contain at least one non-empty field' },
  );

const PostBodySchema = z.object({
  tenant_id: z.string().uuid(),
  listing_id: z.string().min(1).max(256),
  text_fields: TextFieldsSchema,
});

// ─── Auth helper ──────────────────────────────────────────────────────────────

/**
 * Validate the request authentication. Accepts either:
 *   - Bearer JWT whose `tenant_id` claim matches the body tenant_id, OR
 *   - `x-internal-api-secret` header equal to process.env.INTERNAL_API_SECRET.
 *
 * Returns `{ ok: true }` on success, or a NextResponse with the appropriate
 * error status. Never throws.
 */
async function authenticate(
  req: NextRequest,
  bodyTenantId: string,
): Promise<{ ok: true } | NextResponse> {
  // Service-to-service path: shared secret in a header.
  const internalSecret = process.env.INTERNAL_API_SECRET;
  const providedSecret =
    req.headers.get('x-internal-api-secret') ?? req.headers.get('X-Internal-Api-Secret');
  if (internalSecret && providedSecret && providedSecret === internalSecret) {
    return { ok: true };
  }

  // JWT path.
  const claims = await getAuthClaims(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!claims.tenant_id || claims.tenant_id !== bodyTenantId) {
    return NextResponse.json({ error: 'Forbidden: tenant mismatch' }, { status: 403 });
  }
  return { ok: true };
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = PostBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { tenant_id: tenantId, listing_id: listingId, text_fields: textFields } = parsed.data;

  // Auth — must come after body parse so we know the body's tenant_id.
  const authResult = await authenticate(req, tenantId);
  if (authResult instanceof NextResponse) return authResult;

  // Pre-check OPENAI_API_KEY — return 503 (not 5xx) for missing config.
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'OpenAI not configured (OPENAI_API_KEY missing)' },
      { status: 503 },
    );
  }

  // Concatenate non-empty text fields. Order is stable (title first → richer signal).
  const combined = [textFields.title, textFields.description, textFields.price, textFields.location]
    .filter((s): s is string => Boolean(s))
    .join(' ');

  if (combined.length === 0) {
    // Should be caught by the Zod refinement above; defensive guard for type narrowing.
    return NextResponse.json(
      { error: 'text_fields must contain at least one non-empty value' },
      { status: 400 },
    );
  }

  // Compute the embedding.
  let embedding: number[];
  try {
    embedding = await embedTextWithDimensions(combined, LISTING_EMBEDDING_DIM);
  } catch (err) {
    console.error(
      '[listings/embed POST] embedding failed:',
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { error: 'Failed to compute listing embedding. Check OPENAI_API_KEY and OpenAI quota.' },
      { status: 503 },
    );
  }

  if (embedding.length !== LISTING_EMBEDDING_DIM) {
    console.error(
      `[listings/embed POST] unexpected embedding length: ${String(embedding.length)} (wanted ${String(LISTING_EMBEDDING_DIM)})`,
    );
    return NextResponse.json(
      { error: 'OpenAI returned unexpected embedding length' },
      { status: 503 },
    );
  }

  // Upsert into listing_embeddings.
  try {
    const db = createAdminClient();
    await db
      .insert(listingEmbeddings)
      .values({
        tenantId,
        listingId,
        embedding,
      })
      .onConflictDoUpdate({
        target: [listingEmbeddings.tenantId, listingEmbeddings.listingId],
        set: {
          embedding,
          updatedAt: sql`now()`,
        },
      });
  } catch (err) {
    console.error(
      '[listings/embed POST] DB upsert failed:',
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: 'Failed to persist listing embedding' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, listing_id: listingId }, { status: 200 });
}
