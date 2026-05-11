/**
 * Embedding utilities for client-side archetype matching.
 *
 * NOTE: Actual OpenAI text-embedding-3-small generation happens server-side
 * (Decision API → Modal worker). This client-side module is intentionally
 * lightweight and does:
 *
 *   1. Build a 7-dimensional behavioral fingerprint from SDK signals.
 *   2. Provide cosine similarity for client-side confidence scoring.
 *   3. Match the fingerprint against three pre-computed archetype reference
 *      vectors via cosine similarity to produce an immediate archetype hint
 *      for the Decision API (cold-start, before quiz / full embedding).
 *
 * Pure functions; no network calls, no DOM access.
 *
 * @module @estalara/sdk/core/embedding
 */

import type { Archetype } from './intent.js';

export interface BehavioralFingerprint {
  /** Number of `listing.viewed` events observed. */
  listing_view_count: number;
  /** Max scroll depth fraction reached (0.0 – 1.0). */
  avg_scroll_depth: number;
  /** Number of `cta.clicked` events observed. */
  cta_click_count: number;
  /** Session duration in milliseconds. */
  session_duration_ms: number;
  /** Number of `page.view` events observed. */
  page_count: number;
  /** Share of CTAs whose id contains investment keywords (roi / yield / invest / return). */
  investment_signal_ratio: number;
  /** Share of CTAs whose id contains family keywords (school / family / bedroom). */
  family_signal_ratio: number;
}

/**
 * Pre-computed heuristic archetype reference vectors.
 *
 * Each row has 7 values, in the same order as `fingerprintToVector` output:
 *   [listing_views, scroll_depth, cta_clicks, duration, page_count,
 *    investment_ratio, family_ratio]
 *
 * Values are in [0, 1] (already normalized).
 */
const ARCHETYPE_HEURISTIC_VECTORS: Record<Archetype, readonly number[]> = {
  investor: [0.3, 0.5, 0.7, 0.4, 0.3, 0.9, 0.1],
  family: [0.5, 0.6, 0.4, 0.6, 0.5, 0.1, 0.9],
  neutral: [0.2, 0.4, 0.2, 0.3, 0.2, 0.4, 0.4],
} as const;

// Normalization caps for raw fingerprint fields → [0, 1] vector space.
const MAX_LISTING_VIEWS = 20;
const MAX_CTA_CLICKS = 10;
const MAX_SESSION_MS = 30 * 60 * 1000; // 30 minutes
const MAX_PAGE_COUNT = 10;

// Keyword regexes for inferring CTA intent.
const INVESTMENT_KEYWORDS = /roi|yield|invest|return/i;
const FAMILY_KEYWORDS = /school|family|bedroom/i;

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

function getCtaId(payload?: Record<string, unknown>): string | null {
  if (!payload) return null;
  const id = payload.cta_id;
  return typeof id === 'string' ? id : null;
}

/**
 * Build a behavioral fingerprint from accumulated SDK events.
 * Pure computation — no API calls, no DOM access.
 */
export function buildBehavioralFingerprint(
  events: { type: string; payload?: Record<string, unknown> }[],
  sessionDurationMs: number,
): BehavioralFingerprint {
  let listingViews = 0;
  let ctaClicks = 0;
  let pageCount = 0;
  let maxScrollDepth = 0;
  let investmentCtas = 0;
  let familyCtas = 0;

  for (const e of events) {
    if (e.type === 'listing.viewed') {
      listingViews++;
    } else if (e.type === 'page.view') {
      pageCount++;
    } else if (e.type === 'scroll.depth') {
      const depth = e.payload?.depth_percent;
      if (typeof depth === 'number' && depth > maxScrollDepth) {
        maxScrollDepth = depth;
      }
    } else if (e.type === 'cta.clicked') {
      ctaClicks++;
      const ctaId = getCtaId(e.payload);
      if (ctaId && INVESTMENT_KEYWORDS.test(ctaId)) investmentCtas++;
      if (ctaId && FAMILY_KEYWORDS.test(ctaId)) familyCtas++;
    }
  }

  return {
    listing_view_count: listingViews,
    avg_scroll_depth: clamp01(maxScrollDepth / 100),
    cta_click_count: ctaClicks,
    session_duration_ms: Math.max(0, sessionDurationMs),
    page_count: pageCount,
    investment_signal_ratio: ctaClicks > 0 ? investmentCtas / ctaClicks : 0,
    family_signal_ratio: ctaClicks > 0 ? familyCtas / ctaClicks : 0,
  };
}

/**
 * Convert a fingerprint to a normalized 7-dimensional vector in [0, 1]^7.
 *
 * Order: [listing_views, scroll_depth, cta_clicks, duration, page_count,
 *         investment_ratio, family_ratio].
 */
export function fingerprintToVector(fp: BehavioralFingerprint): number[] {
  return [
    clamp01(fp.listing_view_count / MAX_LISTING_VIEWS),
    clamp01(fp.avg_scroll_depth),
    clamp01(fp.cta_click_count / MAX_CTA_CLICKS),
    clamp01(fp.session_duration_ms / MAX_SESSION_MS),
    clamp01(fp.page_count / MAX_PAGE_COUNT),
    clamp01(fp.investment_signal_ratio),
    clamp01(fp.family_signal_ratio),
  ];
}

/**
 * Cosine similarity between two vectors. Returns 0.0–1.0 (1.0 = identical
 * direction). Returns 0 when:
 *   - either vector has zero magnitude (no NaN propagation)
 *   - vectors have different lengths
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Heuristic archetype match using cosine similarity against the three
 * pre-computed archetype reference vectors.
 *
 * Returns `argmax_archetype cos_sim(fingerprint, archetype_ref)` along with
 * the raw similarity and a coarse confidence band. When all similarities are
 * zero (e.g. empty fingerprint), falls back to `neutral` with low confidence.
 *
 * This is a FAST heuristic intended to provide an immediate archetype hint
 * to the Decision API. The authoritative match is the OpenAI pgvector match
 * performed server-side.
 */
export function matchArchetypeHeuristic(fp: BehavioralFingerprint): {
  archetype: Archetype;
  similarity: number;
  confidence: 'high' | 'medium' | 'low';
} {
  const vec = fingerprintToVector(fp);

  let bestArchetype: Archetype = 'neutral';
  let bestSim = -Infinity;

  for (const [name, refVec] of Object.entries(ARCHETYPE_HEURISTIC_VECTORS)) {
    const sim = cosineSimilarity(vec, [...refVec]);
    if (sim > bestSim) {
      bestSim = sim;
      bestArchetype = name as Archetype;
    }
  }

  // Empty / zero fingerprint → no useful match. Default to neutral / low.
  if (bestSim <= 0) {
    return { archetype: 'neutral', similarity: 0, confidence: 'low' };
  }

  const confidence: 'high' | 'medium' | 'low' =
    bestSim > 0.7 ? 'high' : bestSim > 0.5 ? 'medium' : 'low';

  return { archetype: bestArchetype, similarity: bestSim, confidence };
}
