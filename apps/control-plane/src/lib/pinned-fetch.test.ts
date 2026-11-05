// @vitest-environment node
/**
 * FOLLOW-1309 (Codex F-11, plan Phase 6 S3): the outbound guard on the listing-details fetch.
 *
 * Network is real where it can be (an `http` server on 127.0.0.1) and DNS is stubbed, because the
 * cases that matter are what a resolver ANSWERS: a private address, a mixed answer, an answer that
 * changes between two lookups. Nothing here leaves the machine.
 *
 * @module apps/control-plane/src/lib/pinned-fetch.test
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLookup } = vi.hoisted(() => ({ mockLookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mockLookup, default: { lookup: mockLookup } }));

import { OutboundTargetRefusedError, pinnedFetch } from './pinned-fetch';

/** A local server that counts its hits and answers per path. */
let server: http.Server;
let port = 0;
const hits: { path: string; host: string | undefined }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push({ path: req.url ?? '', host: req.headers.host });
    if (req.url === '/redirect-to-metadata') {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
      return;
    }
    if (req.url === '/redirect-to-self') {
      res.writeHead(302, { location: `http://127.0.0.1:${String(port)}/landed` });
      res.end();
      return;
    }
    if (req.url === '/huge') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(Buffer.alloc(5 * 1024 * 1024 + 1, 0x20));
      return;
    }
    if (req.url === '/hang') return; // never answers
    res.writeHead(200, {
      'content-type': 'application/json',
      'x-estalara-facts-source': '/abs/fixture-listing.html',
    });
    res.end(JSON.stringify({ description: 'ok' }));
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  hits.length = 0;
  mockLookup.mockReset();
  mockLookup.mockRejectedValue(new Error('unexpected DNS lookup in this test'));
  vi.stubEnv('ESTALARA_ALLOW_LOOPBACK_BACKEND', '');
  vi.stubEnv('VERCEL', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const allowLoopback = (): void => {
  vi.stubEnv('ESTALARA_ALLOW_LOOPBACK_BACKEND', '1');
};

async function refusal(url: string): Promise<OutboundTargetRefusedError> {
  const err = await pinnedFetch(url, {}).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(OutboundTargetRefusedError);
  return err as OutboundTargetRefusedError;
}

describe('literal addresses outside the public internet are refused before any connect', () => {
  const corpus = [
    // IPv4 private / loopback / link-local / CGNAT / this-network / reserved
    'http://127.0.0.1/',
    'http://127.8.9.10/',
    'http://10.0.0.1/',
    'http://172.16.0.1/',
    'http://172.31.255.254/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://169.254.0.1/',
    'http://100.64.0.1/',
    'http://100.127.255.254/',
    'http://0.0.0.0/',
    'http://0.1.2.3/',
    'http://224.0.0.1/',
    'http://255.255.255.255/',
    // the same addresses as decimal, octal and hex literals (WHATWG URL canonicalises them)
    'http://2130706433/',
    'http://0177.0.0.1/',
    'http://0x7f000001/',
    'http://0x7f.1/',
    'http://0xa9.0xfe.0xa9.0xfe/',
    'http://2852039166/',
    'http://012.0.0.1/',
    // IPv6 loopback / unspecified / ULA / link-local
    'http://[::1]/',
    'http://[::]/',
    'http://[fc00::1]/',
    'http://[fd12:3456::1]/',
    'http://[fe80::1]/',
    // IPv4-mapped IPv6, dotted and hex forms, and NAT64
    'http://[::ffff:10.0.0.1]/',
    'http://[::ffff:a00:1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:169.254.169.254]/',
    'http://[::ffff:a9fe:a9fe]/',
    'http://[64:ff9b::a00:1]/',
  ];

  it.each(corpus)('%s', async (url) => {
    const err = await refusal(url);
    expect(err.reason).toBe('non_public_address');
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('the loopback allowance does not widen to private, link-local or mapped-private targets', async () => {
    allowLoopback();
    for (const url of [
      'http://10.0.0.1/',
      'http://169.254.169.254/',
      'http://[::ffff:10.0.0.1]/',
      'http://[fd00::1]/',
      'http://100.64.0.1/',
    ]) {
      expect((await refusal(url)).reason).toBe('non_public_address');
    }
  });
});

describe('non-http(s) schemes are refused', () => {
  it.each([
    'file:///etc/passwd',
    'ftp://example.com/',
    'gopher://example.com/',
    'data:application/json,{}',
    'ws://example.com/',
  ])('%s', async (url) => {
    expect((await refusal(url)).reason).toBe('scheme_not_allowed');
  });

  it('refuses a URL that does not parse', async () => {
    expect((await refusal('not a url')).reason).toBe('invalid_url');
  });
});

describe('DNS names are resolved once, every answer is checked, the connection is pinned', () => {
  it('refuses a name that resolves to a private address', async () => {
    mockLookup.mockResolvedValue([{ address: '10.1.2.3', family: 4 }]);
    expect((await refusal('https://internal.example/')).reason).toBe('non_public_address');
  });

  it('refuses when ANY of the answers is private (no "first one is public" escape)', async () => {
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]);
    expect((await refusal('https://mixed.example/')).reason).toBe('non_public_address');
  });

  it('refuses IPv6 ULA and IPv4-mapped loopback answers', async () => {
    mockLookup.mockResolvedValue([{ address: 'fd00::1', family: 6 }]);
    expect((await refusal('https://ula.example/')).reason).toBe('non_public_address');
    mockLookup.mockResolvedValue([{ address: '::ffff:127.0.0.1', family: 6 }]);
    expect((await refusal('https://mapped.example/')).reason).toBe('non_public_address');
  });

  it('refuses a name that resolves to loopback without the allowance', async () => {
    mockLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    expect((await refusal(`http://localhost:${String(port)}/`)).reason).toBe('non_public_address');
    expect(hits).toHaveLength(0);
  });

  it('refuses an empty DNS answer', async () => {
    mockLookup.mockResolvedValue([]);
    expect((await refusal('https://empty.example/')).reason).toBe('dns_no_address');
  });

  it('DNS rebinding: a second, private answer is never asked for — the socket goes to the checked address', async () => {
    allowLoopback();
    // First answer: loopback (allowed for `localhost` under the flag). Any later lookup would
    // answer a private address; the guard must never make one.
    mockLookup
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
      .mockResolvedValue([{ address: '10.0.0.1', family: 4 }]);

    const res = await pinnedFetch(`http://localhost:${String(port)}/listing`, {});

    expect(res.status).toBe(200);
    expect(mockLookup).toHaveBeenCalledTimes(1);
    expect(hits).toEqual([{ path: '/listing', host: `localhost:${String(port)}` }]);
  });

  it('a public answer passes and the transport connects to exactly that address', async () => {
    mockLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]);
    const realRequest = http.request.bind(http);
    let pinned: unknown = null;
    // Intercept the outbound request: record what the guard's lookup hands the socket, then send
    // the bytes to the local server instead of the internet.
    vi.spyOn(http, 'request').mockImplementation(((
      _url: URL,
      options: http.RequestOptions,
      cb: (res: http.IncomingMessage) => void,
    ) => {
      const lookup = options.lookup as unknown as (
        host: string,
        opts: { all: boolean },
        done: (err: Error | null, addrs: unknown) => void,
      ) => void;
      lookup('listings.example', { all: true }, (_err, addrs) => {
        pinned = addrs;
      });
      return realRequest(
        `http://127.0.0.1:${String(port)}/public`,
        { ...options, lookup: undefined, agent: false },
        cb,
      );
    }) as unknown as typeof http.request);

    const res = await pinnedFetch('http://listings.example/public', {});

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ description: 'ok' });
    expect(res.headers.get('x-estalara-facts-source')).toBe('/abs/fixture-listing.html');
    expect(pinned).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]);
    expect(mockLookup).toHaveBeenCalledTimes(1);
    expect(mockLookup).toHaveBeenCalledWith('listings.example', { all: true, verbatim: true });
  });
});

describe('redirects are never followed', () => {
  it('a 302 to the metadata address comes back as a 302; nothing contacts the Location', async () => {
    allowLoopback();
    mockLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

    const res = await pinnedFetch(`http://localhost:${String(port)}/redirect-to-metadata`, {});

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://169.254.169.254/latest/meta-data/');
    expect(hits.map((h) => h.path)).toEqual(['/redirect-to-metadata']);
    expect(mockLookup).toHaveBeenCalledTimes(1);
  });

  it('a 302 to an allowed target is not followed either (zero-hop bound)', async () => {
    allowLoopback();
    mockLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

    const res = await pinnedFetch(`http://localhost:${String(port)}/redirect-to-self`, {});

    expect(res.status).toBe(302);
    expect(hits.map((h) => h.path)).toEqual(['/redirect-to-self']);
  });
});

describe('the loopback allowance for the localhost substrate (ESTALARA_BACKEND_URL=http://localhost:8081)', () => {
  it('flag=1 off Vercel: localhost and 127.0.0.1 are reachable', async () => {
    allowLoopback();
    mockLookup.mockResolvedValue([
      { address: '127.0.0.1', family: 4 },
      { address: '::1', family: 6 },
    ]);
    expect((await pinnedFetch(`http://localhost:${String(port)}/a`, {})).status).toBe(200);
    expect((await pinnedFetch(`http://127.0.0.1:${String(port)}/b`, {})).status).toBe(200);
    expect(hits.map((h) => h.path)).toEqual(['/a', '/b']);
  });

  it('works under NODE_ENV=production off Vercel (CP_MODE=prod localhost-up)', async () => {
    allowLoopback();
    vi.stubEnv('NODE_ENV', 'production');
    expect((await pinnedFetch(`http://127.0.0.1:${String(port)}/p`, {})).status).toBe(200);
  });

  it('a Vercel production build refuses loopback even with the flag', async () => {
    allowLoopback();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL', '1');
    mockLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    expect((await refusal(`http://127.0.0.1:${String(port)}/`)).reason).toBe('non_public_address');
    expect((await refusal(`http://localhost:${String(port)}/`)).reason).toBe('non_public_address');
    expect(hits).toHaveLength(0);
  });

  it('VERCEL wins over any NODE_ENV (a preview or a dev build on Vercel refuses too)', async () => {
    allowLoopback();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('VERCEL', '1');
    expect((await refusal(`http://127.0.0.1:${String(port)}/`)).reason).toBe('non_public_address');
  });

  it('only the exact string "1" turns it on', async () => {
    for (const value of ['true', 'yes', '01', ' 1']) {
      vi.stubEnv('ESTALARA_ALLOW_LOOPBACK_BACKEND', value);
      expect((await refusal(`http://127.0.0.1:${String(port)}/`)).reason).toBe(
        'non_public_address',
      );
    }
    expect(hits).toHaveLength(0);
  });

  it('a public DNS name that answers loopback stays refused under the flag (allowance is for loopback-named hosts only)', async () => {
    allowLoopback();
    mockLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    expect((await refusal(`http://api.app.estalara.com:${String(port)}/`)).reason).toBe(
      'non_public_address',
    );
    expect(hits).toHaveLength(0);
  });
});

describe('transport bounds', () => {
  it('a body over the 5 MiB cap is refused', async () => {
    allowLoopback();
    await expect(pinnedFetch(`http://127.0.0.1:${String(port)}/huge`, {})).rejects.toThrow(
      /exceeds/,
    );
  });

  it('the caller signal aborts a request that never answers', async () => {
    allowLoopback();
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 50);
    await expect(
      pinnedFetch(`http://127.0.0.1:${String(port)}/hang`, { signal: controller.signal }),
    ).rejects.toThrow();
  });

  it('the caller signal also bounds a DNS lookup that never answers (the 800 ms facts budget)', async () => {
    mockLookup.mockReturnValue(new Promise(() => undefined));
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 50);
    const started = Date.now();
    await expect(
      pinnedFetch('https://stalled-resolver.example/', { signal: controller.signal }),
    ).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1000);
  }, 3000);

  it('an already-aborted signal makes no DNS lookup at all', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      pinnedFetch('https://listings.example/', { signal: controller.signal }),
    ).rejects.toThrow();
    expect(mockLookup).not.toHaveBeenCalled();
  });
});
