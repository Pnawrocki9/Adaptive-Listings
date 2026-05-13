/**
 * POST /api/detect
 *
 * Runs the Auto-Detection Engine against a given URL and persists the
 * detected `TenantSiteSchema` in the `tenant_site_schemas` table.
 *
 * While AUTO-003 is not yet merged, `detectSiteSchema()` throws
 * "Not implemented". This handler catches that specific error and returns
 * HTTP 501 with `DETECTION_NOT_IMPLEMENTED` so the UI can show a clear
 * "coming soon" state without crashing.
 *
 * Behaviour summary:
 *  - Validates request body with Zod
 *  - Server-side fetches the URL HTML (10 s timeout)
 *  - Calls `detectSiteSchema(html, url, tenantId)`
 *  - On "Not implemented" → 501
 *  - On fetch failure     → 400 FETCH_FAILED
 *  - On valid result with non-null schema → upsert DB + 200
 *  - On valid result with null schema    → 200 (below-threshold, no DB write)
 *
 * @module apps/control-plane/src/app/api/detect/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { detectSiteSchema } from '@estalara/sdk/auto-detect';
import type { DetectionResult } from '@estalara/sdk/auto-detect';
import { createAdminClient, tenantSiteSchemas } from '@estalara/db';

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
  /** Optional tenant identifier. Falls back to 'anonymous' when omitted. */
  tenant_id: z.string().optional(),
});

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
 * Body: `{ url: string, tenant_id?: string }`
 *
 * @returns 200 `DetectionResult` when detection succeeds (schema may be null for low confidence).
 * @returns 400 validation error or fetch failure.
 * @returns 501 when the detection engine is not yet implemented.
 * @returns 500 unexpected error.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = crypto.randomUUID();

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

  const { url, tenant_id: tenantId = 'anonymous' } = parsed.data;

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

  // ── Persist when schema is present ───────────────────────────────────────
  if (result.schema !== null) {
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
  }

  return NextResponse.json(result, { status: 200 });
}
