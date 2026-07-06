/**
 * Unit tests for feedback-nonce.ts — FOLLOW-466 / audit F-21.
 *
 * Coverage:
 *   - unconfigured Redis (UPSTASH_REDIS_URL unset) → fail-open (isReplay: false)
 *   - first sighting (Redis SET NX succeeds, result "OK") → isReplay: false
 *   - replay (Redis SET NX fails, result null) → isReplay: true
 *   - non-2xx Redis response → fail-open (isReplay: false)
 *   - Redis fetch throws (network error) → fail-open (isReplay: false)
 *   - the SET command is issued with NX + EX <FEEDBACK_NONCE_TTL_SECONDS> and the
 *     `nonce:feedback:{sig}` key format
 *
 * @module apps/control-plane/src/lib/__tests__/feedback-nonce.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkAndRecordFeedbackNonce, FEEDBACK_NONCE_TTL_SECONDS } from '../feedback-nonce.js';

const SIG = 'a'.repeat(64);

describe('checkAndRecordFeedbackNonce()', () => {
  beforeEach(() => {
    vi.stubEnv('UPSTASH_REDIS_URL', 'https://redis.test.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_TOKEN', 'test-token');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('fails open (isReplay: false) when UPSTASH_REDIS_URL is not set', async () => {
    vi.stubEnv('UPSTASH_REDIS_URL', '');
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const result = await checkAndRecordFeedbackNonce(SIG);
    expect(result.isReplay).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('first sighting: SET NX succeeds ("OK") → isReplay: false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: 'OK' }), { status: 200 })),
    );
    const result = await checkAndRecordFeedbackNonce(SIG);
    expect(result.isReplay).toBe(false);
  });

  it('replay: SET NX fails (key already present, result null) → isReplay: true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: null }), { status: 200 })),
    );
    const result = await checkAndRecordFeedbackNonce(SIG);
    expect(result.isReplay).toBe(true);
  });

  it('fails open (isReplay: false) when Redis returns a non-2xx status (configured-but-failed)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })));
    const result = await checkAndRecordFeedbackNonce(SIG);
    expect(result.isReplay).toBe(false);
  });

  it('fails open (isReplay: false) when the Redis fetch throws (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const result = await checkAndRecordFeedbackNonce(SIG);
    expect(result.isReplay).toBe(false);
  });

  it('issues SET nonce:feedback:{sig} 1 NX EX <ttl> against the Upstash REST endpoint', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ result: 'OK' }), { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    await checkAndRecordFeedbackNonce(SIG);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    const decodedUrl = decodeURIComponent(url);
    expect(decodedUrl).toContain(
      `/set/nonce:feedback:${SIG}/1/nx/ex/${String(FEEDBACK_NONCE_TTL_SECONDS)}`,
    );
  });
});
