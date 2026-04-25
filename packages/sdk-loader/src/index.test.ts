import { describe, expect, it } from 'vitest';

import { LOADER_VERSION } from './index.js';

describe('@estalara/sdk-loader', () => {
  it('exports LOADER_VERSION', () => {
    expect(LOADER_VERSION).toBe('0.0.0');
  });
});
