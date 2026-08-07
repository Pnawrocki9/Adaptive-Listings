/**
 * Adaptation directive types shared across Decision API and SDK.
 *
 * `ArchetypeId` is derived from `CANONICAL_ARCHETYPE_IDS` (`./archetypes.js`) rather than
 * imported from `@estalara/sdk`, to prevent a circular workspace dependency (`@estalara/sdk`
 * depends on `@estalara/shared`, not the other way around). Keep `CANONICAL_ARCHETYPE_IDS` in
 * sync with the `Archetype` union in `packages/sdk/src/core/intent.ts` whenever new archetypes
 * are added — `packages/shared/src/__tests__/archetype-canonical-parity.test.ts` guards this
 * (FOLLOW-584).
 *
 * @module @estalara/shared/directives
 */

import type { CANONICAL_ARCHETYPE_IDS } from './archetypes.js';

/**
 * Canonical archetype identifiers — mirrors `Archetype` in `@estalara/sdk/core/intent`.
 *
 * Derived from `CANONICAL_ARCHETYPE_IDS` (`./archetypes.js`) to avoid a circular workspace
 * dependency (shared → sdk). Keep `CANONICAL_ARCHETYPE_IDS` in sync with
 * `packages/sdk/src/core/intent.ts` whenever archetypes change.
 */
export type ArchetypeId = (typeof CANONICAL_ARCHETYPE_IDS)[number];

/**
 * Text slot directive — rewrites the text content of a slot element.
 *
 * Matches elements via `[data-estalara-slot="<slot>"]`.
 */
export interface TextDirective {
  type: 'text';
  /** Matches `[data-estalara-slot="<slot>"]` on the host page. */
  slot: string;
  /** Replacement text value. */
  value: string;
  archetype: ArchetypeId;
  /** Confidence score 0–1 from the intent engine. */
  confidence: number;
}

/**
 * Class directive — adds/removes CSS classes on a matched element.
 *
 * Matches elements via `selector` (e.g. `[data-estalara-listing-id="123"]`).
 */
export interface ClassDirective {
  type: 'class';
  /** CSS selector identifying the target element. */
  selector: string;
  /** CSS classes to add. */
  add: string[];
  /** CSS classes to remove. */
  remove: string[];
  archetype: ArchetypeId;
  /** Confidence score 0–1 from the intent engine. */
  confidence: number;
}

/**
 * SPRINT 8 HOOK: ReorderDirective
 * Full DOM implementation in Sprint 8 (A/B framework + re-ranking).
 * Defined here so Decision API can include it in AdaptationDirectives without a breaking change.
 *
 * Requires `IndexSchema.reorder_capable === true` and a valid `container_selector` on the tenant
 * site schema. The SDK reads `container_selector` + `item_selector` to reorder child nodes,
 * applying the sorted `scores` array (highest score first), optionally pinning the top N cards.
 */
export interface ReorderDirective {
  type: 'reorder';
  /** CSS selector for the grid/list container — mirrors `IndexSchema.container_selector`. */
  container_selector: string;
  /** CSS selector for individual listing card elements within the container. */
  item_selector: string;
  /** Scoring algorithm used to rank cards — currently only archetype affinity. */
  score_function: 'archetype_affinity';
  /** Ordered list of listing IDs with their affinity scores (descending). */
  scores: {
    listing_id: string;
    score: number;
  }[];
  /** Pin the top N highest-scoring cards regardless of their original position. */
  pin_top_n?: number;
  /** Archetype ID that produced these scores. */
  archetype: string;
  /** Confidence score 0–1 from the intent engine. */
  confidence: number;
}

/**
 * Full adaptation directive response returned by `GET /api/adapt`.
 *
 * The SDK reads this and applies each directive to the host page DOM.
 */
export interface AdaptationDirectives {
  /**
   * Stable per-decision UUID generated server-side on the canonical `/api/adapt`
   * route (FOLLOW-105 / ADR-0006 §Decision 4C). Returned in BOTH the adapted and
   * the holdout response bodies, and logged into the ClickHouse `adaptation_decisions`
   * insert so a response can be cross-correlated with its analytics row.
   *
   * NOTE: this is distinct from `explainability_id` (a link to a provenance audit
   * trail), which is DEFERRED to FOLLOW-108 (Sprint 14) and is NOT part of this type.
   */
  adapt_decision_id: string;
  session_id: string;
  archetype: ArchetypeId | 'neutral';
  /** Intent confidence 0–1. */
  confidence: number;
  /** Cosine similarity to matched archetype 0–1. */
  similarity: number;
  /**
   * Page context derived from `page_type` (POST handler only — FOLLOW-357).
   *
   * NOT an integration Tier — the product has no Tiers (CEO ruling 2026-06-05, §E.7).
   * This is a page-type signal used for analytics and to control how many directive
   * slots are sent per page context:
   *   - `2` = listing_detail: full per-listing directive set (headline, cta, feature)
   *   - `1` = listing_list / search / home: lighter directive set (cta, feature, reorder only)
   *
   * The value is stored in the `adaptation_decisions.page_context` ClickHouse column
   * (renamed from `tier` in migration 0018). Absent on legacy GET responses.
   */
  page_context?: 1 | 2;
  /**
   * Adaptation directives for this response.
   *
   * Verified against every `source:` return in
   * `apps/control-plane/src/app/api/adapt/route.ts` (FOLLOW-890):
   *   - `'default'` — ALWAYS `[]` (all 8 return sites: `:276,824,859,890,1228,1283,1380,1444`)
   *   - `'playbook_fallback_llm_unavailable'` — `[]` on the branch-4 gateway-failure path
   *     (`:346`), the playbook directives on the branch-3 one (`:367`)
   *   - `'playbook'` — the playbook directives (`:324`)
   *   - `'llm_full'` / `'llm_tweaked'` — the LLM gateway's own directives, verbatim
   *     (`:342,363`). The route NEVER pairs either with an empty-array literal.
   *
   * The previous text here read "Empty when source is 'default' or 'llm_full'", which
   * `route.ts:15` has contradicted since the ADP-002 gateway wiring, and which is where
   * the `simulateDecisionTree` replica deleted from
   * `packages/sdk/src/__tests__/playbooks.test.ts` got the pair it asserted green.
   * `apps/control-plane/src/app/api/adapt/route.test.ts:326-338,396-408` is the authority.
   */
  directives: (TextDirective | ClassDirective | ReorderDirective)[];
  /**
   * - `playbook`                         — static pre-computed playbook, high-confidence match
   * - `llm_tweaked`                      — playbook directives tweaked by Haiku LLM (ADP-002)
   * - `llm_full`                         — full directive generation by Sonnet LLM (ADP-002)
   * - `default`                          — confidence too low, no adaptation
   * - `playbook_fallback_llm_capped`     — LLM spend cap hit, fell back to playbook
   * - `playbook_fallback_llm_unavailable`— LLM unavailable or error, fell back to playbook
   */
  source:
    | 'playbook'
    | 'llm_tweaked'
    | 'llm_full'
    | 'default'
    | 'playbook_fallback_llm_capped'
    | 'playbook_fallback_llm_unavailable';
  /**
   * Thompson sampling bandit variant selected for this request (FOLLOW-007).
   *
   * Populated on the canonical `POST /api/adapt` path after `thompsonSample()`
   * draws from the Beta posteriors stored in `ab_bandit_weights` for the
   * `(tenant_id, archetype)` pair. Defaults to `'control'` when:
   *   - the bandit returned `null` (all arms paused)
   *   - the route is GET (legacy callers, no bandit wiring yet)
   *   - the session is held-out / consent-skipped / below confidence threshold
   *
   * The SDK echoes this value back in `POST /api/adapt/feedback` so the
   * server can update the matching `(tenant_id, archetype, variant)` arm.
   *
   * Optional for backward compatibility — existing GET callers continue to
   * work without a variant field.
   */
  variant?: string;
  /** ISO 8601 timestamp of when this response was generated. */
  generated_at: string;
  /**
   * Flattened chat-intent dimension map from the Modal NLP pipeline (FOLLOW-101).
   *
   * Populated unconditionally by the `/api/adapt` control-plane route when a
   * shadow chat-intent entry exists in Redis for this `(tenant_id, session_id)`
   * pair. The SDK (`adapt.ts`) calls
   * `applyChatIntentPrior(currentIntentState, chat_intent_dimensions)` to update
   * the local IntentState, which also feeds `quiz.mismatch` detection and intent
   * analytics.
   *
   * FOLLOW-635 (CEO ruling, option A, 2026-07-24): this value IS live-influencing
   * across calls, not shadow-only — `applyChatIntentPrior` updates
   * `intentState.archetype`, which is sent back as `archetype_hint` on the next
   * adapt call and drives the directives served then. There is no
   * `CHAT_NLP_LIVE`-style gate. It only has real content once
   * `apps/intent-engine`'s write path is deployed (ESC-042); until then this
   * field is simply absent.
   *
   * Absent when no shadow data exists for the session (first adapt call before any
   * chat messages, intent-engine not yet deployed, or Redis unavailable).
   */
  chat_intent_dimensions?: Record<string, string> | null;
  /**
   * Resolved slot selector map from `detail_schema.slot_selectors` (FOLLOW-340).
   *
   * A flat `{ slotName → CSS_selector }` mapping derived from the active tenant's
   * `tenant_site_schemas.detail_schema.slot_selectors` primary selectors. When
   * present, the SDK calls `annotateSlots(slot_selectors)` BEFORE the first
   * `applyDirectives()` call so that pages without hand-coded `data-estalara-slot`
   * attributes receive self-annotation and directives can find their targets.
   *
   * Additive and optional — omitted when the tenant has no curated slot selectors
   * or when the schema lookup fails (fail-safe: the adapt response is never blocked).
   * The SDK never overwrites an existing `data-estalara-slot` attribute (idempotent).
   */
  slot_selectors?: Record<string, string>;
}
