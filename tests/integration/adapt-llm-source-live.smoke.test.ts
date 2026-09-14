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
 * WHAT A GREEN MEANS, and what it did NOT mean until FOLLOW-1059. Sending no `holdout_pct`
 * left the route defaulting this probe into the 10% A/B holdout, which returns
 * `source: "default"` BEFORE any LLM call — and the predicate scored that as a pass. 14 of
 * the 130 canary decision rows ever written (10.8%) are exactly that, including the green
 * that RETRO-290 §9 offered as proof a production failure was transient. The probe now sends
 * `holdout_pct: 0`, and a response that never reached the band is UNDETERMINED and red, with
 * its own message. A gate must assert the behaviour it is named for (Rule AU).
 *
 * WHY `holdout_pct: 0` STOPPED BEING A GUARANTEE (FOLLOW-1210 / RETRO-329 §4a LG-1). Since #902
 * (FOLLOW-1201), the route honours a body `holdout_pct` only for the ops-bearer caller — every
 * other caller, including this probe's tenant key, draws holdout at the CONFIGURED rate (0.1)
 * regardless of what it sends. That is correct: the rate is configuration, not something a
 * page-visible tenant key should be able to override. But it means this probe legitimately
 * lands in the holdout ~10% of the time, and a holdout draw is not a regression — it is the
 * documented low-probability case. This spec now RETRIES with a fresh `session_id`
 * (`MAX_HOLDOUT_RETRY_ATTEMPTS` = 3, independent HMAC draws, so three in a row is 0.1 ** 3 =
 * 0.001) before it lets a holdout draw turn the gate red, and reports every attempt's verdict
 * loudly either way. See `isHoldoutDraw` / `bandNotExercisedMessage` in `adapt-canary-verdict.ts`
 * for how a holdout draw is told apart from every other `band_not_exercised` cause.
 *
 * SKIP-LOUD CONTRACT (mirrors intent-weights-live.smoke.test.ts / RETRO-007):
 *   secrets absent                          → soft-skip with a ::notice:: annotation
 *   REQUIRE_LIVE_ADAPT_SMOKE=1 + absent     → throws (a green badge over a test that never
 *                                             ran is the failure mode this repo keeps
 *                                             re-filing)
 *   secrets present + LLM path dead         → assertion fails
 *   secrets present + band never reached    → assertion fails, as UNDETERMINED [FOLLOW-1059]
 *
 * ENV:
 *   ESTALARA_SMOKE_DECISION_API_URL — base URL including /api (e.g. https://admin.estalara.com/api)
 *   ESTALARA_SMOKE_API_KEY          — a real tenant key; `/api/adapt` resolves the tenant from it
 *   ESTALARA_SMOKE_TENANT_ID        — that key's tenant UUID. Required because the POST body
 *                                     carries `tenant_id` and the route 403s on a mismatch;
 *                                     it is NOT derivable from the key. Provisioning is
 *                                     tracked in backlog/ESCALATIONS.md (ESC-062).
 *   ESTALARA_SMOKE_LISTING_ID       — a real listing UUID. REQUIRED for the `source` assertion,
 *                                     see the note below; without it only reachability and
 *                                     latency are checked.
 *   REQUIRE_LIVE_ADAPT_SMOKE        — "1" in the CI job that supplies the secrets
 *
 * @module tests/integration/adapt-llm-source-live.smoke.test
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  verdictFor,
  isProbeConclusive,
  isHoldoutDraw,
  bandNotExercisedMessage,
  probeOutcome,
  MAX_HOLDOUT_RETRY_ATTEMPTS,
  type AdaptProbeResponse,
} from './adapt-canary-verdict.js';

const DECISION_API_URL = process.env.ESTALARA_SMOKE_DECISION_API_URL ?? '';
const API_KEY = process.env.ESTALARA_SMOKE_API_KEY ?? '';
const TENANT_ID = process.env.ESTALARA_SMOKE_TENANT_ID ?? '';
/**
 * A real listing UUID, and the difference between a canary and a false alarm.
 *
 * The first live run of this spec failed with `playbook_fallback_llm_unavailable` and it was
 * NOT a production defect — it was this file's own bug. FOLLOW-1022's whole fix is that
 * `/api/adapt` builds the model's context from the listing's OWN facts via `withListingFacts`,
 * which needs `body.listing_id`. Sending none leaves the context empty, so every figure the
 * model writes is ungrounded, FOLLOW-457's fact check discards the batch, and the route
 * correctly falls back. The probe was asserting against a path that is SUPPOSED to fall back.
 *
 * A canary that fails for its own reasons is worse than no canary: it trains people to ignore
 * the alarm. So the `source` assertion now runs only when a listing id is supplied, and says so
 * loudly when it is not.
 */
const LISTING_ID = process.env.ESTALARA_SMOKE_LISTING_ID ?? '';
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

/**
 * One request into the LLM band, with its own fresh canary `session_id` (FOLLOW-1102 AC(5): a
 * distinct session per attempt means every attempt writes its own `adaptation_decisions` row for
 * the smoke tenant — retries are not free re-rolls of one row, they are independent observations).
 */
async function probeAdaptOnce(attempt: number): Promise<{ res: Response; elapsedMs: number }> {
  const startedAt = Date.now();
  try {
    const res = await fetch(`${DECISION_API_URL.replace(/\/$/, '')}/adapt`, {
      method: 'POST',
      signal: AbortSignal.timeout(ADAPT_BUDGET_MS),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        tenant_id: TENANT_ID,
        // A canary session, never a real buyer's — this row lands in adaptation_decisions.
        // Suffixed with the attempt number so a retry (FOLLOW-1210) never reuses a session a
        // prior attempt already drew holdout on.
        session_id: `canary-follow1022-${String(Date.now())}-${String(attempt)}`,
        page_type: 'listing_detail',
        archetype_hint: 'yield_hunter',
        confidence: 0.8,
        // 0.6 < similarity <= 0.85 ⇒ the `llm_tweaked` band. Above 0.85 the tree serves the
        // playbook BY DESIGN and this probe would assert nothing.
        similarity: 0.7,
        // FOLLOW-1059: opt this probe OUT of the A/B holdout when the deployed build still
        // honours it. FOLLOW-1210: since FOLLOW-1201 that is no longer guaranteed for this
        // probe's tenant key (see the docblock at the top of this file) — a fresh session_id
        // per attempt plus the retry loop below is what actually keeps this gate honest now.
        holdout_pct: 0,
        // FOLLOW-1034 / ESC-063: PR #773 added the LISTING_ID gate on the assertion but
        // never put the id in the BODY, so `withListingFacts` had nothing to fetch and
        // every canary run exercised the guaranteed-ungrounded path the docblock above
        // warns about. The gate without the field was the false alarm, armed.
        ...(LISTING_ID ? { listing_id: LISTING_ID } : {}),
      }),
    });
    return { res, elapsedMs: Date.now() - startedAt };
  } catch (err: unknown) {
    const elapsed = Date.now() - startedAt;
    const name = err instanceof Error ? err.name : 'unknown';
    throw new Error(
      `POST /api/adapt (attempt ${String(attempt)}/${String(MAX_HOLDOUT_RETRY_ATTEMPTS)}) did ` +
        `not answer within ${String(ADAPT_BUDGET_MS)}ms (${String(elapsed)}ms elapsed, ${name}). ` +
        'That is a latency/availability finding, NOT evidence about `source` — the LLM band ' +
        'was never reached, and a network failure is never a holdout draw, so it is not ' +
        'retried. Check the control-plane function logs before reading anything into it.',
    );
  }
}

describe('FOLLOW-1022 — production canary: POST /api/adapt serves generated copy, not a template', () => {
  it.skipIf(!HAS_SECRETS)(
    'the LLM band is exercised, and its output is either served or correctly refused',
    async () => {
      let body: AdaptProbeResponse | undefined;
      let attemptsMade = 0;

      // FOLLOW-1210: a holdout draw is production behaving exactly as designed (~10% of every
      // request, since FOLLOW-1201 restricted `holdout_pct` honouring to the ops-bearer caller —
      // see the top-of-file docblock). It must not turn this REGISTERED required gate red on its
      // own. Retry with a fresh session_id, bounded: three consecutive holdout draws happen with
      // probability 0.1 ** 3 = 0.001, and every attempt's verdict is printed either way.
      for (let attempt = 1; attempt <= MAX_HOLDOUT_RETRY_ATTEMPTS; attempt += 1) {
        attemptsMade = attempt;
        const { res, elapsedMs } = await probeAdaptOnce(attempt);

        // Printed on every attempt, success or not: this is the only place the estate measures
        // production adapt latency in the LLM band, and a number nobody records is a number
        // nobody notices moving.
        console.log(
          // "requested": the band is the decision tree's call, and this line prints before the
          // response is classified. The line that names what production actually DID is the
          // verdict notice below [FOLLOW-1059 AC(3)].
          `::notice::/api/adapt (requested llm_tweaked band, attempt ${String(attempt)}/` +
            `${String(MAX_HOLDOUT_RETRY_ATTEMPTS)}) answered in ${String(elapsedMs)}ms`,
        );

        expect(res.status).toBe(200);
        body = (await res.json()) as AdaptProbeResponse;

        if (!LISTING_ID) {
          console.log(
            '::notice::ESTALARA_SMOKE_LISTING_ID is not set — reachability and latency were ' +
              `checked (source="${body.source}"), but the LLM-path assertion was NOT made. ` +
              'Without a listing id the model has no facts to ground in, so a fallback is the ' +
              'correct outcome and asserting against it would be a false alarm.',
          );
          return;
        }

        const verdict = verdictFor(body);
        // Printed on every outcome of every attempt, including the two that pass: a
        // `correctly_refused` run is a real observation about production (the fact check
        // rejected a generation) and a canary that swallows it silently is the FOLLOW-1056
        // blind spot moved into CI.
        console.log(
          `::notice::/api/adapt verdict=${verdict} source="${body.source}" ` +
            `holdout_group=${String(body.holdout_group ?? false)} ` +
            `fallback_reason="${body.fallback_reason ?? '<absent>'}" ` +
            `attempt=${String(attempt)}/${String(MAX_HOLDOUT_RETRY_ATTEMPTS)}`,
        );

        const holdoutDraw = verdict === 'band_not_exercised' && isHoldoutDraw(body);
        if (holdoutDraw && attempt < MAX_HOLDOUT_RETRY_ATTEMPTS) {
          console.log(
            `::notice::attempt ${String(attempt)} drew the A/B holdout (holdout_group=true) — ` +
              'retrying with a fresh session_id [FOLLOW-1210]. Three consecutive holdout draws ' +
              'at the configured rate have probability 0.1 ** 3 = 0.001.',
          );
          continue;
        }

        // Either this attempt was conclusive (not a holdout draw), or the retry budget is
        // exhausted and every attempt drew the holdout — both are terminal, handled below.
        break;
      }

      // The loop above always assigns `body` before it can exit when LISTING_ID is set (either
      // by `return`ing early without LISTING_ID, or by running at least one iteration).
      const finalBody = body!;
      const verdict = verdictFor(finalBody);

      // FOLLOW-1120 / ESC-072 — the third state, and the one thing this gate must NOT do is
      // render a verdict on a pull request for a fault the pull request cannot have caused.
      // This probe reads a DEPLOYED origin, so when production's grounding context is empty the
      // run says something true about production and nothing at all about the branch. It is
      // reported at ::error:: level (loud, visible in the run summary, impossible to mistake for
      // a clean run) and then returns without asserting. It is deliberately not a ::notice:: —
      // an operator must still be pushed to fix FOLLOW-1120.
      if (probeOutcome(verdict) === 'undetermined') {
        console.log(
          `::error::/api/adapt could not ground its prompt — the upstream listing-details fetch ` +
            `returned non-OK, so the model was asked to obey a grounding rule with no listing ` +
            `context in the prompt (FOLLOW-1120). PRODUCTION IS DEGRADED and this needs fixing, ` +
            `but the failure is in a different service and no pull request can cause it, so this ` +
            `gate renders no verdict on the branch it ran from [ESC-072]. Confirm with: ` +
            'SELECT ts, source, tokens_in FROM llm_calls WHERE session_id LIKE ' +
            "'canary-follow1022-%' ORDER BY ts DESC LIMIT 10 — 902 input tokens is grounded, " +
            '558 is this state.',
        );
        return;
      }

      const failureMessage =
        verdict === 'band_not_exercised'
          ? bandNotExercisedMessage(finalBody, attemptsMade)
          : `/api/adapt returned source="${finalBody.source}" ` +
            `fallback_reason="${finalBody.fallback_reason ?? '<absent>'}" from inside the LLM ` +
            'band, and no fact-check refusal was reported — so the LLM was supposed to run and ' +
            'did not produce anything at all (the 2026-08-17 state, [MP-010] in ' +
            'docs/ops/MEASURED_PREMISES.md). Check the Anthropic key in the control plane’s ' +
            'VERCEL env (Vercel env ≠ Doppler) and the llm-gateway URL/timeout. If ' +
            'fallback_reason is <absent>, the deployed build predates FOLLOW-1056 and this red ' +
            'cannot distinguish an outage from a correct refusal — re-check after the next ' +
            'control-plane deploy. The per-outcome counts are now queryable: ' +
            "`SELECT source, count() FROM llm_calls WHERE source LIKE 'llm\\_%' GROUP BY source`.";

      // Both failing verdicts are red, and the message above says WHICH — an outage and a
      // vacuous run are opposite findings and a gate that prints one string for both is how
      // this predicate got read wrong twice already [FOLLOW-1056, FOLLOW-1059].
      expect(isProbeConclusive(verdict), failureMessage).toBe(true);
    },
    MAX_HOLDOUT_RETRY_ATTEMPTS * ADAPT_BUDGET_MS + 15_000,
  );
});
