/**
 * Chat-intent shadow cache helpers — Upstash Redis read for the chat NLP prior
 * bridge (FOLLOW-101 / Master Design §D.1.1).
 *
 * Redis key format: `shadow:{tenant_id}:{session_id}:chat_intent`
 *
 * Written by Modal `process_chat_message` (FOLLOW-087) after processing a
 * `chat.message.sent` event. Read here by the `/api/adapt` route on every
 * adapt call so the SDK can apply `applyChatIntentPrior` with the chat-derived
 * dimension map.
 *
 * Failure posture (AC-1): any Redis read failure is fail-open — returns null
 * with a console.warn. The adapt response proceeds normally; `chat_intent_dimensions`
 * is absent from the response body when the key is not found or a failure occurs.
 *
 * Reuses the same `getRedisBase` + `getRedisHeaders` pattern as description-cache.ts
 * (same Upstash connection env vars: UPSTASH_REDIS_URL + UPSTASH_REDIS_TOKEN).
 *
 * @module apps/control-plane/src/lib/chat-intent-cache
 */

// ─── TypeScript mirror of ChatIntentDetectedPayload (FOLLOW-087 / schemas.py) ─

/**
 * Mirror of the Python `ChatIntentDetectedPayload` Pydantic model from
 * `apps/intent-engine/src/schemas.py`. Kept in TypeScript for the control-plane
 * to parse the Redis value without a cross-language import.
 *
 * Only the fields consumed by the bridge are declared; `passthrough` behaviour
 * is achieved by runtime JSON.parse + extract (not Zod strict).
 */
interface ShadowChatIntentDimensions {
  purchase_purpose?: string | null;
  urgency?: string | null;
  budget_band?: string | null;
  family_stage?: string | null;
  geo_priority?: string | null;
  feature_priority?: string | null;
  cross_border?: string | null;
  finance_complexity?: string | null;
  decision_role?: string | null;
  risk_appetite?: string | null;
  emotional_state?: string | null;
  tax_aware?: boolean | null;
}

export interface ShadowChatIntent {
  intent_dimensions: ShadowChatIntentDimensions;
  archetype_hint?: string;
  confidence?: number;
}

// ─── Key builder ─────────────────────────────────────────────────────────────

/**
 * Build the Redis key for a shadow chat-intent entry.
 *
 * @param tenantId  - Tenant UUID.
 * @param sessionId - Session identifier.
 * @returns Redis key: `shadow:{tenantId}:{sessionId}:chat_intent`
 */
export function shadowChatIntentKey(tenantId: string, sessionId: string): string {
  return `shadow:${tenantId}:${sessionId}:chat_intent`;
}

// ─── Internal Upstash HTTP helpers (mirrors description-cache.ts) ─────────────

function getRedisBase(): string | null {
  const url = process.env.UPSTASH_REDIS_URL;
  return url ? url.replace(/\/$/, '') : null;
}

function getRedisHeaders(): Record<string, string> {
  const token = process.env.UPSTASH_REDIS_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Read the shadow chat-intent entry from Upstash Redis.
 *
 * Fail-open: returns null (without throwing) when:
 *   - Redis is not configured (UPSTASH_REDIS_URL absent)
 *   - Key does not exist
 *   - Network error or non-200 response
 *   - Value is not valid JSON or does not have intent_dimensions
 *
 * @param tenantId  - Tenant UUID.
 * @param sessionId - Session identifier.
 * @returns Parsed ShadowChatIntent or null.
 */
export async function readShadowChatIntent(
  tenantId: string,
  sessionId: string,
): Promise<ShadowChatIntent | null> {
  const base = getRedisBase();
  if (!base) return null;

  const key = shadowChatIntentKey(tenantId, sessionId);

  try {
    const path = ['get', key].map((a) => encodeURIComponent(a)).join('/');
    const res = await fetch(`${base}/${path}`, {
      method: 'GET',
      headers: getRedisHeaders(),
    });
    if (!res.ok) return null;

    const envelope = (await res.json()) as { result: string | null } | null;
    if (envelope?.result == null) return null;

    const parsed = JSON.parse(envelope.result) as unknown;

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'intent_dimensions' in parsed &&
      typeof (parsed as Record<string, unknown>).intent_dimensions === 'object' &&
      (parsed as Record<string, unknown>).intent_dimensions !== null
    ) {
      return parsed as ShadowChatIntent;
    }
    return null;
  } catch (err: unknown) {
    console.warn(
      '[adapt] shadow chat-intent Redis read failed (fail-open):',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Flatten `ShadowChatIntent.intent_dimensions` into a `Record<string, string>` suitable
 * for `applyChatIntentPrior`.
 *
 * Rules (AC-1):
 *   - Skip null / undefined values.
 *   - `tax_aware: true`  → `'tax_aware': 'true'`
 *   - `tax_aware: false` → omitted (false = unknown / no signal).
 *   - All other string values are included as-is when non-empty.
 *
 * @param dims - Raw `intent_dimensions` object from the shadow key.
 * @returns Flat string map, may be empty if all dimensions are null/undefined.
 */
export function flattenIntentDimensions(dims: ShadowChatIntentDimensions): Record<string, string> {
  const result: Record<string, string> = {};

  const entries = Object.entries(dims) as [string, string | boolean | null | undefined][];
  for (const [key, value] of entries) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'boolean') {
      // Only include tax_aware when true; false = unknown / no signal.
      if (value) result[key] = 'true';
    } else if (typeof value === 'string' && value.length > 0) {
      result[key] = value;
    }
  }

  return result;
}
