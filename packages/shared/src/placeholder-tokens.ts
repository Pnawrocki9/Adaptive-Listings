/**
 * The placeholder-token contract between playbook copy and the adapt route (ESC-074 (b)).
 *
 * Playbook `slots[].en` copy carries `{token}` placeholders. Two things can fill them:
 *
 *   1. `POST /api/adapt`, server-side, from the listing's own facts. That is this list.
 *   2. The SDK, client-side, from a `data-estalara-<token>` attribute on the matched slot
 *      element (`interpolatePlaceholders`, `packages/sdk/src/core/adapt.ts`). Unchanged and
 *      still the second line of defence — a token the server already resolved simply arrives
 *      with nothing left to substitute.
 *
 * If NEITHER fills a token, FOLLOW-1018 discards the whole directive rather than painting raw
 * braces at a buyer. ESC-074 reaffirmed that rule rather than relaxing it, so a token absent
 * from this list AND absent from the page is a DELETED adaptation, not a degraded one.
 *
 * WHY THE LIST LIVES IN `@estalara/shared` AND NOT IN THE ROUTE. It is read from two packages
 * that must not drift: `apps/control-plane/src/lib/placeholder-tokens.ts` keys its resolver
 * table by this exact union (a token added here with no resolver is a TYPE error), and
 * `packages/sdk/src/__tests__/placeholder-token-producers.test.ts` subtracts it from the set
 * of tokens the playbooks actually ship to compute — rather than assert from prose — how many
 * shipped tokens nothing can satisfy.
 *
 * WHAT IS DELIBERATELY NOT HERE. Tokens whose value is not a fact of the listing:
 * `{yield}`, `{income}`, `{nightly_rate}`, `{arv}` and `{monthly_payment}` need rent,
 * renovation or mortgage inputs the listing backend does not carry; `{school_rating}`,
 * `{university}`, `{minutes}`, `{climate}` and `{internet_speed}` need third-party datasets;
 * `{threshold}` is a jurisdiction's golden-visa minimum, a legal constant; and
 * `{key_luxury_feature}` needs an editorial ruling on which amenities read as luxury. Adding
 * any of them here would mean inventing a source, which is the one outcome this module exists
 * to prevent. The residual is tracked in `backlog/ESCALATIONS.md` (ESC-075).
 *
 * @module @estalara/shared/placeholder-tokens
 */

/**
 * Playbook placeholder tokens `POST /api/adapt` fills from the listing's own facts.
 *
 * Ordered alphabetically so a diff to this list reads as one insertion, never as a reshuffle.
 */
export const SERVER_RESOLVED_PLACEHOLDER_TOKENS = [
  'bedrooms',
  'key_feature',
  'location_highlight',
  'neighborhood',
  'sqm',
] as const;

/** A token in {@link SERVER_RESOLVED_PLACEHOLDER_TOKENS}. */
export type ServerResolvedPlaceholderToken = (typeof SERVER_RESOLVED_PLACEHOLDER_TOKENS)[number];

/**
 * Matches a `{token}` placeholder inside playbook copy.
 *
 * Deliberately identical in shape to the SDK's own pattern in `interpolatePlaceholders` — the
 * server must consider exactly the set of runs the client would, or a run the server ignores
 * reaches the client as an unresolved token and deletes the directive anyway.
 *
 * Not a module-level `RegExp` constant with the `g` flag shared between call sites: `lastIndex`
 * is stateful and a shared instance skips matches on alternate calls. Callers build their own.
 */
export const PLACEHOLDER_TOKEN_PATTERN_SOURCE = '\\{([a-z][a-z0-9_]*)\\}';

/**
 * Every distinct `{token}` name in a directive value, lower-cased, in first-seen order.
 *
 * @param value - A directive's copy, e.g. `'Upsize to {bedrooms}BR — {key_feature}'`.
 * @returns `['bedrooms', 'key_feature']`; `[]` when the copy carries no placeholder.
 */
export function extractPlaceholderTokens(value: string): string[] {
  const seen: string[] = [];
  for (const match of value.matchAll(new RegExp(PLACEHOLDER_TOKEN_PATTERN_SOURCE, 'gi'))) {
    // Group 1 always participates when the pattern matches, but this package forbids non-null
    // assertions, so the guard is written out rather than asserted away.
    const token = match[1]?.toLowerCase();
    if (token !== undefined && !seen.includes(token)) seen.push(token);
  }
  return seen;
}
