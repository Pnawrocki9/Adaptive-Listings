/**
 * FOLLOW-1429 — a Polish or Spanish `copy_template` is written in the language, not translated.
 *
 * The blind audit found 32 language errors in 21 of 56 served pl/es texts. Most were stock phrases
 * of the voice pattern carried over word for word from the English line ("engineered for more
 * weekends", "exit math", "lease tail", "the deeper return", "made operational", "good bones",
 * "dual-ledger"), which a model then quoted. This pins the closed list of those calques in pl | es,
 * so one that comes back fails here. It reads the templates, not what a model writes.
 */
import { describe, expect, it } from 'vitest';
import { getAllPlaybooks } from '@estalara/shared/playbooks';

/** Each is a calque the audit saw served; none may come back in the locale named. */
const CALQUES: readonly (readonly ['pl' | 'es', string])[] = [
  ['pl', 'pod więcej weekendów'],
  ['pl', 'w wersji operacyjnej'],
  ['pl', 'matematyk'],
  ['pl', 'kości lokalu'],
  ['pl', 'ogon'],
  ['pl', 'głębszy zwrot'],
  ['pl', 'podwójnej księgi'],
  ['pl', 'dwujęzyczny, dwufunkcyjny'],
  ['pl', 'dwufunkcyjny, niska administracja'],
  ['es', 'ingeniad'],
  ['es', 'hecha operativa'],
  ['es', 'matemática de salida'],
  ['es', 'recorrido de reforma'],
  ['es', 'huesos del piso'],
  ['es', 'cola de contrato'],
  ['es', 'retorno más profundo'],
];

describe('FOLLOW-1429 — pl/es copy templates carry no stock-phrase calque', () => {
  const templates = [...getAllPlaybooks().values()].flatMap((p) =>
    Object.entries(p.copy_template).map(([locale, text]) => ({
      archetype: p.archetype,
      locale,
      text,
    })),
  );

  it.each(CALQUES)('no %s template says "%s"', (locale, phrase) => {
    const found = templates
      .filter((t) => t.locale === locale && t.text.includes(phrase))
      .map((t) => t.archetype);
    expect(found).toEqual([]);
  });

  it('the replacement lines are there, so the pin cannot pass on an emptied template', () => {
    const copy = new Map(templates.map((t) => [`${t.archetype} ${t.locale}`, t.text]));
    expect(copy.get('second_home_buyer pl')).toContain('miejsce na więcej weekendów');
    expect(copy.get('second_home_buyer es')).toContain('un lugar para más fines de semana');
    expect(copy.get('flip_investor pl')).toContain('rachunek ze sprzedaży');
    expect(copy.get('commercial_investor es')).toContain('plazo restante del contrato');
  });
});
