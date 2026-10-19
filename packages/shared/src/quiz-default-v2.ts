/**
 * `DEFAULT_QUIZ_DEFINITION_V2` — the v3.0 default quiz tree, EN + PL (MASTER_DESIGN §E.4.2–§E.4.3
 * v3.0, FOLLOW-1356). (The plan calls it "tree v2" — the second default definition in the
 * ADR-0019 sense; the design document calls it §E.4 v3.0. Same thing.)
 *
 * Shape: purpose → one clarifying question → optional trait screen → (SDK) confirmation.
 * Every path carries exactly ONE weighted answer, so the argmax leaf never depends on an
 * override or a tiebreak; the five archetypes the quiz no longer assigns (`upsizer`,
 * `portfolio_builder`, `luxury_buyer`, `remote_worker`, `golden_visa_buyer`) are traits or
 * merged results (`QUIZ_TRAIT_ONLY_ARCHETYPE_IDS`). 12 results + `neutral` ("Not sure yet").
 *
 * The texts are the authoring baseline of §E.4.2 (questions, answers, traits) and §E.4.3
 * (confirmation names and sentences, written from the labelling rules): second person,
 * facts not attitudes, Polish gender-neutral. A confirmation sentence has NO trailing full stop —
 * the screen template is "Based on your answers: {name} — {sentence}. Is that right?" /
 * "Na podstawie Twoich odpowiedzi: {nazwa} — {zdanie}. Zgadza się?".
 *
 * NOT definition content — SDK chrome (`CHROME_LABELS`, EN + PL) owned by FOLLOW-1357 / Q2: the
 * trait screens' exclusive "None of these" / "Żadne z powyższych" option, the confirmation
 * template above, the two buttons ("Yes, that's me" / "Not quite"; "Tak, to ja" / "Nie do
 * końca"), the correction texts ("Which fits you better?" / "Co pasuje lepiej?") and "None of
 * these — show me everything" / "Żadne — pokaż wszystkie oferty".
 *
 * Consumers: the control plane serves it from `GET /api/quiz/public-config` when a tenant has
 * no active `quiz_definitions` row (FOLLOW-1358 / Q3) and the admin editor's "load built-in
 * default" action (FOLLOW-1362 / Q7). The SDK's built-in fallback stays EN-only (bundle budget,
 * ESC-080) until FOLLOW-1357 / Q2 swaps it; this module must stay out of the SDK bundle.
 * Pinned by `quiz-default-v2.test.ts`: zero authoring errors AND zero warnings.
 *
 * @module @estalara/shared/quiz-default-v2
 */

import type { QuizAnswer, QuizDefinition } from './schemas/presentation-config.js';
import type { TraitId } from './traits.js';

/** A single-choice answer with EN + PL text. */
function answer(
  id: string,
  en: string,
  pl: string,
  weights: Record<string, number>,
  next: string | null,
  traits?: TraitId[],
): QuizAnswer {
  return {
    id,
    label_i18n: { en, pl },
    weights,
    next,
    ...(traits ? { traits } : {}),
  };
}

/** A trait-screen answer: no weights, ends the walk, records `trait`. */
function traitAnswer(trait: TraitId, en: string, pl: string, id: string = trait): QuizAnswer {
  return answer(id, en, pl, {}, null, [trait]);
}

function buildDefaultQuizDefinitionV2(): QuizDefinition {
  const TRAIT_SCREEN_PROMPT = {
    en: 'Anything else that applies? (optional — tick all that fit)',
    pl: 'Coś jeszcze się zgadza? (opcjonalnie — zaznacz wszystko, co pasuje)',
  };

  const hasChildren = () =>
    traitAnswer('has_children', 'Children will live with me', 'Będą ze mną mieszkać dzieci');
  const worksFromHome = () =>
    traitAnswer(
      'works_from_home',
      "I'll work from home 2+ days a week",
      'Będę pracować z domu co najmniej 2 dni w tygodniu',
    );
  const premium = () =>
    traitAnswer(
      'premium',
      "I'm looking at the top end of the market",
      'Szukam w segmencie premium',
    );
  const residencyGoal = () =>
    traitAnswer(
      'residency_goal',
      'I want residency through this purchase (e.g. golden visa)',
      'Chcę uzyskać prawo pobytu dzięki temu zakupowi (np. złota wiza)',
    );
  const buyingFromAbroad = () =>
    traitAnswer(
      'buying_from_abroad',
      'I live in a different country than the property',
      'Mieszkam w innym kraju niż ta nieruchomość',
    );
  const seasonedInvestor = () =>
    traitAnswer(
      'seasoned_investor',
      'I already own other investment property',
      'Mam już inne nieruchomości inwestycyjne',
    );

  return {
    schema_version: 1,
    root: 'q_purpose',
    languages: ['en', 'pl'],
    questions: [
      {
        id: 'q_purpose',
        prompt_i18n: {
          en: 'What will this property be for?',
          pl: 'Do czego ma służyć ta nieruchomość?',
        },
        answers: [
          answer(
            'main_here',
            'My main home, in the country where I live now',
            'Mój główny dom — w kraju, w którym teraz mieszkam',
            {},
            'q_home',
          ),
          answer(
            'main_move',
            "My main home, in a country I'm moving to (or back to)",
            'Mój główny dom — w kraju, do którego się przeprowadzam (lub wracam)',
            {},
            'q_move',
            ['buying_from_abroad'],
          ),
          answer(
            'second',
            "A holiday or second home — I'll mainly live elsewhere",
            'Dom wakacyjny lub drugi dom — na co dzień mieszkam gdzie indziej',
            { second_home_buyer: 1 },
            't_second',
          ),
          answer(
            'invest',
            'An investment — to rent out or resell',
            'Inwestycja — pod wynajem lub odsprzedaż',
            {},
            'q_invest',
          ),
          answer(
            'student',
            'A home for my child who is studying',
            'Mieszkanie dla mojego dziecka na czas studiów',
            { student_parent: 1 },
            't_student',
          ),
          answer(
            'unsure',
            'Not sure yet — just looking',
            'Jeszcze nie wiem — tylko się rozglądam',
            {},
            null,
          ),
        ],
      },
      {
        id: 'q_home',
        prompt_i18n: { en: 'Which fits you best?', pl: 'Co najlepiej Cię opisuje?' },
        answers: [
          answer(
            'first',
            'This will be my first own home',
            'To będzie moje pierwsze własne mieszkanie lub dom',
            { first_time_buyer: 1 },
            't_home',
          ),
          answer(
            'up',
            "I've owned before — now I need more space or a better home",
            'To nie mój pierwszy własny dom — potrzebuję więcej miejsca lub lepszego domu',
            { family_buyer: 1 },
            't_home',
          ),
          answer(
            'down',
            "I've owned before — now I want something smaller and easier to look after",
            'To nie mój pierwszy własny dom — chcę czegoś mniejszego i łatwiejszego w utrzymaniu',
            { downsizer: 1 },
            't_home',
          ),
        ],
      },
      {
        id: 'q_move',
        prompt_i18n: { en: 'Which describes you?', pl: 'Który opis do Ciebie pasuje?' },
        answers: [
          answer(
            'return',
            "I'm moving back to my home country",
            'Wracam do kraju, z którego pochodzę',
            { diaspora_buyer: 1 },
            't_move',
          ),
          answer(
            'retire',
            "I'm retired or about to retire",
            'Jestem na emeryturze lub wkrótce na nią przechodzę',
            { retiree_relocator: 1 },
            't_move',
          ),
          answer(
            'work',
            "I'll keep working there — a job, my own business or remotely",
            'Będę tam pracować — na etacie, we własnej firmie lub zdalnie',
            { lifestyle_expat: 1 },
            't_move',
          ),
        ],
      },
      {
        id: 'q_invest',
        prompt_i18n: {
          en: 'How should it earn money?',
          pl: 'Jak ta nieruchomość ma na siebie zarabiać?',
        },
        answers: [
          answer(
            'long',
            'Long-term rental to tenants',
            'Najem długoterminowy',
            { yield_hunter: 1 },
            't_invest',
          ),
          answer(
            'short',
            'Holiday / short-term rental (e.g. Airbnb)',
            'Najem krótkoterminowy / wakacyjny (np. Airbnb)',
            { vacation_rental_investor: 1 },
            't_invest',
          ),
          answer(
            'flip',
            'Renovate and resell',
            'Remont i sprzedaż z zyskiem',
            { flip_investor: 1 },
            't_invest',
          ),
          answer(
            'commercial',
            'Commercial premises (shop, office, warehouse)',
            'Lokal komercyjny (sklep, biuro, magazyn)',
            { commercial_investor: 1 },
            't_invest',
          ),
          // The safe default: the most generic investor copy. Confirmed like any other result and
          // reported separately by the accuracy report (MASTER_DESIGN §E.4.2).
          answer(
            'inv_undecided',
            'Not decided yet',
            'Jeszcze nie wiem',
            { yield_hunter: 1 },
            't_invest',
          ),
        ],
      },
      {
        id: 't_home',
        kind: 'multi',
        prompt_i18n: TRAIT_SCREEN_PROMPT,
        answers: [hasChildren(), worksFromHome(), premium()],
      },
      {
        id: 't_move',
        kind: 'multi',
        prompt_i18n: TRAIT_SCREEN_PROMPT,
        answers: [hasChildren(), worksFromHome(), premium(), residencyGoal()],
      },
      {
        id: 't_second',
        kind: 'multi',
        prompt_i18n: TRAIT_SCREEN_PROMPT,
        answers: [
          traitAnswer(
            'will_let',
            "I'll rent it out when I'm not using it",
            'Będę ją wynajmować, kiedy z niej nie korzystam',
          ),
          buyingFromAbroad(),
          worksFromHome(),
          residencyGoal(),
          premium(),
        ],
      },
      {
        id: 't_invest',
        kind: 'multi',
        prompt_i18n: TRAIT_SCREEN_PROMPT,
        answers: [seasonedInvestor(), buyingFromAbroad(), residencyGoal(), premium()],
      },
      {
        id: 't_student',
        kind: 'multi',
        prompt_i18n: TRAIT_SCREEN_PROMPT,
        answers: [
          buyingFromAbroad(),
          traitAnswer(
            'will_let',
            'Other students will rent rooms there too',
            'Pokoje wynajmą też inni studenci',
          ),
        ],
      },
    ],
    confirm: {
      names_i18n: {
        yield_hunter: {
          en: 'Long-term rental investment',
          pl: 'Inwestycja pod najem długoterminowy',
        },
        vacation_rental_investor: {
          en: 'Holiday-let investment',
          pl: 'Inwestycja pod najem wakacyjny',
        },
        flip_investor: { en: 'Renovate and resell', pl: 'Remont i sprzedaż' },
        commercial_investor: {
          en: 'Commercial property investment',
          pl: 'Inwestycja w lokal komercyjny',
        },
        first_time_buyer: { en: 'First-time buyer', pl: 'Pierwszy własny dom' },
        family_buyer: { en: 'Moving up', pl: 'Przeprowadzka na lepsze' },
        downsizer: { en: 'Downsizing', pl: 'Przeprowadzka na mniejsze' },
        retiree_relocator: { en: 'Retirement move', pl: 'Przeprowadzka na emeryturę' },
        lifestyle_expat: {
          en: 'Relocating and working there',
          pl: 'Przeprowadzka i praca na miejscu',
        },
        diaspora_buyer: { en: 'Moving back home', pl: 'Powrót do kraju' },
        second_home_buyer: { en: 'Holiday or second home', pl: 'Dom wakacyjny lub drugi dom' },
        student_parent: { en: 'Home for a student', pl: 'Mieszkanie dla studiującego dziecka' },
      },
      sentences_i18n: {
        yield_hunter: {
          en: "you're buying to earn income from long-term tenants, and nobody in your household will live there",
          pl: 'kupujesz, żeby zarabiać na najmie długoterminowym, a nikt z Twoich domowników nie będzie tam mieszkać',
        },
        vacation_rental_investor: {
          en: "you're buying to earn from holiday or short-term lets, and your own stays will be occasional at most",
          pl: 'kupujesz, żeby zarabiać na najmie krótkoterminowym lub wakacyjnym, a Twoje własne pobyty będą co najwyżej okazjonalne',
        },
        flip_investor: {
          en: "you're buying to renovate the property and sell it for a profit, not to keep it",
          pl: 'kupujesz, żeby wyremontować nieruchomość i sprzedać ją z zyskiem, a nie żeby ją zatrzymać',
        },
        commercial_investor: {
          en: "you're buying commercial premises — a shop, office or warehouse — as an investment",
          pl: 'kupujesz lokal komercyjny — sklep, biuro lub magazyn — jako inwestycję',
        },
        first_time_buyer: {
          en: "you're buying your first own home where you live now",
          pl: 'kupujesz swoje pierwsze mieszkanie lub dom tam, gdzie mieszkasz',
        },
        family_buyer: {
          en: "you've owned before and want more space or a better home",
          pl: 'to nie Twój pierwszy własny dom i szukasz więcej przestrzeni lub lepszego domu',
        },
        downsizer: {
          en: "you've owned before and now want something smaller and easier to look after",
          pl: 'to nie Twój pierwszy własny dom i teraz chcesz czegoś mniejszego i łatwiejszego w utrzymaniu',
        },
        retiree_relocator: {
          en: "you're moving to a new country to make it your main home, and you're retired or about to retire",
          pl: 'przeprowadzasz się do innego kraju, by zamieszkać tam na stałe, i jesteś na emeryturze lub wkrótce na nią przechodzisz',
        },
        lifestyle_expat: {
          en: "you're moving to a new country to make it your main home, and you'll keep working there",
          pl: 'przeprowadzasz się do innego kraju, by zamieszkać tam na stałe, i będziesz tam dalej pracować',
        },
        diaspora_buyer: {
          en: "you're moving back to the country you come from, to make it your main home",
          pl: 'wracasz do kraju, z którego pochodzisz, by zamieszkać tam na stałe',
        },
        second_home_buyer: {
          en: "you'll use it yourself for part of the year, while your main home stays elsewhere",
          pl: 'będziesz z niego korzystać przez część roku, a Twój główny dom pozostanie gdzie indziej',
        },
        student_parent: {
          en: "you're buying a home for your child to live in while they study",
          pl: 'kupujesz mieszkanie, w którym Twoje dziecko będzie mieszkać na czas studiów',
        },
      },
      alternatives: {
        yield_hunter: ['vacation_rental_investor', 'flip_investor', 'student_parent'],
        vacation_rental_investor: ['second_home_buyer', 'yield_hunter', 'flip_investor'],
        flip_investor: ['yield_hunter', 'vacation_rental_investor', 'commercial_investor'],
        commercial_investor: ['yield_hunter', 'flip_investor', 'vacation_rental_investor'],
        first_time_buyer: ['family_buyer', 'lifestyle_expat', 'student_parent'],
        family_buyer: ['first_time_buyer', 'downsizer', 'lifestyle_expat'],
        downsizer: ['retiree_relocator', 'family_buyer', 'second_home_buyer'],
        retiree_relocator: ['second_home_buyer', 'downsizer', 'diaspora_buyer'],
        lifestyle_expat: ['retiree_relocator', 'diaspora_buyer', 'first_time_buyer'],
        diaspora_buyer: ['lifestyle_expat', 'retiree_relocator', 'second_home_buyer'],
        second_home_buyer: ['vacation_rental_investor', 'retiree_relocator', 'lifestyle_expat'],
        student_parent: ['yield_hunter', 'first_time_buyer', 'family_buyer'],
      },
    },
  };
}

/**
 * The v3.0 default quiz definition, EN + PL. See the module doc.
 *
 * Built by a function behind a `@__PURE__` call so a bundler can drop it from a consumer that
 * never reads it: the SDK bundle imports `@estalara/shared` and its gzip budget must not pay for
 * these texts until FOLLOW-1357 / Q2 deliberately swaps the built-in default.
 */
export const DEFAULT_QUIZ_DEFINITION_V2: QuizDefinition =
  /* @__PURE__ */ buildDefaultQuizDefinitionV2();
