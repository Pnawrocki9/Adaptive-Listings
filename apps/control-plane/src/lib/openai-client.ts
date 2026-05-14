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
  const client = getOpenAIClient();
  const response = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
    dimensions: 1536,
  });
  const embedding = response.data[0]?.embedding;
  if (!embedding) {
    throw new Error('[openai-client] OpenAI returned no embedding data');
  }
  return embedding;
}
