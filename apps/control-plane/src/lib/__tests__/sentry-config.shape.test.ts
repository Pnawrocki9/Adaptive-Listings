/**
 * FOLLOW-811 — pins the FOLLOW-811 decision on the three control-plane Sentry
 * configs: no `beforeSend`/`beforeBreadcrumb` redaction hook, `sendDefaultPii`
 * explicitly false, Session Replay sampled to zero.
 *
 * These tests drive the REAL config modules (`apps/control-plane/sentry.*.config.ts`),
 * not a hand-written replica of them, and assert over the WHOLE options object
 * passed to `Sentry.init` rather than a chosen subset — so a key added later
 * (a hook, a new integration, `sendDefaultPii: true`) fails here and forces
 * `docs/compliance/dpia.md` §2.7.1 to be revisited in the same PR. That is the
 * assertion shape RETRO-247 §5a identified as the half of
 * `test_buyer_text_escapes_both_sinks` worth mirroring; the buyer-text sentinel
 * half lives in `sentry-capture-path.test.ts`, which drives a real capture.
 *
 * @module apps/control-plane/src/lib/__tests__/sentry-config.shape
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const initSpy = vi.fn();

vi.mock('@sentry/nextjs', () => ({
  init: (options: unknown) => {
    initSpy(options);
  },
  replayIntegration: () => ({ name: 'Replay' }),
}));

/** Env keys these three config modules read; cleared and restored per test. */
const ENV_KEYS = [
  'SENTRY_DSN_CONTROL_PLANE',
  'NEXT_PUBLIC_SENTRY_DSN_CONTROL_PLANE',
  'GIT_SHA',
  'NEXT_PUBLIC_GIT_SHA',
] as const;

const FAKE_DSN = 'https://publickey@o0.ingest.sentry.io/0';

let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    Reflect.deleteProperty(process.env, key);
  }
  initSpy.mockClear();
  vi.resetModules();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const previous = saved[key];
    if (previous === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = previous;
  }
});

/**
 * Import a config module fresh and return the single options object it passed
 * to `Sentry.init`, or `null` when it did not init at all.
 */
async function loadConfig(specifier: string): Promise<Record<string, unknown> | null> {
  await import(specifier);
  if (initSpy.mock.calls.length === 0) return null;
  expect(initSpy).toHaveBeenCalledTimes(1);
  return initSpy.mock.calls[0]?.[0] as Record<string, unknown>;
}

/** Every key that could suppress, rewrite or drop event content before send. */
const REDACTION_HOOK_KEYS = [
  'beforeSend',
  'beforeSendTransaction',
  'beforeSendSpan',
  'beforeBreadcrumb',
] as const;

describe('FOLLOW-811 — control-plane Sentry init options (server)', () => {
  it('does not init when SENTRY_DSN_CONTROL_PLANE is absent', async () => {
    expect(await loadConfig('../../../sentry.server.config')).toBeNull();
  });

  it('inits with exactly the decided option set — no redaction hook', async () => {
    process.env.SENTRY_DSN_CONTROL_PLANE = FAKE_DSN;
    const options = await loadConfig('../../../sentry.server.config');
    expect(options).not.toBeNull();

    // Whole-structure assertion: an added key fails here on purpose.
    expect(Object.keys(options ?? {}).sort()).toEqual([
      'autoInstrumentServerFunctions',
      'dsn',
      'environment',
      'release',
      'sendDefaultPii',
      'tracesSampleRate',
    ]);
    for (const key of REDACTION_HOOK_KEYS) {
      expect(options).not.toHaveProperty(key);
    }
    expect(options?.sendDefaultPii).toBe(false);
    expect(options?.dsn).toBe(FAKE_DSN);
  });

  it('ignores the browser-only DSN var', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN_CONTROL_PLANE = FAKE_DSN;
    expect(await loadConfig('../../../sentry.server.config')).toBeNull();
  });
});

describe('FOLLOW-811 — control-plane Sentry init options (edge)', () => {
  it('does not init when SENTRY_DSN_CONTROL_PLANE is absent', async () => {
    expect(await loadConfig('../../../sentry.edge.config')).toBeNull();
  });

  it('inits with exactly the decided option set — no redaction hook', async () => {
    process.env.SENTRY_DSN_CONTROL_PLANE = FAKE_DSN;
    const options = await loadConfig('../../../sentry.edge.config');
    expect(Object.keys(options ?? {}).sort()).toEqual([
      'dsn',
      'environment',
      'release',
      'sendDefaultPii',
      'tracesSampleRate',
    ]);
    for (const key of REDACTION_HOOK_KEYS) {
      expect(options).not.toHaveProperty(key);
    }
    expect(options?.sendDefaultPii).toBe(false);
  });
});

describe('FOLLOW-811 — control-plane Sentry init options (client)', () => {
  /**
   * Pins the env var this module actually reads. Its docstring named
   * `SENTRY_DSN_CONTROL_PLANE` until FOLLOW-811; that var is not readable from
   * the browser bundle, so a doc-lags-code divergence here is not cosmetic —
   * it is the difference between "browser errors reach Sentry" and "they do
   * not". This test makes the two disagree loudly if it ever drifts back.
   */
  it('inits on NEXT_PUBLIC_SENTRY_DSN_CONTROL_PLANE, not on the server var', async () => {
    process.env.SENTRY_DSN_CONTROL_PLANE = FAKE_DSN;
    expect(await loadConfig('../../../sentry.client.config')).toBeNull();
  });

  it('inits with exactly the decided option set — no redaction hook, replay at zero', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN_CONTROL_PLANE = FAKE_DSN;
    const options = await loadConfig('../../../sentry.client.config');
    expect(Object.keys(options ?? {}).sort()).toEqual([
      'dsn',
      'environment',
      'integrations',
      'release',
      'replaysOnErrorSampleRate',
      'replaysSessionSampleRate',
      'sendDefaultPii',
      'tracesSampleRate',
    ]);
    for (const key of REDACTION_HOOK_KEYS) {
      expect(options).not.toHaveProperty(key);
    }
    expect(options?.sendDefaultPii).toBe(false);

    /**
     * Session Replay reads the admin dashboard's DOM. Both rates at 0 is the
     * only reason it captures nothing (`@sentry-internal/replay@10.50.0`,
     * `build/npm/cjs/index.js:8685-8691` returns before creating a session).
     * dpia.md §2.7.1 makes raising either rate a DPIA-amendment trigger; this
     * assertion is the mechanical half of that trigger.
     */
    expect(options?.replaysSessionSampleRate).toBe(0);
    expect(options?.replaysOnErrorSampleRate).toBe(0);
  });
});
