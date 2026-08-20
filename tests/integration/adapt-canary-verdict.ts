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
  | 'band_not_exercised';

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
 */
export function verdictFor(body: AdaptProbeResponse): ProbeVerdict {
  if (BAND_SOURCES.includes(body.source)) return 'generated';
  if (FALLBACK_SOURCES.includes(body.source)) {
    return body.fallback_reason === 'fact_check_refused' ? 'correctly_refused' : 'llm_unavailable';
  }
  return 'band_not_exercised';
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
  return verdict === 'generated' || verdict === 'correctly_refused';
}
