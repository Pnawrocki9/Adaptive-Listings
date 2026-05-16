/**
 * Unit tests for DSR OTP helpers.
 *
 * Pure functions — no mocks needed.
 *
 * @module apps/control-plane/src/lib/__tests__/dsr-otp.test
 */

import { describe, expect, it } from 'vitest';
import { generateOtp, hashOtp, verifyOtp } from '../dsr-otp.js';

describe('generateOtp', () => {
  it('always returns a 6-character string of digits', () => {
    for (let i = 0; i < 50; i++) {
      const otp = generateOtp();
      expect(otp).toMatch(/^\d{6}$/);
    }
  });

  it('produces unique values across 100 generations (collision probability is negligible)', () => {
    const otps = Array.from({ length: 100 }, () => generateOtp());
    const unique = new Set(otps);
    // With 1_000_000 possible values and 100 draws, the birthday-collision probability
    // is ~0.5%. Accepting up to 2 collisions keeps this test non-flaky in CI.
    expect(unique.size).toBeGreaterThanOrEqual(98);
  });
});

describe('hashOtp', () => {
  it('returns a 64-character lowercase hex string', () => {
    const hash = hashOtp('042813');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — same OTP always produces same hash', () => {
    expect(hashOtp('000000')).toBe(hashOtp('000000'));
    expect(hashOtp('999999')).toBe(hashOtp('999999'));
  });

  it('different OTPs produce different hashes', () => {
    expect(hashOtp('123456')).not.toBe(hashOtp('654321'));
  });
});

describe('verifyOtp', () => {
  it('returns true for a matching OTP', () => {
    const otp = '123456';
    const hash = hashOtp(otp);
    expect(verifyOtp(otp, hash)).toBe(true);
  });

  it('returns false for a wrong OTP', () => {
    const hash = hashOtp('123456');
    expect(verifyOtp('654321', hash)).toBe(false);
  });

  it('returns false for an empty string', () => {
    const hash = hashOtp('123456');
    expect(verifyOtp('', hash)).toBe(false);
  });

  it('returns false for a hash that is all zeros', () => {
    const hash = '0'.repeat(64);
    expect(verifyOtp('123456', hash)).toBe(false);
  });
});
