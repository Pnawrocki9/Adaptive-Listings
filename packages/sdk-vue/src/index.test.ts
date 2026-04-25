import { describe, expect, it } from 'vitest';

import { SDK_VUE_VERSION } from './index.js';

describe('@estalara/sdk-vue', () => {
  it('exports SDK_VUE_VERSION', () => {
    expect(SDK_VUE_VERSION).toBe('0.0.0');
  });
});
