/**
 * scripts/issue-tenant-api-key.mts — operator API-key issuance for the single tenant. [FOLLOW-1327]
 *
 * WHY THIS EXISTS
 *   `POST /api/schema/activate` was the only production path that minted an API key, and it also
 *   promoted the tenant `pending → active` and kicked off `seedListingEmbeddingsForActivation`.
 *   Plan Phase 2 R6 (FOLLOW-1328) deletes that route together with the detection chain, so this
 *   script is its replacement: an explicit operator command, run against the service-role
 *   connection, with no HTTP surface at all. Runbook: `docs/runbooks/API_KEY_ISSUANCE.md`.
 *
 * SUBCOMMANDS
 *   issue  --tenant <uuid> --label <text> [--scopes a:b,c:d] [--server] [--additional]
 *   rotate --key-id <uuid> [--label <text>] [--grace-hours <0..720>]
 *   revoke --key-id <uuid> [--reason <text>]
 *   list   --tenant <uuid>
 *   Global: [--confirm-production] (required when the database host is not loopback).
 *
 * PARITY WITH `schema/activate` (what an operator gets is what the route produced)
 *   - Hash: `api_keys.hashed_key` = lower-hex SHA-256 of the UTF-8 raw key — byte-identical to the
 *     route's `hashKey()`, to `seed-local-tenant.mts`'s `HASHED_API_KEY`, and to the verify path
 *     `sha256Hex()` in `src/lib/api-key-auth.ts` (pinned by the test suite).
 *   - Public key format: prefix `est_pub_` (the route's `KEY_PREFIX`) + CSPRNG hex, `prefix` and
 *     `last_4` columns filled the same way. The random part is 32 hex chars (128 bit) instead of the
 *     route's 16 (64 bit); every verifier hashes whatever string it receives, so length is free.
 *   - Tenant promotion: `UPDATE tenants SET status='active' WHERE id=$1 AND status='pending'`, the
 *     route's exact predicate, in the SAME transaction as the key insert (the route's staff path
 *     was transactional; this matches it). It flips once — a second issue is a no-op on status.
 *   - Embedding seed: after the transaction commits, `seedListingEmbeddingsForActivation(tenant,
 *     schema)` is called once per `issue`, as the route called it once per activation. The route
 *     passed the schema it had just upserted; this script passes the tenant's latest stored
 *     `tenant_site_schemas` row (or `null` — the demo-manifest fallback still applies). The route
 *     ran it in `after()`; a CLI simply awaits it and reports the outcome instead of swallowing it.
 *   - Deliberately NOT carried over: the schema upsert and its Redis cache bust (no schema is
 *     written here), and "return the existing key masked" — instead `issue` REFUSES when an active
 *     key of the same type exists (use `rotate`, or `--additional` for a deliberate second key).
 *
 * THE INGEST SIDE (`KV_API_KEYS`)
 *   The ingest Worker reads only KV (`api_key:<raw key>` → `ApiKeyRecord`, `@estalara/shared`) and
 *   has no Postgres binding; the route never wrote KV either. Because the KV KEY is the raw key,
 *   only this one moment can produce the record, so `issue`/`rotate` print it next to the raw key.
 *   The operator writes it with wrangler (runbook §4). `--server` keys (FOLLOW-1203
 *   signed-conversion callers) get a fresh `hmac_secret` (32 random bytes, hex — what
 *   `apps/ingest/src/auth.ts` hex-decodes).
 *
 * BROWSER ORIGINS ARE NOT PER KEY (FOLLOW-1333)
 *   Ingest and the control plane accept browser requests from one constant list
 *   (`@estalara/shared/browser-origins`), so the record carries no origin field and this script
 *   takes no origin flag; `--allowed-origins` / `--on-empty` are refused with a pointer here. The
 *   Postgres origin columns of `api_keys` / `tenants` are left as they are and read by nothing.
 *   What a leaked raw SERVER key alone can do is therefore what the page-visible public key can
 *   already do (unsigned events for the one tenant): the signed-conversion power is in the
 *   `hmac_secret`, which never leaves the host backend.
 *
 * SECRET HYGIENE
 *   Progress and diagnostics go to STDERR. The raw key (and, for `--server`, the HMAC secret) is
 *   written exactly once, to STDOUT, inside a banner — never to a log line, a file or an exception.
 *   Postgres stores only the hash; the HMAC secret is stored nowhere but the KV record.
 *
 * CONNECTION
 *   `createAdminClient()` (`DATABASE_URL_ADMIN`, falling back to `DATABASE_URL_DIRECT`), like
 *   `seed-local-tenant.mts`. A non-loopback host is refused unless `--confirm-production` is given;
 *   only `host:port` is ever printed, never the URL.
 *
 * Usage (repo root):
 *   pnpm exec tsx apps/control-plane/scripts/issue-tenant-api-key.mts issue --tenant <uuid> \
 *     --label "Estalara web"
 *   (`pnpm issue-api-key …` is the same command, but `pnpm run` collapses every non-zero exit to 1.)
 *
 * Exit codes: 0 done · 1 refused / failed, nothing written (or the DB rolled back) ·
 *   2 key issued and valid, but the configured embedding seed was not confirmed complete (a listing
 *   failed, or was handed to the requeue route this process cannot observe). Re-run the seed;
 *   do NOT re-issue.
 *
 * @module apps/control-plane/scripts/issue-tenant-api-key
 */

import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import {
  apiKeys,
  createAdminClient,
  describeAdminDatabase,
  tenantSiteSchemas,
  tenants,
} from '@estalara/db';
import type { ApiKeyRecord, TenantSiteSchema } from '@estalara/shared';
import * as seedListingEmbeddingsModule from '../src/lib/seed-listing-embeddings';
import type { SeedListingsResult } from '../src/lib/seed-listing-embeddings';

/**
 * ESM/CJS interop. This app's package.json declares no `"type": "module"`, so `tsx` loads its
 * `src/*.ts` as CommonJS and, from this `.mts` entry, exposes their exports ONLY on `default`
 * (a named import fails at link time). Under Vitest the same module is real ESM with named
 * exports and no `default`. Resolve whichever shape is present; `@estalara/db` has no CJS build,
 * so this file cannot simply become a `.ts` (CJS) script like `seed-estalara-listings.ts`.
 */
const seedLib =
  (seedListingEmbeddingsModule as unknown as { default?: typeof seedListingEmbeddingsModule })
    .default ?? seedListingEmbeddingsModule;

const LOG = '[issue-api-key]';

// ─── Key material ────────────────────────────────────────────────────────────

/** `api_keys.type` values. `secret` = server-side caller that signs its requests. */
export type KeyType = 'public' | 'secret';

/** Public (SDK) key prefix — the removed `schema/activate` route's `KEY_PREFIX`. */
export const PUBLIC_KEY_PREFIX = 'est_pub_';
/** Server (signing) key prefix. Never placed on a page. */
export const SERVER_KEY_PREFIX = 'est_srv_';
/** Random bytes in a raw key (hex-encoded → 32 chars). */
const KEY_RANDOM_BYTES = 16;
/** Random bytes in an HMAC secret (hex-encoded → 64 chars, what ingest `hexToBytes` expects). */
const HMAC_SECRET_BYTES = 32;

/** Default scopes: the SDK key writes events and reads config; a server key only writes. */
export const DEFAULT_SCOPES: Readonly<Record<KeyType, readonly string[]>> = {
  public: ['read:events', 'write:events'],
  secret: ['write:events'],
};

/**
 * Lower-hex SHA-256 of the UTF-8 raw key — the exact digest stored in `api_keys.hashed_key` and
 * recomputed by every verifier (`sha256Hex` in `src/lib/api-key-auth.ts`).
 */
export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/** CSPRNG raw key: `<prefix><32 lower-hex chars>`. */
export function generateRawKey(type: KeyType): string {
  const prefix = type === 'public' ? PUBLIC_KEY_PREFIX : SERVER_KEY_PREFIX;
  return prefix + randomBytes(KEY_RANDOM_BYTES).toString('hex');
}

/** CSPRNG HMAC secret for the ingest signed-request contract (`apps/ingest/src/auth.ts`). */
export function generateHmacSecret(): string {
  return randomBytes(HMAC_SECRET_BYTES).toString('hex');
}

/**
 * The `KV_API_KEYS` value for a freshly issued key. Typed as the shared {@link ApiKeyRecord} so
 * the producer cannot drift from the ingest reader.
 */
export function buildKvRecord(input: {
  tenantId: string;
  scopes: readonly string[];
  label: string;
  hmacSecret?: string;
}): ApiKeyRecord {
  return {
    tenant_id: input.tenantId,
    scopes: [...input.scopes],
    label: input.label,
    ...(input.hmacSecret !== undefined ? { hmac_secret: input.hmacSecret } : {}),
  };
}

// ─── Persistence port (Drizzle in main, an in-memory fake in tests) ────────────

/** Tenant fields the issuance flow reads. */
export interface TenantRow {
  id: string;
  name: string;
  status: string;
  deletedAt: Date | null;
}

/** Key fields the flow reads — never the hash. */
export interface KeyRow {
  id: string;
  tenantId: string;
  type: string;
  prefix: string;
  last4: string;
  scopes: string[];
  createdAt: Date;
  expiresAt: Date | null;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  revokeReason: string | null;
}

/** New `api_keys` row. */
export interface NewKeyRow {
  tenantId: string;
  type: KeyType;
  prefix: string;
  hashedKey: string;
  last4: string;
  scopes: string[];
}

/** Operations available inside one database transaction. */
export interface IssuanceTx {
  /** `SELECT … FOR UPDATE` the tenant row (serialises concurrent issuance for one tenant). */
  lockTenant(tenantId: string): Promise<TenantRow | null>;
  /** The route's predicate: `status='active' WHERE id=$1 AND status='pending'`. True if flipped. */
  activateIfPending(tenantId: string): Promise<boolean>;
  /** Live (not revoked, not expired) keys of one type for a tenant. */
  liveKeys(tenantId: string, type: string, now: Date): Promise<KeyRow[]>;
  /** `SELECT … FOR UPDATE` one key by id. */
  lockKey(keyId: string): Promise<KeyRow | null>;
  insertKey(row: NewKeyRow): Promise<{ id: string }>;
  updateKey(
    keyId: string,
    patch: Partial<Pick<KeyRow, 'expiresAt' | 'rotatedAt' | 'revokedAt' | 'revokeReason'>>,
  ): Promise<void>;
}

/** The store the flows run against. */
export interface IssuanceStore {
  /** Run `fn` in ONE transaction: any throw rolls every write back. */
  transaction<T>(fn: (tx: IssuanceTx) => Promise<T>): Promise<T>;
  listKeys(tenantId: string): Promise<KeyRow[]>;
  /** Latest `tenant_site_schemas.schema` for the tenant, or null. */
  latestSiteSchema(tenantId: string): Promise<TenantSiteSchema | null>;
}

/** Output channels. `log` = diagnostics (stderr in main). `secret` = the one-time block (stdout). */
export interface Io {
  log(line: string): void;
  secret(block: string): void;
}

/** A refusal the operator can act on. Its message never carries key material. */
export class OperatorError extends Error {}

// ─── Arguments ───────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPE_RE = /^[a-z][a-z_]*:[a-z_*]+$/;
const LABEL_MAX = 120;
const GRACE_MAX_HOURS = 720;

export type Command =
  | {
      cmd: 'issue';
      tenantId: string;
      label: string;
      scopes: string[] | null;
      server: boolean;
      additional: boolean;
      confirmProduction: boolean;
    }
  | {
      cmd: 'rotate';
      keyId: string;
      label: string | null;
      graceHours: number;
      confirmProduction: boolean;
    }
  | { cmd: 'revoke'; keyId: string; reason: string; confirmProduction: boolean }
  | { cmd: 'list'; tenantId: string; confirmProduction: boolean };

const BOOLEAN_FLAGS = new Set(['--server', '--additional', '--confirm-production']);
const VALUE_FLAGS: Record<Command['cmd'], readonly string[]> = {
  issue: ['--tenant', '--label', '--scopes'],
  rotate: ['--key-id', '--label', '--grace-hours'],
  revoke: ['--key-id', '--reason'],
  list: ['--tenant'],
};
/**
 * Flags removed by FOLLOW-1333: browser origins are a constant list, not per key. Refused with a
 * reason rather than as an unknown flag, so an operator following an older runbook learns why.
 */
const REMOVED_FLAGS: ReadonlySet<string> = new Set(['--allowed-origins', '--on-empty']);
const REMOVED_FLAG_REASON =
  'was removed by FOLLOW-1333: browser origins are one constant list ' +
  '(@estalara/shared/browser-origins), not per key — drop the flag (runbook §3)';

const BOOLEAN_FLAGS_FOR: Record<Command['cmd'], readonly string[]> = {
  issue: ['--server', '--additional', '--confirm-production'],
  rotate: ['--confirm-production'],
  revoke: ['--confirm-production'],
  list: ['--confirm-production'],
};

function validLabel(label: string): string | null {
  const trimmed = label.trim();
  if (trimmed.length === 0 || trimmed.length > LABEL_MAX) return null;
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Parse `<subcommand> --flag value …`. Unknown flags, missing values and bad values fail loudly. */
export function parseArgs(argv: readonly string[]): Command | { error: string } {
  const cmd = argv[0];
  if (cmd !== 'issue' && cmd !== 'rotate' && cmd !== 'revoke' && cmd !== 'list') {
    return { error: 'first argument must be one of: issue | rotate | revoke | list' };
  }
  const values = new Map<string, string>();
  const bools = new Set<string>();
  for (let i = 1; i < argv.length; i++) {
    const token = argv[i]!;
    if (!token.startsWith('--')) return { error: `unexpected argument: ${token}` };
    const eqAt = token.indexOf('=');
    const flag = eqAt === -1 ? token : token.slice(0, eqAt);
    if (BOOLEAN_FLAGS.has(flag)) {
      if (!BOOLEAN_FLAGS_FOR[cmd].includes(flag))
        return { error: `${flag} is not valid for ${cmd}` };
      if (eqAt !== -1) return { error: `${flag} takes no value` };
      bools.add(flag);
      continue;
    }
    if (REMOVED_FLAGS.has(flag)) return { error: `${flag} ${REMOVED_FLAG_REASON}` };
    if (!VALUE_FLAGS[cmd].includes(flag)) return { error: `unknown flag for ${cmd}: ${flag}` };
    const value = eqAt === -1 ? argv[++i] : token.slice(eqAt + 1);
    if (value === undefined || value.startsWith('--'))
      return { error: `missing value for ${flag}` };
    values.set(flag, value);
  }
  const confirmProduction = bools.has('--confirm-production');

  if (cmd === 'issue' || cmd === 'list') {
    const tenantId = values.get('--tenant');
    if (!tenantId || !UUID_RE.test(tenantId)) return { error: '--tenant <uuid> is required' };
    if (cmd === 'list') return { cmd, tenantId: tenantId.toLowerCase(), confirmProduction };

    const label = validLabel(values.get('--label') ?? '');
    if (label === null) {
      return { error: `--label <text> is required (1–${String(LABEL_MAX)} printable chars)` };
    }
    let scopes: string[] | null = null;
    const scopesRaw = values.get('--scopes');
    if (scopesRaw !== undefined) {
      scopes = [...new Set(splitList(scopesRaw))];
      if (scopes.length === 0) return { error: '--scopes was supplied but empty' };
      const bad = scopes.find((s) => !SCOPE_RE.test(s));
      if (bad !== undefined) return { error: `--scopes entry is not <noun>:<verb>: ${bad}` };
    }
    const server = bools.has('--server');
    return {
      cmd,
      tenantId: tenantId.toLowerCase(),
      label,
      scopes,
      server,
      additional: bools.has('--additional'),
      confirmProduction,
    };
  }

  const keyId = values.get('--key-id');
  if (!keyId || !UUID_RE.test(keyId)) return { error: '--key-id <uuid> is required' };
  if (cmd === 'revoke') {
    const reason = validLabel(values.get('--reason') ?? 'operator revocation');
    if (reason === null) return { error: '--reason must be 1–120 printable chars' };
    return { cmd, keyId: keyId.toLowerCase(), reason, confirmProduction };
  }
  const labelRaw = values.get('--label');
  const label = labelRaw === undefined ? null : validLabel(labelRaw);
  if (labelRaw !== undefined && label === null)
    return { error: '--label must be 1–120 printable chars' };
  const graceRaw = values.get('--grace-hours') ?? '0';
  if (!/^\d+$/.test(graceRaw) || Number(graceRaw) > GRACE_MAX_HOURS) {
    return { error: `--grace-hours must be an integer 0..${String(GRACE_MAX_HOURS)}` };
  }
  return {
    cmd,
    keyId: keyId.toLowerCase(),
    label,
    graceHours: Number(graceRaw),
    confirmProduction,
  };
}

// ─── Target guard ────────────────────────────────────────────────────────────

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

/**
 * Refuse a non-loopback database unless the operator said `--confirm-production`. Only the
 * credential-free `host:port` is ever echoed.
 */
export function checkTarget(
  target: { host: string; port: string },
  confirmProduction: boolean,
): { ok: true; line: string } | { ok: false; reason: string } {
  const hostPort = `${target.host}:${target.port}`;
  if (LOOPBACK_HOSTS.has(target.host))
    return { ok: true, line: `target database ${hostPort} (local)` };
  if (confirmProduction) {
    return {
      ok: true,
      line: `target database ${hostPort} (NON-LOCAL, --confirm-production given)`,
    };
  }
  return {
    ok: false,
    reason:
      `REFUSING: the database at ${hostPort} is not a loopback host. Issuing or revoking a ` +
      'credential there is a production action — re-run with --confirm-production if that is intended.',
  };
}

// ─── Flows ───────────────────────────────────────────────────────────────────

const BANNER = '═'.repeat(72);

function secretBlock(input: {
  title: string;
  keyId: string;
  tenantId: string;
  type: KeyType;
  rawKey: string;
  record: ApiKeyRecord;
}): string {
  const lines = [
    BANNER,
    ` ${input.title} — SHOWN ONCE. Store it now; it cannot be recovered (only its hash is kept).`,
    BANNER,
    `key_id:      ${input.keyId}`,
    `tenant_id:   ${input.tenantId}`,
    `type:        ${input.type}`,
    `raw api key: ${input.rawKey}`,
    '',
    'KV_API_KEYS (ingest Worker) — key name, then value (runbook §4):',
    `api_key:${input.rawKey}`,
    JSON.stringify(input.record),
  ];
  if (input.type === 'public') {
    lines.push('', 'Estalara app SDK loader env: PUBLIC_ESTALARA_API_KEY=<raw api key above>');
  } else {
    lines.push(
      '',
      'Server caller: keep the raw key AND hmac_secret in the host backend secret store.',
    );
  }
  lines.push(BANNER);
  return lines.join('\n') + '\n';
}

/** Outcome of {@link issueKey}. Carries no key material. */
export interface IssueOutcome {
  keyId: string;
  tenantActivated: boolean;
  seed: SeedListingsResult | null;
  /** True when the embed seed was configured but did not fully succeed (exit 2). */
  seedIncomplete: boolean;
}

type SeedFn = (tenantId: string, schema: TenantSiteSchema | null) => Promise<SeedListingsResult>;

/**
 * `issue`: mint a key, store its hash, promote the tenant `pending → active` (once), print the
 * key + KV record once, then run the activation embedding seed.
 */
export async function issueKey(
  store: IssuanceStore,
  io: Io,
  cmd: Extract<Command, { cmd: 'issue' }>,
  seed: SeedFn,
  now: () => Date = () => new Date(),
): Promise<IssueOutcome> {
  const type: KeyType = cmd.server ? 'secret' : 'public';
  const scopes = cmd.scopes ?? [...DEFAULT_SCOPES[type]];

  const minted = await store.transaction(async (tx) => {
    const tenant = await tx.lockTenant(cmd.tenantId);
    if (!tenant) throw new OperatorError(`no tenant row with id=${cmd.tenantId}.`);
    if (tenant.deletedAt !== null) {
      throw new OperatorError(`tenant ${tenant.id} is soft-deleted; refusing to issue a key.`);
    }
    if (tenant.status !== 'pending' && tenant.status !== 'active') {
      throw new OperatorError(
        `tenant ${tenant.id} has status "${tenant.status}"; keys are issued only to pending/active tenants.`,
      );
    }

    const live = await tx.liveKeys(tenant.id, type, now());
    if (live.length > 0 && !cmd.additional) {
      throw new OperatorError(
        `tenant ${tenant.id} already has ${String(live.length)} live ${type} key(s): ` +
          `${live.map((k) => `${k.id} (${k.prefix}…${k.last4})`).join(', ')}. ` +
          'Use `rotate --key-id <id>` to replace one, or pass --additional to mint a second on purpose.',
      );
    }

    const rawKey = generateRawKey(type);
    const hmacSecret = type === 'secret' ? generateHmacSecret() : undefined;

    // Route order: promote the tenant, then insert the key — one transaction here.
    const activated = await tx.activateIfPending(tenant.id);
    const { id } = await tx.insertKey({
      tenantId: tenant.id,
      type,
      prefix: type === 'public' ? PUBLIC_KEY_PREFIX : SERVER_KEY_PREFIX,
      hashedKey: hashApiKey(rawKey),
      last4: rawKey.slice(-4),
      scopes,
    });
    const record = buildKvRecord({
      tenantId: tenant.id,
      scopes,
      label: cmd.label,
      ...(hmacSecret !== undefined ? { hmacSecret } : {}),
    });
    return { id, tenantId: tenant.id, rawKey, record, activated };
  });

  io.log(
    `${LOG} issued ${type} key ${minted.id} for tenant ${minted.tenantId} ` +
      `(scopes=[${scopes.join(', ')}]); tenant ${minted.activated ? 'promoted pending → active' : 'status unchanged'}.`,
  );
  io.secret(
    secretBlock({
      title: type === 'public' ? 'NEW PUBLIC API KEY' : 'NEW SERVER API KEY + HMAC SECRET',
      keyId: minted.id,
      tenantId: minted.tenantId,
      type,
      rawKey: minted.rawKey,
      record: minted.record,
    }),
  );

  // Activation embedding seed — once per issue, as the route did once per activation.
  const schema = await store.latestSiteSchema(minted.tenantId);
  let result: SeedListingsResult | null = null;
  let seedIncomplete = false;
  try {
    result = await seed(minted.tenantId, schema);
    if (result.skipped_reason) {
      io.log(`${LOG} embedding seed skipped: ${result.skipped_reason}`);
    } else {
      io.log(
        `${LOG} embedding seed: attempted=${String(result.attempted)} succeeded=${String(result.succeeded)} ` +
          `failed=${String(result.failed)} requeued=${String(result.overflow_count)}`,
      );
      // A first-time failure is not counted in `failed` — it is handed to the next hop
      // (`overflow_count`) via the control plane's internal requeue route, whose completion this
      // process cannot observe (and the requeue POST itself may have failed — see the lines
      // above). For the single tenant's catalog a healthy run finishes in one hop, so anything
      // left over is reported as "not confirmed", never as done.
      seedIncomplete = result.failed > 0 || result.overflow_count > 0;
    }
  } catch (err) {
    seedIncomplete = true;
    io.log(`${LOG} embedding seed threw: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (seedIncomplete) {
    io.log(
      `${LOG} WARNING: the key IS issued and valid, but the embedding seed did not complete. ` +
        'Do NOT re-issue; check the control-plane log and re-run the seed (runbook §6).',
    );
  }
  return { keyId: minted.id, tenantActivated: minted.activated, seed: result, seedIncomplete };
}

/**
 * `rotate`: mint a replacement with the same tenant/type/scopes, mark the old key
 * rotated, and end its life now (`revoked_at`) or after a grace window (`expires_at`). A future
 * `revoked_at` is NOT used for the grace: every verifier treats any non-null `revoked_at` as dead.
 */
export async function rotateKey(
  store: IssuanceStore,
  io: Io,
  cmd: Extract<Command, { cmd: 'rotate' }>,
  now: () => Date = () => new Date(),
): Promise<{ newKeyId: string; oldKeyId: string; oldEndsAt: Date }> {
  const minted = await store.transaction(async (tx) => {
    const at = now();
    const old = await tx.lockKey(cmd.keyId);
    if (!old) throw new OperatorError(`no api_keys row with id=${cmd.keyId}.`);
    if (old.revokedAt !== null) throw new OperatorError(`key ${old.id} is already revoked.`);
    if (old.expiresAt !== null && old.expiresAt.getTime() <= at.getTime()) {
      throw new OperatorError(`key ${old.id} already expired; issue a new key instead.`);
    }
    if (old.type !== 'public' && old.type !== 'secret') {
      throw new OperatorError(`key ${old.id} has unknown type "${old.type}".`);
    }
    const tenant = await tx.lockTenant(old.tenantId);
    if (!tenant || tenant.deletedAt !== null) {
      throw new OperatorError(`the tenant of key ${old.id} is missing or soft-deleted.`);
    }
    const type: KeyType = old.type;

    const rawKey = generateRawKey(type);
    const hmacSecret = type === 'secret' ? generateHmacSecret() : undefined;
    const { id } = await tx.insertKey({
      tenantId: old.tenantId,
      type,
      prefix: type === 'public' ? PUBLIC_KEY_PREFIX : SERVER_KEY_PREFIX,
      hashedKey: hashApiKey(rawKey),
      last4: rawKey.slice(-4),
      scopes: old.scopes,
    });
    const graceEnd = new Date(at.getTime() + cmd.graceHours * 3_600_000);
    if (cmd.graceHours === 0) {
      await tx.updateKey(old.id, { rotatedAt: at, revokedAt: at, revokeReason: `rotated → ${id}` });
    } else {
      const endsAt =
        old.expiresAt !== null && old.expiresAt.getTime() < graceEnd.getTime()
          ? old.expiresAt
          : graceEnd;
      await tx.updateKey(old.id, { rotatedAt: at, expiresAt: endsAt });
    }
    const record = buildKvRecord({
      tenantId: old.tenantId,
      scopes: old.scopes,
      label: cmd.label ?? `rotation of ${old.id}`,
      ...(hmacSecret !== undefined ? { hmacSecret } : {}),
    });
    return {
      id,
      oldId: old.id,
      tenantId: old.tenantId,
      type,
      rawKey,
      record,
      endsAt: cmd.graceHours === 0 ? at : graceEnd,
    };
  });

  io.log(
    `${LOG} rotated ${minted.oldId} → ${minted.id}; old key ` +
      (cmd.graceHours === 0
        ? 'revoked now'
        : `stays valid in Postgres until ${minted.endsAt.toISOString()} (expires_at)`) +
      '. Delete its KV_API_KEYS entry when the grace ends (runbook §5).',
  );
  io.secret(
    secretBlock({
      title:
        minted.type === 'public'
          ? 'ROTATED PUBLIC API KEY'
          : 'ROTATED SERVER API KEY + HMAC SECRET',
      keyId: minted.id,
      tenantId: minted.tenantId,
      type: minted.type,
      rawKey: minted.rawKey,
      record: minted.record,
    }),
  );
  return { newKeyId: minted.id, oldKeyId: minted.oldId, oldEndsAt: minted.endsAt };
}

/** `revoke`: set `revoked_at` now. Idempotent on an already-revoked key. */
export async function revokeKey(
  store: IssuanceStore,
  io: Io,
  cmd: Extract<Command, { cmd: 'revoke' }>,
  now: () => Date = () => new Date(),
): Promise<{ alreadyRevoked: boolean }> {
  const outcome = await store.transaction(async (tx) => {
    const key = await tx.lockKey(cmd.keyId);
    if (!key) throw new OperatorError(`no api_keys row with id=${cmd.keyId}.`);
    if (key.revokedAt !== null) return { alreadyRevoked: true, key };
    await tx.updateKey(key.id, { revokedAt: now(), revokeReason: cmd.reason });
    return { alreadyRevoked: false, key };
  });
  io.log(
    outcome.alreadyRevoked
      ? `${LOG} key ${outcome.key.id} was already revoked at ${outcome.key.revokedAt!.toISOString()}; nothing changed.`
      : `${LOG} revoked key ${outcome.key.id} (${outcome.key.prefix}…${outcome.key.last4}). ` +
          'Postgres verifiers reject it now; ingest rejects it only once its KV_API_KEYS entry is deleted (runbook §5).',
  );
  return { alreadyRevoked: outcome.alreadyRevoked };
}

/** `list`: one line per key. Never prints a hash. */
export async function listKeys(
  store: IssuanceStore,
  io: Io,
  cmd: Extract<Command, { cmd: 'list' }>,
): Promise<number> {
  const rows = await store.listKeys(cmd.tenantId);
  if (rows.length === 0) io.log(`${LOG} tenant ${cmd.tenantId} has no api keys.`);
  const iso = (d: Date | null): string => (d === null ? '-' : d.toISOString());
  for (const k of rows) {
    io.log(
      `${k.id}  ${k.type.padEnd(6)}  ${k.prefix}…${k.last4}  scopes=[${k.scopes.join(',')}]  ` +
        `created=${iso(k.createdAt)}  expires=${iso(k.expiresAt)}  rotated=${iso(k.rotatedAt)}  ` +
        `revoked=${iso(k.revokedAt)}${k.revokeReason ? ` (${k.revokeReason})` : ''}`,
    );
  }
  return rows.length;
}

// ─── Drizzle store ───────────────────────────────────────────────────────────

type AdminDb = ReturnType<typeof createAdminClient>;
type Tx = Parameters<Parameters<AdminDb['transaction']>[0]>[0];

const KEY_COLUMNS = {
  id: apiKeys.id,
  tenantId: apiKeys.tenantId,
  type: apiKeys.type,
  prefix: apiKeys.prefix,
  last4: apiKeys.last4,
  scopes: apiKeys.scopes,
  createdAt: apiKeys.createdAt,
  expiresAt: apiKeys.expiresAt,
  rotatedAt: apiKeys.rotatedAt,
  revokedAt: apiKeys.revokedAt,
  revokeReason: apiKeys.revokeReason,
};

function drizzleTx(tx: Tx): IssuanceTx {
  return {
    async lockTenant(tenantId) {
      const rows = await tx
        .select({
          id: tenants.id,
          name: tenants.name,
          status: tenants.status,
          deletedAt: tenants.deletedAt,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .for('update');
      return rows[0] ?? null;
    },
    async activateIfPending(tenantId) {
      const rows = await tx
        .update(tenants)
        .set({ status: 'active', updatedAt: new Date() })
        .where(and(eq(tenants.id, tenantId), eq(tenants.status, 'pending')))
        .returning({ id: tenants.id });
      return rows.length > 0;
    },
    async liveKeys(tenantId, type, now) {
      return tx
        .select(KEY_COLUMNS)
        .from(apiKeys)
        .where(
          and(
            eq(apiKeys.tenantId, tenantId),
            eq(apiKeys.type, type),
            isNull(apiKeys.revokedAt),
            or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now)),
          ),
        )
        .orderBy(desc(apiKeys.createdAt));
    },
    async lockKey(keyId) {
      const rows = await tx
        .select(KEY_COLUMNS)
        .from(apiKeys)
        .where(eq(apiKeys.id, keyId))
        .for('update');
      return rows[0] ?? null;
    },
    async insertKey(row) {
      const rows = await tx.insert(apiKeys).values(row).returning({ id: apiKeys.id });
      const inserted = rows[0];
      if (!inserted) throw new Error('api_keys insert returned no row');
      return inserted;
    },
    async updateKey(keyId, patch) {
      await tx.update(apiKeys).set(patch).where(eq(apiKeys.id, keyId));
    },
  };
}

function drizzleStore(db: AdminDb): IssuanceStore {
  return {
    transaction: (fn) => db.transaction((tx) => fn(drizzleTx(tx))),
    listKeys: (tenantId) =>
      db
        .select(KEY_COLUMNS)
        .from(apiKeys)
        .where(eq(apiKeys.tenantId, tenantId))
        .orderBy(desc(apiKeys.createdAt)),
    async latestSiteSchema(tenantId) {
      const rows = await db
        .select({ schema: tenantSiteSchemas.schema })
        .from(tenantSiteSchemas)
        .where(eq(tenantSiteSchemas.tenantId, tenantId))
        .orderBy(desc(tenantSiteSchemas.updatedAt))
        .limit(1);
      return (rows[0]?.schema as TenantSiteSchema | undefined) ?? null;
    },
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

const USAGE =
  'usage: pnpm issue-api-key <issue|rotate|revoke|list> …  (see docs/runbooks/API_KEY_ISSUANCE.md)\n' +
  '  issue  --tenant <uuid> --label <text> [--scopes a:b,…] [--server] [--additional]\n' +
  '  rotate --key-id <uuid> [--label <text>] [--grace-hours 0..720]\n' +
  '  revoke --key-id <uuid> [--reason <text>]\n' +
  '  list   --tenant <uuid>\n' +
  '  global: --confirm-production (required for a non-loopback database)';

async function main(): Promise<number> {
  const io: Io = {
    log: (line) => console.error(line),
    secret: (block) => {
      process.stdout.write(block);
    },
  };
  const parsed = parseArgs(process.argv.slice(2));
  if ('error' in parsed) {
    io.log(`${LOG} ERROR: ${parsed.error}\n${USAGE}`);
    return 1;
  }

  let target: { host: string; port: string };
  try {
    target = describeAdminDatabase();
  } catch (err) {
    io.log(`${LOG} ERROR: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  const guard = checkTarget(target, parsed.confirmProduction);
  if (!guard.ok) {
    io.log(`${LOG} ${guard.reason}`);
    return 1;
  }
  io.log(`${LOG} ${guard.line}`);

  const db = createAdminClient();
  const store = drizzleStore(db);
  try {
    switch (parsed.cmd) {
      case 'issue': {
        const outcome = await issueKey(
          store,
          io,
          parsed,
          seedLib.seedListingEmbeddingsForActivation,
        );
        return outcome.seedIncomplete ? 2 : 0;
      }
      case 'rotate':
        await rotateKey(store, io, parsed);
        return 0;
      case 'revoke':
        await revokeKey(store, io, parsed);
        return 0;
      case 'list':
        await listKeys(store, io, parsed);
        return 0;
    }
  } catch (err) {
    if (err instanceof OperatorError) {
      io.log(`${LOG} REFUSED (nothing written): ${err.message}`);
      return 1;
    }
    throw err;
  } finally {
    // Close the pool or the process never exits (FOLLOW-818, same as seed-local-tenant.mts).
    await db.$client.end({ timeout: 5 });
  }
}

// ─── Entrypoint guard ────────────────────────────────────────────────────────

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /issue-tenant-api-key\.(mts|ts|js|mjs)$/.test(process.argv[1]);

if (isMain) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      // A driver error message never carries key material: the raw key is not passed to any query.
      console.error(`${LOG} Fatal error:`, err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
