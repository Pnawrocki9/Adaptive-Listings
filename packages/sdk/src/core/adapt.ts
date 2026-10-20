/**
 * Adaptation client: fetches and applies directives; never throws.
 * @module @estalara/sdk/core/adapt
 */

import type { SessionState } from './session.js';
import { getConsentState } from './session.js';
import type { SdkConfig } from './config.js';
import type {
  TextDirective,
  ClassDirective,
  ReorderDirective,
  ArchetypeId,
  QuizLanguage,
  QuizRunPing,
} from '@estalara/shared';
import type { CollectedEvent } from './events.js';
import { mapConsentState } from './events.js';
import { SDK_VERSION } from './version.js';
import type { IntentState } from './intent.js';
import { applyChatIntentPrior } from './intent.js';
import { adaptResponseSchema } from './adapt-schema.js';
import { buildEndpoint } from './endpoint.js';
import { getHeadlineOwner, setHeadlineOwner, clearHeadlineOwner } from './headline-ownership.js';

// ── Signed-ping helper (quiz completion; bandit ping removed by FOLLOW-1286) ──

/**
 * HMAC-SHA256 hex, or null without SubtleCrypto.
 * @internal
 */
async function computeHmacSha256Hex(secret: string, message: string): Promise<string | null> {
  try {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', keyMaterial, enc.encode(message));
    return Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}

// ── Quiz completion ping ──

/**
 * decisionApiUrl already ends in `/api` [FOLLOW-305].
 * @internal
 */
function deriveQuizCompletionUrl(config: SdkConfig): string | null {
  if (!config.decisionApiUrl) return null;
  return buildEndpoint(config.decisionApiUrl, '/quiz/completion');
}

/**
 * The buyer's root→leaf quiz walk, ids paired with answers (ADR-0019) [FOLLOW-1020]. A trait
 * (`multi`) step's entry is the list of ticked indexes, `[]` for "None of these" [FOLLOW-1357].
 */
export interface QuizAnswerPath {
  question_ids: string[];
  answer_indexes: (number | number[])[];
}

/** One walk step on the wire: `answer_index` (single) or `answer_indexes` (trait screen). */
type QuizAnswerStep =
  | { question_id: string; answer_index: number }
  | { question_id: string; answer_indexes: number[] };

/**
 * The walk as wire steps (`QuizRunPingSchema` `answer_path`, FOLLOW-1358): a single-choice step
 * keeps the `quiz_completions` shape `{ question_id, answer_index }`, a trait step is
 * `{ question_id, answer_indexes }` [FOLLOW-1357].
 * @internal
 */
export function quizAnswerSteps(path: QuizAnswerPath): QuizAnswerStep[] {
  return path.question_ids.flatMap((question_id, i): QuizAnswerStep[] => {
    const a = path.answer_indexes[i];
    if (a === undefined) return [];
    return [
      typeof a === 'number' ? { question_id, answer_index: a } : { question_id, answer_indexes: a },
    ];
  });
}

/**
 * Quiz walk → completion-row fields [FOLLOW-1020].
 * `quiz_completions` is unchanged by Faza Q (ESC-086 item 4) and its route takes a NUMBER per
 * step, so a trait step is left out here — `quiz_runs` records it [FOLLOW-1357].
 * @param path - The root→leaf walk from the quiz widget.
 * @returns The subset of completion-row fields the path determines.
 * @internal
 */
function quizPathFields(path: QuizAnswerPath): Record<string, unknown> {
  const pairs = quizAnswerSteps(path).filter((p) => 'answer_index' in p);
  const [q1, q2, q3] = pairs.map((p) => ('answer_index' in p ? p.answer_index : undefined));
  return {
    branch: path.question_ids[1] ?? null,
    ...(q1 !== undefined ? { q1_answer: q1 } : {}),
    q2_answer: q2 ?? null,
    q3_answer: q3 ?? null,
    answer_path: pairs,
  };
}

/**
 * POST /api/quiz/completion, HMAC-signed, fire-and-forget, never throws [FOLLOW-051].
 * @param config            - SDK configuration (needs apiKey + decisionApiUrl).
 * @param sessionId         - Current session identifier.
 * @param resolvedArchetype - Quiz leaf archetype (or 'neutral').
 * @param language          - Quiz locale (`QuizLanguage` from `@estalara/shared`).
 * @param profilingOptedOut - When true, appends `?profiling_opt_out=1` (§H.9).
 * @param answerPath        - The root→leaf walk (FOLLOW-1020); omitted when there is none.
 */
export function postQuizCompletionPing(
  config: SdkConfig,
  sessionId: string,
  resolvedArchetype: string,
  language: QuizLanguage,
  profilingOptedOut?: boolean,
  answerPath?: QuizAnswerPath,
): void {
  const baseUrl = deriveQuizCompletionUrl(config);
  if (!baseUrl) return;

  // §H.9 defence-in-depth behind the quiz-trigger guard [FOLLOW-389].
  const completionUrl = profilingOptedOut ? `${baseUrl}?profiling_opt_out=1` : baseUrl;

  const body = JSON.stringify({
    session_id: sessionId,
    resolved_archetype: resolvedArchetype,
    language,
    // Omitted without a path, so "not reported" stays distinct [FOLLOW-1020].
    ...(answerPath !== undefined ? quizPathFields(answerPath) : {}),
  });

  computeHmacSha256Hex(config.apiKey, body)
    .then((signatureHex) => {
      if (signatureHex === null) {
        console.warn('[estalara] quiz completion ping skipped: SubtleCrypto unavailable');
        return;
      }
      return fetch(completionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
          'X-Estalara-Signature': signatureHex,
        },
        body,
      });
    })
    .catch((err: unknown) => {
      console.warn(
        '[estalara] quiz completion ping failed:',
        err instanceof Error ? err.message : String(err),
      );
    });
}

// ── Quiz run ping (FOLLOW-1357) ──

/** A run transition as the quiz widget reports it; `postQuizRunPing` adds the identity fields. */
export type QuizRunPingFields = Omit<
  QuizRunPing,
  'tenant_id' | 'session_id' | 'sdk_version' | 'consent_state'
>;

/**
 * POST /api/quiz/run — one quiz-run transition (ESC-086 item 2), HMAC-signed like the
 * completion ping; the body is `QuizRunPingSchema` (FOLLOW-1358 parses it). Adds `tenant_id`
 * (the REAL `config.tenantId` — the route answers 403 on a mismatch with the API key's tenant),
 * `session_id`, `sdk_version` and the current `consent_state`. Fire-and-forget with `keepalive`
 * (a `pagehide` ping must survive the unload); no retry; resolves (never rejects) once the
 * request settled or was skipped. Sends NOTHING without profiling consent, under the §H.9
 * opt-out or without a tenant id — enforced client-side so no body leaves the page [FOLLOW-1357].
 * @param config            - SDK configuration (needs apiKey, decisionApiUrl and tenantId).
 * @param sessionId         - Current session identifier (the completion ping's).
 * @param fields            - The run transition the widget reported.
 * @param profilingOptedOut - §H.9 opt-out: when true nothing is sent.
 */
export function postQuizRunPing(
  config: SdkConfig,
  sessionId: string,
  fields: QuizRunPingFields,
  profilingOptedOut: boolean,
): Promise<void> {
  const consent = getConsentState();
  if (profilingOptedOut || consent !== 'granted' || !config.decisionApiUrl || !config.tenantId) {
    return Promise.resolve();
  }
  const runUrl = buildEndpoint(config.decisionApiUrl, '/quiz/run');
  const body: QuizRunPing = {
    ...fields,
    tenant_id: config.tenantId,
    session_id: sessionId,
    sdk_version: SDK_VERSION,
    consent_state: mapConsentState(consent),
  };
  const json = JSON.stringify(body);
  return computeHmacSha256Hex(config.apiKey, json)
    .then((signatureHex) =>
      signatureHex === null
        ? undefined
        : fetch(runUrl, {
            method: 'POST',
            keepalive: true,
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${config.apiKey}`,
              'X-Estalara-Signature': signatureHex,
            },
            body: json,
          }).then(() => undefined),
    )
    .catch(() => undefined);
}

/**
 * @deprecated Use TextDirective or ClassDirective from @estalara/shared instead.
 * Kept for backward compatibility with existing consumers.
 */
export interface Directive {
  /** Slot identifier — matches data-estalara-slot on DOM elements. */
  slot: string;
  type: 'text' | 'order' | 'visibility' | 'class';
  value: string | string[];
}

export interface AdaptResponse {
  /** Per-decision UUID, mirrors `AdaptationDirectives.adapt_decision_id` [FOLLOW-105]. */
  adapt_decision_id: string;
  session_id: string;
  archetype: string;
  confidence: number;
  /** Cosine similarity to the matched archetype 0–1. */
  similarity: number;
  /** Page context (not a Tier): 2 = detail, 1 = list/search/home [FOLLOW-357]. */
  page_context?: 1 | 2;
  /** Raw directives from the Decision API. Cast to (TextDirective | ClassDirective | ReorderDirective)[] for applyDirectives(). */
  directives: (TextDirective | ClassDirective | ReorderDirective)[];
  /** Origin of the response (playbook / llm_* / default / fallback). */
  source: string;
  /** ISO 8601 timestamp of when the server generated this response. */
  generated_at: string;
  /** Recorded bandit variant; 'control' while frozen [FOLLOW-1286]. */
  variant?: string;
  /** @deprecated Not returned by `/api/adapt` [FOLLOW-105]. */
  ttl_seconds?: number;
  /** Chat-intent dimensions to fold, when the server has them [FOLLOW-101]. */
  chat_intent_dimensions?: Record<string, string> | null;
  /** FOLLOW-1024 — the extraction stamp for the map above; the SDK's per-message watermark. */
  chat_intent_detected_at?: string | null;
  /** Slot selectors to annotate before applyDirectives() [FOLLOW-340]. */
  slot_selectors?: Record<string, string>;
}

/** Context passed to applyDirectives for event logging and idempotency. */
export interface ApplyContext {
  archetypeId: ArchetypeId;
  confidence: number;
  sessionId: string;
  /** Latest-wins predicate before every DOM write; REQUIRED, no default [FOLLOW-791]. */
  isStale: () => boolean;
}

// ── Module-level state ──

/** Fingerprints of directives already applied in this session (idempotency). */
/** Ceiling on the `similarity` sent to /api/adapt: the route's playbook-branch threshold [ESC-087]. */
const SENT_SIMILARITY_CAP = 0.85;

const appliedFingerprints = new Set<string>();

// Resilience observers per directive type, on top of the fingerprints [FOLLOW-791].

interface ResilienceState {
  obs: MutationObserver;
  /** flags: bit 1 = reapply write in progress (re-entrancy guard against our own
   *  mutation), bit 2 = rAF pending (dedupes a revert burst to one repair). */
  f: number;
}

const _textResilienceMap = new Map<HTMLElement, ResilienceState>();
const _classResilienceMap = new Map<HTMLElement, ResilienceState>();
const _reorderResilienceMap = new Map<HTMLElement, ResilienceState>();

/**
 * Write once, then repair framework reverts until superseded [FOLLOW-791].
 * @param map            Per-directive-type state map.
 * @param el             Element (text/class directives) or container (reorder) to observe.
 * @param observerInit   MutationObserverInit appropriate to what this directive mutates.
 * @param matches        True when the DOM currently reflects the desired state — re-evaluated live.
 * @param write          Performs the mutation.
 * @param isStale        Latest-wins predicate; a stale repair disconnects and emits `adapt.skipped`.
 * @param slotOrSelector Slot name / selector being tracked, for event payloads.
 * @param archetypeId    Archetype ID for the `adapt.reapplied` event payload.
 * @param confidence     Confidence for the `adapt.reapplied` event payload.
 * @returns `true` if the initial write happened, `false` if declined as stale [FOLLOW-793].
 */
function attachResilience(
  map: Map<HTMLElement, ResilienceState>,
  el: HTMLElement,
  observerInit: MutationObserverInit,
  matches: () => boolean,
  write: () => void,
  isStale: () => boolean,
  slotOrSelector: string,
  archetypeId: string,
  confidence: number,
): boolean {
  map.get(el)?.obs.disconnect();

  const emitStaleSkip = (): void => {
    pushEvent({
      type: 'adapt.skipped',
      payload: { reason: 'stale', slot_or_selector: slotOrSelector },
      ts: Date.now(),
    });
  };

  if (isStale()) {
    emitStaleSkip();
    // A disconnected entry leaves the map too [FOLLOW-793].
    map.delete(el);
    return false;
  }

  const s: ResilienceState = { obs: null as unknown as MutationObserver, f: 0 };

  const reapply = (): void => {
    // Re-check staleness before the deferred write (Rule AB).
    if (isStale()) {
      s.obs.disconnect();
      map.delete(el);
      emitStaleSkip();
      return;
    }
    if (s.f & 1 || matches()) return;
    s.f |= 1;
    s.obs.disconnect();
    write();
    s.obs.observe(el, observerInit);
    void Promise.resolve().then(() => {
      s.f &= ~1;
    });
    pushEvent({
      type: 'adapt.reapplied',
      payload: { slot_or_selector: slotOrSelector, archetype: archetypeId, confidence },
      ts: Date.now(),
    });
  };

  const obs = new MutationObserver(() => {
    if (s.f || matches()) return;
    s.f |= 2;
    requestAnimationFrame(() => {
      s.f &= ~2;
      reapply();
    });
  });
  s.obs = obs;

  write();
  obs.observe(el, observerInit);
  map.set(el, s);
  return true;
}

/** Evict the generic headline watchdog on hand-off: never two observers [FOLLOW-795]. */
export function evictGenericHeadlineObserver(el: HTMLElement): void {
  const s = _textResilienceMap.get(el);
  if (s) {
    s.obs.disconnect();
    _textResilienceMap.delete(el);
  }
  clearHeadlineOwner(el);
}

/** Disconnect all resilience observers and their headline ownership [FOLLOW-791]. */
export function teardownAdaptObservers(): void {
  for (const [el, s] of _textResilienceMap) {
    s.obs.disconnect();
    clearHeadlineOwner(el);
  }
  _textResilienceMap.clear();
  for (const s of _classResilienceMap.values()) s.obs.disconnect();
  _classResilienceMap.clear();
  for (const s of _reorderResilienceMap.values()) s.obs.disconnect();
  _reorderResilienceMap.clear();
}

/** Reference to the SDK event queue, set via setEventQueueRef(). */
let _eventQueue: CollectedEvent[] | null = null;

/** Wire the SDK event queue in; call once at init. */
export function setEventQueueRef(queue: CollectedEvent[]): void {
  _eventQueue = queue;
}

/** Clear idempotency state on a new session. */
export function resetAdaptState(): void {
  appliedFingerprints.clear();
  // Also disconnect resilience observers [FOLLOW-791].
  teardownAdaptObservers();
}

// ── Internal helpers ──

/** Push onto the SDK event queue; no-op before init [FOLLOW-801]. */
export function pushEvent(event: CollectedEvent): void {
  _eventQueue?.push(event);
}

/** Resolve `{token}`s from attributes; null if ANY is unresolved [FOLLOW-1018]. */
function interpolatePlaceholders(value: string, el: HTMLElement, slotName: string): string | null {
  // Collected rather than flagged: a `let` boolean set only inside the replacer reads as
  // always-false to control-flow analysis, which the lint rule then flags as a dead branch.
  const unresolvedTokens: string[] = [];
  const resolved = value.replace(/\{([a-z][a-z0-9_]*)\}/gi, (match, token: string) => {
    const attr = `data-estalara-${token.toLowerCase().replace(/_/g, '-')}`;
    if (el.hasAttribute(attr)) {
      return el.getAttribute(attr) ?? match;
    }
    unresolvedTokens.push(token);
    pushEvent({
      type: 'adapt.skipped',
      payload: { reason: `unresolved_token_${token}`, slot_or_selector: slotName },
      ts: Date.now(),
    });
    return match;
  });
  return unresolvedTokens.length > 0 ? null : resolved;
}

/** Apply a single TextDirective to matching DOM elements. */
function applyTextDirective(directive: TextDirective, context?: ApplyContext): void {
  const slotName = directive.slot;
  const elements = document.querySelectorAll<HTMLElement>(`[data-estalara-slot="${slotName}"]`);

  if (elements.length === 0) {
    pushEvent({
      type: 'adapt.skipped',
      payload: { reason: 'no_slot_elements', slot_or_selector: slotName },
      ts: Date.now(),
    });
    return;
  }

  // Never blank a slot: empty means "no adaptation" (ADR-0010).
  if (directive.value.trim() === '') {
    pushEvent({
      type: 'adapt.skipped',
      payload: { reason: 'empty_value', slot_or_selector: slotName },
      ts: Date.now(),
    });
    return;
  }

  // Fingerprint recorded only after a real write [FOLLOW-793, FOLLOW-802].
  const fingerprint = `text:${slotName}:${context?.archetypeId ?? 'unknown'}`;
  if (appliedFingerprints.has(fingerprint)) return;
  let written = 0;

  elements.forEach((el) => {
    const resolved = interpolatePlaceholders(directive.value, el, slotName);

    // Unresolved token here: keep the tenant's copy [FOLLOW-1018].
    if (resolved === null) return;

    if (!context) {
      // No ApplyContext (legacy / one-shot call site) — no archetypeId/confidence/isStale
      // available to arm resilience with. One-shot write, unchanged behavior.
      el.textContent = resolved;
      written += 1;
      return;
    }

    // Headline hand-off: arm unless the description module owns it (ADR-0009) [FOLLOW-795].
    if (slotName === 'headline') {
      if (getHeadlineOwner(el) === 'description') {
        pushEvent({
          type: 'adapt.skipped',
          payload: { reason: 'headline_owned_by_description', slot_or_selector: slotName },
          ts: Date.now(),
        });
        return;
      }
      if (!context.isStale()) {
        setHeadlineOwner(el, 'generic');
      }
    }

    if (
      attachResilience(
        _textResilienceMap,
        el,
        { childList: true, characterData: true, subtree: true },
        () => el.textContent === resolved,
        () => {
          el.textContent = resolved;
        },
        context.isStale,
        slotName,
        context.archetypeId,
        context.confidence,
      )
    ) {
      written += 1;
    }
  });

  if (written === 0) return;
  appliedFingerprints.add(fingerprint);

  if (context) {
    pushEvent({
      type: 'adapt.applied',
      payload: {
        slot_or_selector: slotName,
        archetype: context.archetypeId,
        confidence: context.confidence,
      },
      ts: Date.now(),
    });
  }
}

/** Apply a single ClassDirective to matching DOM elements. */
function applyClassDirective(directive: ClassDirective, context?: ApplyContext): void {
  const selector = directive.selector;

  // Only allow [data-estalara-*] selectors — reject anything else
  if (!/^\[data-estalara-[^\]]+\]/.test(selector)) {
    pushEvent({
      type: 'adapt.skipped',
      payload: { reason: 'disallowed_selector', slot_or_selector: selector },
      ts: Date.now(),
    });
    return;
  }

  // FOLLOW-793 AC1: record the fingerprint only after a real write — see the note in
  // `applyTextDirective`. The stale-at-arm early return reaches all three appliers.
  const fingerprint = `class:${selector}:${context?.archetypeId ?? 'unknown'}`;
  if (appliedFingerprints.has(fingerprint)) return;
  let written = 0;

  const elements = document.querySelectorAll<HTMLElement>(selector);
  const applyClasses = (el: HTMLElement): void => {
    // remove first, then add — add wins if same class is in both
    if (directive.remove.length > 0) el.classList.remove(...directive.remove);
    if (directive.add.length > 0) el.classList.add(...directive.add);
  };

  elements.forEach((el) => {
    if (!context) {
      applyClasses(el);
      written += 1;
      return;
    }
    // Desired state: `add` classes present, `remove` classes absent.
    const ok = attachResilience(
      _classResilienceMap,
      el,
      { attributes: true, attributeFilter: ['class'] },
      () =>
        directive.add.every((c) => el.classList.contains(c)) &&
        directive.remove.every((c) => !el.classList.contains(c)),
      () => {
        applyClasses(el);
      },
      context.isStale,
      selector,
      context.archetypeId,
      context.confidence,
    );
    if (ok) written += 1;
  });

  if (written === 0) return;
  appliedFingerprints.add(fingerprint);

  if (context) {
    pushEvent({
      type: 'adapt.applied',
      payload: {
        slot_or_selector: selector,
        archetype: context.archetypeId,
        confidence: context.confidence,
      },
      ts: Date.now(),
    });
  }
}

/** Reorder cards by affinity score, optionally pinning the top N; idempotent. */
function applyReorderDirective(directive: ReorderDirective, context?: ApplyContext): void {
  const container = document.querySelector<HTMLElement>(directive.container_selector);
  if (!container) {
    pushEvent({
      type: 'adapt.skipped',
      payload: { reason: 'no_container', slot_or_selector: directive.container_selector },
      ts: Date.now(),
    });
    return;
  }

  const cards = Array.from(container.querySelectorAll<HTMLElement>(directive.item_selector));
  if (cards.length === 0) {
    pushEvent({
      type: 'adapt.skipped',
      payload: { reason: 'no_cards', slot_or_selector: directive.item_selector },
      ts: Date.now(),
    });
    return;
  }

  // Idempotency: same container+archetype is skipped on repeat calls.
  // FOLLOW-793 AC1: recorded only after a real write — see `applyTextDirective`.
  const fingerprint = `reorder:${directive.container_selector}:${directive.archetype}`;
  if (appliedFingerprints.has(fingerprint)) return;
  let written = 0;

  const scoreMap = new Map(directive.scores.map((s) => [s.listing_id, s.score]));

  // Sort by score, unscored last; reused by every repair [FOLLOW-792].
  const sortByScore = (list: HTMLElement[]): HTMLElement[] =>
    [...list].sort((a, b) => {
      const idA = a.getAttribute('data-estalara-listing-id');
      const idB = b.getAttribute('data-estalara-listing-id');
      const scoreA = idA !== null ? (scoreMap.get(idA) ?? -Infinity) : -Infinity;
      const scoreB = idB !== null ? (scoreMap.get(idB) ?? -Infinity) : -Infinity;
      return scoreB - scoreA;
    });

  // `cards` is kept only for the empty-container check [FOLLOW-803].

  // Re-query LIVE nodes and sort by listing id, never node identity [FOLLOW-792].
  const applyOrder = (): void => {
    const liveSorted = sortByScore(
      Array.from(container.querySelectorAll<HTMLElement>(directive.item_selector)),
    );
    if (directive.pin_top_n !== undefined && directive.pin_top_n > 0) {
      const topCards = liveSorted.slice(0, directive.pin_top_n);
      const restCards = liveSorted.slice(directive.pin_top_n);
      container.prepend(...topCards);
      container.append(...restCards);
    } else {
      container.append(...liveSorted);
    }
  };

  if (!context) {
    applyOrder();
    written += 1;
  } else {
    // "Is the live set in score order?" — independent of the card count [FOLLOW-803].
    const ok = attachResilience(
      _reorderResilienceMap,
      container,
      { childList: true },
      () => {
        const current = Array.from(
          container.querySelectorAll<HTMLElement>(directive.item_selector),
        );
        const desired = sortByScore(current);
        return current.every((c, i) => c === desired[i]);
      },
      applyOrder,
      context.isStale,
      directive.container_selector,
      context.archetypeId,
      context.confidence,
    );
    if (ok) written += 1;
  }

  if (written === 0) return;
  appliedFingerprints.add(fingerprint);

  if (context) {
    pushEvent({
      type: 'adapt.applied',
      payload: {
        slot_or_selector: directive.container_selector,
        archetype: context.archetypeId,
        confidence: context.confidence,
      },
      ts: Date.now(),
    });
  }
}

/** Inner directive processing — called when DOM is guaranteed ready. */
function runApply(
  directives: (TextDirective | ClassDirective | ReorderDirective)[],
  context?: ApplyContext,
): void {
  try {
    for (const directive of directives) {
      try {
        if (directive.type === 'text') {
          applyTextDirective(directive, context);
        } else if (directive.type === 'reorder') {
          applyReorderDirective(directive, context);
        } else {
          // directive.type === 'class'
          applyClassDirective(directive, context);
        }
      } catch {
        // Per-directive errors are silenced — continue processing remaining directives
      }
    }
  } catch {
    // Never propagate
  }
}

// ── Public API ──

/** `fetchDirectives` result; commits nothing, the caller does [FOLLOW-1306]. */
export interface FetchDirectivesResult {
  adaptResponse: AdaptResponse | null;
  updatedIntentState?: IntentState;
}

/**
 * Fetch adaptation directives; null when unavailable or unconfigured.
 * @param intentState - Current intent state (archetype_hint, confidence, similarity).
 */
export async function fetchDirectives(
  config: SdkConfig,
  session: SessionState,
  pageType: 'listing_list' | 'listing_detail' | 'home' | 'search',
  intentState?: IntentState,
  listingId?: string,
  profilingOptedOut?: boolean,
): Promise<FetchDirectivesResult> {
  if (!config.decisionApiUrl) return { adaptResponse: null };
  if (!config.tenantId) return { adaptResponse: null };

  try {
    // FOLLOW-197: include derived pseudonymous lead_id when available (registered user path).
    // The raw user_uuid is never stored — only the SHA-256-derived 16-char hex token.
    let leadId = '';
    try {
      leadId = sessionStorage.getItem('__estalara_lead_id__') ?? '';
    } catch {
      // sessionStorage unavailable — leave leadId as empty string
    }

    const body: Record<string, unknown> = {
      tenant_id: config.tenantId,
      session_id: session.sessionId,
      page_type: pageType,
      locale: config.language,
      lead_id: leadId,
    };
    if (intentState !== undefined) {
      body.archetype_hint = intentState.archetype;
      body.confidence = intentState.confidence;
      // ESC-087 (CEO 2026-10-20, option 1): capped at the route's playbook threshold so a confirmed
      // 0.90 quiz leaf keeps the LLM branch; the calibrated posterior stays in state and quiz_runs.
      body.similarity = Math.min(
        intentState.probabilities[intentState.archetype],
        SENT_SIMILARITY_CAP,
      );
      // Quiz traits, additive (ESC-086 item 4; the route's body schema strips it today).
      if (intentState.quiz_traits) body.traits = intentState.quiz_traits;
    }

    // Detail pages send listing_id [FOLLOW-194].
    if (listingId !== undefined) {
      body.listing_id = listingId;
    }

    // Collect visible listing IDs for ReorderDirective scoring (max 50)
    const listingIds: string[] = [];
    if (typeof document !== 'undefined') {
      document.querySelectorAll<HTMLElement>('[data-estalara-listing-id]').forEach((el) => {
        const id = el.getAttribute('data-estalara-listing-id');
        if (id && listingIds.length < 50) listingIds.push(id);
      });
    }
    if (listingIds.length > 0) body.listing_ids = listingIds;

    // 'pending' never reaches here; 'unknown' is the safe mapping.
    const sdkConsent = getConsentState();
    body.consent_state = sdkConsent === 'pending' ? 'unknown' : sdkConsent;

    // Opt-out rides the URL query (§H.9) [FOLLOW-383].
    const adaptPath = profilingOptedOut ? '/adapt?profiling_opt_out=1' : '/adapt';
    const res = await fetch(buildEndpoint(config.decisionApiUrl, adaptPath), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) return { adaptResponse: null };

    const data: unknown = await res.json();

    // Validate the response shape; Sentry + null on failure [FOLLOW-105].
    let response: AdaptResponse;
    try {
      // `.passthrough()` keeps unknown server fields; `.parse()` throws on a
      // structural mismatch. The validated shape is a superset of AdaptResponse.
      response = adaptResponseSchema.parse(data) as unknown as AdaptResponse;
    } catch (err) {
      const gSentry = (globalThis as { Sentry?: { captureException?: (e: unknown) => void } })
        .Sentry;
      gSentry?.captureException?.(err);
      return { adaptResponse: null };
    }

    // Chat prior: once per message via the persisted stamp (Rule R) [FOLLOW-1024, FOLLOW-635].
    const dims = response.chat_intent_dimensions;
    const detectedAt = response.chat_intent_detected_at;
    const hasStamp = typeof detectedAt === 'string' && detectedAt.length > 0;
    const alreadyFolded = hasStamp
      ? intentState?.chatPriorAppliedAt === detectedAt
      : intentState?.chatPriorApplied === true;

    if (
      dims !== null &&
      dims !== undefined &&
      Object.keys(dims).length > 0 &&
      intentState !== undefined &&
      !alreadyFolded
    ) {
      const updatedIntentState = applyChatIntentPrior(intentState, dims);

      // `chatPriorAppliedAt` gates the next fold (Rule R) [FOLLOW-1024].
      const markedIntentState = {
        ...updatedIntentState,
        chatPriorApplied: true as const,
        ...(hasStamp ? { chatPriorAppliedAt: detectedAt } : {}),
      };

      return { adaptResponse: response, updatedIntentState: markedIntentState };
    }

    return { adaptResponse: response };
  } catch {
    return { adaptResponse: null };
  }
}

/**
 * Apply directives to the DOM; never throws, idempotent, emits adapt events.
 * @param directives - TextDirective, ClassDirective or ReorderDirective from @estalara/shared
 * @param context    - Optional session context for event attribution
 */
export function applyDirectives(
  directives: (TextDirective | ClassDirective | ReorderDirective)[],
  context?: ApplyContext,
): void {
  if (typeof document === 'undefined') return;

  if (document.readyState === 'loading') {
    // Queue and apply once DOM is ready; { once: true } prevents listener accumulation
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        runApply(directives, context);
      },
      { once: true },
    );
    return;
  }

  runApply(directives, context);
}
