/**
 * Consent banner component — TICKET-041 (GDPR/CCPA consent gate).
 *
 * Renders a fixed-bottom banner inside the Shadow DOM before any behavioral data
 * is collected. Implemented with vanilla DOM (no Preact) to minimize bundle impact.
 *
 * CSS is fully isolated via an inline <style> tag inside the Shadow DOM.
 *
 * DPIA §13.1 (consent-denied audit dispatch) and §13.2 (cross-session fingerprint)
 * mandate specific disclosure strings that must appear in the banner BEFORE the
 * visitor makes a consent decision (balancing-test condition, §13.2).
 *
 * @module @estalara/sdk/ui/consent-banner
 */

import type { QuizLanguage } from '@estalara/shared';

export interface ConsentBannerOptions {
  /**
   * UI language for banner text.
   * Uses `QuizLanguage` from `@estalara/shared` — canonical `['en','pl','es']` union
   * (FOLLOW-273). Never repeat the literal set in SDK files.
   */
  language: QuizLanguage;
  /** Accent color for the primary "Accept" button (hex, rgb, or CSS color). */
  accentColor: string;
  /** Optional URL for the tenant's privacy policy — shown as a "Learn more" link. */
  privacyPolicyUrl?: string;
  /** Called when the user clicks "Accept". */
  onGranted: () => void;
  /** Called when the user clicks "Decline". */
  onDenied: () => void;
}

const BANNER_STYLE = `
  .estalara-consent-banner {
    box-sizing: border-box;
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    width: 100%;
    min-height: 80px;
    background: #1a1a2e;
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 24px;
    z-index: 9999;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    flex-wrap: wrap;
  }
  .estalara-consent-text {
    flex: 1;
    min-width: 200px;
    margin: 0;
  }
  .estalara-consent-disclosures {
    flex: 1 1 100%;
    margin: 6px 0 0;
    padding: 0;
    font-size: 12px;
    color: #c0bfcd;
    line-height: 1.4;
    list-style: none;
  }
  .estalara-consent-disclosures li {
    margin-top: 3px;
  }
  .estalara-consent-link {
    color: #a29bfe;
    text-decoration: underline;
    cursor: pointer;
    margin-left: 6px;
  }
  .estalara-consent-link:hover {
    color: #ffffff;
  }
  .estalara-consent-actions {
    display: flex;
    gap: 12px;
    flex-shrink: 0;
    flex-wrap: wrap;
  }
  .estalara-consent-btn {
    box-sizing: border-box;
    cursor: pointer;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    padding: 8px 20px;
    min-width: 80px;
    transition: opacity 0.15s ease;
    font-family: inherit;
  }
  .estalara-consent-btn:hover {
    opacity: 0.85;
  }
  .estalara-consent-btn:focus-visible {
    outline: 2px solid #ffffff;
    outline-offset: 2px;
  }
  .estalara-consent-btn-accept {
    color: #ffffff;
    background: var(--estalara-accent, #6c5ce7);
  }
  .estalara-consent-btn-decline {
    color: #ffffff;
    background: transparent;
    border: 2px solid #ffffff;
  }
  @media (max-width: 480px) {
    .estalara-consent-banner {
      flex-direction: column;
      align-items: flex-start;
      padding: 16px;
    }
    .estalara-consent-actions {
      width: 100%;
    }
    .estalara-consent-btn {
      flex: 1;
      text-align: center;
    }
  }
`;

/**
 * Per-locale copy for the consent banner.
 *
 * disclosure13_1 — DPIA §13.1: audit-log retention notice for consent-denied dispatch.
 *   Source: dpia.md §13.1 "Consent banner disclosure" paragraph. Retention = 7 days.
 *
 * disclosure13_2 — DPIA §13.2: cross-session pseudonymous identifier notice.
 *   Source: dpia.md §13.2 "Required consent banner update" paragraph. Retention = 90 days,
 *   refreshed every 90 days. Must appear in the banner (not only in the Privacy Policy) because
 *   the identifier is set at first page load before the visitor navigates to the policy.
 *
 * disclosurePlatform — DPIA §13.4 / FOLLOW-373: platform-wide consent umbrella notice.
 *   Source: dpia.md §13.4 "Platform-wide consent umbrella" and Master Design §H.8.
 *   For registered investors (app.estalara.com Mode B), the registration consent additionally
 *   covers: chat analysis for buying intent, transfer of inferred profile to the agency/agent,
 *   buying-intent identification (12-dim vector, 24 h TTL, no raw chat text stored by AL),
 *   lead ranking by buying-intent strength, and agent-facing summaries of chat questions.
 *   CORRECTED 2026-08-07 (FOLLOW-866 / ESC-049 addendum, ridden by FOLLOW-815): this docblock and
 *   the three `disclosurePlatform` strings below used to assert that raw chat text is NOT stored.
 *   That was FALSE to real data subjects. `chat.message.sent.payload.message` (≤4000 chars) is
 *   written verbatim into the ClickHouse `events` table by deliberate §H.8 design and retained for
 *   13 months (`infra/clickhouse/migrations/0001_create_events.sql` TTL); the PII scrubber masks
 *   email addresses and phone numbers ONLY — names, financial detail and family composition pass
 *   through. The 24-hour structured-intent summary claim was and remains true; it was the "and
 *   nothing else" half that was wrong. Lawful basis stays LEGITIMATE INTEREST with full
 *   transparency, and NO new consent checkbox was added (CEO+DPO, ESC-049 addendum Q1/Q3). These
 *   strings are byte-synced with `PRIVACY_NOTICE_TEMPLATE.md` §6.1 and
 *   `platform-registration/lib.ts` — change all three together or the Rule N gates go red.
 *   The full registration consent text is in the account sign-up flow.
 *   This disclosure is shown here for completeness so that any visitor who is also a registered
 *   investor has full transparency about the platform-wide purposes at this consent surface.
 */
const COPY = {
  en: {
    text: 'We personalize this page based on your browsing behavior.',
    // DPIA §13.1 — denial-logging audit retention (7 days)
    disclosure13_1:
      'We record the fact of your consent decision — including a denial — for compliance and debugging purposes. This log is retained for 7 days and is then permanently deleted.',
    // DPIA §13.2 — cross-session pseudonymous identifier (90 days, refreshed every 90 days)
    disclosure13_2:
      'To remember your preferences across visits, we store a pseudonymous identifier in your browser for up to 90 days. This identifier is refreshed every 90 days and is deleted if you withdraw consent.',
    // DPIA §13.4 / FOLLOW-373 — platform-wide consent umbrella (registered investors)
    disclosurePlatform:
      'If you are a registered investor: your account sign-up consent also covers analysis of your chat messages to identify buying intent, transfer of your inferred buyer profile to the agency/agent, lead ranking by buying-intent strength, and agent-facing summaries of your chat questions. Your chat message text is stored for 13 months, with emails and phone numbers masked; the intent summary is kept for 24 hours.',
    learnMore: 'Learn more ↗',
    accept: 'Accept',
    decline: 'Decline',
  },
  pl: {
    text: 'Personalizujemy tę stronę na podstawie Twojego zachowania.',
    // DPIA §13.1 — informacja o rejestracji decyzji dot. zgody (7 dni)
    disclosure13_1:
      'Rejestrujemy fakt Twojej decyzji dotyczącej zgody — w tym odmowę — w celach zgodności i debugowania. Dziennik ten jest przechowywany przez 7 dni, po czym jest trwale usuwany.',
    // DPIA §13.2 — pseudonimowy identyfikator cross-session (90 dni, odświeżany co 90 dni)
    disclosure13_2:
      'Aby zapamiętać Twoje preferencje pomiędzy wizytami, przechowujemy pseudonimowy identyfikator w Twojej przeglądarce przez maksymalnie 90 dni. Identyfikator ten jest odświeżany co 90 dni i usuwany w przypadku wycofania zgody.',
    // DPIA §13.4 / FOLLOW-373 — platforma: pełne cele przetwarzania (zarejestrowani inwestorzy)
    disclosurePlatform:
      'Jeśli jesteś zarejestrowanym inwestorem: Twoja zgoda wyrażona przy rejestracji obejmuje również analizę wiadomości na czacie w celu identyfikacji intencji zakupowej, przekazanie wywnioskowanego profilu kupującego agencji/agentowi, ranking inwestorów według siły intencji zakupowej oraz podsumowania pytań z czatu widoczne dla pracowników agencji. Treść wiadomości z czatu jest przechowywana przez 13 miesięcy, z zamaskowanymi adresami e-mail i numerami telefonu; podsumowanie intencji przez 24 godziny.',
    learnMore: 'Dowiedz się więcej ↗',
    accept: 'Akceptuj',
    decline: 'Odrzuć',
  },
  es: {
    text: 'Personalizamos esta página según tu comportamiento de navegación.',
    // DPIA §13.1 — aviso de retención del registro de auditoría de denegación de consentimiento (7 días)
    disclosure13_1:
      'Registramos el hecho de tu decisión de consentimiento — incluida una denegación — con fines de cumplimiento y depuración. Este registro se conserva durante 7 días y luego se elimina de forma permanente.',
    // DPIA §13.2 — identificador pseudónimo entre sesiones (90 días, renovado cada 90 días)
    disclosure13_2:
      'Para recordar tus preferencias entre visitas, almacenamos un identificador seudónimo en tu navegador durante un máximo de 90 días. Este identificador se renueva cada 90 días y se elimina si retiras tu consentimiento.',
    // DPIA §13.4 / FOLLOW-373 — cobertura de consentimiento de plataforma (inversores registrados)
    disclosurePlatform:
      'Si eres un inversor registrado: tu consentimiento de registro también cubre el análisis de tus mensajes de chat para identificar la intención de compra, la transferencia de tu perfil de comprador inferido a la agencia/agente, la clasificación por intensidad de intención de compra y los resúmenes de tus preguntas de chat para el equipo de la agencia. El texto de tus mensajes de chat se almacena durante 13 meses, con correos y teléfonos enmascarados; el resumen de intención durante 24 horas.',
    learnMore: 'Más información ↗',
    accept: 'Aceptar',
    decline: 'Rechazar',
  },
} as const;

/**
 * Render a GDPR/CCPA consent banner inside the provided Shadow Root.
 *
 * The banner is positioned at the bottom of the viewport and waits for the user
 * to click Accept or Decline before any behavioral data collection begins.
 *
 * Includes DPIA §13.1 and §13.2 mandatory disclosures visible to the visitor
 * BEFORE the consent decision is made, satisfying the §13.2 balancing-test condition.
 *
 * @param shadowRoot - The Shadow DOM root to inject the banner into.
 * @param options - Banner configuration including callbacks and branding.
 * @returns A teardown function that removes the banner from the DOM.
 */
export function renderConsentBanner(
  shadowRoot: ShadowRoot,
  options: ConsentBannerOptions,
): () => void {
  const copy = COPY[options.language];

  // Inject scoped styles
  const style = document.createElement('style');
  style.textContent = BANNER_STYLE;
  shadowRoot.appendChild(style);

  // Banner container
  const banner = document.createElement('div');
  banner.className = 'estalara-consent-banner';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute(
    'aria-label',
    options.language === 'pl'
      ? 'Zgoda na personalizację'
      : options.language === 'es'
        ? 'Consentimiento de personalización'
        : 'Personalization consent',
  );
  // Apply accent color via CSS custom property
  banner.style.setProperty('--estalara-accent', options.accentColor);

  // Text paragraph
  const textEl = document.createElement('p');
  textEl.className = 'estalara-consent-text';
  textEl.textContent = copy.text;

  if (options.privacyPolicyUrl) {
    const link = document.createElement('a');
    link.className = 'estalara-consent-link';
    link.href = options.privacyPolicyUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = copy.learnMore;
    textEl.appendChild(link);
  }

  // DPIA §13.1 + §13.2 + §13.4 mandatory disclosures — rendered as a sub-list so they are
  // visually subordinate to the main banner text but still visible before the
  // consent decision is made (§13.2 balancing-test condition; §13.4 FOLLOW-373).
  const disclosureList = document.createElement('ul');
  disclosureList.className = 'estalara-consent-disclosures';

  const li13_1 = document.createElement('li');
  li13_1.setAttribute('data-estalara-disclosure', 'dpia-13-1');
  li13_1.textContent = copy.disclosure13_1;

  const li13_2 = document.createElement('li');
  li13_2.setAttribute('data-estalara-disclosure', 'dpia-13-2');
  li13_2.textContent = copy.disclosure13_2;

  // DPIA §13.4 / FOLLOW-373 — platform-wide consent umbrella disclosure for registered investors.
  // Shown to all visitors for full transparency; specifically relevant to registered investors
  // whose registration consent covers purposes (b)–(f) beyond behavioral tracking.
  const liPlatform = document.createElement('li');
  liPlatform.setAttribute('data-estalara-disclosure', 'dpia-13-4-platform');
  liPlatform.textContent = copy.disclosurePlatform;

  disclosureList.appendChild(li13_1);
  disclosureList.appendChild(li13_2);
  disclosureList.appendChild(liPlatform);

  // Action buttons container
  const actions = document.createElement('div');
  actions.className = 'estalara-consent-actions';

  const acceptBtn = document.createElement('button');
  acceptBtn.className = 'estalara-consent-btn estalara-consent-btn-accept';
  acceptBtn.textContent = copy.accept;
  acceptBtn.setAttribute('data-estalara-consent', 'accept');

  const declineBtn = document.createElement('button');
  declineBtn.className = 'estalara-consent-btn estalara-consent-btn-decline';
  declineBtn.textContent = copy.decline;
  declineBtn.setAttribute('data-estalara-consent', 'decline');

  // Teardown helper — removes banner and style from Shadow DOM
  function teardown(): void {
    try {
      banner.remove();
      style.remove();
    } catch {
      // ignore — elements may already be removed
    }
  }

  acceptBtn.addEventListener('click', () => {
    teardown();
    options.onGranted();
  });

  declineBtn.addEventListener('click', () => {
    teardown();
    options.onDenied();
  });

  actions.appendChild(acceptBtn);
  actions.appendChild(declineBtn);
  banner.appendChild(textEl);
  banner.appendChild(disclosureList);
  banner.appendChild(actions);
  shadowRoot.appendChild(banner);

  return teardown;
}
