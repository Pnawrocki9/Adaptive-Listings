/**
 * Adapt loop: intent state → DOM adaptation, latest-wins [FOLLOW-1296].
 * @module
 */

import { fetchDirectives, applyDirectives, resetAdaptState } from './adapt.js';
import { annotateSlots } from './annotate-slots.js';
import { bootTimings, mark } from './boot-timing.js';
import { applyDescriptionAdaptation, teardownDescriptionObservers } from './adapt-description.js';
import { scrubMessagePii } from './pii-scrub.js';
import {
  deriveLeadId,
  LEAD_ID_STORAGE_KEY,
  persistResolvedArchetype,
  readResolvedArchetype,
} from './session.js';
import type { ResolvedArchetype } from './session.js';
import { applyQuizLeaf, calculateBehavioralOnlyState, detectMismatch } from './intent.js';
import type { Archetype } from './intent.js';
import type { ArchetypeId } from '@estalara/shared';
import {
  DECISION_CONFIDENCE_GATE,
  DESCRIPTION_SLOT,
  DOM_ADAPT_CONFIDENCE_FLOOR,
  DOM_ADAPT_DESCRIPTION_MIN_SIGNAL_COUNT,
  DOM_ADAPT_MIN_SIGNAL_COUNT,
} from './adapt-floor.js';
import type { BootContext } from './boot.js';
import type { IntentLoop } from './intent-loop.js';

/** Cycles a drift must hold before overriding the quiz (§E.4.5) [FOLLOW-201]. */
export const DRIFT_HOLD_COUNT = 3;

/** Chat refresh debounce; bounded retries until the watermark moves [FOLLOW-1026]. */
const CHAT_REFRESH_DEBOUNCE_MS = 2_500;
/** Gap between retries when the watermark has not advanced yet. */
const CHAT_REFRESH_RETRY_MS = 6_000;
/** Total adapt calls one chat burst may trigger. */
const CHAT_REFRESH_MAX_ATTEMPTS = 3;

/** Resolved page type literal, shared by {@link resolvePageType} and {@link detectPageType}. */
export type PageType = 'listing_list' | 'listing_detail' | 'home' | 'search';

/** Which branch produced a {@link PageTypeResolution} [FOLLOW-1138]. */
type PageTypeProvenance = 'attribute' | 'url' | 'dom_signal' | 'default';

/** Page type + provenance; two fields only (bundle budget, ESC-028). */
interface PageTypeResolution {
  pageType: PageType;
  provenance: PageTypeProvenance;
}

/**
 * Page type: attribute, `/listing/` URL, exactly one listing id, else list [FOLLOW-1138].
 * @param scriptDataset - The dataset of the Estalara <script> tag (may include pageType).
 */
function resolvePageType(scriptDataset: DOMStringMap): PageTypeResolution {
  const attr = scriptDataset.pageType;
  if (
    attr === 'listing_detail' ||
    attr === 'listing_list' ||
    attr === 'home' ||
    attr === 'search'
  ) {
    return { pageType: attr, provenance: 'attribute' };
  }
  if (typeof window !== 'undefined' && window.location.pathname.includes('/listing/')) {
    return { pageType: 'listing_detail', provenance: 'url' };
  }
  if (
    typeof document !== 'undefined' &&
    document.querySelectorAll('[data-estalara-listing-id]').length === 1
  ) {
    return { pageType: 'listing_detail', provenance: 'dom_signal' };
  }
  return { pageType: 'listing_list', provenance: 'default' };
}

/**
 * Page type literal; wraps {@link resolvePageType}.
 * @param scriptDataset - The dataset of the Estalara <script> tag (may include pageType).
 * @returns The resolved page type literal.
 */
export function detectPageType(scriptDataset: DOMStringMap): PageType {
  return resolvePageType(scriptDataset).pageType;
}

/**
 * First `[data-estalara-listing-id]` value on the page [FOLLOW-194].
 * @internal exported for unit testing only
 */
export function detectListingId(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const el = document.querySelector<HTMLElement>('[data-estalara-listing-id]');
  const id = el?.getAttribute('data-estalara-listing-id') ?? undefined;
  return id !== '' ? id : undefined;
}

/** What the adapt loop hands the rest of `init()`. */
export interface AdaptLoop {
  /** Re-fetch directives and apply them with the latest intent state. */
  refresh: () => Promise<void>;
  /** Capture the first listing's originals, run the first decision cycle, signal `settled`. */
  start: () => Promise<void>;
  /** A `listing.viewed` signal: re-adapt when the listing (id or root node) changed. */
  onListingViewed: (listingId: string | null) => void;
  /** §H.9 opt-out: invalidate the in-flight generation and put the tenant's copy back. */
  revert: () => void;
  /** Register the chat bridge and the live.signup / inquiry.completed listeners. */
  listen: () => void;
  /** Teardown: cancel a pending chat refresh and invalidate the current generation. */
  stop: () => void;
}

/**
 * Create the adapt loop.
 *
 * @param ctx - The boot context (`ctx.state` is read and written here too).
 * @param intent - The intent loop (persistence, dwell timer, signal history, snapshot counters).
 * @param flush - Send the event queue now (owned by `index.ts`).
 */
export function createAdaptLoop(
  ctx: BootContext,
  intent: IntentLoop,
  flush: () => Promise<void>,
): AdaptLoop {
  const { config, session: currentSession, lifetime, queue } = ctx;
  const onIntentUpdate = intent.persist;
  const signalHistory = intent.signals;

  // resetAdaptState() only on archetype change: no flicker [FOLLOW-194].
  let previousArchetype: string | null = null;
  // FOLLOW-258 F-04: store the most recent adapt_decision_id for live.signup attribution.
  let lastAdaptDecisionId: string | undefined;

  // Drift state; overrides after DRIFT_HOLD_COUNT cycles [FOLLOW-201].
  let driftCandidateArchetype: Archetype | null = null;
  let driftCandidateCount = 0;
  let previousListingId: string | null = null;
  // With the id, so a remount of the same listing re-adapts.
  let previousListingEl: HTMLElement | null = null;
  // Original headline per listing, restored on navigation [FOLLOW-380].
  const originalHeadlineByListing = new Map<string, string>();
  // Original description, for opt-out restore [FOLLOW-1019].
  const originalDescriptionByListing = new Map<string, string>();
  /** Capture originals on first sight; observer order is load-bearing [FOLLOW-380]. */
  function captureOriginalHeadline(listingId: string | undefined): void {
    if (!listingId) return;
    if (!originalHeadlineByListing.has(listingId)) {
      const headlineEl = document.querySelector<HTMLElement>('[data-estalara-slot="headline"]');
      const text = headlineEl?.textContent;
      if (typeof text === 'string') {
        originalHeadlineByListing.set(listingId, text);
      }
    }
    // FOLLOW-1019: same capture point, same idempotence — see the map's declaration.
    if (!originalDescriptionByListing.has(listingId)) {
      const descEl = document.querySelector<HTMLElement>('[data-estalara-slot="description"]');
      const text = descEl?.textContent;
      if (typeof text === 'string') {
        originalDescriptionByListing.set(listingId, text);
      }
    }
  }

  /** Restore tenant copy: teardown first, then reset fingerprints [FOLLOW-1019]. */
  function restoreOriginalSlots(listingId: string | null | undefined): void {
    teardownDescriptionObservers();
    resetAdaptState();
    if (!listingId) return;
    const headline = originalHeadlineByListing.get(listingId);
    if (headline !== undefined) {
      document.querySelectorAll<HTMLElement>('[data-estalara-slot="headline"]').forEach((el) => {
        el.textContent = headline;
      });
    }
    const description = originalDescriptionByListing.get(listingId);
    if (description !== undefined) {
      document.querySelectorAll<HTMLElement>('[data-estalara-slot="description"]').forEach((el) => {
        el.textContent = description;
      });
    }
  }

  // Latest-wins refresh id: the last navigation wins [FOLLOW-380].
  let latestRefreshId = 0;
  // FOLLOW-1026 chat-refresh state, declared here (not beside `runChatRefresh`) because
  // `refreshDirectives()` reads it (FOLLOW-1301) and its first call runs from `start()`.
  let chatRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let chatRefreshAttempt = 0;
  /** FOLLOW-1301 — the chat stamp whose folded hint already has its follow-up call (Rule R). */
  let chatFollowUpStamp: string | null = null;

  /** Re-fetch directives and apply them with the latest intent state. */
  async function refreshDirectives(): Promise<void> {
    if (!config.decisionApiUrl) return;

    // Claim this invocation's id (see `latestRefreshId` note above).
    const myRefreshId = ++latestRefreshId;

    // F-08 (FOLLOW-194): detect pageType from URL / data-page-type attribute.
    // F-13 (FOLLOW-194): read the current listing ID for per-listing RAG context.
    const pageTypeResolution = resolvePageType(ctx.dataset);
    const pageType = pageTypeResolution.pageType;
    const listingId = detectListingId();

    // Observable only when a DOM signal decided [FOLLOW-1138].
    if (pageTypeResolution.provenance === 'dom_signal') {
      queue.push({
        type: 'adapt.page_type_resolved',
        payload: {
          page_type: pageTypeResolution.pageType,
          provenance: pageTypeResolution.provenance,
        },
        ts: Date.now(),
      });
    }

    // Neutral decay re-pins the SoT; not quiz-gated (§D.6, ADR-0014) [FOLLOW-344].
    if (ctx.state.archetype === 'neutral') {
      const sot: ResolvedArchetype | null = readResolvedArchetype(currentSession.sessionId);
      if (sot && sot.archetype !== 'neutral') {
        // Re-pin confidence too, or the server gate drops directives [FOLLOW-380].
        ctx.state = {
          ...ctx.state,
          archetype: sot.archetype as Archetype,
          confidence: sot.confidence,
        };
      }
    }

    const sentHint = ctx.state.archetype;
    const sentAboveGate = ctx.state.confidence > DECISION_CONFIDENCE_GATE;
    const { adaptResponse: resp, updatedIntentState } = await fetchDirectives(
      config,
      currentSession,
      pageType,
      ctx.state,
      listingId,
      ctx.optedOut,
    );

    // Superseded in flight: discard [FOLLOW-380].
    if (myRefreshId !== latestRefreshId) return;

    // Accept the chat fold only after the latest-wins check [FOLLOW-1306].
    if (updatedIntentState !== undefined) {
      const currentIntentState = updatedIntentState;
      ctx.state = currentIntentState;
      onIntentUpdate();
      const mismatch = currentIntentState.chat_mismatch;
      if (mismatch) {
        // Schema field is behavioral_archetype; here the "other" source is chat NLP.
        // confidence_gap is unavailable in this context — 0 keeps the schema valid.
        queue.push({
          type: 'quiz.mismatch',
          payload: {
            quiz_archetype: mismatch.quiz_archetype,
            behavioral_archetype: mismatch.chat_archetype,
            confidence_gap: 0,
            signal_count: currentIntentState.signal_count,
          },
          ts: Date.now(),
        });
      }
      // Fold moved a decision input → one follow-up call per stamp [FOLLOW-1301].
      const stamp = currentIntentState.chatPriorAppliedAt ?? '';
      if (
        (currentIntentState.archetype !== sentHint ||
          currentIntentState.confidence > DECISION_CONFIDENCE_GATE !== sentAboveGate) &&
        stamp !== chatFollowUpStamp &&
        !ctx.optedOut &&
        chatRefreshTimer === null
      ) {
        chatFollowUpStamp = stamp;
        scheduleChatRefresh(true);
      }
    }

    // SoT tracks the latest non-neutral archetype.
    if (ctx.state.archetype !== 'neutral') {
      // FOLLOW-380 bug (c): persist the confidence alongside the archetype so the
      // neutral-decay restore above can re-pin both.
      persistResolvedArchetype(currentSession.sessionId, ctx.state.archetype, ctx.state.confidence);
    }

    if (resp) {
      // FOLLOW-258 F-04: persist for live.signup conversion attribution.
      lastAdaptDecisionId = resp.adapt_decision_id;
      // F-15 (FOLLOW-194): only reset adapt state when the archetype has changed.
      // On an unchanged archetype, preserve existing DOM mutations -- no flicker.
      if (resp.archetype !== previousArchetype) {
        resetAdaptState();
        // Archetype change: drop description observers (ADR-0009) [FOLLOW-802].
        teardownDescriptionObservers();
        previousArchetype = resp.archetype;
        if (resp.archetype !== 'neutral') {
          intent.startDwell();
        } else {
          intent.stopDwell();
        }
      }
      // Annotate curated slots first, regardless of confidence [FOLLOW-340].
      if (resp.slot_selectors) {
        annotateSlots(resp.slot_selectors);
      }

      // Confidence/signal floors; description has its own bar [FOLLOW-343, ESC-054].
      const aboveFloor =
        resp.confidence >= DOM_ADAPT_CONFIDENCE_FLOOR ||
        ctx.state.signal_count >= DOM_ADAPT_MIN_SIGNAL_COUNT;
      const aboveDescriptionFloor =
        resp.confidence >= DOM_ADAPT_CONFIDENCE_FLOOR ||
        ctx.state.signal_count >= DOM_ADAPT_DESCRIPTION_MIN_SIGNAL_COUNT;

      // Description slot waits for the description bar [FOLLOW-948].
      const descriptionSlotDirectives = resp.directives.filter(
        (d) => d.type === 'text' && d.slot === DESCRIPTION_SLOT,
      );
      const nonDescriptionDirectives = resp.directives.filter(
        (d) => !(d.type === 'text' && d.slot === DESCRIPTION_SLOT),
      );

      // Same latest-wins predicate for deferred repairs (Rule AB) [FOLLOW-791].
      const directiveContext = {
        archetypeId: resp.archetype as ArchetypeId,
        confidence: resp.confidence,
        sessionId: currentSession.sessionId,
        isStale: () => myRefreshId !== latestRefreshId,
      };

      if (aboveFloor) {
        applyDirectives(nonDescriptionDirectives, directiveContext);
      }

      if (aboveDescriptionFloor && descriptionSlotDirectives.length > 0) {
        applyDirectives(descriptionSlotDirectives, directiveContext);
      }

      if (aboveDescriptionFloor) {
        // Description adaptation, fire-and-forget, latest-wins [FOLLOW-159, FOLLOW-546].
        void applyDescriptionAdaptation(
          config,
          resp.archetype as ArchetypeId,
          () => myRefreshId !== latestRefreshId,
        );
      }

      if (config.debug) {
        console.log(`[Estalara] Archetype: ${resp.archetype} (${String(resp.confidence)})`);
      }

      // Sidebar widget is admin-only — profiling visibility is in admin.estalara.com.
    }

    // Drift detection after a quiz only [FOLLOW-201].
    if (ctx.state.quiz_answered) {
      const behavioralOnlyState = calculateBehavioralOnlyState(signalHistory);
      const mismatch = detectMismatch(
        ctx.state.archetype,
        behavioralOnlyState,
        currentSession.sessionId,
      );

      if (mismatch) {
        // Behavioral signals consistently suggest a different archetype.
        // Track the candidate for DRIFT_HOLD_COUNT consecutive cycles before acting.
        const candidate = mismatch.behavioral_archetype;
        if (candidate === driftCandidateArchetype) {
          driftCandidateCount += 1;
        } else {
          driftCandidateArchetype = candidate;
          driftCandidateCount = 1;
        }

        if (driftCandidateCount >= DRIFT_HOLD_COUNT) {
          // Sustained drift: override the quiz archetype.
          ctx.state = applyQuizLeaf(ctx.state, candidate);
          onIntentUpdate();
          // Reset candidate state so the cycle can begin again if drift continues.
          driftCandidateArchetype = null;
          driftCandidateCount = 0;
          // Re-fetch directives with the updated intent state.
          await refreshDirectives();
        }
      } else {
        // Signals aligned with quiz archetype — reset candidate count but preserve
        // driftCandidateArchetype so a resuming trend can still accumulate.
        driftCandidateCount = 0;
      }
    }
  }

  async function start(): Promise<void> {
    // Capture the first listing's original [FOLLOW-380].
    captureOriginalHeadline(detectListingId());

    // 4b. Fetch personalization directives from Decision API.
    // FOLLOW-372 / §H.9: skip when opted out — returns to tenant default DOM.
    mark('adapt-start');
    if (config.decisionApiUrl && !ctx.optedOut) {
      await refreshDirectives();
    }

    // Release the host cloak even when nothing adapted [FOLLOW-1027].
    try {
      mark('settled');
      // Boot timings ride on the settled event [FOLLOW-1033].
      const timings = bootTimings();
      if (config.debug) console.log('[Estalara] boot timings (ms)', timings);
      document.dispatchEvent(new CustomEvent('estalara:adapt:settled', { detail: timings }));

      // Boot timings to ClickHouse, once per init, behind consent [FOLLOW-1037, MP-011].
      if (timings.preInit !== undefined && timings.total !== undefined) {
        queue.push({ type: 'boot_timing', payload: timings, ts: Date.now() });
      }
    } catch {
      // never let a signal break init
    }
  }

  function onListingViewed(viewedListingId: string | null): void {
    const rootEl = document.querySelector<HTMLElement>('[data-estalara-listing]');
    // Re-adapt when the listing id changed (in-place navigation) OR the root node itself
    // changed (remount of the same or a different listing via a browse page / back button).
    if (
      viewedListingId &&
      (viewedListingId !== previousListingId || rootEl !== previousListingEl)
    ) {
      previousListingId = viewedListingId;
      previousListingEl = rootEl;
      // Capture this listing's original first [FOLLOW-380].
      captureOriginalHeadline(viewedListingId);
      resetAdaptState();
      // Revert adapted slots before re-adapting the new listing.
      teardownDescriptionObservers();
      // FOLLOW-380 bug (b): restore THIS listing's own captured original, not a global one.
      const originalHeadline = originalHeadlineByListing.get(viewedListingId);
      if (originalHeadline !== undefined) {
        document.querySelectorAll<HTMLElement>('[data-estalara-slot="headline"]').forEach((el) => {
          el.textContent = originalHeadline;
        });
      }
      void refreshDirectives();
    }
  }

  function revert(): void {
    // Invalidate in-flight replies [FOLLOW-1306].
    latestRefreshId++;
    // Opt-out reverts the DOM (§H.9) [FOLLOW-1019].
    restoreOriginalSlots(previousListingId ?? detectListingId());
  }

  /** Debounced chat re-fetch: flush first, retry until the stamp moves [FOLLOW-1026]. */
  function scheduleChatRefresh(followUp = false): void {
    // FOLLOW-1306 (F-24): an async chat handler or a fold still in flight at teardown.
    if (lifetime.signal.aborted) return;
    chatRefreshAttempt = followUp ? CHAT_REFRESH_MAX_ATTEMPTS - 1 : 0;
    if (chatRefreshTimer !== null) clearTimeout(chatRefreshTimer);
    chatRefreshTimer = setTimeout(() => void runChatRefresh(), CHAT_REFRESH_DEBOUNCE_MS);
  }

  async function runChatRefresh(): Promise<void> {
    chatRefreshTimer = null;
    const before = ctx.state.chatPriorAppliedAt;
    const followUpBefore = chatFollowUpStamp;
    try {
      await flush();
      await refreshDirectives();
    } catch {
      // A refresh must never break the host page; the retry below still applies.
    }
    // FOLLOW-1301: a fold during that call scheduled its follow-up, which supersedes a retry.
    if (chatFollowUpStamp !== followUpBefore) return;
    chatRefreshAttempt += 1;
    const moved = ctx.state.chatPriorAppliedAt !== before;
    if (!moved && chatRefreshAttempt < CHAT_REFRESH_MAX_ATTEMPTS) {
      chatRefreshTimer = setTimeout(() => void runChatRefresh(), CHAT_REFRESH_RETRY_MS);
    } else if (config.debug) {
      console.log(
        `[Estalara] chat refresh ${moved ? 'folded new chat evidence' : 'gave up'} after ` +
          `${String(chatRefreshAttempt)} attempt(s)`,
      );
    }
  }

  function listen(): void {
    // Chat bridge on `document`; lead_id only (Rule L) [FOLLOW-197].

    // Chat: estalara:chat:message-sent
    function onChatMessage(e: Event): void {
      void (async (): Promise<void> => {
        const ce = e as CustomEvent<Record<string, unknown>>;
        if (ce.detail.is_agent === true) return;

        // Derive lead_id from user_uuid if present; fall back to stored lead_id.
        // Rule L: user_uuid is NEVER stored — only the derived hash prefix.
        let leadId: string | undefined;
        if (typeof ce.detail.user_uuid === 'string' && ce.detail.user_uuid.length > 0) {
          leadId = await deriveLeadId(ce.detail.user_uuid);
          try {
            sessionStorage.setItem(LEAD_ID_STORAGE_KEY, leadId);
          } catch {
            // sessionStorage unavailable — lead_id is used in-memory only for this event
          }
        } else {
          try {
            leadId = sessionStorage.getItem(LEAD_ID_STORAGE_KEY) ?? undefined;
          } catch {
            // sessionStorage unavailable
          }
        }

        // F-01 (FOLLOW-258): message field is required by ChatMessageSentPayloadSchema.
        // F-29 (FOLLOW-258): scrub PII (email/phone) before storing in ClickHouse.
        const rawMessage = typeof ce.detail.message === 'string' ? ce.detail.message : '';
        if (rawMessage.length === 0) return;
        // K.3.6 FOLLOW-266: count buyer chat turns for intent.snapshot payload.
        intent.snapshot.chatTurns += 1;
        // Opt-out flag rides along; event still reaches ingest (§H.8) [FOLLOW-387].
        queue.push({
          type: 'chat.message.sent',
          payload: {
            message: scrubMessagePii(rawMessage),
            char_count: typeof ce.detail.char_count === 'number' ? ce.detail.char_count : undefined,
            lead_id: leadId,
            profiling_opt_out: ctx.optedOut || undefined,
          },
          ts: Date.now(),
        });

        // FOLLOW-1026: give the evidence a way to arrive. §H.9 — an opted-out session queues
        // the ingest event (§H.8 invariant, above) but must NOT be re-profiled, so no refresh.
        if (!ctx.optedOut) scheduleChatRefresh();
      })();
    }
    // Registered directly (not through `ctx.on()`): the follow-819 chat arm reads this exact call
    // to learn the event name it must dispatch. Same lifetime signal as every `ctx.on()` listener.
    document.addEventListener('estalara:chat:message-sent', onChatMessage, {
      signal: lifetime.signal,
    });

    // Live signup: live.signup (dot-separated). This listener queues the ingest event and
    // stores lead_id. (The bandit feedback ping was removed by FOLLOW-1286, D3.)
    ctx.on(document, 'live.signup', (e: Event) => {
      void (async (): Promise<void> => {
        const ce = e as CustomEvent<Record<string, unknown>>;
        if (ce.detail.is_agent === true) return;

        // Derive lead_id from user_uuid if present; fall back to stored lead_id.
        // Rule L: user_uuid is NEVER stored — only the derived hash prefix.
        let leadId: string | undefined;
        if (typeof ce.detail.user_uuid === 'string' && ce.detail.user_uuid.length > 0) {
          leadId = await deriveLeadId(ce.detail.user_uuid);
          try {
            sessionStorage.setItem(LEAD_ID_STORAGE_KEY, leadId);
          } catch {
            // sessionStorage unavailable
          }
        } else {
          try {
            leadId = sessionStorage.getItem(LEAD_ID_STORAGE_KEY) ?? undefined;
          } catch {
            // sessionStorage unavailable
          }
        }

        // This listener queues the ingest telemetry event only.
        // FOLLOW-258 F-04: thread adapt_decision_id for conversion attribution when slot_uuid absent.
        queue.push({
          type: 'live.signup',
          payload: {
            slot_uuid: typeof ce.detail.slot_uuid === 'string' ? ce.detail.slot_uuid : undefined,
            lead_id: leadId,
            source_surface:
              typeof ce.detail.source_surface === 'string' ? ce.detail.source_surface : undefined,
            adapt_decision_id: lastAdaptDecisionId,
          },
          ts: Date.now(),
        });
      })();
    });

    // inquiry.completed to ingest for conversion lift [FOLLOW-569].
    ctx.on(document, 'inquiry.completed', (e: Event) => {
      // detail may be absent (plain Event) — cast to a nullable shape so the guards are honest.
      const detail = (e as CustomEvent).detail as Record<string, unknown> | null;
      if (detail?.is_agent === true) return;

      const payload: Record<string, unknown> = {};
      if (typeof detail?.has_phone === 'boolean') payload.has_phone = detail.has_phone;
      if (
        typeof detail?.message_length === 'number' &&
        Number.isInteger(detail.message_length) &&
        detail.message_length >= 0
      ) {
        payload.message_length = detail.message_length;
      }
      if (
        typeof detail?.channel === 'string' &&
        ['email', 'phone', 'whatsapp', 'sms', 'in_person'].includes(detail.channel)
      ) {
        payload.channel = detail.channel;
      }
      if (
        typeof detail?.timeline === 'string' &&
        ['0-3m', '3-6m', '6-12m', '12m+'].includes(detail.timeline)
      ) {
        payload.timeline = detail.timeline;
      }
      if (typeof detail?.budget_hint === 'string') payload.budget_hint = detail.budget_hint;

      queue.push({ type: 'inquiry.completed', payload, ts: Date.now() });
    });
  }

  return {
    refresh: refreshDirectives,
    start,
    onListingViewed,
    revert,
    listen,
    stop: () => {
      // FOLLOW-1026: a pending chat refresh would otherwise fire against a torn-down session.
      if (chatRefreshTimer !== null) clearTimeout(chatRefreshTimer);
      // FOLLOW-1306 (F-24): invalidate the current generation so a reply still in flight
      // cannot apply to a torn-down page.
      latestRefreshId++;
    },
  };
}
