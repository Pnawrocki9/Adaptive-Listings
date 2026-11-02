// @vitest-environment node
// (same reason as ac9-verdict.test.ts: the package default is jsdom)

/**
 * FOLLOW-1344 — N3 must never read green over a hop that did not run. Pins the REAL pure functions of
 * `scripts/dev/real-app-acceptance.mjs` (imported, not copied). A row breaks exactly one thing.
 *
 * WHAT THIS DOES NOT COVER: whether the live real app produces these observations. That is the run
 * in `docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md` §5.1.
 *
 * Collected by `tests/e2e/vitest.config.ts`; run by `pnpm e2e:smoke` (nightly
 * `.github/workflows/e2e-smoke.yml`). It needs no substrate. This file is outside
 * `HARNESS_TREE_PATHSPEC`, so adding it stales no series artefact.
 *
 * @module tests/e2e/follow-819/real-app-acceptance-verdict.test
 */

import { beforeAll, describe, expect, it } from 'vitest';

interface Hop {
  hop: string;
  status: unknown;
  reason?: unknown;
}
interface Graded extends Hop {
  reason?: string;
  evidence?: { path?: string | null };
}
interface N3Module {
  N3_HOPS: string[];
  evaluateN3Run(results: unknown): {
    verdict: string;
    exitCode: number;
    red: string[];
    unmeasured: string[];
    excused: string[];
  };
  gradeSubstrate(facts: unknown): Graded;
  gradeRepoIdentity(facts: unknown): Graded;
  gradeFollowUp(call: unknown, gate: unknown): Graded;
  gradeSlot(id: string, facts: unknown): Graded;
  gradeDescription(facts: unknown): { answered: Graded; cached: Graded };
  gradeRestore(facts: unknown): Graded;
  gradeInquiryHop(facts: unknown): Graded;
  parseN3Args(argv: string[]): { exitCode: number | null; message: string | null };
}
/* eslint-disable @typescript-eslint/no-explicit-any -- rows hand the verdict malformed shapes */
let n3: N3Module;

beforeAll(async () => {
  (globalThis as any).FOLLOW1344_IMPORT_ONLY = true;
  // @ts-expect-error -- untyped .mjs dev script
  n3 = (await import('../../../scripts/dev/real-app-acceptance.mjs')) as N3Module;
});

const GATE = { value: 0.6, comparison: '<=', source: 'route.ts' };

const allGreen = (): Hop[] => n3.N3_HOPS.map((hop: string) => ({ hop, status: 'GREEN' }));
const withRow = (row: Hop): Hop[] => allGreen().map((r) => (r.hop === row.hop ? row : r));
const k4b = (): Hop[] =>
  withRow({ hop: 'inquiry_signed_rollup', status: 'UNMEASURED:phase5', reason: 'no emitter' });

describe('evaluateN3Run', () => {
  it('every hop green is GREEN, exit 0', () => {
    expect(n3.evaluateN3Run(allGreen())).toMatchObject({ verdict: 'GREEN', exitCode: 0 });
  });

  it('the phase5 hop unmeasured with a reason is GREEN_K4B and names the hop', () => {
    expect(n3.evaluateN3Run(k4b())).toMatchObject({
      verdict: 'GREEN_K4B',
      exitCode: 0,
      excused: ['inquiry_signed_rollup'],
    });
  });

  it('no hops at all, or not an array, is RED', () => {
    expect(n3.evaluateN3Run([])).toMatchObject({ verdict: 'RED', exitCode: 1 });
    expect(n3.evaluateN3Run(null)).toMatchObject({ verdict: 'RED', exitCode: 1 });
  });

  it.each(['RED', true, 'green', 'PASS', 'UNMEASURED', 'UNMEASURED:', null, undefined])(
    'status %s on a hop is RED',
    (status) => {
      const out = n3.evaluateN3Run(withRow({ hop: 'description_ai_cached', status }));
      expect(out).toMatchObject({ verdict: 'RED', exitCode: 1 });
    },
  );

  it('a missing hop is RED, for every hop', () => {
    for (const hop of n3.N3_HOPS) {
      const out = n3.evaluateN3Run(allGreen().filter((r) => r.hop !== hop));
      expect(out.red, hop).toEqual([`${hop}:not_recorded`]);
      expect(out.exitCode).toBe(1);
    }
  });

  it('a hop recorded twice, or an unknown hop, is RED', () => {
    expect(n3.evaluateN3Run([...allGreen(), { hop: 'substrate', status: 'GREEN' }]).verdict).toBe(
      'RED',
    );
    expect(n3.evaluateN3Run([...allGreen(), { hop: 'typo', status: 'GREEN' }]).verdict).toBe('RED');
  });

  it('phase5 cannot excuse any hop but the inquiry hop', () => {
    const out = n3.evaluateN3Run(
      withRow({ hop: 'restored_first_adapt', status: 'UNMEASURED:phase5', reason: 'later' }),
    );
    expect(out).toMatchObject({ verdict: 'UNMEASURED', exitCode: 1 });
  });

  it('UNMEASURED with no reason is RED, even on the inquiry hop', () => {
    const out = n3.evaluateN3Run(
      withRow({ hop: 'inquiry_signed_rollup', status: 'UNMEASURED:phase5' }),
    );
    expect(out.verdict).toBe('RED');
  });

  it('all draws in holdout is UNMEASURED, never green; a RED outranks it', () => {
    const held = withRow({ hop: 'adapt_llm_tweaked', status: 'UNMEASURED:holdout', reason: 'x' });
    expect(n3.evaluateN3Run(held)).toMatchObject({ verdict: 'UNMEASURED', exitCode: 1 });
    const both = held.map((r) => (r.hop === 'ingest_ack' ? { ...r, status: 'RED' } : r));
    expect(n3.evaluateN3Run(both).verdict).toBe('RED');
  });
});

describe('gradeSubstrate: the fixture cannot pass', () => {
  const real = () => ({
    listing: {
      status: 200,
      pathIsFixture: false,
      hasSvelteKit: true,
      listingId: 'real-id',
      fixtureListingId: 'fixture-id',
    },
    grounding: { ok: true, factsSource: null, reason: 'ok' },
    controlPlane: { ok: true, reason: 'ok' },
    quiz: { ok: true, reason: 'ok' },
    walkFound: true,
    build: { ok: true, reason: 'ok' },
  });

  it('the real app passes', () => {
    expect(n3.gradeSubstrate(real()).status).toBe('GREEN');
  });

  it.each([
    ['the fixture path', (f: any) => (f.listing.pathIsFixture = true)],
    ['a non-200 page', (f: any) => (f.listing.status = 404)],
    ['no SvelteKit document', (f: any) => (f.listing.hasSvelteKit = false)],
    ['no listing id', (f: any) => (f.listing.listingId = null)],
    ['the fixture listing id', (f: any) => (f.listing.listingId = 'fixture-id')],
    ['the fixture :8081, by its header', (f: any) => (f.grounding.factsSource = '/x/fixture.html')],
    ['no grounding', (f: any) => (f.grounding.ok = false)],
    ['the mock or a sick control plane', (f: any) => (f.controlPlane.ok = false)],
    ['no served quiz', (f: any) => (f.quiz.ok = false)],
    ['no walk to the leaf', (f: any) => (f.walkFound = false)],
    ['a stale build', (f: any) => (f.build.ok = false)],
  ])('%s is RED', (_name, breakIt) => {
    const f = real();
    breakIt(f);
    expect(n3.gradeSubstrate(f).status).toBe('RED');
  });
});

describe('gradeRepoIdentity', () => {
  const ok = () => ({ alSha: 'abc', alDirty: false, estalaraTree: { hash: 'h', files: 9 } });

  it('both repos named is green', () => {
    expect(n3.gradeRepoIdentity(ok()).status).toBe('GREEN');
  });

  it.each([
    ['no AL SHA', { alSha: null }],
    ['a dirty AL tree', { alDirty: true }],
    ['an unreadable AL tree', { alDirty: null }],
    ['no Estalara hash', { estalaraTree: null }],
    ['an empty Estalara tree', { estalaraTree: { hash: 'h', files: 0 } }],
  ])('%s is RED', (_name, patch) => {
    expect(n3.gradeRepoIdentity({ ...ok(), ...patch }).status).toBe('RED');
  });
});

describe('gradeFollowUp', () => {
  const body = () => ({
    source: 'llm_tweaked',
    archetype: 'yield_hunter',
    confidence: 0.9,
    directives: [{ type: 'text', slot: 'headline', value: 'x' }],
  });
  const call = (patch = {}, status = 200) => ({ status, body: { ...body(), ...patch } });

  it('the adapted answer is green', () => {
    expect(n3.gradeFollowUp(call(), GATE).status).toBe('GREEN');
  });

  it.each([
    ['llm_full', { source: 'llm_full' }],
    ['a playbook fallback', { source: 'playbook_fallback_llm_unavailable' }],
    ['another archetype', { archetype: 'family_buyer' }],
    ['confidence exactly at the strict gate', { confidence: 0.6 }],
    ['only a reorder', { directives: [{ type: 'reorder' }] }],
    ['a held-out body', { holdout_group: true }],
  ])('%s is RED', (_name, patch) => {
    expect(n3.gradeFollowUp(call(patch), GATE).status).toBe('RED');
  });

  it('no call, or a non-200, is RED', () => {
    expect(n3.gradeFollowUp(null, GATE).status).toBe('RED');
    expect(n3.gradeFollowUp(call({}, 500), GATE).status).toBe('RED');
  });
});

describe('gradeSlot', () => {
  const id = 'headline_dom_changed';

  it('changed into a served text is green, whitespace aside', () => {
    const f = { before: 'Seller', after: ' New  copy\n', served: ['New copy'] };
    expect(n3.gradeSlot(id, f).status).toBe('GREEN');
  });

  it('a long served text matches on its opening', () => {
    const served = 'x'.repeat(100);
    const f = { before: 'Seller', after: `${served.slice(0, 60)} and the rest`, served: [served] };
    expect(n3.gradeSlot(id, f).status).toBe('GREEN');
  });

  it.each([
    ['unchanged', { before: 'A', after: ' A ', served: ['A'] }],
    ['changed into text nobody served (a host re-render)', { before: 'A', after: 'B', served: [] }],
    ['served only an empty text', { before: 'A', after: 'B', served: [''] }],
    ['emptied', { before: 'A', after: '', served: ['B'] }],
    ['gone', { before: 'A', after: null, served: ['B'] }],
    ['no baseline', { before: null, after: 'B', served: ['B'] }],
  ])('%s is RED', (_name, f) => {
    expect(n3.gradeSlot(id, f).status).toBe('RED');
  });
});

describe('gradeDescription', () => {
  const hit = { status: 200, source: 'ai_cached', description: 'copy' };
  const miss = { status: 200, source: 'template_fallback', description: '' };
  const grade = (calls: any[], polls: any[] = []) =>
    n3.gradeDescription({ calls, polls, budgetMs: 180000, reloaded: false });

  it('a hit on the first call', () => {
    const out = grade([hit]);
    expect([out.answered.status, out.cached.status]).toEqual(['GREEN', 'GREEN']);
    expect(out.cached.evidence?.path).toBe('first_call');
  });

  it('a cold miss that warmed and was served after the reload', () => {
    const out = grade([miss, hit], [miss, hit]);
    expect(out.cached.status).toBe('GREEN');
    expect(out.cached.evidence?.path).toBe('after_cold_miss');
  });

  it('a cold miss that never arrives is its own failure, and the endpoint still answered', () => {
    const out = grade([miss], [miss, miss]);
    expect(out.answered.status).toBe('GREEN');
    expect(out.cached.status).toBe('RED');
    expect(out.cached.reason).toContain('ai_cached_never_arrived');
  });

  it('warmed by the poll, but the page was never served it, is RED', () => {
    expect(grade([miss], [hit]).cached.status).toBe('RED');
  });

  it('ai_cached with no text is no hit', () => {
    expect(grade([{ ...hit, description: '' }]).cached.status).toBe('RED');
  });

  it('a broken endpoint fails both hops; no call at all too', () => {
    const out = grade([{ status: 500, source: null, description: null }]);
    expect([out.answered.status, out.cached.status]).toEqual(['RED', 'RED']);
    const none = grade([]);
    expect([none.answered.status, none.cached.status]).toEqual(['RED', 'RED']);
  });
});

describe('gradeRestore', () => {
  const call = (patch = {}, top = {}) => ({
    xidTag: 'tag',
    status: 200,
    body: {
      profile_restore: 'restored',
      source: 'llm_tweaked',
      archetype: 'yield_hunter',
      directives: [{ type: 'text', slot: 'headline', value: 'x' }],
      ...patch,
    },
    ...top,
  });
  const grade = (c: any, tag: string | null = 'tag') =>
    n3.gradeRestore({ sessionOneXidTag: tag, call: c, attempts: 1 });

  it('the first call, same xid, restored and adapted, is green', () => {
    expect(grade(call()).status).toBe('GREEN');
  });

  it.each([
    ['a miss', call({ profile_restore: 'miss' })],
    ['an error', call({ profile_restore: 'error' })],
    ['no restore field', call({ profile_restore: undefined })],
    ['restored but not adapted', call({ source: 'default', directives: [] })],
    ['another archetype', call({ archetype: 'family_buyer' })],
    ['held out', call({ holdout_group: true })],
    ['no xid sent', call({}, { xidTag: null })],
    ['another xid', call({}, { xidTag: 'other' })],
    ['a non-200', call({}, { status: 500 })],
    ['no call', null],
  ])('%s is RED', (_name, c) => {
    expect(grade(c).status).toBe('RED');
  });

  it('session 1 left no xid: RED', () => {
    expect(grade(call(), null).status).toBe('RED');
  });
});

describe('gradeInquiryHop: the excuse expires by itself', () => {
  it('no emitter in the app is UNMEASURED:phase5 with a reason', () => {
    const out = n3.gradeInquiryHop({ readable: true, emitterFiles: [], error: null });
    expect(out.status).toBe('UNMEASURED:phase5');
    expect(out.reason).toMatch(/X1/);
  });

  it('an emitter N3 does not measure yet is RED', () => {
    const f = { readable: true, emitterFiles: ['core-master/src/X.kt'], error: null };
    expect(n3.gradeInquiryHop(f).status).toBe('RED');
  });

  it('an unreadable source is RED, not an excuse', () => {
    const f = { readable: false, emitterFiles: [], error: 'ENOENT' };
    expect(n3.gradeInquiryHop(f).status).toBe('RED');
  });
});

describe('parseN3Args', () => {
  it('--arms exits 2, not implemented', () => {
    expect(n3.parseN3Args(['--arms', '40'])).toMatchObject({ exitCode: 2 });
    expect(n3.parseN3Args(['--arms', '40']).message).toMatch(/not implemented/);
  });

  it('an unknown flag exits 2; no flag runs', () => {
    expect(n3.parseN3Args(['--nope']).exitCode).toBe(2);
    expect(n3.parseN3Args([]).exitCode).toBeNull();
  });
});
