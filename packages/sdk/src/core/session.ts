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
 * Intent-state persistence (FOLLOW-176):
 * The resolved archetype/intent is written to sessionStorage keyed by sessionId
 * so that subsequent listing navigations within the same tab can immediately apply
 * the already-inferred archetype without re-accumulating behavioral signals.
 * Persisted only when consent is granted; cleared on consent denial/withdrawal.
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

/**
 * Return the stored session ID without creating a new session.
 *
 * Used by the consent-denial path in `init()` to erase any persisted intent
 * state when the session already exists in sessionStorage (returning visitor
 * who previously granted consent but now revisits with denied consent, or
 * mid-session consent withdrawal). Returns `undefined` when no session is stored.
 *
 * @internal exported for use by index.ts consent gates only
 */
export function peekStoredSessionId(): string | undefined {
  return readStoredSession()?.sessionId;
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

// ---------------------------------------------------------------------------
// Intent-state persistence (FOLLOW-176)
// Persists resolved archetype + full IntentState to sessionStorage so
// subsequent listing navigations in the same tab rehydrate immediately.
// ---------------------------------------------------------------------------

/**
 * Current schema version for the persisted intent state envelope.
 *
 * BUMP THIS whenever `IntentState.probabilities` keys or types change so that
 * stale envelopes in sessionStorage are rejected by `rehydrateIntentState()`.
 * The version check lives in the `envelope.version !== INTENT_STATE_SCHEMA_VERSION`
 * guard inside `rehydrateIntentState()`.
 */
export const INTENT_STATE_SCHEMA_VERSION = 1 as const;

/**
 * Default staleness window in milliseconds (30 minutes).
 * State saved more than this many ms ago is treated as expired and ignored.
 */
export const INTENT_STATE_STALE_MS = 30 * 60 * 1000;

/**
 * Envelope written to sessionStorage for each persisted intent state.
 *
 * Fields:
 *   `version`   — incremented whenever the shape of `state` changes, so
 *                 a rehydration attempt with a mismatched version is rejected.
 *   `savedAt`   — Unix ms timestamp of the write; used for the staleness guard.
 *   `state`     — The full IntentState object serialised as-is.
 *
 * This type intentionally avoids importing IntentState from intent.ts to keep
 * session.ts free of circular dependencies. The caller (index.ts) is responsible
 * for passing a correctly-shaped IntentState.
 */
export interface PersistedIntentEnvelope {
  version: typeof INTENT_STATE_SCHEMA_VERSION;
  savedAt: number;
  state: unknown;
}

/**
 * Build the sessionStorage key for the persisted intent state of a session.
 *
 * The key is scoped to the sessionId so multiple concurrent tabs (each with
 * their own session) cannot collide.
 *
 * @internal exported for testing only
 */
export function intentStateStorageKey(sessionId: string): string {
  return `estalara_intent_${sessionId}`;
}

/**
 * Persist `intentState` for `sessionId` to sessionStorage.
 *
 * Consent gate: callers MUST check consent before calling this function.
 * The function itself does not re-read consent so that the gate lives in one
 * place (index.ts) and is not silently skipped.
 *
 * Fails silently — sessionStorage unavailable or quota exceeded must never
 * throw to the host page.
 *
 * @param sessionId   - The current session's identifier (used as key suffix).
 * @param intentState - The full IntentState object to persist.
 */
export function persistIntentState(sessionId: string, intentState: unknown): void {
  const envelope: PersistedIntentEnvelope = {
    version: INTENT_STATE_SCHEMA_VERSION,
    savedAt: Date.now(),
    state: intentState,
  };
  try {
    sessionStorage.setItem(intentStateStorageKey(sessionId), JSON.stringify(envelope));
  } catch {
    // sessionStorage unavailable or quota exceeded — continue in-memory only
  }
}

/**
 * Attempt to rehydrate a previously persisted IntentState.
 *
 * Returns `null` (and leaves sessionStorage untouched) when:
 *   - No entry exists for `sessionId`
 *   - The stored envelope fails to parse
 *   - `envelope.version` !== INTENT_STATE_SCHEMA_VERSION (schema change)
 *   - `envelope.savedAt` is older than `staleMsThreshold` (default 30 min)
 *   - The envelope's `state` field is missing or not an object
 *
 * On any stale/mismatched entry the key is proactively removed so the next
 * `persistIntentState` call always writes a fresh envelope.
 *
 * Consent gate: callers MUST check consent before calling this function.
 *
 * @param sessionId        - The current session's identifier.
 * @param staleMsThreshold - Maximum age in ms before an entry is considered stale.
 *                           Defaults to INTENT_STATE_STALE_MS (30 min).
 */
export function rehydrateIntentState(
  sessionId: string,
  staleMsThreshold: number = INTENT_STATE_STALE_MS,
): unknown {
  const key = intentStateStorageKey(sessionId);
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;

    const envelope = JSON.parse(raw) as Partial<PersistedIntentEnvelope>;

    // Version guard — reject if schema version has changed.
    if (envelope.version !== INTENT_STATE_SCHEMA_VERSION) {
      sessionStorage.removeItem(key);
      return null;
    }

    // Staleness guard — reject if saved more than staleMsThreshold ms ago.
    if (typeof envelope.savedAt !== 'number' || Date.now() - envelope.savedAt > staleMsThreshold) {
      sessionStorage.removeItem(key);
      return null;
    }

    // Shape guard — state must be a non-null object.
    if (!envelope.state || typeof envelope.state !== 'object') {
      sessionStorage.removeItem(key);
      return null;
    }

    return envelope.state;
  } catch {
    // JSON parse failure or sessionStorage unavailable
    return null;
  }
}

/**
 * Erase the persisted intent state for `sessionId` from sessionStorage.
 *
 * Called on consent denial or withdrawal so no archetype data outlives consent
 * (FOLLOW-176 AC3 / Mode A compliance).
 *
 * Also called without a sessionId when the session has not yet been established
 * (e.g. early consent denial before `getOrCreateSession()` runs). In that case
 * the function is a no-op because there is nothing to erase.
 *
 * Fails silently — storage unavailability must never propagate to the host page.
 *
 * @param sessionId - The session ID whose intent state should be erased.
 *                    Pass `undefined` to skip (pre-session denial path).
 */
export function eraseIntentState(sessionId: string | undefined): void {
  if (!sessionId) return;
  try {
    sessionStorage.removeItem(intentStateStorageKey(sessionId));
    sessionStorage.removeItem(resolvedArchetypeStorageKey(sessionId));
  } catch {
    // sessionStorage unavailable — nothing to erase
  }
}

/**
 * Build the sessionStorage key for the session's resolved source-of-truth archetype.
 *
 * @internal exported for testing only
 */
export function resolvedArchetypeStorageKey(sessionId: string): string {
  return `estalara_resolved_archetype_${sessionId}`;
}

/**
 * The session's resolved source-of-truth archetype together with the confidence it was
 * resolved at (FOLLOW-380 bug (c) / RETRO-105 LG-3).
 */
export interface ResolvedArchetype {
  /** The resolved non-neutral archetype string (e.g. `family_buyer`). */
  archetype: string;
  /** The confidence the archetype was resolved at, re-pinned on neutral-decay restore. */
  confidence: number;
}

/**
 * Fallback confidence for a legacy SoT entry persisted in the pre-FOLLOW-380 plain-string
 * format (archetype only, no confidence). Chosen above BOTH the server directive gate
 * (`CONFIDENCE_THRESHOLD = 0.6`, route.ts) AND the SDK DOM-adaptation floor
 * (`DOM_ADAPT_CONFIDENCE_FLOOR = 0.5`, FOLLOW-343) so a restored legacy SoT archetype is not
 * silently suppressed by either gate. Matches quiz-leaf confidence semantics (a resolved SoT
 * archetype is a deliberate high-confidence assertion, not a cold-start guess).
 */
const RESOLVED_ARCHETYPE_FALLBACK_CONFIDENCE = 0.85;

/**
 * Persist the latest *non-neutral* archetype the engine has resolved for `sessionId`,
 * together with the confidence it was resolved at.
 *
 * This is the session's source-of-truth (SoT) archetype. It is seeded by the quiz answer
 * (§D.6 / FOLLOW-344 — the quiz is the primary explicit signal) and then UPDATED whenever a
 * subsequent strong signal — chat-intent (`applyChatIntentPrior`) or sustained behavioral
 * evidence — resolves a *different* non-neutral archetype, so the SoT always reflects the
 * buyer's most recently evident true need (CEO 2026-06-22: drift away from the quiz answer is
 * legitimate, but ONLY toward another non-neutral archetype, never to `neutral`).
 *
 * Why this exists: routine behavioral signals (scroll, rapid listing views via
 * `applyListingViewRate`, dwell) push probability mass toward `neutral`, which over a session
 * can decay `IntentState.archetype` to `neutral` and silently turn OFF cross-listing
 * adaptation. `refreshDirectives` restores this persisted SoT whenever the live archetype has
 * decayed to `neutral`, so every subsequent listing keeps adapting. Works WITH or WITHOUT the
 * quiz (a quiz-disabled tenant seeds the SoT from behavioral/chat resolution instead).
 *
 * The `confidence` is persisted (FOLLOW-380 bug (c)) so the neutral-decay restore can re-pin
 * BOTH the archetype and the confidence it was resolved at — otherwise the restore leaves the
 * decayed neutral-era low confidence in place, which flows to `body.confidence` and causes the
 * server (`confidence <= 0.6 → no directives`) and the SDK DOM floor to suppress the restored
 * adaptation (RETRO-105 LG-3).
 *
 * Survives in-tab navigation AND full reload (sessionStorage); erased together with the intent
 * state on consent denial (Mode A compliance). Callers MUST gate on consent (mirrors
 * persistIntentState). Fails silently — storage unavailability must never reach the host page.
 */
export function persistResolvedArchetype(
  sessionId: string,
  archetype: string,
  confidence: number,
): void {
  try {
    sessionStorage.setItem(
      resolvedArchetypeStorageKey(sessionId),
      JSON.stringify({ archetype, confidence }),
    );
  } catch {
    // sessionStorage unavailable — continue in-memory only
  }
}

/**
 * Read the session's resolved source-of-truth archetype + confidence, or `null` if none
 * persisted.
 *
 * Backward-compatible with the pre-FOLLOW-380 plain-string format (a bare archetype string
 * with no confidence): such a value is returned with `RESOLVED_ARCHETYPE_FALLBACK_CONFIDENCE`
 * so a session persisted by an older bundle before an in-session redeploy still restores
 * above both gates.
 *
 * Fails silently to `null` when sessionStorage is unavailable.
 */
export function readResolvedArchetype(sessionId: string): ResolvedArchetype | null {
  try {
    const raw = sessionStorage.getItem(resolvedArchetypeStorageKey(sessionId));
    if (raw === null) return null;
    // Current format (FOLLOW-380): JSON `{ archetype, confidence }`.
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as { archetype?: unknown }).archetype === 'string'
      ) {
        const obj = parsed as { archetype: string; confidence?: unknown };
        return {
          archetype: obj.archetype,
          confidence:
            typeof obj.confidence === 'number'
              ? obj.confidence
              : RESOLVED_ARCHETYPE_FALLBACK_CONFIDENCE,
        };
      }
    } catch {
      // Not JSON — fall through to legacy plain-string handling below.
    }
    // Legacy format: bare archetype string persisted before FOLLOW-380 added confidence.
    return { archetype: raw, confidence: RESOLVED_ARCHETYPE_FALLBACK_CONFIDENCE };
  } catch {
    return null;
  }
}
