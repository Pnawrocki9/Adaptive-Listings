/**
 * Consent flow (FOLLOW-1296): the consent gate run by `boot()` (TICKET-041, ADR-0021) and the
 * §H.9 per-user profiling opt-out toggle mounted after the first decision cycle (FOLLOW-372).
 *
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
      // Show banner and wait for the user's decision.
      // Returns true if consent was granted, false if denied.
      //
      // FOLLOW-278 / ADR-0011 (§Consent-banner locale) — Accepted constraint, SCOPED by
      // ADR-0021 §D5 (FOLLOW-915, compliance-countersigned 2026-08-09):
      // The consent banner renders here, BEFORE fetchQuizConfig() resolves (step 3
      // in the ADR-0011 init sequence).  By design, THAT fetch runs AFTER consent is
      // resolved — the consent gate must precede any network call that reads TENANT
      // DATA, so the banner can never receive the server-fetched language/accentColor.
      //
      // READ THE SCOPE CAREFULLY. ADR-0011's addendum sentence "the consent banner
      // cannot wait for the fetch" denotes fetchQuizConfig() and is superseded as a
      // general claim by ADR-0021 §D5: the banner DOES wait for one fetch — the
      // identifier-free consent-text GET immediately below — and under ADR-0021 it
      // MUST. The tenant-data prohibition above is re-affirmed byte-intact (§D1); what
      // fell was an ordering consequence that carried no compliance rationale of its
      // own. Do not re-generalise it: a future reader who reads the paragraph above as
      // "no fetch may precede consent" will delete a legally required disclosure fetch.
      //
      // `config.language` at this point is sourced from the `data-language` snippet
      // attribute (level 2) or the browser's navigator.language (level 3) or the
      // hardcoded 'en' default (level 4).  `buildSnippet()` has NEVER emitted
      // `data-language` or `data-accent-color` — these attributes were not part of
      // the snippet transport and were not retired by ADR-0011 (ADR-0011 only retired
      // `data-quiz-enabled` and the since-removed micro-poll attribute).  As a result, for tenants
      // who do not hand-code those attributes, the banner always uses the
      // navigator.language or 'en' fallback.
      //
      // Decision: this constraint is accepted (option iii of FOLLOW-278 AC1):
      //   - Compliance confirmed no locale-specific legal text in the banner that
      //     would make an 'en' banner a legal defect in a pl/es jurisdiction.
      //   - The quiz widget (rendered AFTER mergeQuizConfig()) correctly uses the
      //     server-fetched language; only the pre-consent banner is affected.
      //   - If a locale-specific consent banner becomes a compliance requirement,
      //     the fix is to ADD `data-language` to buildSnippet() for the first time
      //     (a new feature, not a re-introduction) and update ADR-0011 accordingly.
      //     See the "Consent-banner locale" addendum section added to
      //     docs/adr/ADR-0011-quiz-config-transport.md by FOLLOW-278.
      // ADR-0021 §D2 — the banner copy is fetched, not bundled (ESC-051 / FOLLOW-915).
      // Identifier-free static GET, awaited HERE so that everything capable of profiling
      // is sequenced behind it: a slow fetch delays the banner and the product equally,
      // never the banner alone. Skipped entirely on the granted/denied paths above, so a
      // returning visitor pays no extra request.
      const consentCopy = await fetchConsentText(config.language);

      if (consentCopy === null) {
        // §D4 FAIL CLOSED — no banner, no events, no storage writes, no tenant-identified
        // request; consent remains 'pending' (NOT recorded as denied) and the fetch is
        // retried naturally on the next page load.
        //
        // There is deliberately NO built-in fallback text. A trimmed fallback recreates
        // the ESC-051 defect — disclosure content degraded by an engineering constraint —
        // and consent obtained on an incomplete disclosure is not "informed" under GDPR
        // Art. 4(11)/Art. 7, which would invalidate the lawful basis of everything
        // downstream. Compliance ruled this fail-closed path COMPLIANCE-SUPERIOR, not
        // merely engineering-preferable (ADR-0021 §D5 countersign, item 3): the visitor
        // who is not noticed is also not profiled, and GDPR does not require notifying
        // people about processing that does not occur.
        //
        // Availability cost accepted per §D4: if the control-plane origin cannot serve a
        // static file, the adapt endpoint on that same origin is down too.
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

  // DPIA §13.2 / FOLLOW-139: ensure cross-session xid exists when consent is already granted
  // on this init call (returning visitor). Fire-and-forget — FOLLOW-146 will attach xid to
  // event payloads. Must run before session init so the key is populated before any events fire.
  if (consentState === 'granted') {
    void getOrCreateCrossSessionId();
  }
  return true;
}

/**
 * 5b. Mount the per-user profiling opt-out toggle (FOLLOW-372 / §H.9).
 * Visible to logged-in users; renders at bottom-left fixed in Shadow DOM.
 * The toggle controls AL DOM adaptation only — NOT buying-intent / lead-ranking /
 * agent chat-summaries (those ride mandatory registration consent per §H.8).
 *
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
