/**
 * Quiz session/dismissal state — the storage flags that decide whether the quiz may open.
 *
 * FOLLOW-1015 (2026-08-17): this module used to be `quiz-trigger.ts` and owned a sticky
 * "Find your match →" button that had to be clicked to open the quiz. The trigger is gone —
 * the quiz card now opens by itself once consent and config resolve, and the visitor closes it
 * if they do not want to answer (`renderQuizWidget`'s close/skip → `onDismiss`). What remains
 * here are the two flags that keep that auto-open from becoming a nuisance:
 *
 *   - **completed** (sessionStorage, tab lifetime) — answered, so do not ask again this session.
 *   - **dismissed** (localStorage, 24h) — actively closed, so do not reopen on the next page
 *     view for a day. Before FOLLOW-1015 only dismissing the *trigger* set this; now the card's
 *     own close/skip does, because with auto-open there is nothing else to stop it reappearing
 *     on every navigation.
 */

const DISMISS_STORAGE_KEY = '__estalara_quiz_dismissed__';
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const COMPLETED_STORAGE_KEY = '__estalara_quiz_completed__';

/**
 * Check if the quiz was dismissed recently (24h localStorage check).
 */
export function isQuizDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_STORAGE_KEY);
    if (!raw) return false;
    const ts = parseInt(raw, 10);
    if (isNaN(ts)) return false;
    return Date.now() - ts < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * Start the 24h cooldown after the visitor closes or skips the quiz without completing it.
 */
export function markQuizDismissed(): void {
  try {
    localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()));
  } catch {
    // localStorage unavailable — ignore
  }
}

/**
 * Check if the quiz was completed in THIS session (sessionStorage, tab-lifetime).
 *
 * Session-scoped on purpose: the resolved archetype it produces also lives in sessionStorage
 * (Mode A — no cross-session profiling without re-consent). A permanent (localStorage) flag would
 * suppress the quiz forever while the archetype is wiped on the next session, leaving a returning
 * visitor stuck on `neutral` with no way to re-declare. Tying completion to the session keeps the
 * two in lockstep: within a session the quiz is not re-shown; a fresh session re-profiles.
 */
export function isQuizCompleted(): boolean {
  try {
    return sessionStorage.getItem(COMPLETED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Suppress the quiz for the rest of THIS session after the buyer completes it.
 * Survives in-tab navigation and same-tab reload (sessionStorage); a new tab / window / session
 * shows the quiz again, in lockstep with the session-scoped resolved archetype.
 */
export function markQuizCompleted(): void {
  try {
    sessionStorage.setItem(COMPLETED_STORAGE_KEY, '1');
  } catch {
    // sessionStorage unavailable — ignore
  }
}
