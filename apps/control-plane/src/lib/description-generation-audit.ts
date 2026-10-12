/**
 * The `description_generations` ClickHouse audit-trail writer (FOLLOW-463 / audit F-17, §E.7.5).
 *
 * Moved out of `app/api/internal/description-cache/route.ts` by FOLLOW-1297 (ADR-0023 §3) so the
 * in-process generator (`description-generator.ts`) and the Modal callback route write the same row
 * the same way. `source: 'modal_generation'` is kept as-is for both callers because consumers query
 * it (ADR-0023 §3, byte-identical outputs).
 *
 * Never throws: the Postgres row is the read-path truth, so a ClickHouse failure is logged and
 * captured (`kind: 'description_generations_write_failed'`) and reported in the return value.
 *
 * @module apps/control-plane/src/lib/description-generation-audit
 */

import * as Sentry from '@sentry/nextjs';
import { clickhouseAuthHeaders } from '@/lib/clickhouse-http';

type AuditWriteResult = 'written' | 'not_configured' | 'failed';

/**
 * Write one `description_generations` row (migration 0007). `tier` is fixed at 0 — Adaptive
 * Listings has no Tiers; the column predates that decision and is non-nullable.
 *
 * @returns `'written'`, `'not_configured'` (no `CLICKHOUSE_URL`, dev/CI) or `'failed'`.
 */
export async function writeDescriptionGenerationAudit(entry: {
  tenant_id: string;
  listing_id: string;
  archetype: string;
  locale: string;
  model: string;
  description_chars: number;
  verified_facts_used: readonly string[];
}): Promise<AuditWriteResult> {
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  if (!clickhouseUrl) return 'not_configured';

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

  const tags = {
    area: 'description-cache',
    sink: 'clickhouse',
    kind: 'description_generations_write_failed',
    table: 'description_generations',
  };
  try {
    const res = await fetch(url.toString(), { method: 'POST', headers, body: JSON.stringify(row) });
    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable body>');
      const msg = `[description-generations] ClickHouse INSERT rejected: HTTP ${String(res.status)} — ${body.slice(0, 500)}`;
      console.error(msg);
      Sentry.captureException(new Error(msg), { tags, extra: { status: res.status } });
      return 'failed';
    }
    return 'written';
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[description-generations] ClickHouse audit write failed:', msg);
    Sentry.captureException(err instanceof Error ? err : new Error(msg), { tags });
    return 'failed';
  }
}
