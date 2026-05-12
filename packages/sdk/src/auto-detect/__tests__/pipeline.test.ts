import { describe, it, expect } from 'vitest';
import { detectSiteSchema } from '../pipeline.js';

describe('detectSiteSchema skeleton', () => {
  it('throws Not implemented', async () => {
    await expect(
      detectSiteSchema('<html></html>', 'https://example.com', 'tenant-1'),
    ).rejects.toThrow('Not implemented');
  });
});
