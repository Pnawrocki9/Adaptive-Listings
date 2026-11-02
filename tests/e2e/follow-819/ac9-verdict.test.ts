// @vitest-environment node
// (the package default is jsdom, whose global `URL` `createRequire()` rejects at the harness's
// top-level Playwright resolution — same reason ac1-verdict.test.ts pins this)

/**
 * FOLLOW-1345 — AC(9), the returning buyer (checkpoint K4b; FOLLOW-1316, ESC-090), must not pass over
 * a dead wire, and a restored profile after a negative control must never read as anything but RED.
 *
 * Drives the REAL `evaluateAc9()`, `gradeRun()`, `quizPathToLeaf()` and `scanWireForXid()` out of
 * `differentiator-e2e.mjs` (imported, not copied). `greenObs()` is the shape `driveAc9()` returns for
 * a run in which everything held; each RED row breaks exactly ONE thing in it, so a row that still
 * reads GREEN names a conjunct the verdict does not check.
 *
 * WHAT THE FIXTURES CANNOT FAKE, and is pinned against the real source instead: the stored-value
 * rules the verdict grades against (the store's own allow-list, the retention constant), the consent
 * vocabulary of the server gate, and the served default tree (each walked path reaches its leaf
 * through the shared `nextStep()`).
 *
 * WHAT THIS DOES NOT COVER: whether the live stack produces these observations. That is the manual
 * series (README §1.3); this file pins the verdict over an observation.
 *
 * Collected by `tests/e2e/vitest.config.ts`; run by `pnpm e2e:smoke` (nightly
 * `.github/workflows/e2e-smoke.yml`). It needs no substrate and takes no flag.
 *
 * @module tests/e2e/follow-819/ac9-verdict.test
 */

import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_QUIZ_DEFINITION_V2 } from '../../../packages/shared/src/quiz-default-v2';
import { XID_RETENTION_DAYS } from '../../../packages/shared/src/consent-retention';
import { nextStep } from '../../../packages/shared/src/schemas/quiz-walk';

interface Gate {
  value: number;
  comparison: string;
  source: string;
}
type Obs = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a deliberately partial observation fixture
interface Verdict {
  ok: boolean;
  name: string;
  summary: string;
  evidence: { unmetPreconditions: string[]; privacyViolations: string[] };
}
interface PathStep {
  questionId: string;
  multi: boolean;
  answers: string[][];
}
interface Graded {
  results: { ac: string; verdict: string; unmeasuredBecause: string | null }[];
  tallyLine: string;
  runVerdict: string;
}

let evaluateAc9Raw: (obs: Obs, gate: Gate) => Verdict;
let gradeRun: (results: unknown[], facts: unknown) => Graded;
let quizPathToLeaf: (
  definition: unknown,
  leaf: string,
  traits?: readonly string[],
) => PathStep[] | null;
let scanWireForXid: (
  wire: readonly { url: string; postData: string | null }[],
  xids: readonly string[],
) => { url: string; where: string }[];
let GRADED_ACS: readonly string[];
let AC9_NO_CONSENT_STATES: readonly (string | null)[];
let AC9_RESTORE_SOURCES: readonly string[];
let AC9_STORED_TRAITS: readonly string[];
let AC9_MAX_PTTL_MS: number;
let AC9_MAX_DRAWS: number;
let GATE: Gate;
let harnessSrc: string;
let storeSrc: string;
let routeSrc: string;

const read = (rel: string): Promise<string> => readFile(new URL(rel, import.meta.url), 'utf8');

beforeAll(async () => {
  (globalThis as Record<string, unknown>).FOLLOW1186_IMPORT_ONLY = true;
  const mod = (await import('./differentiator-e2e.mjs')) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- an untyped .mjs harness
  evaluateAc9Raw = mod.evaluateAc9;
  gradeRun = mod.gradeRun;
  quizPathToLeaf = mod.quizPathToLeaf;
  scanWireForXid = mod.scanWireForXid;
  GRADED_ACS = mod.GRADED_ACS;
  AC9_NO_CONSENT_STATES = mod.AC9_NO_CONSENT_STATES;
  AC9_RESTORE_SOURCES = mod.AC9_RESTORE_SOURCES;
  AC9_STORED_TRAITS = mod.AC9_STORED_TRAITS;
  AC9_MAX_PTTL_MS = mod.AC9_MAX_PTTL_MS;
  AC9_MAX_DRAWS = mod.AC9_MAX_DRAWS;
  GATE = await mod.readServerConfidenceGate();
  harnessSrc = await read('./differentiator-e2e.mjs');
  storeSrc = await read('../../../apps/control-plane/src/lib/buyer-profile-store.ts');
  routeSrc = await read('../../../apps/control-plane/src/app/api/adapt/route.ts');
});

const LEAF = 'yield_hunter';
const DAY_MS = 24 * 60 * 60 * 1000;
const STORED = JSON.stringify({
  v: 1,
  archetype: LEAF,
  confidence: 0.9,
  source: 'quiz',
  traits: ['seasoned_investor'],
});
const present = (over: Obs = {}): Obs => ({
  readable: true,
  present: true,
  raw: STORED,
  pttlMs: 89 * DAY_MS,
  ...over,
});
const absent = (): Obs => ({ readable: true, present: false, raw: null, pttlMs: null });
const unreadableKey = (): Obs => ({ readable: false, error: 'HTTP 500', present: false });
const adaptedBody = (over: Obs = {}): Obs => ({
  source: 'llm_tweaked',
  archetype: LEAF,
  confidence: 0.9,
  directives: [{ type: 'text', slot: 'headline' }],
  ...over,
});
const table = (rows: number): Obs => ({ rows, hits: 0, error: null });

/** Everything held: the shape `driveAc9()` returns. */
function greenObs(): Obs {
  return {
    served: { ok: true, reason: 'served', flagOn: true, definitionHash: 'ab'.repeat(32) },
    target: LEAF,
    allHeldOut: false,
    heldOut: [],
    mint: {
      error: null,
      accepted: true,
      textVersion: '2026-08-24.1',
      xidStrict: true,
      xidTag: 'aaaaaaaaaaaa',
      sessionId: 'session-1',
      leaf: LEAF,
      drewHoldout: false,
      configUnreached: null,
      tickedPersistable: ['seasoned_investor'],
      followUp: {
        reason: null,
        xidSent: true,
        consentState: 'consented',
        archetypeHint: LEAF,
        archetypeSourceSent: 'quiz',
        answered: true,
      },
      key: present(),
    },
    restore: {
      error: null,
      sessionId: 'session-2',
      firstCarriedXid: true,
      lateConfigMs: null,
      call: {
        xidSent: true,
        xidMatches: true,
        consentState: 'consented',
        hint: 'neutral',
        confidenceSent: 0.05,
        archetypeSourceSent: null,
        status: 200,
        failure: null,
        holdoutGroup: false,
        profileRestore: 'restored',
        body: adaptedBody(),
      },
    },
    controls: {
      a: {
        noConsent: { error: null, bannerShown: true, adaptCalls: 0, xidOnWire: false, restored: 0 },
        noTextVersion: { error: null, adaptAnswered: 1, xidOnWire: false, restored: 0 },
        server: [
          null,
          'none',
          'session-only',
          'legitimate-interest',
          'granted',
          'denied',
          'unknown',
        ].map((consentState) => ({
          consentState,
          status: 200,
          error: null,
          profileRestore: null,
          archetype: 'neutral',
          directives: 0,
        })),
        keyAfter: present(),
      },
      d: {
        error: null,
        allHeldOut: false,
        before: present(),
        pairRestored: true,
        pairArchetype: LEAF,
        pairReadError: false,
        leaf: 'diaspora_buyer',
        followUp: { reason: null, xidSent: true, archetypeSourceSent: 'quiz', answered: true },
        after: absent(),
        replay: {
          error: null,
          xidSent: true,
          answered: true,
          profileRestore: 'miss',
          archetype: 'neutral',
          directives: 0,
          attempts: ['miss'],
        },
        keyAfterReplay: absent(),
      },
      b: {
        error: null,
        pairRestored: true,
        keyBefore: present(),
        controlShown: true,
        eraseStatus: 200,
        consentAfter: 'denied',
        localXidAfter: false,
        keyAfterErase: absent(),
        reload: { adaptCalls: 0, xidOnWire: false },
        replay: {
          error: null,
          xidSent: true,
          answered: true,
          profileRestore: 'miss',
          archetype: 'neutral',
          directives: 0,
        },
        keyAfterReplay: absent(),
      },
      c: {
        error: null,
        allHeldOut: false,
        keyBefore: present(),
        pairRestored: true,
        pairArchetype: LEAF,
        seeded: true,
        seedError: null,
        seededVerificationRow: true,
        eraseStatus: 200,
        erasure: 'deleted',
        deletedAtPresent: true,
        keyAfter: absent(),
        replay: {
          status: 200,
          error: null,
          profileRestore: 'miss',
          archetype: 'neutral',
          directives: 0,
        },
      },
    },
    nc8: {
      xidCount: 2,
      requestsScanned: 40,
      wireLeaks: [],
      clickhouse: {
        events: table(12),
        adaptation_decisions: table(9),
        llm_calls: table(4),
        intent_events: table(0),
      },
      redisRawKeys: { readable: true, count: 0 },
      postgres: { readable: true, hits: 0 },
      logs: { read: true, hits: 0 },
    },
  };
}

const evaluate = (obs: Obs): Verdict => evaluateAc9Raw(obs, GATE);
const unmet = (obs: Obs): string[] => evaluate(obs).evidence.unmetPreconditions;
const privacy = (obs: Obs): string[] => evaluate(obs).evidence.privacyViolations;
/** The graded row: what the TALLY sees. */
const graded = (obs: Obs): { verdict: string; because: string | null; tally: string } => {
  const v = evaluate(obs);
  const g = gradeRun([{ ac: 'AC(9)', name: v.name, ok: v.ok, evidence: v.evidence }], {
    adaptedArmDrewHoldout: false,
    adaptedResponsesArrivedAfterVerdict: 0,
  });
  const row = g.results[0];
  if (!row) throw new Error('no graded row');
  return { verdict: row.verdict, because: row.unmeasuredBecause, tally: g.tallyLine };
};
const expectRed = (obs: Obs, entry: string | RegExp): void => {
  const list = unmet(obs);
  expect(
    list.some((u) => (typeof entry === 'string' ? u === entry : entry.test(u))),
    list.join(),
  ).toBe(true);
  expect(graded(obs).verdict).toBe('FAIL');
};
const expectUnmeasured = (obs: Obs, because: string): void => {
  const g = graded(obs);
  expect(g.verdict).toBe('UNMEASURED');
  expect(g.because).toBe(because);
};

// ─── GREEN ──────────────────────────────────────────────────────────────────────────────────

describe('AC(9) GREEN', () => {
  it('everything held: PASS, no unmet entry, no privacy violation', () => {
    const v = evaluate(greenObs());
    expect(v.evidence.unmetPreconditions).toEqual([]);
    expect(v.evidence.privacyViolations).toEqual([]);
    expect(v.ok).toBe(true);
    expect(graded(greenObs()).verdict).toBe('PASS');
  });

  it('the evidence says the DSR control ran on a seeded row, not through /api/dsr/initiate', () => {
    expect(JSON.stringify(evaluate(greenObs()).evidence)).toContain('/api/dsr/initiate');
    expect(evaluate(greenObs()).summary).toContain('seeded');
  });
});

// ─── The restore itself ─────────────────────────────────────────────────────────────────────

describe('AC(9) session 1: real consent, the quiz, the write', () => {
  const brokenMint: [string, (o: Obs) => void, string | RegExp][] = [
    ['threw', (o) => (o.mint.error = 'boom'), 's1:threw'],
    ['Accept never clicked', (o) => (o.mint.accepted = false), 's1:bannerAcceptNotClicked'],
    ['no text version recorded', (o) => (o.mint.textVersion = null), 's1:noTextVersionRecorded'],
    ['no xid minted', (o) => (o.mint.xidStrict = false), 's1:noXidMinted'],
    ['another leaf', (o) => (o.mint.leaf = 'flip_investor'), 's1:leaf=flip_investor'],
    ['no follow-up', (o) => (o.mint.followUp = { reason: 'fold_not_observed' }), /^s1:noFollowUp/],
    [
      'follow-up without the xid',
      (o) => (o.mint.followUp.xidSent = false),
      's1:followUpCarriedNoXid',
    ],
    [
      'old consent vocabulary',
      (o) => (o.mint.followUp.consentState = 'granted'),
      's1:followUpConsent=granted',
    ],
    [
      'no archetype_source',
      (o) => (o.mint.followUp.archetypeSourceSent = null),
      's1:followUpArchetypeSource=null',
    ],
    ['nothing written', (o) => (o.mint.key = absent()), 's1:profileNotWritten'],
    [
      'written under the wrong archetype',
      (o) => (o.mint.key = present({ raw: STORED.replace(LEAF, 'flip_investor') })),
      's1:storedArchetype=flip_investor',
    ],
    [
      'a persistable ticked trait lost',
      (o) =>
        (o.mint.key = present({
          raw: JSON.stringify({ v: 1, archetype: LEAF, confidence: 0.9, source: 'quiz' }),
        })),
      's1:tickedTraitNotStored=seasoned_investor',
    ],
    ['no expiry', (o) => (o.mint.key = present({ pttlMs: -1 })), 's1:pttl=-1'],
  ];
  it.each(brokenMint)('%s is RED', (_n, breakIt, entry) => {
    const o = greenObs();
    breakIt(o);
    expectRed(o, entry);
  });

  it('a stored value with a field outside the review is a privacy violation (R9, R10)', () => {
    const o = greenObs();
    o.mint.key = present({ raw: STORED.replace('"v":1', '"v":1,"session_id":"s"') });
    expect(privacy(o)).toContain('privacy:s1:storedField=session_id');
    expect(graded(o).verdict).toBe('FAIL');
  });

  it('a stored trait off the allow-list is a privacy violation (R12)', () => {
    const o = greenObs();
    o.mint.key = present({ raw: STORED.replace('seasoned_investor', 'residency_goal') });
    expect(privacy(o)).toContain('privacy:s1:storedTrait=residency_goal');
  });

  it('an expiry past the retention term is a privacy violation (R21)', () => {
    const o = greenObs();
    o.mint.key = present({ pttlMs: AC9_MAX_PTTL_MS + 60_000 });
    expect(privacy(o).join()).toContain('privacy:s1:pttlBeyondRetention');
  });
});

describe('AC(9) session 2: the first /api/adapt is already restored', () => {
  const brokenRestore: [string, (o: Obs) => void, string | RegExp][] = [
    ['threw', (o) => (o.restore.error = 'boom'), 's2:threw'],
    [
      'same session',
      (o) => {
        o.restore.sessionId = o.mint.sessionId;
      },
      's2:sameSession',
    ],
    [
      'no profile_restore at all',
      (o) => (o.restore.call.profileRestore = null),
      's2:profileRestore=null',
    ],
    ['a miss', (o) => (o.restore.call.profileRestore = 'miss'), 's2:profileRestore=miss'],
    [
      'a store error (NC-12)',
      (o) => (o.restore.call.profileRestore = 'error'),
      's2:profileRestore=error',
    ],
    [
      'another archetype',
      (o) => (o.restore.call.body = adaptedBody({ archetype: 'flip_investor' })),
      's2:archetype=flip_investor',
    ],
    ['another xid', (o) => (o.restore.call.xidMatches = false), 's2:xidDiffers'],
    ['no consented', (o) => (o.restore.call.consentState = 'granted'), 's2:consent=granted'],
    [
      'the session brought its own signal',
      (o) => {
        o.restore.call.hint = LEAF;
        o.restore.call.confidenceSent = 0.72;
      },
      /^s2:sessionHadOwnSignal/,
    ],
    [
      'archetype_source quiz on a restore, so sessionStorage was not empty',
      (o) => (o.restore.call.archetypeSourceSent = 'quiz'),
      's2:archetypeSourceSent=quiz',
    ],
    ['the arm moved', (o) => (o.restore.call.holdoutGroup = true), 's2:armChanged'],
    [
      'llm_full is not the source the criterion names',
      (o) => (o.restore.call.body = adaptedBody({ source: 'llm_full' })),
      's2:source=llm_full',
    ],
    [
      'the LLM fallback',
      (o) =>
        (o.restore.call.body = adaptedBody({
          source: 'playbook_fallback_llm_unavailable',
          directives: [],
        })),
      /^s2:notAdapted/,
    ],
    [
      'no request ever carried the xid',
      (o) => {
        o.restore.firstCarriedXid = false;
        o.restore.call = null;
      },
      's2:firstRequestCarriedNoXid',
    ],
    [
      'the first request had no xid and the config was NOT late',
      (o) => (o.restore.firstCarriedXid = false),
      's2:firstRequestCarriedNoXid',
    ],
  ];
  it.each(brokenRestore)('%s is RED', (_n, breakIt, entry) => {
    const o = greenObs();
    breakIt(o);
    expectRed(o, entry);
  });

  it('source llm_full is the only unmet entry when a restore misses its band', () => {
    const o = greenObs();
    o.restore.call.body = adaptedBody({ source: 'llm_full' });
    expect(unmet(o)).toEqual(['s2:source=llm_full']);
    expect(AC9_RESTORE_SOURCES).toEqual(['llm_tweaked']);
  });
});

// ─── Negative controls: a restored profile is a privacy defect, never anything softer ───────

describe('AC(9) negative control (a): the same xid without consent', () => {
  it('xid on the wire with no consent is a privacy violation and RED', () => {
    const o = greenObs();
    o.controls.a.noConsent.xidOnWire = true;
    expect(privacy(o)).toContain('privacy:a:xidOnWireWithoutConsent');
    expect(graded(o).verdict).toBe('FAIL');
  });

  it('a restore with no consent is a privacy violation and RED', () => {
    const o = greenObs();
    o.controls.a.noConsent.restored = 1;
    expect(privacy(o)).toContain('privacy:a:restoredWithoutConsent');
    expect(graded(o).verdict).toBe('FAIL');
  });

  it('xid on the wire with no recorded text version is a privacy violation and RED', () => {
    const o = greenObs();
    o.controls.a.noTextVersion.xidOnWire = true;
    expect(privacy(o)).toContain('privacy:a:xidOnWireWithoutTextVersion');
    expect(graded(o).verdict).toBe('FAIL');
  });

  it('a no-text-version session that served nothing proves nothing: RED, not vacuously green', () => {
    const o = greenObs();
    o.controls.a.noTextVersion.adaptAnswered = 0;
    expectRed(o, 'a:noTextVersionSessionNeverAnswered');
  });

  it('the banner not showing is RED', () => {
    const o = greenObs();
    o.controls.a.noConsent.bannerShown = false;
    expectRed(o, 'a:bannerNotShown');
  });

  it.each(['session-only', 'granted', 'denied', 'none', 'unknown', 'legitimate-interest'])(
    'consent_state %s restoring on the server is a privacy violation (NC-2)',
    (state) => {
      const o = greenObs();
      const row = o.controls.a.server.find((r: Obs) => r.consentState === state);
      row.profileRestore = 'restored';
      row.archetype = LEAF;
      expect(privacy(o)).toContain(`privacy:a:restoredWithConsentState=${state}`);
      expect(graded(o).verdict).toBe('FAIL');
    },
  );

  it('consent_state absent restoring on the server is a privacy violation (NC-1)', () => {
    const o = greenObs();
    o.controls.a.server[0].profileRestore = 'restored';
    expect(privacy(o)).toContain('privacy:a:restoredWithConsentState=absent');
  });

  it('a store READ without consent is a privacy violation even with a neutral answer (NC-1, NC-2)', () => {
    const o = greenObs();
    o.controls.a.server[1].profileRestore = 'miss';
    expect(privacy(o)).toContain('privacy:a:storeReadWithConsentState=none');
  });

  it('the server table must cover every state: a missing row is RED', () => {
    const o = greenObs();
    o.controls.a.server.pop();
    expectRed(o, 'a:serverTableIncomplete=6');
    expect(AC9_NO_CONSENT_STATES).toHaveLength(7);
  });

  it('a key that vanished during (a) leaves the pair broken: RED', () => {
    const o = greenObs();
    o.controls.a.keyAfter = absent();
    expectRed(o, 'a:keyGoneAfterControl');
  });
});

describe('AC(9) negative control (b): withdrawal through the real control', () => {
  it('the key surviving withdrawal is a privacy violation and RED', () => {
    const o = greenObs();
    o.controls.b.keyAfterErase = present();
    expect(privacy(o)).toContain('privacy:b:keyStillPresentAfterWithdrawal');
    expect(graded(o).verdict).toBe('FAIL');
  });

  it('a restore on the replayed xid is a privacy violation and RED', () => {
    const o = greenObs();
    o.controls.b.replay.profileRestore = 'restored';
    expect(privacy(o)).toContain('privacy:b:restoredAfterWithdrawal');
    expect(graded(o).verdict).toBe('FAIL');
  });

  it('the local xid surviving is a privacy violation', () => {
    const o = greenObs();
    o.controls.b.localXidAfter = true;
    expect(privacy(o)).toContain('privacy:b:localXidKept');
  });

  it('the next page sending the xid, or adapting at all, is a privacy violation', () => {
    const wired = greenObs();
    wired.controls.b.reload.xidOnWire = true;
    expect(privacy(wired)).toContain('privacy:b:xidOnWireAfterWithdrawal');
    const adapted = greenObs();
    adapted.controls.b.reload.adaptCalls = 1;
    expect(privacy(adapted)).toContain('privacy:b:adaptAfterWithdrawal');
  });

  it('a key coming back after the replay is a privacy violation', () => {
    const o = greenObs();
    o.controls.b.keyAfterReplay = present();
    expect(privacy(o)).toContain('privacy:b:keyResurrected');
  });

  const notPrivacyButRed: [string, (o: Obs) => void, string][] = [
    [
      'unpaired: no restore before the click',
      (o) => (o.controls.b.pairRestored = false),
      'b:notPaired',
    ],
    [
      'no key before the click',
      (o) => (o.controls.b.keyBefore = absent()),
      'b:noKeyBeforeWithdrawal',
    ],
    [
      'no control in the widget',
      (o) => (o.controls.b.controlShown = false),
      'b:withdrawControlMissing',
    ],
    ['the delete failed', (o) => (o.controls.b.eraseStatus = 503), 'b:eraseStatus=503'],
    [
      'consent not denied',
      (o) => (o.controls.b.consentAfter = 'granted'),
      'b:consentAfter=granted',
    ],
    [
      'the replay did not send the xid',
      (o) => (o.controls.b.replay.xidSent = false),
      'b:replayCarriedNoXid',
    ],
    [
      'the replay answered no read at all',
      (o) => (o.controls.b.replay.profileRestore = null),
      'b:replayProfileRestore=null',
    ],
    ['threw', (o) => (o.controls.b.error = 'boom'), 'b:threw'],
  ];
  it.each(notPrivacyButRed)('%s is RED', (_n, breakIt, entry) => {
    const o = greenObs();
    breakIt(o);
    expectRed(o, entry);
  });
});

describe('AC(9) negative control (c): revoked through DSR on a seeded row', () => {
  it('the key surviving the erase is a privacy violation and RED', () => {
    const o = greenObs();
    o.controls.c.keyAfter = present();
    expect(privacy(o)).toContain('privacy:c:keyStillPresentAfterDsr');
    expect(graded(o).verdict).toBe('FAIL');
  });

  it('a restore on the same xid after the erase is a privacy violation and RED', () => {
    const o = greenObs();
    o.controls.c.replay.profileRestore = 'restored';
    expect(privacy(o)).toContain('privacy:c:restoredAfterDsr');
    expect(graded(o).verdict).toBe('FAIL');
  });

  const red: [string, (o: Obs) => void, string][] = [
    ['unpaired', (o) => (o.controls.c.pairRestored = false), 'c:notPaired'],
    [
      'pair on another archetype',
      (o) => (o.controls.c.pairArchetype = 'flip_investor'),
      'c:notPaired',
    ],
    ['no key before', (o) => (o.controls.c.keyBefore = absent()), 'c:profileNotWritten'],
    ['erase 503', (o) => (o.controls.c.eraseStatus = 503), 'c:eraseStatus=503'],
    ['erasure failed', (o) => (o.controls.c.erasure = 'failed'), 'c:erasure=failed'],
    ['erasure not_found', (o) => (o.controls.c.erasure = 'not_found'), 'c:erasure=not_found'],
    [
      'read as completed with no deleted_at',
      (o) => (o.controls.c.deletedAtPresent = false),
      'c:noDeletedAt',
    ],
    ['threw', (o) => (o.controls.c.error = 'boom'), 'c:threw'],
  ];
  it.each(red)('%s is RED', (_n, breakIt, entry) => {
    const o = greenObs();
    breakIt(o);
    expectRed(o, entry);
  });
});

describe('AC(9) negative control (d): a non-persistable quiz result deletes the key', () => {
  it('the key gone and staying gone, a fresh context answering miss: PASS', () => {
    expect(unmet(greenObs())).toEqual([]);
  });

  it('the superseded key surviving is a privacy violation and RED', () => {
    const o = greenObs();
    o.controls.d.after = present();
    expect(privacy(o)).toContain('privacy:d:supersededKeySurvived');
    expect(graded(o).verdict).toBe('FAIL');
  });

  it('a new value written is a privacy violation and RED', () => {
    const o = greenObs();
    o.controls.d.after = present({ raw: STORED.replace(LEAF, 'diaspora_buyer') });
    expect(privacy(o)).toContain('privacy:d:newValueWritten');
    expect(graded(o).verdict).toBe('FAIL');
  });

  it('a restore in the fresh context is a privacy violation and RED', () => {
    const o = greenObs();
    o.controls.d.replay.profileRestore = 'restored';
    expect(privacy(o)).toContain('privacy:d:restoredAfterSupersede');
    expect(graded(o).verdict).toBe('FAIL');
  });

  it('the key coming back after the replay is a privacy violation and RED', () => {
    const o = greenObs();
    o.controls.d.keyAfterReplay = present();
    expect(privacy(o)).toContain('privacy:d:keyResurrected');
    expect(graded(o).verdict).toBe('FAIL');
  });

  const red: [string, (o: Obs) => void, string | RegExp][] = [
    ['another leaf', (o) => (o.controls.d.leaf = LEAF), 'd:leaf=yield_hunter'],
    [
      'no key before: an empty store would pass',
      (o) => (o.controls.d.before = absent()),
      'd:profileNotWritten',
    ],
    ['unpaired', (o) => (o.controls.d.pairRestored = false), 'd:notPaired'],
    [
      'pair on another archetype',
      (o) => (o.controls.d.pairArchetype = 'flip_investor'),
      'd:notPaired',
    ],
    [
      'the result never sent, so "the key is gone" proves nothing about this path',
      (o) => (o.controls.d.followUp.archetypeSourceSent = null),
      /^d:resultNotSent/,
    ],
    ['no xid on the follow-up', (o) => (o.controls.d.followUp.xidSent = false), /^d:resultNotSent/],
    ['no answer yet', (o) => (o.controls.d.followUp.answered = false), 'd:followUpNotAnswered'],
    [
      'the replay sent no xid',
      (o) => (o.controls.d.replay.xidSent = false),
      'd:replayCarriedNoXid',
    ],
    ['the replay unanswered', (o) => (o.controls.d.replay.answered = false), 'd:replayNotAnswered'],
    ['threw', (o) => (o.controls.d.error = 'boom'), 'd:threw'],
  ];
  it.each(red)('%s is RED', (_n, breakIt, entry) => {
    const o = greenObs();
    breakIt(o);
    expectRed(o, entry);
  });

  it('its own xid held out on every draw: UNMEASURED:holdout, and the rest still grades', () => {
    const o = greenObs();
    o.controls.d = { allHeldOut: true, error: null };
    expect(unmet(o)).toEqual(['nonPersistable:drewHoldout']);
    expectUnmeasured(o, 'holdout');
    o.controls.c.replay.profileRestore = 'restored';
    expect(graded(o).verdict).toBe('FAIL');
  });
});

describe('AC(9) negative control (e): NC-8, the raw xid is nowhere it should not be', () => {
  it.each(['events', 'adaptation_decisions', 'llm_calls', 'intent_events'])(
    'the xid in ClickHouse %s is a privacy violation and RED',
    (t) => {
      const o = greenObs();
      o.nc8.clickhouse[t] = { rows: 3, hits: 1, error: null };
      expect(privacy(o)).toContain(`privacy:e:xidInClickHouse(${t})`);
      expect(graded(o).verdict).toBe('FAIL');
    },
  );

  it('a leak on the wire is a privacy violation and RED', () => {
    const o = greenObs();
    o.nc8.wireLeaks = [{ url: 'http://x/?xid=<xid>', where: 'url' }];
    expect(privacy(o).join()).toContain('privacy:e:xidOnWire(url');
    expect(graded(o).verdict).toBe('FAIL');
  });

  it('the raw xid in a Redis key, Postgres or the control-plane log is a privacy violation', () => {
    const r = greenObs();
    r.nc8.redisRawKeys.count = 1;
    expect(privacy(r)).toContain('privacy:e:xidInRedisKey');
    const p = greenObs();
    p.nc8.postgres.hits = 1;
    expect(privacy(p)).toContain('privacy:e:xidInIntentSessions');
    const l = greenObs();
    l.nc8.logs.hits = 1;
    expect(privacy(l)).toContain('privacy:e:xidInControlPlaneLog');
  });

  it('nothing searched is RED, an unread log is evidence only', () => {
    const o = greenObs();
    o.nc8.xidCount = 0;
    expectRed(o, 'e:nothingSearched');
    const logs = greenObs();
    logs.nc8.logs = { read: false, hits: 0 };
    expect(evaluate(logs).ok).toBe(true);
  });

  it('scanWireForXid: URL anywhere, body outside /api/adapt and /api/profile/erase; never echoes the xid', () => {
    const x = '11111111-1111-4111-8111-111111111111';
    const wire = [
      { url: 'http://cp/api/adapt', postData: JSON.stringify({ xid: x }) },
      { url: 'http://cp/api/adapt?profiling_opt_out=1', postData: JSON.stringify({ xid: x }) },
      { url: 'http://cp/api/profile/erase', postData: JSON.stringify({ xid: x }) },
      { url: `http://cp/api/adapt/description?xid=${x}`, postData: null },
      { url: 'http://cp/api/adapt/description', postData: JSON.stringify({ xid: x }) },
      { url: 'http://ingest/v1/events', postData: JSON.stringify({ events: [{ xid: x }] }) },
      { url: 'http://cp/api/quiz/run', postData: `{"a":"${x}"}` },
      { url: 'http://cp/page', postData: null },
    ];
    const leaks = scanWireForXid(wire, [x]);
    expect(leaks.map((l) => l.where)).toEqual(['url', 'body', 'body', 'body']);
    expect(JSON.stringify(leaks)).not.toContain(x);
    expect(scanWireForXid(wire.slice(0, 3), [x])).toEqual([]);
  });
});

// ─── Being unable to read something is never green ──────────────────────────────────────────

describe('AC(9) UNMEASURED, each reason', () => {
  /** A run in which every draw of the buyer's xid drew holdout. */
  const allHeldOut = (): Obs => {
    const o = greenObs();
    o.allHeldOut = true;
    o.mint = null;
    o.restore = null;
    o.heldOut = Array.from({ length: AC9_MAX_DRAWS }, () => ({
      label: 'primary',
      xidTag: 'bbb',
      armSessionOne: true,
      armSessionTwo: true,
      followUpCarriedXid: true,
      restored: 0,
      key: absent(),
    }));
    o.controls = { a: { ...o.controls.a, keyAfter: null } };
    return o;
  };

  it('every draw held out: UNMEASURED:holdout, never PASS', () => {
    expect(evaluate(allHeldOut()).ok).toBe(false);
    expect(unmet(allHeldOut())).toEqual(['restore:drewHoldout']);
    expectUnmeasured(allHeldOut(), 'holdout');
    expect(graded(allHeldOut()).tally).toBe(
      'TALLY green=0 red=0 unmeasured=1 total=1 run=UNMEASURED',
    );
  });

  it('holdout does not excuse a violation it can still see: the wire, the store, the arm', () => {
    const wired = allHeldOut();
    wired.controls.a.noConsent.xidOnWire = true;
    expect(graded(wired).verdict).toBe('FAIL');

    const leak = allHeldOut();
    leak.nc8.clickhouse.events.hits = 2;
    expect(graded(leak).verdict).toBe('FAIL');

    const written = allHeldOut();
    written.heldOut[0].key = present();
    expect(privacy(written)).toContain('privacy:holdout:profileWritten');
    expect(graded(written).verdict).toBe('FAIL');

    const restored = allHeldOut();
    restored.heldOut[0].restored = 1;
    expect(privacy(restored)).toContain('privacy:holdout:restored');
    expect(graded(restored).verdict).toBe('FAIL');

    const moved = allHeldOut();
    moved.heldOut[1].armSessionTwo = false;
    expectRed(moved, 'holdout:armChangedBetweenSessions');
  });

  it('a held-out draw followed by a treatment draw grades the treatment draw, and keeps the check', () => {
    const o = greenObs();
    o.heldOut = [
      {
        label: 'primary',
        xidTag: 'b',
        armSessionOne: true,
        armSessionTwo: true,
        restored: 0,
        key: absent(),
      },
    ];
    expect(evaluate(o).ok).toBe(true);
    o.heldOut[0].key = present();
    expect(graded(o).verdict).toBe('FAIL');
  });

  it('(c) alone held out: UNMEASURED:holdout, and the rest still grades', () => {
    const o = greenObs();
    o.controls.c = { allHeldOut: true, error: null };
    expect(unmet(o)).toEqual(['dsr:drewHoldout']);
    expectUnmeasured(o, 'holdout');
    o.controls.b.keyAfterErase = present();
    expect(graded(o).verdict).toBe('FAIL');
  });

  it('a late config: UNMEASURED:late_config, grading the first request that carried the xid', () => {
    const o = greenObs();
    o.restore.firstCarriedXid = false;
    o.restore.lateConfigMs = 1400;
    expect(unmet(o)).toEqual(['s2:lateConfig(1400)']);
    expectUnmeasured(o, 'late_config');
    o.restore.call.profileRestore = 'miss';
    expect(graded(o).verdict).toBe('FAIL');
  });

  it('the served config never reached the browser in session 1: UNMEASURED:config', () => {
    const o = greenObs();
    o.mint = { configUnreached: 'GET no-response pending', error: null };
    o.restore = null;
    o.controls = {};
    o.nc8 = greenObs().nc8;
    expect(unmet(o)).toEqual(['config:s1(GET no-response pending)']);
    expectUnmeasured(o, 'config');
  });

  const unreadable: [string, (o: Obs) => void, string][] = [
    [
      "(b)'s replay read errored twice",
      (o) => (o.controls.b.replay.profileRestore = 'error'),
      'unreadable:profileRead(b)',
    ],
    [
      "(c)'s replay read errored twice (run 271's shape)",
      (o) => (o.controls.c.replay.profileRestore = 'error'),
      'unreadable:profileRead(c)',
    ],
    [
      "(d)'s replay read errored twice",
      (o) => (o.controls.d.replay.profileRestore = 'error'),
      'unreadable:profileRead(d)',
    ],
    [
      "(c)'s positive restore errored twice",
      (o) => {
        o.controls.c.pairRestored = false;
        o.controls.c.pairReadError = true;
      },
      'unreadable:profileRead(c pair)',
    ],
    [
      "(d)'s positive restore errored twice",
      (o) => {
        o.controls.d.pairRestored = false;
        o.controls.d.pairReadError = true;
      },
      'unreadable:profileRead(d pair)',
    ],
    [
      'Redis after the replay of (d)',
      (o) => (o.controls.d.keyAfterReplay = unreadableKey()),
      'unreadable:redis(d)',
    ],
    ['Redis in session 1', (o) => (o.mint.key = unreadableKey()), 'unreadable:redis(s1)'],
    ['Redis after (a)', (o) => (o.controls.a.keyAfter = unreadableKey()), 'unreadable:redis(a)'],
    ['Redis before (d)', (o) => (o.controls.d.before = unreadableKey()), 'unreadable:redis(d)'],
    ['Redis after (d)', (o) => (o.controls.d.after = unreadableKey()), 'unreadable:redis(d)'],
    ['Redis before (b)', (o) => (o.controls.b.keyBefore = unreadableKey()), 'unreadable:redis(b)'],
    [
      'Redis after (b)',
      (o) => (o.controls.b.keyAfterErase = unreadableKey()),
      'unreadable:redis(b)',
    ],
    [
      'Redis after the replay',
      (o) => (o.controls.b.keyAfterReplay = unreadableKey()),
      'unreadable:redis(b)',
    ],
    ['Redis before (c)', (o) => (o.controls.c.keyBefore = unreadableKey()), 'unreadable:redis(c)'],
    ['Redis after (c)', (o) => (o.controls.c.keyAfter = unreadableKey()), 'unreadable:redis(c)'],
    [
      'the seed of (c)',
      (o) => {
        o.controls.c.seeded = false;
        o.controls.c.seedError = 'no url';
      },
      'unreadable:dsrSeed',
    ],
    [
      'ClickHouse events',
      (o) => (o.nc8.clickhouse.events = { rows: null, hits: null, error: 'down' }),
      'unreadable:clickhouse(events)',
    ],
    [
      'ClickHouse decisions',
      (o) => (o.nc8.clickhouse.adaptation_decisions = { rows: null, hits: null, error: 'down' }),
      'unreadable:clickhouse(adaptation_decisions)',
    ],
    [
      'no events row for these sessions',
      (o) => (o.nc8.clickhouse.events = table(0)),
      'unreadable:clickhouseEmpty(events)',
    ],
    [
      'no decision row for these sessions',
      (o) => (o.nc8.clickhouse.adaptation_decisions = table(0)),
      'unreadable:clickhouseEmpty(adaptation_decisions)',
    ],
    [
      'the Redis key scan',
      (o) => (o.nc8.redisRawKeys = { readable: false, count: 0 }),
      'unreadable:redis(e)',
    ],
    ['Postgres', (o) => (o.nc8.postgres = { readable: false, hits: 0 }), 'unreadable:postgres(e)'],
  ];
  it.each(unreadable)('%s unreadable: UNMEASURED:unreadable, never PASS', (_n, breakIt, entry) => {
    const o = greenObs();
    breakIt(o);
    expect(unmet(o)).toContain(entry);
    expect(evaluate(o).ok).toBe(false);
    expectUnmeasured(o, 'unreadable');
  });

  it('session 2 is not retried: a store error on the restore itself stays RED', () => {
    const o = greenObs();
    o.restore.call.profileRestore = 'error';
    expect(graded(o).verdict).toBe('FAIL');
  });

  it('an errored read cannot excuse a restore seen elsewhere', () => {
    const o = greenObs();
    o.controls.c.replay.profileRestore = 'error';
    o.controls.b.replay.profileRestore = 'restored';
    expect(graded(o).verdict).toBe('FAIL');
  });

  it('a control read is asked twice, 3 s apart, and only on `error`', () => {
    const fn = harnessSrc.slice(
      harnessSrc.indexOf('async function ac9RetryOnReadError('),
      harnessSrc.indexOf('function replayAc9InBrowser('),
    );
    expect(fn).toContain("first.profileRestore !== 'error'");
    expect(fn).toContain('await sleep(AC9_READ_RETRY_MS)');
    expect(fn.match(/await ask\(\)/g)).toHaveLength(2);
    expect(harnessSrc).toContain('const AC9_READ_RETRY_MS = 3000;');
  });

  it('NC-12: Redis down makes the restore itself RED; the unreadable reader cannot excuse it', () => {
    const o = greenObs();
    o.mint.key = unreadableKey();
    o.restore.call.profileRestore = 'error';
    expect(graded(o).verdict).toBe('FAIL');
  });

  it('an unreadable reader cannot excuse a violation seen elsewhere', () => {
    const o = greenObs();
    o.nc8.postgres = { readable: false, hits: 0 };
    o.controls.c.replay.profileRestore = 'restored';
    expect(graded(o).verdict).toBe('FAIL');
  });

  it('a late config cannot excuse an unmet entry beside it, and no other unmet is excusable', () => {
    const o = greenObs();
    o.restore.firstCarriedXid = false;
    o.restore.lateConfigMs = 1400;
    o.controls.b.controlShown = false;
    expect(graded(o).verdict).toBe('FAIL');
  });
});

describe('AC(9) cannot go green by not being driven', () => {
  it.each(['a', 'b', 'c', 'd'])('control (%s) not run is RED', (c) => {
    const o = greenObs();
    o.controls[c] = undefined;
    expectRed(o, `${c}:notRun`);
  });

  it('NC-8 not run is RED', () => {
    const o = greenObs();
    o.nc8 = null;
    expectRed(o, 'e:notRun');
  });

  it('no session 2 is RED', () => {
    const o = greenObs();
    o.restore = null;
    expectRed(o, 's2:notRun');
  });

  it('flag off, or the served tree missing, is RED and stops there (NC-14 cannot pass AC(9))', () => {
    const off = { served: { ok: true, reason: 'served', flagOn: false } };
    expectRed(off, 'served:flagOff');
    expect(unmet(off)).toEqual(['served:flagOff']);
    const none = { served: { ok: false, reason: 'HTTP 500', flagOn: null } };
    expectRed(none, 'served:HTTP 500');
  });

  it('the empty store cannot pass: no key, no restore, every control still RED', () => {
    const o = greenObs();
    o.mint.key = absent();
    o.restore.call.profileRestore = 'miss';
    o.controls.b.pairRestored = false;
    o.controls.c.pairRestored = false;
    const v = evaluate(o);
    expect(v.ok).toBe(false);
    expect(v.evidence.unmetPreconditions).toEqual(
      expect.arrayContaining([
        's1:profileNotWritten',
        's2:profileRestore=miss',
        'b:notPaired',
        'c:notPaired',
      ]),
    );
  });
});

// ─── The grade: AC(9) in the TALLY ──────────────────────────────────────────────────────────

describe('TALLY total=9', () => {
  const all = (): { ac: string; name: string; ok: boolean }[] =>
    ['AC(1)', 'AC(2)', 'AC(3)', 'AC(4)', 'AC(5)', 'AC(7)', 'AC(8)', 'AC(10)', 'AC(9)'].map(
      (ac) => ({
        ac,
        name: ac,
        ok: true,
      }),
    );
  const facts = { adaptedArmDrewHoldout: false, adaptedResponsesArrivedAfterVerdict: 0 };

  it('GRADED_ACS names nine, AC(9) among them, in record order', () => {
    expect([...GRADED_ACS]).toEqual(all().map((r) => r.ac));
  });

  it('a full green run reads total=9', () => {
    expect(gradeRun(all(), facts).tallyLine).toBe(
      'TALLY green=9 red=0 unmeasured=0 total=9 run=GREEN',
    );
  });

  it('a raw AC(9) failure with no evidence stays RED, it never defaults to UNMEASURED', () => {
    const g = gradeRun([{ ac: 'AC(9)', name: 'x', ok: false }], facts);
    expect(g.results[0]?.verdict).toBe('FAIL');
  });

  it('main() records a thrown AC(9) as RED, and the driver before the missing-AC sweep', () => {
    const at = (s: string) => harnessSrc.indexOf(s);
    expect(at("unmetPreconditions: ['ac9Threw']")).toBeGreaterThan(0);
    expect(at('ac9Obs = await driveAc9(browser)')).toBeLessThan(
      at('for (const ac of missingGradedAcs(results))'),
    );
    expect(at('ac9Obs = await driveAc9(browser)')).toBeGreaterThan(
      at('ac10Obs = await driveAc10(browser)'),
    );
  });
});

// ─── The driver's order and the real source ─────────────────────────────────────────────────

describe('the driver, against the source', () => {
  const driver = (): string =>
    harnessSrc.slice(
      harnessSrc.indexOf('async function driveAc9(browser)'),
      harnessSrc.indexOf('// ─── Preflight: the substrate is real'),
    );

  it('each control follows the positive restore on its xid; (d), which destroys the key, comes last', () => {
    const d = driver();
    const at = (s: string) => {
      const i = d.indexOf(s);
      expect(i, s).toBeGreaterThan(-1);
      return i;
    };
    expect(at('driveAc9Restore(')).toBeLessThan(at('driveAc9NoConsent('));
    expect(at('driveAc9NoConsent(')).toBeLessThan(at('driveAc9Withdrawal('));
    expect(at('driveAc9Withdrawal(')).toBeLessThan(at('driveAc9Dsr('));
    expect(at('driveAc9Dsr(')).toBeLessThan(at('driveAc9NonPersistable('));
    expect(at('driveAc9NonPersistable(')).toBeLessThan(at('readAc9Nc8('));
  });

  it('session 2 is a fresh context seeded by storageState: nothing in sessionStorage, once only', () => {
    const open = harnessSrc.slice(
      harnessSrc.indexOf('async function openAc9Session('),
      harnessSrc.indexOf('async function resolveAc9Quiz('),
    );
    expect(open).toContain('storageState');
    expect(open).not.toContain('addInitScript');
    expect(open).not.toContain('sessionStorage.setItem');
  });

  it('session 1 reaches consent by the real banner click, and the seed is what the SDK left', () => {
    expect(harnessSrc).toContain(`'[data-estalara-consent="accept"]'`);
    expect(harnessSrc).toContain(`'[data-estalara-withdraw]'`);
    const mint = harnessSrc.slice(
      harnessSrc.indexOf('async function mintAc9Xid('),
      harnessSrc.indexOf('async function driveAc9Restore('),
    );
    expect(mint).toContain('readAc9Seed(s)');
  });

  it('the raw xid stays out of the evidence: only its hash tag', () => {
    expect(harnessSrc).toContain('mint.xidTag = ac9XidTag(');
    const facts = harnessSrc.slice(
      harnessSrc.indexOf('function ac9CallFacts('),
      harnessSrc.indexOf('async function openAc9Session('),
    );
    expect(facts).not.toMatch(/xid:\s*c\.xid/);
  });

  it('the Redis key is read by its hash, the way the store writes it', () => {
    expect(storeSrc).toContain('`buyer_profile:${tenantId}:${xidHash(xid)}`');
    expect(storeSrc).toContain("createHash('sha256').update(xid).digest('hex')");
    expect(harnessSrc).toContain('`buyer_profile:*:${ac9XidHash(xid)}`');
  });

  it('the DSR row is seeded the way the route verifies it: sha-256 of the OTP, dsr_type erase', async () => {
    const probe = await read('./bandit-probe.mjs');
    expect(probe).toContain('INSERT INTO dsr_verifications');
    expect(probe).toContain("'erase'");
    const otpSrc = await read('../../../apps/control-plane/src/lib/dsr-otp.ts');
    expect(otpSrc).toContain("createHash('sha256').update(otp).digest('hex')");
    expect(harnessSrc).toContain("createHash('sha256').update(otp).digest('hex')");
  });
});

describe('parity with the product source', () => {
  it('the stored-trait allow-list is the store’s', () => {
    const m = /const PERSISTABLE_TRAITS = \[([^\]]+)\]/.exec(storeSrc);
    expect(m).not.toBeNull();
    const listed = [...(m?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect([...AC9_STORED_TRAITS]).toEqual(listed);
  });

  it('the retention ceiling is the shared constant', () => {
    expect(AC9_MAX_PTTL_MS).toBe(XID_RETENTION_DAYS * DAY_MS);
  });

  it('the server gate honours exactly `consented`, so the seven states are all refusals', () => {
    expect(storeSrc).toContain("input.consentState !== 'consented'");
    expect(AC9_NO_CONSENT_STATES).not.toContain('consented');
  });

  it('a quiz result that may not persist deletes the key in the store, a behavior label does not', () => {
    expect(storeSrc).toContain(
      "if (candidate.source === 'quiz' && NON_PERSISTABLE_ARCHETYPES.has(candidate.archetype)) {",
    );
    expect(storeSrc).toContain("redisPipeline([['DEL', key]])");
  });

  it('`diaspora_buyer` is non-persistable in the store, and `yield_hunter` is not', () => {
    const m = /NON_PERSISTABLE_ARCHETYPES[^[]*\[([^\]]+)\]/.exec(storeSrc);
    expect(m?.[1]).toContain("'diaspora_buyer'");
    expect(m?.[1]).not.toContain("'yield_hunter'");
  });

  it('a restore serves a similarity the route bands as llm_tweaked', () => {
    const restored = /const RESTORED_SIMILARITY = ([0-9.]+);/.exec(routeSrc);
    const low = /const LOW_SIMILARITY_THRESHOLD = ([0-9.]+);/.exec(routeSrc);
    expect(routeSrc).toContain(
      "similarity <= LOW_SIMILARITY_THRESHOLD ? 'llm_full' : 'llm_tweaked'",
    );
    const high = /const HIGH_SIMILARITY_THRESHOLD = ([0-9.]+);/.exec(routeSrc);
    expect(Number(restored?.[1])).toBeGreaterThan(Number(low?.[1]));
    expect(Number(restored?.[1])).toBeLessThanOrEqual(Number(high?.[1]));
  });
});

describe('quizPathToLeaf, over the served default tree', () => {
  /** Turn a path into the walker's selection indexes and let the real `nextStep()` resolve it. */
  const resolve = (leaf: string, traits: readonly string[]): string | null => {
    const def = DEFAULT_QUIZ_DEFINITION_V2;
    const steps = quizPathToLeaf(def, leaf, traits);
    if (steps === null) return null;
    const path: (number | number[])[] = [];
    for (const step of steps) {
      const q = def.questions.find((x) => x.id === step.questionId);
      if (!q) throw new Error(step.questionId);
      const answers = q.answers as { label_i18n: Record<string, string> }[];
      const indexes = step.answers.map((labels) =>
        answers.findIndex((a) => Object.values(a.label_i18n).some((t) => labels.includes(t))),
      );
      expect(indexes).not.toContain(-1);
      path.push(step.multi ? indexes : indexes[0]!);
    }
    const ns = nextStep(def, { path }) as { kind: string; leaf?: string };
    return ns.kind === 'confirm' ? (ns.leaf ?? null) : `not-confirm:${ns.kind}`;
  };

  it('reaches yield_hunter with both traits ticked on the trait screen', () => {
    expect(resolve('yield_hunter', ['seasoned_investor', 'residency_goal'])).toBe('yield_hunter');
    const steps = quizPathToLeaf(DEFAULT_QUIZ_DEFINITION_V2, 'yield_hunter', [
      'seasoned_investor',
      'residency_goal',
    ]);
    expect(steps?.at(-1)?.multi).toBe(true);
    expect(steps?.at(-1)?.answers).toHaveLength(2);
  });

  it('reaches diaspora_buyer', () => {
    expect(resolve('diaspora_buyer', ['premium'])).toBe('diaspora_buyer');
  });

  it('names labels in every served language, so a language switch cannot lose the path', () => {
    const steps = quizPathToLeaf(DEFAULT_QUIZ_DEFINITION_V2, 'yield_hunter');
    expect(steps?.[0]?.answers[0]).toEqual(
      expect.arrayContaining(['An investment — to rent out or resell']),
    );
    expect(steps?.[0]?.answers[0]?.length).toBeGreaterThanOrEqual(2);
  });

  it('a leaf with no path, or no tree, is null: the verdict says so instead of walking anywhere', () => {
    expect(quizPathToLeaf(DEFAULT_QUIZ_DEFINITION_V2, 'no_such_archetype')).toBeNull();
    expect(quizPathToLeaf(null, 'yield_hunter')).toBeNull();
  });
});
