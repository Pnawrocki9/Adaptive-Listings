/**
 * Demo-mode JWT verification helper.
 *
 * Verifies a compact HS256 JWT against `DEMO_MODE_JWT_SECRET` using the
 * Web Crypto API (`crypto.subtle`), which is available in Node.js 15+ and
 * all edge runtimes. No new third-party dependency is introduced (Rule P /
 * AC4 of FOLLOW-205).
 *
 * Failure modes:
 *   - Secret not configured → throws `DemoJwtSecretMissingError` (caller
 *     should surface a 500; missing secret in prod is a config error, not a
 *     normal auth failure).
 *   - Token is not a valid JWT, signature is wrong, or token is expired →
 *     throws `DemoJwtInvalidError` (caller returns 401).
 *
 * @module apps/control-plane/src/lib/demo-jwt-verify
 */

/** Claims extracted from a verified demo JWT. */
export interface DemoJwtClaims {
  /** Tenant the demo session belongs to. Present in JWTs issued by /api/demo/sessions. */
  tenant_id?: string;
  /**
   * The `demo_sessions.id` (UUID) this token was issued for. Present in JWTs
   * issued by /api/demo/sessions. Consumed by the adapt path to enforce runtime
   * revocation (`demo_sessions.revoked_at`) — the self-contained JWT `exp` cannot
   * reflect a revoke, so this id is the lookup key (FOLLOW-636).
   */
  session_id?: string;
}

/** Thrown when `DEMO_MODE_JWT_SECRET` is not set in the environment. */
export class DemoJwtSecretMissingError extends Error {
  constructor() {
    super('DEMO_MODE_JWT_SECRET is not configured');
    this.name = 'DemoJwtSecretMissingError';
  }
}

/** Thrown when the token fails any verification step (bad signature, expired, malformed). */
export class DemoJwtInvalidError extends Error {
  constructor(reason: string) {
    super(`Demo JWT invalid: ${reason}`);
    this.name = 'DemoJwtInvalidError';
  }
}

/**
 * Verify a compact HS256 JWT against `DEMO_MODE_JWT_SECRET`.
 *
 * Checks:
 *   1. Token has the expected three-part base64url structure.
 *   2. Header declares `alg: HS256`.
 *   3. HMAC-SHA-256 signature is valid (constant-time via `crypto.subtle.verify`).
 *   4. `exp` claim is in the future (replay / expiry defence).
 *
 * @param token - The raw JWT string (without the "Bearer " prefix).
 * @returns Verified claims extracted from the JWT payload.
 * @throws {DemoJwtSecretMissingError} If `DEMO_MODE_JWT_SECRET` is absent.
 * @throws {DemoJwtInvalidError} If the token is invalid for any reason.
 */
export async function verifyDemoJwt(token: string): Promise<DemoJwtClaims> {
  const secret = process.env.DEMO_MODE_JWT_SECRET;
  if (!secret || secret.length === 0) {
    throw new DemoJwtSecretMissingError();
  }

  // ── Split compact serialization ──────────────────────────────────────────
  // Destructure first so TypeScript infers string | undefined for each element.
  const [headerB64, payloadB64, signatureB64, ...rest] = token.split('.');
  if (!headerB64 || !payloadB64 || !signatureB64 || rest.length > 0) {
    throw new DemoJwtInvalidError('token must have exactly 3 parts');
  }

  // ── Decode and validate header ───────────────────────────────────────────
  let header: Record<string, unknown>;
  try {
    header = JSON.parse(base64UrlDecode(headerB64)) as Record<string, unknown>;
  } catch {
    throw new DemoJwtInvalidError('header is not valid base64url JSON');
  }
  if (header.alg !== 'HS256') {
    throw new DemoJwtInvalidError(`unsupported algorithm: ${String(header.alg)}`);
  }

  // ── Import key and verify signature ─────────────────────────────────────
  // Uses crypto.subtle.verify for constant-time comparison (no timing attack).
  const keyMaterial = new TextEncoder().encode(secret);
  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyMaterial,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
  } catch {
    throw new DemoJwtInvalidError('failed to import HMAC key');
  }

  // Encode signingInput as a plain ArrayBuffer to satisfy BufferSource type.
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`).buffer;
  let signatureBuffer: ArrayBuffer;
  try {
    signatureBuffer = base64UrlDecodeBytes(signatureB64).buffer as ArrayBuffer;
  } catch {
    throw new DemoJwtInvalidError('signature is not valid base64url');
  }

  const valid = await crypto.subtle.verify('HMAC', cryptoKey, signatureBuffer, signingInput);
  if (!valid) {
    throw new DemoJwtInvalidError('signature verification failed');
  }

  // ── Decode payload and check expiry ──────────────────────────────────────
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64)) as Record<string, unknown>;
  } catch {
    throw new DemoJwtInvalidError('payload is not valid base64url JSON');
  }

  if (typeof payload.exp === 'number') {
    const nowSecs = Math.floor(Date.now() / 1000);
    if (payload.exp < nowSecs) {
      throw new DemoJwtInvalidError('token has expired');
    }
  }

  return {
    ...(typeof payload.tenant_id === 'string' && payload.tenant_id.length > 0
      ? { tenant_id: payload.tenant_id }
      : {}),
    ...(typeof payload.session_id === 'string' && payload.session_id.length > 0
      ? { session_id: payload.session_id }
      : {}),
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Decode a base64url string to a UTF-8 string. */
function base64UrlDecode(input: string): string {
  // Convert base64url → base64 standard
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  // Pad to multiple of 4
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  return atob(padded);
}

/** Decode a base64url string to a Uint8Array (for binary signature bytes). */
function base64UrlDecodeBytes(input: string): Uint8Array {
  const decoded = base64UrlDecode(input);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) {
    bytes[i] = decoded.charCodeAt(i);
  }
  return bytes;
}
