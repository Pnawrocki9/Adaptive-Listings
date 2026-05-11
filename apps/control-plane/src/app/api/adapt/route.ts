/**
 * GET /api/adapt
 *
 * Decision API — returns personalized adaptation directives for the given session.
 *
 * Implements the decision tree from Master Design E.1:
 *   1. confidence <= 0.6  → default (no adaptation)
 *   2. similarity > 0.85  → use pre-computed archetype playbook  (source: 'playbook')
 *   3. 0.6 < similarity <= 0.85 → playbook + flag for LLM tweak (source: 'llm_tweaked', ADP-002)
 *   4. similarity <= 0.6  → flag for full LLM decision            (source: 'llm_full', ADP-002)
 *
 * Sprint 7 scope: Tier 1 only. Tier 2/3 mutations handled in later sprints.
 *
 * Playbook lookup: uses a local stub in ADP-001. ADP-003 replaces `playbook-stub.ts`
 * with an import from `@estalara/sdk/playbooks` containing real per-archetype data.
 *
 * ClickHouse logging is fire-and-forget — the response is returned immediately
 * and the analytics insert happens asynchronously.
 *
 * @module apps/control-plane/src/app/api/adapt/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { errorBody, ErrorCode } from '@estalara/shared';
import type { AdaptationDirectives, TextDirective, ArchetypeId } from '@estalara/shared';
import { getPlaybook } from './playbook-stub';

// ─── Constants ────────────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.6;
const HIGH_SIMILARITY_THRESHOLD = 0.85;
const LOW_SIMILARITY_THRESHOLD = 0.6;

// ─── Decision logic ───────────────────────────────────────────────────────────

/**
 * Run the adaptation decision tree per Master Design E.1.
 *
 * @param archetypeId - Archetype matched by the intent engine.
 * @param confidence  - Intent confidence 0–1.
 * @param similarity  - Cosine similarity to the matched archetype 0–1.
 * @returns Partial adaptation result (directives + source).
 */
function runDecisionTree(
  archetypeId: ArchetypeId,
  confidence: number,
  similarity: number,
): {
  directives: TextDirective[];
  source: AdaptationDirectives['source'];
} {
  // Branch 1: confidence too low — no adaptation
  if (confidence <= CONFIDENCE_THRESHOLD) {
    return { directives: [], source: 'default' };
  }

  // Branch 4: similarity too low — flag for full LLM decision (ADP-002 handles this)
  if (similarity <= LOW_SIMILARITY_THRESHOLD) {
    return { directives: [], source: 'llm_full' };
  }

  // Fetch playbook (stub in ADP-001; real data in ADP-003)
  const playbook = getPlaybook(archetypeId);

  // Convert playbook slots → TextDirectives
  const directives: TextDirective[] = playbook.slots.map((s) => ({
    type: 'text' as const,
    slot: s.slot,
    value: s.value,
    archetype: archetypeId,
    confidence,
  }));

  // Branch 2: high similarity — use playbook directly
  if (similarity > HIGH_SIMILARITY_THRESHOLD) {
    return { directives, source: 'playbook' };
  }

  // Branch 3: medium similarity — playbook base + mark for LLM tweak (ADP-002)
  return { directives, source: 'llm_tweaked' };
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

// ─── Route handler ────────────────────────────────────────────────────────────

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
export function GET(req: NextRequest): NextResponse {
  const requestId = crypto.randomUUID();
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
  const { directives, source } = runDecisionTree(archetypeId, confidence, similarity);

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
  const tenantId = req.headers.get('x-tenant-id') ?? 'unknown';
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
