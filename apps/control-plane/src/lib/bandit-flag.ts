/**
 * `BANDIT_ENABLED` — the switch that freezes the Thompson-sampling bandit (FOLLOW-1286, CEO
 * ruling D3, ESC-077 amendment).
 *
 * While the flag is off (the default — unset, empty or anything but the exact string `'true'`):
 *   - `POST`/`GET /api/adapt` never draw an arm: every decision is served and logged with
 *     `variant = 'control'` (the `adaptation_decisions.variant` column keeps being written);
 *   - `getBanditArms` (`lib/bandit-query.ts`) and `seedBanditWeightsForTenant`
 *     (`lib/bandit-seed.ts`) are not called by any route;
 *   - `/api/ab/weights`, `/api/tenants/[id]/bandit/weights/[archetype]` and
 *     `/api/adapt/feedback` answer {@link banditDisabledResponse} before doing anything else;
 *   - the analytics dashboards hide the arms panel.
 *
 * Why frozen and not deleted: D3 keeps the code until Phase 2 shows whether playbook variants
 * can survive the §E.7.0 grounding rule. Today the only slot carrying `variants.en` is
 * `headline`, which §E.7.0 withholds without grounding, so every arm served the same copy
 * (ESC-077, RETRO-317): the bandit was learning a difference no buyer saw.
 *
 * `BANDIT_ENABLED=true` restores the pre-freeze behaviour exactly.
 *
 * @module apps/control-plane/src/lib/bandit-flag
 */

import { NextResponse } from 'next/server';
import { errorBody, ErrorCode } from '@estalara/shared';
import { BANDIT_DISABLED_REASON } from '@/lib/bandit-disabled-body';

/** True only when `BANDIT_ENABLED` is exactly `'true'`. Read per call so tests can flip it. */
export function isBanditEnabled(): boolean {
  return process.env.BANDIT_ENABLED === 'true';
}

/**
 * The 404 every bandit route returns while the bandit is frozen. 404 rather than 503: the
 * endpoint is not temporarily unhealthy, it is switched off by ruling, and retrying will not help.
 * Callers tell it apart from a genuine 404 by `error.details.reason === 'bandit_disabled'`.
 */
export function banditDisabledResponse(): NextResponse {
  return NextResponse.json(
    errorBody({
      code: ErrorCode.NOT_FOUND,
      message: 'The Thompson-sampling bandit is frozen (BANDIT_ENABLED is off; FOLLOW-1286, D3).',
      requestId: crypto.randomUUID(),
      details: { reason: BANDIT_DISABLED_REASON },
    }),
    { status: 404 },
  );
}
