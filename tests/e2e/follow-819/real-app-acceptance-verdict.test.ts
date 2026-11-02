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
  N3_ARMS_HOPS: string[];
  N3_DURABLE_HOPS: string[];
  evaluateN3Run(
    results: unknown,
    hops?: string[],
  ): {
    verdict: string;
    exitCode: number;
    red: string[];
    unmeasured: string[];
  };
  gradeSubstrate(facts: unknown): Graded;
  gradeRepoIdentity(facts: unknown): Graded;
  gradeFollowUp(call: unknown, gate: unknown): Graded;
  gradeSlot(id: string, facts: unknown): Graded;
  gradeDescription(facts: unknown): { answered: Graded; cached: Graded };
  gradeRestore(facts: unknown): Graded;
  gradeHostCookie(facts: unknown): Graded;
  gradeSlotMarker(id: string, facts: unknown): Graded;
  gradeCtaWorks(facts: unknown): Graded;
  gradeConversionHeader(facts: unknown): Graded;
  gradeBackendSent(facts: unknown): Graded;
  readBackendCountsSettled(
    before: Record<string, number> | null,
    o: { read: () => Promise<Record<string, number> | null>; budgetMs: number; pollMs: number },
  ): Promise<Record<string, number> | null>;
  describeConsentText(c: unknown): string;
  describeRollupRead(r: unknown): string;
  gradeSdkGlobal(obs: unknown): string | null;
  gradeRows(facts: unknown): Graded;
  gradeLiftReader(facts: unknown): Graded;
  gradeLiftRoute(facts: unknown): Graded;
  gradeNegativeControl(id: string, facts: unknown): Graded;
  gradeBackendLog(facts: unknown): Graded;
  gradeListingSave(facts: unknown): Graded;
  gradeDurableRetry(facts: unknown): Graded;
  predictHoldout(secret: string, tenant: string, unit: string, pct: number): boolean;
  drawIdsForArm(
    arm: string,
    secret: string,
    tenant: string,
    pct: number,
    draw?: () => string,
  ): { sessionId: string; xid: string };
  conversionPlan(i: number): string[];
  gradeArmSessions(n: number, sessions: unknown): Graded;
  gradeArmConversions(sessions: unknown): Graded;
  gradeArmsReader(facts: unknown): Graded & { evidence?: { poolIsRun?: boolean } };
  gradeArmsSample(n: number): Graded;
  parseN3Args(argv: string[]): {
    exitCode: number | null;
    message: string | null;
    mode: string | null;
    arms: number | null;
  };
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

describe('evaluateN3Run', () => {
  it('every hop green is GREEN, exit 0', () => {
    expect(n3.evaluateN3Run(allGreen())).toMatchObject({ verdict: 'GREEN', exitCode: 0 });
  });

  it('the K4b excuse is gone: phase5 on a conversion hop is no pass', () => {
    const out = n3.evaluateN3Run(
      withRow({ hop: 'conversion_rows_signed', status: 'UNMEASURED:phase5', reason: 'later' }),
    );
    expect(out).toMatchObject({ verdict: 'UNMEASURED', exitCode: 1 });
  });

  it('a mode grades its own hop list: the full list on an arms run is RED, its own is GREEN', () => {
    const arms = n3.N3_ARMS_HOPS.map((hop) => ({ hop, status: 'GREEN' }));
    expect(n3.evaluateN3Run(arms, n3.N3_ARMS_HOPS).verdict).toBe('GREEN');
    expect(n3.evaluateN3Run(arms).verdict).toBe('RED');
    const durable = n3.N3_DURABLE_HOPS.map((hop) => ({ hop, status: 'GREEN' }));
    expect(n3.evaluateN3Run(durable, n3.N3_DURABLE_HOPS).verdict).toBe('GREEN');
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

  it('UNMEASURED with no reason is RED', () => {
    const out = n3.evaluateN3Run(withRow({ hop: 'lift_route_http', status: 'UNMEASURED:x' }));
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

describe('gradeHostCookie', () => {
  const ok = { clicked: true, stored: JSON.stringify({ necessary: true, optional: true }) };

  it('a click that stored optional true is green', () => {
    expect(n3.gradeHostCookie(ok).status).toBe('GREEN');
  });

  it.each([
    ['never clicked, even with the value in place', { ...ok, clicked: false }],
    ['refused analytics', { ...ok, stored: JSON.stringify({ necessary: true, optional: false }) }],
    ['nothing stored', { ...ok, stored: null }],
    ['not JSON', { ...ok, stored: 'yes' }],
  ])('%s is RED', (_name, f) => {
    expect(n3.gradeHostCookie(f).status).toBe('RED');
  });
});

describe('gradeSlotMarker', () => {
  const ok = () => ({
    slot: 'cta',
    markers: 2,
    visibleMarkers: 1,
    before: 'Send a message',
    after: 'Request Commercial Pack',
    served: ['Request Commercial Pack'],
    applied: true,
    skipped: [] as string[],
  });

  it('a marker the SDK wrote with served text is green', () => {
    expect(n3.gradeSlotMarker('cta_slot', ok()).status).toBe('GREEN');
  });

  it.each([
    ['no marker', { markers: 0, visibleMarkers: 0 }],
    ['a marker nobody can see', { visibleMarkers: 0 }],
    ['changed into text nobody served', { after: 'A host re-render' }],
    ['served, unchanged, and the SDK silent', { after: 'Send a message' }],
  ])('%s is RED', (_name, patch) => {
    expect(n3.gradeSlotMarker('cta_slot', { ...ok(), ...patch }).status).toBe('RED');
  });

  it('no directive served is not measured, never green', () => {
    const f = { ...ok(), after: 'Send a message', served: [] };
    expect(n3.gradeSlotMarker('cta_slot', f).status).toBe('UNMEASURED:no_directive');
  });

  it('a skip the SDK explains is not measured, with the reason, never green', () => {
    const f = { ...ok(), after: 'Send a message', skipped: ['no_slot_elements'] };
    const out = n3.gradeSlotMarker('cta_slot', f);
    expect(out.status).toBe('UNMEASURED:sdk_skipped');
    expect(out.reason).toContain('no_slot_elements');
  });
});

describe('gradeCtaWorks', () => {
  const ok = {
    adapted: true,
    anonymousOpensLogin: true,
    conversationStatus: 201,
    messagesUrl: true,
    text: 'x',
  };

  it('both clicks did their job on adapted copy: green', () => {
    expect(n3.gradeCtaWorks(ok).status).toBe('GREEN');
  });

  it.each([
    ['the seller copy, not adapted', { adapted: false }],
    ['no login prompt', { anonymousOpensLogin: false }],
    ['a refused conversation', { conversationStatus: 429 }],
    ['no call at all', { conversationStatus: null }],
    ['no thread reached', { messagesUrl: false }],
    ['a driver throw', { error: 'boom' }],
  ])('%s is RED', (_name, patch) => {
    expect(n3.gradeCtaWorks({ ...ok, ...patch }).status).toBe('RED');
  });
});

describe('gradeConversionHeader', () => {
  const sid = 'session-1';
  const ok = () => ({
    sessionId: sid,
    tabSessionId: sid,
    headerRequests: [
      { method: 'POST', path: '/api/v1/calendar/event/live/enrollment', value: sid },
      { method: 'POST', path: '/api/v1/conversation', value: sid },
    ],
    conversionCalls: [
      { kind: 'live', value: sid, status: 200 },
      { kind: 'contact', value: sid, status: 201 },
    ],
  });

  it('both calls, the SDK session, nowhere else: green', () => {
    expect(n3.gradeConversionHeader(ok()).status).toBe('GREEN');
  });

  it.each([
    ['a call without the header', (f: any) => (f.conversionCalls[0].value = null)],
    ['another session on a call', (f: any) => (f.conversionCalls[1].value = 'other')],
    ['a refused call', (f: any) => (f.conversionCalls[1].status = 500)],
    ['only one of the two calls', (f: any) => void f.conversionCalls.pop()],
    ['no SDK session read', (f: any) => (f.sessionId = null)],
    ['the tab on another session', (f: any) => (f.tabSessionId = 'other')],
    [
      'the header on an unrelated path',
      (f: any) =>
        void f.headerRequests.push({ method: 'GET', path: '/api/v1/listing/all', value: sid }),
    ],
    [
      'the header on a GET of an allowed path',
      (f: any) =>
        void f.headerRequests.push({ method: 'GET', path: '/api/v1/conversation', value: sid }),
    ],
  ])('%s is RED', (_name, breakIt) => {
    const f = ok();
    breakIt(f);
    expect(n3.gradeConversionHeader(f).status).toBe('RED');
  });
});

describe('gradeBackendSent', () => {
  const counts = (live: number, inquiry: number, failed = 0) => ({
    'sent live.signup': live,
    'sent inquiry.completed': inquiry,
    failed,
  });

  it('each type moved by exactly one: green', () => {
    const f = { before: counts(4, 7), after: counts(5, 8) };
    expect(n3.gradeBackendSent(f).status).toBe('GREEN');
  });

  it.each([
    ['live did not move', counts(4, 8)],
    ['contact did not move', counts(5, 7)],
    ['a type moved twice', counts(6, 8)],
    ['a failure line appeared', counts(5, 8, 1)],
  ])('%s is RED', (_name, after) => {
    expect(n3.gradeBackendSent({ before: counts(4, 7), after }).status).toBe('RED');
  });

  it('an unreadable log is RED', () => {
    expect(n3.gradeBackendSent({ before: null, after: counts(1, 1) }).status).toBe('RED');
  });
});

describe('gradeRows', () => {
  const row = (type: string, caller_signed = 1, after_first_decision = 1) => ({
    type,
    caller_signed,
    after_first_decision,
  });
  const both = () => [row('live.signup'), row('inquiry.completed')];

  it('both types, signed, after the first decision: green', () => {
    expect(n3.gradeRows({ sessionId: 's', rows: both() }).status).toBe('GREEN');
  });

  it('a repeated row is no failure, and it is counted in the evidence', () => {
    const again = { ...row('live.signup'), event_id: 'a' };
    const rows = [again, again, { ...row('inquiry.completed'), event_id: 'b' }];
    const out = n3.gradeRows({ sessionId: 's', rows });
    expect(out.status).toBe('GREEN');
    expect((out.evidence as { repeatedRows?: number }).repeatedRows).toBe(1);
  });

  it.each([
    ['one type missing', [row('live.signup')]],
    ['unsigned (a browser event)', [row('live.signup', 0), row('inquiry.completed')]],
    ['before the first decision', [row('live.signup', 1, 0), row('inquiry.completed')]],
    ['no rows', []],
    ['ClickHouse unreadable', null],
    ['another type back', [...both(), row('cta.clicked')]],
  ])('%s is RED', (_name, rows) => {
    expect(n3.gradeRows({ sessionId: 's', rows }).status).toBe('RED');
  });
});

describe('gradeLiftReader', () => {
  const body = (conversions: number, live: number, contact: number, holdout = 0) => ({
    conversion_source: 'signed_events',
    conversion_breakdown: {
      adapted: {
        conversions,
        live_signups: live,
        agent_contacts: contact,
        live_signup_rate: 0.1,
        agent_contact_rate: 0.2,
      },
      holdout: { conversions: holdout },
    },
  });
  const rollup = { conversion_source: 'signed_events' };
  const grade = (after: unknown, r: unknown = rollup) =>
    n3.gradeLiftReader({ reader: 'route', before: body(3, 2, 1), after, rollup: r });

  it('one session, both events: conversions +1, each part +1. Green', () => {
    expect(grade(body(4, 3, 2)).status).toBe('GREEN');
  });

  it.each([
    ['counted as two conversions', body(5, 3, 2)],
    ['not counted', body(3, 2, 1)],
    ['the live part missing', body(4, 2, 2)],
    ['the contact part missing', body(4, 3, 1)],
    ['a holdout conversion too', body(4, 3, 2, 1)],
    ['another source', { ...body(4, 3, 2), conversion_source: 'disabled' }],
    ['no breakdown', { conversion_source: 'signed_events', conversion_breakdown: null }],
  ])('%s is RED', (_name, after) => {
    expect(grade(after).status).toBe('RED');
  });

  it('the running plane disagreeing on the source is RED', () => {
    expect(grade(body(4, 3, 2), { conversion_source: 'disabled' }).status).toBe('RED');
    expect(grade(body(4, 3, 2), null).status).toBe('RED');
  });

  it('a rate that is not a number is RED', () => {
    const after = body(4, 3, 2) as any;
    after.conversion_breakdown.adapted.live_signup_rate = null;
    expect(grade(after).status).toBe('RED');
  });
});

describe('gradeLiftRoute', () => {
  it('no secret is not measured, never green', () => {
    const f = { secretPresent: false, status: null, source: null };
    expect(n3.gradeLiftRoute(f).status).toBe('UNMEASURED:no_staff_jwt');
  });

  it('with a secret, the route must answer signed events', () => {
    const ok = { secretPresent: true, status: 200, source: 'signed_events' };
    expect(n3.gradeLiftRoute(ok).status).toBe('GREEN');
    expect(n3.gradeLiftRoute({ ...ok, status: 401 }).status).toBe('RED');
    expect(n3.gradeLiftRoute({ ...ok, source: 'disabled' }).status).toBe('RED');
  });
});

describe('gradeNegativeControl: green needs a call that would have converted', () => {
  const ok = () => ({
    clicks: [
      { kind: 'live', status: 200, value: null },
      { kind: 'contact', status: 201, value: null },
    ],
    headerRequests: [] as unknown[],
    rowsSince: 0,
    skippedBefore: 10,
    skippedAfter: 12,
    stateAtClick: {},
    sessionId: 's',
  });

  it('calls made, no header, no row, the backend said why: green', () => {
    expect(n3.gradeNegativeControl('negative_consent_denied', ok()).status).toBe('GREEN');
  });

  it.each([
    ['no call at all, which proves nothing', (f: any) => (f.clicks = [])],
    ['only one call', (f: any) => void f.clicks.pop()],
    ['a refused call, no new conversion', (f: any) => (f.clicks[1].status = 200 + 300)],
    ['the header on a call', (f: any) => (f.clicks[0].value = 's')],
    ['the header anywhere', (f: any) => void f.headerRequests.push({ path: '/x' })],
    ['a row landed', (f: any) => (f.rowsSince = 1)],
    ['ClickHouse unreadable', (f: any) => (f.rowsSince = null)],
    ['the listener never saw the event', (f: any) => (f.skippedAfter = 10)],
    ['the log unreadable', (f: any) => (f.skippedBefore = null)],
    ['a driver throw', (f: any) => (f.error = 'boom')],
  ])('%s is RED', (_name, breakIt) => {
    const f = ok();
    breakIt(f);
    expect(n3.gradeNegativeControl('negative_consent_denied', f).status).toBe('RED');
  });
});

describe('gradeBackendLog', () => {
  it('ids searched, none found: green', () => {
    expect(n3.gradeBackendLog({ ids: 6, hits: 0 }).status).toBe('GREEN');
  });

  it.each([
    ['a hit', { ids: 6, hits: 1 }],
    ['nothing to search for', { ids: 0, hits: 0 }],
    ['an unreadable log', { ids: 6, hits: null, error: 'ENOENT' }],
  ])('%s is RED', (_name, f) => {
    expect(n3.gradeBackendLog(f).status).toBe('RED');
  });
});

describe('gradeListingSave', () => {
  const ok = { saveStatus: 200, revisionBefore: 4, revisionAfter: 5, jobStatus: 'SUCCEEDED' };

  it('a save, its job done, the revision up: green', () => {
    expect(n3.gradeListingSave(ok).status).toBe('GREEN');
  });

  it.each([
    ['a refused save', { saveStatus: 403 }],
    ['the job still waiting', { jobStatus: 'RETRY_WAIT' }],
    ['no job', { jobStatus: null }],
    ['the revision unmoved', { revisionAfter: 4 }],
    ['the revision unreadable', { revisionAfter: null }],
  ])('%s is RED', (_name, patch) => {
    expect(n3.gradeListingSave({ ...ok, ...patch }).status).toBe('RED');
  });
});

describe('gradeDurableRetry', () => {
  const ok = {
    inserted: true,
    status: 'RETRY_WAIT',
    attempts: 1,
    lastError: 'status=400',
    waitedMs: 1,
  };

  it('refused, and waiting to retry: green', () => {
    expect(n3.gradeDurableRetry(ok).status).toBe('GREEN');
  });

  it.each([
    ['delivered, so nothing was refused', { status: 'SUCCEEDED' }],
    ['still pending, no attempt', { status: 'PENDING', attempts: 0 }],
    ['given up at once', { status: 'DEAD_LETTER' }],
    ['no error kept', { lastError: null }],
    ['the probe not written', { inserted: false }],
  ])('%s is RED', (_name, patch) => {
    expect(n3.gradeDurableRetry({ ...ok, ...patch }).status).toBe('RED');
  });
});

describe('the arm draw mirrors the server', () => {
  const secret = 'a-local-test-key-of-enough-length-000';
  const tenant = '00000000-0000-0000-0000-0000000000e2';

  it('agrees with the real assignHoldout on 200 ids, in both arms', async () => {
    const { assignHoldout } = await import('../../../packages/shared/src/ab-holdout');
    const seen = new Set<boolean>();
    for (let i = 0; i < 200; i++) {
      const unit = `unit-${String(i)}`;
      const server = await assignHoldout({
        tenant_id: tenant,
        session_id: unit,
        holdout_pct: 0.1,
        assignment_secret: secret,
      });
      const mine = n3.predictHoldout(secret, tenant, unit, 0.1);
      expect(mine, unit).toBe((server as { holdout_group: boolean }).holdout_group);
      seen.add(mine);
    }
    expect([...seen].sort()).toEqual([false, true]);
  });

  it('draws both ids into the asked arm, and never the other', () => {
    for (const arm of ['adapted', 'holdout']) {
      const { sessionId, xid } = n3.drawIdsForArm(arm, secret, tenant, 0.1);
      expect(n3.predictHoldout(secret, tenant, sessionId, 0.1)).toBe(arm === 'holdout');
      expect(n3.predictHoldout(secret, tenant, xid, 0.1)).toBe(arm === 'holdout');
    }
  });

  it('an arm no id can draw throws rather than running the wrong arm', () => {
    expect(() => n3.drawIdsForArm('holdout', secret, tenant, 0, () => 'same')).toThrow(/no id/);
  });
});

describe('conversionPlan', () => {
  it('half the sessions convert, with each part and both together', () => {
    const six = [0, 1, 2, 3, 4, 5].map((i) => n3.conversionPlan(i));
    expect(six.filter((p) => p.length > 0)).toHaveLength(3);
    expect(six.flat().sort()).toEqual(['contact', 'contact', 'live', 'live']);
    expect(n3.conversionPlan(6)).toEqual(six[0]);
  });
});

describe('gradeArmSessions', () => {
  const s = (arm: string, servedHoldout: boolean | null, patch = {}) => ({
    arm,
    servedHoldout,
    decisions: 2,
    ...patch,
  });

  it('N of each, by the server: green', () => {
    expect(n3.gradeArmSessions(1, [s('adapted', false), s('holdout', true)]).status).toBe('GREEN');
  });

  it.each([
    ['a short arm', [s('adapted', false)]],
    ['a holdout the server adapted', [s('adapted', false), s('holdout', false)]],
    ['an adapted the server held out', [s('adapted', true), s('holdout', true)]],
    ['no answer', [s('adapted', null), s('holdout', true)]],
    ['no decision', [s('adapted', false, { decisions: 0 }), s('holdout', true)]],
    [
      'one session in both arms',
      [s('adapted', false, { servedBothArms: true }), s('holdout', true)],
    ],
    ['a throw', [s('adapted', false, { error: 'boom' }), s('holdout', true)]],
  ])('%s is RED', (_name, sessions) => {
    expect(n3.gradeArmSessions(1, sessions).status).toBe('RED');
  });
});

describe('gradeArmConversions', () => {
  const row = (type: string, caller_signed = 1) => ({ type, caller_signed });
  const s = (plan: string[], rows: unknown) => ({ arm: 'adapted', sessionId: 's', plan, rows });

  it('what was planned landed, signed, and nothing else: green', () => {
    const sessions = [
      s(['live', 'contact'], [row('live.signup'), row('inquiry.completed')]),
      s([], []),
    ];
    expect(n3.gradeArmConversions(sessions).status).toBe('GREEN');
  });

  it('a re-send of one event is one conversion, as the lift counts it', () => {
    const again = { ...row('live.signup'), event_id: 'a' };
    expect(n3.gradeArmConversions([s(['live'], [again, again])]).status).toBe('GREEN');
  });

  it.each([
    ['a planned one missing', s(['live'], [])],
    ['an unplanned one', s([], [row('live.signup')])],
    ['an unsigned one', s(['live'], [row('live.signup', 0)])],
    [
      'two different events for one plan',
      s(
        ['live'],
        [
          { ...row('live.signup'), event_id: 'a' },
          { ...row('live.signup'), event_id: 'b' },
        ],
      ),
    ],
    ['ClickHouse unreadable', s(['live'], null)],
  ])('%s is RED', (_name, session) => {
    expect(n3.gradeArmConversions([session]).status).toBe('RED');
  });
});

describe('gradeArmsReader and gradeArmsSample', () => {
  const runScoped = { adaptedN: 2, adaptedConversions: 1, holdoutN: 2, holdoutConversions: 1 };
  const body = (patch = {}) => ({
    conversion_source: 'signed_events',
    summary: {
      holdout_cta_rate: 0.5,
      relative_lift_pct: 0,
      confidence: 'not_significant',
      ...patch,
    },
    conversion_breakdown: { adapted: { sessions: 2 }, holdout: { sessions: 2 } },
  });
  const grade = (b: unknown) => n3.gradeArmsReader({ reader: 'route', body: b, runScoped });

  it('a percent and a class: green, and it says whether the pool was the run', () => {
    expect(grade(body()).status).toBe('GREEN');
    expect(grade(body()).evidence?.poolIsRun).toBe(true);
    const pooled = { ...body(), conversion_breakdown: { adapted: { sessions: 900 }, holdout: {} } };
    expect(grade(pooled).status).toBe('GREEN');
    expect(grade(pooled).evidence?.poolIsRun).toBe(false);
  });

  it.each([
    ['no percent over a converting holdout', body({ relative_lift_pct: null })],
    ['no class', body({ confidence: null })],
    ['no summary', { conversion_source: 'signed_events', summary: null }],
    ['another source', { ...body(), conversion_source: 'disabled' }],
  ])('%s is RED', (_name, b) => {
    expect(grade(b).status).toBe('RED');
  });

  it('a null percent with no holdout conversion is the formula, not a failure', () => {
    expect(grade(body({ holdout_cta_rate: 0, relative_lift_pct: null })).status).toBe('GREEN');
  });

  it('under 30 per arm the sample is not measured; at 30 it is', () => {
    expect(n3.gradeArmsSample(29).status).toBe('UNMEASURED:small_n');
    expect(n3.gradeArmsSample(30).status).toBe('GREEN');
  });
});

describe('parseN3Args', () => {
  it('--arms N runs, a bad N exits 2', () => {
    expect(n3.parseN3Args(['--arms', '40'])).toMatchObject({
      exitCode: null,
      mode: 'arms',
      arms: 40,
    });
    for (const bad of [
      ['--arms'],
      ['--arms', '0'],
      ['--arms', '-1'],
      ['--arms', 'x'],
      ['--arms', '2', 'y'],
    ]) {
      expect(n3.parseN3Args(bad).exitCode, bad.join(' ')).toBe(2);
    }
  });

  it('--durable-webhook is its own mode', () => {
    expect(n3.parseN3Args(['--durable-webhook'])).toMatchObject({
      exitCode: null,
      mode: 'durable',
    });
  });

  it('an unknown flag exits 2; no flag runs', () => {
    expect(n3.parseN3Args(['--nope']).exitCode).toBe(2);
    expect(n3.parseN3Args([])).toMatchObject({ exitCode: null, mode: 'run' });
  });
});

describe('FOLLOW-1344 honest measurements', () => {
  const counts = (live: number, inquiry: number) => ({
    'sent live.signup': live,
    'sent inquiry.completed': inquiry,
    failed: 0,
  });

  it('a late sent line is waited for: the last read grades green', async () => {
    let reads = 0;
    const read = async () => (++reads < 3 ? counts(4, 7) : counts(5, 8));
    const after = await n3.readBackendCountsSettled(counts(4, 7), {
      read,
      budgetMs: 1000,
      pollMs: 1,
    });
    expect(reads).toBe(3);
    expect(n3.gradeBackendSent({ before: counts(4, 7), after }).status).toBe('GREEN');
  });

  it('a send that never happens stays RED after the bounded wait', async () => {
    const read = async () => counts(4, 7);
    const after = await n3.readBackendCountsSettled(counts(4, 7), {
      read,
      budgetMs: 20,
      pollMs: 5,
    });
    expect(n3.gradeBackendSent({ before: counts(4, 7), after }).status).toBe('RED');
  });

  it('an unreadable log is returned at once, not waited on', async () => {
    let reads = 0;
    const read = async () => (++reads, null);
    expect(
      await n3.readBackendCountsSettled(counts(1, 1), { read, budgetMs: 1000, pollMs: 1 }),
    ).toBe(null);
    expect(reads).toBe(1);
  });

  it('the consent-text request is named, or its absence is', () => {
    expect(n3.describeConsentText(null)).toBe('no /consent-text.json request was seen');
    expect(
      n3.describeConsentText({ path: '/consent-text.json', status: 503, durationMs: 120 }),
    ).toBe('/consent-text.json status 503, 120 ms');
    expect(
      n3.describeConsentText({
        path: '/consent-text.json',
        status: null,
        durationMs: 3000,
        failure: 'net::ERR_ABORTED',
      }),
    ).toContain('failed (net::ERR_ABORTED)');
  });

  it('window.Estalara: seen is silent, unread says not measured, read-absent says absent', () => {
    expect(n3.gradeSdkGlobal({ sdkGlobal: true })).toBeNull();
    expect(n3.gradeSdkGlobal({ sdkGlobal: null })).toContain('not measured');
    expect(n3.gradeSdkGlobal({ sdkGlobal: null })).not.toContain('never appeared');
    expect(
      n3.gradeSdkGlobal({
        sdkGlobal: false,
        sdkGlobalRead: 'once, when the accept button never appeared',
      }),
    ).toContain('was absent');
    expect(n3.gradeSdkGlobal({ sdkGlobal: false })).toContain('never appeared');
  });

  it('a rollup that gave no body says why, and stays RED', () => {
    const body = (n: number) => ({
      conversion_source: 'signed_events',
      conversion_breakdown: {
        adapted: {
          conversions: n,
          live_signups: n - 1,
          agent_contacts: n - 2,
          live_signup_rate: 0.1,
          agent_contact_rate: 0.2,
        },
        holdout: { conversions: 0 },
      },
    });
    const grade = (rollupRead: unknown) =>
      n3.gradeLiftReader({
        reader: 'route',
        before: body(3),
        after: body(4),
        rollup: null,
        rollupRead,
      });
    const noSecret = grade({ secretPresent: false, status: null, error: null });
    expect(noSecret.status).toBe('RED');
    expect(noSecret.reason).toContain('ADMIN_API_SECRET absent');
    expect(grade({ secretPresent: true, status: 401, error: null }).reason).toContain(
      'rollup HTTP 401',
    );
    expect(grade({ secretPresent: true, status: null, error: 'fetch failed' }).reason).toContain(
      'fetch failed',
    );
  });
});
