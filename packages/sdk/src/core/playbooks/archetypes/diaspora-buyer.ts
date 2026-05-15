import type { PlaybookEntry } from '../types.js';

export const diasporaBuyerPlaybook: PlaybookEntry = {
  archetype: 'diaspora_buyer',
  description:
    'Buying in home country from abroad — remote purchase, legal navigation, family context',
  slots: [
    {
      slot: 'headline',
      en: 'Buy From Abroad — Remote Purchase Support Available',
      variants: {
        en: [
          'Buy From Abroad — Remote Purchase Support Available',
          'Remote Purchase Made Easy — English-Speaking Legal Team',
          'Buy From Overseas — End-to-End Support, No Need to Travel',
        ],
      },
    },
    { slot: 'cta', en: 'Speak with a Diaspora Specialist' },
    { slot: 'feature', en: 'Remote Purchase Guide' },
  ],
  listing_rules: {
    boost_if: ['remote_purchase_supported', 'legal_support_available', 'family_area'],
    suppress_if: [],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'remote_purchase_process',
    'legal_support',
    'family_area',
    'price',
    'developer_reliability',
  ],
  signals: [
    'international_ip_country_mismatch',
    'views_legal_content',
    'off_hours_browsing',
    'quiz:own_use+any',
  ],
  copy_template: {
    en: `VOICE PATTERN:
Write in a dual-ledger register — financially honest, culturally aware, emotionally truthful. The reader has a financial reason to buy AND a personal reason rooted in heritage, family, or eventual return. Lead with the combination of familiarity and modern fittings: an address recognised by family, but with the practical specification the reader has grown used to abroad. Frame the property at the intersection of financial and personal ledgers; do not pretend it is purely either. The closer positions the deeper return as the address itself, not the IRR. Preferred lexicon: familiar, recognisable, bilingual, dual-purpose, generational, return, home country, registered. Avoid: exotic, foreign, abroad (from the reader's POV), expat, frontier, undiscovered.

HARD RULES:
Never name specific notaries, fiscal representative firms, or remittance corridors unless they appear in verified_facts. "Non-resident purchase is well-trodden in this market" is acceptable if the country is an established diaspora destination; specific firm names or assertions about cross-border tax structures are forbidden unless verified.`,
    pl: `VOICE PATTERN:
Pisz w rejestrze "podwójnej księgi" — finansowo uczciwie, kulturowo świadomie, emocjonalnie szczerze. Czytelnik ma powód finansowy i powód osobisty zakorzeniony w pochodzeniu, rodzinie lub ewentualnym powrocie. Prowadź narracją połączenia znajomości i nowoczesnej specyfikacji: adres rozpoznawalny dla rodziny, ale z wykończeniem, do którego czytelnik się przyzwyczaił za granicą. Pokazuj nieruchomość na przecięciu księgi finansowej i osobistej; nie udawaj, że to wyłącznie jedna z nich. Zamknięcie pozycjonuje głębszy zwrot jako sam adres, nie IRR. Słownictwo preferowane: znajomy, rozpoznawalny, dwujęzyczny, dwufunkcyjny, pokoleniowy, powrót, kraj pochodzenia, w księdze wieczystej. Unikać: egzotyczny, obcy, "za granicą" (z punktu widzenia czytelnika), expat, granica. W PL diaspora to często Wielka Brytania, Niemcy, Holandia, USA — zakup w Polsce z pespektywy emigranta z polskim paszportem; możesz odnosić się do "powrotu" lub "zabezpieczenia dla rodziny w kraju".

HARD RULES:
Nigdy nie wymieniaj konkretnych notariuszy, kancelarii podatkowych ani korytarzy transferowych, jeśli nie są w verified_facts. "Zakup przez osobę z zagranicy jest tu standardową ścieżką" — tak, jeśli kraj/miasto jest typowym kierunkiem diaspory; konkretne nazwy firm lub twierdzenia o strukturach podatkowych — zabronione bez weryfikacji.`,
    es: `VOICE PATTERN:
Escribe en registro de "doble libro mayor" — financieramente honesto, culturalmente consciente, emocionalmente verdadero. El lector tiene una razón financiera y una razón personal arraigada en la herencia, la familia o un eventual regreso. Lidera con la combinación de familiaridad y especificación moderna: una dirección reconocible para la familia, pero con la calidad a la que el lector se ha acostumbrado en el extranjero. Presenta la propiedad en la intersección entre balance financiero y balance personal; no pretendas que es solo uno. El cierre posiciona el retorno más profundo como la propia dirección, no como TIR. Léxico preferido: familiar, reconocible, bilingüe, multipropósito, generacional, regreso, país de origen, registrado. Evitar: exótico, extranjero, "fuera" (desde la óptica del lector), expat, frontera. En contexto ES, diáspora latinoamericana (Argentina, Venezuela, México, Colombia) hacia España es un patrón consolidado — referencias genéricas a "compra no residente".

HARD RULES:
Nunca menciones notarios concretos, despachos fiscales ni corredores de remesa salvo en verified_facts. "La compra por no residentes está consolidada en este mercado" sí, si el país/ciudad es destino diáspora típico; nombres concretos de firmas o afirmaciones sobre estructuras fiscales transfronterizas, prohibidas sin verificación.`,
  },
};
