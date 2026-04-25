import { describe, expect, it } from 'vitest';

import { INTENT_ONTOLOGY_VERSION } from './index.js';

describe('@estalara/intent-ontology', () => {
  it('exports INTENT_ONTOLOGY_VERSION', () => {
    expect(INTENT_ONTOLOGY_VERSION).toBe('0.0.0');
  });
});
