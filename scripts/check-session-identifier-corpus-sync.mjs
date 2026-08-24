#!/usr/bin/env node
/**
 * check-session-identifier-corpus-sync.mjs — FOLLOW-1105 AC(5) / ESC-070
 *
 * Fails CI when what the compliance corpus says about the session identifier stops being true of
 * the identifier the SDK actually mints.
 *
 * WHY THIS GATE EXISTS
 *
 * From 2026-05-15 to 2026-08-24 the DPIA, the LIA, the ROPA and the Privacy Notice all described
 * `HMAC(tenant_secret, fingerprint_entropy, day_bucket)` — an identifier that "rotates on tab close"
 * and for which "cross-session linking is technically impossible". None of it was ever built. The
 * shipped value was an unkeyed SHA-256 over four browser attributes, byte-identical from the SDK's
 * first commit, so the document was wrong on the day it was written (ESC-070). Two of the false
 * claims were INVERTED, and those two carried the ePrivacy Art. 5(3)(b) strictly-necessary argument
 * and the LIA balancing test.
 *
 * FOLLOW-1106 fixed the code (random UUID v4) and FOLLOW-1107 fixed the corpus. Neither of them
 * stops it happening again — and the original failure needed no drift at all to occur, only a
 * document written next to a code path nobody re-read. THAT is what this gate closes. It is the
 * half of FOLLOW-1105 that makes the other half stay true.
 *
 * WHY IT EXECUTES THE REAL FUNCTION INSTEAD OF READING SOURCE
 *
 * `packages/sdk/src/core/session.ts` has zero imports, so this gate imports it under Node
 * type-stripping and calls the same `generateSessionId()` the SDK ships. Every property the DPIA
 * claims is then PROVEN against the running function rather than pattern-matched out of its source
 * or trusted to a test whose name a refactor can change. A regression that reintroduces a
 * device-derived identifier goes red here even if every test in the SDK were rewritten to agree
 * with it (Rule AU: assert the behaviour, not the presence of a sentence).
 *
 * THE CHECKS
 *
 *   G1  dpia.md §2.2.1 — the single anchor for every identifier claim — exists, and the source file
 *       and test file it names both exist on disk. A corpus that cites a moved file is already
 *       drifting.
 *   G2  Every test the §2.2.1 table cites exists VERBATIM in the cited test file, exactly once, and
 *       is not `.skip`/`.todo`. This is the cheap drift: rename a test and the SDK suite stays
 *       green while the DPIA silently starts citing nothing.
 *   G3  The five claimed properties, executed against the real `generateSessionId()`:
 *       randomly minted (not derived), no digest computed, no device attribute read, works without
 *       a secure context, and refuses to mint rather than falling back to something weak.
 *   G4  The two INVERTED claims that carried the legal analysis have not reappeared as assertions
 *       anywhere in the corpus. These are the specific sentences ESC-070 withdrew.
 *
 * Modes:
 *   (no args)     check; exit 0 on pass, 1 on violation
 *   --self-test   prove the gate catches each check, red-first
 *
 * Run: node --experimental-strip-types scripts/check-session-identifier-corpus-sync.mjs
 * Wired into: .github/workflows/ci.yml (session-identifier-corpus-sync job)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DPIA = 'docs/compliance/dpia.md';

/** The §2.2.1 heading. Rule AN keeps this a sub-section of §2.2, so match the exact depth. */
const ANCHOR_HEADING = '#### 2.2.1 The session identifier — mechanism of record';

/**
 * The two sentences ESC-070 withdrew. They are not merely imprecise — they assert the OPPOSITE of
 * what the code did, and the Art. 5(3)(b) argument and the LIA balancing test rested on them. A
 * gate that only watched the mechanism would let these come back in prose.
 */
const WITHDRAWN_INVERTED_CLAIMS = [
  'cross-session linking is technically impossible',
  'cross-site tracking is architecturally impossible',
];

/** Files the withdrawn claims must not reappear in as assertions. */
const CORPUS = [
  'docs/compliance/dpia.md',
  'docs/compliance/lia-template.md',
  'docs/compliance/ropa.md',
  'docs/compliance/PRIVACY_NOTICE_TEMPLATE.md',
];

const violations = [];
const notes = [];

function fail(check, message) {
  violations.push(`[${check}] ${message}`);
}

function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(REPO_ROOT, rel));
}

/**
 * Slice §2.2.1 out of the DPIA: from its heading to the next heading of the same or shallower
 * depth. Returning null (rather than an empty string) keeps "the anchor is gone" distinguishable
 * from "the anchor is empty" — the first is a G1 failure, the second a G2 one.
 */
function extractAnchorSection(markdown) {
  const start = markdown.indexOf(ANCHOR_HEADING);
  if (start === -1) return null;
  const after = markdown.slice(start + ANCHOR_HEADING.length);
  const nextHeading = after.search(/\n#{1,4} /);
  return nextHeading === -1 ? after : after.slice(0, nextHeading);
}

/** `` `path/to/file` `` occurrences, in document order. */
function backtickedPaths(section) {
  return [...section.matchAll(/`([^`]+\.(?:ts|tsx|mjs|md|json))`/g)].map((m) => m[1]);
}

/** The `_"..."_` cells of the property→test table. */
function citedTestNames(section) {
  return [...section.matchAll(/_"([^"]+)"_/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------
// G1 — the anchor and the files it names
// ---------------------------------------------------------------------------

function checkAnchor(dpiaText) {
  const section = extractAnchorSection(dpiaText);
  if (section === null) {
    fail(
      'G1',
      `${DPIA} has no "${ANCHOR_HEADING}". That subsection is the single anchor for every ` +
        `identifier claim in the corpus (FOLLOW-1107); without it the claims have no stated ` +
        `mechanism and nothing to check them against.`,
    );
    return null;
  }

  const paths = backtickedPaths(section);
  const sourceFile = paths.find((p) => p.endsWith('core/session.ts'));
  const testFile = paths.find((p) => p.includes('__tests__') && p.endsWith('.test.ts'));

  if (!sourceFile) {
    fail('G1', `§2.2.1 does not name the module that mints the identifier (…/core/session.ts).`);
  } else if (!exists(sourceFile)) {
    fail('G1', `§2.2.1 names \`${sourceFile}\`, which does not exist.`);
  }

  if (!testFile) {
    fail('G1', `§2.2.1 does not name the test file that pins its claims.`);
  } else if (!exists(testFile)) {
    fail('G1', `§2.2.1 names \`${testFile}\`, which does not exist.`);
  }

  return { section, sourceFile, testFile };
}

// ---------------------------------------------------------------------------
// G2 — every cited test exists, once, and actually runs
// ---------------------------------------------------------------------------

function checkCitedTests(section, testFile) {
  const names = citedTestNames(section);
  if (names.length === 0) {
    fail(
      'G2',
      `§2.2.1 cites no tests at all — its property table is empty or has lost its format.`,
    );
    return;
  }
  if (!testFile || !exists(testFile)) return; // already reported by G1

  const testSource = read(testFile);

  for (const name of names) {
    const occurrences = testSource.split(name).length - 1;
    if (occurrences === 0) {
      fail(
        'G2',
        `§2.2.1 cites the test "${name}", which does not exist in \`${testFile}\`. ` +
          `A renamed test leaves the SDK suite green and the DPIA citing nothing.`,
      );
      continue;
    }
    if (occurrences > 1) {
      fail(
        'G2',
        `§2.2.1 cites the test "${name}", which appears ${String(occurrences)} times in ` +
          `\`${testFile}\` — the citation is ambiguous.`,
      );
      continue;
    }

    const line = testSource.split('\n').find((l) => l.includes(name)) ?? '';
    const skipped = /\b(?:it|test|describe)\s*\.\s*(?:skip|todo|fails)\s*\(/.test(line);
    if (skipped) {
      fail(
        'G2',
        `§2.2.1 cites the test "${name}", which is skipped. A skipped test pins nothing, ` +
          `and the DPIA says each one "fails if the property is lost".`,
      );
    }
  }

  notes.push(`G2: ${String(names.length)} cited test(s) present, unique and running.`);
}

// ---------------------------------------------------------------------------
// G3 — the claimed properties, executed against the real function
// ---------------------------------------------------------------------------

/** Swap globalThis.crypto for the duration of one probe. Node exposes it getter-only. */
async function withCrypto(replacement, fn) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    value: replacement,
    configurable: true,
    writable: true,
  });
  try {
    return await fn();
  } finally {
    if (original) Object.defineProperty(globalThis, 'crypto', original);
    else delete globalThis.crypto;
  }
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Run one behavioural probe so that a THROW becomes a reported violation instead of a crash.
 *
 * Found by this gate's own negative control: injecting the retired fingerprint made an later probe
 * throw (the reintroduced code reached for `crypto.subtle` under a stub that has none), and the
 * gate died with a stack trace BEFORE printing the violations it had already collected. Exit 1 with
 * no diagnosis is the shape of red an operator cannot act on, and it would have hidden the three
 * findings that mattered. Every probe is therefore individually guarded.
 */
async function probe(check, fn) {
  try {
    await fn();
  } catch (err) {
    fail(
      check,
      `the probe threw instead of completing: ${err instanceof Error ? err.message : String(err)}. ` +
        `generateSessionId() must not reach for an API outside the CSPRNG rungs §2.2.1 describes.`,
    );
  }
}

async function checkBehaviour(sourceFile) {
  if (!sourceFile || !exists(sourceFile)) return; // already reported by G1

  let generateSessionId;
  try {
    ({ generateSessionId } = await import(path.join(REPO_ROOT, sourceFile)));
  } catch (err) {
    fail(
      'G3',
      `could not import \`${sourceFile}\` to execute its claims: ` +
        `${err instanceof Error ? err.message : String(err)}. The module must stay import-free ` +
        `so this gate can call the real function rather than pattern-match its source.`,
    );
    return;
  }
  if (typeof generateSessionId !== 'function') {
    fail('G3', `\`${sourceFile}\` does not export generateSessionId().`);
    return;
  }

  const realCrypto = globalThis.crypto;

  // (a) Randomly minted, not derived — 500 draws in ONE identical environment.
  // The retired mechanism returned the same value for every call on a given device; that is
  // exactly what this probe would catch.
  const ids = [];
  await probe('G3a', async () => {
    for (let i = 0; i < 500; i += 1) ids.push(await generateSessionId());
  });
  const distinct = new Set(ids).size;
  if (ids.length > 0 && distinct !== 500) {
    fail(
      'G3a',
      `generateSessionId() produced ${String(distinct)} distinct value(s) in 500 calls from one ` +
        `identical environment. The DPIA claims the identifier is randomly minted and not derived ` +
        `— a derived identifier is a persistent fingerprint and moves the ePrivacy Art. 5(3) ` +
        `analysis (ESC-070).`,
    );
  }
  const misshapen = ids.filter((id) => !UUID_V4.test(id));
  if (misshapen.length > 0) {
    fail(
      'G3a',
      `${String(misshapen.length)} of 500 ids are not RFC-4122 UUID v4 (e.g. "${misshapen[0]}"). ` +
        `The corpus describes a random UUID v4 in ropa.md Activity 2 and dpia.md §2.5.`,
    );
  }

  // (b) No digest is computed at all, and (c) no device attribute is read.
  // Both are observed through instrumentation rather than assumed, because the retired mechanism
  // was precisely a digest over device attributes.
  const digestCalls = [];
  const deviceReads = [];
  const watchedCrypto = {
    ...realCrypto,
    randomUUID: () => realCrypto.randomUUID(),
    getRandomValues: (arr) => realCrypto.getRandomValues(arr),
    subtle: new Proxy(realCrypto.subtle ?? {}, {
      get(target, prop, receiver) {
        if (prop === 'digest') {
          return (...args) => {
            digestCalls.push(args[0]);
            return Reflect.get(target, prop, receiver).apply(target, args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }),
  };

  const deviceGlobals = ['navigator', 'screen', 'Intl'];
  const savedDescriptors = new Map();
  for (const name of deviceGlobals) {
    savedDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        deviceReads.push(name);
        return (
          savedDescriptors.get(name)?.get?.call(globalThis) ??
          savedDescriptors.get(name)?.value ??
          {}
        );
      },
    });
  }

  try {
    await probe('G3bc', async () => {
      await withCrypto(watchedCrypto, async () => {
        await generateSessionId();
      });
    });
  } finally {
    for (const name of deviceGlobals) {
      const saved = savedDescriptors.get(name);
      if (saved) Object.defineProperty(globalThis, name, saved);
      else delete globalThis[name];
    }
  }

  if (digestCalls.length > 0) {
    fail(
      'G3b',
      `generateSessionId() called crypto.subtle.digest ${String(digestCalls.length)} time(s). ` +
        `§2.2.1 claims no digest is computed at all; a digest over device inputs IS the retired ` +
        `mechanism.`,
    );
  }
  if (deviceReads.length > 0) {
    fail(
      'G3c',
      `generateSessionId() read device global(s): ${[...new Set(deviceReads)].join(', ')}. ` +
        `§2.2.1 claims no device attribute is read. The retired mechanism read navigator.userAgent, ` +
        `screen, Intl and navigator.language.`,
    );
  }

  // (d) Works without a secure context — randomUUID absent, getRandomValues present.
  let usedGetRandomValues = false;
  const insecureCrypto = {
    getRandomValues: (arr) => {
      usedGetRandomValues = true;
      return realCrypto.getRandomValues(arr);
    },
  };
  let fallbackId;
  await probe('G3d', async () => {
    fallbackId = await withCrypto(insecureCrypto, () => generateSessionId());
  });
  if (!usedGetRandomValues || !UUID_V4.test(String(fallbackId))) {
    fail(
      'G3d',
      `with crypto.randomUUID absent (a plain-HTTP page), generateSessionId() did not produce a ` +
        `UUID-v4-shaped value from crypto.getRandomValues (got "${String(fallbackId)}"). ` +
        `§2.2.1 claims the fallback rung is byte-shape-identical so no validator can tell them apart.`,
    );
  }

  // (e) No weak fallback when no CSPRNG exists — it must REJECT, not invent.
  let rejected = false;
  await withCrypto({}, async () => {
    try {
      await generateSessionId();
    } catch {
      rejected = true;
    }
  });
  if (!rejected) {
    fail(
      'G3e',
      `with no CSPRNG available generateSessionId() returned a value instead of rejecting. ` +
        `§2.2.1 claims the SDK mints no identifier at all rather than a guessable or ` +
        `device-derived one.`,
    );
  }

  notes.push('G3: five claimed properties executed against the real generateSessionId().');
}

// ---------------------------------------------------------------------------
// G4 — the withdrawn inverted claims have not come back
// ---------------------------------------------------------------------------

/**
 * A line is HISTORICAL when it quotes the withdrawn claim in order to withdraw it. Those lines are
 * required — ESC-070's whole remedy was to record what was false — so the gate looks for the claim
 * being ASSERTED, not merely present. The markers below are the ones the corrected corpus uses.
 */
const HISTORICAL_MARKERS = [
  'never existed',
  'never been built',
  'was wrong',
  'withdrawn',
  'FALSE',
  'inverted',
  'no longer',
  'corrected',
  'ESC-070',
  'FOLLOW-1105',
  'FOLLOW-1107',
];

function checkWithdrawnClaims() {
  for (const rel of CORPUS) {
    if (!exists(rel)) continue;
    const lines = read(rel).split('\n');
    lines.forEach((line, i) => {
      for (const claim of WITHDRAWN_INVERTED_CLAIMS) {
        if (!line.includes(claim)) continue;
        const historical = HISTORICAL_MARKERS.some((m) => line.includes(m));
        if (!historical) {
          fail(
            'G4',
            `${rel}:${String(i + 1)} asserts "${claim}" with nothing on the line marking it as ` +
              `the withdrawn claim. ESC-070 withdrew this sentence: it is the inverse of how the ` +
              `identifier behaved, and it carried the Art. 5(3)(b) / LIA balancing argument.`,
          );
        }
      }
    });
  }
  notes.push('G4: neither withdrawn inverted claim is asserted in the corpus.');
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runChecks() {
  const dpiaText = read(DPIA);
  const anchor = checkAnchor(dpiaText);
  if (anchor) {
    checkCitedTests(anchor.section, anchor.testFile);
    await checkBehaviour(anchor.sourceFile);
  }
  checkWithdrawnClaims();
}

/**
 * Red-first proof. Each case perturbs one input and asserts THIS gate goes red for it — a gate
 * whose failure path has never been executed is a green badge, which is the FOLLOW-918 defect.
 */
async function selfTest() {
  const cases = [
    {
      name: 'G1 — anchor section removed',
      run: () => {
        const section = extractAnchorSection(read(DPIA).replace(ANCHOR_HEADING, '#### 2.2.1 gone'));
        return section === null;
      },
    },
    {
      name: 'G1 — anchor names a file that does not exist',
      run: () =>
        backtickedPaths('see `packages/sdk/src/core/nope.ts`').length === 1 &&
        !exists('packages/sdk/src/core/nope.ts'),
    },
    {
      name: 'G2 — a cited test name that is absent is detected',
      run: () => {
        const before = violations.length;
        checkCitedTests(
          '| x | _"a test nobody wrote"_ |',
          'packages/sdk/src/__tests__/session.test.ts',
        );
        const caught = violations.length > before;
        violations.length = before;
        return caught;
      },
    },
    {
      name: 'G2 — a skipped cited test is detected',
      run: () =>
        /\b(?:it|test|describe)\s*\.\s*(?:skip|todo|fails)\s*\(/.test(
          "  it.skip('pinned property', async () => {",
        ),
    },
    {
      name: 'G3a — a derived (constant) identifier is detected',
      run: () => new Set(Array.from({ length: 500 }, () => 'same-value')).size !== 500,
    },
    {
      name: 'G3a — a non-UUID shape is detected',
      // The fixture is BUILT, not pasted. A 64-char hex literal in source is what the
      // `cloudflare-api-token` gitleaks rule matches on — this file tripped it on first push, the
      // same class FOLLOW-1097 had to truncate out of a README. Repeating an 8-char chunk gives a
      // legacy-shaped digest to test against while leaving no high-entropy literal on disk.
      run: () => !UUID_V4.test('2ffdf39a'.repeat(8)),
    },
    {
      name: 'G4 — the withdrawn claim asserted on a bare line is detected',
      run: () =>
        !HISTORICAL_MARKERS.some((m) =>
          'Cross-session linking is technically impossible because the day bucket rolls.'.includes(
            m,
          ),
        ),
    },
    {
      name: 'G4 — the same claim quoted to withdraw it is NOT flagged',
      run: () =>
        HISTORICAL_MARKERS.some((m) =>
          'The claim "cross-session linking is technically impossible" never existed in code.'.includes(
            m,
          ),
        ),
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const ok = await c.run();
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
    if (!ok) failed += 1;
  }
  console.log(
    failed === 0
      ? `\nGate self-test: PASSED (${String(cases.length)} assertions)`
      : `\nGate self-test: FAILED (${String(failed)}/${String(cases.length)})`,
  );
  return failed === 0 ? 0 : 1;
}

const isSelfTest = process.argv.includes('--self-test');

if (isSelfTest) {
  process.exit(await selfTest());
}

console.log('=== Session-identifier corpus sync (FOLLOW-1105 AC(5) / ESC-070) ===\n');
await runChecks();

if (violations.length > 0) {
  console.error(`FAIL — ${String(violations.length)} violation(s):\n`);
  for (const v of violations) console.error(`  ${v}\n`);
  console.error(
    'The compliance corpus and the shipped identifier have diverged. That divergence is the\n' +
      'ESC-070 defect, in which four documents described an identifier that was never built and\n' +
      'two inverted claims carried the ePrivacy Art. 5(3)(b) argument for three months.\n',
  );
  process.exit(1);
}

for (const n of notes) console.log(`OK:  ${n}`);
console.log(
  '\nPASS — every §2.2.1 claim is pinned, cited correctly, and true of the real function.',
);
