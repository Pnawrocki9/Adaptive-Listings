# Adaptive Listings — ponowna weryfikacja audytu i planu dla Claude

Data: 2026-10-08. Autor: Codex, lokalny przegląd repozytorium.

**Werdykt: zasadnicza diagnoza raportu jest poprawna; RED dla pilota z rzeczywistymi kupującymi
pozostaje uzasadniony. Plan dla Claude nadaje się do wykorzystania po uzupełnieniach opisanych
poniżej. Nie znalazłem podstaw do wymiany stosu ani powrotu do usuniętych usług.**

To kontrola raportu przekazanego w rozmowie, nie rozpoczęcie jego programu naprawczego. Nie
zmieniono kodu produktu, backlogu ani decyzji projektowych. Powstały wyłącznie materiały w tym
katalogu; wykonano lokalny build SDK i testy.

## 1. Co faktycznie zweryfikowano

- Baza raportu: `334082c1bd26aec1a473d97d4617d943ba54a18c`.
- Bieżący checkout: `main`, `b54f472c` — jeden commit później, PR #968.
  `git diff 334082c1 HEAD -- apps packages` jest pusty. Różnice obejmują osiem plików
  dokumentacyjnych/procesowych, w tym allowlistę skryptu `check-gate-exit-codes.sh`.
- Początkowe drzewo było czyste. Istniejący osobny worktree FOLLOW-1290 na `7bbd544b` pozostawiono
  bez zmian.
- Zinwentaryzowano 1560 śledzonych plików. Przegląd źródeł objął wszystkie pięć aplikacji i pięć
  pakietów, także moduły odłożone, oraz konfigurację workspace, migracje, CI, skrypty i harness.
- [Mapa i zakres lektury](REPO_MAP.md) rozróżniają czytanie implementacji, odczyt wybranych
  zakresów, wyszukiwanie i niezweryfikowane obszary. To nie jest deklaracja przeczytania wszystkich
  1560 plików linia po linii.
- Oryginalne `/workspace/audit-*` nie były dostępne. Istotne próby odtworzono lokalnie, zamiast
  uznawać poprzednie wyniki za świeże. Szczegóły wszystkich F-ID: [EVIDENCE.md](EVIDENCE.md).

Źródła kanoniczne sprawdzano selektywnie względem ocenianych kontraktów: `CLAUDE.md`, Snapshot.0/1 i
odpowiednie części MASTER_DESIGN, zasady operacyjne/workflow, Rule AA/AB, aktualna kolejka i
poprawki FOLLOW-1203/1251/1297/1302/1303/1304, ADR-y właściwe dla ścieżek adaptacji, zgody,
uprawnień i chat shadow. Nie odczytywano ponownie całych historycznych ksiąg ani wszystkich 5588
linii CONVENTIONS_PATCH.

## 2. Najważniejsze potwierdzenia

**Fakty generowane przez LLM — F-01/F-02.** Rzeczywisty Python checker wykrywa niepoparty yield
`9.9%`, ale `_generate_with_sonnet` zwraca FIT. Wywołanie rzeczywistego joba, z odizolowanymi
transportami, przekazało taką treść do obu writerów cache. Rzeczywisty gateway TS przyjął niepoparte
cechy i zamianę liczby określającej cenę na powierzchnię. Kontrola negatywna z zupełnie nieobecną
liczbą została odrzucona. To potwierdza wadę walidatora; nie jest pomiarem częstotliwości
halucynacji modelu.

**Drugi chat — F-04.** Test przez `_initForTest()` i rzeczywisty listener hosta odtworzył
`0.366839618 → 0.664148815`, ale ostatni request nadal wysyła `0.366839618`. Istotne są dane:
pierwsza kontrolowana ekstrakcja ma `purchase_purpose=investment`,
`finance_complexity=standard_mortgage`, `decision_role=decider`, `risk_appetite=balanced`,
`tax_aware=true`; druga zmienia `finance_complexity` na `investment_vehicle`. Dwukrotna identyczna
ekstrakcja daje tylko `0.484047441`. Oba warianty zachowują `yield_hunter` i pomijają potrzebny
follow-up. SDK, listener, obliczenia i storage są rzeczywiste; HTTP/NLP są kontrolowane, bez żywego
modelu. Warunek w `packages/sdk/src/index.ts:963` patrzy na zmianę archetypu. Control-plane
prawidłowo zatrzymuje confidence ≤0.6. Naprawa powinna dostarczyć zmienione wejście decyzji,
zachowując próg; fixture FOLLOW-1302 musi jawnie określać wiadomości i wynik ekstrakcji.

**Stan i lifecycle — F-05/F-24.** Rzeczywiste transformacje stanu gubią znaczniki chat/dwell.
Zdarzenie hosta po teardown ponownie inicjuje żądania. Odczyt kodu potwierdza też brak unieważnienia
bieżącej generacji po opt-out (F-12) i persystencję wyniku przed kontrolą aktualności odpowiedzi
(F-25). Tych dwóch ostatnich pełnych harmonogramów DOM/storage nie odtwarzano ponownie w tej sesji.

**JWT, transport i rozmiar — F-06/F-09/F-11/F-15.** Odtworzono przyjęcie wygasłych i przyszłych JWT,
przepuszczenie niepublicznych adresów przez guard SSRF, przyjęcie timestampu poza zakresem Date i
przerwanie producenta przed fetch oraz utworzenie wiadomości retry większej niż 131072 B. Próba SSRF
sprawdzała guard; nie łączyła się z żadną usługą wewnętrzną. Próba timestampu obejmowała
schema→producer, bez ponownego pełnego ACK→kolejka→CH.

**Cache, tracer, konwersja i DSR.** Mechanizmy F-03/F-07/F-08/F-13/F-14 pozostają w identycznym
kodzie: brak wersji źródła na writerach cache; JSONB string z samą mapą prawdopodobieństw zamiast
envelope czytelnika; CTA w liczniku lift; erase CH bez tenant; wymaganie niepopulowanego
`session_embeddings`. Nie uznaję poprzednich pięciu prób wyścigów ani syntetycznych procentów
ClickHouse za ponownie wykonane.

## 3. Pominięcia i potrzebne rozszerzenia

### R-01 — DSR może zgubić usunięcie z Redis bez zgłoszenia błędu

**Nowe ustalenie, Medium; do WP05, przed checkpoint B.** Oznaczenie R-01 jest lokalną etykietą tego
przeglądu, nie numerem ticketu.

`apps/control-plane/src/lib/chat-intent-cache.ts:199` / `deleteShadowChatIntent` wykonuje fetch,
lecz nie sprawdza HTTP status ani błędów komend w odpowiedzi pipeline. Lokalna próba wykazała
zakończenie sukcesem zarówno dla HTTP 403, jak i HTTP 200 z `[{error: ...}]`.

Analogiczny problem występuje w `apps/control-plane/src/app/api/dsr/erase/route.ts:78`: SCAN
przerywa pętlę po błędzie, a DEL nie sprawdza wyniku. Zadanie uruchomione przez `afterResponse` przy
`:576` ma jedynie catch/log; te odpowiedzi nie rzucają wyjątku. Obsługa czasu życia funkcji przez
`afterResponse` jest poprawna, lecz nie dowodzi wykonania usunięcia.

**Dopisać do WP05:** jawny wynik każdego magazynu, kontrolę odpowiedzi HTTP i każdej komendy Redis,
stan pending/failed i trwałe ponowienie albo równoważną uzgodnioną procedurę zakończenia. Test: błąd
SCAN/DEL → brak fałszywego completed; recovery → potwierdzona nieobecność klucza. Brak konfiguracji
także wymaga jawnego znaczenia. Sprawdzić osobno erasure ścigające się z wcześniej przyjętym
retry/jobem; takiego end-to-end harmonogramu tutaj nie dowiedziono.

### R-02 — limit prób OTP nie działa atomowo przy równoległych żądaniach

**Nowe ustalenie, Medium; do WP05, przed checkpoint B.**

`apps/control-plane/src/lib/dsr-verify.ts:80` odczytuje rekord, `:93` sprawdza limit, a UPDATE po
błędnym kodzie przy `:117` ogranicza się do id i `used_at IS NULL`. Nie rezerwuje próby warunkowo
względem aktualnego licznika. Analogicznie success UPDATE nie sprawdza ponownie limitu.

W kontrolowanym harmonogramie osiem SELECT-ów odczytało rekord przed pierwszym UPDATE. Rzeczywisty
helper, Drizzle i PGlite wykonały **osiem weryfikacji**, zwróciły osiem `invalid_code` i zapisały
`attempt_count=8`, mimo limitu 5. Nie odgadywano cudzego OTP; fixture miała znany request UUID.
Problem zwiększa liczbę dopuszczonych prób przy znanym request_id, nie usuwa wymogu posiadania tego
identyfikatora ani podpisuje dowodu przejęcia konta.

**Dopisać do WP05:** atomowe rozliczenie/ograniczenie prób oraz kontrolę czasu i wykorzystania
tokenu przy operacji rozstrzygającej. Testy równoległe: błędne próby, poprawny kod ścigający się z
blokadą i dwa użycia poprawnego kodu. Zachować możliwość kontynuacji eksportu z F-35 bez otwarcia
możliwości ponownego nieautoryzowanego wykonania.

### Rozszerzenie F-10 — matryca zapisów pomija `/api/listings/embed`

`apps/control-plane/src/app/api/listings/embed/route.ts:99` sprawdza podpis i tenant, ale nie rangę
użytkownika. `:215` zapisuje embedding. Test rzeczywistego handlera, z atrapami dostawcy embeddingów
i magazynu, wykazał HTTP 200 i wywołanie zapisu jako **agency:viewer**, także z wygasłym poprawnie
podpisanym JWT. To rozszerza F-10 oraz dowód F-09 na granicę rzeczywistej mutacji.

**WP03:** dodać ten endpoint do pełnej matrycy metod/ról. Zachować osobną, zatwierdzoną ścieżkę
automatyzacji `INTERNAL_API_SECRET`; nie naprawiać viewer przez zablokowanie legalnego joba. Nie
ograniczać audytu ról do ośmiu przykładów z pierwotnego raportu.

### Rozszerzenie F-01 — prompt sam uczy niepopartych twierdzeń

W `apps/llm-gateway/src/jobs/generate_description.py:822–845` przykłady opisane jako „Good output”
wyciągają z kilku faktów twierdzenia o braku konieczności remontu i zdolności generowania przychodu.
Przykład 2 nie zawiera faktu o stanie technicznym, a twierdzi: „Nothing here needs work before it
earns.” Przykład 1 również przechodzi od obecności najemcy do dodatkowych zapewnień.

**WP01/WP12:** naprawić również przykłady promptu i sposób budowy whitelisty, nie tylko końcowy
checker. Modelowa lista `verified_facts_used` nie staje się zaufaną prawdą przez przekazanie jej do
następnego promptu nagłówka (`:1936`). Nie zmierzono, jak często te przykłady powodują niepoparte
wyjście na żywym modelu.

### Rozszerzenie wymagań testowych — kopia joba nie jest jego wykonaniem

`apps/llm-gateway/src/jobs/test_generate_description.py:96` zawiera `_run_job`, który **kopiuje**
ciało produkcyjnego joba. Testy używające go mogą pozostać zielone, gdy sam job się zmieni. Obecna
reprodukcja wywołuje `generate_description.get_raw_f()` i mockuje granice zewnętrzne.

**WP01/WP12/WP18:** wymagane regresje mają wykonywać produkcyjny job albo wydzieloną funkcję, której
ten job rzeczywiście używa. Dotyczy to szczególnie odmowy przed każdym zapisem, kosztów, headline
oraz FIT/NEUTRAL. Nie zastępować istniejącej kopii drugą kopią.

## 4. Co skorygować w dotychczasowym raporcie

1. **Kolejka i STATUS:** na b54f472c top banner jest już session176. Uwzględnia merge 1288/1289, WIP
   1290 oraz następne 1302/1251/1303. STATUS także dostał nowy wpis. Stary banner nadal jest niżej,
   a opis „1301 DONE” nadal wymaga korekty merytorycznej F-04. Nie zlecać naprawy już poprawionego
   banneru ani odtwarzać merged funkcji.
2. **FOLLOW-1304 jest nowe względem bazy raportu.** Dotyczy niespójnego wyjątku deferral w Rule-H
   checkerze. To ma znaczenie dla zachowania/publikacji zaparkowanego WIP 1290, ale nie jest nowym
   wymogiem produktu ani powodem obchodzenia gate'a.
3. **F-26: maska jest potwierdzona, `null` w staff reuse nie.** W aktualnej normalnej ścieżce obie
   gałęzie staff przypisują `apiKeyOut`. Usunąć dodatkową sugestię null, chyba że istnieje osobna
   reprodukcja. Błąd executable snippet z maską pozostaje.
4. **„8%” nie opisuje ukończenia produktu.** Arytmetyka 2/26 daje około 7,7%, ale szerokie wiersze
   mają różną wielkość i częściowo ten sam zakres. Jedna wada może zdegradować kilka wierszy.
   Zostawić ewentualnie „2 z 26 ocenianych wierszy spełniają zastosowane kryterium pełnego
   zamknięcia”, poza głównym wskaźnikiem postępu. Nie wyprowadzać z tego czasu ani kosztu
   dokończenia.
5. **Estymacje 4–8+ tygodni pozostają scenariuszem zasobowym.** Ten przegląd ich nie potwierdza.
   Najpierw kontrakt bezpiecznych transformacji, wersji listingów, hosta konwersji i DSR; dopiero
   potem estymacja na małe jednostki prac. Nie dodawać wszystkich WP szeregowo tylko dlatego, że
   występują w jednej tabeli.
6. **ADR-0020 D7 wyraźnie odkłada monotoniczną kolejność dobrych wyników NLP.** Nie uznawać samego
   unconditional SET za nowe nieautoryzowane odstępstwo. WP02 naprawia dedupe/follow-up/storage w
   SDK; zmiana kolejności lub scalania NLP wymaga świadomego rozszerzenia kontraktu. Po usunięciu
   starego batcha możliwy pozostaje wyścig dwóch wywołań realtime, lecz nie odtwarzano jego skutku
   dla kupującego w tym przeglądzie.
7. **Rule AB dotyczy ostatniej chwili przed zapisem DOM.** Sformułowanie planu o „protected commits”
   należy doprecyzować jako commit efektu DOM. Nie przypisywać tej regule znaczenia procedury git
   commit.
8. **Merge może uruchomić także Modal, nie tylko migrację PG.**
   `.github/workflows/modal-deploy.yml:86` i `:151` uruchamiają deployment po odpowiednich zmianach
   na main, jeżeli skonfigurowano token. Plan merge/deploy musi obejmować obie aplikacje Modal, PG i
   faktyczny mechanizm wdrożenia control-plane. Sam `vercel.json` nie dowodzi aktualnego ustawienia
   integracji Git ani stanu wdrożenia. Lokalnego GO nie wolno zastąpić samym merge'em.

Nie wycofuję poprawki raportu dotyczącej FOLLOW-1303: join po tenant i session istnieje, więc brak
filtra pojedynczego tenanta w zamierzonym staff aggregate sam w sobie nie dowodzi mieszania tenantów
w ich własnych wierszach. Brak filtrowania zanieczyszczonego holdout pozostaje odrębnym problemem.

## 5. Ocena rekomendacji dla Claude

**Zgadzam się z kolejnością: zabezpieczenie faktów → stan/lifecycle SDK i autoryzacja → kompletne
kontrakty danych, pomiaru i cache → uproszczenia → migracja runtime na końcu → świeże bramki.** Trzy
pierwsze PR-y nadal powinny dotyczyć WP01, WP02 i WP03. Ścieżka WP10 może postępować niezależnie
przy osobnej odpowiedzialności za pliki.

Zachować:

- oryginalny opis przy nieudowodnionych twierdzeniach, także dla starych HIT-ów i spóźnionych
  callbacków;
- rozróżnienie Mitigated/Closed; wyłączenie generatora nie zamyka F-01/F-02;
- mocny warunek ADAPTED, próg >0.6, rzeczywistą zmianę zamierzonego slotu i kontrole negatywne;
- wersję źródła na wszystkich writerach i backfillach; usunięcie Redis nie naprawia wyścigu PG;
- serwerowe pochodzenie i przypisanie konwersji po ekspozycji, z nazwanym producentem hosta;
- oddzielne akceptacje techniczne T i wdrożeniowe B;
- zamrożony bandit, osiemnaście archetypów, obecną semantykę quizu i odłożone funkcje;
- ADR-0023 i parytet przed końcową zmianą runtime, łącznie ze ścieżką embedding overflow;
- małe PR-y, jednego właściciela wspólnego pliku i odtwarzalne dowody zamiast samych checkboxów.

[CLAUDE_ADDENDUM.md](CLAUDE_ADDENDUM.md) zawiera ocenę każdego WP00–WP20, korekty zależności,
kryteria trzech pierwszych PR-ów i zwięzły tekst do dołączenia Claude do pierwotnego raportu. To
propozycja wykonania po przeglądzie, nie polecenie wdrożenia zrealizowane w tej sesji.

## 6. Świeże testy i granice wniosku

Środowisko: Node 22.22.2, pnpm 9.15.4; Vitest z jednym workerem; Node heap do 2048 MB. Zainstalowane
zależności były dostępne — nie wykonywano nowej instalacji frozen-lockfile.

| Sprawdzenie                            | Wynik obecnej sesji                                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Wybrane istniejące testy SDK           | 3 pliki / 95 PASS: intent, intent-snapshot, follow-1301                                                           |
| Wybrane istniejące testy control-plane | 4 pliki / 111 PASS: gateway, description-cache, chat-intent-cache, dsr-verify                                     |
| Wybrane istniejące testy ingest        | 2 pliki / 60 PASS: producer i snapshot                                                                            |
| Istniejący pakiet auth                 | 4 pliki / 44 PASS                                                                                                 |
| Własne próby TS                        | 5 plików / 16 PASS, `probes/reproductions-final.txt`; próby celowo odtwarzają wady i zawierają kontrolę negatywną |
| Python generation/helper/job           | Odtworzony FIT i dwa wywołania writerów z niepopartą liczbą; `probes/python-reproductions.txt`                    |
| Świeży SDK build + budget              | PASS; 42 400 B gzip / limit 43 136 B; zapas 736 B                                                                 |
| Guard afterResponse                    | PASS; `probes/fire-and-forget.txt`                                                                                |

Istniejące **310 testów przeszło**, równocześnie lokalne próby wykazały opisane wady. To wspiera
diagnozę o lukach pomiędzy testowanymi granicami. Nie oznacza, że wszystkie testy repo są mało
wartościowe.

Nie uruchomiono ponownie całych suite'ów, całego lint/typecheck, pełnego Next build, Gitleaks
tree/history, pięciu oryginalnych harmonogramów cache ani realnego ClickHouse SQL. Nie wykonano
żywego LLM/FOLLOW-819 ×3 ani pomiarów produkcji. Wymienione w poprzednim raporcie wyniki tych
kontroli pozostają historyczne; ani ich nie potwierdzam świeżym wykonaniem, ani nie podważam bez
dowodu.

W szczególności nie potwierdzono wdrożonych wersji, grantów, TTL, KV, aliasów Redis, dostarczenia
maila, hostowych konwersji, p95 ani business uplift. RED wynika już z odtworzonych wad i aktualnego
kodu; rozstrzygnięcie nie wymaga założenia, że każda z nich wystąpiła w produkcji.
