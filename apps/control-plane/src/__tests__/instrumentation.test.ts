/**
 * FOLLOW-1442 (P-7) — `register()` in `src/instrumentation.ts` is the only way `@sentry/nextjs` v10
 * loads `sentry.server.config.ts` / `sentry.edge.config.ts`. Without it every server-side
 * `Sentry.captureException` reaches the console only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const serverLoaded = vi.fn();
const edgeLoaded = vi.fn();

vi.mock('../../sentry.server.config', () => {
  serverLoaded();
  return {};
});
vi.mock('../../sentry.edge.config', () => {
  edgeLoaded();
  return {};
});
vi.mock('@sentry/nextjs', () => ({ captureRequestError: vi.fn() }));

let savedRuntime: string | undefined;

beforeEach(() => {
  savedRuntime = process.env.NEXT_RUNTIME;
  serverLoaded.mockClear();
  edgeLoaded.mockClear();
  vi.resetModules();
});

afterEach(() => {
  if (savedRuntime === undefined) Reflect.deleteProperty(process.env, 'NEXT_RUNTIME');
  else process.env.NEXT_RUNTIME = savedRuntime;
});

describe('FOLLOW-1442 — instrumentation register()', () => {
  it('loads the server config under NEXT_RUNTIME=nodejs only', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    const { register } = await import('../instrumentation');
    await register();
    expect(serverLoaded).toHaveBeenCalledTimes(1);
    expect(edgeLoaded).not.toHaveBeenCalled();
  });

  it('loads the edge config under NEXT_RUNTIME=edge only', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    const { register } = await import('../instrumentation');
    await register();
    expect(edgeLoaded).toHaveBeenCalledTimes(1);
    expect(serverLoaded).not.toHaveBeenCalled();
  });

  it('is a no-op for any other runtime', async () => {
    process.env.NEXT_RUNTIME = 'something-else';
    const { register } = await import('../instrumentation');
    await expect(register()).resolves.toBeUndefined();
    expect(serverLoaded).not.toHaveBeenCalled();
    expect(edgeLoaded).not.toHaveBeenCalled();
  });

  it('exports Sentry.captureRequestError as onRequestError', async () => {
    const Sentry = await import('@sentry/nextjs');
    const mod = await import('../instrumentation');
    expect(mod.onRequestError).toBe(Sentry.captureRequestError);
  });
});
