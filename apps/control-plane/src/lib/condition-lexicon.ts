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
 *     "gotowe do zamieszkania", "nie wymaga remontu", "listo para entrar a vivir"). Read through
 *     `assertsNoWorkClaim` (FOLLOW-1404): a NEGATED match ("it is not move-in ready") is no claim.
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

import { NEGATED_AFTER_RE, NEGATOR_RE, clauseBefore } from '@/lib/amenity-lexicon';

const W = '\\p{L}\\p{N}_';

function wordRe(patterns: readonly string[], flags: string): RegExp {
  return new RegExp(`(?<![${W}])(?:${patterns.join('|')})(?![${W}])`, flags);
}

/** An outcome promise. Not global: callers `test` it. */
const GUARANTEE_RE = wordRe(
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

/** A claim that the property needs no work. Read through {@link assertsNoWorkClaim}. */
const NO_WORK_CLAIM_RE = wordRe(
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

/** The global twin of `NO_WORK_CLAIM_RE`, for `matchAll`. */
const NO_WORK_CLAIM_ALL_RE = new RegExp(NO_WORK_CLAIM_RE.source, 'giu');

/** "not only" / "not just" / "nie tylko" / "no solo": a negator that affirms what follows. */
const AFFIRMING_NEGATION_RE = wordRe(
  ['(?:not|nie|no) (?:just|only|merely|tylko|s[oó]lo|solamente)'],
  'iu',
);

/**
 * Does `text` claim the property needs no work — at least one match of the no-work vocabulary
 * that is not negated [FOLLOW-1404]?
 *
 * Negation reuses the amenity rule (`NEGATOR_RE` in the same clause within 30 code points before
 * the match, or `NEGATED_AFTER_RE` right after it: "Turnkey: no"), with two limits that keep the
 * check fail-closed:
 *   - a phrase that is itself negative ("no renovation", "nie wymaga remontu", "bez remontu",
 *     "sin reformas") is a claim whatever precedes it — the negator before it belongs to another
 *     phrase ("bez balkonu nie wymaga remontu"), not to the claim;
 *   - "not only" / "not just" / "nie tylko" / "no solo" affirm, they do not negate.
 *
 * Used for the generated text AND for the listing's grounding, on both paths: a listing that says
 * "nie jest gotowe do zamieszkania" no longer grounds "move-in ready".
 *
 * @param text - Generated copy, or the listing's grounding text.
 * @returns `true` when a non-negated no-work claim is present.
 */
export function assertsNoWorkClaim(text: string): boolean {
  for (const m of text.matchAll(NO_WORK_CLAIM_ALL_RE)) {
    if (NEGATOR_RE.test(m[0].split(/\s/u)[0] ?? '')) return true;
    const before = clauseBefore(text, m.index);
    const negatedBefore = NEGATOR_RE.test(before) && !AFFIRMING_NEGATION_RE.test(before);
    if (negatedBefore || NEGATED_AFTER_RE.test(text.slice(m.index + m[0].length))) continue;
    return true;
  }
  return false;
}

/** The global twin of `GUARANTEE_RE`, for `matchAll`. */
const GUARANTEE_ALL_RE = new RegExp(GUARANTEE_RE.source, 'giu');

/**
 * FOLLOW-1408: a negator DIRECTLY before a guarantee, with at most three closed filler words
 * between them — "no guarantee", "is not guaranteed", "aren't guaranteed", "cannot be
 * guaranteed", "not a guarantee", "without any guarantee", "nie ma żadnej gwarancji", "nie jest
 * gwarantowany", "no se garantiza", "no está garantizada", "sin ninguna garantía". Anchored at the
 * end of the text before the match. A content word in between ("No other flat offers guaranteed
 * rent", "not only guaranteed") breaks it.
 */
const GUARANTEE_NEGATED_BEFORE_RE = new RegExp(
  `(?<![${W}])(?:no|not|never|nothing|without|cannot|neither|nor|\\p{L}+n[’']t|bez|brak|braku|nie|ani|nic|sin|ni|nada|tampoco|nunca)` +
    `(?:[ \\t]+(?:a|an|any|the|be|been|is|are|was|were|form|kind|of|such|jest|są|ma|daje|można|się|` +
    `żadnej|żadnych|żadnego|żadna|to|hay|se|es|está|están|existe|ofrece|puede|pueden|ninguna|ningún|ninguno|una|un|la|el)){0,3}` +
    `[ \\t]+$`,
  'iu',
);

/**
 * Does `text` make an outcome promise — at least one match of `GUARANTEE_RE` that is not
 * negated [FOLLOW-1408]?
 *
 * A match is negated only by `GUARANTEE_NEGATED_BEFORE_RE` (a negator directly before it). A
 * phrase that is itself negative ("no risk", "bez ryzyka", "sin riesgo") is a claim whatever
 * precedes it. Used for the generated text AND for the listing's grounding, on both paths: a
 * listing's own "there is no guarantee of income" no longer grounds "guaranteed income".
 *
 * @param text - Generated copy, or the listing's grounding text.
 * @returns `true` when a non-negated guarantee is present.
 */
export function assertsGuarantee(text: string): boolean {
  for (const m of text.matchAll(GUARANTEE_ALL_RE)) {
    if (NEGATOR_RE.test(m[0].split(/\s/u)[0] ?? '')) return true;
    if (GUARANTEE_NEGATED_BEFORE_RE.test(text.slice(0, m.index))) continue;
    return true;
  }
  return false;
}
