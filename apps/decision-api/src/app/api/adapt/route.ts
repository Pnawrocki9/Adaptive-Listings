/**
 * POST /api/adapt — adaptation decision endpoint.
 *
 * MVP stub: returns deterministic directives based on archetype_hint.
 * Real ML inference (Modal intent-engine) is wired in Sprint 5 (TICKET-031).
 *
 * Auth: presence-only check on Authorization: Bearer header.
 * DB lookups for tenant validation are deferred to Sprint 5.
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

export interface AdaptResponse {
  session_id: string;
  archetype: string;
  confidence: number;
  directives: Directive[];
  ttl_seconds: number;
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

// ─── Request handler ──────────────────────────────────────────────────────────

function errorResponse(code: string, message: string, status: number, details?: unknown): Response {
  return Response.json(
    { error: { code, message, ...(details !== undefined ? { details } : {}) } },
    { status },
  );
}

export async function handleAdaptRequest(request: Request): Promise<Response> {
  // 1. Auth — presence-only in MVP (tenant DB lookup deferred to Sprint 5)
  const auth = request.headers.get('Authorization') ?? request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ') || auth.slice(7).trim() === '') {
    return errorResponse('unauthorized', 'Authorization: Bearer <key> header is required', 401);
  }

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

  const body: AdaptResponse = {
    session_id,
    archetype,
    confidence,
    directives: isHoldout ? [] : directives,
    ttl_seconds: 300,
    // AC-3: holdout_group is absent when assignment was skipped.
    ...(assignment.skipped ? {} : { holdout_group: assignment.holdout_group }),
  };

  return Response.json(body, { status: 200 });
}
