/**
 * Unit + contract tests for the server-side consent gate (FOLLOW-559 / audit A3-F-08).
 *
 * The contract test derives the canonical event-type set from the shared discriminated union
 * `EventSchema` AT RUNTIME (not from the hand-maintained `EVENT_TYPES` tuple, which could drift
 * from the union). If a new event type is added to the union without a class in
 * `CONSENT_CLASS_BY_EVENT_TYPE`, this test FAILS — no type may silently default to a class (AC3).
 */

import { describe, expect, it } from 'vitest';
import { EventSchema } from '@estalara/shared';
import type { ConsentState } from '@estalara/shared';

import {
  CONSENT_CLASS_BY_EVENT_TYPE,
  PROFILING_ALLOWED_CONSENT_STATES,
  classifyEvent,
  evaluateConsent,
  type ConsentClass,
} from './consent-gate.js';

/**
 * Canonical event-type set, derived directly from the discriminated union at runtime by reading
 * each option's `type` literal. This is the source of truth AC3 requires the gate to track.
 */
const UNION_EVENT_TYPES: string[] = (
  EventSchema.options as { shape: { type: { value: string } } }[]
).map((opt) => opt.shape.type.value);

const VALID_CLASSES: ConsentClass[] = ['profiling', 'audit', 'operational'];
const ALL_CONSENT_STATES: ConsentState[] = [
  'none',
  'session-only',
  'legitimate-interest',
  'consented',
];

describe('consent-gate — contract (map ↔ union)', () => {
  it('classifies EVERY event type in the discriminated union (no unclassified type)', () => {
    const unclassified = UNION_EVENT_TYPES.filter((t) => classifyEvent(t) === undefined);
    expect(unclassified).toEqual([]);
  });

  it('has no stale map keys that are absent from the union', () => {
    const unionSet = new Set(UNION_EVENT_TYPES);
    const stale = Object.keys(CONSENT_CLASS_BY_EVENT_TYPE).filter((k) => !unionSet.has(k));
    expect(stale).toEqual([]);
  });

  it('map size exactly equals the number of union members', () => {
    expect(Object.keys(CONSENT_CLASS_BY_EVENT_TYPE)).toHaveLength(UNION_EVENT_TYPES.length);
  });

  it('every class value is one of the three valid consent classes', () => {
    for (const cls of Object.values(CONSENT_CLASS_BY_EVENT_TYPE)) {
      expect(VALID_CLASSES).toContain(cls);
    }
  });
});

describe('consent-gate — profiling events are gated on consent_state', () => {
  const profilingType = 'page.view';

  it('classifies page.view / scroll.depth / chat.* / intent.snapshot as profiling', () => {
    expect(classifyEvent('page.view')).toBe('profiling');
    expect(classifyEvent('scroll.depth')).toBe('profiling');
    expect(classifyEvent('chat.message.sent')).toBe('profiling');
    expect(classifyEvent('intent.snapshot')).toBe('profiling');
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

  it('the allowed set is exactly {consented, legitimate-interest}', () => {
    expect([...PROFILING_ALLOWED_CONSENT_STATES].sort()).toEqual(
      ['consented', 'legitimate-interest'].sort(),
    );
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

  it('classifies consent.granted / consent.denied as audit', () => {
    expect(classifyEvent('consent.granted')).toBe('audit');
    expect(classifyEvent('consent.denied')).toBe('audit');
  });

  it('operational events (live.signup, adapt.applied, ab.assignment, session.quality.snapshot) ingest under consent_state=none', () => {
    for (const t of ['live.signup', 'adapt.applied', 'ab.assignment', 'session.quality.snapshot']) {
      expect(evaluateConsent(t, 'none').allowed).toBe(true);
    }
  });

  it('conversion events (inquiry.*, tour.requested) are operational and ingest under consent_state=none', () => {
    for (const t of ['inquiry.started', 'inquiry.completed', 'tour.requested']) {
      expect(classifyEvent(t)).toBe('operational');
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
