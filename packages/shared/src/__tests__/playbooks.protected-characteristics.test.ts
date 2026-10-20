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
 * words only as prohibitions: "never call an area family-friendly") and the trait add-ons (pinned
 * by `playbook-traits.test.ts`). NOT SCANNED, KNOWN GAP: `description`, `signals` and
 * `feature_priority`. `description` and `signals` DO reach the LLM prompts
 * (`apps/control-plane/src/lib/llm-gateway.ts`), so this is a gap, not an exemption; a follow-up
 * scrubs and scans them.
 *
 * NOT IN THE LIST, deliberately (pending a compliance ruling): `expat` (a residence
 * status, not a national origin), `retire*` (a life stage, not an age). The list is stems matched
 * at a word start, diacritics folded, so "children" and "dzieci" are caught but "familiar" is not.
 */

import { describe, it, expect } from 'vitest';
import { getAllPlaybooks } from '../playbooks/index.js';
import type { PlaybookEntry } from '../playbooks/types.js';

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
