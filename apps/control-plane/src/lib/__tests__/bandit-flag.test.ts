/**
 * FOLLOW-1286 (D3) — `BANDIT_ENABLED` flag and the frozen-bandit response.
 *
 * @module apps/control-plane/src/lib/__tests__/bandit-flag.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { banditDisabledResponse, isBanditEnabled } from '../bandit-flag';
import { BANDIT_DISABLED_REASON, isBanditDisabledBody } from '../bandit-disabled-body';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isBanditEnabled', () => {
  it('is false by default (unset)', () => {
    expect(process.env.BANDIT_ENABLED).toBeUndefined();
    expect(isBanditEnabled()).toBe(false);
  });

  it.each(['', 'false', '0', '1', 'TRUE', 'yes', ' true'])('is false for %j', (value) => {
    vi.stubEnv('BANDIT_ENABLED', value);
    expect(isBanditEnabled()).toBe(false);
  });

  it('is true only for the exact string "true"', () => {
    vi.stubEnv('BANDIT_ENABLED', 'true');
    expect(isBanditEnabled()).toBe(true);
  });
});

describe('banditDisabledResponse', () => {
  it('is a 404 NOT_FOUND carrying details.reason = bandit_disabled', async () => {
    const res = banditDisabledResponse();
    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      error: { code: string; details: { reason: string }; request_id: string };
    };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.details.reason).toBe(BANDIT_DISABLED_REASON);
    expect(body.error.request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(isBanditDisabledBody(body)).toBe(true);
  });
});

describe('isBanditDisabledBody', () => {
  it.each([
    null,
    undefined,
    'bandit_disabled',
    {},
    { error: 'bandit_disabled' },
    { error: { code: 'NOT_FOUND' } },
    { error: { details: { reason: 'something_else' } } },
    { rows: [], learning_state: 'paused' },
  ])('is false for %j (a genuine 404 or a weights payload)', (body) => {
    expect(isBanditDisabledBody(body)).toBe(false);
  });
});
