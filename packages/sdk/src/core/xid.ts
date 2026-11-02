/**
 * Cross-session identifier (localStorage, 90-day TTL) — DPIA §13.2 / FOLLOW-139, FOLLOW-1316.
 *
 * Apart from `session.ts` because that module must have zero imports:
 * `scripts/check-session-identifier-corpus-sync.mjs` executes it under Node type-stripping.
 *
 * @module @estalara/sdk/core/xid
 */

import { XID_RETENTION_DAYS } from '@estalara/shared';

import { hasProfilingOptOutKey } from './profiling-opt-out.js';
import {
  drawUuid,
  getConsentState,
  isConsentTextStale,
  readConsentTextVersion,
} from './session.js';

/** localStorage key for the cross-session pseudonymous identifier. */
const XSESSION_STORAGE_KEY = '__estalara_xid__';

/** The id's life; the same constant sets the server profile's expiry (FOLLOW-1316, R22). */
const XID_TTL_MS = XID_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Cross-session identifier shape persisted to localStorage.
 * `id` is a UUID v4 string. `created_at` is a Unix millisecond timestamp.
 */
interface CrossSessionId {
  id: string;
  created_at: number;
  /**
   * This id has left the browser at least once, so a server profile may exist under it. Absent means
   * there is nothing to delete and the id must not leave on a denial either (FOLLOW-1316, R26).
   */
  sent?: true;
  /** The logged-in lead this id was sent for: another lead gets no restore (R43). */
  lead?: string;
}

/** In-memory cache so repeated calls within a page load do not hit localStorage. */
let _xidCache: CrossSessionId | null = null;

/** The stored id, read fresh and never minted; null when absent or malformed. */
export function readStoredXid(): CrossSessionId | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(XSESSION_STORAGE_KEY) ?? 'null') as {
      id?: unknown;
      created_at?: unknown;
    } | null;
    return typeof parsed?.id === 'string' && typeof parsed.created_at === 'number'
      ? (parsed as CrossSessionId)
      : null;
  } catch {
    return null;
  }
}

/** True until the id, and so any server profile under it, has expired (R21). */
export function isXidLive(xid: CrossSessionId): boolean {
  return Date.now() - xid.created_at <= XID_TTL_MS;
}

/**
 * The xid if it may be sent right now, else null (FOLLOW-1316, R2). Read-only: it reads
 * `localStorage` on every call, bypasses `_xidCache`, and never mints, so a second tab's withdrawal
 * stops this tab's next send. It also needs SubtleCrypto: without a signature the delete could never
 * be sent, and an id must not leave a browser that cannot take it back (R25).
 *
 * @param leadId - The logged-in lead id, or empty when anonymous.
 */
export function readSendableXid(leadId: string): CrossSessionId | null {
  if (
    getConsentState() !== 'granted' ||
    readConsentTextVersion() === null ||
    isConsentTextStale() ||
    (globalThis.navigator as { globalPrivacyControl?: boolean } | undefined)
      ?.globalPrivacyControl === true ||
    hasProfilingOptOutKey() ||
    !(globalThis.crypto as Partial<Crypto> | undefined)?.subtle
  ) {
    return null;
  }
  const xid = readStoredXid();
  return xid && isXidLive(xid) && !(leadId && xid.lead && xid.lead !== leadId) ? xid : null;
}

/**
 * Note BEFORE sending that the id is leaving the browser, so a later denial deletes the profile.
 * @returns false when that could not be noted: the caller must not send, or the buyer is stranded.
 */
export function markXidSent(xid: CrossSessionId, leadId: string): boolean {
  try {
    const sent: CrossSessionId = { ...xid, sent: true };
    if (leadId && !xid.lead) sent.lead = leadId;
    localStorage.setItem(XSESSION_STORAGE_KEY, JSON.stringify(sent));
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the cross-session identifier, creating or rotating it as needed.
 *
 * - On first call (no entry in localStorage): generates a new UUID and persists it.
 * - If the stored entry is older than 90 days: rotates to a new UUID.
 * - Otherwise: returns the existing entry unchanged.
 *
 * Never throws — returns an in-memory-only entry if localStorage is unavailable, and null without a
 * CSPRNG: the id is a bearer credential once it leaves the browser (FOLLOW-1316, R1).
 * Does NOT erase on any path; call `eraseCrossSessionId()` for that. Never use it to send: it mints
 * on read. {@link readSendableXid} is the only way out of the browser.
 */
export function getOrCreateCrossSessionId(): Promise<CrossSessionId | null> {
  if (_xidCache !== null) return Promise.resolve(_xidCache);

  const stored = readStoredXid();
  if (stored && isXidLive(stored)) {
    _xidCache = stored;
    return Promise.resolve(_xidCache);
  }

  const id = drawUuid();
  if (!id) return Promise.resolve(null);
  const fresh: CrossSessionId = { id, created_at: Date.now() };

  try {
    localStorage.setItem(XSESSION_STORAGE_KEY, JSON.stringify(fresh));
  } catch {
    // localStorage unavailable — continue with in-memory-only entry
  }

  _xidCache = fresh;
  return Promise.resolve(_xidCache);
}

/**
 * Erase the cross-session identifier from localStorage and clear the in-memory cache.
 *
 * Call this when the user denies or withdraws consent (DPIA §13.2 erasure obligation).
 * After this call, `getOrCreateCrossSessionId()` will generate a fresh identifier on
 * its next invocation — do not call it again until/unless consent is re-granted.
 */
export function eraseCrossSessionId(): void {
  _xidCache = null;
  try {
    localStorage.removeItem(XSESSION_STORAGE_KEY);
  } catch {
    // localStorage unavailable — in-memory cache already cleared above
  }
}
