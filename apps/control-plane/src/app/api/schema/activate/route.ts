/**
 * POST /api/schema/activate
 *
 * Schema Activation API — persists the detected schema for the tenant, transitions
 * the tenant's status from 'pending' to 'active', and returns an active public
 * API key (generating one if none exists) so the caller can render the SDK snippet.
 *
 * This endpoint is called by the Magic Link onboarding wizard (DetectionPreview)
 * after the admin reviews the detected schema and clicks "Save & Activate".
 *
 * Key behaviours (TICKET-AUTO-006-POLISH):
 *  - JWT authentication via getAuthClaims() — same pattern as POST /api/detect
 *  - Upserts schema to tenant_site_schemas using tenant_domain_uniq constraint
 *  - Conditionally promotes tenant.status from 'pending' → 'active'
 *  - Looks up existing active public API key; generates a new one if absent
 *  - Returns { api_key: string, tenant_id: string }
 *    - When key is NEW: returns the raw key (only time it is ever visible)
 *    - When key EXISTS: returns <prefix>...<last4> (hash not reversible)
 *
 * @module apps/control-plane/src/app/api/schema/activate/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { eq, and, isNull, or, gt, desc } from 'drizzle-orm';
import { createAdminClient, tenantSiteSchemas, tenants, apiKeys } from '@estalara/db';
import { getAuthClaims } from '@estalara/auth';
import type { TenantSiteSchema } from '@estalara/shared';
import { errorBody, ErrorCode } from '@estalara/shared';
import { invalidateTenantSchemaCache } from '@/lib/tenant-schema';
import { seedListingEmbeddingsForActivation } from '@/lib/seed-listing-embeddings';
import { afterResponse } from '@/lib/after-response';

// ─── Request schema ───────────────────────────────────────────────────────────

const ActivateRequestSchema = z.object({
  /**
   * The full TenantSiteSchema JSON object produced by the detection engine.
   * Structural validation was already performed upstream at detection time —
   * here we only confirm the field is present.
   */
  schema: z.unknown().refine((v) => v !== null && v !== undefined, {
    message: 'schema is required',
  }),
});

// ─── API key generation ───────────────────────────────────────────────────────

const KEY_PREFIX = 'est_pub_';
const KEY_HEX_LENGTH = 16;

/**
 * Generate a raw public API key with the `est_pub_` prefix.
 * Format: `est_pub_<16 random hex chars>`
 */
function generateRawKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(KEY_HEX_LENGTH / 2));
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${KEY_PREFIX}${hex}`;
}

/**
 * Hash a raw key with SHA-256 via the Web Crypto API.
 * Returns the hex-encoded digest.
 */
async function hashKey(rawKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(rawKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ─── Route handler ────────────────────────────────────────────────────────────

/**
 * POST /api/schema/activate
 *
 * Body: `{ schema: TenantSiteSchema }`
 * Auth: `Authorization: Bearer <tenant-JWT>` or `sb-access-token` cookie
 *
 * @returns 200 `{ api_key: string, tenant_id: string }`
 * @returns 400 when the request body is missing or malformed
 * @returns 401 when the JWT is missing or invalid
 * @returns 500 for unexpected errors
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = crypto.randomUUID();

  // ── JWT authentication ────────────────────────────────────────────────────
  const claims = await getAuthClaims(req);
  if (!claims) {
    return NextResponse.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing or invalid token',
        },
      },
      { status: 401 },
    );
  }

  // Staff JWTs carry tenant_id: null — they must not call tenant-scoped endpoints.
  // Returning a sentinel string would silently write 'estalara_staff' into a uuid column.
  if (!claims.tenant_id) {
    return NextResponse.json(
      errorBody({
        code: ErrorCode.STAFF_TENANT_CONTEXT_MISSING,
        message: 'Staff callers cannot use the tenant schema activate API',
        requestId,
      }),
      { status: 403 },
    );
  }
  const tenantId = claims.tenant_id;

  // ── Parse + validate body ─────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request body is not valid JSON',
        },
      },
      { status: 400 },
    );
  }

  const parsed = ActivateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.errors.map((e) => e.message).join('; '),
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  const schemaValue = parsed.data.schema as TenantSiteSchema;

  // Extract domain — TenantSiteSchema always has a `domain` field.
  const domain: string = schemaValue.domain;
  const detectionSource: string = schemaValue.detection_source;
  const detectionConfidence: number = schemaValue.detection_confidence;

  // ── Upsert schema to tenant_site_schemas ──────────────────────────────────
  try {
    const db = createAdminClient();

    await db
      .insert(tenantSiteSchemas)
      .values({
        tenantId,
        domain,
        schema: schemaValue,
        detectionSource,
        detectionConfidence,
      })
      .onConflictDoUpdate({
        target: [tenantSiteSchemas.tenantId, tenantSiteSchemas.domain],
        set: {
          schema: schemaValue,
          detectionSource,
          detectionConfidence,
          updatedAt: new Date(),
        },
      });

    // 2. Conditionally promote tenant status from 'pending' → 'active'.
    await db
      .update(tenants)
      .set({ status: 'active', updatedAt: new Date() })
      .where(and(eq(tenants.id, tenantId), eq(tenants.status, 'pending')));

    // 3. Look up existing active public key for this tenant.
    const now = new Date();
    const existingKeys = await db
      .select()
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.tenantId, tenantId),
          eq(apiKeys.type, 'public'),
          isNull(apiKeys.revokedAt),
          or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now)),
        ),
      )
      .orderBy(desc(apiKeys.createdAt))
      .limit(1);

    if (existingKeys.length > 0 && existingKeys[0]) {
      // Return prefix + "..." + last4 — the raw key is not recoverable.
      // Cast through ApiKey to get typed fields; existingKeys is typed as ApiKey[] by Drizzle.
      const existing = existingKeys[0];
      const displayKey = existing.prefix + '...' + existing.last4;
      // Bust the Redis cache so the next adapt request sees the freshly activated schema.
      await invalidateTenantSchemaCache(tenantId);
      // FOLLOW-432 / FOLLOW-434 / Rule K.2: registered via afterResponse() so the sequential
      // embed loop completes after the response is sent before Vercel instance suspension.
      // Budget assessment (FOLLOW-434): the seeder caps inline work at MAX_INLINE_SEED (50)
      // listings × ~200ms ≈ 10s, leaving ~5s headroom under the 15s Hobby after() budget.
      // Catalogs beyond 50 listings are NOT silently dropped — overflow is captured to Sentry
      // + console.warn with listing_ids for operator retry or Modal job pickup.
      // Demo tenant (12 listings ≈ 2.4s) and non-demo tenants without schema-embedded
      // listing_ids (early-exit no-op) both remain safe within budget.
      afterResponse(() =>
        seedListingEmbeddingsForActivation(tenantId, schemaValue).catch((err: unknown) => {
          console.error(
            '[schema/activate] seedListingEmbeddingsForActivation (existing-key path) threw unexpectedly:',
            err instanceof Error ? err.message : err,
          );
        }),
      );
      return NextResponse.json({ api_key: displayKey, tenant_id: tenantId }, { status: 200 });
    }

    // 4. No active key found — generate a new one.
    const rawKey = generateRawKey();
    const hashedKey = await hashKey(rawKey);
    const last4 = rawKey.slice(-4);

    await db.insert(apiKeys).values({
      tenantId,
      type: 'public',
      prefix: KEY_PREFIX,
      hashedKey,
      last4,
      scopes: ['read:events'],
    });

    // Bust the Redis cache so the next adapt request sees the freshly activated schema.
    await invalidateTenantSchemaCache(tenantId);
    // FOLLOW-432 / FOLLOW-434 / Rule K.2: same afterResponse() wrapping + MAX_INLINE_SEED
    // cap as the existing-key path above. See that path's comment for budget details.
    afterResponse(() =>
      seedListingEmbeddingsForActivation(tenantId, schemaValue).catch((err: unknown) => {
        console.error(
          '[schema/activate] seedListingEmbeddingsForActivation (new-key path) threw unexpectedly:',
          err instanceof Error ? err.message : err,
        );
      }),
    );
    // Return the raw key — it is only visible once.
    return NextResponse.json({ api_key: rawKey, tenant_id: tenantId }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    console.error('[schema/activate] Unexpected error:', message);
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: `Activation failed: ${message}`,
        },
      },
      { status: 500 },
    );
  }
}
