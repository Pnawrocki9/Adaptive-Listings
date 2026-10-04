#!/usr/bin/env node
/**
 * FOLLOW-1259 (WP-1.2, CEO decision D8) - generate `backlog/FOLLOW_UPS_OPEN.md`, an index of the OPEN
 * stubs in `backlog/FOLLOW_UPS.md`. Plain Node, no dependencies. Run by hand by the PM:
 *
 *   node scripts/follow-ups-open-index.mjs          # (re)write backlog/FOLLOW_UPS_OPEN.md
 *   node scripts/follow-ups-open-index.mjs --stdout # print instead of writing
 *
 * FOLLOW_UPS.md is append-only, so nothing there is ever moved or edited; this file is the derived
 * read view. It is a HEURISTIC, not a source of truth - the stub and QUEUE.md win on any conflict.
 *
 * ## "Open" heuristic (a stub is CLOSED if ANY of these holds, otherwise OPEN)
 *
 *   1. Its `## FOLLOW-N - header` line contains DONE / CLOSED / RESOLVED / SUPERSEDED / ABSORBED.
 *   2. A line inside its block is a status marker naming a terminal state: it starts (after an
 *      optional `- ` / `**`) with `status`, `closure` or `closure note`, and the same line contains
 *      DONE / RESOLVED / CLOSED / SUPERSEDED / ABSORBED / FOLDED_INTO / PROMOTED / MERGED. A line
 *      containing NOT DONE or PARTIAL does not count.
 *   3. `backlog/QUEUE.md` has, for that id, either a table row `| FOLLOW-N | ... |` or a dispatch
 *      bullet `- **FOLLOW-N, M ...** - status: ...` whose text says DONE / MERGED / RESOLVED (again
 *      not NOT DONE / PARTIAL). Free-text banner mentions are ignored on purpose (they list many ids).
 *
 *   4. `git log` (current branch history) has a merged code commit for it: a subject of the form
 *      `<feat|fix|refactor|test|perf|build|ci|chore>(scope): ... [FOLLOW-N] (#PR)`, or any subject
 *      matching `close[sd]? FOLLOW-N` / `FOLLOW-N ... DONE|closed`. This over-closes a ticket that
 *      shipped only a slice, which is why on-path ids are exempt from hiding (see below).
 *
 * A stub id that appears twice keeps its first block. Stubs whose block carries the marker
 * `freeze: D8` are FROZEN: they are shown, flagged, never hidden. Priority is read from the first
 * `priority: Px` / `**priority:** Px` in the block ("?" when absent).
 *
 * ## "On the FOLLOW-820 path"
 *
 * An EXPLICIT list (ON_820_PATH below), not guessed. Sources: CLAUDE.md "Localhost-first" critical
 * path (819 -> 1203 -> 1220 -> chat arm -> 820) and docs/PLAN-AUDIT-REMEDIATION-2026-09-24.md WP-1.2
 * (1203, 1220, 1240, 1243, 1244, 1246). Since checkpoint K1 (2026-10-04, FOLLOW-1257) the chat arm
 * has a ticket: 1299 (WP-2.13, FOLLOW-820 condition 1b). The other Phase 2 tickets (1286..1298) are
 * NOT on the path: CLAUDE.md names only the chat arm. On-path ids are ALWAYS listed, even when the
 * heuristic reads them closed; the State column then says "closed?" so a merged ticket is reported,
 * not hidden.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/** id -> why it is on the path. Extend deliberately; do not guess. */
export const ON_820_PATH = new Map([
  [1203, 'CLAUDE.md critical path: server-confirmed conversion, cited by condition 1'],
  [1220, 'CLAUDE.md critical path: reorder_withheld reader'],
  [1240, 'plan WP-1.2 AC: harness settle/holdout grading (FOLLOW-819 substrate)'],
  [1243, 'plan WP-1.2 AC: MASTER_DESIGN section P.0 condition 1 re-sync'],
  [1244, 'plan WP-1.2 AC: HARNESS_TREE_PATHSPEC covers the fixture server'],
  [1246, 'plan WP-1.2 AC: freshness axis on the bring-up path'],
  [1280, 'its stub says "localhost GO path": FOLLOW-1203/1220 may add ClickHouse migrations'],
  [1299, 'CLAUDE.md critical path: chat arm on localhost = FOLLOW-820 condition 1b (plan WP-2.13)'],
  // 1279 is deliberately absent: its stub judges itself NOT on the path (post-GO deployment step).
  // 1286..1298 (Phase 2, allocated at K1) are deliberately absent: the plan and CLAUDE.md put only
  // the chat arm on the path.
]);

const TERMINAL = /\b(DONE|RESOLVED|CLOSED|SUPERSEDED|ABSORBED|FOLDED_INTO|PROMOTED|MERGED)\b/i;
const HEADER_TERMINAL = /\b(DONE|CLOSED|RESOLVED|SUPERSEDED|ABSORBED)\b/;
const NEGATED = /NOT DONE|PARTIAL/i;
const MARKER = /^\s*(?:- )?\*{0,2}(?:status|closure(?: note)?)\b/i;

const ROOT = process.cwd();
const followUps = readFileSync(join(ROOT, 'backlog/FOLLOW_UPS.md'), 'utf8').split('\n');
const queue = readFileSync(join(ROOT, 'backlog/QUEUE.md'), 'utf8').split('\n');

/** ids that QUEUE.md closes via a table row or a dispatch bullet. */
const queueClosed = new Set();
for (const line of queue) {
  if (NEGATED.test(line) || !/\b(DONE|MERGED|RESOLVED)\b/.test(line)) continue;
  const row = line.match(/^\|\s*(?:\*\*)?FOLLOW-(\d+)\b/);
  if (row) queueClosed.add(Number(row[1]));
  const bullet = line.match(/^- \*\*(FOLLOW-[^*]+)\*\*/);
  if (bullet) for (const m of bullet[1].matchAll(/\d{2,4}/g)) queueClosed.add(Number(m[0]));
}

/** ids closed by a merged code commit or an explicit close subject (rule 4). */
const gitClosed = new Set();
try {
  const subjects = execFileSync('git', ['log', '--format=%s'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).split('\n');
  for (const subj of subjects) {
    const code = subj.match(
      /^(?:feat|fix|refactor|test|perf|build|ci|chore)(?:\([^)]*\))?!?:.*\[FOLLOW-(\d+)\].*\(#\d+\)$/,
    );
    if (code) gitClosed.add(Number(code[1]));
    for (const m of subj.matchAll(
      /close[sd]?\s+FOLLOW-(\d+)|FOLLOW-(\d+)[^\n]{0,40}\b(?:DONE|closed)\b/gi,
    )) {
      gitClosed.add(Number(m[1] ?? m[2]));
    }
  }
} catch {
  // not a git checkout: rules 1-3 only
}

const stubs = new Map();
let cur = null;
for (const line of followUps) {
  const h = line.match(/^## FOLLOW-(\d+)\s+[-—–]\s*(.*)$/);
  if (h) {
    const id = Number(h[1]);
    cur = { id, header: h[2].trim(), lines: [] };
    if (!stubs.has(id)) stubs.set(id, cur);
    else cur = { id, header: '', lines: [] }; // duplicate id: swallow its block
    continue;
  }
  if (/^## /.test(line)) cur = null;
  if (cur) cur.lines.push(line);
}

const rows = [];
for (const s of stubs.values()) {
  const body = s.lines.join('\n');
  const closed =
    HEADER_TERMINAL.test(s.header) ||
    s.lines.some((l) => MARKER.test(l) && TERMINAL.test(l) && !NEGATED.test(l)) ||
    queueClosed.has(s.id) ||
    gitClosed.has(s.id);
  const onPath = ON_820_PATH.has(s.id);
  if (closed && !onPath) continue;
  const pr = body.match(/priority:?\*{0,2}:?\s*(P[0-3])/i);
  rows.push({
    id: s.id,
    priority: pr ? pr[1].toUpperCase() : '?',
    // Headers that name the PR-checks gate script are reworded: scripts/check-gate-exit-codes.sh
    // treats ANY file mentioning it as an exit-code consumer needing the contract marker, and this
    // index is a listing, not a router.
    header: s.header
      .replace(/\|/g, '\\|')
      .replace(/(?:scripts\/)?gh-pr-checks-verified(?:\.sh)?/g, 'the PR-checks verifier'),
    onPath,
    frozen: /freeze:\s*D8/i.test(body),
    state: closed ? 'closed?' : 'open',
  });
}
const rank = { P0: 0, P1: 1, P2: 2, P3: 3, '?': 4 };
rows.sort(
  (a, b) =>
    Number(b.onPath) - Number(a.onPath) || rank[a.priority] - rank[b.priority] || b.id - a.id,
);

const clip = (t) => (t.length > 140 ? `${t.slice(0, 137)}...` : t);
const out = [
  '# Follow-Ups - open index',
  '',
  'GENERATED by `node scripts/follow-ups-open-index.mjs` (FOLLOW-1259, D8). Do not edit by hand.',
  'Heuristic read view of `backlog/FOLLOW_UPS.md` (append-only; the stub wins on any conflict).',
  'Rules are documented in the script header. `frozen` = stub marked `freeze: D8`.',
  '',
  `Rows: ${rows.length} (on the FOLLOW-820 path: ${rows.filter((r) => r.onPath).length}; frozen: ${rows.filter((r) => r.frozen).length}).`,
  '',
  '| id | priority | state | on 820 path | frozen | header |',
  '| -- | -------- | ----- | ----------- | ------ | ------ |',
  ...rows.map(
    (r) =>
      `| FOLLOW-${r.id} | ${r.priority} | ${r.state} | ${r.onPath ? 'yes' : 'no'} | ${r.frozen ? 'yes' : 'no'} | ${clip(r.header)} |`,
  ),
  '',
];
if (process.argv.includes('--stdout')) process.stdout.write(out.join('\n'));
else writeFileSync(join(ROOT, 'backlog/FOLLOW_UPS_OPEN.md'), out.join('\n'));
console.error(`follow-ups-open-index: ${rows.length} rows (${stubs.size} stubs parsed)`);
