/**
 * @vitest-environment node
 *
 * FOLLOW-1316, R16: over the REAL capture path, the server Sentry config does not put a request body
 * on an event. `xid` travels in POST bodies, and `requestDataIntegration` includes `data` by default,
 * so without the option an xid in a body would reach Sentry.
 *
 * Paired, or the assertion is vacuous: the control runs the SDK's defaults over the same request and
 * must see the sentinel on the wire. The other half loads `sentry.server.config.ts` itself.
 *
 * Whether server Sentry is initialised at all in production is a separate question (no
 * `instrumentation.ts` loads this config today). This pins what the config does when it is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { captured } = vi.hoisted(() => ({ captured: [] as unknown[] }));

vi.mock('@sentry/nextjs', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.mock importOriginal generic requires inline import() type
  const namespace = await importOriginal<typeof import('@sentry/nextjs')>();
  // The package's CJS build hangs its re-exports off `default`, and a spread of the namespace loses them.
  const real = (namespace as unknown as { default?: typeof namespace }).default ?? namespace;
  return {
    ...real,
    // The config's own options, with only the transport swapped so nothing dials out.
    init: (options: Parameters<typeof real.init>[0]) =>
      real.init({
        ...options,
        transport: () => ({
          send: (envelope: unknown) => {
            captured.push(envelope);
            return Promise.resolve({});
          },
          flush: () => Promise.resolve(true),
        }),
      }),
  };
});

import * as Sentry from '@sentry/nextjs';

const FAKE_DSN = 'https://publickey@o0.ingest.sentry.io/0';
const XID_SENTINEL = '7f3f1c6e-2b1a-4c3d-9e8f-1a2b3c4d5e6f';

interface CapturedRequest {
  url?: string;
  data?: unknown;
}

/** Capture one exception as if handling a POST carrying the xid; return the event's request. */
async function captureDuringPost(): Promise<CapturedRequest | undefined> {
  Sentry.withIsolationScope((scope) => {
    scope.setSDKProcessingMetadata({
      normalizedRequest: {
        method: 'POST',
        url: 'https://admin.estalara.com/api/adapt',
        headers: { 'content-type': 'application/json' },
        data: JSON.stringify({ xid: XID_SENTINEL }),
      },
    });
    Sentry.captureException(new Error('buyer_profile redis_http_error'));
  });
  await Sentry.flush(5000);
  for (const envelope of captured) {
    const [, items] = envelope as [unknown, [{ type?: string }, { request?: CapturedRequest }][]];
    const event = items.find((item) => item[0].type === 'event');
    if (event) return event[1].request;
  }
  throw new Error('no envelope carried a type:event item');
}

beforeEach(() => {
  captured.length = 0;
});

afterEach(async () => {
  await Sentry.close(2000);
  // The Next.js `init` returns early while a client is set, and `close` leaves it set.
  Sentry.getCurrentScope().setClient(undefined);
  Sentry.getIsolationScope().setClient(undefined);
  Sentry.getGlobalScope().setClient(undefined);
  vi.unstubAllEnvs();
});

describe('a POST body on a Sentry event', () => {
  it('control: the SDK defaults carry the body to the wire', async () => {
    Sentry.init({ dsn: FAKE_DSN, sendDefaultPii: false });

    const request = await captureDuringPost();

    expect(request?.data).toBeDefined();
    expect(JSON.stringify(captured)).toContain(XID_SENTINEL);
  });

  it('the server config does not, and the event still names the request', async () => {
    vi.stubEnv('SENTRY_DSN_CONTROL_PLANE', FAKE_DSN);
    vi.resetModules();
    // A variable specifier, as in sentry-config.shape.test.ts: the config stays outside `tsc`'s program.
    const serverConfig = '../../../sentry.server.config';
    await import(serverConfig);

    const request = await captureDuringPost();

    expect(request?.url).toContain('/api/adapt');
    expect(request?.data).toBeUndefined();
    expect(JSON.stringify(captured)).not.toContain(XID_SENTINEL);
  });
});
