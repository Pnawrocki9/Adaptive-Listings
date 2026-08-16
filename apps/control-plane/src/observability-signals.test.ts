/**
 * FOLLOW-965 — every `Sentry.capture*` site in `apps/control-plane/src` must be REGISTERED, and
 * the delivery status of the single channel all 94 of them share must be STATED, not assumed.
 *
 * The twin of `apps/ingest/src/observability-signals.test.ts` (FOLLOW-937), for an app with
 * roughly twenty times the signal count.
 *
 * ---------------------------------------------------------------------------------------------
 * ## DELIVERY STATUS — read this before trusting any capture site below [AC(4)]
 *
 * **Every entry in this register is INERT in production [MP-004].**
 *
 * `sentry.server.config.ts:33`, `sentry.edge.config.ts:20` and `sentry.client.config.ts:23` all
 * gate `Sentry.init()` on an env var. Absent var ⇒ no `init` ⇒ `captureMessage` /
 * `captureException` are silent no-ops, not delayed sends. The vars are:
 *
 * | runtime            | env var                                |
 * | ------------------ | -------------------------------------- |
 * | Node.js (server)   | `SENTRY_DSN_CONTROL_PLANE`             |
 * | Edge               | `SENTRY_DSN_CONTROL_PLANE`             |
 * | Browser (client)   | `NEXT_PUBLIC_SENTRY_DSN_CONTROL_PLANE` |
 *
 * **Measured, dated, pasted** — `apps/control-plane` [MP-004], RETRO-269:
 *
 * ```
 * $ vercel env ls production        # 33 rows, none of them Sentry
 * $ vercel env ls | grep -ci sentry
 * 0
 * ```
 *
 * ### HOW A FUTURE READER CHECKS — the thing that was missing (this is the whole point)
 *
 * The 2026-08-12 failure was not that the DSN was absent. It was that **nothing in the repo said
 * what to check**, so two green gates (`Sentry init singleton guard` FOLLOW-738, `Sentry
 * capture-has-init guard` FOLLOW-743) were read as "the control plane is observable". Run this:
 *
 * ```bash
 * cd apps/control-plane
 * vercel env ls production | grep -i sentry     # expect: SENTRY_DSN_CONTROL_PLANE  Encrypted
 * vercel env ls preview    | grep -i sentry
 * vercel env ls development | grep -i sentry
 * ```
 *
 * **Vercel is the store that decides** — the control plane runs there, and a Doppler read proves
 * nothing about it (the two stores have drifted before; see `BRAND_PROVISIONING.md` §Step 0).
 * A present-but-`Encrypted` row proves PRESENCE only, never that the value is a working DSN:
 * to prove DELIVERY you must observe one event arrive in the Sentry UI.
 *
 * ### RE-VERIFICATION TRIGGER (Rule AU item 3)
 *
 * Re-run the three commands above, and re-derive every `consumer` cell in this file, whenever:
 * (a) somebody sets or rotates a control-plane DSN; (b) a Vercel project/env is added; (c) any
 * document or PR claims a control-plane failure is "visible in Sentry"; (d) 90 days pass with a
 * signal below being cited as a diagnostic. The dated measurement above is the ONLY thing this
 * register asserts about the outside world — deliberately, because a repo cannot know it.
 *
 * ---------------------------------------------------------------------------------------------
 * ## What this gate asserts, and what it does NOT (Rule AU)
 *
 * CLAIM:     no `Sentry.capture*` site can be added to this app without a human stating, in this
 *            file, what it means and whether anything consumes it.
 * ASSERTION: (1) every source file containing capture sites appears in `REGISTER`; (2) each row's
 *            `sites` count equals the count scanned from that file — so a new call inside an
 *            ALREADY-registered file fails too; (3) no row names a file that produces nothing;
 *            (4) `TOTAL_SITES` equals both the register sum and the scanned total; (5) every
 *            string-literal `captureMessage` name is in `NAMED_SIGNALS`; (6) the observability
 *            runbook names those signals and carries the DSN check commands; (7) the env vars
 *            this header tells you to check are exactly the ones the three Sentry configs gate on.
 * GAP:       this gate CANNOT know whether a signal is delivered — no repo assertion can, the
 *            subject is a Vercel env var and a Sentry project (Rule AU item 3). It also does not
 *            name the 93 dynamic-message sites individually: their message is built at runtime
 *            (`captureMessage(msg, …)`) or is an exception, so they are registered by FILE and
 *            EXACT COUNT rather than by name. A new such site therefore forces a register edit
 *            with a stated meaning, but the register does not know the message text.
 *
 * ---------------------------------------------------------------------------------------------
 * ## Count note (honest arithmetic)
 *
 * FOLLOW-965's stub says 96 sites across 54 files, from a line-oriented grep. That grep
 * over-counts by one: `app/api/canary/adaptation-writes/route.ts:23` mentions
 * `Sentry.captureException` in a DOCSTRING, and a line grep scores that as a call site. The true
 * figure when this register was written was **95 call sites in 54 files**.
 *
 * It is now **96 in 55**: FOLLOW-973 added `app/api/admin/diagnostics/first-party-tenant/route.ts`
 * — and this gate is how that was noticed, on the very next ticket. The numbers coinciding with
 * the stub's original 96 is a coincidence, not a reversal of the correction above.
 *
 * FOLLOW-988 stage B deleted `lib/ab-events.ts` (2 sites) — ADR-0022, the Redpanda publisher had
 * been a no-op since ADR-0016. It is now **94 in 54**.
 *
 * FOLLOW-999 added `app/api/admin/tenants/quiz-completions/route.ts` (1 site — the staff quiz
 * answers viewer read). It is now **95 in 55**.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = join(__dirname);
const APP_ROOT = join(__dirname, '..');
const RUNBOOK = join(__dirname, '../../../docs/runbooks/observability.md');

/** The env vars the header tells a reader to check. Asserted against the Sentry configs below. */
const DSN_ENV_VARS = ['SENTRY_DSN_CONTROL_PLANE', 'NEXT_PUBLIC_SENTRY_DSN_CONTROL_PLANE'] as const;

/** Sum of every `sites` cell, restated so a hand-edit of one row cannot drift the headline. */
const TOTAL_SITES = 95;

interface CaptureSiteGroup {
  /** Path relative to `apps/control-plane/src`. */
  file: string;
  /** Exact number of `Sentry.capture*(` occurrences in that file. */
  sites: number;
  /** What a reader should conclude when a capture in this file fires. */
  meaning: string;
  /**
   * What CONSUMES it — an alert rule, a dashboard, a runbook procedure. `null` is the honest
   * answer for every row today: the DSN is unset in every Vercel environment (see header), so
   * there is no channel to consume anything on.
   */
  consumer: string | null;
}

/**
 * `consumer: null` for all 54 rows is ONE fact, not 54 independent judgements: the channel is
 * mute. Recorded per row anyway so that arming the DSN forces a per-row re-derivation instead of
 * a blanket "Sentry is on now".
 */
const NO_CHANNEL = null;

const REGISTER: CaptureSiteGroup[] = [
  {
    file: 'app/admin/demo-sessions/data.ts',
    sites: 1,
    meaning: 'The admin demo-session list query failed; the page renders a degraded empty state.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/admin/registrations/data.ts',
    sites: 1,
    meaning: 'The admin registrations list query failed; the page renders a degraded empty state.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/admin/tenants/data.ts',
    sites: 2,
    meaning: 'The admin tenant list / detail query failed against Postgres.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/adapt/description/route.ts',
    sites: 3,
    meaning:
      'The LLM description path failed — auth DB throw, cache/Modal error, or a write rejected downstream.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/adapt/route.ts',
    sites: 3,
    meaning:
      'The primary adaptation decision path failed — auth DB throw, decision error, or telemetry write rejection.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/admin/analytics/rollup/data.ts',
    sites: 2,
    meaning: 'An analytics rollup query failed (ClickHouse or Postgres leg).',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/admin/diagnostics/first-party-tenant/route.ts',
    sites: 1,
    meaning:
      'The FIRST_PARTY_TENANT_ID diagnostic could not reach Postgres to check whether the ' +
      'configured id resolves to a real tenant. The env verdict in the same response is ' +
      'unaffected and still authoritative; only the tenant-existence leg is unknown.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/admin/intent-weights/route.ts',
    sites: 2,
    meaning: 'Reading or writing the global intent-weight configuration failed.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/admin/intent/config/[id]/route.ts',
    sites: 1,
    meaning: 'A single intent-config record could not be read or mutated.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/admin/intent/config/route.ts',
    sites: 2,
    meaning: 'The intent-config collection could not be listed or appended to.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/admin/labels/[id]/route.ts',
    sites: 3,
    meaning: 'A conversion-label record could not be read, updated or deleted.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/admin/labels/export/route.ts',
    sites: 3,
    meaning: 'The conversion-label export failed while querying or streaming.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/admin/labels/route.ts',
    sites: 2,
    meaning: 'The conversion-label collection could not be listed or appended to.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/admin/tenants/al-state/route.ts',
    sites: 3,
    meaning:
      'The Adaptive-Listings on/off state for a tenant could not be read or persisted — a control-surface failure.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/admin/tenants/optout-widget/route.ts',
    sites: 3,
    meaning:
      'The §H.9 opt-out widget configuration could not be read or persisted — a compliance-surface failure.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/admin/tenants/quiz-completions/route.ts',
    sites: 1,
    meaning:
      'The quiz completions viewer feed could not be read — the staff page shows its K.2 error state instead of an empty table.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/admin/tenants/quiz-definition/route.ts',
    sites: 3,
    meaning: 'The quiz definition for a tenant could not be read or persisted.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/admin/tracer/export/decisions/route.ts',
    sites: 1,
    meaning: 'The archetype-tracer decision export failed.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/admin/tracer/export/events/route.ts',
    sites: 1,
    meaning: 'The archetype-tracer event export failed.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/admin/tracer/history/[session_id]/route.ts',
    sites: 2,
    meaning: 'Per-session tracer history could not be read.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/admin/tracer/history/route.ts',
    sites: 1,
    meaning: 'The tracer history collection could not be read.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/admin/tracer/sessions/[id]/route.ts',
    sites: 2,
    meaning: 'A single tracer session could not be read or mutated.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/admin/tracer/sessions/[id]/stream/route.ts',
    sites: 1,
    meaning: 'The tracer session SSE stream failed mid-flight.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/admin/tracer/sessions/route.ts',
    sites: 1,
    meaning: 'The tracer session list could not be read.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/audit/route.ts',
    sites: 1,
    meaning: 'A `staff_audit_log` read failed — the ADR-0018 audit surface is degraded.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/canary/adaptation-writes/route.ts',
    sites: 4,
    meaning:
      'The adaptation-write canary found a zero-row 24h window or could not run its query — the pilot measurement loop may be silently dead.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/config/route.ts',
    sites: 1,
    meaning: 'A tenant `brand_config` read/write failed.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/crm/outcome/route.ts',
    sites: 1,
    meaning: 'A CRM outcome write failed — a conversion label may be lost.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/dashboard/analytics/lift/route.ts',
    sites: 1,
    meaning: 'The dashboard CTA-lift query failed.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/dashboard/analytics/summary/route.ts',
    sites: 1,
    meaning: 'The dashboard analytics summary query failed.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/demo/override/route.ts',
    sites: 1,
    meaning: 'A demo archetype override could not be applied.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/detect/route.ts',
    sites: 1,
    meaning: 'Auto-detection of a tenant site schema failed.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/dsr/_clickhouse.ts',
    sites: 2,
    meaning:
      'A DSR erasure/export leg against ClickHouse failed — a GDPR obligation may be part-completed.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/dsr/erase/route.ts',
    sites: 2,
    meaning:
      'A DSR erasure failed or completed with an unerased namespace (`tags.crm_namespace`) — compliance-relevant.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/dsr/initiate/route.ts',
    sites: 1,
    meaning:
      'A DSR was initiated for an UNPROVISIONED external brand identity (`brand_identity: unprovisioned_external`) — the OTP e-mail goes out branded "Estalara". `BRAND_PROVISIONING.md` §Step 3a names this as the symptom to watch for.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/dsr/mutation-poll/_finalise.ts',
    sites: 1,
    meaning: 'Finalising a polled DSR mutation failed.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/dsr/mutation-poll/route.ts',
    sites: 5,
    meaning:
      'The DSR mutation poller failed to observe, advance or finalise an erasure — the longest-running compliance path in the app.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/internal/description-cache/route.ts',
    sites: 2,
    meaning: 'A persistent description-cache read/write failed (Modal callback path).',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/internal/retention/conversion-labels/route.ts',
    sites: 1,
    meaning: 'The conversion-label retention sweep failed — retention policy may be unenforced.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/pilot/calibration/route.ts',
    sites: 2,
    meaning: 'The pilot calibration query failed (ClickHouse leg, then Postgres leg).',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/pilot/cta-lift/route.ts',
    sites: 1,
    meaning: 'The pilot CTA-lift ClickHouse query failed.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/pilot/inquiry-starts/route.ts',
    sites: 1,
    meaning: 'The pilot inquiry-start ClickHouse query failed.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/quiz/completion/route.ts',
    sites: 1,
    meaning:
      'A quiz completion could not be persisted — the archetype prior is lost for that user.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/quiz/config/route.ts',
    sites: 1,
    meaning: 'The quiz configuration could not be served.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/schema/activate/route.ts',
    sites: 1,
    meaning: 'Activating a detected site schema failed — the tenant stays on the previous schema.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/tenants/[id]/bandit/weights/[archetype]/route.ts',
    sites: 1,
    meaning: 'A bandit weight read/write failed — the feedback loop may be frozen for that arm.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/tenants/[id]/route.ts',
    sites: 1,
    meaning: 'A tenant record read/write failed.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'app/api/v1/consent/platform-registration/route.ts',
    sites: 5,
    meaning:
      'A platform-registration consent write hit an unverifiable or superseded `consent_text_hash`, an unprovisioned brand identity, or a grace-window default. `MASTER_DESIGN` §H and `BRAND_PROVISIONING.md` §Step 3b both cite these as THE compensating control for a 201 that is not provably correct.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'lib/adapt-get-auth.ts',
    sites: 1,
    meaning:
      'The GET-adaptation API-key lookup threw on a CONFIGURED-but-failing DB (Rule K.2). The caller returns 401 `dbError: true`; this capture is the ONLY thing that distinguishes it from a genuinely bad key.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'lib/al-enablement.ts',
    sites: 1,
    meaning:
      'The Adaptive-Listings enablement lookup failed and the request FAILED OPEN to normal adaptation — a fail-open whose only record is this capture.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'lib/brand-identity.ts',
    sites: 2,
    meaning:
      'Named signals — see `NAMED_SIGNALS` below. `FIRST_PARTY_TENANT_ID` is unusable, so authorisation decisions are taken without a resolvable first-party identity.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'lib/demo-session-revocation.ts',
    sites: 1,
    meaning: 'A demo session could not be revoked — an access grant may outlive its intent.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'lib/listing-embed-seed-publisher.ts',
    sites: 2,
    meaning: 'Publishing a listing-embedding seed job failed — vectors will not be refreshed.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'lib/llm-gateway.ts',
    sites: 3,
    meaning:
      'An LLM call failed, or the `llm_calls` ClickHouse insert was rejected — cost/latency accounting is losing rows.',
    consumer: NO_CHANNEL,
  },
  {
    file: 'lib/seed-listing-embeddings.ts',
    sites: 1,
    meaning: 'The listing-embedding seeder failed mid-run.',
    consumer: NO_CHANNEL,
  },
];

interface NamedSignal {
  /** The string literal passed to `Sentry.captureMessage`. */
  name: string;
  meaning: string;
  consumer: string | null;
}

/**
 * Only capture sites whose message is a STRING LITERAL can be registered by name. There are two,
 * and both are cited by name in shipped documents — which is exactly why FOLLOW-965 exists: the
 * documents promised a Sentry event that could not be delivered.
 */
const NAMED_SIGNALS: NamedSignal[] = [
  {
    name: 'first_party_tenant_id_malformed',
    meaning:
      'FIRST_PARTY_TENANT_ID is set but unparseable — the control-plane origin gate is degrading. (FOLLOW-678)',
    consumer: NO_CHANNEL,
  },
  {
    name: 'first_party_tenant_id_unresolved',
    meaning:
      'An AUTHORISATION decision was taken with no resolvable first-party identity, so platform-origin grants now refuse with `first_party_unverified`. (FOLLOW-957 AC(2)/AC(4))',
    consumer: NO_CHANNEL,
  },
];

/** Every `.ts`/`.tsx` under `src`, excluding tests. */
function sourceFiles(dir: string, base = ''): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    const rel = base ? `${base}/${entry}` : entry;
    if (statSync(full).isDirectory()) return sourceFiles(full, rel);
    return /\.tsx?$/.test(entry) && !entry.includes('.test.') ? [rel] : [];
  });
}

/** `relative path -> exact number of `Sentry.capture*(` occurrences`, for files that have any. */
function scanCaptureSites(): Map<string, number> {
  const found = new Map<string, number>();
  for (const rel of sourceFiles(SRC)) {
    const src = readFileSync(join(SRC, rel), 'utf8');
    const n = [...src.matchAll(/Sentry\.capture(?:Message|Exception)\(/g)].length;
    if (n > 0) found.set(rel, n);
  }
  return found;
}

/** Signal names produced as string literals. */
function literalSignalNames(): string[] {
  const names = new Set<string>();
  for (const rel of sourceFiles(SRC)) {
    const src = readFileSync(join(SRC, rel), 'utf8');
    for (const m of src.matchAll(/captureMessage\(\s*'([^']+)'/g)) {
      const name = m[1];
      if (name !== undefined) names.add(name);
    }
  }
  return [...names].sort();
}

describe('FOLLOW-965 — control-plane Sentry capture-site register', () => {
  it('every file that captures to Sentry is registered', () => {
    const registered = new Set(REGISTER.map((r) => r.file));
    const unregistered = [...scanCaptureSites().keys()].filter((f) => !registered.has(f)).sort();
    expect(
      unregistered,
      'A Sentry capture site was added in a file with no register entry. Add a row to REGISTER ' +
        'stating what it means and what — if anything — consumes it. A producer nobody reads is ' +
        'not observability (Rule AJ).',
    ).toEqual([]);
  });

  it('every registered file still captures, and the count is exact', () => {
    const scanned = scanCaptureSites();
    const drift = REGISTER.filter((r) => scanned.get(r.file) !== r.sites).map(
      (r) =>
        `${r.file}: register says ${String(r.sites)}, source has ${String(scanned.get(r.file) ?? 0)}`,
    );
    expect(
      drift,
      'The register disagrees with the source. A count that GREW means a capture site was added ' +
        'without a stated meaning; a count that SHRANK (or 0) means the row is stale — delete it.',
    ).toEqual([]);
  });

  it('TOTAL_SITES matches both the register and the source', () => {
    const registerSum = REGISTER.reduce((n, r) => n + r.sites, 0);
    const scannedSum = [...scanCaptureSites().values()].reduce((n, v) => n + v, 0);
    expect(registerSum, 'the header headline count drifted from the rows').toBe(TOTAL_SITES);
    expect(scannedSum, 'the header headline count drifted from the source').toBe(TOTAL_SITES);
  });

  it('every string-literal signal name is registered by name', () => {
    const named = new Set(NAMED_SIGNALS.map((s) => s.name));
    const unregistered = literalSignalNames().filter((n) => !named.has(n));
    expect(
      unregistered,
      'a named Sentry signal exists that NAMED_SIGNALS does not carry — documents cite these by ' +
        'name, so an unregistered one is a claim nobody can check',
    ).toEqual([]);
  });

  it('every named signal still has a producer', () => {
    const produced = new Set(literalSignalNames());
    const stale = NAMED_SIGNALS.map((s) => s.name).filter((n) => !produced.has(n));
    expect(stale, 'NAMED_SIGNALS names a signal nothing produces — delete the row').toEqual([]);
  });

  it('the observability runbook names every named signal, so operator and developer read one list', () => {
    const runbook = readFileSync(RUNBOOK, 'utf8');
    const missing = NAMED_SIGNALS.map((s) => s.name).filter((n) => !runbook.includes(n));
    expect(
      missing,
      'a named signal the runbook never mentions — the operator who has to decide whether the ' +
        'channel matters cannot see it',
    ).toEqual([]);
  });

  it('the runbook tells a reader HOW to check the DSN, by name and by command', () => {
    // Deliberately NOT "the runbook says the DSN is unset" — that is a markdown substring standing
    // for the state of a Vercel env var, the exact Rule AU item 3 defect RETRO-266 recorded in the
    // ingest twin. This asserts only what it can: that the instructions are present.
    const runbook = readFileSync(RUNBOOK, 'utf8');
    const missing = [...DSN_ENV_VARS, 'vercel env ls production'].filter(
      (needle) => !runbook.includes(needle),
    );
    expect(
      missing,
      'the runbook no longer tells a reader which env var to check, or with what command — the ' +
        'FOLLOW-965 failure was NOT that the DSN was missing, it was that nothing said what to check',
    ).toEqual([]);
  });

  it('the env vars this register tells you to check are the ones the Sentry configs gate on', () => {
    // A source claim about source: if somebody renames the DSN var, every "how to check"
    // instruction above silently becomes wrong. This is the only part of the delivery question a
    // repo test can honestly own.
    const gated = ['sentry.server.config.ts', 'sentry.edge.config.ts', 'sentry.client.config.ts']
      .flatMap((f) => [
        ...readFileSync(join(APP_ROOT, f), 'utf8').matchAll(
          /process\.env\.((?:NEXT_PUBLIC_)?SENTRY_DSN[A-Z_]*)/g,
        ),
      ])
      .map((m) => m[1]!);
    expect(
      gated.length,
      'a Sentry config stopped reading a DSN env var — re-derive the header',
    ).toBe(3);
    expect(
      [...new Set(gated)].sort(),
      'the DSN env var names drifted from DSN_ENV_VARS — update the register header AND the ' +
        'runbook check commands in the same PR',
    ).toEqual([...DSN_ENV_VARS].sort());
  });
});
