#!/usr/bin/env node
/**
 * FOLLOW-952 — measured premises must be registered, dated, cited and unexpired.
 *
 * ## Why this exists
 *
 * FOLLOW-946 AC(4) asked whether a PR that changes how a live request is authorised should carry a
 * measured premise, and where that control would live. It was answered nowhere, and meanwhile the
 * measurement itself got written into two places that cannot age gracefully: a comment in
 * `origin-policy.ts` asserting what production Postgres holds, and a line in `BRAND_PROVISIONING.md`
 * asking an operator to "re-verify this" with nothing reading the request.
 *
 * A claim about a live environment, written in shipped source, has no owner, no expiry and no
 * reader. This gate gives it all three.
 *
 * ## What it asserts
 *
 *   1. the register parses to at least one entry, and every entry carries every required field —
 *      a malformed register fails LOUD rather than passing vacuously;
 *   2. `revalidate_by` is in the future. Past the date is RED, and the failure prints the entry's
 *      own `measure_with` so the remedy needs no archaeology;
 *   3. every `[MP-NNN]` cited anywhere in the scanned scope resolves to a real entry — no dangling
 *      citations;
 *   4. every registered entry is cited at least once outside the register — the register cannot
 *      accumulate dead premises nobody leans on;
 *   5. a DATED measurement claim in shipped source must carry an `[MP-NNN]` citation. This is the
 *      direction that matters: source may CITE a premise, never RESTATE one.
 *
 * ## What it CANNOT assert, stated rather than implied (Rule AU item 3)
 *
 * **It can never re-measure anything.** CI has no read path to production Postgres, Vercel or
 * Cloudflare. Every claim in the register is true only because a human ran `measure_with` on the
 * stated date. This gate enforces bookkeeping about measurements; it does not verify them, and a
 * green run is NOT evidence that any premise still holds. That is the honest boundary — asserting
 * otherwise would make this gate the very thing it exists to catch.
 *
 * **Assertion 5 is bounded by a regex, and the bound is real.** It catches
 * `<measurement-verb> YYYY-MM-DD`, which is how every such claim in this estate happens to be
 * written today (7 sites at the time of writing). It does NOT catch a measurement written without a
 * date, or one whose date sits elsewhere in the sentence. It is a ratchet against the observed
 * shape, not a proof of absence.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

const REGISTER = join(ROOT, 'docs/ops/MEASURED_PREMISES.md');
const REGISTER_REL = 'docs/ops/MEASURED_PREMISES.md';

const REQUIRED_FIELDS = [
  'claim',
  'measured_on',
  'revalidate_by',
  'revalidate_on',
  'measure_with',
  'watch_status',
  'relied_on_by',
  'falsified_means',
];

/** Shipped source — where a measurement must never be restated (assertion 5). */
const SHIPPED_SOURCE = ['apps', 'packages'];
/** Where a citation counts as a citation (assertions 3 and 4). */
const CITATION_ROOTS = ['apps', 'packages', 'docs', 'scripts', '.github'];

const CITE = /\[(MP-\d{3})\]/g;
/**
 * A DATED LIVE-ENVIRONMENT CLAIM, as this estate actually writes them. [FOLLOW-982]
 *
 * The first version required `<verb>` immediately followed by whitespace and the date. It matched
 * **zero** lines in `apps/`+`packages/` while four such claims sat inside its scope — a ratchet
 * aimed one notch off the shape. The vocabulary below is DERIVED from the corpus, not guessed:
 * every dated comment line in scope (198 of them) was enumerated and classified. See the
 * enumeration in the FOLLOW-982 PR body.
 *
 * `confirmed` is deliberately ABSENT from the verb list: the only line it matched in the whole
 * corpus was `notes: 'CRM confirmed — deal signed 2026-06-01'` — a string literal inside a test
 * fixture, not a claim about anything. A verb the estate never uses for measurements buys no
 * coverage and costs a false positive, and a noisy gate is a gate someone turns off.
 *
 * The 60-character gap is likewise measured, not chosen: the widest true positive is
 * `Measured, dated, pasted** — \`apps/control-plane\`, 2026-08-12` at 42.
 *
 * Two shapes carry the claims, and both are here:
 *   1. a measurement verb with a BOUNDED gap before the date — the gap absorbs `live`, a comma,
 *      or a parenthetical (`verified live 2026-08-04`, `Measured, dated, pasted — …, 2026-08-12`);
 *   2. `as of <date>` with no verb at all (`INERT in production as of 2026-08-12`).
 *
 * **What it must NOT match, and why the classification mattered more than the regex.** Most dated
 * prose in this repo is a DECISION or a HISTORICAL EVENT, and neither rots: `CEO decision
 * 2026-06-05`, `ENFORCED as of FOLLOW-642 (2026-07-25)` — dated by TICKET, so `as of` is not
 * followed by a date — and `The 2026-08-12 failure was not that the DSN was absent`, which is
 * narrative about a past event with no verb before the date. A gate that reddened on those would
 * be noise, and noise is how a control gets disabled.
 */
const MEASUREMENT_VERB =
  'verified|measured|re-measured|re-read|probed|live-probed|sampled|observed|checked|inspected';
const DATED_MEASUREMENT = new RegExp(
  `(?:\\b(?:${MEASUREMENT_VERB})\\b[^.\\n]{0,60}?\\d{4}-\\d{2}-\\d{2})` +
    `|(?:\\bas of\\s+\\d{4}-\\d{2}-\\d{2})`,
  'i',
);

// ── --self-test ─────────────────────────────────────────────────────────────
// The detector and the parse guard are the two things whose FAILURE mode is silence: a regex
// that matches nothing passes, and a dropped register entry reports as a citation problem.
// Neither is observable from a green run, so both are pinned here. Sibling gates
// (`check-rule-i.sh`, `check-gate-exit-codes.sh`) carry self-tests; this one shipped without
// one. [FOLLOW-982 AC(4)]
if (process.argv.includes('--self-test')) {
  const cases = [
    // [label, text, mustMatch] — every POSITIVE is a real pre-fix artefact from this repo,
    // not a synthetic fixture (Rule AS: prove the widened detector against what it missed).
    [
      'as-of, no verb (observability-signals.test.ts:11)',
      'Every entry in this register is INERT in production as of 2026-08-12.',
      true,
    ],
    [
      'verb + "live" gap (domains.ts:97)',
      'hostnames that have NO DNS record (verified live 2026-08-04,',
      true,
    ],
    [
      'verb + comma gap (schema_validation.py:35)',
      'Measured, 2026-08-08 (FOLLOW-902 AC1). The only active tenant has no',
      true,
    ],
    [
      'verb + 42-char gap (observability-signals.test.ts:23)',
      '**Measured, dated, pasted** — `apps/control-plane`, 2026-08-12, RETRO-269:',
      true,
    ],
    [
      'as-of (adapt-floor.ts:151)',
      '**Not reachable in production as of 2026-08-13**, and this constant',
      true,
    ],
    [
      'verb + "on" (test_schema_validation.py:776)',
      'Golden regression on the exact prod condition measured on 2026-08-08.',
      true,
    ],
    [
      'wrapped across a line break (route.ts:14-15)',
      '`Encrypted`, 17d ago as of    2026-08-12) — which rules out `unset`',
      true,
    ],
    // NEGATIVES — dated prose that does NOT rot, and must never redden this gate.
    ['a decision date', 'Tiers retired 2026-06-05 (CEO ruling, MASTER_DESIGN E.7).', false],
    [
      'dated by TICKET, not date (api_keys.ts:36)',
      'The allow-list is ENFORCED as of FOLLOW-642 (2026-07-25).',
      false,
    ],
    [
      'historical narrative (observability-signals.test.ts:33)',
      'The 2026-08-12 failure was not that the DSN was absent.',
      false,
    ],
    [
      'test fixture string (labels/route.test.ts:738)',
      "notes: 'CRM confirmed — deal signed 2026-06-01',",
      false,
    ],
    ['a bare date', 'See the 2026-08-12 entry in the runbook.', false],
  ];
  let bad = 0;
  for (const [label, text, mustMatch] of cases) {
    const got = DATED_MEASUREMENT.test(text);
    if (got !== mustMatch) {
      console.error(
        `SELF-TEST FAIL — ${label}: expected ${mustMatch ? 'MATCH' : 'no match'}, got ${got ? 'MATCH' : 'no match'}`,
      );
      bad++;
    }
  }
  // The parse guard: heading count and parsed count must move together.
  const sample = '## MP-001 — a\n- **claim:** x\n\n## MP-002 — b\n-  **claim:** x\n';
  const headings = (sample.match(/^##\s+MP-\d{3}\s+—/gm) ?? []).length;
  if (headings !== 2) {
    console.error(`SELF-TEST FAIL — heading counter read ${headings}, expected 2`);
    bad++;
  }
  if (bad > 0) {
    console.error(`\nSELF-TEST: ${bad} failure(s). The detector or the parse guard has drifted.`);
    process.exit(1);
  }
  console.log(
    `SELF-TEST OK — ${cases.length} detector case(s) (7 real pre-fix artefacts, 5 must-not-match) + the parse-guard counter.`,
  );
  process.exit(0);
}

const fail = [];

// ── parse the register ──────────────────────────────────────────────────────
if (!existsSync(REGISTER)) {
  console.error(`FAIL — ${REGISTER_REL} does not exist. The gate has no register to check.`);
  process.exit(1);
}
const registerText = readFileSync(REGISTER, 'utf8');

/** id -> { title, fields } */
const entries = new Map();
let current = null;
for (const rawLine of registerText.split('\n')) {
  const head = /^##\s+(MP-\d{3})\s+—\s+(.+?)\s*$/.exec(rawLine);
  if (head) {
    current = { id: head[1], title: head[2], fields: new Map() };
    entries.set(head[1], current);
    continue;
  }
  if (/^##\s/.test(rawLine)) {
    current = null;
    continue;
  }
  if (!current) continue;
  const field = /^-\s+\*\*([a-z_]+):\*\*\s*(.*)$/.exec(rawLine);
  if (field) {
    current.fields.set(field[1], field[2].trim());
    current._last = field[1];
    continue;
  }
  // Field values WRAP. Without this the parser sees only the first line, and a `relied_on_by`
  // whose second line names another file would be half-checked — a subtler version of the
  // half-measured problem this whole register exists for. [FOLLOW-983]
  if (current._last && /^\s{2,}\S/.test(rawLine)) {
    current.fields.set(current._last, `${current.fields.get(current._last)} ${rawLine.trim()}`);
  } else if (!rawLine.trim()) {
    current._last = null;
  }
}

// ── vacuity, at BOTH ends ───────────────────────────────────────────────────
// Zero parsed entries was guarded from the start. N-1 was not, and that is the likelier
// accident: a prettier reflow of a `- **claim:**` line, or a hyphen where an em dash belongs,
// silently drops ONE entry. Assertion 4 then reports it as "registered but cited NOWHERE" — a
// citation diagnosis for a parse failure, which sends the reader to the wrong file. Counting
// headings independently of the field parser is what makes the two distinguishable. [FOLLOW-982]
const headingCount = (registerText.match(/^##\s+MP-\d{3}\s+—/gm) ?? []).length;

if (entries.size === 0) {
  console.error(`FAIL — ${REGISTER_REL} parsed to ZERO entries; the gate would pass vacuously.`);
  console.error('Either the register is empty or its "## MP-NNN — <claim>" heading shape changed.');
  process.exit(1);
}

if (headingCount !== entries.size) {
  console.error(
    `FAIL — PARSE ERROR, not a content problem. ${REGISTER_REL} has ${headingCount} ` +
      `"## MP-NNN — …" heading(s) but ${entries.size} parsed to a usable entry.`,
  );
  console.error(
    '  This is a FORMATTING fault in the register, not a missing citation and not a stale\n' +
      '  premise. Look for a reflowed or re-punctuated `- **field:** value` line — the field\n' +
      '  parser needs `- **name:** ` at the start of a line, and the heading needs an em dash.\n' +
      '  Fix the register format; do NOT start editing code that cites these entries.',
  );
  process.exit(1);
}

// ── 1 + 2: shape and staleness ──────────────────────────────────────────────
// Compared date-only in UTC. A premise measured "today" is never stale, and expiry lands on the
// same calendar day everywhere rather than depending on the runner's timezone.
const TODAY = new Date().toISOString().slice(0, 10);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

for (const [id, entry] of entries) {
  for (const f of REQUIRED_FIELDS) {
    const v = entry.fields.get(f);
    if (!v) fail.push(`${id} — missing or empty required field \`${f}\`.`);
  }
  const measured = entry.fields.get('measured_on');
  const revalidate = entry.fields.get('revalidate_by');

  if (measured && !isDate(measured))
    fail.push(`${id} — \`measured_on\` is "${measured}", not an ISO YYYY-MM-DD date.`);
  if (revalidate && !isDate(revalidate))
    fail.push(`${id} — \`revalidate_by\` is "${revalidate}", not an ISO YYYY-MM-DD date.`);

  if (isDate(measured) && isDate(revalidate) && revalidate <= measured)
    fail.push(
      `${id} — \`revalidate_by\` (${revalidate}) is not after \`measured_on\` (${measured}); ` +
        'an entry that expires before it was taken can never be satisfied.',
    );

  if (isDate(revalidate) && revalidate < TODAY) {
    fail.push(
      `${id} — EXPIRED. \`revalidate_by\` was ${revalidate}, today is ${TODAY}.\n` +
        `      claim:       ${entry.fields.get('claim') ?? '(missing)'}\n` +
        `      re-measure:  ${entry.fields.get('measure_with') ?? '(missing)'}\n` +
        `      Re-run that, then update \`measured_on\` and \`revalidate_by\` — or delete the entry\n` +
        '      AND the code that leans on it. Pushing the date without re-measuring is the exact\n' +
        '      unenforced-human-obligation this register replaced.',
    );
  }
}

// ── walk the tree once ──────────────────────────────────────────────────────
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  '.turbo',
  'coverage',
  'build',
  // Vendored third-party source. `apps/intent-engine/.venv/.../modal/partial_function.py`
  // carries "as of 2025-02-04" and is not ours to annotate. [FOLLOW-982]
  '.venv',
  'site-packages',
  '__pycache__',
]);
const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|md|mts|yml|yaml|py|sh|sql|txt)$/;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, out);
    else if (TEXT_EXT.test(name)) out.push(p);
  }
  return out;
}

const citationFiles = CITATION_ROOTS.flatMap((r) => walk(join(ROOT, r)));

/** id -> [file:line] citations, excluding the register itself. */
const cited = new Map();
/** shipped-source lines carrying a dated measurement with no MP citation. */
const restated = [];

const shippedPrefixes = SHIPPED_SOURCE.map((d) => join(ROOT, d) + '/');

for (const file of citationFiles) {
  const rel = relative(ROOT, file);
  if (rel === REGISTER_REL) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const hasCite = text.includes('MP-');
  const isShipped = shippedPrefixes.some((p) => file.startsWith(p));
  if (!hasCite && !isShipped) continue;

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const m of line.matchAll(CITE)) {
      if (!cited.has(m[1])) cited.set(m[1], []);
      cited.get(m[1]).push(`${rel}:${i + 1}`);
    }

    // Assertion 5 — shipped source only. The register, runbooks, retros and backlog logs are
    // ALLOWED to carry dated measurements: the register is where they belong, and the logs are
    // dated history whose whole value is that it is not rewritten to satisfy a gate.
    //
    // Scanned over a TWO-LINE window with comment markers stripped, because prose wraps and the
    // claim does not care where the line ends. `diagnostics/first-party-tenant/route.ts` carries
    // "…(`Encrypted`, 17d ago as of\n *   2026-08-12)" — a live-environment measurement split
    // across a line break, which a line-at-a-time detector cannot see at ANY vocabulary. The
    // citation may sit on either line of the window, since a wrapped claim may be tagged at
    // either end. [FOLLOW-982]
    if (isShipped) {
      const strip = (t) => (t ?? '').replace(/^\s*(\*|\/\/|#)\s?/, ' ');
      const window = strip(line) + ' ' + strip(lines[i + 1]);
      if (DATED_MEASUREMENT.test(window) && !/\[MP-\d{3}\]/.test(window)) {
        restated.push(`${rel}:${i + 1}  ${line.trim().slice(0, 120)}`);
      }
    }
  }
}

// ── 3: no dangling citations ────────────────────────────────────────────────
for (const [id, sites] of cited) {
  if (!entries.has(id)) {
    fail.push(
      `${id} is cited but not registered — ${sites.slice(0, 3).join(', ')}` +
        (sites.length > 3 ? ` (+${sites.length - 3} more)` : '') +
        `. Add it to ${REGISTER_REL} or fix the citation.`,
    );
  }
}

// Shared by assertions 6 and 8 — both read file paths out of `relied_on_by`.
const PATH_TOKEN = /`([A-Za-z0-9_./-]+\.(?:ts|tsx|mjs|js|py|md|sh|yml|yaml|toml))`/g;

// ── 8: a `measure_with` that quotes a RESPONSE SHAPE pins those field names ─
// MP-002's `measure_with` tells an operator to expect
// `{"env_status":…,"resolves_to_known_tenant":…,"tenant_status":…,"tenant_lookup_error":…}`, and
// two runbooks repeat the call. Nothing asserted those names against the route that emits them,
// so a rename would break an operator instruction SILENTLY — the instruction is prose, and prose
// does not fail a build. [FOLLOW-983 AC(3) / RETRO-270 §5c]
//
// Any JSON key quoted in a `measure_with` must appear in at least one `relied_on_by` file. That
// is deliberately loose about WHICH file: the point is that the name is anchored in source
// somewhere the register can reach, not that we re-implement the route's type.
for (const [id, entry] of entries) {
  const mw = entry.fields.get('measure_with') ?? '';
  const keys = [...mw.matchAll(/"([a-z][a-z0-9_]{2,})"\s*:/g)].map((m) => m[1]);
  if (keys.length === 0) continue;

  const files = [...(entry.fields.get('relied_on_by') ?? '').matchAll(PATH_TOKEN)].map((m) => m[1]);
  const corpus = files
    .map((rel) => {
      try {
        return readFileSync(join(ROOT, rel), 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n');

  for (const key of [...new Set(keys)]) {
    if (!corpus.includes(key)) {
      fail.push(
        `${id} — \`measure_with\` tells an operator to expect the field \`${key}\`, but no file ` +
          'in `relied_on_by` contains that name.\n' +
          '      Either the field was renamed (the operator instruction is now wrong and so is\n' +
          '      every runbook repeating it), or the file that emits it is missing from\n' +
          '      `relied_on_by`. A response shape quoted in an instruction is a contract.',
      );
    }
  }
}

// ── 7: `revalidate_on` must declare whether anything WATCHES it ─────────────
// Every entry names the event that invalidates it sooner than its date. Nothing in the repo
// watched seven of eight, and the register did not say so — the trigger read as an assurance
// when it was an unenforced human obligation, which is what this register was filed to replace.
// `watch_status` makes the honesty mandatory rather than optional. [FOLLOW-983 AC(2)]
//
// Today: 1 watched, 1 watchable-but-unwatched, 6 out-of-repo-only. The last group is not a
// failure — CI has no read path to Vercel, Doppler, prod Postgres, DNS or a separate codebase —
// but it must be STATED, so nobody reads a `revalidate_on` as a tripwire that will fire.
const WATCH_STATES = new Set(['watched', 'watchable-but-unwatched', 'out-of-repo-only']);

for (const [id, entry] of entries) {
  const raw = entry.fields.get('watch_status') ?? '';
  const state = raw.split(/\s+—\s+/)[0]?.trim();
  if (!WATCH_STATES.has(state)) {
    fail.push(
      `${id} — \`watch_status\` is "${state || '(missing)'}", not one of ` +
        `${[...WATCH_STATES].join(' | ')}.\n` +
        '      Say which: does a repo-side gate fire on this trigger (`watched`), could one\n' +
        '      (`watchable-but-unwatched`, and name it), or is the event invisible from this repo\n' +
        '      (`out-of-repo-only`)? An unclassified trigger reads as a tripwire that will fire.',
    );
    continue;
  }
  if (!/\s—\s\S/.test(raw)) {
    fail.push(
      `${id} — \`watch_status: ${state}\` carries no reason. The classification is a CLAIM ` +
        'about what the repo can see; state it so it can be argued with.',
    );
  }
  if (state === 'watchable-but-unwatched' && !/gate|workflow|job|probe|check/i.test(raw)) {
    fail.push(
      `${id} — \`watchable-but-unwatched\` must NAME the gate that would do it, otherwise it is ` +
        'indistinguishable from `out-of-repo-only` and nobody can act on it.',
    );
  }
}

// ── 6: the `relied_on_by` DIRECTION — register → source ────────────────────
// Assertions 3 and 4 both run source → register: a citation must resolve, an entry must be
// cited SOMEWHERE. Neither reads `relied_on_by`, whose stated purpose is "what breaks — file
// paths, not vibes". So the field was a producer with no consumer: three of its paths named
// files that never cite the entry, and nothing noticed. [FOLLOW-983 AC(1)]
//
// Runbooks are correctly OUTSIDE assertion 5's scope — a measurement may legitimately live in a
// runbook — which is exactly why this direction has to be the check that covers them.
//
// Escape hatch, deliberately narrow: `no-cite:<path> — <reason>` inside the entry, for a path
// that genuinely cannot carry the token. It must state a reason, so the exemption is arguable
// rather than silent.

for (const [id, entry] of entries) {
  const value = entry.fields.get('relied_on_by') ?? '';
  const exempt = new Set(
    [...value.matchAll(/no-cite:\s*([A-Za-z0-9_./-]+)\s+—/g)].map((m) => m[1]),
  );
  const paths = [...value.matchAll(PATH_TOKEN)].map((m) => m[1]);

  if (paths.length === 0) {
    fail.push(
      `${id} — \`relied_on_by\` names no file path at all. The field's whole purpose is ` +
        '"what breaks — file paths, not vibes"; prose there is not checkable.',
    );
    continue;
  }

  for (const rel of paths) {
    if (exempt.has(rel)) continue;
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) {
      fail.push(
        `${id} — \`relied_on_by\` names \`${rel}\`, which does NOT exist. Either the file moved ` +
          '(update the entry) or the dependency is gone (delete it) — a path that resolves to ' +
          'nothing cannot tell anyone what breaks.',
      );
      continue;
    }
    let body = '';
    try {
      body = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (!body.includes(id)) {
      fail.push(
        `${id} — \`relied_on_by\` names \`${rel}\`, but that file never mentions ${id}.\n` +
          `      The dependency is asserted in ONE direction only: the register points at the file\n` +
          '      and the file has no idea. Cite it there, or add\n' +
          `      \`no-cite:${rel} — <reason>\` to this entry if citing is genuinely impossible.`,
      );
    }
  }
}

// ── 4: no dead entries ──────────────────────────────────────────────────────
for (const id of entries.keys()) {
  if (!cited.has(id)) {
    fail.push(
      `${id} is registered but cited NOWHERE. A premise nothing leans on is not a premise — ` +
        'cite it from the code or runbook that depends on it, or delete the entry.',
    );
  }
}

// ── 5: measurements restated in shipped source ──────────────────────────────
if (restated.length > 0) {
  fail.push(
    'a dated measurement is written into shipped source without citing a registered premise:\n' +
      restated.map((r) => `      ${r}`).join('\n') +
      `\n      Move the measurement into ${REGISTER_REL} and cite it as [MP-NNN] here.\n` +
      '      Shipped source may CITE a premise; it may not RESTATE one — a live-environment claim\n' +
      '      in a comment has no owner, no expiry and no reader.',
  );
}

// ── verdict ─────────────────────────────────────────────────────────────────
if (fail.length > 0) {
  console.error(`FAIL — ${fail.length} problem(s) with the measured-premise register.\n`);
  for (const f of fail) console.error(`  - ${f}`);
  console.error(
    `\nSee ${REGISTER_REL} for the format and for why this is a hard gate rather than a warning.`,
  );
  process.exit(1);
}

const totalCitations = [...cited.values()].reduce((n, s) => n + s.length, 0);
console.log(
  `OK — ${entries.size} measured premise(s), all fields present, none expired ` +
    `(today ${TODAY}); ${totalCitations} citation(s) across the repo, none dangling, none dead; ` +
    'no dated measurement restated in shipped source.',
);
console.log(
  'NOTE: this gate verifies BOOKKEEPING about measurements, never the measurements themselves — ' +
    'CI has no read path to prod. Green here is not evidence that any premise still holds.',
);
