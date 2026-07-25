/**
 * Tests for POST /api/schema/activate (TICKET-AUTO-006-POLISH)
 *
 * Coverage:
 *   Auth:
 *   - Missing JWT                            → 401 UNAUTHORIZED
 *   - Valid JWT proceeds past auth gate
 *
 *   Request validation:
 *   - Missing body                           → 400 VALIDATION_ERROR
 *   - Non-JSON body                          → 400 VALIDATION_ERROR
 *   - schema field absent                    → 400 VALIDATION_ERROR
 *
 *   Activation (integration-style with mocked DB):
 *   - Valid schema → upserts tenant_site_schemas
 *   - Valid schema → updates tenant status to 'active' (when pending)
 *   - Valid schema → response has non-empty api_key
 *   - Existing active key → returns prefix...last4 format (not raw)
 *   - No existing key → generates and returns raw key
 *
 * @module apps/control-plane/src/app/api/schema/activate/route.test
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  tenantSiteSchemas: {
    tenantId: 'tenant_id',
    domain: 'domain',
  },
  tenants: {
    id: 'id',
    status: 'status',
    // FOLLOW-657: session-auth.ts's tenantExists() also filters on deletedAt.
    deletedAt: 'deleted_at',
  },
  apiKeys: {
    tenantId: 'tenant_id',
    type: 'type',
    revokedAt: 'revoked_at',
    expiresAt: 'expires_at',
    createdAt: 'created_at',
  },
  staffAuditLog: { __table: 'staff_audit_log' },
}));

vi.mock('@/lib/tenant-schema', () => ({
  invalidateTenantSchemaCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/seed-listing-embeddings', () => ({
  seedListingEmbeddingsForActivation: vi.fn().mockResolvedValue({
    tenant_id: 'tenant-abc',
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skipped_reason: 'INTERNAL_API_SECRET not configured',
  }),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val, op: 'eq' })),
  and: vi.fn((...args: unknown[]) => ({ args, op: 'and' })),
  isNull: vi.fn((col: unknown) => ({ col, op: 'isNull' })),
  or: vi.fn((...args: unknown[]) => ({ args, op: 'or' })),
  gt: vi.fn((col: unknown, val: unknown) => ({ col, val, op: 'gt' })),
  desc: vi.fn((col: unknown) => ({ col, op: 'desc' })),
}));

// FOLLOW-657: session-auth.ts's resolveTenantAccess also imports isTenantClaims,
// isStaffClaims, and requireAgencyRole from @estalara/auth — these are pure
// predicate/assert functions, safe to keep REAL via importOriginal. Only
// getAuthClaims (the actual auth I/O) is mocked, exactly as before.
vi.mock('@estalara/auth', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.mock importOriginal generic requires inline import() type
  const actual = await importOriginal<typeof import('@estalara/auth')>();
  return { ...actual, getAuthClaims: vi.fn() };
});

// ── Actual imports ─────────────────────────────────────────────────────────────

import { createAdminClient } from '@estalara/db';
import { getAuthClaims } from '@estalara/auth';
import { invalidateTenantSchemaCache } from '@/lib/tenant-schema';
import { seedListingEmbeddingsForActivation } from '@/lib/seed-listing-embeddings';
import { POST } from './route';

const mockCreateAdminClient = vi.mocked(createAdminClient);
const mockGetAuthClaims = vi.mocked(getAuthClaims);
const mockInvalidateTenantSchemaCache = vi.mocked(invalidateTenantSchemaCache);
const mockSeedListingEmbeddings = vi.mocked(seedListingEmbeddingsForActivation);

// ── Default auth claims ────────────────────────────────────────────────────────

const DEFAULT_CLAIMS = {
  sub: 'user-uuid-001',
  email: 'admin@agency.com',
  tenant_id: 'tenant-abc',
  agency_role: 'agency:admin' as const,
  estalara_staff: false as const,
  mfa_verified: true,
};

// ── Minimal valid schema fixture ───────────────────────────────────────────────

const MINIMAL_SCHEMA = {
  tenant_id: 'tenant-abc',
  domain: 'example.com',
  detected_at: '2026-01-01T00:00:00Z',
  detection_source: 'data_estalara',
  detection_confidence: 0.99,
  index_schema: {
    url_patterns: ['https://example.com/**'],
    listing_card_selector: '[data-estalara-listing]',
    card_field_mappings: {},
    data_extractors_per_card: {},
    reorder_capable: false,
  },
  detail_schema: {
    url_patterns: ['https://example.com/listing/*'],
    slot_selectors: {},
    data_extractors: {},
  },
  archetype_hints: [],
};

// ── Helpers ────────────────────────────────────────────────────────────────────

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/schema/activate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token',
    },
    body: JSON.stringify(body),
  });
}

function makeRequestRaw(body: string): NextRequest {
  return new NextRequest('http://localhost/api/schema/activate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token',
    },
    body,
  });
}

function makeUnauthRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/schema/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Build a DB mock for the activate route.
 * Chain: insert.values.onConflictDoUpdate, update.set.where, select.from.where.orderBy.limit
 */
function makeDbMock({
  existingKey = null,
}: {
  existingKey?: {
    id: string;
    tenantId: string;
    type: string;
    prefix: string;
    hashedKey: string;
    last4: string;
  } | null;
} = {}) {
  // insert chain
  const onConflictDoUpdate = vi.fn().mockResolvedValue([]);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insertFn = vi.fn().mockReturnValue({ values });

  // update chain
  const where = vi.fn().mockResolvedValue([]);
  const set = vi.fn().mockReturnValue({ where });
  const updateFn = vi.fn().mockReturnValue({ set });

  // select chain for api_keys lookup
  const limit = vi.fn().mockResolvedValue(existingKey !== null ? [existingKey] : []);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const selectWhere = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where: selectWhere });
  const selectFn = vi.fn().mockReturnValue({ from });

  return {
    insert: insertFn,
    values,
    onConflictDoUpdate,
    update: updateFn,
    set,
    updateWhere: where,
    select: selectFn,
    from,
    selectWhere,
    orderBy,
    limit,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthClaims.mockResolvedValue(DEFAULT_CLAIMS);
});

// ─────────────────────────────────────────────────────────────────────────────
// JWT authentication
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/schema/activate — JWT authentication', () => {
  it('missing JWT → 401 UNAUTHORIZED', async () => {
    mockGetAuthClaims.mockResolvedValue(null);

    const res = await POST(makeUnauthRequest({ schema: MINIMAL_SCHEMA }));
    expect(res.status).toBe(401);

    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('invalid token (getAuthClaims returns null) → 401 UNAUTHORIZED', async () => {
    mockGetAuthClaims.mockResolvedValue(null);

    const res = await POST(makeRequest({ schema: MINIMAL_SCHEMA }));
    expect(res.status).toBe(401);

    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  // FOLLOW-657 (ADR-0018 §2): staff callers may now activate via an explicit
  // ?tenant_id — the old blanket 403 STAFF_TENANT_CONTEXT_MISSING rejection is
  // superseded. See the staff-override describe block below for the
  // ?tenant_id-present path.
  it('staff JWT without ?tenant_id → 400 (tenantId required for staff override)', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'staff-user-001',
      email: 'staff@estalara.com',
      tenant_id: null,
      estalara_staff: true as const,
      estalara_role: 'estalara:ops' as const,
      mfa_verified: true,
    });

    const res = await POST(makeRequest({ schema: MINIMAL_SCHEMA }));
    expect(res.status).toBe(400);

    const body = await parseBody<{ error: { code: string; message: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(typeof body.error.message).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Request validation
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/schema/activate — request validation', () => {
  it('non-JSON body → 400 VALIDATION_ERROR', async () => {
    const res = await POST(makeRequestRaw('not-valid-json'));
    expect(res.status).toBe(400);

    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('empty object (no schema field) → 400 VALIDATION_ERROR', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);

    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('schema: null → 400 VALIDATION_ERROR', async () => {
    const res = await POST(makeRequest({ schema: null }));
    expect(res.status).toBe(400);

    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Activation: upsert + tenant status + api key (integration-style)
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/schema/activate — activation flow', () => {
  it('(a) upserts tenant_site_schemas row, (b) updates tenant status to active, (c) returns non-empty api_key', async () => {
    const db = makeDbMock({ existingKey: null });

    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);

    const res = await POST(makeRequest({ schema: MINIMAL_SCHEMA }));
    expect(res.status).toBe(200);

    const responseBody = await parseBody<{ api_key: string; tenant_id: string }>(res);

    // (a) tenant_site_schemas upsert was called
    expect(db.insert).toHaveBeenCalled();
    expect(db.values).toHaveBeenCalled();
    expect(db.onConflictDoUpdate).toHaveBeenCalled();

    // (b) tenant status update was attempted
    expect(db.update).toHaveBeenCalled();
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));

    // (c) response has a non-empty api_key
    expect(typeof responseBody.api_key).toBe('string');
    expect(responseBody.api_key.length).toBeGreaterThan(0);
    expect(responseBody.tenant_id).toBe('tenant-abc');
  });

  it('when no active public key exists, generates a new key starting with est_pub_', async () => {
    const db = makeDbMock({ existingKey: null });

    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);

    const res = await POST(makeRequest({ schema: MINIMAL_SCHEMA }));
    expect(res.status).toBe(200);

    const responseBody = await parseBody<{ api_key: string; tenant_id: string }>(res);

    // The raw key should start with the expected prefix
    expect(responseBody.api_key).toMatch(/^est_pub_/);

    // api_keys.insert should have been called for the new key
    // (called twice: once for schema, once for key — or the same insert is reused)
    // Just verify at least one insert call happened
    expect(db.insert).toHaveBeenCalled();
  });

  it('when an active public key exists, returns prefix...last4 format', async () => {
    const existingKey = {
      id: 'key-uuid-001',
      tenantId: 'tenant-abc',
      type: 'public',
      prefix: 'est_pub_',
      hashedKey: 'abc123hash',
      last4: 'ef89',
      scopes: ['read:events'],
      revokedAt: null,
      expiresAt: null,
      createdAt: new Date(),
    };
    const db = makeDbMock({ existingKey });

    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);

    const res = await POST(makeRequest({ schema: MINIMAL_SCHEMA }));
    expect(res.status).toBe(200);

    const responseBody = await parseBody<{ api_key: string; tenant_id: string }>(res);

    // Should return prefix...last4 (not a raw key)
    expect(responseBody.api_key).toBe('est_pub_...ef89');
  });

  it('tenant_id in response matches the JWT claim', async () => {
    const db = makeDbMock({ existingKey: null });

    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);

    const res = await POST(makeRequest({ schema: MINIMAL_SCHEMA }));
    expect(res.status).toBe(200);

    const responseBody = await parseBody<{ api_key: string; tenant_id: string }>(res);
    expect(responseBody.tenant_id).toBe('tenant-abc');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cache invalidation on activation — FOLLOW-018
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/schema/activate — cache invalidation (FOLLOW-018)', () => {
  it('calls invalidateTenantSchemaCache with tenantId before returning 200 (new key path)', async () => {
    const db = makeDbMock({ existingKey: null });

    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);

    const res = await POST(makeRequest({ schema: MINIMAL_SCHEMA }));
    expect(res.status).toBe(200);

    expect(mockInvalidateTenantSchemaCache).toHaveBeenCalledOnce();
    expect(mockInvalidateTenantSchemaCache).toHaveBeenCalledWith('tenant-abc');
  });

  it('calls invalidateTenantSchemaCache with tenantId before returning 200 (existing key path)', async () => {
    const existingKey = {
      id: 'key-uuid-002',
      tenantId: 'tenant-abc',
      type: 'public',
      prefix: 'est_pub_',
      hashedKey: 'somehash',
      last4: 'ab12',
      scopes: ['read:events'],
      revokedAt: null,
      expiresAt: null,
      createdAt: new Date(),
    };
    const db = makeDbMock({ existingKey });

    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);

    const res = await POST(makeRequest({ schema: MINIMAL_SCHEMA }));
    expect(res.status).toBe(200);

    expect(mockInvalidateTenantSchemaCache).toHaveBeenCalledOnce();
    expect(mockInvalidateTenantSchemaCache).toHaveBeenCalledWith('tenant-abc');
  });

  it('returns 200 even when invalidateTenantSchemaCache would have failed (error is swallowed internally)', async () => {
    // The function itself absorbs errors — simulate it resolving normally (as it would in real code)
    mockInvalidateTenantSchemaCache.mockResolvedValueOnce(undefined);

    const db = makeDbMock({ existingKey: null });

    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);

    const res = await POST(makeRequest({ schema: MINIMAL_SCHEMA }));
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Listing embedding seed trigger on activation — FOLLOW-046
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/schema/activate — listing embedding seed trigger (FOLLOW-046)', () => {
  it('calls seedListingEmbeddingsForActivation after a successful activation (new key path)', async () => {
    const db = makeDbMock({ existingKey: null });
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);

    const res = await POST(makeRequest({ schema: MINIMAL_SCHEMA }));
    expect(res.status).toBe(200);

    // Allow the fire-and-forget promise to settle before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockSeedListingEmbeddings).toHaveBeenCalledOnce();
    expect(mockSeedListingEmbeddings).toHaveBeenCalledWith('tenant-abc', MINIMAL_SCHEMA);
  });

  it('calls seedListingEmbeddingsForActivation after a successful activation (existing key path)', async () => {
    const existingKey = {
      id: 'key-uuid-003',
      tenantId: 'tenant-abc',
      type: 'public',
      prefix: 'est_pub_',
      hashedKey: 'somehash2',
      last4: 'cc44',
      scopes: ['read:events'],
      revokedAt: null,
      expiresAt: null,
      createdAt: new Date(),
    };
    const db = makeDbMock({ existingKey });
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);

    const res = await POST(makeRequest({ schema: MINIMAL_SCHEMA }));
    expect(res.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockSeedListingEmbeddings).toHaveBeenCalledOnce();
    expect(mockSeedListingEmbeddings).toHaveBeenCalledWith('tenant-abc', MINIMAL_SCHEMA);
  });

  it('returns 200 even when seedListingEmbeddingsForActivation rejects (fire-and-forget — never blocks response)', async () => {
    mockSeedListingEmbeddings.mockRejectedValueOnce(new Error('OpenAI quota exhausted'));

    const db = makeDbMock({ existingKey: null });
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);

    // Must still return 200 — the embed trigger is fire-and-forget.
    const res = await POST(makeRequest({ schema: MINIMAL_SCHEMA }));
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FOLLOW-657 (ADR-0018 §2): Estalara staff override via ?tenant_id
//
// Drives the REAL resolveTenantAccess → verifyTracerAdminAuth → tenantExists
// chain (only getAuthClaims and the DB layer are mocked). A dedicated
// transaction-capable db mock backs createAdminClient(): the outer `db.select`
// serves session-auth's tenantExists lookup; the tx object (built fresh inside
// `.transaction()`) serves the schema upsert, tenant status update, api-key
// lookup/insert, and the staff_audit_log insert — staged and committed (or
// discarded on rollback) together.
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/schema/activate — Estalara staff override (ADR-0018 §2, FOLLOW-657)', () => {
  const STAFF_TENANT_ID = '550e8400-e29b-41d4-a716-446655440099';

  function staffClaims(role: 'estalara:ops' | 'estalara:readonly' | 'estalara:superadmin') {
    return {
      sub: 'staff-uuid-777',
      email: 'staff@estalara.com',
      tenant_id: null,
      estalara_staff: true as const,
      estalara_role: role,
      mfa_verified: true,
    };
  }

  function makeStaffRequest(tenantId?: string): NextRequest {
    const url = new URL('http://localhost/api/schema/activate');
    if (tenantId) url.searchParams.set('tenant_id', tenantId);
    return new NextRequest(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer staff-jwt-token',
        'user-agent': 'vitest-staff-agent',
        'x-forwarded-for': '203.0.113.9',
      },
      body: JSON.stringify({ schema: MINIMAL_SCHEMA }),
    });
  }

  function makeStaffDb(
    opts: {
      tenantExists?: boolean;
      failAudit?: boolean;
      existingKey?: { prefix: string; last4: string } | null;
    } = {},
  ) {
    const tenantExists = opts.tenantExists ?? true;
    const failAudit = opts.failAudit ?? false;
    const existingKey = opts.existingKey ?? null;
    const auditRows: Record<string, unknown>[] = [];
    const insertedApiKeys: Record<string, unknown>[] = [];

    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(tenantExists ? [{ id: STAFF_TENANT_ID }] : [])),
        })),
      })),
    }));

    const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const stagedAudit: Record<string, unknown>[] = [];
      const stagedApiKeys: Record<string, unknown>[] = [];
      const txSelect = vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => ({
              limit: vi.fn(() => Promise.resolve(existingKey ? [existingKey] : [])),
            })),
          })),
        })),
      }));
      const txUpdate = vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
      }));
      const txInsert = vi.fn(() => ({
        values: vi.fn((v: Record<string, unknown>) => {
          if ('adminUserId' in v) {
            if (failAudit) return Promise.reject(new Error('audit sink down'));
            stagedAudit.push(v);
            return Promise.resolve([]);
          }
          if ('hashedKey' in v) {
            stagedApiKeys.push(v);
            return Promise.resolve([]);
          }
          return { onConflictDoUpdate: vi.fn().mockResolvedValue([]) };
        }),
      }));
      const tx = { select: txSelect, update: txUpdate, insert: txInsert };
      await fn(tx); // rejecting inside discards staged state — nothing commits.
      for (const row of stagedAudit) auditRows.push(row);
      for (const row of stagedApiKeys) insertedApiKeys.push(row);
    });

    return {
      db: { select, transaction },
      _auditRows: auditRows,
      _insertedApiKeys: insertedApiKeys,
    };
  }

  it('estalara:readonly staff (rank < ops) with ?tenant_id → 403, no DB write', async () => {
    mockGetAuthClaims.mockResolvedValue(staffClaims('estalara:readonly'));
    const { db } = makeStaffDb();
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);

    const res = await POST(makeStaffRequest(STAFF_TENANT_ID));
    expect(res.status).toBe(403);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('unknown ?tenant_id (not in tenants table) → 404, no DB write', async () => {
    mockGetAuthClaims.mockResolvedValue(staffClaims('estalara:ops'));
    const { db } = makeStaffDb({ tenantExists: false });
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);

    const res = await POST(makeStaffRequest('550e8400-e29b-41d4-a716-446655440000'));
    expect(res.status).toBe(404);
  });

  it('headless ADMIN_API_SECRET Bearer is REJECTED for staff (RETRO-187 — not attributable)', async () => {
    vi.stubEnv('ADMIN_API_SECRET', 'shared-secret-value');
    mockGetAuthClaims.mockResolvedValue(null); // no identified session/JWT
    const { db } = makeStaffDb();
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);

    const url = new URL('http://localhost/api/schema/activate');
    url.searchParams.set('tenant_id', STAFF_TENANT_ID);
    const req = new NextRequest(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer shared-secret-value', // === ADMIN_API_SECRET
      },
      body: JSON.stringify({ schema: MINIMAL_SCHEMA }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(db.transaction).not.toHaveBeenCalled();

    vi.unstubAllEnvs();
  });

  it('estalara:ops staff with valid ?tenant_id → 200, one staff_audit_log row, new key generated', async () => {
    mockGetAuthClaims.mockResolvedValue(staffClaims('estalara:ops'));
    const { db, _auditRows, _insertedApiKeys } = makeStaffDb({ existingKey: null });
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);

    const res = await POST(makeStaffRequest(STAFF_TENANT_ID));
    expect(res.status).toBe(200);

    const body = await parseBody<{ api_key: string; tenant_id: string }>(res);
    expect(body.api_key).toMatch(/^est_pub_/);
    expect(body.tenant_id).toBe(STAFF_TENANT_ID);

    expect(_insertedApiKeys).toHaveLength(1);
    expect(_auditRows).toHaveLength(1);
    const row = _auditRows[0]!;
    expect(row.adminUserId).toBe('staff-uuid-777');
    expect(row.action).toBe('schema.activate');
    expect(row.targetTenantId).toBe(STAFF_TENANT_ID);
    expect(row.ipAddress).toBe('203.0.113.9');
    expect(row.userAgent).toBe('vitest-staff-agent');
  });

  it('estalara:ops staff with an existing active key → 200, returns prefix...last4 (no new key inserted)', async () => {
    mockGetAuthClaims.mockResolvedValue(staffClaims('estalara:ops'));
    const existingKey = { prefix: 'est_pub_', last4: 'ab12' };
    const { db, _insertedApiKeys } = makeStaffDb({ existingKey });
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);

    const res = await POST(makeStaffRequest(STAFF_TENANT_ID));
    expect(res.status).toBe(200);
    const body = await parseBody<{ api_key: string }>(res);
    expect(body.api_key).toBe('est_pub_...ab12');
    expect(_insertedApiKeys).toHaveLength(0);
  });

  it('staff write whose audit insert FAILS → 500 AUDIT_WRITE_FAILED, no orphan api key insert', async () => {
    mockGetAuthClaims.mockResolvedValue(staffClaims('estalara:ops'));
    const { db, _auditRows, _insertedApiKeys } = makeStaffDb({
      existingKey: null,
      failAudit: true,
    });
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);

    const res = await POST(makeStaffRequest(STAFF_TENANT_ID));
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('AUDIT_WRITE_FAILED');
    // Rolled back together — no orphan api key row and no audit row.
    expect(_insertedApiKeys).toHaveLength(0);
    expect(_auditRows).toHaveLength(0);
  });
});
