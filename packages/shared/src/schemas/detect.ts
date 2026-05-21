/**
 * DetectResponseSchema — Zod schema for the POST /api/detect wizard-ready response.
 *
 * Consumed by TICKET-030 (Magic Link onboarding wizard UI) to render field previews
 * after the Schema Discovery API returns a detection result.
 *
 * Shape mirrors the `WizardDetectResponse` returned by the route handler in
 * `apps/control-plane/src/app/api/detect/route.ts`.
 *
 * @module @estalara/shared/schemas/detect
 */

import { z } from 'zod';

/**
 * A single flattened field entry derived from the detected `TenantSiteSchema`.
 *
 * Each named field from `IndexSchema.card_field_mappings`, `DetailSchema.slot_selectors`,
 * and `DetailSchema.data_extractors` is mapped to this flat shape for the wizard UI.
 */
export const DetectFieldSchema = z.object({
  /** Field name, e.g. 'price', 'headline', 'bedrooms'. */
  name: z.string(),
  /** Primary CSS selector for this field. */
  selector: z.string(),
  /** Live text sample captured during detection, or null if not available. */
  sample_value: z.string().nullable(),
  /** Confidence score 0–1 for this field's selector. */
  confidence: z.number().min(0).max(1),
});

export type DetectField = z.infer<typeof DetectFieldSchema>;

/**
 * Wizard-ready response from `POST /api/detect`.
 *
 * When `schema` is null (detection below confidence threshold), `detection_source`
 * is null, `detection_confidence` is 0, and `fields` is empty.
 *
 * When `cached` is true, the stored schema was returned immediately without
 * re-running the full detection pipeline (60-second cache guard).
 */
export const DetectResponseSchema = z.object({
  /**
   * Full `TenantSiteSchema` JSON object, or null when detection confidence is
   * below the threshold.
   */
  schema: z.unknown().nullable(),
  /**
   * Which detection technique produced the result, or null when schema is null.
   */
  detection_source: z.string().nullable(),
  /**
   * Overall detection confidence 0–1, or 0 when schema is null.
   */
  detection_confidence: z.number().min(0).max(1),
  /**
   * Flattened list of detected field definitions for wizard preview rendering.
   */
  fields: z.array(DetectFieldSchema),
  /**
   * True when the response was served from the 60-second detection cache rather
   * than re-running the full detection pipeline.
   */
  cached: z.boolean(),
  /**
   * Unique request identifier (UUID v4) for tracing.
   */
  request_id: z.string().uuid(),
});

export type DetectResponse = z.infer<typeof DetectResponseSchema>;
