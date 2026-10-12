import type { PlaybookEntry } from '../types.js';

export const portfolioBuilderPlaybook: PlaybookEntry = {
  archetype: 'portfolio_builder',
  description: 'Experienced investor scaling a multi-property portfolio',
  slots: [
    {
      slot: 'headline',
      en: 'Portfolio Addition — {bedrooms}BR, Management Available',
      variants: {
        en: [
          'Portfolio Addition — {bedrooms}BR, Management Available',
          'Scalable Asset — {bedrooms}BR, Fits a Standard Portfolio Profile',
          'Multi-Property Play — Bulk Enquiry Welcome',
        ],
      },
    },
    { slot: 'cta', en: 'Request Bulk Enquiry' },
    { slot: 'feature', en: 'Portfolio Metrics' },
  ],
  listing_rules: {
    boost_if: [
      'multiple_units_available',
      'bulk_discount_possible',
      'management_company_available',
    ],
    suppress_if: [],
    boost_class: 'estalara-boost',
    suppress_class: 'estalara-suppress',
  },
  feature_priority: [
    'price_per_unit',
    'yield',
    'management_available',
    'bulk_availability',
    'legal_status',
  ],
  signals: [
    'views_multiple_listings_same_building',
    'long_session',
    'quiz:investment+long',
    'returns_multiple_times',
  ],
  copy_template: {
    en: `VOICE PATTERN:
Write with systems-thinking, operationally aware, scale-fluent. The reader already owns multi-unit positions and evaluates additions through the lens of fit with an existing operating system: lender profile, manager profile, tenant pool, refinance window. Lead with how the asset slots into an existing system — operational extensibility, homogeneity with current holdings, management leverage. Frame the property as another cog in a system that already runs, not a one-off acquisition. The closer positions the asset as operational leverage. Preferred lexicon: portfolio, homogeneous, extends, operational, blended yield, system, leverage, cog, standard profile. Avoid: unique, special, one-of-a-kind, character home, signature, bespoke.

HARD RULES:
Never quote specific LTV percentages, blended yield percentages, comparable unit counts, or block-discount figures unless they are in verified_facts. "Fits a standard portfolio profile" is acceptable; "85% LTV available, 6.2% blended yield, 12 comparable units in the same block" is forbidden unless verified.`,
    pl: `VOICE PATTERN:
Pisz w języku systemów, operacyjnie, w skali. Czytelnik ma już portfel wielomieszkaniowy i ocenia dodatkową pozycję pod kątem dopasowania do istniejącego systemu operacyjnego: profil banku, profil zarządcy, pula najemców, okno refinansowania. Prowadź narracją "jak to wpadnie w istniejący system" — rozszerzalność operacyjna, jednorodność z obecnym portfelem, dźwignia zarządcza. Pokazuj nieruchomość jako kolejny trybik w działającej maszynie, nie pojedynczy zakup. Zamknięcie pozycjonuje aktywo jako "dźwignia operacyjna". Słownictwo preferowane: portfel, jednorodny, rozszerza, operacyjny, mieszana rentowność, system, dźwignia, trybik, standardowy profil. Unikać: unikatowy, wyjątkowy, jedyny w swoim rodzaju, dom z charakterem, sygnatura, na zamówienie. W PL możesz odnosić się ogólnie do standardowych jednostek 2-3 pokoje na rynku najmu długoterminowego.

HARD RULES:
Nigdy nie cytuj konkretnych LTV w %, mieszanej rentowności w %, liczby porównywalnych jednostek ani rabatu blokowego, jeśli nie ma ich w verified_facts. "Pasuje do standardowego profilu portfela" — tak; "LTV 85%, mieszana rentowność 6,2%, 12 porównywalnych w bloku" — zabronione bez weryfikacji.`,
    es: `VOICE PATTERN:
Escribe en clave de sistemas, conciencia operativa, fluidez en escala. El lector ya tiene cartera y evalúa una incorporación por encaje con un sistema operativo existente: perfil del banco, perfil del gestor, pool de inquilinos, ventana de refinanciación. Lidera con cómo el activo encaja en el sistema actual — extensibilidad operativa, homogeneidad con activos existentes, apalancamiento de gestión. Presenta la propiedad como otro engranaje en una máquina que ya funciona, no como adquisición puntual. El cierre la posiciona como apalancamiento operativo. Léxico preferido: cartera, homogéneo, extiende, operativo, rentabilidad mixta, sistema, palanca, engranaje, perfil estándar. Evitar: único, especial, irrepetible, con carácter, firma, a medida. En contexto ES referencia genérica a unidades estándar de 2-3 dormitorios en mercado de alquiler residencial.

HARD RULES:
Nunca cites % de LTV, % de rentabilidad mixta, número de unidades comparables ni descuentos por bloque salvo en verified_facts. "Encaja en un perfil de cartera estándar" sí; "LTV 85%, rentabilidad mixta 6,2%, 12 comparables en el bloque" prohibido sin verificación.`,
  },
};
