import { describe, expect, it } from 'vitest';

import { SIGNATURE_MAX_SKEW_MS, authenticateRequest, computeHmacSha256Hex } from './auth.js';
import type { ApiKeyRecord, AuthRequestInput } from './auth.js';
import type { Env } from './types.js';

function mockKv(map: Record<string, string | null>, fail = false): Env['KV_API_KEYS'] {
  return {
    get: (key: string): Promise<string | null> => {
      if (fail) return Promise.reject(new Error('kv_failure'));
      return Promise.resolve(map[key] ?? null);
    },
    put: () => Promise.resolve(),
    delete: () => Promise.resolve(),
    list: () => Promise.resolve({ keys: [], list_complete: true } as never),
    getWithMetadata: () => Promise.resolve({ value: null, metadata: null } as never),
  } as unknown as Env['KV_API_KEYS'];
}

/** Nonce store that remembers `put` (and records the TTL) so replay tests are real. */
function statefulKv(fail = false): {
  kv: Env['KV_IDEMPOTENCY'];
  puts: () => { key: string; ttl: number | undefined }[];
} {
  const store = new Map<string, string>();
  const puts: { key: string; ttl: number | undefined }[] = [];
  const kv = {
    get: (key: string): Promise<string | null> => {
      if (fail) return Promise.reject(new Error('nonce_kv_failure'));
      return Promise.resolve(store.get(key) ?? null);
    },
    put: (key: string, value: string, opts?: { expirationTtl?: number }) => {
      store.set(key, value);
      puts.push({ key, ttl: opts?.expirationTtl });
      return Promise.resolve();
    },
    delete: () => Promise.resolve(),
    list: () => Promise.resolve({ keys: [], list_complete: true } as never),
    getWithMetadata: () => Promise.resolve({ value: null, metadata: null } as never),
  } as unknown as Env['KV_IDEMPOTENCY'];
  return { kv, puts: () => puts };
}

const RECORD: ApiKeyRecord = {
  tenant_id: 'tenant-1',
  scopes: ['write:events'],
  hmac_secret: '00112233445566778899aabbccddeeff',
};

const BODY = '{"events":[]}';
const NOW = 1_800_000_000_000;
const NONCE = 'n'.repeat(24);

function unsigned(apiKey: string | undefined, body = BODY): AuthRequestInput {
  return {
    apiKey,
    signatureHeader: undefined,
    timestampHeader: undefined,
    nonceHeader: undefined,
    body,
  };
}

async function signed(
  overrides: Partial<AuthRequestInput> & { at?: number } = {},
): Promise<AuthRequestInput> {
  const at = overrides.at ?? NOW;
  const nonce = overrides.nonceHeader ?? NONCE;
  const body = overrides.body ?? BODY;
  const sig = await computeHmacSha256Hex(RECORD.hmac_secret!, `${String(at)}\n${nonce}\n${body}`);
  return {
    apiKey: 'k1',
    signatureHeader: `hmac-sha256:${sig}`,
    timestampHeader: String(at),
    nonceHeader: nonce,
    body,
    ...overrides,
  };
}

const deps = (replay = statefulKv(), kv = mockKv({ 'api_key:k1': JSON.stringify(RECORD) })) => ({
  kv,
  replayKv: replay.kv,
  now: () => NOW,
});

describe('authenticateRequest — key lookup', () => {
  it('returns missing_key when API key absent', async () => {
    const result = await authenticateRequest(unsigned(undefined), deps(undefined, mockKv({})));
    expect(result).toEqual({ ok: false, reason: 'missing_key' });
  });

  it('returns unknown_key when KV lookup misses', async () => {
    const result = await authenticateRequest(unsigned('not-issued'), deps(undefined, mockKv({})));
    expect(result).toEqual({ ok: false, reason: 'unknown_key' });
  });

  it('returns kv_error when KV throws', async () => {
    const result = await authenticateRequest(unsigned('any'), deps(undefined, mockKv({}, true)));
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('kv_error');
  });

  it('returns kv_error when stored value is malformed JSON', async () => {
    const result = await authenticateRequest(
      unsigned('k1'),
      deps(undefined, mockKv({ 'api_key:k1': 'not-json' })),
    );
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('kv_error');
  });

  it('returns ok with signed=false when no signature header is sent (the handler decides)', async () => {
    const result = await authenticateRequest(unsigned('k1'), deps());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tenant_id).toBe('tenant-1');
      expect(result.signed).toBe(false);
    }
  });

  it('surfaces allowed_origins from the KV record (FOLLOW-642)', async () => {
    const withOrigins: ApiKeyRecord = {
      tenant_id: 'tenant-1',
      scopes: [],
      allowed_origins: ['https://clientx.com'],
    };
    const result = await authenticateRequest(
      unsigned('k1'),
      deps(undefined, mockKv({ 'api_key:k1': JSON.stringify(withOrigins) })),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.allowed_origins).toEqual(['https://clientx.com']);
  });

  it('surfaces allowed_origins as undefined when the record omits it (inherit)', async () => {
    const result = await authenticateRequest(unsigned('k1'), deps());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.allowed_origins).toBeUndefined();
  });
});

describe('authenticateRequest — signed requests [FOLLOW-1201]', () => {
  it('returns ok signed=true when the HMAC over timestamp\\nnonce\\nbody matches', async () => {
    const result = await authenticateRequest(await signed(), deps());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.signed).toBe(true);
  });

  it('records the nonce per tenant with a TTL no shorter than twice the skew window', async () => {
    const replay = statefulKv();
    await authenticateRequest(await signed(), deps(replay));
    const puts = replay.puts();
    expect(puts).toHaveLength(1);
    expect(puts[0]!.key).toBe(`sig-nonce:tenant-1:${NONCE}`);
    // The TTL is read from the put the Worker actually issued, not from a constant the test
    // could share with the implementation — a nonce must outlive every timestamp it guards.
    expect((puts[0]!.ttl ?? 0) * 1000).toBeGreaterThanOrEqual(2 * SIGNATURE_MAX_SKEW_MS);
  });

  it('returns replayed_nonce on the second sighting of the same nonce', async () => {
    const replay = statefulKv();
    const req = await signed();
    const first = await authenticateRequest(req, deps(replay));
    expect(first.ok).toBe(true);
    const second = await authenticateRequest(req, deps(replay));
    if (second.ok) throw new Error('expected failure');
    expect(second.reason).toBe('replayed_nonce');
  });

  it('a different nonce is a different request (not a replay)', async () => {
    const replay = statefulKv();
    await authenticateRequest(await signed(), deps(replay));
    const other = await authenticateRequest(
      await signed({ nonceHeader: 'o'.repeat(24) }),
      deps(replay),
    );
    expect(other.ok).toBe(true);
  });

  it('returns stale_timestamp just outside the skew window, ok just inside it', async () => {
    const outside = await authenticateRequest(
      await signed({ at: NOW - SIGNATURE_MAX_SKEW_MS - 1 }),
      deps(),
    );
    if (outside.ok) throw new Error('expected failure');
    expect(outside.reason).toBe('stale_timestamp');

    const future = await authenticateRequest(
      await signed({ at: NOW + SIGNATURE_MAX_SKEW_MS + 1 }),
      deps(),
    );
    if (future.ok) throw new Error('expected failure');
    expect(future.reason).toBe('stale_timestamp');

    const inside = await authenticateRequest(
      await signed({ at: NOW - SIGNATURE_MAX_SKEW_MS + 1 }),
      deps(),
    );
    expect(inside.ok).toBe(true);
  });

  it('a body-only signature (the pre-FOLLOW-1201 contract) no longer verifies', async () => {
    const legacy = await computeHmacSha256Hex(RECORD.hmac_secret!, BODY);
    const result = await authenticateRequest(
      { ...(await signed()), signatureHeader: `hmac-sha256:${legacy}` },
      deps(),
    );
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('signature_mismatch');
  });

  it('a valid signature does not verify against a tampered body', async () => {
    const result = await authenticateRequest(
      { ...(await signed()), body: '{"events":[{"type":"cta.clicked"}]}' },
      deps(),
    );
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('signature_mismatch');
  });

  it('returns malformed_signature when the timestamp or nonce header is missing', async () => {
    const noTs = await authenticateRequest(
      { ...(await signed()), timestampHeader: undefined },
      deps(),
    );
    if (noTs.ok) throw new Error('expected failure');
    expect(noTs.reason).toBe('malformed_signature');

    const noNonce = await authenticateRequest(
      { ...(await signed()), nonceHeader: undefined },
      deps(),
    );
    if (noNonce.ok) throw new Error('expected failure');
    expect(noNonce.reason).toBe('malformed_signature');
  });

  it('returns malformed_signature for a nonce outside the alphabet or too short', async () => {
    const short = await authenticateRequest(await signed({ nonceHeader: 'abc' }), deps());
    if (short.ok) throw new Error('expected failure');
    expect(short.reason).toBe('malformed_signature');

    const newline = await authenticateRequest(
      await signed({ nonceHeader: `${'a'.repeat(20)}\n${'b'.repeat(20)}` }),
      deps(),
    );
    if (newline.ok) throw new Error('expected failure');
    expect(newline.reason).toBe('malformed_signature');
  });

  it('returns malformed_signature when signature header has wrong prefix', async () => {
    const result = await authenticateRequest(
      { ...(await signed()), signatureHeader: 'sha512:abcd' },
      deps(),
    );
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('malformed_signature');
  });

  it('returns malformed_signature when record has no hmac_secret (a public key cannot sign)', async () => {
    const noSecret: ApiKeyRecord = { tenant_id: 't', scopes: [] };
    const result = await authenticateRequest(
      await signed(),
      deps(undefined, mockKv({ 'api_key:k1': JSON.stringify(noSecret) })),
    );
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('malformed_signature');
  });

  it('returns signature_mismatch on wrong HMAC', async () => {
    const result = await authenticateRequest(
      { ...(await signed()), signatureHeader: 'hmac-sha256:deadbeef'.padEnd(76, '0') },
      deps(),
    );
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('signature_mismatch');
  });

  it('never touches the nonce store for an invalid signature (unauthenticated callers cannot fill it)', async () => {
    const replay = statefulKv();
    await authenticateRequest(
      { ...(await signed()), signatureHeader: 'hmac-sha256:deadbeef'.padEnd(76, '0') },
      deps(replay),
    );
    expect(replay.puts()).toEqual([]);
  });

  it('fails CLOSED with kv_error when the nonce store is unavailable', async () => {
    const result = await authenticateRequest(await signed(), deps(statefulKv(true)));
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('kv_error');
  });
});

describe('computeHmacSha256Hex', () => {
  it('produces deterministic hex output for the same input', async () => {
    const a = await computeHmacSha256Hex('aabbcc', 'hello');
    const b = await computeHmacSha256Hex('aabbcc', 'hello');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different output for different secrets', async () => {
    const a = await computeHmacSha256Hex('aabbcc', 'hello');
    const b = await computeHmacSha256Hex('bbccdd', 'hello');
    expect(a).not.toBe(b);
  });

  it('rejects odd-length hex secrets', async () => {
    await expect(computeHmacSha256Hex('abc', 'x')).rejects.toThrow();
  });

  it('rejects non-hex secrets', async () => {
    await expect(computeHmacSha256Hex('zzzz', 'x')).rejects.toThrow();
  });
});
