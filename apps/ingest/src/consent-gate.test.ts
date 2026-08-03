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

import { evaluateConsent, redactPersistedPayloadForConsent } from './consent-gate.js';

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

/** The gate's three privacy classes (mirrors the module-internal `ConsentClass`). */
type ExpectedConsentClass = 'profiling' | 'audit' | 'operational';

/**
 * GOLDEN per-type classification fixture (FOLLOW-579 / RETRO-177 TG-1).
 *
 * The pre-existing contract test proves EXHAUSTIVENESS (every union member is classified) but not
 * CORRECTNESS: it runs with `consent_state='consented'`, where profiling / audit / operational all
 * return `allowed:true`, so it cannot detect a MIS-classed member (that is how LG-1's under-gate
 * shipped green). This fixture pins the EXPECTED class of EVERY union member and asserts the
 * OBSERVABLE gate behavior that class implies. A future reclassification (e.g. flipping
 * `session.quality.snapshot` operational→profiling, or vice versa) changes gate behavior and so
 * MUST be a deliberate edit to this fixture — it can no longer slip in silently.
 *
 * Hand-maintained on purpose: this is an INDEPENDENT compliance-reviewed copy of the class map, not
 * a derivation from it. Drift between this fixture and the map is the signal, so the two must be
 * edited together.
 */
const EXPECTED_CLASS_BY_EVENT_TYPE: Record<string, ExpectedConsentClass> = {
  // ── profiling: §H.8(a) behavioral tracking + §H.8(d) derived intent (gated) ──
  'page.view': 'profiling',
  'page.exit': 'profiling',
  'tab.visible': 'profiling',
  'tab.hidden': 'profiling',
  'scroll.depth': 'profiling',
  'mouse.dwell': 'profiling',
  'mouse.rage_click': 'profiling',
  'mouse.exit_intent': 'profiling',
  'photo.opened': 'profiling',
  'photo.gallery.next': 'profiling',
  'photo.zoomed': 'profiling',
  'photo.dwell': 'profiling',
  'floorplan.opened': 'profiling',
  'floorplan.zoom': 'profiling',
  'floorplan.dwell': 'profiling',
  'price.hovered': 'profiling',
  'price.compared': 'profiling',
  'feature.expanded': 'profiling',
  'mortgage_calc.used': 'profiling',
  'search.query': 'profiling',
  'filter.applied': 'profiling',
  'filter.removed': 'profiling',
  'sort.changed': 'profiling',
  'chat.opened': 'profiling',
  'chat.message.sent': 'profiling',
  'chat.intent.detected': 'profiling',
  'listing.next': 'profiling',
  'listing.compared': 'profiling',
  'listing.bookmarked': 'profiling',
  'listing.viewed': 'profiling',
  'cta.clicked': 'profiling',
  'quiz.event': 'profiling',
  'quiz.mismatch': 'profiling',
  'sidebar.closed': 'profiling',
  'session.started': 'profiling',
  'intent.snapshot': 'profiling',
  // ── audit: consent trail (always ingest) ──
  'consent.granted': 'audit',
  'consent.denied': 'audit',
  // ── operational: server outcomes, DQS snapshot, discrete conversions (always ingest) ──
  'adapt.applied': 'operational',
  'adapt.skipped': 'operational',
  'adapt.description.applied': 'operational',
  'adapt.description.skipped': 'operational',
  'adapt.description.error': 'operational',
  'adapt.description.re': 'operational',
  'adapt.description.headline.applied': 'operational',
  'adapt.description.headline.re': 'operational',
  // FOLLOW-791 (SDK): generic-directive MutationObserver repair — same shape as
  // adapt.applied / adapt.description.re.
  'adapt.reapplied': 'operational',
  'ab.assignment': 'operational',
  'session.quality.snapshot': 'operational',
  'inquiry.started': 'operational',
  'inquiry.completed': 'operational',
  'tour.requested': 'operational',
  'live.signup': 'operational',
};

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

describe('consent-gate — GOLDEN per-type class fixture (correctness, not just exhaustiveness)', () => {
  it('the golden fixture keys EXACTLY match the discriminated union (no missing, no extra)', () => {
    // If a new event type is added to the union without a fixture entry — or a fixture entry
    // outlives its union member — this fails, forcing a deliberate compliance-reviewed edit.
    expect([...Object.keys(EXPECTED_CLASS_BY_EVENT_TYPE)].sort()).toEqual(
      [...UNION_EVENT_TYPES].sort(),
    );
  });

  it('every union member behaves EXACTLY as its pinned class dictates', () => {
    for (const type of UNION_EVENT_TYPES) {
      const expected = EXPECTED_CLASS_BY_EVENT_TYPE[type];
      // Sanity: the fixture must cover this member (redundant with the set-equality test above,
      // but keeps the per-member assertion self-contained and its failure message precise).
      expect(expected, `missing golden class for '${type}'`).toBeDefined();

      if (expected === 'profiling') {
        // Gated: rejected without a lawful basis, allowed with one.
        const none = evaluateConsent(type, 'none');
        expect(none.allowed, `${type} should be REJECTED under consent_state=none`).toBe(false);
        if (!none.allowed) {
          expect(none.code).toBe('consent_not_granted');
          expect(none.consent_class).toBe('profiling');
        }
        expect(evaluateConsent(type, 'session-only').allowed).toBe(false);
        expect(evaluateConsent(type, 'consented').allowed).toBe(true);
        expect(evaluateConsent(type, 'legitimate-interest').allowed).toBe(true);
      } else {
        // audit / operational: ALWAYS ingest, under every consent_state (incl. none).
        for (const cs of ALL_CONSENT_STATES) {
          expect(
            evaluateConsent(type, cs).allowed,
            `${type} (${String(expected)}) should ALWAYS ingest — failed under consent_state=${cs}`,
          ).toBe(true);
        }
      }
    }
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

// ── FOLLOW-579 — strip §H.8(d) derived-intent fields from session.quality.snapshot payloads ──
describe('consent-gate — redactPersistedPayloadForConsent (session.quality.snapshot strip)', () => {
  const DERIVED_FIELDS = ['final_archetype', 'final_confidence', 'prediction_stability_score'];
  const snapshotPayload = () => ({
    session_id: 'a'.repeat(64),
    prediction_stability_score: 0.8,
    convergence_time_events: 5,
    signal_density_per_min: 3,
    final_archetype: 'family_buyer',
    final_confidence: 0.72,
    total_events: 10,
    listing_view_rate: 1.5,
  });

  it('STRIPS the three derived-intent fields for a snapshot with no lawful basis (none)', () => {
    const result = redactPersistedPayloadForConsent(
      'session.quality.snapshot',
      'none',
      snapshotPayload(),
    ) as Record<string, unknown>;
    for (const f of DERIVED_FIELDS) expect(result).not.toHaveProperty(f);
  });

  it('STRIPS under consent_state=session-only too (also not a lawful basis)', () => {
    const result = redactPersistedPayloadForConsent(
      'session.quality.snapshot',
      'session-only',
      snapshotPayload(),
    ) as Record<string, unknown>;
    for (const f of DERIVED_FIELDS) expect(result).not.toHaveProperty(f);
  });

  it('KEEPS every non-derived DQS metric when stripping (operational record survives)', () => {
    const result = redactPersistedPayloadForConsent(
      'session.quality.snapshot',
      'none',
      snapshotPayload(),
    ) as Record<string, unknown>;
    expect(result.session_id).toBe('a'.repeat(64));
    expect(result.convergence_time_events).toBe(5);
    expect(result.signal_density_per_min).toBe(3);
    expect(result.total_events).toBe(10);
    expect(result.listing_view_rate).toBe(1.5);
  });

  it('KEEPS the three fields for consented / legitimate-interest users (unchanged)', () => {
    for (const cs of ['consented', 'legitimate-interest']) {
      const result = redactPersistedPayloadForConsent(
        'session.quality.snapshot',
        cs,
        snapshotPayload(),
      ) as Record<string, unknown>;
      expect(result.final_archetype).toBe('family_buyer');
      expect(result.final_confidence).toBe(0.72);
      expect(result.prediction_stability_score).toBe(0.8);
    }
  });

  it('is a NO-OP for other event types even under consent_state=none', () => {
    const payload = { url: 'https://example.com', final_archetype: 'x' };
    const result = redactPersistedPayloadForConsent('page.view', 'none', payload);
    // Same content — page.view carries no derived-intent artifact this rule governs.
    expect(result).toEqual(payload);
  });

  it('does NOT mutate the input payload (returns a copy)', () => {
    const input = snapshotPayload();
    redactPersistedPayloadForConsent('session.quality.snapshot', 'none', input);
    expect(input.final_archetype).toBe('family_buyer');
    expect(input.final_confidence).toBe(0.72);
    expect(input.prediction_stability_score).toBe(0.8);
  });

  it('tolerates a non-object payload without throwing', () => {
    expect(redactPersistedPayloadForConsent('session.quality.snapshot', 'none', null)).toBeNull();
    expect(
      redactPersistedPayloadForConsent('session.quality.snapshot', 'none', undefined),
    ).toBeUndefined();
  });
});
