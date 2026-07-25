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
 *  - Auth (ADR-0018 §2, FOLLOW-657): `resolveTenantAccess` with `allowStaffOverride`.
 *    The agency path is byte-unchanged (tenant sourced from the session claim). An
 *    Estalara staff caller may activate any tenant by supplying an explicit
 *    `?tenant_id=<uuid>` — validated against the `tenants` table — and that
 *    validated id becomes the SINGLE tenant fence bound into every query
 *    (invariant 5). Staff writes require `estalara:ops` or higher (rank ≥ 2,
 *    CEO Q3) and the headless `ADMIN_API_SECRET` Bearer path is REJECTED for
 *    staff (RETRO-187 — a shared secret is not attributable to a staff user).
 *  - Upserts schema to tenant_site_schemas using tenant_domain_uniq constraint
 *  - Conditionally promotes tenant.status from 'pending' → 'active'
 *  - Looks up existing active public API key; generates a new one if absent
 *  - Returns { api_key: string, tenant_id: string }
 *    - When key is NEW: returns the raw key (only time it is ever visible)
 *    - When key EXISTS: returns <prefix>...<last4> (hash not reversible)
 *
 * Staff write atomicity (ADR-0018 §3a, FOLLOW-657): when the caller is staff, the
 * schema upsert, the tenant status promotion, and the api-key lookup/insert all
 * commit-or-roll-back TOGETHER with the `staff_audit_log` row in ONE
 * `db.transaction()` — a failure anywhere inside the tx rolls EVERYTHING back and
 * returns 500 `AUDIT_WRITE_FAILED` (never a silent unattributed activation). The
 * agency path is UNCHANGED (non-transactional, not audited — ADR-0018 §3).
 *
 * @module apps/control-plane/src/app/api/schema/activate/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { eq, and, isNull, or, gt, desc } from 'drizzle-orm';
import * as Sentry from '@sentry/nextjs';
import {
  createAdminClient,
  tenantSiteSchemas,
  tenants,
  apiKeys,
  staffAuditLog,
} from '@estalara/db';
// FOLLOW-657 (ADR-0018 §2): resolveTenantAccess replaces the direct getSessionAuthClaims()
// call so an Estalara staff caller can act on an explicit ?tenant_id in addition to the
// unchanged agency-session path (which resolveTenantAccess evaluates first and byte-for-byte
// the same as the old getSessionAuthClaims() call — see session-auth.ts:401-418).
import { resolveTenantAccess, AccessError, type TenantAccess } from '@/lib/session-auth';
import type { TenantSiteSchema } from '@estalara/shared';
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

/** Best-effort client IP for the staff audit trail (no throw if absent). */
function requestIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return req.headers.get('x-real-ip');
}

/**
 * Map an {@link AccessError} status to this route's existing UPPER_SNAKE error
 * code convention (VALIDATION_ERROR, UNAUTHORIZED, etc).
 */
function accessErrorCode(status: number): string {
  switch (status) {
    case 400:
      return 'VALIDATION_ERROR';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'TENANT_NOT_FOUND';
    case 401:
      return 'UNAUTHORIZED';
    default:
      return 'INTERNAL_ERROR';
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

/**
 * POST /api/schema/activate
 *
 * Body: `{ schema: TenantSiteSchema }`
 * Auth: `Authorization: Bearer <tenant-JWT>` (agency) OR an identified Estalara
 *   staff session/JWT plus `?tenant_id=<uuid>` (ADR-0018 §2, FOLLOW-657). Staff
 *   writes require `estalara:ops`+; the headless `ADMIN_API_SECRET` is rejected
 *   for staff (RETRO-187).
 *
 * @returns 200 `{ api_key: string, tenant_id: string }`
 * @returns 400 when the request body is missing or malformed, or staff `tenant_id` is absent
 * @returns 401 when the JWT is missing or invalid
 * @returns 403 when a staff caller is below `estalara:ops` or not identifiable
 * @returns 404 when the staff-supplied `tenant_id` does not resolve to a real tenant
 * @returns 500 for unexpected errors
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth: agency session (byte-unchanged) OR Estalara staff override ─────
  // (ADR-0018 §2, FOLLOW-657). `access.tenantId` is the ONLY tenant fence bound
  // into every query below — for agency it is the session claim (unchanged);
  // for staff it is the validated `?tenant_id` (invariant 5).
  const tenantIdParam = req.nextUrl.searchParams.get('tenant_id');
  let access: TenantAccess;
  try {
    access = await resolveTenantAccess(req, {
      allowStaffOverride: true,
      // exactOptionalPropertyTypes: omit the key when absent (RETRO-189).
      ...(tenantIdParam ? { tenantId: tenantIdParam } : {}),
    });
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json(
        { error: { code: accessErrorCode(err.status), message: err.message } },
        { status: err.status },
      );
    }
    throw err;
  }

  // Write-rank gate (CEO Q3, ADR-0018 §4): staff below `estalara:ops` is view-only.
  // Activation is always a write, so the whole POST is gated.
  if (access.via === 'staff' && !access.canWrite) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Staff write requires estalara:ops or higher' } },
      { status: 403 },
    );
  }

  const tenantId = access.tenantId;

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

  // ── STAFF path — atomic write + audit (ADR-0018 §3a, FOLLOW-657) ───────────
  // The schema upsert, tenant status promotion, and api-key lookup/insert all
  // commit-or-roll-back TOGETHER with the staff_audit_log row in ONE
  // transaction. Any failure inside the tx (including the audit insert) rolls
  // EVERYTHING back — a staff activation can never partially apply.
  if (access.via === 'staff') {
    let apiKeyOut: string | null = null;
    try {
      const db = createAdminClient();
      await db.transaction(async (tx) => {
        await tx
          .insert(tenantSiteSchemas)
          .values({ tenantId, domain, schema: schemaValue, detectionSource, detectionConfidence })
          .onConflictDoUpdate({
            target: [tenantSiteSchemas.tenantId, tenantSiteSchemas.domain],
            set: {
              schema: schemaValue,
              detectionSource,
              detectionConfidence,
              updatedAt: new Date(),
            },
          });

        await tx
          .update(tenants)
          .set({ status: 'active', updatedAt: new Date() })
          .where(and(eq(tenants.id, tenantId), eq(tenants.status, 'pending')));

        const now = new Date();
        const existingKeys = await tx
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
          const existing = existingKeys[0];
          apiKeyOut = existing.prefix + '...' + existing.last4;
        } else {
          const rawKey = generateRawKey();
          const hashedKey = await hashKey(rawKey);
          const last4 = rawKey.slice(-4);
          await tx.insert(apiKeys).values({
            tenantId,
            type: 'public',
            prefix: KEY_PREFIX,
            hashedKey,
            last4,
            scopes: ['read:events'],
          });
          apiKeyOut = rawKey;
        }

        await tx.insert(staffAuditLog).values({
          adminUserId: access.staff.sub,
          action: 'schema.activate',
          targetTenantId: tenantId,
          payload: {
            domain,
            detection_source: detectionSource,
            detection_confidence: detectionConfidence,
          },
          ipAddress: requestIp(req),
          userAgent: req.headers.get('user-agent'),
        });
      });
    } catch (err) {
      Sentry.captureException(err, {
        tags: { route: 'schema/activate', staff_audit_error: 'true' },
        extra: { tenant_id: tenantId, admin_user_id: access.staff.sub },
      });
      return NextResponse.json(
        {
          error: {
            code: 'AUDIT_WRITE_FAILED',
            message:
              'The schema activation could not be recorded atomically with its staff audit ' +
              'row; the change was rolled back and NOT applied. Retry the action.',
          },
        },
        { status: 500 },
      );
    }

    // Bust the Redis cache so the next adapt request sees the freshly activated schema.
    await invalidateTenantSchemaCache(tenantId);
    afterResponse(() =>
      seedListingEmbeddingsForActivation(tenantId, schemaValue).catch((err: unknown) => {
        console.error(
          '[schema/activate] seedListingEmbeddingsForActivation (staff path) threw unexpectedly:',
          err instanceof Error ? err.message : err,
        );
      }),
    );
    return NextResponse.json({ api_key: apiKeyOut, tenant_id: tenantId }, { status: 200 });
  }

  // ── AGENCY path — UNCHANGED, non-transactional, NOT audited (ADR-0018 §3) ──
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
