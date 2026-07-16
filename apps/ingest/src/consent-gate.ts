/**
 * Server-side consent gate for profiling-class events (FOLLOW-559 / audit finding A3-F-08).
 *
 * ## Why this exists
 *
 * `ConsentStateSchema` in `@estalara/shared` validates `consent_state` for SHAPE ONLY (a
 * `z.enum`). Nothing gates on the VALUE, so a broken or malicious client can POST profiling
 * events carrying `consent_state: 'none'` and `apps/ingest` will happily persist them. This
 * module moves consent enforcement to the STORAGE BOUNDARY: after an event passes
 * `EventSchema.safeParse`, `evaluateConsent()` decides whether a profiling-class event has a
 * lawful basis (`consented` or `legitimate-interest`) to be persisted.
 *
 * ## Load-bearing constraint — keys on `consent_state`, NEVER on opt-out (§H.9)
 *
 * CEO ruling 2026-06-23 (Master Design §H.9): the per-user opt-out toggle suppresses
 * CLIENT-SIDE AL profiling + DOM adaptation ONLY. The ingest stream rides the platform-wide
 * registration consent (§H.8) and MUST keep flowing for opted-out users. An opted-out user
 * still sends events carrying a valid `consent_state` (they consented at registration). This
 * gate therefore keys exclusively on `consent_state` and does not read opt-out state anywhere.
 *
 * ## Consent classes
 *
 * - `profiling` — §H.8(a) behavioral tracking + §H.8(d) derived intent (the archetype-building
 *   signals). GATED: requires `consent_state ∈ {consented, legitimate-interest}`.
 * - `audit` — `consent.granted` / `consent.denied`. ALWAYS ingest: you cannot record a consent
 *   denial through a gate that rejects on consent denial (AC2).
 * - `operational` — server-outcome events (`adapt.*`, `ab.assignment`), the data-quality
 *   snapshot, and discrete user-initiated conversions (`inquiry.*`, `tour.requested`,
 *   `live.signup`). These are business/outcome records, not passive profiling signals, and must
 *   flow so conversion truth is never dropped (analogous to the never-fabricate ethos: never
 *   silently drop the primary conversion metric). ALWAYS ingest.
 *
 * The class map is `Record<EventType, ConsentClass>`, so adding a new event type to the shared
 * discriminated union that is NOT classified here fails `pnpm typecheck`. The contract test
 * (`consent-gate.test.ts`) enumerates every union member at runtime through `evaluateConsent`
 * (the sole exported surface): an unclassified type fails closed → the test fails. No new event
 * type can silently default to a class (AC3).
 *
 * Only `evaluateConsent` is exported — the map, classifier, and allowed-set are module-internal
 * (they have no production consumer outside this file; a future cross-app reuse would export
 * them then, per Rule I "wired-or-dead").
 *
 * @module apps/ingest/src/consent-gate
 */

import type { ConsentState, EventType } from '@estalara/shared';

/** Privacy classification that decides whether an event is subject to the consent gate. */
type ConsentClass = 'profiling' | 'audit' | 'operational';

/**
 * Consent states under which a profiling-class event has a lawful basis to be persisted.
 * Mirrors Master Design §H.8: consent (Art. 6.1(a)) or legitimate interest (LIA).
 */
const PROFILING_ALLOWED_CONSENT_STATES: ReadonlySet<ConsentState> = new Set<ConsentState>([
  'consented',
  'legitimate-interest',
]);

/**
 * Canonical event-type → consent-class map. Every event type in the shared discriminated union
 * MUST appear here (enforced at compile time by the `Record<EventType, ...>` shape and at
 * runtime by the contract test). See the module doc for the classification rationale.
 */
const CONSENT_CLASS_BY_EVENT_TYPE: Record<EventType, ConsentClass> = {
  // ── profiling: §H.8(a) passive behavioral tracking ────────────────────────────────────────
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
  // device/session context: establishes a tracked session + device fingerprint — profiling.
  'session.started': 'profiling',
  // §H.8(d) derived 12-dim intent vector — the core archetype-building artifact.
  'intent.snapshot': 'profiling',

  // ── audit: MUST always ingest (compliance trail) ──────────────────────────────────────────
  'consent.granted': 'audit',
  'consent.denied': 'audit',

  // ── operational: server outcomes, data-quality, and discrete conversions — always ingest ──
  'adapt.applied': 'operational',
  'adapt.skipped': 'operational',
  'adapt.description.applied': 'operational',
  'adapt.description.skipped': 'operational',
  'adapt.description.error': 'operational',
  'adapt.description.re': 'operational',
  'adapt.description.headline.applied': 'operational',
  'adapt.description.headline.re': 'operational',
  'ab.assignment': 'operational',
  'session.quality.snapshot': 'operational',
  // discrete user-initiated conversions (business truth, not passive profiling).
  'inquiry.started': 'operational',
  'inquiry.completed': 'operational',
  'tour.requested': 'operational',
  'live.signup': 'operational',
};

/**
 * Classify an event type. Returns `undefined` for a type absent from the map — callers MUST
 * treat `undefined` as fail-closed (an unclassified type is not silently allowed).
 */
function classifyEvent(type: string): ConsentClass | undefined {
  return CONSENT_CLASS_BY_EVENT_TYPE[type as EventType];
}

/** Structured reason a consent evaluation rejected an event. */
interface ConsentRejection {
  allowed: false;
  /** Machine-readable rejection code surfaced to the client + Sentry. */
  code: 'consent_not_granted' | 'unclassified_event_type';
  consent_class: ConsentClass | 'unknown';
  consent_state: string;
  event_type: string;
}

type ConsentEvaluation = { allowed: true } | ConsentRejection;

/**
 * Decide whether an already-shape-valid event may be persisted given its `consent_state`.
 *
 * - `audit` / `operational` events: always allowed (§H.8 / AC2).
 * - `profiling` events: allowed only if `consent_state ∈ {consented, legitimate-interest}`.
 * - unclassified type: fail-closed (rejected). This is a defense-in-depth backstop — the
 *   compile-time `Record<EventType, ...>` and the contract test already prevent this in a
 *   correctly-built worker, but a runtime type that somehow slipped the union must not persist.
 *
 * Keys on `consent_state` only — never on opt-out state (§H.9, see module doc).
 */
export function evaluateConsent(type: string, consentState: string): ConsentEvaluation {
  const consentClass = classifyEvent(type);

  if (consentClass === undefined) {
    return {
      allowed: false,
      code: 'unclassified_event_type',
      consent_class: 'unknown',
      consent_state: consentState,
      event_type: type,
    };
  }

  if (consentClass !== 'profiling') {
    return { allowed: true };
  }

  if (PROFILING_ALLOWED_CONSENT_STATES.has(consentState as ConsentState)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    code: 'consent_not_granted',
    consent_class: 'profiling',
    consent_state: consentState,
    event_type: type,
  };
}
