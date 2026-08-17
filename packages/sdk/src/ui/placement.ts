/**
 * Placement → CSS helper for the SDK's fixed-position Shadow-DOM widgets
 * (FOLLOW-640 / FOLLOW-641 / ADR-0019 D2).
 *
 * Turns a shared `WidgetPlacement` (corner + px offsets) into the two edge CSS declarations a
 * `position: fixed` widget needs. Used by `profiling-toggle.ts` so the
 * corner→edge mapping lives in exactly one place.
 *
 * @module @estalara/sdk/ui/placement
 */

import type { WidgetPlacement } from '@estalara/shared';

/**
 * Build the two edge CSS declarations (e.g. `bottom:24px;left:24px`) for a fixed widget from a
 * corner + offsets. `bottom-*`/`top-*` choose the vertical edge; `*-left`/`*-right` the
 * horizontal one. The offsets are already bounded to 0–200 by `WidgetPlacementSchema`.
 *
 * @param placement - the resolved widget placement.
 * @returns a CSS fragment with exactly the two anchoring edge declarations (no trailing `;`).
 */
export function placementToCss(placement: WidgetPlacement): string {
  const vertical = placement.corner.startsWith('top') ? 'top' : 'bottom';
  const horizontal = placement.corner.endsWith('left') ? 'left' : 'right';
  return `${vertical}:${String(placement.offset_y)}px;${horizontal}:${String(placement.offset_x)}px`;
}
