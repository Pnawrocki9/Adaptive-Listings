/**
 * Global config store — reads/writes global (non-per-tenant) admin settings
 * from the `app_config` table.
 *
 * Single source of truth for the `generation_model` key (FOLLOW-161):
 *   - getGlobalGenerationModel(): returns the configured model or the default.
 *   - setGlobalGenerationModel(): upserts the key with admin attribution.
 *
 * Fail-loud contract (Rule K.2):
 *   - getGlobalGenerationModel: returns the DEFAULT when the DB is not
 *     configured (env var absent) — that is the "not configured" path.
 *     THROWS when the DB IS configured but the query fails, so callers
 *     can choose to degrade or bubble the error.
 *   - setGlobalGenerationModel: always throws on DB failure.
 *
 * Chat classifier note (AC4 / FOLLOW-087):
 *   The real-time chat/intent classifier model is NOT user-selectable and
 *   stays Haiku-class. Its <500ms latency budget constrains it to a
 *   Haiku-class model. Do not expose it here or in the admin UI.
 *
 * @module apps/control-plane/src/lib/global-config-store
 */

import { createAdminClient, appConfig } from '@estalara/db';
import { eq } from 'drizzle-orm';

// ─── Allow-list (mirrors demo-override-store + generate_description.py) ───────

/**
 * Curated LLM model allow-list for content generation.
 * Keep in sync with:
 *   - apps/control-plane/src/lib/demo-override-store.ts DEMO_ALLOWED_MODELS
 *   - apps/llm-gateway/src/jobs/generate_description.py _ALLOWED_GENERATION_MODELS
 */
export const ALLOWED_GENERATION_MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-8',
] as const;

export type AllowedGenerationModel = (typeof ALLOWED_GENERATION_MODELS)[number];

/** Default global generation model (safe fallback when no DB row exists). */
export const DEFAULT_GENERATION_MODEL: AllowedGenerationModel = 'claude-sonnet-4-6';

/** Config key name in app_config table. */
export const GENERATION_MODEL_KEY = 'generation_model' as const;

// ─── Type guard ───────────────────────────────────────────────────────────────

function isAllowedModel(value: string): value is AllowedGenerationModel {
  return (ALLOWED_GENERATION_MODELS as readonly string[]).includes(value);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Read the global default LLM generation model from the `app_config` table.
 *
 * Returns DEFAULT_GENERATION_MODEL when:
 *   - DB client env vars are not set (dev/CI — "not configured" is safe).
 *   - No row exists for the key yet (before migration seed takes effect).
 *   - The stored value is not in the allow-list (defensive fallback).
 *
 * THROWS when:
 *   - DB is configured (env var set) but the query fails (Rule K.2).
 *
 * @returns One of the ALLOWED_GENERATION_MODELS values.
 */
export async function getGlobalGenerationModel(): Promise<AllowedGenerationModel> {
  const dbUrl = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    // DB not configured — return default (dev/CI path, safe).
    return DEFAULT_GENERATION_MODEL;
  }

  const db = createAdminClient();
  const rows = await db
    .select({ value: appConfig.value })
    .from(appConfig)
    .where(eq(appConfig.key, GENERATION_MODEL_KEY))
    .limit(1);

  const row = rows[0];
  if (!row) return DEFAULT_GENERATION_MODEL;

  const value = row.value;
  if (!isAllowedModel(value)) {
    // Stored value not in allow-list — defensive fallback.
    console.warn(
      `[global-config-store] generation_model "${value}" is not in the allow-list; using default "${DEFAULT_GENERATION_MODEL}".`,
    );
    return DEFAULT_GENERATION_MODEL;
  }

  return value;
}

/**
 * Persist the global default LLM generation model in the `app_config` table.
 *
 * Upserts `generation_model` key (INSERT … ON CONFLICT DO UPDATE).
 * Validates the model is in the allow-list before writing (rejects unknown values).
 *
 * THROWS on DB failure — callers must not silently swallow write failures.
 *
 * @param model    - One of ALLOWED_GENERATION_MODELS.
 * @param updatedBy - UUID of the admin performing the update (for audit trail).
 * @throws Error when model is not in allow-list or DB fails.
 */
export async function setGlobalGenerationModel(
  model: string,
  updatedBy: string | null,
): Promise<void> {
  if (!isAllowedModel(model)) {
    throw new Error(
      `[global-config-store] "${model}" is not in ALLOWED_GENERATION_MODELS — refusing write.`,
    );
  }

  const db = createAdminClient();

  await db
    .insert(appConfig)
    .values({
      key: GENERATION_MODEL_KEY,
      value: model,
      updatedBy: updatedBy ?? undefined,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: {
        value: model,
        updatedBy: updatedBy ?? undefined,
        updatedAt: new Date(),
      },
    });
}
