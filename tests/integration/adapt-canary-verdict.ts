/**
 * FOLLOW-1022 canary — the predicate, extracted so it can be tested without production.
 *
 * WHY IT IS A MODULE NOW. It lived inside `adapt-llm-source-live.smoke.test.ts`, where the
 * only thing that ever exercised it was a live production response. That is how it shipped
 * classifying `source: "default"` — the A/B holdout, which returns before any LLM call — as a
 * PASS, for ~11% of every run this canary has ever made [FOLLOW-1059].
 *
 * @module tests/integration/adapt-canary-verdict
 */

/**
 * Sources that mean the LLM path ran and did not serve. Necessary but NOT sufficient for a red
 * — see `verdictFor`, which reads `fallback_reason` to decide which kind of not-serving it was.
 */
export const FALLBACK_SOURCES = ['playbook_fallback_llm_unavailable'];

/**
 * Sources that mean the LLM band actually produced the response — the only two outcomes that
 * make this canary's assertion about production non-vacuous.
 *
 * `llm_tweaked` is Haiku's band (the one this probe requests via `similarity: 0.7`);
 * `llm_full` is Sonnet's, reachable at `similarity <= 0.6`. Both are listed because the band
 * the DECISION TREE picks is production's call, not the probe's — an assertion that hard-codes
 * one of them would go red on a routing change that generated copy perfectly well.
 */
export const BAND_SOURCES = ['llm_tweaked', 'llm_full'];

export interface AdaptProbeResponse {
  source: string;
  /**
   * FOLLOW-1056. Deliberately `string | undefined`: this probe reads a value produced by
   * whatever build is deployed, which may predate the field (absent) or postdate this file (a
   * value the union does not have yet).
   */
  fallback_reason?: string;
  /**
   * FOLLOW-1210. Present and `true` ONLY on the A/B-holdout early return in `route.ts` — the
   * consent-skip, `adaptive_listings_off` and `profiling_opt_out` early returns all also answer
   * `source: "default"` but never set this field. It is what lets `isHoldoutDraw` tell "this
   * request drew the holdout" apart from every other `band_not_exercised` cause.
   */
  holdout_group?: boolean;
}

/**
 * What the probed response says happened.
 *
 * Four outcomes, not three: `band_not_exercised` is UNDETERMINED — the request never reached
 * the LLM at all, so the run is evidence about neither availability nor the fact check
 * (Rule AV clause 4). It is deliberately NOT folded into `llm_unavailable`: reporting a
 * holdout assignment as an outage is the exact conflation FOLLOW-1056 just removed from the
 * other axis of this predicate.
 */
export type ProbeVerdict =
  | 'generated'
  | 'correctly_refused'
  | 'llm_unavailable'
  | 'band_not_exercised'
  | 'grounding_unavailable';

/**
 * FOLLOW-1056 AC(7) narrowed this on one axis; FOLLOW-1059 closes the other.
 *
 * `playbook_fallback_llm_unavailable` covers two OPPOSITE worlds — the LLM was unavailable (an
 * incident) and the model wrote ungrounded copy that the fact check refused to serve (the
 * pipeline working, fail-closed). `fallback_reason` separates them; an ABSENT reason stays
 * `llm_unavailable` on purpose, because absence means the deployed build predates FOLLOW-1056
 * and the honest verdict is the conservative one.
 *
 * Everything that is neither a band source nor that fallback — `default` (A/B holdout, returns
 * before any LLM call), `playbook` (similarity above the band), `playbook_fallback_llm_capped`
 * (spend cap, the gateway is never called), and any `source` value added after this file — is
 * `band_not_exercised`. The default arm is the unknown-value arm on purpose: a new `source`
 * this file has never seen is not evidence that production generated anything.
 *
 * WHAT A `correctly_refused` NO LONGER PROVES, stated because it changed under this predicate
 * without the predicate moving. **A `cta` proper-name flag can no longer produce
 * `fact_check_refused` at all** — `llm-gateway.ts`'s provenance exemption clears it before the
 * fact check can refuse the batch [FOLLOW-1177] — so a green run is weaker evidence about the CTA
 * axis than the same green was before that deploy. And an over-budget batch (more proper-name
 * flags than the band's judge budget) reaches `fact_check_refused` WITHOUT adjudicating any of
 * them [FOLLOW-1183], so this predicate cannot tell an adjudicated refusal from a budget-bound
 * one: both are `correctly_refused` and both pass. Neither is a defect of the canary and neither
 * is fixed here — the verdict mapping is deliberately unchanged. What distinguishes them is
 * `llm_calls.source`: `fact_check_unjudged_exempt_authored` and
 * `fact_check_unjudged_over_budget_flags_*`, counted by MEASURED_PREMISES MP-012's saved query.
 */
export function verdictFor(body: AdaptProbeResponse): ProbeVerdict {
  if (BAND_SOURCES.includes(body.source)) return 'generated';
  if (FALLBACK_SOURCES.includes(body.source)) {
    if (body.fallback_reason === 'fact_check_refused') return 'correctly_refused';
    // FOLLOW-1120 / ESC-072. The model was called and answered; its prompt simply had no listing
    // facts in it, because the upstream listing-details fetch returned non-OK. That is a
    // production fault in a DIFFERENT service, and — decisively for a gate that runs on pull
    // requests — one that no PR diff can cause: this probe reads a deployed origin, so it renders
    // no verdict on the branch it runs from.
    if (body.fallback_reason === 'listing_context_unavailable') return 'grounding_unavailable';
    return 'llm_unavailable';
  }
  return 'band_not_exercised';
}

/**
 * FOLLOW-1210. Bounded retry budget for a holdout draw before this canary gives up and reports
 * `band_not_exercised` for real. `assignHoldout` is an independent HMAC coin flip per
 * `session_id` at the configured rate (0.1 — `DEFAULT_HOLDOUT_PCT`,
 * `packages/shared/src/ab-holdout.ts`), and this probe mints a fresh session per attempt, so
 * three consecutive holdout draws happen with probability 0.1 ** 3 = 0.001 — rare enough that
 * exhausting the budget is itself worth reporting as a finding, not silently swallowing.
 */
export const MAX_HOLDOUT_RETRY_ATTEMPTS = 3;

/**
 * Is this response the real A/B-holdout early return, as opposed to any of the other
 * `source: "default"` early returns (consent-skip, `adaptive_listings_off`,
 * `profiling_opt_out`) or a genuinely dead LLM path?
 *
 * WHY THIS EXISTS (FOLLOW-1210 / RETRO-329 §4a LG-1). Since #902 (FOLLOW-1201), `holdout_pct` in
 * the POST body is honoured only for the ops-bearer caller — every other caller, including this
 * smoke probe's tenant key, draws holdout at the CONFIGURED rate regardless of what it sends.
 * `holdout_pct: 0` in the request body is therefore not a guarantee any more, and about 1 run in
 * 10 legitimately lands here. Before this file could tell that apart from the other
 * `band_not_exercised` causes, a holdout draw turned a REGISTERED required gate red on a request
 * that behaved exactly as designed.
 *
 * Keyed on `source === "default"` AND `holdout_group === true` together — matching the exact
 * shape `route.ts`'s holdout early return answers with, never a guess at it.
 */
export function isHoldoutDraw(body: AdaptProbeResponse): boolean {
  return body.source === 'default' && body.holdout_group === true;
}

/**
 * The `band_not_exercised` failure message, extracted so it can be asserted on without a live
 * probe (Rule AU: a gate must stay testable for the behaviour it is named for).
 *
 * `attempts` is how many independent requests (fresh `session_id` each) this run made before
 * giving up — 1 for a non-holdout cause, up to `MAX_HOLDOUT_RETRY_ATTEMPTS` when every attempt
 * drew the holdout.
 */
export function bandNotExercisedMessage(body: AdaptProbeResponse, attempts = 1): string {
  const holdout = isHoldoutDraw(body);
  const exhausted = holdout && attempts >= MAX_HOLDOUT_RETRY_ATTEMPTS;
  const causes = holdout
    ? [
        exhausted
          ? `every one of ${String(attempts)} attempts (a fresh session_id each) drew the A/B ` +
            `holdout (holdout_group=true) — since FOLLOW-1201, holdout_pct in the body is ` +
            "honoured only for the ops-bearer caller, so this probe's tenant key draws holdout " +
            `at the configured rate independent of the holdout_pct: 0 it sends. ` +
            `${String(attempts)} consecutive draws at that rate happen with probability ` +
            `0.1 ** ${String(attempts)} ≈ ${(0.1 ** attempts).toPrecision(2)} — rare, but ` +
            'this is that rare case, not a build defect'
          : `this attempt drew the A/B holdout (holdout_group=true) — since FOLLOW-1201, ` +
            "holdout_pct in the body is honoured only for the ops-bearer caller, so this probe's " +
            'tenant key draws holdout at the configured rate independent of the holdout_pct: 0 ' +
            'it sends',
      ]
    : [
        'the similarity band moved and 0.7 now lands above it (`playbook`)',
        'the LLM spend cap is hit (`playbook_fallback_llm_capped`)',
        '`source` gained a value this spec has never seen, in which case teach `BAND_SOURCES` ' +
          'about it rather than widening the pass',
      ];

  return (
    `/api/adapt returned source="${body.source}" from a request that asked for the LLM band ` +
    `with holdout_pct: 0 — THE BAND WAS NOT EXERCISED, so this run is evidence about neither ` +
    'availability nor the fact check. It is UNDETERMINED, not a pass and not an outage ' +
    '[FOLLOW-1059, Rule AV clause 4]. Reachable causes, in the order worth checking: ' +
    `${causes.join('; ')}. Confirm which with: SELECT source, holdout_group, count() FROM ` +
    "adaptation_decisions WHERE session_id LIKE 'canary-follow1022-%' GROUP BY source, " +
    'holdout_group.'
  );
}

/**
 * Three states, not two — the shape `Rule I` and the required-check register already use.
 *
 * WHY A THIRD STATE (ESC-072). `Adapt LLM-source canary` is a registered required gate, so a red
 * blocks every merge in the repository. On 2026-08-24 an intermittent upstream grounding outage
 * flapped for hours (`tokens_in` 902 when grounded, 558 when not) and held a PR whose diff touched
 * no adapt-path code. Both available workarounds were worse than the problem: re-running until a
 * green window is caught is what this spec's own docblock forbids ("a canary that fails for its
 * own reasons is worse than no canary"), and adding the gate to the documented pre-existing-red
 * list would erase the distinction the gate exists to draw.
 *
 * So the gate keeps saying the true thing and stops saying the false one. `undetermined` is
 * REPORTED LOUDLY and does not fail: production really is degraded and someone should fix it
 * (FOLLOW-1120), but the run is not evidence about the pull request. `fail` is reserved for the
 * two states that ARE evidence: the LLM path is dead, or the probe never reached the band at all.
 */
export type ProbeOutcome = 'pass' | 'fail' | 'undetermined';

export function probeOutcome(verdict: ProbeVerdict): ProbeOutcome {
  if (verdict === 'generated' || verdict === 'correctly_refused') return 'pass';
  if (verdict === 'grounding_unavailable') return 'undetermined';
  return 'fail';
}

/**
 * Did the run observe the thing this canary exists to observe?
 *
 * `generated` and `correctly_refused` are both real observations of the LLM band and both pass.
 * `llm_unavailable` is the regression the gate was built for. `band_not_exercised` fails too,
 * for the opposite reason: it saw nothing. A green that proves nothing is the failure mode
 * Rule AU names, and it is worse than a red — it is counted as coverage.
 */
export function isProbeConclusive(verdict: ProbeVerdict): boolean {
  return probeOutcome(verdict) === 'pass';
}
