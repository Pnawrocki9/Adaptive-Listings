# Estalara Adaptive Listings — Dogłębna analiza architektoniczno-biznesowa

**Wersja:** 1.2 (Master Design Document) | **Data:** 30 kwietnia 2026 | **Autorzy odbiorcy:** Piotr Nawrocki (CEO), Rafał Palak PhD (CTO), Krystian Wojtkiewicz PhD (CPO)

**Changelog v1.2 (30 April 2026 — Post Sprint 0 strategic upgrade):**
- ✨ Nowa sekcja **K "Internal Operations Panel (Estalara Staff Only)"** — RBAC, monitoring + intervention dla staff Estalara
- ✨ Nowa sekcja **D.5 "Continuous Detection Quality System"** — system osiągania 90–97% accuracy z self-supervised metrics
- ✨ Nowa sekcja **R "Innovation Roadmap & Patent Strategy"** — 6 obszarów unique IP + patent filing roadmap
- 🔄 Rozszerzona sekcja **E.3** o causal inference framework (CATE) i multi-objective optimization
- 🔄 Rozszerzona sekcja **B.5** o predictive drift detection (B.5.4)
- 🔄 Rozszerzona sekcja **O** (była N) o **O.6** (ML model risks) plus accuracy regression w O.1
- 📐 Renumeracja: stare K–Q stają się L–S (przesunięcie +1 dla nowej sekcji K, plus nowa R między Q i S)

**Changelog v1.1:**
- ✨ Nowa sekcja **B.4 "Auto-Onboarding & Zero-Config Installation"** — automatyzacja całego procesu instalacji i konfiguracji
- ✨ Nowa sekcja **B.5 "Schema Discovery & Auto-Configuration Pipeline"** — jak system automatycznie wykrywa strukturę danych
- ✨ Nowa sekcja **B.6 "Continuous Schema Validation & Self-Healing"** — auto-fix gdy strona klienta się zmieni
- ✨ Nowa sekcja **B.7 "Pre-Built Platform Templates Library"** — gotowe templates dla 50+ platform
- 🔄 Zaktualizowana sekcja **J.3** o `auto_detected_schema` w `TenantConfig`
- 🔄 Zaktualizowana sekcja **P.1** — dodano "Sprint 0" dla auto-onboarding infrastructure
- 🔄 Zaktualizowana sekcja **A.1** — dodano "Auto-Detection Service" w diagramie komponentów

---

## Executive Summary (1 strona)

Estalara Adaptive Listings to **embeddable AI layer + standalone SaaS** dla rynku nieruchomości, który w czasie rzeczywistym personalizuje listingi pod konkretnego, anonimowego kupującego — na bazie sygnałów behawioralnych, treści chatu i podróży cross-listing. Produkt sprzedajemy w trzech tierach (Observer / Augment / Native), z modelem hybrydowym (base fee + usage), w czterech regionach (US/UK/EU/UAE) od dnia 1.

**Najważniejsze rekomendacje strategiczne:**

1. **Architektura "jeden core, dwa entry-pointy".** Jeden monorepo (Turborepo) z trzema artefaktami: (a) `@estalara/sdk` (vanilla TS + Preact + Shadow DOM, <40 KB gzip), (b) `apps/ingest` (Cloudflare Workers, low-latency edge), (c) `apps/control-plane` (Next.js App Router na Vercel — dashboard + standalone product).
2. **Stack zorientowany na latency i koszt.** Ingest na Cloudflare Workers (zero cold start, $0.30/M req), event store ClickHouse Cloud, transakcyjny Postgres (Supabase) z Row Level Security per `tenant_id`, embeddings w pgvector do 5–10M wektorów, później migracja do Qdrant. LLM-y: **Claude Haiku 4.5 ($1/$5 per MTok)** jako workhorse, **Sonnet 4.6 ($3/$15)** dla złożonych decyzji adaptacji, fallback OpenAI dla redundancji ([Anthropic pricing](https://www.anthropic.com/news/claude-haiku-4-5)).
3. **Behavioral fingerprinting jako MVP, ale z legitimate-interest framework + opt-out.** EDPB Guidelines 2/2023 (final 16.10.2024) i ICO (grudzień 2024) jasno traktują fingerprinting jako objęty Art. 5(3) ePrivacy — czyli **wymaga consent w EU/UK** dla celów marketingowych ([EDPB](https://www.edpb.europa.eu/news/news/2023/edpb-provides-clarity-tracking-techniques-covered-eprivacy-directive_en), [ICO](https://ico.org.uk/about-the-ico/media-centre/news-and-blogs/2024/12/our-response-to-google-s-policy-change-on-fingerprinting/)). Realne podejście: **session-scoped probabilistic ID** (bez persystencji cross-site bez consent), cross-listing tylko w obrębie jednego tenanta, a globalna agregacja na poziomie *behavioral archetypes* (k-anonymity ≥50, differential privacy ε≤2). To pozwala uruchomić produkt bez consent banneru w 80% scenariuszy, ale **wymaga DPIA, ROPA i jasnej legitimate-interest assessment per tenant**.
4. **Data network effect zbudowany jako embedding space archetypów, nie surowych profili.** Centralized aggregation z DP, nie federated learning (FL jest 1–2 lata przedwczesny dla naszego use case). MOAT: każdy nowy klient zwiększa pokrycie i precyzję ~50–200 archetypów buyera (relocating-family, cross-border-investor, downsizing-retiree, school-district-focus etc.).
5. **Pricing hybrid, anchored przez Mutiny/Dynamic Yield.** Tier 1 Observer: $499/mo + $0.40/1k visits. Tier 2 Augment: $1 999/mo + $1.20/1k adaptations. Tier 3 Native: $7 500/mo + $4/1k rendered listings + LLM passthrough +25%. Enterprise (Idealista/Otodom skala): six-figure annual. Dla porównania Optimizely starts ~$36k/rok, Dynamic Yield ~$35–60k+/rok, Mutiny custom ($10k+/mo na ABM tier) ([Optimizely](https://www.geteppo.com/blog/optimizely-pricing), [Dynamic Yield](https://www.personizely.net/blog/dynamic-yield-pricing)).
6. **AI Act: classify defensively jako *NIE* high-risk, ale przygotuj dokumentację jakby był.** Estalara nie podejmuje automatycznych decyzji o dostępie do mieszkania (decyzję podejmuje agent + buyer); to *recommendation/personalization*, nie *eligibility/credit scoring*. Annex III nie obejmuje real-estate marketingu. Ale ponieważ pełen AI Act zacznie obowiązywać 2 sierpnia 2026 ([European Commission](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai)), trzymamy DPIA + risk-management + transparency + human oversight zgodne z high-risk od dnia 1 — to też pozytywny sygnał dla enterprise klientów.
7. **MVP w 12 tygodniach, zespół 5 FTE (Piotr/CEO, Rafał/CTO, Krystian/CPO + 2 senior engineers).** Budżet MVP: ~€180k–€250k (zespół ~€140k przy kontraktorach + €25–40k infra/LLM credits + €15k legal/DPIA). Pilot z 3–5 agencjami w Marbelli, Warszawie i Londynie, public launch Q4 2026.

8. **🆕 Zero-config onboarding jako strategiczny moat (v1.1).** "Copy-paste & go live w 60s" — admin wkleja URL strony, AI (Claude Sonnet 4.6 Vision + Puppeteer + 15 pre-built platform templates) wykrywa strukturę automatycznie, generuje script tag, monitoruje drift i sam się naprawia gdy strona klienta się zmieni. To **redukuje time-to-value z dni do minut** i jest naszym #1 differentiator vs Mutiny/Dynamic Yield (które wymagają tygodni implementacji). Koszt: ~$0.33 per tenant onboarding — negligible vs ACV. WordPress Plugin (~40% rynku SMB) daje 1-click install bez devu. Patrz sekcja B.4–B.7.

**Największe ryzyka:** (1) ICO/CNIL enforcement na fingerprinting bez consent — mitigujemy przez session-only mode w EU oraz "Estalara Consent Helper" jako component; (2) Vendor lock-in na LLM — mitigujemy przez router (LiteLLM) i embeddings na BGE-M3 self-hosted dla taniej skali; (3) Konkurencja Mutiny / Zillow — MOAT to **vertical depth** (real-estate-specific intent ontology) i **embeddable-first DX** (Mutiny jest stand-alone, nie embeddable do cudzych stron).

---

## A. Wysokopoziomowa architektura systemu

### A.1. Diagram komponentów (logical view)

```
┌─────────────────────────────────────────────────────────────────────┐
│  CLIENT WEBSITE (Idealista, agencja w Marbelli, custom Wordpress)   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  @estalara/sdk (vanilla TS + Preact, Shadow DOM, <40 KB)     │   │
│  │  ├─ TIER 1 Observer:  widget overlay (sidebar / floating)    │   │
│  │  ├─ TIER 2 Augment:   DOM mutations via declarative slots    │   │
│  │  └─ TIER 3 Native:    <EstalaraListing/> full component      │   │
│  └─────────────┬────────────────────────────────────────────────┘   │
└────────────────│─────────────────────────────────────────────────────┘
                 │ HTTPS, batched events (every 2s or on flush)
                 │ + WebSocket for live chat / live adaptation
                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  EDGE INGEST (Cloudflare Workers, 4 regions: iad/lhr/fra/dxb)       │
│  - Tenant auth (HMAC-signed API key + origin allowlist)             │
│  - Schema validation (Zod) + rate limit (Durable Objects)           │
│  - Behavioral fingerprint hashing (session-scoped, k-anon bucket)   │
│  - Push to Redpanda Cloud (Kafka-compatible, multi-region)          │
└────────────────┬────────────────────────────────────────────────────┘
                 │
   ┌─────────────┼─────────────────┬────────────────────┐
   ▼             ▼                 ▼                    ▼
┌─────────┐ ┌──────────┐    ┌─────────────┐   ┌──────────────────┐
│ClickHouse│ │ Postgres │    │Intent Engine│   │ Adaptation Engine│
│ Cloud   │ │(Supabase │    │ (Modal +    │   │ (Modal + Claude  │
│(events) │ │  per     │    │  Claude     │   │  Sonnet 4.6 +    │
│         │ │  region) │    │  Haiku 4.5) │   │  templates)      │
└─────────┘ └──────────┘    └──────┬──────┘   └──────────┬───────┘
                                   │                     │
                                   ▼                     ▼
                            ┌──────────────────────────────────┐
                            │   pgvector (per-tenant embedding │
                            │   spaces) + global archetype     │
                            │   embedding space (DP-protected) │
                            └──────────────────────────────────┘
                                   │
                                   ▼
                            ┌──────────────────────────────────┐
                            │  Decision API (Next.js App Router│
                            │  Edge Runtime, returns JSON      │
                            │  adaptation directives in <80ms) │
                            └──────────────────────────────────┘
                                   │
                                   ▼
                            ┌──────────────────────────────────┐
                            │  Control Plane (Next.js dashboard│
                            │  on Vercel, per-tenant analytics,│
                            │  config, white-label, billing)   │
                            └──────────────────────────────────┘
                                   ▲
                                   │ uses
                                   │
                            ┌──────────────────────────────────┐
                            │  Auto-Detection Service          │
                            │  (Modal serverless, on-demand)   │
                            │  - Puppeteer headless browser    │
                            │  - Schema.org/microdata parser   │
                            │  - Platform fingerprint matcher  │
                            │  - Claude Sonnet 4.6 Vision API  │
                            │  - Selector validator            │
                            │  → Generates TenantSchemaMapping │
                            │     (see B.4 / B.5)              │
                            └──────────────────────────────────┘
```

### A.2. Multi-tenant model — kluczowa decyzja

Trzy poziomy izolacji w jednej architekturze:

| Warstwa | Mechanizm izolacji | Egzekucja |
|---|---|---|
| Edge ingest | Tenant API key → tenant_id w każdym evencie | HMAC + origin check w Workerze |
| Postgres (config, tenants, billing) | Row Level Security per `tenant_id` + per-tenant JWT claims | Supabase RLS ([Supabase docs](https://supabase.com/docs/guides/database/postgres/row-level-security)) |
| ClickHouse (events) | Per-tenant partition key + column-level encryption dla PII fields | ClickHouse RBAC + materialized views |
| pgvector (per-tenant embeddings) | Schema-per-tenant dla top-100 enterprise; row-level (`tenant_id` indexed) dla long-tail | Schema-per-tenant ma 4–8x lepszy query throughput dla 1M+ wektorów |
| Global archetype space (Estalara-owned) | DP-aggregated, nie zawiera tenant identifiers, k-anon ≥50 | Differential Privacy ε≤2 stosowane na poziomie batch updates |

Warto zauważyć, że Cloudflare wybrał TimescaleDB nad ClickHouse dla *operational analytics z małymi batch'ami pisanymi przez wiele klientów* — bo ClickHouse buforuje małe inserty na 400ms timer ([Cloudflare blog](https://blog.cloudflare.com/timescaledb-art/)). Dla naszego use case (high-volume events, append-only, bulk aggregation queries) ClickHouse Cloud jest właściwy — ale **agreguj na edge w 5-sekundowe batche przed wysłaniem do ClickHouse**, nie pisz event-by-event. ClickHouse Cloud charge ~$50/mo for hobby ale realistycznie mid-volume to $500–2000/mo ([G2 comparison](https://www.g2.com/compare/clickhouse-vs-timescale)).

### A.3. Multi-region deployment (EU/US/UK/UAE)

| Region | Hosting | Postgres | ClickHouse | LLM endpoint | Compliance |
|---|---|---|---|---|---|
| **EU** (Frankfurt) | Vercel + Cloudflare fra1 | Supabase EU (Frankfurt) | ClickHouse Cloud EU | Claude przez AWS Bedrock eu-central-1 | GDPR primary |
| **US** (Virginia) | Vercel iad1 + Cloudflare iad | Supabase US-East | ClickHouse Cloud US-East | Claude/OpenAI native | CCPA/CPRA |
| **UK** (London) | Vercel lhr1 + Cloudflare lhr | Supabase EU (separate UK project for residency) | Logical separation w EU instance | Claude przez Bedrock eu-west-2 | UK GDPR |
| **UAE** (Dubai) | Cloudflare dxb (no Vercel POP — fall back na fra1) | Postgres na AWS me-central-1 (Bahrain region najbliższy) | ClickHouse self-hosted on AWS me-central-1 lub EU instance dla MVP | Claude przez Bedrock (najbliższy: eu-central-1) | UAE PDPL Federal Decree-Law 45/2021 + DIFC |

**Routing strategy:** Edge ingest writes do najbliższego POP. Nightly batch ETL replikuje *anonimowe archetypy* (DP-protected) do globalnego archetype store. Surowe events i PII **NIGDY nie opuszczają regionu** zgodnie z data residency. Latency budget od user-event do ingest ACK: **<50ms p95 globally**.

---

## B. Embeddable Plug-in / SDK Design

### B.1. Doświadczenie integratora (klient = real estate website owner)

**Najprostsza możliwa integracja (Tier 1 Observer) — 1 script tag:**

```html
<!-- Wkleić raz w <head> -->
<script async src="https://cdn.estalara.io/sdk/v1/estalara.min.js"
        data-tenant="tnt_marbella_realty_xxx"
        data-tier="observer"
        data-region="eu"></script>
```

**Tier 2 Augment — declarative slots w istniejącym HTML:**

```html
<article class="listing">
  <h1 data-estalara-slot="headline">{originalna nazwa}</h1>
  <div data-estalara-slot="hero-gallery">{istniejąca galeria}</div>
  <ul data-estalara-slot="features">{istniejące features}</ul>
  <section data-estalara-slot="chat-anchor"></section>
</article>
```

SDK wykrywa `data-estalara-slot` atrybuty i może je *augmentować* (re-rank, replace text via LLM rewrite, reorder children) **bez ruszania reszty DOM-u**.

**Tier 3 Native — React/Vue/vanilla component:**

```jsx
import { EstalaraListing } from '@estalara/react';

<EstalaraListing
  listingId="prop_4587"
  tenantId="tnt_idealista"
  feed={mlsData}
  onInquiry={(buyer) => crm.push(buyer)}
  brandTokens={{ primary: '#C4A882', font: 'Fraunces' }}
/>
```

### B.2. Architektura SDK — performance budget i izolacja

| Wymiar | Decyzja | Uzasadnienie |
|---|---|---|
| Framework | **Preact** (3.5 KB) zamiast React (45 KB) | Preact wygrywa dla embeddable widgets — Viget i CompanyCam udowodnili że Preact + Shadow DOM = optymalne dla embeddable ([CompanyCam case](https://dev.to/companycam/build-an-embeddable-widget-using-preact-and-the-shadow-dom-33lm)) |
| Bundler | **esbuild** + **tsup** | esbuild jest 50–100x szybszy niż Webpack, tsup daje gotowe ESM + CJS + UMD bundle dla CDN |
| Distribution | **CDN (Cloudflare R2 + Workers)** + **npm** (@estalara/sdk, @estalara/react, @estalara/vue) | Long-tail klienci wkleją script tag, dev teams użyją npm |
| Style isolation | **Shadow DOM (open mode)** + **Constructable Stylesheets** | Iframe ma overhead per-frame (separate browsing context, postMessage tax) — Shadow DOM jest natywnym standardem dla embeddable widgets ([dev.to comparison](https://dev.to/alanwest/why-shadowdom-matters-more-than-you-think-3cmm)) |
| Bundle size budget | **Tier 1: 25 KB gzip** (loader + observer), **Tier 2: 40 KB gzip** (+ DOM augmenter), **Tier 3: 80 KB gzip** (+ full renderer) | Lazy-load Tier 2/3 features tylko gdy enabled w config |
| Loading | **async + idle-callback dla non-critical work**, intersection observer dla "is listing visible" | Nie blokujemy LCP klienta |
| CSP | Generujemy nonce per-load, dokumentujemy required `script-src cdn.estalara.io 'self' 'wasm-unsafe-eval'` (dla potencjalnego on-device modelu w przyszłości) | XSS mitigation, plus pomaga klientom z surową CSP |
| API surface | Zdarzeniowy: `Estalara.on('intent-detected', cb)`, `Estalara.adapt(slot, directive)`, `Estalara.identify(hint)` (opt-in dla klientów którzy mają consent) | Inspiracja: Segment analytics.js + Intercom Messenger |

### B.3. Adaptery do popularnych stacks

W roadmapie MVP uwzględniamy 5 high-value adapterów:

1. **Intercom/Drift adapter** — auto-pickup chat transcripts via webhook (Intercom oferuje `conversation.user.replied` webhook; Drift po akwizycji przez Salesloft w lutym 2024 nie publikuje już cen, plan startuje ~$2 500/mo ([SaaS Price Pulse](https://www.saaspricepulse.com/compare/intercom-vs-drift))).
2. **Crisp adapter** (popularny w EU + tańszy)
3. **Idealista API adapter** — Idealista oferuje Search API (B2B z access request); my budujemy gotowy connector dla MLS-style feeds ([Idealista developers](https://developers.idealista.com/access-request))
4. **Otodom + Allegro Lokalnie** — Polska, scraping fallback przez Apify-style ($0.50/1k properties ([Apify](https://apify.com/lukass/idealista-scraper/api)))
5. **Generic JSON Schema feed + REST webhook** — fallback dla każdej innej platformy

---

### B.4. Auto-Onboarding & Zero-Config Installation

**Filozofia:** "Copy-paste & go live w 60 sekund." Onboarding na poziomie Intercoma — admin agencji nie powinien myśleć o CSS selectors, schema mapping, ani field mapping. System wykrywa wszystko sam.

#### B.4.1. Trzy ścieżki onboardingu (dopasowane do typu klienta)

| Ścieżka | Target | Time-to-live | Wymagana wiedza techniczna |
|---|---|---|---|
| **Magic Link** (default dla 80% klientów) | Agencje z known platform (Idealista, WordPress + Houzez, etc.) | <2 min | Zero — admin tylko wkleja URL i kopiuje script tag |
| **AI Auto-Detect** (15% klientów) | Custom sites bez znanego template | <5 min | Zero — Claude Vision + Puppeteer wykrywa strukturę |
| **API Connect** (5% power users) | Agencje z własnym REST API / MLS feed | <10 min | Junior dev (token + endpoint URL) |

#### B.4.2. Magic Link Onboarding — flow szczegółowy

```
┌─ Admin wpisuje URL strony agencji w dashboardzie ─┐
│                                                    │
│ "https://agencja-marbella.com/properties"          │
│                                                    │
│ [Analyze My Site]                                  │
└────────────────┬───────────────────────────────────┘
                 │
                 ▼
┌─ Backend Auto-Detection Pipeline (~90s) ──────────┐
│                                                    │
│ 1. Puppeteer headless: open URL, capture HTML      │
│    + viewport screenshot (above-the-fold + scroll) │
│                                                    │
│ 2. Platform fingerprint check:                     │
│    - hostname match → KNOWN_PLATFORMS lookup       │
│    - meta[generator] check → WordPress detection   │
│    - DOM signatures → theme detection (Houzez,     │
│      Realtyna, Estatik, etc.)                      │
│                                                    │
│ 3. Jeśli platform known:                           │
│    → Use pre-built selectors (confidence: 0.99)    │
│    → Skip do step 6                                │
│                                                    │
│ 4. Jeśli unknown — Schema.org check:               │
│    - script[type="application/ld+json"]            │
│    - microdata: itemtype="...RealEstateListing"    │
│    - confidence jeśli match: 0.95                  │
│                                                    │
│ 5. Jeśli no Schema.org — AI Vision:                │
│    - Claude Sonnet 4.6 Vision API                  │
│    - Input: screenshot + HTML (truncated 50KB)     │
│    - Output: JSON z selectors + confidence         │
│                                                    │
│ 6. Validation pass:                                │
│    - Test każdy selector na 5 sample listingach    │
│    - Verify field types (price = number, etc.)     │
│    - Check coverage (% pól znalezione)             │
│                                                    │
│ 7. Generate tenant config + API key                │
│    - Save schema to Postgres (tenants.data_schema) │
│    - Generate installation snippet                 │
└────────────────┬───────────────────────────────────┘
                 │
                 ▼
┌─ Dashboard pokazuje rezultat ─────────────────────┐
│                                                    │
│ ✓ Site analyzed!                                   │
│                                                    │
│ Detected: WordPress + Houzez theme                 │
│ Properties found: 247                              │
│ Confidence: 96%                                    │
│                                                    │
│ Auto-configured fields:                            │
│ ✓ Title:       h1.property-title                   │
│ ✓ Price:       span.price-value (EUR)              │
│ ✓ Photos:      .gallery img (avg 18/listing)       │
│ ✓ Features:    ul.amenities li                     │
│ ⚠ Location:    needs review (low confidence)       │
│                                                    │
│ Installation:                                      │
│                                                    │
│ ┌────────────────────────────────────────────┐    │
│ │ <script async src="https://cdn.estalara.io │    │
│ │   /sdk/v1/estalara.min.js"                 │    │
│ │   data-tenant="tnt_xK7j2mP9..."            │    │
│ │   data-tier="observer"></script>           │    │
│ └────────────────────────────────────────────┘    │
│                                                    │
│ [Copy Code]  [Email to Developer]                  │
│ [Install via WordPress Plugin] (1-click)           │
│                                                    │
│ Next: Add code → Wait 5min → Go Live               │
└────────────────────────────────────────────────────┘
```

#### B.4.3. AI Vision Auto-Detection — szczegóły implementacji

```typescript
// apps/auto-detect/src/detect.ts (Modal serverless function)
async function detectListingPage(input: {
  url: string;
  html: string;
  screenshot_b64: string;
}): Promise<DetectionResult> {

  // STEP 1: Try Schema.org (40% stron ma)
  const schemaOrgResult = parseSchemaOrg(input.html);
  if (schemaOrgResult.confidence > 0.9) {
    return { source: 'schema.org', ...schemaOrgResult };
  }

  // STEP 2: Platform fingerprint (50+ pre-configured)
  const platform = matchPlatform(input.url, input.html);
  if (platform.confidence > 0.85) {
    return { source: 'platform_template', ...platform };
  }

  // STEP 3: Claude Sonnet 4.6 Vision (fallback dla custom sites)
  const visionAnalysis = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: input.screenshot_b64
          }
        },
        {
          type: "text",
          text: `Analyze this real estate listing webpage.
          Return ONLY valid JSON matching this schema:
          {
            "page_type": "property_listing" | "search_results" | "other",
            "platform_guess": string | null,
            "elements": {
              "title":       { "css_selector": string, "confidence": 0-1 },
              "price":       { "css_selector": string, "confidence": 0-1, "currency": string },
              "photos":      { "css_selector": string, "confidence": 0-1 },
              "features":    { "css_selector": string, "confidence": 0-1 },
              "description": { "css_selector": string, "confidence": 0-1 },
              "location":    { "css_selector": string, "confidence": 0-1 },
              "bedrooms":    { "css_selector": string, "confidence": 0-1 },
              "bathrooms":   { "css_selector": string, "confidence": 0-1 }
            },
            "adaptable_slots_recommendation": [
              "headline", "photos", "features"
            ]
          }
          
          HTML sample (truncated): ${input.html.slice(0, 50000)}`
        }
      ]
    });

  const detection = JSON.parse(visionAnalysis.content[0].text);
  
  // STEP 4: Validation pass — test selectors na 5 sample listingach
  const validated = await validateSelectors(input.url, detection);
  
  return {
    source: 'ai_vision',
    confidence: validated.coverage_score,
    schema: validated.confirmed_selectors,
    needs_review: validated.low_confidence_fields
  };
}
```

**Koszt jednorazowego onboarding (Claude Sonnet 4.6):**
- Input: ~50KB HTML + 1 screenshot (~100k tokens combined) = $0.30
- Output: ~2KB JSON = $0.03
- **Total per agency onboarding: ~$0.33** — negligible vs ACV $24k+/yr

#### B.4.4. Pre-built Platform Templates Library (50+ platforms)

```typescript
// packages/sdk/src/platform-templates.ts
export const KNOWN_PLATFORMS = {
  // Spain
  'idealista.com': {
    title: '.main-info__title-main',
    price: '.info-data-price span',
    photos: '.detail-multimedia-gallery img',
    features: '.details-property_features li',
    bedrooms: '[data-feature="bedrooms"]',
    location: '.main-info__title-minor',
    confidence: 0.99
  },
  'fotocasa.es': { /* ... */ },
  'pisos.com': { /* ... */ },

  // UK
  'rightmove.co.uk': {
    title: 'h1[itemprop="name"]',
    price: '._1gfnqJ3Vtd1z40MlC0MzXu span',
    photos: '.gallery-image',
    features: '.key-features li',
    confidence: 0.99
  },
  'zoopla.co.uk': { /* ... */ },
  'onthemarket.com': { /* ... */ },

  // Poland
  'otodom.pl': {
    title: 'h1[data-cy="adPageAdTitle"]',
    price: 'strong[data-cy="adPageHeaderPrice"]',
    photos: '.swiper-slide img',
    features: '[data-testid="ad.top-information.table"] li',
    confidence: 0.99
  },
  'gratka.pl': { /* ... */ },
  'olx.pl': { /* ... */ },

  // US
  'zillow.com': { /* ... */ },
  'realtor.com': { /* ... */ },
  'redfin.com': { /* ... */ },

  // UAE
  'bayut.com': { /* ... */ },
  'propertyfinder.ae': { /* ... */ },
  'dubizzle.com': { /* ... */ },

  // WordPress themes (auto-detected przez DOM signatures)
  'wordpress-houzez': {
    detect: () => document.querySelector('link[href*="houzez"]') !== null,
    selectors: { /* ... */ },
    confidence: 0.95
  },
  'wordpress-realtyna': { /* ... */ },
  'wordpress-estatik': { /* ... */ },
  'wordpress-wp-residence': { /* ... */ },
  'wordpress-realhomes': { /* ... */ },
  
  // Headless CMS / SPA frameworks
  'next-real-estate': { /* ... */ },
  'gatsby-real-estate': { /* ... */ }
};
```

**Roadmapa expansion templates:**
- MVP: 15 templates (top 3 platform per region)
- M6: 30 templates
- Y2: 80+ templates (community-contributed)

#### B.4.5. WordPress Plugin (zero-touch installation)

Dla ~40% rynku real estate (WordPress dominuje SMB):

```php
// wp-estalara-plugin/estalara.php
<?php
/*
Plugin Name: Estalara Adaptive Listings
Description: AI-powered property personalization. Zero config, install in 1 click.
Version: 1.0
*/

class EstalaraPlugin {
    public function __construct() {
        add_action('admin_menu', [$this, 'add_settings_page']);
        add_action('wp_footer', [$this, 'inject_sdk']);
        register_activation_hook(__FILE__, [$this, 'on_activate']);
    }

    public function on_activate() {
        // Auto-register tenant z Estalara API
        $site_url = get_site_url();
        $admin_email = get_option('admin_email');
        $theme = get_template();
        
        $response = wp_remote_post('https://api.estalara.com/v1/onboarding/wordpress', [
            'body' => json_encode([
                'site_url' => $site_url,
                'admin_email' => $admin_email,
                'theme' => $theme,
                'wp_version' => get_bloginfo('version')
            ]),
            'headers' => ['Content-Type' => 'application/json']
        ]);
        
        $data = json_decode(wp_remote_retrieve_body($response));
        update_option('estalara_api_key', $data->api_key);
        update_option('estalara_tenant_id', $data->tenant_id);
        
        // Backend automatycznie:
        // 1. Tworzy tenant
        // 2. Detektuje theme (Houzez/Realtyna/etc.)
        // 3. Aplikuje pre-built template
        // 4. Wysyła activation email
    }

    public function inject_sdk() {
        $api_key = get_option('estalara_api_key');
        if (!$api_key) return;
        
        $theme = get_template();
        ?>
        <script async 
                src="https://cdn.estalara.io/sdk/v1/estalara.min.js"
                data-tenant="<?php echo esc_attr(get_option('estalara_tenant_id')); ?>"
                data-platform="wordpress"
                data-theme="<?php echo esc_attr($theme); ?>"
                data-tier="observer">
        </script>
        <?php
    }
}

new EstalaraPlugin();
```

**Distribution:**
- WordPress.org plugin directory (organic acquisition)
- Marketplace listings: ThemeForest "Houzez Add-ons", Realtyna marketplace
- Direct partnerships z theme authors (revenue share)

#### B.4.6. Progressive Enhancement — Tier 1 → 2 → 3 auto-suggested

System monitoruje performance i sam proponuje upgrade tier:

```typescript
// Background job: weekly tenant health check
async function suggestTierUpgrade(tenantId: string) {
  const stats = await getTenantStats(tenantId, { period: '7d' });
  
  if (stats.tier === 'observer' && 
      stats.sessions > 1000 && 
      stats.archetypes_detected > 50 &&
      stats.engagement_uplift_potential > 0.15) {
    
    // Auto-generate "before/after" preview
    const preview = await generateAdaptationPreview(tenantId);
    
    // Send dashboard notification + email
    await sendUpgradeOffer(tenantId, {
      target_tier: 'augment',
      projected_uplift: '+18-28% conversions',
      preview_url: preview.url,
      one_click_enable: true,
      // Crucial: schema już skonfigurowany, więc upgrade = 1 click
      schema_already_validated: true
    });
  }
}
```

---

### B.5. Schema Discovery & Auto-Configuration Pipeline

#### B.5.1. Layered detection strategy

System próbuje wykryć strukturę w **5 warstwach**, od najmniej do najbardziej kosztownej:

| Layer | Method | Coverage | Cost | Latency |
|---|---|---|---|---|
| **L1: Schema.org JSON-LD** | Parse `script[type="application/ld+json"]` | ~40% stron | $0 | <50ms |
| **L2: Microdata** | Parse `itemtype="...RealEstateListing"` | ~10% stron | $0 | <50ms |
| **L3: Platform fingerprint** | Hostname + DOM signatures match | ~25% stron | $0 | <100ms |
| **L4: Heuristic detection** | Common patterns (h1, .gallery, .price, etc.) | ~15% stron | $0 | <200ms |
| **L5: AI Vision (Claude)** | Screenshot + HTML → Sonnet 4.6 | 100% fallback | $0.33 | 5-10s |

**Logic:** Layer L1-L4 są sprawdzane najpierw (free, fast). Tylko jeśli żaden nie da `confidence > 0.85`, przechodzi do L5 (AI).

#### B.5.2. Field mapping — od raw payload do Estalara standard schema

```typescript
// Standard schema do którego mapujemy wszystko
type EstalaraListingSchema = {
  // Required fields
  listing_id: string;
  title: string;
  price: { value: number; currency: 'EUR' | 'USD' | 'GBP' | 'PLN' | 'AED' };
  photos: Array<{ url: string; alt?: string; order: number }>;
  
  // Recommended fields
  description?: string;
  features?: string[];
  location?: { 
    address?: string; 
    city?: string; 
    region?: string; 
    country?: string;
    coordinates?: { lat: number; lng: number };
  };
  
  // Specific fields (extracted via NLP from features if not direct)
  bedrooms?: number;
  bathrooms?: number;
  area_sqm?: number;
  property_type?: 'apartment' | 'villa' | 'house' | 'penthouse' | 'land' | 'commercial';
  
  // Adaptation hints
  amenities?: string[];      // pool, garden, parking, etc. (parsed)
  energy_rating?: string;
  year_built?: number;
};

// Mapping config przechowywana per tenant
type TenantSchemaMapping = {
  detection_source: 'schema.org' | 'microdata' | 'platform_template' | 
                    'heuristic' | 'ai_vision' | 'manual';
  detection_confidence: number;
  selectors: Record<keyof EstalaraListingSchema, SelectorStrategy>;
  parsers: Record<string, ParserConfig>;  // np. parser dla "4 dormitorios" → bedrooms: 4
  last_validated: string;
  validation_health: number;  // 0-1, ile selectors nadal działa
};

type SelectorStrategy = {
  primary: { type: 'css' | 'xpath' | 'json_path'; value: string };
  fallbacks: Array<{ type: 'css' | 'xpath' | 'json_path'; value: string }>;
  validator?: string;  // np. "value.length > 10 && value.length < 200"
  parser?: 'text' | 'number' | 'currency' | 'array' | 'json';
};
```

#### B.5.3. NLP-powered feature extraction

Surowe features często są w formie text list ("4 dormitorios, 3 baños, piscina, jardín"). System parsuje to przez Claude Haiku:

```typescript
async function parseFeatures(rawFeatures: string[], locale: string) {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 512,
    messages: [{
      role: "user",
      content: `Extract structured data from real estate features list (locale: ${locale}).
      
      Features: ${JSON.stringify(rawFeatures)}
      
      Return ONLY JSON:
      {
        "bedrooms": number | null,
        "bathrooms": number | null,
        "area_sqm": number | null,
        "amenities": string[],  // normalized English: "pool", "garden", "parking", etc.
        "energy_rating": string | null,
        "year_built": number | null
      }`
    }]
  });
  
  return JSON.parse(response.content[0].text);
}
```

**Cost:** ~$0.001 per listing parsing (Haiku 4.5). Cached per listing — parsed raz przy ingest.

#### B.5.4. Predictive drift detection (extends B.6 reactive)

B.6 opisuje reactive drift detection — czeka aż SDK zgłosi błąd, co oznacza że tenant traci dane przez czas detection + recovery (typowo kilka godzin). Dokładamy *predictive layer*, który wykrywa drift **zanim** SDK zacznie zgłaszać błędy.

**Weekly cron job (per tenant, Modal scheduler):**

```
1. Re-crawl primary_url (Puppeteer headless, render JS, snapshot DOM)
2. Serialize DOM tree → canonical string (struktura + class/id signature, bez treści tekstowej)
3. Compute DOM signature embedding (BGE-M3, 1024 dims) → "schema fingerprint"
4. Compare vs ostatni stored fingerprint (cosine similarity)
5. IF cosine < 0.85:
     - Flag tenant jako "potential drift"
     - Schedule full B.4 re-detection (AI Vision + selectors)
     - Notify admin email (transparent: "your site changed, we're re-detecting")
   IF cosine >= 0.85:
     - Continue, log fingerprint do `schema_fingerprints` (history)
```

**Real-time anomaly detection (continuous, ClickHouse query):**

- Track event volume per tenant per hour (rolling 24h baseline ± 2σ)
- Sudden drop > 50% w 1h window z statistical significance (Welch's t-test, p < 0.01) → potential drift signal
- Trigger validation pass na 5 random listings (run B.6.1 health check ad-hoc)
- Auto-fix if health < 0.85 confirmed (per B.6.3)

**DOM signature embedding — szczegóły implementacji:**

```typescript
async function computeDomFingerprint(html: string): Promise<number[]> {
  // 1. Strip text content, keep structure
  const skeleton = serializeStructure(html, {
    keep: ['tag', 'class', 'id', 'data-*'],
    drop: ['textContent', 'inline_styles', 'src', 'href']
  });

  // 2. Embed with BGE-M3 (self-hosted Modal endpoint)
  const embedding = await bgeM3.embed(skeleton);
  return embedding;  // 1024-dim float array
}
```

Storage: `schema_fingerprints (tenant_id, taken_at, fingerprint_vector pgvector(1024), source_url)`. Retention 90 dni. Index na (tenant_id, taken_at DESC).

**Cross-reference:** to jest baza dla Innowacji R.4 (Self-Healing Schema Detection — Predictive). Plus feed do K.3.3 Alerts Center jako alert type "schema_drift_predicted" (severity: warning).

---

### B.6. Continuous Schema Validation & Self-Healing

**Problem:** Strony klientów się zmieniają (redesign, A/B test, theme update). Selectors mogą się zepsuć. Bez automatyzacji to znaczy: tenant wyłącza Estalara, churn.

**Rozwiązanie:** Auto-detection driftu + auto-fix.

#### B.6.1. Health check pipeline

```
Cron job (daily, per tenant):
  ┌───────────────────────────────────────────────────┐
  │ 1. Sample 10 random listings z ostatnich 24h     │
  │ 2. Re-validate każdy selector:                    │
  │    - Czy selector zwraca element?                 │
  │    - Czy typ danych się zgadza?                   │
  │    - Czy value passes validator?                  │
  │ 3. Compute "schema health score" (0-1)            │
  │ 4. Jeśli health < 0.85:                           │
  │    a. Trigger auto re-detection (B.4 pipeline)    │
  │    b. Compare new schema vs stored                │
  │    c. Auto-update jeśli new confidence > stored   │
  │    d. Notify admin email (transparent)            │
  │ 5. Log do audit trail (ClickHouse)                │
  └───────────────────────────────────────────────────┘
```

#### B.6.2. Real-time drift detection (z SDK telemetry)

SDK na żywo raportuje failures:

```typescript
// W SDK na cudzej stronie:
function captureListingData(selectors: TenantSchemaMapping) {
  const result = {};
  const failures = [];
  
  for (const [field, strategy] of Object.entries(selectors.selectors)) {
    try {
      const element = document.querySelector(strategy.primary.value);
      if (!element) {
        // Try fallbacks
        for (const fallback of strategy.fallbacks) {
          const el = document.querySelector(fallback.value);
          if (el) { result[field] = extractValue(el); break; }
        }
        if (!result[field]) failures.push(field);
      } else {
        result[field] = extractValue(element);
      }
    } catch (e) {
      failures.push(field);
    }
  }
  
  // Telemetry: jeśli >2 failures, fire alert event
  if (failures.length > 2) {
    Estalara.track('schema.drift_detected', {
      failures,
      page_url: window.location.href,
      sample_html_hash: hashHTML(document.body.innerHTML.slice(0, 1000))
    });
  }
  
  return result;
}
```

#### B.6.3. Auto-recovery flow

```
SDK reports drift → Backend:
  1. Aggregate drift events across tenant (>10 in 1h = real issue)
  2. Trigger Puppeteer re-crawl on affected URL
  3. Run B.4 detection pipeline (Schema.org → AI Vision)
  4. Compare new vs stored schema (JSON diff)
  5. Auto-apply if:
     - New confidence > 0.9
     - All required fields detected
     - No regression w other listings
  6. Email notification to admin:
     "We detected your site changed (theme update?) and 
      automatically updated our integration. No action needed.
      [View changes] [Revert if needed]"
```

**Mean time to recovery: <30 minut** od detected drift do auto-fix.

---

### B.7. Onboarding Metrics & Success Criteria

| Metric | Target | Measurement |
|---|---|---|
| **Time to first script tag** | <60s | Z dashboardu signup do code copied |
| **Time to data flowing** | <5min | Od code paste do pierwszego event w ClickHouse |
| **Time to first insight** | <1h | Od pierwszych eventów do dashboard widget z archetype |
| **Admin clicks required** | <3 | Signup → Paste URL → Copy code → Done |
| **Developer involvement** | Optional | WordPress plugin / magic link auto-install |
| **Configuration fields** | 0-2 | Tylko URL site (opcjonalnie API token dla power users) |
| **Onboarding success rate** | >90% | % tenantów którzy reach "data flowing" stan w pierwszych 7 dniach |
| **Schema auto-detect accuracy** | >95% | Manual review na sample 100 onboardings |
| **Schema drift recovery rate** | >90% | % auto-recovered bez admin intervention |

---

## C. Signal Ingestion & Data Sources

### C.1. Pełna taxonomia sygnałów (event schema)

Wszystkie eventy mają wspólny envelope:

```typescript
type EstalaraEvent = {
  event_id: string;          // UUIDv7
  tenant_id: string;
  session_id: string;        // session-scoped fingerprint hash
  archetype_hint?: string;   // populated by intent engine, not SDK
  listing_id?: string;
  ts: number;                // ms since epoch (client clock + server skew)
  region: 'eu' | 'us' | 'uk' | 'uae';
  consent_state: 'none' | 'legitimate-interest' | 'consented';
  type: EventType;
  payload: Record<string, unknown>;
};
```

**Pełne kategorie eventów:**

| Kategoria | Przykładowe eventy | Throughput / sesja |
|---|---|---|
| **Page lifecycle** | `page.view`, `page.exit`, `tab.visible`, `tab.hidden` | 5–15 |
| **Mouse/scroll behavioral** | `scroll.depth` (10/25/50/75/90%), `mouse.dwell` (per element ≥500ms), `mouse.rage_click`, `mouse.exit_intent` | 50–500 (sampled) |
| **Photo interactions** | `photo.opened`, `photo.gallery.next`, `photo.zoomed`, `photo.dwell` (per photo) | 10–100 |
| **Floorplan engagement** | `floorplan.opened`, `floorplan.zoom`, `floorplan.dwell` | 0–20 |
| **Price/feature focus** | `price.hovered`, `price.compared`, `feature.expanded`, `mortgage_calc.used` | 5–30 |
| **Search/filter behavior** | `search.query`, `filter.applied`, `filter.removed`, `sort.changed` | 5–50 |
| **Chat (NLP target)** | `chat.opened`, `chat.message.sent` (text), `chat.intent.detected` (server-side after NLP) | 0–30 |
| **Cross-listing journey** | `listing.next`, `listing.compared`, `listing.bookmarked` | 1–10 |
| **Inquiry / conversion** | `inquiry.started`, `inquiry.completed`, `tour.requested` | 0–3 |
| **Device/context** | One-time per session: device class, viewport, language, IP-derived country/city, time-of-day | 1 |

### C.2. Ingestion rate i strategia

- Klient wysyła batches **co 2 sekundy** (lub immediate flush dla `inquiry.*` i `chat.*`)
- Realistic peak: 100k DAU x avg 60 events/session = **6M events/dzień** w Year 1; rozdzielone na ~70k events/sec peak (przy mocnym targowym ruchu) — Cloudflare Workers obsłuży to bez problemu, ClickHouse Cloud na tier $500/mo ingestuje 100M+/dzień
- Real-time path (chat / live adaptation): WebSocket lub Server-Sent Events przez Cloudflare Durable Objects
- Batch path (analytics, model training): Redpanda Cloud → ClickHouse via Kafka connector

### C.3. NLP na chacie

Dla `chat.message.sent`:
- **Real-time intent extraction** — Claude Haiku 4.5 ($1/$5 per MTok), structured output schema dla 12 wymiarów intentu (patrz D.4)
- Latency target: **<500ms** od message send do intent vector update
- Batch enrichment co 6h: re-process konwersacji w pełnym kontekście dla lepszych embeddings (offline)

---

## D. Intent Engine — rdzeń produktu

### D.1. Real-estate-specific intent ontology

Kluczowy MOAT vs generic personalization (Mutiny, Dynamic Yield) to **wertykalna ontologia**. Proponowane 12 wymiarów intent vector:

```
Intent Vector (per session, updated continuously):
  v_intent ∈ ℝ^256 (learned embedding) + structured dimensions:
  
1.  purchase_purpose:    [primary_residence, second_home, investment, vacation_rental, retirement, relocation]
2.  urgency:             [exploratory, 0-3mo, 3-6mo, 6-12mo, 12mo+]
3.  budget_band:         [stretch, comfortable, well_below] (relative to viewed listings)
4.  family_stage:        [single, couple, young_family, established_family, empty_nester, retiree]
5.  geo_priority:        [school_district, commute, lifestyle, beach, mountain, urban_center]
6.  feature_priority:    learned tag distribution (garden, pool, parking, modern, historic, view, ...)
7.  cross_border:        [domestic, eu_intra, foreign_buyer, expat_returning]
8.  finance_complexity:  [cash, standard_mortgage, foreign_mortgage, investment_vehicle, mortgage_uncertain]
9.  decision_role:       [decider, influencer, researcher_for_others]
10. risk_appetite:       [conservative, balanced, aggressive] (signaled by reading legal/title content)
11. emotional_state:     [excited, frustrated, comparison_shopping, validating_choice]
12. tax_aware:           boolean + jurisdiction hints
```

Każdy wymiar ma **confidence score** (0–1). Adaptation engine zachowuje się tylko gdy *combined confidence > threshold* (default 0.6).

### D.2. Architektura model serving

| Warstwa | Model | Latency budget | Koszt na 1k inferencji |
|---|---|---|---|
| **On-device (SDK)** | Małe heurystyki + lookup table (top-100 najczęstszych patternów) | <10ms | $0 |
| **Edge inference** (Cloudflare Workers AI) | Embedding model: BGE-M3 (open weights, MIT) self-hosted lub Workers AI built-in | 50–80ms | ~$0.02 |
| **Server-side fast** (Modal serverless GPU) | Custom fine-tuned Llama 3.1 8B na real-estate intent classification (planowane Y2; Y1 używamy Haiku 4.5) | 150–300ms | ~$0.50 (Haiku 4.5) |
| **Server-side deep** (Modal + Claude Sonnet 4.6) | Złożone decyzje adaptacji, content rewrite, multi-step reasoning | 800–2000ms | ~$8–12 (Sonnet 4.6) |

**Decyzja kluczowa: w MVP NIE fine-tunujemy własnego LLM-a.** Używamy Claude Haiku 4.5 dla 90% przypadków ($1/$5 per MTok) ([Anthropic](https://www.anthropic.com/news/claude-haiku-4-5)) i Sonnet 4.6 dla skomplikowanych sytuacji ($3/$15 per MTok). Per-token economics zaczynają faworyzować self-hosted dopiero powyżej ~15M embeddingów/miesiąc ([zUdyog analysis](https://www.zudyog.com/blog/embedding-models-comparison-guide)).

### D.3. Wybór embeddings — szczegółowo

| Model | MTEB score | Cena | Decyzja |
|---|---|---|---|
| OpenAI text-embedding-3-small | 62.3% | $0.02/MTok | **Default w MVP** — najtańszy z dobrej jakości, dimensions configurable (Matryoshka) |
| Cohere embed-v4 | ~65% | $0.10/MTok | Lepszy multilingual (ważne EU/UAE) — opcja dla enterprise tier |
| BGE-M3 (self-hosted) | 63.0% | ~$5–20/M tokens infrastructure | **Year 2 migration target** gdy volume > 15M embed/mo, savings $1k+/mo per ([Reintech](https://reintech.io/blog/embedding-models-comparison-2026-openai-cohere-voyage-bge)) |
| Voyage-3 / 4 | 67–71% | $0.10/MTok | Best quality, ale małe ekosystem; rozważyć dla enterprise jeśli accuracy gain > cost |

W MVP: **OpenAI text-embedding-3-small @ 1024 dims** (Matryoshka). Jeden model = jeden vector store, prostsza migracja.

### D.4. Pipeline aktualizacji intent vector

```
Per event:
  1. Ingest (Cloudflare Worker): hash + tenant tag + push to Redpanda
  2. Stream consumer (Modal serverless function): 
     - Update structured dimensions (rule-based + small classifier)
     - If chat event: call Claude Haiku 4.5 for intent extraction
     - Recompute intent embedding (weighted moving avg over recent N events)
     - Store in Redis (Upstash, multi-region) keyed by session_id
     - Async: persist to ClickHouse + pgvector
  3. On listing render request: Decision API reads Redis (p95 <5ms), 
     calls Adaptation Engine with intent vector + listing metadata
```

### D.5. Continuous Detection Quality System

**Cel:** Osiągnąć **90% accuracy archetypu w detekcji od drugiego eventu w sesji**, dążąc do 97% accuracy po 10+ eventach. Mierzyć ciągle, poprawiać automatycznie. To jest serce produktu — bez tego adaptacja jest losowa, a A/B uplift (E.3) statystycznie nieznaczący.

#### D.5.1. Wyzwanie: ground truth bez identyfikacji

Klasyczny ML problem: jak mierzymy "accuracy" jeśli buyerzy są anonimowi (Mode A — patrz G.2) i nigdy nie deklarują swojego archetype explicit? W przeciwieństwie do supervised learning gdzie mamy `(x, y)` pary, my mamy tylko strumień zdarzeń `x_1, x_2, ..., x_n` bez label.

**Rozwiązanie: convergence-based proxy ground truth.** Zamiast jednego ground truth label per session, używamy **multi-signal consistency** jako miary correctness:

1. **Predicted archetype A z eventów 1–3** vs **Predicted archetype B z eventów 4–10** → jeśli zgodne (cosine similarity intent vectors > 0.85), prediction prawdopodobnie correct (self-consistency)
2. **Behavioral predicted archetype** vs **Chat NLP archetype** (jeśli buyer otworzył chat) → high agreement = high confidence (cross-modal agreement)
3. **Adaptation confirmation signal:** jeśli predykcja "luxury investor" prowadzi do braku zaangażowania z mortgage info ale wysokiej dwell time na exterior shots → confirmed; jeśli buyer kliknie mortgage calc → disconfirmed (causal feedback)

#### D.5.2. Bayesian update mechanism

Każdy event jest **dual-purpose**: input do current prediction AND evaluation poprzedniej prediction.

```typescript
type SessionPredictionState = {
  current_archetype: ArchetypeId;
  confidence: number;              // 0-1, posterior P(archetype | events)
  trust_score: number;             // 0-1, separate from confidence
  prediction_history: PredictionSnapshot[];
  consistency_score: number;       // % similar predictions in last N events
  signal_density: number;          // events per minute, normalized
};

async function updatePrediction(
  state: SessionPredictionState,
  newEvent: EstalaraEvent
): Promise<SessionPredictionState> {
  // 1. Compute prediction from full event history (not just delta)
  const newPrediction = await classifyArchetype(state.events.concat(newEvent));

  // 2. Bayesian update: P(archetype | events_so_far)
  const prior = state.confidence;
  const likelihood = computeLikelihood(newEvent, state.current_archetype);
  const posterior = (likelihood * prior) /
    (likelihood * prior + (1 - likelihood) * (1 - prior));

  // 3. Detect prediction stability (convergence)
  const isStable = checkStability(state.prediction_history.slice(-5));

  // 4. Trust score combines confidence × stability × signal density
  const trustScore = posterior
    * (isStable ? 1.0 : 0.7)
    * Math.min(state.signal_density / 10, 1);

  return {
    current_archetype: newPrediction.archetype,
    confidence: posterior,
    trust_score: trustScore,
    consistency_score: computeConsistency(state.prediction_history),
    prediction_history: [...state.prediction_history, snapshot(newPrediction)],
    signal_density: updateSignalDensity(state, newEvent.timestamp)
  };
}
```

Trust score jest tym co E.1 (Decision tree) konsumuje jako gating signal — adaptacja odpala tylko gdy `trust_score > tier_threshold` (Observer 0.4, Augment 0.6, Native 0.85).

#### D.5.3. Quality metrics (real-time, per tenant)

Cztery główne metryki, mierzone ciągle, surface'owane w dashboardzie K.3.4:

| Metric | Definicja | Target MVP | Target Y2 |
|---|---|---|---|
| `prediction_stability_score` | % sesji gdzie prediction nie zmieniała się przez ostatnie 5 eventów | >70% | >85% |
| `confirmation_rate` | % adaptations które wywołały expected behavior (signal post-adaptation matches archetype-predicted patterns) | >65% | >80% |
| `convergence_time_p50` | Median # eventów do stable prediction | <8 | <5 |
| `disagreement_rate` | % sesji z conflict between behavioral signals i chat NLP | <15% | <8% |

**Composite "Detection Quality Score" (DQS):**

```
DQS = 0.4 * prediction_stability_score
    + 0.3 * confirmation_rate
    + 0.2 * (1 / convergence_time_p50)   // znormalizowane do [0,1]
    + 0.1 * (1 - disagreement_rate)
```

Target: **DQS > 0.75 = "production grade"**. Poniżej 0.6 → auto-pause adaptacji dla sesji w danym archetypie (degrade do control), alert do `#estalara-ml`.

#### D.5.4. Continuous learning loop

**PER SESSION:**
- Event 1 → Initial prediction (baseline_archetype, low confidence)
- Event 2 → Bayesian update + consistency check vs Event 1
- Event 3 → Update + check
- Event N → Convergence to stable prediction OR detection of low-quality signal
- IF stable: log as confirmed sample → training queue
- IF unstable: log as "hard sample" → active learning queue (D.5.5)

**WEEKLY (Modal cron job, niedziela 02:00 UTC):**
1. Aggregate all "confirmed" sessions cross-tenant (k-anon ≥50 per archetype)
2. Apply DP noise (ε ≤ 2, per F.3)
3. Retrain archetype embeddings (gradient update, *not* full retrain — cost ~$50/tydz)
4. Canary deploy new model do 1% traffic via LiteLLM router
5. Compare DQS old vs new przez 24h (rolling window, bootstrap CI)
6. If DQS improvement > 2pp z p < 0.05: promote to 100%
7. If regression > 2pp: rollback, alert ML team via K.3.3

**QUARTERLY (Krystian + Rafał review):**
- Identify archetypes z persistent <60% confirmation rate → manual review
- Add new archetypes when >50 sessions don't fit any (clustering on hard samples, HDBSCAN nad intent embeddings)
- Retire archetypes z <100 sessions/quarter (fold into nearest neighbor)

#### D.5.5. Active learning queue

System sam identyfikuje "trudne" sesje wymagające human review:

- **Wysokie confidence ale low confirmation:** model jest pewny, ale empirycznie błędny → bias w training data
- **Disagreement** between behavioral i chat predictions (cross-modal conflict)
- **Outliers:** new patterns nie pasujące do existing archetypes (Mahalanobis distance > 3σ od najbliższego centroidu)

Krystian (CPO) co tydzień reviewuje top 20 hard samples (~30 min via internal Ops UI K.4.2). Output: decision o nowym archetypie LUB poprawka existing archetype's seed examples LUB tag jako adversarial/bot (excluded z global learning).

#### D.5.6. Strategia poprawy 90% → 97%

Roadmap accuracy z konkretnymi milestone'ami:

- **Sprint 4–6 (MVP):** baseline 70–75% DQS — 50 manualnie przygotowanych archetypów (Krystian's PhD value), rule-based + Haiku 4.5 classifier
- **Sprint 7–9 (Y1 H2):** 80–85% DQS — pierwsze cross-tenant retrains z prawdziwymi danymi pilotów (3–5 tenants × ~10k sesji/mc)
- **Sprint 10–12 (Y2 H1):** 85–90% DQS — fine-tuned classifier (Llama 3.1 8B, LoRA) zastępuje rule-based, hosted on Modal
- **Y2 H2–Y3:** 90–97% DQS — federated learning (Innowacja R.3) dla enterprise + reinforcement learning z conversion feedback (RLHF-style ale z implicit signals)

#### D.5.7. Sprint mapping dla detection quality

| Sprint | Co osiąga |
|---|---|
| Sprint 4 (Intent ontology) | Baseline classifier z confidence scoring |
| Sprint 5 (LLM gateway) | Bayesian update mechanizm |
| Sprint 6 (Embeddings + matching) | Stable prediction tracking, convergence metrics |
| Sprint 7 (Adaptation engine) | Confirmation rate measurement |
| Sprint 8 (A/B framework) | Causal uplift estimation per archetype (cross-ref E.3 — extended) |
| Sprint 9 (Compliance) | Audit trail predictions, replay capability |
| Sprint 10 (Multi-region) | Cross-region accuracy benchmarks |
| Continuous (Y1+) | Active learning queue, weekly retrains, quarterly archetype refresh |

---

## E. Adaptation Engine

### E.1. Decision tree (logiczny, nie ML)

```
1. Is intent confidence > 0.6?
   NO → return default listing (no adaptation, log impression)
   YES → proceed
   
2. Match buyer to nearest archetype (cosine similarity in archetype space)
   - If similarity > 0.85: use archetype's pre-computed adaptation playbook
   - If 0.6 < similarity < 0.85: use playbook + LLM tweak
   - If similarity < 0.6: full LLM-driven decision (more expensive)

3. For each adaptable element (headline, photo order, features, chat reply):
   a. Apply tier-allowed mutations
   b. Validate against tenant brand guidelines (linter)
   c. Validate against fair-housing rules (no discriminatory framing)
   d. Sign with HMAC + log to ClickHouse for audit

4. Return JSON adaptation directive to SDK (single round-trip, batched)
```

### E.2. Content generation — gdzie LLM, gdzie templates

| Element | Strategia | Uzasadnienie |
|---|---|---|
| **Headline rewrite** | Template + slot filling (95% przypadków), LLM rewrite tylko dla edge cases | Predictable, brand-safe, taniej. Templates: 50–100 archetypów x 3 wariantów per language |
| **Feature highlight order** | Pure ranking model (gradient boosted on intent×feature interaction) | Deterministyczne, A/B testable, brak halucynacji |
| **Photo re-ranking** | CLIP-style scoring photos vs intent vector + tenant hard rules ("first photo must show exterior") | Computer vision na zdjęciach raz przy ingest property, intent-photo dot product przy serve |
| **Chat suggested replies** | Claude Haiku 4.5 + RAG (tenant's FAQ + listing data + intent context) | Conversational quality wymaga LLM; Haiku 4.5 wystarczająco dobre |
| **Long-form copy (description)** | Claude Sonnet 4.6 — tylko Tier 3 Native, async pre-generation, cached | Sonnet 4.6 jakość warte ceny dla flagship feature, ale cache'ujemy bo description rzadko się zmienia |

### E.3. A/B testing & learning loop

- **Hold-out group** (default 10%) — losowo wybrana, dostaje *unadapted* listing. Mierzymy lift na: time-on-listing, photo opens, inquiry rate.
- **Multi-armed bandit** (Thompson sampling) dla wyboru wariantu adaptacji per archetype — automatycznie alokuje ruch do najlepiej konwertujących adaptacji.
- **Conversion feedback loop**: gdy `inquiry.completed` event przychodzi, propagujemy reward signal wstecz przez session events i aktualizujemy archetype embeddings (offline, daily batch).
- **Detekcja regresji**: jeśli archetype X ma stat-significant drop w conversion przez 7 dni — auto-pause adaptacji dla tego archetype, alert do Estalara team.

#### E.3.1. Causal inference framework (extends standard A/B)

Pure CTR uplift jest niewystarczający dla decyzji o pause/scale. Holdout group też może mieć wysoki CTR (bo to po prostu dobrzy buyerzy), więc obserwowana różnica nie izoluje *przyczynowości*. Implementujemy **Conditional Average Treatment Effect (CATE)** estimation:

- **T-Learner / X-Learner** (Künzel et al. 2019): trenują dwa osobne modele (treatment / control) i estymują individual treatment effect dla każdej sesji counterfactually. Dla każdego buyera odpowiadają na: "co by się stało gdyby ten konkretny user dostał holdout vs treatment?"
- **Causal forests** (Wager & Athey 2018): identyfikują heterogeneous treatment effects per archetype — które segmenty MAJĄ uplift, a które są obojętne lub regresyjne
- **Sequential hypothesis testing** (Wald SPRT): Bayesian decision boundaries zamiast fixed-N A/B testing — pozwala kończyć testy wcześniej gdy CI są wąskie, oszczędzając LLM cost

**Użycie w produkcji:** jeśli archetype X ma `CATE_CTR > +12%` ALE archetype Y ma `CATE_CTR ≈ 0%` przez 1000+ sesji → auto-pause adaptacji dla Y (degrade do control), save ~20–30% LLM cost. Zamiast szerokiej adaptacji we wszystkich segmentach, alokujemy compute tam gdzie jest causal lift.

**Tech stack:** EconML (Microsoft) + DoWhy + causal forests (Athey et al.). Bayesian uplift models (PyMC) dla long-tail archetypów z małą liczbą obserwacji.

#### E.3.2. Multi-objective optimization

A/B nie jest tylko o CTR. Optymalizujemy weighted objective:

```
score = 0.4 * conv_rate_uplift
      + 0.2 * inquiry_quality_uplift   // gated chat starts, photo deep-dives
      + 0.2 * (1 - LLM_cost_per_session_normalized)
      + 0.1 * brand_safety_score        // fair-housing linter pass rate
      + 0.1 * latency_within_budget     // p95 < 100ms gate
```

Wagi konfigurowalne per tenant (np. Idealista enterprise stawia większą wagę na latency, mała agencja na brand safety). Konfiguracja w `tenant.objective_weights` JSON, default per Tier.

#### E.3.3. Cross-reference D.5 + R.2

Mechanizmy CATE estimation feed do D.5 confirmation rate (post-adaptation behavior validation) i są fundamentem Innowacji R.2 (Causal A/B Framework — patent angle). Implementacja w Sprint 8.

---

## F. Data Network Effect / MOAT

### F.1. Centralized vs federated — decyzja

**Decyzja: centralized aggregation z differential privacy, NIE federated learning.**

Uzasadnienie:
- FL ma sens gdy raw data nie może opuścić urządzenia/tenanta (bankowość, healthcare). U nas tenant *sam* zgodził się na to przez Master Service Agreement, więc transfer agregatów jest legalny przy proper DPA.
- FL infrastructure (Flower, TensorFlow Federated) dodaje 6–12 miesięcy do roadmapy i wymaga ML eng z FL expertise. Nasz zespół 5-osobowy nie ma na to capacity.
- Google i Meta używają FL+DP w produkcji ([Meta Engineering](https://engineering.fb.com/2022/06/14/production-engineering/federated-learning-differential-privacy/), [Google Research](https://research.google/blog/federated-learning-with-formal-differential-privacy-guarantees/)) ale dla skali miliardów devices i z ML staffem 100+. Nasz pragmatyczny wybór: **centralized aggregation + DP + k-anonymity**.

### F.2. Architektura archetypes

```
Tenant A events ──┐
Tenant B events ──┼──► Anonymization Pipeline ──► Archetype Update Job
Tenant C events ──┘    (k-anon ≥ 50 per bucket,  (Modal, daily, with DP-SGD,
                        DP noise added,           ε ≤ 2 per epoch,
                        no tenant_id retained)    epoch_budget tracked)
                                                      │
                                                      ▼
                                              ┌────────────────────┐
                                              │ Global Archetype   │
                                              │ Embedding Space    │
                                              │ (~50–500 archetypes│
                                              │  in pgvector,      │
                                              │  per region)       │
                                              └────────────────────┘
                                                      │
                                                      ▼
                                              All tenants benefit:
                                              - Faster cold-start intent detection
                                              - Better archetype matching
                                              - Cross-market patterns (e.g.
                                                "British retirees → Costa del Sol"
                                                shows up in tenant B's data even
                                                if tenant B never had British
                                                buyer before)
```

### F.3. Privacy-preserving techniques — co realnie robimy

| Technika | Zastosowanie u nas | Notes |
|---|---|---|
| **k-anonymity (k≥50)** | Archetype tylko publikowany jeśli ≥50 unique sessions z >3 różnych tenantów spadło w bucket | Standard NIST-recommended threshold; eliminuje re-identification risk |
| **Differential Privacy (ε≤2)** | Gaussian noise na embedding updates per epoch | DP-SGD jak w Google Gboard ([Google Research](https://research.google/blog/federated-learning-with-formal-differential-privacy-guarantees/)) |
| **Behavioral hashing** | Session_id = HMAC(tenant_secret, fingerprint, day_bucket) — rotuje się co 24h dla EU bez consent | Limit cross-session re-identification |
| **No raw PII w global store** | Tylko vector + categorical archetype labels; chat transcripts rzadko transferred globally i tylko po LLM-based redaction PII | Zero PII leakage cross-tenant |
| **Consent-aware aggregation** | Sessions z `consent_state = consented` → wkład pełny; `legitimate-interest` → tylko aggregated metrics; `none` → wyłączone z global learning | Compliance with GDPR Art. 6/9 |

### F.4. MOAT mathematics dla inwestorów

```
Tenant utility(t) = α * own_data(t) + β * network_data(N) + γ * model_quality(t,N)

Gdzie:
- own_data(t) rośnie liniowo z czasem dla danego tenanta
- network_data(N) rośnie z N (liczba tenantów) zgodnie z Metcalfe-like (~ N * log N
  bo overlap między tenantami zmniejsza marginal benefit każdego nowego)
- model_quality też rośnie z N — więcej archetypów, lepsze coverage corner cases

Konsekwencja:
- Tenant 100. dostaje zarówno bogatsze archetypes (większe N) jak i lepsze
  modele (γ effect), więc jego time-to-value jest 5-10x szybsze niż tenanta 1.
- Konkurent zaczynający w roku Y3 musiałby zebrać 3 lata danych żeby dotrzeć do
  naszej network_data — ale my w międzyczasie urośniemy x10.
- Switching cost dla tenantów rośnie z czasem (ich własne archetype embeddings
  + intent vectors są de facto trained on Estalara-specific data structure).
```

---

## G. Behavioral Fingerprinting — szczegółowo i pragmatycznie

### G.1. Stan prawny w 2025–2026 (MUSIMY to rozumieć dokładnie)

**EU/EEA — sytuacja jednoznaczna i niekorzystna dla "no consent" approach:**

- ePrivacy Directive Art. 5(3) wymaga prior consent dla *jakiegokolwiek* dostępu do informacji w terminal equipment, niezależnie czy to cookies czy fingerprinting ([EDPB Guidelines 2/2023, finalne październik 2024](https://www.edpb.europa.eu/news/news/2023/edpb-provides-clarity-tracking-techniques-covered-eprivacy-directive_en)).
- EDPB Guidelines 2/2023 wprost obejmują **fingerprinting, pixel tracking, IP-only tracking, URL tracking**.
- **Legitimate interest pod GDPR Art. 6 NIE substytuuje consent pod ePrivacy Art. 5(3)** — to dwa odrębne reżimy ([Consenteo analysis](https://www.consenteo.com/knowledge-hub/GDPR/gdpr_cookie_consent_2026)).
- ePrivacy Regulation została **wycofana w lutym 2025** — czyli przez najbliższe lata utrzyma się obecny ePrivacy Directive 2002/58/EC, transponowany różnie w państwach członkowskich (divergence będzie rosła).
- CNIL we wrześniu 2025 wystawiła €325M Google + €150M Shein za naruszenia cookie/tracking — **enforcement się intensyfikuje**.

**UK:**
- ICO w grudniu 2024 jasno odpowiedział na zmianę polityki Google (luty 2025 dopuszczająca fingerprinting w reklamie): "fingerprinting is not a fair means of tracking users... compliance with UK data protection law is a high bar to meet" ([ICO statement](https://ico.org.uk/about-the-ico/media-centre/news-and-blogs/2024/12/our-response-to-google-s-policy-change-on-fingerprinting/)).
- ICO wymaga consent + transparency dla fingerprinting, identyczne podejście jak EDPB.

**US (CCPA/CPRA):**
- Browser fingerprints klasyfikowane jako "unique personal identifiers" → opt-out right.
- W praktyce: musimy honor GPC (Global Privacy Control) signal i ofiarować "Do Not Sell/Share" mechanizm.

**UAE (PDPL Federal Decree-Law 45/2021):**
- Personal data definition obejmuje "online identifier" → fingerprint = personal data.
- Consent or other lawful basis required (Art. 5).
- Executive Regulations (Cabinet Decision 111/2023) wymagają DPO dla large-scale profiling, DPIA dla high-risk processing.
- DIFC i ADGM mają oddzielne reżimy (Data Protection Law No. 5 of 2020) — bardzo zbliżone do GDPR.

**Polska (UODO):**
- UODO stosuje GDPR + krajową Ustawę o ochronie danych osobowych z 2018 + Prawo telekomunikacyjne dla ePrivacy. Generalnie podąża za EDPB.

### G.2. Pragmatyczna strategia compliance dla Estalara

**Mode A — "Session Mode" (default, no consent banner needed):**
- Fingerprint *tylko per session*, hash rotuje się przy `tab close + 30 min idle`
- **Dla EU/UK/UAE**: opieramy na *strictly necessary* exemption pod ePrivacy 5(3)(b) — service explicitly requested by user (interactive listing experience). ICO Draft Guidance (December 2024) potwierdza że "recording information or selections made on an online service" może spełniać ten exemption.
- Cross-listing journey *w obrębie jednego tenanta* (tej samej witryny) — to jest first-party tracking, generally OK.
- **NIGDY** cross-tenant w Session Mode.

**Mode B — "Consented Mode" (gdy klient zbierze consent przez Estalara Consent Helper lub własny CMP):**
- Pełen behavioral fingerprint, persistence 90 dni, cross-listing/cross-tenant journey w obrębie jednej grupy partnerskiej.
- Wszystkie sygnały zasilają global archetype space.

**Mode C — "Legitimate Interest Mode" (dla narrow use cases jak fraud prevention):**
- Tylko dla konkretnych celów typu detection of duplicate listings spam — nie dla marketingu/personalization (CNIL i EDPB jasno wykluczyły).

W konfiguracji per tenant pozwalamy klientowi wybrać który mode chce uruchomić, z domyślnym Mode A. **Mode A jest naszym differentiatorem vs Mutiny/Drift** — bo daje value od dnia 1 bez consent banner.

### G.3. Techniki fingerprinting i ich realna skuteczność

Niezależne badania Kochava (2024) i innych pokazują że **fingerprinting accuracy spada poniżej 50% po 24h** ze względu na Safari ITP, Firefox ETP, Brave farbling, mobile networks ([Seresa research](https://seresa.io/blog/data-loss/browser-fingerprinting-in-2025-why-ip-device-screen-hashing-is-not-the-cookie-alternative-you-think)). To znaczy że nawet ZE consent fingerprint cross-session jest niesamowicie zawodny.

**Nasza techniczna stack dla Mode A:**
- Canvas fingerprint hash (lightweight, no PII)
- AudioContext fingerprint
- Screen + viewport + timezone + language
- WebGL renderer
- Combined entropy: ~18–22 bits → unique ID dla ~99% browser/device combos w obrębie sesji
- **HMAC z `tenant_secret + day_bucket`** — uniemożliwia cross-tenant correlation nawet wewnętrznie
- Sesja resetuje się po idle 30min lub close tab

Dla Mode B dokładamy:
- LocalStorage persistent ID (z explicit consent)
- Optional CNAME-based first-party endpoint (omija Safari ITP 7-day cap)

---

## H. Compliance & Privacy Multi-Region

### H.1. GDPR (EU) — pragmatyczny checklist

| Obowiązek | Jak realizujemy |
|---|---|
| Lawful basis (Art. 6) | Per-tenant: **Legitimate Interest (Art. 6.1.f)** dla intent detection + adaptation, z udokumentowanym Legitimate Interest Assessment (LIA). CNIL w czerwcu 2025 explicitly potwierdziła że commercial interest może być legitimate dla AI development ([CNIL recommendations](https://www.cnil.fr/en/relying-legal-basis-legitimate-interests-develop-ai-system)) |
| ePrivacy consent | Mode A: strictly necessary exemption. Mode B: wymaga consent collected by tenant (Estalara dostarcza Consent Helper jako optional component) |
| DPIA | Estalara robi DPIA dla całego produktu (template + worked example) → tenant adoptuje + customizes per swoje use case. Required dla "systematic monitoring of behavior" wg GDPR Art. 35.3.c |
| ROPA (Art. 30) | Auto-generated from configuration: per-tenant ROPA entry available do downloadu z dashboardu |
| Data Subject Rights | API endpoint `DELETE /v1/sessions/{session_id}` + bulk export — buyer może żądać deletion przez tenant |
| Transfers | EU data stays w EU; US-based tenants → SCC + supplementary measures (Schrems II); transfer impact assessment template |
| DPO | Estalara appointuje DPO w EU (preferowany Polska — najtańszy, native do założycieli) |
| Breach notification | 72h SLA — Sentry + custom incident playbook, pre-templated notification do supervisory authorities |

### H.2. AI Act (EU) — defensive classification

Pełny tekst AI Act stosuje się od **2 sierpnia 2026** (z wyjątkami dla GPAI od sierpnia 2025) ([European Commission timeline](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai)). Annex III wymienia "high-risk" systemy obejmujące m.in.:
- AI determining access to essential services (housing/credit)
- AI evaluating creditworthiness
- AI for emotion recognition

**Nasza klasyfikacja: NIE high-risk**, ale przygotowujemy się jakby był (defensive posture):
- Estalara nie podejmuje decyzji o sprzedaży/wynajmie nieruchomości — to robi human agent + buyer
- Personalizacja prezentacji ≠ access decision (Recital 53 explicitly differentiates)
- Brak emotion recognition w sensie biometrycznym (psychologiczny stan inferowany z chatu nie kwalifikuje się — to nie biometric data)

Niezależnie utrzymujemy: **Risk Management System, Data Governance, Technical Documentation, Human Oversight (tenant zawsze może wyłączyć adaptację per buyer), Post-Market Monitoring, Logging (full audit trail w ClickHouse 13 miesięcy retention)**.

Komisja w Digital Omnibus (listopad 2025) zaproponowała powiązanie aplikacji high-risk rules z dostępnością harmonizowanych standardów — co potencjalnie odsunie deadline dla high-risk systems poza 2 sierpnia 2026, ale nie liczymy na to ([European Commission FAQ](https://digital-strategy.ec.europa.eu/en/faqs/navigating-ai-act)).

### H.3. CCPA/CPRA (California)

- Notice at collection (link w SDK widget i w listing footer)
- Honor GPC signal automatically (US tenants opt-in)
- Opt-out of sale/sharing (przy Mode B)
- No sensitive personal info collection by default

### H.4. UK GDPR + ICO

- Lokalna PECR (Privacy and Electronic Communications Regulations) dla ePrivacy
- ICO online tracking strategy 2025 → final guidance po Data (Use and Access) Act 2025 ([Inside Privacy](https://www.insideprivacy.com/data-privacy/ico-announces-its-online-tracking-strategy-for-2025/))
- Data Protection Officer registered with ICO

### H.5. UAE PDPL + DIFC

- DPO required (Art. 10) dla large-scale profiling
- DPIA przed launch (Art. 9)
- Cross-border transfers — UAE Data Office maintains adequacy list; SCC alternative
- DIFC tenants (np. agencja w Dubai International Financial Centre) → DIFC Data Protection Law No. 5 of 2020, separate compliance — bardzo zbliżone do GDPR
- Encryption required: AES-256 at rest, TLS 1.2+ in transit ([ITSEC PDPL guide](https://itsecnow.com/regulators/pdpl-cybersecurity))

### H.6. Polska — UODO + bonus

UODO stosuje GDPR + Ustawę 2018, zwłaszcza ostry na profiling i automatyczne decyzje. Rejestracja DPO w UODO. Cookies/ePrivacy via Prawo telekomunikacyjne — wymaga consent identycznie jak EDPB.

### H.7. NIS2

NIS2 dotyczy "essential" i "important entities" — Estalara prawdopodobnie nie kwalifikuje się jako essential (real estate marketing nie jest critical infrastructure), ale **klienci enterprise (np. Idealista) mogą być** → my musimy spełnić wymagania w SLA: incident reporting w 24h, supply chain security, MFA dla admin access. Zaimplementujemy od dnia 1.

---

## I. Stack Technologiczny — Konkretne Rekomendacje

### I.1. Frontend SDK

| Layer | Wybór | Alternatywy | Rationale |
|---|---|---|---|
| Language | **TypeScript 5.x** strict mode | — | Standard dla DX i enterprise integration |
| UI runtime | **Preact 10** | React (za duży), Lit (mniej ekosystemu), vanilla JS (za bolesne dla Tier 3) | Preact = React API w 3.5KB, idealne dla embeddable |
| Bundler | **tsup** (oparte na esbuild) + **Rollup** dla finalnego CDN bundle | Vite (build-tool nie library-tool), Webpack (wolne) | tsup szybki + multi-format output |
| Styling | **CSS-in-JS przez @emotion/css** w Shadow DOM, Constructable Stylesheets dla shared base | Tailwind (problem z Shadow DOM), styled-components (overhead) | Constructable Stylesheets share parsing cost między 50+ instancjami komponentów |
| State | **Nanostores** (1KB) lub Zustand vanilla | Redux (przesada), Jotai (React-only) | Lightweight, framework-agnostic |
| Telemetry | Custom (ingest endpoint), opcjonalnie OpenTelemetry Web | Sentry SDK (za duży) | Custom jest 2KB |

### I.2. Backend

| Layer | Wybór | Alternatywy | Rationale |
|---|---|---|---|
| Edge ingest | **Cloudflare Workers + Durable Objects** | Vercel Edge Functions, AWS Lambda@Edge | Cloudflare ma zero cold start (V8 isolates), $0.30/M requests, unlimited bandwidth, 300+ POPs ([Northflank](https://northflank.com/blog/best-cloudflare-workers-alternatives)). Vercel pricing kapie z bandwidth ($0.06/GB egress) |
| Control plane API | **Next.js 15 App Router on Vercel** (już mamy) | Hono on Cloudflare, NestJS | Kontynuujemy istniejący stack, używamy Edge Runtime gdzie sensowne |
| Worker tasks (intent enrichment, archetype updates) | **Modal** (serverless GPU/CPU) | Inngest (event workflows), AWS Lambda, Trigger.dev | Modal = Python-native, świetne dla ML serving (Modal $1.1B valuation 2025), GPU support, Oracle Cloud partnership for affordable GPU ([Introl analysis](https://introl.com/blog/serverless-gpu-platforms-runpod-modal-beam-comparison-guide-2025)). RunPod tańsze ale bardziej manual |
| Real-time event bus | **Redpanda Cloud** (Kafka-compatible) | Confluent Kafka, AWS Kinesis ($0.014/shard-hour), Cloudflare Queues | Redpanda ma 10x lepszy single-node throughput niż Kafka, niższy ops overhead, multi-region |
| Transactional DB | **Supabase (Postgres 16)** — multi-region projects | Neon (świetne branching ale słabsze RLS), self-hosted RDS | Supabase = Postgres + auth + RLS + realtime in one. RLS jest battle-tested dla multi-tenant ([Supabase RLS docs](https://supabase.com/docs/guides/database/postgres/row-level-security)) |
| Event store | **ClickHouse Cloud** | TimescaleDB, Snowflake | ClickHouse 4.8x szybsze loading + 1.7x mniejszy disk niż konkurencja na dużych aggregations ([Tinybird](https://www.tinybird.co/blog/clickhouse-vs-timescaledb)). Trade-off: nie cool dla małych częstych pisów, więc batchujemy na edge |
| Vector DB | **pgvector w Supabase** (do 5–10M wektorów), później **Qdrant Cloud** | Pinecone (drogi przy >10M), Weaviate (skomplikowany ops) | pgvectorscale (Timescale's extension) osiąga 471 QPS @ 99% recall na 50M vectors, conkurencyjne z Pinecone ([dev.to](https://dev.to/polliog/postgresql-as-a-vector-database-when-to-use-pgvector-vs-pinecone-vs-weaviate-4kfi)) |
| Cache / session store | **Upstash Redis** (multi-region, pay-per-request) | Redis Cloud, Vercel KV | Multi-region replication, $0.20/100k commands, idealne dla intent vector cache |
| LLM gateway | **LiteLLM** (self-hosted) lub **OpenRouter** | Direct provider SDKs | Router pozwala na fallback Claude → OpenAI → Cohere, cost tracking, retry logic, jeden interfejs |

### I.3. ML/AI

| Use case | Provider | Model | Koszt |
|---|---|---|---|
| Intent extraction z chatu | Anthropic | **Claude Haiku 4.5** | $1/$5 per MTok ([Anthropic](https://www.anthropic.com/news/claude-haiku-4-5)) |
| Adaptation reasoning (złożone) | Anthropic | **Claude Sonnet 4.6** | $3/$15 per MTok |
| Headline rewrite (Tier 3 premium) | Anthropic / OpenAI fallback | Sonnet 4.6 / GPT-5.2 | Sonnet $3/$15, GPT-5.2 $1.75/$14 ([IntuitionLabs](https://intuitionlabs.ai/articles/ai-api-pricing-comparison-grok-gemini-openai-claude)) |
| Embeddings | OpenAI | **text-embedding-3-small @ 1024 dim** | $0.02/MTok |
| Photo CLIP scoring | Workers AI built-in (CLIP ViT) | OpenAI Vision (drogie dla volume) | Workers AI ~$0.011/1k requests |
| Future fine-tuned intent classifier | Modal hosted | Llama 3.1 8B fine-tuned na własnych anonimowych konwersacjach | ~$0.50/1k inferences na Modal H100 |

### I.4. Hosting & Infrastructure

- **Vercel Pro**: dashboard + control plane API (~$20/dev + usage)
- **Cloudflare**: Workers ($5/mo + $0.30/M req), R2 storage ($0.015/GB), CDN free
- **Supabase Pro**: $25/project/mo + usage; we run 4 (eu, us, uk-residency, scaling/failover)
- **ClickHouse Cloud**: ~$500–2000/mo at MVP scale
- **Modal**: pay-per-use, ~$300/mo MVP
- **Upstash Redis**: ~$50–200/mo
- **Total infra MVP** ≈ **$2 500–4 000/mo** (skaluje się z usage)

### I.5. Observability

- **Sentry** dla errors (frontend + backend)
- **OpenTelemetry** + **Grafana Cloud** (free tier do 10k metrics) lub **Datadog** dla enterprise tier (~$31/host/mo)
- **PostHog Cloud EU** dla product analytics (self-hosted opcja w roadmapie dla data residency)
- **Custom dashboard w control plane** dla tenant-facing metrics

### I.6. Dev tooling

- Monorepo: **Turborepo** + **pnpm**
- CI/CD: **GitHub Actions** + **Vercel** auto-deploy + **Cloudflare Wrangler** for Workers
- IaC: **Terraform** dla AWS/Cloudflare, **Pulumi** opcjonalnie dla TypeScript-native
- Secrets: **Doppler** lub **Infisical** (open source)
- Feature flags: **PostHog** built-in lub **Statsig** ($0 do 1M events/mo)

---

## J. Multi-Tenancy Model — szczegółowy design

### J.1. Schema strategy

**Hybrid approach:**
- **Shared schema z RLS** dla wszystkich tabel transakcyjnych (tenants, users, listings_metadata, configs, billing) — Supabase RLS per `tenant_id` claim w JWT
- **Schema-per-tenant** dla pgvector embeddings (top-100 enterprise klientów) — lepsza performance dla complex similarity queries
- **Partition-per-tenant** w ClickHouse dla events — tanie i szybkie

```sql
-- przykład RLS policy
CREATE POLICY tenant_isolation ON listings_metadata
  FOR ALL TO authenticated
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
```

### J.2. API key model

- **Public API key** (per origin, rate-limited): wkleja się w SDK, OK dla client-side
- **Secret API key** (server-side): dla webhook adapters, MLS feed sync, CRM integration
- HMAC sign każdy request z `secret`; rotacja keys w 1-click dashboard
- Per-key scopes: `read:events`, `write:adaptations`, `admin:config`

### J.3. Konfiguracja klienta

Per-tenant configuration JSON Schema:

```typescript
type TenantConfig = {
  tenant_id: string;
  display_name: string;
  region: 'eu' | 'us' | 'uk' | 'uae';
  tier: 'observer' | 'augment' | 'native';
  brand_tokens: { primary_color, secondary_color, font_family, ... };
  brand_voice: { tone, formality, vocabulary_constraints, ... };
  signals_enabled: SignalCategory[];
  adapters: { intercom?, drift?, idealista?, otodom?, ... };
  fair_housing_rules: 'us_strict' | 'uk_standard' | 'eu_standard' | 'custom';
  privacy_mode: 'session' | 'consented' | 'legitimate_interest';
  consent_helper_enabled: boolean;
  white_label: { logo_url?, hide_estalara_badge: boolean };
  webhook_url?: string;
  audit_retention_days: 30 | 90 | 365 | 'compliance';
  
  // NEW v1.1 — Auto-onboarding fields (see B.4-B.6)
  data_schema: TenantSchemaMapping;  // auto-generated, manually editable
  onboarding_status: 'pending' | 'auto_detecting' | 'ready' | 'needs_review';
  primary_url: string;               // dla continuous validation
  detected_platform?: string;        // 'wordpress-houzez', 'idealista', etc.
  schema_health_score: number;       // 0-1, updated daily
  last_drift_detected?: string;      // ISO timestamp
  auto_recovery_enabled: boolean;    // default: true
};
```

### J.4. Per-tenant dashboard

Sekcje w dashboardzie:
1. **Overview**: live visitors, active intent-detected sessions, conversion lift
2. **Adaptations**: which listings adapted, top-performing variants, A/B results
3. **Buyer Archetypes (anonymized)**: distribution of buyer types z ich własnego ruchu
4. **Configuration**: tier upgrade/downgrade, signals enable/disable, brand tokens
5. **Integrations**: chat, CRM, MLS feed, webhook
6. **Billing**: current usage, projection, invoices
7. **Compliance**: DPIA template download, ROPA export, DSR queue
8. **Audit log**: kto co zmienił, kiedy

### J.5. Standalone Estalara product

Identyczna architektura, różnica tylko w *frontendzie*:
- Plug-in mode: SDK na cudzej stronie, dane z ich feedu
- Standalone mode: nasz Next.js frontend hostowany na `{tenant}.estalara.app`, ten sam SDK używa się internally, ale my dostarczamy też CMS-like editor dla listingów

To pozwala small agencies bez własnej strony użyć Estalara end-to-end, podczas gdy enterprise integruje SDK do swojej istniejącej witryny.

---

## K. Internal Operations Panel (Estalara Staff Only)

Sekcja zamyka lukę zidentyfikowaną po Sprint 0: nie było planu dla wewnętrznego panelu admin dla staff Estalara (Piotr/CEO, Rafał/CTO, future Customer Success staff) do monitoringu i interwencji w tenant instances. `apps/control-plane` istnieje, ale jest dla tenant-facing dashboardów. Dodajemy internal staff-only routes w tym samym Next.js app (separacja na poziomie middleware + RBAC, nie osobny app — jeden deployment, jeden auth domain, mniejszy ops overhead).

### K.1. Access levels (RBAC, 3 role)

| Rola | Kto | Permissions |
|---|---|---|
| `estalara:superadmin` | Piotr (CEO) + Rafał (CTO) | Full access including tenant suspension, billing changes, dangerous interventions |
| `estalara:ops` | Customer Success staff (post-Series A) | View all tenants, send alerts to tenants, force-refresh schema; **CANNOT** suspend tenants ani zmieniać billing |
| `estalara:readonly` | Future auditors / inwestorzy | Read-only access do aggregated metrics dashboards, no per-tenant deep-dive |

Rola przechowywana w `users.estalara_role` enum (separate od tenant role w sekcji J — staff member może też być tenant userem, role są niezależne). Wszystkie akcje staff logowane do `staff_audit_log` (K.5) — append-only, retention 7 lat (compliance + investigation requirements).

### K.2. Routing (apps/control-plane)

- `/admin/*` routes — separate from `/dashboard/*` tenant routes (które używają tenant subdomeny lub `/t/{tenant_id}/`)
- Middleware (Next.js Edge Middleware) sprawdza `estalara_role` na każdym `/admin/*` request, redirects do 403 jeśli not staff
- Separate Supabase RLS policy: staff z `estalara_role IS NOT NULL` może czytać all rows w `tenants/events/listings_metadata/etc`, podczas gdy regular tenant users widzą tylko `own_data(t)` per existing F section
- Session timeout: **1h inactive** (vs 24h dla tenant users)
- Wszystkie `/admin/*` routes wymagają **MFA mandatory** (TOTP via Supabase Auth, hardware key opcjonalny)

### K.3. Phase 1 — Monitoring (Sprint 3–4, read-only)

#### K.3.1. Fleet Overview Dashboard

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Estalara Internal Ops — Fleet Overview                          [👤 ops] │
├──────────────────────────────────────────────────────────────────────────┤
│ Filtry: [status ▼] [region ▼] [plan ▼] [search tenant...]                │
├──────────────────────────────────────────────────────────────────────────┤
│ Tenant            Status   Last seen   Events 24h   DQS    Plan   MRR   │
│ ─────────────────────────────────────────────────────────────────────── │
│ 🟢 marbella-rs     active   2m ago      12 430       0.81   T2     $1999 │
│ 🟢 idealista-pl    active   12s ago     1 892 003    0.74   Ent    $25k  │
│ 🟡 london-elite    trial    4h ago      341          0.58   T1     $499  │
│ 🔴 warsaw-realty   warn     1d ago      0            n/a    T1     $499  │
│ ⚫ test-suspended  susp.    14d ago     0            n/a    —      $0    │
└──────────────────────────────────────────────────────────────────────────┘
```

Tabela wszystkich tenantów z kolumnami: status, last_seen, events_24h, archetype_confidence_avg (DQS z D.5.3), plan, MRR. Filterable by status (active/suspended/trial), region, plan tier. Click row → Tenant Detail page (K.3.2).

#### K.3.2. Tenant Detail Page

Pięć sekcji per tenant:

- **SDK health:** wersja zainstalowana (z latest event metadata), last heartbeat timestamp, errors w last 24h (z Sentry), bundle hash
- **Archetype quality:** confidence distribution histogram, top 5 detected archetypes (per Q.x scenarios), accuracy vs ground truth (cross-reference D.5 — pełen DQS panel)
- **Auto-detect health:** schema confidence (B.4), last refresh date, drift indicators (B.5.4 fingerprint distance, B.6 health score)
- **Billing:** plan, usage vs limit, MRR, days until next invoice, payment status (Stripe webhooks)
- **Recent activity:** last 100 events (ClickHouse query), last 10 admin actions on this tenant (z `staff_audit_log`)

#### K.3.3. Alerts Center

Auto-generated alerts gdy conditions trigger:

| Alert type | Warunek | Default severity |
|---|---|---|
| `sdk_silent` | SDK silent >1h na tenancie który normalnie ma events | warning |
| `dqs_drop` | DQS < 0.4 na >50% decyzji w ostatnim 1h window | critical |
| `usage_approaching_limit` | Usage > 80% plan limit | warning |
| `schema_drift_predicted` | B.5.4 fingerprint cosine < 0.85 | warning |
| `payment_failed` | Stripe `invoice.payment_failed` webhook | critical |
| `archetype_unstable` | Stability score < 0.5 dla nowego tenanta | info |

Severity: info / warning / critical. Assignable to ops staff (claim/assign UI). Acknowledged/resolved tracking. SLA per severity: critical = 30 min, warning = 4h, info = 1 dzień.

#### K.3.4. Global ML Health (superadmin only)

Cross-tenant aggregated metrics (z respect dla DP guarantees w F.3):
- Composite DQS distribution (per archetype, per region)
- Archetype distribution shifts (np. "luxury investor" rośnie 18% MoM)
- Embedding drift detection (centroid movement w archetype space)
- Model performance trends (accuracy, latency p95/p99 per LLM provider)

Used to detect when global model retraining is needed (cross-ref D.5.4 weekly retrain trigger). Restricted (sensitive ML internals) — superadmin only.

#### K.3.5. Revenue Dashboard (superadmin only)

MRR, ARR, churn rate (logo + revenue), expansion rate (NDR), gross margin per tenant. Tenants at churn risk (declining usage, support tickets, payment issues — composite "churn risk score"). Cohort analysis (signup month → retention curve). Exportable do CSV dla board reports.

### K.4. Phase 2 — Intervention (Sprint 5–6, read-write z audit log)

Każda akcja w K.4 wymaga `reason` (free text, min 10 znaków), confirmation modal, i automatic log do `staff_audit_log` (K.5).

#### K.4.1. Tenant Lifecycle Actions (superadmin only)

- **Suspend tenant** (pauses all SDK responses — Decision API zwraca `{adapt: false}`, soft-delete approach: row pozostaje, flag `suspended_at` set)
- **Reactivate** suspended tenant (clears `suspended_at`)
- **Force-cancel subscription** (Stripe cancel + reason field, nie usuwa danych)
- **Migrate tenant region** (rare, requires DB backup snapshot + dual-write window — runbook w `docs/runbooks/region-migration.md`)

#### K.4.2. Personalization Override (superadmin + ops)

- **Disable personalization** dla specific tenant (returns control archetype globally — useful przy customer escalation albo investigation)
- **Reset archetype assignments** dla specific user_id within tenant (clears Redis session + invalidates intent vector)
- **Force-refresh** auto-detected schema (triggers B.4 re-run)
- **Re-run signal classification** na historical events (replay z ClickHouse, useful po model improvement)

#### K.4.3. SDK Management (superadmin)

- **Pin tenant** to specific SDK version (rollback support — overrides `latest` channel)
- **Push hotfix** SDK version do specific tenant subset (canary deployment dla SDK fixes)
- **Force-refresh CDN cache** dla tenant's SDK bundle (Cloudflare purge by tag)

#### K.4.4. Communication (superadmin + ops)

- **Send in-product notification** do tenant admins (banner w `/dashboard`)
- **Send email** do tenant via configured channels (SES, with Estalara branding)
- **Schedule maintenance notice** (cron-driven announcement)
- **Mark tenant as "VIP"** (priority support flag — escalates ticket SLA)

#### K.4.5. Audit Log (all staff view own, superadmin sees all)

Każda K.4.* akcja logged z: actor, target, action_type, timestamp, reason (required), before_state JSON, after_state JSON, IP, user agent. Immutable (append-only — DB trigger blocks UPDATE/DELETE). Exportable for compliance audits (GDPR DSAR, SOC2 evidence). Retention: **7 lat** (regulatory + insurance requirement).

### K.5. Data model

Trzy nowe tabele:

```sql
-- staff_audit_log: immutable audit trail (append-only via trigger)
CREATE TABLE staff_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  action_type action_type_enum NOT NULL,    -- 'suspend_tenant', 'reset_archetype', etc.
  target_tenant_id uuid REFERENCES tenants(id),
  target_user_id uuid REFERENCES users(id),
  reason text NOT NULL CHECK (length(reason) >= 10),
  before_state jsonb,
  after_state jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_staff_audit_actor ON staff_audit_log(actor_user_id, created_at DESC);
CREATE INDEX idx_staff_audit_tenant ON staff_audit_log(target_tenant_id, created_at DESC);

-- alerts: ops alert queue
CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity severity_enum NOT NULL,           -- 'info' | 'warning' | 'critical'
  tenant_id uuid REFERENCES tenants(id),
  alert_type alert_type_enum NOT NULL,       -- 'sdk_silent', 'dqs_drop', etc.
  payload jsonb,
  assigned_to_user_id uuid REFERENCES users(id),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_alerts_open ON alerts(severity, created_at DESC)
  WHERE resolved_at IS NULL;

-- tenant_health_snapshots: materialized view, refreshed every 5 min
CREATE MATERIALIZED VIEW tenant_health_snapshots AS
SELECT
  t.id as tenant_id,
  now() as snapshot_at,
  -- SDK version z latest event
  (SELECT sdk_version FROM events
   WHERE tenant_id = t.id ORDER BY ts DESC LIMIT 1) as sdk_version,
  -- events w last 24h
  (SELECT count() FROM events
   WHERE tenant_id = t.id AND ts > now() - interval '24 hours') as events_24h,
  -- avg DQS z D.5.3
  (SELECT avg(dqs) FROM session_quality
   WHERE tenant_id = t.id AND ts > now() - interval '24 hours') as avg_dqs,
  -- active alerts count
  (SELECT count(*) FROM alerts
   WHERE tenant_id = t.id AND resolved_at IS NULL) as active_alerts
FROM tenants t;
```

### K.6. Sprint mapping

| Sprint | Tickets | Co dostarcza |
|---|---|---|
| Sprint 3 (SDK Tier 1) | TICKET-XXX foundations | `estalara_role` enum, `/admin/*` middleware, basic Fleet Overview read-only |
| Sprint 4 (Intent ontology) | TICKET-XXX | Tenant Detail, Alerts Center, Global ML Health (ties into model retraining decisions per D.5) |
| Sprint 5 (LLM gateway) | TICKET-XXX | Phase 2 begins — Personalization Override, Communication |
| Sprint 6 (Embeddings + matching) | TICKET-XXX | Tenant Lifecycle Actions, SDK Management, full Audit Log |
| Sprint 9 (DPIA + compliance) | TICKET-XXX | Audit Log retention enforcement, exportable for GDPR audits, ROPA integration |

### K.7. Security

- Wszystkie `/admin/*` routes wymagają **MFA** (mandatory dla `estalara:*` ról, optional dla tenant users)
- Staff IP allowlist (configurable, default: any IP ale logged with geo-IP)
- Session timeout: **1h inactive** (re-auth required after)
- Wszystkie staff actions trigger Slack notification do `#estalara-ops` channel (real-time visibility)
- **Quarterly access review** (superadmin reviews i re-confirms ops staff list — compliance hygiene)
- Hardware security key (WebAuthn) wymagane dla `superadmin` od Sprint 9 (post-MVP hardening)

### K.8. Cross-references

- **Section B.4–B.7** (Auto-Onboarding): Internal Ops może force-refresh detected schemas (K.4.2)
- **Section J** (Tenant Auth): `estalara_role` żyje w tej samej `users` table ale jest niezależna od tenant memberships
- **Section D.5** (Detection Quality): Tenant Detail page (K.3.2) surface'uje D.5 metrics; K.3.4 Global ML Health agreguje DQS cross-tenant
- **Section R** (Innovation Roadmap): Internal Ops dogfooded dla measuring innovation impact (R.1–R.6 metrics surface'ują się w K.3.4)
- **Section H** (Compliance) Sprint 9: `staff_audit_log` feeds do ROPA exports (Art. 30 GDPR)

---

## L. Pricing Model (Hybrid)

### L.1. Pricing tiers — konkretne stawki

**TIER 1 "Observer"** — Self-serve, kredyt karta, instant signup
- Base: **$499/month** (annual: $4 990, save 17%)
- Included: 50k tracked visits/mo
- Overage: **$0.40 / 1k additional visits**
- LLM: not used (pure observation + widget)
- Target: solo agents, brokerages 1–10 people

**TIER 2 "Augment"** — Light-touch sales, 14-day trial
- Base: **$1 999/month** (annual: $19 990)
- Included: 200k tracked visits + 50k adaptations
- Overage: $1.20 / 1k adaptations, $0.30 / 1k additional visits
- LLM passthrough: actual LLM cost + 25% margin
- Target: mid-market agencies, 10–100 agents

**TIER 3 "Native"** — Enterprise, sales-led, custom contract
- Base: **starting $7 500/month** (annual contract minimum)
- Included: 1M visits, 500k adaptations, 100k LLM-rendered listings
- Overage: $4 / 1k rendered listings, LLM passthrough +20%
- White-label + SLA 99.95% + dedicated CSM + custom features
- Target: portals (Idealista/Otodom/Zillow scale), enterprise brokerages

**Free tier (long-tail acquisition):**
- 5k visits/mo, Estalara badge wymagane, no LLM features, watermarked
- Cel: SEO + viral acquisition + funnel do Tier 1

### L.2. Pricing benchmarking — competition

| Vendor | Entry pricing | Notes |
|---|---|---|
| **Mutiny** | Custom, listed ~$1k/mo entry, real deals $50k–$200k+ ARR | B2B ABM personalization, nie real-estate-specific ([Vendr](https://www.vendr.com/marketplace/mutiny)) |
| **Optimizely Web Experimentation** | ~$36k/rok minimum, $113k+ enterprise dla 10M impressions | Pure A/B testing ([Mida](https://www.mida.so/blog/how-much-is-optimizely)) |
| **Dynamic Yield** | ~$35k–60k+/rok minimum, $250k+ dla enterprise | Mastercard-owned, e-commerce focus ([Personizely](https://www.personizely.net/blog/dynamic-yield-pricing)) |
| **Segment (CDP)** | $25k–$200k/rok depending on volume | Data pipeline, not personalization ([Spendflo](https://www.spendflo.com/blog/segment-pricing-guide)) |
| **Drift** | ~$2 500/mo entry ($30k/rok) | Conversational sales, B2B ([Social Intents](https://www.socialintents.com/blog/drift-vs-intercom/)) |
| **Intercom** | $39/seat starting, $903/mo Advanced, scales to enterprise tens of thousands | Customer support primary ([Featurebase](https://www.featurebase.app/blog/intercom-pricing)) |

**Nasze pricing rationale:** plasujemy Tier 2 niżej niż Mutiny/Dynamic Yield (specjalizacja vertical, nie general-purpose), Tier 3 enterprise konkurencyjnie z Dynamic Yield ale z unique value prop (real-estate vertical depth + multi-region z dnia 1).

### L.3. Enterprise dla portals (Idealista/Otodom/Zillow scale)

Custom enterprise contracts:
- Base $50k–$200k+/mo
- Volume discounts: -10% przy >5M visits/mo, -20% przy >50M
- 3-year commitment unlock dodatkowe 15–25% discount (zgodne z industry norm — Vendr data dla Optimizely/Segment)
- Co-marketing rights (case studies, joint webinars)
- On-prem option (Year 3+) dla największych

---

## M. Business Model & Go-To-Market

### M.1. Plan wdrożenia (4 fazy)

| Faza | Czas | Cele | Liczba klientów | ARR target |
|---|---|---|---|---|
| **MVP** | M1–M3 | Build core platform + Tier 1 + Tier 2 (basic), 3-5 design partners | 3–5 (free pilots) | $0 |
| **Beta** | M4–M6 | Stabilize, add Tier 3 Native, recruit pilot enterprise | 10–20 paying | $200–400k |
| **General Availability** | M7–M12 | Marketing engine, content, case studies, self-serve flow | 50–100 paying | $1–2M |
| **Enterprise tier** | Y2 | Dedicated SE team, channel partnerships, on-prem option | 5–10 enterprise + 200+ SMB | $5–10M |

### M.2. Acquisition channels

**Tier 1 Observer (self-serve):**
- SEO content: "AI for real estate listings", "real estate website personalization", "Idealista alternative for personalization"
- Polish + English + Spanish blog
- Free tier viral loop ("Powered by Estalara" badge na free tier)
- Real estate communities (BiggerPockets, ARRA, polskie grupy FB agentów)

**Tier 2 Augment (light-touch):**
- Outbound do top 500 agencji w każdym z 5 rynków (US/UK/ES/PL/UAE)
- Webinary "How AI is changing real estate listings"
- Industry conferences: Inman Connect, REtech, Property Forum (Polska), Dubai REst

**Tier 3 Native (enterprise sales):**
- Account-based marketing dla top 50 portals/brokerages globally
- Partnerships: HouseSigma, Boomtown CRM, Reonomy, Lone Wolf — integracje + co-sell
- Direct relationships z Idealista (enterprise plan SE-led), Otodom (Allegro Group), Rightmove (UK), Zillow Group (US)
- W UAE: Bayut (Dubizzle Group), Property Finder

### M.3. Sales motion per tier

| Tier | Motion | Time-to-close | ACV |
|---|---|---|---|
| Tier 1 | Self-serve, credit card, 24h activation | minutes | $5 988/yr |
| Tier 2 | Light-touch, 30-min demo, 14-day trial, contract | 14–30 dni | $24 000–48 000/yr |
| Tier 3 | SE-led, POC, custom contract, security review, DPIA | 60–120 dni | $100k–500k+/yr |

---

## N. Koszty & Unit Economics

### N.1. COGS — kalkulacja per 1 000 visits / adaptations / inferences

**Założenia bazowe:**
- 1 wizyta = avg 60 events, 4 adaptacje, 0–1 chat session (avg 2 messages), 3–8 LLM inferences
- LLM mix: 80% Claude Haiku 4.5 ($1/$5 per MTok), 20% Sonnet 4.6 ($3/$15)
- Avg input/output per inference: 800 / 200 tokens

| Komponent | Koszt na 1k visits | Komentarz |
|---|---|---|
| Cloudflare Workers ingest (60k events) | $0.018 | $0.30 / M req |
| ClickHouse Cloud storage + queries | $0.05 | based on $1500/mo dla 100M events/mo |
| Postgres (Supabase) — config reads | $0.005 | minimal |
| Embedding (per session ~10 calls × 500 tokens) | $0.10 | OpenAI text-embedding-3-small |
| LLM intent + adaptation (~5 inferences avg) | $1.50 | 80% Haiku, 20% Sonnet |
| GPU inference (CLIP photo scoring, cached) | $0.02 | mostly amortized |
| CDN egress (SDK delivery) | $0.10 | Cloudflare free egress, only R2 storage |
| Egress to LLM providers | $0.05 | minimal |
| **Total COGS / 1k visits** | **~$1.85** | |
| **Total COGS / 1k adaptations** (no LLM) | **~$0.40** | mostly compute |
| **Total COGS / 1k LLM inferences** | **~$3.00** | dominated by Sonnet |

### N.2. Margin targets per tier

| Tier | Avg revenue/1k visits | COGS/1k visits | Gross margin |
|---|---|---|---|
| Tier 1 Observer ($0.40/1k overage) | $0.40 | $0.10 (no LLM, light ops) | 75% |
| Tier 2 Augment ($1.20/1k adaptations) | $1.20 | $0.40 | 67% |
| Tier 3 Native ($4/1k rendered + LLM passthrough) | $4.00 + $0.50 LLM markup | $1.85 + LLM cost | 70% blended |

**Blended target: 70–75% gross margin**, w linii z najlepszymi B2B SaaS.

### N.3. CAC i LTV

Estymacje na podstawie analogicznych SaaS:

| Tier | CAC | ACV | Year 1 LTV (assuming 90% logo retention, 110% NRR) | LTV/CAC |
|---|---|---|---|---|
| Tier 1 (self-serve) | $200 | $5 988 | $30k 5-yr | 150x (excellent) |
| Tier 2 (light-touch) | $3 000 | $36 000 | $180k 5-yr | 60x |
| Tier 3 (enterprise) | $40 000 | $250 000 | $1.5M+ 5-yr | 37x |

**Payback period target: <12 miesięcy dla Tier 1, <18 dla Tier 2, <24 dla Tier 3.**

---

## O. Ryzyka i Mitygacje

### O.1. Techniczne

| Ryzyko | Prawdopodobieństwo | Impact | Mitygacja |
|---|---|---|---|
| SDK latency >100ms degraduje UX klienta | Medium | High | Performance budget per tier; Cloudflare edge; lazy-load; chaos engineering testy |
| Intent misidentification (np. flagujemy retiree jako student) | High (early) | Medium | Confidence threshold; default-no-adapt; A/B holdout zawsze on; monthly accuracy audit |
| Scaling do 10M+ events/dzień przed Y2 | Medium | High | ClickHouse + Cloudflare radzą sobie; load test po MVP; budget na ClickHouse upgrade |
| Vector DB hit ceiling (pgvector @ 10M+) | High w Y2 | Medium | Plan migracji do Qdrant w roadmapie Q4 Y1 |
| Detection accuracy regression przy retraining | Medium | High | Canary deployment 1% traffic, DQS comparison 24h, auto-rollback if regression > 2pp. Patrz D.5.4 |

### O.2. Prawne

| Ryzyko | Prawdopodobieństwo | Impact | Mitygacja |
|---|---|---|---|
| Enforcement na fingerprinting w EU/UK | High | High | Mode A jako default; strict legal opinion przed launch; Estalara Consent Helper jako optional component; transparent privacy notice |
| AI Act high-risk classification by regulator | Low–Medium | Very High | Defensive posture (pełna dokumentacja jakby był high-risk); legal counsel relationship; participate in CEN/CENELEC consultations |
| Data localization wymóg w UAE | Medium | Medium | Region-specific deployment od dnia 1; AWS me-central-1 plan ready |
| Schrems III scenario (US transfers) | Medium | High | Data residency w EU; SCC + supplementary measures; dla US tenantów ich dane stay w US-region |

### O.3. Konkurencyjne

| Konkurent | Threat level | Komentarz |
|---|---|---|
| **Mutiny** | Medium | Mogliby wejść w real estate, ale ich DNA to B2B ABM. Nasza vertical depth jest realnym moat. |
| **Salesforce/HubSpot** | Low–Medium | Mają CRM, ale nie embeddable adaptive listing layer. Przez 2–3 lata bezpiecznie. |
| **Adobe Target** | Low | Enterprise-only, drogie, generic personalization, nie real-estate. |
| **Zillow / Realtor.com / Idealista internal AI** | High | Już budują własne AI search ([Real Estate News](https://www.realestatenews.com/2025/10/14/2-more-portals-embrace-ai-powered-home-search-tools)). Strategy: zostać partnerem, nie konkurentem — sprzedajemy IM Tier 3 enterprise z ich brandem |
| **Real-estate-specific startupy** | Medium | Niewielu z nas widzi (RentSync, EliseAI w property mgmt, ale nie embeddable adaptive listings). Mamy 18-mo head start. |

### O.4. Reputacyjne — "creepy factor"

- Default privacy mode = Mode A (session only, brak persistence)
- Transparent: każdy listing pokazuje "Powered by Estalara — learn more" link → strona "How we personalize"
- Buyer może opt-out 1-click (cookie sets, persistence cross-session)
- Limit adaptation aggressiveness: max 30% headline/copy delta od oryginału (etyczne nie-misleading)
- Fair-housing constraint linter: nigdy nie filtrujemy/adaptujemy na podstawie chronionych klas (race, religion, family status etc.) — to jest hard-coded, nie konfigurowalne

### O.5. Reliance na third parties

| Vendor | Risk | Mitigation |
|---|---|---|
| Anthropic Claude | Pricing change, downtime | LiteLLM router → OpenAI fallback; long-term plan: fine-tuned Llama na Modal |
| OpenAI embeddings | Price hike, model deprecation | Plan na BGE-M3 self-hosted w Y2 (break-even @ 15M embed/mo) |
| Cloudflare | Outage, vendor lock-in | Multi-region; failover do Vercel Edge; Workers-compatible standard (Hono) używany |
| Vercel | Pricing escalation | Architecture pozwala na migrację na Cloudflare Pages + Workers w razie potrzeby |

### O.6. ML model risks

Wprowadzenie systemu D.5 (Continuous Detection Quality) i innowacji R.1–R.6 (patrz sekcja R) tworzy nowe kategorie ML-specific ryzyk, które wcześniej nie istniały (gdy adaptacja była rule-based). Tabelka mitygacji:

| Ryzyko | Prawdopodobieństwo | Impact | Mitygacja |
|---|---|---|---|
| Detection Quality Score (DQS) plateau przy 70–75% — nie osiągamy 90% target | Medium | Very High | Active learning queue (D.5.5), quarterly archetype refresh (D.5.4), fallback to fine-tuned classifier Y2; jeśli plateau utrzymuje się >2 sprinty, eskalacja do Krystiana z propozycją expanded archetype set |
| Cross-tenant retraining wprowadza bias (over-representation top-3 tenants) | High | Medium | Stratified sampling per tenant, k-anon ≥50 per archetype across tenants minimum, weighted loss function (rare tenants up-weighted) |
| Adversarial attack — bot fakuje signals żeby manipulować adaptation | Low (MVP) | Medium | Bot detection w ingest (rate limit, CAPTCHA dla suspicious patterns), tagged jako "low_trust" sessions excluded z global learning loop (D.5.4) |
| Distribution shift gdy expanding to new region (new buyer types) | High | Medium | Region-specific model checkpoints, gradual rollout per region, manual archetype curation by Krystianie dla pierwszych 90 dni nowego rynku |
| Confidence calibration drift po model update | Medium | Medium | Continuous calibration on rolling 7-day window (Platt scaling — patrz R.1), alerts gdy ECE (Expected Calibration Error) > 0.1, surface w K.3.4 |
| Federated learning protocol leakage (Y2 R.3) | Low | High | Secure aggregation (Bonawitz 2017), DP-FedAvg z ε ≤ 2 cumulative, third-party audit przed enterprise rollout |

---

## P. Roadmap & Priorities dla MVP (12 tygodni)

### P.1. Co budujemy (MVP scope)

**Tygodnie 1–2 — Foundation:**
- Monorepo Turborepo, pnpm workspace
- @estalara/sdk skeleton (Preact + Shadow DOM, builds & test harness)
- Cloudflare Workers ingest endpoint (events → Redpanda → ClickHouse)
- Supabase Postgres schema + RLS policies
- Auth: tenant signup, API key generation
- Sentry + OTel basic instrumentation
- **🆕 Auto-Detection Service skeleton** (Modal function, Puppeteer setup)
- **🆕 15 platform templates** (Idealista, Rightmove, Otodom, Zillow, Bayut + top 10 WordPress themes)

**Tygodnie 3–4 — Tier 1 Observer + Magic Link Onboarding:**
- SDK Tier 1 widget (sidebar overlay, intent display, basic chat anchor)
- Event taxonomy v1 (top 30 event types)
- Behavioral fingerprinting (Mode A — session only)
- Per-tenant config dashboard (Next.js)
- Real-time intent vector update (Redis cache)
- **🆕 Magic Link onboarding flow** (paste URL → AI Vision detect → script tag w 90s)
- **🆕 Schema discovery pipeline** (L1-L5 layered detection per B.5)
- **🆕 Field mapping UI** (admin może review/edit auto-detected schema)

**Tygodnie 5–6 — Intent Engine:**
- Claude Haiku 4.5 integration via LiteLLM
- Intent ontology v1 (12 wymiarów, simplified)
- OpenAI embeddings integration + pgvector setup
- 50 seed archetypes (manually crafted from real estate domain knowledge — Krystian's PhD value here)
- Decision API endpoint (Edge Runtime)
- **🆕 NLP feature extraction** (parse "4 dormitorios, piscina" → structured)

**Tygodnie 7–8 — Tier 2 Augment + Adaptation:**
- SDK Tier 2 (declarative slots, DOM augmentation)
- Adaptation engine v1: headline rewrite (templates+slots), feature reorder, photo re-rank
- A/B holdout framework (10% default)
- Inquiry conversion tracking webhook
- **🆕 WordPress Plugin v1** (1-click install dla Houzez/Realtyna themes)
- **🆕 Auto-suggest Tier 2 upgrade** (gdy stats wskazują wysokie potential uplift)

**Tygodnie 9–10 — Compliance, Self-Healing & Polish:**
- DPIA document (master + tenant template)
- ROPA auto-export
- DSR endpoint + admin UI
- Privacy policy generator dla tenants
- White-label config
- Billing integration (Stripe + usage metering via Lago lub własny)
- **🆕 Continuous schema validation** (daily cron job per tenant)
- **🆕 Drift detection telemetry** (SDK reports broken selectors)
- **🆕 Auto-recovery flow** (B.6.3 — re-crawl + auto-update schema)

**Tygodnie 11–12 — Pilot launch prep:**
- Onboard 3 design partners (1 Marbella ES, 1 Warszawa PL, 1 London UK)
- Documentation + integration guides
- Loom demo videos
- Pricing page + signup flow
- **🆕 Onboarding success metrics dashboard** (tenant time-to-value tracking)
- **🆕 Test onboarding na 50 random sites** (validate >90% auto-detect success rate)

### P.2. Co NIE budujemy w MVP

- ❌ Tier 3 Native (full SDK component) — Q5–Q6
- ❌ UAE region deployment — Q5 (legal-heavy, czekamy na pierwszego UAE klienta)
- ❌ Federated learning — never (centralized DP wystarczy)
- ❌ Self-hosted Llama fine-tuning — Q7+, after $15M embed/mo crossover
- ❌ Mobile native SDKs (iOS/Android) — Q5+, MVP web-only
- ❌ Adaptive video / 3D tour — Q6+
- ❌ Voice / phone integration — Y2
- ❌ Multi-language SDK UI (poza EN/ES/PL) — wagi marketu

### P.3. Data flywheel ready od dnia 1

Nawet jeśli MVP używa adaptacji w 30% przypadków, **zbiera 100% sygnałów**:
- Pełen event taxonomy aktywny od dnia 1
- Anonimowe archetypes generowane co tydzień (cron job na Modal)
- ClickHouse z full event history → możemy retrospektywnie rebuild modeli gdy je dodamy
- Schema versioning: każdy event ma `schema_version`, więc można migrować dane forward

### P.4. Walidacja z 3–5 pilot klientami

Konkretne metryki sukcesu pilota:
1. **Inquiry rate uplift > 15%** (vs holdout group) w pierwszych 60 dniach
2. **Time-on-listing uplift > 20%** dla adapted vs holdout
3. **Pilot CSAT > 8/10** od tenant
4. **Latency SLA p95 <100ms** dla wszystkich Decision API calls
5. **Zero compliance incidents**

Pilot terms: free 90 dni → opcja Tier 2 paid ($1 999/mo) z 50% discount na Y1.

### P.5. Budżet i zespół MVP

**Zespół (12 tygodni):**
- Piotr Nawrocki (CEO) — sales, partnerships, fundraising (0.5 FTE on product)
- Rafał Palak PhD (CTO) — architecture, backend, ML/AI lead (1 FTE)
- Krystian Wojtkiewicz PhD (CPO) — product, real-estate domain ontology, design (1 FTE)
- **Senior Full-Stack Engineer #1** — SDK lead, frontend (kontraktor lub hire, 1 FTE)
- **Senior Backend/Data Engineer #2** — ingest, ClickHouse, ML serving (kontraktor lub hire, 1 FTE)

**Budżet 12 tygodni:**
| Pozycja | Koszt |
|---|---|
| Founders (3 × $5k/mo equity-heavy) | ~€36 000 |
| 2 senior engineers (€8–12k/mo full cost) | ~€60 000–72 000 |
| Legal (DPIA, MSA template, ToS, Privacy Policy x4 jurisdykcje) | €15 000 |
| Infra (Vercel, Supabase, Cloudflare, ClickHouse, Modal, Anthropic credits) | €10 000–15 000 |
| Design + branding (Fraunces + Inter system, dashboard UI) | €8 000 |
| Sales + travel dla 3 pilot klientów | €10 000 |
| Buffer / contingency 15% | €20 000 |
| **Total MVP budget** | **€160 000–200 000** |

Po MVP, do general launch (kolejne 6 miesięcy), realnie **€350 000–500 000 dodatkowo** dla zatrudnienia 2 nowych inżynierów + 1 sales/CSM + marketing.

---

## Q. Przykładowe User Stories & Data Flows

### Q.1. Scenariusz 1: Anonimowy buyer w Marbelli (pierwszy raz)

**T+0s** — Brytyjska kobieta (45) wchodzi na stronę agencji Marbella Realty (Tier 2 Augment). SDK ładuje się async (32KB, 80ms).
**T+1s** — `page.view`, `device.context` (UK locale, mobile Safari, view-port iPhone). Session ID = HMAC z fingerprint + tenant_secret + day_bucket.
**T+15s** — Widzi listing willi €1.2M, otwiera 4 zdjęcia, dwell na zdjęciu basenu 8s, scrolluje do features.
**T+45s** — Otwiera czat (Intercom integracja), pisze: *"Czy ta nieruchomość ma dostęp do pomocy domowej? Planujemy spędzać 4 miesiące rocznie w Hiszpanii."*

**System reaguje:**
- Worker Streams: chat message → Claude Haiku 4.5 prompt: extract intent ([NLP intent extraction template])
- Output structured JSON: `{purchase_purpose: 'second_home', cross_border: 'eu_intra → expat', urgency: 'exploratory', family_stage: 'established_family' (inferred from "we"), feature_priority: {staff_quarters: 0.9, lifestyle: 0.8}, geo_priority: 'beach', budget_band: 'comfortable'}`
- Match against archetypes: 0.91 similarity z `british_part_year_resident_costa_del_sol`
- Adaptation engine returns directives:
  - `headline.rewrite`: "4-Month Lifestyle Villa with Live-In Staff Quarters — Marbella" (zamiast generycznego "3-bed villa for sale")
  - `features.reorder`: [staff_quarters, pool, beach_proximity] na top
  - `photos.reorder`: pool deck first, master suite second, kitchen later
  - `chat.suggested_reply`: assistance with year-round property management info + tax implications for UK residents (pre-canned z RAG nad tenant FAQ)

**T+47s** — DOM mutated przez SDK Tier 2; user widzi smoothly zaktualizowany listing
**T+50s** — Agent chat replies (z naszym suggested reply jako draft), user kontynuuje conversation

### Q.2. Scenariusz 2: Ten sam buyer tydzień później (inna agencja, ten sam tenant network)

**Tydzień później** — wchodzi na stronę agencji w Walencji (też klienta Estalara, Tier 2). Default tryb = Mode A (Session) → fingerprint dla Walencja agency to **inny hash** (HMAC z innym tenant_secret), więc *cross-tenant identification jest technicznie niemożliwe*.

**ALE:** archetype już jest w globalnym embedding space. SDK na nowej sesji szybko zbiera 10–15 sygnałów (page.view + initial scroll + first listing photo opens) → intent vector ekstrahowany w <30s mapuje do `british_part_year_resident_costa_del_sol` archetype z confidence 0.78.

→ Adaptation już działa po ~30 sekundach na drugiej witrynie, mimo że buyer "anonimowy" z perspektywy nowego tenanta. **To jest data network effect w akcji** — drugi tenant od dnia 1 dostaje benefit z archetypów wytrenowanych na danych innych tenantów.

**Krytyczne:** ten sam ludzki buyer **nie jest re-identifikowany** — Estalara nie wie że to ta sama osoba. System jedynie szybko klasyfikuje *typ* buyera. Privacy preserved, value delivered.

### Q.3. Scenariusz 3: Idealista (Tier 3 Native) — pierwszy tydzień

**Setup:** Idealista enterprise contract, $150k/mo. Custom integration: Idealista wstawia `<EstalaraListing/>` component dla 100k properties (gradual rollout, A/B 10% traffic).

**Day 1–7 metrics widoczne w dashboardzie (Krystian-led design):**

```
ESTALARA DASHBOARD — IDEALISTA — Week 1

Traffic
├─ Tracked sessions: 4.2M
├─ Adapted impressions: 12.8M (avg 3 per session)
├─ Holdout group impressions: 1.4M (10%)
└─ p95 latency: 73ms (SLA 100ms ✓)

Buyer Archetypes (Top 10 of 87 detected in your traffic)
├─ british_costa_del_sol_part_year_resident   18.2% (770k)
├─ spanish_first_home_madrid_couple           14.7%
├─ french_riviera_barcelona_investor          9.1%
├─ german_retirement_canarias                 7.8%
├─ ... (7 more)

Conversion Lift (vs holdout)
├─ Photo gallery engagement:        +34% ↑↑↑
├─ Time-on-listing:                  +28% ↑↑↑
├─ Inquiry-started rate:             +19% ↑↑
├─ Inquiry-completed rate:           +14% ↑↑
└─ Tour-requested rate:              +22% ↑↑

Top-performing adaptations
1. Photo re-rank (master/pool first):    +41% photo engagement
2. Headline rewrite (lifestyle framing): +18% inquiry start
3. Feature reorder (staff/parking):      +12% engagement

Anomalies (auto-detected)
└─ archetype_id "swedish_lakeside_seeking_med_climate" 
   shows -8% conv vs holdout — auto-paused, investigation queued

Top 3 listings ID-ied as "high intent magnets":
└─ Detail in CSV export
```

Idealista CMO dostaje **case study material w 7 dni**, Idealista product team widzi że są 87 archetypów w ich traffic (czego nie wiedzieli wewnętrznie), Estalara CSM book quarterly review.

---

## R. Innovation Roadmap & Patent Strategy

**Filozofia:** Estalara nie konkuruje executionem (Mutiny i Dynamic Yield mają większe zespoły i budżety). Konkurujemy **vertical depth + technical innovation**. Sześć obszarów gdzie budujemy unique IP — każdy z nich to potencjalny patent + technical moat. Sekcja koresponduje z O.3 (analiza konkurencji) i M.2 (acquisition channels — innowacje są też marketing material).

### R.1. Innovation #1 — Real-Time Confidence Calibration & Graceful Degradation

**Problem:** Konkurenci działają binarnie — albo personalizują, albo nie. Jeśli model jest niepewny, wciąż serwują jakąś wersję (czasem gorszą niż nieadaptowaną).

**Innowacja:** Multi-level adaptation based on calibrated confidence intervals. Adaptation engine zwraca trzy confidence scores (archetype, directive, expected_uplift) i degraduje gracefully:

| Confidence | Akcja |
|---|---|
| > 0.85 | Full adaptation (headline rewrite, photo reorder, feature highlight, CTA personalization) |
| 0.6–0.85 | Partial adaptation (np. tylko reorder photos, no headline rewrite) |
| 0.4–0.6 | "Soft cues" (subtle re-rank features bez DOM mutation) |
| < 0.4 | No adaptation, serve original |

**Patent angle:** "Calibrated multi-level adaptation system based on confidence intervals in real-time personalization."

**Tech stack:** Quantile regression for uplift estimation, isotonic calibration (`sklearn.calibration`), conformal prediction (Vovk et al. 2005), Platt scaling for confidence calibration.

**Sprint mapping:** Sprint 7 (Adaptation engine) baseline, Sprint 8 (A/B holdout) calibration tuning.

**Defensibility:** 12–18 miesięcy dla konkurenta żeby zreplikować bez literatury z conformal prediction expertise.

### R.2. Innovation #2 — Causal A/B Framework (Beyond Vanilla CTR)

**Problem:** Standard A/B testing mierzy CTR uplift ale **nie izoluje czy to przez personalizację czy szczęście**. Holdout group też może mieć wysoki CTR (bo to po prostu dobrzy buyerzy).

**Innowacja:** Counterfactual estimation z meta-learners + Heterogeneous Treatment Effects (HTE):

- **T-Learner / X-Learner:** estymują individual treatment effect dla każdej sesji (co by się stało gdyby ten konkretny buyer dostał holdout vs treatment)
- **HTE (causal forests):** które archetypy MAJĄ uplift, a które nie
- **Auto-pause** dla archetypów bez causal effect — oszczędność LLM cost (prawdopodobnie 20–30%)

**Patent angle:** "Real-time CATE (Conditional Average Treatment Effect) estimation in live personalization pipelines for vertical SaaS."

**Tech stack:** EconML (Microsoft), DoWhy, causal forests (Wager & Athey 2018). Bayesian uplift models (PyMC) dla long-tail.

**Sprint mapping:** Sprint 8 (A/B framework) — extended z sekcji E.3.1.

**Defensibility:** Causal inference w produkcji to >95% B2B SaaS nie ma. 24+ miesięcy dla konkurenta bez ML PhD na zespole.

### R.3. Innovation #3 — Cross-Tenant Federated Archetype Learning

**Problem:** Master Design v1.1 (sekcja F.1) wybiera centralized aggregation. Pragmatyczne dziś, ale FL na 2–3 lat staje się compliance requirement w EU dla high-volume processors (po pierwszym wielkim incydencie data leak w cross-tenant scenario).

**Innowacja:** Hybrid roadmap:

- **Year 1:** centralized + DP (jak w F.1)
- **Year 2:** opcjonalny FL mode dla enterprise klientów (Idealista, Otodom) którzy nie chcą wysyłać żadnych danych poza swoją infrastrukturę
- **Year 3+:** "Federated Archetype Protocol" jako otwarty standard branżowy → potential industry leadership

**Patent angle:** "Real-estate-specific federated learning protocol with domain-aware aggregation rules and differential privacy guarantees."

**Tech stack:** Flower framework (Y2), secure aggregation (Bonawitz 2017), DP-FedAvg, własny protokół optymalizujący bandwidth dla archetype updates (małe wektory, więc unikamy gradient compression overhead).

**Sprint mapping:** Y2 Q3–Q4 (long-term roadmap, nie MVP).

**Defensibility:** FL infrastructure to 18–24 miesiące dla zespołu bez ML expertise. My budujemy bazę w Y1.

### R.4. Innovation #4 — Self-Healing Schema Detection (Predictive)

**Problem:** Master Design B.6 ma drift detection + auto-fix, ale to **reactive** (czeka aż SDK zgłosi błąd). Problem: tenant traci dane przez kilka godzin przed detekcją.

**Innowacja:** Predictive drift detection (już zaimplementowane jako B.5.4) — Estalara wie że strona klienta SIĘ ZMIENI zanim cokolwiek przestanie działać:

- Co tydzień zaplanowany re-crawl + porównanie DOM signature embedding
- Anomaly detection na tenant-level traffic patterns (nagły spadek event volume = możliwy drift)
- "Schema fingerprint embedding" — wektorowa reprezentacja struktury strony, similarity tracking
- Auto-fix triggered ZANIM SDK reportuje failure (proactive re-detection)

**Patent angle:** "Predictive web schema drift detection using embedding-based similarity tracking for SaaS personalization integrations."

**Tech stack:** Sentence transformers nad DOM hashes (BGE-M3), isolation forest dla anomaly detection (sklearn), DOM diffing (jsdiff), embedding distance threshold tuning.

**Sprint mapping:** Sprint 6 baseline (B.5.4 + przedłużenie B.6), Sprint 9 production hardening.

**Defensibility:** Niche problem, ale realnie wartościowy dla każdego B2B SaaS z DOM integration. Patent niezależny od domain real estate.

### R.5. Innovation #5 — Adaptive Trust Score (Self-Supervised Accuracy)

**Problem:** Klasyczny ML wymaga ground truth labels. Estalara w Mode A nie ma labels (anonimowi buyerzy).

**Innowacja:** Self-supervised accuracy estimation through convergence signals (zaimplementowane w D.5):

- **Behavioral consistency:** czy archetype prediction jest **stable across signals**?
- **Adaptation confirmation:** czy adaptacja powoduje **expected behavior**?
- **Bayesian update confidence** po każdym evencie

To jest serce systemu osiągania 90%+. Każdy event jest input do prediction JAK I evaluation poprzedniej prediction. Patrz D.5 dla pełnego mechanizmu.

**Patent angle:** "Self-supervised intent classification accuracy estimation in anonymous user contexts via behavioral consistency metrics."

**Tech stack:** Bayesian neural networks (Pyro/NumPyro), online learning, behavioral consistency metrics, sequential hypothesis testing (Wald 1945 SPRT).

**Sprint mapping:** Sprint 5 baseline, Sprint 7 production hardening (z D.5.6).

**Defensibility:** Wymaga rozumienia self-supervised learning + statystyki sekwencyjnej. 12–18 miesięcy dla konkurenta.

### R.6. Innovation #6 — Adaptive Directives Schema (Domain-Specific Language)

**Problem:** Master Design (E.1) opisuje adaptation directives jako "JSON" ale nie precyzuje strukturę. Każda implementacja ad-hoc.

**Innowacja:** **EAdL — Estalara Adaptation Language**:

- Deklaratywny DSL do opisywania jak modyfikować stronę real estate
- Versioned schema, backwards compatible
- Compiler kompiluje DSL do konkretnych DOM mutations + LLM prompts
- Tenants mogą pisać własne directives (Tier 3 power users)
- Cross-platform — działa na WordPress, Idealista, custom React

**Przykładowa składnia EAdL:**

```yaml
# Tenant-defined adaptation rule
when:
  archetype: british_part_year_resident_costa_del_sol
  confidence: > 0.7
do:
  - reorder_features:
      priority: [staff_quarters, pool, beach_proximity]
  - rewrite_headline:
      style: lifestyle_framing
      max_length: 80
  - add_section:
      type: tax_implications
      content_template: "uk_resident_spain_property"
unless:
  - listing.price > 5000000  # don't auto-adapt premium
  - tenant.disabled_directives.contains(rewrite_headline)
```

**Patent angle:** "Domain-specific declarative language for real-estate listing personalization with cross-platform compilation."

**Tech stack:** Tree-sitter parser, JSON Schema for validation, własny IR (intermediate representation), compiler do DOM mutations + LLM prompts.

**Sprint mapping:** Sprint 7 baseline (basic JSON), Y2 H1 full DSL z editor UI, Y2 H2 community marketplace dla EAdL recipes.

**Defensibility:** DSL adoption tworzy lock-in (tenants inwestują w pisanie reguł). Plus open-source release może stać się standardem branżowym (analogia: GraphQL od Facebooka).

### R.7. Patent filing strategy

**Q4 2026 (post-MVP):**
- **Filing #1:** Innovation R.5 (Adaptive Trust Score) — najszybszy do wykazania prior work + clear technical novelty
- **Filing #2:** Innovation R.4 (Predictive Schema Detection) — niche ale clear

**Q2 2027 (post-pilot validation):**
- **Filing #3:** Innovation R.1 (Confidence Calibration) — wymaga production data dla claims
- **Filing #4:** Innovation R.2 (Causal A/B) — wymaga statystycznej walidacji uplift methodology

**Q4 2027:**
- **Filing #5:** Innovation R.6 (EAdL) — po release jako open-source (defensive patent)
- **Filing #6 (optional):** Innovation R.3 (Federated protocol) — jeśli nie zdecydujemy się open-source'ować

**Jurysdykcje:** US (PCT priority), EU (EPC), UK, Polska. Skip UAE (różny system, niska wartość commercial dla patentowanego ML w tym rynku).

**Budget:** ~$15–25k per patent (USPTO + EPO + EU validation + counsel). Total program: ~$120–150k przez 24 miesiące. Część może być pokryta z Series A.

### R.8. Innovation governance

- **Quarterly innovation review** (Piotr + Rafał + Krystian, 90 min) — review progress, prioritize next quarter
- **Patent committee** (external patent attorney + Rafał) — reviews technical novelty before filing
- **Innovation showcase** — semi-annual blog posts / conference talks (Inman, ProptechOS) — buduje reputation
- **Open-source strategy** — niektóre innowacje (R.4, R.6) mogą być open-sourced post-patent dla industry leadership
- **Internal Ops dogfooding** — K.3.4 Global ML Health surface'uje innovation impact metrics (DQS po wprowadzeniu R.1, koszt LLM po R.2 auto-pause, etc.)

---

## S. Podsumowanie strategiczne i następne kroki

Estalara Adaptive Listings jest projektowany jako **vertically-specialized, embeddable-first, multi-region SaaS**, który wykorzystuje **cztery** strategiczne dźwignie:

1. **Vertical depth** — real-estate-specific intent ontology (12 wymiarów, 50–500 archetypów) jest niemożliwa do skopiowania przez generic personalization (Mutiny, Dynamic Yield) bez 18+ miesięcy work.
2. **Embeddable-first DX** — SDK <40KB, 3 tiery integracji, zero-touch start (jeden script tag) to przewaga vs stand-alone competitors.
3. **Compliant-by-design data network effect** — DP-protected archetype space daje wartość każdemu nowemu klientowi od dnia 1, bez naruszania tenant isolation, GDPR czy ePrivacy.
4. **🆕 Zero-config onboarding** — Magic Link + AI Vision + 50+ platform templates + WordPress Plugin sprawiają że time-to-value to <5 min vs tygodnie u konkurencji. To dramatyczny win dla self-serve Tier 1/2 acquisition i obniża CAC.

**Następne kroki — gotowość do kodowania:**

✅ Architektura zatwierdzona: Cloudflare Workers + Next.js (Vercel) + Supabase + ClickHouse Cloud + Modal + Anthropic Claude (Haiku 4.5/Sonnet 4.6) + OpenAI embeddings + pgvector
✅ Repo struktura: monorepo Turborepo z `packages/sdk`, `packages/sdk-react`, `apps/ingest` (Cloudflare Worker), `apps/control-plane` (Next.js), `apps/intent-engine` (Modal Python), **`apps/auto-detect`** (Modal Python + Puppeteer), **`packages/wp-plugin`** (WordPress PHP), `infra/` (Terraform)
✅ Schema baz danych: Postgres (tenants, configs, billing, listings_metadata, **schema_mappings**, **detection_history**) z RLS + ClickHouse (events, sessions, **schema_drift_events**) + pgvector (per-tenant embeddings + global archetype space)
✅ Schema eventów: 30+ event types w wspólnym envelope, JSON Schema versioned
✅ DPIA + MSA + ToS + Privacy Policy template — legal sprint M1
✅ MVP backlog: Linear/Jira projekt z **~180 ticketami** (wzrost z 150 po dodaniu auto-onboarding scope) pokrywającymi 12-tygodniowy plan

**Rekomendowany sygnał dla zespołu:** rozpocznij sprint zerowy w poniedziałek — Rafał stawia monorepo + ingest worker + auto-detect service skeleton, Krystian finalizuje intent ontology v1 + 50 seed archetypów + reviewuje top 15 platform templates (jego PhD work value), Piotr zapisuje 3 design partner conversations + valida onboarding flow z nimi, Estalara wchodzi w execution mode.

---

*Dokument przygotowany na bazie analizy 35+ źródeł zewnętrznych (Anthropic, OpenAI, Cloudflare, EDPB, ICO, CNIL, UAE Data Office, Mutiny, Optimizely, Dynamic Yield, Segment, Drift/Intercom, ClickHouse, Supabase, Vercel, Cloudflare, Modal, RunPod, pgvector benchmarks, Pinecone, Cohere, BGE) — wszystkie konkretne stwierdzenia są oparte na cytowanych linkach. Stan prawny i pricingowy aktualny na 25 kwietnia 2026.*

*Wersja 1.1 (26 kwietnia 2026): rozszerzono o sekcje B.4–B.7 dotyczące auto-onboardingu i self-healing schema validation — odpowiedź na pytanie "jak zminimalizować friction onboarding klienta do <5 min".*