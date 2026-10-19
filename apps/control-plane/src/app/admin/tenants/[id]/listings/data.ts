/**
 * Server-side data access for `/admin/tenants/[id]/listings` (FOLLOW-1334): which of the tenant's
 * listings already carry FAQ answers (the RAG corpus `answers` table), newest edit first.
 *
 * Rule K.2: a configured-but-failing DB is a real error — it returns `{ ok: false }` with a generic
 * message (the DB error text stays out of the page) and captures to Sentry, so the page renders a
 * visible error, never an empty list that reads as "no listings".
 * The tenant fence is the `WHERE tenant_id = $1` in the query itself: this runs on the service-role
 * client (RLS bypassed), and the page has already validated `tenantId` with `tenantExists`
 * (ADR-0018 §2 invariant 5).
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/listings/data
 */

import { desc, eq, max, count } from 'drizzle-orm';
import * as Sentry from '@sentry/nextjs';

import { answers, createAdminClient } from '@estalara/db';

export interface ListingAnswerSummary {
  listingId: string;
  answerCount: number;
  /** ISO timestamp of the most recent edit among the listing's answers. */
  lastUpdatedAt: string | null;
}

export type ListingAnswerSummaries =
  | { ok: true; listings: ListingAnswerSummary[] }
  | { ok: false; error: string };

/** @param tenantId - a tenant id already validated against the `tenants` table. */
export async function getListingAnswerSummaries(tenantId: string): Promise<ListingAnswerSummaries> {
  try {
    const db = createAdminClient();
    const lastUpdated = max(answers.updatedAt);
    const rows = await db
      .select({
        listingId: answers.listingId,
        answerCount: count(),
        lastUpdatedAt: lastUpdated,
      })
      .from(answers)
      .where(eq(answers.tenantId, tenantId))
      .groupBy(answers.listingId)
      .orderBy(desc(lastUpdated));

    return {
      ok: true,
      listings: rows.map((r) => ({
        listingId: r.listingId,
        answerCount: r.answerCount,
        lastUpdatedAt: r.lastUpdatedAt ? new Date(r.lastUpdatedAt).toISOString() : null,
      })),
    };
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: 'admin/tenants/listings' },
      extra: { tenant_id: tenantId },
    });
    // Generic on purpose: a drizzle error message carries the SQL and its params. The detail is in
    // the Sentry event above.
    return {
      ok: false,
      error: 'The listing lookup failed. Try again; if it persists, check Sentry.',
    };
  }
}
