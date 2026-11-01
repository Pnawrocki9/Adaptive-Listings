/**
 * FOLLOW-1305 — `claim-containment.ts` unit contract.
 *
 * The negative/positive corpus the deleted Python suite also ran (FOLLOW-1297, ADR-0023: the
 * Modal job is gone), applied to the TS check directly; plus the one value the reader and the
 * writer of every stamp MUST agree on byte for byte — the validation version — checked against
 * the generator's single definition and the frozen parity manifest, because a mismatch would
 * make every cache hit legacy and regenerate on every request.
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
import { CLAIMS_VALIDATION_VERSION as GENERATOR_CLAIMS_VALIDATION_VERSION } from '@/lib/description-generator';

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

  it('FOLLOW-1406 / FOLLOW-1411 / FOLLOW-1415 / FOLLOW-1414 / FOLLOW-1419 / FOLLOW-1420: a claims-v1 … v6 FIT hit is not trusted', () => {
    expect(CLAIMS_VALIDATION_VERSION).toBe('claims-v9');
    expect(isTrustedDescriptionHit('FIT', 'claims-v1')).toBe(false);
    expect(isTrustedDescriptionHit(undefined, 'claims-v1')).toBe(false);
    // FOLLOW-1411: a claims-v2 row never passed the protected-ground or school grounding check.
    expect(isTrustedDescriptionHit('FIT', 'claims-v2')).toBe(false);
    // FOLLOW-1415: a claims-v3 row never passed the sensitive-history refusal.
    expect(isTrustedDescriptionHit('FIT', 'claims-v3')).toBe(false);
    // FOLLOW-1414: a claims-v4 row never passed the listing-attribution refusal (meta_commentary).
    expect(isTrustedDescriptionHit('FIT', 'claims-v4')).toBe(false);
    // FOLLOW-1419: a claims-v5 row never passed the tightened protected-ground guard (painful
    // history terms; a place named by a group without a historical adjective).
    expect(isTrustedDescriptionHit('FIT', 'claims-v5')).toBe(false);
    // FOLLOW-1420 / FOLLOW-1421: a claims-v6 row never passed the majority composition refusal,
    // and its multiplied price may have been rounded.
    expect(isTrustedDescriptionHit('FIT', 'claims-v6')).toBe(false);
    // FOLLOW-1311 slice 4: a claims-v8 row never passed the attribute lexicon.
    expect(isTrustedDescriptionHit('FIT', 'claims-v8')).toBe(false);
    expect(isTrustedDescriptionHit('FIT', 'claims-v9')).toBe(true);
    expect(isTrustedDescriptionHit('NEUTRAL', 'claims-v1')).toBe(true);
  });

  it('the version equals the generator constant (the writer of every stamp) and the current parity manifest', () => {
    expect(CLAIMS_VALIDATION_VERSION).toBe(GENERATOR_CLAIMS_VALIDATION_VERSION);
    const manifest = (file: string) =>
      JSON.parse(
        readFileSync(path.resolve(__dirname, '../__fixtures__/description-parity', file), 'utf8'),
      ) as { claims_validation_version: string };
    // The current contract (FOLLOW-1311: corpus v25, a stamp-only re-freeze of v24). History pins
    // its own literal: v10 (FOLLOW-1406) introduced claims-v2, v13 (FOLLOW-1411) claims-v3, v14
    // (FOLLOW-1415) claims-v4, v18 (FOLLOW-1414) claims-v5, v19 (FOLLOW-1419) claims-v6.
    expect(manifest('MANIFEST.v25.json').claims_validation_version).toBe(CLAIMS_VALIDATION_VERSION);
    expect(manifest('MANIFEST.v24.json').claims_validation_version).toBe('claims-v8');
    expect(manifest('MANIFEST.v20.json').claims_validation_version).toBe('claims-v7');
    expect(manifest('MANIFEST.v19.json').claims_validation_version).toBe('claims-v6');
    expect(manifest('MANIFEST.v18.json').claims_validation_version).toBe('claims-v5');
    expect(manifest('MANIFEST.v14.json').claims_validation_version).toBe('claims-v4');
    expect(manifest('MANIFEST.v13.json').claims_validation_version).toBe('claims-v3');
    expect(manifest('MANIFEST.v10.json').claims_validation_version).toBe('claims-v2');
    // The Python job the corpus was first frozen from stamped claims-v1; that record never moves.
    expect(manifest('MANIFEST.json').claims_validation_version).toBe('claims-v1');
  });
});
