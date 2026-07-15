/**
 * Unit tests for chat-intent-cache.ts — deleteShadowChatIntent() (FOLLOW-557 / audit A3-F-05).
 *
 * Coverage:
 *   AC1 (FOLLOW-557): deleteShadowChatIntent() issues a Redis DEL for the exact
 *     `shadow:{tenant_id}:{session_id}:chat_intent` key — tested against a seeded
 *     (pre-existing) key, i.e. the Upstash pipeline mock reports the key was found
 *     and removed (DEL result 1).
 *   AC1b: is a no-op (no fetch call) when UPSTASH_REDIS_URL is unset — matches the
 *     existing `deleteSessionFromRedis()` / `invalidateDescriptionCache()` posture.
 *   AC2 (FOLLOW-557, Rule Z): the TypeScript `shadowChatIntentKey()` key format is
 *     checked against the LITERAL f-string parsed out of the Python producer,
 *     `apps/intent-engine/src/redis_writer.py`'s `shadow_key()` — NOT a hand-typed
 *     copy of the format in this file. This is the "fixture mechanically derived
 *     from the producing runtime's canonical contract" mechanism permitted by
 *     Rule Z (CONVENTIONS_PATCH.md) as an alternative to a live cross-runtime
 *     round-trip: if `redis_writer.py`'s key format ever changes, this test's
 *     regex either fails to match (hard-fail) or extracts a different literal,
 *     which then fails the comparison — it cannot silently pass on drift.
 *
 * @module apps/control-plane/src/lib/__tests__/chat-intent-cache.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { deleteShadowChatIntent, shadowChatIntentKey } from '../chat-intent-cache.js';

// ─── deleteShadowChatIntent() — AC1 ───────────────────────────────────────────

describe('deleteShadowChatIntent() (FOLLOW-557)', () => {
  beforeEach(() => {
    vi.stubEnv('UPSTASH_REDIS_URL', 'https://redis.test.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_TOKEN', 'test-token');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('AC1: DELs the exact shadow:{tenant}:{session}:chat_intent key for a seeded key', async () => {
    const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
    const SESSION_ID = 'sess-follow557-001';

    // Simulate a seeded (pre-existing) shadow key: Upstash DEL returns 1
    // (one key removed) rather than 0 (key absent).
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify([{ result: 1 }]), { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    await deleteShadowChatIntent(TENANT_ID, SESSION_ID);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/pipeline');
    expect(init.method).toBe('POST');

    const body = JSON.parse(init.body as string) as unknown[][];
    expect(body).toHaveLength(1);
    expect(body[0]?.[0]).toBe('DEL');
    expect(body[0]?.[1]).toBe(`shadow:${TENANT_ID}:${SESSION_ID}:chat_intent`);
    // Exactly one key targeted — this is a single deterministic key, not a
    // wildcard namespace, so no SCAN is needed before the DEL.
    expect(body[0]).toHaveLength(2);
  });

  it('AC1b: is a no-op (no fetch call) when UPSTASH_REDIS_URL is unset', async () => {
    vi.stubEnv('UPSTASH_REDIS_URL', '');
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    await deleteShadowChatIntent('tenant-id', 'session-id');

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── shadowChatIntentKey() vs. the Python producer literal — AC2 / Rule Z ─────

describe('shadowChatIntentKey() cross-runtime key-format parity (FOLLOW-557, Rule Z)', () => {
  it('AC2: matches the literal f-string in redis_writer.py shadow_key() (parsed, not hand-typed)', () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const redisWriterPath = path.resolve(
      __dirname,
      '../../../../intent-engine/src/redis_writer.py',
    );

    const source = readFileSync(redisWriterPath, 'utf-8');

    // Extract the literal f-string returned by shadow_key() — this is the
    // producing runtime's canonical contract (Rule Z option (a)): mechanically
    // parsed from the actual current source, not re-typed here.
    const match = /def shadow_key\([^)]*\)[\s\S]*?return f"([^"]+)"/.exec(source);
    expect(
      match,
      "Could not find shadow_key()'s f-string literal in redis_writer.py — the " +
        'function was renamed/restructured. Update this regex to re-derive the ' +
        'fixture rather than hand-typing the new format.',
    ).not.toBeNull();

    const pythonTemplate = match![1]!; // e.g. "shadow:{tenant_id}:{session_id}:chat_intent"
    expect(pythonTemplate).toContain('{tenant_id}');
    expect(pythonTemplate).toContain('{session_id}');

    const TENANT_ID = 'parity-tenant-557';
    const SESSION_ID = 'parity-session-557';

    const pythonExpected = pythonTemplate
      .replace('{tenant_id}', TENANT_ID)
      .replace('{session_id}', SESSION_ID);

    expect(shadowChatIntentKey(TENANT_ID, SESSION_ID)).toBe(pythonExpected);
  });
});
