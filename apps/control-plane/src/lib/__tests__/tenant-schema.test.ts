/**
 * Tests for TICKET-AB-011 — getTenantSchema() DB lookup + Redis cache.
 *
 * Coverage:
 *   - Demo tenant → DEMO_SCHEMA (no DB/Redis call)
 *   - Redis cache hit → returns cached schema, no DB call
 *   - Redis cache miss → DB call → schema returned + cache populated
 *   - DB miss (null rows) → null returned
 *   - DB error → null returned (fail-open)
 *   - Redis read error → falls through to DB
 *   - Schema with index_schema.reorder_capable=false → returns {reorder_capable: false}
 *
 * @module apps/control-plane/src/lib/__tests__/tenant-schema.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ── Mock @estalara/db before import ───────────────────────────────────────────
vi.mock('@estalara/db', () => {
  const mockSelect = vi.fn();
  const mockFrom = vi.fn();
  const mockWhere = vi.fn();
  const mockOrderBy = vi.fn();
  const mockLimit = vi.fn();

  // Chain: db.select().from().where().orderBy().limit()
  mockLimit.mockResolvedValue([]);
  mockOrderBy.mockReturnValue({ limit: mockLimit });
  mockWhere.mockReturnValue({ orderBy: mockOrderBy });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });

  const mockDb = { select: mockSelect };
  const createAdminClient = vi.fn().mockReturnValue(mockDb);

  return {
    createAdminClient,
    tenantSiteSchemas: { schema: 'schema', tenantId: 'tenant_id', updatedAt: 'updated_at' },
    // eq is used in the where clause — return a mock predicate
    eq: vi.fn((_col: unknown, _val: unknown) => 'eq-predicate'),
  };
});

import { getTenantSchema, DEMO_SCHEMA } from '../tenant-schema.js';
import { createAdminClient } from '@estalara/db';

const mockCreateAdminClient = vi.mocked(createAdminClient);

// Helper: set up the DB mock chain to return given rows
function mockDbRows(rows: { schema: unknown }[]) {
  const mockLimit = vi.fn().mockResolvedValue(rows);
  const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
  const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
  mockCreateAdminClient.mockReturnValue({ select: mockSelect } as unknown as ReturnType<
    typeof createAdminClient
  >);
  return { mockSelect, mockFrom, mockWhere, mockOrderBy, mockLimit };
}

// Helper: Redis GET response
function stubRedisGet(value: string | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes('/get/')) {
        return Promise.resolve(new Response(JSON.stringify({ result: value }), { status: 200 }));
      }
      // Redis SET (fire-and-forget) — always succeed
      return Promise.resolve(new Response('', { status: 200 }));
    }),
  );
}

// Helper: Redis GET returns non-ok (simulate error)
function stubRedisError() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes('/get/')) {
        return Promise.resolve(new Response('', { status: 500 }));
      }
      return Promise.resolve(new Response('', { status: 200 }));
    }),
  );
}

describe('getTenantSchema() — TICKET-AB-011', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('UPSTASH_REDIS_URL', 'https://redis.test.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_TOKEN', 'test-token');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  // ── AC-4: Demo tenant always returns DEMO_SCHEMA ──────────────────────────

  it('AC-4: est_demo_tenant → DEMO_SCHEMA (no DB or Redis call)', async () => {
    const result = await getTenantSchema('est_demo_tenant');
    expect(result).toEqual(DEMO_SCHEMA);
    expect(result?.reorder_capable).toBe(true);
    expect(result?.container_selector).toBe('[data-estalara-listings-grid]');
    // DB should not have been called
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  // ── AC-2: Redis cache hit ─────────────────────────────────────────────────

  it('AC-2: Redis cache hit → returns cached schema, DB not called', async () => {
    const cachedSchema = {
      reorder_capable: true,
      container_selector: '[data-listings]',
      item_selector: '[data-listing]',
    };
    stubRedisGet(JSON.stringify(cachedSchema));

    const result = await getTenantSchema('tenant-abc-123');

    expect(result).toEqual(cachedSchema);
    // DB must NOT have been called
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it('AC-2: Redis cache hit with null → returns null without DB call', async () => {
    stubRedisGet(JSON.stringify(null));

    const result = await getTenantSchema('tenant-no-schema');

    expect(result).toBeNull();
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  // ── AC-1: Cache miss → DB lookup ─────────────────────────────────────────

  it('AC-1: cache miss → DB called, reorder_capable schema returned', async () => {
    stubRedisGet(null); // cache miss

    const schemaBlob = {
      index_schema: {
        reorder_capable: true,
        container_selector: '[data-estalara-listings-grid]',
        listing_card_selector: '[data-estalara-listing-id]',
      },
    };
    mockDbRows([{ schema: schemaBlob }]);

    const result = await getTenantSchema('tenant-real-001');

    expect(result).not.toBeNull();
    expect(result?.reorder_capable).toBe(true);
    expect(result?.container_selector).toBe('[data-estalara-listings-grid]');
    expect(mockCreateAdminClient).toHaveBeenCalledOnce();
  });

  it('AC-1: DB returns null schema → result is null', async () => {
    stubRedisGet(null);
    mockDbRows([]); // empty result set

    const result = await getTenantSchema('tenant-no-rows');

    expect(result).toBeNull();
    expect(mockCreateAdminClient).toHaveBeenCalledOnce();
  });

  // ── AC-3: Graceful null on error ──────────────────────────────────────────

  it('AC-3: DB throws → null returned, no rethrow', async () => {
    stubRedisGet(null);

    // Make DB throw
    mockCreateAdminClient.mockImplementation(() => {
      throw new Error('DB connection refused');
    });

    const result = await getTenantSchema('tenant-db-error');

    expect(result).toBeNull();
    // No exception should propagate
  });

  it('AC-3: Redis read fails → falls through to DB', async () => {
    stubRedisError(); // Redis GET returns 500

    const schemaBlob = {
      index_schema: {
        reorder_capable: false,
        container_selector: '',
        listing_card_selector: '.listing-card',
      },
    };
    mockDbRows([{ schema: schemaBlob }]);

    const result = await getTenantSchema('tenant-redis-error');

    // Should still return the DB result
    expect(result).not.toBeNull();
    expect(result?.reorder_capable).toBe(false);
    expect(mockCreateAdminClient).toHaveBeenCalledOnce();
  });

  // ── UPSTASH_REDIS_URL not configured ─────────────────────────────────────

  it('no UPSTASH_REDIS_URL → no Redis call, falls straight to DB', async () => {
    vi.stubEnv('UPSTASH_REDIS_URL', '');

    const schemaBlob = {
      index_schema: {
        reorder_capable: true,
        container_selector: '[data-grid]',
        listing_card_selector: '[data-card]',
      },
    };
    mockDbRows([{ schema: schemaBlob }]);

    const result = await getTenantSchema('tenant-no-redis');

    expect(result?.reorder_capable).toBe(true);
    expect(mockCreateAdminClient).toHaveBeenCalledOnce();
  });
});
