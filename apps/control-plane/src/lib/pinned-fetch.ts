/**
 * Outbound GET with an SSRF guard: only public addresses, resolved once and pinned (FOLLOW-1309,
 * Codex F-11, plan Phase 6 S3).
 *
 * The one consumer is `lib/listing-details.ts`, whose upstream (`ESTALARA_BACKEND_URL`) serves
 * tenant listing content. Every other server-side `fetch(` in the control plane goes to operator
 * infrastructure at a fixed configured host (Upstash, ClickHouse, the Supabase management API).
 *
 * What it refuses, before a socket is opened:
 *
 *   - a scheme other than `http:` / `https:`, or a URL that does not parse;
 *   - an IP literal outside the public internet: IPv4 this-network, private, CGNAT, loopback,
 *     link-local (incl. the 169.254.169.254 metadata address), documentation, benchmarking,
 *     multicast, reserved and broadcast ranges; IPv6 anything outside global unicast 2000::/3
 *     (loopback, unspecified, ULA fc00::/7, link-local fe80::/10, NAT64, multicast) plus 6to4,
 *     Teredo / the 2001::/23 special block and 2001:db8::/32. Decimal, octal and hex IPv4 forms are
 *     canonicalised by the WHATWG URL parser before the check; an IPv4-mapped IPv6 address
 *     (`::ffff:10.0.0.1`, `::ffff:a00:1`) is checked as the IPv4 address it carries;
 *   - a DNS name when ANY address in its answer (`lookup` with `all: true`) is non-public. Refusing
 *     on any, not on the first, is deliberate: a mixed answer is how a rebinding resolver hedges.
 *
 * Pinning (DNS rebinding): the name is resolved exactly once. The socket's `lookup` hook is handed
 * the already-checked answer, so the address connected to is the address that was checked; there
 * is no second resolution for a resolver to answer differently.
 *
 * Redirects are never followed (zero-hop bound). A 3xx comes back to the caller as a 3xx, and
 * `listing-details.ts` already treats any 3xx as a misconfiguration. Nothing contacts a `Location`.
 *
 * The localhost substrate (`ESTALARA_BACKEND_URL=http://localhost:8081`) is reachable only when
 * ALL of these hold: `ESTALARA_ALLOW_LOOPBACK_BACKEND` is exactly `1`; `VERCEL` is unset (Vercel
 * sets it on every build and function, the same fence `origin-policy.ts` uses for
 * `ESTALARA_LOCAL_ORIGINS`); the URL's host is itself `localhost` or a loopback literal; and every
 * resolved address is loopback. It widens to loopback only, never to a private or link-local range.
 * `NODE_ENV` is NOT the fence: `CP_MODE=prod scripts/dev/localhost-up.sh` runs `next start`, which
 * forces `NODE_ENV=production`, against the `:8081` fixture.
 *
 * @module apps/control-plane/src/lib/pinned-fetch
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

/** Largest response body read into memory. A listing-details JSON is tens of kilobytes. */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

/** Statuses whose `Response` must carry a null body. */
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

type RefusalReason = 'invalid_url' | 'scheme_not_allowed' | 'non_public_address' | 'dns_no_address';

/** The target was refused by the guard; no connection was made. */
export class OutboundTargetRefusedError extends Error {
  override readonly name = 'OutboundTargetRefusedError';

  constructor(
    readonly reason: RefusalReason,
    readonly host: string,
  ) {
    super(`outbound target refused (${reason}): ${host}`);
  }
}

interface ResolvedAddress {
  address: string;
  family: number;
}

const V4_LOOPBACK = new net.BlockList();
V4_LOOPBACK.addSubnet('127.0.0.0', 8, 'ipv4');

const V4_NON_PUBLIC = new net.BlockList();
for (const [prefix, bits] of [
  ['0.0.0.0', 8], // this network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT
  ['169.254.0.0', 16], // link-local, incl. cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, incl. broadcast
] as const) {
  V4_NON_PUBLIC.addSubnet(prefix, bits, 'ipv4');
}

/** `::ffff:XXXX:XXXX`, the WHATWG serialisation of an IPv4-mapped IPv6 address. */
const MAPPED_V4_RE = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/;

/** Where an address sits. Anything that cannot be classified is `non_public`. */
function classify(address: string): 'public' | 'loopback' | 'non_public' {
  const family = net.isIP(address);
  if (family === 4) {
    if (V4_LOOPBACK.check(address, 'ipv4')) return 'loopback';
    return V4_NON_PUBLIC.check(address, 'ipv4') ? 'non_public' : 'public';
  }
  if (family !== 6) return 'non_public';

  let canon: string;
  try {
    // Canonical, compressed, lower-case. A zone id (`fe80::1%eth0`) does not parse: non_public.
    canon = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  } catch {
    return 'non_public';
  }
  const mapped = MAPPED_V4_RE.exec(canon);
  if (mapped) {
    const hi = parseInt(mapped[1] ?? '', 16);
    const lo = parseInt(mapped[2] ?? '', 16);
    return classify(
      `${String(hi >> 8)}.${String(hi & 0xff)}.${String(lo >> 8)}.${String(lo & 0xff)}`,
    );
  }
  if (canon === '::1') return 'loopback';

  const parts = canon.split(':');
  const first = canon.startsWith('::') ? 0 : parseInt(parts[0] ?? '', 16);
  const second = canon.startsWith('::') || !parts[1] ? 0 : parseInt(parts[1], 16);
  if ((first & 0xe000) !== 0x2000) return 'non_public'; // outside global unicast 2000::/3
  if (first === 0x2002) return 'non_public'; // 6to4 embeds an arbitrary IPv4
  if (first === 0x2001 && (second < 0x0200 || second === 0x0db8)) return 'non_public';
  return 'public';
}

/** Whether the localhost substrate's loopback target may be reached for this host. */
function loopbackAllowedFor(host: string): boolean {
  if (process.env.ESTALARA_ALLOW_LOOPBACK_BACKEND !== '1') return false;
  if (process.env.VERCEL) return false;
  return host === 'localhost' || classify(host) === 'loopback';
}

/**
 * `dns.lookup` cannot be cancelled, so the caller's signal is raced against it: a stalled resolver
 * must not outlive the caller's budget (800 ms on the placeholder-facts path).
 */
function lookupWithin(host: string, signal: AbortSignal | undefined): Promise<ResolvedAddress[]> {
  if (!signal) return dnsLookup(host, { all: true, verbatim: true });
  signal.throwIfAborted();
  return new Promise<ResolvedAddress[]>((resolve, reject) => {
    const onAbort = (): void => {
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    dnsLookup(host, { all: true, verbatim: true }).then(
      (answers) => {
        signal.removeEventListener('abort', onAbort);
        resolve(answers);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

async function resolveChecked(
  host: string,
  signal: AbortSignal | undefined,
): Promise<ResolvedAddress[]> {
  const literal = net.isIP(host);
  const answers: ResolvedAddress[] =
    literal !== 0 ? [{ address: host, family: literal }] : await lookupWithin(host, signal);
  if (answers.length === 0) throw new OutboundTargetRefusedError('dns_no_address', host);

  const loopbackOk = loopbackAllowedFor(host);
  for (const { address } of answers) {
    const where = classify(address);
    if (where === 'public' || (where === 'loopback' && loopbackOk)) continue;
    throw new OutboundTargetRefusedError('non_public_address', host);
  }
  return answers;
}

/** Keep-alive pools. A pooled socket was connected to an address checked when it was opened. */
const AGENTS = {
  'http:': new http.Agent({ keepAlive: true }),
  'https:': new https.Agent({ keepAlive: true }),
} as const;

function toHeaders(raw: http.IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(name, v);
    } else {
      headers.set(name, value);
    }
  }
  return headers;
}

function send(
  url: URL,
  addresses: ResolvedAddress[],
  signal: AbortSignal | undefined,
): Promise<Response> {
  const scheme = url.protocol as keyof typeof AGENTS;
  const transport = scheme === 'https:' ? https : http;

  // Hand the socket the CHECKED answer; never resolve again.
  const lookup = ((
    _hostname: string,
    options: { all?: boolean; family?: number | string },
    callback: (err: Error | null, address: unknown, family?: number) => void,
  ): void => {
    const family = options.family === 'IPv4' ? 4 : options.family === 'IPv6' ? 6 : options.family;
    const usable =
      family === 4 || family === 6 ? addresses.filter((a) => a.family === family) : addresses;
    const first = usable[0];
    if (!first) {
      callback(new Error(`[pinned-fetch] no checked address of family ${String(family)}`), null);
      return;
    }
    if (options.all) callback(null, usable);
    else callback(null, first.address, first.family);
  }) as unknown as net.LookupFunction;

  return new Promise<Response>((resolve, reject) => {
    const req = transport.request(
      url,
      { method: 'GET', agent: AGENTS[scheme], lookup, signal },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            req.destroy();
            reject(
              new Error(`[pinned-fetch] response body exceeds ${String(MAX_BODY_BYTES)} bytes`),
            );
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('close', () => {
          if (!res.complete) reject(new Error('[pinned-fetch] response closed before its end'));
        });
        res.on('end', () => {
          try {
            const status = res.statusCode ?? 0;
            const body = NULL_BODY_STATUSES.has(status) ? null : Buffer.concat(chunks);
            resolve(
              new Response(body, {
                status,
                statusText: res.statusMessage ?? '',
                headers: toHeaders(res.headers),
              }),
            );
          } catch (err: unknown) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/**
 * GET `url` if, and only if, every address it resolves to is public (or loopback under the
 * localhost allowance), connecting to exactly the address that was checked. Never follows a
 * redirect.
 *
 * @param url  - Absolute `http:` / `https:` URL.
 * @param init - `signal` aborts the request at any stage.
 * @returns A `Response` with the upstream status, headers and body (3xx included, unfollowed).
 * @throws {OutboundTargetRefusedError} when the guard refuses the target (no connection made).
 * @throws {Error} on DNS failure, network failure, abort, or a body over the size cap.
 */
export async function pinnedFetch(url: string, init: { signal?: AbortSignal }): Promise<Response> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new OutboundTargetRefusedError('invalid_url', '');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new OutboundTargetRefusedError('scheme_not_allowed', parsed.protocol);
  }
  const host = parsed.hostname.startsWith('[') ? parsed.hostname.slice(1, -1) : parsed.hostname;
  const addresses = await resolveChecked(host, init.signal);
  return send(parsed, addresses, init.signal);
}
