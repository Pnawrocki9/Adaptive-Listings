# Plan: Quiz → archetyp z ≥ 90 % trafnością + pełne zarządzanie quizem w backoffice (Faza Q)

**Status:** ZATWIERDZONY przez CEO 2026-10-19 (plan mode); kopia w repo od 2026-10-19 (FOLLOW-1355).
Oryginał: `~/.claude/plans/teraz-przerwa-i-czs-smooth-elephant.md`. Nowy plan; program „single
tenant → localhost → handover" (`docs/PLAN-LOCALHOST-COMPLETION-2026-10-17.md`, K0–K7) nie jest
zastępowany — **Faza Q wchodzi między K3 (zamknięte) a Fazę 4 (P1–P7)**, bo CEO zarządził ją „zanim
pójdziemy dalej". Punkty kontrolne KQ1–KQ2 na localhost, KQ3 = pomiar produkcyjny jako krok CTO w
handoverze.

## Kontekst

CEO (2026-10-19): przeanalizować quiz od pytań po archetyp, oprzeć o badania, doprowadzić do ≥ 90 %
prawdopodobieństwa trafnego archetypu po odpowiedziach kupującego; zbadać backoffice pod kątem
pełnej edycji pytań i zarządzania quizem. Decyzje CEO zebrane w tej sesji:

| #   | Decyzja CEO                                                                                                                                                                                                                                                         | Skutek w planie                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Q-A | Ground truth = **samopotwierdzenie kupującego** na końcu quizu                                                                                                                                                                                                      | krok „Zgadza się? / Nie do końca → wybierz" po ostatnim pytaniu; trafność = potwierdzenia / (potwierdzenia + korekty)                      |
| Q-B | **Sam quiz** ma dawać 90 %; zachowanie i czat tylko doprecyzowują po quizie                                                                                                                                                                                         | metryka liczona na liściu quizu; potwierdzony liść nie jest zdejmowany przez zachowanie                                                    |
| Q-C | **Mniej archetypów, pewniej**                                                                                                                                                                                                                                       | 12 wyników + neutral, reszta jako cechy (niżej)                                                                                            |
| Q-D | **EN + PL**                                                                                                                                                                                                                                                         | oba języki OBOWIĄZKOWE dla każdego pytania/odpowiedzi/tekstu potwierdzenia; **kupujący sam przełącza język quizu** (przełącznik na karcie) |
| Q-E | Zbiór: **12 + neutral i cechy** (upsizer → family_buyer, portfolio_builder → yield_hunter; luxury / remote_worker / golden_visa → cechy); commercial_investor zostaje (app ma typy OFFICE/RETAIL/WAREHOUSE/COMMERCIAL); student_parent i diaspora_buyer **zostają** | drzewo v2 (sekcja A); kanoniczna lista 18 id **nie zmienia się** w kodzie (quiz przestaje przypisywać 5 z nich)                            |
| Q-F | Cechy **od razu zmieniają treść** (copy i podbicia z playbooków luxury/remote/golden)                                                                                                                                                                               | sekcja A.3                                                                                                                                 |
| Q-G | **Czat bez quizu nadal adaptuje** (warunek 1b zostaje)                                                                                                                                                                                                              | fold: skala czatu tylko dla sesji bez quizu (sekcja B.3)                                                                                   |
| Q-H | Publikacja / przywracanie / cofnięcie do defaultu / import: **ops i wyżej**, audyt w transakcji                                                                                                                                                                     | sekcja C                                                                                                                                   |
| Q-I | **Szkic w przeglądarce + świadoma publikacja**; historia wersji i przywracanie na serwerze; bez szkiców serwerowych                                                                                                                                                 | sekcja C (brak nowej kolumny na produkcji)                                                                                                 |
| Q-J | Kryterium 90 % **pre-rejestrowane**: n = 400 rozstrzygniętych quizów na jednej wersji, dolna granica 95 % Wilsona ≥ 0,90 (≥ 372/400), per archetyp ≥ 100 etykiet i recall LB ≥ 0,80, odpowiedzi ≥ 60 %, kontrola κ na ~60 sesjach ocenionych przez agentów          | sekcja B.2; localhost dowodzi potoku i matematyki, nie trafności                                                                           |

Fakty zewnętrzne sprawdzone 2026-10-19: Hiszpania zamknęła golden visa 3.04.2025 (Ley Orgánica
1/2025); Cypr — PR z inwestycji ≥ 300 tys. € (Reg. 6(2)) działa w 2026 → „cel pobytowy" to cecha,
nie archetyp. Źródła przeglądu literatury trafiają do
`docs/research/QUIZ-ACCURACY-RESEARCH-2026-10-19.md` (pakiet Q0).

## Stan faktyczny (HEAD `434b2513`, zweryfikowany w kodzie)

- **Drzewo** `packages/sdk/src/ui/quiz-widget.ts:118-301` (tylko EN): 7 pytań, max 3 na ścieżkę, 28
  ścieżek, 17 + neutral wszystkie osiągalne. Liść = argmax wag (`presentation-config.ts:275`). Wady:
  „Lokalizacja"/„Cena" w Q3 nic nie wnoszą; „Luksus"/„Praca zdalna" (waga 2) **kasują** Q2;
  golden_visa tylko pod „Dochód z najmu"; „Za granicą" jest alternatywą celu, choć to fakt o miejscu
  zamieszkania (Brytyjczyk kupujący wakacyjne w Hiszpanii pasuje do dwóch gałęzi).
- **Fold** `intent.ts:813-830`: liść p = 0,85, confidence = min(0,85 × 1,2; 1) = 1,0;
  `QUIZ_CONFIDENCE_BONUS = 1.2` (`:400`), `withConfidenceBonus` (`:445`), **czat zawsze dostaje
  ×1,2** (`:866`, także bez quizu — na tym stoi AC(8): 0,553 × 1,2 = 0,664); `SWITCH_MARGIN` 0,05
  (`:102`); drift (`adapt-loop.ts:366-395`, `DRIFT_HOLD_COUNT` 3) przypina kandydata przez
  `applyQuizLeaf`, **także `neutral`** (brak strażnika w `detectMismatch` `:765-806`); addytywne
  podbicia (`:624` +0,15) mogą zbić nieprzypięty liść poniżej 0,6. Serwer ufa `confidence` klienta
  (`api/adapt/route.ts:688`). Bramki: DOM 0,5, serwer > 0,6.
- **Zapis** `quiz_completions`: indeksy odpowiedzi + `answer_path`, bez wersji definicji, bez
  potwierdzenia, bez czasu, bez impresji; `quiz.event` tylko `step:'completed'` (`step: z.string()`
  — nowe wartości przechodzą, nowe pola są wycinane). **Zero pomiaru trafności.** Localhost: 244
  ukończeń, wszystkie `yield_hunter` (harness). Skip i × to to samo zdarzenie
  (`quiz-widget.ts:529-530`).
- **Backoffice**: formularz edytuje tylko tekst EN; struktura/`next`/wagi/PL tylko w JSON; brak
  wyboru liścia, podglądu, listy wersji/diff/przywracania, draft/publish, powrotu do defaultu
  (STARTER 2-pytaniowy podmienia prawdziwy default), import/eksport, informacji o ~6 min propagacji
  (`max-age=300, swr=60` + sessionStorage). **Błędy**: wyścig numerów wersji (`max(version)` poza
  transakcją, `quiz-definition/route.ts:208` vs `:233`); nieważny aktywny wiersz ładuje STARTER i
  zapis go nadpisuje (`:128-135`, editor `:156`). Podgląd ukończeń pokazuje indeksy; etykiety gałęzi
  w analityce na sztywno; nowe trasy SDK wymagają wpisu CORS w `middleware.ts:17,58` (FOLLOW-936).

## A. Drzewo v2 i zbiór archetypów (EN + PL)

**Wyniki (12 + neutral), każdy z regułą etykietowania (dwie osoby etykietują tak samo):**
yield_hunter (dochód z najmu długoterminowego, nikt z domowników tam nie mieszka),
vacation_rental_investor (najem krótkoterminowy), flip_investor (remont i sprzedaż),
commercial_investor (lokal komercyjny), first_time_buyer (główny dom w kraju zamieszkania, nigdy nie
miał własnego), family_buyer = „przeprowadzka na lepsze" (miał własne, chce więcej/lepiej),
downsizer (miał własne, chce mniej/łatwiej), retiree_relocator (główny dom w nowym kraju,
emerytura), lifestyle_expat (nowy kraj, pracuje dalej), diaspora_buyer (wraca do kraju pochodzenia;
„wracam" wygrywa z „emerytura"), second_home_buyer (sam korzysta część roku, główny dom gdzie
indziej), student_parent (dla studiującego dziecka), neutral (Q1 „jeszcze nie wiem"). **Reguły
pierwszeństwa**: (1) kto tam mieszka przez większość roku decyduje; (2) w „główny dom" przeprowadzka
za granicę wygrywa z historią własności; (3) w „za granicę" powrót wygrywa z emeryturą; (4) każde
drugorzędne użycie = cecha, nigdy drugi wynik.

**Cechy** (`packages/shared/src/traits.ts`, `CANONICAL_TRAIT_IDS`): `premium` (← luxury_buyer),
`works_from_home` (← remote_worker), `residency_goal` (← golden_visa_buyer), `buying_from_abroad`,
`seasoned_investor` (← portfolio_builder), `will_let`, `has_children`.

**Drzewo** (ścieżka ≤ 3 pytania + ekran cech + potwierdzenie; dokładnie jedna ważona odpowiedź na
ścieżkę → argmax bez zmian; teksty EN/PL z raportu agenta A, do redakcji w pakiecie Q1):

- Q1 `q_purpose` „Do czego ma służyć ta nieruchomość?": główny dom w kraju, w którym mieszkam →
  `q_home`; główny dom w kraju, do którego się przeprowadzam/wracam [cecha buying_from_abroad] →
  `q_move`; dom wakacyjny/drugi (na co dzień mieszkam gdzie indziej) → second_home_buyer →
  `t_second`; inwestycja → `q_invest`; mieszkanie dla studiującego dziecka → student_parent →
  `t_student`; jeszcze nie wiem → neutral (bez potwierdzenia).
- `q_home` „Co najlepiej Cię opisuje?": pierwsze własne → first_time_buyer; miałem/am własne, chcę
  więcej/lepiej → family_buyer; miałem/am własne, chcę mniej/łatwiej → downsizer; każde → `t_home`.
- `q_move`: wracam do kraju pochodzenia → diaspora_buyer; emerytura → retiree_relocator; będę tam
  pracować → lifestyle_expat; → `t_move`.
- `q_invest` „Jak ma na siebie zarabiać?": najem długoterminowy → yield_hunter; krótkoterminowy →
  vacation_rental_investor; remont i sprzedaż → flip_investor; lokal komercyjny →
  commercial_investor; jeszcze nie wiem → yield_hunter (bezpieczny default, raportowany osobno); →
  `t_invest`.
- Ekrany cech `t_*` (pytanie typu **multi**, opcjonalne, zawsze ostatnie, „Żadne z powyższych"):
  t_home {has_children, works_from_home, premium}; t_move {+ residency_goal}; t_second {will_let,
  buying_from_abroad, works_from_home, residency_goal, premium}; t_invest {seasoned_investor,
  buying_from_abroad, residency_goal, premium}; t_student {buying_from_abroad, will_let}.
- **Potwierdzenie** (każdy wynik ≠ neutral): „Na podstawie Twoich odpowiedzi: **{nazwa}** — {zdanie
  z faktami}. Zgadza się?" [Tak, to ja] [Nie do końca] (równa waga wizualna). „Nie do końca" → 3
  najbliższe alternatywy (tabela z raportu A) + „Żadne — pokaż wszystkie" (= neutral, bez zapisu
  archetypu); jedna korekta, bez ponownego quizu. × na ekranie potwierdzenia → wynik stosowany,
  zapis `unconfirmed`.
- **Przełącznik języka** EN | PL na karcie quizu (decyzja Q-D): wybór trzymany w sessionStorage,
  nadpisuje `quiz_config.language` dla quizu i tekstów potwierdzenia; chrome EN/PL/ES już w SDK.

**Schemat** (`packages/shared/src/schemas/presentation-config.ts`, addytywnie, `schema_version` 1
zostaje): `QuizAnswerSchema.traits?: TraitId[] (≤4)`; `QuizQuestionSchema.kind?: 'single'|'multi'`;
`QuizDefinitionSchema.confirm?: { names_i18n, sentences_i18n, alternatives }`; nowe twarde reguły:
pytanie `multi` ma `weights {}` i `next null`; klucze `confirm` kanoniczne; każdy osiągalny archetyp
ma nazwę i zdanie w `confirm`; **EN i PL obowiązkowe** dla każdego `prompt_i18n`/`label_i18n`/
`confirm` (błąd blokujący); ostrzeżenie `computeAmbiguousPaths`. `computeUnreachableArchetypes`
dostaje allow-listę 5 id, które quiz celowo nie przypisuje.

**SDK** (`quiz-widget.ts`): `resolveQuizOutcome(def, path) → {leaf, traits}`, krok `multi`
(checkboxy, „Żadne" wyłączne), ekran potwierdzenia + korekty (klasy
`.estalara-quiz-result|-confirm| -reject|-option`, NIE `.estalara-quiz-answer` — pętla harnessu
klika odpowiedzi), przełącznik języka,
`onComplete(leaf, {confirmation, traits, quiz_run_id, definition_hash})`. **Default v2 EN+PL
serwowany z control plane** (`packages/shared` `DEFAULT_QUIZ_DEFINITION_V2`, public-config emituje
go, gdy brak aktywnego wiersza; wbudowany w bundlu zostaje EN-only jako awaryjny — budżet 43 136 B,
dziś 40 405). Cechy: sesja + `intent.snapshot` + `description`-guidance: cecha dołącza
`listing_rules` i jeden slot/akapit z playbooka źródłowego
(`packages/shared/src/playbooks/archetypes/{luxury-buyer, remote-worker,golden-visa-buyer}.ts`);
playbooki family_buyer ← upsizer, yield_hunter ← portfolio_builder scalone; opis diaspora_buyer
zawężony.

## B. Zapis, metryka ≥ 90 %, fold

**Zapis — nowa tabela `quiz_runs`** (`docs/handover/migrations/H002_quiz_runs.sql`, RLS jak H001,
localhost przez `localhost-up.sh`, produkcja = krok CTO; **żadnych kolumn w `quiz_completions`** —
Drizzle wstawia wszystkie kolumny, brak kolumny na prod = utrata ukończeń). Kolumny: id (UUID z
SDK), tenant_id, session_id, language, definition_hash, definition_version, sdk_version, status
(`shown|dismissed|completed|confirmed|corrected|unconfirmed`), last_step, resolved_archetype,
answer_path, traits, step_ms[], result_ms, offered, confirmed_archetype (`none_of_these` dozwolone),
shown_at, updated_at; CHECK + indeks (tenant, hash, status). Helper `lib/quiz-runs.ts` wg wzorca
`lib/lift-snapshots.ts` (42P01 → `quiz_runs_table_missing`, 503, Sentry). Trasa `POST /api/quiz/run`
(HMAC + origin jak `quiz/completion`, opt-out, maszyna stanów forward-only, replay = 200 no-op),
wpis CORS, DSR erase/access/portability (42P01 tolerowane tylko dla tej tabeli), zgoda na
profilowanie jak `consent-gate.ts:106`. `quiz.event`: `step` `confirmed|corrected|unconfirmed` +
opcjonalne `quiz_run_id`, `resolved_archetype` (schemat addytywny) → **ESC-086** (3 zmiany
publicznej powierzchni: `quiz.event`, `/api/quiz/run`, blok `confirm` w public-config). Prywatność:
wszystko pseudonimowe, bez wolnego tekstu, czasy zaokrąglone i ograniczone, bez IP/UA.

**Metryka** (jedna wersja = jeden `definition_hash`; wiersze `confirmed|corrected`, liść ≠ neutral,
bez ruchu staff/ops): A = confirmed / (confirmed + corrected); precision per liść; recall per klasa
prawdziwa (potwierdzony liść lub cel korekty); macro recall (klasy ≥ 30); macierz pomyłek z kolumną
`none_of_these`; wskaźnik odpowiedzi = rozstrzygnięte / completed; wariant pesymistyczny
(unconfirmed = błąd); przekroje język × tercyl szybkości (szybkie „tak" < 1,5 s = flaga
przytakiwania, raportowana, nie wykluczana). **Pre-rejestracja**
`docs/decisions/ PREREG-quiz-accuracy-2026-10.md` (decyzja Q-J; jedna analiza; futility przy n = 130
i 200, gdy górna granica < 0,90; zmiana hasha restartuje licznik).
`packages/shared/src/stats/wilson.ts` z pinami (372/400 PASS, 371 FAIL; 95 % → n ≥ 127, 93 % → 362).
**Backoffice**: zakładka `/admin/tenants/[id]/quiz-accuracy` +
`GET /api/admin/tenants/quiz-accuracy` (lejek shown → dismissed per krok → completed →
confirmed/corrected/unconfirmed; headline + Wilson + werdykt PASS/FAIL/FUTILE/INSUFFICIENT_N; per
liść; macierz; język; miesiące); opcjonalny cron ostrzegawczy. **Localhost dowodzi**: potok (każdy
status ląduje, opt-out nic nie pisze, DSR kasuje, CORS, brak tabeli = głośno), matematykę (złote
fixtury) i piny; opcjonalny dogfood 30–50 osób tylko dla UX. **Tylko produkcja** (CTO: H002,
włączenie kroku, zamrożenie hasha): ≥ 400 rozstrzygnięć, recall per klasa, κ, dryf miesięczny.

**Fold** (`intent.ts`): `applyQuizLeaf(state, leaf, evidence)`: `completed` 0,72 (reszta 0,28/17),
`confirmed` 0,90, `corrected` 0,90 na skorygowanym; confidence = max posterior (bramki: 0,72 > 0,6 >
0,5); `none_of_these` → stan sprzed quizu, `quiz_rejected`; liść neutral → nieprzypięty; podłoga
0,005 dla każdego archetypu; **`QUIZ_CONFIDENCE_BONUS` znika ze ścieżki quizu** (confidence staje
się prawdopodobieństwem; kalibracja ma sens); skala ×1,2 zostaje **tylko** dla czatu bez quizu jako
`CHAT_ONLY_CONFIDENCE_SCALE` (decyzja Q-G; AC(8) G-04 bez zmian). **Potwierdzony liść**: każda
aktualizacja z zachowania zachowuje jego masę i normalizuje resztę (jeden helper dla 8 miejsc
przeliczeń `intent.ts:635-1052`); czat przy potwierdzonym liściu tłumiony τ = 0,5 (3 sprzeczne
wymiary nie przewracają, 4 tak); niepotwierdzony liść aktualizowany normalnie (dwa zakładki 3-pok.
zbijają 0,72 → ~0,55 = koniec adaptacji, udokumentowane). Drift: nigdy dla potwierdzonego, nigdy do
`neutral` (strażnik w `detectMismatch` i w `adapt-loop.ts:384`), przypięcie przez
`applyDriftCandidate` na masie `completed`. Opcjonalnie, osobny ticket: serwer ogranicza
`confidence` klienta (tryb cienia najpierw). Addytywne podbicia → ograniczone mnożniki (osobny
ticket).

**Harness**: **AC(10)** „ścieżka potwierdzenia" (a: potwierdzenie → wiersz `confirmed`, stan 0,90,
następny `/api/adapt` z hintem 0,9 adaptowany, 2 sprzeczne sygnały nie ruszają liścia; b: korekta →
`corrected`, follow-up po korekcie i foldzie [reguła FOLLOW-1352] z hintem skorygowanym, adaptowany;
c: × na potwierdzeniu → `unconfirmed`, 0,72), pin `ac10-verdict.test.ts` w `pnpm e2e:smoke`; AC(1)
pętla quizu: widoczny `.estalara-quiz-result` = ukończenie, klik potwierdzenia; pewność 1,0 →
0,72/0,90 w artefaktach i README; 117 referencji `applyQuizLeaf` w testach SDK: domyślne
`evidence='completed'`, piny 0,85/1,0 → 0,72, nowe piny 0,90/korekta/τ/drift; TALLY total 8;
wszystkie starsze artefakty STALE (planowo) → świeża seria 3× GREEN.

## C. Backoffice — pełne zarządzanie quizem

Logika w `packages/shared` (`schemas/quiz-walk.ts` — przeniesione czyste helpery walkera +
`enumerateQuizPaths`, `resolveLeafArchetype`, `nextStep(def,state)` maszyna stanów używana też przez
SDK; `quiz-lint.ts` — `QuizDefinitionAuthoringSchema` = schemat serwowany + reguły autorskie:
pytania-sieroty, duplikaty id odpowiedzi, ≤ 40 pytań, 2–8 odpowiedzi, głębokość ≤ 6, ≤ 2000 ścieżek,
puste/za długie (> 160) etykiety, **brak EN lub PL = błąd**; ostrzeżenia: nieosiągalne (poza
allow-listą cech), remisy, wagi ujemne, duplikaty etykiet; `quiz-diff.ts`). **Schemat serwowany
pozostaje łagodny** (zaostrzenie zrzuciłoby kupujących na default —
`public-config/route.ts:145-157`).

Edytor `/admin/tenants/[id]/quiz-definition` (ten sam adres, bez nowej strony): karty pytań i
wiersze odpowiedzi z polami **EN | PL obok siebie** i licznikiem „PL 12/30"; dodaj/usuń/kolejność
(usunięcie zeruje `next` przychodzące i oznacza; zmiana kolejności ostrzega o indeksach); `next`
jako lista (bez self/przodków); **wybór liścia** per odpowiedź końcowa (pisze `weights {X:1}`;
„custom weights" w „Advanced"); ekran cech (`kind: multi`) i zakładka „Potwierdzenie"
(nazwy/zdania/alternatywy EN|PL); panel lintu (błędy blokują Save); **symulator**: przejście drzewa
jako kupujący EN/PL z liściem, cechami i ekranem potwierdzenia + tabela wszystkich ścieżek;
**wersje**: lista (wersja, aktywna, data, autor, hash, liczby), diff, **przywróć** (kopia-do-przodu
jako nowa wersja), **cofnij do defaultu** (deaktywacja — public-config serwuje default v2), „wczytaj
default do edytora" (zastępuje STARTER); **publikacja** = jeden audytowany PUT z dialogiem diff +
nota o ~6 min propagacji; szkic lokalny (localStorage, strażnik niezapisanych zmian); import/eksport
JSON (walidacja autorska, nota o wycinanych kluczach); tryb tylko-do-odczytu dla readonly
(`can_write`); baner „nieważny aktywny wiersz" z surowym JSON zamiast cichego STARTER. API: GET
(+`can_write`, `invalid_active`, `lint`), PUT (+`base_version` → 409, `source`, odczyt
`max(version)` **w transakcji** pod `pg_advisory_xact_lock`), nowe `GET versions`, `PUT activate`,
`PUT deactivate` (ops+, audyt `quiz_definition.{update,restore,revert_to_default}` z parą wersji +
SHA-256, nie całym blobem; `check-staff-write-atomicity.sh` zielony). Podgląd ukończeń pokazuje
**tekst** pytań i odpowiedzi (API zwraca `answer_path`; wersja z `quiz_runs.definition_version`, dla
starych wierszy „przybliżone"); etykiety gałęzi w analityce z definicji; odpływ per pytanie z lejka
`quiz_runs`. AI „Suggest weights" zostaje bez audytu (nic nie zapisuje).

## Pakiety, kolejność, punkty kontrolne (Faza Q; model-fit wg CLAUDE.md)

| Pakiet               | Zakres                                                                                                                                                                                                             | Kto / model                                                                                                                                                                     | Seria                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Q0 docs              | `docs/research/QUIZ-ACCURACY-RESEARCH-2026-10-19.md` (źródła), `PREREG-quiz-accuracy-2026-10.md`, ESC-086, tickety FOLLOW-1353…, QUEUE, MASTER_DESIGN §E.4 v3 (drzewo, fold, pomiar) + §D.6                        | PM (bookkeeping) + architect (**Opus**: §E.4 rewrite)                                                                                                                           | nie                                  |
| Q1 shared            | `traits.ts`, schemat (`confirm`, `kind`, `traits`, EN+PL obowiązkowe), `quiz-walk.ts`, `quiz-lint.ts`, `quiz-diff.ts`, `stats/wilson.ts`, `DEFAULT_QUIZ_DEFINITION_V2` EN+PL (redakcja tekstów z raportu A), testy | sdk-engineer (**Sonnet**); teksty PL/EN do akceptacji CEO w symulatorze (KQ2)                                                                                                   | nie                                  |
| Q2 SDK widget        | krok multi, potwierdzenie + korekta, przełącznik języka, `quiz_run_id`/hash/czasy, `onComplete` outcome, `quiz.event` kroki, `build:check`                                                                         | sdk-engineer (**Opus** — maszyna stanów, pętla harnessu, budżet bundla)                                                                                                         | 3× (K-ladder)                        |
| Q3 zapis             | H002 `quiz_runs`, `lib/quiz-runs.ts`, `POST /api/quiz/run`, CORS, DSR, consent, public-config serwuje default v2 + `definition_version`/hash                                                                       | backend (**Opus** — auth/prywatność/DSR)                                                                                                                                        | nie (ścieżka zapisu; AC(10) pokryje) |
| Q4 fold              | masy 0,72/0,90, bonus tylko dla czatu bez quizu, kotwica potwierdzonego liścia, τ czatu, strażniki driftu, re-piny 117 testów                                                                                      | ml-engineer (**Opus**)                                                                                                                                                          | 3×                                   |
| Q5 cechy + playbooki | scalenia family←upsizer, yield←portfolio; cecha → `listing_rules` + slot z playbooka źródłowego; guidance w `description-generator.ts`; parytet opisów                                                             | ml-engineer (**Sonnet**; Opus przegląd grounding — ESC-076)                                                                                                                     | 3×                                   |
| Q6 harness           | AC(10) + pin, AC(1) pętla potwierdzenia, re-piny 0,72/0,90, TALLY 8, README §5                                                                                                                                     | qa-engineer (**Opus**)                                                                                                                                                          | 3× 8/8                               |
| Q7 edytor            | PR C1 (API: wersje/activate/deactivate, lock, 409, audyt — **Opus**), C2 (edytor strukturalny EN                                                                                                                   | PL, liść, cechy, potwierdzenie, lint — Sonnet), C3 (symulator, wersje UI, import/eksport, publikacja — Sonnet), C4 (ukończenia jako tekst, etykiety analityki, odpływ — Sonnet) | backend                              | nie (poza `apps/control-plane/src` → seria 3× po każdym z C1–C4 zgodnie z regułą pathspec; batch na KQ2) |
| Q8 raport            | `quiz-accuracy` API + zakładka, cron ostrzegawczy                                                                                                                                                                  | backend (Sonnet; **Opus** przegląd statystyki)                                                                                                                                  | 3× (pathspec)                        |
| H                    | handover: H002 w §4, krok „włącz potwierdzenie, zamroź hash, zbierz 400", pre-rejestracja, miesięczny monitor                                                                                                      | PM + architect                                                                                                                                                                  | —                                    |

Zależności: Q1 → Q2, Q3, Q7; Q2+Q3 → Q4 → Q6; Q5 równolegle po Q1; Q8 po Q3. Numeracja ticketów: Q0
= FOLLOW-1355, Q1 1356, Q2 1357, Q3 1358, Q4 1359, Q5 1360, Q6 1361, Q7 1362 (PR C1–C4), Q8 1363, H
= amendment FOLLOW-1346 (1353/1354 zużyte przez K3), ESC-086. Każdy PR z pathspec kończy serię 3×
GREEN `[FRESH]` jak dotąd; wszystkie PR-y przechodzą `check-single-tenant.sh` (nowe trasy do
allowlisty), TOTAL_SITES, Rule I „0 new", prettier, verifier.

**KQ1 (po Q1–Q6, localhost):** seria 3× GREEN **8/8** na jednym SHA (AC(10) a/b/c); pin: hop 11 =
0,90 po potwierdzeniu; wiersze `quiz_runs` dla każdego statusu; DSR kasuje; opt-out nic nie pisze;
złote fixtury Wilsona; bundle ≤ 43 136 B; `pnpm e2e:smoke`. STOP: AC(10)(b) nie serwuje
skorygowanego archetypu → ścieżka korekty zepsuta, nie mergować; AC(1)/AC(8) RED dwa razy →
bisekcja. **KQ2 — moment CEO (po Q7–Q8):** CEO w backoffice: przechodzi symulator EN i PL po 3
ścieżkach, edytuje pytanie w obu językach, publikuje, widzi wersję i diff, przywraca poprzednią,
ogląda raport trafności z lejkiem (na localhost z danymi syntetycznymi — werdykt INSUFFICIENT_N)
oraz na stronie ogłoszenia :5173 przechodzi quiz v2 po polsku z przełącznikiem języka i
potwierdzeniem. STOP: CEO odrzuca teksty/drzewo → poprawki w Q1 przed Fazą 4. **KQ3 (produkcja,
CTO):** H002, włączenie, ≥ 400 rozstrzygnięć, jedna pre-rejestrowana analiza, κ; werdykt PASS/FAIL
do MASTER_DESIGN §Snapshot.0.

## Weryfikacja (jak sprawdzić koniec-do-końca)

1. `pnpm --filter @estalara/shared test` (schemat, lint, diff, walk, wilson);
   `pnpm --filter @estalara/sdk test` + `build:check`; control-plane vitest dla `api/quiz/**`,
   `api/admin/tenants/ quiz-*`, `admin/tenants/[id]/quiz*`, `observability-signals`.
2. Pełny bring-up (`scripts/dev/localhost-up.sh`, stosuje H002) → `psql` na `al_pg_local`:
   `select status, count(*) from quiz_runs group by 1` po jednym przejściu harnessu =
   shown/completed/ confirmed; `curl -X POST /api/quiz/run` bez HMAC → 401; z opt-out → 204 bez
   wiersza.
3. Seria FOLLOW-819 3× `run=GREEN` `total=8` `[FRESH]` (README §5.3x) — AC(10) a/b/c.
4. Real app :5173 (`al-real-up.sh`): quiz v2 po PL i EN, potwierdzenie → `/api/adapt` `llm_tweaked`
   (N3-lite + ręczny spacer CEO = KQ2).
5. Backoffice: N2 Playwright anonimowy; spacer CEO (KQ2); `check-staff-write-atomicity.sh`;
   `check-single-tenant.sh --final` = 0.
6. Raport trafności: fixtury 372/400 → PASS, 371 → FAIL; macierz pomyłek z seedowanych wierszy.

## Czego ten plan NIE dowodzi (do powiedzenia CEO wprost)

Localhost nie dowodzi 90 % — sesje syntetyczne potwierdzają same siebie. Plan dowodzi, że quiz jest
zbudowany tak, by 90 % było osiągalne (fakty zamiast postaw, ≤ 2 odpowiedzi na wynik, potwierdzenie,
poprawny fold), że pomiar jest poprawny matematycznie i pre-rejestrowany, i że backoffice pozwala
poprawiać pytania bez programisty. Liczbę „o ile %" da dopiero produkcja po ≥ 400 rozstrzygniętych
quizach (krok CTO). Samopotwierdzenie jest obciążone przytakiwaniem — dlatego kontrola κ na próbie
ocenionej przez agentów i raportowanie wariantu pesymistycznego. Szacunek agenta A: 91–94 % ogółem,
najsłabsze second_home_buyer / vacation_rental_investor / lifestyle_expat (nakładka „dom wakacyjny +
wynajem").

## Pliki krytyczne

- `packages/sdk/src/ui/quiz-widget.ts` (drzewo, walker, ekran potwierdzenia, język),
  `packages/sdk/src/core/{intent,intent-loop,adapt-loop,adapt}.ts`
- `packages/shared/src/schemas/presentation-config.ts`, nowe `traits.ts`,
  `schemas/{quiz-walk,quiz-lint,quiz-diff}.ts`, `stats/wilson.ts`, `playbooks/archetypes/*.ts`,
  `schemas/events/quiz.ts`
- `apps/control-plane/src/app/api/quiz/{public-config,completion}/route.ts`, nowe `api/quiz/run`,
  `api/admin/tenants/quiz-definition/**`, `api/admin/tenants/quiz-accuracy`, `lib/quiz-runs.ts`
  (wzór `lib/lift-snapshots.ts`), `middleware.ts` (CORS), `api/dsr/*`
- `apps/control-plane/src/app/admin/tenants/[id]/{quiz-definition,quiz-completions,quiz-accuracy}/**`,
  `components/analytics/quiz-analytics-view.tsx`
- `docs/handover/migrations/H002_quiz_runs.sql`, `scripts/dev/localhost-up.sh`,
  `docs/handover/CTO_HANDOVER.md`
- `tests/e2e/follow-819/differentiator-e2e.mjs`, `ac8-verdict.test.ts`, nowe `ac10-verdict.test.ts`,
  README §5
- `docs/MASTER_DESIGN.md` §E.4/§D.6, `backlog/ESCALATIONS.md` (ESC-086),
  `docs/decisions/PREREG-quiz-accuracy-2026-10.md`
