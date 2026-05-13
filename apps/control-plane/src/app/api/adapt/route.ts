/**
 * GET /api/adapt
 *
 * Decision API — returns personalized adaptation directives for the given session.
 *
 * Implements the decision tree from Master Design E.1:
 *   1. confidence <= 0.6  → default (no adaptation)
 *   2. similarity > 0.85  → use pre-computed archetype playbook  (source: 'playbook')
 *   3. 0.6 < similarity <= 0.85 → Haiku LLM tweak  (source: 'llm_tweaked', ADP-002)
 *   4. similarity <= 0.6, conf > 0.6 → Sonnet full gen (source: 'llm_full', ADP-002)
 *
 * Sprint 7 Phase 2: LLM gateway wired for branches 3 and 4 (ADP-002).
 * On gateway failure (null return), falls back to:
 *   - llm_tweaked: playbook directives + source 'playbook_fallback_llm_unavailable'
 *   - llm_full: empty directives + source 'playbook_fallback_llm_unavailable'
 *   - cap hit: source 'playbook_fallback_llm_capped'
 *
 * POST /api/adapt
 *
 * Demo-mode adaptation endpoint. Accepts a JSON body with archetype hint,
 * confidence, similarity, and session context. Requires a non-empty
 * Authorization: Bearer header (presence-only auth for demo mode).
 *
 * ClickHouse logging is fire-and-forget — the response is returned immediately
 * and the analytics insert happens asynchronously.
 *
 * @module apps/control-plane/src/app/api/adapt/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { errorBody, ErrorCode } from '@estalara/shared';
import type { AdaptationDirectives, TextDirective, ArchetypeId } from '@estalara/shared';
import { getPlaybook } from '@estalara/sdk/playbooks';
import type { SlotDirective } from '@estalara/sdk/playbooks';
import { callLlmGateway } from '@/lib/llm-gateway';
import { getAuthClaims } from '@estalara/auth';

// ─── Constants ────────────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.6;
const HIGH_SIMILARITY_THRESHOLD = 0.85;
const LOW_SIMILARITY_THRESHOLD = 0.6;

// ─── POST body schema ─────────────────────────────────────────────────────────

const AdaptPostBodySchema = z.object({
  tenant_id: z.string().min(1),
  session_id: z.string().min(1),
  page_type: z.enum(['listing_list', 'listing_detail', 'home', 'search']),
  archetype_hint: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  similarity: z.number().min(0).max(1).optional(),
});

// ─── Decision logic ───────────────────────────────────────────────────────────

/**
 * Run the adaptation decision tree per Master Design E.1.
 * Now async: branches 3 and 4 call the LLM gateway (ADP-002).
 *
 * @param archetypeId   - Archetype matched by the intent engine.
 * @param confidence    - Intent confidence 0–1.
 * @param similarity    - Cosine similarity to the matched archetype 0–1.
 * @param sessionId     - Session ID for gateway context.
 * @returns Partial adaptation result (directives + source).
 */
async function runDecisionTree(
  archetypeId: ArchetypeId,
  confidence: number,
  similarity: number,
  _sessionId: string,
): Promise<{
  directives: TextDirective[];
  source: AdaptationDirectives['source'];
}> {
  // Branch 1: confidence too low — no adaptation
  if (confidence <= CONFIDENCE_THRESHOLD) {
    return { directives: [], source: 'default' };
  }

  // Fetch playbook (real data since ADP-003)
  const playbook = getPlaybook(archetypeId);

  // Convert playbook slots → TextDirectives (English locale as canonical value)
  const playbookDirectives: TextDirective[] = playbook.slots.map((s: SlotDirective) => ({
    type: 'text' as const,
    slot: s.slot,
    value: s.en,
    archetype: archetypeId,
    confidence,
  }));

  // Branch 2: high similarity — use playbook directly (no LLM)
  if (similarity > HIGH_SIMILARITY_THRESHOLD) {
    return { directives: playbookDirectives, source: 'playbook' };
  }

  // Branch 4: similarity too low — full LLM generation
  if (similarity <= LOW_SIMILARITY_THRESHOLD) {
    const gatewayResult = await callLlmGateway({
      archetypeId,
      confidence,
      similarity,
      basePlaybook: playbook,
    });

    if (gatewayResult) {
      return { directives: gatewayResult.directives, source: 'llm_full' };
    }

    // Gateway returned null — check if it was a cap issue (logged in gateway)
    return { directives: [], source: 'playbook_fallback_llm_unavailable' };
  }

  // Branch 3: medium similarity — Haiku LLM tweak of playbook
  const gatewayResult = await callLlmGateway({
    archetypeId,
    confidence,
    similarity,
    basePlaybook: playbook,
  });

  if (gatewayResult) {
    return { directives: gatewayResult.directives, source: 'llm_tweaked' };
  }

  // Gateway returned null — fall back to playbook directives
  return { directives: playbookDirectives, source: 'playbook_fallback_llm_unavailable' };
}

// ─── ClickHouse logging (fire-and-forget) ─────────────────────────────────────

function logDecisionAsync(
  sessionId: string,
  tenantId: string,
  archetype: string,
  confidence: number,
  similarity: number,
  source: string,
  tier: number,
  directiveCount: number,
): void {
  // Fire-and-forget — never awaited, never blocks the response.
  // No-op when CLICKHOUSE_URL is not configured.
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  if (!clickhouseUrl) return;

  const clickhousePassword = process.env.CLICKHOUSE_PASSWORD ?? '';
  const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');

  // Escape single quotes in string values to prevent injection
  const escape = (s: string) => s.replace(/'/g, "\\'");

  const query =
    `INSERT INTO adaptation_decisions ` +
    `(session_id, tenant_id, archetype, confidence, similarity, source, tier, directive_count, ts) ` +
    `VALUES ('${escape(sessionId)}', '${escape(tenantId)}', '${escape(archetype)}', ` +
    `${String(confidence)}, ${String(similarity)}, '${escape(source)}', ${String(tier)}, ${String(directiveCount)}, '${ts}')`;

  fetch(clickhouseUrl, {
    method: 'POST',
    body: query,
    headers: {
      'Content-Type': 'text/plain',
      ...(clickhousePassword
        ? {
            Authorization: `Basic ${Buffer.from(`:${clickhousePassword}`).toString('base64')}`,
          }
        : {}),
    },
  }).catch((err: unknown) => {
    // Analytics failures must not surface to callers
    console.error('[adapt] ClickHouse log failed:', err instanceof Error ? err.message : err);
  });
}

// ─── GET handler ──────────────────────────────────────────────────────────────

/**
 * GET /api/adapt
 *
 * Query params:
 *   session_id  — required, string
 *   archetype   — required, ArchetypeId string
 *   confidence  — required, float 0–1
 *   similarity  — required, float 0–1
 *   tier        — required, 1 | 2 | 3
 *
 * @returns 200 AdaptationDirectives JSON on valid params, even when source is 'default'.
 * @returns 400 ErrorResponseBody on invalid or missing params.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const requestId = crypto.randomUUID();

  // ── Auth gate — same pattern as decision-api Worker ───────────────────────
  const auth = req.headers.get('Authorization') ?? req.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) {
    return NextResponse.json(
      errorBody({
        code: ErrorCode.AUTH_REQUIRED,
        message: 'Authorization: Bearer <key> header is required',
        requestId,
      }),
      { status: 401 },
    );
  }
  const adaptApiKey = process.env.ADAPT_API_KEY;
  if (adaptApiKey && token !== adaptApiKey) {
    return NextResponse.json(
      errorBody({
        code: ErrorCode.FORBIDDEN,
        message: 'Invalid API key',
        requestId,
      }),
      { status: 401 },
    );
  }
  // When ADAPT_API_KEY is unset: presence-only auth (non-empty token is sufficient — backward compat with dev)

  const params = req.nextUrl.searchParams;

  // ── Parameter validation ──────────────────────────────────────────────────
  const sessionId = params.get('session_id');
  const archetypeRaw = params.get('archetype');
  const confidenceRaw = params.get('confidence');
  const similarityRaw = params.get('similarity');
  const tierRaw = params.get('tier');

  if (!sessionId || !archetypeRaw || confidenceRaw === null || similarityRaw === null || !tierRaw) {
    return NextResponse.json(
      errorBody({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Missing required parameters: session_id, archetype, confidence, similarity, tier',
        requestId,
        details: {
          required: ['session_id', 'archetype', 'confidence', 'similarity', 'tier'],
          received: Object.fromEntries(params.entries()),
        },
      }),
      { status: 400 },
    );
  }

  const confidence = parseFloat(confidenceRaw);
  const similarity = parseFloat(similarityRaw);
  const tier = parseInt(tierRaw, 10);

  if (isNaN(confidence) || confidence < 0 || confidence > 1) {
    return NextResponse.json(
      errorBody({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Parameter "confidence" must be a float between 0 and 1',
        requestId,
        details: { received: confidenceRaw },
      }),
      { status: 400 },
    );
  }

  if (isNaN(similarity) || similarity < 0 || similarity > 1) {
    return NextResponse.json(
      errorBody({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Parameter "similarity" must be a float between 0 and 1',
        requestId,
        details: { received: similarityRaw },
      }),
      { status: 400 },
    );
  }

  if (tier !== 1 && tier !== 2 && tier !== 3) {
    return NextResponse.json(
      errorBody({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Parameter "tier" must be 1, 2, or 3',
        requestId,
        details: { received: tierRaw },
      }),
      { status: 400 },
    );
  }

  // ── Decision tree ─────────────────────────────────────────────────────────
  const archetypeId = archetypeRaw as ArchetypeId;
  const { directives, source } = await runDecisionTree(
    archetypeId,
    confidence,
    similarity,
    sessionId,
  );

  const response: AdaptationDirectives = {
    session_id: sessionId,
    archetype: archetypeId,
    confidence,
    similarity,
    tier,
    directives,
    source,
    generated_at: new Date().toISOString(),
  };

  // ── Fire-and-forget ClickHouse analytics log ──────────────────────────────
  // Prefer JWT-verified tenant_id; fall back to x-tenant-id for SDK calls without JWT.
  const tenantId =
    (await getAuthClaims(req))?.tenant_id ?? req.headers.get('x-tenant-id') ?? 'unknown';
  logDecisionAsync(
    sessionId,
    tenantId,
    archetypeId,
    confidence,
    similarity,
    source,
    tier,
    directives.length,
  );

  return NextResponse.json(response, { status: 200 });
}

// ─── POST handler ─────────────────────────────────────────────────────────────

/**
 * POST /api/adapt
 *
 * Demo-mode adaptation endpoint. Accepts a JSON body and returns AdaptationDirectives.
 * Requires a non-empty Authorization: Bearer header (presence-only check for demo mode).
 *
 * Body:
 *   tenant_id      — required, string
 *   session_id     — required, string
 *   page_type      — required, 'listing_list'|'listing_detail'|'home'|'search'
 *   archetype_hint — optional, ArchetypeId (defaults to 'neutral')
 *   confidence     — optional, float 0–1 (defaults to 0.5)
 *   similarity     — optional, float 0–1 (defaults to 0.5)
 *
 * @returns 200 AdaptationDirectives JSON.
 * @returns 400 on Zod validation failure.
 * @returns 401 if Authorization header is missing or empty.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // Presence-only auth — demo mode requires a non-empty Bearer token
  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) {
    return NextResponse.json(
      { error: 'Unauthorized: Authorization: Bearer <token> required' },
      {
        status: 401,
      },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = AdaptPostBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const body = parsed.data;
  const archetypeId = (body.archetype_hint ?? 'neutral') as ArchetypeId;
  const confidence = body.confidence ?? 0.5;
  const similarity = body.similarity ?? 0.5;

  const { directives, source } = await runDecisionTree(
    archetypeId,
    confidence,
    similarity,
    body.session_id,
  );

  const response: AdaptationDirectives = {
    session_id: body.session_id,
    archetype: archetypeId,
    confidence,
    similarity,
    tier: 1,
    directives,
    source,
    generated_at: new Date().toISOString(),
  };

  // Fire-and-forget ClickHouse log using tenant_id from body
  logDecisionAsync(
    body.session_id,
    body.tenant_id,
    archetypeId,
    confidence,
    similarity,
    source,
    1,
    directives.length,
  );

  return NextResponse.json(response, { status: 200 });
}
