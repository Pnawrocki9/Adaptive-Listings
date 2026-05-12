# Sprint 7.5 — Auto-Detection Engine

**Status:** READY TO START (po merge Sprint 7 Phase 2) **Duration:** ~5 dni agentowych **Model:**
Claude Sonnet 4.6 (standard tickets) | Opus 4.7 xhigh (AUTO-005 ML scoring, AUTO-007 archetype
hints) **Agent primary:** sdk-engineer + backend-engineer **Agent support:** ml-engineer (AUTO-007),
qa-engineer (AUTO-005 CI gate)

---

## Kontekst i cel

Sprint 7.5 buduje **Auto-Detection Engine** — komponent który na wejściu dostaje URL strony agencji
nieruchomości, a na wyjściu zwraca `TenantSiteSchema` — kompletny opis gdzie na tej stronie są
listingi i jak z nich wyciągnąć dane.

**Dlaczego teraz:** Sprint 8 (A/B framework + re-ranking + agency answers) wymaga
`data_extractors_per_card` żeby wiedzieć jakie dane posiada każda karta listingu (cena, pokoje, m²)
przed re-rankingiem. Sprint 8 nie może zacząć bez gotowego TenantSiteSchema.

**Corpus reference:** `/packages/sdk/src/auto-detect/__fixtures__/` — 24 platformy z pełnymi
ground-truths (index + detail), zwalidowane ręcznie przez Piotra. CI gate: precision ≥95%, recall
≥80% na corpus.

---

## Hooks dla Sprint 8 (OBOWIĄZKOWE w tym sprincie)

Każdy agent MUSI zostawić następujące hooks **gotowe ale nieużywane** zanim Sprint 7.5 zostanie
zamknięty:

1. **`data_extractors_per_card`** w `TenantSiteSchema` — pole zdefiniowane w typach, wypełniane
   przez detection engine, ale jeszcze nie konsumowane przez Decision API
2. **`ReorderDirective` type stub** w `packages/shared/src/directives.ts` — interfejs zdefiniowany,
   implementacja DOM w Sprint 8
3. **`container_selector`** w `TenantSiteSchema` — selector gridu listingów (nie pojedynczej karty),
   potrzebny do re-orderingu

---

## Tickets

---

### AUTO-001 — Reference Corpus Setup & CI Gate

**Agent:** qa-engineer **Model:** Sonnet 4.6 **Estimated time:** 4h **Depends on:** Sprint 7 Phase 2
merged

**Scope:** Zainstalowanie corpus fixtures w repo i setup CI gate który będzie blokował merge jeśli
precision/recall spada poniżej progu.

**Deliverables:**

1. Skopiuj corpus do repo:

```
packages/sdk/src/auto-detect/__fixtures__/
  000-app-estalara/
    index-ground-truth.json
    detail-ground-truth.json
  001-otodom-mokotow/
    index-ground-truth.json
    detail-ground-truth.json
  ... (24 platformy)
  README.md  ← opis formatu ground-truth
```

2. `packages/sdk/src/auto-detect/__fixtures__/README.md`:

```markdown
# Auto-Detection Reference Corpus

24 real-world platforms, manually validated by Piotr Nawrocki (May 2026).

## Ground-truth format

Each fixture has `index-ground-truth.json` and `detail-ground-truth.json`.

### index-ground-truth.json fields:

- `listing_card_selector` — primary CSS selector for listing cards
- `listing_count` — expected number of cards on index page
- `card_field_mappings` — selectors for headline, price, image, area, bedrooms
- `data_extractors_per_card` — per-card data extraction for re-ranking
- `container_selector` — grid container (for ReorderDirective in Sprint 8)

### detail-ground-truth.json fields:

- `slot_selectors` — headline, description, cta_primary adaptation slots
- `data_extractors` — price, bedrooms, area, year_built, etc.
- `similar_listings_section` — selector/label for similar listings (re-ranking target)

## CI gate thresholds

- Precision ≥ 95% (correct detections / total detections)
- Recall ≥ 80% (detected fields / total expected fields)
- app.estalara.com (id: 000): 100% precision required (we own the code)
```

3. `packages/sdk/src/auto-detect/__tests__/corpus.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFixtures, runDetection, computeMetrics } from '../test-utils';

const fixtures = readFixtures('__fixtures__');

describe('Auto-Detection Corpus CI Gate', () => {
  it('precision >= 95% across all platforms', async () => {
    const results = await Promise.all(fixtures.map((f) => runDetection(f.html, f.groundTruth)));
    const { precision } = computeMetrics(results);
    expect(precision).toBeGreaterThanOrEqual(0.95);
  });

  it('recall >= 80% across all platforms', async () => {
    const results = await Promise.all(fixtures.map((f) => runDetection(f.html, f.groundTruth)));
    const { recall } = computeMetrics(results);
    expect(recall).toBeGreaterThanOrEqual(0.8);
  });

  it('app.estalara.com has 100% precision', async () => {
    const estalara = fixtures.find((f) => f.id === '000-app-estalara');
    const result = await runDetection(estalara!.html, estalara!.groundTruth);
    expect(result.precision).toBe(1.0);
  });
});
```

4. Dodaj do `turbo.json` pipeline: `"test:corpus"` task

**DONE criteria:**

- [ ] 24 fixture dirs w repo
- [ ] README.md z opisem formatu
- [ ] corpus.test.ts kompiluje się (może failować — detection engine jeszcze nie istnieje)
- [ ] `pnpm test:corpus` dostępne jako osobna komenda (nie blokuje main test suite jeszcze)

---

### AUTO-002 — TenantSiteSchema Type + Detection Pipeline Skeleton

**Agent:** sdk-engineer **Model:** Sonnet 4.6 **Estimated time:** 6h **Depends on:** AUTO-001

**Scope:** Definicja kompletnego `TenantSiteSchema` TypeScript type + skeleton pipeline detection z
prawidłową strukturą (bez implementacji ML — to AUTO-004).

**Deliverables:**

1. `packages/shared/src/tenant-site-schema.ts`:

```typescript
export type PageType = 'index' | 'detail' | 'unknown';

export type SelectorStrategy = {
  primary: string; // CSS selector
  fallbacks: string[]; // ordered fallbacks
  partial_match?: string; // for [class*='keyword'] patterns
  json_ld_path?: string; // e.g. "offers.price" for JSON-LD bypass
  regex?: string; // text extraction regex
  type: 'text' | 'number' | 'currency' | 'boolean' | 'url';
  currency?: 'EUR' | 'USD' | 'GBP' | 'PLN' | 'AED';
  unit?: 'sqm' | 'sqft' | 'acres';
};

export type CardFieldMappings = {
  headline?: SelectorStrategy;
  price?: SelectorStrategy;
  image?: SelectorStrategy;
  bedrooms?: SelectorStrategy;
  bathrooms?: SelectorStrategy;
  area?: SelectorStrategy;
  location?: SelectorStrategy;
};

// NEW: per-card data for re-ranking (Sprint 8 hook)
export type DataExtractorsPerCard = {
  price?: SelectorStrategy;
  bedrooms?: SelectorStrategy;
  bathrooms?: SelectorStrategy;
  area_sqm?: SelectorStrategy;
  price_per_sqm?: SelectorStrategy;
  property_type?: SelectorStrategy;
  has_pool?: SelectorStrategy;
  has_live_session?: SelectorStrategy; // app.estalara.com specific
  is_offplan?: SelectorStrategy; // Bayut, Lucas Fox
};

export type SlotSelectors = {
  headline?: SelectorStrategy;
  subheadline?: SelectorStrategy;
  description?: SelectorStrategy;
  cta_primary?: SelectorStrategy;
  cta_secondary?: SelectorStrategy;
  feature_section?: SelectorStrategy;
  ai_topics?: SelectorStrategy; // app.estalara.com specific
  tagline?: SelectorStrategy; // new slot (add above H1 if H1 = price)
};

export type IndexSchema = {
  url_patterns: string[];
  listing_card_selector: string;
  container_selector?: string; // SPRINT 8 HOOK: grid container for ReorderDirective
  listing_count_expected?: number;
  card_field_mappings: CardFieldMappings;
  data_extractors_per_card: DataExtractorsPerCard; // SPRINT 8 HOOK
  sort_options_available?: boolean;
  reorder_capable: boolean;
};

export type DetailSchema = {
  url_patterns: string[];
  slot_selectors: SlotSelectors;
  data_extractors: Record<string, SelectorStrategy>;
  similar_listings_selector?: string; // SPRINT 8 HOOK: re-ranking target
  h1_is_price?: boolean; // app.estalara.com edge case
};

export type TenantSiteSchema = {
  tenant_id: string;
  domain: string;
  detected_at: string;
  detection_source:
    | 'data_estalara'
    | 'json_ld'
    | 'data_testid'
    | 'data_cy'
    | 'article_tag'
    | 'css_modules'
    | 'mui'
    | 'css_in_js'
    | 'angular'
    | 'wordpress'
    | 'drupal'
    | 'php_classic'
    | 'ai_vision'
    | 'manual';
  detection_confidence: number; // 0..1
  framework_hint?: 'react' | 'nextjs' | 'svelte' | 'angular' | 'wordpress' | 'drupal' | 'php';
  index_schema: IndexSchema;
  detail_schema: DetailSchema;
  last_validated?: string;
  validation_health?: number; // 0..1
};
```

2. `packages/shared/src/directives.ts` — dodaj `ReorderDirective` stub:

```typescript
// SPRINT 8 HOOK: ReorderDirective
// Full implementation in Sprint 8 (A/B framework + re-ranking)
export type ReorderDirective = {
  type: 'reorder';
  container_selector: string;
  item_selector: string;
  score_function: 'archetype_affinity';
  scores: Array<{
    listing_id: string;
    score: number; // 0..1
  }>;
  pin_top_n?: number;
  archetype: string;
  confidence: number;
};

// Add to existing DirectiveUnion type
export type DirectiveUnion = TextDirective | ClassDirective | AttributeDirective | ReorderDirective; // SPRINT 8 HOOK
```

3. `packages/sdk/src/auto-detect/pipeline.ts` — skeleton:

```typescript
export type DetectionResult = {
  schema: TenantSiteSchema | null;
  confidence: number;
  technique: TenantSiteSchema['detection_source'];
  warnings: string[];
};

export async function detectSiteSchema(
  html: string,
  url: string,
  tenantId: string,
): Promise<DetectionResult> {
  // Detection priority order (from corpus analysis):
  // 1. data-estalara-* (Tier 3 Native — our own sites)
  // 2. JSON-LD RealEstateListing (Kyero, Zillow, RE/MAX, Realtor.com)
  // 3. data-testid / data-cy (Rightmove, Zoopla, Otodom, OLX)
  // 4. article tag (Idealista, OnTheMarket, Habitaclia)
  // 5. CSS Modules [class*=Prefix] (Rightmove, Zoopla)
  // 6. MUI MuiPaper-root (Foxtons, RE/MAX, Coldwell Banker)
  // 7. CSS-in-JS [class*=keyword] (Engelvoelkers, Bayut, Knight Frank)
  // 8. WordPress classes (Houzez, RealHomes)
  // 9. Drupal field-- (Zyprus)
  // 10. PHP classic (Bazaraki, Habitaclia)
  // 11. AI Vision fallback (Claude Sonnet 4.6)

  throw new Error('Not implemented — see AUTO-003 and AUTO-004');
}
```

4. Eksportuj z `packages/shared/src/index.ts`

**DONE criteria:**

- [ ] `TenantSiteSchema` type w packages/shared, eksportowany
- [ ] `ReorderDirective` stub w directives.ts — kompiluje się, używa `type: 'reorder'`
- [ ] `container_selector` i `data_extractors_per_card` pola obecne w typach
- [ ] `detectSiteSchema` skeleton z komentarzami priority order
- [ ] `pnpm typecheck` zielone

---

### AUTO-003 — Detection Techniques 1–6 (Deterministic)

**Agent:** sdk-engineer **Model:** Sonnet 4.6 **Estimated time:** 8h **Depends on:** AUTO-002

**Scope:** Implementacja 6 deterministycznych technik detection (bez AI). Każda technika przyjmuje
`html: string` i zwraca `DetectionResult | null`.

**Deliverables:**

`packages/sdk/src/auto-detect/techniques/`:

**1. `data-estalara.ts`** — Tier 3 Native detection:

```typescript
// Wykrywa data-estalara-* atrybuty
// Zwraca confidence: 1.0 (my own code)
// Wypełnia data_extractors_per_card z data-estalara-* attr names
// Edge case: H1 = price (app.estalara.com) → dodaje tagline slot
```

**2. `json-ld.ts`** — JSON-LD RealEstateListing bypass:

```typescript
// Parsuje script[type="application/ld+json"]
// Szuka @type: RealEstateListing, SingleFamilyResidence, Apartment
// Mapuje JSON-LD paths do SelectorStrategy.json_ld_path
// Platforms: Kyero, Zillow detail, RE/MAX detail, Realtor.com detail
// Zwraca confidence: 0.95
```

**3. `data-attributes.ts`** — data-testid / data-cy:

```typescript
// Szuka data-testid="property-card", data-testid="listing-card-content"
// Szuka data-cy="listing-item-*", data-cy="l-card"
// Corpus coverage: Rightmove, Zoopla, Otodom, OLX, Bayut, Coldwell Banker, Zillow
// Zwraca confidence: 0.92
```

**4. `article-tag.ts`** — semantic article detection:

```typescript
// Szuka article[class*='item'], article[class*='card'], article[class*='listing']
// Liczy artykuły z price+img (repeating pattern)
// Corpus coverage: Idealista (article.item), OnTheMarket (article.block), Habitaclia
// Special: article.js-list-item (Habitaclia) — 'js-' prefix = stable hook
// Zwraca confidence: 0.85
```

**5. `css-modules.ts`** — CSS Modules prefix detection:

```typescript
// Wzorzec: ClassName_componentName__hash
// Szuka [class*='PropertyCard_'], [class*='Listings_'], [class*='HomeCard']
// Generuje partial match selector: div[class*='PropertyCard_propertyCard']
// Corpus coverage: Rightmove, Zoopla, Redfin
// Zwraca confidence: 0.82
```

**6. `mui-components.ts`** — Material UI detection:

```typescript
// Szuka article.MuiPaper-root lub div.MuiPaper-root z price+img
// MUI = corporate franchise pattern (same markup globally)
// Corpus coverage: Foxtons, RE/MAX, Coldwell Banker
// Zwraca confidence: 0.88
```

**Pipeline integration** — `pipeline.ts`:

```typescript
export async function detectSiteSchema(html, url, tenantId) {
  const techniques = [
    detectDataEstalara, // 1.0 confidence → immediate return
    detectJsonLd, // 0.95
    detectDataAttributes, // 0.92
    detectMui, // 0.88
    detectArticleTag, // 0.85
    detectCssModules, // 0.82
    // AUTO-004: detectCssInJs, detectWordPress, detectDrupal, detectPhp
    // AUTO-004: detectAiVision (fallback)
  ];

  for (const technique of techniques) {
    const result = await technique(html, url);
    if (result && result.confidence >= 0.8) {
      return { ...result, tenant_id: tenantId };
    }
  }

  // Fallback: AI Vision (AUTO-004)
  return null;
}
```

**Tests** `__tests__/techniques.test.ts`:

- Po jednym `it()` dla każdej techniki z fixture HTML z corpus
- Weryfikacja: poprawny selector, confidence >= threshold, data_extractors_per_card wypełnione

**DONE criteria:**

- [ ] 6 technique plików w `techniques/`
- [ ] Każda technika ma testy na minimum 2 fixture'ach z corpus
- [ ] Pipeline wywołuje techniki w kolejności priority
- [ ] `pnpm typecheck && pnpm test` zielone

---

### AUTO-004 — Detection Techniques 7–11 + AI Vision Fallback

**Agent:** sdk-engineer + ml-engineer **Model:** Sonnet 4.6 (kod) | Sonnet 4.6 jako Vision API (AI
fallback) **Estimated time:** 8h **Depends on:** AUTO-003

**Scope:** Pozostałe 5 technik detection + AI Vision fallback. Uwaga: techniki 7–10 obsługują
"niestabilne" frameworki (CSS-in-JS, Angular) gdzie klasy się zmieniają — kluczowe jest generowanie
partial-match selectors.

**Deliverables:**

**7. `css-in-js.ts`** — styled-components / CSS-in-JS:

```typescript
// Wykrywa pattern: klasa = kilka losowych znaków (a4f288ba, jTESSm, etc.)
// Generuje partial match: article[class*='SearchResultCard'] zamiast article.SearchResultCard-sc-a303eae3-14
// Corpus coverage: Engelvoelkers, Bayut, Redfin
// KLUCZOWA LEKCJA Z CORPUS: nigdy nie używaj full CSS-in-JS hash jako selector
// Zwraca confidence: 0.75 (niższy bo partial match = less precise)
// Zapisuje w schema: stable_selector (partial) + volatile_selector (current hash dla debug)
```

**8. `angular.ts`** — Angular ng-tns detection:

```typescript
// Wykrywa ng-tns-c{number}-{number} pattern
// Angular = jeszcze bardziej niestabilne niż CSS-in-JS (zmienia się z każdym buildem)
// Strategia: ignore ng-tns, szukaj struktury: div:has(img) + div:has([class*='price'])
// Corpus coverage: Knight Frank
// Zwraca confidence: 0.70
```

**9. `wordpress.ts`** — WordPress theme detection:

```typescript
// Sprawdza meta[name="generator"] = WordPress
// Mapuje theme-specific classes:
//   Houzez → div.item-listing-wrap (stable, ~55k sites)
//   RealHomes Ultra → article (semantic)
//   WP Residence → article.property-item (theme-controlled)
// Corpus coverage: Houzez demo, RealHomes
// Zwraca confidence: 0.90 (WordPress classes są stable)
```

**10. `drupal-php.ts`** — Drupal/classic PHP:

```typescript
// Drupal: szuka field--name-* pattern (very stable — Drupal naming convention)
// PHP classic: szuka div.advert (Bazaraki), article.js-list-item (Habitaclia)
// Zwraca confidence: 0.88
```

**11. `ai-vision.ts`** — Claude Sonnet 4.6 fallback:

```typescript
// Wywoływany TYLKO gdy techniki 1-10 nie dają confidence >= 0.70
// Input: HTML (pierwsze 50KB) + screenshot (jeśli dostępny)
// Prompt: "Identify listing cards, price selector, headline selector,
//          bedrooms/area data extraction selectors on this real estate page.
//          Return JSON matching TenantSiteSchema format."
// Cost: ~$0.05 per detection (Sonnet 4.6 vision)
// Rate limit: max 1 AI Vision call per tenant per 24h (cached w Postgres)
// Zwraca confidence: wynik z modelu (0..1)
```

**Price format normalization** `utils/price-parser.ts`:

```typescript
// Obsługuje wszystkie formaty z corpus:
// €335.000 (Bazaraki — dot as thousands separator)
// €239,000 (Zyprus — comma as thousands separator)
// £3,000,000 (Knight Frank)
// $128,000,000 (Realtor.com)
// AED 6,800,000 (Bayut)
// "Price on request" / "POA" → special value (Engelvoelkers luxury)
// PLN 12,836,054 (Engelvoelkers Warsaw)
export function parsePrice(raw: string): { value: number | 'POA'; currency: string } | null;
```

**Currency converter stub** (Sprint 8 will use it):

```typescript
// {price} placeholder → '488,168 EUR' or '$531,000 USD' based on buyer locale
// Stub for now: just return formatted price in detected currency
export function formatPrice(value: number | 'POA', currency: string, locale: string): string;
```

**DONE criteria:**

- [ ] 5 technique plików (css-in-js, angular, wordpress, drupal-php, ai-vision)
- [ ] `price-parser.ts` z testami na wszystkich formatach walutowych z corpus
- [ ] CSS-in-JS technika generuje `[class*='keyword']` partial match, NIE pełny hash
- [ ] AI Vision wywoływany tylko jako fallback, z rate limiting
- [ ] Full pipeline działa end-to-end na HTML z dowolnego fixture

---

### AUTO-005 — Corpus CI Gate Validation

**Agent:** qa-engineer **Model:** Opus 4.7 xhigh (scoring + edge cases) **Estimated time:** 6h
**Depends on:** AUTO-003, AUTO-004

**Scope:** Uruchomienie corpus.test.ts na wszystkich 24 fixturach, osiągnięcie precision ≥95% i
recall ≥80%, oraz dodanie corpus CI gate do GitHub Actions.

**Deliverables:**

1. Uruchom `pnpm test:corpus` — zidentyfikuj które platformy failują

2. Dla każdego faila — popraw technique (nie ground-truth!):
   - Zbyt szeroki selector (false positives) → zawęź
   - Zbyt wąski selector (false negatives) → dodaj fallback
   - Brakujący `data_extractors_per_card` → dodaj ekstrakcję

3. Szczególna uwaga na edge cases z corpus:
   - **Engelvoelkers**: CSS-in-JS, "Price on request" → `POA` value
   - **Bayut**: CSS-in-JS, AED currency, `data-cy` obecne
   - **Knight Frank**: Angular ng-tns niestabilne
   - **app.estalara.com**: SvelteKit, H1=price edge case, `data-estalara-*`
   - **Kyero detail**: JSON-LD RealEstateListing → full bypass DOM
   - **Zyprus**: Drupal `field--name-*` pattern

4. Dodaj do `.github/workflows/ci.yml`:

```yaml
- name: Corpus CI Gate
  run: pnpm --filter @estalara/sdk test:corpus
  # Fails if precision < 95% or recall < 80%
```

5. Wygeneruj `corpus-report.json` po każdym test run:

```json
{
  "precision": 0.97,
  "recall": 0.83,
  "by_platform": {
    "001-otodom-mokotow": { "precision": 1.0, "recall": 0.92, "technique": "data_cy" },
    "011-idealista": { "precision": 0.95, "recall": 0.85, "technique": "article_tag" },
    ...
  },
  "failures": [],
  "warnings": ["027-bayut: CSS-in-JS selector may drift on next deploy"]
}
```

**DONE criteria:**

- [ ] `pnpm test:corpus` zielone: precision ≥95%, recall ≥80%
- [ ] 000-app-estalara precision = 100%
- [ ] CI gate w GitHub Actions blokuje merge jeśli thresholds nie spełnione
- [ ] `corpus-report.json` generowany po każdym test run
- [ ] Żadna technika nie używa pełnego CSS-in-JS hash jako primary selector

---

### AUTO-006 — Detection Preview UI (Control Plane)

**Agent:** backend-engineer **Model:** Sonnet 4.6 **Estimated time:** 6h **Depends on:** AUTO-002,
AUTO-003

**Scope:** Strona w control-plane która pozwala agencji zobaczyć co auto-detect wykrył na jej
stronie. Wizualizacja selektorów + możliwość korekty manualnej.

**Deliverables:**

1. Route: `apps/control-plane/src/app/dashboard/detection/page.tsx`

2. API endpoint: `POST /api/detect` — przyjmuje `{ url: string }`, zwraca `TenantSiteSchema`

3. UI layout:

```
┌─────────────────────────────────────────────────────┐
│ 🔍 Site Detection                                    │
│                                                      │
│ URL: [https://agencja-marbella.com/properties  ] [→] │
│                                                      │
├─────────────────────┬───────────────────────────────┤
│ Detection Results   │ Preview                        │
│                     │                                │
│ ✅ Technique: JSON-LD│ [screenshot z kolorowymi      │
│ Confidence: 95%     │  boxami nad listingami]         │
│                     │                                │
│ Index page:         │ 🟠 Listing cards (42x)         │
│   Cards: article.item│ 🟢 Headlines                  │
│   Count: 42         │ 🔵 Prices                      │
│   Container: ul.items│ 🟡 Bedrooms/Area              │
│                     │                                │
│ Data extractors:    │                                │
│   price: ✅ €1,200k  │                               │
│   bedrooms: ✅ 3     │                               │
│   area_sqm: ✅ 120m² │                               │
│   container: ✅ ul   │                               │
│                     │                                │
│ [Edit manually]     │                                │
│ [Save & activate]   │                                │
└─────────────────────┴───────────────────────────────┘
```

4. Zapisuje `TenantSiteSchema` do Postgres tabeli `tenant_site_schemas`:

```sql
CREATE TABLE tenant_site_schemas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  domain TEXT NOT NULL,
  schema JSONB NOT NULL,
  detection_source TEXT NOT NULL,
  detection_confidence FLOAT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, domain)
);
```

5. Migration: `packages/db/migrations/0010_tenant_site_schemas.sql`

**DONE criteria:**

- [ ] Route `/dashboard/detection` dostępna
- [ ] `POST /api/detect` wywołuje `detectSiteSchema()` i zwraca schema
- [ ] Wizualizacja: kolorowe boxy nad selektorami (screenshot z overlay)
- [ ] Możliwość ręcznej edycji selektorów
- [ ] Zapis do Postgres — `tenant_site_schemas` tabela
- [ ] Migration zmergowana i applied

---

### AUTO-007 — Archetype Hints from Site Structure

**Agent:** ml-engineer **Model:** Opus 4.7 xhigh (analiza semantyczna) **Estimated time:** 6h
**Depends on:** AUTO-003

**Scope:** Podczas auto-detection, silnik analizuje strukturę strony i dodaje `archetype_hints` —
sygnały które archetypes są prawdopodobnie obecne na tej stronie. Te hinty zasilają Intent Engine
jako prior (podnoszą baseline confidence dla odpowiednich archetypów).

**Deliverables:**

1. `packages/sdk/src/auto-detect/archetype-hints.ts`:

```typescript
export type ArchetypeHint = {
  archetype_id: string;
  signal: string;
  confidence_boost: number; // 0..0.3
};

export function extractArchetypeHints(
  schema: TenantSiteSchema,
  html: string,
  url: string,
): ArchetypeHint[];
```

2. Heurystyki (z corpus learnings):

```typescript
const ARCHETYPE_SIGNALS = [
  // yield_hunter / investment_buyer
  { pattern: /rental.?yield|roi|investment|investor/i, archetype: 'yield_hunter', boost: 0.15 },
  { pattern: /off.?plan|handover\s*Q[1-4]/i, archetype: 'yield_hunter', boost: 0.2 },
  { pattern: /price.?trend|similar.?transaction/i, archetype: 'yield_hunter', boost: 0.1 },

  // golden_visa_buyer
  {
    pattern: /golden.?visa|residency|AED [0-9,]+|freehold/i,
    archetype: 'golden_visa_buyer',
    boost: 0.25,
  },
  {
    pattern: /regulatory.?information|permit.?number/i,
    archetype: 'golden_visa_buyer',
    boost: 0.2,
  },
  { currency: 'AED', archetype: 'golden_visa_buyer', boost: 0.15 }, // Dubai market

  // family_buyer
  { pattern: /school|kindergarten|playground|family/i, archetype: 'family_buyer', boost: 0.15 },
  { section: 'similar_listings', count: '>= 3', archetype: 'family_buyer', boost: 0.05 },

  // lifestyle_expat
  {
    pattern: /expat|international.?school|english.?speaking|moving.?abroad/i,
    archetype: 'lifestyle_expat',
    boost: 0.2,
  },
  { pattern: /airport|transfer.?fee|non.?resident/i, archetype: 'lifestyle_expat', boost: 0.1 },

  // vacation_rental_investor
  {
    pattern: /vacation.?rental|airbnb|short.?term|resort|pool/i,
    archetype: 'vacation_rental_investor',
    boost: 0.15,
  },
  { pattern: /furnished|ready.?to.?rent/i, archetype: 'vacation_rental_investor', boost: 0.1 },

  // first_time_buyer
  { section: 'mortgage_calculator', archetype: 'first_time_buyer', boost: 0.15 },
  { section: 'stamp_duty_calculator', archetype: 'first_time_buyer', boost: 0.1 },
  { pattern: /buy.?to.?let|yield.?calculator/i, archetype: 'yield_hunter', boost: 0.15 },

  // luxury_buyer
  { priceRange: '>= 2000000', currency: 'EUR', archetype: 'luxury_buyer', boost: 0.2 },
  { priceRange: '>= 5000000', currency: 'USD', archetype: 'luxury_buyer', boost: 0.25 },
  {
    pattern: /exclusive|off.?market|penthouse|prime.?location/i,
    archetype: 'luxury_buyer',
    boost: 0.1,
  },

  // retiree_relocator
  {
    pattern: /retire|second.?home|countryside|peaceful|village/i,
    archetype: 'retiree_relocator',
    boost: 0.15,
  },
];
```

3. Dodaj `archetype_hints: ArchetypeHint[]` do `TenantSiteSchema` type

4. Intent Engine integration — `packages/sdk/src/intent.ts`:

```typescript
// Apply archetype hints as Bayesian priors
// When tenant_site_schema has hints, boost those archetypes' prior probability
// Effect: faster convergence for buyer behavior matching
function applyArchetypeHints(
  currentPriors: ArchetypePriors,
  hints: ArchetypeHint[],
): ArchetypePriors;
```

5. Tests: `__tests__/archetype-hints.test.ts` — test na fixture'ach z corpus:
   - Bayut → `golden_visa_buyer` + `yield_hunter` hints
   - Kyero → `lifestyle_expat` + `vacation_rental_investor` hints
   - Knight Frank → `luxury_buyer` + `retiree_relocator` hints
   - Otodom → `family_buyer` + `first_time_buyer` hints

**DONE criteria:**

- [ ] `extractArchetypeHints()` implementacja z ≥15 signal patterns
- [ ] `archetype_hints` pole w `TenantSiteSchema`
- [ ] Intent Engine przyjmuje hints jako Bayesian prior boosts
- [ ] Testy na 4 reprezentatywnych fixture'ach
- [ ] Hints dla `app.estalara.com` poprawnie wykrywają live-session-related archetypes

---

## Sprint 7.5 — Acceptance Criteria (wszystkie tickets)

```
AC1:  pnpm test:corpus: precision ≥ 95%, recall ≥ 80%
AC2:  000-app-estalara: precision = 100%
AC3:  detectSiteSchema() działa na HTML z dowolnej z 24 fixture platform
AC4:  TenantSiteSchema zawiera container_selector (Sprint 8 hook)
AC5:  TenantSiteSchema zawiera data_extractors_per_card (Sprint 8 hook)
AC6:  ReorderDirective type stub w packages/shared/src/directives.ts
AC7:  CSS-in-JS technika używa [class*='keyword'] partial match, nie pełnego hasha
AC8:  JSON-LD bypass działa dla Kyero/Zillow/RE/MAX/Realtor.com detail pages
AC9:  Price parser obsługuje: PLN, EUR, GBP, USD, AED + "Price on request" → POA
AC10: tenant_site_schemas tabela w Postgres z migration
AC11: Detection Preview UI dostępna w /dashboard/detection
AC12: Archetype hints dla ≥15 signal patterns, testowane na corpus
AC13: CI gate w GitHub Actions blokuje merge jeśli corpus thresholds nie spełnione
AC14: pnpm typecheck && pnpm test zielone (wszystkie pakiety)
AC15: Żaden selector w corpus ground-truths nie używa pełnego CSS-in-JS hash
```

---

## Sprint 7.5 — Lessons from Corpus (dla agentów)

**Krytyczne:**

1. CSS-in-JS klasy (styled-components, Bayut, Knight Frank Angular) ZMIENIAJĄ SIĘ przy każdym
   deploy. Zawsze używaj `[class*='SearchResultCard']` zamiast
   `article.SearchResultCard-sc-a303eae3-14`
2. JSON-LD `RealEstateListing` bypasses DOM — gdy dostępne, użyj `json_ld_path` ekstrakcji. Szybsze
   i odporne na zmiany CSS
3. `data-testid` i `data-cy` są najstabilniejsze — test attributes celowo nie są zmieniane
4. H1 na `app.estalara.com` = cena, nie tytuł — dodaj `tagline` slot powyżej H1
5. "Price on request" na Engelvoelkers luxury — `data_extractors` musi zwracać `POA`, nie `null`

**Währungen (walutowy edge case):**

- `€335.000` (Bazaraki — kropka jako separator tysięcy, nie przecinek!)
- `€239,000` (Zyprus — przecinek)
- `AED 6,800,000` (Bayut — prefix, bez spacji)
- Regex: `[\d,. ]{3,}` wychwytuje wszystkie formaty

**app.estalara.com specific:**

- Framework: SvelteKit (nie Next.js/React)
- `data-sveltekit-preload-data` na `<body>` = identifier
- AI Topics Tags = `[data-estalara-slot='ai-topics']` = reorder target Sprint 8
- Live Session CTA = `[data-estalara-slot='cta-live']` = archetype-aware label Sprint 8

---

## Dependency graph

```
AUTO-001 (corpus setup)
    └── AUTO-002 (schema types)
            ├── AUTO-003 (techniques 1-6)
            │       ├── AUTO-004 (techniques 7-11 + AI)
            │       │       └── AUTO-005 (corpus CI gate) ← BLOCKER for Sprint 8
            │       └── AUTO-007 (archetype hints)
            └── AUTO-006 (detection preview UI) ← parallel z AUTO-003
```

**Critical path:** AUTO-001 → AUTO-002 → AUTO-003 → AUTO-004 → AUTO-005

Sprint 8 NIE MOŻE zacząć dopóki AUTO-005 nie jest DONE (CI gate zielony).

---

## Model upgrade reminder

**AUTO-005 i AUTO-007 używają Opus 4.7 xhigh.**

W QUEUE.md przy tych ticketach dodaj:

```
MODEL: claude-opus-4-7-xhigh
REASON: AUTO-005 requires scoring precision/recall across 24 platforms with edge cases;
        AUTO-007 requires semantic understanding of archetype-signal mapping
```
