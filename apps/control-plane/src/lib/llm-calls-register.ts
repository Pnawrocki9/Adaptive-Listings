/**
 * The ClickHouse `llm_calls` register — one writer, many callers (FOLLOW-1061).
 *
 * ## Why this module exists
 *
 * `logLlmCallAsync` lived inside `llm-gateway.ts` as a module-private function. FOLLOW-1056 made
 * every generation exit book its own row through it; FOLLOW-1061 adds a caller that is not a
 * generation at all (the `/api/adapt` pre-LLM segment, `PRE_LLM_SEGMENT_SOURCE`). Two callers in
 * two modules with one INSERT statement is the point: the stub for FOLLOW-1061 forbids a second,
 * competing latency store, and a copied INSERT would be exactly that with extra steps.
 *
 * Nothing about the statement, its parameterisation (FOLLOW-261 / F-30) or its fail-loud
 * behaviour changed in the move. It is byte-for-byte the same query and the same Sentry tags.
 *
 * ## Why the extraction, rather than exporting it from `llm-gateway.ts`
 *
 * 23 test suites under `src/app/api/adapt/` replace `@/lib/llm-gateway` wholesale with a factory
 * mock that returns only `callLlmGateway`. An export added there would resolve to `undefined` in
 * every one of them, so the register would be untestable from the route precisely where it is now
 * used.
 *
 * @module apps/control-plane/src/lib/llm-calls-register
 */

import * as Sentry from '@sentry/nextjs';
import { clickhouseAuthHeaders } from '@/lib/clickhouse-http';

/**
 * Write one row to ClickHouse `llm_calls`.
 *
 * Fire-and-forget by contract, but it RETURNS the promise so callers can register it via
 * `after()` / `afterResponse()` and guarantee completion after the response is sent
 * (FOLLOW-431 / ESC-033 — an un-awaited fetch is dropped when the Vercel instance suspends).
 *
 * Unconfigured (`CLICKHOUSE_URL` unset, i.e. dev/CI) is a silent no-op; configured-but-failed is
 * loud on both the HTTP-rejected and network paths (Rule K.2). Analytics failures never surface
 * to the caller.
 *
 * @param params.source - The register's discriminator. Generation outcomes and judge verdicts are
 *                        defined in `llm-gateway.ts`; route segments in `adapt-segment-timing.ts`.
 */
export function logLlmCallAsync(params: {
  sessionId: string;
  tenantId: string;
  archetypeId: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  source: string;
}): Promise<void> {
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  if (!clickhouseUrl) return Promise.resolve();

  const clickhouseUser = process.env.CLICKHOUSE_USER ?? 'default';
  const clickhousePassword = process.env.CLICKHOUSE_PASSWORD ?? '';
  const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');

  // FOLLOW-261 (F-30): parameterized INSERT — {name:Type} placeholders eliminate string
  // interpolation; values passed as ?param_name= URL query params (ClickHouse HTTP interface).
  const query =
    `INSERT INTO llm_calls ` +
    `(session_id, tenant_id, archetype, model, tokens_in, tokens_out, cost_usd, latency_ms, source, ts) ` +
    `VALUES ({p_session_id:String}, {p_tenant_id:String}, {p_archetype:String}, {p_model:String}, ` +
    `{p_tokens_in:UInt32}, {p_tokens_out:UInt32}, {p_cost_usd:Float64}, {p_latency_ms:UInt32}, ` +
    `{p_source:String}, {p_ts:String})`;

  const url = new URL(clickhouseUrl);
  url.searchParams.set('param_p_session_id', params.sessionId);
  url.searchParams.set('param_p_tenant_id', params.tenantId);
  url.searchParams.set('param_p_archetype', params.archetypeId);
  url.searchParams.set('param_p_model', params.model);
  url.searchParams.set('param_p_tokens_in', String(params.tokensIn));
  url.searchParams.set('param_p_tokens_out', String(params.tokensOut));
  url.searchParams.set('param_p_cost_usd', String(params.costUsd));
  url.searchParams.set('param_p_latency_ms', String(params.latencyMs));
  url.searchParams.set('param_p_source', params.source);
  url.searchParams.set('param_p_ts', ts);

  return fetch(url.toString(), {
    method: 'POST',
    body: query,
    headers: {
      'Content-Type': 'text/plain',
      ...clickhouseAuthHeaders({ user: clickhouseUser, password: clickhousePassword }),
    },
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.text().catch(() => '<unreadable body>');
        const msg = `[llm-gateway] ClickHouse INSERT rejected: HTTP ${String(res.status)} — ${body.slice(0, 500)}`;
        console.error(msg);
        Sentry.captureException(new Error(msg), {
          tags: { area: 'adapt', sink: 'clickhouse', kind: 'insert_rejected', table: 'llm_calls' },
          extra: { status: res.status },
        });
      }
    })
    .catch((err: unknown) => {
      // Network-layer failure (DNS, connection refused, malformed URL, timeout).
      // Analytics failures must not surface to callers — log + Sentry only.
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[llm-gateway] ClickHouse log failed:', msg);
      Sentry.captureException(err instanceof Error ? err : new Error(msg), {
        tags: { area: 'adapt', sink: 'clickhouse', kind: 'network', table: 'llm_calls' },
      });
    });
}
