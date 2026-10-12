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
 * FOLLOW-463 / audit F-17: this endpoint also persists the §E.7.5 anti-hallucination
 * audit trail — a `description_generations` ClickHouse row carrying
 * `verified_facts_used` — so the facts Sonnet self-reported as used are durable
 * beyond the Redis TTL, not just present in the hot-path cache value. See
 * `writeDescriptionGenerationAudit` below.
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
 *   claims_validation — FOLLOW-1305: optional claim-check version the text passed
 *                 (`CLAIMS_VALIDATION_VERSION`). Absent ⇒ NULL ⇒ the read path treats the
 *                 row as legacy (a miss), never as `ai_cached`.
 *   listing_revision — FOLLOW-1291: optional non-negative integer, the listing revision the
 *                 text was grounded at (from the description.requested event). Absent ⇒ 0.
 *                 The write is one atomic, revision-fenced UPSERT keyed on the model: refused
 *                 when the listing has moved past this revision, and never replaces an active
 *                 row of a newer revision or of another model (Codex F-03/F-17).
 *   verified_facts_used — Optional list of facts Sonnet self-reported as used
 *                 (FOLLOW-463 / audit F-17). Absent ⇒ `[]` (full back-compat with
 *                 every pre-FOLLOW-463 caller). Persisted to the ClickHouse
 *                 `description_generations` audit trail — never written when
 *                 `description === ''` (a NEUTRAL marker has no generation to audit).
 *
 * Responses:
 *   201 { written: true }
 *   200 { written: false, reason: 'stale_revision' } when the revision fence refused the write
 *   400 on validation failure
 *   401 when auth fails
 *   500 on DB error (fail-loud per K.2 — the caller should retry)
 *
 * @module apps/control-plane/src/app/api/internal/description-cache/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import * as Sentry from '@sentry/nextjs';
import { secretEquals } from '@/lib/secret-compare';
import { clickhouseAuthHeaders } from '@/lib/clickhouse-http';
// FOLLOW-1291: the strict (throwing) atomic publish, not the fail-open backfill wrapper — this
// endpoint must answer 500 on a configured-DB error so the job's failure is observable.
import { publishPgCachedDescription } from '@/lib/description-pg-cache';

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
    // FOLLOW-1305: the claim-check version the Modal job's text passed. Optional so a caller
    // that predates it still writes; its row is then legacy and the read path serves it as a
    // miss, never as `ai_cached` (fail-closed, and no 400 that would make the job retry).
    claims_validation: z.string().min(1).max(32).optional(),
    // FOLLOW-1291 (F-03): the listing revision the job's text was grounded at (stamped on the
    // description.requested event by the route BEFORE it fetched the grounding source). Absent ⇒
    // 0: a job dispatched before the fence existed. 0 is the current revision only of a listing
    // that was never updated, so an absent value can never publish over a listing.updated.
    listing_revision: z.number().int().nonnegative().optional().default(0),
    // FOLLOW-463 / audit F-17: facts Sonnet self-reported as used, for the
    // description_generations ClickHouse audit trail. Absent ⇒ `[]` (back-compat
    // with every pre-FOLLOW-463 caller). Capped at 100 — a description's fact
    // whitelist is a handful of short "key: value" strings; 100 is generous
    // headroom while still bounding the ClickHouse row size.
    verified_facts_used: z.array(z.string()).max(100).optional().default([]),
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

  const {
    tenant_id,
    listing_id,
    archetype,
    locale,
    description,
    headline,
    model,
    verdict,
    claims_validation,
    listing_revision,
    verified_facts_used,
  } = parsed.data;

  // ── Write to Postgres permanent cache ─────────────────────────────────────
  // FOLLOW-1291: one atomic, revision-fenced UPSERT keyed on the model (F-03/F-17) — see
  // publishPgCachedDescription. It throws on a configured-DB error (→ 500 below); with
  // DATABASE_URL unset (dev/CI) it is a no-op and we return 201 (not configured ≠
  // configured-but-failed per K.2).
  let outcome: Awaited<ReturnType<typeof publishPgCachedDescription>>;
  try {
    outcome = await publishPgCachedDescription({
      tenantId: tenant_id,
      listingId: listing_id,
      archetype,
      locale,
      description,
      headline: headline ?? null,
      model,
      verdict: verdict ?? null,
      claimsValidation: claims_validation ?? null,
      listingRevision: listing_revision,
    });
  } catch (err: unknown) {
    console.error(
      '[internal/description-cache] DB write failed — Modal job should retry:',
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: 'Database write failed', written: false }, { status: 500 });
  }

  // FOLLOW-1291: the fence refused the write — the job ran on an older listing revision than the
  // current one, or a same-model row at a newer revision is already active. An expected outcome,
  // not an error: 200 (the job must not treat it as a failure), nothing written, no audit row (the
  // text is not served, so there is nothing to audit).
  if (outcome === 'stale') {
    console.warn(
      `[internal/description-cache] stale write refused by the revision fence tenant=${tenant_id} ` +
        `listing=${listing_id} archetype=${archetype} model=${model} revision=${String(listing_revision)}`,
    );
    return NextResponse.json({ written: false, reason: 'stale_revision' }, { status: 200 });
  }

  // ── Write the ClickHouse audit trail (FOLLOW-463 / audit F-17) ────────────
  // description_generations is the durable §E.7.5 anti-hallucination audit
  // trail. A FOLLOW-465 NEUTRAL negative-cache marker carries description === ''
  // — there is no generation to audit, so it is deliberately skipped here (the
  // Postgres negative-cache row above is still written; only the CH audit row
  // is conditional). The Postgres write above is already the durability
  // source-of-truth for reads, so a CH failure here must NOT fail the request —
  // it is captured to Sentry and swallowed (mirrors the llm_calls /
  // dsr_audit_log fire-and-forget sinks elsewhere in this app).
  if (description !== '') {
    await writeDescriptionGenerationAudit({
      tenant_id,
      listing_id,
      archetype,
      locale,
      model,
      description_chars: description.length,
      verified_facts_used,
    });
  }

  return NextResponse.json({ written: true }, { status: 201 });
}

// ─── ClickHouse audit trail write (FOLLOW-463 / audit F-17) ───────────────────

/**
 * Write a `description_generations` audit row to ClickHouse (migration 0007).
 *
 * Mirrors the `writeDsrAuditLog` fire-and-forget pattern in
 * `apps/control-plane/src/app/api/dsr/_clickhouse.ts`: uses the shared
 * `clickhouseAuthHeaders` helper (`@/lib/clickhouse-http`) and an
 * `X-ClickHouse-Format: JSONEachRow` POST body — values are transported as the
 * JSON body, never string-interpolated into SQL, so there is no injection
 * surface to reason about.
 *
 * Never throws: a ClickHouse outage must not fail the Modal job's callback —
 * the Postgres write in `insertPgCachedDescriptionStrict` above is already the
 * read-path durability source-of-truth. Failures are logged and captured to
 * Sentry with `kind: 'description_generations_write_failed'` so they are
 * observable without blocking the caller (Rule K.2 fail-loud-but-non-blocking).
 *
 * `tier` is fixed at 0 — Adaptive Listings has no Tiers concept (MASTER_DESIGN
 * §E.7); the column predates that decision and is kept only because the table
 * schema (migration 0007) already defines it as non-nullable. Do NOT infer a
 * tier from tenant config; there is none to infer.
 */
async function writeDescriptionGenerationAudit(entry: {
  tenant_id: string;
  listing_id: string;
  archetype: string;
  locale: string;
  model: string;
  description_chars: number;
  verified_facts_used: readonly string[];
}): Promise<void> {
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  if (!clickhouseUrl) return; // Not configured — dev/CI OK

  const now = new Date().toISOString().replace('T', ' ').replace('Z', '');

  const row = {
    tenant_id: entry.tenant_id,
    listing_id: entry.listing_id,
    archetype: entry.archetype,
    locale: entry.locale,
    tier: 0,
    model: entry.model,
    source: 'modal_generation',
    description_chars: entry.description_chars,
    verified_facts_used: entry.verified_facts_used,
    generated_at: now,
    created_at: now,
  };

  const user = process.env.CLICKHOUSE_USER ?? 'default';
  const password = process.env.CLICKHOUSE_PASSWORD ?? '';
  const headers: Record<string, string> = {
    'Content-Type': 'text/plain',
    'X-ClickHouse-Format': 'JSONEachRow',
    ...clickhouseAuthHeaders({ user, password }),
  };

  const url = new URL(clickhouseUrl.replace(/\/$/, ''));
  url.searchParams.set('query', 'INSERT INTO description_generations FORMAT JSONEachRow');

  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable body>');
      const msg = `[internal/description-cache] ClickHouse INSERT rejected: HTTP ${String(res.status)} — ${body.slice(0, 500)}`;
      console.error(msg);
      Sentry.captureException(new Error(msg), {
        tags: {
          area: 'description-cache',
          sink: 'clickhouse',
          kind: 'description_generations_write_failed',
          table: 'description_generations',
        },
        extra: { status: res.status },
      });
    }
  } catch (err: unknown) {
    // Network-layer failure (DNS, connection refused, malformed URL, timeout).
    // Audit-trail failures must not surface to the Modal caller — log + Sentry only.
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[internal/description-cache] ClickHouse audit write failed:', msg);
    Sentry.captureException(err instanceof Error ? err : new Error(msg), {
      tags: {
        area: 'description-cache',
        sink: 'clickhouse',
        kind: 'description_generations_write_failed',
        table: 'description_generations',
      },
    });
  }
}
