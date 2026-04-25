import { describe, expect, it } from 'vitest';

import { DB_VERSION } from './index.js';

describe('@estalara/db', () => {
  it('exports DB_VERSION', () => {
    expect(DB_VERSION).toBe('0.0.0');
  });
});
