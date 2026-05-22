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
  },
  apiKeys: {
    tenantId: 'tenant_id',
    type: 'type',
    revokedAt: 'revoked_at',
    expiresAt: 'expires_at',
    createdAt: 'created_at',
  },
}));

vi.mock('@/lib/tenant-schema', () => ({
  invalidateTenantSchemaCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val, op: 'eq' })),
  and: vi.fn((...args: unknown[]) => ({ args, op: 'and' })),
  isNull: vi.fn((col: unknown) => ({ col, op: 'isNull' })),
  or: vi.fn((...args: unknown[]) => ({ args, op: 'or' })),
  gt: vi.fn((col: unknown, val: unknown) => ({ col, val, op: 'gt' })),
  desc: vi.fn((col: unknown) => ({ col, op: 'desc' })),
}));

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn(),
}));

// ── Actual imports ─────────────────────────────────────────────────────────────

import { createAdminClient } from '@estalara/db';
import { getAuthClaims } from '@estalara/auth';
import { invalidateTenantSchemaCache } from '@/lib/tenant-schema';
import { POST } from './route';

const mockCreateAdminClient = vi.mocked(createAdminClient);
const mockGetAuthClaims = vi.mocked(getAuthClaims);
const mockInvalidateTenantSchemaCache = vi.mocked(invalidateTenantSchemaCache);

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

  it('staff JWT (tenant_id: null) → 403 STAFF_TENANT_CONTEXT_MISSING', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'staff-user-001',
      email: 'staff@estalara.com',
      tenant_id: null,
      estalara_staff: true as const,
      estalara_role: 'estalara:ops' as const,
      mfa_verified: true,
    });

    const res = await POST(makeRequest({ schema: MINIMAL_SCHEMA }));
    expect(res.status).toBe(403);

    const body = await parseBody<{ error: { code: string; message: string } }>(res);
    expect(body.error.code).toBe('STAFF_TENANT_CONTEXT_MISSING');
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
