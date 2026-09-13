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
 *     verified ancestor of HEAD must read STALE.
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

describe('FOLLOW-1200 AC(3) — evaluateArtefactStaleness()', () => {
  it('no harnessSha at all is STALE', () => {
    const v = evaluateArtefactStaleness(null, null);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('no harnessSha');
  });

  it('a SHA that is not a verified ancestor of HEAD is STALE', () => {
    const v = evaluateArtefactStaleness('fixture-sha-not-a-real-commit', false);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('not a verified ancestor of HEAD');
  });

  it('an ancestry check that could not be resolved is STALE, not a silent pass', () => {
    const v = evaluateArtefactStaleness('fixture-sha-not-a-real-commit', null);
    expect(v.ok).toBe(false);
  });

  it('a verified ancestor of HEAD reads FRESH and names the SHA', () => {
    const v = evaluateArtefactStaleness('fixture-sha-not-a-real-commit', true);
    expect(v.ok).toBe(true);
    expect(v.reason).toContain('fixture-sha-not-a-real-commit');
  });
});
