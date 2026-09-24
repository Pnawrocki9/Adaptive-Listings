# Plan wdrożenia rekomendacji audytu 2026-09-24 (program naprawczy)

> **Dla agentów wykonawczych:** ten dokument jest planem PROGRAMU (pakiety pracy, kolejność,
> decyzje, kryteria wyjścia). Każdy pakiet WP-x.y dostaje w chwili uruchomienia własny plan
> wykonawczy w formacie `superpowers:writing-plans` (kroki 2–5 min, red-first, commit), pisany przez
> PM z tego dokumentu i z sekcji audytu, którą pakiet realizuje. Wykonanie:
> `superpowers:subagent-driven-development` (świeży subagent na pakiet, review między pakietami).

**Status:** DRAFT do zatwierdzenia przez CEO. Nie jest źródłem prawdy, dopóki nie zostanie
zatwierdzony i odnotowany w `docs/MASTER_DESIGN.md` §Snapshot.0.

**Cel:** wdrożyć wszystkie rekomendacje `docs/AUDIT-2026-09-24.md` (§3A, §3B, §4, §6) bez naruszenia
rdzenia produktu z §5 tego audytu, tak aby po zakończeniu FOLLOW-819 był zielony 3× z rzędu na nowym
HEAD, a repo było o ~15–20 tys. linii mniejsze i utrzymywane przez prostszy proces.

**Architektura zmiany:** trzy fazy. Faza 1 (proces, koszt zero) i Faza 0 (sprzątanie martwego kodu,
ryzyko zero) idą równolegle w osobnych worktree; Faza 2 (produkt) idzie po nich, sekwencyjnie na
`/api/adapt` i równolegle poza nim. Każdy pakiet to jeden PR z dokumentacją zaktualizowaną w tym
samym PR (Rule AI), zweryfikowany `scripts/gh-pr-checks-verified.sh` (exit 0).

**Spec:** `docs/AUDIT-2026-09-24.md` + `docs/audits/2026-09-24/report-A..D.md`. Numery pozycji (np.
„poz. 10”) odnoszą się do tabel §3A/§3B audytu.

## Ograniczenia globalne (obowiązują każdy pakiet)

- Localhost-first (CLAUDE.md, orzeczenie CEO 2026-08-21): każdy PR dotykający `packages/sdk`,
  `apps/control-plane/src/app/api/adapt/**`, `apps/control-plane/src/lib/llm-gateway.ts` lub
  `apps/ingest` kończy się rerunem `tests/e2e/follow-819/differentiator-e2e.mjs` ×3 na realnym
  control plane `:3000` (nie mock `:9100`) i wklejonym wynikiem `[FRESH]` w PR.
- CI: `scripts/gh-pr-checks-verified.sh <pr>` exit 0 przed READY_FOR_REVIEW; nigdy
  `gh pr checks --watch`. PR, który usuwa lub zmienia nazwę wymaganego checku, edytuje
  `.github/required-checks.txt` w tym samym PR.
- Prettier na każdym edytowanym pliku: `./node_modules/.bin/prettier --write` (3.8.3), nigdy `npx`.
- Commit: `<type>(<scope>): <subject> [FOLLOW-NNNN]`, linie ciała ≤100 znaków (commitlint).
- Gałąź: `<agent>/<ticket>-<kebab>`, prefiks agenta obowiązkowy (inaczej push-CI nie startuje).
- Numery FOLLOW/ESC/ADR alokowane na `origin/main` przed użyciem (Rule AN).
- Zmiana publicznego API (eksporty `@estalara/sdk`, schemat eventu ingest, kontrakt `/api/adapt`)
  wymaga wpisu w `backlog/ESCALATIONS.md` PRZED PR.
- Zmiana architektury (usunięcie aplikacji, zamiana runtime) wymaga ADR w `docs/adr/`.
- Migracje Postgres auto-aplikują się na prod po merge (`db-migrate.yml`, brak bramki); migracje
  ClickHouse NIE (krok operatorski, Rule AA `CODE_COMPLETE_OPERATOR_PENDING`).
- Nie pisać „Tier 1/2/3” w nowym kodzie.
- Rule I: „0 nowych” niepodpiętych symboli; usuwanie tylko obniża baseline.
- Ten plan nie zmienia stosu technologicznego (CLAUDE.md „decided, do not re-litigate”). Jedyny
  wyjątek, WP-2.11, idzie przez ADR i osobną decyzję D5.

---

## A. Decyzje wymagane od CEO przed startem (z rekomendowanym domyślnym wyborem)

| ID  | Decyzja                                                                                                                                                                  | Rekomendacja (domyślna, jeśli brak sprzeciwu)                                                                                                                                                                   | Blokuje         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| D1  | Warunki 3–4 FOLLOW-820 (chat-NLP i feedback NA PROD) to warunki GO czy kroki po GO?                                                                                      | **Kroki po GO.** GO = warunek 1 (FOLLOW-819 zielony 3×) + warunek 2 (815 DONE) + nowy warunek 1b: ramię chatowe zielone na localhoście (D2). Spójne z localhost-first.                                          | WP-1.1          |
| D2  | Dodać ramię chatowe do FOLLOW-819 (decyzja #6 z audytu 09-13)?                                                                                                           | **Tak.** Chat → archetyp to noga celu bez testu.                                                                                                                                                                | WP-1.1, WP-2.13 |
| D3  | Bandyta Thompsona: zamrozić (serwować kontrolę, zachować holdout i logi) czy usunąć całkiem?                                                                             | **Zamrozić.** Usunięcie ~1,6k linii dopiero, gdy playbooki nie dostaną wariantów przeżywających wstrzymanie §E.7.0 do końca Fazy 2. Aktualizuje ESC-077.                                                        | WP-2.1          |
| D4  | Auto-detekcja: usunąć techniki platformowe (wordpress, drupal, angular, mui, css-in-js, css-modules, article-tag), zostawić `data-attributes` + `json-ld` + `ai-vision`? | **Tak, usunąć.** Re-brandy private-label dzielą markup Estalara. Sekcja B.5 → PARKED.                                                                                                                           | WP-0.4, WP-2.9  |
| D5  | Jeden runtime LLM: przenieść generowanie opisów z Modal (Python) do control-plane (TS, `after()`) i mieć jeden fact-check, jeden limit wydatków?                         | **Tak, jako OSTATNI pakiet Fazy 2, przez ADR-0023 i testy parytetu (Rule Z).** Zastępuje ADR-0016. Alternatywa: zostawić dwa runtime i tylko wyrównać fact-check testem parytetu (tańsza, nie usuwa duplikatu). | WP-2.11         |
| D6  | Tabele-widma `engagement_scores`, `session_embeddings`, `tenant_compliance_records`: usunąć (z aktualizacją DPIA/ROPA) czy dopisać pisarzy?                              | **Usunąć.** Brak pisarza od migracji 0021; DPIA/ROPA poprawia compliance-engineer w tym samym PR (Rule N).                                                                                                      | WP-0.6b         |
| D7  | `apps/data-quality` (cron walidacji schematu B.6): zaparkować (kod zostaje, deploy i checki prod znikają) czy usunąć?                                                    | **Zaparkować.** Ma sens od kilku tenantów.                                                                                                                                                                      | WP-2.12         |
| D8  | Proces: retro tylko dla PR produktowych >100 linii kodu lub po awarii, zbiorczo raz w tygodniu; moratorium na nowe Reguły do GO; zamrożenie nowych stubów P2/P3 do GO.   | **Tak, w tej formie.** Zamiast przenosić 641 stubów do osobnego pliku (łamie append-only `FOLLOW_UPS.md` i Rule AG) — baner FREEZE na górze pliku + generowany indeks otwartych P0/P1 na ścieżce.               | WP-1.2          |
| D9  | Usunięcie z publicznego API SDK: `identify()` i pola `tier` (schemat eventu ingest).                                                                                     | **Tak, przez ESC** (zmiana publicznego kontraktu). Prod nie serwuje SDK (ESC-020), więc brak konsumentów zewnętrznych.                                                                                          | WP-2.8          |
| D10 | Jedna pamięć podręczna opisów: zostawić Postgres, usunąć warstwę Redis (odwraca decyzję CEO 2026-06-05, FOLLOW-203)?                                                     | **Warunkowo:** zmierzyć p95 `/api/adapt/description` na localhoście z samym Postgresem; jeśli <100 ms, usunąć Redis; jeśli nie, zostawić obie i zamknąć poz. 15 jako „zmierzone, zostaje”.                      | WP-2.6          |

Zatwierdzenie planu z pustą kolumną „sprzeciw” = przyjęcie rekomendacji domyślnych.

---

## B. Pakiety pracy

Legenda: **Agent (model)** wg reguły model-fit z CLAUDE.md. **Weryfikacja** = kryterium zamknięcia
pakietu poza standardowym exit 0 weryfikatora. **Zależy od** = merge wymagany wcześniej.

### Faza 1 — proces i ścieżka krytyczna (4 PR-y, równolegle z Fazą 0)

#### WP-1.1 Ścieżka krytyczna, jedno miejsce statusu, FOLLOW-820 po D1/D2

Realizuje: audyt §4 pkt 1, 2, 3, 4; §6 Faza 1.

- **Pliki:** `CLAUDE.md` (sekcja „Localhost-first until FOLLOW-820 GO”: usunąć 815 ze ścieżki, dodać
  FOLLOW-1203 i FOLLOW-1220, dodać ramię chatowe), `docs/MASTER_DESIGN.md` (§P.0 warunki GO wg
  D1/D2, §Snapshot.0 jako JEDYNE miejsce statusu, wersja 4.14 + changelog), `backlog/FOLLOW_UPS.md`
  (amendment do FOLLOW-820: warunki 3–4 → „kroki po GO”; nowy warunek 1b),
  `tests/e2e/follow-819/README.md` §0 (link do §Snapshot.0 zamiast powtórzenia), `backlog/QUEUE.md`
  baner (tylko PM: „status w §Snapshot.0”, bez powtarzania warunków). Dodatkowo §Snapshot.1: wiersze
  PARKED (jawnie, z datą i powodem „single-tenant localhost GO”) dla L (pricing), M (GTM), N
  (koszty), R (patenty), U.11 (profile mode), W (operational excellence), D.5 (continuous detection
  quality) — audyt §4 pkt 8; sekcje A.3, B.3, B.4/B.5, B.4.4, B.4.5, B.6 dostają PARKED w pakietach,
  które je dotykają (WP-0.6a, WP-0.5, WP-2.9, WP-2.12).
- **Agent:** architect (**Fable** — rewizja SoT i orzeczenia CEO).
- **Weryfikacja:** `grep -n "FOLLOW-815" CLAUDE.md` zwraca tylko wzmiankę historyczną;
  `node scripts/check-measured-premises.mjs` zielony; jedno `grep -rn "GO requires" docs backlog`
  poza §P.0 i stubem FOLLOW-820 = 0 trafień.
- **Zależy od:** decyzje D1, D2.

#### WP-1.2 Kadencja retro, moratorium na Reguły, FREEZE stubów (D8)

Realizuje: audyt §4 pkt 5; §6 Faza 1.

- **Pliki:** `CLAUDE.md` („Per-ticket retrospective loop” → „Retro loop” z progiem: PR produktowy
  > 100 linii w `apps|packages/*/src` lub PR po awarii; zbiorczo raz w tygodniu; docs-only PR bez
  > retro), `.claude/agents/pm-orchestrator.md` (warunek spawnu retrospective-analyst),
  > `.claude/agents/retrospective-analyst.md` (limit: max 3 stuby na retro, każdy z klasyfikacją
  > produkt/pomiar/docs/gate), `docs/AGENT_WORKFLOW.md`, `CONVENTIONS_PATCH.md` (nagłówek:
  > „Moratorium na nowe Reguły do FOLLOW-820 GO — orzeczenie CEO 2026-09-24; poprawki istniejących
  > reguł dozwolone tylko przy udowodnionym fałszywym czerwonym”), `backlog/FOLLOW_UPS.md` (baner
  > FREEZE na górze: nowe stuby P2/P3 nie są zakładane do GO; obserwacje idą do sekcji retro jako
  > lista, nie jako stub), nowy `scripts/follow-ups-open-index.mjs` generujący
  > `backlog/FOLLOW_UPS_OPEN.md` (id, priorytet, nagłówek, „na ścieżce 820: tak/nie”) z heurystyki
  > statusów; uruchamiany ręcznie przez PM.
- **Agent:** pm-orchestrator (**Sonnet** — bookkeeping) po tekście zatwierdzonym przez CEO.
- **Weryfikacja:** `check-gate-exit-codes.sh` zielony (pliki tier-0 nie zmieniają markera);
  wygenerowany `FOLLOW_UPS_OPEN.md` ma ≤700 pozycji i wskazuje 1203, 1220, 1240, 1243, 1244, 1246
  jako „na ścieżce”.
- **Zależy od:** D8.

#### WP-1.3 Bramki meta poza ścieżką PR

Realizuje: audyt §4 pkt 6; raport D §4.

- **Zakres:** przenieść z `pull_request` na `schedule` (tygodniowo) + `workflow_dispatch`: trzy
  self-testy bramek (zostaje jeden: `PR-checks gate self-test`), trzy kontrole negatywne (zostaje
  jedna: `Detector negative control`), `Ticket status vocabulary`, `Measured-premise register`,
  `Deployment-surface register`, `Staging-plane gate`; scalić sześć bramek consent-sync
  (`Consent contract drift`, `Consent retention sync`, `Registration consent-text sync`,
  `Privacy Notice SDK key-sync`, `Consent-text effect probe negative control`,
  `Session-identifier corpus sync`) w jeden job `Consent corpus sync` wywołujący te same skrypty
  sekwencyjnie; cztery sondy `any-state … (prod)` zostają zarejestrowane (prod nie serwuje SDK, ale
  ich obecność jest tania). `Rule I — wired-or-dead check`: zostaje `any-state` (Rule AF:
  kwarantanna, nie usunięcie).
- **Pliki:** `.github/workflows/ci.yml`, `.github/required-checks.txt` (ten sam PR), nowy
  `.github/workflows/gate-hygiene-weekly.yml`, `CONVENTIONS_PATCH.md` Rule Q/AP (adnotacja o
  kadencji), `docs/ops/OPERATING_PRINCIPLES.md` jeśli cytuje listę.
- **Agent:** devops-engineer (**Opus** — zmiana bramek jest wrażliwa).
- **Weryfikacja:** rollup PR ma ≤42 checków, weryfikator exit 0,
  `gh-pr-checks-verified.sh --self-test` zielony, weekly workflow uruchomiony ręcznie raz i zielony.
- **Zależy od:** nic. Konflikt plikowy z WP-0.1/0.2/0.5 na `ci.yml` → merge po nich.

#### WP-1.4 Jeden skrypt bring-up localhost

Realizuje: audyt §4 pkt 7; zamyka klasę FOLLOW-1244/1246.

- **Pliki:** nowy `scripts/dev/localhost-up.sh` (kolejno:
  `pnpm --filter @estalara/db --filter @estalara/auth --filter @estalara/shared build`;
  `docker start estalara_ch_local al_pg_local` + kontenery app stacku; start serwera fixture
  `:8081`; start intent-engine shim `:8090` + SRH `:8079`; start ingest `:8787`; start control plane
  `:3000` przez `doppler run -c dev`; preflight z `tests/e2e/follow-819/harness-preflight.test.ts`),
  `scripts/dev/localhost-down.sh`, `docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md` §3 (jedno polecenie,
  reszta jako „co robi skrypt”), `tests/e2e/follow-819/README.md` §3.
- **Agent:** qa-engineer (**Sonnet**).
- **Weryfikacja:** świeży klon + `localhost-up.sh` + `differentiator-e2e.mjs` = 6/6 bez ręcznych
  kroków; `HARNESS_TREE_PATHSPEC` obejmuje skrypt (FOLLOW-1244).
- **Zależy od:** nic.

### Faza 0 — sprzątanie martwego kodu (8 PR-ów, ryzyko zero)

Kolejność merge na wspólnych plikach (`ci.yml`, `required-checks.txt`, `CLAUDE.md`, `README.md`):
WP-0.1 → WP-0.2 → WP-0.5; pozostałe równolegle w worktree.

#### WP-0.1 Usunięcie `apps/decision-api` (poz. 1)

- **Pliki:** usunąć `apps/decision-api/`; `.github/workflows/ci.yml:201,261` (filtry turbo);
  `.github/workflows/deploy-staging.yml` (job `deploy-decision-api`); `scripts/mirror-files.json`
  (para `shared/bandit.ts` ↔ `decision-api/lib/bandit.ts`); `scripts/check-no-staging-plane.sh`
  (przestaje czytać `apps/decision-api/wrangler.toml`); `scripts/check-rule-h.sh` (wzmianka o 410);
  `tsconfig.json` (referencja projektu); `commitlint.config.cjs` (scope `decision-api` — usunąć);
  `.gitleaks.toml` (wpis ścieżki); `packages/shared/src/domains.ts:30` (domena — usunąć, sprawdzić
  konsumentów); `infra/terraform/cloudflare/dns.tf` (rekord `decision_api`); `docs/INTERFACES.md`,
  `docs/CONVENTIONS.md`, `README.md`, `CLAUDE.md` („7 apps” → aktualna liczba),
  `docs/MASTER_DESIGN.md` §A.1 diagram + §Snapshot.3 (wiersz o Workerze) + §Snapshot.1;
  `backlog/FOLLOW_UPS.md` amendment zamykający FOLLOW-107; `.claude/agents/backend-engineer.md`
  jeśli wymienia.
- **Agent:** backend-engineer (**Opus** — zmiana przecina CI, infra, shared).
- **Weryfikacja:**
  `grep -rn "decision-api" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=backlog --exclude-dir=.claude . | grep -v "docs/audits\|AUDIT-\|adr/"`
  = 0; `pnpm turbo run build test --filter='./packages/*' --filter='@estalara/control-plane'`
  zielony; `check-mirror-files.sh` zielony; FOLLOW-819 ×3 (SDK nie dotknięte, ale
  `shared/domains.ts` tak).
- **Zależy od:** nic. Operator: po merge usunąć Workera `estalara-decision-api-*` z konta Cloudflare
  (`wrangler delete`), zanotować w PR.

#### WP-0.2 Usunięcie `apps/stream-consumer` i resztek Redpandy (poz. 2, 3)

- **Pliki:** usunąć `apps/stream-consumer/`, `infra/terraform/redpanda/`; `ci.yml:220` (matryca
  test-python); `.github/required-checks.txt` (wiersz `Test (Python) (3.12, stream-consumer)`);
  `.github/workflows/modal-deploy.yml` (komentarz nagłówka), `.github/workflows/e2e-smoke.yml`
  (komentarze); `.env.example` (zmienne `REDPANDA_*`, `KAFKA_*`);
  `apps/llm-gateway/src/jobs/generate_description.py:2199-2324` (poller
  `consume_description_requests`
  - import confluent), `apps/llm-gateway/src/jobs/consume_embed_seed_requests.py:149-346` (poller),
    `apps/llm-gateway/src/jobs/_app.py` (obraz Modal bez confluent), testy tych pollerów,
    `apps/llm-gateway/pyproject.toml`,
    `apps/data-quality/src/crons/schema_validation.py:101,521-556` (producer Kafka) +
    `test_schema_validation.py`, `apps/data-quality/pyproject.toml`;
    `packages/shared/src/schemas/description.ts:126` (docstring „Redpanda event” → „Modal
    endpoint”); runbooki z sekcji „historyczne”: `docs/runbooks/MODAL_PROD_STANDUP.md`, the
    ClickHouse ingest-worker grant-narrowing runbook (in `docs/runbooks/`),
    `CLICKHOUSE_DATETIME_INPUT_FORMAT.md`; `docs/compliance/C-07-chat-retention-scope.md`
    (compliance-engineer potwierdza, że opis ścieżki chatu = ingest → Modal, Rule N);
    `docs/MASTER_DESIGN.md` §A.1, §C.4; `CLAUDE.md` (liczba apps).
- **Agent:** data-engineer (**Opus**) + compliance-engineer (**Sonnet**) dla C-07.
- **Weryfikacja:** `pytest` w llm-gateway i data-quality zielony;
  `grep -rniE "redpanda|confluent|kafka" apps packages infra .github .env.example` = 0 poza
  „historical” adnotacjami; weryfikator exit 0 z zaktualizowanym rejestrem.
- **Zależy od:** WP-0.1 (wspólne `ci.yml`).

#### WP-0.3 Usunięcie crona `batch_enrich` (poz. 4)

- **Pliki:** usunąć `apps/intent-engine/src/jobs/batch_enrich.py`, `clickhouse_reader.py`;
  `apps/intent-engine/src/main.py` (rejestracja `@app.function(schedule=...)`), `schemas.py`,
  `conftest.py`, `nlp.py` (zostaje `SONNET_MODEL` dla retry wielojęzycznego — NIE usuwać),
  `apps/intent-engine/README.md`, `.github/workflows/modal-deploy.yml`,
  `docs/runbooks/MODAL_PROD_STANDUP.md`, `docs/MASTER_DESIGN.md` §D.4 (pipeline batch → „nie
  istnieje; strojenie wag ręczne do czasu pętli uczenia”).
- **Agent:** ml-engineer (**Sonnet**).
- **Weryfikacja:** `pytest apps/intent-engine`; `modal deploy --dry-run` lub CI job Modal zielony;
  `check-modal-app-singleton.sh` zielony.
- **Zależy od:** nic.

#### WP-0.4 Martwe moduły SDK i ścieżka hints/detect po stronie klienta (poz. 5, 19 część)

- **Pliki:** usunąć `packages/sdk/src/core/embedding.ts`, `ui/sidebar-widget.ts`,
  `auto-detect/archetype-hints.ts`, `auto-detect/detect-bundle.ts`; `packages/sdk/tsup.config.ts`
  (wpis `estalara-detect`); `packages/sdk/src/index.ts:1216-1250` (odczyt `window.__EStalaraDetect`)
  i `:1348-1350`; `core/intent.ts` `applyDecay` (`:1224`), `applyQuizPrior` (`:884`) + ich testy;
  `apps/control-plane/src/app/api/sdk-detect/route.ts` (usunąć trasę);
  `scripts/check-served-bundles.sh` (jeśli wylicza `estalara-detect.iife.js`);
  `docs/MASTER_DESIGN.md` §B.2 (budżet: bundle detect nie istnieje). `identify()` i `tier` NIE w tym
  pakiecie (publiczne API → WP-2.8).
- **Agent:** sdk-engineer (**Sonnet**).
- **Weryfikacja:** `pnpm --filter @estalara/sdk test build build:check` zielony, bundle ≤ 43 136 B
  (raport delty w PR); Rule I „0 nowych”; FOLLOW-819 ×3 zielony.
- **Zależy od:** D4 (tylko część hints).

#### WP-0.5 Pakiety-zaślepki (poz. 6)

- **Pliki:** usunąć `packages/sdk-loader`, `sdk-react`, `sdk-vue`, `compliance`, `intent-ontology`;
  `scripts/check-bundle-size.ts` (importy sdk-loader/sdk-react); `apps/intent-engine/src/schemas.py`
  (komentarz); `README.md`, `docs/CONVENTIONS.md`, `CLAUDE.md` („10 packages”, tabela agentów:
  sdk-engineer bez „@estalara/react, @estalara/vue”), `.claude/agents/sdk-engineer.md`;
  `pnpm install` → `pnpm-lock.yaml`; `docs/MASTER_DESIGN.md` §B.3/§B.4.4 → PARKED.
- **Agent:** devops-engineer (**Sonnet**).
- **Weryfikacja:** `pnpm install --frozen-lockfile` w CI zielony; `pnpm turbo run build` zielony;
  `check-bundle-size` zielony.
- **Zależy od:** WP-0.2 (wspólne `CLAUDE.md`/`README.md`).

#### WP-0.6a Terraform i infra jako „hand-provisioned” (poz. 7)

- **Pliki:** usunąć `infra/terraform/{clickhouse,supabase,upstash}` (same komentarze) i
  `infra/terragrunt.hcl`, `infra/terraform/validate-all.sh` jeśli tracą sens; zostaje
  `infra/terraform/cloudflare` (DNS, R2) i `infra/terraform/modal`; `infra/README.md` (jedna sekcja
  „Co jest provisionowane ręcznie i gdzie jest udokumentowane”: `docs/runbooks/vendor-accounts.md`);
  `docs/MASTER_DESIGN.md` §A.3 → PARKED z zapisem „jeden projekt EU; `region` to etykieta na
  evencie”.
- **Agent:** devops-engineer (**Sonnet**).
- **Weryfikacja:** `terraform validate` w `cloudflare/`; `check-deployment-surfaces.mjs` zielony.
- **Zależy od:** WP-0.1 (rekord DNS).

#### WP-0.6b Tabele-widma (poz. 8; D6)

- **Pliki:** nowa migracja PG `0039_drop_phantom_tables.sql` (DROP `tenant_compliance_records`,
  `session_embeddings`, `engagement_scores`) + `packages/db/src/schema/*` + trasy DSR
  `apps/control-plane/src/app/api/dsr/{erase,portability,access}/route.ts` (gałęzie tych tabel) +
  ich testy; migracja CH `0023_drop_session_quality_and_summary.sql` (DROP TABLE `session_quality`,
  DROP VIEW `session_summary`) — krok operatorski; `apps/ingest/src/consent-gate.ts:56` (komentarz
  „phantom write-path”); `docs/compliance/DPIA*.md`, `ROPA*.md` (usunięcie aktywności
  `engagement_scores`; compliance-engineer, Rule N); `docs/DATA_DICTIONARY.md`.
- **Agent:** data-engineer (**Opus**) + compliance-engineer (**Sonnet**).
- **Weryfikacja:** `check-migration-journal.sh` zielony;
  `pnpm --filter @estalara/control-plane test` zielony; przed merge `SELECT count(*)` na prod dla
  trzech tabel = 0 (wklejone do PR; jeśli ≠ 0 → STOP i eskalacja). Po merge migracja PG aplikuje się
  na prod automatycznie; migracja CH aplikowana ręcznie i zapisana w PR jako krok operatorski (Rule
  AA).
- **Zależy od:** D6.

#### WP-0.7 Porządki lokalne i pliki w root (bez zmian kodu)

- **Pliki:** przenieść `AUDIT_IMPLEMENTATION_MAP.md`, `AUDIT_REPORT_INVESTOR_READINESS.md`,
  `AUDIT_RISK_MATRIX.md`, `AUDIT_TEST_GAPS.md`, `HANDOFF.md`, `STATUS.md` do
  `docs/audits/historical/` (aktualizacja linków: `docs/MASTER_DESIGN.md` §Snapshot.4,
  `scripts/check-gate-exit-codes.sh` wpis `STATUS.md`, `CLAUDE.md`); usunąć `tmp/` z drzewa, jeśli
  śledzone (sprawdzić `git ls-files tmp`), dodać do `.gitignore`; lokalnie (nie PR):
  `git worktree prune` + usunięcie katalogów `.claude/worktrees/agent-*` starszych niż 7 dni (3,2
  GB; wcześniej `git -C <wt> status` musi być czysty — inaczej to osierocona praca, Rule z pamięci
  sesji).
- **Agent:** pm-orchestrator (**Sonnet**).
- **Weryfikacja:** `check-gate-exit-codes.sh` zielony po zmianie ścieżki `STATUS.md`; brak martwych
  linków (`grep -rn "AUDIT_REPORT_INVESTOR_READINESS" docs CLAUDE.md`).
- **Zależy od:** nic.

#### WP-0.8 (opcjonalny, DEFER) `observability.py` ×3 (poz. 9)

Trzy aplikacje Modal mają osobne obrazy; wspólny moduł wymaga pakietu Python w monorepo i zmiany
budowania obrazów. Bramka mirror kosztuje 0 na PR. **Rekomendacja: nie ruszać do końca Fazy 2;**
jeśli WP-2.11 usunie `apps/llm-gateway`, a WP-2.12 zaparkuje `data-quality`, zostanie jedna kopia i
problem znika sam.

### Faza 2 — produkt (13 PR-ów + 2 ESC + 1 ADR; po Fazie 0/1)

Sekwencja na `route.ts`: WP-2.1 → WP-2.2 → WP-2.3 → WP-2.5. Równolegle poza nim: WP-2.4, WP-2.7,
WP-2.9, WP-2.10b, WP-2.12, WP-2.13. Ostatni: WP-2.11.

#### WP-2.1 Zamrożenie bandyty (poz. 10; D3)

- **Zakres:** `/api/adapt` nie losuje ramienia (`route.ts:1352,2025` → stały `variant='control'`,
  kolumna `variant` w `adaptation_decisions` zostaje); `getBanditArms`, `lib/bandit-query.ts`,
  `lib/bandit-seed.ts`, `/api/ab/weights`, `/api/tenants/[id]/bandit/weights/[archetype]`,
  `/api/adapt/feedback` → za flagą `BANDIT_ENABLED=false` (domyślnie), panel `dashboard/analytics`
  ukrywa sekcję ramion; SDK: cache wariantu i HMAC feedback ping (`adapt.ts:28-200,680-775`)
  usunięte (podpis kluczem publicznym nie daje integralności — raport A §2).
  `backlog/ESCALATIONS.md` ESC-077 amendment (orzeczenie D3); `docs/MASTER_DESIGN.md` §E.1–E.3
  „zamrożony do czasu wariantów przeżywających §E.7.0”.
- **Agent:** ml-engineer (**Opus**).
- **Weryfikacja:** FOLLOW-819 ×3 zielony; `SELECT variant, count() FROM adaptation_decisions` na
  localhoście po runie = tylko `control`; bundle mniejszy (raport delty).

#### WP-2.2 `GET /api/adapt` out, `llm_full`/`llm_tweaked` scalone, testy po etapach (poz. 11, 12, 22 część)

- **Zakres:** usunąć handler GET (`route.ts:1059-1466`) i `lib/adapt-get-auth.ts` jeśli traci
  konsumentów; jedno wywołanie LLM z etykietą źródła jako parametr (`route.ts:484-530`); 29 plików
  `route.*.test.ts` → ~6 plików po etapie (`auth`, `consent-and-enablement`, `decision-tree`,
  `grounding`, `holdout`, `logging`), z zachowaniem każdego asercji zachowania i usunięciem pinów
  stałych; `docs/adr/ADR-0004*.md` amendment (GET wycofany); `docs/INTERFACES.md`.
- **Agent:** backend-engineer (**Opus**).
- **Weryfikacja:** przed usunięciem:
  `grep -rn "method: 'GET'\|\.get(" packages/sdk/src tests apps/control-plane/src --include=*.ts | grep -i adapt`
  = 0 poza usuwanymi testami; canary `adapt-llm-source-smoke.yml` zielony; FOLLOW-819 ×3.
- **Zależy od:** WP-2.1.

#### WP-2.3 Wydzielenie demo z trasy rdzenia (poz. 17)

- **Zakres:** warianty auth demo/ops, override archetypu, unieważnianie sesji demo
  (`route.ts:1546-1846`) → `lib/demo/adapt-demo-context.ts` wywoływany tylko gdy `DEMO_MODE=1`;
  `api/demo/*` i `dashboard/demo/*` za tą samą flagą; `demo-integration.yml` ustawia flagę.
- **Agent:** backend-engineer (**Opus**).
- **Weryfikacja:** `demo-integration.yml` zielony; FOLLOW-819 ×3 (harness używa demo JWT — musi
  działać z `DEMO_MODE=1` na localhoście; zapisać w README §3).
- **Zależy od:** WP-2.2.

#### WP-2.4 Jedna analityka, jedna funkcja lift (poz. 16)

- **Zakres:** `lib/pilot-stats.ts` staje się jedynym źródłem lift (`pilot/cta-lift/route.ts:121-168`
  i `dashboard/analytics/lift/route.ts:152` wołają tę samą funkcję); `dashboard/pilot` i
  `admin/analytics(+rollup)` scalone w `dashboard/analytics` z zakładkami; `admin/tenants/[id]/*`
  wrappery zostają (cienkie). Tracer zostaje.
- **Agent:** backend-engineer (**Sonnet**).
- **Weryfikacja:** test parytetu: ta sama próbka danych → identyczny lift z obu tras przed
  scaleniem; po scaleniu jedna trasa; `check-fire-and-forget-sinks.sh` zielony.

#### WP-2.5 Limit wydatków na liczniku, bez pilot-freeze i stall-timera (poz. 14)

- **Zakres:** `llm-gateway.ts:484-516` → licznik dzienny w Upstash (`INCRBYFLOAT llm:spend:<date>`,
  TTL 48 h), odczyt O(1), fail-open jak dziś; `llm_calls` zostaje jako log; usunąć
  `checkPilotFrozenAsync` (`route.ts:155`) i timer segmentu (`:1537, :2034-2046`) — stall widoczny z
  p95 w Sentry performance.
- **Agent:** backend-engineer (**Sonnet**).
- **Weryfikacja:** test jednostkowy licznika; FOLLOW-819 ×3;
  `tests/integration/redis-shadow-round-trip` zielony.
- **Zależy od:** WP-2.3.

#### WP-2.6 Jedna pamięć podręczna opisów (poz. 15; D10)

- **Zakres:** pomiar p95 `/api/adapt/description` na localhoście z wyłączonym Redis (100 żądań,
  cache ciepły w PG); jeśli <100 ms → usunąć `lib/description-cache.ts` i ścieżkę Redis w
  `description/route.ts`, `generate_description.py:2011` (`_write_to_redis`); jeśli nie → zamknąć z
  pomiarem. `docs/MASTER_DESIGN.md` §E.7.2.
- **Agent:** backend-engineer (**Sonnet**).
- **Weryfikacja:** wklejony pomiar w PR; `pnpm test` control-plane.

#### WP-2.7 Playbooki poza SDK (poz. 20)

- **Zakres:** `packages/sdk/src/core/playbooks/` → `packages/shared/src/playbooks/`; SDK importuje
  tylko typy (`SlotDirective`); control-plane importuje z `@estalara/shared/playbooks`; usunąć
  eksport `./playbooks` z `packages/sdk/package.json`; ~20 importów w testach control-plane.
- **Agent:** sdk-engineer (**Sonnet**).
- **Weryfikacja:** bundle SDK niezmieniony lub mniejszy; `pnpm turbo run typecheck build test`
  zielony; Rule I „0 nowych”.

#### WP-2.8 Publiczne API SDK: `identify()` i `tier` (poz. 5 reszta; D9)

- **Zakres:** ESC-NNN (alokowany na main) z listą konsumentów = 0; usunąć `identify()`
  (`index.ts:2088`), `config.tier` (`config.ts:37,214-216`), pole `tier` z
  `packages/shared/src/schemas/event.ts` i z ingest (`apps/ingest/src/handlers/events.ts`
  walidacja), z `intent.snapshot`; `docs/INTERFACES.md`, `backlog/HANDOFFS.md` kontrakt (Rule AI).
- **Agent:** sdk-engineer (**Sonnet**) po ESC.
- **Weryfikacja:** `Cross-language event contract` zielony; FOLLOW-819 ×3; ingest testy zielone.
- **Zależy od:** ESC zaakceptowany przez CEO.

#### WP-2.9 Auto-detekcja: przycięcie do markupu Estalara; mikro-ankieta i DQS (poz. 18, 19 reszta; D4)

- **Zakres:** usunąć
  `packages/sdk/src/auto-detect/techniques/{wordpress,drupal-php,angular, mui-components,css-in-js,css-modules,article-tag}.ts` +
  fixtures korpusu; zostają `data-attributes`, `json-ld`, `ai-vision`; `auto-detect/pipeline.ts`
  rejestr technik; `vitest.corpus.config.ts` i bramka `Auto-Detection corpus gate` (fixtures
  usuniętych technik); `apps/control-plane/src/app/api/detect/route.ts` bez zmian kontraktu;
  `components/onboarding/ DetectionPreview.tsx` bez hints; mikro-ankieta: krok operatorski
  `SELECT count(*) FROM tenants WHERE micro_polls_enabled` na prod = 0 (wklejone) → usunąć
  `ui/micro-poll.ts`, gałęzie `intent.ts:398, 1067-1100`, `index.ts:1643-1760`, kolumnę przez
  migrację 0040; DQS: usunąć `core/dqs.ts`, `index.ts:649-700`, akceptację w ingest
  (`session.quality` event → 400 z jasnym kodem albo ignore — ESC, jeśli event jest w publicznym
  schemacie); `docs/MASTER_DESIGN.md` §B.4/B.5 → PARKED (zamrożone, nie rozwijane), §G (DQS
  usunięty).
- **Agent:** sdk-engineer (**Opus**).
- **Weryfikacja:** korpus detekcji zielony dla trzech technik; bundle ≤ budżet i raport delty;
  FOLLOW-819 ×3.
- **Zależy od:** D4; ESC dla `session.quality`, jeśli publiczne.

#### WP-2.10a Komentarze-archeologia → ADR (poz. 22 część)

- **Zakres:** `route.ts`, `llm-gateway.ts`, `index.ts`, `intent.ts`, `adapt.ts`: każdy blok
  komentarza „FOLLOW-xxx: historia” zredukowany do jednego zdania „dlaczego” + id; pełna historia do
  `docs/adr/ADR-0024-adapt-route-decision-record.md` (jedno ADR na plik nie jest potrzebne — jeden
  rekord decyzji z sekcjami per plik). PRZED: sprawdzić `scripts/lib/extract-fn-signature.cjs` i
  `check-rule-i.sh`, czy parsują komentarze (Rule I liczy wzmianki w docstringach jako importerów —
  pamięć sesji 146); jeśli tak, usuwanie komentarza może odsłonić „martwy” eksport → to jest
  prawdziwe znalezisko, nie regresja: usunąć eksport albo podpiąć.
- **Agent:** backend-engineer (**Opus**).
- **Weryfikacja:** brak zmian zachowania (`git diff` bez linii kodu poza komentarzami; testy
  zielone); Rule I „0 nowych” po korekcie eksportów; liczba linii komentarzy w pięciu plikach spada
  z ~4,1k do <1k (wklejone przed/po).

#### WP-2.10b `init()` w SDK podzielone (poz. 21)

- **Zakres:** `packages/sdk/src/index.ts:337-2080` → `core/boot.ts` (config, session, consent gate),
  `core/consent-flow.ts`, `core/intent-loop.ts`, `core/adapt-loop.ts`; `index.ts` składa je; zero
  zmian zachowania.
- **Agent:** sdk-engineer (**Opus**).
- **Weryfikacja:** wszystkie testy SDK zielone bez modyfikacji asercji; bundle ±0,5%; FOLLOW-819 ×3.
- **Zależy od:** WP-2.9 (mniej kodu do dzielenia).

#### WP-2.11 Jeden runtime LLM (poz. 13; D5)

- **Zakres:** `docs/adr/ADR-0023-description-generation-in-control-plane.md` (zastępuje ADR-0016);
  `lib/grounding-check.ts` jako jedyny fact-check (port `_check_numbers`, `_check_headline_facts`,
  `_check_body_facts`, `_canon_number`, `_stem_loose`) z testami parytetu na fixtures wygenerowanych
  z Pythona (Rule Z); `lib/description-generator.ts` (Sonnet prompt z `_generate_with_sonnet`,
  verdict parser, cache PG) wywoływany w `after()` z `description/route.ts`;
  `seed-listing-embeddings.ts` liczy embeddingi przez istniejący `lib/openai-client.ts` zamiast
  `MODAL_EMBED_SEED_URL`; usunąć `apps/llm-gateway/`, `modal-deploy.yml` job, `cron-heartbeat.yml`
  sonda kontenerów, wpis w `required-checks.txt` (`Test (Python) (3.12, llm-gateway)`,
  `Assert intent-engine + llm-gateway containers…` → tylko intent-engine); `docs/MASTER_DESIGN.md`
  §E.7, §A.1; runbooki Modal. Operator: `modal app stop estalara-description-generator` po zielonym
  FOLLOW-819.
- **Agent:** ml-engineer (**Fable** — najwyższe ryzyko, ścieżka anty-halucynacyjna).
- **Weryfikacja:** testy parytetu 100% na korpusie ≥50 opisów (wyjścia Python vs TS identyczne co do
  werdyktu); p95 generowania ≤ dzisiejsze (pomiar `llm_calls`); FOLLOW-819 ×3 zielony;
  `adapt-llm-source-smoke.yml` zielony.
- **Zależy od:** D5; wszystkie inne pakiety Fazy 2 zmergowane.

#### WP-2.12 Parkowanie `apps/data-quality` (D7)

- **Zakres:** usunąć job z `modal-deploy.yml`, sondę
  `Assert validate_schemas ran in the last 26h (prod)` z `cron-heartbeat.yml` i z
  `required-checks.txt`, `Test (Python) (3.12, data-quality)` zostaje (kod zostaje);
  `docs/MASTER_DESIGN.md` §B.6 → PARKED „od ≥3 tenantów”; operator:
  `modal app stop estalara-schema-validation`.
- **Agent:** devops-engineer (**Sonnet**).
- **Weryfikacja:** weryfikator exit 0 z rejestrem bez sondy.

#### WP-2.13 Ramię chatowe w FOLLOW-819 (D2; audyt §4 pkt 3)

- **Zakres:** `tests/e2e/follow-819/differentiator-e2e.mjs` nowa gałąź: wysłać `chat.message.sent`
  przez SDK do ingest `:8787` → shim intent-engine `:8090` → klucz shadow w SRH `:8079` → kolejny
  `/api/adapt` ma `archetype` zgodny z intencją wiadomości (np. „szukam mieszkania pod wynajem, jaki
  yield?” → `yield_hunter`) i `chat_intent` w odpowiedzi; nowe AC(8) w `ac1-verdict.test.ts`; README
  §5; `docs/MASTER_DESIGN.md` §P.0 warunek 1b (z WP-1.1).
- **Agent:** qa-engineer (**Opus**).
- **Weryfikacja:** AC(8) zielony 3× z rzędu; negatywna kontrola: wiadomość neutralna nie zmienia
  archetypu.
- **Zależy od:** WP-1.1, WP-1.4.

---

## C. Kolejność i równoległość

```
Tydzień 1   WP-1.1 (Fable) ──► merge  │ WP-0.1 ──► WP-0.2 ──► WP-0.5   │ WP-0.3, WP-0.4, WP-0.6a,
            WP-1.2, WP-1.4 (równolegle)│ (sekwencja na ci.yml)          │ WP-0.6b, WP-0.7 (równolegle)
Tydzień 2   WP-1.3 (po 0.1/0.2/0.5)    │ FOLLOW-819 ×3 na HEAD po Fazie 0 = punkt kontrolny K1
Tydzień 3–4 WP-2.1 ──► WP-2.2 ──► WP-2.3 ──► WP-2.5 (sekwencja na route.ts)
            równolegle: WP-2.4, WP-2.7, WP-2.12, WP-2.13, ESC dla WP-2.8/2.9
Tydzień 5   WP-2.8, WP-2.9 (po ESC) ──► WP-2.10a, WP-2.10b, WP-2.6
Tydzień 6   WP-2.11 (Fable) ──► FOLLOW-819 ×3 = punkt kontrolny K2 ──► FOLLOW-820 wg D1
```

Tygodnie są orientacyjne przy ~4–5 PR-ach tygodniowo (obecna prędkość: 60 docs + 23 kod w 30 dni,
przy czym Faza 1 obniża koszt dokumentacyjny każdego PR). Razem: 25 PR-ów, 2 ESC, 1 ADR, 2
amendments ESC/ADR, MASTER_DESIGN 4.14 → 4.15 (edycje w każdym PR, nie osobny PR).

## D. Punkty kontrolne i kryteria wyjścia programu

- **K1 (po Fazie 0 + 1):** FOLLOW-819 6/6 ×3 na HEAD; weryfikator exit 0; rollup ≤42 checków;
  `grep -rn "decision-api\|stream-consumer\|redpanda"` poza historią = 0; delta LOC wklejona
  (oczekiwane ≥ −10k src, ≥ −5k testów).
- **K2 (po Fazie 2):** FOLLOW-819 6/6 ×3 z AC(8) chat; testy parytetu WP-2.11 100%; `route.ts` <1200
  linii, `llm-gateway.ts` <900, `index.ts` <600; bundle ≤ 43 136 B; §Snapshot.1 z wierszami PARKED;
  liczba plików testowych nazwanych ticketem w `api/adapt` = 0.
- **Zakończenie:** wpis w `docs/MASTER_DESIGN.md` §Snapshot.0 „Program naprawczy audytu 09-24
  zakończony przy `<sha>`” i orzeczenie CEO FOLLOW-820 wg D1.

## E. Ryzyka i zabezpieczenia

| Ryzyko                                                                                              | Zabezpieczenie                                                                                                                                           |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db-migrate.yml` aplikuje DROP na prod bez bramki (WP-0.6b, WP-2.9)                                 | `count(*)` na prod wklejony do PR przed merge; migracja tylko dla tabel z 0 wierszy; inaczej STOP + ESC                                                  |
| Konflikty na `ci.yml`, `required-checks.txt`, `CLAUDE.md`, `README.md`                              | Sekwencja merge 0.1 → 0.2 → 0.5 → 1.3; rebase przed każdym; PM nie uruchamia dwóch pakietów na tych plikach naraz                                        |
| Usunięcie pliku z mirror-pair łamie `check-mirror-files.sh`                                         | `mirror-files.json` edytowany w tym samym PR (WP-0.1)                                                                                                    |
| Rule I liczy wzmianki w komentarzach jako importerów (WP-2.10a)                                     | Traktować odsłonięte eksporty jako znaleziska; usunąć eksport lub podpiąć; nie przywracać komentarza                                                     |
| WP-2.11 zmienia ścieżkę anty-halucynacyjną                                                          | Fable; testy parytetu na fixtures z Pythona; stary Modal app zatrzymany dopiero po zielonym FOLLOW-819 ×3; rollback = `MODAL_DESCRIPTION_URL` z powrotem |
| Gitleaks skanuje historię — usuwanie plików z fixture-tokenami nic nie psuje, ale nowe fixtures tak | Budować fixtures `.repeat()`, nie literałami; skan przed push (Rule V)                                                                                   |
| Osierocona praca w worktree przy przerwaniu sesji (WP-0.7 czyści worktree)                          | Czyścić tylko worktree ze czystym `git status`; inne najpierw odzyskać (pamięć sesji 142/147)                                                            |
| Harness używa demo JWT, a WP-2.3 chowa demo za flagą                                                | `DEMO_MODE=1` w `localhost-up.sh` (WP-1.4) i README §3; test preflight sprawdza flagę                                                                    |

## F. Czego ten plan NIE robi (świadomie)

- Nie zmienia stosu (Cloudflare/Vercel/Modal/ClickHouse/Supabase/Upstash zostają), poza WP-2.11
  redukującym liczbę aplikacji Modal z 3 do 1 przez ADR.
- Nie usuwa DSR, zgód, holdoutu, logów decyzji, quizu, tracera — §5 audytu.
- Nie buduje pętli uczenia (definicja jednej pętli = osobna decyzja produktowa po K2; audyt §3C).
- Nie rusza `observability.py` ×3 (WP-0.8 DEFER).
- Nie przenosi 641 stubów; zamraża je (D8).
