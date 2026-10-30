// @vitest-environment node

/**
 * FOLLOW-1233 — the harness preflight must refuse a substrate whose cosine inputs are absent.
 *
 * AC(3)'s `scoringPaths: ["cosine"]` depended on a machine state no bring-up document produced:
 * `archetype_embeddings` and `listing_embeddings` seeded by hand. A fresh machine served
 * `djb2_fallback` and, since FOLLOW-1202, no reorder at all, and the run only said so ten minutes
 * later as a red AC. `evaluateCosinePrecondition()` is the pure verdict the preflight acts on.
 *
 * Red-first: before FOLLOW-1233 the export did not exist and every empty-table row below could only
 * be discovered by a full run.
 *
 * @module tests/e2e/follow-819/cosine-precondition.test
 */

import { beforeAll, describe, expect, it } from 'vitest';

interface Facts {
  archetypeRows: number | null;
  listingRows: number | null;
  fixtureListingPresent: boolean | null;
  otherTenantListingRows: number | null;
  readError?: string | null;
}
interface Verdict {
  ok: boolean;
  code: string;
  reason: string;
}

let evaluateCosinePrecondition: (facts: Facts, ctx?: { tenantId?: string }) => Verdict;

beforeAll(async () => {
  (globalThis as Record<string, unknown>).FOLLOW1186_IMPORT_ONLY = true;
  const mod = (await import('./differentiator-e2e.mjs')) as unknown as {
    evaluateCosinePrecondition: typeof evaluateCosinePrecondition;
  };
  evaluateCosinePrecondition = mod.evaluateCosinePrecondition;
});

const SEEDED: Facts = {
  archetypeRows: 18,
  listingRows: 13,
  fixtureListingPresent: true,
  otherTenantListingRows: 0,
};
const TENANT = '00000000-0000-0000-0000-0000000000e2';

describe('evaluateCosinePrecondition (FOLLOW-1233)', () => {
  it('passes a fully seeded database', () => {
    expect(evaluateCosinePrecondition(SEEDED, { tenantId: TENANT })).toMatchObject({
      ok: true,
      code: 'cosine_ready',
    });
  });

  it('refuses an empty database and names both halves and the command', () => {
    const v = evaluateCosinePrecondition(
      { ...SEEDED, archetypeRows: 0, listingRows: 0, fixtureListingPresent: false },
      { tenantId: TENANT },
    );
    expect(v.ok).toBe(false);
    expect(v.code).toBe('archetype_embeddings_missing');
    expect(v.reason).toContain('seed:archetypes');
    expect(v.reason).toContain('seed:listings');
    expect(v.reason).toContain('localhost-up.sh');
  });

  it('refuses a half-seeded database: archetypes only (the djb2 / no-reorder state)', () => {
    const v = evaluateCosinePrecondition(
      { ...SEEDED, listingRows: 0, fixtureListingPresent: false },
      { tenantId: TENANT },
    );
    expect(v).toMatchObject({ ok: false, code: 'listing_embeddings_missing' });
  });

  it('refuses listings only', () => {
    const v = evaluateCosinePrecondition({ ...SEEDED, archetypeRows: 0 }, { tenantId: TENANT });
    expect(v).toMatchObject({ ok: false, code: 'archetype_embeddings_missing' });
  });

  it('refuses a database seeded for a DIFFERENT tenant and says so', () => {
    const v = evaluateCosinePrecondition(
      { ...SEEDED, listingRows: 0, fixtureListingPresent: false, otherTenantListingRows: 13 },
      { tenantId: TENANT },
    );
    expect(v.code).toBe('listing_embeddings_wrong_tenant');
    expect(v.reason).toContain(TENANT);
  });

  it('refuses when the fixture listing itself is absent', () => {
    const v = evaluateCosinePrecondition(
      { ...SEEDED, fixtureListingPresent: false },
      { tenantId: TENANT },
    );
    expect(v).toMatchObject({ ok: false, code: 'fixture_listing_embedding_missing' });
  });

  it('refuses fewer than the floor of archetype or listing rows', () => {
    expect(evaluateCosinePrecondition({ ...SEEDED, archetypeRows: 17 }).code).toBe(
      'archetype_embeddings_missing',
    );
    expect(evaluateCosinePrecondition({ ...SEEDED, listingRows: 12 }).code).toBe(
      'listing_embeddings_missing',
    );
  });

  it('refuses when the database cannot be read (never assumes seeded)', () => {
    const v = evaluateCosinePrecondition({
      archetypeRows: null,
      listingRows: null,
      fixtureListingPresent: null,
      otherTenantListingRows: null,
      readError: 'connect ECONNREFUSED',
    });
    expect(v).toMatchObject({ ok: false, code: 'cosine_precondition_unreadable' });
    expect(v.reason).toContain('ECONNREFUSED');
  });
});
