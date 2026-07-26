/**
 * scripts/project-allowed-origins.mts — PG→KV projection of a tenant's browser-`Origin`
 * allow-list onto its ingest api-key record. [FOLLOW-658]
 *
 * WHY THIS EXISTS
 *   `apps/ingest/src/origin-gate.ts` (FOLLOW-642, PR #623) enforces `ApiKeyRecord.allowed_origins`
 *   on every `POST /v1/events`, but NOTHING in this repo ever wrote that field — a repo-wide grep
 *   found zero writes to `KV_API_KEYS`. The whole record was hand-authored JSON. This script is
 *   the producer: it reads the Postgres source-of-truth, translates it into KV semantics, and
 *   writes the record.
 *
 * WHY IT IS AN OPERATOR TOOL AND NOT AN AUTOMATIC PROJECTION AT PROVISIONING
 *   The KV key is `api_key:<RAW api key>`, and the raw key is never stored — Postgres keeps only
 *   `api_keys.hashed_key` = SHA-256(raw). Only the operator who captured the key at activation
 *   (BRAND_PROVISIONING §Step 2, "visible only once") can address the record at all. An automatic
 *   projection would additionally require giving the Vercel control-plane a Cloudflare API token
 *   with KV write scope — i.e. the ability to mint edge auth records — which is a security-posture
 *   change, not a bug fix. So: explicit, documented, single-command provisioning step.
 *
 * THE `[]` TRAP (the reason a naive projection is dangerous)
 *   Postgres `tenants.allowed_origins` is `NOT NULL DEFAULT []` where `[]` means "nothing
 *   configured yet" → inherit. The KV gate reads `[]` as DENY-ALL. Copying the column
 *   mechanically therefore blocks 100% of a brand's browser traffic. {@link planKvAllowedOrigins}
 *   REFUSES the ambiguous empty case by default and makes the operator state the intent.
 *
 * USAGE
 *   pnpm exec tsx apps/control-plane/scripts/project-allowed-origins.mts \
 *     --tenant-id <uuid> --api-key <raw est_pub_…> --namespace-id <KV_API_KEYS id> \
 *     [--origins https://a.com,https://b.com] [--on-empty refuse|deny-all|inherit-env] [--apply]
 *
 *   Without `--apply` the script is a DRY RUN: it reconciles Postgres, prints exactly what it
 *   would write to both stores, and writes nothing.
 *
 *   `--origins` ESTABLISHES `tenants.allowed_origins` when the column is still the `[]` default —
 *   there is no HTTP writer for it today (the staff facade was removed by FOLLOW-622/PR #618) —
 *   and then projects it. It never silently overwrites an already-configured list.
 *
 * CONNECTION
 *   Postgres via `createAdminClient()` (`DATABASE_URL_ADMIN`, falling back to
 *   `DATABASE_URL_DIRECT`). KV via the repo's own `wrangler` (`--apply` only), which needs
 *   `CLOUDFLARE_API_TOKEN` in the environment — see `docs/runbooks/cloudflare.md`.
 *
 * @module apps/control-plane/scripts/project-allowed-origins
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { apiKeys, createAdminClient, tenants } from '@estalara/db';
import type { ApiKeyRecord } from '@estalara/shared';

// ─── Pure projection logic (unit-tested in __tests__/project-allowed-origins.test.ts) ────────

/** What the operator wants done when Postgres carries no configured origins. */
export type OnEmptyPolicy = 'refuse' | 'deny-all' | 'inherit-env';

/** Postgres inputs for the projection. */
export interface OriginProjectionInput {
  /**
   * `api_keys.allowed_origins` — a per-key override. `null` = no override, fall through to the
   * tenant-level column (matches the column's own documented semantics).
   */
  keyOrigins: string[] | null;
  /**
   * `tenants.allowed_origins` — `NOT NULL DEFAULT []`. An EMPTY array means "not configured",
   * NOT deny-all. This is the whole trap.
   */
  tenantOrigins: string[];
  /** How to resolve the ambiguous empty case. */
  onEmpty: OnEmptyPolicy;
}

/**
 * Result of the projection. `value` is exactly what goes into `ApiKeyRecord.allowed_origins`:
 * a non-empty list (explicit allow), `[]` (deny-all) or `null` (inherit the env list).
 */
export type OriginProjection =
  | {
      ok: true;
      value: string[] | null;
      /** Where the decision came from — printed so the operator can audit it. */
      source: 'api_key_column' | 'tenant_column' | 'operator_deny_all' | 'operator_inherit_env';
      /** Human-readable explanation of the resulting ingest behavior. */
      effect: string;
    }
  | { ok: false; reason: string };

/**
 * Canonical origin (`scheme://host[:non-default-port]`) or `null` when unparseable.
 *
 * Deliberately mirrors `normalizeToOrigin` in `apps/ingest/src/origin-gate.ts` (cross-app, no
 * shared runtime package between a Worker and a Next.js script). The asymmetry is safe by
 * construction: the ingest side DROPS an unparseable entry (fails closed at read), while this
 * producer REFUSES to write one at all — the writer is strictly stricter than the reader, so
 * drift can never open the gate.
 */
export function toCanonicalOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url.origin;
}

/**
 * Translate the Postgres origin configuration into the KV field value.
 *
 * Precedence: per-key column → tenant column → operator's `--on-empty` decision. An EMPTY array
 * at either level is treated as "not configured" (never silently projected as KV deny-all), and
 * a value that is not a parseable http(s) origin refuses the whole projection rather than being
 * dropped — a typo must not silently shrink a brand's allow-list.
 */
export function planKvAllowedOrigins(input: OriginProjectionInput): OriginProjection {
  const fromKey = input.keyOrigins ?? [];
  const configured = fromKey.length > 0 ? fromKey : input.tenantOrigins;
  const source: 'api_key_column' | 'tenant_column' =
    fromKey.length > 0 ? 'api_key_column' : 'tenant_column';

  if (configured.length > 0) {
    const canonical: string[] = [];
    for (const raw of configured) {
      const origin = toCanonicalOrigin(raw);
      if (origin === null) {
        return {
          ok: false,
          reason:
            `Postgres holds an origin that is not a parseable http(s) origin: ${JSON.stringify(raw)}. ` +
            'Fix the stored value (scheme://host[:port], no path) before projecting — writing it ' +
            'would silently shrink the brand allow-list at read time.',
        };
      }
      if (!canonical.includes(origin)) canonical.push(origin);
    }
    return {
      ok: true,
      value: canonical,
      source,
      effect: `ingest allows exactly: ${canonical.join(', ')} (every other Origin → 403 forbidden_origin)`,
    };
  }

  switch (input.onEmpty) {
    case 'deny-all':
      return {
        ok: true,
        value: [],
        source: 'operator_deny_all',
        effect:
          'ingest DENIES every cross-origin browser request for this key. Server-side callers ' +
          '(no Origin header, HMAC-signed) still work.',
      };
    case 'inherit-env':
      return {
        ok: true,
        value: null,
        source: 'operator_inherit_env',
        effect:
          "ingest inherits the ENV allow-list — which is ESTALARA's own domains. Correct ONLY for " +
          'the first-party tenant; for any other tenant the ingest guard returns 403 ' +
          'origin_policy_unconfigured (FOLLOW-658).',
      };
    case 'refuse':
    default:
      return {
        ok: false,
        reason:
          'Postgres has NO configured origins for this tenant/key (`tenants.allowed_origins` is ' +
          'the `[]` default). REFUSING to guess: in Postgres `[]` means "not configured yet", but ' +
          'in the KV record `[]` means DENY-ALL — projecting it mechanically would block 100% of ' +
          "this brand's browser traffic. Either set the real origin(s) on the tenant row first, " +
          'or re-run with an explicit --on-empty=deny-all (deliberate lock-down) / ' +
          '--on-empty=inherit-env (first-party tenant only).',
      };
  }
}

/**
 * Decide what to do with operator-supplied `--origins` against what Postgres already holds.
 *
 * There is no HTTP writer for `tenants.allowed_origins` today (the staff settings control was
 * removed as an unenforced facade by FOLLOW-622 / PR #618, and re-adding one is a product
 * decision, not this script's call). So the column is usually the `[]` default, and the operator
 * needs a way to establish it at provisioning time — which is exactly what the schema doc has
 * always claimed happens ("values land at provisioning").
 *
 * Rules:
 *   - Postgres already configured + no `--origins` → use Postgres (`noop`).
 *   - Postgres empty + `--origins` → write the column, then project (`write_pg`). One command
 *     leaves BOTH stores agreeing, which is the point of the ticket.
 *   - Both present and IDENTICAL → `noop` (idempotent re-run).
 *   - Both present and DIFFERENT → refuse. Silently overwriting a configured allow-list from a
 *     command-line argument is how a brand loses origins it depends on.
 */
export function reconcileOperatorOrigins(
  configured: readonly string[],
  operator: readonly string[] | null,
): { ok: true; action: 'noop' | 'write_pg'; origins: string[] } | { ok: false; reason: string } {
  const canonicalConfigured: string[] = [];
  for (const raw of configured) {
    const o = toCanonicalOrigin(raw);
    if (o !== null && !canonicalConfigured.includes(o)) canonicalConfigured.push(o);
  }
  if (operator === null) {
    return { ok: true, action: 'noop', origins: canonicalConfigured };
  }

  const canonicalOperator: string[] = [];
  for (const raw of operator) {
    const o = toCanonicalOrigin(raw);
    if (o === null) {
      return {
        ok: false,
        reason: `--origins contains a value that is not a parseable http(s) origin: ${JSON.stringify(raw)}`,
      };
    }
    if (!canonicalOperator.includes(o)) canonicalOperator.push(o);
  }
  if (canonicalOperator.length === 0) {
    return { ok: false, reason: '--origins was supplied but empty.' };
  }

  if (canonicalConfigured.length === 0) {
    return { ok: true, action: 'write_pg', origins: canonicalOperator };
  }
  const same =
    canonicalConfigured.length === canonicalOperator.length &&
    canonicalConfigured.every((o) => canonicalOperator.includes(o));
  if (same) return { ok: true, action: 'noop', origins: canonicalConfigured };
  return {
    ok: false,
    reason:
      `Postgres already holds [${canonicalConfigured.join(', ')}] but --origins says ` +
      `[${canonicalOperator.join(', ')}]. Refusing to overwrite a configured allow-list from the ` +
      'command line — change the tenant row deliberately, then re-run without --origins.',
  };
}

/**
 * Merge the projected value into the existing KV record, preserving every other field verbatim
 * (notably `hmac_secret`, which this script can never reconstruct).
 *
 * @param existingRaw - the current KV value, or `null` when the record does not exist yet.
 * @param value - the projected `allowed_origins` value.
 * @param fallback - fields used ONLY when creating a record from scratch.
 */
export function mergeKvRecord(
  existingRaw: string | null,
  value: string[] | null,
  fallback: { tenant_id: string; scopes: string[]; label?: string },
): { ok: true; record: ApiKeyRecord; created: boolean } | { ok: false; reason: string } {
  if (existingRaw === null) {
    return {
      ok: true,
      created: true,
      record: {
        tenant_id: fallback.tenant_id,
        scopes: fallback.scopes,
        ...(fallback.label !== undefined ? { label: fallback.label } : {}),
        allowed_origins: value,
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(existingRaw);
  } catch {
    return {
      ok: false,
      reason:
        'The existing KV record is not valid JSON. Refusing to overwrite it — inspect it by hand ' +
        '(`wrangler kv key get`) before re-running.',
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      reason: 'The existing KV record is not a JSON object. Refusing to overwrite.',
    };
  }
  const existing = parsed as Record<string, unknown>;
  if (existing.tenant_id !== fallback.tenant_id) {
    return {
      ok: false,
      reason:
        `The existing KV record belongs to tenant_id=${String(existing.tenant_id)} but Postgres ` +
        `says this api key belongs to ${fallback.tenant_id}. Refusing to write — the two stores ` +
        'disagree about key ownership, which is a security-relevant inconsistency.',
    };
  }
  return {
    ok: true,
    created: false,
    record: { ...(existing as unknown as ApiKeyRecord), allowed_origins: value },
  };
}

// ─── CLI plumbing ────────────────────────────────────────────────────────────

const LOG = '[project-allowed-origins]';

interface Args {
  tenantId: string;
  apiKey: string;
  namespaceId: string;
  onEmpty: OnEmptyPolicy;
  /** Operator-supplied origins (comma-separated on the CLI), or `null` when omitted. */
  origins: string[] | null;
  apply: boolean;
}

/** Parse `--flag value` pairs. Unknown flags and missing values fail loudly. */
export function parseArgs(argv: readonly string[]): Args | { error: string } {
  const values = new Map<string, string>();
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === '--apply') {
      apply = true;
      continue;
    }
    if (!token.startsWith('--')) return { error: `unexpected argument: ${token}` };
    const [flag, inlineValue] = token.includes('=')
      ? [token.slice(0, token.indexOf('=')), token.slice(token.indexOf('=') + 1)]
      : [token, argv[++i]];
    if (inlineValue === undefined) return { error: `missing value for ${flag}` };
    values.set(flag, inlineValue);
  }

  const tenantId = values.get('--tenant-id');
  const apiKey = values.get('--api-key');
  const namespaceId = values.get('--namespace-id');
  const onEmptyRaw = values.get('--on-empty') ?? 'refuse';
  const originsRaw = values.get('--origins');
  if (!tenantId || !apiKey || !namespaceId) {
    return { error: 'required: --tenant-id <uuid> --api-key <raw key> --namespace-id <kv id>' };
  }
  if (onEmptyRaw !== 'refuse' && onEmptyRaw !== 'deny-all' && onEmptyRaw !== 'inherit-env') {
    return { error: `--on-empty must be refuse|deny-all|inherit-env (got ${onEmptyRaw})` };
  }
  const origins =
    originsRaw === undefined
      ? null
      : originsRaw
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
  return { tenantId, apiKey, namespaceId, onEmpty: onEmptyRaw, origins, apply };
}

/** SHA-256 hex of the raw api key — the exact digest stored in `api_keys.hashed_key`. */
function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Read the current KV value, or `null` when the key does not exist.
 *
 * A credentials/network failure also exits non-zero and lands in the `catch`. That is safe here
 * and NOT a silent fallback: the caller's subsequent `wranglerKvPut` uses the same credentials and
 * will throw, so a broken environment can never be mistaken for a successful provisioning run.
 * wrangler's own stderr is inherited, so the real cause is on screen either way.
 */
function wranglerKvGet(namespaceId: string, key: string): string | null {
  let out: string;
  try {
    out = execFileSync(
      'pnpm',
      // Run inside apps/ingest so wrangler finds a config; the explicit --namespace-id is what
      // actually selects the store. `--text` decodes the value as UTF-8 JSON. No `--local`, so
      // this hits the real remote namespace (wrangler v3 default).
      [
        '--filter',
        '@estalara/ingest',
        'exec',
        'wrangler',
        'kv',
        'key',
        'get',
        key,
        '--namespace-id',
        namespaceId,
        '--text',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
    );
  } catch {
    // wrangler exits non-zero when the key does not exist. Treat as "absent" — the merge step
    // then CREATES the record from Postgres rather than silently patching nothing.
    return null;
  }
  return out.trim().length === 0 ? null : out;
}

function wranglerKvPut(namespaceId: string, key: string, value: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'estalara-kv-'));
  const file = join(dir, 'value.json');
  try {
    writeFileSync(file, value, 'utf8');
    execFileSync(
      'pnpm',
      // `--path` avoids putting the record (and the raw api key inside the KV key) through a
      // shell; execFileSync never spawns a shell either.
      [
        '--filter',
        '@estalara/ingest',
        'exec',
        'wrangler',
        'kv',
        'key',
        'put',
        key,
        '--path',
        file,
        '--namespace-id',
        namespaceId,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if ('error' in parsed) {
    console.error(`${LOG} ERROR: ${parsed.error}`);
    console.error(
      `${LOG} usage: pnpm exec tsx apps/control-plane/scripts/project-allowed-origins.mts \\\n` +
        '         --tenant-id <uuid> --api-key <raw key> --namespace-id <kv id> ' +
        '[--origins https://a.com,https://b.com] [--on-empty refuse|deny-all|inherit-env] [--apply]',
    );
    process.exit(1);
  }
  const args = parsed;

  const db = createAdminClient();

  // 1. Tenant must exist and not be soft-deleted.
  const tenantRows = await db
    .select({ id: tenants.id, name: tenants.name, allowedOrigins: tenants.allowedOrigins })
    .from(tenants)
    .where(and(eq(tenants.id, args.tenantId), isNull(tenants.deletedAt)))
    .limit(1);
  const tenant = tenantRows[0];
  if (!tenant) {
    console.error(`${LOG} FAIL: no live tenant row with id=${args.tenantId}.`);
    process.exit(1);
  }

  // 2. RECONCILIATION: the raw key must hash to a live api_keys row owned by THIS tenant.
  //    This is what stops a KV record being seeded for a key Postgres does not know, or for the
  //    wrong tenant — the two-source-of-truth failure this ticket exists to close.
  const hashed = hashApiKey(args.apiKey);
  const keyRows = await db
    .select({
      id: apiKeys.id,
      tenantId: apiKeys.tenantId,
      type: apiKeys.type,
      last4: apiKeys.last4,
      scopes: apiKeys.scopes,
      allowedOrigins: apiKeys.allowedOrigins,
      revokedAt: apiKeys.revokedAt,
      expiresAt: apiKeys.expiresAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.hashedKey, hashed))
    .limit(1);
  const key = keyRows[0];
  if (!key) {
    console.error(
      `${LOG} FAIL: SHA-256 of the supplied --api-key matches no api_keys row. ` +
        'Either the key is mistyped or it was never issued by this control plane.',
    );
    process.exit(1);
  }
  if (key.tenantId !== args.tenantId) {
    console.error(
      `${LOG} FAIL: that api key belongs to tenant ${key.tenantId}, not ${args.tenantId}. ` +
        'Refusing to cross-wire a key onto another tenant.',
    );
    process.exit(1);
  }
  if (key.revokedAt !== null) {
    console.error(
      `${LOG} FAIL: that api key is revoked (revoked_at=${key.revokedAt.toISOString()}).`,
    );
    process.exit(1);
  }
  if (key.expiresAt !== null && key.expiresAt.getTime() <= Date.now()) {
    console.error(`${LOG} FAIL: that api key expired at ${key.expiresAt.toISOString()}.`);
    process.exit(1);
  }
  console.log(
    `${LOG} reconciled: tenant "${tenant.name}" (${tenant.id}) owns api key …${key.last4} ` +
      `(type=${key.type}, scopes=[${key.scopes.join(', ')}]).`,
  );

  // 3. Reconcile any operator-supplied --origins with what Postgres already holds. Postgres stays
  //    the source of truth: `--origins` can ESTABLISH it (there is no HTTP writer for the column
  //    today) but never silently overwrite a configured list.
  const reconciled = reconcileOperatorOrigins(
    key.allowedOrigins ?? tenant.allowedOrigins,
    args.origins,
  );
  if (!reconciled.ok) {
    console.error(`${LOG} FAIL: ${reconciled.reason}`);
    process.exit(1);
  }
  let tenantOrigins = tenant.allowedOrigins;
  if (reconciled.action === 'write_pg') {
    if (args.apply) {
      await db
        .update(tenants)
        .set({ allowedOrigins: reconciled.origins, updatedAt: new Date() })
        .where(eq(tenants.id, tenant.id));
      console.log(
        `${LOG} wrote tenants.allowed_origins = [${reconciled.origins.join(', ')}] ` +
          '(provisioning-time service-role write — there is no HTTP writer for this column).',
      );
    } else {
      console.log(
        `${LOG} DRY RUN would set tenants.allowed_origins = [${reconciled.origins.join(', ')}].`,
      );
    }
    tenantOrigins = reconciled.origins;
  }

  // 4. Project PG → KV semantics.
  const projection = planKvAllowedOrigins({
    keyOrigins: key.allowedOrigins,
    tenantOrigins,
    onEmpty: args.onEmpty,
  });
  if (!projection.ok) {
    console.error(`${LOG} FAIL: ${projection.reason}`);
    process.exit(1);
  }
  console.log(`${LOG} decision source: ${projection.source}`);
  console.log(`${LOG} effect: ${projection.effect}`);
  if (projection.source === 'operator_inherit_env') {
    console.warn(
      `${LOG} WARNING: --on-empty=inherit-env is only correct for Estalara's own first-party ` +
        'tenant. For an external brand the ingest guard will reject its traffic with 403 ' +
        'origin_policy_unconfigured.',
    );
  }

  const kvKey = `api_key:${args.apiKey}`;

  if (!args.apply) {
    console.log(
      `${LOG} DRY RUN — nothing written. Re-run with --apply to write ` +
        `${JSON.stringify({ allowed_origins: projection.value })} onto KV key "api_key:<raw key>" ` +
        `in namespace ${args.namespaceId} (every other field of the record is preserved verbatim).`,
    );
    process.exit(0);
  }

  // 5. Read-modify-write so `hmac_secret` and any other operator-set field survive.
  const existingRaw = wranglerKvGet(args.namespaceId, kvKey);
  const merged = mergeKvRecord(existingRaw, projection.value, {
    tenant_id: tenant.id,
    scopes: key.scopes,
    label: tenant.name,
  });
  if (!merged.ok) {
    console.error(`${LOG} FAIL: ${merged.reason}`);
    process.exit(1);
  }
  if (merged.created && key.type !== 'public') {
    console.error(
      `${LOG} FAIL: KV record does not exist and this is a "${key.type}" key, which needs an ` +
        'hmac_secret this script cannot derive (the secret is not stored in Postgres). Seed the ' +
        'record by hand, then re-run to project the origins.',
    );
    process.exit(1);
  }

  wranglerKvPut(args.namespaceId, kvKey, JSON.stringify(merged.record));
  console.log(
    `${LOG} ${merged.created ? 'CREATED' : 'UPDATED'} KV record for tenant ${tenant.id}. ` +
      'Verify per BRAND_PROVISIONING §Part C step 3: a POST from an allow-listed Origin must be ' +
      '2xx AND the same POST with a foreign Origin must be 403 forbidden_origin.',
  );
}

// ─── Entrypoint guard (mirrors feedback-canary.mts) ──────────────────────────

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('project-allowed-origins.mts') ||
    process.argv[1].endsWith('project-allowed-origins.ts') ||
    process.argv[1].endsWith('project-allowed-origins.js'));

if (isMain) {
  main().catch((err: unknown) => {
    console.error(`${LOG} Fatal error:`, err instanceof Error ? (err.stack ?? err.message) : err);
    process.exit(1);
  });
}

export { main as runProjectAllowedOrigins };
