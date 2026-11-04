/**
 * FOLLOW-1344 — the lift reader's own two functions, in process, on the local ClickHouse. N3 needs
 * the D-J split (`conversion_breakdown`), which only `GET /api/dashboard/analytics/lift` returns, and
 * that route takes a staff JWT no local process can mint while the control plane has no
 * `SUPABASE_JWT_SECRET` (K3 gap). Same SQL and same assembly as the route; not the route. N3 reports
 * which one it read, and grades the route itself as its own hop.
 *
 * Usage (env `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`,
 * `CALLER_SIGNED_COLUMN_ENABLED`): `tsx --tsconfig apps/control-plane/tsconfig.json
 * scripts/dev/n3-lift-reader.ts <tenant_id> <window_days>`. Prints the response JSON.
 *
 * @module scripts/dev/n3-lift-reader
 */

import {
  buildResponseFromRaw,
  fetchLiftRaw,
  parseWindowDays,
} from '../../apps/control-plane/src/app/api/dashboard/analytics/lift/route-helpers';

const [tenantId, windowArg] = process.argv.slice(2);
if (!tenantId) throw new Error('usage: n3-lift-reader.ts <tenant_id> <window_days>');
const windowDays = parseWindowDays(windowArg ?? '7');
void fetchLiftRaw(tenantId, windowDays).then((raw) => {
  if (raw === null) throw new Error('CLICKHOUSE_URL is unset: nothing was read');
  console.log(JSON.stringify(buildResponseFromRaw(tenantId, windowDays, raw, 'clickhouse')));
});
