#!/usr/bin/env node
/**
 * FOLLOW-945 AC(2) — every ticket `status:` must be a word `docs/TICKET_FORMAT.md` defines.
 *
 * ## Why
 *
 * `MERGED_NOT_DEPLOYED` exists precisely because two PRs once closed `DONE` on identical
 * un-deployed surfaces. But nothing validated statuses against the vocabulary, so the status was
 * available to anyone who remembered it and invisible to anyone who did not — and an invented
 * status (or a typo) read as a real state forever after.
 *
 * The vocabulary is PARSED from `TICKET_FORMAT.md`, never duplicated here. A hardcoded copy would
 * be a second source of truth that drifts silently — the failure this file exists to prevent.
 *
 * ## Scope, and why it is what it is (stated, not silent — Rule AU / Rule AS)
 *
 * Checked: every `.md` under `backlog/sprint-N` directories — real ticket files, where
 * `status:` is the front-matter FIELD
 * that `TICKET_FORMAT.md` §status defines.
 *
 * NOT checked, deliberately:
 *   - `backlog/QUEUE.md`, `FOLLOW_UPS.md`, `RETROSPECTIVES.md`, `ESCALATIONS.md`. These are
 *     append-only NARRATIVE logs. They carry their own lifecycle words for their own artifacts
 *     (`OPEN`/`RESOLVED` for escalations, `PROMOTED`/`FOLDED_INTO_FOLLOW` for stubs) and they
 *     record what PAST sessions wrote — including statuses like `CODE_COMPLETE_OPERATOR_PENDING`
 *     that predate `MERGED_NOT_DEPLOYED`. Forcing the ticket vocabulary onto them would require
 *     rewriting dated records to satisfy a gate, which is the wrong direction of causation.
 *   - Prose. A naive `grep "status:"` over `backlog/` also matches sentences — `status: I ran`,
 *     `status: N` — which is exactly why the match below is ANCHORED to line start.
 *
 * If ticket files ever stop being where statuses live, this gate goes RED rather than wrong: the
 * "found zero" guard below fails instead of passing vacuously.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const FORMAT = join(ROOT, 'docs/TICKET_FORMAT.md');
const BACKLOG = join(ROOT, 'backlog');

// ── vocabulary, parsed from the spec ────────────────────────────────────────
const formatText = readFileSync(FORMAT, 'utf8');
const section = /###\s*`?status`?\s*\n([\s\S]*?)(?=\n###\s)/.exec(formatText);
if (!section) {
  console.error('FAIL — could not find the "### status" section in docs/TICKET_FORMAT.md.');
  console.error('The vocabulary is parsed, never hardcoded; if the heading moved, fix this gate.');
  process.exit(1);
}
const VOCAB = new Set([...section[1].matchAll(/^\s*-\s*\*\*([A-Z_]+)\*\*/gm)].map((m) => m[1]));
if (VOCAB.size === 0) {
  console.error(
    'FAIL — the "### status" section parsed to ZERO statuses; the gate would pass vacuously.',
  );
  process.exit(1);
}

// ── every ticket file ───────────────────────────────────────────────────────
function ticketFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((e) => {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) return ticketFiles(full);
    return e.endsWith('.md') ? [full] : [];
  });
}
const sprints = existsSync(BACKLOG)
  ? readdirSync(BACKLOG).filter(
      (d) => d.startsWith('sprint-') && statSync(join(BACKLOG, d)).isDirectory(),
    )
  : [];
const files = sprints.flatMap((d) => ticketFiles(join(BACKLOG, d)));

const bad = [];
let seen = 0;
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    // ANCHORED: a front-matter field, not a word inside a sentence.
    const m = /^status:\s*`?([A-Za-z_]+)`?\s*$/.exec(line);
    if (!m) return;
    seen += 1;
    if (!VOCAB.has(m[1])) bad.push(`${f.replace(ROOT + '/', '')}:${i + 1} — status: ${m[1]}`);
  });
}

if (seen === 0) {
  console.error('FAIL — scanned every backlog/sprint-*/ ticket and found ZERO `status:` fields.');
  console.error(
    'Either the ticket shape changed or the scan is broken. A gate that checks nothing',
  );
  console.error(
    'must go red, not green (it would otherwise pass forever while enforcing nothing).',
  );
  process.exit(1);
}

if (bad.length) {
  console.error(
    `FAIL — ${bad.length} ticket status(es) outside the vocabulary in docs/TICKET_FORMAT.md:\n`,
  );
  for (const b of bad) console.error(`  - ${b}`);
  console.error(`\nAllowed: ${[...VOCAB].sort().join(', ')}`);
  console.error('Add the status to TICKET_FORMAT.md §status if it is real, or correct the ticket.');
  process.exit(1);
}
console.log(
  `OK — ${seen} ticket status(es) across ${files.length} file(s); all within the ${VOCAB.size}-word vocabulary.`,
);
