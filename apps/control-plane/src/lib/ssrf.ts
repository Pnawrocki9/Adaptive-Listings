/**
 * SSRF protection utilities for server-side outbound HTTP requests.
 *
 * Blocks requests to private/loopback IP ranges, IPv6 loopback/private addresses,
 * and bare hostnames without a TLD (e.g. `localhost`, `internal`, `db`).
 *
 * Used by `POST /api/detect` to prevent tenant-supplied URLs from being used
 * to probe internal services. Export `checkSsrf` for unit testing.
 *
 * @module apps/control-plane/src/lib/ssrf
 */

/**
 * Thrown by `checkSsrf()` when the hostname is blocked.
 */
export class SsrfBlockedError extends Error {
  constructor(hostname: string, reason: string) {
    super(`SSRF blocked: hostname '${hostname}' ${reason}`);
    this.name = 'SsrfBlockedError';
  }
}

/**
 * IPv4 private and loopback range check.
 *
 * Blocks:
 *   10.0.0.0/8        — private class A
 *   172.16.0.0/12     — private class B (172.16 – 172.31)
 *   192.168.0.0/16    — private class C
 *   127.0.0.0/8       — loopback
 */
function isPrivateIPv4(hostname: string): boolean {
  // Must be a dotted-decimal IPv4 address
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map(Number);
  if (octets.some((o) => isNaN(o) || o < 0 || o > 255)) return false;

  const [a, b] = octets as [number, number, number, number];

  // 10.x.x.x
  if (a === 10) return true;
  // 127.x.x.x
  if (a === 127) return true;
  // 172.16.x.x – 172.31.x.x
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.x.x
  if (a === 192 && b === 168) return true;

  return false;
}

/**
 * IPv6 loopback and private range check.
 *
 * Blocks:
 *   ::1           — loopback
 *   fc00::/7      — unique local (fc and fd prefixes)
 */
function isPrivateIPv6(hostname: string): boolean {
  // Strip brackets for [::1] form
  const raw = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  const lower = raw.toLowerCase();

  if (lower === '::1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;

  return false;
}

/**
 * Check whether a hostname is a bare label (no TLD / no dot).
 *
 * Blocks: `localhost`, `internal`, `db`, `redis`, etc.
 * Allows: `example.com`, `sub.example.co.uk`, etc.
 */
function isBareHostname(hostname: string): boolean {
  // Strip brackets for IPv6 bracket notation — those aren't bare hostnames
  if (hostname.startsWith('[')) return false;
  // If hostname contains a dot, it has at least one label separator — not bare
  if (hostname.includes('.')) return false;
  // No dot → bare hostname (includes 'localhost')
  return true;
}

/**
 * Validate that the URL's hostname is safe for a server-side outbound request.
 *
 * Exported so it can be unit-tested independently.
 *
 * @throws {SsrfBlockedError} when the hostname is blocked
 */
export function checkSsrf(url: string): void {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new SsrfBlockedError(url, 'is not a valid URL');
  }

  if (isBareHostname(hostname)) {
    throw new SsrfBlockedError(hostname, 'is a bare hostname without a TLD');
  }

  if (isPrivateIPv4(hostname)) {
    throw new SsrfBlockedError(hostname, 'is a private or loopback IPv4 address');
  }

  if (isPrivateIPv6(hostname)) {
    throw new SsrfBlockedError(hostname, 'is a loopback or private IPv6 address');
  }
}
