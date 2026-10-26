/**
 * Model meta-commentary that must never reach a buyer — FOLLOW-1392.
 *
 * A Sonnet 5.5 description body (FOLLOW-1381 live run, `waw.first_time_buyer.en`) ended with a
 * paragraph addressed to the operator, not the buyer: "Correction: the first sentence above
 * contains a slip (…). The corrected opening is: … The rest of the description stands as
 * written." The checks saw only facts, so a text that talks ABOUT itself could be served. Both
 * paths refuse such a text as `meta_commentary` — the description body (`bodyViolatesContract`),
 * the description headline, and every `/api/adapt` directive slot. Refused, never stripped: a text
 * that comments on itself has stopped being copy, and what is left after a cut is not a text the
 * model wrote.
 *
 * Closed lists, en / pl / es, case-insensitive, no model call:
 *
 *   - A NOTE MARKER followed by a colon, at the start of the text, of a line, or of a sentence
 *     ("Correction:", "Note:", "N.B.:", "Word count:", "Poprawka:", "Uwaga:", "Nota:",
 *     "Corrección:"). The colon is required, so the imperative "Note the south-facing terrace"
 *     and "Uwaga na schody" are copy, not commentary.
 *   - An explicit PHRASE anywhere: the model speaking as itself ("As an AI", "I cannot",
 *     "I apologise", "Przepraszam", "No puedo"), a preamble ("Here is the description", "Oto
 *     opis", "Aquí tienes"), a reference to its inputs ("the listing above", "the facts provided",
 *     "the prompt", "the instructions", "powyższy opis", "los datos proporcionados"), a word count
 *     ("(120 words)", "120 słów"), a bracketed placeholder ("[insert agent name]", "[wstaw …]",
 *     "[añadir …]") and a self-correction in flight ("A two-bedroom... no, a two-room flat").
 *
 * What is deliberately NOT here: "the listing" on its own ("The listing names two items" talks
 * to the buyer about the advert), a statement of what the listing leaves out ("Nie podano danych
 * o rentowności", "the information given in the listing", "los datos proporcionados por el
 * vendedor" — the FOLLOW-1392 live re-run's one false positive) and "here is a home that…" (copy, not a preamble — only "here
 * is/here's" + the/a/your + a word for the text itself, or a line-opening preamble ending in a
 * colon, counts).
 *
 * @module apps/control-plane/src/lib/meta-commentary
 */

const W = '\\p{L}\\p{N}_';
const B_START = `(?<![${W}])`;
const B_END = `(?![${W}])`;

/** Words that open a note to the operator when a colon follows them. */
const NOTE_MARKERS = [
  // en
  'corrections?',
  'corrected(?: (?:opening|version|text|sentence|headline|description))?',
  'erratum',
  'errata',
  'notes?',
  'n\\.?\\s?b\\.?',
  "editor[’']s note",
  "author[’']s note",
  'disclaimer',
  'word count',
  'revision',
  'revised(?: (?:opening|version|text|sentence|headline|description))?',
  'translation',
  'explanation',
  'rationale',
  // pl
  'poprawk[ai]',
  'korekt[ay]',
  'sprostowanie',
  'uwag[ai]',
  'notatk[ai]',
  'nota',
  'przypis',
  'wyjaśnienie',
  'tłumaczenie',
  'liczba słów',
  // es
  'correcci[oó]n(?:es)?',
  'notas?',
  'aclaraci[oó]n',
  'fe de erratas',
  'recuento de palabras',
  'traducci[oó]n',
  'explicaci[oó]n',
];

/**
 * A note marker + colon at the start of the text, of a line, or after a sentence end. The marker
 * may be wrapped in brackets or emphasis ("(Note: …)", "[Correction]:").
 */
const NOTE_RE = new RegExp(
  `(?:^|[\\n.!?…]\\s*)[\\s([*_]*${B_START}(?:${NOTE_MARKERS.join('|')})${B_END}[\\])*_]*\\s*[:：]`,
  'iu',
);

/** Words a model uses for the text it is writing. */
const TEXT_WORDS_EN =
  '(?:(?:revised|rewritten|adapted|updated|final|corrected|new|improved|requested) )?' +
  '(?:description|listing description|listing copy|copy|text|version|headline|draft|rewrite|paragraph)';

/** The same, in Spanish. */
const TEXT_WORDS_ES =
  '(?:(?:nueva|revisada|adaptada|corregida|actualizada|final) )?' +
  '(?:descripci[oó]n|texto|versi[oó]n|titular|anuncio|propuesta|borrador|p[aá]rrafo)' +
  '(?: (?:revisad|adaptad|corregid|actualizad|nuev)[oa])?';

const PHRASES = [
  // ── en: the model speaking as itself ──
  'as an ai',
  'as a language model',
  'as an assistant',
  "i (?:cannot|can[’']t|can not|am unable to|[’']m unable to|won[’']t be able to)",
  'i apologi[sz]e',
  'my apologies',
  'sorry for (?:the|any) (?:error|confusion|mistake|slip)',
  "i (?:have|[’']ve) (?:written|rewritten|kept|avoided|removed|added|adapted|included|corrected|made sure)",
  'i (?:wrote|rewrote|kept|avoided|removed|added|corrected)',
  // ── en: preambles ──
  `here(?: is|[’']s| are) (?:the|a|an|your|my) ${TEXT_WORDS_EN}`,
  // ── en: references to its own inputs or text ──
  '(?:the )?(?:listing|description|text|sentence|paragraph|copy|headline|facts?) (?:above|below)',
  '(?:the )?above (?:listing|description|text|sentence|paragraph|copy|headline|facts?)',
  '(?:the )?(?:facts?|information|details|data|listing|text|description) (?:provided|supplied|given) (?:to me|above|below|in the prompt)',
  'the facts? (?:provided|supplied|given)(?! by)',
  'the provided (?:facts?|listing|text|description)',
  '(?:verified|listing) facts (?:provided|given|supplied|list)',
  '(?:the|my|this|your|system|user) prompt(?! (?:sale|handover|completion|response|reply|payment|service|attention|access|transfer|exchange))',
  '(?:the|my|these|your) instructions',
  'as instructed',
  'original (?:listing )?description',
  'the rest of the (?:description|text|copy) stands',
  // ── en: word counts ──
  'word count',
  '\\p{Nd}+ words',
  // ── pl ──
  'jako (?:ai|si|model językowy|asystent)',
  'nie (?:mogę|jestem w stanie)',
  'przepraszam',
  'oto (?:poprawion\\p{L}* |zaktualizowan\\p{L}* |now\\p{L}* |dostosowan\\p{L}* )?(?:opis|tekst|wersj\\p{L}*|nagłówek|propozycj\\p{L}*|treść)',
  'poniżej (?:znajdziesz |przedstawiam |zamieszczam )?(?:opis|tekst|wersj\\p{L}*|nagłówek)',
  'powyższ\\p{L}* (?:opis\\p{L}*|tekst\\p{L}*|zdani\\p{L}*|ogłoszeni\\p{L}*|fakt\\p{L}*|akapit\\p{L}*|nagłów\\p{L}*)',
  '(?:podan|dostarczon|przekazan|zweryfikowan)\\p{L}* fakt\\p{L}*',
  'dostarczon\\p{L}* (?:informacj|dan)\\p{L}*',
  '(?:fakt\\p{L}*|informacj\\p{L}*|dan\\p{L}*) (?:podan|dostarczon|przekazan)\\p{L}* (?:powyżej|poniżej|w prompcie)',
  'w prompcie',
  '(?:zgodnie z |według )instrukcj\\p{L}*',
  'liczba słów',
  '\\p{Nd}+ słów',
  'oryginaln\\p{L}* opis\\p{L}*',
  // ── es ──
  'como (?:una )?(?:ia|inteligencia artificial|modelo de lenguaje|asistente)',
  'no (?:puedo|soy capaz de)',
  'lo siento',
  'pido disculpas',
  'mis disculpas',
  `aqu[ií] (?:tienes|tiene|est[aá]|va|le dejo|te dejo) (?:el|la|tu|su|una|un|mi) ${TEXT_WORDS_ES}`,
  `he aqu[ií] (?:el|la|tu|su|una|un|mi) ${TEXT_WORDS_ES}`,
  'a continuaci[oó]n,? (?:se presenta|presento|tienes|el texto|la descripci[oó]n|el titular)',
  '(?:la descripci[oó]n|el texto|la frase|el anuncio|el p[aá]rrafo|el titular) (?:anterior|de arriba)',
  '(?:los|las) (?:datos|hechos|informaci[oó]n|detalles) (?:proporcionad|facilitad|suministrad)\\p{L}*(?! por)',
  'la informaci[oó]n (?:proporcionada|facilitada|suministrada)(?! por)',
  '(?:seg[uú]n|siguiendo) (?:las )?instrucciones',
  'las instrucciones',
  'el prompt',
  'recuento de palabras',
  '\\p{Nd}+ palabras',
  'descripci[oó]n original',
];

const PHRASE_RE = new RegExp(`${B_START}(?:${PHRASES.join('|')})${B_END}`, 'iu');

/** A preamble opening the text, ending its line in a colon ("Here is the adapted copy for you:"). */
const PREAMBLE_LINE_RE = new RegExp(
  `^\\s*(?:here(?: is|[’']s| are)|oto|poniżej|aqu[ií] (?:tienes|est[aá])|a continuaci[oó]n)${B_END}[^\\n]{0,80}[:：]\\s*(?:\\n|$)`,
  'iu',
);

/** A bracketed placeholder: "[insert agent name]", "[Agent Name]", "[wstaw telefon]", "{{price}}". */
const PLACEHOLDER_RE = new RegExp(
  `\\[\\s*(?:insert|add|your|agent|name|phone|contact|price|address|placeholder|tbd|todo|tbc|x{2,}|wstaw|dodaj|tutaj|tu wpisz|imię|telefon|cena|adres|insertar|añadir|a[ñn]ade|inserte|nombre|tel[eé]fono|precio|direcci[oó]n)${B_END}[^\\]]{0,60}\\]|\\{\\{[^}]{0,60}\\}\\}`,
  'iu',
);

/** A self-correction in flight: "A two-bedroom... no, a two-room flat". */
const SELF_CORRECTION_RE = new RegExp(
  `(?:\\.{3}|…)\\s*(?:no|nie|or rather|i mean|sorry|przepraszam|perd[oó]n|mejor dicho|a właściwie)${B_END}\\s*[,—–-]?`,
  'iu',
);

/**
 * Does `text` comment on itself, its inputs or its writer instead of describing the listing?
 *
 * @param text - A generated description body, headline or directive value.
 * @returns `true` when the text must be refused as `meta_commentary`.
 */
export function hasMetaCommentary(text: string): boolean {
  return (
    NOTE_RE.test(text) ||
    PHRASE_RE.test(text) ||
    PREAMBLE_LINE_RE.test(text) ||
    PLACEHOLDER_RE.test(text) ||
    SELF_CORRECTION_RE.test(text)
  );
}
