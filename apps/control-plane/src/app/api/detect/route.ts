/**
 * POST /api/detect
 *
 * Schema Discovery API — tenant-authenticated, SSRF-protected endpoint that
 * runs the Auto-Detection Engine against a given URL and returns a wizard-ready
 * response for the Magic Link onboarding wizard (TICKET-030).
 *
 * Key behaviours (TICKET-033):
 *  - JWT authentication via getAuthClaims() — tenant_id extracted from JWT claims
 *  - SSRF protection — blocks private IPs, IPv6 loopback/private, localhost, bare hostnames
 *  - 60-second detection cache guard — avoids burning AI Vision quota on rapid retries
 *  - Wizard-ready response shape with flattened `fields[]` array
 *
 * Detection engine behaviour (unchanged from AUTO-003 / AUTO-004):
 *  - Validates request body with Zod
 *  - Server-side fetches the URL HTML (10 s timeout)
 *  - Calls `detectSiteSchema(html, url, tenantId)`
 *  - On "Not implemented" → 501
 *  - On fetch failure     → 400 FETCH_FAILED
 *  - On valid result with non-null schema → upsert DB + 200 wizard response
 *  - On valid result with null schema    → 200 (below-threshold, no DB write)
 *
 * AI Vision fallback (Technique 11):
 *  - Called when L1–L10 all return null and ANTHROPIC_API_KEY is set
 *  - AI Vision failure must not block the response
 *
 * @module apps/control-plane/src/app/api/detect/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { detectSiteSchema } from '@estalara/sdk/auto-detect';
import type { DetectionResult } from '@estalara/sdk/auto-detect';
import { createAdminClient, tenantSiteSchemas } from '@estalara/db';
import { getAuthClaims } from '@estalara/auth';
import type {
  TenantSiteSchema,
  CardFieldMappings,
  SlotSelectors,
  SelectorStrategy,
} from '@estalara/shared';
import type { DetectField } from '@estalara/shared';

// ─── Request schema ───────────────────────────────────────────────────────────

const DetectRequestSchema = z.object({
  /**
   * The full URL of the page to analyse.
   * Must be an http or https URL — ftp, data URIs, etc. are rejected.
   */
  url: z
    .string()
    .url({ message: 'url must be a valid http/https URL' })
    .refine(
      (u) => {
        try {
          const { protocol } = new URL(u);
          return protocol === 'http:' || protocol === 'https:';
        } catch {
          return false;
        }
      },
      { message: 'url must use http or https scheme' },
    ),
});

// ─── SSRF protection ──────────────────────────────────────────────────────────

/**
 * IPv4 private and loopback range check.
 *
 * Blocks:
 *   10.0.0.0/8        — private class A
 *   172.16.0.0/12     — private class B (172.16 – 172.31)
 *   192.168.0.0/16    — private class C
 *   127.0.0.0/8       — loopback
 */
function isPrivateIPv4(hostname: string): boolean {
  // Must be a dotted-decimal IPv4 address
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map(Number);
  if (octets.some((o) => isNaN(o) || o < 0 || o > 255)) return false;

  const [a, b] = octets as [number, number, number, number];

  // 10.x.x.x
  if (a === 10) return true;
  // 127.x.x.x
  if (a === 127) return true;
  // 172.16.x.x – 172.31.x.x
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.x.x
  if (a === 192 && b === 168) return true;

  return false;
}

/**
 * IPv6 loopback and private range check.
 *
 * Blocks:
 *   ::1           — loopback
 *   fc00::/7      — unique local (fc and fd prefixes)
 */
function isPrivateIPv6(hostname: string): boolean {
  // Strip brackets for [::1] form
  const raw = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  const lower = raw.toLowerCase();

  if (lower === '::1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;

  return false;
}

/**
 * Check whether a hostname is a bare label (no TLD / no dot).
 *
 * Blocks: `localhost`, `internal`, `db`, `redis`, etc.
 * Allows: `example.com`, `sub.example.co.uk`, etc.
 */
function isBareHostname(hostname: string): boolean {
  // Strip brackets for IPv6 bracket notation — those aren't bare hostnames
  if (hostname.startsWith('[')) return false;
  // If hostname contains a dot, it has at least one label separator — not bare
  if (hostname.includes('.')) return false;
  // No dot → bare hostname (includes 'localhost')
  return true;
}

/**
 * SSRF protection guard.
 *
 * Throws an `SsrfBlockedError` when the given URL's hostname resolves to a
 * private/loopback/internal address or is a bare hostname without a TLD.
 *
 * @throws {SsrfBlockedError} on blocked hostname
 */
export class SsrfBlockedError extends Error {
  constructor(hostname: string, reason: string) {
    super(`SSRF blocked: hostname '${hostname}' ${reason}`);
    this.name = 'SsrfBlockedError';
  }
}

/**
 * Validate that the URL's hostname is safe for a server-side outbound request.
 *
 * Exported so it can be unit-tested independently.
 *
 * @throws {SsrfBlockedError} when the hostname is blocked
 */
export function checkSsrf(url: string): void {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new SsrfBlockedError(url, 'is not a valid URL');
  }

  if (isBareHostname(hostname)) {
    throw new SsrfBlockedError(hostname, 'is a bare hostname without a TLD');
  }

  if (isPrivateIPv4(hostname)) {
    throw new SsrfBlockedError(hostname, 'is a private or loopback IPv4 address');
  }

  if (isPrivateIPv6(hostname)) {
    throw new SsrfBlockedError(hostname, 'is a loopback or private IPv6 address');
  }
}

// ─── Field mapping helpers ────────────────────────────────────────────────────

/**
 * Flatten the card_field_mappings from the IndexSchema into DetectField entries.
 */
function cardFieldsToDetectFields(mappings: CardFieldMappings | undefined): DetectField[] {
  if (!mappings) return [];

  const fields: DetectField[] = [];
  for (const [name, rawStrategy] of Object.entries(mappings)) {
    // CardFieldMappings values are SelectorStrategy | undefined — cast after null check
    const strategy = rawStrategy as SelectorStrategy | undefined;
    if (!strategy) continue;
    fields.push({
      name,
      selector: strategy.primary,
      sample_value: null,
      confidence: 1.0,
    });
  }
  return fields;
}

/**
 * Flatten the slot_selectors from the DetailSchema into DetectField entries.
 */
function slotSelectorsToDetectFields(slots: SlotSelectors | undefined): DetectField[] {
  if (!slots) return [];

  const fields: DetectField[] = [];
  for (const [name, rawStrategy] of Object.entries(slots)) {
    // SlotSelectors values are SelectorStrategy | undefined — cast after null check
    const strategy = rawStrategy as SelectorStrategy | undefined;
    if (!strategy) continue;
    fields.push({
      name,
      selector: strategy.primary,
      sample_value: null,
      confidence: 1.0,
    });
  }
  return fields;
}

/**
 * Build the flattened `fields[]` array from a `TenantSiteSchema`.
 *
 * Collects fields from:
 *   1. `index_schema.card_field_mappings` (display-level extraction)
 *   2. `detail_schema.slot_selectors` (augment slot selectors)
 *
 * Deduplicates by name (index schema takes precedence).
 */
function schemaToFields(schema: TenantSiteSchema): DetectField[] {
  const seen = new Set<string>();
  const result: DetectField[] = [];

  const addField = (f: DetectField) => {
    if (seen.has(f.name)) return;
    seen.add(f.name);
    result.push(f);
  };

  for (const f of cardFieldsToDetectFields(schema.index_schema.card_field_mappings)) {
    addField(f);
  }
  for (const f of slotSelectorsToDetectFields(schema.detail_schema.slot_selectors)) {
    addField(f);
  }

  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isNotImplementedError(err: unknown): boolean {
  return err instanceof Error && err.message.toLowerCase().startsWith('not implemented');
}

/**
 * Fetch the HTML from the provided URL server-side.
 *
 * @throws {FetchFailedError} when the fetch times out or returns a non-2xx status.
 */
class FetchFailedError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'FetchFailedError';
  }
}

async function fetchHtml(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': 'Estalara-AutoDetect/1.0' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'network error';
    throw new FetchFailedError(`fetch timed out or failed: ${detail}`);
  }

  if (!response.ok) {
    throw new FetchFailedError(`server returned ${String(response.status)} for ${url}`);
  }

  return response.text();
}

// ─── Route handler ────────────────────────────────────────────────────────────

/**
 * POST /api/detect
 *
 * Body: `{ url: string }`
 * Auth: `Authorization: Bearer <tenant-JWT>` (required)
 *
 * @returns 200 wizard-ready `WizardDetectResponse` (schema may be null for low confidence).
 * @returns 400 validation error, fetch failure, or SSRF block.
 * @returns 401 when JWT is missing or invalid.
 * @returns 501 when the detection engine is not yet implemented.
 * @returns 500 unexpected error.
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
          request_id: requestId,
        },
      },
      { status: 401 },
    );
  }

  // For tenant users, use their tenant_id directly.
  // For Estalara staff (tenant_id is null on StaffClaims), fall back to a sentinel.
  const tenantId: string = claims.tenant_id ?? 'estalara_staff';

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
          request_id: requestId,
        },
      },
      { status: 400 },
    );
  }

  const parsed = DetectRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.errors.map((e) => e.message).join('; '),
          request_id: requestId,
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  const { url } = parsed.data;

  // ── SSRF protection ───────────────────────────────────────────────────────
  try {
    checkSsrf(url);
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      return NextResponse.json(
        {
          error: {
            code: 'SSRF_BLOCKED',
            message: err.message,
            request_id: requestId,
          },
        },
        { status: 400 },
      );
    }
    throw err;
  }

  // ── 60-second detection cache guard ──────────────────────────────────────
  const domain = new URL(url).hostname;
  const sixtySecondsAgo = new Date(Date.now() - 60_000);

  try {
    const db = createAdminClient();
    const cached = await db
      .select()
      .from(tenantSiteSchemas)
      .where(and(eq(tenantSiteSchemas.tenantId, tenantId), eq(tenantSiteSchemas.domain, domain)))
      .limit(1);

    if (cached.length > 0 && cached[0] && cached[0].updatedAt > sixtySecondsAgo) {
      const cachedRow = cached[0];
      const cachedSchema = cachedRow.schema as TenantSiteSchema;
      return NextResponse.json(
        {
          schema: cachedSchema,
          detection_source: cachedRow.detectionSource,
          detection_confidence: cachedRow.detectionConfidence,
          fields: schemaToFields(cachedSchema),
          cached: true,
          request_id: requestId,
        },
        { status: 200 },
      );
    }
  } catch (cacheErr) {
    // Cache guard failure must not block the response — proceed with detection.
    console.error(
      '[detect] Cache guard query failed:',
      cacheErr instanceof Error ? cacheErr.message : cacheErr,
    );
  }

  // ── Fetch page HTML ───────────────────────────────────────────────────────
  let html: string;
  try {
    html = await fetchHtml(url);
  } catch (err) {
    if (err instanceof FetchFailedError) {
      return NextResponse.json(
        {
          error: {
            code: 'FETCH_FAILED',
            message: 'Could not fetch the provided URL',
            request_id: requestId,
            details: { reason: err.message },
          },
        },
        { status: 400 },
      );
    }
    throw err;
  }

  // ── Run detection ─────────────────────────────────────────────────────────
  let result: DetectionResult;
  try {
    result = await detectSiteSchema(html, url, tenantId);

    // ── AI Vision fallback (Technique 11) ───────────────────────────────────
    // Called server-side only when all deterministic techniques return null.
    // Rate limiting (max 1 call per tenant per 24 h) is enforced via the
    // tenant_site_schemas table — check that table before this handler is called
    // or add a guard here when rate-limiting middleware is available (Sprint 8).
    if (result.schema === null && process.env.ANTHROPIC_API_KEY) {
      try {
        const aiVisionModule = (await import('@estalara/sdk/auto-detect/ai-vision')) as {
          detectAiVision: (html: string, url: string) => Promise<typeof result | null>;
        };
        const aiResult = await aiVisionModule.detectAiVision(html, url);
        if (aiResult) {
          result = {
            ...aiResult,
            schema: aiResult.schema ? { ...aiResult.schema, tenant_id: tenantId } : null,
          };
        }
      } catch (aiErr) {
        // AI Vision failure must not block the response.
        console.error(
          '[detect] AI Vision fallback failed:',
          aiErr instanceof Error ? aiErr.message : aiErr,
        );
      }
    }
  } catch (err) {
    if (isNotImplementedError(err)) {
      return NextResponse.json(
        {
          error: {
            code: 'DETECTION_NOT_IMPLEMENTED',
            message: 'Detection engine is being deployed — available shortly.',
            request_id: requestId,
          },
        },
        { status: 501 },
      );
    }

    // Unexpected detection error
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: `Detection failed: ${message}`,
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }

  // ── Null schema — below threshold ─────────────────────────────────────────
  if (result.schema === null) {
    return NextResponse.json(
      {
        schema: null,
        detection_source: null,
        detection_confidence: 0,
        fields: [],
        cached: false,
        request_id: requestId,
      },
      { status: 200 },
    );
  }

  // ── Persist when schema is present ───────────────────────────────────────
  try {
    const db = createAdminClient();
    await db
      .insert(tenantSiteSchemas)
      .values({
        tenantId,
        domain: result.schema.domain,
        schema: result.schema,
        detectionSource: result.schema.detection_source,
        detectionConfidence: result.confidence,
      })
      .onConflictDoUpdate({
        target: [tenantSiteSchemas.tenantId, tenantSiteSchemas.domain],
        set: {
          schema: result.schema,
          detectionSource: result.schema.detection_source,
          detectionConfidence: result.confidence,
          updatedAt: new Date(),
        },
      });
  } catch (dbErr) {
    // DB failure must not block the response — log and continue.
    console.error('[detect] DB upsert failed:', dbErr instanceof Error ? dbErr.message : dbErr);
  }

  // ── Wizard-ready response ─────────────────────────────────────────────────
  return NextResponse.json(
    {
      schema: result.schema,
      detection_source: result.schema.detection_source,
      detection_confidence: result.confidence,
      fields: schemaToFields(result.schema),
      cached: false,
      request_id: requestId,
    },
    { status: 200 },
  );
}
