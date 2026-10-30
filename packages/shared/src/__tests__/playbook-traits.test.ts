/**
 * Trait add-ons [FOLLOW-1360]: the rules and the invitation slot exist only when the trait is
 * present, and every rule is listing-grounded by construction. ESC-089 (CEO 2026-10-29) lifted the
 * familial-status limits: `has_children` now shapes copy towards family wording and the
 * family-relevant facts the listing states [FOLLOW-1411]; the one protected-ground guard left
 * (`describesResidentsByProtectedGround`) is pinned below.
 */

import { describe, expect, it } from 'vitest';
import { getAllPlaybooks, getPlaybook } from '../playbooks/index.js';
import {
  TRAIT_NOTE_SLOT,
  getTraitAddOns,
  renderTraitRules,
  describesResidentsByProtectedGround,
  traitSlots,
} from '../playbooks/traits.js';
import { CANONICAL_TRAIT_IDS } from '../traits.js';

/** Words that would turn an invitation into a claim about the property. */
const CLAIM_WORDS =
  /(?<![\p{L}\p{N}])(?:has|have|includes?|qualif\w+|eligible|guarantee\w*|yield\w*|licen[cs]\w*|ma|mają|posiada\w*|spełnia\w*|kwalifik\w*|licencj\w*|gwarant\w*|rentown\w*|tiene|tienen|incluye\w*|cumple\w*|califica\w*|licencia|garant\w*|rentabilidad)(?![\p{L}\p{N}])|\d/iu;

describe('getTraitAddOns', () => {
  it('returns nothing without a trait, and drops unknown ids', () => {
    expect(getTraitAddOns(undefined)).toEqual([]);
    expect(getTraitAddOns([])).toEqual([]);
    expect(getTraitAddOns(['not_a_trait', 42, null])).toEqual([]);
  });

  it('returns canonical order, de-duplicated, whatever the input order', () => {
    const got = getTraitAddOns(['has_children', 'premium', 'premium', 'bogus', 'will_let']);
    expect(got.map((a) => a.trait)).toEqual(['premium', 'will_let', 'has_children']);
  });

  it.each(CANONICAL_TRAIT_IDS)('%s: rules and slot appear only when the trait is present', (id) => {
    const other = CANONICAL_TRAIT_IDS.filter((t) => t !== id);
    const without = getTraitAddOns(other);
    expect(without.map((a) => a.trait)).not.toContain(id);
    expect(renderTraitRules(without)).not.toContain(`[${id}]`);

    const only = getTraitAddOns([id]);
    expect(only).toHaveLength(1);
    expect(renderTraitRules(only)).toContain(`[${id}]`);
    expect(only[0]?.rules.length).toBeGreaterThan(0);
    expect(traitSlots(only).length).toBe(id === 'has_children' ? 0 : 1);
  });

  it.each(CANONICAL_TRAIT_IDS)(
    '%s: every rule set is small, grounded and ends in a prohibition',
    (id) => {
      const [addOn] = getTraitAddOns([id]);
      const rules = addOn?.rules ?? [];
      expect(rules.length).toBeLessThanOrEqual(2);
      expect(rules.some((r) => /\b(?:never|only if|only where)\b/i.test(r))).toBe(true);
      expect(rules.at(-1)).toMatch(/\b(?:never|unless)\b/i);
    },
  );

  it('renders an empty string for no add-ons (a request without traits is byte-identical)', () => {
    expect(renderTraitRules([])).toBe('');
  });

  it('carries the absorbed playbook listing_rules for the four absorbed traits', () => {
    expect(getTraitAddOns(['premium'])[0]?.listing_rules).toBe(
      getPlaybook('luxury_buyer').listing_rules,
    );
    expect(getTraitAddOns(['works_from_home'])[0]?.listing_rules).toBe(
      getPlaybook('remote_worker').listing_rules,
    );
    expect(getTraitAddOns(['residency_goal'])[0]?.listing_rules).toBe(
      getPlaybook('golden_visa_buyer').listing_rules,
    );
    expect(getTraitAddOns(['seasoned_investor'])[0]?.listing_rules).toBe(
      getPlaybook('portfolio_builder').listing_rules,
    );
  });
});

describe('trait invitation slots', () => {
  const withSlot = CANONICAL_TRAIT_IDS.filter((t) => t !== 'has_children');

  it.each(withSlot)('%s: one non-assertive invitation in en, pl and es', (id) => {
    const slots = traitSlots(getTraitAddOns([id]));
    expect(slots).toHaveLength(1);
    const slot = slots[0];
    expect(slot?.slot).toBe(TRAIT_NOTE_SLOT);
    for (const text of [slot?.en, slot?.pl, slot?.es]) {
      expect(text).toBeTruthy();
      expect(text).not.toMatch(CLAIM_WORDS);
    }
    // An offer or a question the buyer may ask, in the same register as the enumerated `cta`s.
    expect(slot?.en).toMatch(/^(?:Request|Ask About)\b/);
  });

  it('has_children adds no slot: its contribution is emphasis in the copy', () => {
    expect(traitSlots(getTraitAddOns(['has_children']))).toEqual([]);
  });
});

describe('has_children shapes copy towards the family [FOLLOW-1411, ESC-089]', () => {
  const [addOn] = getTraitAddOns(['has_children']);
  const text = addOn?.rules.join(' ') ?? '';

  it('its slot is null and its rules write for a household with children', () => {
    expect(addOn?.slot).toBeNull();
    expect(text).toMatch(/household with children/i);
    expect(text).toMatch(/a room each/i);
    // The FOLLOW-1360 fair-housing prohibitions are lifted.
    expect(text).not.toMatch(/fair-housing|never address the reader as a parent/i);
  });

  it('it names schools and playgrounds only as the listing does (grounding, §E.7.0)', () => {
    expect(text).toMatch(
      /schools, nurseries, parks or playgrounds only where the listing names them/i,
    );
    expect(text).toMatch(/never invent a school, catchment, playground, distance or safety claim/i);
  });
});

describe('describesResidentsByProtectedGround — race, ethnic origin, religion of residents [FOLLOW-1411]', () => {
  const FLAGGED: Record<string, string[]> = {
    en: [
      'Friendly Muslim neighbours on every floor',
      'A close-knit Catholic community',
      'White residents only',
      'A predominantly Jewish neighbourhood',
      'The area is mostly Christian',
      'Residents are predominantly Asian',
      'A street with no immigrants',
      'Free of minorities',
      'An ethnically diverse district',
      'A religiously homogeneous estate',
      'Mostly Muslims live here',
    ],
    pl: [
      'Katolicka społeczność osiedla',
      'Muzułmańscy sąsiedzi',
      'Mieszkańcy to głównie katolicy',
      'Dzielnica głównie żydowska',
      'Okolica zamieszkana głównie przez muzułmanów',
      'Osiedle bez imigrantów',
      'Etnicznie jednorodna okolica',
    ],
    es: [
      'Vecinos musulmanes',
      'La comunidad judía del edificio',
      'Un barrio mayoritariamente católico',
      'Una zona sin inmigrantes',
      'Un vecindario étnicamente diverso',
      'Residentes blancos',
    ],
  };
  for (const [locale, values] of Object.entries(FLAGGED)) {
    it.each(values)(`flags ${locale} %j`, (value) => {
      expect(describesResidentsByProtectedGround(value)).toBe(true);
    });
  }

  it.each([
    // Family wording is archetype fit since ESC-089, never refused.
    'A family-friendly neighbourhood',
    'Ideal for families, with a garden',
    'Your children will love the garden',
    'A true family home with a room each',
    'Okolica przyjazna rodzinom',
    'Idealne dla rodzin z dziećmi',
    'Ideal para familias con niños',
    // Buyer nationality and origin are targeting, not a statement about residents.
    'For the diaspora returning home: an address your family will recognise',
    'An established international community',
    'A large British community nearby',
    'Polska diaspora w Wielkiej Brytanii',
    'Zabezpieczenie dla rodziny w kraju',
    'Comunidad internacional consolidada',
    // Place names, buildings, institutions and colours of things.
    'Steps from the former Jewish Quarter',
    'W sercu dawnej dzielnicy żydowskiej',
    'Junto al antiguo barrio judío',
    'A church and a mosque within walking distance',
    'Next to the Jewish Community Centre',
    'Mostly white walls and oak floors',
    'Mostly white buildings on the seafront',
    'Białe ściany i dębowa podłoga',
    'Głównie azjatycka kuchnia w restauracjach obok',
    'Uno de los pueblos blancos de Cádiz',
    'Edificio principalmente blanco',
    'Comunidad Valenciana',
    'A single-family house',
  ])('passes %j', (value) => {
    expect(describesResidentsByProtectedGround(value)).toBe(false);
  });

  it('no authored playbook string served on any branch trips the guard', () => {
    const served: string[] = [];
    for (const p of getAllPlaybooks().values()) {
      for (const slot of p.slots) {
        served.push(slot.en, slot.pl ?? '', slot.es ?? '', ...(slot.variants?.en ?? []));
      }
    }
    for (const id of CANONICAL_TRAIT_IDS) {
      for (const slot of traitSlots(getTraitAddOns([id])))
        served.push(slot.en, slot.pl ?? '', slot.es ?? '');
    }
    const strings = served.filter(Boolean);
    expect(strings.length).toBeGreaterThan(100);
    expect(strings.filter(describesResidentsByProtectedGround)).toEqual([]);
  });
});

/**
 * ESC-089 follow-up (CEO 2026-10-30) [FOLLOW-1415]: the race and religion guard is about
 * discrimination, not about describing facts — on one condition, that the copy stirs no
 * controversy. Three rules, each pinned per locale:
 *   1. PASS — a historical fact or a place ("the old Jewish quarter", "historically home to
 *      Kraków's Jewish community") and a building or institution ("a synagogue nearby").
 *   2. REFUSE — a discriminatory or exclusionary statement, or present-day residents described by
 *      race, ethnic origin or religion; a historical qualifier does not excuse it once the copy
 *      says the group is still there ("historically and still predominantly Muslim residents").
 *   3. REFUSE — sensitive or traumatic history, even as a fact and whatever the qualifier
 *      (Holocaust / Shoah, ghetto, deportations, pogroms, massacres, ethnic cleansing, genocide,
 *      war crimes, concentration or extermination camps).
 * Calls made for the tricky cases: a "Catholic school", the "Jewish Community Centre" and "Asian
 * cuisine" are institutions or things, not residents (rule 1, PASS); an adjectival qualifier
 * ("old", "dawna", "antigua") excuses only the phrase it directly modifies, so "an old building
 * with Muslim neighbours" still refuses.
 */
describe('describesResidentsByProtectedGround — facts pass, discrimination and sensitive history refuse [FOLLOW-1415]', () => {
  const RULE_1_PASS: Record<string, string[]> = {
    en: [
      'In Kazimierz, the historic Jewish district',
      'Steps from the old Jewish quarter',
      "Historically home to Kraków's Jewish community",
      'Once home to a thriving Jewish community, the street is now full of cafés',
      'The former Jewish community of the town built the synagogue',
      'Close to the old Jewish cemetery',
      'A synagogue, a church and a mosque within walking distance',
      'Overlooking the cathedral',
      'Next to the Jewish Community Centre',
      'A Catholic school nearby',
      'Asian cuisine on the corner',
    ],
    pl: [
      'W sercu dawnej dzielnicy żydowskiej',
      'Stara żydowska dzielnica Krakowa za rogiem',
      'Kazimierz, historyczna dzielnica żydowska',
      'Niegdyś dom społeczności żydowskiej Krakowa',
      'Dawna społeczność żydowska zbudowała tu synagogę',
      'Dzielnica dawniej zamieszkana przez Żydów',
      'Blisko synagogi i kościoła Mariackiego',
      'Katolicka szkoła w pobliżu',
      'Głównie azjatycka kuchnia w restauracjach obok',
      'Rzeźba w ogrodzie, starannie wykończone wnętrza',
    ],
    es: [
      'Junto al antiguo barrio judío',
      'En la antigua judería de Toledo',
      'Históricamente hogar de la comunidad judía de Toledo',
      'La antigua comunidad judía construyó la sinagoga',
      'Cerca de la catedral y de la mezquita',
      'Un colegio católico cerca',
      'Cocina asiática en la esquina',
      'Polideportivo y club deportivo a dos calles',
    ],
  };
  for (const [locale, values] of Object.entries(RULE_1_PASS)) {
    it.each(values)(`rule 1 passes ${locale} %j`, (value) => {
      expect(describesResidentsByProtectedGround(value)).toBe(false);
    });
  }

  const RULE_2_REFUSE: Record<string, string[]> = {
    en: [
      'Muslim neighbours',
      'A predominantly Catholic neighbourhood',
      'Residents are mostly Asian',
      'A street with no immigrants',
      'An ethnically homogeneous estate',
      'A welcoming Jewish community',
      'Historically and still predominantly Muslim residents',
      'Historically and still Muslim residents',
      'An old building with Muslim neighbours',
      'The old Jewish community still lives here',
      'Once inside, you will meet friendly Muslim neighbours',
      'Friendly old Muslim neighbours',
      'Formerly a warehouse, now with Catholic families on every floor',
    ],
    pl: [
      'Mieszkańcy to głównie katolicy',
      'Osiedle bez imigrantów',
      'Muzułmańscy sąsiedzi',
      'Społeczność muzułmańska osiedla',
      'Mieszkańcy żydowscy kamienicy',
      'Dawna kamienica z muzułmańskimi sąsiadami',
      'Dzielnica zamieszkana przez Żydów',
      'Dawniej i nadal zamieszkana przez katolików',
      'Okolica zamieszkana głównie przez muzułmanów',
      'Starzy muzułmańscy sąsiedzi',
    ],
    es: [
      'Vecinos musulmanes',
      'Una zona sin inmigrantes',
      'Un barrio mayoritariamente católico',
      'Residentes mayoritariamente asiáticos',
      'La antigua comunidad judía sigue viviendo aquí',
      'Históricamente y todavía vecinos musulmanes',
      'Un vecindario étnicamente homogéneo',
      'Antiguos vecinos musulmanes',
    ],
  };
  for (const [locale, values] of Object.entries(RULE_2_REFUSE)) {
    it.each(values)(`rule 2 refuses ${locale} %j`, (value) => {
      expect(describesResidentsByProtectedGround(value)).toBe(true);
    });
  }

  const RULE_3_REFUSE: Record<string, string[]> = {
    en: [
      'Near the former Jewish ghetto',
      'A short walk from the Holocaust memorial',
      'A street that remembers the Shoah',
      'The square where the deportations began',
      'Site of the 1903 pogrom',
      'Scene of a wartime massacre',
      'A valley once marked by ethnic cleansing',
      'Opposite the genocide museum',
      'A town tried for war crimes',
      'A short drive from a former concentration camp',
      'Near the old extermination camp',
    ],
    pl: [
      'Obok dawnego getta',
      'W dawnym getcie, dziś pełnym kawiarni',
      'Pomnik ofiar Zagłady za rogiem',
      'Blisko Muzeum Holokaustu',
      'Miejsce pogromu kieleckiego',
      'Stąd ruszały deportacje w 1942 roku',
      'Dawny obóz koncentracyjny w pobliżu',
      'Teren byłego obozu zagłady',
      'Region dotknięty czystkami etnicznymi',
      'Pomnik ofiar ludobójstwa',
      'Ślady zbrodni wojennych',
    ],
    es: [
      'Junto al antiguo gueto',
      'Cerca del Museo del Holocausto',
      'Memoria de la Shoá',
      'Las deportaciones de 1942 salieron de esta plaza',
      'Escenario de un pogromo',
      'Lugar de una masacre',
      'Una región marcada por la limpieza étnica',
      'Memorial del genocidio',
      'Juzgados por crímenes de guerra',
      'A pocos minutos de un antiguo campo de concentración',
      'Cerca del campo de exterminio',
    ],
  };
  for (const [locale, values] of Object.entries(RULE_3_REFUSE)) {
    it.each(values)(`rule 3 refuses ${locale} %j`, (value) => {
      expect(describesResidentsByProtectedGround(value)).toBe(true);
    });
  }
});

/**
 * CEO decisions 2026-10-30 [FOLLOW-1419]: (1) rule 3 refuses more terms that can evoke painful
 * associations — occupation, the Nazi regime, the camps by name, expulsion, deportation by train,
 * round-ups and forced labour — while ordinary listing words pass; (2) a PLACE named by race,
 * ethnic origin or religion passes only with a historical adjective directly before it, while a
 * building, an institution or a street's name stays allowed; (3) prices stay exact — enforced by
 * the digit rule (`number-groups.ts`), which until FOLLOW-1421 still rounded a multiplied price.
 */
describe('describesResidentsByProtectedGround — painful history and places named by a group [FOLLOW-1419]', () => {
  const PAINFUL_REFUSE: Record<string, string[]> = {
    en: [
      'Built under Nazi occupation',
      'A villa requisitioned during the German occupation',
      'Survived the Soviet occupation intact',
      'A former Gestapo headquarters',
      'A Nazi-era villa',
      'The Nazis used the cellar',
      'Built in the Third Reich',
      'Near the former SS barracks',
      'A short drive from Auschwitz',
      'Near Auschwitz-Birkenau',
      'Close to Treblinka',
      'Overlooking Majdanek',
      'Twenty minutes from Sobibor',
      'The Belzec memorial nearby',
      'Near the former Plaszow camp',
      'A short walk to KL Plaszow',
      'Close to the Dachau concentration camp',
      'Twenty minutes from the camp at Mauthausen',
      'The expulsion of the town’s families in 1945',
      'Residents were expelled after the war',
      'Built for displaced persons',
      'The station where the death trains left',
      'Deportation trains left from this square',
      'Prisoners were taken to forced labour',
      'A former labour camp nearby',
      'Near the Umschlagplatz',
    ],
    pl: [
      'Kamienica z okresu okupacji niemieckiej',
      'W czasie okupacji mieścił się tu urząd',
      'Podczas okupacji kamienica była zajęta',
      'Pod sowiecką okupacją',
      'Dawna siedziba gestapo',
      'Okupowana przez nazistów kamienica',
      'Willa z czasów III Rzeszy',
      'Hitlerowcy zajęli budynek',
      'Kilka minut od Auschwitz',
      'Blisko Muzeum Auschwitz-Birkenau w Oświęcimiu',
      'Blisko Treblinki',
      'Widok na Majdanek',
      'W pobliżu Sobiboru',
      'Niedaleko Bełżca',
      'Teren dawnego obozu Płaszów',
      'Obok byłego obozu w Płaszowie',
      'Wysiedlenia mieszkańców w 1940 roku',
      'Wysiedleni mieszkańcy nie wrócili',
      'Wypędzeni z tej kamienicy',
      'Pamiątka po wywózkach na Sybir',
      'Wywózki z tego dworca trwały do 1943 roku',
      'Wywiezieni do obozu mieszkańcy kamienicy',
      'Mieszkańców wywieziono na roboty do Niemiec',
      'Tu odbyła się łapanka',
      'Robotnicy przymusowi mieszkali w budynku',
      'Transporty do obozu odjeżdżały stąd',
      'Pociągi śmierci odjeżdżały z tej stacji',
      'Dawny obóz pracy obok osiedla',
      'Muzeum Więzienia Pawiak',
      'Pomnik Ofiar Zbrodni Katyńskiej',
    ],
    es: [
      'Construido durante la ocupación nazi',
      'Bajo la ocupación alemana',
      'Antigua sede de la Gestapo',
      'Una villa de la época nazi',
      'A una hora de Auschwitz',
      'Cerca del campo de Mauthausen',
      'Tras la expulsión de los judíos en 1492',
      'Los judíos expulsados vivían en esta calle',
      'Los deportados salieron de esta estación',
      'Trenes de deportados partían de aquí',
      'Antiguo campo de trabajos forzados',
    ],
  };
  for (const [locale, values] of Object.entries(PAINFUL_REFUSE)) {
    it.each(values)(`refuses painful history ${locale} %j`, (value) => {
      expect(describesResidentsByProtectedGround(value)).toBe(true);
    });
  }

  /** Ordinary listing words the new terms sit next to — each was checked and must stay served. */
  const ORDINARY_PASS: Record<string, string[]> = {
    en: [
      'A pre-war tenement with high ceilings',
      'A post-war block, fully renovated',
      'Ready for occupation in June',
      'Occupation date: immediate',
      'Occupancy from September',
      'Excellent transport links',
      'Public transport on the doorstep',
      'The terrace transports you to Tuscany',
      'A two-bedroom flat in Oświęcim, close to the market square',
      'Next to Kraków Płaszów railway station',
      'A flat in Płaszów, Kraków',
      'A house in Dachau, 20 minutes from Munich',
      'A loft in Frankfurt-Sachsenhausen',
      'A summer camp for children nearby',
      'Stainless-steel (SS) appliances',
      'Near the Warsaw Rising Museum',
      'Close to the Galicia Jewish Museum',
    ],
    pl: [
      'Przedwojenna kamienica po remoncie',
      'Powojenna kamienica w centrum',
      'Kamienica z okresu międzywojennego',
      'Mieszkanie w Oświęcimiu z balkonem',
      'Dom w Brzezince z ogrodem',
      'Blisko dworca Kraków Płaszów',
      'Mieszkanie na Płaszowie',
      'Wywózka śmieci raz w tygodniu',
      'Wywózki odpadów wliczone w czynsz',
      'Gruz wywieziony po remoncie',
      'Dobra komunikacja i transport publiczny',
      'Osiedle Majdan Tatarski w Lublinie',
      'Blisko Muzeum Powstania Warszawskiego',
      'Przeprowadzka możliwa od zaraz',
      'Obóz harcerski nad jeziorem',
    ],
    es: [
      'Ocupación inmediata',
      'Libre de ocupación',
      'Vivienda sin okupas',
      'Buena conexión de transporte público',
      'Expulsión de aire a la fachada',
      'Junto al polideportivo',
      'Construcción de posguerra reformada',
    ],
  };
  for (const [locale, values] of Object.entries(ORDINARY_PASS)) {
    it.each(values)(`passes ordinary listing words ${locale} %j`, (value) => {
      expect(describesResidentsByProtectedGround(value)).toBe(false);
    });
  }

  const PLACE_REFUSE: Record<string, string[]> = {
    en: [
      'Steps from the Jewish quarter',
      'In the Muslim neighbourhood',
      'In the heart of the Jewish Quarter',
      'A Catholic district close to the river',
      'The old and lively Jewish quarter',
    ],
    pl: [
      'W sercu dzielnicy żydowskiej',
      'Żydowska dzielnica Krakowa za rogiem',
      'Muzułmańska dzielnica miasta',
      'Osiedle katolickie przy parku',
    ],
    es: [
      'Junto al barrio judío',
      'En pleno corazón de la judería',
      'En la judería de Córdoba',
      'Una zona musulmana tranquila',
      'Cerca de la morería',
    ],
  };
  for (const [locale, values] of Object.entries(PLACE_REFUSE)) {
    it.each(values)(`refuses a bare place named by a group ${locale} %j`, (value) => {
      expect(describesResidentsByProtectedGround(value)).toBe(true);
    });
  }

  const PLACE_PASS: Record<string, string[]> = {
    en: [
      'Steps from the former Jewish Quarter',
      'In the old Jewish quarter, now full of cafés',
      'The historic Jewish district of Kazimierz',
      'A synagogue nearby',
      'A Catholic school and a church within walking distance',
      'Next to the Jewish Community Centre',
      'Close to the Jewish district museum',
    ],
    pl: [
      'Dawna dzielnica żydowska Kazimierz',
      'W sercu dawnej dzielnicy żydowskiej',
      'Stara żydowska dzielnica za rogiem',
      'W okolicy katolickiego kościoła',
      'Blisko synagogi i kościoła',
      'Mieszkanie przy ul. Żydowskiej',
      'Przy ulicy Żydowskiej w Lublinie',
    ],
    es: [
      'En el antiguo barrio judío',
      'En la antigua judería de Toledo',
      'Junto a la antigua morería',
      'Un colegio católico cerca',
      'Cerca de la sinagoga',
    ],
  };
  for (const [locale, values] of Object.entries(PLACE_PASS)) {
    it.each(values)(`passes a qualified place or an institution ${locale} %j`, (value) => {
      expect(describesResidentsByProtectedGround(value)).toBe(false);
    });
  }
});

/**
 * FOLLOW-1420 (RETRO-369 / RETRO-371): rule 2 reads composition through a majority quantifier,
 * "once" and "remains" no longer open the historical exemption, and rule 3 spares a street's name
 * in an address. Every REFUSE below was served before this change (red-first); each locale has a
 * member outside the forms the RETRO named (Rule BC clause 3).
 */
describe('describesResidentsByProtectedGround — majority, once / remains, addresses [FOLLOW-1420]', () => {
  const MAJORITY_REFUSE: Record<string, string[]> = {
    en: [
      'Most residents are Catholic.',
      'Most of the neighbours are Muslim.',
      'A Muslim-majority neighbourhood.',
      'The majority of locals are Hindu.',
      'The majority of residents here are Muslims.',
      'An area with a Catholic majority.',
      'A Catholic-dominated estate.',
    ],
    pl: [
      'Większość mieszkańców to katolicy.',
      'Przeważająca część mieszkańców to muzułmanie.',
      'Mieszkańcy to w przeważającej mierze katolicy.',
      'Większość sąsiadów stanowią Żydzi.',
      'Większość mieszkańców jest katolikami.',
      'Osiedle z muzułmańską większością.',
    ],
    es: [
      'La mayoría de los vecinos son musulmanes.',
      'Una zona con mayoría musulmana.',
      'La mayor parte de los habitantes son católicos.',
      'Un barrio de mayoría judía.',
    ],
  };
  for (const [locale, values] of Object.entries(MAJORITY_REFUSE)) {
    it.each(values)(`rule 2 refuses a majority ${locale} %j`, (value) => {
      expect(describesResidentsByProtectedGround(value)).toBe(true);
    });
  }

  it.each([
    'Once you move in the Jewish community will welcome you.',
    'Historically home to a Muslim population that remains active.',
  ])('the historical exemption no longer opens on %j', (value) => {
    expect(describesResidentsByProtectedGround(value)).toBe(true);
  });

  it.each([
    'Residents are mostly Catholic.',
    'Close to the former ghetto.',
    'Mieszkanie przy ul. Bohaterów Getta 5, obok dawnego getta.',
    'Residents were expelled after the war',
  ])('controls stay refused: %j', (value) => {
    expect(describesResidentsByProtectedGround(value)).toBe(true);
  });

  const PASS: Record<string, string[]> = {
    en: [
      'Most residents enjoy the park.',
      'Most of the rooms face south.',
      'Most of the neighbours are retirees.',
      'A majority-owned company manages the building.',
      'Ideal for a growing family, close to good schools.',
      'Steps from the old Jewish quarter',
      "Historically home to Kraków's Jewish community",
      'Once home to a thriving Jewish community, the street is now full of cafés',
      'Flat on Ghetto Heroes Street.',
      'The air is expelled through a heat-recovery unit.',
    ],
    pl: [
      'Większość mieszkań ma balkon.',
      'Większość mieszkańców osiedla to młode rodziny.',
      'Mieszkanie przy ul. Bohaterów Getta 5.',
      'Mieszkanie przy ul. Katyńskiej we Wrocławiu.',
      'Mieszkanie przy ulicy Bohaterów Getta.',
      'Lokal przy al. Bohaterów Getta 12.',
    ],
    es: [
      'La mayoría de los pisos tienen balcón.',
      'La mayor parte de la superficie es jardín.',
      'Expulsión de aire a la fachada.',
    ],
  };
  for (const [locale, values] of Object.entries(PASS)) {
    it.each(values)(`passes ${locale} %j`, (value) => {
      expect(describesResidentsByProtectedGround(value)).toBe(false);
    });
  }
});

describe('playbook merges (FOLLOW-1360)', () => {
  it('keeps the playbooks of the five de-assigned ids', () => {
    for (const id of [
      'upsizer',
      'portfolio_builder',
      'luxury_buyer',
      'remote_worker',
      'golden_visa_buyer',
    ] as const) {
      expect(getPlaybook(id).archetype).toBe(id);
    }
  });

  it('trait invitations use the reviewed PL/ES wording', () => {
    const pl = (t: string) => traitSlots(getTraitAddOns([t]))[0];
    expect(pl('will_let')?.pl).toBe('Zapytaj o wynajem tej nieruchomości');
    expect(pl('works_from_home')?.es).toBe('Pregunta por espacio para teletrabajar');
    expect(pl('premium')?.pl).toBe('Poproś o prywatną prezentację');
  });

  it('family_buyer is the Moving up framing, family-fitted since ESC-089', () => {
    const p = getPlaybook('family_buyer');
    const headline = p.slots.find((s) => s.slot === 'headline');
    expect(headline?.variants?.en.some((v) => /^Moving Up/i.test(v))).toBe(true);
    for (const locale of ['en', 'pl', 'es'] as const) {
      expect(p.copy_template[locale]).toMatch(/HARD RULES:/);
    }
    // FOLLOW-1411: the FOLLOW-1407 ban on children and household is lifted; schools stay grounded.
    expect(p.copy_template.en).toMatch(/moving up for their family/i);
    expect(p.copy_template.en).not.toMatch(/never write about children/i);
    expect(p.copy_template.en).toMatch(/only where the listing names them/i);
    expect(p.description).toMatch(/has_children/);
  });

  it('diaspora_buyer is narrowed to returning to the country of origin', () => {
    expect(getPlaybook('diaspora_buyer').description).toMatch(/country of origin/i);
  });

  it('yield_hunter names the seasoned_investor add-on', () => {
    expect(getPlaybook('yield_hunter').description).toMatch(/seasoned_investor/);
  });
});
