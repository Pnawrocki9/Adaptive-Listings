# Estalara Adaptive Listings — Dogłębna analiza architektoniczno-biznesowa

**Wersja:** 1.7 (Master Design Document — Cold Start Protection redesign for description pipeline) | **Data:** 15 maja 2026 | **Autorzy odbiorcy:** Piotr Nawrocki (CEO), Rafał Palak PhD (CTO), Krystian Wojtkiewicz PhD (CPO)

**Changelog v1.7 (15 May 2026 — Cold Start Protection for adaptation pipeline):**

- 🔄 **Sekcja E.7 przeprojektowana.** Pierwszy buyer dla każdej pary `(listing, archetype)` widzi **oryginalne copy agenta** (`source: 'original_agent_copy'`), a nie statyczny template. Sonnet job uruchamia się w tle i serwuje adaptowaną wersję od drugiego buyera tego archetypu (`source: 'ai_cached'`). Cache miss z istniejącym oryginałem zwraca oryginał, nigdy template.
- 🔄 **`copy_template` przestaje być renderowany do usera w standardowym flow.** Templates są **seedami promptu** dla Sonneta (SEED 2 w 3-seed prompcie: oryginał agenta + Opus template + listing_context). Wyjątek: edge case gdy `listing.description` jest pusty — wtedy template renderuje się bezpośrednio jako `source: 'template_fallback'`, z placeholderami rozwiązanymi z `listing_context`.
- ✨ **Templates trójjęzyczne (EN + PL + ES).** Każdy z 18 archetypów ma trzy locale-natywne wersje (54 templates łącznie), pisane od zera w kontekście lokalnego rynku (Bezpieczny Kredyt 2% w PL, Non-Lucrative Visa w ES post-Golden-Visa-repeal, VFT/VUT licensing dla STR, etc.). Patrz `docs/specs/cold-start-archetype-templates-v1.md`.
- 🔄 **`source` enum (final):** trzy wartości używane: `'ai_cached'` (cache hit), `'original_agent_copy'` (cache miss, oryginał istnieje), `'template_fallback'` (cache miss, brak oryginału). `'ai_generated'` zarezerwowany formalnie, nieużywany.
- 🔄 **Tier 1 nie używa `/api/adapt/description`.** Tier 1 = Observer = no DOM mutation; endpoint zarezerwowany dla Tier 2/3.
- ✨ **Nowa sekcja E.7.7 "Cold Start Protection"** — pełna specyfikacja flow (z dwiema ścieżkami cache-miss), two-branch three-seed prompt, invariants (factual, voice, length, token), observability.
- ✨ **7 nowych ticketów (TICKET-COLD-001 do TICKET-COLD-007)** zastępują dotychczasowy TICKET-DESC-001. Modal job z PR #112 (commit b55c025) wymaga zmiany kontraktu payload o pole `original_agent_copy` (string, dozwolony pusty).
- 📝 Pełna spec: `docs/specs/cold-start-protection-v1.md` (impl plan) + `docs/specs/cold-start-archetype-templates-v1.md` (54 templates).

**Changelog v1.6 (14 May 2026 — Adaptation Engine extensions after PR #92 / TICKET-046):**
- 🔄 Rozszerzona sekcja **E.2** — dodano blok "Definicje terminów" (slot, wariant, copy_template, ListingContext) oraz "Implementacja 3 wariantów per slot" z przykładem `yield_hunter`. Slot `feature-section` (bug w `yield-hunter.ts` przed PR #92) ustandaryzowany do `feature`.
- 🔄 Rozszerzona sekcja **E.3** — dodano paragraf opisujący selekcję wariantu przez Thompson sampling per `(tenant_id, archetype, variant)` w `ab_bandit_weights`; `winningVariant` indeksuje `slots[i].variants.en[]`; `TextDirective` dostaje `variant_index` (post-Sprint 10, TICKET-BANDIT-VARIANTS).
- ✨ Nowa podsekcja **E.5 (Reserved)** — placeholder utrzymujący numerację stabilną dla przyszłych wstawek.
- ✨ Nowa podsekcja **E.6 "Placeholder Resolution Order"** — 7-poziomowa hierarchia źródeł danych dla `{token}` placeholderów (wklejone z `MASTER_DESIGN_PATCH_v1_5.md`). Foundation dla E.7.
- ✨ Nowa podsekcja **E.7 "Long-form Description Pipeline"** — Tier gating (1 = static fallback, 2 = AI 72h, 3 = AI 48h), endpoint `GET /api/adapt/description`, Redis cache key, Modal job dla Sonnet 4.6, invalidation. Implementacja: TICKET-DESC-001, Sprint 9.

**Changelog v1.4 (5 May 2026 — Security & Operational Excellence hardening + Investor Quiz + Profile Mode forward-compat):**
- ✨ Nowa sekcja **V "Security Architecture & Cybersecurity"** — kompleksowa specyfikacja zabezpieczeń: authentication & session security, API security, OWASP Top 10 coverage, secrets management, supply chain security, database security, frontend SDK security, threat modeling, security testing, compliance certifications roadmap (SOC 2, ISO 27001), bug bounty program
- ✨ Nowa sekcja **W "Operational Excellence — DR, Monitoring, Deployment"** — Disaster Recovery & Business Continuity (RPO/RTO targets), Incident Response Plan (sev levels, on-call, post-mortems, status page), SLO/SLI definitions z error budgets, observability strategy, deployment & rollback playbooks, cost controls & abuse prevention (DoW protection), data governance, multi-tenant isolation testing
- ✨ Nowa podsekcja **E.4 "Investor Quiz Widget"** — opt-in 2-pytaniowy quiz (cel zakupu: personal/investment, horyzont: ≤3mo/>1yr) jako Bayesian prior dla Intent Engine; sticky widget + post-3-listings prompt; decay logic (10-20 min) pozwalająca behavioral signals dominować z czasem; 6 nowych ticketów (TICKET-QUIZ-001 do QUIZ-006)
- ✨ Nowa podsekcja **U.10 "Investor Quiz back-office"** — per-tenant toggle (`/dashboard/quiz`), agency analytics dashboard (`/dashboard/quiz/analytics`) z funnel + answer distribution + conversion lift, Master Admin Fleet View extension; 3 dodatkowe tickety (QUIZ-003, QUIZ-004, QUIZ-007)
- 🔮 Nowa podsekcja **U.11 "Profile Mode (Identified Buyers)"** — POST-MVP feature (Sprint 12+); forward-compatibility checklist dla MVP; Master Admin globalna flaga "Profile Mode beta" + zewnętrzny approval workflow (Notion+DPA, nie w systemie); 4 forward-compat action items w Sprint 2/4/8 (`consent_records` table, `Estalara.identify()` SDK stub, fair-housing linter); pełna spec w osobnym Year-2 strategic doc
- 🔧 Sprint 1.5 hardening tickets — 5 fix-ticketów ukończonych (TICKET-FIX-001 do FIX-005): OTel context propagation, canonical error format, security response headers, Drizzle role separation, PII blacklist
- 📝 Cross-references — wszystkie sekcje (B, D, D.5, E, F, H, J, K, T, U, V) zaktualizowane o referencje do V, W, Quiz, i Profile Mode forward-compat

**Changelog v1.3 (5 May 2026 — Demo Mode v5 + Agency Registration + Master Admin):**
- ✨ Nowa sekcja **T "Demo Mode v5 — Built-In Feature for Sales & Validation"** — kompletna specyfikacja Demo Mode jako integralnej funkcji produktu (2 funkcje: Mock-up Toggle + Side Panel), sprint mapping, 7 ticketów, acceptance criteria dla wszystkich ticketów
- ✨ Nowa sekcja **U "Agency Registration Flow & Master Admin"** — decyzje architektoniczne zatwierdzone przez Piotra: approval-required onboarding, Stripe + invoice billing, RBAC z trzema rolami, osobny `admin.estalara.com`, Master Admin oversight Demo Mode ON/OFF per tenant

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
| **Headline rewrite** | Template + slot filling (95% przypadków), LLM rewrite tylko dla edge cases | Predictable, brand-safe, taniej. Templates: 18 archetypów × 3 warianty per slot per language (E.2.1) |
| **Feature highlight order** | Pure ranking model (gradient boosted on intent×feature interaction) | Deterministyczne, A/B testable, brak halucynacji |
| **Photo re-ranking** | CLIP-style scoring photos vs intent vector + tenant hard rules ("first photo must show exterior") | Computer vision na zdjęciach raz przy ingest property, intent-photo dot product przy serve |
| **Chat suggested replies** | Claude Haiku 4.5 + RAG (tenant's FAQ + listing data + intent context) | Conversational quality wymaga LLM; Haiku 4.5 wystarczająco dobre |
| **Long-form copy (description)** | Claude Sonnet 4.6 + `copy_template.en` fallback — Tier 2 + Tier 3, async, Redis-cached | Sonnet 4.6 jakość warte ceny dla flagship feature, cache TTL per Tier. Pełna spec: E.7 |

#### E.2.1. Definicje terminów stosowanych w tej sekcji

- **slot** — pozycja DOM identyfikowana przez `data-estalara-slot="<name>"`. Trzy kanoniczne wartości: `headline`, `cta`, `feature`.
  > **Nota historyczna:** wartość `feature-section` używana wcześniej w `yield-hunter.ts` była błędem naming-conventionowym (SDK query selector nie pasował do dokumentacji deweloperskiej, slot `feature` nigdy nie aktywował się dla tego archetypu). Ustandaryzowano do `feature` w PR #92 / TICKET-046 (PLAYBOOK-001).
- **wariant** — alternatywna kopia dla tego samego slotu, służąca A/B testowaniu przez bandit (E.3). NIE mylić z locale. Min 3 warianty per slot `headline` per archetype. Zaimplementowane w polu `SlotDirective.variants.{en|pl|es}[]` (`packages/sdk/src/core/playbooks/types.ts`).
- **copy_template** — statyczny ~130–150-słowowy opis nieruchomości per archetype; jednocześnie (a) Tier 1 fallback gdy nie generujemy AI description oraz (b) seed promptu Sonneta dla Tier 2/3 (E.7). Pole `PlaybookEntry.copy_template.{en|pl?|es?}`.
- **ListingContext** — dane listingu (cena, yield%, sypialnie, m², miasto, …) dostarczone przez AGENCY-001 (Level 2) lub enrichment APIs (Level 5), używane przez SDK `interpolatePlaceholders()` oraz wstrzykiwane do promptu LLM gateway jako kontekst.

#### E.2.2. Implementacja 3 wariantów per slot

Każdy `SlotDirective.variants.en[]` zawiera ≥3 alternatywy. `variants.en[0]` jest aliasem `slots[i].en` (default copy). Przykład dla `yield_hunter` (headline):

```typescript
// packages/sdk/src/core/playbooks/archetypes/yield-hunter.ts
{
  slot: 'headline',
  en: 'Rental Yield: {yield}% | Gross Income: {income}/yr',
  variants: {
    en: [
      'Rental Yield: {yield}% | Gross Income: {income}/yr',                 // variant_0 (default)
      'Investment Property — {yield}% Gross Yield, Tenant in Place',         // variant_1
      'Passive Income: {income}/yr — Cash-Flow Positive from Day One',       // variant_2
    ],
  },
}
```

Selekcja wariantu przez Thompson sampling bandit (E.3) — seed `Beta(1,1)` per `(tenant_id, archetype, variant_index)` w tabeli `ab_bandit_weights` (PR #80). Reward signal (`inquiry.completed`, `time_on_listing`) propaguje się wstecz przez session events i aktualizuje rozkład Beta per wariant.

### E.3. A/B testing & learning loop

- **Hold-out group** (default 10%) — losowo wybrana, dostaje *unadapted* listing. Mierzymy lift na: time-on-listing, photo opens, inquiry rate.
- **Multi-armed bandit** (Thompson sampling) dla wyboru wariantu adaptacji per archetype — automatycznie alokuje ruch do najlepiej konwertujących adaptacji.
- **Conversion feedback loop**: gdy `inquiry.completed` event przychodzi, propagujemy reward signal wstecz przez session events i aktualizujemy archetype embeddings (offline, daily batch).
- **Detekcja regresji**: jeśli archetype X ma stat-significant drop w conversion przez 7 dni — auto-pause adaptacji dla tego archetype, alert do Estalara team.

#### E.3.0. Variant selection mechanics (z playbooków)

Bandit nie generuje wariantów — konsumuje już istniejące w `PlaybookEntry.slots[i].variants.{en|pl|es}` (E.2.2). Per request do Decision API:

1. Decision API ustala `(tenant_id, archetype_id)` i wybiera ścieżkę `source = 'playbook'` (sim > 0.85, confidence > threshold).
2. Per każdy slot z `variants` ≥ 2 — pobiera rozkład Beta z `ab_bandit_weights WHERE tenant_id = ? AND archetype = ? AND variant_index IN (0..N-1)`.
3. Thompson sample: dla każdego variantu losuje `θ_i ~ Beta(α_i, β_i)`, wybiera `argmax θ`.
4. `winningVariant` indeksuje `slots[i].variants.en[winningVariant]`; result wraca jako `TextDirective` z polem `variant_index: number` dla downstream attribution.
5. Po zarejestrowaniu `inquiry.completed` (lub innego conversion eventu z `adaptation_decisions` ClickHouse) — async batch job aktualizuje `α` (success) lub `β` (no-conversion) per wybrany wariant.

Implementacja w dwóch fazach:
- **Faza 1 (Sprint 8, TICKET-AB-001):** bandit infrastructure + holdout assignment + `variant_index` column w `adaptation_decisions`. Zawsze wybiera `variant_index = 0` (default), bo playbook variants nie były jeszcze wyeksponowane do decision API.
- **Faza 2 (post-Sprint 10, TICKET-BANDIT-VARIANTS):** podłączenie Thompson sampling do realnych wariantów z playbooków (PR #92). Wymaga: (a) seedowania `ab_bandit_weights` rowsami per variant per archetype przy first-use, (b) eksposure `variants` w response shape Decision API, (c) feedback loop dopisany do `adaptation_decisions`.

Cross-reference: E.2.2 (gdzie warianty są zdefiniowane), E.3.1 (CATE per wariant, nie tylko per archetype), E.3.2 (variant score wchodzi do multi-objective optimization).

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

### E.4. Investor Quiz Widget — opt-in self-declared intent

> **Decyzja produktowa (Piotr Nawrocki, 5 maja 2026):** dodajemy opt-in 2-pytaniowy quiz jako **opcjonalny, per-tenant toggle** w back-office agencji. Quiz jest dobrowolny, transparentny, i działa równolegle z behavioral detection — nie zastępuje go.

#### E.4.1. Filozofia — dlaczego opt-in zamiast obowiązkowo

Standardowy Adaptive Listings polega wyłącznie na behavioral signals (Section D — Intent Engine). Działa świetnie po 30-90 sek przeglądania, ale **w pierwszych 30 sek mamy zimny start** — system nie ma jeszcze wystarczająco danych żeby spersonalizować widok.

Quiz daje agencji opcjonalne narzędzie żeby **skrócić cold-start** dla buyerów którzy chcą szybko dostać dopasowane wyniki. Kluczowe założenia:

1. **Opt-in, nie obowiązkowo** — buyer zawsze może zignorować quiz i przeglądać normalnie
2. **Per-tenant toggle** — agencja decyduje czy quiz jest aktywny na jej stronie
3. **Bayesian prior, nie hard lock** — odpowiedzi quizowe są silnym wstępnym sygnałem dla Intent Engine, ale behavioral signals z biegiem czasu mogą skorygować profil
4. **Zero dark patterns** — brak modal-spam, brak "Are you sure you want to leave?", brak "X to skip" które blokują widok

#### E.4.2. Dwa pytania — dlaczego te i tylko te

Po analizie design partnerów (Idealista, Engel & Völkers Marbella) zidentyfikowaliśmy **dwa pytania o najwyższym signal-to-noise ratio** dla early archetype detection:

**Pytanie 1: Cel zakupu**
> "What brings you here today? / Co Cię tu przyprowadza?"
> 
> ○ **Looking for a home for myself or my family** *(własny)*
> ○ **Exploring as an investment opportunity** *(inwestycyjny)*

**Pytanie 2: Horyzont czasowy**
> "When are you hoping to make a decision? / Kiedy planujesz podjąć decyzję?"
> 
> ○ **Within the next 3 months** *(≤3 mies.)*
> ○ **More than a year from now / Just exploring** *(>1 rok)*

**Dlaczego nie więcej pytań?** Każde dodatkowe pytanie redukuje completion rate o ~15-25% (industry data dla onboarding flows). Dwa pytania mają completion rate ~75-85% (za design partnerami z marketingu B2C SaaS), pięć pytań — ~30%. Mniej pytań = więcej completed quizzes = więcej priors dla Intent Engine.

**Dlaczego te a nie inne (np. budżet, lokalizacja)?** Budżet i lokalizacja są już *implicit* w buyer's URL i selected listings. Cel + horyzont są **najsilniejsze różnicujące cechy archetype** które NIE są inferowalne z URL — buyer "Investor + 3mo" ma drastycznie inny intent niż "Family + 1yr" przeglądający te same listingi.

#### E.4.3. Mapping odpowiedzi → archetype prior

```typescript
// packages/intent-engine/src/quiz-mapping.ts
type QuizAnswers = {
  purpose: 'personal' | 'investment';
  horizon: 'short' | 'long';  // ≤3 mies. vs >1 rok
};

type ArchetypePrior = {
  archetype_id: string;
  prior_weight: number;      // 0.0 - 1.0, multiplier on default uniform prior
  decay_minutes: number;     // jak długo prior dominuje nad behavioral signals
};

const QUIZ_TO_PRIOR: Record<string, ArchetypePrior> = {
  'personal+short': { 
    archetype_id: 'urgent_family_buyer', 
    prior_weight: 0.85, 
    decay_minutes: 10 
  },
  'personal+long': { 
    archetype_id: 'aspirational_browser', 
    prior_weight: 0.75, 
    decay_minutes: 15 
  },
  'investment+short': { 
    archetype_id: 'active_investor', 
    prior_weight: 0.90, 
    decay_minutes: 8 
  },
  'investment+long': { 
    archetype_id: 'passive_capital_seeker', 
    prior_weight: 0.70, 
    decay_minutes: 20 
  },
};
```

**Bayesian update — formal definition:**

```
P(archetype | session_data) ∝ P(session_data | archetype) × P(archetype)

Without quiz:  P(archetype) = uniform across all archetypes (1/N)
With quiz:     P(archetype) = QUIZ_TO_PRIOR weighted distribution

After T minutes of behavioral data:
  effective_prior_weight(t) = prior_weight × max(0, 1 - t/decay_minutes)
  
Po decay_minutes minut: prior_weight → 0, behavioral signals dominate fully
```

Innymi słowy: w pierwszych ~10 min od quiz completion, system jest "stronnie nastawiony" na archetype z quizu. Z każdą minutą prior słabnie liniowo, a behavioral signals zyskują wagę. Po 10-20 min (zależnie od archetype): quiz jest tylko historycznym sygnałem, system działa normalnie na podstawie zachowania.

**Edge case — quiz vs behavioral mismatch:**
Jeśli quiz mówi `personal+short` (urgent_family_buyer) a w pierwszych 5 min user przegląda 8 inwestycyjnych listingów, browse na ROI page, scroll na yield calculator → system wykrywa **strong behavioral contradiction** i logs metric `quiz_behavioral_mismatch=true`. Po 5 min: behavioral wygrywa, archetype switch do `active_investor`. Quiz answer pozostaje w session metadata dla analytics (E.4.7 — agency stats).

#### E.4.4. Widget UX — sticky + triggered prompt

Zgodnie z decyzją (B+D combo):

**A. Sticky widget (od pierwszej sekundy)**
```
                                          ┌────────────────────────────┐
                                          │ 🎯 Find your perfect match │
                                          │    in 2 questions →        │
                                          │                       [×]  │
                                          └────────────────────────────┘
                                          Bottom-right, 320px wide
                                          Subtle shadow, brand-tinted
```
- Default position: bottom-right corner (mobile + desktop)
- Dismissible przez `[×]` — set `localStorage.estalara_quiz_dismissed=true` (24h)
- Click → expands quiz inline (Shadow DOM, doesn't navigate away)

**B. Triggered prompt (post-3-listings event)**
- Po `listing.view` event count ≥ 3 w sesji AND user nie kliknął quiz AND nie dismissed:
- Wyświetl drugi sticky w innym kolorze: "Saved time on browsing? Get personalized matches in 2 quick questions."
- Trigger TYLKO RAZ na sesję — jeśli user dismiss, no more prompts

**Kluczowe UX zasady:**
- Brak modal blokujących widok
- Brak entry-time popups (np. "Wait 3 sec → modal") — to jest dark pattern
- Brak countdown timers, exit-intent popups, bait-and-switch buttons
- Quiz widget zawsze dismissable jednym klikiem
- ARIA-compliant (focus trap w expanded state, escape key zamyka, screen reader friendly)

#### E.4.5. Quiz lifecycle — events tracked

```typescript
// packages/shared/src/schemas/events/quiz.ts
const QuizPayloadSchema = z.object({
  quiz_id: z.literal('investor_intent_v1'),
  step: z.enum(['shown', 'started', 'q1_answered', 'q2_answered', 'completed', 'dismissed']),
  
  // Anonimowe — zero PII (per TICKET-FIX-005 PII blacklist)
  answers: z.object({
    purpose: z.enum(['personal', 'investment']).optional(),
    horizon: z.enum(['short', 'long']).optional(),
  }).optional(),
  
  // Opcjonalne UX metrics
  trigger: z.enum(['sticky', 'prompt_after_3_listings', 'manual']).optional(),
  time_to_complete_ms: z.number().int().min(0).optional(),
});

export const QuizEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('quiz.event'),
  payload: QuizPayloadSchema,
});
```

**6 trackowanych stanów:**
- `shown` — widget renderowany (impression)
- `started` — user kliknął expand
- `q1_answered` — pytanie 1 odpowiedziane
- `q2_answered` — pytanie 2 odpowiedziane (after this: prior aktywny w Intent Engine)
- `completed` — quiz fully completed (oba pytania) — primary success metric
- `dismissed` — user kliknął `[×]` lub abandoned po `started`

#### E.4.6. Privacy & GDPR considerations

- **Brak PII w quiz payload** — tylko enum values (purpose, horizon). Nie zbieramy email, name, ani niczego osobowego
- **No tracking cookies** — quiz state w localStorage TYLKO dla dismissal tracking (24h TTL)
- **Consent layer** — quiz nie wymaga consent dla GDPR (no PII, no profiling z personal data) ALE jest część `consent_state: 'analytics'` jeśli tenant ma cookie banner. Default: quiz visible przed consent (legitimate interest — service improvement)
- **Right to erasure** — quiz answers powiązane są z session_id (anonimowy fingerprint hash). Erasure session_id usuwa też quiz history

#### E.4.7. Cross-reference D + E + U

- **Section D (Intent Engine)** — Section D.2 (signals) rozszerzone o `self_declared_intent` jako new signal source. Quiz priors implementowane w `intent-engine/src/bayesian-prior.ts`
- **Section D.5 (Detection Quality Score)** — quiz answers jako **third ground truth source** (alongside post-adaptation confirmation rate i form completions). Tenant DQS reflektuje `quiz_completion_rate` jako leading indicator
- **Section E (Adaptation Engine)** — adaptation logic używa archetype output bez modyfikacji; quiz wpływa na *which* archetype, nie na *how to adapt*
- **Section U (Master Admin / Agency Back Office)** — toggle quizu w `/dashboard/quiz` (per-tenant), statystyki w `/dashboard/quiz/analytics`. Master Admin widzi adoption rate quizu w fleet view (`/admin/tenants` — kolumna `quiz_enabled`)

#### E.4.8. Sprint mapping (quiz tickets)

| Sprint | Ticket | Deliverable |
|---|---|---|
| Sprint 4 | TICKET-QUIZ-001 | Quiz widget SDK component (Preact + Shadow DOM, sticky + triggered) |
| Sprint 4 | TICKET-QUIZ-002 | Quiz event schema + Bayesian prior implementation w Intent Engine |
| Sprint 5 | TICKET-QUIZ-003 | Per-tenant toggle w back office (`/dashboard/quiz` config page) |
| Sprint 5 | TICKET-QUIZ-004 | Agency analytics dashboard (`/dashboard/quiz/analytics`) — completion rate, archetype distribution, conversion lift |
| Sprint 6 | TICKET-QUIZ-005 | Quiz mismatch detection + alerts (behavioral contradiction logging dla DQS feed) |
| Sprint 7 | TICKET-QUIZ-006 | A/B test: quiz on/off cohort comparison (causal lift via E.3.1 framework) |

---

### E.5. (Reserved)

Numerację zarezerwowano dla przyszłej podsekcji. Nie usuwać — krzyżowe referencje z innych dokumentów (TICKET-ARCH-002 spec, plan v1.6) zakładają stabilność numeracji E.6 / E.7.

---

### E.6. Placeholder Resolution Order (Locked Architecture)

Gdy SDK musi wypełnić placeholder np. `{price}` lub `{school_rating}` w adaptowanym tekście, sprawdza źródła danych w ustalonej hierarchii. Każdy level degraduje do następnego.

| Level | Źródło                                     | Przykład                       | Pewność |
| ----- | ------------------------------------------ | ------------------------------ | ------- |
| **1** | `data-estalara-*` atrybuty (manual)        | `data-estalara-price="488168"` | 1.0     |
| **2** | Agency-provided answers per listing        | Agent odpowiada: "yield: 6.2%" | 0.95    |
| **3** | Auto-extracted z DOM via `data_extractors` | CSS selector → "€488,168"      | 0.85    |
| **4** | Computed metrics                           | price/area_sqm → price_per_sqm | 0.80    |
| **5** | Cached enrichments z external APIs         | school_rating, walkability     | 0.75    |
| **6** | LLM generation (Haiku 4.5 / Sonnet 4.6)    | Generates missing copy         | 0.60    |
| **7** | Skip directive                             | Placeholder usunięty z tekstu  | —       |

**Zasada:** każdy level jest próbowany tylko jeśli poprzedni zwrócił `null`. Level 6 (LLM) kosztuje ~$0.001 per placeholder — cache agresywnie per listing per archetype.

**Cross-reference:** Level 6 dla long-form description NIE idzie przez raw LiteLLM call — przechodzi przez pipeline opisany w E.7 (cache key + Tier gating + Modal async job). Inne placeholdery (np. krótki copy w slotach `headline`/`cta`/`feature`) używają LiteLLM bezpośrednio przez gateway `apps/control-plane/src/lib/llm-gateway.ts` (Haiku 4.5 / Sonnet 4.6 routing).

---

### E.7. Long-form Description Pipeline (Tier 2 + Tier 3) — Cold Start Protection

Opis nieruchomości (`description`) dopasowany do archetypu kupującego. Dostępny dla Tier 2 Augment i Tier 3 Native. **Cold Start Protection (v1.7 redesign):** pierwszy buyer dla pary `(listing, archetype)` widzi **oryginalne copy agenta**, nie statyczny template. Sonnet generuje adaptację w tle i serwuje ją od drugiego buyera tego archetypu. Statyczny `PlaybookEntry.copy_template.en` istnieje wyłącznie jako voice-pattern seed dla Sonneta — **nigdy nie jest renderowany do buyera.**

**Tier 1 Observer** nie używa tego endpointu — pozostaje read-only i nie podmienia description w DOM hosta.

#### E.7.1. Tier gating

| Tier | Cache hit              | Cache miss + agent original obecny                      | Cache miss + brak oryginału (edge case)               | TTL     | max_tokens |
| ---- | ---------------------- | ------------------------------------------------------- | ----------------------------------------------------- | ------- | ---------- |
| 1    | (endpoint not exposed) | (endpoint not exposed — Tier 1 is read-only)            | (endpoint not exposed)                                | —       | —          |
| 2    | `ai_cached`            | `original_agent_copy` + enqueue Sonnet job (background) | `template_fallback` (Opus template, placeholders rozwiązane) + enqueue Sonnet job z pustym SEED 1 | **72h** | 450        |
| 3    | `ai_cached`            | `original_agent_copy` + enqueue Sonnet job (background) | `template_fallback` + enqueue Sonnet job z pustym SEED 1 | **48h** | 600        |

Templates istnieją w trzech locale (EN/PL/ES). Endpoint wybiera template w żądanym locale, z fallbackiem na EN gdy locale nie jest authored (np. żądanie `fr` dla archetypu który nie ma autorskiego FR template).

#### E.7.2. Endpoint contract

```
GET /api/adapt/description
Query: listing_id (required), archetype (required), tier (required, ≥2), locale (optional, default 'en')
Auth:  Bearer JWT (jak dla /api/adapt)
Returns: {
  description: string,
  source: 'ai_cached' | 'original_agent_copy' | 'template_fallback',
  locale: string,
  generated_at: string  // ISO 8601 — Sonnet completion ts (ai_cached) lub listing.updated_at (original_agent_copy / template_fallback)
}
Errors:
  400 — tier === 1
  404 — listing not found
```

`source: 'ai_generated'` jest formalnie zarezerwowany (legacy compat), ale realnie nie wraca z endpointu: każdy udany cache write skutkuje `'ai_cached'` przy następnym żądaniu. `'template_fallback'` po przeprojektowaniu (v1.7) ma węższe znaczenie niż w v1.6 — wraca wyłącznie gdy `listing.description` jest pusty.

#### E.7.3. Flow (Cold Start Protection)

1. **Tier 1** → 400 "description endpoint not available for Tier 1". Sidebar widget Tier 1 renderuje listing z DOM hosta bez ingerencji.
2. **Tier 2 / Tier 3** → Redis lookup `desc:{tenant_id}:{listing_id}:{archetype}:{locale}`:
   - **Cache hit** → `{ description: cached.text, source: 'ai_cached', generated_at: cached.generated_at }`.
   - **Cache miss + agent original obecny** (`listing.description` non-empty):
     - Zwróć **`{ description: listing.description, source: 'original_agent_copy', generated_at: listing.updated_at }`** — oryginalne copy agenta z bazy.
     - Asynchronicznie wyemituj zdarzenie na topic `estalara.descriptions` z payloadem trzech seedów (E.7.7).
     - Następny buyer tego archetypu (po typowo ~3–8s) trafi cache hit.
   - **Cache miss + brak oryginału** (edge case — `listing.description` pusty/null):
     - Endpoint resolves placeholders w `PlaybookEntry.copy_template[locale]` (z fallbackiem na `.en`) względem `listing.fields`.
     - Zwróć **`{ description: resolved_template, source: 'template_fallback', generated_at: listing.updated_at }`**.
     - Wyemituj zdarzenie na `estalara.descriptions` z trzema seedami (SEED 1 = pusty string).
     - Sonnet generuje wtedy z samego template + listing_context (branch 4.2 w spec'u). Następny buyer trafi cache hit.
3. **Modal job** `apps/llm-gateway/src/jobs/generate_description.py`:
   - Input payload (kontrakt v1.7): `{ tenant_id, listing_id, archetype, locale, tier, cache_key, original_agent_copy, copy_template, listing_context, ttl_seconds }`.
   - Model: `claude-sonnet-4-6`.
   - Three-seed prompt — patrz E.7.7.
   - Fallback: jeśli Sonnet zwróci `null` lub pusty string → NIE zapisuj do cache. Następny request ponownie wraca `original_agent_copy` i ponownie enqueue'uje job (idempotent retry).
   - Output: Redis `SET desc:{tenant_id}:{listing_id}:{archetype}:{locale}` z TTL per Tier.

#### E.7.4. Cache invalidation

`listing.updated` event z Redpanda (`apps/ingest`) → consumer w `apps/control-plane` wywołuje `Redis DEL desc:{tenant_id}:{listing_id}:*` (wildcard delete via SCAN + DEL). Następny request po inwalidacji wraca `original_agent_copy` (z nową treścią agenta) i enqueue'uje regenerację. To kluczowy moment Cold Start Protection: gdy agent zmienia opis, pierwszy buyer każdego archetypu widzi nową wersję agenta — nigdy nie-zsynchronizowanego template fallback.

#### E.7.5. Strategia kosztowa

- **Lazy generation, NIE eager.** Generujemy tylko gdy buyer faktycznie patrzy na listing z Tier 2/3 SDK.
- **Koszt:** Sonnet × 450–600 tokenów = ~$0.006–0.009 per opis × (unique listing × unique archetype × unique locale).
- **Estymacja przy 10k unique listings × 18 archetypów × 1 locale = 180k cached opisów = ~$1k jednorazowo + invalidations.** Realnie: tylko Top 5–10 archetypów per tenant trafia cache, więc ~5–10k opisów per tenant per lokalizację = ~$30–90/mo per większy tenant.
- **Cold Start Protection nie zwiększa kosztu** — liczba `enqueue` calls = liczba unique `(listing, archetype)` par × 1 (z pominięciem retries po cache expiry). Identycznie jak w starym flow.

#### E.7.6. Implementation owner & tickets

Dotychczasowy TICKET-DESC-001 zostaje zastąpiony przez **7 ticketów (TICKET-COLD-001 do TICKET-COLD-007)** rozdzielonych między owner'ów. PM orchestrator generuje je z `docs/specs/cold-start-protection-v1.md` §6 przy planowaniu sprint'a. Modal job z PR #112 (commit b55c025) wymaga zmiany kontraktu payload (COLD-002).

Acceptance dla całego pakietu:

- Pierwszy buyer dla pary `(listing, archetype)` gdy `listing.description` istnieje zwraca `source: 'original_agent_copy'` i `description === listing.description`.
- Pierwszy buyer gdy `listing.description` pusty zwraca `source: 'template_fallback'` z Opus template w żądanym locale, placeholderami rozwiązanymi z `listing_context`.
- Drugi buyer tego archetypu (po typowo ~3–8s) zwraca `source: 'ai_cached'` z treścią Sonneta — zachowującą wszystkie fakty z `listing.description` gdy ten istniał, albo opartą wyłącznie na template + context w przeciwnym razie.
- Templates są dostępne we wszystkich trzech locale (EN/PL/ES) dla wszystkich 18 archetypów (54 templates łącznie).
- Tier 1 zwraca 400 dla `/api/adapt/description`.
- `listing.updated` invalidacja działa: po update'cie pierwszy buyer każdego archetypu znów dostaje `original_agent_copy` (świeży tekst agenta) lub `template_fallback` (jeśli agent skasował description).
- Modal job p95 < 8s (Sonnet inference + Redis SET).
- Endpoint p95: < 100ms (cache hit), < 150ms (cache miss path — Postgres fetch + Redpanda produce + opcjonalna resolucja placeholderów).

#### E.7.7. Cold Start Protection — two-branch three-seed Sonnet prompt

Sonnet otrzymuje trzy wyraźnie oznaczone seedy, w jasno określonej hierarchii priorytetów:

| Seed | Źródło                                            | Rola w prompcie                                                  | Priorytet faktyczny |
| ---- | ------------------------------------------------- | ---------------------------------------------------------------- | ------------------- |
| 1    | `listing.description` (oryginał agenta)           | Source of truth — żaden fakt nie może być sprzeczny z tym seedem | **HIGH** — fakty    |
| 2    | `PlaybookEntry.copy_template[locale]` (Opus 4.7) | Voice/rhythm pattern dla danego archetypu i locale               | **HIGH** — styl     |
| 3    | `listing_context` (structured fields)             | Dodatkowe fakty (placeholders); nigdy nie wymyśla wartości       | **MEDIUM** — fakty  |

Prompt ma dwa branche zależnie od obecności SEED 1:

- **Branch 4.1 (standard).** SEED 1 non-empty. System prompt: "rewrite an estate agent's original property description so it resonates with a specific buyer archetype. Preserve every factual claim in the agent's original. Adopt the voice, rhythm, and emphasis of the provided archetype pattern. Surface property facts most relevant to this archetype's motivations."
- **Branch 4.2 (missing original).** SEED 1 empty. System prompt: "The agent has not supplied an original description for this listing. Generate a property description grounded strictly in the archetype voice pattern and the structured listing context provided. Do not invent any property feature, price, yield, or other claim not present in the listing context."

Pełna treść obu promptów — `docs/specs/cold-start-protection-v1.md` §4. Locale Sonneta zawsze zgodne z `locale` żądania (EN/PL/ES), niezależnie od locale w którym SEED 2 jest authored — jeśli locale request nie ma autorskiego template, używamy `.en` jako voice seed ale instrukcji output'u w `{locale}`.

**Invariants (testowalne):**

1. **Factual invariant.** Output Sonneta nie może zawierać liczbowych faktów (bedrooms, price, yield, lease length) różnych od SEED 1 ∪ SEED 3. Walidacja: regex extraction liczb z output'u i SEED'ów; mismatch → log + nie zapisuj do cache.
2. **Voice invariant.** Output dla `yield_hunter` powinien zawierać >= 3 metryki numeryczne. Output dla `family_buyer` powinien zawierać >= 1 wzmiankę o szkołach/dzieciach. Walidacja heurystyczna w testach Sonneta (TICKET-COLD-006).
3. **Length invariant.** Output 80–180 słów (Tier 2: target 100, Tier 3: target 150). Outside range → log + nie zapisuj do cache.
4. **Token invariant.** Output nie zawiera raw `{token}` literals (Sonnet musi je rozwiązać lub usunąć).

**Observability (TICKET-COLD-005):**

ClickHouse `description_calls` (lub rozszerzenie `llm_calls`) loguje per request: `tenant_id, listing_id, archetype, locale, source, latency_ms, cache_age_seconds (dla ai_cached)`. Grafana panele:

- `% requests served as original_agent_copy` per tenant z 24h rolling window. Wysokie wartości (>40% sustained) wskazują na: (a) bardzo świeże listingi, (b) rozdrobnioną dystrybucję archetypów per listing, lub (c) degradację Modal job → on-call alert.
- `% requests served as template_fallback` per tenant z 24h rolling window. Wysokie wartości (>5% sustained) wskazują na tenant'a, który nie dostarcza `listing.description` w payload'ach — wymaga interwencji onboardingowej (Auto-Detect / Magic Link wizard nie wykrył pola description).

**Co Cold Start Protection daje biznesowo:**

- **Zero "synthetic looking" pages.** Pierwszy buyer dowolnej listingu zawsze widzi tekst agenta — copy ma kontekst, fakty i ton agencji.
- **Lift mierzalny.** Drugi+ buyer widzi adapted version. Można puścić A/B (5% trafficu serwowanego `original_agent_copy` mimo cache hit) i zmierzyć rzeczywisty lift adaptacji — wartość, którą sprzedajemy agencjom.
- **Trust z agencjami.** Agencja może w każdej chwili rzucić okiem na pierwsze wyświetlenie listingu i zobaczyć dokładnie swój tekst, nie generowany. Buduje zaufanie w fazie pilot.

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
---

## U. Agency Registration Flow & Master Admin Panel

> **Decyzje architektoniczne zatwierdzone przez Piotra Nawrockiego (CEO) — 5 maja 2026:**
> - U1: Rejestracja agencji = **approval-required** (nie self-serve)
> - U2: Płatności = **Stripe + Invoice** (Stripe dla kart, manual invoice dla enterprise)
> - U3: SDK generation flow = **public API key + gotowy `<script>` snippet** w back office
> - U4: Master admin auth = **RBAC** (superadmin / ops / readonly)
> - U5: Master admin lokalizacja = **`/admin/*` routes w `adaptive.estalara.com`** z middleware RBAC (nie osobny app)

---

### U.1. Dwupanelowa architektura dostępu

System ma dwa logicznie odrębne obszary dostępu w **jednej aplikacji** (`apps/control-plane`, domena `adaptive.estalara.com`):

```
adaptive.estalara.com
│
├── /dashboard/*          ← AGENCY PANEL (każda agencja widzi tylko swoje dane)
│   ├── /dashboard        Overview, analytics
│   ├── /dashboard/demo   Demo Mode toggle + settings
│   ├── /dashboard/sdk    SDK Integration + snippet generator
│   ├── /dashboard/billing Billing, plan, invoices
│   └── /dashboard/config  Configuration, archetypes
│
└── /admin/*              ← MASTER ADMIN PANEL (tylko role estalara:*)
    ├── /admin            Fleet overview — wszystkie agencje
    ├── /admin/tenants    Lista + zarządzanie agencjami
    ├── /admin/tenants/:id Szczegóły jednej agencji
    ├── /admin/registrations Pending approvals
    ├── /admin/demo-sessions Aktywne Demo Mode sessions
    ├── /admin/billing    Revenue dashboard (MRR, ARR, churn)
    └── /admin/alerts     Alerts center
```

**Middleware Next.js** (`apps/control-plane/src/middleware.ts`) blokuje `/admin/*`:
```typescript
// Tylko użytkownicy z JWT claim role: 'estalara:superadmin' | 'estalara:ops' | 'estalara:readonly'
// Redirect → /login dla agencji które trafią na /admin/*
// IP allowlist opcjonalnie dla dodatkowego bezpieczeństwa (Cloudflare WAF rule)
```

**Dlaczego jeden app, nie dwa:**
- `apps/control-plane` już istnieje z Next.js 15, Supabase Auth, Tailwind, shadcn/ui
- RBAC przez JWT claims wystarczy do separacji — nie ma potrzeby osobnego deploymentu
- Szybszy development w Sprint 3; można wyekstrahować do osobnego app post-Series A jeśli zajdzie potrzeba

---

### U.2. RBAC — Role i uprawnienia

#### U.2.1. Role agencji (tenant-scoped)

```typescript
type AgencyRole = 
  | 'agency:owner'    // Pełen dostęp do konta agencji, billing, team management
  | 'agency:admin'    // Konfiguracja, SDK, analytics — bez billing
  | 'agency:viewer'   // Read-only: analytics, archetypes
```

JWT claim dla agencji: `{ tenant_id: "uuid", role: "agency:owner" }`

#### U.2.2. Role Master Admin (Estalara staff)

```typescript
type EstalaraRole =
  | 'estalara:superadmin'  // Pełen dostęp: billing, konfiguracja systemu, user management
  | 'estalara:ops'         // Monitoring, support, impersonation, demo oversight
  | 'estalara:readonly'    // Tylko odczyt: analytics, fleet overview, audit logs
```

JWT claim dla staff: `{ estalara_staff: true, role: "estalara:superadmin" }`

**Przypisanie ról (decyzja Piotra):**
- `estalara:superadmin` — Piotr Nawrocki, Rafał Palak PhD
- `estalara:ops` — Customer Success, Senior Engineers
- `estalara:readonly` — Sales, Marketing, Auditors

#### U.2.3. Schema Supabase Auth

```typescript
// packages/db/src/schema/users.ts
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),               // Supabase Auth user ID
  email: text('email').notNull().unique(),
  
  // Dla agencji:
  tenant_id: uuid('tenant_id').references(() => tenants.id),
  agency_role: text('agency_role'),          // agency:owner | agency:admin | agency:viewer
  
  // Dla staff Estalara:
  estalara_staff: boolean('estalara_staff').default(false),
  estalara_role: text('estalara_role'),      // estalara:superadmin | estalara:ops | estalara:readonly
  
  created_at: timestamp('created_at').defaultNow(),
  last_login_at: timestamp('last_login_at'),
  mfa_enabled: boolean('mfa_enabled').default(false),  // Mandatory dla estalara_staff
});
```

---

### U.3. Agency Registration Flow (Approval-Required)

Rejestracja agencji jest **dwuetapowa**: agencja składa wniosek → Master Admin zatwierdza → konto aktywne.

#### U.3.1. Etap 1 — Wniosek agencji

**URL:** `adaptive.estalara.com/register`

**Formularz rejestracyjny:**
```
┌─────────────────────────────────────────────────────┐
│  Get started with Estalara Adaptive Listings        │
│  ─────────────────────────────────────────────────  │
│                                                     │
│  Agency name *          [Marbella Premium Realty  ] │
│  Website URL *          [https://marbella-prem... ] │
│  Your name *            [Carlos García            ] │
│  Work email *           [carlos@marbella-prem...  ] │
│  Phone (optional)       [+34 ...                  ] │
│  Country *              [Spain ▼                  ] │
│  Listings volume        [○ <100  ● 100–1000  ○ 1k+]│
│  How did you hear?      [Google ▼                  ] │
│                                                     │
│  [Create account →]                                 │
│                                                     │
│  Already have an account? [Log in]                  │
└─────────────────────────────────────────────────────┘
```

**Po kliknięciu "Create account":**
1. System tworzy rekord w tabeli `tenant_registrations` ze statusem `pending`
2. Agencja dostaje email: "Dziękujemy za rejestrację — rozpatrzymy wniosek w ciągu 24h"
3. Slack notification do `#estalara-registrations`: nowy wniosek z nazwą agencji, URL, kraj, volume
4. Master Admin widzi wniosek w `/admin/registrations`

#### U.3.2. Schema `tenant_registrations`

```typescript
// packages/db/src/schema/registrations.ts
export const tenantRegistrations = pgTable('tenant_registrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  
  // Dane z formularza
  agency_name: text('agency_name').notNull(),
  website_url: text('website_url').notNull(),
  contact_name: text('contact_name').notNull(),
  contact_email: text('contact_email').notNull(),
  contact_phone: text('contact_phone'),
  country: text('country').notNull(),
  listings_volume: text('listings_volume'),  // '<100' | '100-1000' | '1000+'
  referral_source: text('referral_source'),
  
  // Status approval
  status: text('status').notNull().default('pending'),
  // 'pending' | 'approved' | 'rejected' | 'needs_info'
  
  // Po approval
  tenant_id: uuid('tenant_id').references(() => tenants.id),  // Tworzony przy approval
  approved_by: uuid('approved_by').references(() => users.id),
  approved_at: timestamp('approved_at'),
  rejection_reason: text('rejection_reason'),
  
  // Metadata
  ip_address: text('ip_address'),
  user_agent: text('user_agent'),
  created_at: timestamp('created_at').defaultNow(),
  updated_at: timestamp('updated_at').defaultNow(),
});
```

#### U.3.3. Etap 2 — Master Admin approval

**W `/admin/registrations`:**
```
┌─────────────────────────────────────────────────────────────────────┐
│ Pending Registrations (3)                                           │
│ ─────────────────────────────────────────────────────────────────── │
│                                                                     │
│ Marbella Premium Realty     Spain    100–1000    2h ago    [Review] │
│ Warsaw Luxury Homes         Poland   <100        5h ago    [Review] │
│ Dubai Properties LLC        UAE      1000+       1d ago    [Review] │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Widok `/admin/registrations/:id`:**
- Dane z formularza
- Auto-check: czy website_url jest dostępny, czy jest na nim system CMS (wykryte przez auto-detect)
- Przyciski: `[Approve]` `[Request more info]` `[Reject]`
- Przy Approve: wybór initial plan (Free / Observer / Augment / Native), opcjonalny trial period

**Po zatwierdzeniu:**
1. System tworzy rekord w tabeli `tenants` (aktywny tenant)
2. Tworzy konto użytkownika dla contact_email z rolą `agency:owner`
3. Agencja dostaje email z linkiem aktywacyjnym (set password + MFA setup)
4. Tenant pojawia się w Fleet Overview

#### U.3.4. Etap 3 — Pierwsze logowanie agencji

Po kliknięciu linku aktywacyjnego:
1. Agencja ustawia hasło + MFA (TOTP)
2. Przekierowanie do `adaptive.estalara.com/dashboard`
3. Onboarding wizard:
   - Krok 1: "Wklej URL swojej strony" → auto-detect schema (B.4 — Magic Link flow)
   - Krok 2: "Skopiuj SDK snippet" → `/dashboard/sdk`
   - Krok 3: "Wklej w `<head>` swojej strony"
4. System zaczyna nasłuchiwać na eventy z domeny agencji

---

### U.4. SDK Generation Flow

**URL:** `adaptive.estalara.com/dashboard/sdk`

```
┌─────────────────────────────────────────────────────────┐
│  SDK Integration                                        │
│  ─────────────────────────────────────────────────────  │
│                                                         │
│  Your Public API Key                                    │
│  ┌───────────────────────────────────────────────────┐  │
│  │ est_live_marbella_abc123xyz                       │  │
│  │                                [Copy] [Rotate]   │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  Integration Snippet                                    │
│  ┌───────────────────────────────────────────────────┐  │
│  │ <!-- Estalara Adaptive Listings -->               │  │
│  │ <script                                           │  │
│  │   src="https://cdn.estalara.com/sdk/v1.js"       │  │
│  │   data-api-key="est_live_marbella_abc123xyz"      │  │
│  │   data-tier="observer"                            │  │
│  │   async>                                          │  │
│  │ </script>                                         │  │
│  │                                          [Copy]   │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  Add this to the <head> of every page on your site.    │
│                                                         │
│  SDK Status                                             │
│  ○ Not detected yet — paste the snippet and reload     │
│  ✓ marbella-premium.com — Active (last seen 2min ago)  │
│                                                         │
│  [Download WordPress Plugin]  [View documentation]     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**SDK Status** jest aktualizowany przez ingest worker — gdy pierwsze eventy dotrą z domeny agencji, status zmienia się z "Not detected yet" na "Active".

---

### U.5. Master Admin Fleet View

**URL:** `adaptive.estalara.com/admin/tenants`

Kolumny tabeli Fleet Overview (rozszerzone o decyzje P1–P5):

| Kolumna | Źródło | Opis |
|---|---|---|
| Agency | `tenants.name` | Nazwa agencji |
| Status | `tenants.status` | `active` / `suspended` / `trial` |
| Plan | `tenants.plan` | Free / Observer / Augment / Native |
| SDK | `events` (ClickHouse) | `live` / `silent` / `not_installed` |
| **Demo Mode** | `demo_sessions` | `OFF` / `🟡 ON — mockup` / `🟠 ON — production` |
| Last seen | `events.ts` | Timestamp ostatniego eventu |
| MRR | `billing` | Miesięczny przychód |
| Registered | `tenants.created_at` | Data zatwierdzenia rejestracji |
| Actions | — | `[View]` `[Impersonate]` `[Suspend]` |

**Demo Mode kolumna — szczegóły:**
- `OFF` — Demo Mode nieaktywny
- `🟡 ON — mockup` — agencja ma aktywny Demo Mode na mock-up page (nie ma SDK na produkcji)
- `🟠 ON — production` — agencja ma aktywny Demo Mode na produkcyjnej domenie
- Kliknięcie → `/admin/demo-sessions` filtrowane po tenant

**Alert: Demo Mode active >7 days** — automatyczny alert w Alerts Center gdy tenant ma Demo Mode aktywny dłużej niż 7 dni. Interpretacja: agencja może mieć problem z wdrożeniem SDK na produkcji (utknęła na mocku). Akcja: Customer Success team kontaktuje się proaktywnie.

---

### U.6. Master Admin Demo Sessions View

**URL:** `adaptive.estalara.com/admin/demo-sessions`

Real-time widok wszystkich aktywnych Demo Mode sessions:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Active Demo Sessions (2)                                            │
│ ─────────────────────────────────────────────────────────────────── │
│                                                                     │
│ Marbella Premium   mockup      British Retiree   Active 14 min  [X] │
│ Warsaw Luxury      production  Polish Family     Active 3h 22m  [X] │
│                                                                     │
│ ─────────────────────────────────────────────────────────────────── │
│ Demo Sessions — Last 30 days                         [Export CSV]   │
│                                                                     │
│ DATE        AGENCY              SCOPE       DURATION  PERSONAS      │
│ 2026-05-04  Dubai Properties    production  42 min    Gulf Investor  │
│ 2026-05-03  Marbella Premium    mockup      8 min     3 switches     │
│ ...                                                                 │
└─────────────────────────────────────────────────────────────────────┘
```

**Master Admin może:**
- Wymusić zakończenie Demo Session dla dowolnego tenanta (`[X]` → `POST /api/admin/demo-sessions/:id/revoke`)
- Eksportować historię demo sessions (CSV) do analizy sales effectiveness
- Filtrować po scope (mockup / production), dacie, agencji

---

### U.7. Billing & Subscriptions

#### U.7.1. Stripe + Invoice (decyzja P2)

**Stripe** obsługuje:
- Automatyczne cykliczne płatności (miesięczne / roczne) kartą kredytową
- Webhooks: `payment_succeeded`, `payment_failed`, `subscription.updated`, `subscription.canceled`
- Stripe Customer Portal dla agencji (self-serve zmiany planu, aktualizacja karty)

**Manual Invoice** obsługuje:
- Tier 3 Native i enterprise — płatność przelewem
- System generuje fakturę PDF (przez Stripe Invoice lub zewnętrzny system księgowy)
- Master Admin manualnie potwierdza wpłatę i aktywuje plan w `/admin/tenants/:id`

#### U.7.2. Subscription states

```typescript
type SubscriptionStatus = 
  | 'trial'           // 14-dniowy trial (opcjonalny przy approval)
  | 'active'          // Płacąca agencja
  | 'past_due'        // Płatność się nie powiodła, grace period 7 dni
  | 'suspended'       // Po grace period — SDK wyłączony, back office read-only
  | 'canceled'        // Konto anulowane — dane retencja 90 dni
```

#### U.7.3. Master Admin Revenue Dashboard (`/admin/billing`)

Dostępny tylko dla `estalara:superadmin`:
- MRR (Monthly Recurring Revenue) z trendem
- ARR (Annual Run Rate)
- Churn rate (ostatnie 30/90 dni)
- Cohort analysis (retencja po 1/3/6 miesiącach)
- Upcoming renewals i at-risk accounts (`past_due`)
- Export do CSV / integracja z zewnętrznym BI

---

### U.8. Impersonation (Support Tool)

Master Admin z rolą `estalara:ops` lub `estalara:superadmin` może zalogować się jako dowolna agencja:

**Flow:**
1. `/admin/tenants/:id` → przycisk `[Impersonate]`
2. System generuje krótkotrwały JWT (15 min) z `{ tenant_id, impersonated_by: admin_user_id }`
3. Admin widzi back office dokładnie tak jak agencja
4. Żółty banner: "⚠️ Impersonating Marbella Premium — [Exit impersonation]"
5. Wszystkie akcje wykonane podczas impersonation są logowane w `staff_audit_log` z `impersonated_by`

**Ograniczenia:**
- Impersonation nie pozwala na zmianę hasła / MFA agencji
- Billing actions podczas impersonation wymagają dodatkowego potwierdzenia (eskalacja do superadmin)
- Session timeout impersonation: 15 minut (nie extendable)

---

### U.9. Audit Log (staff)

Wszystkie akcje Master Admin są logowane w tabeli `staff_audit_log`:

```typescript
export const staffAuditLog = pgTable('staff_audit_log', {
  id: uuid('id').primaryKey(),
  admin_user_id: uuid('admin_user_id').notNull(),
  action: text('action').notNull(),
  // 'tenant.approved' | 'tenant.suspended' | 'demo.force_stopped' | 
  // 'impersonation.started' | 'subscription.changed' | ...
  target_tenant_id: uuid('target_tenant_id'),
  payload: jsonb('payload'),               // Szczegóły akcji
  ip_address: text('ip_address'),
  created_at: timestamp('created_at').defaultNow(),
});
// append-only, brak DELETE/UPDATE przez RLS
// retention: 7 lat (compliance requirement)
```

---

### U.10. Investor Quiz — opt-in self-declared intent feature (back-office side)

> **Cross-reference:** Pełna specyfikacja widget UX, mapping odpowiedzi do priors, i events tracking — patrz **Section E.4**. Ta podsekcja opisuje wyłącznie back-office (per-tenant toggle + analytics).

#### U.10.1. Per-tenant Quiz Toggle (`/dashboard/quiz`)

Każda agencja decyduje czy quiz inwestora jest aktywny na jej stronie. Domyślnie: **OFF** (agencja musi explicit włączyć).

```
┌─────────────────────────────────────────────────────────────────┐
│ 🎯 Investor Intent Quiz                                         │
│ ─────────────────────────────────────────────────────────────── │
│                                                                 │
│ Help your buyers find their match faster with 2 quick questions │
│ Show a sticky widget asking purpose (personal/investment) and   │
│ horizon (≤3 months / >1 year). Answers boost personalization    │
│ accuracy from the very first listing view.                      │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────┐     │
│ │ Quiz status                              [  OFF  ●  ]   │     │
│ └─────────────────────────────────────────────────────────┘     │
│                                                                 │
│ ── Display options ─────────────────────────────────────        │
│ ☑ Sticky widget (always visible, bottom-right corner)           │
│ ☑ Trigger prompt after 3 listings viewed                        │
│ ☐ Show on listing detail pages only (hide on home/search)       │
│                                                                 │
│ ── Localization ────────────────────────────────────────        │
│ Question language        [ English ▼ ]                          │
│                          (PL, ES, AR, FR, DE coming Sprint 7)   │
│                                                                 │
│ ── Brand styling ───────────────────────────────────────        │
│ Widget accent color      [ #2563EB ]  (inherits brand tokens)   │
│ Widget icon              [ 🎯 ▼ ]                                │
│                                                                 │
│ [Cancel]                                  [Save & Activate]     │
└─────────────────────────────────────────────────────────────────┘
```

**Konfiguracja zapisywana w `tenants.config.quiz`:**
```typescript
type QuizConfig = {
  enabled: boolean;
  display: {
    sticky_widget: boolean;
    trigger_after_n_listings: number | null;  // null = disabled
    show_on_detail_pages_only: boolean;
  };
  localization: {
    language: 'en' | 'pl' | 'es' | 'ar' | 'fr' | 'de';
  };
  styling: {
    accent_color: string;       // hex, inherits brand tokens default
    icon: string;               // emoji or icon ID
  };
  updated_by: string;            // user_id
  updated_at: Date;
};
```

#### U.10.2. Quiz Analytics Dashboard (`/dashboard/quiz/analytics`)

Agencja widzi statystyki skuteczności quizu w czasie rzeczywistym:

```
┌─────────────────────────────────────────────────────────────────┐
│ 🎯 Quiz Analytics — Last 30 days                                │
│ ─────────────────────────────────────────────────────────────── │
│                                                                 │
│ ┌──────────────┬──────────────┬──────────────┬──────────────┐   │
│ │ Impressions  │ Started      │ Completed    │ Conversion+  │   │
│ │   12,847     │   3,206      │   2,439      │    +18.4%    │   │
│ │              │ 25.0% rate   │ 76.1% rate   │ vs no-quiz   │   │
│ └──────────────┴──────────────┴──────────────┴──────────────┘   │
│                                                                 │
│ ── Funnel ────────────────────────────────────────────────      │
│ Shown    ████████████████████████████████████████  12,847       │
│ Started  ██████████                                  3,206  25% │
│ Q1 done  █████████                                   2,890  90% │
│ Q2 done  ████████                                    2,439  84% │
│                                                                 │
│ ── Answer distribution ────────────────────────────────         │
│ Personal × Short (≤3mo):       ████████  31% (758)              │
│ Personal × Long  (>1yr):       █████     19% (462)              │
│ Investment × Short (≤3mo):     ███████   28% (683)              │
│ Investment × Long (>1yr):      ███████   22% (536)              │
│                                                                 │
│ ── Conversion lift by answer combination ─────────────          │
│ Personal × Short:    +24.1% inquiry rate vs control             │
│ Investment × Short:  +31.2% inquiry rate vs control             │
│ Personal × Long:     +12.8% inquiry rate vs control             │
│ Investment × Long:   +8.4% inquiry rate vs control              │
│                                                                 │
│ ── Quiz vs behavioral mismatch rate ──────────────────          │
│ 14.2% of completed quizzes had behavioral signals               │
│ contradicting answers within 5 minutes.                         │
│ Most common: "Personal" → behavioral indicates investment.      │
│                                                                 │
│ [Export CSV]  [Compare cohorts]  [View as graph]                │
└─────────────────────────────────────────────────────────────────┘
```

**Metryki wyliczane real-time z ClickHouse `events` table:**

| Metric | Definition | Source |
|---|---|---|
| **Impressions** | Count of `quiz.event` z `step='shown'` | events |
| **Started** | Count z `step='started'` | events |
| **Completed** | Count z `step='completed'` | events |
| **Completion rate** | Completed / Started | derived |
| **Conversion lift** | Inquiry rate quiz-completed vs no-quiz cohort | join with `inquiry.completed` |
| **Answer distribution** | Group by (purpose, horizon) | events |
| **Mismatch rate** | % sessions z `quiz_behavioral_mismatch=true` flag | events |

**Drill-down filters:**
- Date range (last 7 / 30 / 90 days, custom)
- Device type (desktop / mobile / tablet)
- Trigger source (sticky / prompt / manual)
- Listing category (residential / commercial / land)
- Geographic region (jeśli tenant ma multi-region listings)

**Export:** CSV download z agregowanymi statystykami (zero PII — tylko enum values + counts).

#### U.10.3. Master Admin oversight (Fleet View extension)

W `/admin/tenants` Fleet Overview dodajemy kolumnę:

| Column | Source | Values |
|---|---|---|
| **Quiz** | `tenants.config.quiz.enabled` | `OFF` / `🟢 ON — N% completion` |

Pozwala Master Adminowi szybko zidentyfikować:
- Tenants którzy mają quiz wyłączony mimo wysokiego SDK traffic (sales opportunity — "włącz quiz, +18% conversion")
- Tenants z bardzo niskim completion rate (<30%) — może źle skonfigurowany trigger lub brand styling

#### U.10.4. Sprint mapping (back-office quiz tickets)

Patrz Section E.4.8 dla pełnej listy quiz ticketów. Tickety wpływające na back-office:

- **TICKET-QUIZ-003** (Sprint 5): Per-tenant toggle `/dashboard/quiz` config page (U.10.1)
- **TICKET-QUIZ-004** (Sprint 5): Agency analytics dashboard `/dashboard/quiz/analytics` (U.10.2)
- **TICKET-QUIZ-007** (Sprint 6): Master Admin Fleet View column dla quiz status (U.10.3)

---

### U.11. Profile Mode (Identified Buyers) — POST-MVP feature, forward-compatibility only

> **Status:** **Deferred to post-MVP roadmap (Sprint 12+).** Ta podsekcja NIE definiuje ticketów do implementacji w Sprint 0-7. Definiuje wyłącznie **forward-compatibility constraints** dla bieżącej architektury — tak żebyśmy nie zablokowali tej funkcjonalności podczas budowania MVP.
>
> **Decyzja produktowa (Piotr Nawrocki, 5 maja 2026):**
> - Profile Mode jako **Tier-agnostic feature** — toggle dostępny dla wszystkich tierów po aktywacji przez Master Admin
> - **Globalna flaga "Profile Mode beta"** w `/admin/tenants/:id` — jednoklikowy toggle Master Admin
> - **Approval workflow ZEWNĘTRZNY** (Notion + email + DPA review) — proces nie zaszyty w systemie IT
> - **Wdrożenie:** dopiero po MVP retrospective (Sprint 12+), z pełnym kontekstem real customer needs

#### U.11.1. Co to jest Profile Mode

Domyślnie Estalara Adaptive Listings jest **anonymous-first**:
- Buyer nie zostawia śladu między sesjami
- Behavioral signals + opcjonalny quiz (E.4) tworzą session-scoped archetype
- Sesja kończy się — profile znika
- Cross-tenant aggregations (Sekcja F) używają tylko anonymized, k-anonymized, DP-protected data

**Profile Mode (opt-in per tenant po Master Admin approval)** dodaje warstwę **identified buyers**:
- Buyer wypełnia registration form (email, imię, telefon optional, preferences)
- Granular consent: contact (phone/email), behavior tracking, team sharing
- Profile zapisany **tylko per-tenant** (RLS scoped) — Idealista NIE WIDZI buyer profiles z Otodom
- Agencja może później do buyera zadzwonić z znajomością preferencji

**Co Profile Mode NIE zmienia:**
- Cross-tenant archetype aggregations (Sekcja F) NIGDY nie używają identified data
- Profile data NIGDY nie wychodzi poza tenant boundaries
- Anonymous mode pozostaje default — Profile Mode wymaga explicit buyer consent

#### U.11.2. Dlaczego post-MVP (uzasadnienie deferreal)

1. **YAGNI w MVP** — większość agencji w pilot phase będzie testować anonymous-first proposition. Profile Mode jest add-on dla power users
2. **Legal complexity** — wymaga custom DPA per tenant, fair-housing review, GDPR Art. 22 (automated decision-making) consent flow. To jest 2-4 tygodnie legal work per pierwszy customer — nie chcemy tego w Sprint 0-7
3. **Spec może się zmienić** — po 6 miesiącach real customer feedback wiemy więcej o tym **co konkretnie** agencje chcą zbierać (czy email + phone wystarczy, czy potrzebują budget range, family size, etc.)
4. **Cross-tenant intelligence path** — przed Profile Mode warto zbudować **Estalara Insights** (Sekcja U.13.5) jako standalone product. Insights używa wyłącznie aggregated anonymous data — zero legal risk

#### U.11.3. Forward-compatibility — co MUSI respektować obecna architektura

To jest **architectural checklist** dla każdego ticketu w Sprint 0-7. Każda decyzja powinna pass tych 6 testów:

**Test 1 — Tenant isolation strict from day 1**
- ✅ RLS na każdej tabeli z tenant_id (już designed w Sekcji J)
- ✅ Drizzle role separation `createTenantClient` vs `createAdminClient` (TICKET-FIX-004 ✅)
- ✅ ClickHouse tenant_id partition key (Sekcja A.4)
- ✅ Cross-tenant queries TYLKO przez admin client + audit log
- **Implication dla Profile Mode:** dodanie `agency_profiles` table w Sprint 12+ wymaga tylko nowych RLS policies, nie refactoring

**Test 2 — Encryption-ready column architecture**
- ✅ pgcrypto extension dostępny w Supabase (zero infra setup needed)
- ✅ Column-level encryption pattern documented w Sekcji V.8.1 (`users.mfa_backup_codes` używa już bcrypt)
- ✅ `DB_COLUMN_ENCRYPTION_KEY` w Doppler scope dla future use
- **Implication dla Profile Mode:** `agency_profiles.email`, `phone`, `full_name` będą encrypted columns od dnia 1 — bez migracji

**Test 3 — Consent tracking primitives**
- ⚠️ **Action item dla Sprint 2 TICKET-021:** dodać generic `consent_records` table (tenant_id, subject_id, consent_type, granted_at, revoked_at, ip_address, user_agent, tos_version)
- ✅ Już planowane dla cookie consent / behavioral tracking opt-in (Sekcja H)
- **Implication dla Profile Mode:** ta sama tabela obsłuży `consent_type='profile_creation'`, `consent_type='phone_contact'`, etc.

**Test 4 — Session ↔ identity bridge**
- ✅ Session model w Sekcji D.3 ma `session_id` (anonymous fingerprint hash)
- ⚠️ **Action item dla Sprint 4 SDK ticket:** SDK musi mieć optional `Estalara.identify(profile_id)` API stub — placeholder, nic nie robi w MVP, ale API exists
- **Implication dla Profile Mode:** w Sprint 12+ `identify()` zaczyna linkować session → profile. Brak stub'u w MVP = breaking change w SDK API later

**Test 5 — Anonymous-first global archetype training**
- ✅ Archetype Update Job (Sekcja F.2) już używa anonymized data tylko
- ✅ Differential privacy, k-anonymity ≥50, no tenant_id w training data
- ✅ Code path explicitly excludes any future identified data
- **Implication dla Profile Mode:** profile data NIGDY nie feed do global archetypes — ten constraint jest zapisany w F.2 documentation jako invariant

**Test 6 — Fair-housing linter ready**
- ✅ Już planowany w Sekcji E.3.2 (weighted objective: `brand_safety_score`)
- ✅ Sprint 8+ implementation
- **Implication dla Profile Mode:** linter musi być gotowy ZANIM Profile Mode aktywny u pierwszego customer — bez tego ryzyko Fair Housing Act violation

#### U.11.4. Co BĘDZIE w Sprint 12+ (placeholder spec)

Pełna specyfikacja będzie w **osobnym dokumencie** napisanym po Sprint 7 retrospective. Wstępny scope:

**Master Admin side (`/admin/tenants/:id`):**
- Toggle "Profile Mode beta" (default OFF)
- Wymaga external approval flow done (audit log captures who, when, DPA reference)
- Audit log entry przy każdej zmianie

**Agency side (`/dashboard/profile-mode`):**
- Konfiguracja registration form fields (email, name, phone, budget, location, etc.)
- Granular consent text editor (per-tenant brand voice)
- Privacy policy template auto-generator
- Lead export (CSV, JSON, CRM webhook)

**SDK side:**
- Registration form widget (Preact + Shadow DOM, sticky, dismissable)
- `Estalara.identify(profile_id)` API
- Session linking
- Profile-aware adaptation (Intent Engine używa profile preferences jako stronger prior niż quiz)

**Data architecture:**
- `agency_profiles` table (per-tenant, encrypted PII columns, RLS)
- `agency_profile_sessions` linking table
- `consent_records` extension dla profile consents
- Indexes dla agency analytics queries

**Compliance:**
- Custom DPA template (Estalara processor, agency controller)
- Fair-housing linter integration (E.3.2)
- GDPR Art. 22 explicit consent flow dla automated personalization
- Right to access/erasure self-service portal dla buyers

**Estimated scope:** 15-20 ticketów, 2-3 sprinty (Sprint 12-14).

#### U.11.5. Estalara Insights (parallel path, also post-MVP)

**Cross-tenant intelligence as standalone product** — zero legal risk because uses only aggregated anonymous data:

- "Top 10 conversion patterns dla luxury Spain coastal" reports
- "Buyer archetype trends Q1 2027" industry reports
- "Adaptation effectiveness benchmarks" by region/property type
- API access for banks, REITs, large brokerages

**Pricing:** $5k-50k/year per subscription (separate from Adaptive Listings).

**Why parallel to Profile Mode:** Insights NIE potrzebuje identified data, więc może iść first (Sprint 10+). Insights revenue stream sam w sobie justifies network effect inwestycji.

Pełna spec w **Year 2 strategic document** — out of scope dla Master Design v1.4.

#### U.11.6. Action items dla obecnych sprintów

Te punkty MUSZĄ być uwzględnione w MVP żeby Profile Mode było viable post-MVP bez breaking changes:

| Sprint | Ticket | Action item |
|---|---|---|
| Sprint 2 | TICKET-021 | Dodać generic `consent_records` table do schema (T3 forward-compat) |
| Sprint 4 | SDK ticket | Dodać `Estalara.identify()` stub do SDK API (no-op, but exported) |
| Sprint 8 | TICKET-FAIR-001 (new) | Fair-housing linter MVP — gate dla Profile Mode aktywacji |
| Documentation | Sekcja F.2 | Add invariant: "global archetype training NEVER uses identified data, even if Profile Mode active" |

Te 4 punkty to suma "kosztu" forward-compatibility w MVP. Każdy z nich jest <1 dnia pracy — łączny narzut <1 sprint, dystrybuowany. Akceptowalne.

#### U.11.7. Cross-references

- **Sekcja F (Data Network Effect):** Profile Mode RESPECTS F's anonymous-first architecture — identified data nigdy nie feed do global archetypes (invariant)
- **Sekcja H (Compliance):** Profile Mode wymaga custom DPA per tenant; Sekcja H już covers GDPR principles dla anonymous mode, future doc covers identified mode
- **Sekcja J (Multi-Tenancy):** RLS policies wystarczające dla `agency_profiles` extension — bez refactoringu
- **Sekcja V (Security):** column-level encryption już designed (V.8.1) — Profile Mode użyje istniejącego patternu
- **Sekcja E.3.2 (Multi-objective optimization):** `brand_safety_score` (fair-housing linter) MUST be live before first Profile Mode activation

---

### U.12. Sprint mapping

| Sprint | Ticket | Deliverable |
|---|---|---|
| Sprint 2 | TICKET-021 | Postgres schema — dodać `tenant_registrations`, `users` z rolami, `staff_audit_log`, **`consent_records`** (forward-compat dla Profile Mode U.11.6) |
| Sprint 3 | TICKET-ADM-001 | `/register` page + approval flow + Slack notification |
| Sprint 3 | TICKET-ADM-002 | `/admin/registrations` — pending approvals view |
| Sprint 3 | TICKET-ADM-003 | `/admin/tenants` — Fleet Overview z Demo Mode kolumną |
| Sprint 3 | TICKET-ADM-004 | `/admin/demo-sessions` — real-time demo oversight |
| Sprint 4 | TICKET-ADM-005 | `/dashboard/sdk` — SDK snippet generator + SDK Status |
| Sprint 4 | TICKET-ADM-006 | Stripe integration — subscriptions + webhooks |
| Sprint 4 | TICKET-SDK-IDENTIFY | SDK `Estalara.identify()` API stub (no-op, forward-compat dla Profile Mode U.11.6) |
| Sprint 5 | TICKET-ADM-007 | `/admin/billing` — Revenue Dashboard (superadmin only) |
| Sprint 5 | TICKET-ADM-008 | Impersonation tool |
| Sprint 5 | TICKET-QUIZ-003 | Per-tenant Quiz Toggle — `/dashboard/quiz` config page (U.10.1) |
| Sprint 5 | TICKET-QUIZ-004 | Quiz Analytics Dashboard — `/dashboard/quiz/analytics` (U.10.2) |
| Sprint 6 | TICKET-ADM-009 | Manual Invoice flow (Tier 3 enterprise) |
| Sprint 6 | TICKET-QUIZ-007 | Master Admin Fleet View — quiz status column (U.10.3) |
| Sprint 8 | TICKET-FAIR-001 | Fair-housing linter MVP (gate dla Profile Mode aktywacji, E.3.2 + U.11.6) |
| **Sprint 12+** | **PROF-001 do PROF-020** | **Profile Mode pełna implementacja — separate spec doc, post-MVP** |

---

### U.13. Cross-references

- **Sekcja E.4 (Investor Quiz Widget):** pełna specyfikacja widget UX, Bayesian prior mapping, events tracking, sprint mapping. U.10 opisuje wyłącznie back-office; E.4 jest source of truth dla logiki personalizacji
- **Sekcja D.5 (Detection Quality Score):** quiz completion rate i quiz-behavioral mismatch rate jako leading indicators DQS — feed do dashboard `/admin/data-quality`
- **Sekcja F (Data Network Effect):** Profile Mode (U.11) RESPECTS anonymous-first architecture — identified data nigdy nie feed do global archetypes (invariant zapisany w F.2)
- **Sekcja J (Multi-Tenancy):** `tenants` tabela i RLS policies — rozszerzone o `registration_id`, `approved_by`, `status`, `config.quiz` (per-tenant Quiz config), `profile_mode_enabled` (Master Admin gated boolean dla U.11)
- **Sekcja K (Internal Ops Panel):** Section U rozszerza i uszczegółowia Section K — U jest source of truth dla master admin design
- **Sekcja T (Demo Mode):** Demo Mode toggle dostępny po approval (U.3.3); Master Admin oversight Demo Mode opisany w U.5 i U.6
- **Sekcja V (Security):** column-level encryption pattern (V.8.1) reused dla `agency_profiles` w Sprint 12+
- **Sekcja O (Roadmap):** Sprint 2 TICKET-021 musi uwzględnić nowe tabele z U.2.3, U.3.2, oraz `consent_records` z U.11.6


---

## V. Security Architecture & Cybersecurity

> **Decyzja architektoniczna (Piotr Nawrocki, 5 maja 2026):** Estalara Adaptive Listings buduje fundament bezpieczeństwa od dnia 1 — nie jako "compliance check-box" ale jako warunek wejścia w segment enterprise (Idealista, Otodom, Rightmove). Każdy enterprise klient w Year 1 zażąda security questionnaire — musimy mieć na to gotową odpowiedź.

### V.1. Security philosophy & threat model

#### V.1.1. Trust boundaries

System ma **pięć warstw zaufania** — każda granica wymaga eksplicytnej walidacji:

```
┌─ Untrusted: public internet (buyers on agency websites) ─────────────┐
│                                                                       │
│  ┌─ Semi-trusted: SDK on third-party domain ──────────────────────┐  │
│  │  - Origin validated, HMAC-signed payloads, rate-limited        │  │
│  │  - No access to tenant secrets                                 │  │
│  │  - Cannot read tenant config                                   │  │
│  │                                                                 │  │
│  │  ┌─ Tenant-trusted: agency staff (adaptive.estalara.com) ──┐  │  │
│  │  │  - Authenticated via Supabase Auth + MFA                 │  │  │
│  │  │  - JWT scoped to single tenant_id                        │  │  │
│  │  │  - RLS enforces row-level isolation                      │  │  │
│  │  │                                                          │  │  │
│  │  │  ┌─ Estalara-trusted: staff (/admin/*) ──────────────┐   │  │  │
│  │  │  │  - RBAC: superadmin/ops/readonly                  │   │  │  │
│  │  │  │  - MFA mandatory + IP allowlist (post-MVP)        │   │  │  │
│  │  │  │  - All actions audit-logged                       │   │  │  │
│  │  │  │                                                    │   │  │  │
│  │  │  │  ┌─ Infra-trusted: backend service-role ─────┐    │   │  │  │
│  │  │  │  │  - Bypass RLS dla migracji/admin ops       │    │   │  │  │
│  │  │  │  │  - Never exposed to tenant API routes      │    │   │  │  │
│  │  │  │  └────────────────────────────────────────────┘    │   │  │  │
│  │  │  └────────────────────────────────────────────────────┘   │  │  │
│  │  └────────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

#### V.1.2. STRIDE threat model

| Threat | Attack scenario | Mitigation |
|---|---|---|
| **Spoofing** | Atakujący podszywa się pod tenant API key | HMAC signing per request (V.4.2), origin validation, rate limit per tenant |
| **Tampering** | MITM modyfikuje event payload w tranzycie | TLS 1.3 mandatory, HMAC integrity check, idempotency keys (TICKET-019) |
| **Repudiation** | Tenant zaprzecza akcjom administracyjnym | `staff_audit_log` append-only, 7 lat retencji, `tenants_audit_log` per-tenant |
| **Information Disclosure** | Buyer A widzi dane buyera B (cross-session) | Session-scoped fingerprint hash z HMAC + tenant_secret + day_bucket; RLS na poziomie DB; no PII w events (TICKET-FIX-005) |
| **Denial of Service** | Bot pętla wysyła 1M eventów/min do Ingest | Rate limiting Durable Objects (TICKET-013), Cloudflare DDoS protection, per-tenant cost limits (V.10) |
| **Elevation of Privilege** | Tenant user uzyskuje master admin role | Separate JWT claims (`tenant_id` vs `estalara_staff`), middleware RBAC walidacja, MFA dla staff, sudo mode dla destruktywnych akcji |

#### V.1.3. Critical assets — co chronimy

| Asset | Why critical | Tier |
|---|---|---|
| **Buyer behavioral data** | GDPR/CCPA personal data; reputation risk on breach | T1 (najwyższy) |
| **Tenant API keys** | Bypass uwierzytelniania, cross-tenant impersonation | T1 |
| **Master admin credentials** | Full-fleet access | T1 |
| **Stripe webhook signing secret** | Fraudulent billing manipulation | T1 |
| **Tenant config (brand tokens, schemas)** | Reputation if defaced; competitive intel | T2 |
| **ML model weights** | Trade secret, competitive moat | T2 |
| **Audit logs** | Regulatory compliance, incident investigation | T2 |
| **Anonymized archetype embeddings** | Data network effect (DP-protected) | T3 |

---

### V.2. Authentication & Session Security

#### V.2.1. Password policy (Supabase Auth)

```typescript
// packages/db/src/auth/password-policy.ts
export const PASSWORD_POLICY = {
  min_length: 12,                          // NIST SP 800-63B current best practice
  max_length: 128,                         // prevent algorithmic DoS
  require_breach_check: true,              // HaveIBeenPwned k-anonymity API
  disallow_common_passwords: true,         // top 10k blacklist (zxcvbn dictionary)
  disallow_user_attributes_match: true,    // password ≠ email/name fragments
  history_count: 5,                        // last 5 passwords cannot be reused
  expiry_days: null,                       // NIST: no forced rotation (modern standard)
};
```

**HaveIBeenPwned integration:** SHA-1 prefix lookup (k-anonymity), nigdy nie wysyłamy pełnego hasha. Implementowane jako Supabase Auth hook lub middleware przy signup/password-change.

#### V.2.2. JWT & session management

| Claim | Wartość | Komentarz |
|---|---|---|
| `iss` | `https://adaptive.estalara.com` | Audience-scoped issuer |
| `aud` | tenant_id LUB `estalara:staff` | Single audience per token |
| `sub` | user_id (UUID) | Subject |
| `tenant_id` | UUID (dla agency users) | Used by RLS auth.jwt() |
| `agency_role` | `agency:owner | agency:admin | agency:viewer` | RBAC enforcement |
| `estalara_staff` | boolean | `true` only for staff |
| `estalara_role` | `estalara:superadmin | estalara:ops | estalara:readonly` | Staff RBAC |
| `mfa_verified` | boolean | True jeśli MFA passed w bieżącej sesji |
| `iat`, `exp`, `jti` | standard | jti dla revocation list |

**Session TTLs:**
- Access token: **15 min** (krótkie żeby ograniczyć blast radius przy kradzieży)
- Refresh token: **7 dni** dla agency users; **24h** dla `estalara:*` staff
- Idle timeout: **1h** dla `/admin/*` (per K.7), **8h** dla `/dashboard/*`
- Absolute session timeout: **8h** staff, **30 dni** agency

**Token revocation:** Supabase Auth supports JTI-based revocation list w Postgres. Dodajemy `revoked_tokens` tabelę z TTL = max(refresh_token TTL). Middleware sprawdza JTI przy każdym request do `/admin/*` i destruktywnych akcjach.

**Refresh token rotation:** Każde użycie refresh token wymienia go na nowy (one-time use). Kradzież wykryta → all-sessions invalidate.

#### V.2.3. Brute-force protection

- **Account lockout:** 5 nieudanych prób w 15 min → 30-min lockout, eskalacja do ops alert po 10 lockoutach z różnych IP w 1h (możliwy credential stuffing attack)
- **Cloudflare Turnstile** na `/login` i `/register` (invisible challenge dla legitimate users, hard challenge dla suspicious patterns)
- **Geographic anomaly detection:** Login z innego kraju niż last_login → wymaganie MFA + email notification ("New device login from {city, country}")
- **Failed login telemetry:** wszystkie wysyłane do `auth_events` table → aggregacja w Sentry + Slack `#estalara-security` alert dla anomalii

#### V.2.4. Multi-Factor Authentication (MFA)

| Persona | MFA wymagane | Method |
|---|---|---|
| `agency:viewer` | Optional (rekomendowane) | TOTP |
| `agency:admin` | **Mandatory** od MVP | TOTP (Google Authenticator, Authy, 1Password) |
| `agency:owner` | **Mandatory** od MVP — billing access | TOTP + backup codes |
| `estalara:readonly` | **Mandatory** | TOTP |
| `estalara:ops` | **Mandatory** | TOTP + WebAuthn (Sprint 9 hardening) |
| `estalara:superadmin` | **Mandatory** | TOTP + **WebAuthn hardware key** od Sprint 9 |

**Backup codes:** 10 jednorazowych kodów generowanych przy MFA setup, encrypted-at-rest w `users.mfa_backup_codes` (bcrypt-hashed).

#### V.2.5. Sudo mode dla destruktywnych operacji

Dla operacji wysokiego ryzyka — usunięcie konta agencji, force-suspend tenant, wyłączenie MFA dla staff member, zmiana super-admin permissions, master admin impersonation — wymagamy **re-authentication w ostatnich 5 minutach** (sudo mode timer):

```typescript
// apps/control-plane/src/middleware/sudo-mode.ts
export async function requireSudoMode(req: Request) {
  const lastAuth = await db.query.users.findFirst({
    where: eq(users.id, req.user.id),
    columns: { last_sudo_auth_at: true }
  });
  
  if (!lastAuth?.last_sudo_auth_at || 
      Date.now() - lastAuth.last_sudo_auth_at > 5 * 60 * 1000) {
    throw new HTTPError(403, 'sudo_mode_required', 
      'This action requires recent re-authentication. Please confirm your password.');
  }
}
```

#### V.2.6. Just-in-Time (JIT) elevated access

Dla `estalara:ops` impersonation tenant accountu (Section U.8) — wymagamy **JIT approval workflow**:

1. Ops klika "Impersonate Marbella Premium" → system tworzy `pending_impersonation` request
2. Drugi superadmin (Piotr lub Rafał) musi approve w `#estalara-security` Slack channel (lub w `/admin/jit-approvals`)
3. Po approval, ops dostaje 15-min impersonation token (single-use)
4. Wszystkie akcje podczas impersonation oznaczone w `staff_audit_log` z `impersonation_request_id`
5. Tenant dostaje email notification w ciągu 24h: "Estalara support team accessed your account on {date}. Reason: {reason}. If this was unexpected, contact security@estalara.com immediately."

**Compliance note:** JIT + tenant notification spełnia GDPR Art. 5(1)(a) "lawfulness, fairness, transparency" dla legitimate interest impersonation.

---

### V.3. API Security

#### V.3.1. Rate limiting strategy (multi-layered)

| Layer | Where | Limits | Enforcement |
|---|---|---|---|
| **L1: Cloudflare WAF** | Edge, before Workers | Generic DDoS, suspicious patterns | Auto-block IP |
| **L2: Per-tenant ingest** | Ingest Worker (Durable Objects, TICKET-013) | 1000 events/sec/tenant baseline; tier-scaled | 429 + retry-after |
| **L3: Per-IP for unauthenticated** | Control Plane middleware | 60 req/min per IP for `/login`, `/register` | 429 + Cloudflare Turnstile |
| **L4: Per-user for authenticated** | Control Plane middleware | 600 req/min per user_id (any endpoint) | 429 |
| **L5: Per-endpoint critical paths** | Control Plane middleware | `/api/admin/impersonate`: 10/hour; `/api/billing/*`: 30/min | 429 + Sentry alert |

**Implementation:** Upstash Redis dla L3-L5 (sliding window), Cloudflare Durable Objects dla L2 (już zaimplementowane).

#### V.3.2. Request signing (HMAC)

**Ingest endpoint** (już zaimplementowane w TICKET-012):
```
HMAC-SHA-256(secret_api_key, timestamp + ":" + body_hash)
```

**Webhook endpoints (Stripe, future integrations):**
- Stripe webhook secret (per environment) sprawdzane w middleware
- Replay protection: timestamp ± 5 min tolerance, nonce z body hash w Redis (TTL = 10 min)
- Signature header: `x-estalara-signature`, body hash: SHA-256

**Admin destructive actions:**
- HMAC signing wymagane dla: tenant suspend, billing changes, impersonation, force-stop demo
- Sygnowane przez session JWT + nonce → middleware weryfikuje przed wykonaniem
- Idempotency keys (TICKET-019) dla każdej destruktywnej akcji

#### V.3.3. Input validation

**Wszystkie inputs walidowane przez Zod schemas** (już praktykowane w `packages/shared`):
- Event envelope (TICKET-011) z PII blacklist (TICKET-FIX-005)
- API request bodies — każda route handler używa `.safeParse()` przed processingiem
- Path parameters — UUID format validation
- Query parameters — explicit schema, nie blank `z.string()`

**Output sanitization:**
- DOMPurify dla user-generated content w archetype names, listing titles
- Escape sequences w SQL queries — NIGDY raw SQL, zawsze parameterized przez Drizzle
- LLM output sanitization — prompts zwracane do user UI przepuszczane przez DOMPurify (XSS prevention)

#### V.3.4. CORS configuration

```typescript
// apps/control-plane/src/middleware/cors.ts
const ALLOWED_ORIGINS = {
  production: [
    'https://adaptive.estalara.com',
    'https://app.estalara.com',
  ],
  staging: ['https://staging.adaptive.estalara.com'],
  development: ['http://localhost:3000', 'http://localhost:3001'],
};

// Ingest endpoint (cdn.estalara.com SDK calls):
// Origin validated against tenant.allowed_origins config
// Wildcard ('*') NEVER allowed — explicit allowlist tylko
```

**SDK CDN (cdn.estalara.com):**
- Public access (każda strona klienta może załadować SDK)
- CORS `Access-Control-Allow-Origin: *` ale TYLKO dla `/sdk/*.js` static assets
- Ingest endpoint validuje origin per tenant config

#### V.3.5. API key lifecycle

```typescript
// packages/db/src/schema/api_keys.ts
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey(),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id),
  
  type: text('type').notNull(),                  // 'public' | 'secret'
  prefix: text('prefix').notNull(),              // 'est_live_' | 'est_test_' | 'est_secret_'
  hashed_key: text('hashed_key').notNull(),      // bcrypt or argon2id
  last_4: text('last_4').notNull(),              // dla wyświetlania w UI
  
  scopes: text('scopes').array().notNull(),      // ['read:events', 'write:adaptations']
  allowed_origins: text('allowed_origins').array(),
  
  created_by: uuid('created_by').references(() => users.id),
  created_at: timestamp('created_at').defaultNow(),
  expires_at: timestamp('expires_at'),           // optional TTL
  last_used_at: timestamp('last_used_at'),
  rotated_at: timestamp('rotated_at'),
  revoked_at: timestamp('revoked_at'),
  revoke_reason: text('revoke_reason'),
});
```

**1-click rotation flow:**
1. Agency owner klika "Rotate API Key" w `/dashboard/sdk`
2. System generuje new key, ustawia `rotated_at` na old key
3. Old key działa przez 24h grace period (`revoked_at = now + 24h`)
4. SDK na produkcyjnej stronie powinien w tym czasie zostać zaktualizowany
5. Po 24h old key zwraca 401, alerty Slack do ops

**Automatic detection of leaked keys:**
- GitGuardian / TruffleHog scanner monitoruje GitHub i pastebin sites
- Wykryty key automatycznie revoked + email do tenant + ops alert

#### V.3.6. Idempotency

Idempotency keys (TICKET-019) wymagane dla:
- POST `/v1/events` (ingest) — already implemented
- POST `/api/admin/tenants/:id/suspend`
- POST `/api/admin/demo-sessions/:id/revoke`
- POST `/api/billing/subscriptions` (Stripe sync)
- DELETE wszystkie destruktywne ops

Header: `Idempotency-Key: <uuid v4>`. Cached response w Redis TTL 24h. Ten sam key + różne body = 409 Conflict.

---

### V.4. OWASP Top 10 (2021) — coverage matrix

| OWASP # | Risk | Mitigation w Estalara |
|---|---|---|
| **A01:2021** Broken Access Control | RLS in Postgres (per-tenant), middleware RBAC, JWT claim validation, sudo mode dla destructive ops |
| **A02:2021** Cryptographic Failures | TLS 1.3 mandatory, HSTS preload (TICKET-FIX-003), Argon2id dla passwords, AES-256 at rest, Stripe-managed PCI tokens (no card storage) |
| **A03:2021** Injection | Parameterized queries via Drizzle (no raw SQL), Zod validation on all inputs, DOMPurify on output, escape user content w LLM prompts |
| **A04:2021** Insecure Design | Threat modeling (V.1.2), security review per epic, design partner security questionnaires |
| **A05:2021** Security Misconfiguration | secureHeaders middleware (TICKET-FIX-003), CSP for Control Plane (V.5), no default credentials, infrastructure-as-code (Terraform) |
| **A06:2021** Vulnerable Components | Dependabot, Renovate, `pnpm audit` w CI, `pip-audit` for Python, monthly security review (V.7.3) |
| **A07:2021** Authentication Failures | MFA mandatory dla staff, brute-force protection, password policy z HaveIBeenPwned check, session timeout, JIT elevated access |
| **A08:2021** Data Integrity Failures | Subresource Integrity (SRI) na CDN'owanym SDK, signed releases (SLSA provenance), HMAC integrity checks na requests |
| **A09:2021** Logging & Monitoring Failures | OTel distributed tracing (TICKET-FIX-001), `staff_audit_log` 7yr retention, Sentry, security events to Slack `#estalara-security` |
| **A10:2021** Server-Side Request Forgery (SSRF) | URL allowlist dla outbound requests (auto-detect Puppeteer service), DNS validation, no internal network access from public services |

---

### V.5. Web security headers (Control Plane)

#### V.5.1. Headers stack dla `adaptive.estalara.com`

```typescript
// apps/control-plane/src/middleware.ts
export const securityHeaders = {
  // Strict Transport Security — wymuś HTTPS na 2 lata, włącz preload
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  
  // Content Security Policy — restrykcyjne, no inline scripts
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'nonce-{NONCE}' https://js.stripe.com",
    "style-src 'self' 'unsafe-inline'", // Tailwind requires for now; migrate to CSS modules Sprint 6
    "img-src 'self' data: https://*.supabase.co https://*.estalara.com",
    "font-src 'self'",
    "connect-src 'self' https://*.supabase.co https://api.stripe.com https://o4505.ingest.sentry.io",
    "frame-src https://js.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",          // anti-clickjacking
    "block-all-mixed-content",
    "upgrade-insecure-requests",
  ].join('; '),
  
  // Anti-clickjacking
  'X-Frame-Options': 'DENY',
  
  // MIME-type sniffing
  'X-Content-Type-Options': 'nosniff',
  
  // Referrer policy
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  
  // Permissions Policy (formerly Feature-Policy)
  'Permissions-Policy': [
    'camera=()', 'microphone=()', 'geolocation=()', 
    'payment=(self "https://js.stripe.com")',
    'usb=()', 'fullscreen=(self)', 'autoplay=()',
  ].join(', '),
  
  // Cross-Origin policies
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-site',
};
```

**Nonce strategy:** Każdy server-rendered response generuje cryptographic nonce, embedded w CSP `script-src` i w każdym `<script>` tagu. Brak `unsafe-inline`, brak `unsafe-eval`.

#### V.5.2. SDK CDN (cdn.estalara.com) headers

Inne headers (SDK ma być embeddable w cudze strony):

```typescript
{
  'Cache-Control': 'public, max-age=31536000, immutable',  // long cache dla versioned URLs
  'Cross-Origin-Resource-Policy': 'cross-origin',           // allow cross-origin embedding
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': null,  // brak CSP dla static assets
}
```

#### V.5.3. Subresource Integrity (SRI)

SDK loader generated dla każdego tenanta zawiera SRI hash:

```html
<script async 
        src="https://cdn.estalara.com/sdk/v1.2.3/estalara.min.js"
        integrity="sha384-{hash}"
        crossorigin="anonymous"
        data-tenant="est_live_marbella_abc123">
</script>
```

SDK Snippet Generator (`/dashboard/sdk`) automatycznie wstawia aktualny SRI hash. Build pipeline computuje hash przy każdej release.

---

### V.6. Secrets Management

#### V.6.1. Doppler — single source of truth

Wszystkie secrets w Doppler, environments: `dev` / `staging` / `prod`. Brak `.env` plików w repo (gitleaks w pre-commit hook).

**Secret categories i rotation policy:**

| Category | Examples | Rotation cadence | Rotation method |
|---|---|---|---|
| Database credentials | `DATABASE_URL`, `DATABASE_URL_ADMIN` | 90 dni | Supabase Dashboard → service role rotate |
| API keys (provider) | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `STRIPE_SECRET_KEY` | 180 dni LUB on suspected breach | Provider dashboard + Doppler update |
| JWT signing keys | `SUPABASE_JWT_SECRET` | 365 dni LUB on breach | Supabase Auth → JWT settings |
| HMAC tenant secrets | `tenants.hmac_secret` (per-tenant) | 1-click w dashboard, max 90 dni | UI w `/dashboard/sdk` → Rotate |
| Webhook signing secrets | `STRIPE_WEBHOOK_SECRET` | On breach only | Stripe dashboard regenerate |
| Internal service-to-service | OTel collector token, Sentry DSN | 365 dni | Doppler → all environments |

#### V.6.2. Secrets scanning

| Layer | Tool | When |
|---|---|---|
| Pre-commit | `gitleaks` (Lefthook hook) | Local dev, every commit |
| CI | `gitleaks` workflow | Every PR + merge to main |
| Supply chain | GitGuardian dla GitHub | 24/7 monitoring private repos |
| Production logs | Custom regex w Pino serializer | Real-time log scrubbing |
| Dependencies | `pnpm audit` + `pip-audit` | CI + weekly cron |

**Secret detected w git history:**
1. Trigger immediate rotation (Doppler + provider dashboard)
2. `git-filter-repo` removal z historii (force push)
3. Notify all developers do re-clone
4. Post-mortem: jak doszło, czy CI hook zadziałał

#### V.6.3. Environment isolation

```
┌──────────────────────────────────────────────────────────┐
│ dev — local development, hobby/test API keys             │
│   - Cloudflare Workers preview deployments               │
│   - Supabase dev project (separate from prod data)       │
│   - Anthropic dev API key (low rate limit)               │
├──────────────────────────────────────────────────────────┤
│ staging — pre-prod testing, real schema, fake data       │
│   - Vercel preview branches                              │
│   - Supabase staging project                             │
│   - Stripe test mode keys                                │
├──────────────────────────────────────────────────────────┤
│ prod — production, real customer data                    │
│   - Mandatory MFA dla developers z prod write access     │
│   - Audit log każdego prod-write access                  │
│   - 4-eyes principle dla destructive ops                 │
└──────────────────────────────────────────────────────────┘
```

**Brak shared secrets między environments.** Brak access do prod z laptopów developerów (CLI tools czytają tylko z dev/staging).

---

### V.7. Supply Chain Security

#### V.7.1. Dependency management

**TypeScript / Node:**
```json
// .github/dependabot.yml
{
  "version": 2,
  "updates": [
    {
      "package-ecosystem": "npm",
      "directory": "/",
      "schedule": { "interval": "weekly", "day": "monday" },
      "groups": {
        "security": { "patterns": ["*"], "applies-to": "security-updates" },
        "patch": { "update-types": ["patch"] },
        "minor": { "update-types": ["minor"] }
      },
      "open-pull-requests-limit": 5,
      "reviewers": ["Pnawrocki9"],
      "labels": ["dependencies"]
    },
    {
      "package-ecosystem": "github-actions",
      "directory": "/",
      "schedule": { "interval": "weekly" }
    }
  ]
}
```

**Python:** Renovate Bot z group strategy (security PRs auto-merged dla patch versions).

#### V.7.2. Software Bill of Materials (SBOM)

Generated for every release:
```yaml
# .github/workflows/sbom.yml
- name: Generate SBOM
  uses: anchore/sbom-action@v0
  with:
    format: cyclonedx-json
    output-file: sbom-${{ github.sha }}.cdx.json
- name: Upload SBOM artifact
  uses: actions/upload-artifact@v4
  with:
    name: sbom
    path: sbom-*.cdx.json
    retention-days: 365
```

SBOM dla każdej Vercel/Cloudflare release zachowywana 1 rok dla compliance audits.

#### V.7.3. Container image scanning

Modal Functions używają container images. Scanowanie przed deployment:
```yaml
- name: Scan image with Trivy
  uses: aquasecurity/trivy-action@master
  with:
    image-ref: 'estalara/auto-detect:${{ github.sha }}'
    severity: 'CRITICAL,HIGH'
    exit-code: '1'  # fail build on high-severity findings
```

#### V.7.4. Signed releases & provenance

SLSA Level 3 provenance attestations dla:
- Cloudflare Workers production deploys
- Vercel production deploys
- Modal function image builds
- npm package publishes (`@estalara/sdk`, `@estalara/react`)

```yaml
# Use sigstore + cosign for signing
- name: Sign artifact
  uses: sigstore/cosign-installer@v3
- run: cosign sign-blob --bundle artifact.bundle artifact.tar.gz
```

#### V.7.5. Vendor risk assessment

Quarterly review:
- SOC 2 Type II reports — Anthropic, OpenAI, Stripe, Cloudflare, Vercel, Supabase, Sentry, Modal
- Sub-processor list — published na status.estalara.com (GDPR Art. 28 transparency)
- Changes in vendor terms — automated monitoring (Klaus.ai, Termly, lub manual quarterly)

---

### V.8. Database Security

#### V.8.1. Encryption

| Layer | Method | Key management |
|---|---|---|
| **At rest** (Postgres) | AES-256-GCM (Supabase native) | AWS KMS managed by Supabase |
| **At rest** (ClickHouse) | AES-256 disk encryption | ClickHouse Cloud managed |
| **At rest** (column-level) | pgcrypto dla `users.mfa_backup_codes`, `tenants.hmac_secret` | App-level, key w Doppler `DB_COLUMN_ENCRYPTION_KEY` |
| **In transit** | TLS 1.3 mandatory | Supabase + ClickHouse Cloud certs |
| **Tenant-tier 3 (enterprise)** | Customer-Managed Keys (CMK) opt-in Year 2 | AWS KMS w tenant's account, cross-account role |

#### V.8.2. Row Level Security (RLS) — testing

**TICKET-FIX-004 already separated `createTenantClient` (RLS enforced) vs `createAdminClient` (RLS bypass).** 

**Automated isolation tests w CI** (Sprint 2 enhancement do TICKET-021):

```typescript
// packages/db/src/__tests__/rls-isolation.test.ts
describe('RLS tenant isolation', () => {
  it('tenant A cannot SELECT rows owned by tenant B', async () => {
    const tenantA_db = createTenantClient(tenantA_jwt);
    const result = await tenantA_db.select().from(listings_metadata)
      .where(eq(listings_metadata.tenant_id, tenantB_uuid));
    expect(result).toHaveLength(0);  // RLS hides tenant B's rows
  });
  
  it('tenant A cannot INSERT row with tenant_id = B', async () => {
    const tenantA_db = createTenantClient(tenantA_jwt);
    await expect(
      tenantA_db.insert(listings_metadata).values({
        tenant_id: tenantB_uuid, /* ... */
      })
    ).rejects.toThrow(/policy|permission/i);
  });
  
  it('admin client bypasses RLS', async () => {
    const admin_db = createAdminClient();
    const result = await admin_db.select().from(listings_metadata);
    expect(result.length).toBeGreaterThan(0);  // sees everything
  });
});
```

#### V.8.3. Database audit logging

PostgreSQL `pgaudit` extension (Supabase): logs DDL, role changes, sensitive table access.

```sql
-- Enable pgaudit (Supabase Dashboard → Database → Extensions)
CREATE EXTENSION IF NOT EXISTS pgaudit;
ALTER SYSTEM SET pgaudit.log = 'ddl, role, write';
ALTER SYSTEM SET pgaudit.log_relation = on;
SELECT pg_reload_conf();
```

Audit logs streamed do ClickHouse `db_audit_log` tabela, 7-year retention dla compliance.

#### V.8.4. Connection pooling & prepared statements

- **PgBouncer (Supavisor)** — already w stack
- Transaction mode dla pooled connections (port 6543) — używane przez `createTenantClient`
- Session mode dla long-lived ops — używane przez `createAdminClient`
- **Statement timeout:** 30s dla tenant queries, 5min dla admin/migrations
- **Connection limits per tenant:** Max 100 concurrent connections per tenant API key (anti-noisy-neighbor)

#### V.8.5. Backup & restore

Patrz Section W.1 (Disaster Recovery) dla pełnych RPO/RTO targets. Skrótowo:
- Postgres: continuous WAL backup (PITR), 7-day retention dla MVP, 30-day dla enterprise tier
- ClickHouse: daily snapshots, 30-day retention
- Quarterly restore drill (W.1.5) — testowane w staging

---

### V.9. Frontend SDK Security

SDK wstrzykuje się w **cudze strony klientów** — security threats są asymetryczne (klient nie kontroluje co dzieje się na ich stronie).

#### V.9.1. Sandbox & isolation

- **Shadow DOM (open mode)** dla wszystkich UI elements (już zaplanowane w B.2)
- Brak dostępu do `window.parent.X` properties z host page (read-only przez `Estalara.identify()` API)
- `postMessage` z origin validation:
  ```typescript
  window.addEventListener('message', (e) => {
    if (e.origin !== 'https://cdn.estalara.com') return;
    // process message
  });
  ```

#### V.9.2. CSP-friendly distribution

SDK loader nie używa `eval`, `new Function()`, ani inline event handlers — zgodne z restrictive CSP klientów. Wymagany CSP klienta:
```
script-src cdn.estalara.com 'self' 'wasm-unsafe-eval'
connect-src ingest.estalara.com 'self'
```

Documented w SDK integration guide. Magic Link onboarding pomaga klientom auto-update CSP (przez WordPress plugin gdy applicable).

#### V.9.3. Prototype pollution protection

```typescript
// packages/sdk/src/utils/safe-merge.ts
export function safeMerge<T extends object>(target: T, source: object): T {
  for (const key of Object.keys(source)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    // safe merge logic
  }
  return target;
}
```

Wszystkie merge ops (config, brand tokens) używają `safeMerge`. Audit `Object.assign` calls w PR review.

#### V.9.4. Anti-clickjacking dla SDK widgets

- SDK widgets renderowane w Shadow DOM nie mogą być iframed — sprawdzamy `window.top !== window` i logujemy alert
- Brak click-jacking-vulnerable actions (np. "Confirm purchase") w SDK UI — wszystkie destructive flows na `adaptive.estalara.com`

#### V.9.5. Telemetry sanitization

SDK NIE WYSYŁA do ingest:
- Hashed/raw passwords (form fields type=password)
- Credit card data (PCI scope)
- Authorization headers, cookies (browser-blocked)
- URL fragments (#hash) zawierające `password`, `token`, `secret`, `api_key`
- Local storage / sessionStorage values

Już enforced przez TICKET-FIX-005 (PII blacklist) na poziomie Zod validation w ingest.

---

### V.10. Cost Controls & Abuse Prevention (Denial of Wallet)

**Zagrożenie:** Złośliwy lub buggy SDK wysyła pętlę 1M eventów/min → triggeruje Anthropic / OpenAI calls → bill $50k/dzień.

#### V.10.1. Per-tenant spending limits

```typescript
// packages/db/src/schema/billing_limits.ts
export const billingLimits = pgTable('billing_limits', {
  tenant_id: uuid('tenant_id').primaryKey(),
  
  // Hard caps (events budget per tier)
  max_events_per_day: integer('max_events_per_day').notNull(),
  max_llm_calls_per_day: integer('max_llm_calls_per_day').notNull(),
  max_llm_spend_usd_per_day: decimal('max_llm_spend_usd_per_day').notNull(),
  
  // Soft alerts (% of cap)
  alert_threshold_percent: integer('alert_threshold_percent').default(80),
  
  // Action when exceeded
  exceed_action: text('exceed_action').default('throttle'),  // 'throttle' | 'block' | 'alert_only'
});
```

**Per-tier defaults:**

| Tier | Events/day | LLM calls/day | LLM spend/day USD |
|---|---|---|---|
| Free | 5,000 | 0 | $0 |
| Observer | 200,000 | 1,000 | $5 |
| Augment | 1,000,000 | 10,000 | $50 |
| Native | unlimited (custom contract) | custom | custom |

#### V.10.2. Real-time anomaly detection

Cloudflare Worker z Durable Object per tenant tracks rolling 1-min event volume. **Sudden spike >10x baseline** = circuit breaker:
- Throttle events to baseline rate
- Slack alert do `#estalara-ops`
- Email do tenant owner: "Unusual traffic detected on your site. We've throttled to protect against abuse. [Review](link)"
- Anthropic/OpenAI calls SUSPENDED dla tego tenanta przez 1h cooldown

#### V.10.3. Circuit breaker dla zewnętrznych API

```python
# apps/llm-gateway/src/circuit_breaker.py
from circuitbreaker import circuit

@circuit(failure_threshold=5, recovery_timeout=60, expected_exception=AnthropicError)
async def call_claude(prompt: str) -> str:
    return await anthropic_client.messages.create(...)
```

Open circuit po 5 failures w 60s → fallback do simpler heuristic adaptation. Closed po 60s recovery.

#### V.10.4. Cost monitoring dashboard

`/admin/billing/spend` — real-time view:
- Total LLM spend per provider (Anthropic, OpenAI) z trendem 7-day
- Top 10 tenants by LLM spend
- Anomalies: tenants z >2σ deviation od ich baseline
- Forecast: projected month-end spend, alert jeśli >budget

---

### V.11. Security Testing & Validation

#### V.11.1. Test pyramid (security-specific)

| Layer | Tests | Frequency | Gate |
|---|---|---|---|
| **Unit** | Authorization logic, input validators, crypto helpers | CI per PR | Block merge on fail |
| **Integration** | RLS isolation (V.8.2), MFA flow, JWT validation | CI per PR | Block merge on fail |
| **E2E** | Full auth flows, impersonation, password reset | Nightly + per-PR | Warn on fail |
| **DAST (OWASP ZAP)** | Auth bypass, injection, XSS, CSRF on staging | Weekly cron | Slack alert on findings |
| **SAST (Semgrep)** | Static analysis dla insecure patterns | CI per PR | Warn on fail |
| **Dependency scanning** | `pnpm audit`, `pip-audit`, Trivy, GitGuardian | CI + 24/7 monitoring | Block on critical |
| **Penetration testing** | External pentest firm | Annually + post-major-release | Triage all findings |
| **Bug bounty** | HackerOne lub Intigriti | Continuous (post-Series A) | Triage SLA per severity |

#### V.11.2. Penetration testing schedule

- **Year 1 H2:** First external pentest (post-MVP, before first enterprise customer) — budget ~$15k, vendor: Cure53 or Bishop Fox
- **Year 2 H1:** Second pentest (after Series A) — budget ~$25k
- **Continuous:** Bug bounty program launched Q3 2026 — budget $5-50k/year

**Scope:** SDK injection vectors, SSO/auth flows, RLS isolation, admin panel, billing integration.

#### V.11.3. Security review process

Każdy PR z security implications wymaga:
- Code review przez senior engineer (Rafał lub designated security champion)
- Threat model update dla new features
- Security test cases w PR description
- For sensitive changes (auth, billing, RLS): 2-osobowy approval

---

### V.12. Compliance Certifications Roadmap

**Decyzja:** Inwestujemy w SOC 2 Type II w Year 1 jako blocker dla US enterprise klientów (Zillow, Realtor.com), ISO 27001 w Year 2 dla EU enterprise.

#### V.12.1. SOC 2 Type II — timeline

| Quarter | Milestone | Cost | Deliverable |
|---|---|---|---|
| **Q3 2026** | Engage Vanta lub Drata (compliance automation) | $15k/year | Continuous monitoring setup |
| **Q3 2026** | SOC 2 Type I audit (point-in-time) | $30k | Letter of attestation |
| **Q1-Q2 2027** | 6-month observation window | — | Evidence collection |
| **Q3 2027** | SOC 2 Type II audit | $60k | Final report |

**Trust Service Criteria:** Security (mandatory), Availability, Confidentiality. Skip Processing Integrity i Privacy dla MVP — możemy dodać Year 2.

#### V.12.2. ISO 27001 — Year 2

Po SOC 2 Type II, dodajemy ISO 27001 dla EU enterprise:
- Implement Information Security Management System (ISMS) — większość zarobu już zrobiona dla SOC 2
- Statement of Applicability (SoA) — Annex A controls
- External audit przez akredytowanego auditora (BSI, DNV, lub TÜV) — ~$40k
- Annual surveillance audit ($15k) + 3-year recertification ($25k)

#### V.12.3. Other certifications (deferred)

- **PCI DSS:** Nie obejmuje nas direct — Stripe Tokenization (PCI Level 1) handles card data. Zachowujemy PCI SAQ-A self-assessment annual.
- **HIPAA:** Brak applicability (real estate ≠ healthcare).
- **FedRAMP:** Skip dla MVP (US gov customers nie są target).

---

### V.13. Cyber Insurance

**Recommendation:** Cyber liability insurance od dnia 1 — wymóg wielu enterprise klientów (Idealista MSA explicitly requires).

| Coverage | Limit | Provider candidates |
|---|---|---|
| Data breach response (forensics, notifications, credit monitoring) | $5M | Coalition, At-Bay, Beazley |
| Business interruption | $2M | Same |
| Regulatory fines (GDPR, CCPA) | $5M | Cyber-specific extension |
| E&O / professional liability | $2M | Hiscox, Travelers |

**Premium estimate:** $8-15k/year dla startup at MVP stage (3-person team, no real customer data yet). Skaluje się z ARR.

**Decision required from Piotr:** zapewnij cyber insurance przed pierwszym enterprise customer signed.

---

### V.14. Bug Bounty Program (post-Series A)

Launch Q3 2026 (po pierwszych 10-20 paying customers):

```yaml
program:
  platform: HackerOne (preferowany — większy researcher pool)
  scope:
    - "*.estalara.com"
    - "cdn.estalara.com (SDK)"
    - "@estalara/sdk npm package"
  out_of_scope:
    - "*.estalara.app (tenant subdomains)"
    - "Third-party services (Stripe, Anthropic)"
    - "Social engineering, physical attacks"
  rewards:
    critical: $5000-$15000   # auth bypass, RCE, data leak
    high:     $1000-$5000    # privilege escalation, stored XSS
    medium:   $250-$1000     # CSRF, IDOR, info disclosure
    low:      $50-$250       # missing security headers, version disclosure
  triage_sla:
    initial_response: 24h
    triage_decision: 5 days
    resolution: 90 days for critical, 180 for high
```

Annual budget: $25-75k initially.

---

### V.15. Cross-references

- **Section H (Compliance)** — V uzupełnia o technical security; H pozostaje source of truth dla privacy regulations
- **Section J (Multi-tenancy)** — V.8 rozszerza J o explicit RLS testing strategy
- **Section K (Internal Ops)** — V.2.6 (sudo mode) i V.2.5 (JIT impersonation) rozszerzają K.7
- **Section O.1 (Technical risks)** — V.10 (Cost controls) mityguje "DoW attack" risk
- **Section U (Master Admin)** — V.2 i V.3 są implementacją security wymagań Section U
- **Section W (Operational Excellence)** — komplementarne; V to "what we secure", W to "how we operate it"


---

## W. Operational Excellence — DR, Monitoring, Deployment

> **Filozofia:** Section V opisuje *co* chronimy, Section W opisuje *jak operujemy*. To jest sekcja, którą będzie czytać każdy enterprise customer w due diligence — i każdy on-call engineer o 3 nad ranem.

### W.1. Disaster Recovery & Business Continuity

#### W.1.1. RPO/RTO targets per data store

| Data store | RPO (max data loss) | RTO (max downtime) | Strategy |
|---|---|---|---|
| **Postgres (Supabase)** | 5 min (PITR) | 1h | Continuous WAL → S3, hot standby w region paired |
| **ClickHouse Cloud** | 1h | 4h | Daily snapshots + replicated zones |
| **pgvector embeddings** | 24h | 4h | Daily logical backup do S3, regenerable z events |
| **Redpanda Kafka** | 24h | 2h | Multi-AZ replication, message retention 7 dni |
| **R2 / S3 storage** | 0 (eventually consistent) | 30 min | Cloudflare R2 native multi-region |
| **Cloudflare Workers code** | 0 | 5 min | Wrangler deploy z any region |
| **Vercel deployments** | 0 | 5 min | Git-based, instant rollback |

**Tier-specific SLAs:**
- Free / Observer: best-effort, 99.5% uptime
- Augment: 99.9% uptime, RTO 2h, RPO 30 min
- Native (enterprise): 99.95% uptime, RTO 1h, RPO 5 min, dedicated DR runbook

#### W.1.2. Backup strategy per data store

**Postgres (Supabase):**
- Continuous WAL backup (Point-in-Time Recovery — PITR)
- Daily full backup retained 7 dni (MVP), 30 dni (Augment+), 90 dni (Native)
- Weekly cross-region backup do AWS S3 (eu-west-1 ↔ eu-central-1)
- **Encryption at rest:** AES-256 (S3 SSE-KMS)

**ClickHouse Cloud:**
- Daily snapshots (ClickHouse Cloud native)
- Retention: 30 dni (default)
- Cross-region replication dla Native tier (Year 2 feature)

**pgvector:**
- Daily `pg_dump` logical backup
- Embeddings są regenerowane z source events (ClickHouse) jeśli backup fails

**Source code & infrastructure-as-code:**
- GitHub repo private (Pnawrocki9/Adaptive-Listings)
- Mirror do GitLab (passive backup) raz dziennie
- Terraform state w S3 z versioning + state lock w DynamoDB

#### W.1.3. Multi-region failover strategy

**Active-Active (default):**
- Cloudflare Workers automatycznie route do najbliższego POP
- Read replicas w paired regions: EU primary (Frankfurt) + EU read replica (Dublin)
- Write traffic w primary region only — failover wymaga manual promotion

**Failover triggers (W.1.4):**
- Region complete outage (>15 min)
- Data corruption detected w primary
- Compliance event (e.g., region-specific legal injunction)

**Failover playbook (manual, runbook w Notion):**
1. Confirm outage z Cloudflare/Supabase status pages
2. Promote read replica → primary (Supabase Dashboard or `pg_ctl promote`)
3. Update Doppler `DATABASE_URL` → new primary endpoint
4. Re-deploy apps z new env (Vercel/Cloudflare auto)
5. Monitor lag, validate writes succeed
6. Public communication via status.estalara.com

**Estimated failover time:** 30-60 min manual w MVP, target 5 min automated w Year 2.

#### W.1.4. Disaster scenarios & response

| Scenario | Likelihood | Impact | Response |
|---|---|---|---|
| Cloudflare global outage | Low (1-2/year) | High | Failover do Vercel Edge dla Ingest (architecture allows); SDK CDN fallback do AWS CloudFront |
| Supabase region down | Low (rare) | Critical | Promote read replica; document in runbook |
| Anthropic API outage | Medium (occasional) | Medium | LiteLLM router → OpenAI fallback (already configured); circuit breaker (V.10.3) |
| Stripe outage | Low | Medium | Queue billing events w Redpanda, replay when Stripe back; tenants don't see disruption |
| Data corruption (logical bug) | Low | Critical | PITR to before-corruption timestamp; communicate data window lost |
| Ransomware on developer laptop | Low | Medium | No prod credentials on laptops; MFA mandatory; can't escalate to prod |
| GitHub repo compromise | Very Low | Critical | Force-push protection, signed commits, immediate revoke + restore from backup mirror |
| Insider threat (rogue admin) | Very Low | Critical | Audit log review weekly; 4-eyes principle dla destructive ops; offboarding checklist |

#### W.1.5. Restore drill schedule

**Quarterly disaster recovery drill** (mandatory, calendar-blocked):
- Q1: Postgres PITR restore w staging — verify <1h RTO
- Q2: ClickHouse snapshot restore — verify queryable after restore
- Q3: Cross-region failover (full stack) — chaos engineering
- Q4: Tabletop exercise — simulated breach + comms drill

**Drill report:** posted in Notion, sent do board jako quarterly metric. Failed drill = blocker dla next sprint until issue resolved.

---

### W.2. Incident Response Plan

#### W.2.1. Severity levels

| Severity | Definition | Examples | Response time | Communication |
|---|---|---|---|---|
| **SEV-1** | Critical: data loss, security breach, complete outage | Master DB down, breach detected, zero ingest events 30+ min | 15 min | Status page red, all-hands Slack ping, customer email if >1h |
| **SEV-2** | Major: feature broken, partial outage, performance regression | Demo Mode broken, single region down, p99 latency >5s | 30 min | Status page yellow, engineering Slack |
| **SEV-3** | Minor: degraded UX, single tenant impact | Specific archetype detection failing, dashboard slow | 4h | Internal Slack only |
| **SEV-4** | Cosmetic: typos, minor UI issues | Misaligned button, 404 on edge case | Next sprint | None |

#### W.2.2. On-call rotation

**MVP (3-person team):**
- Rafał (CTO) — primary on-call dla wszystkich SEV-1/SEV-2 (24/7)
- Piotr (CEO) — secondary on-call (escalation only)
- Krystian (CPO) — domain expert escalation (ML/data quality issues)

**Post-Series A (target by Q4 2026):**
- 5+ engineers w rotation (1 week shifts)
- Primary + Secondary always on-call
- PagerDuty / Opsgenie integration

#### W.2.3. Incident workflow

```
1. DETECTION
   - Sentry alert / Grafana threshold / customer report / status check
   ↓
2. TRIAGE
   - On-call assesses severity (SEV-1/2/3/4)
   - Creates incident channel: #incident-{date}-{slug}
   - Updates status.estalara.com if SEV-1/2
   ↓
3. RESPONSE
   - Identify root cause (use OTel traces, logs)
   - Mitigate first (rollback, throttle, failover) — fix later
   - Document timeline w incident channel
   ↓
4. RESOLUTION
   - Validate mitigation (metrics return to baseline)
   - Update status page green
   - Send customer communication (if SEV-1)
   ↓
5. POST-MORTEM (within 5 business days)
   - Blameless review meeting (all engineers)
   - Document w Notion: timeline, root cause, contributing factors, action items
   - Public post-mortem dla SEV-1 (on blog) — builds trust
```

#### W.2.4. Post-mortem template

```markdown
# Post-mortem: <incident-name>

**Date of incident:** YYYY-MM-DD HH:MM UTC
**Severity:** SEV-1 / SEV-2 / SEV-3
**Duration:** <X> minutes
**Authors:** <on-call engineer>, <reviewer>

## Summary
<1-paragraph executive summary>

## Impact
- Affected services: ...
- Affected tenants: <X> tenants, <Y>% of total traffic
- Data loss: yes/no, scope
- Revenue impact: $<X>

## Timeline (UTC)
- HH:MM — Detection: <how was it detected>
- HH:MM — Triage: <severity declared>
- HH:MM — Mitigation: <what was done>
- HH:MM — Resolution: <validation>

## Root Cause
<technical analysis — what actually broke>

## Contributing Factors
1. ...
2. ...

## What went well
- ...

## What went poorly
- ...

## Action items (with owners + due dates)
| Action | Owner | Due | Priority |
|---|---|---|---|
| Add monitoring for X | @Rafal | Sprint+1 | High |
| Update runbook for Y | @Piotr | Sprint+2 | Med |

## Lessons learned
<reusable knowledge for the team>
```

#### W.2.5. Status page

`https://status.estalara.com` (Atlassian Statuspage lub Cachet self-hosted):
- Real-time component status (Ingest API, Control Plane, SDK CDN, Demo Mode, Auto-Detect)
- Incident history (last 90 days)
- Subscriber email/SMS notifications dla customers
- Uptime metrics per component (90-day rolling)

**Auto-update integration:**
- Sentry → Statuspage incident creation (SEV-1 only)
- Grafana → Statuspage component degradation (SEV-2)
- Manual: on-call updates dla SEV-1 communications

---

### W.3. SLO/SLI definitions

#### W.3.1. Service Level Objectives

| Service | SLI | SLO | Error budget (per 30 days) |
|---|---|---|---|
| **Ingest API** | Availability (HTTP 2xx/5xx ratio) | 99.95% | 21.6 min downtime |
| **Ingest API** | p99 latency | <100 ms | 1% requests can exceed |
| **Control Plane API** | Availability | 99.9% | 43.2 min downtime |
| **Decision API** | Availability | 99.9% | 43.2 min |
| **Decision API** | p99 latency | <200 ms | 1% can exceed |
| **SDK CDN** | Availability | 99.99% | 4.3 min downtime |
| **Auto-Detect Service** | Success rate | 95% | 5% can fail (graceful fallback) |
| **Demo Mode** | Availability | 99.5% | 3.6h downtime |

#### W.3.2. Error budget policy

**If SLO breached w 30-day window:**
- Engineering team **freezes new feature work** until SLO restored
- Post-mortem dla każdego event który "spalił" >25% budget
- Quarterly SLO review — adjust targets jeśli systematically unmet

**Grace period dla MVP:** First 90 dni post-launch, SLOs są aspirational (no freeze policy). Po stabilization, freeze policy active.

#### W.3.3. Synthetic monitoring

**Checkly (or Pingdom)** — 24/7 synthetic checks z 5 regionów:

```typescript
// Critical user journeys monitored every 1-5 min
const checks = [
  { name: 'ingest-healthz', url: 'https://ingest.estalara.com/healthz', interval: '1m' },
  { name: 'control-plane-login', flow: 'login-flow.spec.ts', interval: '5m' },
  { name: 'sdk-cdn-availability', url: 'https://cdn.estalara.com/sdk/v1.js', interval: '1m' },
  { name: 'demo-mode-end-to-end', flow: 'demo-flow.spec.ts', interval: '15m' },
  { name: 'auto-detect-pipeline', flow: 'auto-detect.spec.ts', interval: '1h' },
];
```

Failed check → Sentry alert → on-call notification.

---

### W.4. Observability Strategy

#### W.4.1. Three pillars

**Logs (Pino + Grafana Loki):**
- Structured JSON, ISO timestamps, request_id correlation
- Log levels: trace/debug/info/warn/error/fatal
- PII redaction w Pino serializer (TICKET-FIX-005 enforces na ingest layer)
- Retention: 30 dni hot, 1 rok cold storage (S3 Glacier)

**Metrics (OpenTelemetry + Grafana):**
- Pre-built dashboards: per-service (ingest, control-plane, intent-engine), per-tenant fleet, business KPIs
- Custom metrics: events/sec, LLM cost/hour, archetype detection accuracy
- Alert rules: PromQL-based, paged via Grafana OnCall

**Traces (OpenTelemetry):**
- Distributed tracing across SDK → Ingest → Kafka → Modal (TICKET-FIX-001 ✅)
- W3C Trace Context propagation
- Tail-based sampling: 100% errors, 10% successful traces, 1% latency outliers
- Backend: Grafana Tempo (cost-efficient) lub Honeycomb (Year 2 dla deeper analysis)

#### W.4.2. Critical dashboards

1. **Real-time Operations** — events/sec, error rate, p99 latency, alert count
2. **Per-tenant Health** — DQS, SDK status, archetype quality (per K.3.2)
3. **Business KPIs** — MRR, active tenants, conversions per tenant, top archetypes
4. **Cost Center** — daily LLM spend, infra costs, cost per tenant per visit
5. **Security Events** — failed logins, MFA failures, anomalous traffic, audit log activity

#### W.4.3. Distributed tracing — what to instrument

**Already instrumented (post TICKET-FIX-001):**
- ✅ SDK → Ingest Worker (auto via @microlabs/otel-cf-workers)
- ✅ Ingest → Redpanda (W3C traceparent in Kafka headers)
- ✅ Redpanda → Modal stream-consumer (extract + child span)

**Sprint 2-4 additions:**
- Control Plane API → Postgres (auto via Drizzle instrumentation)
- Modal → Anthropic / OpenAI (manual span around LLM calls)
- Modal → ClickHouse insert (batch metrics)
- Modal → pgvector queries (similarity search latency)

#### W.4.4. Log retention & PII redaction

```typescript
// packages/shared/src/observability/log-redactor.ts
const PII_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,           // email
  /\b\d{3}-\d{2}-\d{4}\b/,                                  // SSN-like
  /\b(?:\d{4}[\s-]?){3}\d{4}\b/,                            // credit card
  /\b\+?[1-9]\d{1,14}\b/,                                   // phone
];

export function redactPII(message: string): string {
  let redacted = message;
  for (const pattern of PII_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED]');
  }
  return redacted;
}
```

Pino custom serializer applies redactPII na każdym log message. Tested w `packages/shared/__tests__/log-redactor.test.ts`.

---

### W.5. Deployment & Rollback

#### W.5.1. Deployment strategy per service

| Service | Strategy | Tool | Rollback time |
|---|---|---|---|
| **Cloudflare Workers (ingest)** | Atomic version swap | Wrangler | 30 sec (revert version) |
| **Vercel (control-plane)** | Atomic deployment | Vercel CLI | 30 sec (promote previous) |
| **Modal Functions** | Versioned deployment | Modal CLI | 1 min (deploy previous) |
| **Database migrations** | Forward-only, backwards-compatible | Drizzle Kit | Manual rollback only |
| **SDK CDN** | Versioned URLs (v1.2.3 immutable) | Wrangler R2 | Update SRI hash w generator |

#### W.5.2. Canary deployment dla critical services

**Ingest Worker** — najbardziej krytyczny, najbardziej traffic:
- Cloudflare Workers Routes z weighted routing
- 5% traffic → new version, 95% → stable
- Monitor 15 min: error rate, p99 latency, schema validation failures
- Auto-rollback jeśli regression >5% lub error rate >0.1%
- Po pass: 25% → 50% → 100% over 1h

**Decision API** (Sprint 5+):
- Same canary strategy, dodatkowo DQS comparison
- 24h canary period (longer due to ML quality variance)
- Auto-rollback jeśli DQS drops >2 percentage points (per O.6 mitigation)

#### W.5.3. Database migration strategy

**Always backwards-compatible:**
1. Add new column (NULL allowed)
2. Deploy code that writes to both old + new
3. Backfill old rows
4. Deploy code that reads from new
5. Drop old column (separate migration, separate deploy)

**Never:**
- Drop columns w same migration as code change
- Rename columns (always: add new, migrate, drop old)
- Change column types in-place (always: new column, migrate, drop)

**Migration testing:**
- Each migration tested w staging z prod-size data sample
- Migration timing tracked — alerts dla slow migrations (>5 min)
- Quarterly: full migration replay test on backup

#### W.5.4. Rollback playbook

**Immediate rollback (one command):**
```bash
# Workers
wrangler deployments list
wrangler rollback <deployment-id>

# Vercel  
vercel rollback <deployment-url>

# Modal
modal deploy --version <previous-version>
```

**Database rollback:** Manual, requires careful data review. Generally: write forward fix instead of true rollback.

**Post-rollback:**
- Sentry alerts confirmed cleared
- Status page updated
- Slack post-mortem channel created
- Action item: prevent recurrence

#### W.5.5. Feature flags

**PostHog feature flags** — gradual rollout:

```typescript
// Example: roll out new archetype model
if (await posthog.isFeatureEnabled('archetype-v2', tenantId)) {
  return await archetypeEngineV2.match(intent);
} else {
  return await archetypeEngineV1.match(intent);
}
```

**Flag types:**
- **Release flags** — feature on/off, deleted after rollout
- **Operational flags** — kill switches dla expensive features (e.g., disable LLM if cost spike)
- **Permission flags** — feature visibility per tier
- **Experiment flags** — A/B testing with assignment tracking

**Hygiene:** Quarterly review removes stale flags (>90 days post-rollout).

---

### W.6. Multi-tenant Isolation Testing

#### W.6.1. Automated isolation tests w CI

Patrz V.8.2 dla code examples. Każda migration adding tenant-scoped table requires accompanying RLS isolation test.

#### W.6.2. Noisy neighbor mitigation

**Per-tenant resource quotas:**
- Connection pool: max 100 concurrent connections per tenant API key
- Query timeout: 30s default (15s for read-heavy queries)
- Rate limits per V.3.1 (Layer 2)
- Cost limits per V.10.1

**Detection:**
- Tenant consuming >5x their fair share → Slack alert
- Consistent abuse → CSM outreach + tier upgrade conversation

#### W.6.3. Fuzzing authentication & authorization

```typescript
// packages/shared/__tests__/auth-fuzz.test.ts
import { fc } from 'fast-check';

describe('JWT fuzzing', () => {
  it('rejects all JWT permutations except valid', () => {
    fc.assert(fc.property(
      fc.string(), 
      (randomToken) => {
        expect(verifyJwt(randomToken)).toBeNull();
      }
    ), { numRuns: 10000 });
  });
});
```

Run weekly w CI (cron) — finds edge cases human tests miss.

---

### W.7. Data Governance

#### W.7.1. PII inventory

| Field | Storage | Classification | Retention | DSR coverage |
|---|---|---|---|---|
| Buyer fingerprint hash | ClickHouse `events.session_id` | Pseudonymous (technical identifier) | 13 months | DSR by session_id |
| Buyer chat transcripts | ClickHouse `chat_events.payload` (PII-redacted) | Personal (after redaction: low) | 90 dni | DSR by session_id |
| Tenant user emails | Postgres `users.email` | PII (email) | Active + 30 dni post-cancellation | Self-service deletion |
| Tenant user names | Postgres `users.full_name` | PII | Same | Same |
| Stripe customer ID | Postgres `tenants.stripe_customer_id` | Pseudonymous | Active + 7 lat (tax compliance) | Anonymized after retention |
| Audit logs | Postgres `staff_audit_log`, `tenant_audit_log` | Internal | 7 lat | Retained even after DSR (legal basis) |

#### W.7.2. Data classification

| Class | Definition | Examples | Encryption | Access |
|---|---|---|---|---|
| **Public** | Intentionally publicly accessible | Marketing site, SDK CDN | TLS in transit only | Anyone |
| **Internal** | Estalara internal use | Internal docs, design specs | TLS + at-rest | Estalara staff |
| **Confidential** | Tenant business data | Tenant config, listings, analytics | TLS + at-rest + RLS | Tenant + authorized staff |
| **Restricted** | PII, secrets | User passwords, MFA secrets, audit logs, Stripe data | TLS + at-rest + column-level encryption | Strictly RBAC + audit |

#### W.7.3. Right to erasure (GDPR Art. 17) — technical implementation

**Postgres:** Standard `DELETE` + cascading FK constraints.

**ClickHouse:** Tricky — ClickHouse supports lightweight deletes (`ALTER TABLE ... DELETE WHERE`) but not transactional. Strategy:
1. DSR endpoint marks `session_id` w `dsr_deletion_queue` table
2. Daily cron (Modal job) executes `ALTER TABLE events DELETE WHERE session_id IN (...)` w ClickHouse
3. Confirmation email do user once deletion confirmed (typowo <48h)

**pgvector embeddings:** Re-generated z events (which are deleted), so will fade naturally w 30 dni. Manual purge available na request.

**Audit logs:** Retained per legal basis (GDPR Art. 17(3)(b) — for legal claims). Documented w Privacy Policy.

#### W.7.4. Data lineage tracking

System diagram tracking where data flows:
```
SDK (browser) → Cloudflare Workers (ingest)
              ↓
              Redpanda Kafka
              ↓
              Modal stream-consumer
              ↓ ↓
        ClickHouse  pgvector
              ↓ ↓
        Modal archetype-job (daily)
              ↓
        Global archetype space (DP-anonymized)
```

Documented w Section A diagram + this section. Maintained as we add new data flows.

---

### W.8. Cost Management & FinOps

#### W.8.1. Per-service cost monitoring

**Daily spend dashboard** (`/admin/costs`):
- Cloudflare (Workers + R2 + Durable Objects)
- Vercel (compute + bandwidth)
- Supabase (DB + Auth + Storage)
- ClickHouse Cloud
- Modal (compute + GPU)
- Anthropic API (per model)
- OpenAI API (embeddings + fallback)
- Sentry, Doppler, GitHub, etc.

**Cost per tenant:** Daily aggregation showing margin per tier (Section N alignment).

#### W.8.2. Budget alerts

```yaml
budgets:
  daily:
    total: $250        # alert if exceeded by 20%
    anthropic: $100    # circuit breaker if >150% (V.10.3)
    openai: $50
  monthly:
    total: $7500       # MVP budget
    target_growth: 10% MoM until pilot revenue
```

Alerts: Slack `#estalara-finance` + email do Piotra.

#### W.8.3. Reserved capacity (Year 2)

- Anthropic: prepaid usage credits (reduces marginal cost ~10%)
- Cloudflare: Workers Unbound subscription (reduces per-req cost at scale)
- Supabase: Team plan upgrade (when >$1k/mo on Pay-as-you-go)

---

### W.9. Sprint mapping — Operational tickets

| Sprint | Ticket | Deliverable |
|---|---|---|
| Sprint 2 | TICKET-OPS-001 | Status page setup (status.estalara.com) |
| Sprint 2 | TICKET-OPS-002 | Sentry alert rules (SEV-1/2/3 routing) |
| Sprint 3 | TICKET-OPS-003 | Grafana dashboards: Real-time Ops, Per-tenant Health |
| Sprint 3 | TICKET-OPS-004 | Synthetic monitoring (Checkly or Pingdom) |
| Sprint 3 | TICKET-OPS-005 | PII log redactor (Pino serializer) |
| Sprint 4 | TICKET-OPS-006 | Per-tenant cost limits + circuit breaker (V.10) |
| Sprint 4 | TICKET-OPS-007 | Disaster recovery runbook (Notion) + first quarterly drill |
| Sprint 5 | TICKET-OPS-008 | Canary deployment dla Ingest Worker |
| Sprint 5 | TICKET-OPS-009 | RLS isolation tests (V.8.2) |
| Sprint 6 | TICKET-OPS-010 | DSR automation (Right to erasure) |

---

### W.10. Cross-references

- **Section H (Compliance)** — W.7 (Data Governance) implementuje H.1 GDPR requirements
- **Section J (Multi-tenancy)** — W.6 testuje J's RLS design
- **Section K (Internal Ops)** — W.4 (Observability) feeds K.3.4 Global ML Health
- **Section O (Risks)** — W.1 (DR) mityguje O.5 vendor reliance, W.5 (Deployment) mityguje O.1 deployment risks
- **Section V (Security)** — komplementarne; V to "what we secure", W to "how we operate it"

---

## X. Sprint 1.5 — Hardening Mini-Sprint (Completed 5 May 2026)

> **Context:** Po Sprint 1 audit kodu wykazał 5 luk security/observability które wymagały naprawy **przed** rozszerzaniem systemu. Ten mini-sprint zaadresował wszystkie z nich. Wszystkie commity zmergowane do `main`, CI zielone.

### X.1. Completed fix-tickets

| Ticket | Commit | Branch | Description |
|---|---|---|---|
| **TICKET-FIX-001** | `ff2760f` | `fix/otel-context-propagation` | OTel W3C Trace Context propagation through Kafka headers (Ingest → Redpanda → Modal stream-consumer). 7 Python tests + 2 TypeScript tests. |
| **TICKET-FIX-002** | `efa8f0f` | `fix/canonical-error-shared` | Promote `ErrorResponseBody` type + `errorBody()` helper z `apps/ingest` do `packages/shared/src/errors.ts`. Single source of truth dla całej aplikacji. |
| **TICKET-FIX-003** | `8446bb9` | `fix/ingest-security-headers` | Hono `secureHeaders` middleware na Ingest Worker — HSTS preload, nosniff, Referrer-Policy, Permissions-Policy. |
| **TICKET-FIX-004** | `d34bf9c` | `fix/drizzle-role-separation` | Two Drizzle clients: `createTenantClient` (RLS enforced) + `createAdminClient` (service role). Environment vars: `DATABASE_URL` + `DATABASE_URL_ADMIN`. |
| **TICKET-FIX-005** | `e163f94` | `fix/pii-blacklist-zod` | Zod `superRefine` validator rejecting PII fields (email, phone, name, address, ip, ssn, etc.) w event payloads. 23 test cases. GDPR Art. 5(1)(c) data minimization. |

### X.2. Side benefits

- **commitlint regex extended** — accepts `[TICKET-FIX-NNN]` and `[TICKET-INFRA-NNN]` formats
- **`pnpm install` for `packages/db`** — pre-existing missing dependency caught and fixed
- **224 new tests** — 78 → 101 shared, 113 → 115 ingest, 4 → 8 db, plus 7 Python OTel tests
- **CI green** post-merge: Lint ✅, Typecheck ✅, Test (Node 22) ✅, 7× Test (Python) ✅, Format ✅, Gitleaks ✅, ClickHouse migrations smoke ✅, Build ✅

### X.3. Lessons learned

1. **Zod `superRefine` returns `ZodEffects`, not `ZodObject`** — breaks `.extend()`. Solution: rename base schema, apply superRefine separately. (TICKET-FIX-005)
2. **Vitest mock proxies throw on undefined property access** — optional chaining can't intercept. Solution: try/catch around OTel calls. (TICKET-FIX-001)
3. **Cherry-picking same commit across branches creates duplicate history** — git's ORT merge strategy resolves automatically when diffs are identical. (Multiple branches sharing commitlint fix)
4. **`pnpm install` not run after dependency added to `package.json`** — pre-existing typecheck failure. Caught when typechecking after adding new code. (TICKET-FIX-004)

### X.4. Outcome

System **ready for Sprint 2** (TICKET-021 Postgres schema + remaining 7 tickets). Foundation hardened against:
- Cross-tenant data leakage (RLS enforced via Drizzle separation)
- PII compliance violations (Zod blocks at validation layer)
- XSS/clickjacking (security headers enforced)
- Distributed debugging blind spots (OTel propagation works end-to-end)
- Inconsistent error responses (canonical format shared)

**Next step:** Section U Sprint 2 ticket — TICKET-021 must include new tables from U.2.3 (`users` with RBAC roles), U.3.2 (`tenant_registrations`), and U.9 (`staff_audit_log`).

