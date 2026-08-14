/**
 * FOLLOW-937 — every named Sentry signal in this Worker must be REGISTERED, and its delivery
 * status stated rather than assumed.
 *
 * **Why a register and not a fix for one signal.** `schema_rejected` (FOLLOW-931) was filed as a
 * producer-only alarm. It is not the first: Rule AJ was promoted for
 * `first_party_tenant_id_malformed`, produced 260 lines above it **in this same file**, and that
 * instance is still open as FOLLOW-693. A promoted rule did not prevent its next instance in its
 * own file — so the answer cannot be a fifth ticket about a fifth signal.
 *
 * **WIDENED 2026-08-12 (FOLLOW-944).** The previous detector matched ONLY
 * `captureMessage('name', …)` while the header claimed "every named alarm this Worker raises".
 * Measured: **15** `captureException` sites, of which **9 carry a named alarm as a literal**
 * (`new Error('name')` / `` new Error(`name: …`) ``) across **8 distinct names** — every one of
 * them invisible to the gate that existed to make silent additions impossible. The header was
 * broader than the assertion, which is the failure the register itself exists to prevent.
 *
 * **What this gate actually asserts** — deliberately NOT "the signal is delivered", which no test
 * can know:
 *   1. every `captureMessage('name', …)` AND every `captureException(new Error('name' | `name: …`))`
 *      in the Worker source appears in `REGISTER`;
 *   2. every `REGISTER` entry still has a producer (no stale rows);
 *   3. every `REGISTER` entry is named in the deploy runbook, so an operator reading the runbook
 *      sees the same list a developer sees;
 *   4. the runbook carries a DATED environment observation and the command that produced it —
 *      not a prose claim about state (AC(4); see the delivery note below).
 *
 * **STATED RESIDUAL (the header must not out-run the assertion again).** A signal introduced as
 * `captureMessage(SOME_CONST, …)` or with a template-literal name would still evade detection.
 * The scan below CANNOT close this gap — `producedSignals` matches `captureMessage('…')` on a
 * single-quoted literal, so the one shape it is blind to is exactly the shape named here. The
 * absence is therefore a grep a reader re-runs, not something this file proves:
 *
 * ```
 * grep -rEn "captureMessage\(" apps/ingest/src --include='*.ts' \
 *   | grep -v '\.test\.' | grep -vE "captureMessage\('"
 * ```
 *
 * Empty at the time of writing. A known and currently empty gap, named rather than papered over.
 * If one is ever added, widen the detector — do not widen this comment.
 *
 * **The delivery truth, now OBSERVED rather than asserted (FOLLOW-944 AC(4)).** Until this
 * ticket, "the channel is mute" rested on a markdown substring: set the Cloudflare secret without
 * editing the doc — the overwhelmingly likely order, since they live in different systems — and
 * the gate stayed green while every `consumer: null` below was false. That is a doc assertion
 * standing in for a state, the exact shape Rule AU item 3 forbids.
 *
 * Measured against the real Worker [MP-005] — the register carries the date, the command and the
 * re-measurement trigger, so this transcript cannot quietly outlive the fact it records:
 *
 * ```
 * $ cd apps/ingest && doppler run -- npx wrangler secret list --env production
 * [ { "name": "CLICKHOUSE_PASSWORD" }, { "name": "CLICKHOUSE_USER" },
 *   { "name": "FIRST_PARTY_TENANT_ID" } ]        # SENTRY_DSN_INGEST is ABSENT
 * ```
 *
 * Note `--env production`: the top-level `name` in `wrangler.toml` is `estalara-ingest`, which
 * does NOT exist on the account — a bare `wrangler secret list` answers "This Worker does not
 * exist" and reads like a broken setup rather than a wrong flag.
 *
 * `observability.ts` returns the un-instrumented handler when the DSN is falsy, and
 * `wrangler.toml` declares neither `logpush` nor `tail_consumers`, so every entry below is INERT
 * in production as of that date — no delayed sends, no second path.
 *
 * **This file still cannot verify delivery, and does not pretend to (Rule AU item 3).** What it
 * now enforces is that the runbook carries the PROBE and a DATE, so the next reader re-measures
 * instead of inheriting a claim.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const INGEST_SRC = join(__dirname);
const RUNBOOK = join(__dirname, '../../../docs/runbooks/INGEST_WORKER_DEPLOY.md');

interface Signal {
  /** The literal passed to `Sentry.captureMessage`. */
  name: string;
  /** What a reader should conclude when it fires. */
  meaning: string;
  /**
   * Whether anything CONSUMES it — an alert rule, a dashboard, a runbook procedure.
   * `null` means nothing does, which is the honest answer for all of these today.
   */
  consumer: string | null;
}

const REGISTER: Signal[] = [
  {
    name: 'first_party_tenant_id_malformed',
    meaning: 'FIRST_PARTY_TENANT_ID is set but unparseable — the origin gate is degrading.',
    consumer: null, // FOLLOW-693, still open — the instance that PROMOTED Rule AJ.
  },
  {
    name: 'origin_policy_unconfigured',
    meaning: 'A non-first-party tenant has no origin policy; requests are refused fail-closed.',
    consumer: null,
  },
  {
    name: 'origin_gate_rejected',
    meaning: 'A browser Origin was refused for the resolved tenant.',
    consumer: null,
  },
  {
    name: 'consent_gate_rejected',
    meaning: 'A profiling-class event was dropped because consent_state grants no lawful basis.',
    consumer: null,
  },
  {
    name: 'schema_rejected',
    meaning:
      'A batch carried events that failed EventSchema. `has_consent_event` marks the compliance-relevant case: a visitor decision was discarded.',
    consumer: null, // FOLLOW-937 — the ticket this register discharges.
  },

  // ── Raised as `captureException(new Error('name'))`. Invisible to this gate until
  //    FOLLOW-944 widened the detector; all eight were already shipping. ──────────────
  {
    name: 'clickhouse_push_failed_post_ack',
    meaning:
      'ClickHouse rejected or dropped a batch AFTER the client was ACKed — the event is lost and the client will never retry it.',
    consumer: null,
  },
  {
    name: 'intent_snapshot_clickhouse_rejected',
    meaning: 'An intent snapshot was refused by ClickHouse; the session projection is incomplete.',
    consumer: null,
  },
  {
    name: 'intent_snapshot_clickhouse_write_failed',
    meaning: 'The intent-snapshot ClickHouse write threw (network/transport) rather than refusing.',
    consumer: null,
  },
  {
    name: 'intent_snapshot_supabase_rejected',
    meaning:
      'Supabase refused the intent-session upsert; the archetype a later request reads may be stale.',
    consumer: null,
  },
  {
    name: 'intent_snapshot_supabase_write_failed',
    meaning: 'The intent-session Supabase upsert threw (network/transport) rather than refusing.',
    consumer: null,
  },
  {
    name: 'events_retry_message_malformed',
    meaning:
      'A queued retry message could not be parsed — the batch it carried cannot be re-driven and is dropped.',
    consumer: null,
  },
  {
    name: 'events_retry_unknown_schema_version',
    meaning:
      'A retry message carried a schema version this Worker does not know — a deploy-order skew between producer and consumer.',
    consumer: null,
  },
  {
    name: 'events_retry_reinsert_failed',
    meaning: 'The retry consumer could not re-insert a batch; this is the END of the retry path.',
    consumer: null,
  },
];

/** Every `.ts` under the Worker source, excluding tests. */
function sourceFiles(dir: string, base = ''): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    const rel = base ? `${base}/${entry}` : entry;
    if (statSync(full).isDirectory()) return sourceFiles(full, rel);
    return entry.endsWith('.ts') && !entry.includes('.test.') ? [rel] : [];
  });
}

/**
 * Signal names actually produced in the Worker source.
 *
 * TWO shapes, because the Worker uses both and the register must see both (FOLLOW-944 AC(1)):
 *   - `captureMessage('name', …)`
 *   - `captureException(new Error('name'))` and `` captureException(new Error(`name: ${detail}`)) ``
 *
 * For the `Error` form the NAME is the leading `snake_case` identifier; anything after a `:` is
 * runtime detail and is deliberately not part of the identity, so `intent_snapshot_clickhouse_
 * rejected: <reason>` registers once rather than once per reason.
 */
function producedSignals(): string[] {
  const names = new Set<string>();
  const patterns = [
    /captureMessage\(\s*'([^']+)'/g,
    /captureException\(\s*new Error\(\s*[`']([a-z0-9_]+)/g,
  ];
  for (const rel of sourceFiles(INGEST_SRC)) {
    const src = readFileSync(join(INGEST_SRC, rel), 'utf8');
    for (const re of patterns) {
      for (const m of src.matchAll(re)) {
        const name = m[1];
        if (name !== undefined) names.add(name);
      }
    }
  }
  return [...names].sort();
}

describe('FOLLOW-937 — ingest Sentry signal register', () => {
  it('every produced signal is registered', () => {
    const registered = new Set(REGISTER.map((s) => s.name));
    const unregistered = producedSignals().filter((n) => !registered.has(n));
    expect(
      unregistered,
      'A new Sentry signal was added with no register entry. State what it means and what — if ' +
        'anything — consumes it. A producer nobody reads is not observability.',
    ).toEqual([]);
  });

  it('every registered signal still has a producer', () => {
    const produced = new Set(producedSignals());
    const stale = REGISTER.map((s) => s.name).filter((n) => !produced.has(n));
    expect(stale, 'the register names a signal nothing produces — delete the row').toEqual([]);
  });

  it('the deploy runbook names every signal, so operator and developer read one list', () => {
    const runbook = readFileSync(RUNBOOK, 'utf8');
    const missing = REGISTER.map((s) => s.name).filter((n) => !runbook.includes(n));
    expect(
      missing,
      'a signal exists that the deploy runbook never mentions — the operator who has to decide ' +
        'whether the channel matters cannot see it',
    ).toEqual([]);
  });

  // ── AC(4): the mute claim must rest on an OBSERVATION, not on prose ──────────────────
  //
  // What was here before asserted `runbook.includes('`SENTRY_DSN_INGEST` is unset in prod')`.
  // That is a doc substring standing in for a state: set the Cloudflare secret without editing
  // the markdown — different systems, so the likely order — and the gate stays green while every
  // `consumer: null` row is false. It could only ever go red when somebody ALREADY knew enough to
  // edit the doc, i.e. exactly when it was no longer needed.
  //
  // A repo test still cannot read a Worker secret (Rule AU item 3). What it CAN do is refuse to
  // let the claim be undated and unreproducible, which is what these two assertions enforce.

  it('the runbook carries the PROBE that observes the channel, not just a claim about it', () => {
    const runbook = readFileSync(RUNBOOK, 'utf8');
    expect(
      runbook.includes('wrangler secret list --env production'),
      'the runbook must carry the exact command that OBSERVES whether SENTRY_DSN_INGEST exists. ' +
        'A sentence asserting the channel is mute is not checkable by the next reader; a command ' +
        'is. Note `--env production` is load-bearing — the bare form targets a Worker name that ' +
        'does not exist on the account and answers "This Worker does not exist".',
    ).toBe(true);
  });

  it('the runbook dates its last observation, so the claim expires instead of being inherited', () => {
    const runbook = readFileSync(RUNBOOK, 'utf8');
    // Requires an explicit "observed <ISO date>" next to the secret-state claim. A date cannot
    // prove the state is CURRENT — nothing in a repo can — but it converts an inherited assertion
    // into a measurement somebody can re-run and compare.
    // Proximity is measured in CHARACTERS, not lines: prettier reflows this runbook, so a
    // line-based window would fail on formatting alone and teach the next reader to weaken
    // the assertion rather than re-measure.
    //
    // [FOLLOW-983] An `[MP-NNN]` CITATION now satisfies this too, and is strictly stronger than an
    // inline stamp. This assertion and the measured-premise register collided head-on: FOLLOW-944
    // requires a date beside the claim; FOLLOW-952 requires shipped prose to CITE a premise rather
    // than restate its measurement. Both are right about their own half, and the register wins on
    // the merits — a bare `observed <date>` carries a date and nothing else, while an MP entry
    // carries the date PLUS an expiry a CI gate reddens on, the command that re-takes it, and a
    // `watch_status` saying whether anything watches its trigger. Accepting the citation is
    // therefore a strengthening, not a relaxation: what it accepts instead is a claim that
    // EXPIRES, which is the property this assertion was written to obtain.
    const WINDOW = 600;
    const near = (index: number) =>
      runbook.slice(Math.max(0, index - WINDOW), index + WINDOW).includes('SENTRY_DSN_INGEST');
    const dated =
      [...runbook.matchAll(/observed (\d{4}-\d{2}-\d{2})/g)].some((m) => near(m.index)) ||
      [...runbook.matchAll(/\[MP-\d{3}\]/g)].some((m) => near(m.index));
    expect(
      dated,
      'the runbook states something about SENTRY_DSN_INGEST with neither an "observed ' +
        '<YYYY-MM-DD>" stamp NOR an [MP-NNN] citation within 600 characters. An undated claim ' +
        'about an environment is the defect ' +
        'FOLLOW-944 AC(4) exists to remove — re-run the probe and record the date with it.',
    ).toBe(true);
  });

  // ── AC(2): negative fixture — the detector must SEE a shape it previously could not ──
  it('detects a named alarm added as captureException(new Error(...)), the shape it used to miss', () => {
    const probe = [
      "Sentry.captureException(new Error('follow944_probe_plain'), { tags: {} });",
      'Sentry.captureException(new Error(`follow944_probe_template: ${detail}`), { tags: {} });',
      "Sentry.captureMessage('follow944_probe_message', { level: 'warning' });",
    ].join('\n');

    const found = new Set<string>();
    for (const re of [
      /captureMessage\(\s*'([^']+)'/g,
      /captureException\(\s*new Error\(\s*[`']([a-z0-9_]+)/g,
    ]) {
      for (const m of probe.matchAll(re)) if (m[1]) found.add(m[1]);
    }

    // The two Error shapes are the regression this ticket fixes; the third is the pre-existing
    // shape, asserted so a future edit cannot trade one for the other.
    expect([...found].sort()).toEqual([
      'follow944_probe_message',
      'follow944_probe_plain',
      'follow944_probe_template',
    ]);
    // …and the template form must register under its NAME, never with the runtime detail glued on.
    expect([...found]).not.toContain('follow944_probe_template: ${detail}');
  });
});
