# Analiza luk raportu Codex Review — 2026-10-09

Punkt wejścia: [Codex Review](../../CODEX_REVIEW.md). Uzupełnienie raportu źródłowego F-01–F-37 i
lokalnej ponownej weryfikacji R-01/R-02. Seria **G-01–G-12** oznacza kandydatów wymagających
reprodukcji, a nie przydzielone tickety ani zamknięte naprawy. Wagi są wstępne.

## Pochodzenie, metoda i baza

Właściciel repo przekazał niezależny gap check wykonany 2026-10-09. Autor materiału deklaruje
lekturę REVIEW, CLAUDE_ADDENDUM, EVIDENCE i REPO_MAP, wyszukiwanie luk pokrycia oraz odczyt
implementacji; G-01–G-05 sprawdził osobiście, a G-06–G-12 pochodzą od jego agenta badawczego. Nie
przekazano logów reprodukcji nowych G. Przy włączeniu do archiwum Codex sprawdził wszystkie
dwanaście pozycji w źródłach i skorygował poniżej twierdzenia wykraczające poza te dowody.

**Wszystkie G mają dowód S — odczyt implementacji, konfiguracji i powiązanych konsumentów.** Nie
uruchomiono nowych reprodukcji produktu, żywego modelu ani usług produkcyjnych. Odczyt lokalnych
stałych biblioteki i konfiguracji nie jest runtime reprodukcją scenariusza. PASS przyszłej próby
odtwarzającej wadę będzie dowodem jej występowania, nie naprawy. Promocja do ticketu naprawczego
wymaga reprodukcji (dla konfiguracji: testu konkretnego naruszenia jej kontraktu); naprawa wymaga
red-before/green-after i odpowiednich kontroli negatywnych. Nie przydzielono numerów FOLLOW.

Kotwice źródeł odnoszą się do `8730d377`. PR #969 został scalony jako `af926447`; nowa aktualizacja
wychodzi z tego main. Sprawdzono lokalnie:

```bash
git diff --exit-code 334082c1 8730d377 -- apps packages
git diff --exit-code b54f472c 8730d377 -- apps packages
git diff --exit-code 8730d377 af926447 -- apps packages
git diff --exit-code 8730d377 af926447
```

Każde porównanie zakończyło się pustym diffem. Ostatnie potwierdza także zgodność drzew archiwum
przed i po squash merge. Wskazane niżej pliki istnieją; poprawiono przesunięte numery linii i
ścieżkę `apps/llm-gateway/src/jobs/_app.py`. ORIGINAL_CODEX_REPORT.md pozostaje zamrożony; jego
SHA-256 jest zapisany w indeksie i manifeście.

Nie potwierdzono liczby „około 40 nieaudytowanych tras”. W repo jest **68 plików `route.ts`** pod
`apps/control-plane/src/app/api`, ale grep listy tras nie dowodzi kompletnego audytu metod, ról i
ścieżek. Raport źródłowy wzmiankuje retained Stripe webhook w §7.1; brak tam osobnego findingu
dotyczącego jego kolejności zdarzeń. Brak osobnego findingu nie dowodzi braku lektury.

## Tabela zbiorcza

| ID   | Waga wstępna                             | Obszar               | Ustalenie po kwalifikacji S                                                                                         |
| ---- | ---------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| G-01 | Medium                                   | Stripe webhook       | Brak dedupu, kontroli kolejności i bieżącej subskrypcji przy mutacji planu.                                         |
| G-02 | Medium                                   | llm-gateway          | Wyjątek zapisu Redis przerywa job przed trwałym callbackiem PG.                                                     |
| G-03 | Medium                                   | llm-gateway          | Lokalny cap fail-open, niepełna księga kosztów i brak jawnego budżetu timeout/retries klienta.                      |
| G-04 | Medium                                   | intent-engine        | Spłaszczony transcript i brak walidacji słowników/długości tekstowych wymiarów; skuteczność injection niezmierzona. |
| G-05 | Medium–High, warunkowo przy uruchomieniu | data-quality, PARKED | Nieobsłużony błąd wiersza przerywa walidację kolejnych par tenant-domain.                                           |
| G-06 | Medium                                   | llm-gateway seed     | Sekwencyjny wsad może przekroczyć 120 s; brak trwałego checkpoint/requeue w jobie.                                  |
| G-07 | Medium, warunkowo przy uruchomieniu      | data-quality, PARKED | Dedup alertów po tenant, choć wiersze dotyczą tenant-domain.                                                        |
| G-08 | Low–Medium, osiągalność do odtworzenia   | data-quality, PARKED | Fetch URL ze schematu z redirectami bez kontroli publicznego celu i limitu rozmiaru.                                |
| G-09 | Low–Medium                               | ingest/wrangler      | Domyślne i produkcyjne KV oraz nazwy kolejek są wspólne.                                                            |
| G-10 | Low–Medium                               | Python deps          | Brak śledzonego lockfile; deklaracje zależności mają dolne granice.                                                 |
| G-11 | Low                                      | CI                   | Zewnętrzne akcje pinowane do tagów, nie pełnych SHA.                                                                |
| G-12 | Info                                     | Różne                | Drobiazgi kodu i warunkowe ryzyka interpretacji danych.                                                             |

## G-01 — integralność zdarzeń webhooka Stripe

**Medium, S.** `apps/control-plane/src/app/api/webhooks/stripe/route.ts:27–134` weryfikuje podpis, a
następnie wybiera handler po typie zdarzenia. Nie zapisuje `event.id`, nie wykorzystuje
`event.created` ani nie porównuje `subscription.id` z bieżącym `tenants.stripeSubscriptionId` przed
mutacją. Zapis filtruje po `stripeCustomerId`. Nie wszystkie typy mutują dane:
`invoice.payment_succeeded` i nieznane typy są tylko potwierdzane.

Wniosek z kodu: przy przyjęciu poprawnie uwierzytelnionego zdarzenia usunięcia starszej subskrypcji
handler może ustawić `plan='free'`, `status='active'` i wyzerować identyfikator nowszej subskrypcji
tego klienta. Powtórzenie identycznego zdarzenia może tylko ponownie ustawić ten sam stan; brak
dedupu i brak kontroli kolejności są odrębnymi problemami. Nie wykonano podpisanego replay ani nie
potwierdzono konfiguracji dostaw Stripe w produkcji.

`apps/control-plane/src/lib/stripe.ts:55–61` mapuje również pusty price. **Korekta materiału
wejściowego:** `stripePriceToPlan('')` nie zawsze zwraca `observer`. Gdy zmienne cen są ustawione,
nieznany pusty identyfikator trafia do fallbacku `observer`; gdy zmienne są nieustawione, klucze
`''` w mapie się nadpisują, a ostatni może dać `native`. Route podstawia `''` przy braku pozycji
subskrypcji (`:91`).

**Kierunek WP03/WP04:** trwała obsługa `event.id`, zgodność z bieżącą subskrypcją, ustalona
semantyka kolejności/downgrade i brak mutacji przy pustym lub nieznanym price. Sam próg wieku
zdarzenia może odrzucić legalną opóźnioną dostawę — wymaga decyzji biznesowej i testu, nie jest
gotowym kontraktem. Overlay wiersza „L Pricing” z §7.1 oryginału: pricing pozostaje PARKED, ale
retained webhook jest wykonywalnym kodem wymagającym oceny integralności. Nie zmieniać oryginału.

## G-02 — awaria Redis przed trwałym zapisem PG

**Medium, S.** `apps/llm-gateway/src/jobs/generate_description.py:561–572` (NEUTRAL) i `:619–635`
(FIT) wywołują `_write_to_redis` przed `_write_to_postgres_cache`, bez otaczającej obsługi wyjątku.
Writer Redis czyta wymagane zmienne środowiskowe i wykonuje `httpx.post` oraz `raise_for_status()`
(`:2064–2089`). Wyjątek tej ścieżki przerywa job przed callbackiem PG.

Wniosek: wynik już wykonanej generacji może nie zostać utrwalony, a kolejny cache miss może
spowodować ponowną generację i koszt. Nie zmierzono podwójnego obciążenia rachunku. To inna granica
niż ignorowanie błędów usuwania Redis opisane przez R-01.

**Kierunek WP01/WP11:** izolacja błędu Redis i kontynuacja zapisu trwałego albo kolejność PG→Redis z
jawnym wynikiem obu operacji. Zachować wersjonowanie i atomowe dopuszczenie publikacji z F-03; samo
odwrócenie kolejności nie zamyka wyścigu starych wersji. Reprodukcja powinna objąć FIT, NEUTRAL,
błąd transportu/HTTP i negatywną kontrolę starej rewizji.

## G-03 — obserwowalność kosztów i budżet czasu klienta

**Medium, S.** `generate_description.py:309–334` zwraca 0.0 dla braku konfiguracji i błędów odczytu
spend. `:337–395` loguje i połyka błędy insertów kosztów. Gdy zapisy zawodzą, a odczyty działają,
suma `llm_calls` może zaniżać koszt. To lokalny cap joba; nie dowiedziono, że jest jedynym limitem
całego systemu.

`generate_description.py:453` ma limit funkcji 120 s, a konstrukcje `anthropic.Anthropic` przy
`:1326` i `:1958` nie określają `timeout` ani `max_retries`. Lokalnie dostępny pakiet Anthropic
0.102.0 ma `DEFAULT_MAX_RETRIES=2` i `DEFAULT_TIMEOUT` z read/write/pool=600 s, connect=5 s. To
odczyt stałych lokalnej wersji, nie identyfikacja pakietu wdrożonego w Modal ani dowód, że każde
żądanie wykona trzy pełne próby. Brakuje jawnego budżetu obejmującego model, headline, retry i
zapisy przed limitem joba.

**Kierunek WP18, koordynacja WP14/FOLLOW-1290:** metryka/alarm nieodczytanego cap i utraconego
zapisu kosztów, jawne timeout/retries mieszczące się w budżecie funkcji. Fail-open jest
udokumentowanym trade-offem i przyjętym ograniczeniem istniejącego planu; G-03 nie upoważnia do
samodzielnej zmiany tej polityki. Reprodukcje: niedostępny odczyt, niedostępny insert i wolny
provider, z kontrolą kosztu/utrwalenia wyniku.

## G-04 — granica zaufania ekstrakcji chat

**Medium, S; skuteczny prompt injection pozostaje hipotezą do odtworzenia.**
`apps/intent-engine/src/nlp.py:348–355` skleja `role: content`, a `:431–438` przekazuje transcript
jako jedną wiadomość user. Nowa linia w treści może imitować tag roli wewnątrz tekstu; nie zmienia
roli wiadomości w protokole Anthropic. Istnieje system prompt ze słownikami i regułą „tylko jawnie
podane lub silnie implikowane” (`:173–217`) oraz limit wyjścia 512 tokenów (`:140`, `:434`).
Stwierdzenie „brak jakichkolwiek mitigacji” byłoby zbyt szerokie.

`nlp.py:371–397` ogranicza archetype i confidence, a Pydantic sprawdza strukturę i typy.
`apps/intent-engine/src/schemas.py:49–87` zawiera **11 pól `str | None` i jedno `bool | None`**, bez
per-field limitów długości i enumów dla pól słownikowych. `feature_priority` jest z założenia
free-form. Nie należy narzucać mu zamkniętego słownika bez zmiany kontraktu.

`redis_writer.py:48–73,116–129` traktuje dowolny niepusty string jako sygnał i może zastąpić nim
dobry rekord shadow zgodnie z ADR-0020 D3. **Korekta zasięgu:** zapis shadow nie oznacza
bezwarunkowego nadpisania posterioru SDK. `packages/sdk/src/core/intent.ts:1230–1250` pomija pary
niewystępujące w `CHAT_INTENT_LIKELIHOODS`; gdy żadna nie pasuje, zachowuje stan. Przyjęcie wymiaru
spoza słownika i zmanipulowanie rozpoznawanego wymiaru to dwa różne scenariusze. Model nie wybiera
tenant/session; ustawia je worker. Nie dowiedziono wpływu między tenantami.

**Kierunek WP12, zależność WP02:** jawne oddzielenie niezaufanej treści od instrukcji, walidacja
właściwych słowników i długości, zachowanie typu bool oraz free-form tam, gdzie przewiduje go
kontrakt. Test iniekcji z rzeczywistym ekstraktorem, zapis→reader→SDK, kontrola neutralnego tekstu i
błędnego słownika. Same delimitery ani osobne messages nie gwarantują odporności modelu.

## G-05 — brak izolacji błędu pary tenant-domain

**Medium–High warunkowo przy uruchomieniu, S; data-quality pozostaje PARKED.**
`apps/data-quality/src/crons/schema_validation.py:587–800` iteruje po wierszach bez try/except
obejmującego jedną parę tenant-domain. Odczyt JSON i `extract_selectors` mogą rzucić dla
niepoprawnego typu; już zdekodowana lista/skalar może dać TypeError w `json.loads`, a struktura po
dekodowaniu może zawieść na `.get`. Nie każdy przypadek kończy się tym samym AttributeError.
Niepoprawny URL lub błąd DB również może przerwać pętlę. Guard HTTP (`:678–681`) obsługuje
TimeoutException/RequestError, nie wszystkie błędy wiersza.

`validate_schemas` (`:521–551`) ma `finally`, ale nie `capture_exception` dla takiej awarii.
Inicjalizator Sentry (`crons/observability.py:139–171`) wyłącza domyślne integracje i włącza
AtexitIntegration. Nie ma jawnego capture tej ścieżki; nie jest to dowód braku logu awarii w
platformie Modal ani pomiar liczby utraconych alertów.

**Korekta stanu operacyjnego:** w kodzie zachowano `modal.Cron("0 2 * * *")`, lecz FOLLOW-1298
usunął deploy job i produkcyjny `assert-prod-heartbeat`. Pozostały testy detektora. Runbook
`docs/runbooks/DEPLOYMENT_SURFACES.md:23` wymienia operator step zatrzymania aplikacji. Bez odczytu
Modal nie wiadomo, czy został wykonany. Nie stwierdzamy „cron nadal działa” ani „zewnętrzny alarm 26
h na pewno go obserwuje”.

**Kierunek:** izolacja per tenant-domain, jawny capture i wynik error, z rollback/recovery po
błędzie transakcji przed następnym wierszem. Reprodukcja: dobry→uszkodzony→dobry wiersz, awaria
HTTP/DB i oczekiwane zdarzenia telemetryczne. „WP21” jest wyłącznie proponowaną nazwą grupy
G-05/G-07/G-08; nie przyjęto nowego pakietu ani nie wznowiono PARKED.

## G-06 — wsad embeddingów a limit funkcji

**Medium, S.** `apps/llm-gateway/src/jobs/consume_embed_seed_requests.py:110–131` wykonuje
synchroniczny HTTP z `timeout=30.0`; job ma `timeout=120` (`:166–172`) i pętlę sekwencyjną
(`:208–234`). Budżet całego wsadu nie jest ograniczony liczbą listingów do pozostałego czasu.
Timeout HTTP jest konfiguracją operacji klienta, nie dowodem sztywnego czasu wall-clock każdej
iteracji. Duży lub wolny wsad może przekroczyć limit joba.

Moduł nie zapisuje trwałego checkpointu ani nie zleca ponownie nieprzetworzonego ogona. **Korekta:**
błędy poszczególnych listingów mają log i `capture_exception`; nie wszystkie częściowe niepowodzenia
są „ciche”. Nie odtworzono hard timeout, końcowego stanu wsadu ani konfiguracji retry po stronie
wdrożonej platformy. Overflow FOLLOW-435 jest konsumentem tej ścieżki, więc należy go zachować
również przy WP18.

**Kierunek WP18:** ograniczony wsad/równoległość, trwały checkpoint i ponowienie z kontrolą
idempotencji oraz całkowitego budżetu. Reprodukcja musi wykazać odzyskanie ogona po przerwaniu, a
nie tylko obsługę pojedynczego wyjątku HTTP.

## G-07 — zakres deduplikacji alertów

**Medium przy uruchomieniu, S.** `schema_validation.py:404–459` filtruje ostatni alert po
`tenant_id` i rodzaju błędu, bez domeny. Fingerprint drift przy `:783` zawiera tenant i datę, nie
domenę. Pętla pracuje na parach tenant-domain (`:565–574`). Pierwszy zapis drift może więc wyciszyć
alert kolejnej domeny tego samego tenanta na 24 h. Historia drugiej domeny nadal jest zapisywana;
nie twierdzimy, że cały pomiar znika. Analogiczne scope należy sprawdzić dla config_gap i
zero_coverage.

**Kierunek proponowanej grupy data-quality:** uzgodnić tenant-domain jako jednostkę dedupu albo
jawnie przyjąć alert zbiorczy z listą domen. Reprodukcja dwóch domen jednego tenanta i kontroli
drugiego tenanta. Pozostaje zależność od decyzji o wznowieniu PARKED, jak G-05.

## G-08 — URL z zapisanego schematu i redirecty

**Low–Medium wstępnie, S; osiągalność do odtworzenia.** `schema_validation.py:620,667–681` pobiera
`sample_listing_url`, ustawia `follow_redirects=True` i odczytuje `response.text`. Brakuje własnego
guardu publicznego celu/DNS/redirectów oraz limitu liczby bajtów. Klient ma timeout, lecz sam
timeout nie jest limitem rozmiaru. Nie wykonano żądania SSRF.

**Korekta „pole bez writera”:** wyszukiwanie nie znalazło dedykowanego produkcyjnego writera tego
klucza, ale `apps/control-plane/src/app/api/schema/activate/route.ts:61–69,209–233` przyjmuje
`schema: z.unknown()` i zapisuje cały obiekt, również pola dodatkowe (F-27). Brak literalnego
`sample_listing_url` w writerze nie dowodzi, że nie da się go zapisać. Konieczne jest odtworzenie
autoryzowanej aktywacji→JSONB→cron i sprawdzenie warunków wdrożenia; sam termin „latentne” nie
rozstrzyga osiągalności.

**Kierunek WP04 i proponowanej grupy data-quality:** dodać cron do mapy SSRF, sprawdzać każdy cel
przekierowania, jawnie ograniczyć schemat/host i rozmiar. Reprodukcja na kontrolowanym transporcie,
z testem zwykłego publicznego URL; bez łączenia z usługami wewnętrznymi.

## G-09 — współdzielone bindingi konfiguracji ingest

**Low–Medium, S.** `apps/ingest/wrangler.toml:37–49,113–168` deklaruje identyczne namespace ID
KV_API_KEYS/KV_IDEMPOTENCY na poziomie domyślnym i `env.production`; `preview_id == id`. Te same są
nazwy kolejek producer/consumer. `env.dev` nie deklaruje KV. Domyślna nazwa workera to
`estalara-ingest`, a `ENVIRONMENT` to `development`.

Konfiguracja dopuszcza użycie referencji produkcyjnych KV/kolejek przy wdrożeniu bez jawnego
środowiska. Nie wykonano deploy ani nie odczytano zasobów Cloudflare. To samo `class_name` Durable
Object przy innym workerze nie dowodzi współdzielenia tego samego namespace DO. Nie należy też
utożsamiać każdego lokalnego `wrangler dev` ze zdalnym zapisem do KV.

**Kierunek WP16:** jawna polityka default/env, blokada niezamierzonego deploy, rozdzielenie
referencji tam, gdzie wymagane. Test konfiguracji i kontrola resolved bindings przed operacją; nie
proponować odtworzenia wycofanego środowiska staging.

## G-10 — powtarzalność zależności Python

**Low–Medium, S.** Wszystkie trzy `apps/{intent-engine,llm-gateway,data-quality}/pyproject.toml`
używają dolnych granic `>=` dla zależności. `git ls-files` nie zawiera uv.lock, poetry.lock,
Pipfile.lock ani requirements\*.txt. Definicje obrazów powtarzają zakresy w
`apps/intent-engine/src/main.py:43–55`, `apps/llm-gateway/src/jobs/_app.py:49–59` oraz
`apps/data-quality/src/crons/schema_validation.py:134–143`.

Brakuje jednego zamrożonego resolution łączącego testy i deploy. Nowy build obrazu może dobrać inne
wersje, także major dopuszczony zakresem. **Korekta:** nie każdy deploy musi pobrać najnowsze wersje
— możliwe jest użycie wcześniej zbudowanych warstw. Nie wykazano rzeczywistej różnicy zależności
lokalnych i produkcyjnych.

**Kierunek WP18:** lock/resolution używany zarówno przez CI, jak i obrazy Modal, wraz z kontrolowaną
aktualizacją. Sam lockfile ignorowany przez `pip_install` nie zamyka G-10.

## G-11 — przypięcie akcji CI

**Low, S.** W `.github/workflows/*` znaleziono 136 deklaracji `uses:` dla dziewięciu różnych
referencji zewnętrznych akcji. Wszystkie używają tagów (m.in. checkout@v4, setup-node@v4,
dopplerhq/cli-action@v3); żadna pełnego 40-znakowego SHA. Nie znaleziono aktywnego triggera
`pull_request_target`. To obserwacja konfiguracji i propozycja hardeningu, nie dowód kompromitacji
akcji. Przekazywanie sekretu przez env samo w sobie nie dowodzi bezpieczeństwa każdego kroku.

**Kierunek WP16:** SHA-pinning z rejestrem wersji i aktualizacją zależności akcji; zachować
dotychczasowe granice triggerów/sekretów. Pełna lektura ci.yml, uprawnień tokenów i zależności
workflow pozostaje poza ukończonym gap checkiem.

## G-12 — drobne obserwacje do powiązanych prac

**Info, S.** Nie traktować poniższych pozycji jako jednego odtworzonego defektu:

- `consume_embed_seed_requests.py:224`: alternatywa `else` po `isinstance(exc, Exception)` jest
  nieosiągalna wewnątrz `except Exception as exc`.
- `nlp.py:52–60`: komentarz mówi o odczycie przy wywołaniu, choć stałe model IDs czytają env przy
  imporcie. Główny model jest argumentem funkcji; nie oznacza to, że każda zmiana wyboru modelu jest
  nieskuteczna.
- `redis_writer.py:46–48`: konkatenacja `shadow:{tenant}:{session}:chat_intent` jest niejednoznaczna
  dla dowolnych identyfikatorów zawierających `:`. To własność konstruktora, nie dowiedziony
  cross-tenant exploit. Sprawdzić walidację rzeczywistych identyfikatorów i wszystkich callerów.
- `schema_validation.py:584`: niewykorzystywana zmienna `async_client`.
- `schema_validation.py:692–703`: fetch_failed zapisuje coverage i total_selectors jako zero, choć
  listę selektorów już policzono. Pole `error` rozróżnia taki wiersz. Zafałszowanie agregatu wymaga
  wskazania readera, który wlicza błąd jak pomiar; takiego dowodu nie dostarczono.

Pochłonąć przy właściwych WP po kwalifikacji. Nie przydzielać oddzielnych ticketów niskiej wagi z
pominięciem obowiązującego moratorium.

## Obszary przejrzane bez dodatkowych zarzutów w przekazanym materiale

Autor materiału deklaruje grep wszystkich 68 tras API i odczyt wybranych: resolveTenantAccess,
verifyTracerAdminAuth, secretEquals/fail-closed dla CRON/ADMIN/INTERNAL, atomowe staff audit,
crm/outcome, quiz/public-config, internal/retention, demo i tenants root. Jest to spis
zaobserwowanych zabezpieczeń, **nie certyfikat poprawności autoryzacji wszystkich 68 tras**.
F-09/F-10 oraz prawa agency:viewer pozostają otwarte.

Podobnie obserwacje o parametryzowanym SQL i Zod dotyczą wskazanych granic, a F-13 pozostaje
otwarte. Przeszukanie produkcyjnego SDK pod kątem innerHTML/outerHTML/insertAdjacentHTML/
document.write znalazło tylko czyszczenie `card.innerHTML = ''` w quiz-widget.ts:567. Nie jest to
pełny dowód braku XSS, poprawności wszystkich URL/atrybutów ani walidacji każdego JSON.parse.
Przekazany przegląd wskazuje bezpieczne textContent i dodatkowe safeParse quiz-config.

Kod `apps/ingest/src/handlers/events.ts:140–154,327–329` potwierdza auth przed per-tenant rate
limiterem. Origin i consent gate istnieją; nie stanowi to dowodu ich pełnego zakresu, zachowania
wszystkich dróg odrzucenia ani wdrożenia. Znany F-18 dotyczy middleware idempotency przed handlerem;
F-31 dotyczy scopes. Brak nowych G w tym obszarze nie zamyka tych findingów.

## Zbieżności z backlogiem i stanem operacyjnym

Do sprawdzenia przy triage: FOLLOW-750 (historyczna współdzielona konfiguracja Anthropic),
FOLLOW-954 (przegląd dokumentacji CORS), FOLLOW-249 oraz FOLLOW-181 (testy granic RLS/FK). ESC-016
ma w backlogu oznaczenie **RESOLVED**; nie rejestrować go ponownie jako nowej otwartej luki.
Istnienie historycznego wpisu nie potwierdza obecnej konfiguracji kluczy ani otwartego statusu
wszystkich powiązanych prac.

ESCALATIONS odnotowuje „FOLLOW-642 not live”, a implementacja origin gate znajduje się w repo. To
różne osie code/deploy: obecność kodu nie obala wpisu o niewdrożeniu. Stan deploymentu pozostaje
niezweryfikowany; nie poprawiać go na podstawie samego grepa.

Kandydaci zostali wskazani do triage w QUEUE/STATUS, bez numerów FOLLOW, bez przesuwania NEXT i bez
wznowienia data-quality. Mapowanie na WP znajduje się w
[CLAUDE_ADDENDUM](CLAUDE_ADDENDUM.md#uzupełnienie-z-przeglądu-luk-2026-10-09-seria-g).

## Ograniczenia

Autor gap checku zgłosił przerwanie przez limit stawek i brak ukończenia pełnej lektury ci.yml,
głębszej analizy Terraform/otel, ponownego Gitleaks, audytu zależności JS i środowisk live. Te
ograniczenia pozostają; obecna kwalifikacja źródeł nie zastępuje tych prac. Nie wykonano runtime
reprodukcji żadnego G ani produkcyjnego odczytu Modal/Cloudflare/Stripe. Wszystkie wagi oraz wpływ
pozostają wstępne i warunkowe tam, gdzie brakuje dowodu osiągalności.

## Krótki tekst do przyszłych promptów

```text
Archiwum Codex Review zawiera gap check z 2026-10-09, seria G-01–G-12.
Kod apps/packages: 8730d377 ≡ b54f472c ≡ 334082c1 ≡ af926447.
G to dowody S i kandydaci do reprodukcji, nie gotowe tickety ani naprawy.
Najważniejsze: integralność zdarzeń Stripe (G-01), wyjątek Redis przed PG (G-02),
obserwowalność kosztów/budżet timeout (G-03), walidacja ekstrakcji chat i hipoteza
prompt injection (G-04), brak izolacji błędu w data-quality (G-05).
Czytaj GAP_ANALYSIS_2026-10-09.md, EVIDENCE (G), REVIEW §7 i CLAUDE_ADDENDUM (G).
Nie uznawaj 68 tras auth za w pełni czyste; F-09/F-10/F-18/F-31 pozostają otwarte.
SDK pomija nierozpoznane pary wymiarów; to nie usuwa ryzyka nadpisania shadow.
Data-quality pozostaje PARKED, aktywność crona i deployment są niezweryfikowane.
Brak dedykowanego writera sample_listing_url nie wyklucza zapisu przez F-27.
Sprawdź zbieżności FOLLOW-750/954/249/181; ESC-016 jest historycznie RESOLVED.
Oryginał audytu jest zamrożony. Promocja/naprawa wymaga reprodukcji i red-before/
green-after według workflow; PASS reprodukcji wady nie oznacza naprawy.
```

Materiał przygotowany niezależnie, odczytowo, na zlecenie właściciela repozytorium 2026-10-09. Baza:
8730d377 (≡ b54f472c ≡ 334082c1 dla apps/packages); kwalifikacja przy włączeniu do archiwum na
identycznym drzewie af926447. Dowody S — reprodukcja wymagana przed naprawami.
