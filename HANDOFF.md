# HANDOFF — Estalara Adaptive Listings

**Data:** 2026-05-19 | **Wersja:** 4.1 | **Repo:** `github.com/Pnawrocki9/Adaptive-Listings`

---

## 1. Project Overview

**Produkt:** Estalara Adaptive Listings — embeddable AI SDK dla agencji nieruchomości. Personalizuje
listingi w czasie rzeczywistym na podstawie anonimowych sygnałów behawioralnych kupującego. B2B
SaaS, 3 tiery: Observer $499/mo, Augment $1999/mo, Native $7500+/mo.

**Firma:** Time2Show Inc. (Delaware)

- **Piotr Nawrocki** — CEO (non-technical, prowadzi rozmowy z Claude)
- **Rafał Palak PhD** — CTO (implementuje, Cursor, deploye)
- **Krystian Wojtkiewicz PhD** — CPO (product, real-estate domain)
- **Claude** — PM orchestrator + 9 subagentów przez Claude Code

**Rynki docelowe:** USA, UK, Hiszpania, Polska, Cypr

---

## 2. Stack technologiczny

```
Monorepo:        Turborepo + pnpm, TypeScript strict
SDK:             Preact 10 + Shadow DOM (packages/sdk/)
Edge Ingest:     Cloudflare Workers + Hono (apps/ingest/)
Event Bus:       Redpanda Cloud (Kafka, eu-central-1) — ZDEFERRED do Phase 2
Event Store:     ClickHouse Cloud — ZDEFERRED do Phase 2
DB:              Supabase Postgres 16 + RLS, Drizzle ORM (packages/db/)
Stream Consumer: Python/Modal — ZDEFERRED do Phase 2
Control Plane:   Next.js 15 App Router na Vercel (apps/control-plane/)
Decision API:    Cloudflare Worker (apps/decision-api/)
LLM:             Claude Haiku 4.5 + Sonnet 4.6 via LiteLLM gateway
CI/CD:           GitHub Actions — ZIELONE
Secrets:         Doppler (project: estalara-adaptive-listings, config: prd)
```

**Kluczowe lokalizacje:**

- Repo lokalne: `~/Projects/Adaptive-Listings` (WSL Ubuntu, user: asipi)
- GitHub: `github.com/Pnawrocki9/Adaptive-Listings`
- Supabase project: `yhmivuqeqkmzpxpyrsvc` (West EU Paris, Free tier)
- Cloudflare account: `fb2e567808fb5f3b911347c407cee65f`
- Redpanda broker: `d7nmcdra47k55204bajg.any.eu-central-1.mpx.prd.cloud.redpanda.com:9092`

---

## 3. AI Council — Procedura

**Lokalizacja:** `~/ai-council/` (osobne repo, Python, `.venv`)

**Architektura:**

- 3 krytycy działają równolegle:
  - `critic_architecture.md` → Claude (architektura, bezpieczeństwo)
  - `critic_innovation.md` → ChatGPT (innowacyjność, rynek)
  - `critic_repo.md` → Kimi (code review, repo quality)
- 1 orchestrator: ChatGPT → tworzy `decision_memo.md`
- 1 writer: Claude → tworzy `writer_output.md` (implementacja lub pytania blokujące)

**Uruchomienie:**

```bash
cd ~/ai-council
source .venv/bin/activate
python council.py --task "OPIS ZADANIA" --context-file /ścieżka/do/kontekstu.md
```

**Wyświetlenie ostatniej sesji:**

```bash
cd ~/ai-council && bash council-latest.sh
```

**Sesje zapisywane w:** `~/ai-council/sessions/YYYYMMDD_HHMMSS/`

- `debate_log.md` — outputs wszystkich 3 krytyków
- `decision_memo.md` — decyzja orchestratora
- `writer_output.md` — output Claude Writer

**Kiedy uruchamiać:**

- **Council Checkpoint** — przed każdą fazą (Phase 1, 2, 3...)
- **Strategiczne decyzje** — nowe funkcje, zmiany architektury, pivoty
- **Code review milestone** — po ukończeniu dużego sprintu
- **Przed demo** — walidacja gotowości

**Checkpointy dotychczasowe:**

- Council Checkpoint 2.5 (2026-05-18) — strategic re-frame, D1-D8 locked, Phase 1 vendor activation
  plan
- Council Checkpoint 3 — PENDING (po Phase 1 complete)

**WAŻNE:** Writer Agent NIE implementuje kodu jeśli `APPROVED_TO_IMPLEMENT=true` nie jest w Decision
Memo. Jeśli nie approved — zadaje tylko pytania blokujące.

---

## 4. LIVE URLs (Phase 1 — aktywne)

| Serwis                 | URL                                                              | Status            |
| ---------------------- | ---------------------------------------------------------------- | ----------------- |
| Ingest Worker          | `https://estalara-ingest-production.piotr-fb2.workers.dev`       | ✅ LIVE           |
| Decision API Worker    | `https://estalara-decision-api-production.piotr-fb2.workers.dev` | ✅ LIVE           |
| Control Plane          | `https://adaptive-listings-control-plane-4baem4dci.vercel.app`   | ✅ LIVE           |
| Ingest (custom domain) | `https://ingest.estalara.com`                                    | ⏳ DNS propagacja |
| API (custom domain)    | `https://api.estalara.com`                                       | ⏳ DNS propagacja |

> ⚠️ **Historical snapshot — host renamed (FOLLOW-568, 2026-07-11).** `api.estalara.com` later
> became the Estalara-app Spring backend host (ESC-019/PR #196) and was renamed by Estalara infra to
> **`api.app.estalara.com`** ~2026-06-30; the old name is no longer routed. Current values live in
> `docs/ops/DOPPLER_SECRETS_MATRIX.md`; this table is left as written for the historical record.

**Health endpoints:**

```bash
curl https://estalara-ingest-production.piotr-fb2.workers.dev/health
curl https://estalara-decision-api-production.piotr-fb2.workers.dev/api/health
```

---

## 5. Phase 1 — Vendor Activation (COMPLETE ✅)

### Decyzje strategiczne (Council Checkpoint 2.5)

- **D1-D8 LOCKED:** app.estalara.com jako international private-label SaaS
- **Shared classifier MOAT** — jeden model dla wszystkich agencji
- **Privacy-by-design** — zero PII
- **Demo target:** "directional proof-of-signal" (nie statystycznie znaczący lift)
- **Vendor staging:** 5 aktywnych w Phase 1, 4 zdeferred (Redpanda/Modal/ClickHouse/R2)
- **Budget:** $100-200/mo infrastructure

### Phase 0.5 — Pre-flight Runtime Fixes (DONE)

5 commitów, 12 blockerów wyczyszczonych: | Commit | Fix | |--------|-----| | e06da6e |
RUNTIME-FIX-001: canonical domain map | | c92da81 | RUNTIME-FIX-002: migration journal repair
(8→13) + RLS migration 0012 | | 5d30b28 | RUNTIME-FIX-003: SDK↔Ingest schema reconciliation + 23
contract tests | | 0942140 | RUNTIME-FIX-004: Worker-safe logger (WorkerLogger, 115 linii) | |
b0339cd | RUNTIME-FIX-005: Vercel config + env discipline + Phase 1 route gating |

### Phase 1 — Step-by-step (DONE)

**Step 1: Doppler ✅** — config: `prd`, 20+ sekretów, git email naprawiony na `piotr@time2show.com`

**Step 2: Supabase ✅** — pooler: `aws-0-eu-west-3.pooler.supabase.com:5432`, 13 migracji, 15 tabel,
RLS na 10 CAT-A tabelach

**Step 3: Cloudflare Workers ✅** — KV: API_KEYS=`523aafacf2d54201a33631d62ba801e3`,
IDEMPOTENCY=`0603c2833a7a46e2890fb885319d813c`, workers.dev: `piotr-fb2.workers.dev`

**Step 4: Vercel Control Plane ✅**

- Project ID: `prj_rUx2U8EnAqyRAwpPK40ypMEzAdPO`
- **WAŻNE:** `NPM_CONFIG_PRODUCTION=false` w Vercel env vars (Production + Preview)
- Install Command override: `cd ../.. && pnpm install --frozen-lockfile --prod=false`

**Build fixes:** | Commit | Fix | |--------|-----| | d51b1a8 | typescript → dependencies (shared,
db, auth) | | 10301fb | tsconfig.build.json exclude tests + @types/node + DOM lib (auth) | | 9946a4e
| @types/node + ES2022 lib (db) | | 78a8e38 | @types/node + DOM lib (shared) | | 6aae6a8 | tsup →
dependencies (sdk) |

**Step 5: Smoke Test ✅** — `accepted:1, rejected:0`

```bash
ADAPT_API_KEY=$(doppler secrets get ADAPT_API_KEY --plain) && \
curl -X POST https://estalara-ingest-production.piotr-fb2.workers.dev/v1/events \
  -H "Content-Type: application/json" \
  -H "X-Estalara-API-Key: $ADAPT_API_KEY" \
  -d '{"events":[{"event_id":"550e8400-e29b-41d4-a716-446655440000","session_id":"550e8400-e29b-41d4-a716-446655440001","tenant_id":"550e8400-e29b-41d4-a716-446655440002","type":"page.view","ts":1747656000000,"region":"eu","consent_state":"consented","schema_version":1,"payload":{"url":"https://app.estalara.com/listings/test","referrer":"https://google.com","device_class":"desktop"}}]}'
```

**Uwaga o autentykacji:** Header: `X-Estalara-API-Key`, KV key format: `api_key:<token>` (z
prefixem!)

**Step 6: DNS ✅ (w propagacji)** — OVH CNAME: `ingest.estalara.com` + `api.estalara.com`

---

## 6. Stan sprintów (2026-05-19)

| Sprint                 | Status     | Uwagi                                              |
| ---------------------- | ---------- | -------------------------------------------------- |
| Sprint 0–7.5           | ✅ DONE    | Pełny stack, SDK, Decision API, Auto-Detection     |
| Sprint 8 partial       | ✅ DONE    | A/B framework, 7 security fixes, SDK re-fetch loop |
| **Phase 1 Activation** | ✅ DONE    | Wszystkie 5 vendorów aktywnych, smoke test passed  |
| **Sprint 8 remaining** | 🔜 NEXT    | REORDER-001 + AGENCY-001                           |
| Sprint 9               | 📋 PLANNED | GDPR, DSR, consent management                      |
| Sprint 10              | 📋 PLANNED | External enrichment APIs                           |

---

## 7. Następne kroki (priorytet)

### Immediate

1. **Zresetuj hasło Supabase DB** — hasło było widoczne w terminal history. Supabase Dashboard →
   Settings → Database → Reset password. Potem zaktualizuj `DATABASE_URL` i `DATABASE_URL_DIRECT` w
   Doppler.

2. **Sprawdź DNS propagację** (po ~1-24h):

```bash
nslookup ingest.estalara.com && curl https://ingest.estalara.com/health
```

3. **Council Checkpoint 3** — uruchom AI Council z task "Review Phase 1 results, plan Phase 2
   activation scope"

### Sprint 8 remaining

**REORDER-001** (sdk-engineer, Sonnet 4.6) — ReorderDirective w DOM, per-archetype scoring, pierwszy
A/B experiment. Hooki gotowe: `container_selector`, `data_extractors_per_card`, `ReorderDirective`
stub w `packages/shared/src/directives.ts`

**AGENCY-001** (backend-engineer, Sonnet 4.6) — Agency pre-computed answers per listing, Level 2 w
placeholder resolution, endpoint POST /api/agency/answers

### Phase 2 (po Council Checkpoint 3)

- Aktywacja Redpanda, ClickHouse, Modal
- Custom domeny (cdn.estalara.com, admin.estalara.com)
- Demo na app.estalara.com (NATIVE-001 z Rafałem)

---

## 8. Kluczowe decyzje architektoniczne (locked)

### Placeholder resolution order

```
1. data-estalara-* atrybuty (manual)        → confidence 1.0
2. Agency-provided answers per listing       → 0.95
3. Auto-extracted z DOM via data_extractors  → 0.85
4. Computed metrics (price/area → price_sqm) → 0.80
5. Cached enrichments z external APIs        → 0.75
6. LLM generation (Haiku 4.5 / Sonnet 4.6)  → 0.60
7. Skip directive (usuń placeholder)
```

### app.estalara.com integration (NATIVE-001)

- Framework: **SvelteKit** (nie Next.js!)
- H1 = cena (nie tytuł) → dodaj `[data-estalara-slot='tagline']` powyżej H1
- **NATIVE-001 odroczone** do MVP launch

---

## 9. CI/CD i workflow

**Vercel deploy — WAŻNA LEKCJA:**

- `NPM_CONFIG_PRODUCTION=false` MUSI być w Vercel env vars
- Install Command override: `cd ../.. && pnpm install --frozen-lockfile --prod=false`

**pm-orchestrator workflow:**

1. Czyta QUEUE.md + MASTER_DESIGN.md
2. Przydziela tickety agentom
3. Po merge: `pnpm --filter @estalara/sdk build` → weryfikuje dist/
4. Aktualizuje STATUS.md i HANDOFFS.md

**Kluczowe reguły CI:**

- `@estalara/shared` MUSI być zbudowany przed lint i testami
- Corpus CI gate: precision ≥95%, recall ≥80% (aktualnie 100%/100%)
- GitHub Actions spending limit może cicho blokować CI

---

## 10. Model selection

| Kontekst                                        | Model             |
| ----------------------------------------------- | ----------------- |
| Standard tickets (implementacja wg spec)        | Claude Sonnet 4.6 |
| ML, architektura, algo scoring, copy generation | Opus 4.7 xhigh    |
| Retrospective-analyst (po każdym merge)         | Opus 4.7 xhigh    |
| Causal inference                                | Opus 4.7 xhigh    |
| Boilerplate, CI fixes                           | Sonnet 4.6        |

---

## 11. Czego unikać

**Git:**

- NIE: `git rebase` gdy PR ma konflikty → TAK: `git reset --soft origin/main`
- Git user.email MUSI być `piotr@time2show.com`

**Vercel:**

- NIE: deploy bez `NPM_CONFIG_PRODUCTION=false`
- NIE: `--cwd` flag w Vercel CLI z root repo

**Cloudflare KV:**

- NIE: `--binding` razem z `--namespace-id`
- NIE: bez `--remote` flag
- KV key format: `api_key:<token>` (z prefixem!)

**Detection Engine:**

- NIE: pełny CSS-in-JS hash → TAK: `[class*='keyword']`
- NIE: `null` dla POA → TAK: wartość `'POA'`

---

## 12. Kluczowe pliki

| Plik                                                   | Co zawiera                                     |
| ------------------------------------------------------ | ---------------------------------------------- |
| `docs/MASTER_DESIGN.md`                                | Architektura v1.4                              |
| `HANDOFF.md`                                           | Ten plik (v4.1)                                |
| `backlog/QUEUE.md`                                     | Status wszystkich ticketów                     |
| `packages/sdk/src/core/intent.ts`                      | Bayesian Intent Engine (18 archetypów)         |
| `packages/shared/src/directives.ts`                    | ReorderDirective stub                          |
| `packages/shared/src/schemas/events/page-lifecycle.ts` | Event schemas (page.view wymaga device_class!) |
| `apps/ingest/src/auth.ts`                              | Auth middleware — KV format `api_key:<token>`  |
| `~/ai-council/`                                        | AI Council — Python, osobne repo               |

---

## 13. Infrastruktura — podsumowanie

| Vendor             | Status      | Uwagi                                      |
| ------------------ | ----------- | ------------------------------------------ |
| Doppler            | ✅ aktywny  | config: prd, ~20 sekretów                  |
| Supabase           | ✅ aktywny  | 15 tabel, RLS, migracje 0001-0013          |
| Cloudflare Workers | ✅ aktywny  | ingest + decision-api na workers.dev       |
| Vercel             | ✅ aktywny  | control-plane, NPM_CONFIG_PRODUCTION=false |
| OVH DNS            | ✅ dodane   | ingest + api CNAME, w propagacji           |
| Redpanda           | ⏳ deferred | Phase 2                                    |
| ClickHouse         | ⏳ deferred | Phase 2                                    |
| Modal              | ⏳ deferred | Phase 2                                    |
| R2                 | ⏳ deferred | Phase 2                                    |

---

_Wygenerowano: 2026-05-19 | Wersja: 4.1 — dodano sekcję AI Council_ _Poprzedni HANDOFF: v4.0
(2026-05-19)_
