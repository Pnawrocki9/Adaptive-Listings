/**
 * POST /api/adapt — adaptation decision endpoint.
 *
 * MVP stub: returns deterministic directives based on archetype_hint.
 * Real ML inference (Modal intent-engine) is wired in Sprint 5 (TICKET-031).
 * ReorderDirective emission wired in TICKET-AB-009.
 * Thompson sampling variant selection is tracked in FOLLOW-007.
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
 * - ab.assignment event emitted fire-and-forget: TICKET-AB-005 / FOLLOW-006.
 *
 * ReorderDirective: TICKET-AB-009.
 * - Emitted when listing_ids is present, session is non-holdout, and tenant is reorder_capable.
 * - Helpers live in apps/decision-api/src/lib/reorder.ts (canonical location).
 *
 * Edge-compatible — no Node.js APIs.
 *
 * @module apps/decision-api/src/app/api/adapt/route
 */

import { z } from 'zod';

import { assignHoldout, DEFAULT_HOLDOUT_PCT } from '../../../lib/ab-assignment.js';
import { publishAbAssignmentEvent } from '../../../lib/ab-events.js';
import type { Env } from '../../../index.js';
import { isDailyCapExceeded } from '../../../lib/llm-gateway.js';
import {
  getTenantSchema,
  buildReorderDirective,
  type ReorderDirective,
  type TenantSchemaEnv,
} from '../../../lib/reorder.js';

// ─── Request / response types ─────────────────────────────────────────────────

const AdaptRequestSchema = z.object({
  tenant_id: z.string().uuid(),
  session_id: z.string().min(1),
  /** Optional archetype signal — from quiz E.4 or URL params. */
  archetype_hint: z.string().optional(),
  page_type: z.enum(['listing_list', 'listing_detail', 'home', 'search']),
  listing_ids: z.array(z.string().max(64)).max(100).optional(),
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
  /**
   * Archetype confidence score from the SDK intent engine (0–1).
   * When >= 0.6 and archetype_hint is a non-empty string, the hint is used as-is
   * without falling back to stub detection. Values below 0.6 or absent cause
   * the stub classifier to run as before. [TICKET-FIX-015]
   */
  confidence: z.number().min(0).max(1).optional(),
  /**
   * Embedding cosine similarity from the SDK intent engine (0–1).
   * Passed through to the response for observability. [TICKET-FIX-015]
   */
  similarity: z.number().min(0).max(1).optional(),
});

type DirectiveType = 'text' | 'order' | 'visibility' | 'class';

export interface Directive {
  slot: string;
  type: DirectiveType;
  value: string | string[];
  archetype: string;
  confidence: number;
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
  /**
   * Embedding cosine similarity forwarded from the SDK intent engine.
   * Present when the SDK included it in the request. [TICKET-FIX-015]
   */
  similarity?: number;
  /**
   * ReorderDirective list — emitted when listing_ids is provided, the session is
   * non-holdout, and the tenant is reorder_capable. Empty array otherwise.
   * [TICKET-AB-009]
   */
  reorderDirectives: ReorderDirective[];
}

// ─── Stub directive sets ──────────────────────────────────────────────────────

/** Base directive shape before archetype/confidence are threaded in from detectArchetype(). */
type DirectiveBase = Pick<Directive, 'slot' | 'type' | 'value'>;

const INVESTOR_DIRECTIVES_BASE: DirectiveBase[] = [
  { slot: 'hero_headline', type: 'text', value: 'High-yield investment properties' },
  { slot: 'cta_text', type: 'text', value: 'View ROI Analysis' },
  { slot: 'listing_order', type: 'order', value: ['yield_high', 'price_asc'] },
];

const FAMILY_DIRECTIVES_BASE: DirectiveBase[] = [
  { slot: 'hero_headline', type: 'text', value: 'Find your perfect family home' },
  { slot: 'cta_text', type: 'text', value: 'Book a Family Viewing' },
  { slot: 'listing_order', type: 'order', value: ['schools_nearby', 'bedrooms_desc'] },
];

const NEUTRAL_DIRECTIVES_BASE: DirectiveBase[] = [
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

/** Thread archetype + confidence from the detection result into each directive. */
function toDirectives(bases: DirectiveBase[], archetype: string, confidence: number): Directive[] {
  return bases.map((d) => ({ ...d, archetype, confidence }));
}

/**
 * Detect the archetype for a session.
 *
 * When `confidence` is >= 0.6 and `hint` is a non-empty string the SDK has
 * already produced a high-confidence signal; trust it directly and skip the
 * stub classifier so the real score is preserved in the response.
 *
 * When `confidence` is absent or < 0.6, fall through to the stub keyword
 * matcher (existing behaviour — no regression for callers that omit the field).
 *
 * @param hint       - Archetype hint string (e.g. "investor", "family").
 * @param confidence - Optional confidence score from the SDK intent engine (0–1).
 * @param similarity - Optional cosine similarity (passed-through, not used here).
 */
export function detectArchetype(
  hint?: string,
  confidence?: number,
  _similarity?: number,
): ArchetypeResult {
  // High-confidence SDK signal: use hint as-is, preserve the provided score.
  if (confidence !== undefined && confidence >= 0.6 && hint && hint.trim().length > 0) {
    const archetype = hint.trim().toLowerCase();
    // Build directives from the matching playbook when available; neutral otherwise.
    let bases: DirectiveBase[];
    if (archetype === 'investor' || archetype.includes('invest')) {
      bases = INVESTOR_DIRECTIVES_BASE;
    } else if (archetype === 'family' || archetype.includes('family')) {
      bases = FAMILY_DIRECTIVES_BASE;
    } else {
      bases = NEUTRAL_DIRECTIVES_BASE;
    }
    return {
      archetype,
      confidence,
      directives: toDirectives(bases, archetype, confidence),
    };
  }

  // Stub keyword-based fallback (original logic).
  const h = (hint ?? '').toLowerCase();
  if (h === 'investor' || h.includes('invest')) {
    const archetype = 'investor';
    const conf = 0.9;
    return {
      archetype,
      confidence: conf,
      directives: toDirectives(INVESTOR_DIRECTIVES_BASE, archetype, conf),
    };
  }
  if (h === 'family' || h.includes('family')) {
    const archetype = 'family';
    const conf = 0.9;
    return {
      archetype,
      confidence: conf,
      directives: toDirectives(FAMILY_DIRECTIVES_BASE, archetype, conf),
    };
  }
  const archetype = 'neutral';
  const conf = 0.5;
  return {
    archetype,
    confidence: conf,
    directives: toDirectives(NEUTRAL_DIRECTIVES_BASE, archetype, conf),
  };
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
    confidence: inputConfidence,
    similarity: inputSimilarity,
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

  // 4b. Emit ab.assignment event (fire-and-forget — MUST NOT delay the HTTP response).
  //     Only emitted when assignment was NOT skipped (consent granted or consent mode disabled).
  //     Sentry tag `ab_assignment_emit_failed` on producer error.
  const redpandaUrl = env.REDPANDA_REST_URL;
  if (!assignment.skipped && redpandaUrl) {
    void (async () => {
      try {
        await publishAbAssignmentEvent({
          session_id,
          tenant_id,
          holdout_group: assignment.holdout_group,
          holdout_pct: holdout_pct ?? DEFAULT_HOLDOUT_PCT,
          assigned_at: assignment.assigned_at,
          env: {
            REDPANDA_REST_URL: redpandaUrl,
            REDPANDA_TOPIC_EVENTS: env.REDPANDA_TOPIC_EVENTS ?? 'estalara.events',
            ...(env.REDPANDA_REST_USERNAME !== undefined
              ? { REDPANDA_REST_USERNAME: env.REDPANDA_REST_USERNAME }
              : {}),
            ...(env.REDPANDA_REST_PASSWORD !== undefined
              ? { REDPANDA_REST_PASSWORD: env.REDPANDA_REST_PASSWORD }
              : {}),
          },
        });
      } catch (err) {
        // Non-fatal — capture in Sentry when available but never block the response path.
        // Sentry is injected globally in Cloudflare Workers; the interface is typed explicitly
        // to avoid unsafe-member-access lint errors while keeping the call site clean.
        interface GlobalSentry {
          captureException: (err: unknown, opts: unknown) => void;
        }
        const gSentry = (globalThis as { Sentry?: GlobalSentry }).Sentry;
        gSentry?.captureException(err, { tags: { ab_assignment_emit_failed: true } });
      }
    })();
  }

  // 5. Archetype detection and directive selection.
  //    Holdout sessions receive no adaptation directives (default experience).
  const isHoldout = !assignment.skipped && assignment.holdout_group;

  const { archetype, directives, confidence } = isHoldout
    ? {
        archetype: 'neutral',
        directives: toDirectives(NEUTRAL_DIRECTIVES_BASE, 'neutral', 0.5),
        confidence: 0.5,
      }
    : detectArchetype(archetype_hint, inputConfidence, inputSimilarity);

  // 6. LLM cap check.
  const dailyCapUsd = parseDailyCap(env.LLM_DAILY_CAP_USD);
  const capExceeded = isDailyCapExceeded(tenant_id, dailyCapUsd);

  const source: AdaptResponseSource = capExceeded ? 'playbook_fallback_llm_capped' : 'playbook';

  // 7. ReorderDirective — emitted for non-holdout sessions with listing_ids. [TICKET-AB-009]
  //    Holdout sessions always receive empty reorderDirectives.
  //    getTenantSchema() now does Redis cache + SCHEMA_API_URL fallback. [TICKET-AB-011]
  const listingIds = parsed.data.listing_ids;
  let reorderDirective: ReorderDirective | null = null;
  if (!isHoldout && listingIds && listingIds.length > 0) {
    // Build TenantSchemaEnv omitting undefined values (exactOptionalPropertyTypes).
    const schemaEnv: TenantSchemaEnv = {};
    if (env.UPSTASH_REDIS_URL !== undefined) schemaEnv.UPSTASH_REDIS_URL = env.UPSTASH_REDIS_URL;
    if (env.UPSTASH_REDIS_TOKEN !== undefined)
      schemaEnv.UPSTASH_REDIS_TOKEN = env.UPSTASH_REDIS_TOKEN;
    if (env.SCHEMA_API_URL !== undefined) schemaEnv.SCHEMA_API_URL = env.SCHEMA_API_URL;
    if (env.SCHEMA_API_TOKEN !== undefined) schemaEnv.SCHEMA_API_TOKEN = env.SCHEMA_API_TOKEN;
    const tenantSchema = await getTenantSchema(tenant_id, schemaEnv);
    if (tenantSchema?.reorder_capable) {
      reorderDirective = buildReorderDirective(tenantSchema, listingIds, archetype, confidence);
    }
  }

  const body: AdaptResponse = {
    session_id,
    archetype,
    confidence,
    directives: isHoldout ? [] : directives,
    ttl_seconds: 300,
    source,
    // AC-3: holdout_group is absent when assignment was skipped.
    ...(assignment.skipped ? {} : { holdout_group: assignment.holdout_group }),
    // Forward similarity from SDK intent engine when provided. [TICKET-FIX-015]
    ...(inputSimilarity !== undefined ? { similarity: inputSimilarity } : {}),
    // ReorderDirective list — empty array for holdout or non-reorder-capable tenants.
    reorderDirectives: reorderDirective !== null ? [reorderDirective] : [],
  };

  return Response.json(body, { status: 200 });
}
