# TICKET-DESC-PIVOT-001 v1.7.1 — Anti-hallucination + voice-pattern templates

**Status:** SPEC READY (supersedes v1.7 plan) **Date:** 15 May 2026 **Author:** Piotr Nawrocki +
Claude (Opus 4.7 xhigh) **Branch target:** `claude/adaptive-listings-docs-J4W9H` **Recommended
Claude Code model:** Opus 4.7 xhigh

---

## Context: dlaczego v1.7.1, a nie v1.7

Plan v1.7 (poprzednia wersja w project knowledge) zawierał krytyczną lukę: templates miały hardcoded
liczby (`{yield}%`, `above 95% occupancy`, `at {price_per_sqm}`, `WAULT of {wault} years`). Gdy
Sonnet dostaje to jako "voice/framing seed" + oryginał agenta + listing_context bez tych liczb → dwa
złe scenariusze:

1. **Sonnet zachowuje strukturę** i wymyśla liczby → halucynacja (ryzyko reputacyjne i prawne — w
   UK/EU misrepresentation w nieruchomościach to przestępstwo)
2. **Sonnet pomija zdanie** → opis traci przewagę nad oryginałem agenta

W obecnych templates są też **hardcoded "fakty" które nie są placeholderami** — np. yield_hunter
mówi `"historical occupancy in this micro-market sits above 95%"` jako twarde stwierdzenie. To po
prostu nieprawda dla większości listingów.

**v1.7.1 rozwiązuje to przez:**

1. **Templates przepisane jako pure voice/framing patterns** — zero konkretnych liczb, zero
   hardcoded "faktów". Templates opisują JAK Sonnet ma pisać dla archetypu, NIE CO ma napisać.
2. **Strict whitelist** w Sonnet system prompt — Sonnet pisze TYLKO o faktach z
   `original_description` lub `listing_context`. Inne źródła (data-estalara, agency answers,
   external API) wprowadzimy w osobnych ticketach gdy dojrzeje.
3. **Generic positive claims OK** — gdy voice wymaga "lead with cashflow" a brak yield, Sonnet pisze
   "attractive rental yield" (bez liczby), nie wymyśla "6.2%". Voice consistency wygrywa z
   maksymalnym rygorem.
4. **Audit trail w response metadata** — Sonnet zwraca `verified_facts_used: [...]` jako osobne pole
   JSON, logujemy do ClickHouse. Description text pozostaje czysty.
5. **Test test_hallucination_resistance** — sprawdza że gdy original_description zawiera tylko
   "3-bed flat in Madrid", Sonnet nie wymyśli yield, occupancy, ratings.

## Decyzje Piotra (locked 2026-05-15)

| #   | Pytanie                                        | Decyzja                                                               |
| --- | ---------------------------------------------- | --------------------------------------------------------------------- |
| 1   | Strategia anti-hallucination                   | Templates BEZ konkretnych liczb — voice/framing pattern only          |
| 2   | Whitelist verified facts                       | Tylko `original_description` + `listing_context` (rygor maksymalny)   |
| 3   | Voice pattern wymaga claim o nieznanej liczbie | "attractive rental yield" OK (generic positive claim, no number)      |
| 4   | Audit trail w outputie                         | TAK — response metadata (verified_facts_used), nie w description text |

## Architektura — diff vs v1.7

### Templates: voice patterns, nie marketing copy

**v1.7 (źle):**

```
"A gross rental yield of {yield}% and projected annual income of {income} put this
asset firmly in the income-producing category from day one. Located in {location},
the property benefits from {transport_links} and a tenant pool that keeps voids low —
historical occupancy in this micro-market sits above 95%..."
```

**v1.7.1 (dobrze):**

```yaml
yield_hunter:
  voice_pattern_en: |
    Tone: analytical, numbers-first, dismissive of lifestyle framing. Lead with
    cashflow language whenever yield, income or occupancy data exists in verified
    facts. If those data points are absent, lead with location quality and tenant
    demand patterns from agent's description. Frame all features in cashflow terms.
    Avoid emotional or aspirational language ("dream home", "perfect for"). End with
    a sentence positioning this as an income asset rather than a lifestyle purchase.
  hard_rules_en: |
    - NEVER quote specific numbers (yields, occupancy %, ADR, cap rates) unless they
      appear in verified_facts (original_description or listing_context).
    - NEVER write "above 95%", "low voids", "high yield" as facts — these are claims
      requiring data.
    - Generic positive claims ARE permitted: "attractive yield", "strong demand",
      "well-positioned" — these describe quality without quantitative claims.
  length_target: ~140 words
```

### Sonnet prompt: strict whitelist

System prompt dostaje twardy guard-rail:

```
WHITELIST RULES (do not violate):

1. The ONLY sources of facts you may write about are:
   (a) original_description — agent's text
   (b) listing_context — structured property data passed in payload

2. You MUST NOT mention numbers, ratings, distances, percentages, prices, dates,
   names of schools/hospitals/companies, or any specific quantitative or named
   facts unless they appear explicitly in (a) or (b).

3. Generic positive descriptors WITHOUT numbers are permitted:
   ALLOWED:  "attractive yield", "strong rental demand", "spacious garden",
             "well-connected", "established neighbourhood"
   FORBIDDEN: "yield of 6.2%", "above 95% occupancy", "300m from Tube",
             "Ofsted Outstanding", "Knight Frank managed"

4. If voice_pattern asks you to "lead with cashflow" but no yield/income data
   exists in verified facts, use generic positive cashflow language. Do not
   invent numbers.

5. At the end of your response, output a separate JSON block listing the verified
   facts you actually used:

   <verified_facts_used>
   ["bedrooms: 3", "location: Marbella Old Town", "garden: yes", "epc: B"]
   </verified_facts_used>

6. Do not include the <verified_facts_used> block in the description text. The
   description text and audit block are returned separately.
```

### Endpoint response: audit field

```typescript
type DescriptionResponse = {
  description: string | null;
  source: 'template_fallback' | 'ai_cached' | 'original';
  locale: 'en' | 'pl' | 'es';
  generated_at: string | null; // ISO 8601
  verified_facts_used?: string[]; // NEW — Tier 2/3 ai_cached only
};
```

`verified_facts_used` jest logowane do ClickHouse z każdą generacją (kolumna w
`description_generations` tabeli). Można potem audytować "co Sonnet faktycznie użył?".

### listing_context structure (clarification)

To pole już istnieje w v1.7, ale dla v1.7.1 dodajemy zasadę: każda wartość w `listing_context`
traktowana jest jako verified fact. Nie wprowadzamy nowych pól na tym etapie.

```typescript
type ListingContext = {
  bedrooms?: number;
  bathrooms?: number;
  area_sqm?: number;
  property_type?: string;
  location?: { city?: string; neighbourhood?: string; country?: string };
  price?: { value: number; currency: string };
  tenure?: string;
  epc_rating?: string;
  features?: string[];
  // ...inne pola z TenantConfig data_extractors
};
```

---

## 18 archetypów × 3 locale = 54 voice patterns

**Struktura per archetype:**

```typescript
copy_template: {
  // EN/PL/ES kazdy ma trzy klucze:
  en: {
    voice_pattern: string,    // ~80-120 słów — JAK pisać
    hard_rules: string,       // ~30-50 słów — czego NIGDY nie wolno
    length_target: number,    // ~140
  },
  pl: { ... },
  es: { ... }
}
```

> **Implementation note:** dla zachowania backward compatibility z istniejącym typem
> `PlaybookEntry.copy_template`, w v1.7.1 zachowujemy płaski string per locale, ale jego treść to
> **structured voice pattern**, nie marketing copy. Treść każdego stringu zawiera dwie sekcje:
> `VOICE PATTERN:` i `HARD RULES:`. Modal job parsuje obie sekcje przed przekazaniem Sonnetowi.

**Pełna treść 54 voice patterns:** patrz Appendix A na końcu tego dokumentu.

---

## Zmiany w plikach (vs v1.7 plan)

| Plik                                                     | Zmiana vs v1.7                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `packages/sdk/src/core/playbooks/archetypes/*.ts` (18)   | Templates przepisane jako voice patterns (zamiast marketing copy z liczbami)          |
| `packages/sdk/src/core/playbooks/types.ts`               | JSDoc rozszerzony o opis voice_pattern + hard_rules format                            |
| `apps/llm-gateway/src/jobs/generate_description.py`      | + strict whitelist w system prompt + parsing `<verified_facts_used>` z output Sonneta |
| `apps/llm-gateway/src/jobs/test_generate_description.py` | + test_hallucination_resistance + test_verified_facts_extraction                      |
| `packages/shared/src/schemas/description.ts`             | + `verified_facts_used: z.array(z.string()).optional()`                               |
| `apps/control-plane/src/lib/description-cache.ts`        | + logowanie verified_facts_used do ClickHouse                                         |
| `apps/data-warehouse/migrations/*.sql`                   | NEW — kolumna `verified_facts_used: Array(String)` w `description_generations`        |
| `docs/MASTER_DESIGN.md`                                  | v1.7 → v1.7.1, sekcja E.7 dostaje subsekcję E.7.5 "Anti-hallucination guard-rails"    |
| `backlog/sprint-9/TICKET-DESC-001.md`                    | AC #11 dodaje wymóg test_hallucination_resistance, AC #14 audit trail w ClickHouse    |
| `CONVENTIONS_PATCH.md`                                   | + Rule "AI-generated content uses strict fact whitelist + audit trail"                |

---

## Acceptance Criteria (rozszerzone vs v1.7)

Wszystkie AC z v1.7 + następujące dodatki:

**AC #14 (NEW) — Anti-hallucination guard-rail:** Sonnet system prompt zawiera WHITELIST RULES
(treść z sekcji "Sonnet prompt: strict whitelist" powyżej). Test `test_hallucination_resistance`
weryfikuje że gdy `original_description = "3-bed flat in Madrid"` i
`listing_context = {bedrooms: 3, location: {city: "Madrid"}}`, Sonnet NIE wymyśli yield, occupancy,
school ratings, distances ani innych liczb nie obecnych w whitelist.

**AC #15 (NEW) — Audit trail:** Modal job parsuje `<verified_facts_used>...</verified_facts_used>` z
output Sonneta, zapisuje jako tablicę stringów w response.
`apps/control-plane/src/lib/description-cache.ts` przekazuje to do ClickHouse jako kolumnę
`verified_facts_used: Array(String)` w tabeli `description_generations`. Endpoint response zawiera
`verified_facts_used` w odpowiedzi `ai_cached` (opcjonalnie — dla auditu po stronie agencji).

**AC #16 (NEW) — Voice pattern templates:** Każdy z 18 archetypów ma `copy_template[locale]` w
formacie structured: sekcja `VOICE PATTERN:` (jak pisać) + sekcja `HARD RULES:` (czego nie wolno).
Zero placeholderów typu `{yield}`, `{occupancy_rate}`, `{adr}`, `{wault}` itp. (lista zakazanych
placeholderów liczbowych w `__tests__/template-purity.test.ts`).

**AC #17 (NEW) — Test template purity:** CI gate sprawdza że żaden `copy_template[locale]` nie
zawiera regex `\{[a-z_]+\}` dla zakazanych zmiennych: `yield`, `income`, `occupancy_rate`, `adr`,
`price_per_sqm`, `cap_rate`, `wault`, `lease_remaining`, `passing_rent`, `reversionary_yield`,
`ltv`, `portfolio_yield`, `comparable_units`, `flip_timeline`, `refurb_comp`, `visa_threshold`,
`covenant_rating`, `schools_rating`, `broadband_speed`, `climate_summary`, `distance_to_university`,
`distance_from_primary`, `airport`, `view`, `epc_rating`, `tenure`, `tenant_name`,
`university_name`, `garden_or_balcony`, `garden_sqm`, `sleeps`, `transport_links`. Dozwolone są
tylko placeholdery dla pól archetype voice (np. `{archetype_name}` w meta-templatce — żaden z 18
archetypów ich nie wymaga, więc whitelist jest pusta).

---

## Komendy terminalowe — flow

Plan TICKET-DESC-PIVOT-001 v1.7 miał 14 komend. v1.7.1 zachowuje tę samą strukturę, **ale**:

1. **Komenda 2c (heredoc TEMPLATES)** — zastąpiona nową treścią z 54 voice patterns (Appendix A).
2. **Komenda 5 (Modal job patch)** — rozszerzona o:
   - Whitelist rules w system_prompt
   - Parsing `<verified_facts_used>` z output
3. **Komenda 6 (test)** — zastąpiona dwoma testami: `test_hallucination_resistance` +
   `test_verified_facts_extraction`
4. **Komenda 8 (Master Design)** — dodaje subsekcję E.7.5
5. **Nowa komenda 9b** — migration SQL dla ClickHouse `verified_facts_used`
6. **Nowa komenda 9c** — test `template-purity.test.ts`

Pozostałe komendy (0, 1, 3, 4, 7, 10-14) bez zmian.

> **Implementation strategy:** delegacja do Opus 4.7 xhigh w Claude Code. Agent (sdk-engineer dla
> templates + ml-engineer dla Modal job patch) dostanie ten plik jako spec, wygeneruje pełne 54
> voice patterns na bazie wytycznych z Appendix A i wpisze je do plików.

---

## Appendix A — 18 archetype voice patterns (wytyczne dla agenta)

Każdy archetype definiuje:

- **Tone descriptors** (3-5 słów)
- **Lead-with priority** (od czego zacząć opis)
- **Frame** (przez jaki pryzmat opisać property)
- **Closer** (jak zakończyć)
- **Lexicon hints** (preferowane / unikane słowa)
- **Hard rules** (czego NIGDY nie pisać)

> **UWAGA dla agenta:** wygeneruj pełną treść w EN/PL/ES (~140 słów per locale) BEZ liczb, BEZ
> placeholderów typu `{yield}` itp. Każda treść to instrukcja JAK pisać, nie gotowy tekst.

### 1. yield_hunter

- **Tone:** analytical, numbers-first, dismissive of lifestyle
- **Lead-with:** cashflow language (if data exists), tenant demand patterns
- **Frame:** every feature in cashflow terms (garden → rental premium, location → tenant demand)
- **Closer:** position as income asset, not lifestyle purchase
- **Lexicon preferred:** cashflow, yield, tenant demand, occupancy, ROI, defensible, cycle-resistant
- **Lexicon avoid:** dream, perfect for, family-friendly, charming
- **Hard rules:** No yield %, no occupancy %, no ADR unless in verified_facts. "Attractive yield"
  OK; "6.2% yield" forbidden.

### 2. family_buyer

- **Tone:** warm, practical, grounded
- **Lead-with:** layout suitability for family life, room flexibility
- **Frame:** day-to-day rhythm of family — mornings, weekends, growth phases
- **Closer:** house you grow into, not out of
- **Lexicon preferred:** room to grow, daily rhythm, generous storage, flexible layout, walking
  distance
- **Lexicon avoid:** investment, yield, ROI, cap rate, exit
- **Hard rules:** No school ratings, no Ofsted, no specific catchment names unless in
  verified_facts. "Well-regarded local schools" OK if neighbourhood mentioned in agent description;
  "Ofsted Outstanding" forbidden.

### 3. lifestyle_expat

- **Tone:** reassuring, cosmopolitan, low-friction
- **Lead-with:** international community context, English-language services
- **Frame:** soft landing for someone moving from abroad
- **Closer:** soft landing, not a renovation project
- **Lexicon preferred:** international community, bilingual, soft landing, walkable, established
- **Lexicon avoid:** authentic local experience, off the beaten path, charming chaos
- **Hard rules:** No specific neighbourhood names, no distance figures, no "English-speaking" claims
  unless agent description supports it. "Established international community in the area" OK if
  location is international hub by general knowledge; specific claims forbidden.

### 4. first_time_buyer

- **Tone:** encouraging, honest, reassuring
- **Lead-with:** affordability framing, scheme eligibility (if price data exists)
- **Frame:** foot in the door, manageable next step
- **Closer:** place you'll be happy to wake up in
- **Lexicon preferred:** manageable, predictable, foot in the door, move-in ready, planable
- **Lexicon avoid:** trophy, prestige, investment-grade, luxury
- **Hard rules:** No specific scheme names (Help-to-Buy, Pierwsze Mieszkanie) unless mentioned in
  agent description. No mortgage rate quotes. "Affordable for first-time buyers" OK if price in
  verified_facts and below market average is reasonable inference.

### 5. luxury_buyer

- **Tone:** discreet, authoritative, understated
- **Lead-with:** address/positioning quality (if location data exists)
- **Frame:** quiet authority, considered choice
- **Closer:** destination, not upgrade
- **Lexicon preferred:** considered, discreet, principal suite, quiet authority, hand-laid
- **Lexicon avoid:** opportunity, deal, investment, yield, affordable
- **Hard rules:** No specific brand names (Gaggenau, Sub-Zero, Bulthaup) unless in agent
  description. No view descriptions ("sea view", "skyline") unless in verified_facts. "Premium
  fittings throughout" OK; "Gaggenau and Sub-Zero" forbidden unless mentioned.

### 6. remote_worker

- **Tone:** practical, work-aware, modern
- **Lead-with:** workspace suitability (if bedrooms/rooms data exists)
- **Frame:** how work actually happens now
- **Closer:** designed for the way work happens
- **Lexicon preferred:** dedicated office, quiet, reliable, dual-purpose, predictable
- **Lexicon avoid:** lifestyle, retreat, escape, getaway
- **Hard rules:** No specific broadband speeds, no Mbps, no Tube/metro distances unless in
  verified_facts. "Fast broadband" OK if agent mentions fibre; "1Gbps fibre" forbidden unless
  explicit.

### 7. downsizer

- **Tone:** dignified, practical, calm
- **Lead-with:** right-sizing framing, single-level features (if layout data exists)
- **Frame:** next chapter, not the one you've outgrown
- **Closer:** frees up time, capital and head-space
- **Lexicon preferred:** right-sized, manageable, single-level, dignified, calm
- **Lexicon avoid:** investment, scale, portfolio, family-sized, ambition
- **Hard rules:** No specific service charge figures, no specific EPC ratings unless in
  verified_facts. "Efficient heating" OK; "EPC B" forbidden unless explicit.

### 8. upsizer

- **Tone:** practical, family-aware, optimistic
- **Lead-with:** space flexibility, growth headroom (if rooms data exists)
- **Frame:** house where the next child has their own room
- **Closer:** scope for the next ten years
- **Lexicon preferred:** room to grow, flexible, family-sized, scope, headroom
- **Lexicon avoid:** compact, efficient, low-maintenance, single
- **Hard rules:** No specific school ratings, no specific local secondary names unless in
  verified_facts. "Schools within easy reach" OK if location in agent description; specific names
  forbidden.

### 9. retiree_relocator

- **Tone:** calm, sunlit, practical
- **Lead-with:** lifestyle quality (if location data exists), accessibility
- **Frame:** retirement you described to yourself ten years ago
- **Closer:** made operational
- **Lexicon preferred:** sunlit, accessible, established community, predictable, calm
- **Lexicon avoid:** investment, ambition, fast-paced, scale
- **Hard rules:** No specific climate figures (average temperature, days of sun), no specific
  airport distances, no specific hospital names unless in verified_facts. "Mild climate" OK if
  location is generally mild by knowledge; "average 22°C" forbidden.

### 10. vacation_rental_investor

- **Tone:** operational, data-aware, platform-fluent
- **Lead-with:** short-let suitability (if licence/photo readiness data exists)
- **Frame:** unit that starts producing week one
- **Closer:** producing in week one, not month six
- **Lexicon preferred:** turnkey, platform-ready, operational, documented, photogenic
- **Lexicon avoid:** family home, retirement, long-term, lifestyle
- **Hard rules:** No occupancy %, no ADR, no platform-specific commission rates unless in
  verified_facts. "Strong short-let demand in the area" OK if location is established tourist area;
  "85% occupancy on Airbnb" forbidden unless explicit.

### 11. flip_investor

- **Tone:** trade-fluent, margin-focused, unsentimental
- **Lead-with:** structural soundness (if condition data exists), cosmetic state
- **Frame:** scares retail, rewards trade
- **Closer:** exit math is straightforward
- **Lexicon preferred:** flip margin, cosmetic, structural, trade, exit math
- **Lexicon avoid:** dream, charming, character, original features
- **Hard rules:** No specific refurb comparable prices, no specific flip timelines unless in
  verified_facts. "Refurbishment scope exists" OK if condition is described as dated; "£50k refurb
  spend" forbidden.

### 12. portfolio_builder

- **Tone:** systems-thinking, operational, scale-aware
- **Lead-with:** fit-into-system framing, operational extensibility
- **Frame:** another cog in a system that already runs
- **Closer:** operational leverage
- **Lexicon preferred:** portfolio, homogeneous, extends, operational, blended yield, system
- **Lexicon avoid:** unique, special, one-of-a-kind, character home
- **Hard rules:** No specific LTV %, no specific blended yield %, no specific comparable unit counts
  unless in verified_facts. "Fits standard portfolio profile" OK; "85% LTV available, 6.2% blended
  yield" forbidden.

### 13. golden_visa_buyer

- **Tone:** programme-aware, compliant, defensible
- **Lead-with:** programme fit (if price data + location data exist), documentation quality
- **Frame:** cleanest, most defensible path the programme allows
- **Closer:** capital preserved in real estate, not a fund
- **Lexicon preferred:** programme-eligible, documented, defensible, qualifying, genuine residential
- **Lexicon avoid:** loophole, easy, fast-track, guaranteed approval
- **Hard rules:** No specific programme names (Golden Visa Portugal, Spain Investor Visa) unless in
  verified_facts. No specific investment thresholds unless explicit. "Eligible for
  residency-by-investment programmes" OK if price and country support it; specific programme names
  forbidden unless mentioned.

### 14. commercial_investor

- **Tone:** institutional, underwriting-fluent, defensible
- **Lead-with:** covenant quality (if tenant data exists), lease term
- **Frame:** underwriting IS the story
- **Closer:** defensible underwrite with value-add levers
- **Lexicon preferred:** covenant, WAULT, reversion, underwrite, defensible, value-add
- **Lexicon avoid:** charming, opportunity for, character, home-like
- **Hard rules:** No specific tenant names, no specific WAULT years, no specific yield % unless in
  verified_facts. "Established tenant covenant" OK if agent mentions long lease; "10-year FRI lease
  to Tesco, WAULT 8.2 years" forbidden unless explicit.

### 15. diaspora_buyer

- **Tone:** dual-ledger, culturally aware, emotionally honest
- **Lead-with:** familiarity + modern fittings combination
- **Frame:** intersection of financial and personal ledger
- **Closer:** deeper return is the address itself
- **Lexicon preferred:** familiar, recognisable, bilingual, dual-purpose, generational
- **Lexicon avoid:** exotic, foreign, abroad, expat
- **Hard rules:** No specific notary names, no specific fiscal representative firms unless in
  verified_facts. "Non-resident purchase well-trodden in this market" OK if country is established
  diaspora destination; "Smith & Co bilingual notary on call" forbidden.

### 16. second_home_buyer

- **Tone:** lifestyle-aware, lock-up-and-leave, dual-purpose
- **Lead-with:** weekend-arrival feeling (if location data exists)
- **Frame:** more weekends, not more admin
- **Closer:** engineered for more weekends
- **Lexicon preferred:** weekend, lock-up-and-leave, dual-purpose, low-admin, escape
- **Lexicon avoid:** primary residence, every-day, daily commute, family rhythm
- **Hard rules:** No specific distances from primary residence, no specific short-let occupancy %
  unless in verified_facts. "Reasonable drive from major cities" OK if location supports it; "2.5
  hours from London" forbidden unless explicit.

### 17. student_parent

- **Tone:** parent-reassuring, dual-purpose, practical
- **Lead-with:** proximity to university (if location/distance data exists)
- **Frame:** does two jobs without compromising either
- **Closer:** slides straight into student rental market at graduation
- **Lexicon preferred:** dual-purpose, calm parents, durable, walking distance, exit market
- **Lexicon avoid:** family home, retirement, executive
- **Hard rules:** No specific university names, no specific distance figures, no specific yield %
  unless in verified_facts. "Walking distance to campus" OK if location is near university by
  general knowledge; "300m from King's College" forbidden unless explicit.

### 18. neutral

- **Tone:** balanced, fundamentals-focused, non-leading
- **Lead-with:** practical accommodation summary
- **Frame:** sound fundamentals, depends on buyer priorities
- **Closer:** fundamentals sound, asking price fair
- **Lexicon preferred:** practical, sound, balanced, conventional, fair
- **Lexicon avoid:** opportunity, perfect, dream, must-see, exclusive
- **Hard rules:** No specific ratings, no specific distances unless in verified_facts. Generic
  descriptors throughout. This is the safest archetype — when in doubt about claims, default to
  neutral language.

---

## Appendix B — Sonnet system prompt (final v1.7.1)

```
You are an expert real-estate copywriter writing adaptive listing descriptions
for a specific buyer archetype: {archetype}.

You will receive:
- archetype_voice_pattern: instructions on how this archetype's copy should sound
- archetype_hard_rules: what you must NEVER write for this archetype
- original_description: agent's original listing copy (factual source of truth)
- listing_context: structured property data (also factual source of truth)
- locale: {locale} (en/pl/es)

WHITELIST RULES — DO NOT VIOLATE:

1. The ONLY sources of facts you may write about are:
   (a) original_description — agent's text
   (b) listing_context — structured property data

2. You MUST NOT mention numbers, ratings, distances, percentages, prices, dates,
   names of schools/hospitals/companies, or any specific quantitative or named
   facts unless they appear explicitly in (a) or (b).

3. Generic positive descriptors WITHOUT numbers are permitted:
   ALLOWED:  "attractive yield", "strong rental demand", "spacious garden",
             "well-connected", "established neighbourhood"
   FORBIDDEN: "yield of 6.2%", "above 95% occupancy", "300m from Tube",
             "Ofsted Outstanding", "Knight Frank managed"

4. If voice_pattern asks you to "lead with cashflow" but no yield/income data
   exists in verified facts, use generic positive cashflow language. Do not
   invent numbers.

5. At the end of your response, output a separate JSON block listing the verified
   facts you actually used:

   <verified_facts_used>
   ["bedrooms: 3", "location: Marbella Old Town", "garden: yes", "epc: B"]
   </verified_facts_used>

6. Do not include the <verified_facts_used> block in the description text. The
   description text and audit block are returned separately.

7. Target length: ~140 words for the description body.

8. Write in {locale} (en/pl/es). Match the linguistic register of the
   archetype_voice_pattern, which is provided in {locale}.

Now write the description following archetype_voice_pattern and archetype_hard_rules,
respecting the WHITELIST RULES above.
```

---

## Appendix C — Test cases (kluczowe)

### test_hallucination_resistance

```python
def test_hallucination_resistance() -> None:
    """When verified facts are minimal, Sonnet must not invent numbers or names."""
    from apps.llm_gateway.src.jobs.generate_description import _generate_with_sonnet
    from unittest.mock import patch, MagicMock

    # Minimal fact set — Sonnet has almost nothing to work with
    minimal_original = "3-bed flat in Madrid"
    minimal_context = {"bedrooms": 3, "location": {"city": "Madrid"}}

    # Voice pattern that tempts hallucination
    yield_hunter_voice = """
    VOICE PATTERN: Lead with cashflow language. Frame all features in cashflow terms.
    HARD RULES: No yield %, no occupancy %, no ADR unless in verified_facts.
    """

    mock_response = MagicMock()
    # Simulate a well-behaved Sonnet response
    mock_response.content = [MagicMock(text="""
    A Madrid apartment positioned for income-focused investors. With three bedrooms
    in a city with established rental demand, the unit fits a cashflow strategy
    without aspirational framing. Rental yield is attractive in this market type.
    Position: income asset rather than lifestyle purchase.

    <verified_facts_used>
    ["bedrooms: 3", "location: Madrid"]
    </verified_facts_used>
    """)]

    with patch("anthropic.Anthropic") as mock_anthropic_cls:
        mock_client = MagicMock()
        mock_client.messages.create.return_value = mock_response
        mock_anthropic_cls.return_value = mock_client

        result = _generate_with_sonnet(
            archetype="yield_hunter",
            copy_template=yield_hunter_voice,
            original_description=minimal_original,
            listing_context=minimal_context,
            tier=2,
            locale="en",
        )

    # Result is a tuple (description, verified_facts_used)
    description, verified_facts = result

    # Anti-hallucination assertions
    forbidden_patterns = [
        r"\d+\.\d+%",          # any decimal percentage like 6.2%
        r"\d+% (occupancy|yield)",  # 85% occupancy
        r"€\d+",                # any euro amount
        r"\d+ sqm",            # any square metres figure
        r"Ofsted",              # specific schools authority
        r"Airbnb",              # platform name not in facts
    ]
    import re
    for pattern in forbidden_patterns:
        assert not re.search(pattern, description, re.IGNORECASE), \
            f"Hallucinated forbidden pattern '{pattern}' in: {description}"

    # Audit trail assertions
    assert isinstance(verified_facts, list)
    assert "bedrooms: 3" in verified_facts
    assert "location: Madrid" in verified_facts


def test_verified_facts_extraction() -> None:
    """Parser must extract <verified_facts_used> block correctly."""
    from apps.llm_gateway.src.jobs.generate_description import _parse_verified_facts

    sonnet_output = """
    Description text here without facts block in body.

    <verified_facts_used>
    ["bedrooms: 3", "location: Marbella", "garden: yes"]
    </verified_facts_used>
    """

    description, facts = _parse_verified_facts(sonnet_output)
    assert "Description text here" in description
    assert "<verified_facts_used>" not in description  # block stripped
    assert facts == ["bedrooms: 3", "location: Marbella", "garden: yes"]


def test_verified_facts_missing_falls_back_gracefully() -> None:
    """If Sonnet forgets the audit block, response still works (facts=[])."""
    from apps.llm_gateway.src.jobs.generate_description import _parse_verified_facts

    sonnet_output = "Just a description, no audit block."

    description, facts = _parse_verified_facts(sonnet_output)
    assert description == "Just a description, no audit block."
    assert facts == []
```

### template-purity.test.ts

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { glob } from 'glob';

describe('Template purity — no numeric placeholders in voice patterns', () => {
  const FORBIDDEN_PLACEHOLDERS = [
    'yield',
    'income',
    'occupancy_rate',
    'adr',
    'price_per_sqm',
    'cap_rate',
    'wault',
    'lease_remaining',
    'passing_rent',
    'reversionary_yield',
    'ltv',
    'portfolio_yield',
    'comparable_units',
    'flip_timeline',
    'refurb_comp',
    'visa_threshold',
    'covenant_rating',
    'schools_rating',
    'broadband_speed',
    'climate_summary',
    'distance_to_university',
    'distance_from_primary',
    'airport',
    'view',
    'epc_rating',
    'tenure',
    'tenant_name',
    'university_name',
    'garden_or_balcony',
    'garden_sqm',
    'sleeps',
    'transport_links',
    'visa_program',
    'price_vs_average',
    'sqm',
    'bedrooms',
    'bathrooms',
    'price',
    'location',
    'neighbourhood',
    'city',
  ];

  it.each(FORBIDDEN_PLACEHOLDERS)(
    'no archetype template contains {%s} placeholder',
    (placeholder) => {
      const files = glob.sync('packages/sdk/src/core/playbooks/archetypes/*.ts');
      for (const file of files) {
        const content = readFileSync(file, 'utf-8');
        const regex = new RegExp(`\\{${placeholder}\\}`, 'g');
        const matches = content.match(regex);
        expect(matches, `${file} contains forbidden {${placeholder}}`).toBeNull();
      }
    },
  );
});
```

---

## Appendix D — Master Design v1.7.1 — gotowy markdown do podmiany

Ten appendix zawiera **gotowy tekst** który agent ma wpisać do `docs/MASTER_DESIGN.md`. Agent NIE
generuje tej treści sam — kopiuje stąd dosłownie.

### D.1. Header (linia ~3 pliku) — podmień

**Old:**

```
**Wersja:** 1.6 (Master Design Document — Adaptation Engine extensions: variants, placeholder resolution, description pipeline) | **Data:** 14 maja 2026
```

**New:**

```
**Wersja:** 1.7.1 (Master Design Document — Description pipeline pivot: original-first + anti-hallucination guard-rails) | **Data:** 15 maja 2026
```

### D.2. Changelog v1.7.1 — wstaw PRZED changelog v1.6

```markdown
**Changelog v1.7.1 (15 May 2026 — Description pipeline pivot + anti-hallucination guard-rails):**

- 🔄 Sekcja **E.7 "Long-form Description Pipeline"** przepisana w dwóch wymiarach:
  - **Original-first behavior:** Tier 2/3 cache miss → endpoint zwraca `source: 'original'` z
    `description: null`, SDK NIE rusza DOM (agent's original copy zostaje widoczne dla buyera 1).
    AI-adapted copy pojawia się dopiero dla buyera N+1 (cache hit po Modal job). Powód: archetypal
    templates wstawione w miejsce realnego opisu agenta na pierwszej wizycie wyglądają sztucznie i
    mogą się kłócić faktograficznie z resztą strony.
  - **Anti-hallucination guard-rails:** Templates przepisane jako pure voice/framing patterns (zero
    konkretnych liczb, zero hardcoded "faktów"). Sonnet system prompt dostaje strict whitelist —
    pisze TYLKO o faktach z `original_description` lub `listing_context`. Audit trail przez
    `<verified_facts_used>` parsowany do ClickHouse.
- ✨ **Endpoint contract change**: `GET /api/adapt/description` zostaje dla Tier 1 (sidebar widget,
  zwraca `copy_template`). Dla Tier 2/3 nowy `POST /api/adapt/description` z body
  `{ listing_id, archetype, tier, locale, original_description, listing_context }`. POST jest
  potrzebny, bo `original_description` może być długie (kilkaset–kilka tysięcy znaków).
- ✨ Nowa wartość w `source` enum: `'original'`. Schema:
  `'template_fallback' | 'ai_cached' | 'original'`.
- ✨ Nowe pole `verified_facts_used: Array(String)` w response (Tier 2/3 ai_cached) i w ClickHouse
  `description_generations`. Audit trail które fakty Sonnet faktycznie użył.
- 🔄 Templates `copy_template.en/pl/es` w 18 archetypach przepisane jako structured voice patterns
  (sekcje `VOICE PATTERN:` + `HARD RULES:`). Zero placeholderów liczbowych (`{yield}`,
  `{occupancy_rate}`, `{adr}`, `{wault}` itp.). CI gate `template-purity.test.ts` blokuje regresje.
- 🔄 Modal job `apps/llm-gateway/src/jobs/generate_description.py`:
  - Przyjmuje `original_description` w event payload, używa jako faktograficzny seed.
  - System prompt zawiera WHITELIST RULES (Appendix B spec'u TICKET-DESC-PIVOT-001).
  - Parsuje `<verified_facts_used>` z output Sonneta i zwraca jako osobne pole.
- 🔄 SDK (TICKET-DESC-001 scope) na Tier 2/3 ekstraktuje oryginalny opis z DOM przez
  `tenant.data_extractors.description` selektor, wysyła w POST body. Na `source: 'original'`
  zostawia DOM. Na `source: 'ai_cached'` podmienia.
- ✨ Nowa subsekcja **E.7.5 "Anti-hallucination guard-rails"** — formalne reguły whitelistu i
  polityka audit trail.
- 📝 Reguła w `CONVENTIONS_PATCH.md`: "AI-adapted display copy never replaces agent's original on
  first view" + "AI-generated content uses strict fact whitelist + audit trail".
- 🔧 Decyzje Piotra (locked 2026-05-15): templates BEZ liczb / whitelist tylko original+context /
  generic positive claims OK ("attractive yield" bez liczby) / audit trail w metadata.
```

### D.3. Pełna nowa sekcja E.7 — podmień całość

Agent znajduje istniejącą sekcję `### E.7. Long-form Description Pipeline` (z v1.6) i podmienia ją
na poniższy tekst. Granicę "do gdzie podmieniać" wyznacza następny nagłówek tej samej głębokości
(`### E.8`) lub wyższej (`## F`).

````markdown
### E.7. Long-form Description Pipeline (v1.7.1 — original-first + anti-hallucination)

**Fundamentalna zasada:** AI-adapted copy NIGDY nie wypiera agentowego oryginału na pierwszej
wizycie buyera. Dopiero gdy Sonnet skończy generację (w tle, dla konkretnej kombinacji listing ×
archetype × locale), kolejny buyer w tej samej kombinacji dostaje wersję zoptymalizowaną. Dodatkowo:
Sonnet NIGDY nie zmyśla faktów (liczb, nazw, ratings) których nie ma w `original_description` ani
`listing_context`.

#### E.7.1. Endpoint contract

| Method | Path                     | Tier | Body / Query                                                                   | Purpose                                                            |
| ------ | ------------------------ | ---- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| GET    | `/api/adapt/description` | 1    | `?listing_id&archetype&locale`                                                 | Zwraca `copy_template[locale]` dla sidebar widget                  |
| POST   | `/api/adapt/description` | 2, 3 | `{listing_id, archetype, tier, locale, original_description, listing_context}` | Cache lookup; hit → `ai_cached`; miss → `original` + enqueue Modal |

#### E.7.2. Response schema

```json
{
  "description": "string | null",
  "source": "template_fallback" | "ai_cached" | "original",
  "locale": "en" | "pl" | "es",
  "generated_at": "ISO 8601 | null",
  "verified_facts_used": ["bedrooms: 3", "location: Madrid"]
}
```

- `template_fallback` — tylko Tier 1. `description = copy_template[locale]` (voice pattern
  wyświetlony as-is w sidebar widget). `generated_at = now()`. `verified_facts_used` omitted.
- `ai_cached` — Tier 2/3 cache hit. `description = <Sonnet text>`.
  `generated_at = <Redis-stored timestamp>`.
  `verified_facts_used = <parsed from Sonnet audit block>`.
- `original` — Tier 2/3 cache miss. `description = null`. `generated_at = null`. SDK NIE rusza DOM.
  `verified_facts_used` omitted.

#### E.7.3. Redis cache

- **Key:** `desc:{tenant_id}:{listing_id}:{archetype}:{locale}`
- **Value:** JSON
  `{"text": "<Sonnet output>", "generated_at": "<ISO>", "verified_facts_used": [...]}`
- **TTL:** Tier 2 = 72h (259200s), Tier 3 = 48h (172800s)
- **Invalidation:** `listing.updated` Redpanda event → SCAN+DEL `desc:{tenant_id}:{listing_id}:*`

#### E.7.4. Modal job payload (v1.7.1)

```json
{
  "tenant_id": "string",
  "listing_id": "string",
  "archetype": "string",
  "locale": "en|pl|es",
  "tier": 2,
  "cache_key": "desc:...",
  "copy_template": "string (voice pattern + hard rules, NOT marketing copy)",
  "original_description": "string (factual seed from agent — REQUIRED in v1.7+)",
  "listing_context": { "bedrooms": 3, "location": { "city": "Madrid" } },
  "ttl_seconds": 259200
}
```

Sonnet system prompt: WHITELIST RULES (patrz E.7.5). NIE zmyślaj faktów, których nie ma w
`original_description` ani `listing_context`.

#### E.7.5. Anti-hallucination guard-rails

**Cel:** AI-generated copy nigdy nie wprowadza faktów nieistniejących w whitelist. Halucynacje w
opisach nieruchomości to ryzyko reputacyjne i prawne (UK/EU misrepresentation laws).

**WHITELIST RULES (w Sonnet system prompt):**

1. Sonnet pisze TYLKO o faktach z dwóch źródeł:
   - (a) `original_description` — tekst agenta
   - (b) `listing_context` — structured property data w payloadzie
2. Sonnet NIE WOLNO wymieniać liczb, ratings, distances, percentages, prices, dates, names of
   schools/hospitals/companies, ani innych specyficznych quantitative lub named facts, chyba że są w
   (a) lub (b).
3. Generic positive descriptors BEZ liczb są dozwolone:
   - **ALLOWED:** "attractive yield", "strong rental demand", "spacious garden", "well-connected",
     "established neighbourhood"
   - **FORBIDDEN:** "yield of 6.2%", "above 95% occupancy", "300m from Tube", "Ofsted Outstanding",
     "Knight Frank managed"
4. Voice pattern może mówić "lead with cashflow" — jeśli brak yield/income w whitelist, Sonnet używa
   generic positive cashflow language ("attractive rental yield"). NIE wymyśla "6.2%".
5. Sonnet zwraca audit block `<verified_facts_used>[...]</verified_facts_used>` na końcu odpowiedzi
   — lista faktów które faktycznie użył. Block jest stripowany z description text i zapisywany
   osobno do ClickHouse.

**Template format (zmiana z v1.6):**

Templates `copy_template[locale]` w 18 archetype playbooks NIE są już marketing copy. Każdy template
to structured string z dwiema sekcjami:

```
VOICE PATTERN:
<jak archetype'owe copy ma brzmieć — tone, lead-with priority, frame,
closer, lexicon preferred / lexicon avoid; ~80-120 słów>

HARD RULES:
<czego NIGDY nie wolno pisać dla tego archetypu, w kontekście anti-hallucination;
~30-50 słów>
```

Modal job parsuje obie sekcje przed przekazaniem Sonnetowi (jako `voice_pattern` i `hard_rules`
parametry user prompta).

**CI gate:** `template-purity.test.ts` blokuje merge jeśli którykolwiek `copy_template[locale]`
zawiera placeholder z listy zakazanych (yield, occupancy*rate, adr, wault, ltv, schools_rating,
broadband_speed, distance*\*, etc. — pełna lista w teście).

**Audit trail w ClickHouse:** Tabela `description_generations` dostaje kolumnę
`verified_facts_used: Array(String)`. Każda generacja loguje listę faktów. Master Admin oraz
audytorzy mogą później sprawdzić "co Sonnet faktycznie użył dla listing X archetype Y locale Z".

#### E.7.6. Flow diagrams

**Tier 2/3 cache miss (buyer 1):**

```
SDK extracts original from DOM via tenant.data_extractors.description
  → POST /api/adapt/description { original_description: "...", listing_context, ... }
  → Endpoint: Redis GET miss
    → Enqueue Modal job (with original_description + copy_template voice pattern)
    → Return { description: null, source: "original" }
  → SDK: leaves DOM untouched (agent's original copy stays visible)
  → [async] Modal job:
      Sonnet(voice_pattern + hard_rules + original + context)
      → parse <verified_facts_used>
      → Redis SET { text, generated_at, verified_facts_used }
      → expires in 72h (Tier 2) / 48h (Tier 3)
      → ClickHouse INSERT description_generations
```

**Tier 2/3 cache hit (buyer N+1):**

```
Same POST as buyer 1
  → Endpoint: Redis GET hit
  → Return { description: "<AI>", source: "ai_cached", generated_at: "...",
            verified_facts_used: [...] }
  → SDK: replaces DOM [data-estalara-slot="description"] with AI text
```

**Different archetype (separate cache key):**

```
Cache is per-(listing, archetype, locale), not per-listing.
Buyer 1 of yield_hunter → cache miss → original
Buyer 1 of family_buyer (same listing) → separate cache miss → original
Each Modal job generates copy independently.
```

**Tier 1 — separate path (sidebar widget):**

```
SDK calls GET /api/adapt/description?listing_id=X&archetype=Y&tier=1&locale=en
  → Endpoint: lookup playbook, return copy_template.en (voice pattern as-is)
  → Return { description: "<voice pattern>", source: "template_fallback", generated_at: now() }
  → SDK: renders in sidebar widget (read-only, side-by-side with agent's
         original in main DOM — koegzystencja, nie zastępowanie)
```

#### E.7.7. Pre-warming (post-MVP, follow-up TICKET-PREWARM-001)

Aby zniwelować "buyer 1 zawsze widzi oryginał" przy listingu który jest hit dla wielu archetypów,
można na `listing.created` enqueue'ować Modal job dla TOP-5 archetypów najczęstszych dla regionu
tenanta.

- **Cost:** $0.05–$0.15 per listing (5 generations × $0.01–$0.03)
- **Decision:** out of Sprint 9 scope, ewentualnie Sprint 11+ jako tuning
- **Trigger:** gdy mamy >100 listingów per tenant per region z dystrybucją archetypów

#### E.7.8. Cost model

- Sonnet 4.6: ~$0.01–$0.03 per generation
- Modal: ~$0.001 per cold start, ~$0.0003 per warm
- Redis: marginal (set/get)
- ClickHouse: marginal (audit insert)

**Per listing × archetype × locale (unique cache key):** ~$0.02 average per first buyer trigger.
Cache hit = $0. Heavy listings (50+ archetypes hit) ≈ $1/listing maximum, w praktyce 3-5
archetypes/listing.

#### E.7.9. Cross-references

- **E.6 (Placeholder Resolution Order):** v1.7.1 nie używa E.6 dla long-form copy. Templates nie
  zawierają placeholderów. Placeholdery pozostają w użyciu dla short slotów (tagline, headline, CTA)
  per E.2.
- **B.4 (TenantConfig):** `data_extractors.description` jest źródłem CSS selector dla SDK do
  ekstrakcji `original_description` z DOM.
- **D.5 (Detection Quality):** archetype confidence > 0.6 jest warunkiem wywołania endpointu (per
  E.1 decision tree).
- **K.3 (Internal Ops):** `description_generations` tabela ClickHouse dostępna w Internal Ops dla
  auditu halucynacji per tenant.
- **V.4 (Threat Modeling):** halucynacja w copy = misrepresentation risk (V.4.3 reputational
  threats). Whitelist rules są mitigation control.
````

### D.4. Instrukcja podmiany dla agenta

Agent stosuje następujący Python script po wpisaniu treści D.2 i D.3 w odpowiednie zmienne:

```python
from pathlib import Path
import re

p = Path("docs/MASTER_DESIGN.md")
src = p.read_text()

# 1. Header — sprawdź aktualną wersję
header_match = re.search(r"\*\*Wersja:\*\* (\d+\.\d+(?:\.\d+)?)", src)
current_version = header_match.group(1) if header_match else "unknown"
print(f"Current version: {current_version}")

# Podmień całą linię nagłówka
new_header_line = "**Wersja:** 1.7.1 (Master Design Document — Description pipeline pivot: original-first + anti-hallucination guard-rails) | **Data:** 15 maja 2026"
src = re.sub(r"\*\*Wersja:\*\* \d+\.\d+(?:\.\d+)?[^\n]*", new_header_line, src, count=1)

# 2. Changelog v1.7.1 — wstaw PRZED najnowszego istniejącego changelog
# Znajdź pierwsze "**Changelog v" w pliku
changelog_pattern = re.search(r"\*\*Changelog v\d+\.\d+", src)
if not changelog_pattern:
    raise SystemExit("ERROR: żaden changelog v* nie znaleziony")
changelog_marker = changelog_pattern.group(0)

new_changelog = """<TREŚĆ Z D.2 BEZ NAGŁÓWKA "### D.2." — od "**Changelog v1.7.1" do ostatniego bulletu>

"""
src = src.replace(changelog_marker, new_changelog + changelog_marker, 1)

# 3. Sekcja E.7 — podmień od "### E.7." do następnego nagłówka tej samej/wyższej głębokości
pattern = re.compile(
    r"### E\.7\.[^\n]*\n.*?(?=\n### E\.\d|\n## [A-Z]\. )",
    re.DOTALL,
)
m = pattern.search(src)
if not m:
    raise SystemExit("ERROR: sekcja E.7 nie znaleziona do podmiany")

new_e7 = """<TREŚĆ Z D.3 BEZ NAGŁÓWKA "### D.3." — od "### E.7. Long-form Description Pipeline (v1.7.1..." do końca E.7.9>

"""
src = src[: m.start()] + new_e7 + src[m.end() :]

p.write_text(src)
print("✓ Master Design v1.7.1: header + changelog + E.7 podmienione")
```

**WAŻNE:** Treść z D.2 i D.3 powyżej to dokładne stringi do podmiany — agent kopiuje je dosłownie,
nie generuje własnej wersji. Tylko w ten sposób zapewniamy że Master Design dokładnie odzwierciedla
decyzje Piotra (locked 2026-05-15).

---

## Następne kroki

1. **Wklej ten plik do Claude Code** jako spec.
2. Delegacja do **sdk-engineer + ml-engineer** (model: **Opus 4.7 xhigh**), zadanie: "Wygeneruj
   pełne 54 voice patterns (EN/PL/ES × 18 archetypes) na bazie wytycznych z Appendix A. Każdy ~140
   słów. Wpisz do plików archetypes/\*.ts jako string z dwiema sekcjami `VOICE PATTERN:` i
   `HARD RULES:`. Zaimplementuj guard-rails w Modal job per Appendix B. Dodaj testy per Appendix C.
   Zaktualizuj docs/MASTER_DESIGN.md per Appendix D (header + changelog + E.7) — kopiuj treść
   dosłownie, nie generuj własnej wersji. Migracja ClickHouse dla `verified_facts_used`. Wszystko na
   branch claude/adaptive-listings-docs-J4W9H. Nie merge'uj, tylko push."

**Estimated effort:** 6-8h (Opus 4.7 xhigh, kreatywna praca + testy + migration + Master Design
update).

**Branch:** `claude/adaptive-listings-docs-J4W9H` (kontynuacja, working tree clean po pull z
origin).
