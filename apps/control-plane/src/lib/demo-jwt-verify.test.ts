/**
 * `verifyDemoJwt` — registered-claim checks (FOLLOW-1307, Codex F-09: "exp / nbf / unsupported
 * alg rejected on every JWT path"). The demo JWT is the second HS256 path in the control plane
 * (`lib/demo/adapt-demo-context.ts`, DEMO_MODE only); before this ticket a token without `exp`
 * never expired, `nbf` was ignored and a token was still valid in the second of its `exp`.
 *
 * Tokens are signed in-process; the secret is built at runtime (no token-shaped literal).
 */

import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DemoJwtInvalidError, verifyDemoJwt } from './demo-jwt-verify';

const SECRET = 'demo-jwt-verify-test-'.repeat(2);
const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = (): number => Math.floor(Date.now() / 1000);

function sign(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' },
): string {
  const input = `${b64(header)}.${b64(payload)}`;
  return `${input}.${createHmac('sha256', SECRET).update(input).digest('base64url')}`;
}

beforeEach(() => {
  vi.stubEnv('DEMO_MODE_JWT_SECRET', SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('verifyDemoJwt — exp / nbf / alg (FOLLOW-1307)', () => {
  it('control: a live token is accepted and its claims returned', async () => {
    await expect(verifyDemoJwt(sign({ tenant_id: 't-1', exp: now() + 600 }))).resolves.toEqual({
      tenant_id: 't-1',
    });
  });

  it('expired token → DemoJwtInvalidError', async () => {
    await expect(verifyDemoJwt(sign({ exp: now() - 1 }))).rejects.toBeInstanceOf(
      DemoJwtInvalidError,
    );
  });

  it('exp equal to now → rejected (expired AT exp, RFC 7519 §4.1.4)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
    await expect(verifyDemoJwt(sign({ exp: now() }))).rejects.toBeInstanceOf(DemoJwtInvalidError);
  });

  it('no exp claim → rejected (a demo token must expire)', async () => {
    await expect(verifyDemoJwt(sign({ tenant_id: 't-1' }))).rejects.toBeInstanceOf(
      DemoJwtInvalidError,
    );
  });

  it('non-numeric exp → rejected', async () => {
    await expect(verifyDemoJwt(sign({ exp: String(now() + 600) }))).rejects.toBeInstanceOf(
      DemoJwtInvalidError,
    );
  });

  it('nbf in the future → rejected; nbf in the past → accepted', async () => {
    await expect(
      verifyDemoJwt(sign({ exp: now() + 600, nbf: now() + 300 })),
    ).rejects.toBeInstanceOf(DemoJwtInvalidError);
    await expect(verifyDemoJwt(sign({ exp: now() + 600, nbf: now() - 300 }))).resolves.toEqual({});
  });

  it('non-numeric nbf → rejected', async () => {
    await expect(verifyDemoJwt(sign({ exp: now() + 600, nbf: 'later' }))).rejects.toBeInstanceOf(
      DemoJwtInvalidError,
    );
  });

  it.each(['none', 'HS512', 'RS256'])('header alg %s → rejected', async (alg) => {
    await expect(verifyDemoJwt(sign({ exp: now() + 600 }, { alg }))).rejects.toBeInstanceOf(
      DemoJwtInvalidError,
    );
  });
});
