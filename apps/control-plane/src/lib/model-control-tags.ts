/**
 * Model-control tags that must never reach a buyer — FOLLOW-1390.
 *
 * A Haiku 5.5 description body opened with `<reasoning_effort>8</reasoning_effort>`: a 5.x model
 * can echo its own control markup into the text. Both paths refuse a text that carries one — the
 * description contract (`bodyViolatesContract`, `residual_tag`), the description headline, and
 * every `/api/adapt` directive slot (`residual_tag`). Refused, never stripped: a text that leaked
 * its control markup may have leaked its reasoning with it.
 *
 * Covered: an opening or closing tag whose name starts with `reasoning`, `thinking` or `effort`
 * (`<reasoning_effort>`, `</thinking>`, `<thinking_budget …>`, `<effort>`), any case, also when the
 * tag is cut off at the end of the text. The description path's own tags
 * (`<adaptation_verdict`, `<verified_facts_used`, `<neutral_reason`) stay in `grounding-check.ts`.
 *
 * @module apps/control-plane/src/lib/model-control-tags
 */

const MODEL_CONTROL_TAG_RE = /<\/?\s*(?:reasoning|thinking|effort)[a-z_]*(?=[\s>/]|$)/iu;

/**
 * Does `text` carry a model-control tag?
 *
 * @param text - A generated description body, headline or directive value.
 * @returns `true` when the text must be refused as `residual_tag`.
 */
export function hasModelControlTag(text: string): boolean {
  return MODEL_CONTROL_TAG_RE.test(text);
}
