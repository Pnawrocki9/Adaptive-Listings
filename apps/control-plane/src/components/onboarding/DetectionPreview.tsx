/**
 * DetectionPreview — stub component for the Magic Link onboarding wizard.
 *
 * Real implementation is delivered by TICKET-AUTO-006-POLISH.
 * This stub accepts the required props and renders a placeholder so the
 * DetectWizard can import it without errors.
 *
 * Props mirror the fields returned by POST /api/detect (TICKET-033):
 *   - schema: full TenantSiteSchema JSON (unknown at this layer)
 *   - fields: flattened DetectField[] from @estalara/shared
 *   - detection_source: string identifying the detection technique
 *   - detection_confidence: 0–1 confidence score
 *
 * @module apps/control-plane/src/components/onboarding/DetectionPreview
 */

import type { DetectField } from '@estalara/shared';

export interface DetectionPreviewProps {
  /** Full TenantSiteSchema object returned by the detection engine. */
  schema: unknown;
  /** Flattened list of detected field definitions. */
  fields: DetectField[];
  /** Detection technique identifier, e.g. 'data_estalara'. */
  detection_source: string | null;
  /** Overall detection confidence 0–1. */
  detection_confidence: number;
}

/**
 * Stub implementation — replaced by TICKET-AUTO-006-POLISH.
 *
 * Renders a placeholder `<div>` with `data-testid="detection-preview"` so
 * DetectWizard tests can assert the component is mounted with the correct props.
 */
export function DetectionPreview(_props: DetectionPreviewProps) {
  return <div data-testid="detection-preview">Detection preview coming soon</div>;
}
