/**
 * Adapt loop (FOLLOW-1296): everything in `init()` that turns the live intent state into DOM
 * adaptation — `refreshDirectives()` with its latest-wins guard, the chat prior fold and its
 * follow-up draw (FOLLOW-1301/1306), the cross-listing slot revert, the first decision cycle and
 * its `estalara:adapt:settled` signal, the chat → refresh bridge and the conversion listeners.
 *
 * State is per-instance: the shared fields live on the {@link BootContext}, the rest in this
 * factory's closure (RETRO-006 LG-2).
 *
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

/**
 * Number of consecutive refreshDirectives() cycles a drift archetype must be confirmed
 * before overriding the quiz-assigned session state (FOLLOW-201 / Master_Design §E.4.5).
 * Anti-thrash guard: 3 cycles prevents transient behavioral noise from flipping the archetype.
 */
export const DRIFT_HOLD_COUNT = 3;

/**
 * Chat-triggered directive refresh (FOLLOW-1026).
 *
 * FOLLOW-1024 made every buyer message ELIGIBLE to move the archetype. It did not give the
 * evidence a way to arrive: the chat prior rides on an `/api/adapt` RESPONSE, and a buyer who
 * stays on one listing and talks never triggers another adapt call. Measured on the local
 * stack — a full session with two chat questions produced exactly TWO adapt calls, both before
 * the chat, so the archetype could not move however many questions were asked.
 *
 * The debounce collapses a burst of typing into one cycle. The retries exist because the
 * evidence is not ready when the message is sent: it has to reach ingest, then the NLP
 * extraction (a live model call), then the shadow key, before an adapt response can carry it.
 * Refreshing once would reliably read the PREVIOUS stamp and burn the call for nothing.
 *
 * Bounded on purpose — at most `CHAT_REFRESH_MAX_ATTEMPTS` extra adapt calls per burst,
 * stopping the moment the watermark advances. A message that yields no usable dimension (a
 * greeting) never advances it, so it costs the full budget; that is the price of not polling
 * indefinitely, and it is why the budget is small.
 */
const CHAT_REFRESH_DEBOUNCE_MS = 2_500;
/** Gap between retries when the watermark has not advanced yet. */
const CHAT_REFRESH_RETRY_MS = 6_000;
/** Total adapt calls one chat burst may trigger. */
const CHAT_REFRESH_MAX_ATTEMPTS = 3;

/** Resolved page type literal, shared by {@link resolvePageType} and {@link detectPageType}. */
export type PageType = 'listing_list' | 'listing_detail' | 'home' | 'search';

/**
 * Which detection branch produced a {@link PageTypeResolution} (FOLLOW-1138 observability):
 * `attribute` (explicit `data-page-type`), `url` (`/listing/` in the pathname), `dom_signal`
 * (widened heuristic -- exactly one `[data-estalara-listing-id]` element on the page, see
 * {@link resolvePageType}), or `default`.
 */
type PageTypeProvenance = 'attribute' | 'url' | 'dom_signal' | 'default';

/** Page type plus which branch produced it -- {@link resolvePageType}'s return shape. Kept to
 * two fields deliberately: this sits inside the 42KB-gzip-gated IIFE bundle
 * (`scripts/check-bundle-size.js`, ESC-028). */
interface PageTypeResolution {
  pageType: PageType;
  provenance: PageTypeProvenance;
}

/**
 * Resolve the page type from the current URL, an optional data-page-type attribute, and a DOM
 * detail-page signal, with provenance for observability (FOLLOW-1138).
 *
 * Detection order:
 *   1. `data-page-type` attribute on the <script> tag -- explicit override; takes precedence.
 *   2. URL pathname contains '/listing/' -> 'listing_detail'.
 *   3. Exactly one `[data-estalara-listing-id]` element on the page -> 'listing_detail'
 *      (FOLLOW-1138 widened heuristic -- a tenant whose detail-page URLs don't contain
 *      '/listing/' and who never sets `data-page-type` was silently losing headline
 *      adaptation; `detectListingId()` already reads this attribute elsewhere in this module
 *      but the page-type heuristic never consulted it). "Exactly one" -- not "any" -- because a
 *      real listing GRID page renders ONE such element PER CARD (the same attribute
 *      `tenant-schema.ts`'s default `item_selector` targets), so "any" would misfire on a grid.
 *   4. Default -> 'listing_list'.
 *
 * Module-local, together with {@link PageTypeResolution}/{@link PageTypeProvenance}: nothing
 * outside this file consumes them, and exporting a symbol whose only importer is a test is a
 * Rule I (wired-or-dead) violation. {@link detectPageType} is the exported surface.
 *
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
 * Detect the page type from the current URL and an optional data-page-type attribute.
 *
 * Thin wrapper over {@link resolvePageType} kept for callers that only need the literal (unit
 * tests) -- see that function's doc for detection order and FOLLOW-1138 context.
 *
 * @param scriptDataset - The dataset of the Estalara <script> tag (may include pageType).
 * @returns The resolved page type literal.
 */
export function detectPageType(scriptDataset: DOMStringMap): PageType {
  return resolvePageType(scriptDataset).pageType;
}

/**
 * Read the current listing ID from the page DOM.
 *
 * Looks for `[data-estalara-listing-id]` in the document. Returns the first
 * non-empty value found, or undefined if no such attribute exists.
 *
 * Used by F-13 (FOLLOW-194) to wire per-listing RAG context into the adapt request.
 *
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

  // F-15 (FOLLOW-194): track the last archetype returned by the Decision API.
  // resetAdaptState() is called ONLY when the archetype changes, preventing the
  // text-flicker that occurred every ~30s when resetAdaptState() was called
  // unconditionally on every refreshDirectives() cycle.
  let previousArchetype: string | null = null;
  // FOLLOW-258 F-04: store the most recent adapt_decision_id for live.signup attribution.
  let lastAdaptDecisionId: string | undefined;

  // FOLLOW-201: per-session drift detection state (per-instance — RETRO-006 LG-2).
  // Tracks consecutive refreshDirectives() cycles where detectMismatch() fires for
  // the same suggested archetype. Only overrides quiz state when driftCandidateCount
  // reaches DRIFT_HOLD_COUNT (anti-thrash guard per Master_Design §E.4.5).
  let driftCandidateArchetype: Archetype | null = null;
  let driftCandidateCount = 0;
  let previousListingId: string | null = null;
  // The listing-root node we last adapted. Tracked alongside the id so a remount of the SAME
  // listing (navigate listing → browse → same listing back) — a NEW node carrying the same id —
  // is still detected as a fresh listing that needs re-adaptation.
  let previousListingEl: HTMLElement | null = null;
  // FOLLOW-380 bug (b) / RETRO-105 LG-2: captured original (pre-adaptation) headline text,
  // keyed PER LISTING. Real listings have DIFFERENT titles, so a single global capture would
  // stamp listing-1's title onto listing-2 on cross-listing navigation. Each listing's
  // original is captured the first time that listing id is seen (before any adaptation
  // touches its headline) and restored on cross-listing navigation so a listing the archetype
  // does not fit (neutral / archetype-fit gate) shows ITS OWN original copy — never the
  // previous listing's adapted (or original) headline.
  const originalHeadlineByListing = new Map<string, string>();
  // FOLLOW-1019: the description's original copy, captured on the same schedule and for the
  // same reason. Cross-listing navigation never needed it (the framework re-renders the new
  // listing's own description, and `teardownDescriptionObservers()` lets that text stand), but
  // an in-session opt-out has no re-render to lean on — without a captured original there is
  // nothing to put back, and the visitor keeps reading profiled copy.
  const originalDescriptionByListing = new Map<string, string>();
  /**
   * Capture the current headline- and description-slot text for `listingId` the FIRST time it
   * is seen.
   *
   * Ordering note (bug (b)): the `listing.viewed` handler runs synchronously inside the
   * `navMutObs` MutationObserver callback, which was created at init — BEFORE the per-listing
   * headline loop-guard observers (created during adaptation). MutationObserver callbacks fire
   * in creation order, so at capture time the framework's freshly-rendered per-listing title
   * is still present (the stale loop-guard has not yet re-asserted the previous listing's
   * adapted copy), and `teardownDescriptionObservers()` in the handler then disconnects that
   * loop-guard before it can clobber. Idempotent per listing (skips if already captured), so
   * a later view of the same listing never overwrites its true pre-adaptation original.
   */
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

  /**
   * Put the tenant's own copy back on every adapted slot for `listingId` (FOLLOW-1019).
   *
   * Ordering mirrors the cross-listing restore below: observers are torn down FIRST, because
   * both the description loop-guard and the generic headline watchdog treat an external write
   * as a revert to fight — restoring before teardown would have them re-assert the adapted
   * copy within a frame. `resetAdaptState()` clears the applied-fingerprints so that opting
   * back IN re-applies the same (slot, archetype) pair instead of short-circuiting on a
   * fingerprint recorded before the revert.
   */
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

  // FOLLOW-380 bug (a) / RETRO-105 LG-1: monotonic in-flight guard for overlapping
  // `refreshDirectives()` calls. Rapid SPA navigation fires `void refreshDirectives()`
  // fire-and-forget (`onListingViewed` below) with no lock or AbortController, so two
  // invocations can interleave on the shared mutable `ctx.state` / SoT. Each invocation claims
  // the next id; after its async fetch resolves it commits state ONLY if it is still the
  // latest — so a stale in-flight call whose fetch arrives after a newer navigation started can
  // never clobber the newer navigation's state/DOM. The LAST navigation always wins.
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

    // FOLLOW-1138: make the widened heuristic's use observable -- fires only when neither an
    // explicit data-page-type attribute nor the /listing/ URL convention decided the page
    // type, i.e. a DOM signal did. Not on every cycle -- that would just be noise on every
    // ordinary grid-page load, and this sits inside the 42KB-gzip-gated IIFE bundle.
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

    // Source-of-truth archetype restore (§D.6 / FOLLOW-344; CEO 2026-06-22): routine
    // behavioral signals (rapid listing views via applyListingViewRate, scroll, dwell) push
    // probability mass toward `neutral` and can decay the live archetype to `neutral`
    // mid-session, which would silently stop cross-listing adaptation. When that happens,
    // re-pin the archetype to the persisted SoT (seeded by the quiz, later updated by chat /
    // sustained behavioral evidence) so every subsequent listing keeps adapting. A genuine
    // *non-neutral* switch (e.g. chat reveals investor intent → yield_hunter) is left
    // untouched — drift away from the declared archetype is legitimate, but ONLY toward
    // another non-neutral archetype, never to `neutral`. Works with OR without the quiz.
    //
    // FOLLOW-380 doc gap (RETRO-105 CB-1) — quiz vs quiz-disabled stickiness asymmetry:
    // For a QUIZ tenant there are TWO layers of anti-neutral-decay protection: (1) intent.ts
    // hysteresis (`classifyFromProbabilities`, gated in part on `state.quiz_answered`,
    // intent.ts:~747-779) PREVENTS `neutral` from overtaking the argmax mid-classify, and
    // (2) this restore-after-decay. For a QUIZ-DISABLED tenant there is no quiz answer, so
    // layer (1) does not engage — the archetype can freely decay all the way to `neutral`
    // and the ONLY protection is THIS restore. Net: quiz-disabled tenants get a weaker
    // guarantee (decay-then-restore) than quiz tenants (prevent-decay + restore). This is
    // acceptable per the CEO cross-listing SoT ruling (quiz-disabled stays functional) — the
    // restore below is deliberately NOT gated on `quiz_answered` so it works for both.
    if (ctx.state.archetype === 'neutral') {
      const sot: ResolvedArchetype | null = readResolvedArchetype(currentSession.sessionId);
      if (sot && sot.archetype !== 'neutral') {
        // FOLLOW-380 bug (c) / RETRO-105 LG-3: re-pin the archetype AND the confidence it
        // was resolved at. `body.confidence = currentIntentState.confidence` (adapt.ts:762)
        // is sent to the Decision API, which BOTH gates directives server-side
        // (`confidence <= 0.6 → no directives`, route.ts) AND echoes the value into
        // `resp.confidence` — the value the FOLLOW-343 DOM floor checks (below). If we
        // pinned only the archetype and left the neutral-era low confidence in place, the
        // server would return no directives and the floor would suppress the restored
        // adaptation, silently defeating the restore. Pinning `sot.confidence` keeps
        // cross-listing re-adaptation working.
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

    // FOLLOW-380 bug (a): a newer navigation superseded this call while the fetch was in
    // flight — discard this stale result so it cannot clobber the newer navigation's state
    // or re-apply stale directives/description onto the newer listing's DOM.
    if (myRefreshId !== latestRefreshId) return;

    // FOLLOW-101: if the chat-intent prior was applied, update the live intent state.
    // FOLLOW-1306 (F-25): the fold is accepted only here, after
    // the latest-wins check above — `onIntentUpdate` persists it and the mismatch event is
    // queued here, so a discarded stale reply leaves neither storage nor telemetry behind.
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
      // FOLLOW-1301: the fold lands on THIS response, but the folded state only reaches the
      // server on the NEXT call — and a buyer who just chats makes none. So when the fold
      // changed a decision input, draw that call once, through the chat-refresh path.
      // FOLLOW-1306 (F-04): "changed a decision input" is the hint OR the confidence crossing
      // the server's directive gate. Hint-only missed a second message that lifted the SAME
      // archetype from 0.37 to 0.66 — the server never saw it. A confidence move that stays
      // on one side of the gate (0.37 -> 0.48) changes nothing the server serves: no call.
      // Once per stamp (Rule R); a call whose stamp is already folded folds nothing and so
      // schedules nothing (no loop); a pending chat refresh already carries the new state.
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

    // Update the session source-of-truth archetype to the latest non-neutral resolution
    // (post chat-intent prior). This is how chat / sustained behavioral evidence overrides
    // the quiz answer when the buyer's true need becomes evident: the SoT always tracks the
    // most recent non-neutral archetype, and the neutral-decay restore above pins to it.
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
        // FOLLOW-802 AC2 (option 2 of the two the ticket offered — see the PR for why this
        // one). `resetAdaptState()` releases headline ownership only for elements still in
        // `_textResilienceMap`, but a hand-off to the description module DELETES the element
        // from that map, so ownership would survive an archetype change and make the generic
        // pipeline skip the headline forever.
        //
        // Tearing the description observers down here is right on the merits, not merely a
        // means to release ownership: the applied description/headline is generated PER
        // ARCHETYPE (ADR-0009), so on an archetype change the old copy is stale content, and
        // leaving its observer armed makes it defend that stale copy against the new
        // archetype's directives. `applyDescriptionAdaptation` is re-invoked with the new
        // archetype a few lines below and re-arms. This mirrors what the cross-listing path
        // already does.
        teardownDescriptionObservers();
        previousArchetype = resp.archetype;
        if (resp.archetype !== 'neutral') {
          intent.startDwell();
        } else {
          intent.stopDwell();
        }
      }
      // FOLLOW-340: Self-annotate DOM nodes from curated slot_selectors BEFORE
      // applyDirectives() so pages without hand-coded data-estalara-slot attributes
      // (incl. app.estalara.com no-code) can receive directive mutations.
      // Runs unconditionally (outside the aboveFloor gate) so annotation is done
      // once regardless of confidence — directives themselves are still gated below.
      // annotateSlots is idempotent and never throws onto the host page.
      if (resp.slot_selectors) {
        annotateSlots(resp.slot_selectors);
      }

      // FOLLOW-343: gate DOM mutation (text, class, reorder, description) behind a
      // confidence/signal floor.  At cold start the Bayesian prior is ~0.37; a single
      // device or referrer hint can tip argmax above neutral at ~0.05–0.10 confidence
      // and reshuffle the page.  We hold off until we have either:
      //   (a) confidence ≥ DOM_ADAPT_CONFIDENCE_FLOOR (0.5), or
      //   (b) signal_count ≥ a per-axis minimum — sufficient behavioral evidence.
      // Quiz leaf resolves at 0.85 → always above the floor (no regression, AC-3).
      //
      // FOLLOW-913 / ESC-054 (CEO ruled 2026-08-08): the directive axis and the
      // description axis are now TWO SEPARATE disjunctions with two separate `if`
      // blocks, not one shared `aboveFloor` gating both. Before this ruling both axes
      // shared DOM_ADAPT_MIN_SIGNAL_COUNT (2), so a single real behavioral event
      // (device_type prior at init + one scroll-depth milestone) opened LLM-generated
      // long-form description copy at any confidence. The ruling kept the disjunction
      // shape but raised the description axis's signal-count arm to
      // DOM_ADAPT_DESCRIPTION_MIN_SIGNAL_COUNT (5); the directive axis is unchanged.
      const aboveFloor =
        resp.confidence >= DOM_ADAPT_CONFIDENCE_FLOOR ||
        ctx.state.signal_count >= DOM_ADAPT_MIN_SIGNAL_COUNT;
      const aboveDescriptionFloor =
        resp.confidence >= DOM_ADAPT_CONFIDENCE_FLOOR ||
        ctx.state.signal_count >= DOM_ADAPT_DESCRIPTION_MIN_SIGNAL_COUNT;

      // FOLLOW-948: the ESC-054 ruling raised the bar on the DESCRIPTION COPY, not on the
      // `/adapt/description` fetch mechanism. `aboveDescriptionFloor` gated only the fetch,
      // while `TextDirective.slot` is an open string and `SlotSelectors.description` is a
      // curated slot that `annotateSlots()` marks unconditionally above — so a `text`
      // directive naming `description` would rewrite the very copy the ruling protects, at
      // the DIRECTIVE bar (2 signals) instead of the description bar (5).
      //
      // Split by SLOT, not by directive type, so both axes keep their own bar:
      // `aboveDescriptionFloor` strictly implies `aboveFloor` (identical confidence arm,
      // 5 >= 2 on the signal arm), so this can only ever withhold the description slot
      // longer — never apply anything the previous code would not have applied.
      //
      // This is a bar, not a ban: the ruling raised the threshold for description copy, it
      // did not remove the capability, so excluding the slot outright would over-correct.
      const descriptionSlotDirectives = resp.directives.filter(
        (d) => d.type === 'text' && d.slot === DESCRIPTION_SLOT,
      );
      const nonDescriptionDirectives = resp.directives.filter(
        (d) => !(d.type === 'text' && d.slot === DESCRIPTION_SLOT),
      );

      // FOLLOW-791 / Rule AB: propagate the same latest-wins staleness predicate used
      // by applyDescriptionAdaptation below into the generic directive pipeline's
      // MutationObserver-backed resilience mechanism, so a rapid cross-listing nav that
      // supersedes this adaptation cannot repaint a stale archetype's directive onto the
      // newer listing via a deferred repair.
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
        // Fetch + apply long-form description adaptation (FOLLOW-159).
        // Fire-and-forget — description errors are observable via adapt.description.error events;
        // a failure here must never block the directive/headline path or sidebar update.
        // FOLLOW-546 / RETRO-169: the latestRefreshId checkpoint above ran synchronously
        // and cannot catch a supersession that lands while applyDescriptionAdaptation awaits its
        // own fetchDescription. Propagate the same latest-wins predicate so the description tail
        // bails before mutating any slot on the newer listing when a rapid nav supersedes us.
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

    // FOLLOW-201: Post-directive drift detection.
    // Only runs when the quiz has been answered — no quiz means no quiz-vs-behavioral
    // discrepancy to detect. AC5: description_cache_persistent is NOT modified here;
    // applyQuizLeaf() is session-only (no DB write).
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
          // Anti-thrash guard satisfied: override quiz archetype with behavioral evidence.
          // applyQuizLeaf() sets high confidence (0.85) for the drift archetype — same
          // mechanism as quiz leaf but triggered by sustained behavioral mismatch.
          // `candidate` is the confirmed drift archetype (Archetype, never null).
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
    // FOLLOW-380 bug (b): capture the FIRST listing's original headline text BEFORE the first
    // adaptation (refreshDirectives below), keyed by its listing id, so cross-listing
    // navigation can restore each listing's OWN original on a non-fitting (neutral) listing.
    captureOriginalHeadline(detectListingId());

    // 4b. Fetch personalization directives from Decision API.
    // FOLLOW-372 / §H.9: skip when opted out — returns to tenant default DOM.
    mark('adapt-start');
    if (config.decisionApiUrl && !ctx.optedOut) {
      await refreshDirectives();
    }

    // FOLLOW-1027: tell the host page's anti-flicker cloak it may reveal the slots. Dispatched
    // unconditionally once the first decision cycle has settled — including when nothing was
    // adapted, because a page that will never change must not stay masked for the full
    // fail-safe timeout. The host snippet also has its own timeout; this is the fast path.
    try {
      mark('settled');
      // FOLLOW-1033: carry the boot decomposition on the event the cloak already listens for,
      // so measuring costs a listener rather than a debug build. Consumers that only want the
      // reveal signal ignore `detail` and are unaffected.
      const timings = bootTimings();
      if (config.debug) console.log('[Estalara] boot timings (ms)', timings);
      document.dispatchEvent(new CustomEvent('estalara:adapt:settled', { detail: timings }));

      // FOLLOW-1037 / MP-011: land the SAME decomposition in ClickHouse through the existing
      // ingest event queue/dispatch path (no new transport) — the console/CustomEvent route
      // above is the only place these numbers went before this ticket. Shape matches
      // BootTimingPayloadSchema (packages/shared/src/schemas/events/boot-timing.ts): preInit
      // and total required, the rest best-effort spans. Guarded on both because
      // `bootTimings()` only omits `total` in the same failure mode it omits `preInit`
      // (Performance API unavailable) — never send a payload the ingest schema will reject.
      // Operational latency telemetry, not profiling (§H.9) — it rides the SAME consent gate
      // as every other queued event because this code only runs past the consent gate in
      // boot() (denied/pending-declined sessions return from init() before reaching this
      // line); no separate opt-out check is needed, mirroring collectPageView()'s push.
      // Exactly one `boot_timing` push per init() call — mark('settled') has a single call
      // site — so no additional per-session/per-tenant guard is needed (YAGNI, no kill
      // switch: at most one event per page load is a structural property of this call site,
      // not a runtime flag to maintain).
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
      // FOLLOW-380 bug (b): capture THIS listing's own original headline (before teardown
      // and before refreshDirectives adapts it) so the restore below uses the correct
      // per-listing title. See captureOriginalHeadline's ordering note.
      captureOriginalHeadline(viewedListingId);
      resetAdaptState();
      // Revert adapted slots to their original copy before re-adapting, so a listing the
      // archetype does NOT fit (the decision API returns neutral / no directive) shows the
      // tenant's original text — not the previous listing's adapted copy left on the reused
      // DOM node. Description: disconnect the per-slot observers FIRST so the framework's
      // freshly-rendered per-listing text stands. Headline: restore the captured placeholder
      // AFTER teardown — the headline loop-guard observer would otherwise treat the restore
      // as a revert and re-assert the previous listing's adapted copy. refreshDirectives()
      // re-applies + re-observes if the new listing IS a fit.
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
    // FOLLOW-1306 (F-12): invalidate the current generation. A personalised reply still in
    // flight (or a deferred description/directive repair holding its `isStale` predicate)
    // would otherwise repaint profiled copy over the revert below.
    latestRefreshId++;
    // FOLLOW-1019: opting OUT actively reverts the DOM. The previous note here claimed
    // "the tenant-default DOM is already visible", which is only true before the first
    // adaptation — mid-session it is the ADAPTED copy on screen, and merely suppressing
    // future directives left a visitor who had just declined profiling still reading
    // profiled copy until a full reload. §H.9's "reversible suspend" is what this does:
    // it suspends the adaptation AND puts the tenant's own copy back, and opting in again
    // re-adapts (the opt-out toggle's other branch).
    restoreOriginalSlots(previousListingId ?? detectListingId());
  }

  /**
   * Debounced, bounded re-fetch of directives after the buyer says something.
   *
   * Flushes first: the event queue is on a 5s timer, so without this the message would still
   * be sitting in the browser when the refresh fires, and the adapt response could not
   * possibly carry it.
   *
   * Retries only while `chatPriorAppliedAt` has NOT moved — the watermark advancing is proof
   * the evidence arrived and was folded, and is the signal to stop.
   *
   * FOLLOW-1301: `followUp` is the one call that carries a just-folded hint to the server. It
   * gets no retries (its attempt counter starts at the last slot): it waits for no evidence.
   */
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
    // FOLLOW-197 / CHAT-003: Chat signal bridge.
    // Listens for chat and live-signup CustomEvents dispatched by Estalara-app on `document`.
    // Using document (not window) per RETRO-033 — Estalara-app dispatches on document.
    //
    // Rule L: raw user_uuid is NEVER stored — only the SHA-256-derived lead_id is stored.
    // Agent activity (is_agent === true) is silently filtered — investor signals only.

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
        // §H.9/FOLLOW-387: attach the per-session opt-out flag so the ingest chat-NLP
        // dispatch can forward it to process_chat_message and skip the AL shadow-prior write.
        // §H.8 invariant: the event STILL flows to ingest regardless of the flag.
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

    // F-01 (audit 2026-07-12, FOLLOW-569): inquiry.completed ingest listener.
    // Mirrors the live.signup listener above. Before FOLLOW-1286 the SDK sent only a bandit
    // feedback ping on inquiry.completed, and nothing ever queued it for INGEST — so the
    // cta-lift conversion-analytics leg that JOINs on inquiry.completed was permanently empty for
    // holdout AND variant sessions alike (audit finding F-01). This queues the ingest telemetry
    // event for every session so conversion lift can actually be measured. Payload is limited to
    // InquiryCompletedPayloadSchema (no PII); session/variant attribution rides the event
    // envelope's session_id, not the payload.
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
