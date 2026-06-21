/**
 * Per-user opt-out state for Adaptive-Listings DOM adaptation.
 *
 * FOLLOW-372 / Master Design §H.9 (CEO decision 2026-06-21):
 *
 * This module manages the reversible per-user opt-out that suspends AL
 * archetype profiling and DOM adaptation for one logged-in user only.
 *
 * Scope boundary (AL-DOM only):
 * - Suspends: AL archetype profiling, intent-weight updates, DOM mutation.
 * - Does NOT affect: app.estalara.com buying-intent identification, lead ranking,
 *   or agent-facing chat summaries — those ride the mandatory registration consent
 *   (§H.8) and are outside AL's per-user opt-out scope.
 *
 * Reversible — NOT erasure:
 * - OFF suspends; ON resumes. Accumulated archetype/intent state is preserved
 *   (enables the with/without comparison showcase).
 * - Hard erasure (Art. 17 GDPR withdrawal) remains on the FOLLOW-139 path.
 *
 * Persistence: localStorage per-user, scoped by `userId` when provided (logged-in),
 * or a fixed key for anonymous sessions. Survives page reload.
 *
 * @module @estalara/sdk/core/profiling-opt-out
 */

/**
 * localStorage key for the profiling opt-out flag (anonymous / per-device fallback).
 * When a userId is known the key is scoped: PROFILING_OPT_OUT_KEY + ':' + userId.
 */
export const PROFILING_OPT_OUT_KEY = '__estalara_profiling_opt_out__';

/**
 * Build the per-user localStorage key.
 *
 * When `userId` is provided the key is scoped to that user so that multiple
 * accounts on the same device cannot inherit each other's opt-out choice.
 * Falls back to the unscoped key for anonymous visitors.
 *
 * @param userId - Opaque user identifier (e.g. SHA-256 lead_id prefix). Optional.
 */
export function profilingOptOutKey(userId?: string): string {
  return userId ? `${PROFILING_OPT_OUT_KEY}:${userId}` : PROFILING_OPT_OUT_KEY;
}

/**
 * Read the current profiling opt-out state for a user.
 *
 * Returns `true` when the user has opted out (DOM adaptation suspended).
 * Returns `false` when opted in (default — adaptation active).
 *
 * Fails silently (localStorage unavailable → returns false so the feature
 * degrades gracefully to always-on adaptation rather than always-off).
 *
 * @param userId - Optional scoped user identifier.
 */
export function isProfilingOptedOut(userId?: string): boolean {
  try {
    return localStorage.getItem(profilingOptOutKey(userId)) === 'true';
  } catch {
    // localStorage unavailable — default to opted-in (no suspension)
    return false;
  }
}

/**
 * Persist the profiling opt-out choice for a user.
 *
 * @param optedOut - `true` to suspend adaptation; `false` to resume.
 * @param userId   - Optional scoped user identifier.
 */
export function setProfilingOptOut(optedOut: boolean, userId?: string): void {
  const key = profilingOptOutKey(userId);
  try {
    if (optedOut) {
      localStorage.setItem(key, 'true');
    } else {
      // Resume: remove the key so the default (opted-in) applies.
      localStorage.removeItem(key);
    }
  } catch {
    // localStorage unavailable — setting is ephemeral (in-memory only via callers)
  }
}

/**
 * Erase the profiling opt-out flag.
 *
 * Called on consent denial / withdrawal so the storage is cleaned up consistently
 * with other AL keys (DPIA §13.2 erasure obligation pattern, RETRO-019/020).
 *
 * @param userId - Optional scoped user identifier.
 */
export function eraseProfilingOptOut(userId?: string): void {
  try {
    localStorage.removeItem(profilingOptOutKey(userId));
  } catch {
    // localStorage unavailable — nothing to erase
  }
}
