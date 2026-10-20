/**
 * Boot phase of `init()`: everything up to the initial intent state [FOLLOW-1296].
 * @module
 */

import { readConfig, BOT_UA_RE } from './config.js';
import type { SdkConfig } from './config.js';
import { fetchQuizConfig } from './quiz-config.js';
import { fetchIntentWeights } from './intent-weights.js';
import type { PresentationConfigResponse } from '@estalara/shared';
import { collectPageView } from './events.js';
import type { CollectedEvent } from './events.js';
import {
  getOrCreateSession,
  incrementPageCount,
  deriveLeadId,
  LEAD_ID_STORAGE_KEY,
  rehydrateIntentState,
  persistIntentState,
} from './session.js';
import type { SessionState } from './session.js';
import { createShadowHost } from '../ui/shadow-host.js';
import type { ShadowHost } from '../ui/shadow-host.js';
import { isProfilingOptedOut } from './profiling-opt-out.js';
import { resetAdaptState } from './adapt.js';
import { mark } from './boot-timing.js';
import {
  applyBehavioralSignal,
  applyReferrerHints,
  initIntentState,
  resolveIntentOverrides,
} from './intent.js';
import type { IntentEngineOverrides, IntentState } from './intent.js';
import { resolveConsent } from './consent-flow.js';

/** Per-`init()` state; only `state` and `optedOut` change after boot. */
export interface BootContext {
  /** Resolved config — snippet attributes overlaid with the server quiz config (ADR-0011). */
  config: SdkConfig;
  /** The Estalara `<script>` tag's dataset (page-type override). */
  dataset: DOMStringMap;
  /** Shared event queue owned by `index.ts`. */
  queue: CollectedEvent[];
  /** Shadow host created before the consent gate; reused for every widget. */
  host: ShadowHost | null;
  /** This page view's session (page count already incremented). */
  session: SessionState;
  /** `Date.now()` at the top of `init()` — origin of the listing-view rate (FOLLOW-208). */
  startedAt: number;
  /** SHA-256 lead_id prefix from sessionStorage, if any (scopes the opt-out key). */
  leadId: string | undefined;
  /** §H.9 per-user profiling opt-out. Written by the opt-out toggle. */
  optedOut: boolean;
  /** The live intent state. Written by the intent loop and the adapt loop. */
  state: IntentState;
  /** Server-supplied intent-engine overrides, or SDK defaults (ADR-0012). */
  overrides: IntentEngineOverrides;
  /** Set when the 1 s init config fetch failed: one 8 s retry, merged; null on failure [FOLLOW-1365]. */
  lateConfig?: Promise<SdkConfig | null> | null;
  /** This instance's lifetime (FOLLOW-1306 F-24); aborted on teardown. */
  lifetime: AbortController;
  /** Register a host listener bound to {@link lifetime}. */
  on: (target: EventTarget, type: string, fn: (e: Event) => void) => void;
}

/**
 * Overlay fetched quiz config onto SdkConfig; null → unchanged (ADR-0011) [FOLLOW-275].
 * @internal exported for tests only
 */
export function mergeQuizConfig(
  config: SdkConfig,
  fetched: PresentationConfigResponse | null,
): SdkConfig {
  if (!fetched) return config;
  return {
    ...config,
    quiz: { ...config.quiz, enabled: fetched.quiz_enabled },
    language: fetched.language,
    accentColor: fetched.accent_color,
    // Absent brand → key omitted, unbranded tenants byte-identical [FOLLOW-623].
    ...(fetched.brand
      ? {
          brand: {
            primaryColor: fetched.brand.primary_color,
            logoUrl: fetched.brand.logo_url,
            whiteLabel: fetched.brand.white_label,
          },
        }
      : {}),
    // FOLLOW-639 / ADR-0019 D5: overlay the optional editable quiz definition. Absent → key
    // omitted so the SDK walks its built-in DEFAULT_QUIZ_DEFINITION (byte-identical, D4/D5).
    ...(fetched.quiz_definition ? { quizDefinition: fetched.quiz_definition } : {}),
    // FOLLOW-1357: forward the served definition's identity (Q3 computes it; never hashed here).
    ...(fetched.definition_hash ? { quizDefinitionHash: fetched.definition_hash } : {}),
    ...(fetched.definition_version !== undefined
      ? { quizDefinitionVersion: fetched.definition_version }
      : {}),
    // FOLLOW-640 / ADR-0019 D2: overlay the optional quiz placement. Absent → key omitted
    // so renderQuizWidget uses DEFAULT_QUIZ_PLACEMENT (byte-identical, D4).
    ...(fetched.quiz_placement ? { quizPlacement: fetched.quiz_placement } : {}),
    // FOLLOW-641 / ADR-0019 D2: overlay the optional opt-out widget config. Absent → key
    // omitted so renderProfilingToggle uses hardcoded defaults (byte-identical, D4).
    ...(fetched.opt_out_widget ? { optOutWidget: fetched.opt_out_widget } : {}),
  };
}

/** Structural guard for a persisted IntentState [FOLLOW-176]. */
function isValidIntentState(raw: unknown): raw is IntentState {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.archetype === 'string' &&
    typeof r.confidence === 'number' &&
    typeof r.signal_count === 'number' &&
    typeof r.last_updated_at === 'number' &&
    typeof r.quiz_answered === 'boolean' &&
    r.probabilities !== null &&
    typeof r.probabilities === 'object'
  );
}

/**
 * Run the boot phase. See the module doc.
 *
 * @param queue - The shared event queue (owned by `index.ts`).
 * @returns The boot context, or `null` when init must stop here.
 */
export async function boot(queue: CollectedEvent[]): Promise<BootContext | null> {
  // Bot gate before any session or data work [FOLLOW-099].
  const navGlobal = (globalThis as { navigator?: { userAgent?: string } }).navigator;
  if (navGlobal !== undefined && BOT_UA_RE.test(navGlobal.userAgent ?? '')) {
    return null;
  }

  // Set before any await: one origin for view rates [FOLLOW-208].
  const sessionStartedAt = Date.now();

  // 1. Find the Estalara script tag (the one with data-api-key)
  const script = document.querySelector<HTMLScriptElement>('script[data-api-key]');
  if (!script) return null;

  // 2. Config from data-* (`let`: mergeQuizConfig replaces it).
  let config = readConfig({ dataset: script.dataset });

  // 3a. Consent gate — MUST run before any data collection (TICKET-041, GDPR/CCPA).
  //     Create the shadow host early so we have a ShadowRoot to render the banner in.
  const earlyHost = createShadowHost();
  if (!(await resolveConsent(config, earlyHost, queue))) return null;

  // 3. Initialize anonymous session (reset idempotency state for new session)
  resetAdaptState();
  const session = await getOrCreateSession();
  const currentSession = incrementPageCount(session);

  // Lead id = SHA-256 prefix of the `sub`, sessionStorage only (Rule L) [FOLLOW-197].
  try {
    const kcToken = localStorage.getItem('kc_token');
    if (kcToken) {
      // JWT is three base64url segments separated by dots; middle segment is the payload.
      const parts = kcToken.split('.');
      if (parts.length === 3) {
        // base64url → base64 → JSON
        const [, payloadSegment] = parts;
        const b64 = (payloadSegment ?? '').replace(/-/g, '+').replace(/_/g, '/');
        const json = atob(b64);
        const claims = JSON.parse(json) as Record<string, unknown>;
        if (typeof claims.sub === 'string' && claims.sub.length > 0) {
          const leadId = await deriveLeadId(claims.sub);
          try {
            sessionStorage.setItem(LEAD_ID_STORAGE_KEY, leadId);
          } catch {
            // sessionStorage unavailable — lead_id lives in memory only for this call
          }
        }
      }
    }
  } catch {
    // Any parse failure (malformed JWT, missing atob, JSON error) → continue anonymously
  }

  // Per-user profiling opt-out; AL DOM adaptation only (§H.9) [FOLLOW-372].
  let storedLeadId: string | undefined;
  try {
    storedLeadId = sessionStorage.getItem(LEAD_ID_STORAGE_KEY) ?? undefined;
  } catch {
    // sessionStorage unavailable — anonymous scope
  }
  const profilingOptedOut = isProfilingOptedOut(storedLeadId);

  // 4. Collect initial page.view event
  queue.push(collectPageView());

  // 4a. Rehydrate first, so cold-start priors never apply twice [FOLLOW-176].
  let intentStateRehydrated = false;
  let currentIntentState: IntentState = initIntentState();

  {
    const raw = rehydrateIntentState(currentSession.sessionId);
    if (isValidIntentState(raw)) {
      currentIntentState = raw;
      intentStateRehydrated = true;
    }
  }

  // Needed by session.started either way [FOLLOW-202].
  const referrer = (globalThis as { document?: { referrer?: string } }).document?.referrer ?? '';
  const utmTerm =
    new URLSearchParams(
      (globalThis as { location?: { search?: string } }).location?.search ?? '',
    ).get('utm_term') ?? '';
  const windowWidth = (globalThis as { window?: { innerWidth?: number } }).window?.innerWidth;
  const deviceType = windowWidth !== undefined && windowWidth >= 1024 ? 'desktop' : 'mobile';

  // Capture referrer_domain for session.started ingest event
  let referrerDomain = '';
  try {
    if (referrer) {
      referrerDomain = new URL(referrer).hostname;
    }
  } catch {
    // Malformed referrer URL — leave empty
  }

  // Emit session.started with device_type and referrer_domain (FOLLOW-207 AC3).
  // viewport is required by SessionStartedPayloadSchema; fall back to 0x0 in non-browser envs.
  const sessionViewport =
    windowWidth !== undefined
      ? {
          width: windowWidth,
          height: (globalThis as { window?: { innerHeight?: number } }).window?.innerHeight ?? 0,
        }
      : { width: 0, height: 0 };
  queue.push({
    type: 'session.started',
    payload: {
      device_class: deviceType,
      viewport: sessionViewport,
      language: config.language,
      ...(referrerDomain ? { referrer_domain: referrerDomain } : {}),
      device_type: deviceType,
    },
    ts: Date.now(),
  });

  // 3a quiz config + 3b intent weights in parallel, 1 s each (ADR-0011, ADR-0012).
  let intentOverrides: IntentEngineOverrides = resolveIntentOverrides(null);
  let lateConfig: BootContext['lateConfig'] = null;
  if (config.decisionApiUrl) {
    mark('config-fetch-start');
    const apiUrl = config.decisionApiUrl;
    // FOLLOW-1369: ONE request (15 s from boot) raced against the 1 s init budget; if it is
    // still pending after 1 s the same promise becomes `lateConfig` (one preflight, one GET).
    const quizRequest = fetchQuizConfig(
      apiUrl,
      config.apiKey,
      intentStateRehydrated,
      15_000,
      config.debug,
    );
    let budgetTimer: ReturnType<typeof setTimeout> | undefined;
    const [raced, fetchedWeights] = await Promise.all([
      Promise.race([
        quizRequest,
        new Promise<'slow'>((resolve) => {
          budgetTimer = setTimeout(() => {
            resolve('slow');
          }, 1_000);
        }),
      ]),
      // 3b: fetched even when rehydrated; not applied then.
      fetchIntentWeights(apiUrl, config.apiKey, 1_000, config.debug),
    ]);
    clearTimeout(budgetTimer);

    mark('config-fetch-end');
    config = mergeQuizConfig(config, raced === 'slow' ? null : raced);
    intentOverrides = resolveIntentOverrides(fetchedWeights);

    if (raced === 'slow') {
      // Awaited by the quiz card only; never blocks init.
      const base = config;
      lateConfig = quizRequest.then((late) => (late ? mergeQuizConfig(base, late) : null));
    }

    if (config.debug && (raced === 'slow' || raced === null)) {
      console.warn('[Estalara] fetchQuizConfig returned null — using snippet/default fallback');
    }
  }

  // Single cold-start gate: add new cold-start priors INSIDE it [FOLLOW-219, FOLLOW-372].
  if (!intentStateRehydrated && !profilingOptedOut) {
    // Step 6 (ADR-0012): re-init with server priors.
    currentIntentState = initIntentState(intentOverrides);

    // Referrer hints (cold-session prior, FOLLOW-207).
    // Applied after archetype hints so site-level hints are already folded in.
    currentIntentState = applyReferrerHints(currentIntentState, referrer, utmTerm);

    // Device type prior (FOLLOW-207).
    // Pass intentOverrides so the damping and signal likelihoods respect server config.
    currentIntentState = applyBehavioralSignal(
      currentIntentState,
      `device_type.${deviceType}`,
      undefined,
      intentOverrides,
    );

    // Persist cold-start state once for the first navigation [FOLLOW-216].
    persistIntentState(currentSession.sessionId, currentIntentState);
  }

  // Instance lifetime; teardown aborts every listener [FOLLOW-1306].
  const lifetime = new AbortController();
  return {
    config,
    // `script` is guaranteed non-null past the early return above.
    dataset: script.dataset,
    queue,
    host: earlyHost,
    session: currentSession,
    startedAt: sessionStartedAt,
    leadId: storedLeadId,
    optedOut: profilingOptedOut,
    state: currentIntentState,
    overrides: intentOverrides,
    lateConfig,
    lifetime,
    on: (target, type, fn) => {
      target.addEventListener(type, fn, { signal: lifetime.signal });
    },
  };
}
