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
  'relied_on_by',
  'falsified_means',
];

/** Shipped source — where a measurement must never be restated (assertion 5). */
const SHIPPED_SOURCE = ['apps', 'packages'];
/** Where a citation counts as a citation (assertions 3 and 4). */
const CITATION_ROOTS = ['apps', 'packages', 'docs', 'scripts', '.github'];

const CITE = /\[(MP-\d{3})\]/g;
const DATED_MEASUREMENT =
  /\b(verified|measured|re-read|probed|re-measured|answered|live-probed|sampled|observed)\s+(\d{4}-\d{2}-\d{2})/i;

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
  if (field) current.fields.set(field[1], field[2].trim());
}

if (entries.size === 0) {
  console.error(`FAIL — ${REGISTER_REL} parsed to ZERO entries; the gate would pass vacuously.`);
  console.error('Either the register is empty or its "## MP-NNN — <claim>" heading shape changed.');
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
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '.turbo', 'coverage', 'build']);
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
    if (isShipped && DATED_MEASUREMENT.test(line) && !/\[MP-\d{3}\]/.test(line)) {
      restated.push(`${rel}:${i + 1}  ${line.trim().slice(0, 120)}`);
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
