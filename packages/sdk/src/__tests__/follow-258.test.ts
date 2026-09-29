/**
 * FOLLOW-258: SDK↔ingest data-loss cluster
 * Tests for F-01/F-02/F-03/F-04/F-29 fixes.
 */

import { describe, it, expect } from 'vitest';
import { scrubMessagePii } from '../core/pii-scrub.js';

describe('F-29 + F-01: scrubMessagePii', () => {
  it('replaces email addresses with [email]', () => {
    expect(scrubMessagePii('Contact me at foo@bar.com please')).toBe(
      'Contact me at [email] please',
    );
  });

  it('replaces multiple emails', () => {
    const result = scrubMessagePii('a@b.com and c@d.org');
    expect(result).not.toContain('@');
    expect(result).toContain('[email]');
  });

  it('replaces phone numbers', () => {
    const result = scrubMessagePii('Call me on +44 7911 123456 please');
    expect(result).toContain('[phone]');
  });

  it('leaves plain text unchanged', () => {
    const plain = 'Looking for 3 beds near good schools';
    expect(scrubMessagePii(plain)).toBe(plain);
  });

  it('truncates to 4000 chars', () => {
    const long = 'a'.repeat(5000);
    expect(scrubMessagePii(long)).toHaveLength(4000);
  });

  it('handles empty string without throwing', () => {
    expect(scrubMessagePii('')).toBe('');
  });
});
