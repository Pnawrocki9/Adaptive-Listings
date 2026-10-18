# Plan: domknięcie Adaptive Listings na localhost (jeden tenant: app.estalara.com) → przekazanie CTO

**Status:** ZATWIERDZONY przez CEO 2026-10-17 (plan mode); kopia w repo od 2026-10-18 (FOLLOW-1319).
Oryginał: `~/.claude/plans/teraz-przerwa-i-czs-smooth-elephant.md`. Zastępuje plan intake'u Codex z
2026-10-11 (jego treść żyje w `docs/CODEX_REVIEW.md` §"Ocena PM"; wszystkie jego tickety są już
założone).

## Kontekst

Po przeglądzie 2026-10-16/17 CEO orzekł: (1) **nie będzie innych tenantów** — Adaptive Listings
działa wyłącznie na app.estalara.com; wszystko, co nawiązuje do wielu tenantów lub rozpoznawania
obcych stron, ma zostać usunięte; (2) ruling FOLLOW-820 GO jest **odroczony** — projekt domykamy w
całości na localhost, a wdrożenie produkcyjne to **pakiet przekazania dla CTO** (instrukcja,
dostępy, kroki operatorskie), nie kroki wykonywane przez PM; (3) kolejność najbliższych prac: **C**
(dwie pilne usterki backoffice) → **B** (tickety i kolejność) → **A** (dokument dla CTO). Plan musi
mieć **punkty kontrolne** sprawdzające poprawność na kilku etapach, żeby rozwój nie poszedł w
stronę, która na końcu nie da w pełni działającego Adaptive Listings.

Co dziś wiemy (zweryfikowane w kodzie 2026-10-17):

- Ścieżka kupującego działa na obu substratach localhost: harness FOLLOW-819 (3× `run=GREEN`
  `[FRESH]` przy `e8d1a04d`, README §5.24) i prawdziwa aplikacja Estalara
  (`~/Projects/ Estalara-gitlab-2026-08-17`, quiz → `yield_hunter` → `/api/adapt` `llm_tweaked` →
  nagłówek i opis zaadaptowane, `ADAPTIVE_LISTINGS_LOCAL.md` §Verification).
- Prawdziwa aplikacja NIE emituje podpisanych konwersji (`inquiry.completed`/`live.signup`), nie
  woła webhooka `listing.updated` i nie ma hooków slotów `cta`/`feature` na stronie ogłoszenia —
  więc na niej nie ma liftu ani bumpu rewizji. Produkcyjne app.estalara.com nie ma SDK (ESC-020,
  krok CTO).
- Backoffice: `/admin` przekierowuje na sztywno wpisany tenant produkcyjny
  (`lib/pilot-tenant.ts:17`), którego nie ma w lokalnej bazie; globalny edytor wag intencji nie
  sprawdza rangi konta (`lib/tracer-auth.ts` — tylko `estalara_staff === true`), wbrew ADR-0018
  orzeczeniu #3 (zapisy ≥ `ops`, najgroźniejsze = `superadmin`); brak `not-found.tsx`/`error.tsx`;
  brak ścieżki odzyskiwania hasła; `/admin/registrations` i sesje demo mają martwe przyciski;
  lokalne `next build` pada (dwie kopie React w lokalnym `node_modules`; Vercel buduje poprawnie).
- Wielodostępność jest zaszyta w ADR-0018 §Decision 0 (CEO 2026-07-20: odsłonięcie Tenants /
  Registrations / Demo Sessions) — ten plan ją **odwraca** (nowy ESC + aneks ADR). Wewnętrzne
  `tenant_id` zostaje jako jedna stała (zabezpieczenia RLS, zdarzenia, klucze API nie są
  przepisywane).
- Harness pomiarowy czyta `/api/admin/analytics/rollup` (`differentiator-e2e.mjs:4997`) — tej trasy
  nie wolno usunąć, tylko zawęzić do jednego tenanta.
- Ograniczenia maszyny: 4,9 GB RAM w WSL → jedna ciężka rzecz naraz; harness (fixture :5173/:8081) i
  prawdziwa aplikacja kolidują na portach → jeden substrat naraz (przełączanie:
  `.al-local/al-real-up.sh` / `al-real-down.sh --restore-fixture`, ok. 10 min).

## Decyzje CEO wpisane do planu (2026-10-16/17)

| #   | Decyzja                                                                                                                                                                                         | Skutek w planie                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-A | Jeden tenant: app.estalara.com. Usuwamy **funkcje** wielotenantowe i rozpoznawanie obcych stron; **fundament `tenant_id` zostaje** jako stała.                                                  | Faza 2 (usuwanie w kolejności od najbezpieczniejszego); `PILOT_TENANT_ID` → `ESTALARA_TENANT_ID` jako jedyna stała; stała lista origin `app.estalara.com`, `admin.estalara.com` (+ localhost poza prod). |
| D-B | Panel agencji `/dashboard` **scalony** w jeden backoffice `/admin`; role agencji znikają; zostają role pracowników Estalary.                                                                    | Faza 3.                                                                                                                                                                                                  |
| D-C | Tryb demo: zostaje **tylko symulator archetypów**; sesje demo i makieta obcej agencji — usunięte.                                                                                               | Faza 2.                                                                                                                                                                                                  |
| D-D | Rejestracje: **usunięte w całości** (strona, API, publiczny `/register`); zostaje `/api/v1/consent/platform-registration` (zgoda inwestora na app.estalara.com — to nie jest wielotenantowość). | Faza 2.                                                                                                                                                                                                  |
| D-E | Profil wracającego klienta (FOLLOW-1316) — **budujemy teraz**, z przeglądem zgód/DPIA w tym samym tickecie.                                                                                     | Faza 4.                                                                                                                                                                                                  |
| D-F | GO odroczone; produkcja = pakiet dla CTO; PM nie wykonuje kroków produkcyjnych.                                                                                                                 | Faza 7; wszystkie kroki operatorskie trafiają do dokumentu, nie do kolejki PM.                                                                                                                           |
| D-G | Kolejność: C → B → A, potem reszta.                                                                                                                                                             | Faza 1 = C; Faza 0 = B (tickety, QUEUE, ESC, aneks ADR); A = szkielet dokumentu CTO w Fazie 0, wypełniony w Fazie 7.                                                                                     |

| D-H | Kod Stripe (`lib/stripe.ts`, `api/webhooks/stripe`) — **usunąć**; kolumna `tenants.plan`
zostaje (czyta ją `api/config`, `api/tenants`, `api/audit`). Krok CTO: wyłączyć endpoint webhooka,
usunąć sekrety `STRIPE_*`. | Faza 2 (R9). | | D-I | Moratorium D8 (brak nowych stubów P2/P3 i nowych
Reguł „do GO") — **zniesione**. | Faza 0 zapisuje to w QUEUE; retro loop bez zmian. | | D-K |
**Raport liftu w backoffice (CEO 2026-10-17):** lift jest dziś mierzony i widoczny
(`/admin/tenants/[id]/analytics?tab=pilot`, okno 7/14/30 dni, trend dzienny, odznaka istotności),
ale **nie zapisywany** jako historia i bez eksportu. Decyzja: **CSV + dzienna migawka w Postgres**;
PDF/Excel (STATS-001..003 z maja) — nie. | Faza 3 M5; K3 i K5 sprawdzają raport. | | D-J |
**Definicja liftu (CEO 2026-10-17):** lift nie mierzy zakupów (zakup dzieje się poza aplikacją).
Dowodem liftu jest **podwyższone prawdopodobieństwo — wyrażone w %** — (a) zapisu na LIVE/webinar
oraz (b) nawiązania kontaktu ze sprzedającym agentem, w ramieniu adaptowanym względem holdoutu. |
Sekcja „Definicja liftu" poniżej; Faza 0.2 (aneks §E.3.4 pkt 3), Faza 5 X1 (emitery), K5/K7
(akceptacja pokazuje liczbę w %). |

## Definicja liftu wpisana do planu (ruling D-J)

**Metryka (istnieje w kodzie, `apps/control-plane/src/lib/pilot-stats.ts`):**
`relative_lift_pct = (p_adapted − p_holdout) / p_holdout × 100`, gdzie `p` = odsetek sesji z
konwersją w ramieniu; test z dla dwóch proporcji; `confidence` = `95%` (p < 0,05) / `90%` /
`insufficient`; **minimum 30 sesji na ramię** (`MIN_SAMPLE_PER_ARM`). Czytniki:
`api/dashboard/analytics/lift` (`relative_lift_pct`, `is_significant`) i
`api/admin/analytics/rollup` (`ctaLift`). Plan NIE zmienia wzoru — zmienia **zdarzenia**, które się
w nim liczą, i **źródło** ich emisji.

**Zdarzenie konwersji (po aneksie, zastępuje brzmienie §E.3.4 pkt 3 z 2026-10-14):** sesja ma
konwersję, gdy **po pierwszej decyzji** control plane odbierze podpisane (`caller_signed=1`, klucz
serwerowy z `hmac_secret`) zdarzenie:

| Zdarzenie           | Znaczenie biznesowe                                                                                                                  | Źródło w aplikacji Estalara (`core-master`)                                                               | Schemat                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `live.signup`       | zapis na LIVE / webinar (w słowniku Estalary: rejestracja na prezentację na żywo; „webinar" = ten sam mechanizm, brak osobnego typu) | rejestracja `CalendarEventType.LIVE_PRESENTATION_REGISTRATION` w `LivestreamServiceImpl`                  | istnieje (`packages/shared/src/schemas/events/live.ts`); payload zyskuje `event_kind: 'live_presentation' \| 'webinar'` na wypadek rozróżnienia w przyszłości |
| `inquiry.completed` | nawiązanie kontaktu ze sprzedającym agentem                                                                                          | `ConversationCreatedEvent` z `initiatorRole` = kupujący (pierwsza wiadomość do agenta tworzy konwersację) | istnieje (`events/inquiry.ts`); nazwa zostaje (zmiana nazwy = zmiana kontraktu publicznego bez korzyści); payload zyskuje `channel: 'conversation'`           |

Konsekwencje zapisane w Fazie 0.2 (MASTER_DESIGN 4.27, §E.3.4 pkt 3 + §D.6) i w ESC-085:

- ESC-084 (2026-10-13) odrzuciło `chat.contact_initiated` **emitowane z przeglądarki** — to nadal
  obowiązuje; kontakt z agentem liczy się wyłącznie jako zdarzenie **potwierdzone przez serwer
  Estalary** (`ConversationCreatedEvent`), czyli zgodnie z zasadą podpisanych konwersji. Brak
  konfliktu, tylko doprecyzowanie.
- Konwersja z przeglądarki (SDK) jest nadal **wykluczona** z liftu, nie odrzucana przy ingest.
- Dwa zdarzenia liczą się jako **jedna** konwersja sesji (OR; sesja z LIVE i rozmową = 1), żeby
  prawdopodobieństwo było prawdopodobieństwem; osobne odsetki per zdarzenie pokazujemy obok
  (`live_signup_rate`, `agent_contact_rate`) — rozszerzenie odpowiedzi czytnika, nie wzoru.
- Serwer fixture `:8081` (harness) emituje **oba** typy, żeby AC(5) sprawdzało obie ścieżki.
- Czego ta metryka nie dowodzi: zakupu nieruchomości (poza aplikacją) — plan nie udaje, że to
  mierzy.

Decyzje PM wpisane do planu (odwracalne, zgłoszone tu do wiadomości CEO):

- Tabela `tenant_registrations` **zostaje** (kasujemy kod i strony, plik schematu oznaczamy
  `@deprecated`): usunięcie pliku schematu wygenerowałoby `DROP TABLE` uderzający w produkcję, a
  kroków produkcyjnych nie wykonujemy — DROP trafia na listę CTO.
- `demo-integration.yml` i `tests/e2e/sprint-9-5-demo.spec.ts` — **usunąć** razem z łańcuchem
  detekcji (testują tylko detect → activate; nie są w rejestrze wymaganych bramek).
- Usunięcie eksportu typu `auto-detect` z `packages/sdk/src/index.ts:141` to zmiana publicznej
  powierzchni SDK → wpis w `ESCALATIONS.md` przed PR (formalność; nikt poza `/api/detect` tego nie
  importuje).
- Zmiany w aplikacji Estalara (repo lokalne, bez git) dostarczamy jako **zestaw patchy + README** w
  `docs/handover/estalara-app-patches/`, po wcześniejszym snapshocie `tar` katalogu — żeby CTO
  dostał recenzowalny diff, a nie zmodyfikowany katalog.

## Zasady wykonania (obowiązują w każdej fazie)

- Każdy PR dotykający `HARNESS_TREE_PATHSPEC` (`apps`, `packages`, `infra/clickhouse`, pliki root
  pakietu, harness + fixtures, `scripts/dev/*`) kończy się serią FOLLOW-819 **3× `run=GREEN`**,
  każdy przebieg z wklejonym `[FRESH]` (`--check-staleness runN.json`), zapisaną w README §5. PR
  dokumentacyjny — bez serii.
- Rule I („0 new" względem bazy `main`), Rule H, `check-follow555-session-auth.sh`; każdy PR
  usuwający bramkę CI edytuje `.github/required-checks.txt` w tym samym PR; każdy PR usuwający
  aplikację Modal edytuje REGISTRY w `scripts/check-modal-local-imports.py`; każda zmiana miejsc
  `Sentry.capture*` aktualizuje `TOTAL_SITES` (`observability-signals.test.ts:173`); bundle SDK ≤ 43
  136 B gzip; gitleaks (zero literałów 40+ znaków alfanumerycznych).
- Weryfikacja CI wyłącznie `scripts/gh-pr-checks-verified.sh <pr>` (exit 0); merge squash; agenci
  pracują w worktree, push i merge wykonuje PM.
- Model-fit (CLAUDE.md): Sonnet — rutynowe usuwanie/dokumentacja/testy; Opus — auth, bezpieczeństwo,
  zmiany międzymodułowe, harness; Fable — aneksy architektury (ADR/MASTER_DESIGN) i odzyskiwanie
  konfliktów.
- RAM: w trakcie serii pomiarowej lub przeglądu CEO **nic ciężkiego w tle** (żadnych buildów,
  vitest, prettier całego `FOLLOW_UPS.md`); `NODE_OPTIONS=--max-old-space-size=2048` max; turbo
  `--concurrency=1`.
- Reguła „verify, don't guess": każde usunięcie poprzedza grep importerów; każde „działa" ma komendę
  i wynik w PR.

## Mapa planu

```
K0 ─ Faza 0 (B+A v0) ─ Faza 1 (C) ─ K1 ─ Faza 2 (usuwanie R1…R11) ─ K2a/K2b/K2c ─ Faza 3 (merge M1…M4) ─ K3 [CEO 1]
   ─ Faza 4 (ścieżka kupującego P1…P7) ─ K4a/K4b ─ Faza 5 (aplikacja Estalara X1…X4) ─ K5 [CEO 2]
   ─ Faza 6 (bezpieczeństwo S1…S4) ─ K6 ─ Faza 7 (handover H1…H4) ─ K7 [CEO 3]
```

Szacunek: ok. 30–35 dni pracy agentów; ścieżka krytyczna C → R5 → R6 → R10 → R11 → M2 → S → H. Przy
4,9 GB RAM serie pomiarowe i przeglądy są **szeregowane**, więc realny horyzont to 6–8 tygodni
kalendarzowych. Każdy punkt kontrolny ma własną stronę w `docs/checkpoints/K<n>.md` (SHA, ścieżki
artefaktów, wyniki instrumentów) i tag `k<n>-green` na `main` — to cel rollbacku kolejnej fazy.

## Cztery kontrole powtarzane na KAŻDYM punkcie kontrolnym (na zmergowanym SHA `main`)

| #   | Kontrola                                     | Instrument                                                                                                                | Co łapie                                                 |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| I1  | Różnicujący mechanizm wciąż działa           | seria FOLLOW-819: 3× `run=GREEN` (7/7; 8/8 od K4b) przy jednym SHA, każdy `runN.json` → `[FRESH]`                         | usunięcia/merge, które po cichu psują ścieżkę kupującego |
| I2  | Powierzchnia wielotenantowa tylko maleje     | **N1** `scripts/check-single-tenant.sh --ratchet` (nowy)                                                                  | połowiczne usuwanie, powrót starych ekranów              |
| I3  | Prawdziwa aplikacja działa od końca do końca | **N3** `scripts/dev/real-app-acceptance.mjs` (nowy; od K4), wcześniej `scripts/dev/local-pilot-session.mjs` hopy 1/4/5/10 | zielone na fixture, zepsute na Estalarze                 |
| I4  | Backoffice jest używalny                     | **N2** `tests/e2e/backoffice/admin-smoke.spec.ts` + `admin-nav-reachability.test.ts` (nowe; od K1)                        | martwe linki, 500, zły tenant                            |

Kolejność na punkcie (RAM): bramki offline przy zgaszonym stosie → `localhost-up.sh` → seria + N2 →
`localhost-down.sh` → przełączenie substratu → N3. OOM / awaria sieci / `gh-pr-checks-verified` exit
2–3 = UNMEASURED (neutralne, powtórz), nigdy RED.

## Faza 0 — porządek (B + szkielet A) · 1 PR docs + 1 PR gate · ~1 dzień

| Pakiet | Zakres                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Kto / model           |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 0.1    | `backlog/ESCALATIONS.md`: **ESC-085** (RESOLVED) — ruling jednego tenanta, odwrócenie ADR-0018 §Decision 0 i rozstrzygnięcia #2; zniesienie D8; zgoda na usunięcie Stripe. Aneks do `docs/adr/ADR-0018-superadmin-tenant-access.md` (sekcja „Superseded 2026-10-17").                                                                                                                                                                                           | PM (Sonnet)           |
| 0.2    | `docs/MASTER_DESIGN.md` → 4.27: §A.2 (model jednego tenanta), §B.4/B.5/B.6 → REMOVED (były PARKED), §J.4/§K.3 → jeden backoffice, §P.0 nota „GO odroczone; definicja ukończenia = K7"; **§E.3.4 pkt 3 + §D.6 → definicja liftu D-J** (dwa zdarzenia serwerowe, OR, względny %, 30/ramię); §Snapshot.1 wiersze K/U poprawione (strony admin czytają prawdziwe dane, nie atrapy).                                                                                 | architect (**Fable**) |
| 0.3    | `backlog/QUEUE.md` + `FOLLOW_UPS.md`: tickety dla każdego pakietu C/R/M/P/X/S/H (od FOLLOW-1319), FOLLOW-1311 i 1307–1310 przepisane z „post-GO" na P1 w zakresie; kolejność = ten plan; `CLAUDE.md` — poprawka ról agentów (platform-templates, schema-validation, Magic Link) i zdania „any real estate website".                                                                                                                                             | PM (Sonnet)           |
| 0.4    | `docs/handover/CTO_HANDOVER.md` v0 — szkielet: mapa systemu, inwarianty jednego tenanta, sekrety po nazwach, **lista kroków produkcyjnych należnych** (ESC-020 osadzenie SDK, CH 0022/0023/0024 + flagi, `modal app stop estalara-schema-validation`, Stripe off, DROP `tenant_registrations`, Supabase redirect URL dla resetu hasła, runbook wydawania klucza API), zapis cutoveru 2026-10-13 i rollback. Żywy dokument: każdy późniejszy PR dopisuje wiersz. | architect (**Fable**) |
| 0.5    | **N1 v0** `scripts/check-single-tenant.sh --report` + `scripts/baselines/single-tenant.baseline` (liczniki startowe) + wpięcie do `ci.yml` jako „Single-tenant surface" i do `.github/required-checks.txt`; kontrola negatywna (fixture z `agency_role` musi oblać).                                                                                                                                                                                            | devops (Sonnet)       |

**K0 (bazowy, przed jakimkolwiek kodem):** `pnpm e2e:smoke`;
`pnpm --filter=@estalara/sdk build:check` (zapisać bajty, ≤ 43 136);
`check-ticket-status-vocabulary.mjs`; zapis liczby linii `required-checks.txt` i liczby
`page.test.tsx` (19/37); N1 `--report` zapisany jako baseline; **jedna seria 3× GREEN `[FRESH]` na
`main`** (README §5.25); jeden przebieg na prawdziwej aplikacji (`local-pilot-session.mjs` +
udokumentowany spacer quizem → `yield_hunter`, `llm_tweaked`). STOP: czerwony baseline = naprawa
substratu, zero prac Fazy 1.

## Faza 1 — „C": dwie pilne usterki · 2 PR · ~1 dzień

| PR                                                                                  | Zakres                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Wzorzec                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Kto / model        |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| C1 `fix(control-plane): rank-gate global intent config and generation-model writes` | `lib/tracer-auth.ts`; `api/admin/intent/config/route.ts` (GET/POST) i `…/[id]/route.ts` (PUT) — **to one są bez rangi**, nie `intent-weights` (ta już ma `canWrite`); `api/admin/generation-model` PUT; `admin/tracer/weights/page.tsx` (tryb tylko-odczyt dla `readonly`).                                                                                                                                                                                                                                                                                                              | `verifyTracerAdminAuth` zwraca `{kind:'staff', role, canWrite, isSuperadmin} \| {kind:'secret'}` na bazie `STAFF_ROLE_RANK`/`canWrite`/`isSuperadmin` z `lib/session-auth.ts:226-236,456-457` (żadnej czwartej kopii tabeli rang — trzecia już jest w `middleware.ts:276`). Zapisy ≥ `ops`; generation-model = `superadmin` (ADR-0018 #3). Bearer `ADMIN_API_SECRET`: 403 na zapis, GET bez zmian (harness czyta rollup tym tokenem). Każdy zapis → `staff_audit_log`. Testy: readonly 403, secret 403, ops 200, ops→generation-model 403, wiersz audytu. | backend (**Opus**) |
| C2 `fix(control-plane): admin landing resolves the Estalara tenant`                 | `lib/pilot-tenant.ts` → `lib/estalara-tenant.ts` (`ESTALARA_TENANT_ID`, env `NEXT_PUBLIC_ESTALARA_TENANT_ID`, jedno wydanie fallbacku na `NEXT_PUBLIC_PILOT_TENANT_ID`); `app/admin/page.tsx` (`permanentRedirect` 308 → `redirect` 307 — 308 jest cache'owany przez przeglądarkę i to on „przypinał" stary id); `app/admin/layout.tsx:15,27-30`; `tenants/[id]/tracer/page.tsx:317` (Live Monitor wysyła `tenant_id`); `scripts/dev/localhost-up.sh` eksportuje env = `$OPS_TENANT_ID`. Brak tenanta w bazie → jawna strona „tenant not configured" z nazwą zmiennej, nie pusty tracer. | backend (Sonnet)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

**K1:** vitest control-plane (`middleware.test.ts` 33 + nowe przypadki rangi;
`session-auth.test.ts`; `estalara-tenant` — override działa tylko gdy `NODE_ENV !== 'production'`);
`check-follow555-session-auth.sh`; `check-staff-write-atomicity.sh`; **N2 v0** (logowanie, `/admin`
ląduje na tenancie Estalara, sidebar przypięty, Live Monitor niesie `tenant_id`, nieznany URL →
`not-found` [po M3], `readonly` nie zapisze wag globalnych); jedna seria (C2 dotyka
`localhost-up.sh` z pathspec). STOP: `/admin` rozwiązuje się na inny id lub override działa w
buildzie produkcyjnym → nie zaczynać Fazy 2.

## Faza 2 — jeden tenant: usuwanie (od najbezpieczniejszego) · 11 PR · ~10 dni

Każdy PR: kasuje kod + testy + wiersze rejestrów CI/REGISTRY w tym samym PR;
`pnpm turbo typecheck lint test --concurrency=1`; grep zerowych importerów w opisie PR; Rule I „0
new".

| PR  | Zakres                                                                                                                                                                                                                                                                                                                                              | Uwagi / rejestry                                                                                                                                                                                                                                                                                                                            | Kto / model                 | Dni |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | --- |
| R1  | `app/api/internal/schema`; `packages/platform-templates` (workspace, turbo/tsconfig, lockfile)                                                                                                                                                                                                                                                      | zero importerów; wiersz ml-engineer w CLAUDE.md                                                                                                                                                                                                                                                                                             | backend (Sonnet)            | 0,5 |
| R2  | `apps/data-quality` (PARKED → usunięte)                                                                                                                                                                                                                                                                                                             | `ci.yml:192` matrix; `required-checks.txt:112`; REGISTRY `check-modal-local-imports.py`; `check-modal-secret-keys.py:15`; `check-cron-heartbeat.sh:5`; `cron-heartbeat.yml`; `modal-deploy.yml`; krok CTO `modal app stop` → handover                                                                                                       | devops (Sonnet)             | 0,5 |
| R3  | Rejestracje: `admin/registrations/*`, `app/register`, `api/registrations`, link w sidebarze, `/register` z `PUBLIC_PREFIXES`                                                                                                                                                                                                                        | tabela i plik schematu zostają (`@deprecated`); **zostaje** `/api/v1/consent/platform-registration`                                                                                                                                                                                                                                         | backend (Sonnet)            | 0,5 |
| R4  | Sesje demo + makieta: `admin/demo-sessions`, `api/demo/sessions*`, `dashboard/demo/mockup*`, `lib/mockup-listings`                                                                                                                                                                                                                                  | **zostają** `api/demo/override` i `admin/tenants/[id]/demo`; grep: `verifyDemoJwt` nie może być zależne od sesji demo (harness probe)                                                                                                                                                                                                       | backend (Sonnet)            | 0,5 |
| R5  | **warunek R6:** `apps/control-plane/scripts/issue-tenant-api-key.mts` + `docs/runbooks/API_KEY_ISSUANCE.md`                                                                                                                                                                                                                                         | wzorzec hashowania z `seed-local-tenant.mts` (ten sam SHA-256 co produkcja); rotacja/odwołanie; musi też przełączać tenant `pending→active` i wołać `seedListingEmbeddingsForActivation` (`seed-listing-embeddings.ts:367`) — dziś robi to `schema/activate`; gitleaks: klucz nigdy w logu                                                  | backend (**Opus**)          | 1   |
| R6  | Łańcuch detekcji: `components/onboarding/*`, `dashboard/onboarding/detect`, `dashboard/detection` + link, `api/detect`, `api/schema/activate`, `shared/schemas/detect.ts`, `packages/sdk/src/auto-detect/**`, eksport typu `sdk/src/index.ts:141`, alias w `apps/control-plane/vitest.config.ts`, `demo-integration.yml`, `sprint-9-5-demo.spec.ts` | `ci.yml` ~496 + `required-checks.txt:87`; **zostają** `lib/ssrf.ts` (używa `listing-details`), `tenant_site_schemas`, `lib/tenant-schema.ts`; `inquiry_submit_selector` czytany z kuratorowanego wiersza schematu i seedowany w `seed-local-tenant`; ESC przed PR (publiczna powierzchnia SDK); bundle musi zmaleć lub zostać; **seria 3×** | sdk + backend (**Opus**)    | 1,5 |
| R7  | Lista floty: najpierw osobny commit przenoszący `getTenantById` do `admin/tenants/[id]/data.ts`, potem kasacja `tenants/page.tsx`, `getTenantsList`, `api/admin/diagnostics/first-party-tenant`                                                                                                                                                     | Sentry `TOTAL_SITES` (`observability-signals.test.ts:173` wymienia diagnostics); `docs/runbooks/BRAND_PROVISIONING.md` → superseded                                                                                                                                                                                                         | backend (Sonnet)            | 0,5 |
| R8  | Analityka cross-brand: kasacja **tylko strony** `admin/analytics`; trasa `api/admin/analytics/rollup` **zostaje** (harness :4997 woła ją Bearerem bez `tenant_id`)                                                                                                                                                                                  | brak `tenant_id` ⇒ `ESTALARA_TENANT_ID`; panele `reorder_withheld` (FOLLOW-1220) i scoring-path przenieść do `admin/tenants/[id]/analytics`; zostaje `rollup-lift-parity.test.ts`; **nowy test kontraktu** pinujący klucze odpowiedzi czytane przez AC(5) (`data_source`, `rollup.ctaLift`, `conversion_source`) — PRZED zmianą; seria      | backend (**Opus**)          | 1   |
| R9  | Stripe: `lib/stripe.ts`, `api/webhooks/stripe`, testy, wpisy env; `tenants.plan` zostaje, przypięte w seedzie                                                                                                                                                                                                                                       | krok CTO do handoveru                                                                                                                                                                                                                                                                                                                       | backend (Sonnet)            | 0,5 |
| R10 | `lib/brand-identity.ts` (563 linie) → stałe w `lib/estalara-tenant.ts`; importerzy: `origin-policy`, `api-key-auth`, `quiz/completion`, `api/config`, `dsr/initiate`, `consent/platform-registration`, `tenant-config-editor`                                                                                                                       | zachowanie bez zmian, ta sama wartość `tenant_id`; compliance-engineer: potwierdzenie braku zmiany zakresu danych w DSR/consent                                                                                                                                                                                                             | backend (**Opus**)          | 1,5 |
| R11 | `allowed_origins` (tri-state) → stała lista: `lib/origin-policy.ts`, `lib/api-key-auth.ts`, `apps/ingest/src/{origin-gate,auth,router}.ts`, `scripts/project-allowed-origins.mts`, preflight w middleware (FOLLOW-941: koniec odbijania dowolnego Origin)                                                                                           | PROD = `app.estalara.com`, `admin.estalara.com`; DEV = dotychczasowa lista DEV **z originem fixture :5173**; `control-plane-probe.test.ts` i `harness-preflight.test.ts` w tym samym PR; kolumna DB zostaje (nieczytana); **seria 3×** (ingest w pathspec)                                                                                  | backend + devops (**Opus**) | 2   |

Zależności: R5 → R6; commit-split R7 → kasacja R7; R7 i C2 → R8; R10 → R11; R3, R4, R6 → M2.

**K2a (po R1–R4, R7):** N1 `--ratchet` (każda usunięta ścieżka = 0, suma < K0); vitest
control-plane, db, shared po jednym pakiecie; `check-mirror-files.sh`;
`check-deployment-surfaces.mjs`; test jednostkowy splitu `getTenantById`; jedna seria. STOP: N1 nie
maleje = PR nie usunął tego, co deklaruje; `// @ts-expect-error` lub stub, żeby się skompilowało =
usuwanie nie było od liścia → revert, przeplanować kolejność.

**K2b (po R5, R6, R2):** bramka wstępna: dowód integracyjny R5 (operator wydaje klucz → SDK wysyła →
ingest 2xx; `apps/ingest test:integration:clickhouse` zielony) **przed** kasacją `schema/activate`;
N1; REGISTRY i wiersze `ci.yml`/`required-checks.txt:87,112` usunięte w tym samym PR;
`gh-pr-checks-verified.sh` exit 0 (zarejestrowana nazwa bez joba = exit 2 — sam pass dowodzi
zgodności rejestru z workflowami); `check-gate-exit-codes.sh`; vitest SDK + `build:check` (zapisać
nowy rozmiar); seria + `pnpm --filter @estalara/sdk test:e2e` przy zgaszonym stosie. STOP: ingest
odrzuca klucz z R5 lub seria RED na AC(1)/(2)/(3) → revert do `k2a-green`, najpierw sprawdzić init
SDK (`auto-detect` mógł być nośny).

**K2c (po R8–R11):** N1 `--final` = 0 trafień dla DB-owych odczytów `allowed_origins` i
`brand-identity`; testy `packages/auth`, `middleware.test.ts`; ingest vitest z originami
(`app.estalara.com`/`admin.estalara.com` → OK; localhost → OK tylko poza produkcją; inne → 403);
rodzina consent-sync; seria; **N3-lite** na prawdziwej aplikacji (stała lista musi przyjąć origin
`:5173`). STOP: AC(5) `conversion_source ≠ signed_events` → kolaps analityki złamał czytnik liftu,
revert do `k2b-green`; hop 4 (ACK ingest) na prawdziwej aplikacji pada → lista origin błędna.
Najbardziej ryzykowny punkt — PM czyta wynik N1 ręcznie.

## Faza 3 — jeden backoffice `/admin` · 3 PR + 1 operacja · ~6 dni

| PR                                                                                | Zakres                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Kto / model                                      | Dni |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --- |
| M1 `feat(control-plane): port unique dashboard surfaces to /admin/tenants/[id]`   | przenieść: `quiz/analytics`, `listings/[id]/answers` (FAQ RAG), zakładka pilot, panel kalibracji etykiet (`labels-editor.tsx:9` „not ported to staff"); `api/dashboard/analytics/{summary,lift}` → `resolveTenantAccess` ścieżką staff; eksporty `lift/route-helpers.ts` zostają (rollup je importuje)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | backend (Sonnet UI, **Opus** przegląd auth)      | 2   |
| M2 `refactor(auth): remove agency roles and /dashboard`                           | kasacja `app/dashboard/**` + przekierowania `/dashboard/*` → `/admin/...` w middleware na jedno wydanie; `AGENCY_ROLE_RANK`, `requireAgencyRole`, `x-agency-role` z `middleware.ts`; roszczenia agencji z `packages/auth/src/jwt.ts:23-62`; gałęzie agencji w `session-auth.ts`, `demo/override:195`, `config/route.ts:282`, `admin/labels/[id]:138-156` (w `api/config` **tylko** gałąź agencji — ścieżka klucza API obsługuje SDK); ~30 testów; seria (middleware importowany przez probe harnessu)                                                                                                                                                                                                                                                                                                                                                            | backend (**Opus**)                               | 2   |
| M3 `fix(control-plane): backoffice defects`                                       | `app/not-found.tsx`, `app/error.tsx`; odzyskiwanie hasła: `app/auth/callback/route.ts` (wymiana kodu), strona `/reset-password`, link „forgot password", naprawa `SignInForm.tsx:34` (klient Supabase tylko w handlerze submit); porządek sidebaru; Supabase redirect-URL → handover                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | backend (Sonnet; **Opus** przegląd callbacku)    | 1,5 |
| M4 (operacyjnie)                                                                  | naprawa lokalnego `next build`: pełne usunięcie `node_modules` + czysty `pnpm install`; przy nawrocie dwóch kopii React — `pnpm.overrides` małym PR; zapis jako warunek wstępny handoveru                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | devops (Sonnet)                                  | 0,5 |
| M5 `feat(control-plane): lift report — D-J breakdown, daily snapshot, CSV export` | (a) widok pilot (`components/analytics/pilot-view.tsx`) i czytnik `api/dashboard/analytics/lift`: okno 7/14/30/**90** dni, rozbicie `live_signup_rate` / `agent_contact_rate` obok łącznej konwersji, liczebności ramion i odznaka istotności bez zmian; (b) **migawka dzienna**: tabela PG `lift_daily_snapshots` (tenant, dzień, ramię, sesje, konwersje per zdarzenie, `relative_lift_pct`, `p_value`, `confidence`) pisana przez trasę cron `api/cron/lift-snapshot` (Vercel Cron istnieje; `CRON_SECRET`) — historia niezależna od okna i retencji zdarzeń (13 mies. TTL w CH); migracja PG z RLS jak sąsiednie tabele; (c) **eksport CSV** tabeli trendu i rozbicia z panelu (`api/dashboard/analytics/lift/export`); staff-only; test trasy + `page.test.tsx`; **nie** zmienia wzoru (`lib/pilot-stats.ts`) ani kontraktu rollupu czytanego przez harness | backend (Sonnet; **Opus** przegląd migracji/RLS) | 1,5 |

**K3 — [CEO 1]:** `page.test.tsx` dla **każdej** zachowanej strony `/admin` (dziś 19/37); N1 pada na
każdym `app/dashboard/**/page.tsx` poza przekierowaniem; `admin-nav-reachability.test.ts` w CI
(każda zachowana funkcja ≤ 2 kliknięcia od `/admin`, każda strona z inwentarza w nawigacji lub
jawnie ukryta, każde przekierowanie `/dashboard/*` ma cel); **N2 pełne** (żadna strona nie renderuje
`error.tsx`, jedna rola staff otwiera wszystko); test trasy cron migawki (jeden dzień → jeden wiersz
per ramię, idempotentny) i eksportu CSV (nagłówki = kolumny panelu); seria. **Moment CEO:**
logowanie na :3000 → `/admin` → kliknięcie do czterech zachowanych funkcji **i do raportu liftu**
(okno 90 dni, rozbicie LIVE / kontakt z agentem, przycisk CSV); widzi dane Estalary, brak wyboru
tenanta, brak słowa „agency", brak 404/500 (skrypt kliknięć na jedną stronę). STOP: CEO odrzuca
nawigację → poprawki w Fazie 3 przed Fazą 4.

## Faza 4 — ścieżka kupującego (P1) · 7 PR · ~7 dni (każdy dotyka pathspec → seria 3×)

Kolejność: **P1 FOLLOW-1246** (nieświeży `dist` ukrywa poprawki — najpierw, żeby serie były
wiarygodne; Sonnet) → **P2 FOLLOW-1317** (`lib/listing-details.ts:173-179` przyjmuje
`priceUsd`/`priceEur`, toleruje brak ulicy, waluta w faktach; wyrównanie
`scripts/dev/fixture-listing-details-server.mjs` do prawdziwego DTO z `core-master`; **Opus**) →
**P3 FOLLOW-1318** (koniec tekstu playbooka w `description` przy `template_fallback`; Sonnet) → **P4
FOLLOW-1233** (ścieżka cosine seed w bring-upie; Sonnet) → **P5 FOLLOW-1168** (nieruchomy bandit;
Opus) → **P6 FOLLOW-1311** (typowany kontrakt twierdzeń; **Opus**) → **P7 FOLLOW-1316** (xid za
zgodą → serwer; profil archetypu trzymany server-side i przywracany w nowej sesji; **bramka merge:
podpisany przegląd compliance-engineer** (zgody, DPIA/ROPA, retencja, DSR, opt-out) zapisany w ESC;
**Opus**).

**K4a (po P1–P6):** offline: `description-parity.test.ts` (98 przypadków, 100 %),
`grounding-check.follow1314.test.ts`, `claim-containment.test.ts`, `description-generator.test.ts`,
`llm-gateway.follow1305.test.ts`, nowe piny obu kształtów ceny/ulicy; **nowe AC(1b) „wierność
gruntowania"** (pod-kontrola AC(1)): opis bez markerów playbooka; każda cena/ulica w opisie równa
źródłu `:8081`; każde typowane twierdzenie ma ugruntowane pole; klasa „single-storey" odrzucona; pin
`ac1b-verdict.test.ts` w `pnpm e2e:smoke`; seria. STOP: parytet < 100 % lub AC(1b) RED dwa razy →
generator dryfuje, revert do `k3-green`.

**K4b (po P7):** **nowe AC(9) „wracający klient"**: sesja 1 — zgoda + quiz; sesja 2 — świeży
kontekst przeglądarki z tym samym xid i zerem zdarzeń behawioralnych → pierwszy `/api/adapt` już
`llm_tweaked` z tym samym archetypem; **kontrola negatywna**: xid bez zgody lub odwołany przez DSR →
brak adaptacji; pin `ac9-verdict.test.ts`; TALLY `total=8` (każdy starszy artefakt staje się STALE,
bo zmienił się plik harnessu); seria 8/8; **N3** (pierwsze użycie) na prawdziwej aplikacji. STOP:
kontrola negatywna GREEN (profil przywrócony bez zgody) = wada prywatności → nie mergować.

## Faza 5 — aplikacja Estalara (repo lokalne, bez git) · 4 pakiety · ~4 dni

Wstęp: snapshot `tar` katalogu `~/Projects/Estalara-gitlab-2026-08-17`; zmiany jako patche + README
w `docs/handover/estalara-app-patches/`.

| Pakiet | Zakres                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Kto / model        |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| X1     | `core-master`: emisja podpisanych zdarzeń do `/v1/events` kluczem serwerowym z `hmac_secret` (kontrakt §V.3.2), dokładnie w dwóch miejscach z definicji D-J: (a) `live.signup` przy rejestracji na prezentację na żywo (`LivestreamServiceImpl`, typ `LIVE_PRESENTATION_REGISTRATION`), (b) `inquiry.completed` przy `ConversationCreatedEvent` z `initiatorRole` = kupujący; oba niosą `session_id`/`xid` kupującego z SDK (do ustalenia nośnik: ciasteczko sesji SDK czytane przez backend lub nagłówek z frontu — X1 wybiera i dokumentuje); test jednostkowy sygnatury HMAC z tym samym wektorem co weryfikator w control plane; w repo AL: serwer fixture `:8081` emituje oba typy | backend (**Opus**) |
| X2     | `core-master`: wywołanie `/api/webhooks/listing-updated` przy zapisie ogłoszenia (bump rewizji)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | backend (Opus)     |
| X3     | `web-master`: hooki slotów `cta` i `feature` obok `headline`/`description` na stronie ogłoszenia                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | sdk (Sonnet)       |
| X4     | `web-master`: `data-debug` z env, nie na sztywno `true`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | sdk (Sonnet)       |

Zmiana kontraktu zdarzeń = wpis w ESC przed X1.

**K5 — [CEO 2]:** repo Estalara: test sygnatury; `grep -r 'data-debug="true"'` = 0; repo AL: testy
ingest `/v1/events` dla obu zdarzeń z HMAC; **N3 pełne 3× pod rząd** na jednym nierestartowanym
control plane (ta sama dyscyplina co seria; seria harnessu tylko jeśli zmienił się kod AL). **Moment
CEO** na prawdziwym ogłoszeniu :5173: zgoda → quiz (Investment → Rental income → Steady yield) →
zmiana nagłówka i opisu → **(1) zapis na prezentację LIVE** i **(2) napisanie do agenta** → `/admin`
analityka: jego sesja policzona jako **jedna** konwersja „signed", z rozbiciem `live_signup_rate` /
`agent_contact_rate`. Potem **N3 w trybie batch** (`--arms 40`): 40 sesji adaptowanych + 40 holdout
przeprowadzonych skryptem na prawdziwej aplikacji → czytnik liftu pokazuje `relative_lift_pct` jako
liczbę w % z klasą `confidence` (nie `insufficient`, bo ≥ 30 na ramię). Brief mówi wprost: wartość i
znak na localhost **nie są** dowodem efektu produktu (sesje syntetyczne) — dowodem jest, że pipeline
liczy **właściwe zdarzenia właściwym wzorem**. STOP: N3 `conversion_source ≠ signed_events`, lift
null przy ≥ 30/ramię, niepodpisana konwersja policzona, albo zdarzenie LIVE/rozmowa nie trafia do CH
→ stop; rollback `al-real-down.sh --restore-fixture` + przywrócenie snapshotu.

## Faza 6 — bezpieczeństwo (oś B) · 4 PR · ~3 dni

Po R11 i M2 (oba zmieniają powierzchnię auth/origin, której te tickety dotyczą) — każdy ticket
najpierw **przeskalowany** do kodu jednotenantowego. S1 FOLLOW-1307 (exp/nbf/alg, issuer/audience;
pełna matryca metody×rola generowana z inwentarza tras N2, żeby nowa trasa nie prześlizgnęła się bez
wpisu), S2 FOLLOW-1308 (łańcuch DSR: usunięcie sięga PG i CH; po nim AC(9) raportuje brak
adaptacji), S3 FOLLOW-1309 (SSRF: private-IP, redirect-to-private, DNS-rebind), S4 FOLLOW-1310
(ingest ograniczony i odtwarzalny: paczka ponadwymiarowa, backpressure, restart-and-resume).
backend/devops (**Opus**), przegląd `/security-review`.

**K6:** testy wymienione wyżej; `check-rule-i.sh`; seria 8/8; N2 i N3 (auth sięga obu). STOP:
dowolna komórka matrycy odbiega od oczekiwanego statusu lub N2 traci dostęp do strony → revert do
`k5-green`.

## Faza 7 — akceptacja i handover · ~2 dni

H1 pełny dowód localhost na finalnym SHA (seria 3× 8/8 `[FRESH]`; N3 3×; N2; `next build` po czystej
instalacji przy zgaszonym stosie, exit 0); H2 `CTO_HANDOVER.md` v1 (zamrożony): kroki produkcyjne
(Faza 0.4 + wszystko dopisane po drodze), zestaw patchy Estalary, rejestr otwartych ryzyk, kanarki
produkcyjne (LLM-source, Intent Weights, Redis shadow, Cron Heartbeat) jako kontrole **po**
wdrożeniu przez CTO, rollback z zapisem cutoveru 2026-10-13; H3 PM zamyka/odkłada tickety zastąpione
planem; H4 akceptacja CEO. architect (**Fable**) H2; qa (Opus) H1.

**K7 — [CEO 3]:** `check-served-bundles.sh`, `check-no-staging-plane.sh`,
`check-measured-premises.mjs`, `check-migration-journal.sh`, `gh-pr-checks-verified.sh` na finalnym
PR, `vitest --coverage` w control plane (zapis, nieblokujące — progi nie są egzekwowane w CI);
kontrola PM handoveru: każdy sekret po nazwie zgodny z plikami env, migracje 0022/0023/0024 z
flagami, Modal stops, Vercel/Doppler, ESC-020. **Moment CEO:** pełny spacer K5 + skrypt K3 na
finalnym SHA + lektura jednostronicowego „co jest udowodnione / co nie". STOP: build po czystej
instalacji pada = nie ma handoveru.

## Nowe instrumenty (tanie, wysoka dźwignia)

- **N1 `scripts/check-single-tenant.sh`** + `scripts/baselines/single-tenant.baseline` +
  `single-tenant-routes.allowlist`. Pada, gdy istnieje którakolwiek z usuwanych ścieżek
  (`app/register`, `api/registrations`, `api/detect`, `api/internal/schema`, `api/schema/activate`,
  diagnostics, `packages/platform-templates`, `packages/sdk/src/auto-detect`,
  `shared/schemas/detect.ts`, `apps/data-quality`, sesje demo/makieta, od K3 `app/dashboard/**` poza
  redirectami) lub gdy poza testami występują `agency_role`/`AgencyRole`, odczyty DB
  `allowed_origins`, `getTenantsList`, `brand-identity`. Inwentarz tras: każdy
  `app/**/{page,route}.tsx?` porównany z allowlistą (nowa trasa wymaga jawnej edycji). Tryby
  `--report` (K0) / `--ratchet` (K2a) / `--final` (K2c). Kody wyjścia wg `check-gate-exit-codes.sh`.
  W `ci.yml` + `required-checks.txt` (nie w cotygodniowej higienie, która nie blokuje merge).
- **N2 backoffice smoke** — tani test CI `admin/__tests__/admin-nav-reachability.test.ts` (BFS po
  manifeście nawigacji) + przeglądarkowy `tests/e2e/backoffice/admin-smoke.spec.ts` z
  `playwright.config.ts` (binarkę `@playwright/test` reużyć z `packages/sdk` lub dodać do
  `tests/e2e/package.json`; potrzebuje tylko PG + control plane, ~1,5 GB, ~3 min): logowanie jako
  seedowany staff, przypięty tenant, klik do każdej funkcji, 500/`error.tsx` = fail, kontrola rangi,
  nieznana trasa → `not-found`.
- **N3 `scripts/dev/real-app-acceptance.mjs`** — rozszerzenie `local-pilot-session.mjs` (zasada „bez
  degradacji do skipped" zostaje), zastępuje ręczny spacer quizem: zgoda → ~30 s → quiz (Investment
  → Rental income → Steady yield) → `yield_hunter` z pewnością ≥ próg z `route.ts` → `/api/adapt`
  200 `llm_tweaked`, DOM nagłówka i opisu zmieniony, `/api/adapt/description` `ai_cached`, brak
  `data-debug="true"`; od K4: zapytanie → poll CH `inquiry.completed` podpisany przez host →
  `/api/admin/analytics/rollup` `conversion_source='signed_events'`, `data_source='clickhouse'`,
  `ctaLift` nie-null; od K4b: nowy kontekst z tym samym xid → pierwszy `/api/adapt` już
  zaadaptowany; od K5: dwie ścieżki konwersji (rejestracja LIVE, rozmowa z agentem) i **tryb
  `--arms N`** (N sesji na ramię, holdout wymuszony przez `holdout_pct` callera ops jak w harnessie)
  → asercja `relative_lift_pct` liczbowe i `confidence ≠ 'insufficient'` przy N ≥ 30. Zapisuje
  `SESSION_JSON` z SHA obu repo.
- **Harness:** AC(1b) i AC(9) z pinami w `pnpm e2e:smoke` (zmiana harnessu = wszystkie wcześniejsze
  artefakty STALE — planowo).

## Reguły STOP wspólne

- RED na AC, które było GREEN na poprzednim punkcie, dwa razy pod rząd przy jednym SHA → stop fazy,
  bisekcja PR-ów fazy, `git revert` winowajcy, przeplanowanie; trzecia próba bez diagnozy —
  niedozwolona (RED resetuje serię).
- Flake AC(5) (znany, 2/10): jeden RED z `last-run.json` pokazującym timeout kliknięcia CTA →
  powtórz i zapisz jako flake; dwa w jednej serii → traktować jako realne; > 3 w fazie → ticket na
  flake przed następnym punktem.
- Naruszenia zapadek nigdy nie są uchylane na punkcie: N1 rośnie, bundle > 43 136 B, Rule I > 0 new.
- Cel rollbacku: zawsze ostatni tag `k<n>-green`; dla repo Estalary — snapshot +
  `al-real-down.sh --restore-fixture`.

## Czego ten plan NIE dowodzi (do powiedzenia CEO wprost)

Żaden punkt nie dowodzi **dodatniego** liftu ani jego **wielkości**: na fixture `ctaLift` jest
niedodatni z konstrukcji (syntetyczne ramiona, ~10 % holdout), sesje N3 w trybie batch są
skryptowane, `:8081`/`:8078` to zastępniki, produkcyjny lift jest `disabled`, nie ma produkcyjnego
wiersza `source='description'`. K5 i K7 dowodzą **poprawnego, podpisanego pipeline'u liftu wg
definicji D-J**: właściwe dwa zdarzenia (zapis na LIVE/webinar, kontakt z agentem), policzone jako
prawdopodobieństwo per ramię, wyrażone jako względny % z klasą istotności. Rzeczywista wartość „o
ile %" pojawi się dopiero na produkcji, po ≥ 30 realnych sesjach na ramię — to zadanie CTO po
wdrożeniu, a czytnik `api/dashboard/analytics/lift` jest już na to gotowy.

## Pliki krytyczne

- `apps/control-plane/src/lib/tracer-auth.ts`, `lib/session-auth.ts:226-236,456-457`,
  `middleware.ts`
- `apps/control-plane/src/lib/pilot-tenant.ts` → `lib/estalara-tenant.ts`;
  `app/admin/{page,layout}.tsx`
- `apps/control-plane/src/app/api/admin/analytics/rollup/{route,data}.ts` (kontrakt harnessu)
- `apps/control-plane/src/app/api/schema/activate/route.ts` + `scripts/seed-local-tenant.mts`
  (wzorzec R5)
- `apps/control-plane/src/lib/{brand-identity,origin-policy,api-key-auth,listing-details}.ts`
- `apps/ingest/src/{origin-gate,auth,router}.ts`
- `packages/auth/src/jwt.ts`, `packages/sdk/src/index.ts:141`,
  `packages/sdk/src/core/consent-flow.ts`
- `tests/e2e/follow-819/differentiator-e2e.mjs` (:2855 pathspec, :4147-4176 preflighty, :4997
  rollup)
- `scripts/dev/{localhost-up.sh,local-pilot-session.mjs,fixture-listing-details-server.mjs}`
- `.github/{workflows/ci.yml,required-checks.txt}`, `scripts/check-modal-local-imports.py`
- `docs/MASTER_DESIGN.md` (§A.2, §B.4–B.6, §J.4, §K.3, §P.0, §Snapshot.0/1), `docs/adr/ADR-0018-…md`
- `~/Projects/Estalara-gitlab-2026-08-17/{core-master,web-master}` (patche),
  `ADAPTIVE_LISTINGS_LOCAL.md`
