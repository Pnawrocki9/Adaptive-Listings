# HANDOFF — Estalara Adaptive Listings

**Data:** 2026-05-12 | **Projekt:** Adaptive-Listings | **Repo:**
`github.com/Pnawrocki9/Adaptive-Listings`

---

## 1. Project Overview

**Czego dotyczy projekt:** Estalara Adaptive Listings to embeddable AI SDK dla agencji
nieruchomości, który w czasie rzeczywistym personalizuje listingi pod konkretnego anonimowego
kupującego — na podstawie sygnałów behawioralnych (scrollowanie, kliknięcia, czas na zdjęciach). B2B
SaaS w 3 tierach (Observer $499/mo, Augment $1999/mo, Native $7500+/mo). Produkt Time2Show Inc.
(Delaware).

**Dwa konteksty deploymentu:**

- **Standalone** — zewnętrzna agencja wgrywa `<script>` tag (WordPress, custom, cokolwiek)
- **Embedded** — `app.estalara.com` (SvelteKit, live streaming platform) — Tier 3 Native

**Stack technologiczny:**

- **Monorepo:** Turborepo + pnpm, TypeScript strict
- **SDK:** Preact 10 + Shadow DOM (`packages/sdk/`)
- **Edge Ingest:** Cloudflare Workers + Hono
- **Event Bus:** Redpanda Cloud (Kafka-compatible, eu-central-1)
- **Event Store:** ClickHouse Cloud
- **DB:** Supabase Postgres 16 + RLS, Drizzle ORM (`packages/db/`)
- **Stream Consumer:** Python/Modal
- **Control Plane:** Next.js 15 App Router na Vercel (`apps/control-plane/`)
- **ML:** Claude Haiku 4.5 (intent), Claude Sonnet 4.6 (adaptation), LiteLLM gateway
- **Observability:** Sentry + OpenTelemetry + Pino

**Zespół:**

- **Piotr Nawrocki** — CEO (prowadzi rozmowy z Claude, decyzje produktowe)
- **Rafał Palak PhD** — CTO (implementuje, deploye, Cursor)
- **Krystian Wojtkiewicz PhD** — CPO (product, real-estate domain)
- **Claude** — PM orchestrator + subagenty przez Claude Code

---

## 2. Stan sprintów (2026-05-12)

| Sprint               | Status          | PR                                         |
| -------------------- | --------------- | ------------------------------------------ |
| Sprint 0             | ✅ DONE         | #1–9                                       |
| Sprint 1             | ✅ DONE         | #10–25                                     |
| Sprint 1.5 hardening | ✅ DONE         | FIX-001..005                               |
| Sprint 2             | ✅ DONE         | #36–55                                     |
| Sprint 3             | ✅ DONE         | #56–58                                     |
| Sprint 4             | ✅ DONE         | #59–62                                     |
| Sprint 5             | ✅ DONE         | #63–66                                     |
| Sprint 6             | ✅ DONE         | #67+                                       |
| Sprint 7 Phase 1     | ✅ DONE         | PR #67 (ADP-001), PR #68 (ADP-003)         |
| **Sprint 7 Phase 2** | 🟡 IN PROGRESS  | ADP-002, ADP-004, DQS-001 — agenci pracują |
| Sprint 7.5           | 📋 SPEC READY   | Czeka na Phase 2 DONE                      |
| Sprint 8             | 📋 SCOPE LOCKED | Czeka na Sprint 7.5 DONE                   |

---

## 3. Cel obecnej fazy — Sprint 7 Phase 2

**Trzy tickety w toku:**

**ADP-002 — LiteLLM gateway** (backend-engineer)

- `POST /api/llm` endpoint w control-plane
- Routing: Haiku 4.5 (intent) / Sonnet 4.6 (adaptation)
- Circuit breaker: $100/day limit
- DONE gdy: endpoint zwraca adaptowane copy dla fixture listing + circuit breaker test

**ADP-004 — DOM mutations** (sdk-engineer)

- SDK `applyDirectives()` aplikuje TextDirective, ClassDirective, AttributeDirective
- Pierwsze 3 typy dyrektyw — ReorderDirective jest stub (Sprint 8)
- DONE gdy: visual smoke test — headline zmienia się per archetype na mockup page

**DQS-001 — convergence metrics** (data-engineer)

- ClickHouse `session_quality` tabela
- Metryki: sessions_to_convergence, archetype_stability, quiz_lift
- DONE gdy: DQS score pojawia się w ClickHouse dla test session

**Po Phase 2:** pm-orchestrator uruchamia Sprint 7.5. Spec w `docs/specs/SPRINT_7_5_SPEC.md`.

---

## 4. Kluczowe decyzje architektoniczne (locked)

### Placeholder resolution order

```
1. data-estalara-* atrybuty (manual) → confidence 1.0
2. Agency-provided answers per listing → 0.95
3. Auto-extracted z DOM via data_extractors → 0.85
4. Computed metrics (price/area → price_per_sqm) → 0.80
5. Cached enrichments z external APIs → 0.75
6. LLM generation (Haiku 4.5 / Sonnet 4.6) → 0.60
7. Skip directive (usuń placeholder z tekstu)
```

### Re-ranking (Sprint 8)

- Nowy typ dyrektywy `ReorderDirective` — per-archetype reorder listing cards na index page
- Pierwszy A/B experiment w Sprint 8
- Sprint 7.5 zostawia hooks: `data_extractors_per_card`, `container_selector`, `ReorderDirective`
  stub

### Detection priority order (Auto-Detection Engine, Sprint 7.5)

```
data-estalara-* → JSON-LD RealEstateListing → data-testid/data-cy →
MUI → article tag → CSS Modules → CSS-in-JS [partial] → WordPress → Drupal → AI Vision
```

### app.estalara.com (Sprint 8 NATIVE-001)

- Framework: SvelteKit (nie Next.js)
- H1 = cena (nie tytuł) — dodaj `[data-estalara-slot='tagline']` nad H1
- AI Topics tags = reorder target per archetype
- Live Session CTA = archetype-aware copy

### Agency registration

- Wymaga Master Admin approval (nie self-serve)
- Billing: Stripe + manual invoice

### Admin panel

- `/admin/*` w ramach `adaptive.estalara.com` (nie osobna subdomena — YAGNI)

---

## 5. Reference Corpus (Auto-Detection)

**24 platformy z pełnymi ground-truths**, fixtures w `packages/sdk/src/auto-detect/__fixtures__/`.

**CI gate:** precision ≥95%, recall ≥80%. app.estalara.com: 100%.

**Kluczowe lekcje:**

- CSS-in-JS klasy ZMIENIAJĄ SIĘ przy deploy → zawsze `[class*='keyword']`, nigdy pełny hash
- JSON-LD RealEstateListing → bypass DOM (Kyero, Zillow, RE/MAX, Realtor.com)
- "Price on request" → wartość `'POA'`, nie `null` (Engelvoelkers luxury)
- H1 = cena na app.estalara.com → potrzebny dodatkowy `tagline` slot

---

## 6. Artefakty i lokalizacje

| Artefakt           | Lokalizacja                                                             |
| ------------------ | ----------------------------------------------------------------------- |
| Repo               | `~/Projects/Adaptive-Listings` (WSL Ubuntu, user: asipi)                |
| GitHub             | `github.com/Pnawrocki9/Adaptive-Listings`                               |
| Master Design      | `docs/MASTER_DESIGN.md` (v1.4 → v1.5 patch gotowy)                      |
| Sprint 7.5 spec    | `docs/specs/SPRINT_7_5_SPEC.md` (do dodania)                            |
| Corpus fixtures    | `packages/sdk/src/auto-detect/__fixtures__/` (do dodania)               |
| Corpus raw files   | `/home/claude/corpus/fixtures/` (lokalne, sesja Claude)                 |
| Doppler            | project=`estalara-adaptive-listings`, config=`dev`                      |
| Redpanda broker    | `d7nmcdra47k55204bajg.any.eu-central-1.mpx.prd.cloud.redpanda.com:9092` |
| Supabase org       | `mxypmgkdqeerkcskyswc`                                                  |
| Cloudflare account | `fb2e567808fb5f3b911347c407cee65f`                                      |

---

## 7. Backlog management

```
backlog/QUEUE.md     — source of truth ticket status (pm-orchestrator pisze)
backlog/STATUS.md    — auto-overwrite przez pm-orchestrator
backlog/ESCALATIONS.md — otwarte escalacje
backlog/HANDOFFS.md  — agent-to-agent handoffs
docs/MASTER_DESIGN.md — architektura (agenci czytają na początku każdego sprintu)
docs/specs/          — per-sprint specs (SPRINT_7_5_SPEC.md)
```

**pm-orchestrator workflow:**

1. Czyta QUEUE.md + MASTER_DESIGN.md
2. Przydziela tickety agentom
3. Po merge: `pnpm --filter @estalara/sdk build` → weryfikuje dist/
4. Aktualizuje STATUS.md i HANDOFFS.md

---

## 8. CI/CD stan

| Co                   | Status                                    |
| -------------------- | ----------------------------------------- |
| `ci.yml`             | ✅ Zielone (30+ jobów)                    |
| `deploy-staging.yml` | ✅ Wyłączony (workflow_dispatch) — celowo |
| `e2e-smoke.yml`      | ✅ Nightly 03:00 UTC                      |
| Corpus CI gate       | 📋 Do dodania w Sprint 7.5 AUTO-001       |

**Kluczowe reguły CI (nie powtarzać błędów):**

- `if: ${{ secrets.X != '' }}` NIE działa w step-level — używaj w `env:` lub `with:`
- `@estalara/shared` MUSI być zbudowany przed lint i testami
- Gitleaks wymaga `permissions: { pull-requests: read }`
- Pytest bez testów zwraca exit code 5 → zawsze dodaj `test_smoke.py`

---

## 9. Pierwszy task w nowej sesji

**Sprawdź:** Czy Sprint 7 Phase 2 (ADP-002, ADP-004, DQS-001) jest DONE?

```bash
# Sprawdź status na GitHub
gh pr list --state merged --limit 10
gh run list --limit 5
```

- **Jeśli Phase 2 DONE → CI zielone:** Zacznij Sprint 7.5. Daj pm-orchestratorowi:
  `docs/specs/SPRINT_7_5_SPEC.md` + ten HANDOFF. Pierwsze zadanie: AUTO-001 (corpus setup).

- **Jeśli Phase 2 w toku:** Poczekaj. Opcjonalnie: wykonaj visual smoke test po merge Phase 2
  (headline zmienia się per archetype na mockup page?).

- **Jeśli Phase 2 ma problem:** Czytaj ESCALATIONS.md i rozwiąż przed Sprint 7.5.

---

## 10. Czego unikać

### Git

- NIE: `git rebase` gdy PR ma konflikty → pętla nieskończona
- TAK: `git reset --soft origin/main && git add . && git commit && git push --force-with-lease`

### Detection Engine (Sprint 7.5)

- NIE: pełny CSS-in-JS hash jako selector (`article.SearchResultCard-sc-a303eae3-14`)
- TAK: partial match (`article[class*='SearchResultCard']`)
- NIE: `null` dla "Price on request"
- TAK: wartość `'POA'` w data_extractors

### Agent workflow

- NIE: dwa agenty na tym samym pliku jednocześnie
- TAK: `git status` przed każdym commitem agenta
- NIE: merge Sprint 7.5 bez zielonego corpus CI gate (precision ≥95%)
- TAK: po merge PR z nowym SDK subpath → `pnpm --filter @estalara/sdk build` + verify dist/

### Komunikacja z Piotrem

- Po polsku w konwersacji, po angielsku w kodzie i PR tytułach
- Jedno pytanie naraz
- Konkretne komendy do wklejenia, nie abstrakcyjne opisy

---

_Dokument wygenerowany: 2026-05-12 | Wersja: 2.0_ _Poprzedni HANDOFF: `/mnt/project/HANDOFF.md`
(v1.0, przestarzały — Sprint 2)_ _Transkrypt sesji:
`/mnt/transcripts/2026-05-12-15-49-14-estalara-sprint7-corpus.txt`_
