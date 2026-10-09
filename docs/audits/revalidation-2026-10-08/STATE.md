# Checkpoint końcowy — 2026-10-08

## Aktualizacja — 2026-10-09

PR #969 scalony jako `af926447`; checkout aktualizacji:
`pm-orchestrator/FOLLOW-1257-codex-gap-check`, baza af926447. Drzewa af926447 i 8730d377 są
identyczne; apps/packages także względem b54f472c i 334082c1. Dodano GAP_ANALYSIS_2026-10-09,
wiersze G-01–G-12 w EVIDENCE, REVIEW §7, mapowanie w CLAUDE_ADDENDUM, indeks i kandydatów w
QUEUE/STATUS. Wszystkie G to S; nowych reprodukcji produktu nie wykonano. Oryginalny raport
zachowuje SHA-256. Nie przydzielono FOLLOW, nie wdrożono napraw i nie wznowiono PARKED.

Kwalifikacja usuwa nadmierne twierdzenia o czystych 68 trasach, działającym cronie i dowolnych
wymiarach zmieniających posterior. Uwzględnia istniejący writer całego schema JSONB (F-27), zależny
od konfiguracji fallback Stripe oraz przyjęte fail-open kosztów. Następny wykonawca czyta
GAP_ANALYSIS wraz z F/R i reprodukuje kandydatów przed promocją do napraw. Wskazany tam WP21 jest
propozycją, nie zaakceptowaną zmianą programu. Poniżej historyczny checkpoint z 2026-10-08.

**Zadanie:** niezależna kontrola raportu i rekomendacji dla Claude; przegląd zakończony w jawnym
zakresie REPO_MAP. Dokończono także późniejszą prośbę o zapis wszystkich dostępnych wyników Codex
Review w repo i zapewnienie łatwego dostępu dla Claude Code. Nie rozpoczęto implementacji planu.

**Checkout:** `main/b54f472c11fd16962024ea3633343c7246280b3e`; baza raportu `334082c1`. Diff
apps/packages pusty. Początkowe drzewo przeglądu czyste. Wyniki w
`docs/audits/revalidation-2026-10-08/`; przy archiwizacji dodano `docs/CODEX_REVIEW.md`, odnośniki w
CLAUDE.md i README.md oraz wyjątek Prettier dla niezmiennej kopii raportu źródłowego. Pierwszy etap
zakończył się zapisem lokalnym. Na kolejną prośbę Piotra przygotowano publikację przez gałąź
`pm-orchestrator/FOLLOW-1257-codex-review-archive` i PR do `main`. Osobny WIP FOLLOW-1290
pozostawiony bez zmian. Przed wykorzystaniem tych materiałów sprawdzić aktualny status/SHA i
zmienione interfejsy.

**Gotowe:** REVIEW (wniosek i korekty), REPO_MAP (5 apps/5 packages + infra/tests, zakres lektury i
wyłączenia), EVIDENCE (37 F-ID + nowe ustalenia), CLAUDE_ADDENDUM (WP00–WP20 i trzy następne PR-y),
CONTEXT, inventory/reading i lokalne probes. Kanoniczne decyzje nadal w repo docs/ticketach; ten
folder nie jest nową kolejką wdrożeniową. Pełny raport źródłowy odzyskano z wiadomości użytkownika i
zapisano w ORIGINAL_CODEX_REPORT.md. Uzupełniono kopie `.txt` wszystkich lokalnych logów, indeks
probes/README.md i manifest plików z SHA-256. Punkt wejścia: [Codex Review](../../CODEX_REVIEW.md).

**Wynik:** RED nadal uzasadnione. Dodatkowe R-01: ignorowane HTTP/Redis command errors przy
usuwaniu; R-02: nonatomic OTP cap. Rozszerzenia F-10/F-09 o listings/embed oraz F-01 o niepoparte
przykłady promptu. Aktualizacja planu o automatyczny Modal deploy, current QUEUE/STATUS/FOLLOW-1304
i ostrożną interpretację 8%/estymacji. Rule AB odnosi się do DOM, nie Git. ADR-0020 D7 jawnie
odkłada monotonic good-chat ordering — nie dodano tego jako nowego confirmed findingu.

**Istotna precyzja F-04:** dwukrotnie identyczne wymiary z fixture FOLLOW-1301 dają
0.366839618→0.484047441. Druga ekstrakcja zmieniająca finance_complexity na investment_vehicle daje
0.664148815; request pozostaje na 0.366839618. Oba harmonogramy potwierdzone przez real init, z
kontrolowanym HTTP/NLP. Nieudane pierwsze założenie zachowano w sdk-initial-assumption.txt. Final
suite ma oba warianty.

**Świeże dowody:** 310 istniejących testów PASS (SDK95, control-plane111, ingest60, auth44); własne
TS 16 PASS/5 plików, odtwarzające wady; actual Python helper/job przyjmuje niepoparte 9.9% i woła
oba cache writery. SDK build/budget PASS 42400/43136 B (736 B zapasu). Guard afterResponse PASS.
Logi przenośne `.txt` w probes; dokładne komendy w EVIDENCE. Reprodukcja PASS nie jest product
regression PASS. Nie powtarzać bez przyczyny istniejących suite'ów już zakończonych na tym samym
kodzie.

**Nie zrobiono:** całych suite'ów/typecheck/lint/Next build, fresh Gitleaks/CH SQL/migration replay,
real LLM/FOLLOW-819 ×3, wdrożeń i hosted readback. Oryginalnych /workspace/audit-\* brak. Nie uznano
tych pozycji za PASS. Granice code/deploy/effect pozostają rozdzielone.

**Następna konkretna czynność:** następna sesja Claude zaczyna od `docs/CODEX_REVIEW.md`, REVIEW i
CLAUDE_ADDENDUM oraz odpowiednich sekcji pełnego raportu. Przy publikacji poprawiono wyłącznie lint
w próbach offline (wrapper Drizzle, jawne Promise i bloki callbacków); raport źródłowy pozostaje
niezmieniony. Archiwizacja jest zakończona. Dalsze naprawy dopiero jako osobne zadanie w aktualnym
zakresie ticketów. Proponowany start: WP01 bezpieczeństwo treści/legacy cache, WP02 stan i lifecycle
SDK/FOLLOW-1302, WP03 JWT/matryca mutatorów; WP10 może iść niezależnie przy rozdzielonych plikach.
F-08 zależy od nazwanego host emittera, WP11 od wersji źródła, WP05 od ownership proof; brak tych
danych nie został zamieniony w domyślną decyzję.
