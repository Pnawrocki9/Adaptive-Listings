/**
 * The DEMO MODE switch (FOLLOW-1288, WP-2.3) — the ONE place `DEMO_MODE` is read.
 *
 * Demo tooling (the demo-JWT and ops-caller auth variants and the archetype override on
 * `POST /api/adapt`, `api/demo/*`, `dashboard/demo/*`) exists only when the control plane is started
 * with `DEMO_MODE=1`. Any other value, or no value, means OFF: the core decision route behaves as if
 * the demo code did not exist, `api/demo/*` answers 404 and `dashboard/demo/*` renders Next's 404.
 *
 * Who sets it: `scripts/dev/localhost-up.sh` (the FOLLOW-819 harness forces its control arm with the
 * ops caller — `tests/e2e/follow-819/README.md` §3) and `.github/workflows/demo-integration.yml`.
 * Read per request, never cached at module load, so a test can flip it with `vi.stubEnv`.
 *
 * @module apps/control-plane/src/lib/demo/demo-mode
 */

import { NextResponse } from 'next/server';

/** True only when the process was started with `DEMO_MODE=1` exactly. */
export function isDemoModeEnabled(): boolean {
  return process.env.DEMO_MODE === '1';
}

/**
 * The answer every `api/demo/*` handler gives when DEMO MODE is off: the same 404 an absent route
 * would give, so a deployment without the flag does not advertise that demo tooling exists.
 *
 * @returns null when DEMO MODE is on (the handler proceeds), else a `404 { error: 'not_found' }`.
 */
export function demoModeOffResponse(): NextResponse | null {
  return isDemoModeEnabled() ? null : NextResponse.json({ error: 'not_found' }, { status: 404 });
}
