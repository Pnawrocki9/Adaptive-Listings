/**
 * A/B assignment event publisher for decision-api.
 *
 * Wraps the Redpanda producer with envelope construction for the `ab.assignment` event.
 * Called fire-and-forget from the adapt route after a successful non-skipped assignment.
 *
 * The envelope format follows ADR-0003. Server-side fields (event_id, ts, region,
 * consent_state, schema_version) are generated here; payload mirrors the
 * AbAssignmentPayloadSchema defined in @estalara/shared.
 *
 * Sentry is intentionally NOT imported here — the caller (route.ts) wraps the call in
 * a try/catch and tags Sentry on error. This keeps the helper dependency-free and
 * independently testable.
 *
 * @module apps/decision-api/src/lib/ab-events
 */

import type { PushOptions, PushResult, RedpandaProducerEnv } from './redpanda-producer.js';
import { pushToRedpanda } from './redpanda-producer.js';

/**
 * Arguments required to build and publish an `ab.assignment` event.
 */
export interface AbAssignmentEventArgs {
  /** Session fingerprint from the adapt request. */
  session_id: string;
  /** Tenant UUID from the adapt request. */
  tenant_id: string;
  /** Whether the session was placed in the holdout (control) group. */
  holdout_group: boolean;
  /** Holdout rate configured at assignment time (e.g. 0.10). */
  holdout_pct: number;
  /** ISO 8601 timestamp of when the assignment was made. */
  assigned_at: string;
  /** Redpanda environment bindings. */
  env: RedpandaProducerEnv;
  /** Optional push overrides (fetch mock, back-off, timeout) — used in tests. */
  pushOptions?: PushOptions;
}

/**
 * Builds and publishes a single `ab.assignment` event envelope to Redpanda.
 *
 * The event_id is a randomly generated UUID (crypto.randomUUID — edge-compatible).
 * The consent_state is hard-coded to 'consented' because this code path is only
 * reached when `assignHoldout` did NOT skip (i.e. consent was granted or consent
 * mode is disabled — both situations imply consent is acceptable for analytics).
 *
 * @returns The PushResult from the Redpanda producer.
 */
export async function publishAbAssignmentEvent(args: AbAssignmentEventArgs): Promise<PushResult> {
  const { session_id, tenant_id, holdout_group, holdout_pct, assigned_at, env, pushOptions } = args;

  // Pad session_id to the envelope minimum of 32 chars if needed.
  // The adapt route validates session_id as min(1) — handle shorter values defensively.
  const envelopeSessionId = session_id.length < 32 ? session_id.padEnd(32, '0') : session_id;

  const envelope = {
    event_id: crypto.randomUUID(),
    tenant_id,
    session_id: envelopeSessionId,
    ts: Date.now(),
    // Region is not available at the adapt route level (no geo lookup in this path).
    // Default to 'eu' for MVP; Sprint 5 will thread the Cloudflare `cf.continent` header.
    region: 'eu',
    // consented: this path only executes when assignment was NOT skipped, meaning
    // consent_mode_enabled is false OR consent_state is granted.
    consent_state: 'consented',
    schema_version: 1,
    type: 'ab.assignment',
    payload: {
      session_id,
      tenant_id,
      holdout_group,
      holdout_pct,
      assigned_at,
    },
  };

  return pushToRedpanda([envelope], env, pushOptions);
}
