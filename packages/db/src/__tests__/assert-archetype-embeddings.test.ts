/**
 * Unit tests for the `Archetype embeddings not-NULL check` gate's evaluator.
 *
 * FOLLOW-1191 / audit finding E-5. The pre-fix assertion lived inline in
 * `ci.yml` and asked one question — "are there NULL rows?" — which an EMPTY
 * table answers "no". The first test below is the red-first evidence: it is the
 * exact case the shipped gate passed while printing "all 18 archetype
 * embeddings populated", measured against a truncated local `:5433` table.
 *
 * @module packages/db/src/__tests__/assert-archetype-embeddings.test
 */

import { describe, expect, it } from 'vitest';

import {
  EXPECTED_EMBEDDING_DIM,
  evaluateArchetypeEmbeddings,
  type ArchetypeEmbeddingRow,
} from '../archetype-embedding-assert.js';
import { ARCHETYPE_SEEDS } from '../seed/archetype-seeds.js';

const NAMES = ARCHETYPE_SEEDS.map((s) => s.archetypeName);

function goodRows(): ArchetypeEmbeddingRow[] {
  return NAMES.map((archetype_name) => ({ archetype_name, dims: EXPECTED_EMBEDDING_DIM }));
}

describe('evaluateArchetypeEmbeddings', () => {
  it('FAILS on an empty table — the case the pre-fix gate passed vacuously', () => {
    const failures = evaluateArchetypeEmbeddings([], NAMES);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join(' ')).toContain('row count is 0');
  });

  it('passes on 18 non-NULL 1024-dim rows carrying every seeded name', () => {
    expect(evaluateArchetypeEmbeddings(goodRows(), NAMES)).toEqual([]);
  });

  it('FAILS when one row has a NULL embedding (the original assertion)', () => {
    const rows = goodRows();
    rows[0] = { archetype_name: NAMES[0]!, dims: null };
    const failures = evaluateArchetypeEmbeddings(rows, NAMES);
    expect(failures.join(' ')).toContain('NULL embedding');
  });

  it('FAILS when a row is the wrong dimensionality', () => {
    const rows = goodRows();
    rows[2] = { archetype_name: NAMES[2]!, dims: 1536 };
    const failures = evaluateArchetypeEmbeddings(rows, NAMES);
    expect(failures.join(' ')).toContain('not 1024-dim');
  });

  it('FAILS when the row count is right but a seeded name is absent', () => {
    const rows = goodRows();
    rows[5] = { archetype_name: 'not_an_archetype', dims: EXPECTED_EMBEDDING_DIM };
    const failures = evaluateArchetypeEmbeddings(rows, NAMES);
    expect(failures.join(' ')).toContain('absent');
  });

  it('FAILS on a partially-migrated table (fewer rows, all populated)', () => {
    const failures = evaluateArchetypeEmbeddings(goodRows().slice(0, 4), NAMES);
    expect(failures.join(' ')).toContain('expected 18');
  });

  it('EXPECTED_EMBEDDING_DIM is 1024', () => {
    expect(EXPECTED_EMBEDDING_DIM).toBe(1024);
  });
});
