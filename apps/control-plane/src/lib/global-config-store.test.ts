/**
 * Unit tests for global-config-store (FOLLOW-161).
 *
 * Coverage:
 *   - getGlobalGenerationModel: returns DEFAULT when DB not configured (env absent)
 *   - getGlobalGenerationModel: returns DB value when row exists + value is allow-listed
 *   - getGlobalGenerationModel: returns DEFAULT when DB row has a non-allow-listed value
 *   - getGlobalGenerationModel: returns DEFAULT when DB returns empty rows
 *   - getGlobalGenerationModel: THROWS when DB is configured but query fails (Rule K.2)
 *   - setGlobalGenerationModel: throws on non-allow-listed model (refuse write)
 *   - setGlobalGenerationModel: succeeds with a valid model
 *   - Allow-list constants: all 3 curated models present, default is Sonnet
 *
 * @module apps/control-plane/src/lib/global-config-store.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ─── Hoisted stubs ────────────────────────────────────────────────────────────

const { mockCreateAdminClient, mockDbQuery } = vi.hoisted(() => {
  const mockDbQuery = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue([]),
  };
  const mockCreateAdminClient = vi.fn().mockReturnValue(mockDbQuery);
  return { mockCreateAdminClient, mockDbQuery };
});

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@estalara/db', () => ({
  createAdminClient: mockCreateAdminClient,
  appConfig: {
    key: 'key',
    value: 'value',
    updatedAt: 'updated_at',
    updatedBy: 'updated_by',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
}));

import {
  getGlobalGenerationModel,
  setGlobalGenerationModel,
  ALLOWED_GENERATION_MODELS,
  DEFAULT_GENERATION_MODEL,
  GENERATION_MODEL_KEY,
} from './global-config-store';

// ─── Allow-list constants ─────────────────────────────────────────────────────

describe('ALLOWED_GENERATION_MODELS', () => {
  it('contains exactly 3 curated models', () => {
    expect(ALLOWED_GENERATION_MODELS).toHaveLength(3);
  });

  it('includes haiku, sonnet, and opus', () => {
    expect(ALLOWED_GENERATION_MODELS).toContain('claude-haiku-4-5-20251001');
    expect(ALLOWED_GENERATION_MODELS).toContain('claude-sonnet-4-6');
    expect(ALLOWED_GENERATION_MODELS).toContain('claude-opus-4-8');
  });

  it('default is claude-sonnet-4-6', () => {
    expect(DEFAULT_GENERATION_MODEL).toBe('claude-sonnet-4-6');
  });

  it('config key is generation_model', () => {
    expect(GENERATION_MODEL_KEY).toBe('generation_model');
  });
});

// ─── getGlobalGenerationModel ─────────────────────────────────────────────────

describe('getGlobalGenerationModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset db query mock chain
    mockDbQuery.select.mockReturnThis();
    mockDbQuery.from.mockReturnThis();
    mockDbQuery.where.mockReturnThis();
    mockDbQuery.limit.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns DEFAULT when DATABASE_URL is not set (dev/CI path)', async () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('SUPABASE_DB_URL', '');
    const model = await getGlobalGenerationModel();
    expect(model).toBe(DEFAULT_GENERATION_MODEL);
    // DB should not be called
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it('returns DB value when row exists and value is allow-listed', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://test');
    mockDbQuery.limit.mockResolvedValue([{ value: 'claude-opus-4-8' }]);

    const model = await getGlobalGenerationModel();
    expect(model).toBe('claude-opus-4-8');
  });

  it('returns DEFAULT when DB returns empty rows (no config written yet)', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://test');
    mockDbQuery.limit.mockResolvedValue([]);

    const model = await getGlobalGenerationModel();
    expect(model).toBe(DEFAULT_GENERATION_MODEL);
  });

  it('returns DEFAULT when stored value is not in allow-list (defensive)', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://test');
    mockDbQuery.limit.mockResolvedValue([{ value: 'gpt-4o' }]);

    const model = await getGlobalGenerationModel();
    expect(model).toBe(DEFAULT_GENERATION_MODEL);
  });

  it('returns haiku when stored value is claude-haiku-4-5-20251001', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://test');
    mockDbQuery.limit.mockResolvedValue([{ value: 'claude-haiku-4-5-20251001' }]);

    const model = await getGlobalGenerationModel();
    expect(model).toBe('claude-haiku-4-5-20251001');
  });

  it('THROWS when DB is configured but query fails (Rule K.2 fail-loud)', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://test');
    mockDbQuery.limit.mockRejectedValue(new Error('DB connection refused'));

    await expect(getGlobalGenerationModel()).rejects.toThrow('DB connection refused');
  });
});

// ─── setGlobalGenerationModel ─────────────────────────────────────────────────

describe('setGlobalGenerationModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbQuery.insert.mockReturnThis();
    mockDbQuery.values.mockReturnThis();
    mockDbQuery.onConflictDoUpdate.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('throws when model is not in allow-list', async () => {
    await expect(setGlobalGenerationModel('gpt-4o', null)).rejects.toThrow(
      'not in ALLOWED_GENERATION_MODELS',
    );
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it('throws when model is empty string', async () => {
    await expect(setGlobalGenerationModel('', null)).rejects.toThrow(
      'not in ALLOWED_GENERATION_MODELS',
    );
  });

  it('succeeds with claude-opus-4-8', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://test');
    await expect(setGlobalGenerationModel('claude-opus-4-8', 'user-uuid')).resolves.toBeUndefined();
    expect(mockDbQuery.insert).toHaveBeenCalled();
  });

  it('succeeds with claude-haiku-4-5-20251001', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://test');
    await expect(
      setGlobalGenerationModel('claude-haiku-4-5-20251001', null),
    ).resolves.toBeUndefined();
  });

  it('succeeds with the default claude-sonnet-4-6', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://test');
    await expect(
      setGlobalGenerationModel('claude-sonnet-4-6', 'user-uuid'),
    ).resolves.toBeUndefined();
  });
});
