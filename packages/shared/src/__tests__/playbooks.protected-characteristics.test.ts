/**
 * Fair-housing scan of every string a playbook can SERVE to a buyer [FOLLOW-1366].
 *
 * The CEO ruling of 2026-05-14 (backlog/ESCALATIONS.md, FOLLOW-034 entry) binds copy and variant
 * strings never to reference protected characteristics explicitly: race, religion, gender,
 * disability, national origin, family status. ESC-088 added that school and "family area" proxies
 * are the same breach. This test makes that a red build instead of a review comment.
 *
 * SCANNED: for all 18 playbooks, every slot (`en`/`pl`/`es`) and every variant in every locale
 * (headline, cta, feature), plus the `listing_rules` flag names (`boost_if` / `suppress_if`),
 * which decide which listing cards are promoted.
 *
 * NOT SCANNED, deliberately: `copy_template` (voice instructions to a model; they contain these
 * words only as prohibitions: "never call an area family-friendly"; since FOLLOW-1400 the
 * last describe block below holds that claim against `steersByFamilialStatus`) and the trait
 * add-ons (pinned by `playbook-traits.test.ts`). NOT SCANNED, KNOWN GAP: `description`, `signals` and
 * `feature_priority`. `description` and `signals` DO reach the LLM prompts
 * (`apps/control-plane/src/lib/llm-gateway.ts`), so this is a gap, not an exemption; a follow-up
 * scrubs and scans them (FOLLOW-1409 scans `description` for children only).
 *
 * NOT IN THE LIST, deliberately (pending a compliance ruling): `expat` (a residence
 * status, not a national origin), `retire*` (a life stage, not an age). The list is stems matched
 * at a word start, diacritics folded, so "children" and "dzieci" are caught but "familiar" is not.
 */

import { describe, it, expect } from 'vitest';
import { getAllPlaybooks } from '../playbooks/index.js';
import type { PlaybookEntry } from '../playbooks/types.js';
import { steersByFamilialStatus } from '../playbooks/traits.js';

type Locale = 'en' | 'pl' | 'es';

/** Word-start stems per locale; folded to ASCII lower case. */
const PROTECTED_STEMS: Record<Locale, readonly string[]> = {
  en: [
    // family status
    'family',
    'families',
    'familial',
    'child',
    'kid',
    'daughter',
    'mother',
    'father',
    'parent',
    'husband',
    'wife',
    'school',
    'nursery',
    // national origin / race / ethnicity
    'diaspora',
    'ethnic',
    'nationality',
    'national origin',
    'immigrant',
    'migrant',
    'foreigner',
    'foreign',
    'catchment',
    'race',
    'racial',
    // religion
    'religio',
    'church',
    'mosque',
    'synagogue',
    'christian',
    'muslim',
    'jewish',
    // disability
    'disab',
    'handicap',
    'wheelchair',
    // gender
    'gender',
    'male',
    'female',
    'men\\b',
    'women',
    // age
    'senior',
    'elderly',
    'pensioner',
    'golden years',
  ],
  pl: [
    'rodzin',
    'dzieci',
    'dziec',
    'matk',
    'ojciec',
    'rodzic',
    'szkol',
    'przedszkol',
    'diaspor',
    'etnicz',
    'narodowosc',
    'imigrant',
    'obcokraj',
    'cudzoziem',
    'rasa',
    'rasow',
    'religi',
    'kosciol',
    'meczet',
    'synagog',
    'niepelnosprawn',
    'wozek inwalidzki',
    'plec',
    'kobiet',
    'mezczyzn',
    'senior',
    'starsz',
  ],
  es: [
    'familia',
    'familiar',
    'hijo',
    'hija',
    'nino',
    'nina',
    'madre',
    'padre',
    'esposa',
    'marido',
    'colegio',
    'escuela',
    'guarderia',
    'diaspora',
    'etnic',
    'nacionalidad',
    'inmigrante',
    'extranjer',
    'raza',
    'racial',
    'religi',
    'iglesia',
    'mezquita',
    'sinagoga',
    'discapacidad',
    'minusvalid',
    'silla de ruedas',
    'genero',
    'hombre',
    'mujer',
    'anciano',
    'senior',
    'tercera edad',
  ],
};

/**
 * Property facts that merely CONTAIN a listed stem. Removed before scanning. Every entry needs a
 * reason; an unexplained entry is a hole in the fence.
 */
const PROPERTY_FACT_ALLOW_LIST: readonly { phrase: string; reason: string }[] = [
  { phrase: 'single-family', reason: 'house type (US), describes the building' },
  { phrase: 'single family', reason: 'house type (US), describes the building' },
  { phrase: 'unifamiliar', reason: 'house type (ES: detached house), describes the building' },
  { phrase: 'jednorodzinn', reason: 'house type (PL: single-household house), the building' },
];

const fold = (s: string): string =>
  s.normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l').toLowerCase();

/** Stems found in `text`, scanned with the locale's list. */
function protectedHits(text: string, locale: Locale): string[] {
  let folded = fold(text);
  for (const { phrase } of PROPERTY_FACT_ALLOW_LIST) folded = folded.split(phrase).join(' ');
  return PROTECTED_STEMS[locale].filter((stem) =>
    new RegExp(`(?<![a-z])${stem.replace(/ /g, '\\s+')}`).test(folded),
  );
}

interface ServedString {
  where: string;
  locale: Locale;
  text: string;
}

function servedStrings(p: PlaybookEntry): ServedString[] {
  const out: ServedString[] = [];
  for (const s of p.slots) {
    out.push({ where: `${p.archetype}.${s.slot}`, locale: 'en', text: s.en });
    if (s.pl !== undefined)
      out.push({ where: `${p.archetype}.${s.slot}`, locale: 'pl', text: s.pl });
    if (s.es !== undefined)
      out.push({ where: `${p.archetype}.${s.slot}`, locale: 'es', text: s.es });
    for (const loc of ['en', 'pl', 'es'] as const) {
      (s.variants?.[loc] ?? []).forEach((text, i) =>
        out.push({
          where: `${p.archetype}.${s.slot}.variants.${loc}[${String(i)}]`,
          locale: loc,
          text,
        }),
      );
    }
  }
  for (const flag of [...p.listing_rules.boost_if, ...p.listing_rules.suppress_if]) {
    // flag names are snake_case English identifiers
    out.push({
      where: `${p.archetype}.listing_rules.${flag}`,
      locale: 'en',
      text: flag.replace(/_/g, ' '),
    });
  }
  return out;
}

describe('protectedHits — the scanner itself', () => {
  it('catches the four strings FOLLOW-1366 retired', () => {
    expect(protectedHits('Get Family Buyer Guide', 'en')).toContain('family');
    expect(protectedHits('Family Essentials', 'en')).toContain('family');
    expect(protectedHits('Speak with a Diaspora Specialist', 'en')).toContain('diaspora');
    expect(protectedHits('good school district', 'en')).toContain('school');
  });

  it('catches PL and ES equivalents, with diacritics', () => {
    expect(protectedHits('Poradnik dla rodzin', 'pl')).toContain('rodzin');
    expect(protectedHits('Blisko szkoły i przedszkola', 'pl')).toContain('szkol');
    expect(protectedHits('Ideal para familias con niños', 'es')).toEqual(
      expect.arrayContaining(['familia', 'nino']),
    );
    expect(protectedHits('Cerca del colegio', 'es')).toContain('colegio');
  });

  it('does not flag property facts or look-alike words', () => {
    expect(protectedHits('Single-family house, 4BR', 'en')).toEqual([]);
    expect(protectedHits('Dom jednorodzinny z ogrodem', 'pl')).toEqual([]);
    expect(protectedHits('Chalet unifamiliar con jardín', 'es')).toEqual([]);
    expect(protectedHits('A familiar address', 'en')).toEqual([]);
    expect(protectedHits('Moving Up — 4BR with Space to Spare', 'en')).toEqual([]);
  });
});

describe('every served playbook string is free of protected characteristics', () => {
  const playbooks = [...getAllPlaybooks().values()];

  const byId = (id: string): PlaybookEntry => {
    const p = playbooks.find((x) => x.archetype === id);
    if (p === undefined) throw new Error(`missing playbook ${id}`);
    return p;
  };

  it('covers all 18 archetypes', () => {
    expect(playbooks).toHaveLength(18);
  });

  it('has no hit in any slot, variant or listing-rule flag, in any locale', () => {
    const hits = playbooks.flatMap((p) =>
      servedStrings(p)
        .map((s) => ({ ...s, stems: protectedHits(s.text, s.locale) }))
        .filter((s) => s.stems.length > 0)
        .map((s) => `${s.where} [${s.locale}] "${s.text}" -> ${s.stems.join(',')}`),
    );
    expect(hits).toEqual([]);
  });

  it('serves PL and ES for the three slots reworded by FOLLOW-1366', () => {
    const family = byId('family_buyer');
    const diaspora = byId('diaspora_buyer');
    for (const slot of [
      family.slots.find((s) => s.slot === 'cta'),
      family.slots.find((s) => s.slot === 'feature'),
      diaspora.slots.find((s) => s.slot === 'cta'),
    ]) {
      expect(slot?.pl?.length).toBeGreaterThan(0);
      expect(slot?.es?.length).toBeGreaterThan(0);
    }
  });
});

/**
 * FOLLOW-1400: a `copy_template` must never RECOMMEND a phrase the familial-steering refusal
 * refuses — the description path and `/api/adapt` both refuse it, so the template would only
 * produce refusals. The diaspora PL template recommended "zabezpieczenie dla rodziny w kraju" and
 * "adres rozpoznawalny dla rodziny"; Sonnet 5.5 wrote them (FOLLOW-1399). A template may still
 * NAME a steering phrase inside a prohibition ("Never call an area family-friendly", an "Avoid:"
 * list): those sentences are pinned below, so a new matching sentence fails until it is reviewed.
 */
describe('no copy_template recommends a familial-steering phrase [FOLLOW-1400]', () => {
  const PROHIBITIONS: readonly string[] = [
    'yield_hunter en: dream, perfect for, family-friendly',
    // FOLLOW-1407 retired the yield_hunter pl pin (`nie "miejsce dla dzieci"`): the garden is now
    // a lettability fact, and the family-occupant framing has its own scan below.
    'vacation_rental_investor en: family home, retirement',
    'family_buyer en: Never call an area family-friendly',
    'family_buyer pl: Nie nazywaj okolicy przyjazną rodzinom',
    'family_buyer es: Nunca llames a una zona apta para familias',
    // FOLLOW-1409: upsizer carries the same ban as family_buyer.
    'upsizer en: Never call an area family-friendly',
    'upsizer pl: Nie nazywaj okolicy przyjazną rodzinom',
    'upsizer es: Nunca llames a una zona apta para familias',
    'student_parent en: family home, retirement',
  ];

  it('every template sentence the scanner matches is a pinned prohibition', () => {
    const matched = [...getAllPlaybooks().values()].flatMap((p) =>
      Object.entries(p.copy_template).flatMap(([locale, text]) =>
        text
          .split(/(?<=[.;:])\s+/)
          .filter((sentence) => steersByFamilialStatus(sentence))
          .map((sentence) => `${p.archetype} ${locale}: ${sentence}`),
      ),
    );
    const unpinned = matched.filter((m) => !PROHIBITIONS.some((pin) => m.startsWith(pin)));
    expect(unpinned).toEqual([]);
    expect(matched).toHaveLength(PROHIBITIONS.length);
  });
});

/**
 * FOLLOW-1407: two templates contradicted the familial-steering refusal that runs on every request
 * (ESC-088, FOLLOW-1400). yield_hunter framed a garden as "family-tenant retention" (en) /
 * "retencję rodzinnego najemcy" (pl) — a feature sold by who will live there; family_buyer allowed
 * the reader's children or household "unless the listing text itself does" (and "unless the
 * reader's profile adds it") — the refusal admits no such exception, whoever wrote the words.
 * Neither was visible to `steersByFamilialStatus`, so these two scans read the templates directly.
 */
describe('no copy_template contradicts the familial-steering refusal [FOLLOW-1407]', () => {
  const templateSentences = (): { where: string; sentence: string }[] =>
    [...getAllPlaybooks().values()].flatMap((p) =>
      Object.entries(p.copy_template).flatMap(([locale, text]) =>
        text
          .split(/(?<=[.;:])\s+/)
          .map((sentence) => ({ where: `${p.archetype} ${locale}`, sentence })),
      ),
    );

  /** The reader's children or household, in the three template languages. */
  const HOUSEHOLD =
    /(?<![\p{L}])(?:child|children|kids?|household|dzieci|dziecko|domownik\p{L}*|gospodarstw\p{L}*|hijos?|hogar)(?![\p{L}])/iu;
  /** An exception clause: the ban would hold only sometimes. */
  const EXCEPTION =
    /(?<![\p{L}])(?:unless|except|chyba że|jeśli nie robi|o ile|salvo que|a menos que|excepto)(?![\p{L}])/iu;
  /** A feature framed by a family occupant (a tenant, a renter, a buyer). */
  const FAMILY_OCCUPANT =
    /(?:family[- ](?:tenants?|renters?|occupiers?|retention)|rodzinn\p{L}*\s+najem\p{L}*|najemc\p{L}*\s+z\s+dzie\p{L}*|inquilin\p{L}*\s+familiar\p{L}*|familias?\s+inquilinas?)/iu;

  it('the scans see the wording FOLLOW-1407 retired', () => {
    expect(
      HOUSEHOLD.test("never refer to the reader's children or household unless the listing does") &&
        EXCEPTION.test("never refer to the reader's children or household unless the listing does"),
    ).toBe(true);
    expect(EXCEPTION.test('i nie odnoś się do dzieci, jeśli nie robi tego sam opis oferty')).toBe(
      true,
    );
    expect(
      FAMILY_OCCUPANT.test('a garden is outdoor amenity that supports family-tenant retention'),
    ).toBe(true);
    expect(FAMILY_OCCUPANT.test('ogród zwiększający retencję rodzinnego najemcy')).toBe(true);
    expect(FAMILY_OCCUPANT.test('Single-family house with a garden')).toBe(false);
  });

  it('no template allows the reader’s children or household under an exception', () => {
    const hits = templateSentences()
      .filter(({ sentence }) => HOUSEHOLD.test(sentence) && EXCEPTION.test(sentence))
      .map(({ where, sentence }) => `${where}: ${sentence}`);
    expect(hits).toEqual([]);
  });

  it('no template frames a feature by a family occupant', () => {
    const hits = templateSentences()
      .filter(({ sentence }) => FAMILY_OCCUPANT.test(sentence))
      .map(({ where, sentence }) => `${where}: ${sentence}`);
    expect(hits).toEqual([]);
  });

  it('family_buyer bans the reader’s children and household outright, in every locale', () => {
    const family = getAllPlaybooks().get('family_buyer')!;
    expect(family.copy_template.en).toContain(
      "never refer to the reader's children or household composition, even when the listing text does",
    );
    expect(family.copy_template.pl).toContain(
      'nie odnoś się do dzieci czytelnika ani do składu jego gospodarstwa domowego, nawet jeśli robi to opis oferty',
    );
    expect(family.copy_template.es).toContain(
      'ni hagas referencia a los hijos del lector ni a la composición de su hogar, aunque lo haga el propio anuncio',
    );
  });
});

/**
 * FOLLOW-1409: three templates still framed a home by who would live in it, which the
 * familial-steering refusal forbids on every request (ESC-088): `upsizer` sold rooms as "the
 * second child's bedroom" / "where the next child has their own room" (pl, es alike) and let PL and
 * ES copy refer to districts "dobrze ocenianych przez rodziny" / "bien valoradas por familias";
 * `lifestyle_expat` placed the reader among "international families". None of these matched
 * `steersByFamilialStatus`, so these scans read the templates directly. `family_buyer`'s
 * `description` (it reaches the `/api/adapt` prompts) told the model that children "are assumed"
 * when the `has_children` trait is present; the trait's own rules forbid referring to children.
 */
describe('no copy_template frames a home by its occupants [FOLLOW-1409]', () => {
  const templateSentences = (): { where: string; sentence: string }[] =>
    [...getAllPlaybooks().values()].flatMap((p) =>
      Object.entries(p.copy_template).flatMap(([locale, text]) =>
        text
          .split(/(?<=[.;:])\s+/)
          .map((sentence) => ({ where: `${p.archetype} ${locale}`, sentence })),
      ),
    );

  /** A child, in the three template languages. */
  const CHILD =
    /(?<![\p{L}])(?:child\p{L}*|kids?|teen\p{L}*|dzie(?:ci|ck|ć)\p{L}*|nastolat\p{L}*|hij[oa]s?|niñ\p{L}*|adolescent\p{L}*)(?![\p{L}])/iu;
  /** Families as the residents or the judges of an area. */
  const AREA_BY_FAMILIES =
    /(?:international\s+families|families\s+(?:have|already|live|settled)|(?:rated|valued|popular|chosen)\s+(?:\p{L}+\s+)?(?:by|with|among)\s+families|(?:ocenian|lubian|wybieran|popularn)\p{L}*\s+(?:\p{L}+\s+)?(?:przez|wśród)\s+rodzin\p{L}*|(?:valorad|elegid|preferid|popular)\p{L}*\s+(?:\p{L}+\s+)?(?:por|entre)\s+(?:las\s+)?familias|familias\s+internacionales)/iu;

  /**
   * Every template sentence that names a child: a prohibition, or `student_parent`'s purpose (the
   * reader buys for a student; the student is the buyer's stated purpose, not an occupant the copy
   * imagines). A new match fails until it is reviewed and pinned here.
   */
  const CHILD_PINS: readonly string[] = [
    'family_buyer en: never write about children',
    "family_buyer en: Never call an area family-friendly, safe, or suited to families, and never refer to the reader's children",
    'family_buyer pl: nigdy nie pisz o dzieciach',
    'family_buyer pl: Nie nazywaj okolicy przyjazną rodzinom',
    'family_buyer es: nunca escribas sobre hijos',
    'family_buyer es: Nunca llames a una zona apta para familias',
    'upsizer en: never write about children',
    "upsizer en: Never call an area family-friendly, safe, or suited to families, and never refer to the reader's children",
    'upsizer pl: nigdy nie pisz o dzieciach',
    'upsizer pl: Nie nazywaj okolicy przyjazną rodzinom',
    'upsizer es: nunca escribas sobre hijos',
    'upsizer es: Nunca llames a una zona apta para familias',
    'student_parent en: The reader is a parent buying for a child going to university',
    'student_parent en: a calm home for the child today',
    'student_parent pl: Czytelnik to rodzic kupujący dla dziecka idącego na studia',
    'student_parent pl: spokojny dom dla dziecka teraz',
    'student_parent es: El lector es progenitor que compra para un hijo',
    'student_parent es: hogar tranquilo para el hijo hoy',
  ];

  it('the scans see the wording FOLLOW-1409 retired', () => {
    for (const retired of [
      "a room that becomes the second child's bedroom, a study that becomes a teenager's space",
      'Frame the home as the one where the next child has their own room',
      'pokój, który stanie się sypialnią drugiego dziecka',
      'gdzie kolejne dziecko ma swój pokój',
      'una habitación que se convertirá en el cuarto del segundo hijo',
      'donde el próximo hijo tiene su propia habitación',
    ]) {
      expect(CHILD.test(retired), retired).toBe(true);
    }
    for (const retired of [
      'W PL możesz odnosić się ogólnie do dzielnic dobrze ocenianych przez rodziny',
      'En contexto ES referencia genérica a zonas residenciales bien valoradas por familias',
      'neighbourhoods where international families have already settled',
      'barrios con familias internacionales ya asentadas',
    ]) {
      expect(AREA_BY_FAMILIES.test(retired), retired).toBe(true);
    }
    expect(
      AREA_BY_FAMILIES.test('Single-family house in an established international community'),
    ).toBe(false);
  });

  it('every template sentence naming a child is a pinned prohibition or purpose', () => {
    const matched = templateSentences()
      .filter(({ sentence }) => CHILD.test(sentence))
      .map(({ where, sentence }) => `${where}: ${sentence}`);
    const unpinned = matched.filter((m) => !CHILD_PINS.some((pin) => m.startsWith(pin)));
    expect(unpinned).toEqual([]);
    expect(matched).toHaveLength(CHILD_PINS.length);
  });

  it('no template characterises an area by the families who live in or rate it', () => {
    const hits = templateSentences()
      .filter(({ sentence }) => AREA_BY_FAMILIES.test(sentence))
      .map(({ where, sentence }) => `${where}: ${sentence}`);
    expect(hits).toEqual([]);
  });

  it('upsizer bans the reader’s children and household outright, in every locale', () => {
    const upsizer = getAllPlaybooks().get('upsizer')!;
    expect(upsizer.copy_template.en).toContain(
      "never refer to the reader's children or household composition, even when the listing text does",
    );
    expect(upsizer.copy_template.pl).toContain(
      'nie odnoś się do dzieci czytelnika ani do składu jego gospodarstwa domowego, nawet jeśli robi to opis oferty',
    );
    expect(upsizer.copy_template.es).toContain(
      'ni hagas referencia a los hijos del lector ni a la composición de su hogar, aunque lo haga el propio anuncio',
    );
  });

  it('no playbook description tells the model to assume children', () => {
    const hits = [...getAllPlaybooks().values()]
      .filter((p) => p.archetype !== 'student_parent')
      .filter((p) => CHILD.test(p.description) && !/\bnever\b/i.test(p.description))
      .map((p) => `${p.archetype}: ${p.description}`);
    expect(hits).toEqual([]);
    expect(getAllPlaybooks().get('family_buyer')!.description).not.toMatch(/assum/i);
  });
});
