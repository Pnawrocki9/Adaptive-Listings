/**
 * Widget placement contract — shared corner+offset model for the SDK's fixed-position
 * Shadow-DOM widgets (ADR-0019 D3 / FOLLOW-640 + FOLLOW-641).
 *
 * The SDK's widgets (the quiz sticky trigger, the profiling opt-out toggle) always render
 * inside OUR OWN known app DOM on every brand domain (never a third-party site — the
 * DOMAIN-INDEPENDENCE ruling), so placement is a bounded corner + pixel-offset model rather
 * than arbitrary CSS. This module is the SINGLE source of truth for that shape, imported by
 * BOTH `quiz-config.ts` (the `quiz_config.placement` write key, FOLLOW-640) and
 * `presentation-config.ts` (the `quiz_placement` + `opt_out_widget.placement` wire slices).
 * It lives in its own module so `quiz-config.ts` can reference it without a circular import
 * (`presentation-config.ts` already imports from `quiz-config.ts`).
 *
 * @module @estalara/shared/schemas/widget-placement
 */

import { z } from 'zod';

/**
 * The four viewport corners a fixed widget can anchor to. `offset_x` is measured from the
 * corner's horizontal edge (left for `*-left`, right for `*-right`) and `offset_y` from its
 * vertical edge (bottom for `bottom-*`, top for `top-*`).
 */
export const WidgetCornerSchema = z.enum(['bottom-left', 'bottom-right', 'top-left', 'top-right']);

/** TypeScript union for a widget anchor corner. */
export type WidgetCorner = z.infer<typeof WidgetCornerSchema>;

/**
 * A bounded fixed-position placement: a corner plus non-negative px offsets (≤200 so a
 * misconfiguration cannot push a widget entirely off-screen). Both offsets are integers.
 */
export const WidgetPlacementSchema = z.object({
  corner: WidgetCornerSchema,
  offset_x: z.number().int().min(0).max(200),
  offset_y: z.number().int().min(0).max(200),
});

/** TypeScript type for a widget placement. */
export type WidgetPlacement = z.infer<typeof WidgetPlacementSchema>;

/**
 * Default quiz sticky-trigger placement (ADR-0019 D4).
 *
 * FOLLOW-1014: `offset_y` is 96, not the pre-FOLLOW-640 hardcoded 24. At 24 the trigger sat
 * directly on top of the profiling opt-out toggle — same corner, `DEFAULT_OPTOUT_PLACEMENT`
 * bottom-left 16/16 — and completely covered it, so an unconfigured tenant shipped an
 * unreachable §H.9 opt-out control whenever the quiz trigger was showing. 96 clears the
 * toggle's measured 56px height plus its 16px offset, leaving the two stacked with a gap.
 *
 * Keep this above `DEFAULT_OPTOUT_PLACEMENT.offset_y` + the toggle height whenever either
 * default moves; `widget-placement.test.ts` asserts they cannot overlap.
 */
export const DEFAULT_QUIZ_PLACEMENT: WidgetPlacement = {
  corner: 'bottom-left',
  offset_x: 24,
  offset_y: 96,
};

/**
 * Default profiling opt-out toggle placement. Byte-identical to the pre-FOLLOW-641 hardcoded
 * `position:fixed; bottom:16px; left:16px` — an unconfigured tenant renders here.
 */
export const DEFAULT_OPTOUT_PLACEMENT: WidgetPlacement = {
  corner: 'bottom-left',
  offset_x: 16,
  offset_y: 16,
};
