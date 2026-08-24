/**
 * GET /api/internal/retention/consent-log
 *
 * Vercel Cron handler (daily, `0 2 * * *`). Deletes the consent-decision audit log —
 * `consent.granted` / `consent.denied` rows in ClickHouse `events` — once it is older than
 * `CONSENT_LOG_RETENTION_DAYS`, the single declared retention value that ALSO generates the
 * DPIA §13.1 disclosure sentence the visitor reads (FOLLOW-1118 / ESC-071).
 *
 * **The window is never written here.** It comes from `buildConsentLogRetentionSql()` in
 * `@estalara/shared`, which derives both statements from the same constant the three locale
 * disclosures are rendered from. Change the constant and the promise and the deletion move
 * together; `scripts/check-consent-retention-sync.mjs` fails CI if they ever disagree. Writing a
 * literal interval in this file is the drift ESC-071 was raised about, so the gate rejects it.
 *
 * **Scope — what this deletes and what it must not touch.** The predicate matches only
 * `CONSENT_LOG_EVENT_TYPES`. Every other type in `events` is governed by the table's 13-month
 * TTL (`infra/clickhouse/migrations/0001_create_events.sql`), which this cron does not and must
 * not disturb. Proven against a real engine by
 * `src/__tests__/integration/consent-log-retention.integration.test.ts`, which seeds a consent
 * row and a non-consent row of the same age and asserts only the first disappears.
 *
 * **Implementation choice: a cron rather than a ClickHouse TTL.** A measured constraint, not a
 * preference. ClickHouse DDL is not auto-applied in this repo (`infra/clickhouse/migrations/` is
 * applied by hand via the Cloud console) and the production role can `ALTER … DELETE` on `events`
 * but cannot alter its TTL — [MP-015]. A TTL could therefore never "adapt automatically" to a
 * changed constant; every change would need a human in a console. The mutation this route issues
 * needs no human.
 *
 * **ClickHouse semantics.** `ALTER TABLE … DELETE` is an asynchronous *mutation*: it is queued,
 * not applied inline. The handler therefore reports `matched` (a `SELECT count()` over exactly
 * the rows the mutation will remove, issued immediately before it) and `mutation_issued`, rather
 * than claiming a synchronous deleted-row count it cannot observe. When `matched` is 0 no
 * mutation is issued at all — a daily no-op ALTER would queue a mutation for every day of the
 * ~180 days before the first row ages out.
 *
 * **Auth:** `CRON_SECRET` per Vercel Cron guidance — Vercel injects
 * `Authorization: Bearer ${CRON_SECRET}` on cron-triggered invocations. Compared with
 * `secretEquals` (constant-time). Returns 401 when CRON_SECRET is unset (infrastructure
 * misconfiguration, never a dev bypass) or the header does not match. Replay resistance is
 * structural rather than nonce-based: the handler is a pure idempotent sweep of rows already
 * past the declared window — replaying it a thousand times removes exactly the same set and
 * mutates nothing else, so there is no state a replayed request could poison.
 *
 * **Fail-loud (Rule K.2):** when `CLICKHOUSE_URL` is set and the count or the mutation throws,
 * this returns 500 and captures to Sentry. It never returns a plausible 200 with `matched: 0`
 * that would read as "retention is being enforced" while it is not — the exact failure shape
 * that made ESC-071 a three-month-old false statement. When `CLICKHOUSE_URL` is unset (dev/CI)
 * the route is a deliberate no-op and says so on the wire via `data_source: 'not_configured'`.
 *
 * **Compliance references:**
 *   - ESC-071 (CEO ruling 2026-08-24) / FOLLOW-1118 / FOLLOW-140
 *   - DPIA §13.1 — Consent-Denied Audit Dispatch LIA (retention limb)
 *   - `docs/compliance/ropa.md` — Retention Schedule, `events` (consent-decision audit log) row
 *
 * @module apps/control-plane/src/app/api/internal/retention/consent-log/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { CONSENT_LOG_RETENTION_DAYS, buildConsentLogRetentionSql } from '@estalara/shared';
import { executeClickHouseSql, readClickHouseConfig } from '@/lib/clickhouse-dsr';
import { secretEquals } from '@/lib/secret-compare';

// ─── Auth ────────────────────────────────────────────────────────────────────

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // An unset CRON_SECRET is an infrastructure misconfiguration, not a valid dev/CI bypass:
  // this endpoint issues an irreversible DELETE mutation.
  if (!secret) return false;
  const authHeader = req.headers.get('authorization') ?? '';
  const providedToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  return secretEquals(secret, providedToken);
}

// ─── GET handler ─────────────────────────────────────────────────────────────

/**
 * Deletes consent-audit rows older than `CONSENT_LOG_RETENTION_DAYS`.
 *
 * @returns `{ data_source, retention_days, matched, mutation_issued }` on success; 401 on a
 *   failed auth check; 500 (plus a Sentry capture) when ClickHouse is configured and throws.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Cron secret invalid' } },
      { status: 401 },
    );
  }

  const cfg = readClickHouseConfig();
  if (!cfg) {
    // Dependency NOT CONFIGURED (dev/CI) — distinct from "configured but threw", and visible
    // on the wire so a consumer can never read this as enforcement having run (Rule K.2).
    return NextResponse.json({
      data_source: 'not_configured',
      retention_days: CONSENT_LOG_RETENTION_DAYS,
      matched: 0,
      mutation_issued: false,
      note: 'CLICKHOUSE_URL_unset',
    });
  }

  const { count, del, retentionDays } = buildConsentLogRetentionSql();

  try {
    const raw = await executeClickHouseSql(cfg, count.sql, count.params);
    const matched = Number(raw.trim());
    if (!Number.isFinite(matched)) {
      throw new Error(`consent-log retention: unparseable count response ${JSON.stringify(raw)}`);
    }

    if (matched === 0) {
      return NextResponse.json({
        data_source: 'clickhouse',
        retention_days: retentionDays,
        matched: 0,
        mutation_issued: false,
      });
    }

    await executeClickHouseSql(cfg, del.sql, del.params);

    Sentry.addBreadcrumb({
      category: 'retention',
      message: `consent-log retention cron: queued deletion of ${String(matched)} row(s) older than ${String(retentionDays)} days`,
      level: 'info',
      data: { matched, retention_days: retentionDays },
    });

    return NextResponse.json({
      data_source: 'clickhouse',
      retention_days: retentionDays,
      matched,
      mutation_issued: true,
    });
  } catch (err: unknown) {
    // Rule K.2 — a configured store that throws must not be reported as a quiet success.
    Sentry.captureException(err, {
      tags: { retention_cron_failed: 'consent_log' },
      extra: { retention_days: retentionDays },
    });
    return NextResponse.json(
      {
        data_source: 'clickhouse',
        retention_days: retentionDays,
        error: {
          code: 'RETENTION_DELETE_FAILED',
          message: err instanceof Error ? err.message : String(err),
        },
      },
      { status: 500 },
    );
  }
}
