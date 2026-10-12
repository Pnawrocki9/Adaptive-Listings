/**
 * Consent gate and §H.9 opt-out toggle (ADR-0021) [FOLLOW-1296, FOLLOW-372].
 * @module
 */

import type { SdkConfig } from './config.js';
import { eraseCachedQuizConfig } from './quiz-config.js';
import { dispatchEvents } from './events.js';
import type { CollectedEvent } from './events.js';
import {
  getOrCreateSession,
  getConsentState,
  setConsentState,
  eraseCrossSessionId,
  getOrCreateCrossSessionId,
  eraseIntentState,
  peekStoredSessionId,
} from './session.js';
import type { ShadowHost } from '../ui/shadow-host.js';
import { fetchConsentText } from './consent-text.js';
import { renderConsentBanner } from '../ui/consent-banner.js';
import { renderProfilingToggle } from '../ui/profiling-toggle.js';
import type { ProfilingToggleController } from '../ui/profiling-toggle.js';
import { setProfilingOptOut, eraseProfilingOptOut } from './profiling-opt-out.js';
import type { BootContext } from './boot.js';
import type { AdaptLoop } from './adapt-loop.js';

/**
 * The consent gate. Resolves `true` when init may proceed (granted, or no shadow host in a
 * non-browser env) and `false` when it must halt — every erase/audit/teardown for the halting
 * paths has already run.
 *
 * @param config - Snippet config (the server config is fetched only AFTER consent, ADR-0011).
 * @param earlyHost - The shadow host the banner renders in; destroyed on every halting path.
 * @param queue - The shared event queue (consent audit events).
 */
export async function resolveConsent(
  config: SdkConfig,
  earlyHost: ShadowHost | null,
  queue: CollectedEvent[],
): Promise<boolean> {
  const consentState = getConsentState();

  if (consentState === 'denied') {
    // User previously declined — halt SDK entirely, no events dispatched.
    // DPIA §13.2 / FOLLOW-139: ensure cross-session xid is absent on a denied session.
    eraseCrossSessionId();
    // FOLLOW-176: erase any persisted intent state for this session (if one exists
    // in sessionStorage from a prior page load where consent was still granted).
    eraseIntentState(peekStoredSessionId());
    // ADR-0011 / FOLLOW-275: erase cached quiz config on consent denial (Mode A compliance).
    eraseCachedQuizConfig();
    // FOLLOW-372 / §H.9: erase profiling opt-out flag on consent denial (storage cleanup).
    eraseProfilingOptOut();
    // The shadow host is destroyed to avoid leaving a DOM node.
    earlyHost?.destroy();
    return false;
  }

  if (consentState === 'pending') {
    if (earlyHost) {
      // No TENANT-data fetch before consent, but the consent-text GET MUST precede the banner
      // (ADR-0021 §D5).
      const consentCopy = await fetchConsentText(config.language);

      if (consentCopy === null) {
        // §D4 fail closed: no banner, no events, NO fallback text (ADR-0021 §D5) [ESC-051].
        earlyHost.destroy();
        return false;
      }

      const granted = await new Promise<boolean>((resolve) => {
        renderConsentBanner(earlyHost.root, {
          language: config.language,
          copy: consentCopy,
          accentColor: config.accentColor,
          ...(config.privacyPolicyUrl !== undefined
            ? { privacyPolicyUrl: config.privacyPolicyUrl }
            : {}),
          onGranted: () => {
            setConsentState('granted');
            // DPIA §13.2 / FOLLOW-139: create the cross-session xid now that consent is granted.
            // Fire-and-forget — future tickets (FOLLOW-146) will attach xid to event payloads.
            void getOrCreateCrossSessionId();
            // Consent audit event — compliance audit trail, dispatched unconditionally.
            queue.push({
              type: 'consent.granted',
              payload: { language: config.language, method: 'banner' },
              ts: Date.now(),
            });
            resolve(true);
          },
          onDenied: () => {
            setConsentState('denied');
            // DPIA §13.2 / FOLLOW-139: erase cross-session xid on consent denial.
            eraseCrossSessionId();
            // ADR-0011 / FOLLOW-275: erase cached quiz config on consent denial.
            eraseCachedQuizConfig();
            // FOLLOW-372 / §H.9: erase profiling opt-out flag on consent denial.
            eraseProfilingOptOut();
            // Consent audit event — dispatched even when consent is denied.
            queue.push({
              type: 'consent.denied',
              payload: { language: config.language, method: 'banner' },
              ts: Date.now(),
            });
            resolve(false);
          },
        });
      });

      if (!granted) {
        // User declined — flush the consent.denied audit event, then halt.
        if (queue.length > 0) {
          const batch = queue.splice(0);
          const auditSession = await getOrCreateSession();
          // FOLLOW-176: erase any persisted intent state for this session.
          eraseIntentState(auditSession.sessionId);
          await dispatchEvents(batch, config, auditSession);
        }
        earlyHost.destroy();
        return false;
      }
    }
    // If earlyHost is null (SSR/non-browser), treat as granted and continue.
  }
  // consentState === 'granted' (or earlyHost is null in non-browser env) — proceed.

  // Returning visitor: ensure the xid before session init (DPIA §13.2) [FOLLOW-139].
  if (consentState === 'granted') {
    void getOrCreateCrossSessionId();
  }
  return true;
}

/**
 * 5b. §H.9 opt-out toggle; AL DOM adaptation only [FOLLOW-372].
 * @returns The toggle controller, or `null` when there is no shadow host.
 */
export function mountOptOutToggle(
  ctx: BootContext,
  adapt: AdaptLoop,
): ProfilingToggleController | null {
  const { config, host } = ctx;
  if (!host) return null;
  return renderProfilingToggle(host.root, {
    language: config.language,
    // FOLLOW-641 / ADR-0019 D4: the opt-out toggle has no per-widget color, so the brand
    // umbrella color becomes its accent; absent → the SDK accentColor (byte-identical).
    accentColor: config.brand?.primaryColor ?? config.accentColor,
    initialOptedOut: ctx.optedOut,
    // FOLLOW-641 / ADR-0019 D2: per-brand placement + i18n label overrides. Absent → the
    // toggle renders at bottom-left with hardcoded copy (byte-identical to pre-FOLLOW-641).
    ...(config.optOutWidget?.placement ? { placement: config.optOutWidget.placement } : {}),
    ...(config.optOutWidget?.labels ? { labels: config.optOutWidget.labels } : {}),
    // FOLLOW-651: render the "Powered by Estalara" attribution unless this tenant is
    // white-label. First real consumer of brand.whiteLabel (RETRO-214 HALF_WIRE_P).
    showAttribution: config.brand?.whiteLabel !== true,
    onChange: (newOptedOut: boolean) => {
      ctx.optedOut = newOptedOut;
      setProfilingOptOut(newOptedOut, ctx.leadId);
      if (!newOptedOut && config.decisionApiUrl) {
        // Opted back IN — resume full adaptation immediately.
        void adapt.refresh();
        return;
      }
      // FOLLOW-1019 / FOLLOW-1306 (F-12): opting OUT invalidates the in-flight generation and
      // actively reverts the DOM — see `AdaptLoop.revert`.
      adapt.revert();
    },
  });
}
