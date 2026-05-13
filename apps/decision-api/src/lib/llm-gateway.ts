/**
 * LLM Gateway — thin wrapper around the LiteLLM router.
 *
 * Responsibilities:
 *   - Forward generation requests to the LiteLLM gateway (LITELLM_BASE_URL env).
 *   - Track estimated per-tenant daily spend via an in-memory counter.
 *   - Enforce a configurable daily cap (LLM_DAILY_CAP_USD, default $1.00 / tenant / day).
 *
 * Edge-compatible — uses `fetch` only, no Node.js APIs.
 *
 * In-memory counters reset on Worker restart, which is acceptable for MVP.
 * Sprint 9 replaces this with Upstash Redis for persistent cross-instance tracking.
 *
 * Cost model (rough estimate, Haiku 4.5):
 *   $0.00025 per 1K input tokens  →  0.00000025 USD per input token
 *
 * @module apps/decision-api/src/lib/llm-gateway
 */

// ─── Cost constants ───────────────────────────────────────────────────────────

/** Estimated cost in USD per input token for Claude Haiku 4.5 (rough estimate). */
const COST_PER_INPUT_TOKEN_USD = 0.00000025; // $0.00025 / 1K tokens

// ─── In-memory spend tracker ──────────────────────────────────────────────────

/**
 * Key: `{tenant_id}:{YYYY-MM-DD}` (UTC date)
 * Value: accumulated estimated spend in USD for that tenant on that day.
 *
 * Resets naturally on Worker restart; acceptable for MVP.
 */
const spendTracker = new Map<string, number>();

/** Returns today's UTC date string in YYYY-MM-DD format. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Returns the tracker key for a given tenant and date. */
function trackerKey(tenantId: string, date: string): string {
  return `${tenantId}:${date}`;
}

/**
 * Returns the current accumulated spend in USD for the given tenant today.
 * Exported for testing.
 */
export function getTenantSpend(tenantId: string): number {
  const key = trackerKey(tenantId, todayUtc());
  return spendTracker.get(key) ?? 0;
}

/**
 * Resets the spend counter for a tenant (for testing only).
 * @internal
 */
export function resetTenantSpend(tenantId: string): void {
  const key = trackerKey(tenantId, todayUtc());
  spendTracker.delete(key);
}

/**
 * Records estimated spend for a tenant based on input token count.
 */
export function recordSpend(tenantId: string, inputTokens: number): void {
  const key = trackerKey(tenantId, todayUtc());
  const previous = spendTracker.get(key) ?? 0;
  spendTracker.set(key, previous + inputTokens * COST_PER_INPUT_TOKEN_USD);
}

// ─── Cap check ────────────────────────────────────────────────────────────────

/**
 * Returns true if the tenant has exceeded their daily LLM spend cap.
 */
export function isDailyCapExceeded(tenantId: string, dailyCapUsd: number): boolean {
  return getTenantSpend(tenantId) >= dailyCapUsd;
}

// ─── LLM call ─────────────────────────────────────────────────────────────────

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmGatewayOptions {
  tenantId: string;
  messages: LlmMessage[];
  model?: string;
  /** Maximum input tokens to count for spend estimation (default: sum of message lengths / 4). */
  estimatedInputTokens?: number;
  /** Daily cap in USD from env — if undefined, no cap is enforced. */
  dailyCapUsd?: number;
  /** LiteLLM base URL. */
  baseUrl?: string;
  /** LiteLLM master key. */
  apiKey?: string;
}

export interface LlmGatewayResult {
  content: string;
  /** Estimated input tokens used (may be an approximation). */
  inputTokensUsed: number;
}

/** Shape of the LiteLLM /chat/completions response we care about. */
interface LiteLlmResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number };
}

/**
 * Calls the LiteLLM gateway if the tenant has not exceeded their daily cap.
 *
 * Returns `null` when:
 *   - The daily cap is exceeded (caller should fall back to static playbook)
 *   - The gateway returns a non-2xx response
 *   - The gateway times out (>200ms — CF Worker budget)
 */
export async function callLlmGateway(options: LlmGatewayOptions): Promise<LlmGatewayResult | null> {
  const { tenantId, messages, model = 'claude-haiku-4-5', dailyCapUsd, baseUrl, apiKey } = options;

  // Estimate input tokens (rough: chars / 4)
  const estimatedInputTokens =
    options.estimatedInputTokens ??
    Math.ceil(messages.reduce((acc, m) => acc + m.content.length, 0) / 4);

  // 1. Enforce daily cap if configured
  if (dailyCapUsd !== undefined && isDailyCapExceeded(tenantId, dailyCapUsd)) {
    return null;
  }

  // 2. Bail early if no gateway is configured (local dev without LiteLLM)
  if (!baseUrl || !apiKey) {
    return null;
  }

  // 3. Call LiteLLM (CF-compatible fetch, abort after 200ms to stay within latency budget)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 200);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const data: LiteLlmResponse = await response.json();

    const content = data.choices?.[0]?.message?.content ?? '';
    const actualInputTokens = data.usage?.prompt_tokens ?? estimatedInputTokens;

    // 4. Record spend after a successful call
    recordSpend(tenantId, actualInputTokens);

    return { content, inputTokensUsed: actualInputTokens };
  } catch {
    // AbortError (timeout) or network error — fall through to null
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
