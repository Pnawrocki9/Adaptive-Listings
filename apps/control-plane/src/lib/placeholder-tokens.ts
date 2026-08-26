/**
 * Server-side resolution of playbook `{token}` placeholders (ESC-074 (b) / FOLLOW-1140).
 *
 * THE DEFECT THIS CLOSES. Playbook copy carries `{token}` placeholders that the SDK fills from
 * a `data-estalara-<token>` attribute on the matched slot element. FOLLOW-1018 made an
 * unresolved token discard the WHOLE directive — correctly, because the alternative had put raw
 * `{key_luxury_feature}` braces in front of production buyers. But nothing ever enforced the
 * producer half: 15 of the 17 tokens the playbooks ship had no emitter anywhere in the estate,
 * so on a real tenant page most archetypes did not degrade, they DELETED their headline, with
 * no error and nothing user-visible. ESC-074 ruled that the route must fill what it can from
 * the listing's own facts, so no unresolved token leaves the server.
 *
 * WHAT THIS MODULE REFUSES TO DO, and why that is the point:
 *
 * - **It never invents a value.** A token whose fact is missing stays unresolved and its
 *   directive is dropped. There is no default, no placeholder-for-the-placeholder, and no
 *   "reasonable estimate". A headline that states a figure the listing does not carry is a
 *   fabricated claim shown to a buyer, which is strictly worse than showing the tenant's own
 *   copy.
 * - **It never partially renders.** ESC-074 reaffirmed FOLLOW-1018: one unresolved token
 *   discards the directive even when its siblings resolved.
 * - **It never widens the token set to cover copy it cannot ground.** The five resolvable
 *   tokens are declared in `@estalara/shared`; the twelve that are not resolvable from any data
 *   this route holds are recorded in ESC-075 rather than papered over here.
 *
 * The client-side resolver stays exactly as it was. A token this module fills simply arrives at
 * the SDK with nothing left to substitute; a token it cannot fill never arrives at all.
 *
 * @module apps/control-plane/src/lib/placeholder-tokens
 */

import * as Sentry from '@sentry/nextjs';
import {
  SERVER_RESOLVED_PLACEHOLDER_TOKENS,
  extractPlaceholderTokens,
  type ServerResolvedPlaceholderToken,
  type TextDirective,
} from '@estalara/shared';

import { fetchListingPlaceholderFacts, type ListingPlaceholderFacts } from '@/lib/listing-details';

/** Runtime membership test for the shared contract — used to decide whether a fetch is worth it. */
const RESOLVABLE = new Set<string>(SERVER_RESOLVED_PLACEHOLDER_TOKENS);

/** A non-blank string, or `null`. Blank strings are absent facts wearing a value's costume. */
function text(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? null : trimmed;
}

/**
 * Render a numeric fact without a spurious `.0` — `128.5` → `'128.5'`, `128.0` → `'128'`.
 * The copy reads `'{sqm}m²'`, so trailing precision the backend stores but nobody quotes would
 * only make the headline look machine-generated.
 */
function number(value: number | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return String(Number(value.toFixed(1)));
}

/**
 * One resolver per token in the shared contract.
 *
 * The `Record<ServerResolvedPlaceholderToken, …>` annotation is load-bearing: adding a token to
 * `SERVER_RESOLVED_PLACEHOLDER_TOKENS` without a resolver here is a compile error, and a
 * resolver here for a token not in the contract is one too. That is what keeps the list the SDK
 * register test reads from drifting away from the behaviour it describes.
 */
const RESOLVERS: Record<
  ServerResolvedPlaceholderToken,
  (facts: ListingPlaceholderFacts) => string | null
> = {
  // A studio is `bedrooms: 0`, and "Easy Living — 0BR with Lift" is a true number in a sentence
  // it makes false. Unresolved is the honest answer; the tenant's own copy then stands.
  bedrooms: (f) => (typeof f.bedrooms === 'number' && f.bedrooms > 0 ? String(f.bedrooms) : null),
  sqm: (f) => number(f.livingArea),
  // The agent's own first bullet. Their ordering IS the priority signal — we do not re-rank it.
  key_feature: (f) => text(f.highlights?.[0]),
  // `district` is the neighbourhood; `city` is the coarser truth when a listing has no district.
  neighborhood: (f) => text(f.district) ?? text(f.city),
  // The label the backend has already cleared for public display under `locationDisclosureLevel`.
  location_highlight: (f) => text(f.publicLocationLabel) ?? text(f.district) ?? text(f.city),
};

/**
 * Outcome of resolving a directive set.
 *
 * Deliberately NOT exported. It is the return type of {@link resolvePlaceholderDirectives}, and
 * the one call site destructures the result rather than naming the type — so exporting it adds a
 * public symbol nothing imports, which is exactly what the wired-or-dead gate (Rule I) exists to
 * catch. Consumers still get the full shape structurally through the function's inferred return
 * type, and this app compiles with `noEmit`, so no declaration file needs the name either. If a
 * second call site ever needs to name it, export it THEN and with that importer in the same PR.
 */
interface PlaceholderResolution {
  /** Directives that carry no `{token}` at all, plus those whose every token resolved. */
  directives: TextDirective[];
  /**
   * Distinct token names that caused at least one directive to be dropped, sorted.
   * Empty when nothing was dropped — which is the only state that is not a defect somewhere.
   */
  droppedTokens: string[];
}

/**
 * Substitute every `{token}` the listing's facts can satisfy, and drop the directives they cannot.
 *
 * Cost discipline — this runs on the playbook-DIRECT branch, which otherwise performs no I/O
 * after the decision:
 *
 * - No token anywhere in the directive set → returns immediately, no fetch.
 * - Every token-carrying directive names at least one token outside the shared contract → those
 *   directives are unresolvable whatever the listing says, so they are dropped WITHOUT a fetch.
 * - Otherwise exactly one listing-details fetch, bounded by its own 800 ms budget.
 *
 * @param directives - Playbook directives, pre-locale/variant resolution.
 * @param listingId  - `body.listing_id`; absent means there is nothing to resolve FROM.
 * @param locale     - Content locale, forwarded to the listing-details backend.
 */
export async function resolvePlaceholderDirectives(
  directives: TextDirective[],
  listingId: string | undefined,
  locale: 'en' | 'pl' | 'es',
): Promise<PlaceholderResolution> {
  const tokensPerDirective = directives.map((d) => extractPlaceholderTokens(d.value));
  if (tokensPerDirective.every((tokens) => tokens.length === 0)) {
    return { directives, droppedTokens: [] };
  }

  const anyDirectiveCouldResolve = tokensPerDirective.some(
    (tokens) => tokens.length > 0 && tokens.every((t) => RESOLVABLE.has(t)),
  );

  const facts =
    anyDirectiveCouldResolve && listingId
      ? await fetchListingPlaceholderFacts(listingId, locale)
      : null;

  const values = new Map<string, string>();
  if (facts) {
    for (const token of SERVER_RESOLVED_PLACEHOLDER_TOKENS) {
      const value = RESOLVERS[token](facts);
      if (value !== null) values.set(token, value);
    }
  }

  const kept: TextDirective[] = [];
  const dropped = new Set<string>();

  directives.forEach((directive, index) => {
    const tokens = tokensPerDirective[index] ?? [];
    if (tokens.length === 0) {
      kept.push(directive);
      return;
    }
    const missing = tokens.filter((token) => !values.has(token));
    if (missing.length > 0) {
      for (const token of missing) dropped.add(token);
      return;
    }
    kept.push({
      ...directive,
      value: directive.value.replace(
        /\{([a-z][a-z0-9_]*)\}/gi,
        (match, token: string) => values.get(token.toLowerCase()) ?? match,
      ),
    });
  });

  return { directives: kept, droppedTokens: [...dropped].sort() };
}

/**
 * Make a server-side drop visible where operators already look.
 *
 * Same vocabulary as the SDK's `adapt.skipped { reason: 'unresolved_token_<name>' }` — this is
 * the SERVER end of that stream, not a parallel channel — and the same shape as this route's
 * other Sentry signals (`pre_llm_stall`, `directive_fact_check_violation`). It is a warning and
 * not an error: for the twelve tokens ESC-075 records as unsatisfiable, the drop is the system
 * behaving correctly under a known gap, and paging on a known gap trains people to ignore pages.
 *
 * @param droppedTokens - From {@link resolvePlaceholderDirectives}; caller checks for non-empty.
 * @param context       - Session/tenant/archetype, for correlating with `adaptation_decisions`.
 */
export function reportDroppedPlaceholderDirectives(
  droppedTokens: string[],
  context: { sessionId: string; tenantId: string; archetype: string; listingId?: string },
): void {
  const detail = { ...context, unresolved_tokens: droppedTokens };
  console.warn('[adapt] directive dropped — unresolved placeholder token', JSON.stringify(detail));
  Sentry.captureMessage('adapt unresolved placeholder token', {
    level: 'warning',
    tags: {
      area: 'adapt',
      kind: 'unresolved_placeholder_token',
      // One tag per event would be unqueryable; the first token sorted is a stable grouping key
      // and the full list is on `extra`.
      token: droppedTokens[0] ?? 'unknown',
    },
    extra: detail,
  });
}
