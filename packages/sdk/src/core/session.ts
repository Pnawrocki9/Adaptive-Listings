/**
 * Session management — anonymous fingerprint, no PII.
 *
 * Session ID is a SHA-256 hex string derived from stable browser signals.
 * Persisted in sessionStorage so it survives page navigations within a tab.
 *
 * Consent state is stored in localStorage (not sessionStorage) so it persists
 * across page loads and tab sessions — users should not be re-prompted every visit.
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
