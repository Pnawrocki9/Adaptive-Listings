/**
 * The returning-buyer profile store (FOLLOW-1316, ESC-090; `docs/compliance/FOLLOW-1316-design-review.md`
 * R9-R21, R27). All store access sits here, so moving to the H003 table replaces this one file (R19).
 *
 * Importers are allow-listed (R15, `buyer-profile-store.importers.test.ts`): `/api/adapt`, the
 * self-service helper `buyer-profile-route.ts` and `/api/dsr/erase`. Analytics, lead ranking, agent
 * summaries and admin must not read it. It reads no other store, so a profile can never be rebuilt
 * from `quiz_runs` or `intent_sessions` (R23).
 *
 * The xid is a bearer credential. It never leaves this module except as a SHA-256 in a key (R17), and
 * no log or Sentry capture here carries anything but a failure code (R16).
 *
 * Expiry is absolute: `EXAT` at first write, `KEEPTTL` on overwrite, never touched by a read (R21).
 *
 * Commands always go as a POST to `/pipeline`, and every result is checked for its HTTP status and
 * its per-command error (R17, R18), unlike `tenant-schema.ts` and the session-keyed DSR erase.
 *
 * @module apps/control-plane/src/lib/buyer-profile-store
 */

import { createHash } from 'node:crypto';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { ArchetypeIdSchema, XID_RETENTION_DAYS } from '@estalara/shared';

import { afterResponse } from '@/lib/after-response';

/** Stored-value schema version; a value of another version does not restore. */
const PROFILE_SCHEMA_VERSION = 1;

/** Archetypes never persisted (R11, ESC-090 item 3). `neutral` carries nothing to restore. */
const NON_PERSISTABLE_ARCHETYPES: ReadonlySet<string> = new Set([
  'neutral',
  'diaspora_buyer',
  'golden_visa_buyer',
]);

/** Traits that may persist (R12, ESC-090 item 3). In-session copy still uses every trait. */
const PERSISTABLE_TRAITS = ['premium', 'works_from_home', 'seasoned_investor', 'will_let'] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const XID_RETENTION_MS = XID_RETENTION_DAYS * DAY_MS;
const TOMBSTONE_TTL_SECONDS = 24 * 60 * 60;
const ROUTE_QUOTA_WINDOW_SECONDS = 60;
const ROUTE_QUOTA_MAX = 60;

/** Budget for the read on the Decision API path; a slower store means neutral, not a slow page. */
const READ_TIMEOUT_MS = 1000;
const TIMEOUT_MS = 2000;

const STRICT_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The stored value: exactly these fields, anything else is refused (R9, R10). */
const StoredBuyerProfileSchema = z
  .object({
    v: z.literal(PROFILE_SCHEMA_VERSION),
    archetype: ArchetypeIdSchema.refine((a) => !NON_PERSISTABLE_ARCHETYPES.has(a)),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .refine((c) => Math.round(c * 100) / 100 === c),
    source: z.enum(['quiz', 'behavior']),
    traits: z.array(z.enum(PERSISTABLE_TRAITS)).optional(),
  })
  .strict();

type StoredBuyerProfile = z.infer<typeof StoredBuyerProfileSchema>;

/** A profile as a route may use it. */
type BuyerProfile = Omit<StoredBuyerProfile, 'v'>;

/** An xid the gate below has honoured, with the absolute second its profile must end at. */
interface ConsentedXid {
  xid: string;
  expiresAtSeconds: number;
}

type FailureCode =
  | 'redis_unconfigured'
  | 'redis_unreachable'
  | 'redis_http_error'
  | 'redis_command_error'
  | 'stored_value_invalid'
  | 'api_key_lookup_failed';

type PipelineOutcome = { ok: true; replies: unknown[] } | { ok: false; code: FailureCode };

// ─── Transport ────────────────────────────────────────────────────────────────

/** Capture a store failure by its code only (R16); nothing from a driver, no `cause`. */
export function reportBuyerProfileFailure(code: FailureCode): void {
  console.error('[buyer-profile] failure:', code);
  afterResponse(() => {
    Sentry.captureException(new Error(`buyer_profile ${code}`), {
      tags: { area: 'buyer_profile', error_code: code },
    });
    return Promise.resolve();
  });
}

function isReplyList(value: unknown): value is ({ result?: unknown; error?: unknown } | null)[] {
  return Array.isArray(value);
}

/** POST the commands to `/pipeline`; ok only when the HTTP status and every reply are clean. */
async function redisPipeline(
  commands: string[][],
  timeoutMs = TIMEOUT_MS,
): Promise<PipelineOutcome> {
  const base = process.env.UPSTASH_REDIS_URL?.replace(/\/$/, '');
  if (!base) return { ok: false, code: 'redis_unconfigured' };
  const token = process.env.UPSTASH_REDIS_TOKEN;

  let res: Response;
  try {
    res = await fetch(`${base}/pipeline`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, code: 'redis_unreachable' };
  }
  if (!res.ok) return { ok: false, code: 'redis_http_error' };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, code: 'redis_http_error' };
  }
  if (!isReplyList(body) || body.length !== commands.length) {
    return { ok: false, code: 'redis_command_error' };
  }
  if (body.some((reply) => reply === null || typeof reply !== 'object' || 'error' in reply)) {
    return { ok: false, code: 'redis_command_error' };
  }
  return { ok: true, replies: body.map((reply) => reply?.result ?? null) };
}

function xidHash(xid: string): string {
  return createHash('sha256').update(xid).digest('hex');
}

function profileKey(tenantId: string, xid: string): string {
  return `buyer_profile:${tenantId}:${xidHash(xid)}`;
}

function tombstoneKey(tenantId: string, xid: string): string {
  return `buyer_profile_tombstone:${tenantId}:${xidHash(xid)}`;
}

/** A store that was never configured holds nothing; with the flag on that absence is an error. */
function isUnconfiguredAndOff(code: FailureCode): boolean {
  return code === 'redis_unconfigured' && !isBuyerProfileEnabled();
}

// ─── The gate ─────────────────────────────────────────────────────────────────

/** The server flag (R8): off means the xid is ignored on `/api/adapt`. Default off. */
function isBuyerProfileEnabled(): boolean {
  return process.env.BUYER_PROFILE_ENABLED === 'true';
}

/** True for the only id shape this feature honours (R5). */
export function isStrictXid(value: unknown): value is string {
  return typeof value === 'string' && STRICT_UUID_V4.test(value);
}

/**
 * The route's consent gate (R5, R8, R21): the xid counts only with the flag on, canonical
 * `consented`, a strict v4 and a usable `xid_created_at`. Anything else behaves as if no xid was sent.
 * Independent of `consent_mode_enabled`.
 *
 * @param input - The request's raw fields.
 * @param nowMs - The current time.
 * @returns the honoured xid with its absolute expiry, or null.
 */
export function honourConsentedXid(
  input: { xid: unknown; xidCreatedAt: unknown; consentState: unknown },
  nowMs: number,
): ConsentedXid | null {
  if (!isBuyerProfileEnabled()) return null;
  if (input.consentState !== 'consented') return null;
  if (!isStrictXid(input.xid)) return null;
  const createdAt = input.xidCreatedAt;
  if (typeof createdAt !== 'number' || !Number.isSafeInteger(createdAt) || createdAt <= 0) {
    return null;
  }
  const xidEndsAt = createdAt + XID_RETENTION_MS;
  if (xidEndsAt <= nowMs) return null;
  return {
    xid: input.xid,
    expiresAtSeconds: Math.floor(Math.min(nowMs + XID_RETENTION_MS, xidEndsAt) / 1000),
  };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Read a profile for the restore; never extends its life (R21).
 *
 * @param tenantId - The server-derived tenant.
 * @param xid - An xid from {@link honourConsentedXid}.
 * @returns `hit`, `miss`, or `error`, which the caller serves as neutral (R18).
 */
export async function readBuyerProfile(
  tenantId: string,
  xid: string,
): Promise<{ result: 'hit'; profile: BuyerProfile } | { result: 'miss' | 'error' }> {
  const out = await redisPipeline([['GET', profileKey(tenantId, xid)]], READ_TIMEOUT_MS);
  if (!out.ok) {
    reportBuyerProfileFailure(out.code);
    return { result: 'error' };
  }
  const profile = parseStored(out.replies[0]);
  if (profile === 'absent') return { result: 'miss' };
  if (profile === 'invalid') {
    reportBuyerProfileFailure('stored_value_invalid');
    return { result: 'error' };
  }
  return { result: 'hit', profile };
}

function parseStored(raw: unknown): BuyerProfile | 'absent' | 'invalid' {
  if (raw === null) return 'absent';
  if (typeof raw !== 'string') return 'invalid';
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return 'invalid';
  }
  const parsed = StoredBuyerProfileSchema.safeParse(json);
  if (!parsed.success) return 'invalid';
  return {
    archetype: parsed.data.archetype,
    confidence: parsed.data.confidence,
    source: parsed.data.source,
    ...(parsed.data.traits ? { traits: parsed.data.traits } : {}),
  };
}

/**
 * Read a profile for the buyer's own access or export request, with when it ends.
 *
 * @param tenantId - The key's tenant.
 * @param xid - The strict xid from the request body.
 * @returns the profile or null with its expiry; `not_configured` when no store exists and the flag
 *   is off; `failed` on any store error.
 */
export async function readBuyerProfileForSubject(
  tenantId: string,
  xid: string,
): Promise<
  | { result: 'found'; profile: BuyerProfile; expiresAt: string }
  | { result: 'not_found' | 'not_configured' | 'failed' }
> {
  const key = profileKey(tenantId, xid);
  const out = await redisPipeline([
    ['GET', key],
    ['PTTL', key],
  ]);
  if (!out.ok) {
    if (isUnconfiguredAndOff(out.code)) return { result: 'not_configured' };
    reportBuyerProfileFailure(out.code);
    return { result: 'failed' };
  }
  const profile = parseStored(out.replies[0]);
  if (profile === 'absent') return { result: 'not_found' };
  if (profile === 'invalid' || typeof out.replies[1] !== 'number') {
    reportBuyerProfileFailure('stored_value_invalid');
    return { result: 'failed' };
  }
  return {
    result: 'found',
    profile,
    expiresAt: new Date(Date.now() + out.replies[1]).toISOString(),
  };
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Write or overwrite a profile. The caller has already decided the write is due (R14); this enforces
 * what may be stored (R9-R12), the absolute expiry (R21) and the tombstone (R27).
 *
 * A delete sets its tombstone BEFORE its `DEL`, and this write checks for the tombstone again AFTER
 * its `SET`. Whichever order the two interleave in, either the `DEL` lands after the `SET` or the
 * second check sees the tombstone, so no profile comes back (NC-11).
 *
 * @param tenantId - The server-derived tenant.
 * @param consented - From {@link honourConsentedXid}.
 * @param candidate - The resolved state; a non-persistable archetype writes nothing, other traits drop.
 * @returns `written`, `refused` (nothing stored, by rule), or `failed`.
 */
export async function writeBuyerProfile(
  tenantId: string,
  consented: ConsentedXid,
  candidate: {
    archetype: string;
    confidence: number;
    source: 'quiz' | 'behavior';
    traits: readonly string[] | undefined;
  },
): Promise<'written' | 'refused' | 'failed'> {
  const persistableTraits = PERSISTABLE_TRAITS.filter((t) => candidate.traits?.includes(t));
  const parsed = StoredBuyerProfileSchema.safeParse({
    v: PROFILE_SCHEMA_VERSION,
    archetype: candidate.archetype,
    confidence: roundProfileConfidence(candidate.confidence),
    source: candidate.source,
    ...(persistableTraits.length > 0 ? { traits: persistableTraits } : {}),
  });
  if (!parsed.success) return 'refused';

  const key = profileKey(tenantId, consented.xid);
  const tombstone = tombstoneKey(tenantId, consented.xid);
  const value = JSON.stringify(parsed.data);

  const before = await redisPipeline([['EXISTS', tombstone]]);
  if (!before.ok) return failedWrite(before.code);
  if (before.replies[0] === 1) return 'refused';

  const written = await redisPipeline([
    ['SET', key, value, 'NX', 'EXAT', String(consented.expiresAtSeconds)],
    ['SET', key, value, 'XX', 'KEEPTTL'],
    ['EXISTS', tombstone],
  ]);
  if (!written.ok) return failedWrite(written.code);
  if (written.replies[2] === 1) {
    const undone = await redisPipeline([['DEL', key]]);
    if (!undone.ok) return failedWrite(undone.code);
    return 'refused';
  }
  return 'written';
}

function failedWrite(code: FailureCode): 'failed' {
  reportBuyerProfileFailure(code);
  return 'failed';
}

/** Stored precision, two decimals (section 3); the route compares this value to its threshold. */
export function roundProfileConfidence(confidence: number): number {
  return Math.round(confidence * 100) / 100;
}

// ─── Delete ───────────────────────────────────────────────────────────────────

/**
 * Delete a profile and leave a 24-hour hash-only tombstone that refuses later writes (R27).
 *
 * @param tenantId - The tenant.
 * @param xid - A strict xid.
 * @returns `deleted`, `not_found`, `not_configured` (no store and the flag off), or `failed`; a
 *   caller must answer `failed` with a non-2xx (R18).
 */
export async function deleteBuyerProfile(
  tenantId: string,
  xid: string,
): Promise<'deleted' | 'not_found' | 'not_configured' | 'failed'> {
  const out = await redisPipeline([
    ['SET', tombstoneKey(tenantId, xid), '1', 'EX', String(TOMBSTONE_TTL_SECONDS)],
    ['DEL', profileKey(tenantId, xid)],
  ]);
  if (!out.ok) {
    if (isUnconfiguredAndOff(out.code)) return 'not_configured';
    reportBuyerProfileFailure(out.code);
    return 'failed';
  }
  return out.replies[1] === 1 ? 'deleted' : 'not_found';
}

// ─── Route quota ──────────────────────────────────────────────────────────────

/**
 * Take one request from a client's per-minute quota for the self-service routes. A random-xid flood
 * would otherwise mint a tombstone per request. The client is held as a hash for one minute.
 *
 * A store failure allows the request: the operation that follows fails loud on its own, and a limiter
 * must not be what stands between a buyer and a withdrawal.
 *
 * @param tenantId - The key's tenant.
 * @param client - The caller's address as the platform reports it.
 * @returns false when the quota is spent.
 */
export async function takeProfileRouteQuota(tenantId: string, client: string): Promise<boolean> {
  const key = `buyer_profile_quota:${tenantId}:${createHash('sha256').update(client).digest('hex')}`;
  const out = await redisPipeline([
    ['SET', key, '0', 'NX', 'EX', String(ROUTE_QUOTA_WINDOW_SECONDS)],
    ['INCR', key],
  ]);
  if (!out.ok) return true;
  return typeof out.replies[1] !== 'number' || out.replies[1] <= ROUTE_QUOTA_MAX;
}
