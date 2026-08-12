#!/usr/bin/env node
/**
 * FOLLOW-945 — the deployment-surface register must be DERIVED-AND-CHECKED, not prose.
 *
 * ## Why this exists
 *
 * `docs/runbooks/DEPLOYMENT_SURFACES.md` is the file a reader consults to answer "did my merge
 * actually ship?". Until this gate, exactly ONE line in the whole estate referenced it —
 * `scripts/check-gate-exit-codes.sh:79`, and it referenced it to record that it does **NOT** route
 * on it. So nothing checked that a surface the register calls manual-deploy still has no workflow,
 * and nothing noticed when a new app failed to appear in it at all.
 *
 * **Rule AP** already required this: _"a gate's known-residual-gaps list MUST be a MACHINE-CHECKED
 * register the gate itself executes, not prose."_ This is a compliance failure against an adequate
 * rule, so it is a gate, not a rule amendment.
 *
 * ## What it asserts
 *
 *   1. every `apps/*` directory appears as a row in the register — a new app cannot ship
 *      undocumented;
 *   2. the row's **automatic on merge?** claim AGREES with the workflow set derived from
 *      `.github/workflows/`. Naming a surface is not enough (FOLLOW-945 AC(4) / Rule AU): the
 *      CLAIM about it is what gets checked.
 *
 * A surface counts as automatic when some workflow (a) triggers on push to `main`, (b) has no
 * `paths:` filter or one covering that app, and (c) contains a deploy command naming that app.
 *
 * ## What it CANNOT assert, stated rather than implied
 *
 * `apps/control-plane` ships via Vercel's own git integration, which lives outside this repo — no
 * workflow will ever prove it. It is handled as a NAMED exception: the gate asserts the register
 * says so in those words, and does not pretend to have verified the deploy. That is the honest
 * boundary (Rule AU item 3); silently scoring it "automatic" would be the gate lying about its
 * own reach.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const REGISTER = join(ROOT, 'docs/runbooks/DEPLOYMENT_SURFACES.md');
const WORKFLOWS = join(ROOT, '.github/workflows');
const APPS = join(ROOT, 'apps');

/** Surfaces whose deploy trigger provably lives outside this repo. Value = required register text. */
const OUT_OF_REPO_TRIGGER = {
  'apps/control-plane': 'Vercel merge-triggered deploy',
};

const fail = [];

// ── the register ────────────────────────────────────────────────────────────
const registerText = readFileSync(REGISTER, 'utf8');
/** surface -> { ships, automatic: true|false } */
const rows = new Map();
for (const line of registerText.split('\n')) {
  const m = /^\|([^|]*)\|([^|]*)\|([^|]*)\|/.exec(line);
  if (!m || /^[-\s]+$/.test(m[2])) continue;
  // The surface cell carries decoration the identity does not: backticks and a trailing
  // parenthetical (e.g. "`apps/ingest` (Worker)"). Normalise to the bare identifier so the
  // register stays readable without the gate going blind on its prose.
  const surface = m[1]
    .replace(/`/g, '')
    .replace(/\s*\(.*$/, '')
    .trim();
  if (!surface || surface === 'surface') continue;
  const auto = m[3].toLowerCase();
  if (!/\byes\b|\bno\b/.test(auto)) continue;
  rows.set(surface, { ships: m[2].trim(), automatic: /\byes\b/.test(auto) });
}
if (rows.size === 0)
  fail.push(
    'parsed ZERO rows from the register — the table shape changed and this gate went blind',
  );

// ── the workflows ───────────────────────────────────────────────────────────
const workflows = existsSync(WORKFLOWS)
  ? readdirSync(WORKFLOWS).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  : [];

/** Does this workflow deploy `app` on a push to main? */
function deploysOnMerge(wfText, app) {
  const onPushMain = /on:[\s\S]{0,400}?push:[\s\S]{0,400}?branches:[\s\S]{0,120}?-\s*main/.test(
    wfText,
  );
  if (!onPushMain) return false;
  const pathsBlock = /paths:\n((?:\s+-\s.*\n)+)/.exec(wfText);
  if (pathsBlock && !pathsBlock[1].includes(`apps/${app}/`)) return false;
  return new RegExp(`(modal deploy|wrangler deploy|vercel deploy)[^\\n]*apps/${app}[/\\s]`).test(
    wfText,
  );
}

// ── assertions ──────────────────────────────────────────────────────────────
for (const app of readdirSync(APPS).filter((d) => statSync(join(APPS, d)).isDirectory())) {
  const surface = `apps/${app}`;
  const row = rows.get(surface);
  if (!row) {
    fail.push(
      `${surface} exists in apps/ but has NO row in the register — a new app cannot ship undocumented`,
    );
    continue;
  }
  const claim = row;

  if (surface in OUT_OF_REPO_TRIGGER) {
    const required = OUT_OF_REPO_TRIGGER[surface];
    if (!claim.ships.includes(required)) {
      fail.push(
        `${surface}: its deploy trigger lives outside this repo, so the register must say ` +
          `"${required}" verbatim (this gate cannot verify the deploy itself). Found: "${claim.ships}"`,
      );
    }
    continue;
  }

  const derived = workflows.some((f) =>
    deploysOnMerge(readFileSync(join(WORKFLOWS, f), 'utf8'), app),
  );
  if (derived !== claim.automatic) {
    fail.push(
      `${surface}: register says "automatic on merge = ${claim.automatic ? 'yes' : 'NO'}" but the ` +
        `workflow set says ${derived ? 'yes' : 'NO'}. Either a deploy workflow was added/removed ` +
        `without updating the register, or the register's claim was never true. ` +
        `Naming the surface is not enough — this gate checks the CLAIM (Rule AU).`,
    );
  }
}

if (fail.length) {
  console.error('FAIL — deployment-surface register disagrees with the repo:\n');
  for (const f of fail) console.error(`  - ${f}`);
  console.error('\nRegister: docs/runbooks/DEPLOYMENT_SURFACES.md');
  process.exit(1);
}
console.log(
  `OK — ${rows.size} register rows; every apps/* surface present and its merge-trigger claim matches the workflow set.`,
);
