# Uzupełnienie rekomendacji dla Claude Code

Ten dokument należy czytać razem z pełnym raportem przekazanym przez Piotra i
[ponowną weryfikacją](REVIEW.md). Nie zastępuje kanonicznych decyzji repo i nie przydziela ticketów.
Baza przeglądu: `main/b54f472c`; aplikacje/pakiety nie zmieniły się względem `334082c1`.

## Ocena pakietów

„Zgoda” dotyczy celu i kierunku wykonania, nie akceptacji nieistniejącego jeszcze diffu.
Implementujący musi przeczytać całe pliki zmienianej jednostki wraz z zależnościami; zakres obecnego
przeglądu opisuje REPO_MAP. Podane zależności dotyczą kontraktów/plików, nie wymagają automatycznie
czekania na merge każdego sąsiedniego WP.

| Pakiet | Ocena                      | Dowód, zależność i ryzyko                                                                                                        | Zmiana w zleceniu                                                                                                                                                                                                                                 |
| ------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WP00   | Zgoda z aktualizacją       | HEAD nie zawiera napraw aplikacji, ale QUEUE/STATUS i FOLLOW-1304 są nowsze. Źródła i lokalne dowody są w tym katalogu.          | Zacząć od delta review do bieżącego SHA. Wykorzystać mapę jako nawigację, bez deklarowania nieodbytej lektury. Nie dublować kontekstu w kilku konkurujących rejestrach statusu.                                                                   |
| WP01   | Zgoda, rozszerzyć          | F-01/F-02 odtworzone; cache HIT i stare joby muszą podlegać admission. Python few-shot podaje niepoparte właściwości.            | Dodać przegląd promptów, whitelisty nagłówka i actual job tests. Uzgodnić validation version legacy FIT i pending jobs. Przy braku bezpiecznego ADAPTED zachować draft/composite z minimum WP12, zgodnie z pierwotnym planem.                     |
| WP02   | Zgoda                      | F-04/F-05/F-24 odtworzone; F-12/F-25 potwierdzone w kodzie. Wspólne index/intent/adapt.                                          | Najpierw stan, generacje, storage i teardown; potem bounded follow-up zmienionych wejść decyzji. Nie dodawać po cichu porządkowania serwerowego NLP: ADR-0020 D7 to osobna decyzja.                                                               |
| WP03   | Zgoda, rozszerzyć          | Legacy JWT i mutation roles rzeczywiście nie domykają kontraktu. Nowy rzeczywisty handler probe: `/api/listings/embed`.          | Dodać embed oraz pozostałe mutatory znalezione w pełnej matrycy. Rozróżnić istniejące staff write/audit guards od braków agency viewer. Zachować legalne internal automation i SSR.                                                               |
| WP04   | Zgoda                      | SSRF, unknown schema, mask-as-key, absent meta producer są trafne. Zależność od polityki WP03.                                   | Wycofać nieudowodnione null w staff reuse. Gotowy snippet sprawdzić przez faktyczne authentication, wraz z wymaganą projekcją klucza do ingest. Nie obracać kluczy klienta przy re-aktywacji bez jawnej operacji provisioning/rotation.           |
| WP05   | Zgoda, istotnie rozszerzyć | F-13/14/19/34/35 plus R-01/R-02. Równoległe próby OTP przekraczają cap, Redis errors milczą.                                     | Atomowe OTP, resumable export, tenant scope i current ownership; do tego trwały wynik/ponowienie Redis. Testować pending accepted work po erase. Nie uznawać „Promise fulfilled” ani samego afterResponse za proof of deletion.                   |
| WP06   | Zgoda                      | F-06/F-15 odtworzone, auth/idempotency/scopes w kodzie. Caller class jest potrzebny WP08.                                        | Zachować dokładny retry-envelope byte bound i per-event reject. Nie zmieniać read:events→write:events bez migracji/projekcji. Reconcile retry z erasure WP05; zachować uzgodnione H.8/H.9.                                                        |
| WP07   | Zgoda                      | SDK wysyła snapshot, writer i reader nie zgadzają się co do JSONB, start/head bez monotonicity.                                  | Jeden kontrakt SDK→writer bytes→PG→rzeczywiste readers. Nie „naprawiać” przez samą tolerancję UI na stringa. W repair legacy zaznaczyć nierozstrzygalny start/head i nie fabrykować danych.                                                       |
| WP08   | Zgoda                      | FOLLOW-1203/2026-09-14 wymaga reject/exclude decyzji, provenance i osobnego harness scope; obecny numerator to CTA.              | Nazwać serwer hosta, migrację caller class i zaakceptowaną politykę replay. Zachować tab session i `ev.ts >= first_decision_ts`. Jawnie opisać, że czas decyzji jest przyjętym punktem atrybucji; sam nie dowodzi zobaczenia DOM przez człowieka. |
| WP09   | Zgoda                      | Source SQL potwierdza kardynalność, cohort mismatch, OR-config i null→0.                                                         | Nie usuwać staff aggregate na podstawie błędnej przesłanki FOLLOW-1303. Poprawki kardynalności/null/config mogą powstawać niezależnie, a końcowa parity musi użyć WP08. Exact SQL na real CH, bez preaggregated mocks jako jedynego dowodu.       |
| WP10   | Zgoda                      | migrate.sh replay + niepowtarzalne CH0018, intent_events bez TTL.                                                                | Wcześnie ledger/bootstrap/retry. Istniejącego stanu nie „adoptować” tylko na podstawie nazw plików. Operator CH0023 według trzech DROP i warunków ticketu; oddzielić local i deployed proof.                                                      |
| WP11   | Zgoda                      | Czytelnicy i wszyscy writerzy cache nie mają source revision. Model uniqueness także rozbieżne.                                  | Oprócz lokalnego epoch wymagać autorytatywnego listing version lub jasno określonego fallback przy lag upstream. Publikacja atomowa; nie wystarczy compare przed osobnym write.                                                                   |
| WP12   | Zgoda, rozszerzyć          | Oba runtime'y przyjmują unsupported facts; sama zgodność cyfr nie zachowuje znaczenia.                                           | Ograniczony zbiór wspieranych transformacji, source/field/unit/relation/negation, poprawione prompts oraz actual jobs. Bez uniwersalnej obietnicy „LLM judge gwarantuje prawdę”. Safe useful adaptation osobno od containment.                    |
| WP13   | Zgoda                      | FOLLOW-1251 dotyczy authored label oraz warunkowo per-slot refusal.                                                              | Dozwolona etykieta slotu nie staje się źródłem cech nieruchomości. Serializować wspólny gateway z WP01/12; przed per-slot sprawdzić ESC-076.                                                                                                      |
| WP14   | Zgoda, aktualizacja startu | FOLLOW-1290 ma istniejący lokalny WIP; 1291 decyzję pomiarową; gateway logika kosztowa istnieje.                                 | Najpierw ocenić/rebazować WIP zamiast pisać drugi counter. Uwzględnić FOLLOW-1304 w normalnym workflow. Zachować zaakceptowane fail-open kosztów, nie wprowadzać nowej polityki budżetu bez decyzji.                                              |
| WP15   | Zgoda                      | SDK ma dziesięć technik, stare identify/tier/DQS/micro-poll nadal w źródle; approved serial chain istnieje.                      | 1292→1294→1293→1296, WP02 invariants przed refaktorem. `micro_polls_enabled` jest kluczem JSONB; nie DROP COLUMN. Obecny zapas bundle 736 B, mierzyć każdy diff.                                                                                  |
| WP16   | Zgoda, aktualizacja        | F-33/F-37 to mieszanka rzeczywistej boundary gap, starych komentarzy i problemów skanera.                                        | Aktualizować statusy różnicowo; nie usuwać historii. Boundary checks w WP06. Gitleaks zawężać per-rule/fixture, nie pozwalać globalnie całych rodzin. Historycznych 30/58 wyników nie przenosić jako fresh scan.                                  |
| WP17   | Zgoda                      | Standard SDK nie daje wektora do RAG; helper SQL istnieje.                                                                       | Jawna opcjonalna deferral jest poprawnym wynikiem zakresowym. Oddzielić od działającego listing grounding i od koniecznej naprawy FAQ UI w używanym onboarding flow.                                                                              |
| WP18   | Zgoda                      | FOLLOW-1297 ostatni, ADR-0023 nie jest jeszcze zaakceptowanym plikiem; overflow publisher ma rzeczywistego caller'a.             | Zamrozić korpus po naprawach WP11/12, nie kopiować zgodnie starej wady. Parytet, p95, rollback i stare in-flight jobs; intent-engine pozostaje. Uwzględnić automatyczny Modal deploy na merge.                                                    |
| WP19   | Zgoda, doprecyzować        | AC8 nadal ocenia zmianę etykiety; obecny GREEN nie dowodzi silniejszego warunku. Main workflow może wywoływać zewnętrzne skutki. | Wszystkie obowiązujące per-PR i final ×3/FRESH; osobne T i B. Plan rollout obejmuje PG i Modal oraz zweryfikowany control-plane deploy. Nie włączać bandita z historycznej instrukcji.                                                            |
| WP20   | Zgoda                      | Pozostałe Snapshot cele są szersze niż usunięcie 37 wad.                                                                         | Osobne specyfikacje i estymacje po decyzji zakresu. Nie przywracać parked funkcji pod pretekstem „100% audytu”.                                                                                                                                   |

## Trzy pierwsze proponowane PR-y

To proponowani właściciele odpowiedzialności, nie faktycznie uruchomione zlecenia dla agentów.
Numery ticketów trzeba przypisać zgodnie z istniejącym workflow; WP/R nie są przydzielonymi
FOLLOW-ID.

### PR 1 — bezpieczne podawanie faktów, z obsługą legacy cache

**Właściciel:** jedna osoba/agent odpowiedzialny za adaptation; QA weryfikuje granice.

Pliki: `apps/llm-gateway/src/jobs/generate_description.py`,
`apps/control-plane/src/lib/llm-gateway.ts`,
`apps/control-plane/src/app/api/adapt/description/route.ts`,
`apps/control-plane/src/app/api/internal/description-cache/route.ts`, odpowiednie cache helpers i
testy. Schemat/migracja validation-version tylko po konkretnym projekcie kompatybilności.

Akceptacja: niepoparte 9.9%, pool/sea-view, gwarancje, price-as-area oraz stary unsafe HIT nie są
podawane ani przyjmowane jako zaufany FIT. Bezpieczna kontrola działa. Prompt nie podpowiada faktów
niewymienionych w źródle. Actual job i gateway wykonywane, nie kopia joba. Jeśli wymagany harness
jest RED wskutek containment, kandydat pozostaje draft i łączy minimalną bezpieczną część WP12;
żadnego fałszowania source/ADAPTED.

Checks: skoncentrowane red-before/green-after, suite'y gateway/cache/Python, affected types/lint,
aktualne required CI i wymagany real harness. Blokery: minimalny wspierany claim contract, legacy
admission i kompatybilność starych jobów; przed merge jawny skutek workflow Modal/PG.

### PR 2 — spójny stan SDK i domknięta druga wiadomość

**Właściciel:** jedna osoba/agent SDK; koordynacja z QA/FOLLOW-1302.

Pliki: `packages/sdk/src/index.ts`, `core/intent.ts`, `core/adapt.ts`, `core/adapt-description.ts`,
`core/session.ts` według potrzeb, istniejące testy lifecycle/intent/FOLLOW-1301. Harness
`tests/e2e/follow-819/*` zmieniać pod właściwym zakresem FOLLOW-1302.

Akceptacja: zachowane znaczniki chat/dwell, stale replies nie nadpisują storage, opt-out i destroy
zamykają immediate/deferred commit, H.9 zachowane. Nowy stamp ze zmianą confidence wysyła najwyżej
jeden potrzebny follow-up; ustalony dwuwiadomościowy pozytywny scenariusz przekracza gate bez
reload. Nie zakładać, że dowolne dwie zgodne wiadomości muszą dać >0.6: w lokalnych fixture
identyczne wymiary dały 0.484, a zmiana standard_mortgage→investment_vehicle dała 0.664. Zapisać
dokładne wiadomości, ekstrakcje i stan początkowy; osobno sprawdzić live NLP. Końcowe
źródło/response/DOM spełnia mocny ADAPTED. Testować stan bezpośrednio po fold oraz późniejsze timery
— to różne momenty obserwacji.

Checks: regresje real init, wybrane/pełne affected SDK suites, build + ≤43136 B, types/lint i
wymagane ×3 real harness. Bloker tylko końcowej pozytywnej oceny: bezpiecznie działający
gateway/FOLLOW-1251. Napraw stanu nie trzeba odkładać do zakończenia całego WP12.

### PR 3 — JWT i kompletna matryca uprawnień do zapisów

**Właściciel:** backend/auth; jeden integrator wspólnych guardów.

Pliki: `packages/auth/src/middleware.ts`, `jwt.ts` według projektu,
`apps/control-plane/src/lib/session-auth.ts`, `tracer-auth.ts`, dotknięte routes admin
intent/quiz/tenants/answers/LIA/detect/activate oraz **listings/embed**. Testy actual handlerów z
controlled stores i negatywną matrycą.

Akceptacja: expired/nbf/nieobsługiwany alg odrzucane; issuer/audience zgodne z faktycznym formatem
emitera; SSR i internal automation zachowane. Readonly nie zapisuje, agency A nie działa na B,
wymagane staff mutation+audit atomowe. Nie zamykać F-10 testem wyłącznie helpera.

Checks: auth suite, affected route suites, real local store gdzie weryfikowana jest atomicity,
types/lint i required CI/harness zgodnie z zakresem. Blokery: uzgodniona lista uprzywilejowanych
automation oraz parametry emitera JWT. R-02 dotyczy innego tokenu, DSR OTP: naprawa w WP05, nie
ukryta w refaktorze JWT.

## Krótki tekst do dołączenia do promptu

```text
Do pierwotnego raportu dołącz ponowną weryfikację z 2026-10-08:
docs/audits/revalidation-2026-10-08/{REVIEW,REPO_MAP,EVIDENCE,CLAUDE_ADDENDUM}.md.
Baza to main b54f472c; aplikacje/pakiety identyczne z 334082c1. Sprawdź delta
od tego SHA i aktualne decyzje. Przegląd nie rozpoczął implementacji.

Zachowaj diagnozę RED i zależności planu, z następującymi uzupełnieniami:
- WP05: Redis SCAN/DEL ma kontrolować HTTP i wyniki komend, z widocznym
  pending/failed oraz ponowieniem. Limit prób OTP ma być atomowy także dla
  równoległych żądań. Sprawdź erase kontra wcześniej przyjęte retry/jobs.
- WP03: rozszerz mutation matrix o /api/listings/embed; zachowaj poprawną
  ścieżkę INTERNAL_API_SECRET. Viewer i expired JWT dzisiaj wywołują zapis.
- WP01/12: popraw również niepoparte twierdzenia w few-shot promptach.
  Modelowe verified_facts_used nie jest zweryfikowaną listą źródeł.
  Regresje muszą uruchamiać rzeczywisty job, nie _run_job kopiujące jego ciało.
- QUEUE/STATUS są już częściowo poprawione. FOLLOW-1290 ma zaparkowany WIP,
  FOLLOW-1304 opisuje jego przeszkodę workflow. Nie dubluj wykonanej pracy.
- ADR-0020 D7 jawnie odkłada monotonic ordering dobrych wyników NLP; nie
  rozszerzaj WP02 o zmianę tego kontraktu bez jawnego rozstrzygnięcia.
- Rule AB pilnuje chwili zapisu DOM. Merge ma osobne zasady; poza PG może
  uruchomić także automatyczny Modal deployment. Zweryfikuj wszystkie skutki.

Zachowaj 18 archetypów, quiz, próg >0.6, frozen bandit, parked zakres i osobne
T/B. 8% traktuj wyłącznie jako dawną metodę liczenia zamkniętych wierszy,
nie miarę ilości gotowego produktu. Estymuj po konkretnych kontraktach.

Własne probes w katalogu audytu odtwarzają błędy: PASS oznacza wadę.
Przed włączeniem jako regresje odwróć oczekiwania do kontraktu produktu
i pokaż red-before/green-after. Historycznych logów nie oznaczaj jako fresh.
```
