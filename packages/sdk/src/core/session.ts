/**
 * Session management — anonymous, random, no PII.
 *
 * Session ID is a randomly-minted UUID v4 (FOLLOW-1106 / ESC-070 Path C).
 * It is derived from NOTHING about the device or the visitor. Persisted in
 * sessionStorage so it survives page navigations and reloads within a tab.
 *
 * Consent state is stored in localStorage (not sessionStorage) so it persists
 * across page loads and tab sessions — users should not be re-prompted every visit.
 *
 * Cross-session ID (xid) is a UUID stored in localStorage with a 90-day TTL.
 * It provides cross-session continuity for returning visitors as disclosed in
 * DPIA §13.2. It is erased on consent denial or withdrawal (FOLLOW-139). It lives in `xid.ts`.
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

/** localStorage key of the consent text version the buyer accepted (FOLLOW-1316, R6). */
const CONSENT_TEXT_VERSION_KEY = 'estalara_consent_text_version';

/**
 * The oldest accepted consent text under which the xid may leave the browser (FOLLOW-1316, R6).
 * Raising it stops sending and re-prompts every grant recorded below it, which is how counsel's text
 * change reaches existing consents. Compared as a string: `text_version` is `YYYY-MM-DD.n`.
 */
const MIN_PROFILE_TEXT_VERSION = '2026-08-24.1';

/**
 * The accepted consent text version, or null when none was recorded: storage unavailable, or a
 * grant made before FOLLOW-1316.
 */
export function readConsentTextVersion(): string | null {
  try {
    return localStorage.getItem(CONSENT_TEXT_VERSION_KEY);
  } catch {
    return null;
  }
}

/** Record the accepted version; null erases it (every denial path). */
export function setConsentTextVersion(version: string | null): void {
  try {
    if (version === null) localStorage.removeItem(CONSENT_TEXT_VERSION_KEY);
    else localStorage.setItem(CONSENT_TEXT_VERSION_KEY, version);
  } catch {
    // Unrecorded means no xid is sent, the safe side (R6).
  }
}

/**
 * True when a recorded grant predates the minimum text, so the banner shows again (R6). A grant with
 * NO recorded version is not stale: it sends no xid, and it is not re-asked, because nothing tells a
 * pre-FOLLOW-1316 grant from a page that seeded the key, and the in-session product does not need it.
 */
export function isConsentTextStale(): boolean {
  const version = readConsentTextVersion();
  return version !== null && version < MIN_PROFILE_TEXT_VERSION;
}

export interface SessionState {
  /**
   * Random UUID v4 — 36 chars, no PII, no device input (FOLLOW-1106).
   *
   * Sessions minted by a pre-FOLLOW-1106 build carry a 64-char hex value
   * instead. Both shapes are valid and both satisfy the ingest envelope's
   * `z.string().min(32).max(64)` bound; nothing re-derives or migrates them.
   */
  sessionId: string;
  startedAt: number;
  pageCount: number;
}

const SESSION_STORAGE_KEY = '__estalara_session__';

/**
 * Format one byte of a 16-byte CSPRNG draw as RFC 4122 §4.4 requires:
 * the version nibble (4) sits in byte 6, the variant bits (10xx) in byte 8.
 * Keeps the fallback rung below byte-shape-identical to `crypto.randomUUID()`,
 * so no caller or validator can tell which rung minted the id.
 */
function rfc4122Byte(byte: number, index: number): string {
  let value = byte;
  if (index === 6) value = (byte & 0x0f) | 0x40;
  if (index === 8) value = (byte & 0x3f) | 0x80;
  return value.toString(16).padStart(2, '0');
}

/**
 * Mint a NEW, RANDOM session ID. 36-char UUID v4.
 *
 * **What this value is:** 122 bits of CSPRNG output in UUID v4 layout, minted
 * once per tab and then held in `sessionStorage` by {@link getOrCreateSession}.
 *
 * **What this value is NOT, and this is the entire point of the function:** it
 * is not a device fingerprint. Until FOLLOW-1106 this function returned an
 * *unkeyed* `SHA-256(navigator.userAgent | screen.WxH | Intl timeZone |
 * navigator.language)` — a deterministic device digest, byte-identical across
 * tenants, never rotating. Measured against production ClickHouse, real ids
 * spanned 41-106 hours across 2-5 calendar days; and because it was a device
 * digest it *collided*, so two visitors sharing one device profile shared one
 * id and one person's Art. 17 erasure destroyed another person's consent
 * record. Do not reintroduce determinism here as an optimisation or a
 * "stability fix": `src/__tests__/session.test.ts` forbids it deliberately.
 *
 * - Measured evidence: `docs/compliance/FOLLOW-1105-session-identifier-assessment.md`
 * - Ruling: `backlog/ESCALATIONS.md` ESC-070 — Path C, CEO, 2026-08-24.
 *
 * **Intra-session stability is a property of the caller, not of this function.**
 * {@link getOrCreateSession} reads `sessionStorage['__estalara_session__']`
 * FIRST and calls this only on a miss, and `sessionStorage` already spans
 * navigation and full reload for the tab's lifetime. That is why randomising
 * the mint changed no downstream consumer, no schema and no migration.
 *
 * **Availability, decided rather than assumed.** `crypto.randomUUID()` is
 * secure-context gated (https://developer.mozilla.org/docs/Web/API/Crypto/randomUUID),
 * so it is absent on a plain-HTTP tenant page. `crypto.getRandomValues()` is
 * not gated (https://developer.mozilla.org/docs/Web/API/Crypto/getRandomValues)
 * and has shipped in every browser since IE11, so rung 2 covers that case —
 * which makes this function strictly MORE available than the body it replaces,
 * whose `crypto.subtle` is itself secure-context gated. If neither exists the
 * environment has no CSPRNG at all: we reject rather than mint a guessable id,
 * and above all rather than fall back to the device digest, which would
 * reinstate the defect on precisely the browsers nobody is watching.
 *
 * Returns `Promise<string>` (without `async`, matching
 * `getOrCreateCrossSessionId` in `xid.ts`) so every existing
 * `await generateSessionId()` call site is untouched by the change.
 */
export function generateSessionId(): Promise<string> {
  const id = drawUuid();
  // Deliberately terse: the reasoning lives in this docblock, not in the bundle.
  return id
    ? Promise.resolve(id)
    : Promise.reject(new Error('[Estalara] No CSPRNG — no session id (FOLLOW-1106)'));
}

/** The CSPRNG ladder of {@link generateSessionId}, shared with the xid; null without a CSPRNG. */
export function drawUuid(): string | null {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), rfc4122Byte).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return null;
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
// Registered-user lead ID derivation (FOLLOW-197 / CHAT-003)
// ---------------------------------------------------------------------------

/**
 * sessionStorage key for the derived pseudonymous lead identifier.
 *
 * Rule L compliance: the raw `user_uuid` from Keycloak is NEVER stored. Only
 * the first 16 hex chars of its SHA-256 digest are persisted here. This token
 * cannot be reversed to the original UUID without the pre-image.
 *
 * Stored in sessionStorage (tab-lifetime). The same token also reaches localStorage in two places:
 * the xid record's `lead` once that id is sent (FOLLOW-1316, R43) and the scoped opt-out key.
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
