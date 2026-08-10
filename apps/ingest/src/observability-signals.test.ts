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
 * **What this gate actually asserts** — deliberately NOT "the signal is delivered", which no test
 * can know:
 *   1. every `captureMessage('name', …)` in the Worker source appears in `REGISTER`;
 *   2. every `REGISTER` entry still has a producer (no stale rows);
 *   3. every `REGISTER` entry is named in the deploy runbook, so an operator reading the runbook
 *      sees the same list a developer sees.
 *
 * So a sixth signal cannot be added silently, and the honest statement *"this channel is mute in
 * prod"* cannot quietly stop being true for one of them without the runbook saying so.
 *
 * **The delivery truth, recorded once:** `SENTRY_DSN_INGEST` is unset in prod
 * (`docs/runbooks/INGEST_WORKER_DEPLOY.md`), `observability.ts` returns the un-instrumented
 * handler when the DSN is falsy, and `wrangler.toml` declares neither `logpush` nor
 * `tail_consumers`. Every entry below is therefore INERT in production today. That is FOLLOW-937
 * AC(2): the acceptable answer is to say so, in the code and the runbook. What is not acceptable
 * is silence.
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

/** Signal names actually produced in the Worker source. */
function producedSignals(): string[] {
  const names = new Set<string>();
  for (const rel of sourceFiles(INGEST_SRC)) {
    const src = readFileSync(join(INGEST_SRC, rel), 'utf8');
    for (const m of src.matchAll(/captureMessage\(\s*'([^']+)'/g)) {
      const name = m[1];
      if (name !== undefined) names.add(name);
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

  it('the runbook still states the delivery channel is mute, while it is', () => {
    // The one claim this register rests on. If somebody sets SENTRY_DSN_INGEST and updates the
    // runbook, this fails and the `consumer: null` rows above must be revisited — which is the
    // point: the inert state has to be re-confirmed, not inherited.
    const runbook = readFileSync(RUNBOOK, 'utf8');
    expect(
      runbook.includes('`SENTRY_DSN_INGEST` is unset in prod'),
      'the runbook no longer states that SENTRY_DSN_INGEST is unset — if the channel is now live, ' +
        'every `consumer: null` in the register is a stale claim and must be re-derived',
    ).toBe(true);
  });
});
