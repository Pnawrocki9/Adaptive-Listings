/**
 * Demo Mode types shared across all Estalara services.
 *
 * Used by:
 *   - apps/control-plane: API routes and back office UI
 *   - SDK: validates demo token payload and activates demo behaviour
 *   - apps/decision-api: respects demo context in adaptation decisions
 *
 * @module @estalara/shared/demo
 */

/** Whether the demo is running against a mockup or a live production domain. */
export type DemoScope = 'mockup' | 'production';

/** Who can access this demo session — only the creator, or anyone with the link. */
export type DemoVisibility = 'self' | 'shareable';

/** How long the demo session token is valid. */
export type DemoDuration = 'session' | '24h' | '7d';

/** A demo session as returned by the API (client-facing view, no sensitive fields). */
export interface DemoSession {
  id: string;
  tenant_id: string;
  scope: DemoScope;
  visibility: DemoVisibility;
  duration: DemoDuration;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  /** True if the session has not been revoked and has not expired. */
  is_active: boolean;
  /** Full URL with ?demo=<token> — only set when visibility='shareable'. */
  shareable_link: string | null;
}

/** Claims embedded in a signed demo JWT (verified by SDK and decision API). */
export interface DemoTokenPayload {
  tenant_id: string;
  session_id: string;
  scope: DemoScope;
  /** Unix timestamp (seconds) — standard JWT exp claim. */
  exp: number;
}

// ─── Quiz mismatch types ──────────────────────────────────────────────────────

/** How strongly the quiz answer contradicts the behavioral signals. */
export type MismatchSeverity = 'low' | 'medium' | 'high';

/** Persisted record of a quiz-vs-behavior mismatch for DQS analysis. */
export interface QuizMismatchRecord {
  session_id: string;
  quiz_archetype: string;
  behavioral_archetype: string;
  confidence_gap: number;
  severity: MismatchSeverity;
  signal_count: number;
  ts: number;
}

/**
 * Classify mismatch severity from confidence gap.
 *
 * gap > 0.5 → high (behavioral and quiz strongly disagree)
 * gap > 0.3 → medium
 * gap ≤ 0.3 → low
 */
export function classifyMismatchSeverity(confidenceGap: number): MismatchSeverity {
  if (confidenceGap > 0.5) return 'high';
  if (confidenceGap > 0.3) return 'medium';
  return 'low';
}
