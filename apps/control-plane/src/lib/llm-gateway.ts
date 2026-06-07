/**
 * LLM Gateway — routes adaptation decisions through Claude Haiku or Sonnet.
 *
 * Routing policy (per ADP-002 spec):
 *   similarity > 0.85       → no LLM call (playbook path, not this module)
 *   0.6 < similarity ≤ 0.85 → Haiku 4.5: tweak 1-2 directives (low-latency path; stays Haiku)
 *   similarity ≤ 0.6, conf > 0.6 → global default model: full directive generation (FOLLOW-161)
 *   confidence ≤ 0.6        → no LLM call (default path, not this module)
 *
 * Model precedence for the full-generation path (similarity ≤ 0.6):
 *   1. forceModel (DEMO MODE, DEMO-001) — highest precedence, bypasses all routing.
 *   2. getGlobalGenerationModel() (FOLLOW-161) — admin-configured global default.
 *   3. SONNET_MODEL constant — static fallback when DB returns the default.
 *
 * The Haiku tweak path (0.6 < similarity ≤ 0.85) always stays Haiku regardless of
 * forceModel or the global config. It is the low-latency path and its model is not
 * user-selectable.
 *
 * Chat/intent classifier note (AC4 / FOLLOW-087):
 *   The real-time chat/intent classifier model is NOT user-selectable and stays
 *   Haiku-class. Its <500ms latency budget constrains it to a Haiku-class model.
 *   It is not wired through this gateway.
 *
 * Circuit breaker: $100/day rolling 24h spend cap via ClickHouse llm_calls table.
 * Returns null on: missing API key, cap hit, or any Anthropic API error.
 *
 * @module apps/control-plane/src/lib/llm-gateway
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { ArchetypeId, TextDirective } from '@estalara/shared';
import type { PlaybookEntry } from '@estalara/sdk/playbooks';
import { getGlobalGenerationModel } from '@/lib/global-config-store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LlmGatewayInput {
  archetypeId: ArchetypeId;
  confidence: number;
  similarity: number;
  basePlaybook: PlaybookEntry;
  sessionContext?: {
    recentEvents?: string[];
    quizAnswers?: { purpose: string; horizon: string };
  };
  /**
   * Agency-curated listing metadata, keyed by field name.
   * Populated by RAG retrieval in the adapt route (TICKET-AGENCY-001).
   * When non-empty, prompt builders append a "Listing context" block that
   * instructs the LLM to substitute placeholder tokens (e.g. `{yield}`).
   */
  listingContext?: Record<string, string>;
  /** Session ID for per-session LLM cost attribution in ClickHouse [F-10]. */
  sessionId?: string;
  /** Tenant ID for per-tenant LLM cost attribution in ClickHouse [F-10]. */
  tenantId?: string;
  /**
   * Force a specific Anthropic model ID, bypassing the similarity-based routing
   * policy. Used by DEMO MODE (DEMO-001) when the operator selects a model from
   * the admin UI. Must be one of the curated DEMO_ALLOWED_MODELS.
   * When null/undefined, the standard routing policy applies.
   */
  forceModel?: string;
}

export interface LlmGatewayOutput {
  directives: TextDirective[];
  /** Actual Anthropic model ID used (may be forceModel from DEMO MODE). */
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HAIKU_MODEL = 'claude-haiku-4-5' as const;
const SONNET_MODEL = 'claude-sonnet-4-6' as const;

/** Cost per 1K tokens in USD (approximate list pricing, adjust as needed). */
const COST_PER_1K_INPUT: Record<string, number> = {
  [HAIKU_MODEL]: 0.00025,
  [SONNET_MODEL]: 0.003,
};
const COST_PER_1K_OUTPUT: Record<string, number> = {
  [HAIKU_MODEL]: 0.00125,
  [SONNET_MODEL]: 0.015,
};

const DAILY_SPEND_CAP_USD = 100;
const DAILY_WARN_USD = 90;

// ---------------------------------------------------------------------------
// Zod schema for LLM response validation
// ---------------------------------------------------------------------------

const TextDirectiveSchema = z.object({
  type: z.literal('text'),
  slot: z.string().min(1),
  value: z.string().min(1),
  archetype: z.string(),
  confidence: z.number().min(0).max(1),
});

// ---------------------------------------------------------------------------
// Circuit breaker — ClickHouse rolling 24h spend check
// ---------------------------------------------------------------------------

async function getRolling24hSpend(): Promise<number> {
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  if (!clickhouseUrl) return 0;

  const clickhousePassword = process.env.CLICKHOUSE_PASSWORD ?? '';
  const query = `SELECT sum(cost_usd) as total FROM llm_calls WHERE ts >= now() - INTERVAL 1 DAY FORMAT JSON`;

  try {
    const res = await fetch(clickhouseUrl, {
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
    });

    if (!res.ok) return 0;

    const json = (await res.json()) as { data?: { total?: string }[] };
    const total = parseFloat(json.data?.[0]?.total ?? '0');
    return isNaN(total) ? 0 : total;
  } catch {
    // If we can't check, allow the call (fail open — better than blocking legitimate traffic)
    return 0;
  }
}

// ---------------------------------------------------------------------------
// ClickHouse logging
// ---------------------------------------------------------------------------

function logLlmCallAsync(params: {
  sessionId: string;
  tenantId: string;
  archetypeId: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  source: string;
}): void {
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  if (!clickhouseUrl) return;

  const clickhousePassword = process.env.CLICKHOUSE_PASSWORD ?? '';
  const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');
  // ANSI SQL '' doubling — consistent with clickhouse-dsr.ts (FOLLOW-206)
  const escape = (s: string) => s.replace(/'/g, "''");

  const query =
    `INSERT INTO llm_calls ` +
    `(session_id, tenant_id, archetype, model, tokens_in, tokens_out, cost_usd, latency_ms, source, ts) ` +
    `VALUES ('${escape(params.sessionId)}', '${escape(params.tenantId)}', ` +
    `'${escape(params.archetypeId)}', '${escape(params.model)}', ` +
    `${String(params.tokensIn)}, ${String(params.tokensOut)}, ${String(params.costUsd)}, ` +
    `${String(params.latencyMs)}, '${escape(params.source)}', '${ts}')`;

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
    console.error('[llm-gateway] ClickHouse log failed:', err instanceof Error ? err.message : err);
  });
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildListingContextBlock(listingContext: Record<string, string>): string {
  const entries = Object.entries(listingContext);
  if (entries.length === 0) return '';
  const lines = entries.map(([k, v]) => `${k}: ${v}`).join('\n');
  return (
    `\nListing context (agency-provided):\n` +
    `${lines}\n` +
    `Use this data to fill placeholder tokens in copy (e.g., replace {yield} with the\n` +
    `value from "yield" context key). If a key is missing, omit the token rather than\n` +
    `guessing.\n`
  );
}

function buildHaikuPrompt(input: LlmGatewayInput): string {
  const { archetypeId, basePlaybook, sessionContext, listingContext } = input;
  const baseDirectivesJson = JSON.stringify(
    basePlaybook.slots.map((s) => ({
      type: 'text',
      slot: s.slot,
      value: s.en,
      archetype: archetypeId,
      confidence: input.confidence,
    })),
  );

  const signals = basePlaybook.signals.slice(0, 5).join(', ');
  const recentEvents = sessionContext?.recentEvents?.slice(0, 5).join(', ') ?? 'none';
  const contextBlock =
    listingContext && Object.keys(listingContext).length > 0
      ? buildListingContextBlock(listingContext)
      : '';

  return (
    `You are an AI adapting real estate listing descriptions for a specific buyer archetype.\n` +
    `Archetype: ${archetypeId} — ${basePlaybook.description}\n` +
    `Signals: ${signals}\n` +
    `Current directives (JSON): ${baseDirectivesJson}\n` +
    `Buyer's recent actions: ${recentEvents}\n` +
    contextBlock +
    `\nReturn a JSON array of TextDirective objects that improve upon the current directives.\n` +
    `Keep slot names unchanged. Output JSON only, no explanation.\n` +
    `Schema: [{"type":"text","slot":"<slot>","value":"<value>","archetype":"${archetypeId}","confidence":<float>}]`
  );
}

function buildSonnetPrompt(input: LlmGatewayInput): string {
  const { archetypeId, basePlaybook, sessionContext, listingContext } = input;
  const signals = basePlaybook.signals.slice(0, 8).join(', ');
  const recentEvents = sessionContext?.recentEvents?.slice(0, 5).join(', ') ?? 'none';
  const quizAnswers = sessionContext?.quizAnswers
    ? `purpose: ${sessionContext.quizAnswers.purpose}, horizon: ${sessionContext.quizAnswers.horizon}`
    : 'not provided';
  const contextBlock =
    listingContext && Object.keys(listingContext).length > 0
      ? buildListingContextBlock(listingContext)
      : '';

  return (
    `You are an AI generating real estate listing adaptations for a specific buyer archetype.\n` +
    `Archetype: ${archetypeId} — ${basePlaybook.description}\n` +
    `Signals that define this archetype: ${signals}\n` +
    `Available slots: headline, cta, feature\n` +
    `Buyer's recent actions: ${recentEvents}\n` +
    `Quiz answers: ${quizAnswers}\n` +
    contextBlock +
    `\nGenerate 2-3 TextDirective objects that would resonate with this buyer.\n` +
    `Output JSON only.\n` +
    `Schema: [{"type":"text","slot":"<slot>","value":"<value>","archetype":"${archetypeId}","confidence":<float>}]`
  );
}

// ---------------------------------------------------------------------------
// Parse and validate LLM response
// ---------------------------------------------------------------------------

function parseDirectivesFromResponse(
  text: string,
  archetypeId: ArchetypeId,
): TextDirective[] | null {
  try {
    // Extract JSON array from response (model may include surrounding text)
    const match = /\[[\s\S]*\]/.exec(text);
    if (!match) return null;

    const parsed: unknown = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return null;

    const result: TextDirective[] = [];
    for (const item of parsed) {
      const validated = TextDirectiveSchema.safeParse(item);
      if (validated.success) {
        result.push({
          ...validated.data,
          archetype: archetypeId,
        });
      }
    }

    return result.length > 0 ? result : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Compute cost
// ---------------------------------------------------------------------------

function computeCost(model: string, tokensIn: number, tokensOut: number): number {
  const inputCost = (tokensIn / 1000) * (COST_PER_1K_INPUT[model] ?? 0.001);
  const outputCost = (tokensOut / 1000) * (COST_PER_1K_OUTPUT[model] ?? 0.005);
  return Math.round((inputCost + outputCost) * 1e6) / 1e6; // 6 decimal places
}

// ---------------------------------------------------------------------------
// Main gateway function
// ---------------------------------------------------------------------------

let _client: Anthropic | null = null;
let _startupWarningLogged = false;

function getClient(): Anthropic | null {
  if (_client) return _client;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    if (!_startupWarningLogged) {
      console.warn(
        '[llm-gateway] ANTHROPIC_API_KEY not set — LLM gateway disabled. Fallback to playbook.',
      );
      _startupWarningLogged = true;
    }
    return null;
  }

  _client = new Anthropic({ apiKey });
  return _client;
}

/**
 * Call the LLM gateway to generate or tweak adaptation directives.
 *
 * Returns null on: missing API key, circuit breaker triggered ($100/day cap),
 * or any Anthropic API error.
 *
 * The caller is responsible for falling back to playbook directives on null.
 */
export async function callLlmGateway(input: LlmGatewayInput): Promise<LlmGatewayOutput | null> {
  const client = getClient();
  if (!client) return null;

  const { confidence, similarity } = input;

  // Select model using precedence chain:
  //   1. forceModel (DEMO MODE, DEMO-001) — bypasses all routing.
  //   2. Haiku (low-latency tweak path) — when 0.6 < similarity ≤ 0.85.
  //      This path is NOT affected by the global config (FOLLOW-161):
  //      it is the real-time latency-sensitive path; its model is not selectable.
  //   3. getGlobalGenerationModel() (FOLLOW-161) — admin-configured global default
  //      for the full-generation path (similarity ≤ 0.6).
  let model: string;
  if (input.forceModel) {
    // DEMO MODE takes absolute precedence (DEMO-001).
    model = input.forceModel;
  } else if (similarity > 0.6 && similarity <= 0.85) {
    // Low-latency Haiku tweak path — stays Haiku, not selectable.
    model = HAIKU_MODEL;
  } else {
    // Full-generation path — use admin-configured global default (FOLLOW-161).
    // getGlobalGenerationModel() returns the default on DB absence/error, so
    // this path never hard-fails even when config DB is unavailable.
    model = await getGlobalGenerationModel();
  }

  // Circuit breaker: check rolling 24h spend
  const currentSpend = await getRolling24hSpend();

  if (currentSpend >= DAILY_SPEND_CAP_USD) {
    console.warn(
      `[llm-gateway] Daily spend cap reached ($${currentSpend.toFixed(2)} >= $${DAILY_SPEND_CAP_USD.toFixed(0)}). Returning null.`,
    );
    return null;
  }

  if (currentSpend >= DAILY_WARN_USD) {
    console.warn(
      `[llm-gateway] Daily spend approaching cap: $${currentSpend.toFixed(2)} / $${DAILY_SPEND_CAP_USD.toFixed(0)}`,
    );
  }

  // Build prompt — use haiku-style for haiku, sonnet-style for all others.
  const prompt = model === HAIKU_MODEL ? buildHaikuPrompt(input) : buildSonnetPrompt(input);

  const startMs = Date.now();

  try {
    const message = await client.messages.create({
      // Pass model string directly. For DEMO MODE forceModel this is e.g.
      // 'claude-opus-4-8' or 'claude-haiku-4-5-20251001'.
      model,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    const latencyMs = Date.now() - startMs;
    const tokensIn = message.usage.input_tokens;
    const tokensOut = message.usage.output_tokens;
    const costUsd = computeCost(model, tokensIn, tokensOut);

    // Extract text from response
    const textBlock = message.content.find((b) => b.type === 'text');
    if (!textBlock) {
      console.warn('[llm-gateway] No text block in Anthropic response');
      return null;
    }

    const responseText = 'text' in textBlock ? textBlock.text : null;
    if (!responseText) {
      console.warn('[llm-gateway] No text content in Anthropic response block');
      return null;
    }

    const directives = parseDirectivesFromResponse(responseText, input.archetypeId);
    if (!directives) {
      console.warn('[llm-gateway] Failed to parse directives from LLM response');
      return null;
    }

    const output: LlmGatewayOutput = {
      directives,
      model,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_usd: costUsd,
      latency_ms: latencyMs,
    };

    // Log to ClickHouse (fire-and-forget)
    logLlmCallAsync({
      sessionId: input.sessionId ?? 'unknown',
      tenantId: input.tenantId ?? 'unknown',
      archetypeId: input.archetypeId,
      model,
      tokensIn,
      tokensOut,
      costUsd,
      latencyMs,
      source: model === HAIKU_MODEL ? 'llm_tweaked' : 'llm_full',
    });

    // Attach confidence from input confidence score
    const outputWithConfidence = {
      ...output,
      directives: directives.map((d) => ({ ...d, confidence })),
    };

    return outputWithConfidence;
  } catch (err) {
    console.error('[llm-gateway] Anthropic API error:', err instanceof Error ? err.message : err);
    return null;
  }
}
