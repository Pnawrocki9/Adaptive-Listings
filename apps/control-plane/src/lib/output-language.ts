/**
 * Output-language check of the description generator — FOLLOW-1384.
 *
 * The FOLLOW-1380 comparison found Polish descriptions served on English pages (Haiku 5.5 wrote
 * 3 of them in the FOLLOW-1381 re-run): the generator asked for a language and never looked at
 * what came back. This is the cheap, deterministic look: count the FUNCTION WORDS of each
 * supported language (en / pl / es) in the text, and call it the wrong language only when another
 * language's function words clearly outnumber the requested one's.
 *
 * Why function words and not diacritics or a language-ID library:
 *   - Proper names carry diacritics ("ul. Kłobucka", "Jávea", "Mokotów") and must not refuse an
 *     English text that names a Polish street; function words ("w", "z", "na", "the", "con") are
 *     not names. Diacritics are therefore ignored.
 *   - A word that is a function word in two supported languages is in neither list ("a", "i",
 *     "o", "no", "do", "to", "on", "ten", "we", "tu", "son", ...), so a shared word never counts.
 *   - A function word inside a capitalised name ("Costa del Sol", "Playa de la Arenal", "Nowe
 *     Miasto nad Wartą") is not counted: a word whose nearest neighbours on BOTH sides (skipping
 *     other function words) start with a capital is taken as part of the name.
 *   - No dependency: the repo has no language-ID package, and the three-language question needs
 *     nothing more than these lists.
 *
 * The rule refuses only on clear evidence, so a short text with a few names is never refused: the
 * best other language needs at least {@link MIN_EVIDENCE} counted words AND more than
 * {@link DOMINANCE} times the requested language's count. Pure, no I/O.
 *
 * @module apps/control-plane/src/lib/output-language
 */

type Language = 'en' | 'pl' | 'es';

const FUNCTION_WORDS: Readonly<Record<Language, ReadonlySet<string>>> = {
  en: new Set(
    (
      'the and with of in for is are this that from by its it an at which has have be into your ' +
      'you while where each or but as near was were will can there their our all also every any ' +
      'more than very so not only through within between onto over under after before both'
    ).split(' '),
  ),
  pl: new Set(
    (
      'w z ze na się jest są oraz dla przy od po pod jak że lub też także który która które ' +
      'którym której tym ta jego jej być można bardzo nad przez za bez już czy tylko ich nie co ' +
      'gdzie jako tego tej tutaj wraz około obok między więc'
    ).split(' '),
  ),
  es: new Set(
    (
      'el la los las y que con para por del una un es se su sus al lo muy más en de este esta ' +
      'como pero desde hasta sobre entre también cada donde está están le les ya todo toda todos'
    ).split(' '),
  ),
};

const LANGUAGES: readonly Language[] = ['en', 'pl', 'es'];

/** The fewest counted words of another language that can refuse a text. */
const MIN_EVIDENCE = 2;
/** How many times the requested language's count another language must exceed. */
const DOMINANCE = 2;

const TOKEN_RE = /\p{L}+(?:['’]\p{L}+)*/gu;
const CAPITALISED_RE = /^\p{Lu}/u;

function isFunctionWord(lower: string): boolean {
  return LANGUAGES.some((lang) => FUNCTION_WORDS[lang].has(lower));
}

/** Function-word counts per language, names excluded. */
function functionWordCounts(text: string): Record<Language, number> {
  const tokens = Array.from(text.matchAll(TOKEN_RE), (m) => m[0]);
  const lower = tokens.map((t) => t.toLowerCase());
  const counts: Record<Language, number> = { en: 0, pl: 0, es: 0 };
  const capitalisedNeighbour = (from: number, step: 1 | -1): boolean => {
    for (let j = from + step; j >= 0 && j < tokens.length; j += step) {
      if (!isFunctionWord(lower[j] ?? '')) return CAPITALISED_RE.test(tokens[j] ?? '');
    }
    return false;
  };
  for (const [i, word] of lower.entries()) {
    const langs = LANGUAGES.filter((lang) => FUNCTION_WORDS[lang].has(word));
    if (langs.length === 0) continue;
    if (capitalisedNeighbour(i, -1) && capitalisedNeighbour(i, 1)) continue;
    for (const lang of langs) counts[lang] += 1;
  }
  return counts;
}

/**
 * Is `text` written in another supported language than `locale` asks for?
 *
 * @param text - A generated description body or headline.
 * @param locale - The page's locale, the language the prompt asked for.
 * @returns `'wrong_language'` when another language clearly dominates, else `null`.
 */
export function checkOutputLanguage(text: string, locale: Language): 'wrong_language' | null {
  const counts = functionWordCounts(text);
  const target = counts[locale];
  for (const lang of LANGUAGES) {
    if (lang === locale) continue;
    if (counts[lang] >= MIN_EVIDENCE && counts[lang] > DOMINANCE * target) return 'wrong_language';
  }
  return null;
}
