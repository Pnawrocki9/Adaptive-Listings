/**
 * Tests for scripts/issue-tenant-api-key.mts (FOLLOW-1327) — the operator replacement for the API
 * key issuance that `POST /api/schema/activate` performs today.
 *
 * Harness: like project-allowed-origins.test.ts, the script's exports are imported directly (the
 * `isMain` guard keeps `main()` and its DB connection from running). The flows take a persistence
 * port, so they run here against an in-memory store with real transaction semantics (a throw
 * discards every write) — the Drizzle adapter is the script's own thin `drizzleStore`.
 *
 * Contract anchors, not re-derivations:
 *   - the hash is pinned against `sha256Hex` (the production verify path) and against
 *     `seed-local-tenant.mts`'s precomputed `HASHED_API_KEY`;
 *   - the printed KV record is fed to the ingest Worker's real `authenticateRequest`, including a
 *     signed request over the FOLLOW-1203 contract for `--server` keys.
 *
 * No key-shaped literals: every key, secret and digest here is generated or computed at run time.
 *
 * @module apps/control-plane/scripts/__tests__/issue-tenant-api-key.test
 */

import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ApiKeyRecord, TenantSiteSchema } from '@estalara/shared';
import { sha256Hex } from '@/lib/api-key-auth';
import type { SeedListingsResult } from '@/lib/seed-listing-embeddings';
import { authenticateRequest } from '../../../ingest/src/auth';
import { HASHED_API_KEY, RAW_API_KEY } from '../seed-local-tenant.mts';
import {
  DEFAULT_SCOPES,
  OperatorError,
  checkTarget,
  generateRawKey,
  hashApiKey,
  issueKey,
  listKeys,
  parseArgs,
  revokeKey,
  rotateKey,
  type Command,
  type IssuanceStore,
  type IssuanceTx,
  type Io,
  type KeyRow,
  type TenantRow,
} from '../issue-tenant-api-key.mts';

// ─── In-memory store ─────────────────────────────────────────────────────────

interface StoredKey extends KeyRow {
  hashedKey: string;
}

interface State {
  tenants: Map<string, TenantRow>;
  keys: StoredKey[];
  schemas: Map<string, TenantSiteSchema>;
}

function clone(state: State): State {
  return {
    tenants: new Map([...state.tenants].map(([k, v]) => [k, { ...v }])),
    keys: state.keys.map((k) => ({ ...k })),
    schemas: new Map(state.schemas),
  };
}

function isLive(k: StoredKey, now: Date): boolean {
  return k.revokedAt === null && (k.expiresAt === null || k.expiresAt.getTime() > now.getTime());
}

function makeStore(initial: State): {
  store: IssuanceStore;
  state: () => State;
  commits: () => number;
} {
  let state = initial;
  let commits = 0;
  const strip = ({ hashedKey: _h, ...rest }: StoredKey): KeyRow => rest;
  const store: IssuanceStore = {
    async transaction(fn) {
      const draft = clone(state);
      const tx: IssuanceTx = {
        lockTenant: async (id) => {
          const t = draft.tenants.get(id);
          return t ? { ...t } : null;
        },
        activateIfPending: async (id) => {
          const t = draft.tenants.get(id);
          if (!t || t.status !== 'pending') return false;
          t.status = 'active';
          return true;
        },
        liveKeys: async (tenantId, type, now) =>
          draft.keys
            .filter((k) => k.tenantId === tenantId && k.type === type && isLive(k, now))
            .map(strip),
        lockKey: async (id) => {
          const k = draft.keys.find((x) => x.id === id);
          return k ? strip(k) : null;
        },
        insertKey: async (row) => {
          if (draft.keys.some((k) => k.hashedKey === row.hashedKey)) {
            throw new Error('unique violation');
          }
          const id = randomUUID();
          draft.keys.push({
            ...row,
            id,
            createdAt: new Date(),
            expiresAt: null,
            rotatedAt: null,
            revokedAt: null,
            revokeReason: null,
          });
          return { id };
        },
        updateKey: async (id, patch) => {
          const k = draft.keys.find((x) => x.id === id);
          if (k) Object.assign(k, patch);
        },
      };
      const out = await fn(tx); // a throw leaves `state` untouched = rollback
      state = draft;
      commits++;
      return out;
    },
    listKeys: async (tenantId) => state.keys.filter((k) => k.tenantId === tenantId).map(strip),
    latestSiteSchema: async (tenantId) => state.schemas.get(tenantId) ?? null,
  };
  return { store, state: () => state, commits: () => commits };
}

const TENANT = randomUUID();

function tenant(overrides: Partial<TenantRow> = {}): TenantRow {
  return {
    id: TENANT,
    name: 'Estalara',
    status: 'pending',
    deletedAt: null,
    allowedOrigins: ['https://estalara.example'],
    ...overrides,
  };
}

function freshState(t: TenantRow = tenant()): State {
  return { tenants: new Map([[t.id, t]]), keys: [], schemas: new Map() };
}

function captureIo(): Io & { logs: string[]; secrets: string[] } {
  const logs: string[] = [];
  const secrets: string[] = [];
  return { logs, secrets, log: (l) => logs.push(l), secret: (b) => secrets.push(b) };
}

const seedOk = (): ReturnType<typeof vi.fn> =>
  vi.fn(
    async (tenantId: string): Promise<SeedListingsResult> => ({
      tenant_id: tenantId,
      attempted: 1,
      succeeded: 1,
      failed: 0,
      overflow_count: 0,
    }),
  );

function issueCmd(overrides: Partial<Extract<Command, { cmd: 'issue' }>> = {}) {
  return {
    cmd: 'issue' as const,
    tenantId: TENANT,
    label: 'Estalara web',
    scopes: null,
    server: false,
    allowedOrigins: null,
    onEmpty: 'refuse' as const,
    additional: false,
    confirmProduction: false,
    ...overrides,
  };
}

/** Pull the raw key and the KV record back out of the one-time stdout block. */
function readSecretBlock(block: string): { rawKey: string; record: ApiKeyRecord } {
  const rawKey = /^raw api key: (\S+)$/m.exec(block)?.[1];
  const recordLine = block.split('\n').find((l) => l.startsWith('{'));
  if (!rawKey || !recordLine) throw new Error('secret block missing key or record');
  expect(block).toContain(`api_key:${rawKey}`);
  return { rawKey, record: JSON.parse(recordLine) as ApiKeyRecord };
}

function fakeKv(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return {
    get: async (k: string) => map.get(k) ?? null,
    put: async (k: string, v: string) => {
      map.set(k, v);
    },
  } as never;
}

// ─── Hash parity (the reason this script can replace the route) ────────────────

describe('hashApiKey — byte-identical to the route / seed / verify path', () => {
  it('matches seed-local-tenant.mts HASHED_API_KEY for its RAW_API_KEY (precomputed vector)', () => {
    expect(hashApiKey(RAW_API_KEY)).toBe(HASHED_API_KEY);
  });

  it('matches sha256Hex (api-key-auth verify path, Web Crypto) for generated keys', async () => {
    for (const raw of [generateRawKey('public'), generateRawKey('secret'), 'zażółć-ключ']) {
      expect(hashApiKey(raw)).toBe(await sha256Hex(raw));
    }
  });

  it('is lower-case hex of SHA-256 length', () => {
    expect(hashApiKey('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('generateRawKey', () => {
  it('uses the route prefix for public keys and a distinct one for server keys', () => {
    expect(generateRawKey('public')).toMatch(/^est_pub_[0-9a-f]{32}$/);
    expect(generateRawKey('secret')).toMatch(/^est_srv_[0-9a-f]{32}$/);
  });

  it('is not repeatable', () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateRawKey('public')));
    expect(keys.size).toBe(50);
  });
});

// ─── Argument parsing + target guard ─────────────────────────────────────────

describe('parseArgs', () => {
  it('parses issue with defaults', () => {
    expect(parseArgs(['issue', '--tenant', TENANT, '--label', 'web'])).toMatchObject({
      cmd: 'issue',
      tenantId: TENANT,
      label: 'web',
      scopes: null,
      server: false,
      onEmpty: 'refuse',
      additional: false,
      confirmProduction: false,
    });
  });

  it('canonicalises --allowed-origins and rejects a non-origin', () => {
    expect(
      parseArgs([
        'issue',
        '--tenant',
        TENANT,
        '--label',
        'w',
        '--allowed-origins=https://A.example/x',
      ]),
    ).toMatchObject({ allowedOrigins: ['https://a.example'] });
    expect(
      parseArgs(['issue', '--tenant', TENANT, '--label', 'w', '--allowed-origins', 'a.example']),
    ).toHaveProperty('error');
  });

  it('refuses missing/invalid required flags, unknown flags and cross-command flags', () => {
    expect(parseArgs(['issue', '--tenant', TENANT])).toHaveProperty('error');
    expect(parseArgs(['issue', '--tenant', 'not-a-uuid', '--label', 'x'])).toHaveProperty('error');
    expect(parseArgs(['issue', '--tenant', TENANT, '--label', 'x', '--nope', '1'])).toHaveProperty(
      'error',
    );
    expect(parseArgs(['revoke', '--key-id', TENANT, '--server'])).toHaveProperty('error');
    expect(
      parseArgs(['issue', '--tenant', TENANT, '--label', 'x', '--scopes', 'bad']),
    ).toHaveProperty('error');
    expect(parseArgs(['rotate', '--key-id', TENANT, '--grace-hours', '9999'])).toHaveProperty(
      'error',
    );
    expect(parseArgs(['frobnicate'])).toHaveProperty('error');
  });

  it('refuses --allowed-origins on a --server key', () => {
    expect(
      parseArgs([
        'issue',
        '--tenant',
        TENANT,
        '--label',
        'x',
        '--server',
        '--allowed-origins',
        'https://a.example',
      ]),
    ).toHaveProperty('error');
  });
});

describe('checkTarget', () => {
  it('allows loopback without confirmation', () => {
    expect(checkTarget({ host: '127.0.0.1', port: '5433' }, false)).toMatchObject({ ok: true });
  });

  it('refuses a remote host without --confirm-production and names only host:port', () => {
    const r = checkTarget({ host: 'db.example.supabase.co', port: '6543' }, false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('db.example.supabase.co:6543');
    expect(checkTarget({ host: 'db.example.supabase.co', port: '6543' }, true).ok).toBe(true);
  });
});

// ─── issue ───────────────────────────────────────────────────────────────────

describe('issueKey', () => {
  it('stores only the hash, default scopes, prints the key once, and the KV record passes ingest auth', async () => {
    const { store, state } = makeStore(freshState());
    const io = captureIo();
    const out = await issueKey(store, io, issueCmd(), seedOk());

    expect(io.secrets).toHaveLength(1);
    const { rawKey, record } = readSecretBlock(io.secrets[0]!);
    const row = state().keys[0]!;
    expect(row).toMatchObject({
      id: out.keyId,
      tenantId: TENANT,
      type: 'public',
      prefix: 'est_pub_',
      last4: rawKey.slice(-4),
      scopes: [...DEFAULT_SCOPES.public],
      hashedKey: hashApiKey(rawKey),
    });
    expect(JSON.stringify(state())).not.toContain(rawKey);

    expect(record).toEqual({
      tenant_id: TENANT,
      scopes: ['read:events', 'write:events'],
      label: 'Estalara web',
      allowed_origins: ['https://estalara.example'],
    });
    const auth = await authenticateRequest(
      {
        apiKey: rawKey,
        signatureHeader: null,
        timestampHeader: null,
        nonceHeader: null,
        body: '{}',
      },
      { kv: fakeKv({ [`api_key:${rawKey}`]: JSON.stringify(record) }), replayKv: fakeKv({}) },
    );
    expect(auth).toMatchObject({
      ok: true,
      tenant_id: TENANT,
      signed: false,
      allowed_origins: ['https://estalara.example'],
    });
  });

  it('--server mints an hmac_secret whose KV record verifies a signed request (FOLLOW-1203 contract)', async () => {
    const { store, state } = makeStore(freshState());
    const io = captureIo();
    await issueKey(store, io, issueCmd({ server: true }), seedOk());
    const { rawKey, record } = readSecretBlock(io.secrets[0]!);

    expect(rawKey).toMatch(/^est_srv_/);
    expect(record.hmac_secret).toMatch(/^[0-9a-f]{64}$/);
    expect(record.allowed_origins).toEqual([]);
    expect(record.scopes).toEqual(['write:events']);
    expect(state().keys[0]).toMatchObject({ type: 'secret', prefix: 'est_srv_' });
    expect(JSON.stringify(state())).not.toContain(record.hmac_secret!);

    const body = JSON.stringify({ events: [] });
    const ts = String(Date.now());
    const nonce = randomBytes(12).toString('hex');
    const sig = createHmac('sha256', Buffer.from(record.hmac_secret!, 'hex'))
      .update(`${ts}\n${nonce}\n${body}`)
      .digest('hex');
    const auth = await authenticateRequest(
      {
        apiKey: rawKey,
        signatureHeader: `hmac-sha256:${sig}`,
        timestampHeader: ts,
        nonceHeader: nonce,
        body,
      },
      { kv: fakeKv({ [`api_key:${rawKey}`]: JSON.stringify(record) }), replayKv: fakeKv({}) },
    );
    expect(auth).toMatchObject({ ok: true, tenant_id: TENANT, signed: true });
  });

  it('promotes pending → active exactly once; a second key needs --additional', async () => {
    const { store, state } = makeStore(freshState());
    const first = await issueKey(store, captureIo(), issueCmd(), seedOk());
    expect(first.tenantActivated).toBe(true);
    expect(state().tenants.get(TENANT)!.status).toBe('active');

    await expect(issueKey(store, captureIo(), issueCmd(), seedOk())).rejects.toThrow(
      /already has 1 live public key/,
    );
    expect(state().keys).toHaveLength(1);

    const second = await issueKey(store, captureIo(), issueCmd({ additional: true }), seedOk());
    expect(second.tenantActivated).toBe(false);
    expect(state().keys).toHaveLength(2);

    // A server key is a different type: no refusal, no second status flip.
    const srv = await issueKey(store, captureIo(), issueCmd({ server: true }), seedOk());
    expect(srv.tenantActivated).toBe(false);
  });

  it('refuses the PG `[]` origin trap before writing anything (no status flip, no key)', async () => {
    const { store, state, commits } = makeStore(freshState(tenant({ allowedOrigins: [] })));
    await expect(issueKey(store, captureIo(), issueCmd(), seedOk())).rejects.toBeInstanceOf(
      OperatorError,
    );
    expect(commits()).toBe(0);
    expect(state().keys).toHaveLength(0);
    expect(state().tenants.get(TENANT)!.status).toBe('pending');
  });

  it('--allowed-origins sets the per-key PG column and the KV list', async () => {
    const { store, state } = makeStore(freshState(tenant({ allowedOrigins: [] })));
    const io = captureIo();
    await issueKey(store, io, issueCmd({ allowedOrigins: ['http://localhost:5173'] }), seedOk());
    expect(state().keys[0]!.allowedOrigins).toEqual(['http://localhost:5173']);
    expect(readSecretBlock(io.secrets[0]!).record.allowed_origins).toEqual([
      'http://localhost:5173',
    ]);
  });

  it('refuses soft-deleted, suspended and unknown tenants', async () => {
    for (const t of [tenant({ deletedAt: new Date() }), tenant({ status: 'suspended' })]) {
      const { store, commits } = makeStore(freshState(t));
      await expect(issueKey(store, captureIo(), issueCmd(), seedOk())).rejects.toBeInstanceOf(
        OperatorError,
      );
      expect(commits()).toBe(0);
    }
    const { store } = makeStore(freshState());
    await expect(
      issueKey(store, captureIo(), issueCmd({ tenantId: randomUUID() }), seedOk()),
    ).rejects.toThrow(/no tenant row/);
  });

  it('runs the activation embedding seed after commit with the latest stored schema', async () => {
    const schema = { domain: 'estalara.example' } as unknown as TenantSiteSchema;
    const s = freshState();
    s.schemas.set(TENANT, schema);
    const { store } = makeStore(s);
    const seed = seedOk();
    const out = await issueKey(store, captureIo(), issueCmd(), seed);
    expect(seed).toHaveBeenCalledTimes(1);
    expect(seed).toHaveBeenCalledWith(TENANT, schema);
    expect(out.seedIncomplete).toBe(false);

    const { store: noSchema } = makeStore(freshState());
    const seed2 = seedOk();
    await issueKey(noSchema, captureIo(), issueCmd(), seed2);
    expect(seed2).toHaveBeenCalledWith(TENANT, null);
  });

  it('reports a failed or throwing seed as incomplete without un-issuing the key', async () => {
    const failing = vi.fn(async (tenantId: string) => ({
      tenant_id: tenantId,
      attempted: 2,
      succeeded: 1,
      failed: 1,
      overflow_count: 0,
    }));
    const a = makeStore(freshState());
    expect((await issueKey(a.store, captureIo(), issueCmd(), failing)).seedIncomplete).toBe(true);
    expect(a.state().keys).toHaveLength(1);

    // First-time failures land in overflow_count (handed to the requeue route), not `failed`.
    const handedOff = vi.fn(async (tenantId: string) => ({
      tenant_id: tenantId,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      overflow_count: 13,
    }));
    const d = makeStore(freshState());
    expect((await issueKey(d.store, captureIo(), issueCmd(), handedOff)).seedIncomplete).toBe(true);

    const throwing = vi.fn(async () => {
      throw new Error('boom');
    });
    const b = makeStore(freshState());
    expect((await issueKey(b.store, captureIo(), issueCmd(), throwing)).seedIncomplete).toBe(true);

    const skipped = vi.fn(async (tenantId: string) => ({
      tenant_id: tenantId,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      overflow_count: 0,
      skipped_reason: 'INTERNAL_API_SECRET not configured',
    }));
    const c = makeStore(freshState());
    const io = captureIo();
    expect((await issueKey(c.store, io, issueCmd(), skipped)).seedIncomplete).toBe(false);
    expect(io.logs.join('\n')).toMatch(/embedding seed skipped/);
  });
});

// ─── rotate / revoke / list ──────────────────────────────────────────────────

describe('rotateKey', () => {
  it('grace 0: new live key with the same scopes/origins, old key rotated + revoked', async () => {
    const { store, state } = makeStore(freshState());
    const issued = await issueKey(
      store,
      captureIo(),
      issueCmd({ scopes: ['write:events'] }),
      seedOk(),
    );
    const io = captureIo();
    const r = await rotateKey(store, io, {
      cmd: 'rotate',
      keyId: issued.keyId,
      label: null,
      graceHours: 0,
      confirmProduction: false,
    });
    const old = state().keys.find((k) => k.id === issued.keyId)!;
    const neu = state().keys.find((k) => k.id === r.newKeyId)!;
    expect(old.revokedAt).not.toBeNull();
    expect(old.rotatedAt).not.toBeNull();
    expect(old.revokeReason).toContain(r.newKeyId);
    expect(neu).toMatchObject({ revokedAt: null, scopes: ['write:events'], type: 'public' });
    const { rawKey } = readSecretBlock(io.secrets[0]!);
    expect(neu.hashedKey).toBe(hashApiKey(rawKey));
  });

  it('grace N: old key stays unrevoked but expires after N hours', async () => {
    const { store, state } = makeStore(freshState());
    const issued = await issueKey(store, captureIo(), issueCmd({ server: true }), seedOk());
    const now = new Date('2026-10-18T12:00:00Z');
    const io = captureIo();
    await rotateKey(
      store,
      io,
      {
        cmd: 'rotate',
        keyId: issued.keyId,
        label: 'srv',
        graceHours: 24,
        confirmProduction: false,
      },
      () => now,
    );
    const old = state().keys.find((k) => k.id === issued.keyId)!;
    expect(old.revokedAt).toBeNull();
    expect(old.expiresAt?.toISOString()).toBe('2026-10-19T12:00:00.000Z');
    // A rotated server key gets a NEW hmac_secret.
    expect(readSecretBlock(io.secrets[0]!).record.hmac_secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses an already-revoked key', async () => {
    const { store } = makeStore(freshState());
    const issued = await issueKey(store, captureIo(), issueCmd(), seedOk());
    await revokeKey(store, captureIo(), {
      cmd: 'revoke',
      keyId: issued.keyId,
      reason: 'test',
      confirmProduction: false,
    });
    await expect(
      rotateKey(store, captureIo(), {
        cmd: 'rotate',
        keyId: issued.keyId,
        label: null,
        graceHours: 0,
        confirmProduction: false,
      }),
    ).rejects.toThrow(/already revoked/);
  });
});

describe('revokeKey', () => {
  it('sets revoked_at with the reason and is idempotent', async () => {
    const { store, state } = makeStore(freshState());
    const issued = await issueKey(store, captureIo(), issueCmd(), seedOk());
    const cmd = {
      cmd: 'revoke' as const,
      keyId: issued.keyId,
      reason: 'leaked',
      confirmProduction: false,
    };
    expect(await revokeKey(store, captureIo(), cmd)).toEqual({ alreadyRevoked: false });
    expect(state().keys[0]).toMatchObject({ revokeReason: 'leaked' });
    expect(state().keys[0]!.revokedAt).not.toBeNull();
    expect(await revokeKey(store, captureIo(), cmd)).toEqual({ alreadyRevoked: true });
  });
});

describe('secret hygiene', () => {
  it('the raw key, hmac secret and hash never reach the log channel (issue, rotate, list)', async () => {
    const { store, state } = makeStore(freshState());
    const io = captureIo();
    const issued = await issueKey(store, io, issueCmd({ server: true }), seedOk());
    await rotateKey(store, io, {
      cmd: 'rotate',
      keyId: issued.keyId,
      label: null,
      graceHours: 1,
      confirmProduction: false,
    });
    expect(
      await listKeys(store, io, { cmd: 'list', tenantId: TENANT, confirmProduction: false }),
    ).toBe(2);

    expect(io.secrets).toHaveLength(2);
    const logs = io.logs.join('\n');
    for (const block of io.secrets) {
      const { rawKey, record } = readSecretBlock(block);
      expect(logs).not.toContain(rawKey);
      expect(logs).not.toContain(record.hmac_secret!);
    }
    for (const k of state().keys) expect(logs).not.toContain(k.hashedKey);
    expect(logs).toContain(issued.keyId);
  });
});
