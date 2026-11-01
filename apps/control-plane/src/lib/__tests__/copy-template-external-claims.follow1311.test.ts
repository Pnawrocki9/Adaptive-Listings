/**
 * FOLLOW-1311 slice 6 — a `copy_template` sends the model to the listing, not to the world.
 *
 * The blind audit of 2026-10-26 found 38 external claims in Sonnet's 45 served texts, mostly
 * template-led ("operational from week one", "value-add levers"). Templates told the model that a
 * claim was acceptable if "the location is generally mild" or "near a university by general
 * knowledge", and the Polish and Spanish ones named cities and markets to refer to "generically".
 * Under §E.7.0 (ESC-076) a directive comes from the listing's own words: if the listing states it,
 * use it; if not, do not assert it. This pins the closed list of those invitations in en | pl | es,
 * so a new one fails here until it is reviewed. It reads the templates, not what a model writes.
 */
import { describe, expect, it } from 'vitest';
import { getAllPlaybooks } from '@estalara/shared/playbooks';

/** Each invited a claim from outside the listing; none may come back. */
const INVITATIONS: readonly string[] = [
  // en: permission from general knowledge of the place, the market or the law.
  'general knowledge',
  'generally mild',
  'established tourist market',
  'established diaspora destination',
  'location supports it',
  'price and country',
  'week one',
  'seasoned market',
  'established demand',
  'student rental market at graduation',
  // pl
  'odnoś się ogólnie',
  'ogólnie łagodna',
  'ustabilizowany rynek turystyczny',
  'typowym kierunkiem diaspory',
  'ogólnie znanej',
  'cena i kraj',
  'tygodniu pierwszym',
  'dojrzały rynek',
  'ustabilizowany popyt',
  'rynek najmu studenckiego po dyplomie',
  // es
  'referencia genérica',
  'referencias genéricas',
  'puedes referirte',
  'puedes mencionar genéricamente',
  'de forma general',
  'conocimiento general',
  'mercado turístico consolidado',
  'destino diáspora',
  'contexto general',
  'semana uno',
  'mercado consolidado',
  'demanda asentada',
  'alquiler estudiantil al graduarse',
];

/** "możesz odnosić się" stays once: `diaspora_buyer` pl, the reader's motive, not a fact. */
const MOTIVE = /możesz odnosić się do "powrotu"[^.]*jako motywu czytelnika, nigdy jako faktu/u;

describe('FOLLOW-1311 slice 6 — copy templates and claims from outside the listing', () => {
  const templates = [...getAllPlaybooks().values()].flatMap((p) =>
    Object.entries(p.copy_template).map(([locale, text]) => ({
      where: `${p.archetype} ${locale}`,
      text,
    })),
  );

  it('reads all 18 archetypes in 3 locales', () => {
    expect(templates).toHaveLength(54);
  });

  it.each(INVITATIONS)('no template says "%s"', (phrase) => {
    const found = templates.filter(({ text }) => text.includes(phrase)).map(({ where }) => where);
    expect(found).toEqual([]);
  });

  it('the only "you may refer to" left in Polish is the reader\'s motive', () => {
    const found = templates
      .filter(({ text }) => text.replace(MOTIVE, '').includes('możesz odnosić się'))
      .map(({ where }) => where);
    expect(found).toEqual([]);
    expect(templates.filter(({ text }) => MOTIVE.test(text)).map(({ where }) => where)).toEqual([
      'diaspora_buyer pl',
    ]);
  });

  it('an "acceptable" area, market or property claim now hangs on the listing', () => {
    const copy = new Map(templates.map(({ where, text }) => [where, text]));
    for (const [where, line] of [
      ['diaspora_buyer en', 'Say non-resident purchase is well-trodden only if the listing does'],
      ['retiree_relocator en', '"Mild climate" only if the listing says so'],
      ['student_parent en', '"Walking distance to campus" only if the listing says so'],
      ['lifestyle_expat pl', 'tylko jeśli mówi o niej oferta'],
      ['golden_visa_buyer es', 'solo si las menciona el anuncio'],
    ] as const) {
      expect(copy.get(where), where).toContain(line);
    }
  });
});
