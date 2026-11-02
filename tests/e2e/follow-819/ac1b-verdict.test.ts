// @vitest-environment node
// (the package default is jsdom, whose global `URL` `createRequire()` rejects at the harness's
// top-level Playwright resolution — same reason the sibling files pin this)

/**
 * FOLLOW-1345 AC(1b) — grounding fidelity, a sub-check of AC(1): what the session was SERVED as a
 * description is read off the wire and the page, and checked against the listing on `:8081`.
 *
 * What is real here:
 *   - the SOURCE: `createFixtureListingDetailsServer()`, on an ephemeral port, serving the SAME
 *     `fixture-listing.html` the harness drives the browser against;
 *   - the CHECK: `runAc1bClaimCheck()` out of the harness, the function `main()` calls. It spawns
 *     `tsx` on `ac1b-claim-check.cts` exactly as a live run does, so `fetchDescriptionGrounding()`,
 *     `buildGrounding()` and `checkTypedClaims()` run unmocked over a real HTTP hop. Every claim
 *     verdict below is that subprocess's output, never a typed-in one. This is the live-only path
 *     the rest of the harness keeps out of CI (harness lesson, session 172), so it is run here;
 *   - the PLAYBOOKS: `getAllPlaybooks()`, every archetype and locale, against the marker check;
 *   - the GRADE: `evaluateAc1()`, `foldAc1bIntoAc1()` and `gradeRun()`, as `main()` calls them.
 *
 * What is typed in, and only a live run can show otherwise: the served bodies. They are the shape
 * `GET /api/adapt/description` answers (`route.follow1318.test.ts` pins that route) and they go
 * through the Playwright observer below on a stand-in `context`.
 *
 * Collected by `tests/e2e/vitest.config.ts` (`**\/*.test.ts`); run by `pnpm e2e:smoke`, which
 * `.github/workflows/e2e-smoke.yml` executes nightly. It needs no substrate and takes no flag.
 *
 * @module tests/e2e/follow-819/ac1b-verdict.test
 */

import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getAllPlaybooks } from '@estalara/shared/playbooks';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE_PATH = path.join(HERE, 'fixture-listing.html');
const LISTING_ID = '839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c';
const SELLER =
  'A three-bedroom, two-bathroom single-family home on a quiet residential street. Open-plan ' +
  'living area, attached two-car garage, screened lanai and a mature garden. Close to schools, ' +
  'the intracoastal waterway and local amenities.';

interface Claim {
  kind: string;
  key: string;
  value: string;
  source: string | null;
  violation: string | null;
}
interface ClaimCheck {
  original?: string;
  fields?: Record<string, string>;
  claims?: Claim[][];
  error?: string;
}
interface Call {
  seq?: number;
  status: number | null;
  source?: string | null;
  description?: string | null;
  headline?: string | null;
  unreadable?: string | null;
}
interface Fidelity {
  ok: boolean;
  verdict: 'PASS' | 'FAIL' | 'UNMEASURED';
  unmeasured: 'holdout' | 'no_description' | null;
  texts: { via: string; field: string; text: string }[];
  failures: { kind: string; violation?: string; value?: string; field?: string }[];
  passedWithoutGroundedField: { value: string }[];
  summary: string;
}
interface Ac1bIn {
  calls: readonly Call[];
  page?: { seller: string | null; painted: string | null } | null;
  drewHoldout: boolean | null;
  adaptedResponseSeen: boolean;
  claimCheck: ClaimCheck | null;
}
interface Result {
  ac: string;
  name: string;
  ok: boolean;
  evidence: Record<string, unknown>;
}
interface Grade {
  results: (Result & { verdict: string; unmeasuredBecause: string | null })[];
  tally: { green: number; red: number; unmeasured: number; total: number };
  runVerdict: string;
  tallyLine: string;
  summaryLine: string;
}
interface Observer {
  calls: Call[];
  settle: (budgetMs?: number) => Promise<void>;
}

let evaluateAc1b: (input: Ac1bIn) => Fidelity;
let servedDescriptionTexts: (
  calls: readonly Call[],
  page?: Ac1bIn['page'],
) => { via: string; field: string; text: string }[];
let findPlaybookMarkers: (text: string) => string[];
let runAc1bClaimCheck: (input: {
  listingId: string;
  locale: string;
  texts: string[];
  groundingOrigin: string;
}) => Promise<ClaimCheck>;
let foldAc1bIntoAc1: (result: Result, fidelity: Fidelity) => void;
let observeDescriptionCalls: (context: EventEmitter, origin: string) => Observer;
let gradeRun: (results: readonly Result[], facts: Record<string, unknown>) => Grade;
let evaluateAc1: (
  responses: readonly unknown[],
  gate: { value: number },
) => { ok: boolean; summary: string; evidence: Record<string, unknown> };
let GRADED_ACS: readonly string[];
let HARNESS_TREE_PATHSPEC: readonly string[];

let server: Server;
let origin: string;
/** Every text of this file, through one real subprocess: it takes seconds. */
let checked: ClaimCheck;

const TEXTS = {
  clean:
    'A three-bedroom home at 9 Blackberry Place, Palm Coast, listed at $385,000, with a screened ' +
    'lanai and a mature garden.',
  seller: SELLER,
  ownAddressLowerCase: 'A quiet home on blackberry pl with a screened lanai.',
  part: 'Two bedrooms for the children, and a mature garden.',
  wrongPrice: 'A three-bedroom home listed at $390,000.',
  wrongCurrency: 'A three-bedroom home listed at €385,000.',
  wrongStreet: 'A three-bedroom home at 14 Oak Street, close to schools.',
  singleStorey: 'A single-storey home with a screened lanai and a mature garden.',
  wrongCount: 'A five-bedroom home with a mature garden.',
} as const;
type TextKey = keyof typeof TEXTS;
const KEYS = Object.keys(TEXTS) as TextKey[];

const checkOf = (...keys: TextKey[]): ClaimCheck => ({
  original: checked.original,
  fields: checked.fields,
  claims: keys.map((k) => checked.claims?.[KEYS.indexOf(k)] ?? []),
});
const served = (description: string, headline: string | null = null): Call => ({
  status: 200,
  source: 'ai_cached',
  description,
  headline,
});
const coldMiss: Call = {
  status: 200,
  source: 'template_fallback',
  description: '',
  headline: null,
};

/** One `ai_cached` response for each key, graded through the real check. */
const grade = (...keys: TextKey[]): Fidelity =>
  evaluateAc1b({
    calls: keys.map((k) => served(TEXTS[k])),
    drewHoldout: false,
    adaptedResponseSeen: true,
    claimCheck: checkOf(...keys),
  });

beforeAll(async () => {
  (globalThis as Record<string, unknown>).FOLLOW1186_IMPORT_ONLY = true;
  const harness = (await import('./differentiator-e2e.mjs')) as Record<string, never>;
  evaluateAc1b = harness.evaluateAc1b;
  servedDescriptionTexts = harness.servedDescriptionTexts;
  findPlaybookMarkers = harness.findPlaybookMarkers;
  runAc1bClaimCheck = harness.runAc1bClaimCheck;
  foldAc1bIntoAc1 = harness.foldAc1bIntoAc1;
  observeDescriptionCalls = harness.observeDescriptionCalls;
  gradeRun = harness.gradeRun;
  evaluateAc1 = harness.evaluateAc1;
  GRADED_ACS = harness.GRADED_ACS;
  HARNESS_TREE_PATHSPEC = harness.HARNESS_TREE_PATHSPEC;

  const devServer = (await import('../../../scripts/dev/fixture-listing-details-server.mjs')) as {
    createFixtureListingDetailsServer: (o: { fixturePath: string }) => Server;
  };
  server = devServer.createFixtureListingDetailsServer({ fixturePath: FIXTURE_PATH });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

  checked = await runAc1bClaimCheck({
    listingId: LISTING_ID,
    locale: 'en',
    texts: KEYS.map((k) => TEXTS[k]),
    groundingOrigin: origin,
  });
}, 120_000);

afterAll(async () => {
  delete (globalThis as Record<string, unknown>).FOLLOW1186_IMPORT_ONLY;
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

describe('the source is the listing on :8081, through the production reader', () => {
  it('reads what the fixture page publishes, nothing typed in here', async () => {
    expect(checked.error).toBeUndefined();
    const html = await readFile(FIXTURE_PATH, 'utf8');
    expect(html).toContain('data-estalara-fact="price">385000<');
    expect(html).toContain('data-estalara-fact="publicLocationLabel">9 Blackberry Pl<');
    expect(checked.original).toBe(SELLER);
    expect(checked.fields?.listing_price).toBe('385000 USD');
    expect(checked.fields?.listing_location).toBe('9 Blackberry Pl, Palm Coast, FL');
  });

  it('a dead source yields no original, and that is RED: nothing was compared', async () => {
    const dead = await runAc1bClaimCheck({
      listingId: LISTING_ID,
      locale: 'en',
      texts: [TEXTS.clean],
      // A port nothing listens on: 1 is privileged and unbindable.
      groundingOrigin: 'http://127.0.0.1:1',
    });
    expect(dead.original).toBe('');
    const f = evaluateAc1b({
      calls: [served(TEXTS.clean)],
      drewHoldout: false,
      adaptedResponseSeen: true,
      claimCheck: dead,
    });
    expect(f.verdict).toBe('FAIL');
    expect(f.failures.map((x) => x.kind)).toEqual(['source_unreadable']);
  });

  it('a check that could not run is RED, never a text with no claims', () => {
    const f = evaluateAc1b({
      calls: [served(TEXTS.clean)],
      drewHoldout: false,
      adaptedResponseSeen: true,
      claimCheck: { error: 'tsx exited 1' },
    });
    expect(f.verdict).toBe('FAIL');
    expect(f.failures.map((x) => x.kind)).toEqual(['claim_check_unavailable']);
  });
});

describe('PASS: every served text checked, FOLLOW-1311 rules standing', () => {
  it("the listing's price and its own address in another form", () => {
    const f = grade('clean');
    expect(f.verdict).toBe('PASS');
    expect(f.ok).toBe(true);
    expect(f.unmeasured).toBeNull();
    expect(f.failures).toEqual([]);
    const claims = checked.claims?.[KEYS.indexOf('clean')] ?? [];
    expect(claims.find((c) => c.kind === 'money')?.source).toBe('listing_price');
    expect(claims.find((c) => c.kind === 'street')?.source).not.toBeNull();
  });

  it("the seller's own words", () => {
    expect(grade('seller').verdict).toBe('PASS');
  });

  it("the listing's own street in lower case", () => {
    expect(grade('ownAddressLowerCase').verdict).toBe('PASS');
  });

  it('a part of a stated count passes and is named: the check has no field for it', () => {
    const f = grade('part');
    expect(f.verdict).toBe('PASS');
    expect(f.passedWithoutGroundedField.map((c) => c.value)).toEqual(['2']);
  });

  it('a template_fallback beside a served text does not unmeasure it', () => {
    const f = evaluateAc1b({
      calls: [coldMiss, served(TEXTS.clean)],
      drewHoldout: false,
      adaptedResponseSeen: true,
      claimCheck: checkOf('clean'),
    });
    expect(f.verdict).toBe('PASS');
  });
});

describe('FAIL: each failure kind, through the real check', () => {
  it('a playbook marker in the description', () => {
    const f = evaluateAc1b({
      calls: [served(`VOICE PATTERN:\n${TEXTS.clean}`)],
      drewHoldout: false,
      adaptedResponseSeen: true,
      claimCheck: checkOf('clean'),
    });
    expect(f.verdict).toBe('FAIL');
    expect(f.failures.map((x) => x.kind)).toEqual(['playbook_marker']);
  });

  it.each([
    ['wrongPrice', 'price_mismatch', 'money_mismatch'],
    ['wrongCurrency', 'price_mismatch', 'money_mismatch'],
    ['wrongStreet', 'street_mismatch', 'unsupported_street'],
    ['singleStorey', 'unsupported_typed_claim', 'unsupported_attribute'],
    ['wrongCount', 'unsupported_typed_claim', 'count_mismatch'],
  ] as const)('%s → %s (%s)', (key, kind, violation) => {
    const f = grade(key);
    expect(f.verdict).toBe('FAIL');
    expect(f.ok).toBe(false);
    expect(f.unmeasured).toBeNull();
    expect(f.failures).toHaveLength(1);
    expect(f.failures[0]).toMatchObject({ kind, violation });
  });

  it('"single-storey" for "single-family" is refused by the check itself', () => {
    const claims = checked.claims?.[KEYS.indexOf('singleStorey')] ?? [];
    expect(claims).toEqual([
      {
        kind: 'attribute',
        key: 'single_storey',
        value: 'single-storey',
        source: null,
        violation: 'unsupported_attribute',
      },
    ]);
  });

  it('the same response\'s headline is checked too: §6.16 served "single-storey" there', () => {
    const f = evaluateAc1b({
      calls: [served(TEXTS.clean, TEXTS.singleStorey)],
      drewHoldout: false,
      adaptedResponseSeen: true,
      claimCheck: checkOf('clean', 'singleStorey'),
    });
    expect(f.verdict).toBe('FAIL');
    expect(f.failures[0]).toMatchObject({ field: 'headline', value: 'single-storey' });
  });

  it('text on the page that no response explains is graded as served', () => {
    const f = evaluateAc1b({
      calls: [coldMiss],
      page: { seller: SELLER, painted: TEXTS.wrongPrice },
      drewHoldout: false,
      adaptedResponseSeen: true,
      claimCheck: checkOf('wrongPrice'),
    });
    expect(f.verdict).toBe('FAIL');
    expect(f.failures[0]).toMatchObject({ kind: 'price_mismatch', field: 'description' });
  });

  it.each([
    ['a 500', { status: 500 }],
    ['a failed request', { status: null, unreadable: 'net::ERR_FAILED' }],
    ['an unparsable body', { status: 200, unreadable: 'body is not JSON' }],
    ['an unknown source', { status: 200, source: 'original', description: null }],
    ['ai_cached with nothing in it', { status: 200, source: 'ai_cached', description: '' }],
    ['never answered', { status: null }],
  ] as const)('%s is RED: the session may have been served what we cannot read', (_, call) => {
    const f = evaluateAc1b({
      calls: [call],
      drewHoldout: false,
      adaptedResponseSeen: true,
      claimCheck: null,
    });
    expect(f.verdict).toBe('FAIL');
    expect(f.ok).toBe(false);
    expect(f.failures.map((x) => x.kind)).toEqual(['description_unreadable']);
  });
});

describe('no description served: never PASS', () => {
  it('holdout: UNMEASURED, the existing reason', () => {
    const f = evaluateAc1b({
      calls: [],
      drewHoldout: true,
      adaptedResponseSeen: false,
      claimCheck: null,
    });
    expect(f).toMatchObject({ ok: false, verdict: 'UNMEASURED', unmeasured: 'holdout' });
  });

  it('template_fallback: UNMEASURED no_description, a cold miss and a refusal read alike', () => {
    const f = evaluateAc1b({
      calls: [coldMiss, coldMiss],
      drewHoldout: false,
      adaptedResponseSeen: true,
      claimCheck: null,
    });
    expect(f).toMatchObject({ ok: false, verdict: 'UNMEASURED', unmeasured: 'no_description' });
    expect(f.summary).toContain('template_fallback');
  });

  it("the seller's copy still on the page is no description served", () => {
    const f = evaluateAc1b({
      calls: [coldMiss],
      page: { seller: SELLER, painted: SELLER },
      drewHoldout: false,
      adaptedResponseSeen: true,
      claimCheck: null,
    });
    expect(f).toMatchObject({ ok: false, verdict: 'UNMEASURED', unmeasured: 'no_description' });
  });

  it('an adapted session whose SDK never asked: RED, a dead wire', () => {
    const f = evaluateAc1b({
      calls: [],
      drewHoldout: false,
      adaptedResponseSeen: true,
      claimCheck: null,
    });
    expect(f.verdict).toBe('FAIL');
    expect(f.failures.map((x) => x.kind)).toEqual(['no_description_request']);
  });

  it('no request and nothing adapted: UNMEASURED here, AC(1) itself is what is RED', () => {
    const f = evaluateAc1b({
      calls: [],
      drewHoldout: false,
      adaptedResponseSeen: false,
      claimCheck: null,
    });
    expect(f).toMatchObject({ ok: false, verdict: 'UNMEASURED', unmeasured: 'no_description' });
  });

  it('a text the holdout session was nevertheless served is still graded', () => {
    const f = evaluateAc1b({
      calls: [served(TEXTS.wrongPrice)],
      drewHoldout: true,
      adaptedResponseSeen: false,
      claimCheck: checkOf('wrongPrice'),
    });
    expect(f.verdict).toBe('FAIL');
  });
});

describe('the served texts', () => {
  it('reads what the SDK paints, ai_cached only', () => {
    expect(servedDescriptionTexts([coldMiss, served('A.', 'H.')], null)).toEqual([
      { via: 'response', field: 'description', text: 'A.' },
      { via: 'response', field: 'headline', text: 'H.' },
    ]);
  });

  it('one text served twice, and painted, is graded once', () => {
    const texts = servedDescriptionTexts([served('One.\n\nTwo.'), served('One.\n\nTwo.')], {
      seller: SELLER,
      painted: 'One.\n\nTwo.',
    });
    expect(texts).toHaveLength(1);
  });
});

describe('the marker check against the real playbooks', () => {
  it('names each marker', () => {
    expect(findPlaybookMarkers(TEXTS.clean)).toEqual([]);
    expect(findPlaybookMarkers(SELLER)).toEqual([]);
    expect(findPlaybookMarkers('HARD RULES: x')).toEqual(['HARD RULES']);
    expect(findPlaybookMarkers('per verified_facts')).toEqual(['verified_facts']);
    expect(findPlaybookMarkers('Rental Yield: {yield}%')).toEqual(['{yield}']);
  });

  it('flags every copy_template of every archetype in every locale', () => {
    const playbooks = [...getAllPlaybooks().values()];
    expect(playbooks.length).toBeGreaterThan(0);
    for (const playbook of playbooks) {
      for (const locale of ['en', 'pl', 'es'] as const) {
        expect(findPlaybookMarkers(playbook.copy_template[locale])).toContain('VOICE PATTERN');
      }
    }
  });
});

describe('the fold: AC(1b) is inside AC(1), and the TALLY keeps its meaning', () => {
  const gate = { value: 0.6 };
  const adapted = {
    source: 'llm_tweaked',
    archetype: 'yield_hunter',
    confidence: 0.85,
    directives: [{ type: 'text', slot: 'headline' }],
  };
  const noResponseLate = { adaptedArmDrewHoldout: false, adaptedResponsesArrivedAfterVerdict: 0 };

  const ac1Of = (bodies: readonly unknown[]): Result => {
    const r = evaluateAc1(bodies, gate);
    return { ac: 'AC(1)', name: r.summary, ok: r.ok, evidence: r.evidence };
  };
  const others = (): Result[] =>
    GRADED_ACS.filter((ac) => ac !== 'AC(1)').map((ac) => ({
      ac,
      name: ac,
      ok: true,
      evidence: {},
    }));
  const gradedAfterFold = (
    bodies: readonly unknown[],
    fidelity: Fidelity,
    facts: Record<string, unknown> = noResponseLate,
  ): Grade => {
    const ac1 = ac1Of(bodies);
    foldAc1bIntoAc1(ac1, fidelity);
    return gradeRun([ac1, ...others()], facts);
  };
  const ac1In = (g: Grade): Grade['results'][number] => {
    const r = g.results.find((x) => x.ac === 'AC(1)');
    if (r === undefined) throw new Error('no AC(1) row');
    return r;
  };
  const noDescription = (): Fidelity =>
    evaluateAc1b({
      calls: [coldMiss],
      drewHoldout: false,
      adaptedResponseSeen: true,
      claimCheck: null,
    });

  it('GRADED_ACS has no row of its own for AC(1b)', () => {
    expect(GRADED_ACS).not.toContain('AC(1b)');
    expect(GRADED_ACS).toHaveLength(9);
  });

  it('adapted + faithful: AC(1) PASS, total=9, run GREEN', () => {
    const g = gradedAfterFold([adapted], grade('clean'));
    expect(ac1In(g).verdict).toBe('PASS');
    expect(g.tallyLine).toBe('TALLY green=9 red=0 unmeasured=0 total=9 run=GREEN');
  });

  it('adapted + a wrong price: AC(1) FAIL, total=9, run RED', () => {
    const g = gradedAfterFold([adapted], grade('wrongPrice'));
    expect(ac1In(g).verdict).toBe('FAIL');
    expect(ac1In(g).unmeasuredBecause).toBeNull();
    expect(g.tallyLine).toBe('TALLY green=8 red=1 unmeasured=0 total=9 run=RED');
  });

  it('adapted + no description: AC(1) UNMEASURED[no_description], never green', () => {
    const g = gradedAfterFold([adapted], noDescription());
    expect(ac1In(g).verdict).toBe('UNMEASURED');
    expect(ac1In(g).unmeasuredBecause).toBe('no_description');
    expect(g.tallyLine).toBe('TALLY green=8 red=0 unmeasured=1 total=9 run=UNMEASURED');
    expect(g.summaryLine).toContain('AC(1)[no_description]');
  });

  it('the fold changes neither the graded count nor the adapted evidence', () => {
    const ac1 = ac1Of([adapted]);
    foldAc1bIntoAc1(ac1, grade('wrongPrice'));
    expect(ac1.ok).toBe(false);
    expect((ac1.evidence.outcomes as { adapted: number }).adapted).toBe(1);
    expect(ac1.evidence.adaptedPredicateOk).toBe(true);
    expect(ac1.evidence.groundingFidelity).toMatchObject({ verdict: 'FAIL' });
  });

  // Negative controls: an excuse for the AC's adapted half must not reach a measured violation.
  it('a measured violation is RED even with a late adapted response on the same run', () => {
    const g = gradedAfterFold([], grade('wrongPrice'), {
      adaptedArmDrewHoldout: false,
      adaptedResponsesArrivedAfterVerdict: 1,
    });
    expect(ac1In(g).verdict).toBe('FAIL');
  });

  it('a measured violation is RED even on a holdout draw', () => {
    const g = gradedAfterFold([], grade('wrongPrice'), {
      adaptedArmDrewHoldout: true,
      adaptedResponsesArrivedAfterVerdict: 0,
    });
    expect(ac1In(g).verdict).toBe('FAIL');
  });

  it('a RED adapted half stays RED when no description was served: no_description excuses 1b only', () => {
    const g = gradedAfterFold(
      [{ source: 'playbook', archetype: 'yield_hunter', confidence: 0.9 }],
      noDescription(),
    );
    expect(ac1In(g).verdict).toBe('FAIL');
  });

  it('a holdout draw stays UNMEASURED:holdout', () => {
    const holdoutBody = { holdout_group: true, source: 'default', archetype: 'neutral' };
    const fidelity = evaluateAc1b({
      calls: [],
      drewHoldout: true,
      adaptedResponseSeen: false,
      claimCheck: null,
    });
    const g = gradedAfterFold([holdoutBody], fidelity, {
      adaptedArmDrewHoldout: true,
      adaptedResponsesArrivedAfterVerdict: 0,
    });
    expect(ac1In(g).verdict).toBe('UNMEASURED');
    expect(ac1In(g).unmeasuredBecause).toBe('holdout');
  });
});

describe('the live wiring, as far as CI can see it', () => {
  /** Stand-ins with the Playwright surface the observer reads. */
  const req = (url: string, method = 'GET'): Record<string, unknown> => ({
    url: () => url,
    method: () => method,
    failure: () => ({ errorText: 'net::ERR_FAILED' }),
  });
  const res = (request: Record<string, unknown>, status: number, body: string): unknown => ({
    url: request.url,
    status: () => status,
    request: () => request,
    text: () => Promise.resolve(body),
  });

  it('matches the URL the SDK builds, and records what came back', async () => {
    const sdk = await readFile(
      path.join(HERE, '../../../packages/sdk/src/core/adapt-description.ts'),
      'utf8',
    );
    expect(sdk).toContain(
      '`${config.decisionApiUrl!}/adapt/description?listing_id=${listingId}&archetype=${archetype}&locale=${config.language}`',
    );
    const url =
      `http://localhost:3000/api/adapt/description?listing_id=${LISTING_ID}` +
      '&archetype=yield_hunter&locale=en';

    const context = new EventEmitter();
    const seen = observeDescriptionCalls(context, 'http://localhost:3000');
    const hit = req(url);
    const dead = req(url);
    const broken = req(url);
    const silent = req(url);
    for (const r of [hit, dead, broken, silent]) context.emit('request', r);
    context.emit(
      'response',
      res(hit, 200, JSON.stringify({ source: 'ai_cached', description: 'A.', headline: null })),
    );
    context.emit('requestfailed', dead);
    context.emit('response', res(broken, 200, '<html>'));
    await seen.settle(50);

    expect(seen.calls).toHaveLength(4);
    expect(seen.calls[0]).toMatchObject({
      seq: 1,
      listingId: LISTING_ID,
      archetype: 'yield_hunter',
      locale: 'en',
      status: 200,
      source: 'ai_cached',
      description: 'A.',
    });
    expect(seen.calls[1]?.unreadable).toBe('net::ERR_FAILED');
    expect(seen.calls[2]?.unreadable).toContain('not JSON');
    expect(seen.calls[3]?.status).toBeNull();
  });

  it('ignores every other request', () => {
    const context = new EventEmitter();
    const seen = observeDescriptionCalls(context, 'http://localhost:3000');
    context.emit('request', req('http://localhost:3000/api/adapt', 'POST'));
    context.emit('request', req('http://localhost:3000/api/adapt/description', 'POST'));
    context.emit('request', req('http://localhost:8787/adapt/description'));
    expect(seen.calls).toEqual([]);
  });

  it('main() observes the adapted session and folds before it grades', async () => {
    const src = await readFile(path.join(HERE, 'differentiator-e2e.mjs'), 'utf8');
    const body = src.slice(src.indexOf('async function main()'));
    const observed = body.indexOf('observeDescriptionCalls(context, DECISION_ORIGIN)');
    const firstPage = body.indexOf('await context.newPage()');
    const fold = body.indexOf('foldAc1bIntoAc1(');
    const missing = body.indexOf('missingGradedAcs(results)');
    const graded = body.indexOf('gradeRun(results, gradeFacts)');
    expect(observed).toBeGreaterThan(-1);
    expect(observed).toBeLessThan(firstPage);
    expect(fold).toBeGreaterThan(-1);
    expect(fold).toBeLessThan(missing);
    expect(missing).toBeLessThan(graded);
  });

  it('the helper is in the tree a run stamps', () => {
    expect(HARNESS_TREE_PATHSPEC).toContain('tests/e2e/follow-819/ac1b-claim-check.cts');
  });
});
