/**
 * API key authentication for the ingest Worker.
 *
 * MVP behavior:
 * 1. SDK sends `X-Estalara-API-Key: <opaque token>` on every request
 * 2. Worker looks up `api_key:<token>` in `KV_API_KEYS`. KV value is JSON describing the tenant.
 * 3. (Optional, server-side adapters): if `X-Estalara-Signature: hmac-sha256:<hex>` is present,
 *    the request body is HMAC-SHA256-verified against the tenant's `hmac_secret` (KV value field).
 *    Browser SDK callers omit the header — the public API key alone is sufficient identity for
 *    rate limiting + per-tenant routing. Server-side adapters MUST sign their requests.
 *
 * Postgres-backed lookup (with cache) replaces KV in Sprint 2 (TICKET-021+). The KV scheme is the
 * shape we expect Postgres to mirror, so consumers downstream (`AuthenticatedTenant`) shouldn't
 * need to change.
 *
 * @module apps/ingest/src/auth
 */

import type { KVNamespace } from '@cloudflare/workers-types';

/** Shape of a `KV_API_KEYS` value. Stored as JSON, looked up by `api_key:<token>` key. */
export interface ApiKeyRecord {
  /** Tenant UUID owning this API key. */
  tenant_id: string;
  /** Permission scopes (e.g. `read:events`, `write:adaptations`). Master Design J.2. */
  scopes: string[];
  /** Hex-encoded HMAC-SHA256 secret. Optional — public client keys may omit it. */
  hmac_secret?: string;
  /** Optional human label for ops dashboards. */
  label?: string;
  /**
   * Per-tenant browser-`Origin` allow-list projected onto this api-key record. [FOLLOW-642]
   *
   * WRITE PATH (choice per the FOLLOW-642 stub — "provisioning writes the column directly"):
   * these values are seeded into the KV record by tenant provisioning, alongside the api key
   * itself, NOT by a control-plane admin UI (that facade was removed by FOLLOW-622/PR #618).
   * The ingest Worker has no Postgres binding — KV IS the edge-cached tenant-config projection
   * it reads. Values SHOULD be stored as canonical origins (`scheme://host[:port]`), but the
   * gate re-normalizes defensively at read (see `origin-gate.ts` `normalizeToOrigin`), so a
   * full-URL / trailing-path value (the `z.string().url()` bug) still matches correctly.
   *
   * SEMANTICS (see `origin-gate.ts` `resolveOriginPolicy`):
   *   `undefined` / `null` (absent) → inherit the env allow-list (backward compat for
   *                                   Estalara's own tenant); `[]` → deny ALL cross-origin
   *                                   browser requests; `[...]` → allow exactly those origins.
   */
  allowed_origins?: string[] | null;
}

/** Result of a successful auth check — passed to downstream handlers. */
export interface AuthenticatedTenant {
  tenant_id: string;
  scopes: string[];
  /** True if request body was HMAC-verified. Server-side callers must pass this gate. */
  signed: boolean;
  /**
   * The tenant's browser-`Origin` allow-list, verbatim from the KV record (un-normalized).
   * Consumed by the per-tenant origin gate in `handlers/events.ts` (FOLLOW-642). See
   * {@link ApiKeyRecord.allowed_origins} for semantics.
   */
  allowed_origins?: string[] | null;
}

/** Reasons auth can fail. Caller maps these to HTTP 401 with appropriate detail. */
export type AuthFailure =
  | { reason: 'missing_key' }
  | { reason: 'unknown_key' }
  | { reason: 'malformed_signature' }
  | { reason: 'signature_mismatch' }
  | { reason: 'kv_error'; cause: unknown };

export type AuthResult = ({ ok: true } & AuthenticatedTenant) | ({ ok: false } & AuthFailure);

const SIGNATURE_PREFIX = 'hmac-sha256:';

/**
 * Validate an inbound request. Looks the API key up in KV, optionally verifies the HMAC body
 * signature.
 *
 * @param apiKey - Value of the `X-Estalara-API-Key` header (raw, unparsed).
 * @param signatureHeader - Value of the `X-Estalara-Signature` header (may be `null`/`undefined`).
 * @param body - Raw request body string (used for HMAC verification).
 * @param kv - The `KV_API_KEYS` binding from `env`.
 */
export async function authenticateRequest(
  apiKey: string | null | undefined,
  signatureHeader: string | null | undefined,
  body: string,
  kv: KVNamespace,
): Promise<AuthResult> {
  if (!apiKey) return { ok: false, reason: 'missing_key' };

  let raw: string | null;
  try {
    raw = await kv.get(`api_key:${apiKey}`);
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
    const provided = signatureHeader.slice(SIGNATURE_PREFIX.length).toLowerCase();
    const expected = await computeHmacSha256Hex(record.hmac_secret, body);
    if (!constantTimeEqual(provided, expected)) {
      return { ok: false, reason: 'signature_mismatch' };
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
