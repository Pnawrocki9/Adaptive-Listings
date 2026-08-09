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

import type { ConsentTextLocale, QuizLanguage } from '@estalara/shared';

export interface ConsentBannerOptions {
  /**
   * UI language for banner text.
   * Uses `QuizLanguage` from `@estalara/shared` — canonical `['en','pl','es']` union
   * (FOLLOW-273). Never repeat the literal set in SDK files.
   */
  language: QuizLanguage;
  /** Accent color for the primary "Accept" button (hex, rgb, or CSS color). */
  accentColor: string;
  /**
   * Banner copy for {@link ConsentBannerOptions.language}, fetched and validated by
   * `fetchConsentText()` before this function is called (ADR-0021 §D2, FOLLOW-915).
   *
   * REQUIRED, and deliberately has no default: ESC-051 moved these strings out of the bundle,
   * and a built-in fallback would either re-create the byte cost the ruling removed or ship a
   * TRIMMED disclosure — consent obtained on an incomplete disclosure is not "informed" under
   * GDPR Art. 4(11)/Art. 7 (§D4). If the text could not be fetched, the caller must fail
   * closed and never reach this function.
   */
  copy: ConsentTextLocale;
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
  const copy = options.copy;

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
