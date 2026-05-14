# HANDOFF — Estalara Adaptive Listings

**Data:** 2026-05-14 | **Projekt:** Adaptive-Listings | **Repo:**
`github.com/Pnawrocki9/Adaptive-Listings` | **Wersja:** 4.0

---

## 1. Project Overview

**Czego dotyczy projekt:** Estalara Adaptive Listings to embeddable AI SDK dla agencji
nieruchomości, który w czasie rzeczywistym personalizuje listingi pod konkretnego anonimowego
kupującego — na podstawie sygnałów behawioralnych (scrollowanie, kliknięcia, czas na zdjęciach). B2B
SaaS w 3 tierach (Observer $499/mo, Augment $1999/mo, Native $7500+/mo). Produkt Time2Show Inc.
(Delaware).

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

## 2. Stan sprintów (2026-05-14 koniec dnia)

| Sprint               | Status         | PR / commit                                           |
| -------------------- | -------------- | ----------------------------------------------------- |
| Sprint 0             | ✅ DONE        | #1–9                                                  |
| Sprint 1             | ✅ DONE        | #10–25                                                |
| Sprint 1.5 hardening | ✅ DONE        | FIX-001..005                                          |
| Sprint 2             | ✅ DONE        | #36–55                                                |
| Sprint 2.5           | 🟡 BLOCKED     | TICKET-030 READY; 032–034, 036 BLOCKED; 035 CANCELLED |
| Sprint 3             | 🟡 IN PROGRESS | TICKET-037 DONE (PR #98); TICKET-038 READY            |
| Sprint 6             | ✅ DONE        | commits f0aca06, be4e366, c69ee9c                     |
| Sprint 7             | ✅ DONE        | PR #67–71                                             |
| Sprint 7.5           | ✅ DONE        | PR #72–79; corpus 100%/100% on 24 platforms           |
| **Sprint 8**         | ✅ **DONE**    | PR #80, #91–92, #95, #97–99 — 6 tickets DONE          |
| Sprint 9             | 📋 BACKLOG     | 6 tickets spec'ed, nie zaczęte                        |
| Sprint 10            | 📋 TBD         |                                                       |
| Sprint 11            | 📋 TBD         |                                                       |

---

## 3. Sprint 8 — DONE (2026-05-14)

Wszystkie 6 zaplanowanych ticketów zmergowane. FAIR-001 CANCELLED (archetype = behavioral, nie
demographic — decyzja Piotra 2026-05-13). NATIVE-001 DEFERRED do launch (wymaga CTO/CPO scheduling
SvelteKit). CAUSAL-001 P2 BACKLOG (wymaga 2+ tygodni realnych danych holdout).

| Ticket             | PR  | Co zrobiło                                                    |
| ------------------ | --- | ------------------------------------------------------------- |
| TICKET-AB-001      | #80 | Thompson bandit + A/B holdout framework (10% holdout)         |
| TICKET-REORDER-001 | #91 | ReorderDirective — DOM photo reorder per archetype            |
| TICKET-046         | #92 | 3 copy variants + copy_template dla 18 archetypów             |
| TICKET-ARCH-003    | #95 | Per-ticket retrospective learning loop + /retro slash command |
| TICKET-AGENCY-001  | #97 | Agency answers CRUD + RAG pipeline → Haiku 4.5 context        |
| TICKET-AB-004      | #99 | Analytics dashboard — 5 paneli (traffic, archetypes, lift)    |

**Dodatkowe PRy tej sesji (meta):**

| PR   | Co                                                                    |
| ---- | --------------------------------------------------------------------- |
| #100 | QUEUE.md sync — TICKET-AB-004 DONE                                    |
| #101 | RETRO-002 dla TICKET-AB-001 — FOLLOW-006..014, Rule H promoted        |
| #102 | RETRO-003 dla TICKET-REORDER-001 — FOLLOW-015..024                    |
| #103 | RETRO-004 dla TICKET-046 — FOLLOW-025..034, fair-housing escalation   |
| #104 | Rule H hard CI gate (scripts/check-rule-h.sh) + fair-housing RESOLVED |

---

## 4. Learning Loop — AKTYWNY

Retrospective loop wprowadzony w TICKET-ARCH-003 (PR #95). PM-orchestrator automatycznie spawnuje
`retrospective-analyst` (Opus 4.7) po każdym merged PR. Trzy retroaktywne retro wykonane tej sesji:

| Retro     | Ticket                   | Gaps | Follow-ups      |
| --------- | ------------------------ | ---- | --------------- |
| RETRO-001 | TICKET-046               | 8    | FOLLOW-001..005 |
| RETRO-002 | TICKET-AB-001            | 12   | FOLLOW-006..014 |
| RETRO-003 | TICKET-REORDER-001       | 14   | FOLLOW-015..024 |
| RETRO-004 | TICKET-046 (re-analysis) | 18   | FOLLOW-025..034 |

**Łącznie:** 34 follow-ups, 4 retros, 1 permanent rule promoted (Rule H).

**Rule H** — "Schema scaffold MUST ship with at least one runtime-wired consumer" — recurred across
4 retros, ≥12 distinct instances. **Hard CI gate active** (`scripts/check-rule-h.sh` + job `rule-h`
w CI + `pre-push` lefthook).

---

## 5. Krytyczne P0 Follow-ups (nieimplementowane, wymagają Sprint 8/9)

Te follow-upy blokują correctness AB testów i dashboardu. Muszą wylądować zanim jakikolwiek tenant
pilotowy zobaczy dashboard.

| Follow-up  | Co                                                                                                    | Kto              | Sprint |
| ---------- | ----------------------------------------------------------------------------------------------------- | ---------------- | ------ |
| FOLLOW-006 | Emit `ab.assignment` event z decision-api (obecnie: nigdy nie emitowany)                              | backend-engineer | 8 imm. |
| FOLLOW-007 | Wire Thompson sampling w adapt hot path — `variant_index` w response                                  | backend + sdk    | 9      |
| FOLLOW-008 | Seed `ab_bandit_weights` — 18 archetype rows per tenant (pusty dla wszystkich)                        | data-engineer    | 8 imm. |
| FOLLOW-010 | Wire `holdout_group` do ClickHouse inserts (kolumna zawsze `false`)                                   | data-engineer    | 8 imm. |
| FOLLOW-014 | Zastąp `/api/ab/weights` mock realnym Drizzle — AB-004 dashboard pokazuje fake dane                   | backend          | 8 imm. |
| FOLLOW-015 | Wire `ReorderDirective` do decision-api Worker route (listing_ids są, ale nigdy nie buduje dyrektywy) | backend          | 8 imm. |
| FOLLOW-017 | Dodaj holdout gating do `POST /api/adapt` control-plane                                               | backend-engineer | 8 imm. |
| FOLLOW-018 | Zastąp `getTenantSchema()` hardcoded `est_demo_tenant` realnym DB lookup                              | backend          | 8 imm. |

Pełna lista: `backlog/FOLLOW_UPS.md` (FOLLOW-001 do FOLLOW-034).

---

## 6. Następne tickety — co odpalić w nowej sesji

### Priorytet 1 — P0 follow-ups (Sprint 8 immediate)

Sześć z ośmiu P0 follow-ups (FOLLOW-006, 008, 010, 014, 015, 018) to backend-engineer +
data-engineer, niezależne od siebie. Można zrównoleglić:

```
PM → backend-engineer: FOLLOW-014 (replace /api/ab/weights mock) — 3h
PM → backend-engineer: FOLLOW-015 (wire ReorderDirective in decision-api) — 4h [parallel]
PM → backend-engineer: FOLLOW-017 (holdout gating in POST /api/adapt) — 3h [parallel]
PM → backend-engineer: FOLLOW-018 (real getTenantSchema DB lookup) — 3h [parallel]
PM → data-engineer: FOLLOW-006 (emit ab.assignment events) — 3h [parallel]
PM → data-engineer: FOLLOW-008 (seed ab_bandit_weights) — 2h [parallel]
PM → data-engineer: FOLLOW-010 (wire holdout_group into ClickHouse) — 3h [parallel]
```

FOLLOW-007 (variant_index end-to-end) jest złożony — musi poczekać aż FOLLOW-025 (TextDirective
pole) wyląduje najpierw. Sprint 9.

### Priorytet 2 — Sprint 3 unblocking

TICKET-038 (tsup bundle gate) jest READY i niezależny od P0 follow-ups. sdk-engineer może zacząć:

```
TICKET-038 (tsup gate, <40KB) → unblocks TICKET-039 (Playwright) + TICKET-041 (consent) + TICKET-042 (Decision API) + TICKET-043 (npm publish)
```

### Priorytet 3 — Sprint 9 start

TICKET-GDPR-001 (DPIA + ROPA, compliance-engineer, 8h) nie ma zależności — może zacząć równolegle.

### QUEUE.md do aktualizacji

QUEUE.md (stan z 16:40 tej sesji) **nie jest w pełni aktualny** — brakuje:

- TICKET-ARCH-003 → DONE (PR #95 zmergowany 2026-05-14, commit `3e574b9`)
- Sprint 8 header → COMPLETE (6/6 DONE)
- Sprint 8 progress table: 5 DONE → 6 DONE
- "Currently in flight" i "Awaiting human review" → wyczyścić
- "Recent merges" → dodać PR #95–104

---

## 7. Kluczowe decyzje z tej sesji (2026-05-14)

1. **Fair-housing copy layer** — RESOLVED. Wszyscy kupujący otrzymują ten sam zestaw listingów;
   `copy_template` i variants zmieniają tylko framing prezentacji, nie dostęp. To nie jest FHA
   steering. Decyzja Piotra. Binding constraint: copy strings nie mogą referencjonować protected
   characteristics explicite (race, religion, gender, disability, national origin, family status).
   Behavioral framing only. FOLLOW-034 CANCELLED.

2. **Rule H hard gate** — IMPLEMENTED. `scripts/check-rule-h.sh` + CI job `rule-h` + `pre-push`
   lefthook. Pattern recurred w 4 retros, ≥12 instances. Pre-push hook działa (fired na PR #104
   push, passed).

3. **TICKET-035 CANCELLED** — duplikat z TICKET-VAL-001 (Sprint 9). Canonical implementation w
   VAL-001. Decyzja Piotra 2026-05-14.

---

## 8. Architektura — kluczowe decyzje (locked)

### Placeholder resolution order (E.6)

```
1. data-estalara-* atrybuty → confidence 1.0
2. Agency-provided answers per listing (TICKET-AGENCY-001, DONE) → 0.95
3. Auto-extracted z DOM via data_extractors → 0.85
4. Computed metrics (price/area → price_per_sqm) → 0.80
5. Cached enrichments z external APIs → 0.75
6. LLM generation (Haiku 4.5 / Sonnet 4.6) → 0.60
7. Skip directive (usuń placeholder z tekstu)
```

### Archetype space (18 archetypów)

18 behawioralnych archetypów (yield_hunter, family_buyer, first_time_buyer, commercial_investor,
golden_visa_buyer, luxury_buyer, remote_worker, lifestyle_expat, flip_investor, portfolio_builder,
vacation_rental_investor, upsizer, downsizer, diaspora_buyer, retiree_relocator, second_home_buyer,
student_parent + neutral). Każdy ma 3 copy variants + copy_template (~150 słów EN). Polish/Spanish —
do Sprint 11+.

**Archetype = behavioral cluster ONLY.** Żadne protected-class signals nie wchodzą do archetype
space (binding constraint z 2026-05-13 escalation resolution). Jeśli ktokolwiek zaproponuje
demographic/proxy-demographic signal — re-litigate przez nową escalation zanim cokolwiek wejdzie do
modelu.

### A/B holdout (E.3)

- 10% holdout (session-level, consent-aware, random keyed na session_id hash)
- Thompson sampling bandit — SCHEMA gotowy, **wiring wciąż niegotowy** (FOLLOW-007)
- `ab_bandit_weights` tabela istnieje, **pusta dla wszystkich tenantów** (FOLLOW-008)
- Analytics dashboard (PR #99) działa ale `ab/weights` route zwraca **mock data** (FOLLOW-014)

### Auto-Detection Engine (Sprint 7.5, DONE)

Detection priority:

```
data-estalara-* → JSON-LD RealEstateListing → data-testid/data-cy →
MUI → article tag → CSS Modules → CSS-in-JS [partial] → WordPress → Drupal → AI Vision
```

24 platformy, CI gate precision 100% / recall 100%.

**CSS-in-JS lekcja:** klasy ZMIENIAJĄ SIĘ przy deploy → zawsze `[class*='keyword']`, nigdy pełny
hash.

### Master Design

Wersja: v1.6 (docs/MASTER_DESIGN.md). Kluczowe sekcje: E.2 (warianty), E.6 (placeholder resolution),
E.7 (description pipeline — do implementacji w DESC-001), Q.3 (analytics dashboard).

---

## 9. CI/CD stan

| Co                   | Status                                                    |
| -------------------- | --------------------------------------------------------- |
| `ci.yml`             | ✅ Zielone + nowy job `rule-h` (hard gate, blocking)      |
| `rule-h` CI job      | ✅ Aktywny — scripts/check-rule-h.sh, exit 1 na violation |
| `pre-push` lefthook  | ✅ Aktywny — rule-h sprawdzany lokalnie przed każdym push |
| `deploy-staging.yml` | ✅ Wyłączony (workflow_dispatch) — celowo                 |
| `e2e-smoke.yml`      | ✅ Nightly 03:00 UTC                                      |
| Corpus CI gate       | ✅ precision/recall 100%/100% (24 platformy)              |
| SDK bundle size gate | 📋 Do implementacji — TICKET-038                          |

**Kluczowe reguły CI:**

- `if: ${{ secrets.X != '' }}` NIE działa w step-level — używaj w `env:` lub `with:`
- `@estalara/shared` MUSI być zbudowany przed lint i testami
- Gitleaks wymaga `permissions: { pull-requests: read }`
- Pytest bez testów zwraca exit code 5 → zawsze dodaj `test_smoke.py`
- **NOWE:** `scripts/check-rule-h.sh` — mock route bez FOLLOW-NNN lub nowy lib/ export bez consumer
  → CI fail

---

## 10. Backlog management

```
backlog/QUEUE.md        — source of truth ticket status (pm-orchestrator pisze JEDYNY)
backlog/RETROSPECTIVES.md — per-ticket retro log (RETRO-001..004 + kolejne po każdym merge)
backlog/FOLLOW_UPS.md   — stubs ticketów z retro (FOLLOW-001..034; PM promuje do QUEUE przy planowaniu)
CONVENTIONS_PATCH.md    — permanent rules (Rule A–H); bierze precedencję nad CLAUDE.md
backlog/ESCALATIONS.md  — otwarte i zamknięte escalacje
backlog/HANDOFFS.md     — agent-to-agent handoffs
docs/MASTER_DESIGN.md   — architektura v1.6
```

**pm-orchestrator loop:**

1. Czyta QUEUE.md + MASTER_DESIGN.md + CONVENTIONS_PATCH.md
2. Przydziela tickety agentom z pełnym kontekstem (rules + retro findings)
3. Po merge: spawnuje retrospective-analyst (Opus 4.7) — ASYNC, nie blokuje pipeline
4. Promuje FOLLOW-UPS do QUEUE przy planowaniu następnego sprintu
5. Aktualizuje QUEUE.md (jedyny agent który to robi)

**Branch protection:** main jest protected — bezpośrednie pushe odrzucone 403. Każda zmiana wymaga
PR → squash merge.

---

## 11. Artefakty i lokalizacje

| Artefakt           | Lokalizacja                                                             |
| ------------------ | ----------------------------------------------------------------------- |
| Repo               | `~/Projects/Adaptive-Listings`                                          |
| GitHub             | `github.com/Pnawrocki9/Adaptive-Listings`                               |
| Master Design      | `docs/MASTER_DESIGN.md` (v1.6)                                          |
| Sprint 7.5 spec    | `docs/specs/SPRINT_7_5_SPEC.md` (applied, DONE)                         |
| Corpus fixtures    | `packages/sdk/src/auto-detect/__fixtures__/` (24 platformy)             |
| Retro log          | `backlog/RETROSPECTIVES.md` (RETRO-001..004)                            |
| Follow-ups queue   | `backlog/FOLLOW_UPS.md` (FOLLOW-001..034)                               |
| Conventions        | `CONVENTIONS_PATCH.md` (Rule A–H)                                       |
| Rule H gate script | `scripts/check-rule-h.sh`                                               |
| Doppler            | project=`estalara-adaptive-listings`, config=`dev`                      |
| Redpanda broker    | `d7nmcdra47k55204bajg.any.eu-central-1.mpx.prd.cloud.redpanda.com:9092` |
| Supabase org       | `mxypmgkdqeerkcskyswc`                                                  |
| Cloudflare account | `fb2e567808fb5f3b911347c407cee65f`                                      |

---

## 12. Pierwszy task w nowej sesji

```bash
# Sprawdź stan
git log --oneline -10
cat backlog/QUEUE.md | head -30
```

**Jeśli Sprint 8 P0 follow-ups nierozpoczęte (priorytet 1):**

```
PM spawns backend-engineer × 4 równolegle (FOLLOW-014, 015, 017, 018)
PM spawns data-engineer × 3 równolegle (FOLLOW-006, 008, 010)
```

Potem:

- sdk-engineer → TICKET-038 (tsup bundle gate, unblocks Sprint 3 łańcuch)
- compliance-engineer → TICKET-GDPR-001 (DPIA + ROPA, żadnych zależności, może zacząć równolegle)

**PM musi też zaktualizować QUEUE.md** (te zmiany nie wylądowały tej sesji — branch protection
uniemożliwił commit na main; każda zmiana wymagała oddzielnego PR):

- TICKET-ARCH-003 → DONE (PR #95, commit `3e574b9`)
- Sprint 8 header → COMPLETE (6/6 DONE)
- "Currently in flight" → (none)
- "Awaiting human review" → (none)
- "Recent merges" → dodać PR #95–104

---

## 13. Czego unikać

### Git + CI

- **NIE** pushuj bezpośrednio na main — branch protection, HTTP 403. Zawsze PR → squash merge.
- **NIE** pomijaj `--no-verify` / `--no-gpg-sign` bez explicite prośby użytkownika.
- **TAK**: `scripts/check-rule-h.sh origin/main` przed otwarciem każdego PR.
- **TAK**: pnpm exec prettier --write na każdym pliku który edytujesz — CI format jest strict.
- **TAK**: `@estalara/shared` build przed lint i testami.

### Rule H (schema scaffolds)

- **NIE** merguj nowego `lib/*.ts` exportu bez non-test importera LUB explicit FOLLOW-NNN stub.
- **NIE** merguj mock route (`MVP stub` comment) bez FOLLOW-NNN reference w tym samym pliku.
- **TAK**: `bash scripts/check-rule-h.sh origin/main` lokalnie przed push — CI to złapie ale lepiej
  wcześniej.

### Archetype space

- **NIE** dodawaj demographic/proxy-demographic signals do archetype (zip-code priors, name
  analysis, photo analysis). Jeśli ktoś proponuje → new escalation ZANIM wejdzie do modelu.
- **TAK**: behavioral signals only (scroll depth, dwell time, chat intent, click patterns).

### Learning loop

- **NIE** spawnuj duplikata `retrospective-analyst` jeśli już jeden działa (sprawdź
  system-reminder).
- **TAK**: retro zawsze po każdym merge — PM Step 7.
- **TAK**: retros run sequentially (każdy czyta poprzednie N entries dla cross-pattern detection).
- **NIE** promuj Follow-up do Rule jeśli pattern wystąpił < 2 retros (RULE_PROMOTION_THRESHOLD=2).

### Agent workflow

- **NIE** dwa agenty na tym samym pliku jednocześnie.
- **TAK**: `git status` + `git log --oneline -3` przed każdą delegacją.
- **NIE** QUEUE.md pisze ktokolwiek oprócz pm-orchestrator.
- **TAK**: Po polsku w konwersacji z Piotrem, po angielsku w kodzie i PR tytułach.

---

_Wersja: 4.0 | Data: 2026-05-14 | Poprzednie wersje: v1.0 (Sprint 2), v2.0 (2026-05-12), v3.0
(Sprint 8 start)_
