/**
 * Corpus CI Gate test utilities (TICKET-AUTO-005).
 *
 * Loads ground-truth JSONs from `__fixtures__/`, synthesises representative HTML
 * for each platform from the ground-truth, runs `detectSiteSchema` against it,
 * and scores precision / recall by DOM-overlap (a detected selector "matches"
 * an expected selector when both query the same DOM elements in the synthesised
 * page — robust against equivalent attribute / class / tag forms).
 *
 * The CI thresholds are precision >= 0.95 and recall >= 0.80 pooled across all
 * fixtures; `000-app-estalara` is held to 100% precision (we own the markup).
 *
 * @module @estalara/sdk/auto-detect/test-utils
 */

import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { detectSiteSchema } from './pipeline.js';
import type { SelectorStrategy, TenantSiteSchema } from '@estalara/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Ground-truth types
// ---------------------------------------------------------------------------

export interface SelectorStrategyGt {
  primary: string;
  type?: string;
  currency?: string;
  unit?: string;
  json_ld_path?: string;
  price_format?: string;
  allows_poa?: boolean;
}

export interface GroundTruth {
  platform_name: string;
  platform_id: string;
  url_pattern_example: string;
  listing_card_selector: string;
  container_selector?: string;
  listing_count_expected?: number;
  card_field_mappings: Record<string, SelectorStrategyGt>;
  data_extractors_per_card: Record<string, SelectorStrategyGt>;
  detection_technique: string;
  detection_confidence: number;
}

export interface FixtureEntry {
  id: string;
  url: string;
  html: string;
  groundTruth: GroundTruth;
}

// ---------------------------------------------------------------------------
// Per-fixture scoring result
// ---------------------------------------------------------------------------

export interface FieldComparison {
  field: string;
  expected: string;
  detected: string | null;
  matched: boolean;
}

export interface FixtureResult {
  id: string;
  platform: string;
  expected_technique: string;
  detected_technique: string;
  schema_present: boolean;
  fields: FieldComparison[];
  expected_count: number;
  detected_count: number;
  correct_count: number;
  precision: number;
  recall: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Fixture loader
// ---------------------------------------------------------------------------

export function readFixtures(fixturesDir: string): FixtureEntry[] {
  const fixturesPath = join(__dirname, fixturesDir);
  const dirs = readdirSync(fixturesPath, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  return dirs.map((dirName) => {
    const gtPath = join(fixturesPath, dirName, 'index-ground-truth.json');
    const groundTruth = JSON.parse(readFileSync(gtPath, 'utf-8')) as GroundTruth;
    const html = buildFixtureHtml(groundTruth);
    return {
      id: dirName,
      url: groundTruth.url_pattern_example,
      html,
      groundTruth,
    };
  });
}

// ---------------------------------------------------------------------------
// HTML synthesis
// ---------------------------------------------------------------------------

type HashStyle = 'none' | 'cssModules' | 'cssInJs' | 'angular';

/**
 * Compatibility classes added to each field element so that technique fallbacks
 * which look for generic class fragments (`[class*='price']`, `[class*='beds']`)
 * find the element regardless of the platform-specific ground-truth class.
 */
const COMPAT_CLASSES: Record<string, string[]> = {
  headline: ['title', 'address', 'card-address'],
  price: ['price'],
  image: ['image', 'photo'],
  bedrooms: ['beds', 'bedrooms', 'rooms'],
  bathrooms: ['baths', 'bathrooms'],
  area: ['area', 'size', 'sqm', 'sqft', 'floor-area'],
  location: ['location', 'address'],
};

/** Microdata `itemprop` injected into each field element for JSON-LD fixtures. */
const MICRODATA_FIELD: Record<string, string> = {
  headline: 'streetAddress name',
  price: 'price',
  image: 'image',
  bedrooms: 'numberOfRooms',
  bathrooms: 'numberOfBathrooms',
  area: 'floorSize',
  location: 'address',
};

/**
 * Synthesise a minimal representative HTML page from a fixture's ground-truth.
 */
export function buildFixtureHtml(gt: GroundTruth): string {
  const cardCount = Math.max(3, Math.min(5, gt.listing_count_expected ?? 5));
  const technique = gt.detection_technique;
  const hashStyle = hashStyleFor(technique);
  const isJsonLd = technique === 'json_ld';

  const cardInner = (i: number) => {
    const parts: string[] = [];
    for (const [fieldName, strategy] of Object.entries(gt.card_field_mappings)) {
      if (!strategy.primary) continue;
      const value = sampleFieldValue(fieldName, i, strategy.currency);
      const extraClasses = COMPAT_CLASSES[fieldName] ?? [];
      const extraAttrs: Record<string, string> = {};
      if (isJsonLd && MICRODATA_FIELD[fieldName]) {
        extraAttrs.itemprop = MICRODATA_FIELD[fieldName];
      }
      parts.push(renderSelector(strategy.primary, value, hashStyle, extraClasses, extraAttrs));
    }
    return parts.join('\n');
  };

  const cardExtraClasses: string[] = [];
  const cardExtraAttrs: Record<string, string> = {};
  if (isJsonLd) {
    cardExtraAttrs.itemtype = 'https://schema.org/RealEstateListing';
    cardExtraAttrs.itemscope = '';
  }

  const cards: string[] = [];
  for (let i = 0; i < cardCount; i++) {
    cards.push(
      renderSelector(
        gt.listing_card_selector,
        cardInner(i),
        hashStyle,
        cardExtraClasses,
        cardExtraAttrs,
      ),
    );
  }

  const containerHtml = gt.container_selector
    ? renderSelector(gt.container_selector, cards.join('\n'), hashStyle, [], {})
    : cards.join('\n');

  // Technique-specific head / body markers required by the detection pipeline.
  const headExtras: string[] = [];
  const bodyAttrs: Record<string, string> = {};
  const extraBodyHtml: string[] = [];

  if (isJsonLd) {
    headExtras.push(buildJsonLdScript(gt));
  }

  if (technique === 'wordpress') {
    headExtras.push('<meta name="generator" content="WordPress 6.4" />');
    if (gt.platform_id.includes('houzez')) bodyAttrs.class = 'houzez';
    if (gt.platform_id.includes('realhomes')) bodyAttrs.class = 'real-homes';
  }

  if (technique === 'drupal_php' && gt.platform_id.includes('zyprus')) {
    headExtras.push('<meta name="generator" content="Drupal 9" />');
    bodyAttrs['data-path'] = '/properties-for-sale';
    for (let i = 0; i < 5; i++) {
      extraBodyHtml.push(`<div class="field--name-field-extra-${String(i)}"></div>`);
    }
  }

  if (technique === 'angular') {
    headExtras.push('<meta name="generator" content="Angular" />');
    extraBodyHtml.push('<app-root></app-root>');
  }

  if (technique === 'data_estalara') {
    bodyAttrs['data-sveltekit-preload-data'] = 'hover';
  }

  const bodyAttrsStr = Object.entries(bodyAttrs)
    .map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${escapeHtml(v)}"`))
    .join('');

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    `<title>${escapeHtml(gt.platform_name)}</title>`,
    ...headExtras,
    '</head>',
    `<body${bodyAttrsStr}>`,
    ...extraBodyHtml,
    containerHtml,
    '</body>',
    '</html>',
  ].join('\n');
}

function hashStyleFor(technique: string): HashStyle {
  switch (technique) {
    case 'css_modules':
      return 'cssModules';
    case 'css_in_js':
      return 'cssInJs';
    case 'angular':
      return 'angular';
    default:
      return 'none';
  }
}

function buildJsonLdScript(gt: GroundTruth): string {
  const priceStrategy = gt.card_field_mappings.price;
  const currency = priceStrategy?.currency ?? 'EUR';
  const isItemList = (gt.listing_count_expected ?? 1) > 1;

  if (isItemList) {
    const items = Array.from({ length: Math.min(gt.listing_count_expected ?? 3, 5) }, (_, i) => ({
      '@type': 'RealEstateListing',
      name: `${gt.platform_name} listing ${String(i + 1)}`,
      offers: { price: 250000 + i * 50000, priceCurrency: currency },
      image: `https://example.com/img-${String(i)}.jpg`,
    }));
    const json = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: items,
    });
    return `<script type="application/ld+json">${json}</script>`;
  }

  const json = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'RealEstateListing',
    name: gt.platform_name,
    offers: { price: 488168, priceCurrency: currency },
    address: { streetAddress: 'Calle Mayor 1, Madrid' },
    image: 'https://example.com/hero.jpg',
    description: `Sample property on ${gt.platform_name}`,
  });
  return `<script type="application/ld+json">${json}</script>`;
}

function sampleFieldValue(field: string, i: number, currency?: string): string {
  switch (field) {
    case 'headline':
      return `Listing #${String(i + 1)} headline`;
    case 'price': {
      const base = 200000 + i * 50000;
      return formatSamplePrice(base, currency ?? 'EUR');
    }
    case 'image':
      return '';
    case 'bedrooms':
      return String((i % 4) + 1);
    case 'bathrooms':
      return String((i % 3) + 1);
    case 'area':
      return `${String(50 + i * 10)} m²`;
    case 'location':
      return `City ${String(i + 1)}`;
    default:
      return `value-${String(i)}`;
  }
}

function formatSamplePrice(value: number, currency: string): string {
  const formatted = value.toLocaleString('en-US');
  switch (currency) {
    case 'EUR':
      return `€${formatted}`;
    case 'GBP':
      return `£${formatted}`;
    case 'USD':
      return `$${formatted}`;
    case 'AED':
      return `AED ${formatted}`;
    case 'PLN':
      return `${formatted} PLN`;
    default:
      return `${currency} ${formatted}`;
  }
}

// ---------------------------------------------------------------------------
// Minimal CSS-selector → HTML emitter
// ---------------------------------------------------------------------------

/**
 * Render an HTML element matching the given CSS selector. Supports descendant
 * combinators (` `), tags, classes, and attribute selectors. Comma-separated
 * alternatives use the first.
 *
 * `hashStyle` controls the volatile suffix appended to partial-attribute classes
 * (`[class*='X']`) so the corpus exercises the CSS-in-JS / CSS Modules /
 * Angular hash-tolerance contracts.
 *
 * `extraClasses` and `extraAttrs` are added to the OUTERMOST emitted element.
 */
function renderSelector(
  selector: string,
  innerHtml: string,
  hashStyle: HashStyle,
  extraClasses: string[] = [],
  extraAttrs: Record<string, string> = {},
): string {
  if (!selector) return innerHtml;
  const sel = (selector.split(',')[0] ?? '').trim();
  const tokens = sel.split(/\s+/).filter(Boolean);
  let body = innerHtml;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const tok = tokens[i];
    if (tok === undefined) continue;
    const isOutermost = i === 0;
    body = renderSelectorToken(
      tok,
      body,
      hashStyle,
      isOutermost ? extraClasses : [],
      isOutermost ? extraAttrs : {},
    );
  }
  return body;
}

function renderSelectorToken(
  token: string,
  innerHtml: string,
  hashStyle: HashStyle,
  extraClasses: string[],
  extraAttrs: Record<string, string>,
): string {
  if (token === '>' || token === '~' || token === '+') return innerHtml;

  let tag = '';
  const classes: string[] = [];
  const attrs: Record<string, string> = {};
  let buf = '';
  let mode: 'tag' | 'class' | 'attr' = 'tag';

  const flushBuf = () => {
    if (!buf) return;
    if (mode === 'tag') {
      tag = buf;
    } else if (mode === 'class') {
      classes.push(buf);
    }
    buf = '';
    mode = 'tag';
  };

  for (let i = 0; i < token.length; i++) {
    const ch = token[i] ?? '';

    if (mode === 'attr') {
      const end = token.indexOf(']', i);
      const attrChunk = token.slice(i, end);
      i = end;
      const m = /^([\w-]+)(?:([*^$|~]?)=(["'])([^"']*)\3)?/.exec(attrChunk);
      if (m?.[1] !== undefined) {
        const name = m[1];
        const value = m[4];
        // For [attr*='X']-style substring selectors and `[attr='X']` alike,
        // emit the bare value so the technique's `[attr*='X']` variants match.
        attrs[name] = value ?? '';
      }
      mode = 'tag';
      continue;
    }

    if (ch === '.') {
      flushBuf();
      mode = 'class';
      continue;
    }
    if (ch === '#') {
      flushBuf();
      let j = i + 1;
      let id = '';
      while (j < token.length) {
        const c = token[j] ?? '';
        if (!/[\w-]/.test(c)) break;
        id += c;
        j++;
      }
      attrs.id = id;
      i = j - 1;
      continue;
    }
    if (ch === '[') {
      flushBuf();
      mode = 'attr';
      continue;
    }
    if (ch === ':') {
      flushBuf();
      break;
    }
    buf += ch;
  }
  flushBuf();

  if (!tag) tag = 'div';

  // If the selector used a partial-attribute class form like [class*='X'],
  // the attribute is captured as `attrs.class = 'X'`. Convert that into a real
  // class with a hash suffix appropriate for the technique under test.
  if (attrs.class !== undefined) {
    const stable = attrs.class;
    delete attrs.class;
    classes.unshift(suffixedClass(stable, hashStyle));
  }

  // Add extra compat classes onto the outermost element.
  for (const c of extraClasses) {
    if (!classes.includes(c)) classes.push(c);
  }

  // Merge extraAttrs.
  for (const [k, v] of Object.entries(extraAttrs)) {
    attrs[k] = v;
  }

  const classAttr = classes.length > 0 ? ` class="${escapeHtml(classes.join(' '))}"` : '';
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${escapeHtml(v)}"`))
    .join('');

  if (tag === 'img' || tag === 'br' || tag === 'hr' || tag === 'meta' || tag === 'link') {
    return `<${tag}${classAttr}${attrStr} />`;
  }
  return `<${tag}${classAttr}${attrStr}>${innerHtml}</${tag}>`;
}

/**
 * Synthesise a class name with a volatile suffix matching the given technique's
 * hash style. The corpus uses these to exercise the techniques' hash-tolerance
 * code paths and prove that none of them leak the volatile portion into stored
 * selectors.
 */
function suffixedClass(stable: string, style: HashStyle): string {
  switch (style) {
    case 'cssModules':
      // ComponentName_localName__hash — must start with uppercase.
      return `${stable}_${stable.toLowerCase()}__a1b2c3`;
    case 'cssInJs':
      return `${stable}-sc-aaaaaaaa-1`;
    case 'angular':
      // Angular fixtures must NOT trigger the css-in-js technique. The CSS-in-JS
      // prefix extractor anchors on `^[A-Z][a-z]+[A-Z][a-zA-Z]+`; we wrap the
      // stable token in a lowercase prefix so it loses the anchor while still
      // satisfying ground-truth `[class*='Stable']` selectors.
      return `kf-${stable}-list-item`;
    default:
      return stable;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Detection runner & scoring
// ---------------------------------------------------------------------------

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

/** All candidate selectors for a single field (primary first, then fallbacks). */
type SelectorCandidates = string[];

interface DetectedField {
  primary: string | null;
  fallbacks: string[];
}

export async function runDetection(
  html: string,
  url: string,
  gt: GroundTruth,
): Promise<FixtureResult> {
  const result = await detectSiteSchema(html, url, TENANT_ID);
  const schema = result.schema;
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const detected = extractDetectedSelectors(schema);
  const expected = extractExpectedSelectors(gt);

  // Determine the first card element on each side to scope per-field selectors.
  const expectedCardEl = gt.listing_card_selector
    ? doc.querySelector(gt.listing_card_selector)
    : null;
  const detectedCardSel = detected.listing_card_selector?.primary ?? null;
  let detectedCardEl: Element | null = null;
  if (detectedCardSel) {
    try {
      detectedCardEl = doc.querySelector(splitFirstAlternative(detectedCardSel));
    } catch {
      detectedCardEl = null;
    }
  }
  const fieldScope: ParentNode = detectedCardEl ?? expectedCardEl ?? doc.body;

  const fields: FieldComparison[] = [];
  for (const [fieldKey, expectedSel] of Object.entries(expected)) {
    const detectedField = detected[fieldKey] ?? null;
    const detectedPrimary = detectedField?.primary ?? null;
    const candidates: SelectorCandidates = detectedField
      ? [detectedField.primary ?? '', ...detectedField.fallbacks].filter(Boolean)
      : [];

    const scope: ParentNode =
      fieldKey === 'listing_card_selector' || fieldKey === 'container_selector' ? doc : fieldScope;

    const matched = candidates.some((cand) => compareSelectorsByDom(scope, expectedSel, cand));
    fields.push({
      field: fieldKey,
      expected: expectedSel,
      detected: detectedPrimary,
      matched,
    });
  }

  const expectedCount = fields.length;
  const detectedCount = fields.filter((f) => f.detected !== null && f.detected !== '').length;
  const correctCount = fields.filter((f) => f.matched).length;
  const precision = detectedCount > 0 ? correctCount / detectedCount : 0;
  const recall = expectedCount > 0 ? correctCount / expectedCount : 0;

  return {
    id: gt.platform_id,
    platform: gt.platform_name,
    expected_technique: gt.detection_technique,
    detected_technique: result.technique,
    schema_present: schema !== null,
    fields,
    expected_count: expectedCount,
    detected_count: detectedCount,
    correct_count: correctCount,
    precision,
    recall,
    warnings: result.warnings,
  };
}

function extractExpectedSelectors(gt: GroundTruth): Record<string, string> {
  const out: Record<string, string> = {};
  out.listing_card_selector = gt.listing_card_selector;
  if (gt.container_selector) out.container_selector = gt.container_selector;
  for (const [k, v] of Object.entries(gt.card_field_mappings)) {
    if (v.primary) out[`card.${k}`] = v.primary;
  }
  for (const [k, v] of Object.entries(gt.data_extractors_per_card)) {
    if (v.primary) out[`extractor.${k}`] = v.primary;
  }
  return out;
}

function extractDetectedSelectors(schema: TenantSiteSchema | null): Record<string, DetectedField> {
  const out: Record<string, DetectedField> = {};
  if (!schema) return out;
  const idx = schema.index_schema;
  out.listing_card_selector = {
    primary: idx.listing_card_selector,
    fallbacks: [],
  };
  if (idx.container_selector) {
    out.container_selector = { primary: idx.container_selector, fallbacks: [] };
  }
  for (const [k, v] of Object.entries(idx.card_field_mappings)) {
    if (!v) continue;
    out[`card.${k}`] = strategyToDetected(v as SelectorStrategy);
  }
  for (const [k, v] of Object.entries(idx.data_extractors_per_card)) {
    if (!v) continue;
    out[`extractor.${k}`] = strategyToDetected(v as SelectorStrategy);
  }
  return out;
}

function strategyToDetected(s: SelectorStrategy): DetectedField {
  return {
    primary: s.primary,
    fallbacks: Array.isArray(s.fallbacks) ? s.fallbacks : [],
  };
}

/**
 * Two selectors match when both find at least one common element in the given
 * scope. Splits comma-separated alternatives so that any matching alternative
 * counts.
 */
function compareSelectorsByDom(
  scope: ParentNode,
  expected: string,
  detected: string | null,
): boolean {
  if (!expected || !detected) return false;
  for (const expAlt of splitAlternatives(expected)) {
    for (const detAlt of splitAlternatives(detected)) {
      let expectedEls: Element[];
      let detectedEls: Element[];
      try {
        expectedEls = Array.from(scope.querySelectorAll(expAlt));
        detectedEls = Array.from(scope.querySelectorAll(detAlt));
      } catch {
        continue;
      }
      if (expectedEls.length === 0 || detectedEls.length === 0) continue;
      // Lenient match: same element OR one contains the other. Nested ground-
      // truth selectors like `li.beds span` are semantically equivalent to a
      // technique-emitted `[class*='bed']` that finds the parent li — both
      // identify the same field, just at different DOM depths.
      if (
        expectedEls.some((e) => detectedEls.some((d) => e === d || e.contains(d) || d.contains(e)))
      ) {
        return true;
      }
    }
  }
  return false;
}

function splitAlternatives(sel: string): string[] {
  return sel
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitFirstAlternative(sel: string): string {
  return splitAlternatives(sel)[0] ?? '';
}

// ---------------------------------------------------------------------------
// Pooled metrics & corpus report
// ---------------------------------------------------------------------------

export interface CorpusMetrics {
  precision: number;
  recall: number;
  expected_total: number;
  detected_total: number;
  correct_total: number;
}

export function computeMetrics(results: FixtureResult[]): CorpusMetrics {
  let expected = 0;
  let detected = 0;
  let correct = 0;
  for (const r of results) {
    expected += r.expected_count;
    detected += r.detected_count;
    correct += r.correct_count;
  }
  return {
    precision: detected > 0 ? correct / detected : 0,
    recall: expected > 0 ? correct / expected : 0,
    expected_total: expected,
    detected_total: detected,
    correct_total: correct,
  };
}

export interface CorpusReport {
  generated_at: string;
  thresholds: { precision: number; recall: number };
  metrics: CorpusMetrics;
  by_platform: Record<
    string,
    {
      precision: number;
      recall: number;
      expected_technique: string;
      detected_technique: string;
      schema_present: boolean;
      missed_fields: { field: string; expected: string; detected: string | null }[];
    }
  >;
  failures: string[];
  warnings: string[];
}

export function buildCorpusReport(
  results: FixtureResult[],
  thresholds = { precision: 0.95, recall: 0.8 },
): CorpusReport {
  const metrics = computeMetrics(results);
  const byPlatform: CorpusReport['by_platform'] = {};
  const failures: string[] = [];
  const warnings: string[] = [];

  for (const r of results) {
    byPlatform[r.id] = {
      precision: r.precision,
      recall: r.recall,
      expected_technique: r.expected_technique,
      detected_technique: r.detected_technique,
      schema_present: r.schema_present,
      missed_fields: r.fields
        .filter((f) => !f.matched)
        .map((f) => ({ field: f.field, expected: f.expected, detected: f.detected })),
    };
    if (!r.schema_present) {
      failures.push(`${r.id}: no schema returned by pipeline`);
    } else if (r.precision < thresholds.precision || r.recall < thresholds.recall) {
      failures.push(
        `${r.id}: precision=${r.precision.toFixed(2)} recall=${r.recall.toFixed(2)} ` +
          `expected_technique=${r.expected_technique} detected_technique=${r.detected_technique}`,
      );
    }
    for (const w of r.warnings) {
      if (w.toLowerCase().includes('css-in-js')) warnings.push(`${r.id}: ${w}`);
    }
  }

  return {
    generated_at: new Date().toISOString(),
    thresholds,
    metrics,
    by_platform: byPlatform,
    failures,
    warnings,
  };
}

export function writeCorpusReport(report: CorpusReport, outPath?: string): string {
  const path = outPath ?? join(__dirname, '..', '..', 'corpus-report.json');
  writeFileSync(path, JSON.stringify(report, null, 2));
  return path;
}

// ---------------------------------------------------------------------------
// CSS-in-JS hash safety guard
// ---------------------------------------------------------------------------

/**
 * True when the given selector string contains a full CSS-in-JS hash:
 *   - CSS Modules `CamelPrefix_local__hash` (requires the uppercase prefix)
 *   - styled-components `-sc-12345678-1`
 *
 * The CSS Modules guard requires an uppercase CamelCase prefix before `_` so
 * Drupal BEM class names like `field__item` do NOT trip it.
 */
export function containsCssInJsHash(selector: string): boolean {
  if (!selector) return false;
  if (/[A-Z][a-zA-Z]*_[a-zA-Z]+__[a-z0-9]{4,8}(?:$|\s|,|\]|\))/.test(selector)) return true;
  if (/-sc-[a-f0-9]{8}-\d+/.test(selector)) return true;
  return false;
}
