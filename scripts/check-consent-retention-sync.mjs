#!/usr/bin/env node
/**
 * check-consent-retention-sync.mjs — FOLLOW-1118 / ESC-071
 *
 * Fails CI when the declared consent-log retention constant, the disclosure sentence rendered to
 * visitors, and the retention cron's deletion window disagree.
 *
 * WHY THIS GATE EXISTS, AND WHY IT IS THE POINT OF THE TICKET
 *
 * Before FOLLOW-1118 the retention period lived in four places that disagreed: a 13-month TTL in a
 * ClickHouse migration, a hand-typed "7 days" sentence byte-locked into three locales, ROPA rows
 * stating a third thing, and three tables with no TTL at all. The shipped banner therefore told
 * visitors in en/pl/es that their consent-decision log was deleted after 7 days while the only
 * mechanism kept it 13 months (ESC-071).
 *
 * FOLLOW-1118 makes `CONSENT_LOG_RETENTION_DAYS` the single declared value and derives both the
 * disclosure and the deletion from it. WITHOUT THIS GATE that work would have *moved* the drift
 * rather than removed it: nothing would stop the next editor re-typing a number into the served
 * JSON, or writing a literal interval into the cron. So this gate is not a nicety attached to the
 * fix — it is the half of the fix that makes the other half stay true.
 *
 * WHY IT EVALUATES THE REAL MODULE INSTEAD OF PATTERN-MATCHING SOURCE
 *
 * It imports `packages/shared/src/consent-retention.ts` directly (Node type-stripping) and calls
 * the same `renderDisclosure13_1()` and `buildConsentLogRetentionSql()` the product calls. The
 * number it compares is therefore the number the cron will actually send and the sentence the
 * visitor will actually read — not a regex's opinion of them. The module deliberately has zero
 * imports so this works with no build step.
 *
 * THE CHECKS
 *
 *   G1  docs/compliance/consent-disclosures.canonical.json — the byte record the ADR-0021 §D5
 *       countersign rests on — carries exactly the rendered sentence, per locale.
 *   G2  apps/control-plane/public/consent-text.json (the bytes actually served) likewise.
 *   G3  Tri-party agreement: the number inside each rendered sentence == the constant == the
 *       window bound into the cron's SQL.
 *   G4  The cron route derives its window from `buildConsentLogRetentionSql` and contains no
 *       literal interval or hand-rolled DELETE of its own.
 *   G5  The cron is actually scheduled in apps/control-plane/vercel.json. An enforcement
 *       mechanism nothing invokes is the ESC-071 defect with a new file name.
 *   G6  No stale retention period survives anywhere in the consent corpus, in any of the three
 *       languages — including the prose in dpia.md and PRIVACY_NOTICE_TEMPLATE.md.
 *   G7  ropa.md and dpia.md name the constant, so the corpus points at code rather than
 *       restating a number that can drift again.
 *
 * Modes:
 *   (no args)     check; exit 0 on pass, 1 on violation
 *   --write       regenerate the two JSON artefacts from the constant (the maintenance path:
 *                 change the constant, run this, commit)
 *   --self-test   prove the gate catches each check, red-first
 *
 * Run: node --experimental-strip-types scripts/check-consent-retention-sync.mjs
 * Wired into: .github/workflows/ci.yml (consent-retention-sync job)
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  CONSENT_DISCLOSURE_LOCALES,
  CONSENT_LOG_RETENTION_DAYS,
  buildConsentLogRetentionSql,
  renderDisclosure13_1,
} from '../packages/shared/src/consent-retention.ts';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const P = {
  canonical: 'docs/compliance/consent-disclosures.canonical.json',
  served: 'apps/control-plane/public/consent-text.json',
  route: 'apps/control-plane/src/app/api/internal/retention/consent-log/route.ts',
  vercel: 'apps/control-plane/vercel.json',
  ropa: 'docs/compliance/ropa.md',
  dpia: 'docs/compliance/dpia.md',
  notice: 'docs/compliance/PRIVACY_NOTICE_TEMPLATE.md',
  example: 'packages/shared/src/examples/consent-text.ts',
};

/** The route path the cron must be scheduled on. */
const CRON_PATH = '/api/internal/retention/consent-log';

/**
 * Retention-period phrasings, per language, that must always state the current value.
 *
 * Deliberately narrow in two independent ways, because a sweep that is merely broad produces
 * false reds and a gate people learn to ignore is worth less than no gate:
 *
 *   1. The pattern matches a stated RETENTION PERIOD, not every occurrence of a number.
 *      `7-day denial-log promise` in a changelog row is history and must survive; `retained for
 *      7 days` is a live claim and must not.
 *   2. The match must be ABOUT THE CONSENT LOG. The corpus legitimately states other periods —
 *      `archetype_contribution_log retained for 90 days`, the 90-day `__estalara_xid__` — and
 *      those are none of this constant's business. {@link CONSENT_SUBJECT} decides.
 */
const PERIOD_PHRASES = [
  { label: 'en', re: /retained for (?:a maximum of )?(\d+) days?\b/gi },
  { label: 'pl', re: /przechowywany przez (\d+) dni\b/gi },
  { label: 'es', re: /se conserva durante (\d+) días?\b/gi },
];

/**
 * A retention period only belongs to this constant if the consent decision is the subject.
 * Matched against a window of text around the period, in all three languages.
 */
const CONSENT_SUBJECT = /consent|denial|denied|disclosure13_1|zgod|odmow|consentimiento|denegaci/i;

/** Characters of context either side of a period match that {@link CONSENT_SUBJECT} may use. */
const SUBJECT_WINDOW = 260;

/** Files that make up the consent corpus for the G6 stale-period sweep. */
const CORPUS = [P.canonical, P.served, P.example, P.dpia, P.notice, P.ropa];

// ── helpers ──────────────────────────────────────────────────────────────────

const read = (base, rel) => {
  const f = path.join(base, rel);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
};

/**
 * Remove `//` and block comments so the G4 source checks read CODE, not prose.
 * Crude but sufficient here: the route contains no string literal carrying `//` or a comment
 * opener, and the checks it feeds are all "is this construct present", never "is it absent from
 * a string".
 */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The rendered disclosure sentence per locale, from the real product code. */
function renderedDisclosures() {
  const out = {};
  for (const locale of CONSENT_DISCLOSURE_LOCALES) out[locale] = renderDisclosure13_1(locale);
  return out;
}

/**
 * Compare a JSON artefact's `locales.<loc>.disclosure13_1` against the rendered sentence.
 *
 * @param label file label for messages
 * @param raw file contents (or null when absent)
 * @param rendered locale -> sentence
 * @param problems accumulator
 */
function checkJsonArtefact(label, raw, rendered, problems) {
  if (raw === null) {
    problems.push(`${label} is MISSING — the disclosure has no home to be checked against.`);
    return;
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    problems.push(`${label} is not valid JSON (${e.message}).`);
    return;
  }
  const locales = doc?.locales;
  if (!locales || typeof locales !== 'object') {
    problems.push(`${label} has no \`locales\` object.`);
    return;
  }
  for (const [locale, want] of Object.entries(rendered)) {
    const got = locales[locale]?.disclosure13_1;
    if (got === undefined) {
      problems.push(`${label} locale '${locale}' is missing 'disclosure13_1'.`);
    } else if (got !== want) {
      problems.push(
        `${label} locale '${locale}' 'disclosure13_1' does not equal the sentence rendered from ` +
          `CONSENT_LOG_RETENTION_DAYS.\n` +
          `      rendered: ${JSON.stringify(want)}\n` +
          `      found   : ${JSON.stringify(got)}\n` +
          `      Fix by changing the constant (or the template) and running ` +
          `\`node --experimental-strip-types scripts/check-consent-retention-sync.mjs --write\` — ` +
          `never by re-typing the sentence, which is the drift ESC-071 was raised about.`,
      );
    }
  }
}

/**
 * @param base repo root (or a fixture root, for --self-test)
 * @returns {{problems: string[], notes: string[]}}
 */
function check(base) {
  const problems = [];
  const notes = [];

  const rendered = renderedDisclosures();
  const statements = buildConsentLogRetentionSql();

  // ── G1 / G2 — the two JSON homes carry exactly the rendered sentence ──────
  checkJsonArtefact(P.canonical, read(base, P.canonical), rendered, problems);
  checkJsonArtefact(P.served, read(base, P.served), rendered, problems);
  notes.push(
    `G1/G2: ${String(Object.keys(rendered).length)} locale(s) compared against the rendered sentence in 2 artefacts.`,
  );

  // ── G3 — constant == rendered number == cron window ──────────────────────
  const window = Number(statements.del.params.retention_days);
  if (window !== CONSENT_LOG_RETENTION_DAYS) {
    problems.push(
      `G3: the cron's deletion window (${String(window)} days, bound as param_retention_days) does ` +
        `not equal CONSENT_LOG_RETENTION_DAYS (${String(CONSENT_LOG_RETENTION_DAYS)}).`,
    );
  }
  for (const [locale, sentence] of Object.entries(rendered)) {
    const digits = sentence.match(/\b(\d+)\b/g) ?? [];
    if (digits.length !== 1) {
      problems.push(
        `G3: the rendered '${locale}' disclosure contains ${String(digits.length)} numbers; exactly ` +
          `one (the retention period) is expected, so the gate can compare it to the cron window.`,
      );
    } else if (Number(digits[0]) !== CONSENT_LOG_RETENTION_DAYS) {
      problems.push(
        `G3: the rendered '${locale}' disclosure states ${digits[0]} days but ` +
          `CONSENT_LOG_RETENTION_DAYS is ${String(CONSENT_LOG_RETENTION_DAYS)} — the template is not ` +
          `interpolating the constant.`,
      );
    }
  }
  notes.push(
    `G3: constant=${String(CONSENT_LOG_RETENTION_DAYS)}d, cron window=${String(window)}d, rendered text states the same in every locale.`,
  );

  // ── G4 — the cron derives its window, never writes one ───────────────────
  const routeSrc = read(base, P.route);
  if (routeSrc === null) {
    problems.push(
      `G4: the retention cron ${P.route} is MISSING. The disclosure promises deletion; without ` +
        `this route nothing performs it, which is exactly ESC-071.`,
    );
  } else {
    // Comments are stripped first: this route's own docblock explains the ClickHouse semantics
    // it must NOT hand-roll, and a gate that reads prose as code fails on a correct file.
    const routeCode = stripComments(routeSrc);
    if (!/buildConsentLogRetentionSql\s*\(/.test(routeCode)) {
      problems.push(
        `G4: ${P.route} does not call buildConsentLogRetentionSql(); its window is therefore not ` +
          `derived from CONSENT_LOG_RETENTION_DAYS.`,
      );
    }
    if (!/from '@estalara\/shared'/.test(routeCode)) {
      problems.push(
        `G4: ${P.route} does not import the retention contract from '@estalara/shared'.`,
      );
    }
    const literalInterval = routeCode.match(/INTERVAL\s+\d+|toIntervalDay\(\s*\d/i);
    if (literalInterval) {
      problems.push(
        `G4: ${P.route} contains a literal SQL interval (${literalInterval[0]}). The window must ` +
          `come from the shared builder so it cannot drift from the disclosure.`,
      );
    }
    if (/ALTER\s+TABLE/i.test(routeCode)) {
      problems.push(
        `G4: ${P.route} hand-rolls an ALTER TABLE statement. The DELETE must come from ` +
          `buildConsentLogRetentionSql() so its predicate and window stay tied to the constant.`,
      );
    }
    notes.push(`G4: ${P.route} derives its window from the shared builder.`);
  }

  // ── G5 — the cron is actually scheduled ──────────────────────────────────
  const vercelRaw = read(base, P.vercel);
  if (vercelRaw === null) {
    problems.push(`G5: ${P.vercel} is MISSING; the cron schedule cannot be checked.`);
  } else {
    let vercel;
    try {
      vercel = JSON.parse(vercelRaw);
    } catch (e) {
      problems.push(`G5: ${P.vercel} is not valid JSON (${e.message}).`);
    }
    const crons = vercel?.crons ?? [];
    const entry = crons.find((c) => c?.path === CRON_PATH);
    if (!entry) {
      problems.push(
        `G5: no cron scheduled on ${CRON_PATH} in ${P.vercel}. A retention mechanism nothing ` +
          `invokes is the ESC-071 defect with a new file name.`,
      );
    } else {
      notes.push(`G5: cron scheduled on ${CRON_PATH} (${entry.schedule}).`);
    }
  }

  // ── G6 — no stale retention period anywhere in the consent corpus ────────
  for (const rel of CORPUS) {
    const src = read(base, rel);
    if (src === null) continue;
    for (const { label, re } of PERIOD_PHRASES) {
      for (const m of src.matchAll(re)) {
        const context = src.slice(
          Math.max(0, m.index - SUBJECT_WINDOW),
          m.index + m[0].length + SUBJECT_WINDOW,
        );
        if (!CONSENT_SUBJECT.test(context)) continue; // a period about something else
        if (Number(m[1]) !== CONSENT_LOG_RETENTION_DAYS) {
          const line = src.slice(0, m.index).split('\n').length;
          problems.push(
            `G6: ${rel}:${String(line)} states a ${label} retention period of ${m[1]} days ` +
              `("${m[0]}") but CONSENT_LOG_RETENTION_DAYS is ${String(CONSENT_LOG_RETENTION_DAYS)}. ` +
              `A historical figure must be phrased so it does not read as a live claim (e.g. "the ` +
              `7-day figure", not "retained for 7 days").`,
          );
        }
      }
    }
  }
  notes.push(
    `G6: swept ${String(CORPUS.length)} corpus file(s) for stale en/pl/es retention periods.`,
  );

  // ── G7 — the corpus points at the constant, not at a number ──────────────
  for (const rel of [P.ropa, P.dpia]) {
    const src = read(base, rel);
    if (src === null) {
      problems.push(`G7: ${rel} is MISSING.`);
    } else if (!src.includes('CONSENT_LOG_RETENTION_DAYS')) {
      problems.push(
        `G7: ${rel} never names CONSENT_LOG_RETENTION_DAYS. The compliance corpus must point at ` +
          `the enforcing mechanism rather than restate a number that can drift again.`,
      );
    }
  }
  notes.push(`G7: ropa.md and dpia.md name the enforcing constant.`);

  return { problems, notes };
}

// ── --write: regenerate the JSON artefacts from the constant ─────────────────

function write() {
  const rendered = renderedDisclosures();
  for (const rel of [P.canonical, P.served]) {
    const file = path.join(ROOT, rel);
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [locale, sentence] of Object.entries(rendered)) {
      if (!doc.locales?.[locale]) {
        console.error(`--write: ${rel} has no locale '${locale}'; refusing to invent one.`);
        process.exit(1);
      }
      doc.locales[locale].disclosure13_1 = sentence;
    }
    fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
    console.log(`wrote ${rel}`);
  }
  console.log(
    `\nRe-rendered at CONSENT_LOG_RETENTION_DAYS = ${String(CONSENT_LOG_RETENTION_DAYS)}.\n` +
      `Remember: the canonical record carries a compliance sign-off. Changing the period is a ` +
      `compliance change, not a copy edit.`,
  );
}

// ── self-test ────────────────────────────────────────────────────────────────

/**
 * Build a fixture root that is a COPY of the repo's real files, then let each case MUTATE it.
 * Copying and then constructing the defect is deliberate: a fixture that merely restates HEAD
 * goes green the moment HEAD acquires the very defect it is meant to catch (PR #843).
 */
function fixtureRoot(tmp, name) {
  const base = path.join(tmp, name);
  for (const rel of Object.values(P)) {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(base, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  return base;
}

function selfTest() {
  const tmp = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || '/tmp', 'consent-retention-'));
  let failures = 0;
  let passes = 0;

  const patch = (base, rel, fn) => {
    const f = path.join(base, rel);
    fs.writeFileSync(f, fn(fs.readFileSync(f, 'utf8')));
  };

  /** @param expect 'PASS' | a substring the violation list must contain */
  const run = (name, mutate, expect) => {
    const base = fixtureRoot(tmp, name.replace(/\W+/g, '-'));
    mutate(base);
    const { problems } = check(base);
    const ok =
      expect === 'PASS'
        ? problems.length === 0
        : problems.some((p) => p.includes(expect)) && problems.length > 0;
    if (ok) {
      passes += 1;
      console.log(`  PASS  ${name}`);
    } else {
      failures += 1;
      console.log(`  FAIL  ${name}`);
      console.log(
        `        expected: ${expect === 'PASS' ? 'no violations' : `a violation containing "${expect}"`}`,
      );
      console.log(
        `        got     : ${problems.length ? problems.map((p) => p.split('\n')[0]).join(' | ') : '(none)'}`,
      );
    }
  };

  console.log('Self-test — each case constructs the defect and demands the gate name it.\n');

  run('T1 unmutated repo state passes', () => {}, 'PASS');

  run(
    'T2 canonical byte record re-typed with a different period',
    (base) =>
      patch(base, P.canonical, (s) =>
        s.replace(
          `retained for ${String(CONSENT_LOG_RETENTION_DAYS)} days`,
          'retained for 30 days',
        ),
      ),
    "locale 'en' 'disclosure13_1' does not equal the sentence rendered",
  );

  run(
    'T3 served document re-typed with a different period (pl)',
    (base) =>
      patch(base, P.served, (s) =>
        s.replace(`przez ${String(CONSENT_LOG_RETENTION_DAYS)} dni`, 'przez 30 dni'),
      ),
    "locale 'pl' 'disclosure13_1' does not equal the sentence rendered",
  );

  run(
    'T4 a locale loses the mandated sentence entirely',
    (base) =>
      patch(base, P.canonical, (s) => s.replace(/"disclosure13_1"/, '"retired_disclosure13_1"')),
    "is missing 'disclosure13_1'",
  );

  run(
    'T5 the cron writes its own literal interval instead of deriving one',
    (base) =>
      patch(base, P.route, (s) =>
        s.replace(
          'const { count, del, retentionDays } = buildConsentLogRetentionSql();',
          "const sql = 'DELETE WHERE ts < now() - INTERVAL 7 DAY';",
        ),
      ),
    'does not call buildConsentLogRetentionSql()',
  );

  run(
    'T6 the cron route is deleted — the promise loses its mechanism',
    (base) => fs.rmSync(path.join(base, P.route)),
    'is MISSING',
  );

  run(
    'T7 the cron exists but nothing schedules it',
    (base) =>
      patch(base, P.vercel, (s) =>
        JSON.stringify(
          {
            ...JSON.parse(s),
            crons: JSON.parse(s).crons.filter((c) => c.path !== CRON_PATH),
          },
          null,
          2,
        ),
      ),
    `no cron scheduled on ${CRON_PATH}`,
  );

  run(
    'T8 a stale period survives in DPIA prose',
    (base) =>
      patch(
        base,
        P.dpia,
        (s) => s + '\n\nThe denial log is retained for 7 days and is then deleted.\n',
      ),
    'states a en retention period of 7 days',
  );

  run(
    'T9 a stale Spanish period survives in the Privacy Notice',
    (base) =>
      patch(
        base,
        P.notice,
        (s) => s + '\n\nEl registro de tu decisión de consentimiento se conserva durante 7 días.\n',
      ),
    'states a es retention period of 7 days',
  );

  run(
    'T10 ROPA restates a number instead of naming the constant',
    (base) =>
      patch(base, P.ropa, (s) => s.replaceAll('CONSENT_LOG_RETENTION_DAYS', 'the constant')),
    'never names CONSENT_LOG_RETENTION_DAYS',
  );

  console.log(`\n${String(passes)} passed, ${String(failures)} failed.`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failures === 0 ? 0 : 1);
}

// ── main ─────────────────────────────────────────────────────────────────────

const arg = process.argv[2];
if (arg === '--self-test') {
  selfTest();
} else if (arg === '--write') {
  write();
} else {
  const { problems, notes } = check(ROOT);
  console.log('check-consent-retention-sync — FOLLOW-1118 / ESC-071\n');
  for (const n of notes) console.log(`  ${n}`);
  if (problems.length) {
    console.log(`\n${String(problems.length)} violation(s):\n`);
    for (const p of problems) console.log(`  - ${p}`);
    console.log(
      '\nThe declared constant, the disclosure the visitor reads, and the deletion window must ' +
        'agree. They are meant to have ONE source: packages/shared/src/consent-retention.ts.',
    );
    process.exit(1);
  }
  console.log('\nOK — constant, rendered disclosure and cron window agree.');
}
