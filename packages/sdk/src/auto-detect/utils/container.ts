/**
 * Container selector inference (shared across detection techniques).
 *
 * The grid container that wraps all listing cards is required by the Sprint 8
 * ReorderDirective hook (per Master Design B.6). When a technique identifies
 * the listing cards, this helper derives a stable selector for their nearest
 * common ancestor: ID > stable data-* attribute > tag + first class > tag.
 *
 * @module @estalara/sdk/auto-detect/utils/container
 */

/**
 * Volatile class fragments we refuse to bake into a stored container selector.
 * CSS Modules and styled-components both append per-build random hashes after a
 * stable component-name prefix; the hash changes within days. We accept the
 * stable prefix as a `[class*='Prefix']` form instead.
 */
const CSS_MODULES_FULL_HASH_RE = /[A-Z][a-zA-Z]*_[a-zA-Z]+__[a-z0-9]{4,8}/;
const STYLED_COMPONENTS_HASH_RE = /-sc-[a-f0-9]{8}-\d+/;

/** Stable, semantically meaningful CamelCase prefixes for partial-class matches. */
const STABLE_CAMEL_PREFIX_RE = /^([A-Z][a-z]+[A-Z][a-zA-Z]+)/;

/**
 * Derive a container selector from the first detected listing card element.
 * Returns `null` when no usable ancestor signal is found.
 */
export function inferContainerSelector(card: Element | null): string | null {
  if (!card) return null;
  const parent = card.parentElement;
  if (!parent || parent.tagName === 'BODY' || parent.tagName === 'HTML') return null;
  return buildStableSelector(parent);
}

/**
 * Build a stable CSS selector for an element using the cheapest unique signal
 * available. Volatile CSS Modules / styled-components hashes are stripped.
 */
export function buildStableSelector(el: Element): string | null {
  const tag = el.tagName.toLowerCase();

  if (el.id && !/^\d/.test(el.id)) {
    return `${tag}#${el.id}`;
  }

  // Stable data-* attributes first (data-testid / data-cy / data-path).
  for (const attr of el.attributes) {
    if (attr.name === 'data-testid' || attr.name === 'data-cy') {
      return `${tag}[${attr.name}='${attr.value}']`;
    }
  }

  // First non-volatile class.
  for (const cls of el.classList) {
    if (CSS_MODULES_FULL_HASH_RE.test(cls)) {
      // Use the stable CamelCase prefix as a partial match.
      const m = STABLE_CAMEL_PREFIX_RE.exec(cls);
      if (m?.[1]) return `${tag}[class*='${m[1]}']`;
      continue;
    }
    if (STYLED_COMPONENTS_HASH_RE.test(cls)) {
      const m = STABLE_CAMEL_PREFIX_RE.exec(cls);
      if (m?.[1]) return `${tag}[class*='${m[1]}']`;
      continue;
    }
    // Skip Angular scope attributes-as-classes and other obvious hashes.
    if (cls.startsWith('_ngcontent') || cls.startsWith('ng-tns')) continue;
    return `${tag}.${cls}`;
  }

  return tag;
}
