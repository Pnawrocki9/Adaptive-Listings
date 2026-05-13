/**
 * POST /api/adapt — adaptation decision endpoint.
 *
 * MVP stub: returns deterministic directives based on archetype_hint.
 * Real ML inference (Modal intent-engine) is wired in Sprint 5 (TICKET-031).
 *
 * Auth:
 *   - When ADAPT_API_KEY env var is set: Bearer token must match exactly.
 *   - When ADAPT_API_KEY is unset (local dev / tests): presence-only auth is used.
 *
 * LLM cap:
 *   - When per-tenant daily spend exceeds LLM_DAILY_CAP_USD (default $1.00),
 *     the response source is set to 'playbook_fallback_llm_capped'.
 *
 * A/B holdout assignment: TICKET-AB-001.
 * - Deterministic HMAC-SHA-256 hash on (tenant_id, session_id).
 * - Consent-aware: sessions with opted_out/unknown/none consent are skipped.
 * - Fair-housing safe: no user attributes, only (tenant_id, session_id).
 *
 * Edge-compatible — no Node.js APIs.
 *
 * @module apps/decision-api/src/app/api/adapt/route
 */

import { z } from 'zod';

import { assignHoldout, DEFAULT_HOLDOUT_PCT } from '../../../lib/ab-assignment.js';
import type { Env } from '../../../index.js';
import { isDailyCapExceeded } from '../../../lib/llm-gateway.js';

// ─── Request / response types ─────────────────────────────────────────────────

const AdaptRequestSchema = z.object({
  tenant_id: z.string().uuid(),
  session_id: z.string().min(1),
  /** Optional archetype signal — from quiz E.4 or URL params. */
  archetype_hint: z.string().optional(),
  page_type: z.enum(['listing_list', 'listing_detail', 'home', 'search']),
  listing_ids: z.array(z.string()).optional(),
  /**
   * Consent state from the session. Used for A/B holdout consent gating.
   * Accepts the existing ConsentState values plus 'opted_out' | 'unknown' for
   * the A/B layer (these map to the skip condition in AC-3 of TICKET-AB-001).
   */
  consent_state: z.string().optional(),
  /**
   * Whether the tenant has consent mode enabled.
   * When true, sessions with non-granted consent states are skipped for A/B assignment.
   */
  consent_mode_enabled: z.boolean().optional(),
  /**
   * Holdout percentage override. If omitted, the default (0.10) is used.
   * Must be in [0, 1].
   */
  holdout_pct: z.number().min(0).max(1).optional(),
});

type DirectiveType = 'text' | 'order' | 'visibility' | 'class';

export interface Directive {
  slot: string;
  type: DirectiveType;
  value: string | string[];
}

export type AdaptResponseSource =
  | 'playbook'
  | 'llm'
  | 'cache'
  | 'playbook_fallback_llm_capped'
  | 'playbook_fallback_llm_timeout';

export interface AdaptResponse {
  session_id: string;
  archetype: string;
  confidence: number;
  directives: Directive[];
  ttl_seconds: number;
  /** Origin of the response — useful for observability and client-side analytics. */
  source: AdaptResponseSource;
  /**
   * A/B holdout assignment. Present when the session was assigned (consent granted).
   * Absent when assignment was skipped (opted-out / unknown consent).
   */
  holdout_group?: boolean;
}

// ─── Stub directive sets ──────────────────────────────────────────────────────

const INVESTOR_DIRECTIVES: Directive[] = [
  { slot: 'hero_headline', type: 'text', value: 'High-yield investment properties' },
  { slot: 'cta_text', type: 'text', value: 'View ROI Analysis' },
  { slot: 'listing_order', type: 'order', value: ['yield_high', 'price_asc'] },
];

const FAMILY_DIRECTIVES: Directive[] = [
  { slot: 'hero_headline', type: 'text', value: 'Find your perfect family home' },
  { slot: 'cta_text', type: 'text', value: 'Book a Family Viewing' },
  { slot: 'listing_order', type: 'order', value: ['schools_nearby', 'bedrooms_desc'] },
];

const NEUTRAL_DIRECTIVES: Directive[] = [
  { slot: 'hero_headline', type: 'text', value: 'Discover your next property' },
  { slot: 'cta_text', type: 'text', value: 'Explore Listings' },
  { slot: 'listing_order', type: 'order', value: ['featured', 'recent'] },
];

// ─── Archetype detection ──────────────────────────────────────────────────────

interface ArchetypeResult {
  archetype: string;
  directives: Directive[];
  confidence: number;
}

export function detectArchetype(hint?: string): ArchetypeResult {
  const h = (hint ?? '').toLowerCase();
  if (h === 'investor' || h.includes('invest')) {
    return { archetype: 'investor', directives: INVESTOR_DIRECTIVES, confidence: 0.9 };
  }
  if (h === 'family' || h.includes('family')) {
    return { archetype: 'family', directives: FAMILY_DIRECTIVES, confidence: 0.9 };
  }
  return { archetype: 'neutral', directives: NEUTRAL_DIRECTIVES, confidence: 0.5 };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Default daily LLM cap in USD when LLM_DAILY_CAP_USD is not configured. */
const DEFAULT_DAILY_CAP_USD = 1.0;

function parseDailyCap(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_DAILY_CAP_USD;
  const parsed = parseFloat(raw);
  return isNaN(parsed) || parsed <= 0 ? DEFAULT_DAILY_CAP_USD : parsed;
}

function errorResponse(code: string, message: string, status: number, details?: unknown): Response {
  return Response.json(
    { error: { code, message, ...(details !== undefined ? { details } : {}) } },
    { status },
  );
}

// ─── Request handler ──────────────────────────────────────────────────────────

/**
 * Handles POST /api/adapt.
 *
 * @param request - The incoming Request object.
 * @param env     - Cloudflare Worker environment bindings.
 *                  Pass `{}` in tests to use presence-only auth (ADAPT_API_KEY unset).
 */
export async function handleAdaptRequest(
  request: Request,
  env: Env = {} as Env,
): Promise<Response> {
  // 1. Auth
  const auth = request.headers.get('Authorization') ?? request.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';

  if (!token) {
    return errorResponse('unauthorized', 'Authorization: Bearer <key> header is required', 401);
  }

  if (env.ADAPT_API_KEY !== undefined && env.ADAPT_API_KEY !== '') {
    // Strict validation: token must match the configured key exactly.
    if (token !== env.ADAPT_API_KEY) {
      return errorResponse('unauthorized', 'Invalid API key', 401);
    }
  }
  // If ADAPT_API_KEY is unset, presence-only auth is used (token non-empty is sufficient).

  // 2. Parse body
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorResponse('validation_failed', 'Request body must be valid JSON', 400);
  }

  // 3. Validate schema
  const parsed = AdaptRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return errorResponse('validation_failed', 'Invalid request body', 400, parsed.error.flatten());
  }

  const {
    tenant_id,
    session_id,
    archetype_hint,
    consent_state,
    consent_mode_enabled,
    holdout_pct,
  } = parsed.data;

  // 4. A/B holdout assignment (AC-1, AC-2, AC-3 — TICKET-AB-001).
  const assignment = await assignHoldout({
    tenant_id,
    session_id,
    // exactOptionalPropertyTypes: only set consent_state when it's a string
    ...(consent_state !== undefined ? { consent_state } : {}),
    consent_mode_enabled: consent_mode_enabled ?? false,
    holdout_pct: holdout_pct ?? DEFAULT_HOLDOUT_PCT,
  });

  // 5. Archetype detection and directive selection.
  //    Holdout sessions receive no adaptation directives (default experience).
  const isHoldout = !assignment.skipped && assignment.holdout_group;

  const { archetype, directives, confidence } = isHoldout
    ? { archetype: 'neutral', directives: NEUTRAL_DIRECTIVES, confidence: 0.5 }
    : detectArchetype(archetype_hint);

  // 6. LLM cap check.
  const dailyCapUsd = parseDailyCap(env.LLM_DAILY_CAP_USD);
  const capExceeded = isDailyCapExceeded(tenant_id, dailyCapUsd);

  const source: AdaptResponseSource = capExceeded ? 'playbook_fallback_llm_capped' : 'playbook';

  const body: AdaptResponse = {
    session_id,
    archetype,
    confidence,
    directives: isHoldout ? [] : directives,
    ttl_seconds: 300,
    source,
    // AC-3: holdout_group is absent when assignment was skipped.
    ...(assignment.skipped ? {} : { holdout_group: assignment.holdout_group }),
  };

  return Response.json(body, { status: 200 });
}
