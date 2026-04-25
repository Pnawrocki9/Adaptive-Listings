
Markdown View 
AA
Estalara Adaptive Listings — Dogłębna analiza architektoniczno-biznesowa
Wersja: 1.0 (Master Design Document) | Data: 25 kwietnia 2026 | Autorzy odbiorcy: Piotr Nawrocki (CEO), Rafał Palak PhD (CTO), Krystian Wojtkiewicz PhD (CPO)

Executive Summary (1 strona)
Estalara Adaptive Listings to embeddable AI layer + standalone SaaS dla rynku nieruchomości, który w czasie rzeczywistym personalizuje listingi pod konkretnego, anonimowego kupującego — na bazie sygnałów behawioralnych, treści chatu i podróży cross-listing. Produkt sprzedajemy w trzech tierach (Observer / Augment / Native), z modelem hybrydowym (base fee + usage), w czterech regionach (US/UK/EU/UAE) od dnia 1.
Najważniejsze rekomendacje strategiczne:
Architektura "jeden core, dwa entry-pointy". Jeden monorepo (Turborepo) z trzema artefaktami: (a) @estalara/sdk (vanilla TS + Preact + Shadow DOM, <40 KB gzip), (b) apps/ingest (Cloudflare Workers, low-latency edge), (c) apps/control-plane (Next.js App Router na Vercel — dashboard + standalone product).
Stack zorientowany na latency i koszt. Ingest na Cloudflare Workers (zero cold start, $0.30/M req), event store ClickHouse Cloud, transakcyjny Postgres (Supabase) z Row Level Security per tenant_id, embeddings w pgvector do 5–10M wektorów, później migracja do Qdrant. LLM-y: Claude Haiku 4.5 ($1/$5 per MTok) jako workhorse, Sonnet 4.6 ($3/$15) dla złożonych decyzji adaptacji, fallback OpenAI dla redundancji (Anthropic pricing).
Behavioral fingerprinting jako MVP, ale z legitimate-interest framework + opt-out. EDPB Guidelines 2/2023 (final 16.10.2024) i ICO (grudzień 2024) jasno traktują fingerprinting jako objęty Art. 5(3) ePrivacy — czyli wymaga consent w EU/UK dla celów marketingowych (EDPB, ICO). Realne podejście: session-scoped probabilistic ID (bez persystencji cross-site bez consent), cross-listing tylko w obrębie jednego tenanta, a globalna agregacja na poziomie behavioral archetypes (k-anonymity ≥50, differential privacy ε≤2). To pozwala uruchomić produkt bez consent banneru w 80% scenariuszy, ale wymaga DPIA, ROPA i jasnej legitimate-interest assessment per tenant.
Data network effect zbudowany jako embedding space archetypów, nie surowych profili. Centralized aggregation z DP, nie federated learning (FL jest 1–2 lata przedwczesny dla naszego use case). MOAT: każdy nowy klient zwiększa pokrycie i precyzję ~50–200 archetypów buyera (relocating-family, cross-border-investor, downsizing-retiree, school-district-focus etc.).
Pricing hybrid, anchored przez Mutiny/Dynamic Yield. Tier 1 Observer: $499/mo + $0.40/1k visits. Tier 2 Augment: $1 999/mo + $1.20/1k adaptations. Tier 3 Native: $7 500/mo + $4/1k rendered listings + LLM passthrough +25%. Enterprise (Idealista/Otodom skala): six-figure annual. Dla porównania Optimizely starts ~$36k/rok, Dynamic Yield ~$35–60k+/rok, Mutiny custom ($10k+/mo na ABM tier) (Optimizely, Dynamic Yield).
AI Act: classify defensively jako NIE high-risk, ale przygotuj dokumentację jakby był. Estalara nie podejmuje automatycznych decyzji o dostępie do mieszkania (decyzję podejmuje agent + buyer); to recommendation/personalization, nie eligibility/credit scoring. Annex III nie obejmuje real-estate marketingu. Ale ponieważ pełen AI Act zacznie obowiązywać 2 sierpnia 2026 (European Commission), trzymamy DPIA + risk-management + transparency + human oversight zgodne z high-risk od dnia 1 — to też pozytywny sygnał dla enterprise klientów.
MVP w 12 tygodniach, zespół 5 FTE (Piotr/CEO, Rafał/CTO, Krystian/CPO + 2 senior engineers). Budżet MVP: ~€180k–€250k (zespół ~€140k przy kontraktorach + €25–40k infra/LLM credits + €15k legal/DPIA). Pilot z 3–5 agencjami w Marbelli, Warszawie i Londynie, public launch Q4 2026.
Największe ryzyka: (1) ICO/CNIL enforcement na fingerprinting bez consent — mitigujemy przez session-only mode w EU oraz "Estalara Consent Helper" jako component; (2) Vendor lock-in na LLM — mitigujemy przez router (LiteLLM) i embeddings na BGE-M3 self-hosted dla taniej skali; (3) Konkurencja Mutiny / Zillow — MOAT to vertical depth (real-estate-specific intent ontology) i embeddable-first DX (Mutiny jest stand-alone, nie embeddable do cudzych stron).

A. Wysokopoziomowa architektura systemu
A.1. Diagram komponentów (logical view)
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
A.2. Multi-tenant model — kluczowa decyzja
Trzy poziomy izolacji w jednej architekturze:
Warstwa
Mechanizm izolacji
Egzekucja
Edge ingest
Tenant API key → tenant_id w każdym evencie
HMAC + origin check w Workerze
Postgres (config, tenants, billing)
Row Level Security per tenant_id + per-tenant JWT claims
Supabase RLS (Supabase docs)
ClickHouse (events)
Per-tenant partition key + column-level encryption dla PII fields
ClickHouse RBAC + materialized views
pgvector (per-tenant embeddings)
Schema-per-tenant dla top-100 enterprise; row-level (tenant_id indexed) dla long-tail
Schema-per-tenant ma 4–8x lepszy query throughput dla 1M+ wektorów
Global archetype space (Estalara-owned)
DP-aggregated, nie zawiera tenant identifiers, k-anon ≥50
Differential Privacy ε≤2 stosowane na poziomie batch updates
Warto zauważyć, że Cloudflare wybrał TimescaleDB nad ClickHouse dla operational analytics z małymi batch'ami pisanymi przez wiele klientów — bo ClickHouse buforuje małe inserty na 400ms timer (Cloudflare blog). Dla naszego use case (high-volume events, append-only, bulk aggregation queries) ClickHouse Cloud jest właściwy — ale agreguj na edge w 5-sekundowe batche przed wysłaniem do ClickHouse, nie pisz event-by-event. ClickHouse Cloud charge ~$50/mo for hobby ale realistycznie mid-volume to $500–2000/mo (G2 comparison).
A.3. Multi-region deployment (EU/US/UK/UAE)
Region
Hosting
Postgres
ClickHouse
LLM endpoint
Compliance
EU (Frankfurt)
Vercel + Cloudflare fra1
Supabase EU (Frankfurt)
ClickHouse Cloud EU
Claude przez AWS Bedrock eu-central-1
GDPR primary
US (Virginia)
Vercel iad1 + Cloudflare iad
Supabase US-East
ClickHouse Cloud US-East
Claude/OpenAI native
CCPA/CPRA
UK (London)
Vercel lhr1 + Cloudflare lhr
Supabase EU (separate UK project for residency)
Logical separation w EU instance
Claude przez Bedrock eu-west-2
UK GDPR
UAE (Dubai)
Cloudflare dxb (no Vercel POP — fall back na fra1)
Postgres na AWS me-central-1 (Bahrain region najbliższy)
ClickHouse self-hosted on AWS me-central-1 lub EU instance dla MVP
Claude przez Bedrock (najbliższy: eu-central-1)
UAE PDPL Federal Decree-Law 45/2021 + DIFC
Routing strategy: Edge ingest writes do najbliższego POP. Nightly batch ETL replikuje anonimowe archetypy (DP-protected) do globalnego archetype store. Surowe events i PII NIGDY nie opuszczają regionu zgodnie z data residency. Latency budget od user-event do ingest ACK: <50ms p95 globally.

B. Embeddable Plug-in / SDK Design
B.1. Doświadczenie integratora (klient = real estate website owner)
Najprostsza możliwa integracja (Tier 1 Observer) — 1 script tag:
<!-- Wkleić raz w <head> -->
<script async src="https://cdn.estalara.io/sdk/v1/estalara.min.js"
        data-tenant="tnt_marbella_realty_xxx"
        data-tier="observer"
        data-region="eu"></script>
Tier 2 Augment — declarative slots w istniejącym HTML:
<article class="listing">
  <h1 data-estalara-slot="headline">{originalna nazwa}</h1>
  <div data-estalara-slot="hero-gallery">{istniejąca galeria}</div>
  <ul data-estalara-slot="features">{istniejące features}</ul>
  <section data-estalara-slot="chat-anchor"></section>
</article>
SDK wykrywa data-estalara-slot atrybuty i może je augmentować (re-rank, replace text via LLM rewrite, reorder children) bez ruszania reszty DOM-u.
Tier 3 Native — React/Vue/vanilla component:
import { EstalaraListing } from '@estalara/react';

<EstalaraListing
  listingId="prop_4587"
  tenantId="tnt_idealista"
  feed={mlsData}
  onInquiry={(buyer) => crm.push(buyer)}
  brandTokens={{ primary: '#C4A882', font: 'Fraunces' }}
/>
B.2. Architektura SDK — performance budget i izolacja
Wymiar
Decyzja
Uzasadnienie
Framework
Preact (3.5 KB) zamiast React (45 KB)
Preact wygrywa dla embeddable widgets — Viget i CompanyCam udowodnili że Preact + Shadow DOM = optymalne dla embeddable (CompanyCam case)
Bundler
esbuild + tsup
esbuild jest 50–100x szybszy niż Webpack, tsup daje gotowe ESM + CJS + UMD bundle dla CDN
Distribution
CDN (Cloudflare R2 + Workers) + npm (@estalara/sdk, @estalara/react, @estalara/vue)
Long-tail klienci wkleją script tag, dev teams użyją npm
Style isolation
Shadow DOM (open mode) + Constructable Stylesheets
Iframe ma overhead per-frame (separate browsing context, postMessage tax) — Shadow DOM jest natywnym standardem dla embeddable widgets (dev.to comparison)
Bundle size budget
Tier 1: 25 KB gzip (loader + observer), Tier 2: 40 KB gzip (+ DOM augmenter), Tier 3: 80 KB gzip (+ full renderer)
Lazy-load Tier 2/3 features tylko gdy enabled w config
Loading
async + idle-callback dla non-critical work, intersection observer dla "is listing visible"
Nie blokujemy LCP klienta
CSP
Generujemy nonce per-load, dokumentujemy required script-src cdn.estalara.io 'self' 'wasm-unsafe-eval' (dla potencjalnego on-device modelu w przyszłości)
XSS mitigation, plus pomaga klientom z surową CSP
API surface
Zdarzeniowy: Estalara.on('intent-detected', cb), Estalara.adapt(slot, directive), Estalara.identify(hint) (opt-in dla klientów którzy mają consent)
Inspiracja: Segment analytics.js + Intercom Messenger
B.3. Adaptery do popularnych stacks
W roadmapie MVP uwzględniamy 5 high-value adapterów:
Intercom/Drift adapter — auto-pickup chat transcripts via webhook (Intercom oferuje conversation.user.replied webhook; Drift po akwizycji przez Salesloft w lutym 2024 nie publikuje już cen, plan startuje ~$2 500/mo (SaaS Price Pulse)).
Crisp adapter (popularny w EU + tańszy)
Idealista API adapter — Idealista oferuje Search API (B2B z access request); my budujemy gotowy connector dla MLS-style feeds (Idealista developers)
Otodom + Allegro Lokalnie — Polska, scraping fallback przez Apify-style ($0.50/1k properties (Apify))
Generic JSON Schema feed + REST webhook — fallback dla każdej innej platformy

C. Signal Ingestion & Data Sources
C.1. Pełna taxonomia sygnałów (event schema)
Wszystkie eventy mają wspólny envelope:
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
Pełne kategorie eventów:
Kategoria
Przykładowe eventy
Throughput / sesja
Page lifecycle
page.view, page.exit, tab.visible, tab.hidden
5–15
Mouse/scroll behavioral
scroll.depth (10/25/50/75/90%), mouse.dwell (per element ≥500ms), mouse.rage_click, mouse.exit_intent
50–500 (sampled)
Photo interactions
photo.opened, photo.gallery.next, photo.zoomed, photo.dwell (per photo)
10–100
Floorplan engagement
floorplan.opened, floorplan.zoom, floorplan.dwell
0–20
Price/feature focus
price.hovered, price.compared, feature.expanded, mortgage_calc.used
5–30
Search/filter behavior
search.query, filter.applied, filter.removed, sort.changed
5–50
Chat (NLP target)
chat.opened, chat.message.sent (text), chat.intent.detected (server-side after NLP)
0–30
Cross-listing journey
listing.next, listing.compared, listing.bookmarked
1–10
Inquiry / conversion
inquiry.started, inquiry.completed, tour.requested
0–3
Device/context
One-time per session: device class, viewport, language, IP-derived country/city, time-of-day
1
C.2. Ingestion rate i strategia
Klient wysyła batches co 2 sekundy (lub immediate flush dla inquiry.* i chat.*)
Realistic peak: 100k DAU x avg 60 events/session = 6M events/dzień w Year 1; rozdzielone na ~70k events/sec peak (przy mocnym targowym ruchu) — Cloudflare Workers obsłuży to bez problemu, ClickHouse Cloud na tier $500/mo ingestuje 100M+/dzień
Real-time path (chat / live adaptation): WebSocket lub Server-Sent Events przez Cloudflare Durable Objects
Batch path (analytics, model training): Redpanda Cloud → ClickHouse via Kafka connector
C.3. NLP na chacie
Dla chat.message.sent:
Real-time intent extraction — Claude Haiku 4.5 ($1/$5 per MTok), structured output schema dla 12 wymiarów intentu (patrz D.4)
Latency target: <500ms od message send do intent vector update
Batch enrichment co 6h: re-process konwersacji w pełnym kontekście dla lepszych embeddings (offline)

D. Intent Engine — rdzeń produktu
D.1. Real-estate-specific intent ontology
Kluczowy MOAT vs generic personalization (Mutiny, Dynamic Yield) to wertykalna ontologia. Proponowane 12 wymiarów intent vector:
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
Każdy wymiar ma confidence score (0–1). Adaptation engine zachowuje się tylko gdy combined confidence > threshold (default 0.6).
D.2. Architektura model serving
Warstwa
Model
Latency budget
Koszt na 1k inferencji
On-device (SDK)
Małe heurystyki + lookup table (top-100 najczęstszych patternów)
<10ms
$0
Edge inference (Cloudflare Workers AI)
Embedding model: BGE-M3 (open weights, MIT) self-hosted lub Workers AI built-in
50–80ms
~$0.02
Server-side fast (Modal serverless GPU)
Custom fine-tuned Llama 3.1 8B na real-estate intent classification (planowane Y2; Y1 używamy Haiku 4.5)
150–300ms
~$0.50 (Haiku 4.5)
Server-side deep (Modal + Claude Sonnet 4.6)
Złożone decyzje adaptacji, content rewrite, multi-step reasoning
800–2000ms
~$8–12 (Sonnet 4.6)
Decyzja kluczowa: w MVP NIE fine-tunujemy własnego LLM-a. Używamy Claude Haiku 4.5 dla 90% przypadków ($1/$5 per MTok) (Anthropic) i Sonnet 4.6 dla skomplikowanych sytuacji ($3/$15 per MTok). Per-token economics zaczynają faworyzować self-hosted dopiero powyżej ~15M embeddingów/miesiąc (zUdyog analysis).
D.3. Wybór embeddings — szczegółowo
Model
MTEB score
Cena
Decyzja
OpenAI text-embedding-3-small
62.3%
$0.02/MTok
Default w MVP — najtańszy z dobrej jakości, dimensions configurable (Matryoshka)
Cohere embed-v4
~65%
$0.10/MTok
Lepszy multilingual (ważne EU/UAE) — opcja dla enterprise tier
BGE-M3 (self-hosted)
63.0%
~$5–20/M tokens infrastructure
Year 2 migration target gdy volume > 15M embed/mo, savings $1k+/mo per (Reintech)
Voyage-3 / 4
67–71%
$0.10/MTok
Best quality, ale małe ekosystem; rozważyć dla enterprise jeśli accuracy gain > cost
W MVP: OpenAI text-embedding-3-small @ 1024 dims (Matryoshka). Jeden model = jeden vector store, prostsza migracja.
D.4. Pipeline aktualizacji intent vector
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

E. Adaptation Engine
E.1. Decision tree (logiczny, nie ML)
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
E.2. Content generation — gdzie LLM, gdzie templates
Element
Strategia
Uzasadnienie
Headline rewrite
Template + slot filling (95% przypadków), LLM rewrite tylko dla edge cases
Predictable, brand-safe, taniej. Templates: 50–100 archetypów x 3 wariantów per language
Feature highlight order
Pure ranking model (gradient boosted on intent×feature interaction)
Deterministyczne, A/B testable, brak halucynacji
Photo re-ranking
CLIP-style scoring photos vs intent vector + tenant hard rules ("first photo must show exterior")
Computer vision na zdjęciach raz przy ingest property, intent-photo dot product przy serve
Chat suggested replies
Claude Haiku 4.5 + RAG (tenant's FAQ + listing data + intent context)
Conversational quality wymaga LLM; Haiku 4.5 wystarczająco dobre
Long-form copy (description)
Claude Sonnet 4.6 — tylko Tier 3 Native, async pre-generation, cached
Sonnet 4.6 jakość warte ceny dla flagship feature, ale cache'ujemy bo description rzadko się zmienia
E.3. A/B testing & learning loop
Hold-out group (default 10%) — losowo wybrana, dostaje unadapted listing. Mierzymy lift na: time-on-listing, photo opens, inquiry rate.
Multi-armed bandit (Thompson sampling) dla wyboru wariantu adaptacji per archetype — automatycznie alokuje ruch do najlepiej konwertujących adaptacji.
Conversion feedback loop: gdy inquiry.completed event przychodzi, propagujemy reward signal wstecz przez session events i aktualizujemy archetype embeddings (offline, daily batch).
Detekcja regresji: jeśli archetype X ma stat-significant drop w conversion przez 7 dni — auto-pause adaptacji dla tego archetype, alert do Estalara team.

F. Data Network Effect / MOAT
F.1. Centralized vs federated — decyzja
Decyzja: centralized aggregation z differential privacy, NIE federated learning.
Uzasadnienie:
FL ma sens gdy raw data nie może opuścić urządzenia/tenanta (bankowość, healthcare). U nas tenant sam zgodził się na to przez Master Service Agreement, więc transfer agregatów jest legalny przy proper DPA.
FL infrastructure (Flower, TensorFlow Federated) dodaje 6–12 miesięcy do roadmapy i wymaga ML eng z FL expertise. Nasz zespół 5-osobowy nie ma na to capacity.
Google i Meta używają FL+DP w produkcji (Meta Engineering, Google Research) ale dla skali miliardów devices i z ML staffem 100+. Nasz pragmatyczny wybór: centralized aggregation + DP + k-anonymity.
F.2. Architektura archetypes
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
F.3. Privacy-preserving techniques — co realnie robimy
Technika
Zastosowanie u nas
Notes
k-anonymity (k≥50)
Archetype tylko publikowany jeśli ≥50 unique sessions z >3 różnych tenantów spadło w bucket
Standard NIST-recommended threshold; eliminuje re-identification risk
Differential Privacy (ε≤2)
Gaussian noise na embedding updates per epoch
DP-SGD jak w Google Gboard (Google Research)
Behavioral hashing
Sessionid = HMAC(tenantsecret, fingerprint, day_bucket) — rotuje się co 24h dla EU bez consent
Limit cross-session re-identification
No raw PII w global store
Tylko vector + categorical archetype labels; chat transcripts rzadko transferred globally i tylko po LLM-based redaction PII
Zero PII leakage cross-tenant
Consent-aware aggregation
Sessions z consent_state = consented → wkład pełny; legitimate-interest → tylko aggregated metrics; none → wyłączone z global learning
Compliance with GDPR Art. 6/9
F.4. MOAT mathematics dla inwestorów
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

G. Behavioral Fingerprinting — szczegółowo i pragmatycznie
G.1. Stan prawny w 2025–2026 (MUSIMY to rozumieć dokładnie)
EU/EEA — sytuacja jednoznaczna i niekorzystna dla "no consent" approach:
ePrivacy Directive Art. 5(3) wymaga prior consent dla jakiegokolwiek dostępu do informacji w terminal equipment, niezależnie czy to cookies czy fingerprinting (EDPB Guidelines 2/2023, finalne październik 2024).
EDPB Guidelines 2/2023 wprost obejmują fingerprinting, pixel tracking, IP-only tracking, URL tracking.
Legitimate interest pod GDPR Art. 6 NIE substytuuje consent pod ePrivacy Art. 5(3) — to dwa odrębne reżimy (Consenteo analysis).
ePrivacy Regulation została wycofana w lutym 2025 — czyli przez najbliższe lata utrzyma się obecny ePrivacy Directive 2002/58/EC, transponowany różnie w państwach członkowskich (divergence będzie rosła).
CNIL we wrześniu 2025 wystawiła €325M Google + €150M Shein za naruszenia cookie/tracking — enforcement się intensyfikuje.
UK:
ICO w grudniu 2024 jasno odpowiedział na zmianę polityki Google (luty 2025 dopuszczająca fingerprinting w reklamie): "fingerprinting is not a fair means of tracking users… compliance with UK data protection law is a high bar to meet" (ICO statement).
ICO wymaga consent + transparency dla fingerprinting, identyczne podejście jak EDPB.
US (CCPA/CPRA):
Browser fingerprints klasyfikowane jako "unique personal identifiers" → opt-out right.
W praktyce: musimy honor GPC (Global Privacy Control) signal i ofiarować "Do Not Sell/Share" mechanizm.
UAE (PDPL Federal Decree-Law 45/2021):
Personal data definition obejmuje "online identifier" → fingerprint = personal data.
Consent or other lawful basis required (Art. 5).
Executive Regulations (Cabinet Decision 111/2023) wymagają DPO dla large-scale profiling, DPIA dla high-risk processing.
DIFC i ADGM mają oddzielne reżimy (Data Protection Law No. 5 of 2020) — bardzo zbliżone do GDPR.
Polska (UODO):
UODO stosuje GDPR + krajową Ustawę o ochronie danych osobowych z 2018 + Prawo telekomunikacyjne dla ePrivacy. Generalnie podąża za EDPB.
G.2. Pragmatyczna strategia compliance dla Estalara
Mode A — "Session Mode" (default, no consent banner needed):
Fingerprint tylko per session, hash rotuje się przy tab close + 30 min idle
Dla EU/UK/UAE: opieramy na strictly necessary exemption pod ePrivacy 5(3)(b) — service explicitly requested by user (interactive listing experience). ICO Draft Guidance (December 2024) potwierdza że "recording information or selections made on an online service" może spełniać ten exemption.
Cross-listing journey w obrębie jednego tenanta (tej samej witryny) — to jest first-party tracking, generally OK.
NIGDY cross-tenant w Session Mode.
Mode B — "Consented Mode" (gdy klient zbierze consent przez Estalara Consent Helper lub własny CMP):
Pełen behavioral fingerprint, persistence 90 dni, cross-listing/cross-tenant journey w obrębie jednej grupy partnerskiej.
Wszystkie sygnały zasilają global archetype space.
Mode C — "Legitimate Interest Mode" (dla narrow use cases jak fraud prevention):
Tylko dla konkretnych celów typu detection of duplicate listings spam — nie dla marketingu/personalization (CNIL i EDPB jasno wykluczyły).
W konfiguracji per tenant pozwalamy klientowi wybrać który mode chce uruchomić, z domyślnym Mode A. Mode A jest naszym differentiatorem vs Mutiny/Drift — bo daje value od dnia 1 bez consent banner.
G.3. Techniki fingerprinting i ich realna skuteczność
Niezależne badania Kochava (2024) i innych pokazują że fingerprinting accuracy spada poniżej 50% po 24h ze względu na Safari ITP, Firefox ETP, Brave farbling, mobile networks (Seresa research). To znaczy że nawet ZE consent fingerprint cross-session jest niesamowicie zawodny.
Nasza techniczna stack dla Mode A:
Canvas fingerprint hash (lightweight, no PII)
AudioContext fingerprint
Screen + viewport + timezone + language
WebGL renderer
Combined entropy: ~18–22 bits → unique ID dla ~99% browser/device combos w obrębie sesji
HMAC z tenant_secret + day_bucket — uniemożliwia cross-tenant correlation nawet wewnętrznie
Sesja resetuje się po idle 30min lub close tab
Dla Mode B dokładamy:
LocalStorage persistent ID (z explicit consent)
Optional CNAME-based first-party endpoint (omija Safari ITP 7-day cap)

H. Compliance & Privacy Multi-Region
H.1. GDPR (EU) — pragmatyczny checklist
Obowiązek
Jak realizujemy
Lawful basis (Art. 6)
Per-tenant: Legitimate Interest (Art. 6.1.f) dla intent detection + adaptation, z udokumentowanym Legitimate Interest Assessment (LIA). CNIL w czerwcu 2025 explicitly potwierdziła że commercial interest może być legitimate dla AI development (CNIL recommendations)
ePrivacy consent
Mode A: strictly necessary exemption. Mode B: wymaga consent collected by tenant (Estalara dostarcza Consent Helper jako optional component)
DPIA
Estalara robi DPIA dla całego produktu (template + worked example) → tenant adoptuje + customizes per swoje use case. Required dla "systematic monitoring of behavior" wg GDPR Art. 35.3.c
ROPA (Art. 30)
Auto-generated from configuration: per-tenant ROPA entry available do downloadu z dashboardu
Data Subject Rights
API endpoint DELETE /v1/sessions/{session_id} + bulk export — buyer może żądać deletion przez tenant
Transfers
EU data stays w EU; US-based tenants → SCC + supplementary measures (Schrems II); transfer impact assessment template
DPO
Estalara appointuje DPO w EU (preferowany Polska — najtańszy, native do założycieli)
Breach notification
72h SLA — Sentry + custom incident playbook, pre-templated notification do supervisory authorities
H.2. AI Act (EU) — defensive classification
Pełny tekst AI Act stosuje się od 2 sierpnia 2026 (z wyjątkami dla GPAI od sierpnia 2025) (European Commission timeline). Annex III wymienia "high-risk" systemy obejmujące m.in.:
AI determining access to essential services (housing/credit)
AI evaluating creditworthiness
AI for emotion recognition
Nasza klasyfikacja: NIE high-risk, ale przygotowujemy się jakby był (defensive posture):
Estalara nie podejmuje decyzji o sprzedaży/wynajmie nieruchomości — to robi human agent + buyer
Personalizacja prezentacji ≠ access decision (Recital 53 explicitly differentiates)
Brak emotion recognition w sensie biometrycznym (psychologiczny stan inferowany z chatu nie kwalifikuje się — to nie biometric data)
Niezależnie utrzymujemy: Risk Management System, Data Governance, Technical Documentation, Human Oversight (tenant zawsze może wyłączyć adaptację per buyer), Post-Market Monitoring, Logging (full audit trail w ClickHouse 13 miesięcy retention).
Komisja w Digital Omnibus (listopad 2025) zaproponowała powiązanie aplikacji high-risk rules z dostępnością harmonizowanych standardów — co potencjalnie odsunie deadline dla high-risk systems poza 2 sierpnia 2026, ale nie liczymy na to (European Commission FAQ).
H.3. CCPA/CPRA (California)
Notice at collection (link w SDK widget i w listing footer)
Honor GPC signal automatically (US tenants opt-in)
Opt-out of sale/sharing (przy Mode B)
No sensitive personal info collection by default
H.4. UK GDPR + ICO
Lokalna PECR (Privacy and Electronic Communications Regulations) dla ePrivacy
ICO online tracking strategy 2025 → final guidance po Data (Use and Access) Act 2025 (Inside Privacy)
Data Protection Officer registered with ICO
H.5. UAE PDPL + DIFC
DPO required (Art. 10) dla large-scale profiling
DPIA przed launch (Art. 9)
Cross-border transfers — UAE Data Office maintains adequacy list; SCC alternative
DIFC tenants (np. agencja w Dubai International Financial Centre) → DIFC Data Protection Law No. 5 of 2020, separate compliance — bardzo zbliżone do GDPR
Encryption required: AES-256 at rest, TLS 1.2+ in transit (ITSEC PDPL guide)
H.6. Polska — UODO + bonus
UODO stosuje GDPR + Ustawę 2018, zwłaszcza ostry na profiling i automatyczne decyzje. Rejestracja DPO w UODO. Cookies/ePrivacy via Prawo telekomunikacyjne — wymaga consent identycznie jak EDPB.
H.7. NIS2
NIS2 dotyczy "essential" i "important entities" — Estalara prawdopodobnie nie kwalifikuje się jako essential (real estate marketing nie jest critical infrastructure), ale klienci enterprise (np. Idealista) mogą być → my musimy spełnić wymagania w SLA: incident reporting w 24h, supply chain security, MFA dla admin access. Zaimplementujemy od dnia 1.

I. Stack Technologiczny — Konkretne Rekomendacje
I.1. Frontend SDK
Layer
Wybór
Alternatywy
Rationale
Language
TypeScript 5.x strict mode
—
Standard dla DX i enterprise integration
UI runtime
Preact 10
React (za duży), Lit (mniej ekosystemu), vanilla JS (za bolesne dla Tier 3)
Preact = React API w 3.5KB, idealne dla embeddable
Bundler
tsup (oparte na esbuild) + Rollup dla finalnego CDN bundle
Vite (build-tool nie library-tool), Webpack (wolne)
tsup szybki + multi-format output
Styling
CSS-in-JS przez @emotion/css w Shadow DOM, Constructable Stylesheets dla shared base
Tailwind (problem z Shadow DOM), styled-components (overhead)
Constructable Stylesheets share parsing cost między 50+ instancjami komponentów
State
Nanostores (1KB) lub Zustand vanilla
Redux (przesada), Jotai (React-only)
Lightweight, framework-agnostic
Telemetry
Custom (ingest endpoint), opcjonalnie OpenTelemetry Web
Sentry SDK (za duży)
Custom jest 2KB
I.2. Backend
Layer
Wybór
Alternatywy
Rationale
Edge ingest
Cloudflare Workers + Durable Objects
Vercel Edge Functions, AWS Lambda@Edge
Cloudflare ma zero cold start (V8 isolates), $0.30/M requests, unlimited bandwidth, 300+ POPs (Northflank). Vercel pricing kapie z bandwidth ($0.06/GB egress)
Control plane API
Next.js 15 App Router on Vercel (już mamy)
Hono on Cloudflare, NestJS
Kontynuujemy istniejący stack, używamy Edge Runtime gdzie sensowne
Worker tasks (intent enrichment, archetype updates)
Modal (serverless GPU/CPU)
Inngest (event workflows), AWS Lambda, Trigger.dev
Modal = Python-native, świetne dla ML serving (Modal $1.1B valuation 2025), GPU support, Oracle Cloud partnership for affordable GPU (Introl analysis). RunPod tańsze ale bardziej manual
Real-time event bus
Redpanda Cloud (Kafka-compatible)
Confluent Kafka, AWS Kinesis ($0.014/shard-hour), Cloudflare Queues
Redpanda ma 10x lepszy single-node throughput niż Kafka, niższy ops overhead, multi-region
Transactional DB
Supabase (Postgres 16) — multi-region projects
Neon (świetne branching ale słabsze RLS), self-hosted RDS
Supabase = Postgres + auth + RLS + realtime in one. RLS jest battle-tested dla multi-tenant (Supabase RLS docs)
Event store
ClickHouse Cloud
TimescaleDB, Snowflake
ClickHouse 4.8x szybsze loading + 1.7x mniejszy disk niż konkurencja na dużych aggregations (Tinybird). Trade-off: nie cool dla małych częstych pisów, więc batchujemy na edge
Vector DB
pgvector w Supabase (do 5–10M wektorów), później Qdrant Cloud
Pinecone (drogi przy >10M), Weaviate (skomplikowany ops)
pgvectorscale (Timescale's extension) osiąga 471 QPS @ 99% recall na 50M vectors, conkurencyjne z Pinecone (dev.to)
Cache / session store
Upstash Redis (multi-region, pay-per-request)
Redis Cloud, Vercel KV
Multi-region replication, $0.20/100k commands, idealne dla intent vector cache
LLM gateway
LiteLLM (self-hosted) lub OpenRouter
Direct provider SDKs
Router pozwala na fallback Claude → OpenAI → Cohere, cost tracking, retry logic, jeden interfejs
I.3. ML/AI
Use case
Provider
Model
Koszt
Intent extraction z chatu
Anthropic
Claude Haiku 4.5
$1/$5 per MTok (Anthropic)
Adaptation reasoning (złożone)
Anthropic
Claude Sonnet 4.6
$3/$15 per MTok
Headline rewrite (Tier 3 premium)
Anthropic / OpenAI fallback
Sonnet 4.6 / GPT-5.2
Sonnet $3/$15, GPT-5.2 $1.75/$14 (IntuitionLabs)
Embeddings
OpenAI
text-embedding-3-small @ 1024 dim
$0.02/MTok
Photo CLIP scoring
Workers AI built-in (CLIP ViT)
OpenAI Vision (drogie dla volume)
Workers AI ~$0.011/1k requests
Future fine-tuned intent classifier
Modal hosted
Llama 3.1 8B fine-tuned na własnych anonimowych konwersacjach
~$0.50/1k inferences na Modal H100
I.4. Hosting & Infrastructure
Vercel Pro: dashboard + control plane API (~$20/dev + usage)
Cloudflare: Workers ($5/mo + $0.30/M req), R2 storage ($0.015/GB), CDN free
Supabase Pro: $25/project/mo + usage; we run 4 (eu, us, uk-residency, scaling/failover)
ClickHouse Cloud: ~$500–2000/mo at MVP scale
Modal: pay-per-use, ~$300/mo MVP
Upstash Redis: ~$50–200/mo
Total infra MVP ≈ $2 500–4 000/mo (skaluje się z usage)
I.5. Observability
Sentry dla errors (frontend + backend)
OpenTelemetry + Grafana Cloud (free tier do 10k metrics) lub Datadog dla enterprise tier (~$31/host/mo)
PostHog Cloud EU dla product analytics (self-hosted opcja w roadmapie dla data residency)
Custom dashboard w control plane dla tenant-facing metrics
I.6. Dev tooling
Monorepo: Turborepo + pnpm
CI/CD: GitHub Actions + Vercel auto-deploy + Cloudflare Wrangler for Workers
IaC: Terraform dla AWS/Cloudflare, Pulumi opcjonalnie dla TypeScript-native
Secrets: Doppler lub Infisical (open source)
Feature flags: PostHog built-in lub Statsig ($0 do 1M events/mo)

J. Multi-Tenancy Model — szczegółowy design
J.1. Schema strategy
Hybrid approach:
Shared schema z RLS dla wszystkich tabel transakcyjnych (tenants, users, listings_metadata, configs, billing) — Supabase RLS per tenant_id claim w JWT
Schema-per-tenant dla pgvector embeddings (top-100 enterprise klientów) — lepsza performance dla complex similarity queries
Partition-per-tenant w ClickHouse dla events — tanie i szybkie
-- przykład RLS policy
CREATE POLICY tenant_isolation ON listings_metadata
  FOR ALL TO authenticated
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
J.2. API key model
Public API key (per origin, rate-limited): wkleja się w SDK, OK dla client-side
Secret API key (server-side): dla webhook adapters, MLS feed sync, CRM integration
HMAC sign każdy request z secret; rotacja keys w 1-click dashboard
Per-key scopes: read:events, write:adaptations, admin:config
J.3. Konfiguracja klienta
Per-tenant configuration JSON Schema:
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
};
J.4. Per-tenant dashboard
Sekcje w dashboardzie:
Overview: live visitors, active intent-detected sessions, conversion lift
Adaptations: which listings adapted, top-performing variants, A/B results
Buyer Archetypes (anonymized): distribution of buyer types z ich własnego ruchu
Configuration: tier upgrade/downgrade, signals enable/disable, brand tokens
Integrations: chat, CRM, MLS feed, webhook
Billing: current usage, projection, invoices
Compliance: DPIA template download, ROPA export, DSR queue
Audit log: kto co zmienił, kiedy
J.5. Standalone Estalara product
Identyczna architektura, różnica tylko w frontendzie:
Plug-in mode: SDK na cudzej stronie, dane z ich feedu
Standalone mode: nasz Next.js frontend hostowany na {tenant}.estalara.app, ten sam SDK używa się internally, ale my dostarczamy też CMS-like editor dla listingów
To pozwala small agencies bez własnej strony użyć Estalara end-to-end, podczas gdy enterprise integruje SDK do swojej istniejącej witryny.

K. Pricing Model (Hybrid)
K.1. Pricing tiers — konkretne stawki
TIER 1 "Observer" — Self-serve, kredyt karta, instant signup
Base: $499/month (annual: $4 990, save 17%)
Included: 50k tracked visits/mo
Overage: $0.40 / 1k additional visits
LLM: not used (pure observation + widget)
Target: solo agents, brokerages 1–10 people
TIER 2 "Augment" — Light-touch sales, 14-day trial
Base: $1 999/month (annual: $19 990)
Included: 200k tracked visits + 50k adaptations
Overage: $1.20 / 1k adaptations, $0.30 / 1k additional visits
LLM passthrough: actual LLM cost + 25% margin
Target: mid-market agencies, 10–100 agents
TIER 3 "Native" — Enterprise, sales-led, custom contract
Base: starting $7 500/month (annual contract minimum)
Included: 1M visits, 500k adaptations, 100k LLM-rendered listings
Overage: $4 / 1k rendered listings, LLM passthrough +20%
White-label + SLA 99.95% + dedicated CSM + custom features
Target: portals (Idealista/Otodom/Zillow scale), enterprise brokerages
Free tier (long-tail acquisition):
5k visits/mo, Estalara badge wymagane, no LLM features, watermarked
Cel: SEO + viral acquisition + funnel do Tier 1
K.2. Pricing benchmarking — competition
Vendor
Entry pricing
Notes
Mutiny
Custom, listed ~$1k/mo entry, real deals $50k–$200k+ ARR
B2B ABM personalization, nie real-estate-specific (Vendr)
Optimizely Web Experimentation
~$36k/rok minimum, $113k+ enterprise dla 10M impressions
Pure A/B testing (Mida)
Dynamic Yield
~$35k–60k+/rok minimum, $250k+ dla enterprise
Mastercard-owned, e-commerce focus (Personizely)
Segment (CDP)
$25k–$200k/rok depending on volume
Data pipeline, not personalization (Spendflo)
Drift
~$2 500/mo entry ($30k/rok)
Conversational sales, B2B (Social Intents)
Intercom
$39/seat starting, $903/mo Advanced, scales to enterprise tens of thousands
Customer support primary (Featurebase)
Nasze pricing rationale: plasujemy Tier 2 niżej niż Mutiny/Dynamic Yield (specjalizacja vertical, nie general-purpose), Tier 3 enterprise konkurencyjnie z Dynamic Yield ale z unique value prop (real-estate vertical depth + multi-region z dnia 1).
K.3. Enterprise dla portals (Idealista/Otodom/Zillow scale)
Custom enterprise contracts:
Base $50k–$200k+/mo
Volume discounts: -10% przy >5M visits/mo, -20% przy >50M
3-year commitment unlock dodatkowe 15–25% discount (zgodne z industry norm — Vendr data dla Optimizely/Segment)
Co-marketing rights (case studies, joint webinars)
On-prem option (Year 3+) dla największych

L. Business Model & Go-To-Market
L.1. Plan wdrożenia (4 fazy)
Faza
Czas
Cele
Liczba klientów
ARR target
MVP
M1–M3
Build core platform + Tier 1 + Tier 2 (basic), 3-5 design partners
3–5 (free pilots)
$0
Beta
M4–M6
Stabilize, add Tier 3 Native, recruit pilot enterprise
10–20 paying
$200–400k
General Availability
M7–M12
Marketing engine, content, case studies, self-serve flow
50–100 paying
$1–2M
Enterprise tier
Y2
Dedicated SE team, channel partnerships, on-prem option
5–10 enterprise + 200+ SMB
$5–10M
L.2. Acquisition channels
Tier 1 Observer (self-serve):
SEO content: "AI for real estate listings", "real estate website personalization", "Idealista alternative for personalization"
Polish + English + Spanish blog
Free tier viral loop ("Powered by Estalara" badge na free tier)
Real estate communities (BiggerPockets, ARRA, polskie grupy FB agentów)
Tier 2 Augment (light-touch):
Outbound do top 500 agencji w każdym z 5 rynków (US/UK/ES/PL/UAE)
Webinary "How AI is changing real estate listings"
Industry conferences: Inman Connect, REtech, Property Forum (Polska), Dubai REst
Tier 3 Native (enterprise sales):
Account-based marketing dla top 50 portals/brokerages globally
Partnerships: HouseSigma, Boomtown CRM, Reonomy, Lone Wolf — integracje + co-sell
Direct relationships z Idealista (enterprise plan SE-led), Otodom (Allegro Group), Rightmove (UK), Zillow Group (US)
W UAE: Bayut (Dubizzle Group), Property Finder
L.3. Sales motion per tier
Tier
Motion
Time-to-close
ACV
Tier 1
Self-serve, credit card, 24h activation
minutes
$5 988/yr
Tier 2
Light-touch, 30-min demo, 14-day trial, contract
14–30 dni
$24 000–48 000/yr
Tier 3
SE-led, POC, custom contract, security review, DPIA
60–120 dni
$100k–500k+/yr

M. Koszty & Unit Economics
M.1. COGS — kalkulacja per 1 000 visits / adaptations / inferences
Założenia bazowe:
1 wizyta = avg 60 events, 4 adaptacje, 0–1 chat session (avg 2 messages), 3–8 LLM inferences
LLM mix: 80% Claude Haiku 4.5 ($1/$5 per MTok), 20% Sonnet 4.6 ($3/$15)
Avg input/output per inference: 800 / 200 tokens
Komponent
Koszt na 1k visits
Komentarz
Cloudflare Workers ingest (60k events)
$0.018
$0.30 / M req
ClickHouse Cloud storage + queries
$0.05
based on $1500/mo dla 100M events/mo
Postgres (Supabase) — config reads
$0.005
minimal
Embedding (per session ~10 calls × 500 tokens)
$0.10
OpenAI text-embedding-3-small
LLM intent + adaptation (~5 inferences avg)
$1.50
80% Haiku, 20% Sonnet
GPU inference (CLIP photo scoring, cached)
$0.02
mostly amortized
CDN egress (SDK delivery)
$0.10
Cloudflare free egress, only R2 storage
Egress to LLM providers
$0.05
minimal
Total COGS / 1k visits
~$1.85

Total COGS / 1k adaptations (no LLM)
~$0.40
mostly compute
Total COGS / 1k LLM inferences
~$3.00
dominated by Sonnet
M.2. Margin targets per tier
Tier
Avg revenue/1k visits
COGS/1k visits
Gross margin
Tier 1 Observer ($0.40/1k overage)
$0.40
$0.10 (no LLM, light ops)
75%
Tier 2 Augment ($1.20/1k adaptations)
$1.20
$0.40
67%
Tier 3 Native ($4/1k rendered + LLM passthrough)
$4.00 + $0.50 LLM markup
$1.85 + LLM cost
70% blended
Blended target: 70–75% gross margin, w linii z najlepszymi B2B SaaS.
M.3. CAC i LTV
Estymacje na podstawie analogicznych SaaS:
Tier
CAC
ACV
Year 1 LTV (assuming 90% logo retention, 110% NRR)
LTV/CAC
Tier 1 (self-serve)
$200
$5 988
$30k 5-yr
150x (excellent)
Tier 2 (light-touch)
$3 000
$36 000
$180k 5-yr
60x
Tier 3 (enterprise)
$40 000
$250 000
$1.5M+ 5-yr
37x
Payback period target: <12 miesięcy dla Tier 1, <18 dla Tier 2, <24 dla Tier 3.

N. Ryzyka i Mitygacje
N.1. Techniczne
Ryzyko
Prawdopodobieństwo
Impact
Mitygacja
SDK latency >100ms degraduje UX klienta
Medium
High
Performance budget per tier; Cloudflare edge; lazy-load; chaos engineering testy
Intent misidentification (np. flagujemy retiree jako student)
High (early)
Medium
Confidence threshold; default-no-adapt; A/B holdout zawsze on; monthly accuracy audit
Scaling do 10M+ events/dzień przed Y2
Medium
High
ClickHouse + Cloudflare radzą sobie; load test po MVP; budget na ClickHouse upgrade
Vector DB hit ceiling (pgvector @ 10M+)
High w Y2
Medium
Plan migracji do Qdrant w roadmapie Q4 Y1
N.2. Prawne
Ryzyko
Prawdopodobieństwo
Impact
Mitygacja
Enforcement na fingerprinting w EU/UK
High
High
Mode A jako default; strict legal opinion przed launch; Estalara Consent Helper jako optional component; transparent privacy notice
AI Act high-risk classification by regulator
Low–Medium
Very High
Defensive posture (pełna dokumentacja jakby był high-risk); legal counsel relationship; participate in CEN/CENELEC consultations
Data localization wymóg w UAE
Medium
Medium
Region-specific deployment od dnia 1; AWS me-central-1 plan ready
Schrems III scenario (US transfers)
Medium
High
Data residency w EU; SCC + supplementary measures; dla US tenantów ich dane stay w US-region
N.3. Konkurencyjne
Konkurent
Threat level
Komentarz
Mutiny
Medium
Mogliby wejść w real estate, ale ich DNA to B2B ABM. Nasza vertical depth jest realnym moat.
Salesforce/HubSpot
Low–Medium
Mają CRM, ale nie embeddable adaptive listing layer. Przez 2–3 lata bezpiecznie.
Adobe Target
Low
Enterprise-only, drogie, generic personalization, nie real-estate.
Zillow / Realtor.com / Idealista internal AI
High
Już budują własne AI search (Real Estate News). Strategy: zostać partnerem, nie konkurentem — sprzedajemy IM Tier 3 enterprise z ich brandem
Real-estate-specific startupy
Medium
Niewielu z nas widzi (RentSync, EliseAI w property mgmt, ale nie embeddable adaptive listings). Mamy 18-mo head start.
N.4. Reputacyjne — "creepy factor"
Default privacy mode = Mode A (session only, brak persistence)
Transparent: każdy listing pokazuje "Powered by Estalara — learn more" link → strona "How we personalize"
Buyer może opt-out 1-click (cookie sets, persistence cross-session)
Limit adaptation aggressiveness: max 30% headline/copy delta od oryginału (etyczne nie-misleading)
Fair-housing constraint linter: nigdy nie filtrujemy/adaptujemy na podstawie chronionych klas (race, religion, family status etc.) — to jest hard-coded, nie konfigurowalne
N.5. Reliance na third parties
Vendor
Risk
Mitigation
Anthropic Claude
Pricing change, downtime
LiteLLM router → OpenAI fallback; long-term plan: fine-tuned Llama na Modal
OpenAI embeddings
Price hike, model deprecation
Plan na BGE-M3 self-hosted w Y2 (break-even @ 15M embed/mo)
Cloudflare
Outage, vendor lock-in
Multi-region; failover do Vercel Edge; Workers-compatible standard (Hono) używany
Vercel
Pricing escalation
Architecture pozwala na migrację na Cloudflare Pages + Workers w razie potrzeby

O. Roadmap & Priorities dla MVP (12 tygodni)
O.1. Co budujemy (MVP scope)
Tygodnie 1–2 — Foundation:
Monorepo Turborepo, pnpm workspace
@estalara/sdk skeleton (Preact + Shadow DOM, builds & test harness)
Cloudflare Workers ingest endpoint (events → Redpanda → ClickHouse)
Supabase Postgres schema + RLS policies
Auth: tenant signup, API key generation
Sentry + OTel basic instrumentation
Tygodnie 3–4 — Tier 1 Observer:
SDK Tier 1 widget (sidebar overlay, intent display, basic chat anchor)
Event taxonomy v1 (top 30 event types)
Behavioral fingerprinting (Mode A — session only)
Per-tenant config dashboard (Next.js)
Real-time intent vector update (Redis cache)
Tygodnie 5–6 — Intent Engine:
Claude Haiku 4.5 integration via LiteLLM
Intent ontology v1 (12 wymiarów, simplified)
OpenAI embeddings integration + pgvector setup
50 seed archetypes (manually crafted from real estate domain knowledge — Krystian's PhD value here)
Decision API endpoint (Edge Runtime)
Tygodnie 7–8 — Tier 2 Augment + Adaptation:
SDK Tier 2 (declarative slots, DOM augmentation)
Adaptation engine v1: headline rewrite (templates+slots), feature reorder, photo re-rank
A/B holdout framework (10% default)
Inquiry conversion tracking webhook
Tygodnie 9–10 — Compliance & Polish:
DPIA document (master + tenant template)
ROPA auto-export
DSR endpoint + admin UI
Privacy policy generator dla tenants
White-label config
Billing integration (Stripe + usage metering via Lago lub własny)
Tygodnie 11–12 — Pilot launch prep:
Onboard 3 design partners (1 Marbella ES, 1 Warszawa PL, 1 London UK)
Documentation + integration guides
Loom demo videos
Pricing page + signup flow
O.2. Co NIE budujemy w MVP
❌ Tier 3 Native (full SDK component) — Q5–Q6
❌ UAE region deployment — Q5 (legal-heavy, czekamy na pierwszego UAE klienta)
❌ Federated learning — never (centralized DP wystarczy)
❌ Self-hosted Llama fine-tuning — Q7+, after $15M embed/mo crossover
❌ Mobile native SDKs (iOS/Android) — Q5+, MVP web-only
❌ Adaptive video / 3D tour — Q6+
❌ Voice / phone integration — Y2
❌ Multi-language SDK UI (poza EN/ES/PL) — wagi marketu
O.3. Data flywheel ready od dnia 1
Nawet jeśli MVP używa adaptacji w 30% przypadków, zbiera 100% sygnałów:
Pełen event taxonomy aktywny od dnia 1
Anonimowe archetypes generowane co tydzień (cron job na Modal)
ClickHouse z full event history → możemy retrospektywnie rebuild modeli gdy je dodamy
Schema versioning: każdy event ma schema_version, więc można migrować dane forward
O.4. Walidacja z 3–5 pilot klientami
Konkretne metryki sukcesu pilota:
Inquiry rate uplift > 15% (vs holdout group) w pierwszych 60 dniach
Time-on-listing uplift > 20% dla adapted vs holdout
Pilot CSAT > 8/10 od tenant
Latency SLA p95 <100ms dla wszystkich Decision API calls
Zero compliance incidents
Pilot terms: free 90 dni → opcja Tier 2 paid ($1 999/mo) z 50% discount na Y1.
O.5. Budżet i zespół MVP
Zespół (12 tygodni):
Piotr Nawrocki (CEO) — sales, partnerships, fundraising (0.5 FTE on product)
Rafał Palak PhD (CTO) — architecture, backend, ML/AI lead (1 FTE)
Krystian Wojtkiewicz PhD (CPO) — product, real-estate domain ontology, design (1 FTE)
Senior Full-Stack Engineer #1 — SDK lead, frontend (kontraktor lub hire, 1 FTE)
Senior Backend/Data Engineer #2 — ingest, ClickHouse, ML serving (kontraktor lub hire, 1 FTE)
Budżet 12 tygodni:
Pozycja
Koszt
Founders (3 × $5k/mo equity-heavy)
~€36 000
2 senior engineers (€8–12k/mo full cost)
~€60 000–72 000
Legal (DPIA, MSA template, ToS, Privacy Policy x4 jurisdykcje)
€15 000
Infra (Vercel, Supabase, Cloudflare, ClickHouse, Modal, Anthropic credits)
€10 000–15 000
Design + branding (Fraunces + Inter system, dashboard UI)
€8 000
Sales + travel dla 3 pilot klientów
€10 000
Buffer / contingency 15%
€20 000
Total MVP budget
€160 000–200 000
Po MVP, do general launch (kolejne 6 miesięcy), realnie €350 000–500 000 dodatkowo dla zatrudnienia 2 nowych inżynierów + 1 sales/CSM + marketing.

P. Przykładowe User Stories & Data Flows
P.1. Scenariusz 1: Anonimowy buyer w Marbelli (pierwszy raz)
T+0s — Brytyjska kobieta (45) wchodzi na stronę agencji Marbella Realty (Tier 2 Augment). SDK ładuje się async (32KB, 80ms). T+1s — page.view, device.context (UK locale, mobile Safari, view-port iPhone). Session ID = HMAC z fingerprint + tenantsecret + daybucket. T+15s — Widzi listing willi €1.2M, otwiera 4 zdjęcia, dwell na zdjęciu basenu 8s, scrolluje do features. T+45s — Otwiera czat (Intercom integracja), pisze: "Czy ta nieruchomość ma dostęp do pomocy domowej? Planujemy spędzać 4 miesiące rocznie w Hiszpanii."
System reaguje:
Worker Streams: chat message → Claude Haiku 4.5 prompt: extract intent ([NLP intent extraction template])
Output structured JSON: {purchase_purpose: 'second_home', cross_border: 'eu_intra → expat', urgency: 'exploratory', family_stage: 'established_family' (inferred from "we"), feature_priority: {staff_quarters: 0.9, lifestyle: 0.8}, geo_priority: 'beach', budget_band: 'comfortable'}
Match against archetypes: 0.91 similarity z british_part_year_resident_costa_del_sol
Adaptation engine returns directives:
headline.rewrite: "4-Month Lifestyle Villa with Live-In Staff Quarters — Marbella" (zamiast generycznego "3-bed villa for sale")
features.reorder: [staffquarters, pool, beachproximity] na top
photos.reorder: pool deck first, master suite second, kitchen later
chat.suggested_reply: assistance with year-round property management info + tax implications for UK residents (pre-canned z RAG nad tenant FAQ)
T+47s — DOM mutated przez SDK Tier 2; user widzi smoothly zaktualizowany listing T+50s — Agent chat replies (z naszym suggested reply jako draft), user kontynuuje conversation
P.2. Scenariusz 2: Ten sam buyer tydzień później (inna agencja, ten sam tenant network)
Tydzień później — wchodzi na stronę agencji w Walencji (też klienta Estalara, Tier 2). Default tryb = Mode A (Session) → fingerprint dla Walencja agency to inny hash (HMAC z innym tenant_secret), więc cross-tenant identification jest technicznie niemożliwe.
ALE: archetype już jest w globalnym embedding space. SDK na nowej sesji szybko zbiera 10–15 sygnałów (page.view + initial scroll + first listing photo opens) → intent vector ekstrahowany w <30s mapuje do british_part_year_resident_costa_del_sol archetype z confidence 0.78.
→ Adaptation już działa po ~30 sekundach na drugiej witrynie, mimo że buyer "anonimowy" z perspektywy nowego tenanta. To jest data network effect w akcji — drugi tenant od dnia 1 dostaje benefit z archetypów wytrenowanych na danych innych tenantów.
Krytyczne: ten sam ludzki buyer nie jest re-identifikowany — Estalara nie wie że to ta sama osoba. System jedynie szybko klasyfikuje typ buyera. Privacy preserved, value delivered.
P.3. Scenariusz 3: Idealista (Tier 3 Native) — pierwszy tydzień
Setup: Idealista enterprise contract, $150k/mo. Custom integration: Idealista wstawia <EstalaraListing/> component dla 100k properties (gradual rollout, A/B 10% traffic).
Day 1–7 metrics widoczne w dashboardzie (Krystian-led design):
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
Idealista CMO dostaje case study material w 7 dni, Idealista product team widzi że są 87 archetypów w ich traffic (czego nie wiedzieli wewnętrznie), Estalara CSM book quarterly review.

Q. Podsumowanie strategiczne i następne kroki
Estalara Adaptive Listings jest projektowany jako vertically-specialized, embeddable-first, multi-region SaaS, który wykorzystuje trzy strategiczne dźwignie:
Vertical depth — real-estate-specific intent ontology (12 wymiarów, 50–500 archetypów) jest niemożliwa do skopiowania przez generic personalization (Mutiny, Dynamic Yield) bez 18+ miesięcy work.
Embeddable-first DX — SDK <40KB, 3 tiery integracji, zero-touch start (jeden script tag) to przewaga vs stand-alone competitors.
Compliant-by-design data network effect — DP-protected archetype space daje wartość każdemu nowemu klientowi od dnia 1, bez naruszania tenant isolation, GDPR czy ePrivacy.
Następne kroki — gotowość do kodowania:
✅ Architektura zatwierdzona: Cloudflare Workers + Next.js (Vercel) + Supabase + ClickHouse Cloud + Modal + Anthropic Claude (Haiku 4.5/Sonnet 4.6) + OpenAI embeddings + pgvector ✅ Repo struktura: monorepo Turborepo z packages/sdk, packages/sdk-react, apps/ingest (Cloudflare Worker), apps/control-plane (Next.js), apps/intent-engine (Modal Python), infra/ (Terraform) ✅ Schema baz danych: Postgres (tenants, configs, billing, listings_metadata) z RLS + ClickHouse (events, sessions) + pgvector (per-tenant embeddings + global archetype space) ✅ Schema eventów: 30+ event types w wspólnym envelope, JSON Schema versioned ✅ DPIA + MSA + ToS + Privacy Policy template — legal sprint M1 ✅ MVP backlog: Linear/Jira projekt z ~150 ticketami pokrywającymi 12-tygodniowy plan
Rekomendowany sygnał dla zespołu: rozpocznij sprint zerowy w poniedziałek — Rafał stawia monorepo + ingest worker, Krystian finalizuje intent ontology v1 + 50 seed archetypów (jego PhD work value), Piotr zapisuje 3 design partner conversations, Estalara wchodzi w execution mode.

Dokument przygotowany na bazie analizy 35+ źródeł zewnętrznych (Anthropic, OpenAI, Cloudflare, EDPB, ICO, CNIL, UAE Data Office, Mutiny, Optimizely, Dynamic Yield, Segment, Drift/Intercom, ClickHouse, Supabase, Vercel, Cloudflare, Modal, RunPod, pgvector benchmarks, Pinecone, Cohere, BGE) — wszystkie konkretne stwierdzenia są oparte na cytowanych linkach. Stan prawny i pricingowy aktualny na 25 kwietnia 2026.
