/**
 * FOLLOW-1059 — the canary predicate's first test.
 *
 * Offline: no secrets, no network. Runs in `Test (Node …)` via the
 * `--filter='@estalara/integration-smoke'` added to `.github/workflows/ci.yml` by FOLLOW-1065 —
 * before that filter existed this file (and `archetype-id-parity.test.ts`) was executed by no CI
 * job at all (RETRO-294 HW-1).
 *
 * @module tests/integration/adapt-canary-verdict.test
 */

import { describe, it, expect } from 'vitest';
import { verdictFor, isProbeConclusive, probeOutcome } from './adapt-canary-verdict.js';

describe('FOLLOW-1059 — verdictFor', () => {
  it('a served generation is `generated`, and it is a pass', () => {
    const verdict = verdictFor({ source: 'llm_tweaked' });
    expect(verdict).toBe('generated');
    expect(isProbeConclusive(verdict)).toBe(true);
  });

  it('a fallback with `fact_check_refused` is `correctly_refused`, and it is a pass', () => {
    const verdict = verdictFor({
      source: 'playbook_fallback_llm_unavailable',
      fallback_reason: 'fact_check_refused',
    });
    expect(verdict).toBe('correctly_refused');
    expect(isProbeConclusive(verdict)).toBe(true);
  });

  it('a fallback with an ABSENT reason is `llm_unavailable` — the conservative reading', () => {
    const verdict = verdictFor({ source: 'playbook_fallback_llm_unavailable' });
    expect(verdict).toBe('llm_unavailable');
    expect(isProbeConclusive(verdict)).toBe(false);
  });

  it('`default` — the A/B holdout — is NOT a pass: the band was never exercised', () => {
    const verdict = verdictFor({ source: 'default' });
    expect(verdict).toBe('band_not_exercised');
    expect(isProbeConclusive(verdict)).toBe(false);
  });
});

describe('FOLLOW-1059 — the other ways the band is never reached', () => {
  it.each([
    ['playbook', 'similarity above the band — the tree serves the template by design'],
    ['playbook_fallback_llm_capped', 'the spend cap: the gateway is never called'],
    ['source_added_after_this_file', 'an unknown value is not evidence of a generation'],
  ])('`%s` is `band_not_exercised` (%s)', (source) => {
    expect(verdictFor({ source })).toBe('band_not_exercised');
  });

  it('a `fact_check_refused` reason on a NON-fallback source does not rescue it', () => {
    // Guards the arm order: the reason field is only meaningful on a fallback, and a
    // holdout response carrying one (a future server bug) must still read as vacuous.
    expect(verdictFor({ source: 'default', fallback_reason: 'fact_check_refused' })).toBe(
      'band_not_exercised',
    );
  });

  it('`llm_full` — Sonnet’s band — passes: the band the tree picks is production’s call', () => {
    expect(verdictFor({ source: 'llm_full' })).toBe('generated');
    expect(isProbeConclusive(verdictFor({ source: 'llm_full' }))).toBe(true);
  });
});

describe('FOLLOW-1120 / ESC-072 — the third state', () => {
  const grounded = {
    source: 'playbook_fallback_llm_unavailable',
    fallback_reason: 'listing_context_unavailable',
  };

  it('an ungroundable prompt is `grounding_unavailable`, and it is UNDETERMINED — not a pass, not a fail', () => {
    const verdict = verdictFor(grounded);
    expect(verdict).toBe('grounding_unavailable');
    expect(probeOutcome(verdict)).toBe('undetermined');
    // The load-bearing assertion of ESC-072: it must not be counted as a pass either. A gate that
    // turned a production outage into a green badge is the failure mode this repo keeps re-filing.
    expect(isProbeConclusive(verdict)).toBe(false);
  });

  it('a REAL LLM outage stays `fail` — the new state must not swallow the regression the gate exists for', () => {
    const verdict = verdictFor({
      source: 'playbook_fallback_llm_unavailable',
      fallback_reason: 'llm_unavailable',
    });
    expect(verdict).toBe('llm_unavailable');
    expect(probeOutcome(verdict)).toBe('fail');
  });

  it('an ABSENT reason stays `fail`, not undetermined — a build predating FOLLOW-1120 gets the conservative verdict', () => {
    const verdict = verdictFor({ source: 'playbook_fallback_llm_unavailable' });
    expect(verdict).toBe('llm_unavailable');
    expect(probeOutcome(verdict)).toBe('fail');
  });

  it('the grounding reason on a NON-fallback source does not create a third state', () => {
    // Same arm-order guard as the fact_check_refused case above: the reason is only meaningful
    // on a fallback source, and a holdout carrying one must still read as vacuous.
    expect(verdictFor({ source: 'default', fallback_reason: 'listing_context_unavailable' })).toBe(
      'band_not_exercised',
    );
  });

  it.each([
    ['generated', 'pass'],
    ['correctly_refused', 'pass'],
    ['llm_unavailable', 'fail'],
    ['band_not_exercised', 'fail'],
    ['grounding_unavailable', 'undetermined'],
  ])('probeOutcome(%s) === %s — every verdict maps, none falls through', (verdict, expected) => {
    expect(probeOutcome(verdict as Parameters<typeof probeOutcome>[0])).toBe(expected);
  });
});
