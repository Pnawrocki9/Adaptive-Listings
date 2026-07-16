/**
 * Unit + contract tests for the server-side consent gate (FOLLOW-559 / audit A3-F-08).
 *
 * All assertions go through `evaluateConsent` — the sole exported surface of the gate (Rule I:
 * the internal class map / classifier have no production consumer outside consent-gate.ts). The
 * contract test derives the canonical event-type set from the shared discriminated union
 * `EventSchema` AT RUNTIME (not from the hand-maintained `EVENT_TYPES` tuple, which could drift
 * from the union) and asserts that EVERY member is classified: an unclassified type fails closed
 * (`allowed: false`, `code: 'unclassified_event_type'`), so adding a new event type to the union
 * without a class in the map fails this test (AC3).
 */

import { describe, expect, it } from 'vitest';
import { EventSchema } from '@estalara/shared';
import type { ConsentState } from '@estalara/shared';

import { evaluateConsent } from './consent-gate.js';

/**
 * Canonical event-type set, derived directly from the discriminated union at runtime by reading
 * each option's `type` literal. This is the source of truth AC3 requires the gate to track.
 */
const UNION_EVENT_TYPES: string[] = (
  EventSchema.options as { shape: { type: { value: string } } }[]
).map((opt) => opt.shape.type.value);

const ALL_CONSENT_STATES: ConsentState[] = [
  'none',
  'session-only',
  'legitimate-interest',
  'consented',
];

describe('consent-gate — contract (every union member is classified)', () => {
  it('classifies EVERY event type in the discriminated union (unclassified fails closed)', () => {
    // With consent_state='consented', every CLASSIFIED type is allowed (profiling passes because
    // consented is a lawful basis; audit/operational always pass). Only an UNCLASSIFIED type
    // fails closed — so any union member missing from the class map surfaces here.
    const unclassified = UNION_EVENT_TYPES.filter((t) => {
      const r = evaluateConsent(t, 'consented');
      return !r.allowed && r.code === 'unclassified_event_type';
    });
    expect(unclassified).toEqual([]);
  });

  it('the union has members (guards against an empty/mis-derived enumeration)', () => {
    expect(UNION_EVENT_TYPES.length).toBeGreaterThan(0);
  });
});

describe('consent-gate — profiling events are gated on consent_state', () => {
  const profilingType = 'page.view';

  it('treats page.view / scroll.depth / chat.* / intent.snapshot as profiling (gated)', () => {
    for (const t of ['page.view', 'scroll.depth', 'chat.message.sent', 'intent.snapshot']) {
      expect(evaluateConsent(t, 'none').allowed).toBe(false);
      expect(evaluateConsent(t, 'consented').allowed).toBe(true);
    }
  });

  it('ALLOWS profiling with consent_state=consented', () => {
    expect(evaluateConsent(profilingType, 'consented').allowed).toBe(true);
  });

  it('ALLOWS profiling with consent_state=legitimate-interest', () => {
    expect(evaluateConsent(profilingType, 'legitimate-interest').allowed).toBe(true);
  });

  it('REJECTS profiling with consent_state=none', () => {
    const result = evaluateConsent(profilingType, 'none');
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe('consent_not_granted');
      expect(result.consent_class).toBe('profiling');
    }
  });

  it('REJECTS profiling with consent_state=session-only', () => {
    const result = evaluateConsent(profilingType, 'session-only');
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe('consent_not_granted');
  });

  it('the allowed set for profiling is EXACTLY {consented, legitimate-interest}', () => {
    // Fully characterizes the allowed-consent-state set through the public surface.
    const allowedStates = ALL_CONSENT_STATES.filter(
      (cs) => evaluateConsent(profilingType, cs).allowed,
    );
    expect([...allowedStates].sort()).toEqual(['consented', 'legitimate-interest'].sort());
  });
});

// ── §H.9 NON-REGRESSION — these tests MUST fail if someone regresses the CEO 2026-06-23 ruling.
// Audit + operational events (and opted-out users' §H.8 events, which always carry a valid
// consent_state) must ALWAYS ingest regardless of consent_state. The gate keys on consent_state,
// never on opt-out state.
describe('consent-gate — §H.9 non-regression: audit/operational always ingest', () => {
  it('consent.granted ingests under EVERY consent_state (incl. none)', () => {
    for (const cs of ALL_CONSENT_STATES) {
      expect(evaluateConsent('consent.granted', cs).allowed).toBe(true);
    }
  });

  it('consent.denied ingests under EVERY consent_state (cannot record a denial through a denial gate)', () => {
    for (const cs of ALL_CONSENT_STATES) {
      expect(evaluateConsent('consent.denied', cs).allowed).toBe(true);
    }
  });

  it('operational events (live.signup, adapt.applied, ab.assignment, session.quality.snapshot) ingest under consent_state=none', () => {
    for (const t of ['live.signup', 'adapt.applied', 'ab.assignment', 'session.quality.snapshot']) {
      expect(evaluateConsent(t, 'none').allowed).toBe(true);
    }
  });

  it('conversion events (inquiry.*, tour.requested) ingest under consent_state=none', () => {
    for (const t of ['inquiry.started', 'inquiry.completed', 'tour.requested']) {
      expect(evaluateConsent(t, 'none').allowed).toBe(true);
    }
  });
});

describe('consent-gate — fail-closed on unclassified type', () => {
  it('rejects a type absent from the map (defense-in-depth backstop)', () => {
    const result = evaluateConsent('totally.unknown.type', 'consented');
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe('unclassified_event_type');
      expect(result.consent_class).toBe('unknown');
    }
  });
});
