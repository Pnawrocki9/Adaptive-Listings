import { describe, expect, it } from 'vitest';

import { COMPLIANCE_VERSION } from './index.js';

describe('@estalara/compliance', () => {
  it('exports COMPLIANCE_VERSION', () => {
    expect(COMPLIANCE_VERSION).toBe('0.0.0');
  });
});
