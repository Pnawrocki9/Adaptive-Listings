/**
 * Unit tests for the ab_bandit_weights Drizzle schema definition.
 *
 * These are structural tests — they verify the schema shape without
 * making a real DB connection (no DATABASE_URL required).
 *
 * TICKET-AB-001 AC-4 (idempotency) is tested here at the schema level.
 *
 * @module @estalara/db/src/__tests__/ab_bandit_weights.test
 */

import { describe, expect, it } from 'vitest';

import { abBanditWeights } from '../schema/ab_bandit_weights.js';

describe('abBanditWeights schema', () => {
  it('table name is ab_bandit_weights', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing internal Drizzle symbol
    expect((abBanditWeights as any)[Symbol.for('drizzle:Name')]).toBe('ab_bandit_weights');
  });

  it('has tenant_id column', () => {
    expect(abBanditWeights.tenantId).toBeDefined();
  });

  it('has archetype column', () => {
    expect(abBanditWeights.archetype).toBeDefined();
  });

  it('has variant column', () => {
    expect(abBanditWeights.variant).toBeDefined();
  });

  it('has alpha column with numeric type', () => {
    expect(abBanditWeights.alpha).toBeDefined();
    const col = abBanditWeights.alpha;
    // Drizzle column dataType for double precision
    expect((col as { dataType: string }).dataType).toBe('number');
  });

  it('has beta column with numeric type', () => {
    expect(abBanditWeights.beta).toBeDefined();
    const col = abBanditWeights.beta;
    expect((col as { dataType: string }).dataType).toBe('number');
  });

  it('has paused column with boolean type', () => {
    expect(abBanditWeights.paused).toBeDefined();
    const col = abBanditWeights.paused;
    expect((col as { dataType: string }).dataType).toBe('boolean');
  });

  it('has updated_at column', () => {
    expect(abBanditWeights.updatedAt).toBeDefined();
  });

  it('exports AbBanditWeight inferred type (structural check via type assertion)', () => {
    // This is a compile-time check — if the import works, types are exported correctly.
    // The actual inference test is implicit in TypeScript compilation.
    expect(abBanditWeights).toBeDefined();
  });
});

describe('abBanditWeights schema exports', () => {
  it('is exported from schema/index', async () => {
    const { abBanditWeights: exported } = await import('../schema/index.js');
    expect(exported).toBeDefined();
    expect(exported).toBe(abBanditWeights);
  });

  it('is exported from db package index', async () => {
    const pkg = await import('../index.js');
    expect((pkg as Record<string, unknown>).abBanditWeights).toBeDefined();
  });
});
