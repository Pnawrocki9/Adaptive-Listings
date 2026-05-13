/**
 * Structural test for the archetypeEmbeddings Drizzle schema.
 *
 * Verifies that the table definition exposes the expected columns without
 * requiring a real database connection.
 */
import { getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { archetypeEmbeddings } from '../schema/archetype_embeddings.js';

/** The 18 canonical archetype names that must be present in the seed migration. */
const CANONICAL_ARCHETYPES = [
  'yield_hunter',
  'vacation_rental_investor',
  'flip_investor',
  'portfolio_builder',
  'golden_visa_buyer',
  'commercial_investor',
  'family_buyer',
  'first_time_buyer',
  'upsizer',
  'downsizer',
  'luxury_buyer',
  'remote_worker',
  'lifestyle_expat',
  'retiree_relocator',
  'diaspora_buyer',
  'second_home_buyer',
  'student_parent',
  'neutral',
] as const;

describe('archetypeEmbeddings schema', () => {
  it('is defined as a Drizzle table', () => {
    expect(archetypeEmbeddings).toBeDefined();
  });

  it('table name is archetype_embeddings', () => {
    expect(getTableName(archetypeEmbeddings)).toBe('archetype_embeddings');
  });

  it('exposes id column', () => {
    expect(archetypeEmbeddings.id).toBeDefined();
  });

  it('exposes archetype_name column', () => {
    expect(archetypeEmbeddings.archetypeName).toBeDefined();
  });

  it('exposes description column', () => {
    expect(archetypeEmbeddings.description).toBeDefined();
  });

  it('exposes embedding column (nullable vector)', () => {
    expect(archetypeEmbeddings.embedding).toBeDefined();
  });

  it('exposes confidence_threshold column', () => {
    expect(archetypeEmbeddings.confidenceThreshold).toBeDefined();
  });

  it('exposes sample_count column', () => {
    expect(archetypeEmbeddings.sampleCount).toBeDefined();
  });

  it('exposes is_active column', () => {
    expect(archetypeEmbeddings.isActive).toBeDefined();
  });

  it('exposes created_at column', () => {
    expect(archetypeEmbeddings.createdAt).toBeDefined();
  });

  it('exposes updated_at column', () => {
    expect(archetypeEmbeddings.updatedAt).toBeDefined();
  });

  it('canonical archetype list has exactly 18 entries', () => {
    expect(CANONICAL_ARCHETYPES).toHaveLength(18);
  });

  it('canonical archetype list contains no duplicates', () => {
    const unique = new Set(CANONICAL_ARCHETYPES);
    expect(unique.size).toBe(CANONICAL_ARCHETYPES.length);
  });

  it('neutral is the last archetype (fallback sentinel)', () => {
    expect(CANONICAL_ARCHETYPES[CANONICAL_ARCHETYPES.length - 1]).toBe('neutral');
  });
});
