// @vitest-environment node
// (the package default is jsdom, whose global `URL` `createRequire()` rejects at the harness's
// top-level Playwright resolution — same reason ac1-verdict.test.ts pins this)

/**
 * FOLLOW-1200 — the FOLLOW-819 harness's preflight and artefact-staleness verdicts must not pass
 * over a dead wire.
 *
 * Drives the REAL verdict functions out of `differentiator-e2e.mjs` (imported, not copied):
 *
 *   - `evaluateListingOrigin()` — AC(1): `LISTING_URL`'s origin must be one the control plane's
 *     CORS policy will actually answer, read from `CORS_DEV_EXTRA_ORIGINS`
 *     (`apps/control-plane/src/lib/origin-policy.ts`) at HEAD, not a copy hardcoded into a test.
 *   - `evaluateControlPlaneProbe()` — AC(2): the `/api/adapt` preflight probe must fail on a 5xx
 *     and on any non-2xx body carrying `demo_auth_misconfigured`, not only on a 404.
 *   - `evaluateArtefactStaleness()` — AC(3): a `last-run.json` whose `harnessSha` is not a
 *     verified ancestor of HEAD must read STALE. FOLLOW-1196: so must one produced any number of
 *     commits BEFORE HEAD (`commitsBehind > 0`), unless `--allow-stale` is given.
 *
 * Red-first for AC(2): `LEGACY_probeOk()` below reproduces the PRE-FIX predicate (the only check
 * `assertRealControlPlane()` used to run, `probe.status === 404`) so the same probe table can be
 * read against both the legacy and the fixed verdict and the L-1 defect (5xx passes) is EXECUTED,
 * not just asserted in prose.
 *
 * Collected by `tests/e2e/vitest.config.ts` (`**\/*.test.ts`); run by `pnpm e2e:smoke`, which
 * `.github/workflows/e2e-smoke.yml` executes nightly. It needs no substrate and takes no flag.
 *
 * @module tests/e2e/follow-819/harness-preflight.test
 */

import { beforeAll, describe, expect, it } from 'vitest';

interface OriginVerdict {
  ok: boolean;
  origin: string;
  reason: string;
}
interface ProbeVerdict {
  ok: boolean;
  reason: string;
}
interface StalenessVerdict {
  ok: boolean;
  allowedStale: boolean;
  commitsBehind: number | null;
  reason: string;
}
interface Probe {
  status: number | null;
  bodyText: string | null;
  networkError: string | null;
}

type EvaluateListingOrigin = (
  listingUrl: string,
  allowedOrigins: readonly string[],
) => OriginVerdict;
type EvaluateControlPlaneProbe = (probe: Probe) => ProbeVerdict;
type EvaluateArtefactStaleness = (
  harnessSha: string | null,
  isAncestorOfHead: boolean | null,
  commitsBehind: number | null,
  options?: { allowStale?: boolean },
) => StalenessVerdict;

let evaluateListingOrigin: EvaluateListingOrigin;
let evaluateControlPlaneProbe: EvaluateControlPlaneProbe;
let evaluateArtefactStaleness: EvaluateArtefactStaleness;

beforeAll(async () => {
  // The harness runs main() at import unless told not to — see the guard at its foot.
  (globalThis as Record<string, unknown>).FOLLOW1186_IMPORT_ONLY = true;
  const mod = (await import('./differentiator-e2e.mjs')) as {
    evaluateListingOrigin: EvaluateListingOrigin;
    evaluateControlPlaneProbe: EvaluateControlPlaneProbe;
    evaluateArtefactStaleness: EvaluateArtefactStaleness;
  };
  evaluateListingOrigin = mod.evaluateListingOrigin;
  evaluateControlPlaneProbe = mod.evaluateControlPlaneProbe;
  evaluateArtefactStaleness = mod.evaluateArtefactStaleness;
});

/** `CORS_DEV_EXTRA_ORIGINS` at HEAD (`apps/control-plane/src/lib/origin-policy.ts`). */
const ALLOWED_ORIGINS = ['http://localhost:5173', 'http://localhost:3000'];

describe('FOLLOW-1200 AC(1) — evaluateListingOrigin() names the CORS-refused origin', () => {
  it('the fixed default (:5173) is allowed', () => {
    const v = evaluateListingOrigin('http://localhost:5173/fixture-listing.html', ALLOWED_ORIGINS);
    expect(v.ok).toBe(true);
    expect(v.origin).toBe('http://localhost:5173');
  });

  it('the decision origin itself (:3000) is allowed', () => {
    const v = evaluateListingOrigin('http://localhost:3000/fixture-listing.html', ALLOWED_ORIGINS);
    expect(v.ok).toBe(true);
  });

  it('the old CORS-refused default (:9200) is a hard fail that names the origin', () => {
    const v = evaluateListingOrigin('http://localhost:9200/fixture-listing.html', ALLOWED_ORIGINS);
    expect(v.ok).toBe(false);
    expect(v.origin).toBe('http://localhost:9200');
    expect(v.reason).toContain('http://localhost:9200');
    expect(v.reason).toContain('NOT in CORS_DEV_EXTRA_ORIGINS');
  });

  it('an unparseable LISTING_URL fails rather than throwing', () => {
    const v = evaluateListingOrigin('not-a-url', ALLOWED_ORIGINS);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('not a parseable URL');
  });
});

/**
 * The PRE-FIX predicate — reproduced, not imported, because it never was a pure function in
 * `assertRealControlPlane()`: it lived inline in a fetch call that ALSO threw on a network error
 * before ever comparing a status. `legacyOk` mirrors that shape faithfully: a network error/timeout
 * was already red pre-fix; only the 5xx case was the silent pass (audit 2026-09-13, L-1/L-12).
 */
function legacyProbeOk(probe: Probe): boolean {
  if (probe.networkError) return false;
  return probe.status !== 404;
}

const PROBES: readonly [name: string, probe: Probe, legacyOk: boolean, fixedOk: boolean][] = [
  ['404 — wrong origin', { status: 404, bodyText: 'Not Found', networkError: null }, false, false],
  [
    'timeout',
    { status: null, bodyText: null, networkError: 'TimeoutError: signal timed out' },
    false,
    false,
  ],
  [
    'healthy 401 — expected unauthenticated rejection',
    { status: 401, bodyText: '{"error":"invalid_demo_token"}', networkError: null },
    true,
    true,
  ],
  [
    'healthy 200',
    { status: 200, bodyText: '{"adapt_decision_id":"x"}', networkError: null },
    true,
    true,
  ],
  // The direction that was silently wrong: L-1's Turbo-stripped-env 500 used to read as healthy.
  [
    '500 demo_auth_misconfigured (L-1) — the defect this ticket fixes',
    { status: 500, bodyText: '{"error":"demo_auth_misconfigured"}', networkError: null },
    true,
    false,
  ],
  [
    '503 with an unrelated body — still a 5xx',
    { status: 503, bodyText: '{"error":"upstream_unavailable"}', networkError: null },
    true,
    false,
  ],
];

describe('FOLLOW-1200 AC(2) — evaluateControlPlaneProbe(), pre-fix vs post-fix, EXECUTED', () => {
  it.each(PROBES.map(([name, probe, legacyOk, fixedOk]) => ({ name, probe, legacyOk, fixedOk })))(
    '$name → legacy=$legacyOk, fixed=$fixedOk',
    ({ probe, legacyOk, fixedOk }) => {
      expect(legacyProbeOk(probe)).toBe(legacyOk);
      expect(evaluateControlPlaneProbe(probe).ok).toBe(fixedOk);
    },
  );

  it('names the observed status and body in the failure reason (Rule Q amendment 1 cl. 5)', () => {
    const v = evaluateControlPlaneProbe({
      status: 500,
      bodyText: '{"error":"demo_auth_misconfigured"}',
      networkError: null,
    });
    expect(v.reason).toContain('500');
    expect(v.reason).toContain('demo_auth_misconfigured');
  });

  it('a non-2xx WITHOUT the demo_auth_misconfigured body is still accepted (401/403 rejection)', () => {
    const v = evaluateControlPlaneProbe({
      status: 403,
      bodyText: '{"error":"forbidden"}',
      networkError: null,
    });
    expect(v.ok).toBe(true);
  });
});

/**
 * The PRE-FIX staleness predicate (FOLLOW-1200 as merged in #898), reproduced so the table below
 * carries its column. It read ancestry only. The FOLLOW-1196 red-first run executed the table's
 * `fixedOk` column against the SLICED pre-fix function bytes; transcripts are in that PR body.
 */
function legacyStalenessOk(harnessSha: string | null, isAncestorOfHead: boolean | null): boolean {
  if (typeof harnessSha !== 'string' || harnessSha.length === 0) return false;
  return isAncestorOfHead === true;
}

const SHA = 'fixture-sha-not-a-real-commit';

interface StalenessRow {
  name: string;
  sha: string | null;
  ancestor: boolean | null;
  commitsBehind: number | null;
  allowStale: boolean;
  legacyOk: boolean;
  fixedOk: boolean;
  allowedStale: boolean;
}

const STALENESS: readonly StalenessRow[] = [
  {
    name: 'no harnessSha at all',
    sha: null,
    ancestor: null,
    commitsBehind: null,
    allowStale: false,
    legacyOk: false,
    fixedOk: false,
    allowedStale: false,
  },
  {
    name: 'not an ancestor of HEAD',
    sha: SHA,
    ancestor: false,
    commitsBehind: null,
    allowStale: false,
    legacyOk: false,
    fixedOk: false,
    allowedStale: false,
  },
  {
    name: 'ancestry unresolved',
    sha: SHA,
    ancestor: null,
    commitsBehind: null,
    allowStale: false,
    legacyOk: false,
    fixedOk: false,
    allowedStale: false,
  },
  {
    name: 'produced AT HEAD (commitsBehind 0)',
    sha: SHA,
    ancestor: true,
    commitsBehind: 0,
    allowStale: false,
    legacyOk: true,
    fixedOk: true,
    allowedStale: false,
  },
  // The #898 review finding: every earlier commit on a branch is an ancestor of its HEAD.
  {
    name: 'same-branch artefact 27 commits behind HEAD',
    sha: SHA,
    ancestor: true,
    commitsBehind: 27,
    allowStale: false,
    legacyOk: true,
    fixedOk: false,
    allowedStale: false,
  },
  {
    name: 'ancestor, but the distance could not be counted',
    sha: SHA,
    ancestor: true,
    commitsBehind: null,
    allowStale: false,
    legacyOk: true,
    fixedOk: false,
    allowedStale: false,
  },
  {
    name: '27 commits behind with --allow-stale',
    sha: SHA,
    ancestor: true,
    commitsBehind: 27,
    allowStale: true,
    legacyOk: true,
    fixedOk: true,
    allowedStale: true,
  },
  // --allow-stale covers distance only; it cannot place an artefact that is not on this branch.
  {
    name: 'not an ancestor, even with --allow-stale',
    sha: SHA,
    ancestor: false,
    commitsBehind: 27,
    allowStale: true,
    legacyOk: false,
    fixedOk: false,
    allowedStale: false,
  },
  {
    name: 'uncountable distance, even with --allow-stale',
    sha: SHA,
    ancestor: true,
    commitsBehind: null,
    allowStale: true,
    legacyOk: true,
    fixedOk: false,
    allowedStale: false,
  },
];

const staleness = (row: StalenessRow) =>
  evaluateArtefactStaleness(row.sha, row.ancestor, row.commitsBehind, {
    allowStale: row.allowStale,
  });

/** Only `ok` here, so the same table can be driven against the pre-fix function unchanged. */
describe('FOLLOW-1196 staleness verdict — an artefact behind HEAD is not fresh', () => {
  it.each(STALENESS)('$name → fixed=$fixedOk', (row) => {
    expect(staleness(row).ok).toBe(row.fixedOk);
  });
});

describe('FOLLOW-1200 AC(3) + FOLLOW-1196 — evaluateArtefactStaleness() reporting', () => {
  it.each(STALENESS)('$name → legacy=$legacyOk, allowedStale=$allowedStale', (row) => {
    expect(legacyStalenessOk(row.sha, row.ancestor)).toBe(row.legacyOk);
    expect(staleness(row).allowedStale).toBe(row.allowedStale);
  });

  it('no harnessSha names the missing SHA', () => {
    expect(evaluateArtefactStaleness(null, null, null).reason).toContain('no harnessSha');
  });

  it('a non-ancestor names the ancestry failure', () => {
    expect(evaluateArtefactStaleness(SHA, false, null).reason).toContain(
      'not a verified ancestor of HEAD',
    );
  });

  it('a behind-HEAD refusal prints the SHA and commitsBehind, and names the escape hatch', () => {
    const v = evaluateArtefactStaleness(SHA, true, 27);
    expect(v.commitsBehind).toBe(27);
    expect(v.reason).toContain(SHA);
    expect(v.reason).toContain('commitsBehind=27');
    expect(v.reason).toContain('--allow-stale');
  });

  it('an allowed-stale grade still says STALE and commitsBehind in its reason', () => {
    const v = evaluateArtefactStaleness(SHA, true, 27, { allowStale: true });
    expect(v.reason).toContain('STALE');
    expect(v.reason).toContain('commitsBehind=27');
  });

  it('an artefact at HEAD reads FRESH and names the SHA and commitsBehind=0', () => {
    const v = evaluateArtefactStaleness(SHA, true, 0);
    expect(v.reason).toContain(SHA);
    expect(v.reason).toContain('commitsBehind=0');
  });
});
