/**
 * OpenAI client singleton for the control-plane.
 *
 * Provides a shared `OpenAI` instance and a typed helper for computing
 * `text-embedding-3-small` vectors (1536 dimensions).
 *
 * The client is lazily initialised on first use. If `OPENAI_API_KEY` is not
 * set, every call to `embedText()` throws — callers must handle this in the
 * API routes by returning a 503.
 *
 * Do NOT instantiate `OpenAI` elsewhere in the control-plane — import this
 * module and call `embedText()` instead.
 *
 * @module apps/control-plane/src/lib/openai-client
 */

import OpenAI from 'openai';

let _openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (_openaiClient) return _openaiClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('[openai-client] OPENAI_API_KEY is not set');
  }
  _openaiClient = new OpenAI({ apiKey });
  return _openaiClient;
}

/**
 * Compute a 1536-dimension OpenAI `text-embedding-3-small` vector for `text`.
 *
 * @throws {Error} if `OPENAI_API_KEY` is not set or the API call fails.
 */
export async function embedText(text: string): Promise<number[]> {
  return embedTextWithDimensions(text, 1536);
}

/**
 * Compute an OpenAI `text-embedding-3-small` vector at a caller-specified
 * dimensionality (Matryoshka truncation).
 *
 * Used by FOLLOW-019 listing embedding ingest (1024 dims) and by the existing
 * answers RAG path (1536 dims via {@link embedText}).
 *
 * Valid dimensions per OpenAI docs: any value ≤ 1536 (the full model size).
 * Estalara standardises on 1024 for archetype + listing + session embeddings.
 *
 * @param text       - Input text to embed.
 * @param dimensions - Desired vector length.
 * @throws {Error} if `OPENAI_API_KEY` is not set or the API call fails.
 */
export async function embedTextWithDimensions(text: string, dimensions: number): Promise<number[]> {
  const client = getOpenAIClient();
  const response = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
    dimensions,
  });
  const embedding = response.data[0]?.embedding;
  if (!embedding) {
    throw new Error('[openai-client] OpenAI returned no embedding data');
  }
  return embedding;
}
