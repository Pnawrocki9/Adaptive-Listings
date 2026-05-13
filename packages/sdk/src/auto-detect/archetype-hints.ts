/**
 * Archetype hints from site structure — Bayesian prior seeding.
 *
 * Extracts site-level signals from a `TenantSiteSchema`, the page HTML, and the URL,
 * producing an `ArchetypeHint[]` that the Intent Engine consumes once at session start.
 * The hints encode what kind of buyer the tenant's site predominantly serves — before
 * any behavioral signal arrives.
 *
 * Three layers of signals are combined:
 *   1. HTML pattern matching — language cues ("rental yield", "stamp duty", "golden visa", …)
 *   2. Schema-level signals — currency, detection_source (Drupal/WordPress/JSON-LD)
 *   3. URL-based signals    — TLD and known portal brands (Bayut, Kyero, Knight Frank, …)
 *
 * For each archetype the boosts are **summed** across all firing signals, then **capped
 * at 0.30**, archetypes with a net boost ≤ 0.05 are filtered out, and the remaining hints
 * are sorted by `confidence_boost` descending.
 *
 * Estalara's own Tier 3 Native pages return an empty array — on our own sites the Intent
 * Engine has full control and does not need site-level priors.
 *
 * @module @estalara/sdk/auto-detect/archetype-hints
 */

import type { ArchetypeHint, ArchetypeId, TenantSiteSchema } from '@estalara/shared';

/** Maximum total `confidence_boost` allowed per archetype after summation. */
const MAX_BOOST_PER_ARCHETYPE = 0.3;

/** Archetypes with a summed boost at or below this value are filtered out as noise. */
const MIN_BOOST_THRESHOLD = 0.05;

/** A single HTML-pattern-based rule. */
interface PatternRule {
  pattern: RegExp;
  archetype: ArchetypeId;
  boost: number;
  signal: string;
}

/**
 * Pattern rules — every entry is evaluated against the page HTML.
 *
 * NOTE: ordering doesn't matter (boosts are summed) — keep grouped by archetype family
 * for readability.
 */
const PATTERN_RULES: readonly PatternRule[] = [
  // ─── Investment archetypes ────────────────────────────────────────────────
  // yield_hunter
  {
    pattern: /rental[\s-]?yield|\broi\b|\binvestment\b|\binvestor\b/i,
    archetype: 'yield_hunter',
    boost: 0.15,
    signal: 'rental yield / investment language detected',
  },
  {
    pattern: /off[\s-]?plan|handover\s*Q[1-4]/i,
    archetype: 'yield_hunter',
    boost: 0.2,
    signal: 'off-plan / handover terminology detected',
  },
  {
    pattern: /price[\s-]?trend|similar[\s-]?transaction|capital[\s-]?growth/i,
    archetype: 'yield_hunter',
    boost: 0.1,
    signal: 'investment performance language detected',
  },
  {
    pattern: /buy[\s-]?to[\s-]?let|yield[\s-]?calculator/i,
    archetype: 'yield_hunter',
    boost: 0.15,
    signal: 'buy-to-let / yield calculator detected',
  },

  // golden_visa_buyer
  {
    pattern:
      /golden[\s-]?visa|residency[\s-]?by[\s-]?investment|citizenship[\s-]?by[\s-]?investment/i,
    archetype: 'golden_visa_buyer',
    boost: 0.25,
    signal: 'golden visa / residency by investment language',
  },
  {
    pattern: /regulatory[\s-]?information|permit[\s-]?number|\bRERA\b|\bDLD\b/i,
    archetype: 'golden_visa_buyer',
    boost: 0.2,
    signal: 'regulatory / permit language (UAE pattern)',
  },
  {
    pattern: /\bfreehold\b|leasehold[\s-]?ownership/i,
    archetype: 'golden_visa_buyer',
    boost: 0.1,
    signal: 'freehold ownership language (UAE/Cyprus pattern)',
  },

  // vacation_rental_investor
  {
    pattern: /vacation[\s-]?rental|\bairbnb\b|short[\s-]?term[\s-]?rental|holiday[\s-]?let/i,
    archetype: 'vacation_rental_investor',
    boost: 0.15,
    signal: 'vacation rental / Airbnb language',
  },
  {
    pattern: /\bfurnished\b|ready[\s-]?to[\s-]?rent|turnkey[\s-]?rental/i,
    archetype: 'vacation_rental_investor',
    boost: 0.1,
    signal: 'furnished / ready-to-rent listing',
  },

  // flip_investor
  {
    pattern:
      /\brenovation\b|below[\s-]?market[\s-]?value|motivated[\s-]?seller|fix[\s-]?and[\s-]?flip/i,
    archetype: 'flip_investor',
    boost: 0.15,
    signal: 'renovation / below market value language',
  },

  // ─── Own-use archetypes ───────────────────────────────────────────────────
  // family_buyer
  {
    pattern:
      /school[\s-]?district|school[\s-]?catchment|\bofsted\b|\bkindergarten\b|\bplayground\b/i,
    archetype: 'family_buyer',
    boost: 0.15,
    signal: 'school / family amenities language',
  },
  {
    pattern: /family[\s-]?home|family[\s-]?friendly|safe[\s-]?neighbourhood/i,
    archetype: 'family_buyer',
    boost: 0.1,
    signal: 'family home / safe neighbourhood language',
  },

  // first_time_buyer
  {
    pattern:
      /first[\s-]?time[\s-]?buyer|stamp[\s-]?duty[\s-]?(relief|exemption|calculator)|help[\s-]?to[\s-]?buy|shared[\s-]?ownership/i,
    archetype: 'first_time_buyer',
    boost: 0.2,
    signal: 'first-time buyer scheme / stamp duty language',
  },
  {
    pattern: /mortgage[\s-]?calculator|monthly[\s-]?payment|\baffordability\b/i,
    archetype: 'first_time_buyer',
    boost: 0.1,
    signal: 'mortgage calculator / affordability tool detected',
  },

  // luxury_buyer
  {
    pattern:
      /\bexclusive\b|off[\s-]?market|\bpenthouse\b|prime[\s-]?location|private[\s-]?viewing/i,
    archetype: 'luxury_buyer',
    boost: 0.1,
    signal: 'luxury / exclusive property language',
  },

  // remote_worker
  {
    pattern:
      /dedicated[\s-]?office|home[\s-]?office|fibre[\s-]?broadband|fast[\s-]?internet|co[\s-]?working[\s-]?nearby/i,
    archetype: 'remote_worker',
    boost: 0.15,
    signal: 'home office / fast internet language',
  },

  // ─── Special / cross-border archetypes ────────────────────────────────────
  // lifestyle_expat
  {
    pattern: /expat[\s-]?community|international[\s-]?school|english[\s-]?speaking|\brelocat/i,
    archetype: 'lifestyle_expat',
    boost: 0.2,
    signal: 'expat community / international school language',
  },
  {
    pattern: /airport[\s-]?transfer|non[\s-]?resident|foreign[\s-]?buyer/i,
    archetype: 'lifestyle_expat',
    boost: 0.1,
    signal: 'non-resident / foreign buyer language',
  },

  // retiree_relocator
  {
    pattern:
      /\bretire\b|retirement[\s-]?living|second[\s-]?home[\s-]?abroad|\bpeaceful\b|countryside[\s-]?retreat/i,
    archetype: 'retiree_relocator',
    boost: 0.15,
    signal: 'retirement / second home abroad language',
  },
  {
    pattern:
      /healthcare[\s-]?nearby|medical[\s-]?centre|\baccessible\b|ground[\s-]?floor|lift[\s-]?access/i,
    archetype: 'retiree_relocator',
    boost: 0.1,
    signal: 'healthcare / accessibility language',
  },

  // diaspora_buyer
  {
    pattern: /buy[\s-]?from[\s-]?abroad|remote[\s-]?purchase|\bdiaspora\b|overseas[\s-]?buyer/i,
    archetype: 'diaspora_buyer',
    boost: 0.2,
    signal: 'buy from abroad / overseas buyer language',
  },

  // second_home_buyer
  {
    pattern:
      /holiday[\s-]?home|weekend[\s-]?retreat|second[\s-]?residence|\bcoastal\b|\bbeachfront\b|ski[\s-]?chalet/i,
    archetype: 'second_home_buyer',
    boost: 0.15,
    signal: 'holiday home / second residence language',
  },

  // student_parent
  {
    pattern:
      /near[\s-]?university|student[\s-]?accommodation|purpose[\s-]?built[\s-]?student|\bPBSA\b/i,
    archetype: 'student_parent',
    boost: 0.2,
    signal: 'near university / student accommodation language',
  },
];

/** A single URL-pattern-based rule. */
interface UrlRule {
  /** Substring or regex that must match against the lowercased URL. */
  pattern: RegExp;
  /** Archetype boosts emitted when this rule matches. */
  boosts: { archetype: ArchetypeId; boost: number }[];
  /** Human-readable signal label. */
  signal: string;
}

/**
 * URL rules — each is matched against `url.toLowerCase()`. Multiple rules can fire for
 * the same URL (e.g. `bayut.com/...` matches both the `.ae` TLD rule and the brand rule).
 */
const URL_RULES: readonly UrlRule[] = [
  // UAE / Gulf — strong golden visa + yield signal
  {
    pattern: /\.ae(\/|$|:)|bayut\.com|propertyfinder\.ae/,
    boosts: [
      { archetype: 'golden_visa_buyer', boost: 0.2 },
      { archetype: 'yield_hunter', boost: 0.15 },
    ],
    signal: 'UAE / Gulf market URL signal (golden visa + yield)',
  },

  // Spain — expat + vacation rental
  {
    pattern: /\.es(\/|$|:)|idealista|kyero/,
    boosts: [
      { archetype: 'lifestyle_expat', boost: 0.15 },
      { archetype: 'vacation_rental_investor', boost: 0.1 },
    ],
    signal: 'Spain market URL signal (expat + vacation rental)',
  },

  // Cyprus — golden visa + expat
  {
    pattern: /\.cy(\/|$|:)|bazaraki|zyprus/,
    boosts: [
      { archetype: 'golden_visa_buyer', boost: 0.15 },
      { archetype: 'lifestyle_expat', boost: 0.1 },
    ],
    signal: 'Cyprus market URL signal (golden visa + expat)',
  },

  // Poland — family + first time buyer
  {
    pattern: /\.pl(\/|$|:)|otodom/,
    boosts: [
      { archetype: 'family_buyer', boost: 0.1 },
      { archetype: 'first_time_buyer', boost: 0.1 },
    ],
    signal: 'Poland market URL signal (family + first-time buyer)',
  },

  // UK mainstream portals
  {
    pattern: /rightmove|zoopla/,
    boosts: [
      { archetype: 'family_buyer', boost: 0.1 },
      { archetype: 'first_time_buyer', boost: 0.1 },
      { archetype: 'upsizer', boost: 0.05 },
    ],
    signal: 'UK mainstream portal URL signal (family / FTB / upsizer)',
  },

  // Luxury brokerages
  {
    pattern: /knight-frank|knightfrank|engelvoelkers|engel-volkers|lucas-fox|lucasfox/,
    boosts: [{ archetype: 'luxury_buyer', boost: 0.25 }],
    signal: 'Luxury brokerage URL signal',
  },

  // US mainstream portals
  {
    pattern: /\.com\/.*\b(redfin|zillow|realtor)\b|redfin\.com|zillow\.com|realtor\.com/,
    boosts: [
      { archetype: 'family_buyer', boost: 0.1 },
      { archetype: 'first_time_buyer', boost: 0.1 },
    ],
    signal: 'US mainstream portal URL signal (family + FTB)',
  },
];

/**
 * Internal accumulator — for each archetype we collect every triggering signal so we
 * can compose a representative `signal` string after capping/summing the boost.
 */
interface AccumulatedHint {
  archetype: ArchetypeId;
  /** Raw running sum of all firing boosts (may exceed `MAX_BOOST_PER_ARCHETYPE`). */
  rawBoost: number;
  /** Ordered list of triggering signal labels (most impactful first). */
  signals: { label: string; boost: number }[];
}

function addBoost(
  acc: Map<ArchetypeId, AccumulatedHint>,
  archetype: ArchetypeId,
  boost: number,
  signal: string,
): void {
  const existing = acc.get(archetype);
  if (existing) {
    existing.rawBoost += boost;
    existing.signals.push({ label: signal, boost });
  } else {
    acc.set(archetype, {
      archetype,
      rawBoost: boost,
      signals: [{ label: signal, boost }],
    });
  }
}

/** Apply HTML pattern rules. */
function applyHtmlPatterns(html: string, acc: Map<ArchetypeId, AccumulatedHint>): void {
  if (!html) return;
  for (const rule of PATTERN_RULES) {
    if (rule.pattern.test(html)) {
      addBoost(acc, rule.archetype, rule.boost, rule.signal);
    }
  }
}

/** Apply schema-level signals (currency, detection_source, framework). */
function applySchemaSignals(
  schema: TenantSiteSchema,
  acc: Map<ArchetypeId, AccumulatedHint>,
): void {
  const currency = schema.index_schema.card_field_mappings.price?.currency;

  // AED currency → Dubai/UAE market
  if (currency === 'AED') {
    addBoost(acc, 'yield_hunter', 0.15, 'AED currency detected (Dubai market signal)');
    addBoost(acc, 'golden_visa_buyer', 0.2, 'AED currency detected (Dubai market signal)');
    addBoost(acc, 'vacation_rental_investor', 0.1, 'AED currency detected (Dubai market signal)');
  }

  // EUR currency — mild luxury + golden visa hint (refined further by HTML patterns)
  if (currency === 'EUR') {
    addBoost(acc, 'luxury_buyer', 0.05, 'EUR currency signal (refine with HTML / luxury keyword)');
  }

  // JSON-LD structured data → typically professional / investor-savvy platforms
  if (schema.detection_source === 'json_ld') {
    addBoost(acc, 'yield_hunter', 0.05, 'JSON-LD structured data — investor-savvy platform signal');
  }

  // WordPress theme → typically local family / first-time buyer
  if (schema.detection_source === 'wordpress') {
    addBoost(acc, 'family_buyer', 0.1, 'WordPress theme — local family market signal');
    addBoost(acc, 'first_time_buyer', 0.05, 'WordPress theme — local FTB market signal');
  }

  // Drupal / PHP classic → established local markets, family skew
  if (schema.detection_source === 'drupal' || schema.detection_source === 'php_classic') {
    addBoost(acc, 'family_buyer', 0.08, 'Drupal/PHP classic platform — local family market signal');
  }
}

/** Apply URL-based signals (TLD + known portal brands). */
function applyUrlSignals(url: string, acc: Map<ArchetypeId, AccumulatedHint>): void {
  if (!url) return;
  const lowered = url.toLowerCase();
  for (const rule of URL_RULES) {
    if (rule.pattern.test(lowered)) {
      for (const { archetype, boost } of rule.boosts) {
        addBoost(acc, archetype, boost, rule.signal);
      }
    }
  }
}

/**
 * Compose a human-readable `signal` string from the accumulated triggers.
 *
 * Format: top-2 signal labels joined by " + ", or just one if only one fired.
 */
function composeSignalLabel(hint: AccumulatedHint): string {
  // Sort signals by individual boost descending so the strongest triggers appear first.
  const sorted = [...hint.signals].sort((a, b) => b.boost - a.boost);
  const top = sorted.slice(0, 2).map((s) => s.label);
  // Dedupe in case multiple identical labels (e.g. same URL rule fired by TLD + brand).
  const unique = Array.from(new Set(top));
  return unique.join(' + ');
}

/**
 * Extract archetype hints from a detected `TenantSiteSchema`, the page HTML, and the URL.
 *
 * Returns an array of `ArchetypeHint` sorted by `confidence_boost` descending. Each entry
 * carries the archetype id, a human-readable signal description, and a confidence boost
 * in `(MIN_BOOST_THRESHOLD, MAX_BOOST_PER_ARCHETYPE]`.
 *
 * Edge cases:
 *  - Estalara Tier 3 Native (`detection_source === 'data_estalara'`) → returns `[]`
 *  - Empty HTML / URL → only schema-level signals fire
 *  - Multiple signals targeting the same archetype are **summed** then **capped** at 0.30
 *  - Archetypes with a final boost ≤ 0.05 are filtered out as noise
 */
export function extractArchetypeHints(
  schema: TenantSiteSchema,
  html: string,
  url: string,
): ArchetypeHint[] {
  // Tier 3 Native sites — the Intent Engine owns these end-to-end; no priors needed.
  if (schema.detection_source === 'data_estalara') {
    return [];
  }

  const acc = new Map<ArchetypeId, AccumulatedHint>();

  applyHtmlPatterns(html, acc);
  applySchemaSignals(schema, acc);
  applyUrlSignals(url, acc);

  const hints: ArchetypeHint[] = [];
  for (const entry of acc.values()) {
    const cappedBoost = Math.min(entry.rawBoost, MAX_BOOST_PER_ARCHETYPE);
    if (cappedBoost <= MIN_BOOST_THRESHOLD) continue;
    hints.push({
      archetype_id: entry.archetype,
      signal: composeSignalLabel(entry),
      confidence_boost: cappedBoost,
    });
  }

  hints.sort((a, b) => b.confidence_boost - a.confidence_boost);
  return hints;
}
