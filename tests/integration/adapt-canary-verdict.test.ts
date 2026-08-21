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
import { verdictFor, isProbeConclusive } from './adapt-canary-verdict.js';

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
