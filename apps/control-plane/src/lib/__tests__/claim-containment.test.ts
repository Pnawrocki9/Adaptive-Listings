/**
 * FOLLOW-1305 — `claim-containment.ts` unit contract, and its parity with the Python job.
 *
 * The same negative/positive corpus the Python suite runs
 * (`apps/llm-gateway/src/jobs/test_generate_description_follow1305.py`), applied to the TS
 * check directly; plus the one value the two runtimes MUST agree on byte for byte — the
 * validation version — read out of the Python source, because a mismatch would make every
 * cache hit legacy and regenerate on every request.
 *
 * @module apps/control-plane/src/lib/__tests__/claim-containment.test
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLAIMS_VALIDATION_VERSION,
  slotRefusal,
  buildClaimGrounding,
  checkUnsupportedClaims,
  isTrustedDescriptionHit,
} from '@/lib/claim-containment';

const G = buildClaimGrounding({
  listing_description: 'An apartment with two bedrooms and no pool.',
  listing_price: '400000',
  listing_location: 'Lisbon',
});

describe('checkUnsupportedClaims', () => {
  it.each([
    ['A two-bedroom apartment in Lisbon with a private pool.', 'unsupported_amenity'],
    ['A two-bedroom apartment in Lisbon with sea views from every room.', 'unsupported_amenity'],
    ['Nothing here needs work before it earns.', 'unsupported_guarantee'],
    ['Guaranteed rental income in Lisbon.', 'unsupported_guarantee'],
    ['Ready to fold into a portfolio with no works and no waiting.', 'unsupported_guarantee'],
    ['A two-bedroom apartment with 400000 square metres of space.', 'unit_mismatch'],
  ])('refuses %s', (value, code) => {
    expect(checkUnsupportedClaims(value, G)).toBe(code);
  });

  it('serves a supported transformation of the same listing', () => {
    expect(checkUnsupportedClaims('A two-bedroom apartment in Lisbon.', G)).toBeNull();
  });

  it('grounds an amenity the listing states positively, and an area stated as an area', () => {
    const g = buildClaimGrounding({ description: 'Villa with a heated pool', living_area: '128' });
    expect(checkUnsupportedClaims('Villa with a pool and 128 m² of living space', g)).toBeNull();
    expect(checkUnsupportedClaims('Villa with 129 m²', g)).toBe('unit_mismatch');
  });

  it('a field that denies an amenity does not ground it', () => {
    expect(
      checkUnsupportedClaims('Comes with a garage', buildClaimGrounding({ garage: 'no' })),
    ).toBe('unsupported_amenity');
  });

  it('a condition fact grounds a no-work claim', () => {
    const g = buildClaimGrounding({ description: 'Fully renovated in 2024.' });
    expect(checkUnsupportedClaims('Nothing here needs work.', g)).toBeNull();
  });
});

describe('slotRefusal (the slot is the unit of refusal — FOLLOW-1312)', () => {
  const ok = { slot: 'headline', value: 'a', violation: null };
  const ok2 = { slot: 'feature', value: 'c', violation: null };
  const bad = { slot: 'cta', value: 'b', violation: 'unsupported_amenity' };

  it('serves the grounded slots and refuses only the offending one, in directive order', () => {
    expect(slotRefusal([ok, bad, ok2])).toEqual({ served: [ok, ok2], refused: [bad] });
  });

  it('serves everything when every slot passed', () => {
    expect(slotRefusal([ok, ok2])).toEqual({ served: [ok, ok2], refused: [] });
  });

  it('serves nothing when every slot is refused — the caller refuses the request', () => {
    expect(slotRefusal([bad, bad]).served).toEqual([]);
  });
});

describe('isTrustedDescriptionHit (legacy admission)', () => {
  it('trusts only the current stamp for FIT, and NEUTRAL regardless', () => {
    expect(isTrustedDescriptionHit('FIT', CLAIMS_VALIDATION_VERSION)).toBe(true);
    expect(isTrustedDescriptionHit(undefined, CLAIMS_VALIDATION_VERSION)).toBe(true);
    expect(isTrustedDescriptionHit('FIT', null)).toBe(false);
    expect(isTrustedDescriptionHit(undefined, undefined)).toBe(false);
    expect(isTrustedDescriptionHit('FIT', 'claims-v0')).toBe(false);
    expect(isTrustedDescriptionHit('NEUTRAL', null)).toBe(true);
  });

  it('the version equals the Python job constant (the writer of every stamp)', () => {
    const py = readFileSync(
      path.resolve(__dirname, '../../../../llm-gateway/src/jobs/generate_description.py'),
      'utf8',
    );
    const m = /^CLAIMS_VALIDATION_VERSION = "([^"]+)"$/m.exec(py);
    expect(m?.[1]).toBe(CLAIMS_VALIDATION_VERSION);
  });
});
