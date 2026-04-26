import { describe, expect, it } from 'vitest';

import { SDK_REACT_VERSION } from './index.js';

describe('@estalara/sdk-react', () => {
  it('exports SDK_REACT_VERSION', () => {
    expect(SDK_REACT_VERSION).toBe('0.0.0');
  });
});
