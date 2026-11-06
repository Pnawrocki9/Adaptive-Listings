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
  eraseIntentState,
  isConsentTextStale,
  peekStoredSessionId,
  setConsentTextVersion,
  clearConsentDenial,
} from './session.js';
import { eraseCrossSessionId, getOrCreateCrossSessionId, isXidLive, readStoredXid } from './xid.js';
import { postProfileErase } from './adapt.js';
import type { ShadowHost } from '../ui/shadow-host.js';
import { fetchConsentText } from './consent-text.js';
import { renderConsentBanner } from '../ui/consent-banner.js';
import { renderProfilingToggle, renderReopenChip } from '../ui/profiling-toggle.js';
import type { ProfilingToggleController } from '../ui/profiling-toggle.js';
import { setProfilingOptOut, eraseProfilingOptOut } from './profiling-opt-out.js';
import type { BootContext } from './boot.js';
import type { AdaptLoop } from './adapt-loop.js';

/**
 * Delete first, erase the local xid only on a 2xx; any other answer keeps it for the next load's
 * stored-denied branch, because the id is the only key to the profile (FOLLOW-1316, R25, R26). An id
 * that never left the browser, or has expired along with its profile, has nothing to delete, so it
 * is erased without a request: with the server flag off the xid never leaves, denial included.
 */
async function deleteThenEraseXid(config: SdkConfig): Promise<void> {
  const xid = readStoredXid();
  if (!xid?.sent || !isXidLive(xid) || (await postProfileErase(config, xid.id))) {
    eraseCrossSessionId();
  }
}

/** Consent audit event — compliance audit trail, also on a denial or withdrawal. */
function deniedEvent(config: SdkConfig): CollectedEvent {
  return {
    type: 'consent.denied',
    payload: { language: config.language, method: 'banner' },
    ts: Date.now(),
  };
}

/** The local erases of every denial path, the xid apart (DPIA §13.2, ADR-0011, §H.9). */
function eraseConsentedState(): void {
  eraseCachedQuizConfig();
  eraseProfilingOptOut();
  setConsentTextVersion(null);
}

/**
 * The withdrawal control's click (FOLLOW-1316, R25, R28): `denied` first, so sending stops; then the
 * delete, the DOM revert, the local erases and the halt. The audit event is the only other request.
 */
async function withdrawConsent(ctx: BootContext, adapt: AdaptLoop): Promise<void> {
  setConsentState('denied');
  const erasing = deleteThenEraseXid(ctx.config);
  adapt.revert();
  eraseIntentState(ctx.session.sessionId);
  eraseConsentedState();
  ctx.queue.length = 0;
  (window as Window & { __estalaraTeardown?: () => void }).__estalaraTeardown?.();
  await Promise.all([erasing, dispatchEvents([deniedEvent(ctx.config)], ctx.config, ctx.session)]);
}

/**
 * The way back from `denied` (ESC-092 B-d) [FOLLOW-1446]: the halted SDK keeps its host only for a
 * "turn on" chip. The chip, or the host event `estalara:consent:reopen`, forgets the denial and runs
 * `init()` again, so the buyer sees the first-visit banner. Nothing is read or sent before that; the
 * banner's own consent-text GET is the first request, as on a first visit.
 */
function offerReopen(config: SdkConfig, host: ShadowHost, reinit: () => void): void {
  const reopen = (): void => {
    // Once: the host leaves on the first call, or went with the page (an SPA, a test) before it.
    if (!host.container.isConnected) return;
    host.destroy();
    clearConsentDenial();
    reinit();
  };
  renderReopenChip(host.root, config.language, reopen);
  document.addEventListener('estalara:consent:reopen', reopen, { once: true });
}

/** Show the withdrawal control in the toggle [FOLLOW-1316, R24]. */
export function offerWithdrawal(
  ctx: BootContext,
  adapt: AdaptLoop,
  toggle: ProfilingToggleController,
): void {
  toggle.showWithdraw(() => void withdrawConsent(ctx, adapt));
}

/**
 * The consent gate. Resolves `true` when init may proceed (granted, or no shadow host in a
 * non-browser env) and `false` when it must halt — every erase/audit/teardown for the halting
 * paths has already run.
 *
 * @param config - Snippet config (the server config is fetched only AFTER consent, ADR-0011).
 * @param earlyHost - The shadow host the banner renders in; destroyed on every halting path.
 * @param queue - The shared event queue (consent audit events).
 * @param reinit - Runs `init()` again, for the way back from `denied` [FOLLOW-1446].
 */
export async function resolveConsent(
  config: SdkConfig,
  earlyHost: ShadowHost | null,
  queue: CollectedEvent[],
  reinit: () => void,
): Promise<boolean> {
  const consentState = getConsentState();

  if (consentState === 'denied') {
    // User previously declined — halt SDK entirely, no events dispatched.
    // FOLLOW-176: erase any persisted intent state for this session (if one exists
    // in sessionStorage from a prior page load where consent was still granted).
    eraseIntentState(peekStoredSessionId());
    eraseConsentedState();
    // The host stays only for the "turn on" chip (ESC-092 B-d) [FOLLOW-1446].
    if (earlyHost) offerReopen(config, earlyHost, reinit);
    // DPIA §13.2 / FOLLOW-139: the xid does not outlive a denied session. This is also the retry of
    // a delete that failed earlier, and the only request a halted SDK sends (R25, R26).
    await deleteThenEraseXid(config);
    return false;
  }

  // A grant of an older text than this feature requires is asked again (FOLLOW-1316, R6).
  if (consentState === 'pending' || isConsentTextStale()) {
    if (earlyHost) {
      // No TENANT-data fetch before consent, but the consent-text GET MUST precede the banner
      // (ADR-0021 §D5).
      const consentText = await fetchConsentText(config.language);

      if (consentText === null) {
        // §D4 fail closed: no banner, no events, NO fallback text (ADR-0021 §D5) [ESC-051].
        earlyHost.destroy();
        return false;
      }

      const granted = await new Promise<boolean>((resolve) => {
        renderConsentBanner(earlyHost.root, {
          language: config.language,
          copy: consentText.copy,
          accentColor: config.accentColor,
          ...(config.privacyPolicyUrl !== undefined
            ? { privacyPolicyUrl: config.privacyPolicyUrl }
            : {}),
          onGranted: () => {
            setConsentState('granted');
            // What the buyer accepted: below the minimum, or absent, no xid is sent (R6).
            setConsentTextVersion(consentText.textVersion);
            // DPIA §13.2 / FOLLOW-139: create the cross-session xid now that consent is granted.
            // It stays off events (ESC-090 item 4); only `readSendableXid` may send it.
            void getOrCreateCrossSessionId();
            // Consent audit event — compliance audit trail, dispatched unconditionally.
            queue.push({
              type: 'consent.granted',
              payload: {
                language: config.language,
                method: 'banner',
                text_version: consentText.textVersion,
              },
              ts: Date.now(),
            });
            resolve(true);
          },
          onDenied: () => {
            setConsentState('denied');
            eraseConsentedState();
            queue.push(deniedEvent(config));
            resolve(false);
          },
        });
      });

      if (!granted) {
        // DPIA §13.2 / FOLLOW-139, R26: the xid goes on denial, its server profile first.
        const erasing = deleteThenEraseXid(config);
        // User declined — flush the consent.denied audit event, then halt.
        if (queue.length > 0) {
          const batch = queue.splice(0);
          const auditSession = await getOrCreateSession();
          // FOLLOW-176: erase any persisted intent state for this session.
          eraseIntentState(auditSession.sessionId);
          await dispatchEvents(batch, config, auditSession);
        }
        // The page is now `denied`: the same chip as a stored denial [FOLLOW-1446].
        offerReopen(config, earlyHost, reinit);
        await erasing;
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
  const toggle = renderProfilingToggle(host.root, {
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
  // With the flag on, or once this id left the browser: never strand a stored profile (FOLLOW-1316).
  if (config.buyerProfileEnabled || readStoredXid()?.sent) offerWithdrawal(ctx, adapt, toggle);
  return toggle;
}
