# Archetype Copy Templates v1 — Opus 4.7-authored (EN + PL + ES)

**Status:** DRAFT — pending Piotr's review. **Date:** 2026-05-15. **Authored by:** Opus 4.7 (this
session). **Companion doc:** `docs/specs/cold-start-protection-v1.md`.

> **⚠️ This spec's token table PREDATES the ESC-075 ruling (2026-08-27) and conflicts with it
> [FOLLOW-1161].** The description templates below are built on `{key_luxury_feature}`,
> `{internet_speed}`, `{university}` and `{yield_range}` — the first three are among the twelve
> tokens ESC-075 removed from shipped copy for having no source anywhere in the estate, and
> `{yield_range}` is the same class. Verified spec-only as of 2026-08-27: none of those tokens
> appears in `packages/*/src` or `apps/*/src` outside this file. **Implementing this table as
> written would move `SERVER_UNREACHABLE_TOKEN_COUNT` off zero and re-open the ruling** — and it
> would do so invisibly to the register gate, which walks `playbook.slots` only and would not see a
> DESCRIPTION template. Re-scope the token table against `SERVER_RESOLVED_PLACEHOLDER_TOKENS` in
> `@estalara/shared` before any implementation ticket is written.

These templates **replace** the current `copy_template.{en|pl|es}` values in
`packages/sdk/src/core/playbooks/archetypes/*.ts`. Per the Cold Start Protection redesign (companion
doc §2):

- The static template is **never the first thing a buyer sees when `listing.description` exists** —
  the agent's original copy is. The template is used only as SEED 2 in the Sonnet three-seed prompt.
- The template **does** render directly in one edge case: when `listing.description` is empty /
  missing entirely (the tenant has not provided agency-authored copy for the listing). In that case
  the endpoint returns `source: 'template_fallback'` for the first buyer too, with the template's
  placeholders resolved from `listing_context`. See §3 below and companion doc §2.

PL and ES templates are **not translations** of the EN versions. Each is written from scratch in the
local market context — Polish copy invokes Polish housing programmes (Bezpieczny Kredyt 2%, KW
documentation), Spanish copy invokes Spanish realities (post-2024 Golden Visa repeal → Non-Lucrative
Visa / Digital Nomad routes, VFT/VUT licensing for STR, ITE inspections). A template that worked in
Manchester would not work in Kraków or Marbella; we don't pretend otherwise.

Voice notes preceding each archetype document the stylistic intent so future editors (humans or
agents) preserve coherence.

---

## 1. first_time_buyer

**Voice:** warm, demystifying, reassuring. Acknowledges the leap from renting to owning. Short,
direct sentences. No jargon — and where it appears, explained.

**EN:**

```
For first-time buyers, this {bedrooms}-bedroom home offers a rare combination — affordability, condition, and a foothold in a neighbourhood that still has room to grow. The asking price sits comfortably within standard mortgage eligibility, and the property has been recently surveyed with no major works flagged. Move-in ready means just that: a working kitchen, a serviced boiler, no immediate renovation budget needed. The layout is straightforward and sensible — no awkward rooms that fight you on day one. {neighborhood} is well-connected by public transport, with everyday shops and a GP surgery within walking distance. Help-to-Buy and shared-ownership pathways may be available subject to eligibility. For anyone making the leap from renting to owning, this property removes most of the things that usually go wrong, and leaves you with the things that go right.
```

**PL:**

```
Dla kupujących pierwsze mieszkanie, ten {bedrooms}-pokojowy lokal łączy trzy rzeczy, które rzadko spotyka się razem: cenę, stan i lokalizację. Kwota mieści się komfortowo w widełkach standardowej zdolności kredytowej, a księga wieczysta jest wolna od istotnych obciążeń. „Do wprowadzenia" znaczy tutaj dokładnie tyle — działająca kuchnia, przegląd instalacji aktualny, brak pilnych remontów na start. Układ jest logiczny: bez wąskich gardeł, bez pokoi przejściowych, bez niespodzianek. {neighborhood} jest dobrze skomunikowana z centrum, ze sklepami osiedlowymi i przychodnią POZ w zasięgu spaceru. W zależności od sytuacji kupujący mogą skorzystać z programu Bezpieczny Kredyt 2% lub innych form wsparcia młodych nabywców. Dla osób przechodzących z najmu na własność — mieszkanie, które usuwa większość rzeczy, które zwykle idą nie tak, i zostawia te, które idą jak należy.
```

**ES:**

```
Para quienes compran su primera vivienda, esta casa de {bedrooms} dormitorios reúne tres factores que rara vez aparecen juntos: precio asequible, buen estado y ubicación con margen para revalorizar. El importe encaja cómodamente dentro de los baremos estándar de capacidad hipotecaria, y el inmueble cuenta con una nota simple actualizada sin cargas relevantes. «Listo para entrar a vivir» significa exactamente eso — cocina funcional, instalaciones revisadas, sin obras urgentes en el horizonte inmediato. La distribución es lógica y sensata, sin pasillos perdidos ni habitaciones difíciles. {neighborhood} cuenta con buena comunicación por transporte público, comercios de proximidad y centro de salud accesibles a pie. Programas como las ayudas al alquiler joven o la hipoteca ICO pueden ser de aplicación según las circunstancias del comprador. Para quien da el salto del alquiler a la propiedad, esta vivienda elimina la mayor parte de los problemas que suelen aparecer y deja lo que de verdad importa.
```

---

## 2. family_buyer

**Voice:** practical with quiet emotional undertone. Long-arc framing — this is a decade-plus
decision, not a transaction.

**EN:**

```
A home built for the long arc of family life. The {bedrooms}-bedroom layout gives each child a room of their own, with a flexible additional space that adapts as needs change — playroom now, study later, guest room when grandparents visit. The garden is properly proportioned: large enough for football and a small trampoline, small enough that maintenance stays manageable through busy years. {neighborhood}'s primary and secondary catchments are both well-regarded, with school-run distances measured in minutes rather than miles. The street is residential and quiet, with a park at the end of the road and neighbours who know each other by name. The kitchen-diner is the kind of room where homework happens at one end while dinner cooks at the other. A house that will hold a family well as it grows.
```

**PL:**

```
Dom skrojony pod długą perspektywę życia rodzinnego. Układ {bedrooms}-pokojowy daje każdemu dziecku własny pokój, plus pomieszczenie elastyczne, które zmienia funkcję wraz z wiekiem rodziny — pokój zabaw teraz, pokój do nauki za parę lat, sypialnia dla dziadków gdy przyjeżdżają. Ogród ma rozmiar, który ma sens: wystarczająco duży na piłkę, trampolinę i niedzielny grill, wystarczająco mały by koszenie nie zajmowało całego sobotniego poranka. {neighborhood} oferuje rejonizację do dobrze ocenianych szkół podstawowych i ponadpodstawowych, a droga na lekcje to minuty, nie kilometry. Ulica jest spokojna, ruch lokalny, plac zabaw w zasięgu wzroku z balkonu. Kuchnia z jadalnią to ten typ przestrzeni, gdzie z jednej strony lądują zeszyty do odrobienia, a z drugiej kolacja. Dom, który dobrze niesie rodzinę przez kolejne lata.
```

**ES:**

```
Una vivienda pensada para el largo plazo de la vida familiar. La distribución de {bedrooms} dormitorios garantiza a cada hijo su propia habitación, con un espacio adicional flexible que se adapta a cada etapa — zona de juegos hoy, despacho de estudio mañana, habitación de invitados cuando vienen los abuelos. El jardín está perfectamente dimensionado: suficientemente amplio para fútbol y trampolín, suficientemente contenido para que el mantenimiento no consuma los fines de semana. {neighborhood} dispone de buena oferta de colegios públicos, concertados y privados — todos accesibles en distancias razonables, no en kilómetros. La calle es residencial y tranquila, con parque al final de la manzana y vecinos que se conocen por nombre. La cocina-comedor tiene esa cualidad de espacio donde los deberes ocurren en un extremo mientras la cena se prepara en el otro. Una casa diseñada para sostener bien a una familia mientras crece.
```

---

## 3. upsizer

**Voice:** aspirational, "next chapter" framing. Implicit comparison to a smaller starter home the
buyer is leaving.

**EN:**

```
For families ready to move on from a starter home, this property is the natural next step. An additional bedroom over your current home — and a layout that finally gives everyone their own space to breathe. The {bedrooms}-bedroom plan flexes around real life: a separate dining room for slower evenings, a snug for the children, a primary suite that feels deliberately removed from the daily noise. The garden adds proper outdoor room for entertaining or simply spreading out. Potential for further extension at the side has been confirmed via the local planning office, should the family continue to grow. Schools in {neighborhood} hold strong reputations, and the village high street is close enough for spontaneous coffees. This is a home for the years when the children are at their most demanding and you most need the space to absorb them.
```

**PL:**

```
Dla rodzin gotowych zostawić pierwsze mieszkanie za sobą — naturalny kolejny krok. Dodatkowa sypialnia względem dotychczasowego lokum i układ, który wreszcie pozwala każdemu mieć swoje miejsce do oddechu. Plan {bedrooms}-pokojowy działa pod realne życie: osobna jadalnia na wolniejsze wieczory, kącik dla dzieci, sypialnia główna celowo odsunięta od codziennego zgiełku. Ogród lub duży taras dokłada przestrzeń na przyjmowanie gości albo po prostu rozproszenie się po pracy. Szkoły w {neighborhood} mają mocną reputację, a najbliższe centrum handlowe jest na tyle blisko, że spontaniczna kawa pozostaje opcją. Wskazana opcja dalszej rozbudowy została wstępnie skonsultowana z wydziałem architektury urzędu gminy, gdyby rodzina nadal się powiększała. Dom na lata, kiedy dzieci są najbardziej wymagające, a ty najbardziej potrzebujesz przestrzeni, która je pomieści.
```

**ES:**

```
Para familias listas para dejar atrás su primer piso, esta vivienda es el siguiente paso natural. Una habitación más de la que tienen ahora — y una distribución que por fin permite que cada miembro de la familia tenga su propio espacio para respirar. El plano de {bedrooms} dormitorios se adapta a la vida real: comedor separado para cenas pausadas, salita para los niños, dormitorio principal deliberadamente alejado del ruido cotidiano. El jardín o terraza añade el espacio exterior necesario para recibir o simplemente extenderse. La posibilidad de ampliación adicional ha sido contrastada con el Ayuntamiento, si la familia continúa creciendo. Los colegios de {neighborhood} mantienen buena reputación, y el centro está suficientemente cerca para mantener los cafés espontáneos. Esta es una casa para los años en que los hijos son más exigentes y los padres más necesitan el espacio para absorber esa intensidad.
```

---

## 4. downsizer

**Voice:** calm, considered, age-respectful (never patronising). Emphasis on engineering-out
maintenance and engineering-in community.

**EN:**

```
A home designed to make the next stage of life easier, not smaller in any meaningful sense. The {bedrooms}-bedroom layout is arranged on a single floor with wide doorways and step-free access throughout, so day-to-day mobility never becomes an obstacle. Maintenance has been deliberately engineered out: a low-maintenance garden, modern condensing boiler under warranty, double-glazing throughout, and a recent re-roof. The kitchen and bathroom were refitted within the last three years to a comfortable, age-friendly specification with lever taps and a walk-in shower. {neighborhood} brings together the things that matter at this stage — a friendly GP surgery, a pharmacy, a good café, a regular bus to the town centre, and a community hall that runs an active programme. Smaller in square metres, larger in everything that makes a home work simply and well.
```

**PL:**

```
Mieszkanie zaprojektowane tak, by kolejny etap życia był łatwiejszy — nie mniejszy w sensach, które mają znaczenie. Układ {bedrooms}-pokojowy mieści się na jednym poziomie, z szerokimi drzwiami i bez progów, więc codzienne poruszanie się nigdy nie staje się problemem. Budynek ma sprawną windę, a sam lokal — minimalizm konserwacji wbudowany w wybór materiałów: nowoczesny piec dwufunkcyjny z gwarancją, okna trzyszybowe wymienione w ubiegłym roku, świeży przegląd instalacji elektrycznej i gazowej. Kuchnia i łazienka zostały odświeżone w ciągu ostatnich trzech lat — bateria z dźwignią, prysznic walk-in. {neighborhood} łączy rzeczy ważne na tym etapie: przyjazną przychodnię POZ, aptekę w sąsiedztwie, regularny autobus do centrum i lokalny dom kultury z aktywnym programem dla seniorów. Mniej metrów kwadratowych, więcej tego, co naprawdę liczy się w codziennym domu.
```

**ES:**

```
Una vivienda diseñada para hacer la siguiente etapa de la vida más sencilla, no más pequeña en lo que de verdad importa. La distribución de {bedrooms} dormitorios se desarrolla en una sola planta con anchos de puerta generosos y accesos sin escalones, de modo que la movilidad diaria nunca se convierte en obstáculo. El mantenimiento se ha minimizado deliberadamente: jardín de bajo mantenimiento, caldera de condensación moderna en garantía, ventanas con doble acristalamiento, cubierta reciente. La cocina y el baño se han reformado en los últimos tres años con especificación cómoda para esta etapa — grifería de palanca, ducha de obra a nivel. {neighborhood} reúne lo que más importa en este momento: un centro de salud cercano, farmacia accesible, cafetería de barrio, transporte público regular hacia el centro y un centro cultural con programa activo. Menos metros, más de lo que de verdad hace que una casa funcione bien.
```

---

## 5. luxury_buyer

**Voice:** confident, restrained, prestige-aware. Avoids superlative inflation. Materials
specificity. Discretion as a value, not an absence.

**EN:**

```
An exceptional residence where architectural distinction meets uncompromising quality. {key_luxury_feature} distinguishes this property from the broader market — a defining characteristic that cannot be retrofitted or imitated. Materials throughout reflect considered choices: imported stone, bespoke joinery, and integrated smart-home systems engineered for invisibility rather than display. Floor-to-ceiling glazing frames views that change with the season. A dedicated concierge manages day-to-day operations from maintenance scheduling to private event coordination, and the building offers secure underground parking, a private gym, and a temperature-controlled wine room. {neighborhood} remains one of the most discreet of the city's prestige addresses — close enough to its cultural and culinary landmarks to feel central, far enough to insulate residents from the casual traffic of central life. Offered by private appointment only.
```

**PL:**

```
Nieruchomość, w której architektoniczna klasa spotyka się z bezkompromisową jakością wykonania. {key_luxury_feature} wyróżnia ten apartament na tle reszty rynku — cechę, której nie da się dorobić po fakcie. Materiały odzwierciedlają przemyślane wybory: kamień naturalny sprowadzony bezpośrednio z włoskiego kamieniołomu, stolarka projektowana indywidualnie, integrowane systemy smart-home stworzone z myślą o niewidoczności, nie demonstracji. Przeszklenia od podłogi do sufitu kadrują widoki, które zmieniają się z porą roku. Conciérge prowadzi codzienną obsługę — od harmonogramu konserwacji po koordynację wydarzeń prywatnych — a budynek oferuje strzeżony parking podziemny, prywatną siłownię i klimatyzowane piwnice winne. {neighborhood} pozostaje jednym z najbardziej dyskretnych prestiżowych adresów miasta — wystarczająco blisko jego kulinarnych i kulturalnych punktów odniesienia, by czuć centrum, dostatecznie daleko, by odgrodzić się od jego ruchu. Pokazujemy wyłącznie po wcześniejszym umówieniu.
```

**ES:**

```
Una residencia excepcional donde la distinción arquitectónica converge con una calidad sin concesiones. {key_luxury_feature} singulariza esta propiedad frente al resto del mercado — una característica definitoria que no puede añadirse a posteriori. Los materiales reflejan elecciones meditadas: piedra importada, ebanistería a medida, sistemas domóticos integrados diseñados para la invisibilidad antes que para la exhibición. Los acristalamientos de suelo a techo enmarcan vistas que cambian con cada estación. Un conserje dedicado gestiona la operativa diaria — desde el calendario de mantenimiento hasta la coordinación de eventos privados — y el edificio dispone de aparcamiento subterráneo de seguridad, gimnasio privado y bodega climatizada. {neighborhood} permanece como una de las direcciones de prestigio más discretas de la ciudad — lo suficientemente cerca de sus referentes culturales y gastronómicos para sentirse central, lo suficientemente apartada para aislarse del tráfico cotidiano del centro. Se muestra exclusivamente con cita previa.
```

---

## 6. lifestyle_expat

**Voice:** welcoming, practical, internationally fluent. Acknowledges relocation friction directly
and explains how it has been resolved. Multi-curriculum, multilingual context.

Market note: in PL the strong expat hubs are Warszawa, Kraków, Wrocław (smaller community vs ES); in
ES the strong hubs are Costa del Sol, Costa Blanca, Mallorca, Barcelona (very large, mature
community).

**EN:**

```
Positioned in {neighborhood}, one of the area's most established international communities, this home is designed to make relocation feel manageable rather than overwhelming. International schools serving British, American, French, and IB curricula sit within a short drive. English-speaking estate agents, solicitors, accountants, and medical practitioners operate throughout the district, and a network of relocation-support services handles everything from utilities to residency paperwork. The expat social scene is active without being exclusive — international supper clubs, language exchanges, and a thriving community of professionals who have settled here long-term. Public transport is reliable, and the international airport is accessible in under an hour. The property itself is move-in ready, with all major utilities in place and a furniture-inclusive option available. For professionals and families arriving from abroad, this address offers community, infrastructure, and a genuine welcome.
```

**PL:**

```
Położenie w {neighborhood} — jednej z lokalizacji najlepiej zintegrowanych z międzynarodową społecznością mieszkańców Polski — sprawia, że relokacja przestaje być przedsięwzięciem na trzy miesiące. Szkoły międzynarodowe (British School, American School, École Française, IB) są w zasięgu krótkiego dojazdu. Lokalni pośrednicy nieruchomości, prawnicy, księgowi i lekarze pracują również po angielsku, a sieć usług relokacyjnych obsługuje wszystko od podpisania umowy z dostawcami mediów po formalności pobytowe i meldunkowe. Społeczność ekspacka jest aktywna, ale nie zamknięta — międzynarodowe kolacje, wymiany językowe, ludzie którzy zostali tu na lata. Transport publiczny działa przewidywalnie, a lotnisko Chopina lub Balice są w zasięgu trzydziestu minut. Sam lokal jest gotowy do wprowadzenia — z opcją wynajęcia razem z meblami. Dla profesjonalistów i rodzin przybywających z zagranicy: adres, który oferuje społeczność, infrastrukturę i autentyczne powitanie.
```

**ES:**

```
Situada en {neighborhood}, una de las comunidades internacionales más consolidadas de la zona, esta vivienda convierte la relocalización en algo manejable y no en un proyecto agotador. Colegios internacionales con currículos británico, americano, francés y BI se encuentran a una distancia corta. Asesores inmobiliarios, abogados, gestores y profesionales sanitarios atienden habitualmente en inglés, y existe una red de servicios de relocalización que cubre desde los suministros básicos hasta los trámites de residencia. La comunidad expatriada es activa sin ser cerrada — clubs internacionales, intercambios de idiomas, profesionales que han echado raíces aquí durante décadas. El transporte público funciona con fiabilidad, y el aeropuerto internacional está accesible en menos de una hora. La vivienda se entrega lista para entrar a vivir, con todos los suministros operativos y opción de adquisición amueblada. Para profesionales y familias que llegan desde fuera, esta dirección ofrece comunidad, infraestructura y una bienvenida genuina.
```

---

## 7. remote_worker

**Voice:** practical, productivity-led, slightly technical. Acknowledges the failure modes of bad
remote-work setups.

**EN:**

```
Built for the location-independent professional, this home prioritises the two things remote work genuinely depends on: dedicated workspace and uncompromised connectivity. A separate study, with its own door, provides the acoustic and visual separation needed for back-to-back video calls without the rest of the household drifting through the frame. Full-fibre broadband delivering {internet_speed}Mbps is already installed and on a business-grade contract. Morning light fills the main working area through east-facing windows, reducing eye strain through long sessions in front of screens. The living spaces are equally well-considered — generous enough to genuinely decompress after working hours, calm enough to stay focused during them. A co-working café is five minutes away for the days when a change of scene helps, and {neighborhood} has reliable mobile coverage on all major networks. Designed around how knowledge work actually happens.
```

**PL:**

```
Mieszkanie zbudowane pod profesjonalistę pracującego z dowolnego miejsca — z naciskiem na dwie rzeczy, na których praca zdalna naprawdę stoi: dedykowaną przestrzeń pracy i bezkompromisową łączność. Osobny gabinet z drzwiami, które się zamykają, daje akustyczną i wizualną separację potrzebną do back-to-back spotkań video bez wchodzenia reszty domu w kadr. Światłowód {internet_speed} Mbps jest już podpięty, na pakiecie biznesowym. Poranne światło wpada do strefy pracy przez okna wschodnie, redukując zmęczenie wzroku przy długich sesjach. Strefa dzienna jest równie przemyślana — wystarczająco przestronna, by faktycznie odciąć się po godzinach, wystarczająco spokojna, by się skupić w trakcie. Co-working café jest pięć minut piechotą, gdy zmiana scenerii pomaga, a {neighborhood} ma dobry zasięg wszystkich sieci komórkowych. Mieszkanie zaprojektowane wokół tego, jak praca biurowa wygląda dziś naprawdę.
```

**ES:**

```
Una vivienda concebida para el profesional independiente de la ubicación, con énfasis en los dos elementos sobre los que el trabajo remoto realmente se sostiene: espacio de trabajo dedicado y conectividad sin compromisos. Un despacho independiente, con puerta propia, ofrece la separación acústica y visual necesaria para encadenar videollamadas sin que el resto de la casa irrumpa en la imagen. Fibra simétrica de {internet_speed} Mbps ya está instalada en tarifa profesional. La luz natural de la mañana inunda la zona principal de trabajo a través de ventanas orientadas al este, reduciendo la fatiga visual durante jornadas largas frente a pantalla. Las zonas comunes están igualmente bien resueltas — suficientemente amplias para desconectar de verdad al final del día. Un espacio de coworking se encuentra a cinco minutos, para los días en que conviene cambiar de escenario, y {neighborhood} ofrece buena cobertura móvil en todas las operadoras. Una casa diseñada en torno a cómo el trabajo del conocimiento sucede hoy.
```

---

## 8. retiree_relocator

**Voice:** warm but unsentimental. Climate, healthcare, value — in that order.

Market note: in PL this archetype is less common as a destination market — most Polish retirees stay
local; the template is calibrated for retirees moving from large Polish cities to smaller, cheaper
towns, or for returning diaspora. In ES this is a primary inbound market — UK, German, Dutch, Nordic
retirees on the Costa del Sol, Costa Blanca, Mallorca — so the ES template can be confidently
literal about climate, healthcare, and cost-of-living differential.

**EN:**

```
For retirees seeking a quieter rhythm in a more forgiving climate, {neighborhood} offers warm winters, predictable weather, and a healthcare system rated among the region's most accessible. This {bedrooms}-bedroom property is arranged for low-effort daily life: single-storey living, an easy garden, a walking-distance pharmacy and clinic, and a long-established expat community that has done the heavy lifting on local integration. Cost of living comfortably below most northern European baselines means a fixed income stretches notably further — restaurants, household help, transport, and routine medical care all priced for everyday use rather than special occasions. The property includes secure parking and is within a short drive of the international airport for visits home. Sun, healthcare, value, and an unhurried community — the four ingredients most retirees prioritise, in proportions that actually work.
```

**PL:**

```
Dla osób na emeryturze szukających spokojniejszego rytmu w lepszym klimacie, {neighborhood} łączy łagodne, pełne słońca lata z dobrze rozwiniętą lokalną opieką zdrowotną. {bedrooms}-pokojowe mieszkanie jest tak ułożone, by codzienność była niskim wysiłkiem: jedna kondygnacja, sprawna winda w budynku, apteka i przychodnia POZ w zasięgu spaceru, długo istniejąca lokalna społeczność, która ułatwia wejście w okolicę. Koszty życia wyraźnie niższe niż w Warszawie czy Krakowie sprawiają, że stała emerytura starcza więcej — codzienna obsługa, transport publiczny, lokale gastronomiczne wszystko wycenione pod codzienność, nie pod święta. Parking przed budynkiem, lotnisko regionalne w pół godziny — dla odwiedzin rodziny czy podróży za granicę. Słońce, opieka, sensowne ceny, niespiesznie funkcjonująca okolica — w proporcjach, które naprawdę działają.
```

**ES:**

```
Para jubilados que buscan un ritmo más pausado en un clima más generoso, {neighborhood} ofrece inviernos suaves, tiempo predecible y un sistema sanitario valorado entre los más accesibles de Europa. Esta vivienda de {bedrooms} dormitorios está dispuesta para una vida cotidiana de bajo esfuerzo: una sola planta, jardín fácil, farmacia y centro de salud accesibles a pie, y una comunidad expatriada de larga trayectoria que ha resuelto la integración local antes de tu llegada. El coste de vida significativamente por debajo de la mayoría de referencias del norte de Europa significa que una pensión fija rinde notablemente más — restaurantes, ayuda doméstica, transporte y atención médica rutinaria todos a precios cotidianos. La vivienda incluye plaza de aparcamiento y se encuentra a un corto trayecto del aeropuerto internacional para las visitas familiares. Sol, sanidad, valor y una comunidad sin prisas — los cuatro ingredientes que la mayoría de jubilados prioriza, en las proporciones que de verdad funcionan.
```

---

## 9. diaspora_buyer

**Voice:** respectful of dual identity. Acknowledges that the purchase serves multiple roles across
generations. Long-horizon, quietly emotional.

Market note: very strong archetype in PL (Polish diaspora in UK, USA, Germany buying back home).
Also relevant in ES (Latin American buyers, returning Spanish-Argentinians).

**EN:**

```
For buyers maintaining a foothold in their country of origin, this property offers what the diaspora purchase typically asks for: a credible home for extended-family visits, a hedge in familiar currency, and a long-term store of value in a market the buyer already understands intuitively. {neighborhood}'s established residential character, schools, and proximity to the airport make it equally suitable as a base for older relatives, a place for children's summers, or a future return-home residence. The {bedrooms}-bedroom layout accommodates multi-generational stays without forcing compromises on privacy. Property management options are well-developed locally, supporting absentee-ownership during the years when the family remains based abroad. Currency conversion, remittance, and cross-border tax planning are routinely handled by local advisors who specialise in diaspora cases. A property that holds both meaning and value across the years and the miles.
```

**PL:**

```
Dla Polaków utrzymujących stopę w kraju z zagranicy, ta nieruchomość oferuje to, czego zwykle szuka zakup z dystansu: wiarygodne mieszkanie na rodzinne wizyty, zabezpieczenie wartości w polskiej walucie i długoterminowe oparcie w rynku, który kupujący zna intuicyjnie. {neighborhood} z ustabilizowanym charakterem mieszkalnym, dobrymi szkołami i bliskością lotniska sprawdza się równie dobrze jako baza dla starszych rodziców, miejsce wakacji dzieci wychowanych za granicą, lub przyszły powrót do kraju. Układ {bedrooms}-pokojowy mieści wizyty wielopokoleniowe bez kompromisów co do prywatności. Lokalne firmy zarządzające najmem mają doświadczenie w obsłudze nieruchomości właścicieli mieszkających za granicą — od kontroli okresowych po rozliczenia z fiskusem. Wymiana waluty, przelewy międzynarodowe i planowanie podatkowe są standardowo obsługiwane przez polskich doradców specjalizujących się w sprawach diaspory. Nieruchomość, która niesie znaczenie i wartość przez lata i kilometry.
```

**ES:**

```
Para compradores que mantienen un anclaje en su país de origen, esta propiedad ofrece lo que la compra de la diáspora suele requerir: una vivienda creíble para visitas familiares prolongadas, una cobertura de valor en moneda conocida y un depósito de valor a largo plazo en un mercado que el comprador entiende intuitivamente. El carácter residencial consolidado de {neighborhood}, su oferta educativa y su proximidad al aeropuerto la convierten en una base igualmente válida como vivienda para familiares mayores, casa de veranos para los hijos crecidos fuera, o futura residencia de retorno. La distribución de {bedrooms} dormitorios acoge estancias multigeneracionales sin imponer compromisos sobre la intimidad. Las gestoras locales de alquiler tienen experiencia con propietarios residentes fuera — desde inspecciones periódicas hasta liquidaciones fiscales. Cambio de divisa, transferencias internacionales y planificación fiscal transfronteriza son rutinariamente atendidas por asesores locales especializados en casos de diáspora. Una propiedad que mantiene significado y valor a lo largo de los años y las distancias.
```

---

## 10. second_home_buyer

**Voice:** leisure-led, with quiet financial pragmatism. Lifestyle first, asset performance second.

Market note: PL leisure anchors include Mazury, Bałtyk, Tatry, Bieszczady. ES leisure anchors
include Costa del Sol, Mallorca, Ibiza, Costa Brava.

**EN:**

```
A second home is a decision about lifestyle first and economics second, and this property is designed accordingly. {neighborhood} delivers the leisure ingredients you can't manufacture — proximity to {leisure_anchor}, mild seasonality, a genuine local community rather than a tourist-only veneer. The {bedrooms}-bedroom layout is configured for short-stay use: an easy kitchen, generous living space for guests, low-maintenance finishes that won't punish you for a four-month gap between visits. When the property isn't in personal use, the short-term rental market here is healthy and the building permits holiday letting, generating useful offset against running costs. A reputable local management company can handle bookings, cleaning, and turnaround end-to-end. Travel access is convenient: an airport within forty minutes and direct connections to major source cities. A weekend life, a holiday base, and an asset that earns its keep.
```

**PL:**

```
Drugi dom to przede wszystkim decyzja o jakości życia, a ekonomia idzie w drugiej kolejności — i ta nieruchomość zaprojektowana jest dokładnie w tej kolejności. {neighborhood} dostarcza atrakcji, których nie da się zbudować sztucznie: bliskość {leisure_anchor}, prawdziwą lokalną społeczność a nie wyłącznie sezon turystyczny, sensowną przyrodę dookoła. Układ {bedrooms}-pokojowy jest dostosowany pod krótkie pobyty: prosta kuchnia, hojna strefa dzienna dla gości, materiały odporne na cztery miesiące przerwy między wizytami. Gdy mieszkanie nie jest w użytku własnym, lokalny rynek najmu krótkoterminowego jest aktywny, a wspólnota mieszkaniowa zezwala na wynajem dobowy — co generuje sensowny offset na koszty stałe. Sprawdzona miejscowa firma zarządzająca może obsłużyć rezerwacje, sprzątanie i wymianę gości end-to-end. Dojazd jest wygodny: autostrada lub bezpośrednie połączenia kolejowe z głównymi miastami źródłowymi. Życie weekendowe, baza wakacyjna i aktywo, które się utrzymuje.
```

**ES:**

```
Una segunda residencia es ante todo una decisión sobre el estilo de vida y, en segundo término, sobre la rentabilidad — y esta propiedad está concebida exactamente en ese orden. {neighborhood} aporta los ingredientes de ocio que no pueden fabricarse: proximidad a {leisure_anchor}, una estacionalidad amable, una comunidad local auténtica en lugar de un revestimiento puramente turístico. La distribución de {bedrooms} dormitorios está pensada para uso de estancia corta: cocina sencilla, salón generoso para acoger a los invitados, acabados de bajo mantenimiento que no penalicen los meses entre visitas. Cuando la vivienda no está en uso propio, el mercado local de alquiler vacacional es saludable y la comunidad permite el alquiler turístico, generando una compensación útil frente a los costes operativos. Una gestora local de buena reputación puede encargarse de las reservas, la limpieza y los cambios de huéspedes de extremo a extremo. El acceso es cómodo: aeropuerto a menos de cuarenta minutos. Una vida de fines de semana, una base de vacaciones y un activo que se sostiene económicamente.
```

---

## 11. student_parent

**Voice:** pragmatic, dual-use (live now / let later). Parental rather than student perspective.

Market note: PL `{university}` typically resolves to UJ (Kraków), UW (Warszawa), UWr (Wrocław), AGH;
ES typically Universidad Complutense (Madrid), UAM, Universidad de Barcelona, UPV.

**EN:**

```
For parents purchasing alongside a university-age child, this property is sized and located to do double duty: a comfortable base for student years and a credible rental investment afterwards. {bedrooms} bedrooms allow the student to host visiting siblings, parents, or a flatmate or two during the degree, and the layout supports both quiet study and occasional social life. {neighborhood} sits within a walk or short cycle of the {university} campus, with local shops and libraries on the same route. Once the degree concludes, demand from incoming postgraduate and young-professional tenants makes the property a straightforward let, with gross yields locally in the {yield_range} band. Finishes have been chosen for durability rather than fragility — a sensible decision for either a student tenant or a future buy-to-let. A four-year solution that converts cleanly into a long-term holding.
```

**PL:**

```
Dla rodziców kupujących mieszkanie wspólnie z dzieckiem rozpoczynającym studia, ta nieruchomość jest sensownie zwymiarowana i ulokowana do podwójnej funkcji: komfortowa baza na lata uczelni i wiarygodne mieszkanie pod wynajem po dyplomie. {bedrooms} pokoje pozwalają studentowi gościć rodzeństwo, rodziców lub współlokatorów na okres akademii, a układ łączy spokojną strefę do nauki z możliwością okazjonalnego życia towarzyskiego. {neighborhood} jest w zasięgu spaceru lub krótkiego dojazdu rowerem do kampusu {university}, z lokalnymi sklepami i bibliotekami na tej samej trasie. Po zakończeniu studiów popyt ze strony młodych specjalistów i doktorantów czyni z lokalu prosty produkt najmu, z rentownością brutto w okolicy {yield_range}. Wykończenia dobierano pod trwałość, nie pod kruchość — sensowna decyzja zarówno dla studenta jak i przyszłego najemcy. Rozwiązanie na cztery lata, które czysto przechodzi w inwestycję długoterminową.
```

**ES:**

```
Para padres que adquieren una vivienda junto a un hijo en edad universitaria, esta propiedad está dimensionada y ubicada para una doble función: una base cómoda durante los años de estudio y una inversión inmobiliaria creíble después. {bedrooms} dormitorios permiten al estudiante alojar hermanos, padres o uno o dos compañeros de piso durante la carrera, y la distribución sostiene tanto el estudio tranquilo como la vida social ocasional. {neighborhood} se encuentra a distancia caminable o en bici corta del campus de {university}, con comercios locales y bibliotecas en el mismo recorrido. Concluida la carrera, la demanda de postgraduados y jóvenes profesionales entrantes convierte la propiedad en un alquiler sencillo, con rentabilidad bruta local en el rango {yield_range}. Los acabados se han elegido por su durabilidad antes que por su fragilidad — una decisión sensata tanto para un inquilino estudiante como para un futuro inversor buy-to-let. Una solución de cuatro años que se transforma limpiamente en una posición a largo plazo.
```

---

## 12. golden_visa_buyer

**Voice:** formal, institutional, residency-pathway-led.

Market note: this archetype's regulatory anchor differs sharply by country.

- EN template assumes a country that actively runs a Golden Visa programme (Portugal until 2023,
  Greece, UAE, several Caribbean states). Generic enough to fit most.
- PL has **no Golden Visa scheme.** The PL template reframes around general long-term residency
  routes available to foreign investors (karta pobytu rezydenta długoterminowego UE, działalność
  gospodarcza, employment-based permits) without claiming a residency-by-investment programme that
  does not exist locally.
- ES **repealed its Golden Visa programme in 2024.** The ES template reframes around the
  Non-Lucrative Visa, Digital Nomad Visa, and substantial-investment pathways that remain available,
  and explicitly notes the Golden Visa repeal so the copy stays factually current.

**EN:**

```
This property exceeds the {minimum_investment} threshold for the {country}'s residency-by-investment pathway, providing the qualifying capital outlay required for application together with credible long-term capital preservation. The address is one of the country's established prime residential locations, where capital values have shown resilience across cycles and resale liquidity remains strong with both domestic and international buyer pools. Title is unencumbered and recently surveyed; the property is registered in the cadastre with full documentation available for the residency application. Local legal counsel familiar with the visa programme can typically complete the purchase, due diligence, and visa application in {timeline} weeks. The {bedrooms}-bedroom layout is appropriate for occasional personal use, extended-family visits, or institutional-grade letting during periods of non-occupation. Capital-secure, residency-eligible, and located in an address that protects rather than dilutes the investment.
```

**PL:**

```
Nieruchomość pozycjonowana dla zagranicznych nabywców planujących długoterminowe osiedlenie w Polsce — czy to przez kartę pobytu rezydenta długoterminowego UE, działalność gospodarczą, czy pracę w sektorach wymagających lokalnej obecności. Polska nie prowadzi programu residency-by-investment, ale zakup nieruchomości na tej kwocie (przekraczającej próg {minimum_investment}) wzmacnia każdy z dostępnych wniosków pobytowych poprzez wykazanie zakotwiczenia majątkowego. Sama lokalizacja jest jednym z ustabilizowanych prestiżowych adresów {country}, gdzie wartości kapitałowe wykazują odporność w cyklach. Tytuł prawny jest wolny od obciążeń, ujawniony w księdze wieczystej, z kompletem dokumentów dostępnych do wniosków administracyjnych. Lokalny radca prawny specjalizujący się w pobytach cudzoziemców jest w stanie przeprowadzić zakup, due diligence i wniosek pobytowy w typowo {timeline} tygodni. Układ {bedrooms}-pokojowy nadaje się na okresowy użytek własny, wizyty rodziny lub najem instytucjonalny w okresach nieobecności. Bezpieczny kapitał i adres, który chroni a nie rozwadnia inwestycję.
```

**ES:**

```
Esta propiedad cumple los requisitos patrimoniales asociados a las vías españolas de residencia para inversores y profesionales internacionales — desde la Visa No Lucrativa hasta la Visa de Nómada Digital, pasando por la inversión sustancial requerida en alternativas patrimoniales tras la finalización del programa de Golden Visa en 2024. El importe de adquisición supera el umbral de referencia de {minimum_investment} habitualmente exigido en estos procedimientos, y la dirección se encuentra entre las localizaciones residenciales prime consolidadas de {country}, donde los valores capitales han mostrado resistencia a lo largo de los ciclos y la liquidez de reventa permanece sólida. El título está libre de cargas, registrado en el Registro de la Propiedad con documentación íntegra disponible para el procedimiento administrativo. Un despacho legal local familiarizado con los procedimientos de residencia puede completar la compra, la due diligence y el expediente de residencia en {timeline} semanas. La distribución de {bedrooms} dormitorios es apropiada para uso personal ocasional, visitas familiares extendidas o alquiler institucional durante períodos de no ocupación.
```

---

## 13. yield_hunter

**Voice:** numbers-led, terse, ROI-focused. Sentences load metrics densely. No emotional language.

**EN:**

```
A property positioned for income rather than appreciation. Gross yield of {yield}% sits meaningfully above the {neighborhood} median, supported by a {tenancy_status} and a price-per-square-metre {ppsqm_delta}% below comparable units within a 500m radius. Annual rental income is estimated at {annual_rent} against running costs of {running_costs}, delivering net yield in the {net_yield} band after standard management fees. Void risk is low: the building is professionally managed, the catchment is dominated by white-collar tenants on stable contracts, and the unit has historically let within {average_void} days of becoming available. Transport links — {transport_links} — sustain consistent rental demand and provide a tenant pool reaching beyond the immediate neighbourhood. The structural survey is current and identifies no capital expenditure requirements over the next five years. A clean income-producing line on a portfolio spreadsheet.
```

**PL:**

```
Lokal pozycjonowany pod dochód, nie pod aprecjację. Rentowność brutto {yield}% wyraźnie powyżej mediany dla {neighborhood}, wsparta {tenancy_status} i ceną za metr kwadratowy o {ppsqm_delta}% niższą od porównywalnych mieszkań w promieniu 500 metrów. Roczny czynsz szacowany na {annual_rent} przy kosztach stałych {running_costs}, co przekłada się na rentowność netto w paśmie {net_yield} po standardowej prowizji zarządzania. Ryzyko pustostanu niskie: budynek jest zarządzany profesjonalnie, lokalny rynek najmu zdominowany przez najemców z umowami o pracę, a sam lokal historycznie znajdował najemcę w średnio {average_void} dniach od zwolnienia. Komunikacja — {transport_links} — podtrzymuje stabilny popyt i powiększa basen potencjalnych najemców daleko poza najbliższą okolicę. Aktualny operat techniczny nie wskazuje konieczności nakładów kapitałowych w horyzoncie pięcioletnim. Czysta pozycja dochodowa w portfelu.
```

**ES:**

```
Una propiedad posicionada para generación de rentas antes que para apreciación. La rentabilidad bruta de {yield}% se sitúa notablemente por encima de la mediana de {neighborhood}, respaldada por {tenancy_status} y un precio por metro cuadrado {ppsqm_delta}% por debajo de comparables transaccionados dentro de un radio de 500 metros. La renta anual estimada es {annual_rent} frente a costes operativos de {running_costs}, generando una rentabilidad neta en la banda {net_yield} tras la comisión estándar de gestión. El riesgo de vacancia es bajo: el edificio cuenta con administración profesional, el área atrae mayoritariamente a inquilinos con contratos laborales estables, y la unidad ha registrado históricamente un período medio de comercialización de {average_void} días desde la liberación. Las conexiones de transporte — {transport_links} — sostienen una demanda de alquiler consistente y amplían la base de inquilinos potenciales mucho más allá del barrio inmediato. La inspección técnica del edificio (ITE) está vigente y no identifica requerimientos de inversión capital en el horizonte de cinco años. Una línea limpia de ingresos en la hoja de cálculo del portfolio.
```

---

## 14. flip_investor

**Voice:** opportunity-spotter, exit-value oriented. Realistic about upside and works required.

**EN:**

```
A renovation opportunity priced at {discount_to_market}% below recently sold comparables in {neighborhood}, with the structural integrity to justify capital deployment and the planning history to support an ambitious scheme. The shell is sound — surveyed roof, intact party walls, no major subsidence, no immediate structural reservations. Cosmetic and second-fix works dominate the required scope, with a realistic budget in the {budget_range} bracket producing a finished product credibly aligned with the {target_value} achieved by recently transacted units of similar dimensions. Planning permission for {planning_scope} was previously granted on the property and remains a credible reapplication. Local builders familiar with the property typology can typically deliver a comparable scheme in {timeline_months} months. Exit liquidity is strong — recent sold prices show 30-day average days-on-market for refurbished stock — supporting a return of capital on a defensible timeline.
```

**PL:**

```
Okazja remontowa z ceną o {discount_to_market}% poniżej cen transakcyjnych porównywalnych lokali w {neighborhood} — z konstrukcją uzasadniającą wkład kapitałowy i historią pozwoleń wspierającą ambitny zakres prac. Sama struktura jest zdrowa: dach po niedawnym przeglądzie, ściany konstrukcyjne nienaruszone, brak osiadań, brak zastrzeżeń strukturalnych. Prace dotyczą głównie warstw wykończeniowych i instalacyjnych, z realnym budżetem w przedziale {budget_range} dającym produkt zgodny z {target_value} osiąganym przez świeżo wyremontowane lokale o podobnych parametrach. Wcześniej wydano decyzję o {planning_scope}, która pozostaje wiarygodną podstawą do ponownego wniosku. Lokalni wykonawcy z doświadczeniem w tym typie zabudowy są w stanie zrealizować analogiczny zakres w {timeline_months} miesięcy. Płynność wyjścia mocna — średni czas sprzedaży lokalów po remoncie poniżej 45 dni — wspiera defensywny harmonogram zwrotu kapitału.
```

**ES:**

```
Una oportunidad de reforma valorada a un {discount_to_market}% por debajo de los comparables transaccionados recientemente en {neighborhood}, con la solidez estructural que justifica el despliegue de capital y un historial urbanístico que sostiene un alcance de obra ambicioso. La estructura es sana — cubierta verificada por arquitecto, muros maestros íntegros, sin asentamientos relevantes, sin reservas estructurales inmediatas. Las obras necesarias son fundamentalmente de acabados e instalaciones, con un presupuesto realista en la banda {budget_range} dando lugar a un producto finalizado alineado con el {target_value} alcanzado por unidades reformadas recientemente. Una licencia previa para {planning_scope} fue concedida sobre la propiedad y constituye una base creíble para una nueva tramitación. Constructores locales familiarizados con esta tipología pueden entregar un proyecto comparable en {timeline_months} meses. La liquidez de salida es robusta — el mercado registra un tiempo medio de venta inferior a 45 días para stock reformado — sosteniendo un retorno de capital con un calendario defendible.
```

---

## 15. portfolio_builder

**Voice:** strategic, scalable. One line item in a larger book of holdings. Compliance-aware.

**EN:**

```
For investors building rather than buying — multi-unit configuration, scalable management, and a price point that holds up against the rest of the portfolio's blended yield. The building contains {unit_count} self-contained lettable units, each with separate utilities and entrance, supporting either single-let or HMO operation depending on local licensing. Bulk-purchase pricing reflects a {bulk_discount}% discount against equivalent units sold individually in {neighborhood}, materially improving entry yield. Existing tenants on standard ASTs continue in occupation, generating immediate rental income from completion day with no void exposure. The local council's HMO licensing regime is well-understood; the property has either current licences or a credible compliance path. Property management by a single agency covering the full portfolio is straightforward at this address and at this scale. A clean acquisition that scales rather than diversifies — the sort of transaction that compounds well over time.
```

**PL:**

```
Dla inwestorów budujących portfel, nie kupujących pojedynczo — konfiguracja wielolokalowa, skalowalne zarządzanie i cena trzymająca poziom względem reszty książki. Budynek zawiera {unit_count} samodzielnych lokali pod najem, każdy z osobnymi licznikami i wejściem, co umożliwia operowanie zarówno w trybie pojedynczego najmu, jak i w modelu pokojowym (zgodnie z lokalnymi regulacjami). Cena zakupu odzwierciedla rabat w wysokości {bulk_discount}% względem analogicznych lokali sprzedawanych jednostkowo w {neighborhood}, co materialnie poprawia rentowność wejścia. Dotychczasowi najemcy na standardowych umowach najmu kontynuują obecność — natychmiastowe wpływy z czynszów od daty zakupu, zerowy okres pustostanu na start. Lokalne regulacje dotyczące ochrony lokatorów są dobrze poznane, a lokal ma stabilną strukturę umów. Zarządzanie portfelem przez jedną agencję jest na tym adresie i tej skali standardowe. Czysty zakup, który skaluje a nie dywersyfikuje — typ transakcji, który dobrze procentuje w czasie.
```

**ES:**

```
Para inversores que construyen cartera en lugar de comprar individualmente — configuración multi-unidad, gestión escalable y un precio que sostiene la rentabilidad combinada del resto del libro. El edificio contiene {unit_count} unidades independientes con suministros separados y entradas propias, permitiendo operación tanto en régimen de alquiler tradicional como en explotación tipo coliving según la regulación local. El precio de adquisición refleja un descuento del {bulk_discount}% frente al equivalente unitario en {neighborhood}, mejorando materialmente la rentabilidad de entrada. Los inquilinos actuales continúan en contratos de arrendamiento estándar, generando ingresos por rentas desde el día siguiente a la firma sin exposición a vacancia. El marco regulatorio local de viviendas para alquiler está bien estudiado; la propiedad mantiene la documentación adecuada. La gestión por una única administración cubriendo el portfolio completo es estándar a esta dirección y a esta escala. Una adquisición limpia que escala antes que diversifica — el tipo de operación que compone bien a lo largo del tiempo.
```

---

## 16. vacation_rental_investor

**Voice:** tourism-aware, regulation-conscious, platform-fluent.

Market note: ES STR regulations are tightening sharply (Barcelona, Mallorca, Palma). The ES template
uses VFT/VUT terminology specific to local licensing regimes.

**EN:**

```
A property positioned for the short-term rental market, in a destination with both genuine tourist demand and a clear regulatory pathway. {neighborhood} maintains an active STR licence regime; this property either holds a current registration or qualifies for one with standard paperwork. Local occupancy data from comparable units in the area runs at {occupancy}% averaged across the year, with summer peaks reliably above {peak_occupancy}%. ADR benchmarks for the unit's class and configuration sit in the {adr_range} band, producing realistic gross income materially above conventional long-let yields. Platform performance — Airbnb, Vrbo, Booking.com — is straightforward at this address with strong photography and a competent listing. A reliable local STR management company can handle guest communications, cleaning, key handover, and turnover for {management_fee}% of gross. A short-term-rental property built for short-term rental, not retrofitted into it.
```

**PL:**

```
Lokal pozycjonowany pod rynek najmu krótkoterminowego — w destynacji z autentycznym popytem turystycznym i jasną ścieżką regulacyjną. {neighborhood} utrzymuje rejestr meldunków turystycznych jasno udokumentowany; ten lokal posiada aktywną rejestrację lub kwalifikuje się do niej po standardowej dokumentacji. Lokalne dane o obłożeniu z porównywalnych mieszkań w okolicy wskazują {occupancy}% średniorocznie, ze szczytami letnimi powyżej {peak_occupancy}%. Średnia stawka dobowa (ADR) dla klasy i konfiguracji lokalu mieści się w paśmie {adr_range}, generując realny przychód brutto wyraźnie powyżej rentowności konwencjonalnego najmu długoterminowego. Wyniki na platformach — Airbnb, Booking.com, Vrbo — są na tym adresie przewidywalne przy dobrej fotografii i kompetentnym opisie oferty. Sprawdzona lokalna firma operatorska jest w stanie obsłużyć komunikację z gośćmi, sprzątanie, wymianę kluczy i rotację za {management_fee}% obrotu. Lokal zbudowany pod najem krótki, nie do niego dostosowany.
```

**ES:**

```
Una propiedad posicionada para el mercado de alquiler vacacional, en un destino con demanda turística genuina y una vía regulatoria definida. {neighborhood} mantiene un régimen activo de licencia de alquiler turístico (VFT/VUT); esta propiedad cuenta con registro vigente o reúne los requisitos para obtenerlo con tramitación estándar. Los datos locales de ocupación procedentes de unidades comparables en la zona se sitúan en el {occupancy}% promediado anualmente, con picos estivales fiablemente por encima del {peak_occupancy}%. Los benchmarks de tarifa media (ADR) para la clase y configuración de la unidad se sitúan en la banda {adr_range}, generando ingresos brutos realistas materialmente por encima de la rentabilidad del alquiler tradicional. El desempeño en plataforma — Airbnb, Vrbo, Booking.com — es sólido en esta dirección con fotografía profesional y descripción competente. Una gestora local especializada puede ocuparse de la comunicación con huéspedes, limpieza, entrega de llaves y rotación por un {management_fee}% sobre ingresos brutos. Una vivienda construida para el alquiler vacacional, no adaptada a él tras la compra.
```

---

## 17. commercial_investor

**Voice:** institutional, lease-led, technical. Uses commercial-agency vocabulary (WAULT, ERV, FRI,
MEES) without explanation.

**EN:**

```
A commercial holding offered with a strong existing income profile and credible asset-management upside. The unit is let to {tenant} on a {lease_length}-year lease with {wault} years unexpired, generating passing rent of {passing_rent} against an ERV of {erv} — a reversionary spread of {reversionary_pct}% supporting straightforward income growth at the next review or renewal. The tenant covenant is investment-grade with {credit_rating} rating and a {trading_history} trading history at this address. The lease is FRI on standard institutional terms with five-yearly upward-only reviews. Vacant possession value is also defensible given the building's specification and {neighborhood}'s commercial fundamentals. Service-charge accounts are current, no material capex sits within the next five-year horizon, and EPC rating supports continued lettability under the {mees_year} MEES thresholds. A clean institutional acquisition with both income certainty and a realistic exit narrative.
```

**PL:**

```
Aktywum komercyjne oferowane z mocnym aktualnym profilem dochodowym i wiarygodnym potencjałem zarządzania aktywami. Lokal jest wynajęty {tenant} na umowie {lease_length}-letniej, z {wault} lat do końca, generując czynsz na poziomie {passing_rent} względem ERV {erv} — co daje spread rewersyjny {reversionary_pct}% wspierający naturalny wzrost dochodu przy najbliższej renegocjacji lub przedłużeniu. Wiarygodność kredytowa najemcy klasy inwestycyjnej, rating {credit_rating}, historia handlowa {trading_history} w tej lokalizacji. Umowa typu triple-net na standardowych warunkach instytucjonalnych z waloryzacją co pięć lat. Wartość rynkowa w stanie pustym również jest defendable, biorąc pod uwagę specyfikację budynku i fundamenta komercyjne {neighborhood}. Rozliczenia czynszu serwisowego aktualne, brak istotnych nakładów kapitałowych w horyzoncie pięcioletnim, klasa energetyczna budynku wspiera dalszą zdolność najemu pod EU EPBD do {mees_year}. Czysty zakup instytucjonalny z pewnością dochodu i realistyczną narracją wyjścia.
```

**ES:**

```
Un activo comercial ofrecido con un perfil de ingresos sólido y un recorrido creíble de gestión de activos. La unidad está arrendada a {tenant} mediante contrato de {lease_length} años con {wault} años restantes, generando una renta de paso de {passing_rent} frente a un ERV de {erv} — un spread reversionario del {reversionary_pct}% que sustenta un crecimiento natural de ingresos en la próxima revisión o renovación. El covenant del arrendatario es de grado de inversión con rating {credit_rating} y un historial comercial de {trading_history} en esta dirección. El contrato es FRI bajo términos institucionales estándar con revisiones quinquenales al alza. El valor en estado de desocupación también es defendible, dada la especificación del edificio y los fundamentales comerciales de {neighborhood}. Las cuentas de gastos comunes están al corriente, no se identifican capex materiales en el horizonte de cinco años, y la certificación energética sostiene la continuidad de arrendabilidad bajo los umbrales aplicables hasta {mees_year}. Una adquisición institucional limpia con certidumbre de ingresos y una narrativa de salida realista.
```

---

## 18. neutral

**Voice:** balanced, factual, audience-agnostic. Shorter than other archetypes — neutral copy
doesn't argue, only informs.

**EN:**

```
A {bedrooms}-bedroom property in {neighborhood}, presented in {condition} condition and offered at {price}. The layout includes {key_features}, with {parking_details} and {outdoor_space}. The building is constructed to {construction_year} standards and has been maintained throughout. Energy performance is rated {epc}. Local amenities — shops, transport, schools, and healthcare — are within walking distance, and the immediate surroundings are predominantly residential. Tenure is {tenure}, with {service_charge_details} where applicable. Viewings are available by appointment. A factual, balanced description for prospective buyers across a range of intentions and budgets.
```

**PL:**

```
Lokal {bedrooms}-pokojowy w {neighborhood}, w stanie {condition}, oferowany za {price}. Układ obejmuje {key_features}, z {parking_details} i {outdoor_space}. Budynek wzniesiony zgodnie ze standardami z roku {construction_year}, regularnie konserwowany. Klasa energetyczna {epc}. Lokalna infrastruktura — sklepy, komunikacja, szkoły, opieka medyczna — w zasięgu spaceru, otoczenie głównie mieszkalne. Tytuł prawny: {tenure}, z {service_charge_details} gdzie ma zastosowanie. Pokazujemy po wcześniejszym umówieniu. Faktyczny, neutralny opis dla potencjalnych kupujących o różnych celach i budżetach.
```

**ES:**

```
Inmueble de {bedrooms} dormitorios en {neighborhood}, presentado en estado {condition} y ofrecido por {price}. La distribución incluye {key_features}, con {parking_details} y {outdoor_space}. La construcción cumple los estándares de {construction_year} y se ha mantenido continuadamente. La certificación energética es {epc}. Los servicios locales — comercio, transporte, centros educativos y atención sanitaria — son accesibles a pie, y el entorno inmediato es predominantemente residencial. La titularidad es {tenure}, con {service_charge_details} donde aplique. Las visitas se conciertan previa cita. Descripción factual y equilibrada para compradores con distintos perfiles y presupuestos.
```

---

## Placeholder reference (shared across EN / PL / ES)

| Archetype                | Placeholders relied on                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| first_time_buyer         | `{bedrooms}`, `{neighborhood}`                                                                                                                                                             |
| family_buyer             | `{bedrooms}`, `{neighborhood}`                                                                                                                                                             |
| upsizer                  | `{bedrooms}`, `{neighborhood}`                                                                                                                                                             |
| downsizer                | `{bedrooms}`, `{neighborhood}`                                                                                                                                                             |
| luxury_buyer             | `{key_luxury_feature}`, `{neighborhood}`                                                                                                                                                   |
| lifestyle_expat          | `{neighborhood}`                                                                                                                                                                           |
| remote_worker            | `{internet_speed}`, `{neighborhood}`                                                                                                                                                       |
| retiree_relocator        | `{bedrooms}`, `{neighborhood}`                                                                                                                                                             |
| diaspora_buyer           | `{bedrooms}`, `{neighborhood}`                                                                                                                                                             |
| second_home_buyer        | `{bedrooms}`, `{neighborhood}`, `{leisure_anchor}`                                                                                                                                         |
| student_parent           | `{bedrooms}`, `{neighborhood}`, `{university}`, `{yield_range}`                                                                                                                            |
| golden_visa_buyer        | `{bedrooms}`, `{minimum_investment}`, `{country}`, `{timeline}`                                                                                                                            |
| yield_hunter             | `{yield}`, `{neighborhood}`, `{tenancy_status}`, `{ppsqm_delta}`, `{annual_rent}`, `{running_costs}`, `{net_yield}`, `{average_void}`, `{transport_links}`                                 |
| flip_investor            | `{discount_to_market}`, `{neighborhood}`, `{budget_range}`, `{target_value}`, `{planning_scope}`, `{timeline_months}`                                                                      |
| portfolio_builder        | `{unit_count}`, `{bulk_discount}`, `{neighborhood}`                                                                                                                                        |
| vacation_rental_investor | `{neighborhood}`, `{occupancy}`, `{peak_occupancy}`, `{adr_range}`, `{management_fee}`                                                                                                     |
| commercial_investor      | `{tenant}`, `{lease_length}`, `{wault}`, `{passing_rent}`, `{erv}`, `{reversionary_pct}`, `{credit_rating}`, `{trading_history}`, `{neighborhood}`, `{mees_year}`                          |
| neutral                  | `{bedrooms}`, `{neighborhood}`, `{condition}`, `{price}`, `{key_features}`, `{parking_details}`, `{outdoor_space}`, `{construction_year}`, `{epc}`, `{tenure}`, `{service_charge_details}` |

Placeholders are identical across all three locales — Sonnet (or the placeholder resolver in the
`template_fallback` direct-render path) substitutes them from `listing_context`. Unresolved tokens
are dropped silently rather than left as raw `{token}` literals.

---

## When the template DOES render directly (missing-original edge case)

Companion doc §2 specifies one case where the template — NOT Sonnet's output, NOT the agent's
original — is served directly to a buyer: when `listing.description` is null or empty in the agency
feed. In that case:

1. Endpoint resolves placeholders in the appropriate locale template against `listing_context`.
2. Returns
   `{ description: resolved_template, source: 'template_fallback', generated_at: listing.updated_at }`.
3. Still enqueues a Sonnet job — `original_agent_copy` is passed as empty string and the prompt
   explicitly notes "no agent original available; generate from archetype template and structured
   context only". Subsequent buyers see `ai_cached` Sonnet output as usual.

This means each of the 54 templates above must remain shippable as a direct-render artifact, even
though that is a fallback edge case. Voice notes, placeholder discipline, and 100–160 word
constraint apply to every template for that reason.

---

## Acceptance criteria for template verification

When reviewing this doc, Piotr should check, per language:

1. **Voice distinctness.** Read EN templates 1, 5, 13 back-to-back. They should sound like three
   different copywriters wrote them. Same check for PL and ES separately. If two archetypes blur in
   any language, the weaker one needs a rewrite.
2. **Factual restraint.** No template should claim something that isn't backed by either the
   `listing_context` schema or general property-listing convention. Tone-setting prose
   ("kitchen-diner is the kind of room where homework happens") is acceptable; specific factual
   claims about features not in the placeholder reference table are not.
3. **Placeholder discipline.** Every `{token}` must appear in the Placeholder Reference table above.
   Sonnet drops unresolved tokens, but the table is the contract.
4. **Archetype alignment.** The single most-important motivation for each archetype must appear in
   the first 30 words in every language.
5. **Length.** 100–170 words per locale per archetype. Neutral is allowed shorter (~80–100).
6. **Market correctness.** PL templates must not invoke programmes/institutions that don't exist in
   Poland (e.g. Polish Help-to-Buy → Bezpieczny Kredyt 2%). ES templates must not invoke programmes
   repealed after the template was written (Golden Visa repealed 2024 → reframed to Non-Lucrative /
   Digital Nomad). Flag any template that references a regulation that has changed.

Sign-off: Piotr's approval here triggers TICKET-COLD-003 (swap into .ts files for all three
locales).
