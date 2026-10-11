# Codex Review — wszystkie wyniki

Punkt wejścia dla Claude Code i osób szukających „Codex Review”, „Codex audit”, „wyników Codex” lub
„przeglądu Codex”. Zebrano tutaj cały dostępny raport przekazany w rozmowie, lokalną ponowną
weryfikację, rekomendacje, kod prób i ich wyniki. Archiwum zapisano 2026-10-08; 2026-10-09 dodano
analizę luk G-01–G-12.

## Od czego zacząć

1. [REVIEW — wniosek i korekty](audits/revalidation-2026-10-08/REVIEW.md): co potwierdzono, co
   wymaga poprawienia i jakie są ograniczenia dowodów.
2. [CLAUDE_ADDENDUM — rekomendacje dla Claude](audits/revalidation-2026-10-08/CLAUDE_ADDENDUM.md):
   ocena WP00–WP20, zależności i trzy pierwsze proponowane PR-y.
3. [Pełny raport źródłowy Codex](audits/revalidation-2026-10-08/ORIGINAL_CODEX_REPORT.md): wszystkie
   sekcje 1–9, F-01–F-37, plan WP00–WP20, kryteria zamknięcia i prompt dla Claude (§8.9). Czytać
   razem z korektami z dwóch powyższych plików.

Werdykt lokalnej weryfikacji: **RED dla pilota z rzeczywistymi kupującymi pozostaje uzasadniony**.
Nowe ustalenia R-01/R-02 dotyczą ignorowania błędów usuwania danych z Redis oraz nieatomowego limitu
prób OTP. Liczba „8%” z raportu źródłowego nie oznacza stopnia ukończenia produktu.

## Komplet materiałów

Wszystkie ścieżki poniżej są względem tego pliku i działają w innym checkoutcie repozytorium.

| Materiał                                                                                | Zawartość                                                                                                                         |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [ORIGINAL_CODEX_REPORT.md](audits/revalidation-2026-10-08/ORIGINAL_CODEX_REPORT.md)     | Pełny, niezmieniony raport przekazany przez Piotra, datowany 2026-10-06.                                                          |
| [REVIEW.md](audits/revalidation-2026-10-08/REVIEW.md)                                   | Lokalna opinia, potwierdzenia, rozszerzenia, korekty i ograniczenia.                                                              |
| [CLAUDE_ADDENDUM.md](audits/revalidation-2026-10-08/CLAUDE_ADDENDUM.md)                 | Ocena wszystkich pakietów WP00–WP20 i materiał do przekazania Claude.                                                             |
| [EVIDENCE.md](audits/revalidation-2026-10-08/EVIDENCE.md)                               | Rejestr F-01–F-37, dodatkowe R-01/R-02, rodzaje dowodów i dokładne komendy.                                                       |
| [REPO_MAP.md](audits/revalidation-2026-10-08/REPO_MAP.md)                               | Pięć aplikacji, pięć pakietów, interfejsy, zakres lektury i wyłączenia.                                                           |
| [CONTEXT.md](audits/revalidation-2026-10-08/CONTEXT.md)                                 | Cel przeglądu, ograniczenia zakresu i zasady odtworzenia kontekstu.                                                               |
| [STATE.md](audits/revalidation-2026-10-08/STATE.md)                                     | Końcowy checkpoint i stan po dokończeniu archiwizacji.                                                                            |
| [inventory.json](audits/revalidation-2026-10-08/inventory.json)                         | Spis 1560 śledzonych plików w badanym checkoutcie.                                                                                |
| [reading.jsonl](audits/revalidation-2026-10-08/reading.jsonl)                           | Pomocniczy zapis odczytanych zakresów i hashy źródeł; nie dowodzi pełnej lektury.                                                 |
| [probes/README.md](audits/revalidation-2026-10-08/probes/README.md)                     | Indeks wszystkich lokalnych prób i logów, także nieudanych podejść.                                                               |
| [ARCHIVE_MANIFEST.json](audits/revalidation-2026-10-08/ARCHIVE_MANIFEST.json)           | Lista plików archiwum z rozmiarem i SHA-256 do sprawdzenia kompletności kopii.                                                    |
| [GAP_ANALYSIS_2026-10-09.md](audits/revalidation-2026-10-08/GAP_ANALYSIS_2026-10-09.md) | Niezależny przegląd luk 2026-10-09, kwalifikacja G-01–G-12, ograniczenia dowodów, mapowanie na WP i tekst do przyszłych promptów. |

## Pochodzenie i granice kompletności

Raport źródłowy odzyskano z wiadomości użytkownika z **2026-10-08 11:07:54.871 UTC** w poprzedniej
sesji. Zapisano dokładnie jej treść w UTF-8: **215 101 znaków / 215 590 bajtów**, bez zmiany treści,
formatowania ani linków. SHA-256:

```text
a3e4dd36485f5a294b2282d0a40e61fccba48fe11f39b29970d411fd2819e2b3
```

Archiwalny plik jest wyłączony z Prettier, aby zachować identyczność z przekazanym tekstem. Jego
instrukcje wykonawcze są częścią cytowanego materiału; samo odczytanie nie uruchamia implementacji.

Baza raportu źródłowego: `334082c1bd26aec1a473d97d4617d943ba54a18c`. Lokalna weryfikacja i
archiwizacja: `main/b54f472c11fd16962024ea3633343c7246280b3e`. Kod `apps/` i `packages/` pomiędzy
tymi rewizjami jest identyczny. Wyniki lokalnych testów pochodzą z zakończonego przeglądu;
archiwizacja nie jest kolejnym uruchomieniem tych testów ani dowodem wdrożenia.

**Niedostępne załączniki z pierwotnego środowiska `/workspace`:** `audit-intent.md`,
`audit-events.md`, `audit-ingest.md`, `audit-analytics.md`, `audit-security.md`, `audit-llm.md`,
`audit-description-cache.md`, `audit-gitleaks-summary.md`, `audit-ch-proof.json`,
`audit-inquiry-ch-proof.json`. Ich historyczne linki w raporcie pozostawiono bez zmian. Nie
odtworzono tych plików pod ich dawnymi nazwami; lokalne próby mają własne źródła i wyniki w
`probes/`. Nie należy traktować wyników opisanych tylko w oryginale jako świeżo wykonanych lokalnie.

Przenośne logi `.txt` zachowują wyjścia lokalnych prób po usunięciu sekwencji kolorów ANSI.
Uwzględniono również błędy konfiguracji i obalone założenia. **PASS reprodukcji oznacza wykazanie
wady**, a nie jej naprawę; wcześniejszych przebiegów nie sumować z końcowym wynikiem.

## Uzupełnienie 2026-10-09

PR #969 scalono do main jako `af926447`; kod apps/packages i drzewo plików są identyczne z
`8730d377`. [Analiza luk](audits/revalidation-2026-10-08/GAP_ANALYSIS_2026-10-09.md) dodaje serię G
z dowodem S, bez nowych reprodukcji produktu. Kwalifikacja koryguje m.in. twierdzenia o pełnej
czystości auth, bezwarunkowym wpływie dowolnych wymiarów na SDK i aktywności crona w produkcji.
Oryginał pozostaje niezmieniony. Kandydaci są w QUEUE/STATUS bez przydzielonych numerów FOLLOW.

## Wskazówka dla następnej sesji Claude Code

Przy poleceniu „znajdź wszystkie wyniki Codex Review” użyj tego indeksu, przeczytaj REVIEW i
CLAUDE_ADDENDUM, a następnie odpowiednie sekcje pełnego raportu i EVIDENCE. Do przekazania całego
pakietu potrzebny jest ten indeks oraz cały katalog `docs/audits/revalidation-2026-10-08/`.

Przy pracach nad lukami pokrycia czytaj także
[GAP_ANALYSIS_2026-10-09.md](audits/revalidation-2026-10-08/GAP_ANALYSIS_2026-10-09.md) oraz wiersze
G-01–G-12 w EVIDENCE. Seria G uzupełnia F/R i wymaga reprodukcji przed naprawami. Skorygowany tekst
do przyszłych promptów znajduje się na końcu GAP_ANALYSIS.

Przed zmianami produktu sprawdź bieżący SHA, aktualne pliki, MASTER_DESIGN i kanoniczne tickety.
Identyfikatory F/WP/R są etykietami raportu; archiwum nie zastępuje kolejki ani decyzji
projektowych. Archiwum opublikowano przez PR #969; uzupełnienie G jest przygotowywane na gałęzi
`pm-orchestrator/FOLLOW-1257-codex-gap-check` do kolejnego PR. Nie podjęto implementacji napraw ani
wdrożeń produktu w ramach archiwizacji.

## Ocena PM i orzeczenia CEO (2026-10-11)

Ocena wykonana przez PM-a sesji 177 na `main/9212e9f0` (jedyny PR kodu po bazie raportu: #971,
FOLLOW-1290). Pełny plan: `~/.claude/plans/teraz-przerwa-i-czs-smooth-elephant.md`; decyzje w
`backlog/ESCALATIONS.md` ESC-083; tickety w `backlog/FOLLOW_UPS.md` (FOLLOW-1305..1311 i
amendmenty).

- **Potwierdzone niezależnie w bieżącym kodzie:** F-04 (`packages/sdk/src/index.ts:965`), R-01
  (`lib/chat-intent-cache.ts:~201`, `api/dsr/erase/route.ts:~92`), R-02
  (`lib/dsr-verify.ts:~90/109`), F-10 rozszerzenie (`api/listings/embed/route.ts`).
- **Zgoda:** diagnoza i kolejność napraw; RED dla kupujących nie podważa strategii localhost-first.
  Kluczowe: warunek 1 FOLLOW-820 ocenia „zaadaptowane”, nie „prawdziwe” → nowy warunek **1c**.
- **Nieprzyjęte:** „8%” i estymaty tygodniowe jako miary; WP00 jako osobny rejestr statusu; WP12 w
  obu runtime'ach (koliduje z D5 — tylko TS po 1297); seria G jako tickety (kandydaci bez
  reprodukcji; część wpięta do 1297/1302, reszta PARKED lub oś B po GO). Archiwum i rewalidacja mają
  jednego autora — stąd własne kontrole.
- **Korekty naszych stubów:** 1303 (przesłanka „mieszanie tenantów” wycofana), 1294 (klucz JSONB,
  bez migracji 0040), 1291 (revision fence niezależnie od p95), 1302 (fixture ze zmianą wymiaru;
  zależy od 1306), 1297 (ADR-0023 najpierw; G-02/03/06/10; auto-deploy Modal), 1251 (pierwsze na
  gateway).
- **Mapowanie WP → tickety:** WP01→1305, WP02→1306, WP03→1307, WP04→1309, WP05→1308 (+1279),
  WP06/07→1310, WP08→1203, WP09→1220/1303, WP10→1280, WP11→1291, WP12→1311, WP13→1251,
  WP14→1286–1291 (zmergowane poza 1291), WP15→1292/1294/1293/1296, WP16→1295, WP17→odroczone jawnie
  (F-28), WP18→1297, WP19→K2/FOLLOW-820, WP20→poza programem (§F planu).
