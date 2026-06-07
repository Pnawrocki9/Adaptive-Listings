/**
 * Session management — anonymous fingerprint, no PII.
 *
 * Session ID is a SHA-256 hex string derived from stable browser signals.
 * Persisted in sessionStorage so it survives page navigations within a tab.
 *
 * Consent state is stored in localStorage (not sessionStorage) so it persists
 * across page loads and tab sessions — users should not be re-prompted every visit.
 *
 * Cross-session ID (xid) is a UUID stored in localStorage with a 90-day TTL.
 * It provides cross-session continuity for returning visitors as disclosed in
 * DPIA §13.2. It is erased on consent denial or withdrawal (FOLLOW-139).
 *
 * @module @estalara/sdk/core/session
 */

/** Consent state stored in localStorage under 'estalara_consent'. */
export type ConsentState = 'granted' | 'denied' | 'pending';

const CONSENT_STORAGE_KEY = 'estalara_consent';

/**
 * Read the current consent state from localStorage.
 * Returns 'pending' if the user has not yet made a decision, or if localStorage
 * is unavailable (SSR, sandboxed iframe, or storage permission denied).
 */
export function getConsentState(): ConsentState {
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (raw === 'granted' || raw === 'denied') return raw;
    return 'pending';
  } catch {
    // SSR / iframe sandboxed context — treat as pending
    return 'pending';
  }
}

/**
 * Persist a consent decision to localStorage.
 * Fails silently if storage is unavailable — consent only persists for this session.
 */
export function setConsentState(state: 'granted' | 'denied'): void {
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, state);
  } catch {
    // swallow — consent persists only for this session if storage unavailable
  }
}

export interface SessionState {
  /** SHA-256 hex fingerprint — 64 chars, no PII. */
  sessionId: string;
  startedAt: number;
  pageCount: number;
}

const SESSION_STORAGE_KEY = '__estalara_session__';

/**
 * Generate a deterministic 64-char hex session ID from stable browser signals.
 * Uses SubtleCrypto (available in all modern browsers and Node 18+).
 */
export async function generateSessionId(): Promise<string> {
  const parts = [
    typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown-ua',
    typeof screen !== 'undefined' ? `${String(screen.width)}x${String(screen.height)}` : '0x0',
    typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC',
    typeof navigator !== 'undefined' ? navigator.language : 'en',
  ];

  const fingerprint = parts.join('|');
  const encoder = new TextEncoder();
  const data = encoder.encode(fingerprint);
  const buffer = await globalThis.crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Read a session from sessionStorage. Returns null if unavailable or missing. */
function readStoredSession(): SessionState | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SessionState;
  } catch {
    return null;
  }
}

/** Persist a session to sessionStorage. Fails silently. */
function writeSession(session: SessionState): void {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // sessionStorage not available — continue without persistence
  }
}

/**
 * Get the existing session or create a new one.
 * Never throws — falls back to an in-memory session if storage is unavailable.
 */
export async function getOrCreateSession(): Promise<SessionState> {
  const stored = readStoredSession();
  if (stored) return stored;

  const session: SessionState = {
    sessionId: await generateSessionId(),
    startedAt: Date.now(),
    pageCount: 0,
  };

  writeSession(session);
  return session;
}

/** Return a new session state with pageCount incremented. */
export function incrementPageCount(session: SessionState): SessionState {
  const updated = { ...session, pageCount: session.pageCount + 1 };
  writeSession(updated);
  return updated;
}

// ---------------------------------------------------------------------------
// Cross-session identifier (localStorage, 90-day TTL) — DPIA §13.2 / FOLLOW-139
// ---------------------------------------------------------------------------

/** localStorage key for the cross-session pseudonymous identifier. */
export const XSESSION_STORAGE_KEY = '__estalara_xid__';

/** 90 days expressed in milliseconds. */
const XID_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Cross-session identifier shape persisted to localStorage.
 * `id` is a UUID v4 string. `created_at` is a Unix millisecond timestamp.
 */
export interface CrossSessionId {
  id: string;
  created_at: number;
}

/** In-memory cache so repeated calls within a page load do not hit localStorage. */
let _xidCache: CrossSessionId | null = null;

/**
 * Generate a UUID v4 string using `crypto.randomUUID()` when available,
 * falling back to a Math.random-based implementation for environments that
 * lack SubtleCrypto (e.g. very old browsers).
 */
function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: RFC 4122 v4 UUID using Math.random

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;

    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Get the cross-session identifier, creating or rotating it as needed.
 *
 * - On first call (no entry in localStorage): generates a new UUID and persists it.
 * - If the stored entry is older than 90 days: rotates to a new UUID.
 * - Otherwise: returns the existing entry unchanged.
 *
 * Never throws — returns an in-memory-only entry if localStorage is unavailable.
 * Does NOT erase on any path; call `eraseCrossSessionId()` for that.
 */
export function getOrCreateCrossSessionId(): Promise<CrossSessionId> {
  if (_xidCache !== null) return Promise.resolve(_xidCache);

  try {
    const raw = localStorage.getItem(XSESSION_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CrossSessionId;
      if (
        typeof parsed.id === 'string' &&
        typeof parsed.created_at === 'number' &&
        Date.now() - parsed.created_at <= XID_TTL_MS
      ) {
        _xidCache = parsed;
        return Promise.resolve(_xidCache);
      }
    }
  } catch {
    // localStorage unavailable or JSON parse failure — fall through to create new
  }

  const fresh: CrossSessionId = {
    id: generateUuid(),
    created_at: Date.now(),
  };

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

// ---------------------------------------------------------------------------
// Registered-user lead ID derivation (FOLLOW-197 / CHAT-003)
// ---------------------------------------------------------------------------

/**
 * sessionStorage key for the derived pseudonymous lead identifier.
 *
 * Rule L compliance: the raw `user_uuid` from Keycloak is NEVER stored. Only
 * the first 16 hex chars of its SHA-256 digest are persisted here. This token
 * cannot be reversed to the original UUID without the pre-image.
 *
 * Stored in sessionStorage (tab-lifetime) — NOT localStorage — so it cannot
 * accumulate across sessions without repeated authentication (Mode A compliance).
 */
export const LEAD_ID_STORAGE_KEY = '__estalara_lead_id__';

/**
 * Derive a pseudonymous `lead_id` from a Keycloak user UUID.
 *
 * Computes SHA-256(user_uuid) and returns the first 16 hex characters.
 * The raw UUID is NEVER stored anywhere (Rule L).
 *
 * @param userUuid - Keycloak `sub` claim (UUID string).
 * @returns 16-character lowercase hex string.
 */
export async function deriveLeadId(userUuid: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userUuid));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}
