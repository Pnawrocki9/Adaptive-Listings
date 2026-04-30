import { describe, expect, it } from 'vitest';

import { authenticateRequest, computeHmacSha256Hex } from './auth.js';
import type { ApiKeyRecord } from './auth.js';
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

const RECORD: ApiKeyRecord = {
  tenant_id: 'tenant-1',
  scopes: ['write:events'],
  hmac_secret: '00112233445566778899aabbccddeeff',
};

describe('authenticateRequest', () => {
  it('returns missing_key when API key absent', async () => {
    const result = await authenticateRequest(undefined, undefined, '', mockKv({}));
    expect(result).toEqual({ ok: false, reason: 'missing_key' });
  });

  it('returns unknown_key when KV lookup misses', async () => {
    const result = await authenticateRequest('not-issued', undefined, '', mockKv({}));
    expect(result).toEqual({ ok: false, reason: 'unknown_key' });
  });

  it('returns kv_error when KV throws', async () => {
    const result = await authenticateRequest('any', undefined, '', mockKv({}, true));
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('kv_error');
  });

  it('returns kv_error when stored value is malformed JSON', async () => {
    const result = await authenticateRequest(
      'k1',
      undefined,
      '',
      mockKv({ 'api_key:k1': 'not-json' }),
    );
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('kv_error');
  });

  it('returns ok unsigned when no signature header is sent', async () => {
    const kv = mockKv({ 'api_key:k1': JSON.stringify(RECORD) });
    const result = await authenticateRequest('k1', undefined, '{"events":[]}', kv);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tenant_id).toBe('tenant-1');
      expect(result.signed).toBe(false);
    }
  });

  it('returns malformed_signature when signature header has wrong prefix', async () => {
    const kv = mockKv({ 'api_key:k1': JSON.stringify(RECORD) });
    const result = await authenticateRequest('k1', 'sha512:abcd', 'body', kv);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('malformed_signature');
  });

  it('returns malformed_signature when record has no hmac_secret', async () => {
    const noSecret: ApiKeyRecord = { tenant_id: 't', scopes: [] };
    const kv = mockKv({ 'api_key:k1': JSON.stringify(noSecret) });
    const result = await authenticateRequest('k1', 'hmac-sha256:abcd', 'body', kv);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('malformed_signature');
  });

  it('returns signature_mismatch on wrong HMAC', async () => {
    const kv = mockKv({ 'api_key:k1': JSON.stringify(RECORD) });
    const result = await authenticateRequest(
      'k1',
      'hmac-sha256:deadbeef'.padEnd(72, '0'),
      'body',
      kv,
    );
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('signature_mismatch');
  });

  it('returns ok signed when HMAC matches', async () => {
    const body = '{"events":[]}';
    const expected = await computeHmacSha256Hex(RECORD.hmac_secret!, body);
    const kv = mockKv({ 'api_key:k1': JSON.stringify(RECORD) });
    const result = await authenticateRequest('k1', `hmac-sha256:${expected}`, body, kv);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.signed).toBe(true);
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
