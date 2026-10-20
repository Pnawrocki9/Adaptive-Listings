/**
 * `definition_hash` — the identity of one quiz definition (MASTER_DESIGN §E.4.8 v3.0, ESC-086
 * item 3, FOLLOW-1358).
 *
 * The pre-registered accuracy analysis counts decided runs on ONE frozen hash, and any edit to the
 * questions, answers, weights, traits or confirmation texts restarts the count
 * (`docs/decisions/PREREG-quiz-accuracy-2026-10.md` §2). So the hash must change exactly when the
 * served definition changes, and never because of key order, whitespace or a stored key the serve
 * schema strips. It is therefore taken over a CANONICAL JSON of the PARSED definition (the output of
 * `QuizDefinitionSchema`): object keys sorted, no whitespace, `undefined` members omitted, array
 * order kept (array order is meaningful — answer order is what the buyer sees).
 *
 * One implementation for every reader: `GET /api/quiz/public-config` (FOLLOW-1358) stamps it on the
 * served slice; the admin versions list (FOLLOW-1362 / Q7) and the accuracy report (FOLLOW-1363 /
 * Q8) reuse it. Web Crypto (`crypto.subtle`), so it runs unchanged in Node 20+ and in a browser.
 *
 * @module @estalara/shared/schemas/quiz-hash
 */

import type { QuizDefinition } from './presentation-config.js';

/** Deterministic JSON: sorted object keys, no whitespace, `undefined` object members dropped. */
function canonicalJson(value: unknown): string {
  // `undefined` only reaches here as an array element; JSON renders it as null there.
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/**
 * SHA-256 (lower-case hex) of the canonical JSON of a PARSED quiz definition.
 *
 * @param def - a definition that has been through `QuizDefinitionSchema` (the serve schema), so
 *   unknown stored keys are already stripped. Pass the built-in default the same way.
 * @returns 64 lower-case hex characters.
 */
export async function computeQuizDefinitionHash(def: QuizDefinition): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(def));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
