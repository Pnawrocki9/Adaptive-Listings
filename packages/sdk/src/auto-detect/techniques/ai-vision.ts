/**
 * Technique 11 — AI Vision fallback via Claude Sonnet 4.6 (confidence: varies)
 *
 * ARCHITECTURE BOUNDARY — SERVER-SIDE ONLY
 * =========================================
 * This module is intentionally NOT exported from the browser SDK bundle
 * (`packages/sdk/src/auto-detect/techniques/index.ts`) and is NOT imported in
 * `pipeline.ts`. It is called exclusively from the server-side
 * `POST /api/detect` route handler in `apps/control-plane`.
 *
 * Rationale: `@anthropic-ai/sdk` is a Node.js library (~300 KB) that:
 *   1. Requires `ANTHROPIC_API_KEY` from the server environment
 *   2. Must never be bundled into the browser SDK (bundle budget constraint)
 *   3. Must never be called from browser context (API key exposure risk)
 *
 * How it is called (from POST /api/detect):
 * ```typescript
 * if (!result.schema && process.env.ANTHROPIC_API_KEY) {
 *   const { detectAiVision } = await import('@estalara/sdk/auto-detect/ai-vision');
 *   const aiResult = await detectAiVision(html, url);
 *   if (aiResult) result = aiResult;
 * }
 * ```
 *
 * Rate limiting note:
 * The rate limit (max 1 AI Vision call per tenant per 24 h) is enforced at the
 * API layer via the `tenant_site_schemas` Postgres table — NOT here. This module
 * has no Postgres access by design. The caller (POST /api/detect) must check the
 * table before invoking this function.
 *
 * @module @estalara/sdk/auto-detect/techniques/ai-vision
 */

import type { TenantSiteSchema, CardFieldMappings, DataExtractorsPerCard } from '@estalara/shared';
import type { DetectionResult } from '../pipeline.js';

// Declare the Node.js `process` global for this server-side-only module.
// This file is never loaded in the browser. The SDK tsconfig does not include
// @types/node, so we declare the minimal subset we need here.
declare const process: { env: Record<string, string | undefined> };

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const PROMPT_MAX_HTML_BYTES = 50_000; // 50 KB

const VISION_PROMPT = `You are analyzing an HTML page from a real estate website. Identify the listing cards.

Return a JSON object matching this schema:
{
  "listing_card_selector": "CSS selector for individual listing cards",
  "container_selector": "CSS selector for the grid/list container (optional)",
  "price_selector": "CSS selector for price within a card",
  "headline_selector": "CSS selector for property title/headline",
  "bedrooms_selector": "CSS selector for bedroom count (optional)",
  "inquiry_submit_selector": "CSS selector for the inquiry/contact form submit button (optional — only when clearly identifiable)",
  "detection_confidence": 0.0-1.0
}

Rules:
- Use stable selectors: data-* attributes > semantic tags > class-contains patterns
- Never use CSS-in-JS hash classes (random strings like sc-abc123)
- For inquiry_submit_selector: look for button[type=submit] inside a contact/inquiry/enquiry form.
  Only include this field when you are highly confident; omit it entirely rather than guessing.
- Return ONLY valid JSON, no explanation

HTML (first 50KB):
`;

// ---------------------------------------------------------------------------
// Response shape from Claude
// ---------------------------------------------------------------------------

interface AiVisionResponse {
  listing_card_selector?: unknown;
  container_selector?: unknown;
  price_selector?: unknown;
  headline_selector?: unknown;
  bedrooms_selector?: unknown;
  /** CSS selector for inquiry/contact form submit button (FOLLOW-127). */
  inquiry_submit_selector?: unknown;
  detection_confidence?: unknown;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect site schema using Claude Sonnet 4.6 Vision as a last-resort fallback.
 *
 * Called ONLY by `POST /api/detect` when all deterministic techniques (1–10)
 * return `null` or confidence < 0.70.
 *
 * - If `ANTHROPIC_API_KEY` is missing: returns `null` with a warning (no throw).
 * - If JSON parse fails or confidence < 0.5: returns `null`.
 * - If model returns confidence >= 0.5: returns a `DetectionResult` with
 *   `detection_source: 'ai_vision'`.
 *
 * @param html      - Raw HTML string (first 50 KB will be sent to the model).
 * @param url       - Canonical page URL (used for domain/url_patterns inference).
 */
export async function detectAiVision(html: string, url: string): Promise<DetectionResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    // Do not throw — return null gracefully so the caller can handle the
    // absence of the API key without crashing.
    console.warn('[ai-vision] ANTHROPIC_API_KEY not set — skipping AI Vision fallback');
    return null;
  }

  // Truncate HTML to stay within prompt budget.
  const htmlSnippet = truncateToBytes(html, PROMPT_MAX_HTML_BYTES);

  let rawResponse: string;
  try {
    rawResponse = await callAnthropic(apiKey, htmlSnippet);
  } catch (err) {
    console.warn(
      '[ai-vision] Anthropic API call failed:',
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }

  const parsed = parseVisionResponse(rawResponse);
  if (!parsed) return null;

  const confidence =
    typeof parsed.detection_confidence === 'number' ? parsed.detection_confidence : 0;
  if (confidence < 0.5) return null;

  const cardSelector =
    typeof parsed.listing_card_selector === 'string' ? parsed.listing_card_selector : null;
  if (!cardSelector) return null;

  const domain = extractDomain(url);
  const urlObj = tryParseUrl(url);
  const indexPatterns = urlObj ? [`${urlObj.origin}/**`] : ['/**'];
  const detailPatterns = urlObj
    ? [`${urlObj.origin}/property/*`, `${urlObj.origin}/listing/*`]
    : ['/property/*'];

  const priceSelector =
    typeof parsed.price_selector === 'string' ? parsed.price_selector : '[class*="price"]';
  const headlineSelector =
    typeof parsed.headline_selector === 'string' ? parsed.headline_selector : 'h2';
  const bedroomsSelector =
    typeof parsed.bedrooms_selector === 'string' ? parsed.bedrooms_selector : undefined;
  const containerSelector =
    typeof parsed.container_selector === 'string' ? parsed.container_selector : undefined;
  // FOLLOW-127: extract inquiry submit selector from AI Vision response.
  // Only accept a non-empty string; omit entirely (undefined) when absent or blank.
  const rawInquirySelector =
    typeof parsed.inquiry_submit_selector === 'string' ? parsed.inquiry_submit_selector : undefined;
  const inquirySubmitSelector =
    rawInquirySelector !== undefined && rawInquirySelector.trim().length > 0
      ? rawInquirySelector.trim()
      : undefined;

  const currency = inferCurrency(domain);

  const cardFieldMappings: CardFieldMappings = {
    headline: {
      primary: headlineSelector,
      fallbacks: ['h2', 'h3', '[class*="title"]'],
      type: 'text',
    },
    price: {
      primary: priceSelector,
      fallbacks: ['[class*="price"]'],
      type: 'currency',
      currency,
    },
    image: {
      primary: 'img',
      fallbacks: [],
      type: 'url',
    },
    ...(bedroomsSelector
      ? {
          bedrooms: {
            primary: bedroomsSelector,
            fallbacks: ['[class*="bed"]', '[class*="room"]'],
            type: 'number' as const,
          },
        }
      : {}),
  };

  const dataExtractors: DataExtractorsPerCard = {
    price: {
      primary: priceSelector,
      fallbacks: ['[class*="price"]'],
      type: 'currency',
      currency,
    },
    ...(bedroomsSelector
      ? {
          bedrooms: {
            primary: bedroomsSelector,
            fallbacks: [],
            type: 'number' as const,
          },
        }
      : {}),
  };

  const schema: TenantSiteSchema = {
    tenant_id: 'pending',
    domain,
    detected_at: new Date().toISOString(),
    detection_source: 'ai_vision',
    detection_confidence: confidence,
    index_schema: {
      url_patterns: indexPatterns,
      listing_card_selector: cardSelector,
      ...(containerSelector ? { container_selector: containerSelector } : {}),
      card_field_mappings: cardFieldMappings,
      data_extractors_per_card: dataExtractors,
      reorder_capable: false,
    },
    detail_schema: {
      url_patterns: detailPatterns,
      slot_selectors: {
        headline: {
          primary: 'h1',
          fallbacks: ['[class*="title"]'],
          type: 'text',
        },
        description: {
          primary: '[class*="description"]',
          fallbacks: ['p'],
          type: 'text',
        },
        cta_primary: {
          primary: 'a[href*="contact"]',
          fallbacks: ['button'],
          type: 'text',
        },
      },
      data_extractors: {},
    },
    archetype_hints: [],
    // FOLLOW-127: only set inquiry_submit_selector when AI Vision returned a non-empty value.
    // Never set it to "". Pipeline's detectInquirySubmitSelector also runs on the HTML as a
    // deterministic safety net — here we capture what the LLM returned directly.
    ...(inquirySubmitSelector ? { inquiry_submit_selector: inquirySubmitSelector } : {}),
  };

  return {
    schema,
    confidence,
    technique: 'ai_vision',
    warnings: ['Schema generated by AI Vision fallback — manual review recommended'],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Call the Anthropic Messages API with the vision prompt.
 *
 * Uses an indirect dynamic import to keep `@anthropic-ai/sdk` out of the static
 * module graph — this file is only ever loaded server-side from `POST /api/detect`
 * which has `@anthropic-ai/sdk` as a runtime dependency.
 *
 * TypeScript cannot resolve `@anthropic-ai/sdk` from `packages/sdk` because it is
 * not listed as a dependency here (by design). The import is therefore typed as
 * `unknown` / `any` and guarded at runtime.
 */
async function callAnthropic(apiKey: string, htmlSnippet: string): Promise<string> {
  // Indirect dynamic import: prevents TypeScript from statically resolving
  // `@anthropic-ai/sdk` at compile time within this package.
  // The package is a runtime dependency of apps/control-plane, not packages/sdk.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- intentional indirect import for cross-package boundary
  const importFn = new Function('specifier', 'return import(specifier)') as (
    s: string,
  ) => Promise<unknown>;

  const AnthropicModule: Record<string, unknown> = (await importFn('@anthropic-ai/sdk')) as Record<
    string,
    unknown
  >;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- server-only dynamic import, type not available at build time
  const AnthropicCtor = AnthropicModule.default as new (opts: { apiKey: string }) => any;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- runtime instantiation
  const client = new AnthropicCtor({ apiKey });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- runtime API call
  const message: unknown = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: `${VISION_PROMPT}${htmlSnippet}`,
      },
    ],
  });

  const firstBlock =
    message !== null &&
    typeof message === 'object' &&
    'content' in message &&
    Array.isArray((message as { content: unknown[] }).content)
      ? (message as { content: unknown[] }).content[0]
      : undefined;

  if (
    firstBlock !== undefined &&
    firstBlock !== null &&
    typeof firstBlock === 'object' &&
    'type' in firstBlock &&
    firstBlock.type === 'text' &&
    'text' in firstBlock &&
    typeof (firstBlock as { text: unknown }).text === 'string'
  ) {
    return (firstBlock as { text: string }).text;
  }

  throw new Error('Unexpected response format from Anthropic API');
}

/**
 * Parse Claude's text response as JSON.
 * Returns `null` if parsing fails.
 */
function parseVisionResponse(raw: string): AiVisionResponse | null {
  // Claude sometimes wraps JSON in markdown code fences — strip them.
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  try {
    const parsed: unknown = JSON.parse(stripped);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/** Truncate a string to at most `maxBytes` UTF-8 bytes. */
function truncateToBytes(str: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(str);
  if (encoded.length <= maxBytes) return str;
  const truncated = encoded.slice(0, maxBytes);
  return new TextDecoder().decode(truncated);
}

function inferCurrency(domain: string): 'EUR' | 'USD' | 'GBP' | 'PLN' | 'AED' {
  if (domain.endsWith('.co.uk') || domain.endsWith('.uk')) return 'GBP';
  if (domain.endsWith('.pl')) return 'PLN';
  if (domain.endsWith('.ae')) return 'AED';
  if (domain.endsWith('.com')) return 'USD';
  return 'EUR';
}

function extractDomain(url: string): string {
  const parsed = tryParseUrl(url);
  return parsed ? parsed.hostname : url;
}

function tryParseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}
