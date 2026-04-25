import { describe, expect, it } from 'vitest';

import { AUTH_VERSION } from './index.js';

describe('@estalara/auth', () => {
  it('exports AUTH_VERSION', () => {
    expect(AUTH_VERSION).toBe('0.0.0');
  });
});
