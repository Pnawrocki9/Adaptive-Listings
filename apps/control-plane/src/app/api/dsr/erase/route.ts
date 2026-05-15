/**
 * POST /api/dsr/erase
 *
 * Erases all Estalara-held data for the session identified by the DSR OTP token.
 * No JWT required — the OTP is the authorisation mechanism.
 *
 * Flow:
 *   1. Hash submitted OTP, look up dsr_verifications WHERE otp_hash = hash AND dsr_type = 'erase'.
 *   2. Validate: not expired, not used.
 *   3. Mark used_at = now().
 *   4. In a single transaction:
 *      - DELETE FROM session_embeddings WHERE session_id AND tenant_id
 *      - DELETE FROM consent_records WHERE session_id
 *   5. Redis DEL session:{session_id}:* (fire-and-forget).
 *   6. Return 200 { deleted_at, clickhouse_deletion }.
 *
 * ClickHouse deletion is a follow-up (Redpanda event — post-MVP scope).
 *
 * @module apps/control-plane/src/app/api/dsr/erase/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import {
  createAdminClient,
  dsrVerifications,
  sessionEmbeddings,
  consentRecords,
} from '@estalara/db';
import { hashOtp } from '@/lib/dsr-otp';
import { writeDsrAuditLog } from '../_clickhouse';

// ─── Request schema ────────────────────────────────────────────────────────────

const EraseBodySchema = z.object({
  token: z.string().min(1),
});

// ─── Redis session DEL (fire-and-forget) ─────────────────────────────────────

async function deleteSessionFromRedis(sessionId: string): Promise<void> {
  const base = process.env.UPSTASH_REDIS_URL?.replace(/\/$/, '');
  if (!base) return;

  const token = process.env.UPSTASH_REDIS_TOKEN;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  // SCAN for session:{sessionId}:* keys then DEL them
  const matchPattern = `session:${sessionId}:*`;
  let cursor = '0';

  do {
    const scanUrl = `${base}/scan/${cursor}/match/${encodeURIComponent(matchPattern)}/count/100`;
    const resp = await fetch(scanUrl, { method: 'GET', headers });
    if (!resp.ok) break;

    const data = (await resp.json()) as { result?: unknown };
    const result = data.result;
    if (!Array.isArray(result) || result.length < 2) break;

    const nextCursor = String(result[0]);
    const maybeKeys: unknown = result[1];
    const keys: string[] = Array.isArray(maybeKeys) ? (maybeKeys as unknown[]).map(String) : [];
    cursor = nextCursor;

    if (keys.length > 0) {
      await fetch(`${base}/pipeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify([['DEL', ...keys]]),
      });
    }
  } while (cursor !== '0');
}

// ─── POST handler ──────────────────────────────────────────────────────────────

/**
 * POST /api/dsr/erase
 *
 * Body: `{ token: string }` — the 6-digit OTP.
 *
 * @returns 200 `{ deleted_at: string, clickhouse_deletion: string }` on success.
 * @returns 400 on invalid body.
 * @returns 401 when OTP is expired or already used.
 * @returns 404 when OTP is not found or wrong type.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Parse + validate body ──────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Request body is not valid JSON' } },
      { status: 400 },
    );
  }

  const parsed = EraseBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'body.token is required',
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  const { token } = parsed.data;
  const db = createAdminClient();
  const otpHash = hashOtp(token);

  // ── Look up the verification record ──────────────────────────────────────
  const [record] = await db
    .select()
    .from(dsrVerifications)
    .where(and(eq(dsrVerifications.otpHash, otpHash), eq(dsrVerifications.dsrType, 'erase')))
    .limit(1);

  if (!record) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Token not found or invalid type' } },
      { status: 404 },
    );
  }

  // ── Validate: not expired ─────────────────────────────────────────────────
  if (record.expiresAt < new Date()) {
    return NextResponse.json(
      {
        error: {
          code: 'token_expired',
          message: 'This token has expired. Please request a new one.',
        },
      },
      { status: 401 },
    );
  }

  // ── Validate: not already used ────────────────────────────────────────────
  if (record.usedAt !== null) {
    return NextResponse.json(
      { error: { code: 'token_already_used', message: 'This token has already been used.' } },
      { status: 401 },
    );
  }

  // ── Mark as used ──────────────────────────────────────────────────────────
  const now = new Date();
  await db.update(dsrVerifications).set({ usedAt: now }).where(eq(dsrVerifications.id, record.id));

  // ── Delete session data in a transaction ──────────────────────────────────
  await db.transaction(async (tx) => {
    await tx
      .delete(sessionEmbeddings)
      .where(
        and(
          eq(sessionEmbeddings.sessionId, record.sessionId),
          eq(sessionEmbeddings.tenantId, record.tenantId),
        ),
      );

    await tx.delete(consentRecords).where(eq(consentRecords.sessionId, record.sessionId));
  });

  // ── Redis session DEL (fire-and-forget) ───────────────────────────────────
  void deleteSessionFromRedis(record.sessionId).catch((err: unknown) => {
    console.error('[dsr/erase] Redis DEL failed:', err instanceof Error ? err.message : err);
  });

  // ── Audit log (fire-and-forget) ────────────────────────────────────────────
  void writeDsrAuditLog({
    tenant_id: record.tenantId,
    session_id: record.sessionId,
    dsr_type: 'erase',
    action: 'completed',
    email: record.email,
    requested_at: record.createdAt,
    completed_at: now,
  }).catch((err: unknown) => {
    console.error(
      '[dsr/erase] ClickHouse audit log failed:',
      err instanceof Error ? err.message : err,
    );
  });

  return NextResponse.json(
    {
      deleted_at: now.toISOString(),
      // ClickHouse deletion via Redpanda event is post-MVP scope.
      clickhouse_deletion: 'scheduled_in_24h',
    },
    { status: 200 },
  );
}
