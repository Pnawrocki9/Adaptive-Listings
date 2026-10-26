/**
 * The guarantee and "no work needed" vocabulary of the claim checks, in every supported language —
 * FOLLOW-1393.
 *
 * One closed list, shared by the description path (`grounding-check.ts`) and `/api/adapt`
 * (`claim-containment.ts`), like the amenity list (`lib/amenity-lexicon.ts`). Until FOLLOW-1393 it
 * was English only and lived twice: an English page whose Polish original says "Mieszkanie jest
 * wykończone" ("the flat is finished") had "move-in ready" and "no renovation to plan" refused as
 * `unsupported_guarantee`, and a Polish or Spanish guarantee was never checked at all.
 *
 *   - `GUARANTEE_RE` — an outcome promise ("guaranteed return", "gwarantowany zysk", "rentabilidad
 *     garantizada", "risk-free", "bez ryzyka"). Grounded ONLY by the listing's own guarantee, in
 *     any language (the seller's claim, ESC-076). A condition fact never grounds it.
 *   - `NO_WORK_CLAIM_RE` — a claim that nothing needs doing ("move-in ready", "no renovation",
 *     "gotowe do zamieszkania", "nie wymaga remontu", "listo para entrar a vivir").
 *   - `CONDITION_FACT_RE` — a condition fact in the listing that grounds such a claim ("fully
 *     renovated", "wykończone", "do zamieszkania", "po remoncie", "gotowe do wprowadzenia",
 *     "reformado", "a estrenar"). Global: callers read it NON-negated, so "nie jest wykończone"
 *     grounds nothing. "Do wykończenia" (to be finished) and "stan deweloperski" (shell) are not
 *     condition facts.
 *
 * Closed and deterministic: Unicode word boundaries, no fuzzy matching, no model call. Pure, no I/O.
 *
 * @module apps/control-plane/src/lib/condition-lexicon
 */

const W = '\\p{L}\\p{N}_';

function wordRe(patterns: readonly string[], flags: string): RegExp {
  return new RegExp(`(?<![${W}])(?:${patterns.join('|')})(?![${W}])`, flags);
}

/** An outcome promise. Not global: callers `test` it. */
export const GUARANTEE_RE = wordRe(
  [
    // en
    'guarantee(?:d|s)?',
    'risk[- ]free',
    '(?:no|zero)[- ]risk',
    'assured (?:income|returns?|yields?|rent)',
    // pl
    'gwaran[ct]\\p{L}*',
    'bez(?: żadnego)? ryzyka',
    'zero ryzyka',
    '(?:pewn|zapewnion)\\p{L}* (?:zysk|zwrot|doch[oó]d|przych[oó]d|czynsz|najem|rentowno[sś][cć])\\p{L}*',
    // es
    'garantiz\\p{L}*',
    'garant[ií]as?',
    'sin riesgos?',
    'riesgo cero',
    '(?:rentabilidad|ingresos?|alquiler|rendimientos?)(?: \\p{L}+)? asegurad\\p{L}*',
  ],
  'iu',
);

/** A claim that the property needs no work. Not global: callers `test` it. */
export const NO_WORK_CLAIM_RE = wordRe(
  [
    // en (the FOLLOW-1305 patterns, unchanged)
    '(?:no|zero) (?:work|works|renovation|repairs?|refurbishment)',
    '(?:needs?|requires?) no (?:work|works|renovation|repairs?)',
    `nothing (?:here )?(?:needs|requires) (?:work|doing|fixing|renovat[${W}]*)`,
    'turn-?key',
    'move[- ]in[- ]ready',
    'ready to move in',
    // pl
    'gotow\\p{L}* do (?:zamieszkania|wprowadzenia|wprowadzki)',
    'do zamieszkania od (?:zaraz|razu)',
    'bez (?:konieczności |potrzeby )?(?:remontu|nakładów|prac remontowych)',
    'nie wymaga (?:żadnego |żadnych )?(?:remontu|nakładów|prac|inwestycji)',
    'pod klucz',
    'wprowad[źz]\\p{L}* się od (?:razu|zaraz)',
    // es
    'list[oa]s? para (?:entrar a vivir|vivir|mudarse|habitar|entrar)',
    'para entrar a vivir',
    'sin (?:necesidad de )?(?:reformas?|obras)',
    'no (?:necesita|requiere) (?:ninguna |ningún )?(?:reformas?|obras|arreglos?)',
    'llave en mano',
  ],
  'iu',
);

/** A condition fact that grounds a no-work claim. Global: callers read it non-negated. */
export const CONDITION_FACT_RE = wordRe(
  [
    // en (the FOLLOW-1305 patterns, unchanged)
    '(?:fully|newly|recently|completely) (?:renovated|refurbished|restored)',
    'new[- ]build',
    'newly built',
    'turn-?key',
    'move[- ]in[- ]ready',
    'ready to move in',
    'no work needed',
    // pl
    'wykończon\\p{L}*',
    'do zamieszkania',
    'gotow\\p{L}* do (?:zamieszkania|wprowadzenia|wprowadzki)',
    'po (?:generalnym |kapitalnym |całkowitym |gruntownym )?remoncie',
    'wyremontowan\\p{L}*',
    'pod klucz',
    'nie wymaga (?:żadnego |żadnych )?(?:remontu|nakładów)',
    // es
    'reformad[oa]s?',
    'a estrenar',
    'list[oa]s? para (?:entrar a vivir|vivir|entrar)',
    'para entrar a vivir',
    'obra nueva',
    'llave en mano',
    'sin necesidad de reformas?',
  ],
  'giu',
);
