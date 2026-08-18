/**
 * FOLLOW-1022 — production canary: is `/api/adapt` actually generating, or quietly
 * serving templates?
 *
 * WHY THIS EXISTS. The 2026-08-17 audit found every production adapt decision coming back
 * as `"source": "playbook_fallback_llm_unavailable"` while the LLM was up, was called and
 * was billed — the model was asked to rewrite copy for a listing it had never been shown,
 * so FOLLOW-457's post-generation fact check discarded the whole batch (registered as
 * [MP-010]). Nothing in CI noticed, because a fallback is a 200 with directives in it. Demo
 * Mode's banner promised "generated with Haiku 4.5" and delivered a template.
 *
 * FOLLOW-1022 closed the cause. This closes the SILENCE: a regression that empties the LLM
 * path again now fails a check instead of looking like a normal green day.
 *
 * WHAT IT ASSERTS, and why the request is shaped the way it is. The decision tree only
 * calls the LLM inside a similarity band — above 0.85 it deliberately serves the playbook
 * (`source: 'playbook'`), which is correct behaviour and would make a naive assertion
 * either vacuous or flaky. The probe therefore sends `similarity: 0.7` / `confidence: 0.8`
 * to land squarely in the `llm_tweaked` band. From inside that band,
 * `playbook_fallback_llm_unavailable` is unambiguous: the LLM was supposed to run and its
 * output did not survive.
 *
 * SKIP-LOUD CONTRACT (mirrors intent-weights-live.smoke.test.ts / RETRO-007):
 *   secrets absent                          → soft-skip with a ::notice:: annotation
 *   REQUIRE_LIVE_ADAPT_SMOKE=1 + absent     → throws (a green badge over a test that never
 *                                             ran is the failure mode this repo keeps
 *                                             re-filing)
 *   secrets present + LLM path dead         → assertion fails
 *
 * ENV:
 *   ESTALARA_SMOKE_DECISION_API_URL — base URL including /api (e.g. https://admin.estalara.com/api)
 *   ESTALARA_SMOKE_API_KEY          — a real tenant key; `/api/adapt` resolves the tenant from it
 *   ESTALARA_SMOKE_TENANT_ID        — that key's tenant UUID. Required because the POST body
 *                                     carries `tenant_id` and the route 403s on a mismatch;
 *                                     it is NOT derivable from the key. Provisioning is
 *                                     tracked in backlog/ESCALATIONS.md (ESC-062).
 *   REQUIRE_LIVE_ADAPT_SMOKE        — "1" in the CI job that supplies the secrets
 *
 * @module tests/integration/adapt-llm-source-live.smoke.test
 */

import { describe, it, expect, beforeAll } from 'vitest';

const DECISION_API_URL = process.env.ESTALARA_SMOKE_DECISION_API_URL ?? '';
const API_KEY = process.env.ESTALARA_SMOKE_API_KEY ?? '';
const TENANT_ID = process.env.ESTALARA_SMOKE_TENANT_ID ?? '';
const HAS_SECRETS = Boolean(DECISION_API_URL) && Boolean(API_KEY) && Boolean(TENANT_ID);
const REQUIRE = process.env.REQUIRE_LIVE_ADAPT_SMOKE === '1';

if (REQUIRE && !HAS_SECRETS) {
  const missing = [
    !DECISION_API_URL && 'ESTALARA_SMOKE_DECISION_API_URL',
    !API_KEY && 'ESTALARA_SMOKE_API_KEY',
    !TENANT_ID && 'ESTALARA_SMOKE_TENANT_ID',
  ]
    .filter(Boolean)
    .join(', ');

  throw new Error(
    `REQUIRE_LIVE_ADAPT_SMOKE=1 is set but these secrets are absent: ${missing}. ` +
      'The adapt-llm-source-smoke CI job MUST supply them. A silent skip is forbidden — ' +
      'fix the job secrets or unset REQUIRE_LIVE_ADAPT_SMOKE. See backlog/ESCALATIONS.md ESC-062.',
  );
}

beforeAll(() => {
  if (!HAS_SECRETS) {
    console.log(
      '::notice::ESTALARA_SMOKE_DECISION_API_URL / ESTALARA_SMOKE_API_KEY / ' +
        'ESTALARA_SMOKE_TENANT_ID are not all set — skipping the FOLLOW-1022 adapt LLM-source ' +
        'canary. Until they are provisioned (ESC-062) a silent collapse of the LLM path is ' +
        'invisible to CI, exactly as it was on 2026-08-17.',
    );
  }
});

/** Sources that mean "the LLM was supposed to produce this copy and did not". */
const DEAD_LLM_SOURCES = ['playbook_fallback_llm_unavailable'];

interface AdaptProbeResponse {
  source: string;
  archetype: string;
  directives: unknown[];
}

/**
 * How long production is allowed to take to GENERATE.
 *
 * The first run of this canary (2026-08-18, run 32121627885) failed on the vitest default of
 * 30 s — not on the assertion. A request that deliberately lands in the LLM band is asking for
 * live generation on a possibly-cold Vercel function, and the 2026-08-17 audit measured 6–8 s
 * for a single cold generation in the local harness alone. 30 s was simply the wrong budget for
 * what this probe asks for, and a timeout there tells you nothing about `source`.
 *
 * Bounded, not removed: past this the probe reports the elapsed time, so "prod is slow" and
 * "prod is hung" stay distinguishable, and the number itself answers the 2026-08-17 audit's §5
 * gap 3 (production latency was never measured, only harness latency).
 */
const ADAPT_BUDGET_MS = 90_000;

describe('FOLLOW-1022 — production canary: POST /api/adapt serves generated copy, not a template', () => {
  it.skipIf(!HAS_SECRETS)(
    'inside the LLM similarity band, `source` is not a fallback',
    async () => {
      const startedAt = Date.now();
      let res: Response;
      try {
        res = await fetch(`${DECISION_API_URL.replace(/\/$/, '')}/adapt`, {
          method: 'POST',
          signal: AbortSignal.timeout(ADAPT_BUDGET_MS),
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${API_KEY}`,
          },
          body: JSON.stringify({
            tenant_id: TENANT_ID,
            // A canary session, never a real buyer's — this row lands in adaptation_decisions.
            session_id: `canary-follow1022-${String(Date.now())}`,
            page_type: 'listing_detail',
            archetype_hint: 'yield_hunter',
            confidence: 0.8,
            // 0.6 < similarity <= 0.85 ⇒ the `llm_tweaked` band. Above 0.85 the tree serves the
            // playbook BY DESIGN and this probe would assert nothing.
            similarity: 0.7,
          }),
        });
      } catch (err: unknown) {
        const elapsed = Date.now() - startedAt;
        const name = err instanceof Error ? err.name : 'unknown';
        throw new Error(
          `POST /api/adapt did not answer within ${String(ADAPT_BUDGET_MS)}ms ` +
            `(${String(elapsed)}ms elapsed, ${name}). That is a latency/availability finding, ` +
            'NOT evidence about `source` — the LLM band was never reached. Check the ' +
            'control-plane function logs before reading anything into it.',
        );
      }

      const elapsedMs = Date.now() - startedAt;
      // Printed on success too: this is the only place the estate measures production adapt
      // latency in the LLM band, and a number nobody records is a number nobody notices moving.
      console.log(`::notice::/api/adapt (llm_tweaked band) answered in ${String(elapsedMs)}ms`);

      expect(res.status).toBe(200);
      const body = (await res.json()) as AdaptProbeResponse;

      expect(
        DEAD_LLM_SOURCES,
        `/api/adapt returned source="${body.source}" from inside the LLM band. ` +
          'That means generation ran and produced nothing usable — the 2026-08-17 state ' +
          '(see [MP-010] in docs/ops/MEASURED_PREMISES.md). Check the Anthropic key in the ' +
          "control plane's VERCEL env (Vercel env ≠ Doppler), the llm-gateway URL/timeout, " +
          'and the FOLLOW-457 fact-check rejection reasons in the control-plane logs.',
      ).not.toContain(body.source);
    },
    ADAPT_BUDGET_MS + 15_000,
  );
});
