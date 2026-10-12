/**
 * Boot phase of `init()` (FOLLOW-1296): bot gate, script tag and config, the consent gate,
 * the anonymous session, the per-user opt-out read, the first two queued events, intent-state
 * rehydration, the parallel server-config fetch and the cold-start priors — i.e. everything up
 * to the initial intent state the intent and adapt loops start from.
 *
 * Returns the {@link BootContext} every later phase works on, or `null` when init must stop
 * (bot, no script tag, consent denied / not obtained). Nothing here is module-level state: the
 * context is created per `init()` call (RETRO-006 LG-2).
 *
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

/**
 * Per-`init()` state shared by the boot, consent-flow, intent-loop and adapt-loop phases.
 *
 * `state` and `optedOut` are the only fields written after boot: the intent loop and the adapt
 * loop both read and write the live intent state, and the opt-out toggle flips `optedOut`. Every
 * other field is fixed once boot returns.
 */
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
  /** This instance's lifetime (FOLLOW-1306 F-24); aborted on teardown. */
  lifetime: AbortController;
  /** Register a host listener bound to {@link lifetime}. */
  on: (target: EventTarget, type: string, fn: (e: Event) => void) => void;
}

/**
 * Merge server-fetched quiz config into SdkConfig (ADR-0011, FOLLOW-275).
 *
 * Overlays `{ quiz_enabled, language, accent_color }` from the
 * `GET /api/quiz/public-config` response onto the already-parsed SdkConfig.
 *
 * When `fetched` is `null` (network error / timeout / parse failure) the original
 * config is returned unchanged — callers already hold snippet-attribute fallback values
 * from `readConfig()`, which are themselves a fallback to hardcoded defaults.
 *
 * Called in `init()` AFTER `resolveConsent()` and BEFORE `scheduleQuizTrigger()`
 * (ADR-0011 init sequence step 4).
 *
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
    // FOLLOW-623 / ADR-0019: overlay the optional brand slice. Absent → key omitted
    // (conditional spread for exactOptionalPropertyTypes) so an unbranded tenant is
    // byte-identical to pre-ADR-0019. `logo_url` stays `string | null`, never undefined.
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
    // FOLLOW-640 / ADR-0019 D2: overlay the optional quiz placement. Absent → key omitted
    // so renderQuizWidget uses DEFAULT_QUIZ_PLACEMENT (byte-identical, D4).
    ...(fetched.quiz_placement ? { quizPlacement: fetched.quiz_placement } : {}),
    // FOLLOW-641 / ADR-0019 D2: overlay the optional opt-out widget config. Absent → key
    // omitted so renderProfilingToggle uses hardcoded defaults (byte-identical, D4).
    ...(fetched.opt_out_widget ? { optOutWidget: fetched.opt_out_widget } : {}),
  };
}

/**
 * Structural type guard for a persisted IntentState envelope.
 *
 * Validates that a rehydrated `unknown` value from sessionStorage has the
 * required fields of IntentState before it is used as one. Intentionally
 * permissive on the `probabilities` sub-object — a full per-archetype check
 * would be expensive and adds no safety beyond the top-level fields.
 *
 * FOLLOW-176: called once per `init()` during rehydration; never called on
 * the hot path.
 */
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
  // FOLLOW-099 AC7 (CEO-ratified): Bot detection gate.
  // Any known crawler UA short-circuits init before session creation, DOM mutation,
  // or any data collection.  Uses globalThis.navigator to avoid esbuild constant-folding
  // of `typeof navigator` checks (same pattern as language detection in config.ts).
  const navGlobal = (globalThis as { navigator?: { userAgent?: string } }).navigator;
  if (navGlobal !== undefined && BOT_UA_RE.test(navGlobal.userAgent ?? '')) {
    return null;
  }

  // FOLLOW-208: Record session start time for listing-view-rate computation.
  // Must be set before any async await so all listing.viewed callbacks reference
  // the same origin timestamp for rate = viewCount / (elapsedMs / 60_000).
  const sessionStartedAt = Date.now();

  // 1. Find the Estalara script tag (the one with data-api-key)
  const script = document.querySelector<HTMLScriptElement>('script[data-api-key]');
  if (!script) return null;

  // 2. Read configuration from data-* attributes
  // `config` is declared with `let` because mergeQuizConfig() may replace it later
  // (ADR-0011 step 4: fetchQuizConfig → mergeQuizConfig overlays server values).
  let config = readConfig({ dataset: script.dataset });

  // 3a. Consent gate — MUST run before any data collection (TICKET-041, GDPR/CCPA).
  //     Create the shadow host early so we have a ShadowRoot to render the banner in.
  const earlyHost = createShadowHost();
  if (!(await resolveConsent(config, earlyHost, queue))) return null;

  // 3. Initialize anonymous session (reset idempotency state for new session)
  resetAdaptState();
  const session = await getOrCreateSession();
  const currentSession = incrementPageCount(session);

  // FOLLOW-197 / CHAT-003: Registered user lead_id derivation.
  // If a Keycloak JWT is present in localStorage ('kc_token'), derive a pseudonymous
  // lead_id from the 'sub' claim and store it in sessionStorage (tab-lifetime only).
  // Rule L: the raw user_uuid is NEVER stored — only the SHA-256 16-char hex prefix.
  // Mode A compliance: sessionStorage only, never localStorage for this identifier.
  // Failures are silently swallowed — anonymous users continue with xid-based tracking.
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

  // FOLLOW-372 / §H.9: Read per-user profiling opt-out state.
  // Read after lead_id derivation so the opt-out key can be scoped to the user.
  // The userId used here is the same SHA-256 lead_id prefix stored in sessionStorage —
  // it is not raw PII (Rule L). For anonymous sessions the unscoped key is used.
  //
  // Scope boundary: this flag suspends AL DOM adaptation only. It does NOT affect
  // app.estalara.com buying-intent identification, lead ranking, or agent-facing
  // chat summaries (those ride the mandatory registration consent per §H.8).
  let storedLeadId: string | undefined;
  try {
    storedLeadId = sessionStorage.getItem(LEAD_ID_STORAGE_KEY) ?? undefined;
  } catch {
    // sessionStorage unavailable — anonymous scope
  }
  const profilingOptedOut = isProfilingOptedOut(storedLeadId);

  // 4. Collect initial page.view event
  queue.push(collectPageView());

  // 4a. Initialize Bayesian intent state.
  // FOLLOW-176: attempt to rehydrate a previously persisted intent state before
  // cold-start. A successful rehydrate means the visitor already accumulated
  // signals on a prior listing page in this tab — skip cold-start hints so the
  // prior archetype is not diluted by site-level priors applied a second time.
  //
  // Consent gate: we only reach this line when consent is 'granted' (all denial
  // paths return early above). No re-check needed here.
  //
  // ADR-0012 Ticket C: the state starts as `initIntentState()` (no overrides yet) as a
  // temporary placeholder for the rehydration check. The server-supplied priors
  // (intentOverrides) are applied by the cold-start gate below, AFTER the parallel fetch
  // completes.
  let intentStateRehydrated = false;
  let currentIntentState: IntentState = initIntentState();

  {
    const raw = rehydrateIntentState(currentSession.sessionId);
    if (isValidIntentState(raw)) {
      currentIntentState = raw;
      intentStateRehydrated = true;
    }
  }

  // Read referrer, UTM, and device width unconditionally — required by session.started
  // below regardless of whether state was rehydrated.
  // globalThis property access prevents esbuild dead-code elimination (FOLLOW-202 pattern).
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

  // ADR-0012 Ticket C (FOLLOW-268-sdk) + ADR-0011 (FOLLOW-275):
  // Steps 3a + 3b run IN PARALLEL — both fetches are bounded to 1000ms each
  // and must both complete (or timeout) before steps 5–8 run.
  //
  //   3a. fetchQuizConfig  — GET /api/quiz/public-config (ADR-0011)
  //   3b. fetchIntentWeights — GET /api/intent/config (ADR-0012)
  //
  // Rule R gate: `intentStateRehydrated` is passed to `fetchQuizConfig()` so that
  // cross-listing navigations within the same tab reuse the sessionStorage-cached
  // quiz config instead of re-fetching. Intent weights are NOT cached because they
  // are applied once to initIntentState and the resulting IntentState is rehydrated
  // from sessionStorage on subsequent navigations (see session.ts / Rule R comment).
  //
  // `config` is reassigned here (declared `let` above for exactly this purpose).
  // On any failure either fetch returns null; mergeQuizConfig / resolveIntentOverrides
  // fall back to snippet-attribute values / SDK internal defaults respectively.
  let intentOverrides: IntentEngineOverrides = resolveIntentOverrides(null);
  if (config.decisionApiUrl) {
    mark('config-fetch-start');
    const [fetchedQuizConfig, fetchedWeights] = await Promise.all([
      fetchQuizConfig(
        config.decisionApiUrl,
        config.apiKey,
        intentStateRehydrated,
        1_000,
        config.debug,
      ),
      // Step 3b: fetch intent weight overrides (ADR-0012 Ticket C).
      // On a rehydrated session, the intent state is already persisted with the
      // cold-start priors applied — refetching weights would not affect the
      // rehydrated distribution. We still fetch so any weight config change is
      // observable in debug mode; the result is passed to resolveIntentOverrides
      // which is a no-op when intentStateRehydrated=true (overrides are not applied
      // to the already-rehydrated state — see the cold-start gate below).
      fetchIntentWeights(config.decisionApiUrl, config.apiKey, 1_000, config.debug),
    ]);

    mark('config-fetch-end');
    config = mergeQuizConfig(config, fetchedQuizConfig);
    intentOverrides = resolveIntentOverrides(fetchedWeights);

    if (config.debug && fetchedQuizConfig === null) {
      console.warn('[Estalara] fetchQuizConfig returned null — using snippet/default fallback');
    }
  }

  // FOLLOW-219 / ADR-0012 Ticket C: Single cold-start gate.
  // ALL init-time priors and the LG-2 persist live inside this one block so the
  // guard cannot be partially applied.
  //
  // Placed AFTER the parallel fetch (step 3a/3b) so that `initIntentState` can
  // be called with server-supplied `intentOverrides` (ADR-0012 §3 init sequence step 6).
  //
  // Why each step is skipped on rehydration:
  //   - initIntentState(overrides): rehydrated state already has all cold-start priors
  //     baked in; applying overrides again would double-count and perturb the distribution.
  //   - Archetype hints (4a-f02): already folded in on the first listing page (FOLLOW-176).
  //   - Referrer + device (FOLLOW-207, FOLLOW-216 LG-1): already applied on the first page;
  //     re-applying would perturb the archetype and inflate signal_count by +1 per nav.
  //   - LG-2 persist (FOLLOW-216): the persisted entry is already current; a second write is
  //     a no-op in terms of state but would be caught as a double-write by follow-217 tests.
  //
  // Adding a new cold-start prior: add it INSIDE this block. A prior added outside this block
  // without its own guard would be caught by the follow-217 integration tests (signal_count
  // is asserted unchanged on every rehydrated-session test).
  // FOLLOW-372 / §H.9: When opted out, skip ALL profiling cold-start priors.
  // Accumulated archetype/intent state in sessionStorage is preserved (reversible suspend).
  // The toggle resumes full adaptation with no data loss when flipped back ON.
  if (!intentStateRehydrated && !profilingOptedOut) {
    // Step 6 (ADR-0012): re-initialize with server-supplied priors now that the fetch
    // has completed. `intentOverrides` contains server values (or SDK defaults on null).
    // This replaces the temporary `initIntentState()` placeholder from step 4a above.
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

    // FOLLOW-216 (LG-2): Persist the cold-start intent state (after all init-time priors have
    // been applied) once, before the first refreshDirectives(). This ensures the very first
    // cross-listing navigation in the same tab can rehydrate the cold-start archetype even if
    // no behavioral signal has fired yet (the intent loop's persist is the only other persist
    // site, but it fires only after a behavioral event).
    persistIntentState(currentSession.sessionId, currentIntentState);
  }

  // FOLLOW-1306 (F-24): this instance's lifetime. Every host listener registered by init() goes
  // through `on()` and is bound to it; teardown aborts it, so a torn-down SDK no longer answers
  // host events with requests.
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
    lifetime,
    on: (target, type, fn) => {
      target.addEventListener(type, fn, { signal: lifetime.signal });
    },
  };
}
