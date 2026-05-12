# MASTER_DESIGN.md — Patch v1.4 → v1.5

# Data: 2026-05-12

# Dodaje: B.8, B.9, E.6, Sprint 7.5 spec, aktualizacja Section P roadmap

# Instrukcja dla architekta: wklej każdą sekcję w odpowiednie miejsce w docs/MASTER_DESIGN.md

---

## SEKCJA B.8 — Reference Corpus for Auto-Detection

(wklej po B.7 "Onboarding Metrics")

### B.8. Reference Corpus — Auto-Detection Training & CI Gate

Reference corpus to zbiór 24 ręcznie zwalidowanych platform nieruchomości, służący jako "egzamin"
dla Auto-Detection Engine. Każda platforma ma `index-ground-truth.json` i `detail-ground-truth.json`
z poprawnymi selektorami.

**Lokalizacja w repo:** `packages/sdk/src/auto-detect/__fixtures__/`

**CI Gate:** `pnpm test:corpus` — blokuje merge jeśli precision <95% lub recall <80%.  
**Wyjątek:** `000-app-estalara` wymaga 100% precision (własny kod).

#### B.8.1. Pokrycie corpus

| Region | Platformy                                                                        | Wzorzec detekcji                  |
| ------ | -------------------------------------------------------------------------------- | --------------------------------- |
| PL     | Otodom, OLX, Morizon, Gratka                                                     | data-cy attributes                |
| UK     | Rightmove, Zoopla, OnTheMarket, Foxtons, Knight Frank                            | data-testid / MUI / Angular       |
| ES     | Idealista, Habitaclia, Engelvoelkers, Kyero, Lucas Fox                           | article tag / CSS-in-JS / JSON-LD |
| USA    | Zillow, Realtor.com, Redfin, Compass, Coldwell Banker, RE/MAX, Houzez, RealHomes | data-testid / JSON-LD / MUI / WP  |
| CY     | Bazaraki, home.cy, Zyprus                                                        | PHP / React / Drupal              |
| UAE    | Bayut                                                                            | CSS-in-JS / data-cy               |
| DEMO   | app.estalara.com                                                                 | data-estalara-\* (Tier 3 Native)  |

#### B.8.2. Detection priority order

Wynika bezpośrednio z analizy corpus. Pipeline próbuje techniki w tej kolejności:

1. **`data-estalara-*`** (confidence: 1.0) — Tier 3 Native, własne strony klientów
2. **JSON-LD `RealEstateListing`** (confidence: 0.95) — bypass DOM, Kyero/Zillow/RE/MAX/Realtor
3. **`data-testid` / `data-cy`** (confidence: 0.92) — Rightmove/Zoopla/Otodom/OLX/Bayut
4. **MUI `MuiPaper-root`** (confidence: 0.88) — Foxtons/RE/MAX/Coldwell Banker
5. **`article` tag semantic** (confidence: 0.85) — Idealista/OnTheMarket/Habitaclia
6. **CSS Modules `[class*=Prefix_]`** (confidence: 0.82) — Rightmove/Zoopla partial match
7. **CSS-in-JS `[class*=keyword]`** (confidence: 0.75) — Engelvoelkers/Bayut/Knight Frank
8. **Angular `ng-tns` structural** (confidence: 0.70) — Knight Frank fallback
9. **WordPress theme classes** (confidence: 0.90) — Houzez/RealHomes (stable)
10. **Drupal `field--name-*`** (confidence: 0.88) — Zyprus
11. **AI Vision fallback** (Sonnet 4.6) — ostateczny fallback, max 1x/24h per tenant

#### B.8.3. Kluczowe lekcje architektoniczne z corpus

**CSS-in-JS instability:** Klasy generowane przez styled-components (Engelvoelkers), CSS-in-JS
(Bayut) i Angular ng-tns (Knight Frank) zmieniają się przy każdym deploy. **Zasada:** zawsze używaj
`article[class*='SearchResultCard']` zamiast `article.SearchResultCard-sc-a303eae3-14`. Nigdy nie
zapisuj pełnego hasha jako selector.

**JSON-LD bypass:** Gdy strona ma `<script type="application/ld+json">` z
`@type: RealEstateListing`, SDK wyciąga dane przez `json_ld_path` zamiast DOM. Szybsze, odporne na
zmiany CSS. Dotyczy: Kyero, Zillow detail, RE/MAX detail, Realtor.com.

**data-testid gold standard:** Selektory `data-testid` i `data-cy` są celowo nie zmieniane przez
deweloperów (służą testom automatycznym). Najstabilniejsze po `data-estalara-*`.

**Price on request (POA):** Engelvoelkers i inne luxury portale nie pokazują ceny. `data_extractors`
musi zwracać `'POA'` jako specjalną wartość, nie `null`.

**Walutowa różnorodność:** PLN, EUR, GBP, USD, AED — każda z osobnym formatem tysięcy. `€335.000`
(Bazaraki: kropka), `€239,000` (Zyprus: przecinek), `AED 6,800,000` (prefix).

---

## SEKCJA B.9 — app.estalara.com Native Integration

(wklej po B.8)

### B.9. app.estalara.com — Adaptive Listings Native Integration

`app.estalara.com` to główny produkt Estalary (live streaming nieruchomości, SvelteKit). Adaptive
Listings jest w niego wbudowany jako **Tier 3 Native** — atrybuty `data-estalara-*` dodane
bezpośrednio w komponentach Svelte.

**Framework:** SvelteKit (nie Next.js/React). `data-sveltekit-preload-data` na `<body>`.  
**SDK inicjalizacja:** `+layout.svelte` —
`onMount(() => init({ tenantId: 'estalara-platform', tier: 3 }))`.

#### B.9.1. Kluczowy edge case — H1 = cena

Na stronach detail `app.estalara.com`, `<h1>` zawiera cenę (`488,168 EUR`), nie tytuł. Adres jest w
`<div>` poniżej. SDK musi to obsłużyć przez dodanie nowego slotu:

```svelte
<!-- Nowy element powyżej H1 — per-archetype tagline -->
<p data-estalara-slot="tagline">{listing.address}</p>
<h1>{formattedPrice}</h1>
```

#### B.9.2. Największe szanse produktowe

**AI Topics reordering** — detail page ma tagi: `Transport | Schools | Parks | Retail`. Sprint 8
`ReorderDirective` zmienia kolejność per archetype:

- `yield_hunter` → Rental potential, ROI data, Transport
- `family_buyer` → Schools, Parks, Safety, Transport
- `lifestyle_expat` → International schools, English services, Expat community

**Live Session CTA per archetype:**

- `lifestyle_expat` → "Join live tour — English-speaking agent"
- `yield_hunter` → "Join investor Q&A"
- `golden_visa_buyer` → "Ask about residency requirements"

**"Properties you might also like"** — sekcja nie istnieje na obecnej stronie detail. Sprint 8
dodaje ją dynamicznie jako archetype-ranked grid.

#### B.9.3. Wymagane atrybuty w SvelteKit komponentach

```svelte
<!-- ListingCard.svelte -->
<div
  data-estalara-listing-id={listing.slug}
  data-estalara-price={listing.price}
  data-estalara-currency={listing.currency}
  data-estalara-bedrooms={listing.bedrooms}
  data-estalara-area={listing.area_sqm}
  data-estalara-country={listing.country_code}
  data-estalara-property-type={listing.type}
  data-estalara-has-live-session={listing.hasLiveSession ? 'true' : 'false'}
>
  <p data-estalara-slot="tagline">{listing.address}</p>
  <span data-estalara-slot="price">{formattedPrice}</span>
  <!-- reszta bez zmian -->
</div>
```

**Sprint 8 ticket:** `NATIVE-001 — app.estalara.com Adaptive Listings integration`  
**Odpowiedzialny:** Rafał (CTO) dodaje atrybuty, Krystian (CPO) zatwierdza slot mapping.

---

## SEKCJA E.6 — Placeholder Resolution Order

(wklej po E.5 lub na końcu sekcji E)

### E.6. Placeholder Resolution Order (Locked Architecture)

Gdy SDK musi wypełnić placeholder np. `{price}` lub `{school_rating}` w adaptowanym tekście,
sprawdza źródła danych w ustalonej hierarchii. Każdy level degraduje do następnego.

| Level | Źródło                                     | Przykład                       | Pewność |
| ----- | ------------------------------------------ | ------------------------------ | ------- |
| **1** | `data-estalara-*` atrybuty (manual)        | `data-estalara-price="488168"` | 1.0     |
| **2** | Agency-provided answers per listing        | Agent odpowiada: "yield: 6.2%" | 0.95    |
| **3** | Auto-extracted z DOM via `data_extractors` | CSS selector → "€488,168"      | 0.85    |
| **4** | Computed metrics                           | price/area_sqm → price_per_sqm | 0.80    |
| **5** | Cached enrichments z external APIs         | school_rating, walkability     | 0.75    |
| **6** | LLM generation (Haiku 4.5 / Sonnet 4.6)    | Generates missing copy         | 0.60    |
| **7** | Skip directive                             | Placeholder usunięty z tekstu  | —       |

**Zasada:** każdy level jest próbowany tylko jeśli poprzedni zwrócił `null`. Level 6 (LLM) kosztuje
~$0.001 per placeholder — cache agresywnie per listing per archetype.

---

## SEKCJA P — aktualizacja roadmapy

(zastąp istniejącą tabelę w Section P sprint mapping)

### Aktualny roadmap (stan: 2026-05-12)

| Sprint         | Status          | Kluczowe deliverable                                                      |
| -------------- | --------------- | ------------------------------------------------------------------------- |
| Sprint 0       | ✅ DONE         | Monorepo, CI, vendor accounts                                             |
| Sprint 1       | ✅ DONE         | Ingest pipeline, ClickHouse, SDK skeleton                                 |
| Sprint 1.5     | ✅ DONE         | OTel, error format, security headers, Drizzle RLS, PII blacklist          |
| Sprint 2       | ✅ DONE         | Postgres schema, tenant auth, multi-tenancy, Stripe stub                  |
| Sprint 3       | ✅ DONE         | Agency registration, Admin panel, Demo Mode mockup                        |
| Sprint 4       | ✅ DONE         | Decision API, SDK quiz widget, Bayesian Intent Engine                     |
| Sprint 5       | ✅ DONE         | Quiz analytics, DQS, SDK publish                                          |
| Sprint 6       | ✅ DONE         | Embeddings, 18 archetypes                                                 |
| Sprint 7 Ph.1  | ✅ DONE         | Real Decision API logic, 18 playbooks, confidence routing                 |
| Sprint 7 Ph.2  | 🟡 IN PROGRESS  | LiteLLM gateway (ADP-002), DOM mutations (ADP-004), DQS metrics (DQS-001) |
| **Sprint 7.5** | 📋 SPEC READY   | Auto-Detection Engine (AUTO-001..007), corpus CI gate                     |
| **Sprint 8**   | 📋 SCOPE LOCKED | A/B framework, agency answers etap A, ReorderDirective, NATIVE-001        |
| **Sprint 9**   | 🗓 PLANNED      | GDPR — consent management, DSR endpoints, DPIA update                     |
| **Sprint 10**  | 🗓 PLANNED      | External enrichment APIs (school ratings, walkability, yield estimates)   |
| Sprint 12+     | 🔮 POST-MVP     | Profile Mode (identified buyers) — osobny spec doc                        |

### Model upgrade schedule

| Sprint                                 | Model                                                            |
| -------------------------------------- | ---------------------------------------------------------------- |
| Sprint 0–6                             | Sonnet 4.5 (boilerplate/infra)                                   |
| Sprint 7+                              | Sonnet 4.6 (standard tickets)                                    |
| Sprint 7.5 AUTO-005, AUTO-007          | **Opus 4.7 xhigh** (scoring precision, semantic archetype hints) |
| Sprint 8+ NATIVE-001, ReorderDirective | **Opus 4.7 xhigh** (innovative algorithmic work)                 |
| Sprint 4+ ML core                      | **Opus 4.7 xhigh** (ML embeddings, matching logic)               |

---

## SEKCJA Y — Sprint 7.5 Specification

(nowa sekcja na końcu dokumentu)

### Y. Sprint 7.5 — Auto-Detection Engine Specification

> Pełny spec: `docs/specs/SPRINT_7_5_SPEC.md`  
> Warunek wejścia: Sprint 7 Phase 2 DONE + CI zielone  
> Warunek wyjścia: corpus CI gate ≥95% precision, ≥80% recall

#### Y.1. Tickets overview

| Ticket   | Agent            | Model              | Deliverable                                                                    |
| -------- | ---------------- | ------------------ | ------------------------------------------------------------------------------ |
| AUTO-001 | qa-engineer      | Sonnet 4.6         | Corpus fixtures w repo + CI gate skeleton                                      |
| AUTO-002 | sdk-engineer     | Sonnet 4.6         | TenantSiteSchema type + ReorderDirective stub + container_selector             |
| AUTO-003 | sdk-engineer     | Sonnet 4.6         | Techniki 1–6: data-estalara, JSON-LD, data-testid, MUI, article, CSS Modules   |
| AUTO-004 | sdk-engineer     | Sonnet 4.6         | Techniki 7–11: CSS-in-JS, Angular, WordPress, Drupal, AI Vision + price parser |
| AUTO-005 | qa-engineer      | **Opus 4.7 xhigh** | Corpus CI gate: precision ≥95%, recall ≥80%                                    |
| AUTO-006 | backend-engineer | Sonnet 4.6         | Detection Preview UI + tenant_site_schemas tabela                              |
| AUTO-007 | ml-engineer      | **Opus 4.7 xhigh** | Archetype hints z struktury strony → Bayesian priors                           |

#### Y.2. Obowiązkowe Sprint 8 hooks

Każdy agent MUSI zostawić przed zamknięciem Sprint 7.5:

1. **`data_extractors_per_card`** — pole w `TenantSiteSchema`, wypełniane przez detection
2. **`ReorderDirective`** — type stub w `packages/shared/src/directives.ts`
3. **`container_selector`** — selector gridu w `IndexSchema` (dla ReorderDirective)
4. **`similar_listings_selector`** — w `DetailSchema` (re-ranking target Sprint 8)

#### Y.3. Critical path

```
AUTO-001 → AUTO-002 → AUTO-003 → AUTO-004 → AUTO-005 (BLOCKER dla Sprint 8)
                    └──────────────────────────────── AUTO-006 (parallel)
                    └── AUTO-007 (parallel, po AUTO-003)
```

Sprint 8 NIE MOŻE zacząć dopóki AUTO-005 nie jest DONE.
