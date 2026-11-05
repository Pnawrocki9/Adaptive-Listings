/**
 * The ONE byte contract for `intent_sessions.intent_state` (JSONB) — FOLLOW-1310, Codex F-07.
 *
 * Writer: `apps/ingest/src/handlers/intent-snapshot.ts` builds the value with
 * `buildIntentStateEnvelope` from the SDK's `intent.snapshot` payload and sends it as a JSON
 * OBJECT (never a JSON string). Readers: every control-plane route that selects `intentState`
 * parses it with `readIntentStateEnvelope`, so writer and readers cannot drift.
 *
 * Shape (documented on the Drizzle column, `packages/db/src/schema/intent-sessions.ts`):
 * `{ weights: Record<archetype, number>, topArchetype: string, confidence: number }`.
 *
 * Legacy rows: before FOLLOW-1310 the writer stored `JSON.stringify(probabilities)`, so the JSONB
 * value is a STRING holding the bare probability map. The reader recovers the real `weights` from
 * it and reports `topArchetype`/`confidence` as `null` — the SDK's archetype is NOT the argmax of
 * the weights (hysteresis, neutral threshold), so deriving one would fabricate it. The repair
 * script `packages/db/scripts/repair-intent-state-follow1310.sql` unwraps those strings in place.
 *
 * @module @estalara/shared/intent-state-envelope
 */

/** What the writer stores in `intent_sessions.intent_state`. */
export interface IntentStateEnvelope {
  /** Full archetype probability distribution (SDK `probabilities`). */
  weights: Record<string, number>;
  /** The SDK's current top archetype label (SDK `archetype`). */
  topArchetype: string;
  /** Confidence for `topArchetype`, in [0, 1] (SDK `confidence`). */
  confidence: number;
}

/** What a reader gets back — every field nullable because legacy and empty rows exist. */
export interface IntentStateView {
  weights: Record<string, number> | null;
  topArchetype: string | null;
  confidence: number | null;
  /** True when the stored value used a pre-FOLLOW-1310 shape (string or bare map). */
  legacy: boolean;
}

/** Build the stored envelope from the `intent.snapshot` payload fields it is made of. */
export function buildIntentStateEnvelope(payload: {
  archetype: string;
  confidence: number;
  probabilities: Record<string, number>;
}): IntentStateEnvelope {
  return {
    weights: { ...payload.probabilities },
    topArchetype: payload.archetype,
    confidence: payload.confidence,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numericEntries(value: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

const EMPTY: IntentStateView = {
  weights: null,
  topArchetype: null,
  confidence: null,
  legacy: false,
};

/**
 * Parse a stored `intent_state` value (as Drizzle returns JSONB) into a view. Never throws.
 */
export function readIntentStateEnvelope(raw: unknown): IntentStateView {
  if (typeof raw === 'string') {
    // Legacy: the pre-FOLLOW-1310 writer double-serialised, so JSONB holds a string.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...EMPTY, legacy: true };
    }
    if (typeof parsed === 'string') return { ...EMPTY, legacy: true };
    return { ...readIntentStateEnvelope(parsed), legacy: true };
  }
  if (!isPlainObject(raw)) return EMPTY;

  if ('weights' in raw) {
    const confidence = raw.confidence;
    return {
      weights: isPlainObject(raw.weights) ? numericEntries(raw.weights) : null,
      topArchetype: typeof raw.topArchetype === 'string' ? raw.topArchetype : null,
      confidence:
        typeof confidence === 'number' && confidence >= 0 && confidence <= 1 ? confidence : null,
      legacy: false,
    };
  }

  // Legacy bare probability map: every value numeric.
  const values = Object.values(raw);
  if (values.length > 0 && values.every((v) => typeof v === 'number')) {
    return { weights: numericEntries(raw), topArchetype: null, confidence: null, legacy: true };
  }
  return EMPTY;
}
