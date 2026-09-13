/**
 * API key authentication for the ingest Worker.
 *
 * Two caller classes, decided by the `Origin` header in `handlers/events.ts` [FOLLOW-1201]:
 *
 * 1. **Browser SDK** — sends `X-Estalara-API-Key: <public token>` and (because it is a browser
 *    POST) an `Origin`. The public key alone is identity for rate limiting + per-tenant routing;
 *    the per-tenant origin gate (`origin-gate.ts`, FOLLOW-642) is what binds a stolen key to the
 *    brand's own domains.
 * 2. **Server-side producer** — no browser, so no `Origin`. MUST sign every request, because the
 *    api key is page-visible (`packages/sdk/src/core/config.ts` reads `script.dataset.apiKey`) and
 *    a key alone proves nothing about who is holding it. Audit SEC-1 found the signature was
 *    optional here and `signed` was read by nothing, so any visitor could `curl` conversion
 *    events into the pilot's lift metric. The handler now refuses `!Origin && !signed`.
 *
 * Signed-request contract (server producers):
 *   X-Estalara-Signature: hmac-sha256:<lower-hex>
 *   X-Estalara-Timestamp: <unix ms, decimal>
 *   X-Estalara-Nonce:     <16–128 chars of [A-Za-z0-9_-], unique per request>
 *   signature = HMAC-SHA-256(hex-decode(record.hmac_secret), timestamp + "\n" + nonce + "\n" + body)
 *
 * The timestamp bounds the window a captured request is valid in (`SIGNATURE_MAX_SKEW_MS`); the
 * nonce closes the window entirely once the request has been seen (`sig-nonce:` keys in
 * `KV_IDEMPOTENCY`, TTL `NONCE_TTL_SECONDS` ≥ 2× the skew so a nonce cannot outlive its
 * timestamp). Replay defence runs ONLY after the signature verifies, so an unauthenticated caller
 * cannot fill the nonce store. A nonce-store failure fails CLOSED (`kv_error`): a replay guard
 * that cannot record what it has seen cannot promise anything. Documented residual: Cloudflare KV
 * is eventually consistent, so two replays that race inside the propagation window can both be
 * admitted — the same limit `middleware/idempotency.ts` documents. A Durable-Object nonce set
 * would close it; not needed for the pilot's single server producer.
 *
 * @module apps/ingest/src/auth
 */

import type { KVNamespace } from '@cloudflare/workers-types';
import type { ApiKeyRecord } from '@estalara/shared';

/**
 * Shape of a `KV_API_KEYS` value — re-exported from `@estalara/shared` so the ingest READ path
 * and the control-plane provisioning WRITE path
 * (`apps/control-plane/scripts/project-allowed-origins.mts`) share ONE declaration and cannot
 * drift (FOLLOW-658). See that module for the `allowed_origins` three-state semantics.
 */
export type { ApiKeyRecord };

/** Result of a successful auth check — passed to downstream handlers. */
export interface AuthenticatedTenant {
  tenant_id: string;
  scopes: string[];
  /**
   * True iff the request carried a valid timestamped, nonce'd HMAC signature. Consumed by
   * `handlers/events.ts`: a request with no browser `Origin` and `signed: false` is refused
   * (`unsigned_server_caller`). [FOLLOW-1201]
   */
  signed: boolean;
  /**
   * The tenant's browser-`Origin` allow-list, verbatim from the KV record (un-normalized).
   * Consumed by the per-tenant origin gate in `handlers/events.ts` (FOLLOW-642). See
   * {@link ApiKeyRecord.allowed_origins} for semantics.
   */
  allowed_origins?: string[] | null;
}

/**
 * Reasons auth can fail. Caller maps these to HTTP 401 with appropriate detail.
 * `malformed_signature` covers a signature header without its timestamp/nonce companions, a bad
 * prefix, a non-integer timestamp, an out-of-alphabet nonce, or a key record with no secret.
 */
export type AuthFailure =
  | { reason: 'missing_key' }
  | { reason: 'unknown_key' }
  | { reason: 'malformed_signature' }
  | { reason: 'signature_mismatch' }
  | { reason: 'stale_timestamp' }
  | { reason: 'replayed_nonce' }
  | { reason: 'kv_error'; cause: unknown };

export type AuthResult = ({ ok: true } & AuthenticatedTenant) | ({ ok: false } & AuthFailure);

const SIGNATURE_PREFIX = 'hmac-sha256:';

/** Maximum |now − X-Estalara-Timestamp| a signed request is accepted at (5 minutes). */
export const SIGNATURE_MAX_SKEW_MS = 5 * 60_000;
/** How long a seen nonce is remembered — 2× the skew so no valid timestamp outlives it. */
const NONCE_TTL_SECONDS = 600;
/** Nonce alphabet/length. Unambiguous inside the newline-joined signed message. */
const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/;
const NONCE_KV_PREFIX = 'sig-nonce:';

/** Everything `authenticateRequest` reads off the inbound request. */
export interface AuthRequestInput {
  /** Value of the `X-Estalara-API-Key` header (raw, unparsed). */
  apiKey: string | null | undefined;
  /** Value of the `X-Estalara-Signature` header (may be absent for browser callers). */
  signatureHeader: string | null | undefined;
  /** Value of the `X-Estalara-Timestamp` header — required whenever a signature is sent. */
  timestampHeader: string | null | undefined;
  /** Value of the `X-Estalara-Nonce` header — required whenever a signature is sent. */
  nonceHeader: string | null | undefined;
  /** Raw request body string (signed verbatim). */
  body: string;
}

/** Bindings `authenticateRequest` needs from the Worker `env`, plus an injectable clock. */
export interface AuthDeps {
  /** `KV_API_KEYS` — api-key → tenant record. */
  kv: KVNamespace;
  /** Nonce store for replay rejection (`KV_IDEMPOTENCY` in production — same namespace, own prefix). */
  replayKv: KVNamespace;
  /** Clock, injectable for skew tests. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Validate an inbound request: look the API key up in KV and, when a signature is presented,
 * verify it over (timestamp, nonce, body), enforce the skew window and reject a seen nonce.
 *
 * Does NOT decide whether an UNSIGNED request is acceptable — that depends on the browser
 * `Origin`, which `handlers/events.ts` owns. This function reports `signed` and the handler
 * applies the rule.
 */
export async function authenticateRequest(
  input: AuthRequestInput,
  deps: AuthDeps,
): Promise<AuthResult> {
  const { apiKey, signatureHeader, timestampHeader, nonceHeader, body } = input;
  const now = deps.now ?? Date.now;
  if (!apiKey) return { ok: false, reason: 'missing_key' };

  let raw: string | null;
  try {
    raw = await deps.kv.get(`api_key:${apiKey}`);
  } catch (cause) {
    return { ok: false, reason: 'kv_error', cause };
  }
  if (!raw) return { ok: false, reason: 'unknown_key' };

  let record: ApiKeyRecord;
  try {
    record = JSON.parse(raw) as ApiKeyRecord;
  } catch (cause) {
    return { ok: false, reason: 'kv_error', cause };
  }

  let signed = false;
  if (signatureHeader) {
    if (!record.hmac_secret) return { ok: false, reason: 'malformed_signature' };
    if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) {
      return { ok: false, reason: 'malformed_signature' };
    }
    // Timestamp + nonce are part of the signed message, so they are mandatory with a signature.
    if (!timestampHeader || !/^\d{1,16}$/.test(timestampHeader)) {
      return { ok: false, reason: 'malformed_signature' };
    }
    if (!nonceHeader || !NONCE_RE.test(nonceHeader)) {
      return { ok: false, reason: 'malformed_signature' };
    }
    const timestampMs = Number.parseInt(timestampHeader, 10);
    if (Math.abs(now() - timestampMs) > SIGNATURE_MAX_SKEW_MS) {
      return { ok: false, reason: 'stale_timestamp' };
    }

    const provided = signatureHeader.slice(SIGNATURE_PREFIX.length).toLowerCase();
    const expected = await computeHmacSha256Hex(
      record.hmac_secret,
      `${timestampHeader}\n${nonceHeader}\n${body}`,
    );
    if (!constantTimeEqual(provided, expected)) {
      return { ok: false, reason: 'signature_mismatch' };
    }

    // Replay rejection — only reachable with a VALID signature (see module doc).
    const nonceKey = `${NONCE_KV_PREFIX}${record.tenant_id}:${nonceHeader}`;
    try {
      const seen = await deps.replayKv.get(nonceKey);
      if (seen !== null) return { ok: false, reason: 'replayed_nonce' };
      await deps.replayKv.put(nonceKey, '1', { expirationTtl: NONCE_TTL_SECONDS });
    } catch (cause) {
      return { ok: false, reason: 'kv_error', cause };
    }
    signed = true;
  }

  return {
    ok: true,
    tenant_id: record.tenant_id,
    scopes: record.scopes,
    signed,
    // Conditional spread (exactOptionalPropertyTypes): only present when the KV record carried
    // the field, so `undefined` (absent) stays absent → the gate reads it as "inherit".
    ...(record.allowed_origins !== undefined ? { allowed_origins: record.allowed_origins } : {}),
  };
}

/**
 * Compute the HMAC-SHA256 of `data` keyed by `secretHex` and return the lower-case hex digest.
 * Uses the Worker-native Web Crypto API.
 */
export async function computeHmacSha256Hex(secretHex: string, data: string): Promise<string> {
  const keyBytes = hexToBytes(secretHex);
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return bytesToHex(new Uint8Array(sig));
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error('hmac_secret must be hex (even length)');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    const byte = Number.parseInt(clean.slice(i, i + 2), 16);
    if (Number.isNaN(byte)) throw new Error('hmac_secret contains non-hex chars');
    out[i / 2] = byte;
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/**
 * Constant-time string equality. Both inputs MUST be the same length string of identical alphabet
 * (e.g. lower-case hex) — we compare codepoint-by-codepoint without short-circuiting.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
