/**
 * Tests for the shared widget placement contract (FOLLOW-640 / FOLLOW-641, ADR-0019 D3).
 *
 * The load-bearing property here is NOT "zod validates" — it is that the DEFAULTS reproduce
 * the pre-FOLLOW-640/641 hardcoded positions exactly, because ADR-0019 D4 requires an
 * unconfigured tenant to render byte-identically to before this config existed.
 *
 * @module packages/shared/src/schemas/widget-placement.test
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_OPTOUT_PLACEMENT,
  DEFAULT_QUIZ_PLACEMENT,
  WidgetCornerSchema,
  WidgetPlacementSchema,
} from './widget-placement.js';

describe('WidgetCornerSchema', () => {
  it('accepts exactly the four viewport corners', () => {
    for (const corner of ['bottom-left', 'bottom-right', 'top-left', 'top-right']) {
      expect(WidgetCornerSchema.safeParse(corner).success).toBe(true);
    }
  });

  it('rejects an unknown corner', () => {
    expect(WidgetCornerSchema.safeParse('middle-center').success).toBe(false);
  });
});

describe('WidgetPlacementSchema', () => {
  it('accepts a corner with in-range integer offsets', () => {
    const result = WidgetPlacementSchema.safeParse({
      corner: 'top-right',
      offset_x: 0,
      offset_y: 200,
    });
    expect(result.success).toBe(true);
  });

  it('rejects offsets above the 200px bound (a widget pushed off-screen)', () => {
    expect(
      WidgetPlacementSchema.safeParse({ corner: 'bottom-left', offset_x: 201, offset_y: 10 })
        .success,
    ).toBe(false);
    expect(
      WidgetPlacementSchema.safeParse({ corner: 'bottom-left', offset_x: 10, offset_y: 201 })
        .success,
    ).toBe(false);
  });

  it('rejects negative offsets', () => {
    expect(
      WidgetPlacementSchema.safeParse({ corner: 'bottom-left', offset_x: -1, offset_y: 10 })
        .success,
    ).toBe(false);
  });

  it('rejects fractional offsets (integers only)', () => {
    expect(
      WidgetPlacementSchema.safeParse({ corner: 'bottom-left', offset_x: 12.5, offset_y: 10 })
        .success,
    ).toBe(false);
  });

  it('requires every key — a partial placement is not a placement', () => {
    expect(WidgetPlacementSchema.safeParse({ corner: 'bottom-left' }).success).toBe(false);
  });
});

describe('defaults reproduce the pre-config hardcoded positions (ADR-0019 D4)', () => {
  it('quiz trigger default is bottom-left 24/96 (raised off the opt-out toggle, FOLLOW-1014)', () => {
    expect(DEFAULT_QUIZ_PLACEMENT).toEqual({
      corner: 'bottom-left',
      offset_x: 24,
      offset_y: 96,
    });
  });

  // Regression guard for FOLLOW-1014: both widgets default to the SAME corner, so an
  // unconfigured tenant is exactly the case where they can collide. At the old 24/24 the
  // trigger covered the §H.9 opt-out control entirely, making it unreachable.
  it('the two bottom-left defaults cannot overlap', () => {
    expect(DEFAULT_QUIZ_PLACEMENT.corner).toBe(DEFAULT_OPTOUT_PLACEMENT.corner);
    // The opt-out toggle measures ~56px tall; require the trigger to clear it with a gap.
    const OPTOUT_HEIGHT_PX = 56;
    expect(DEFAULT_QUIZ_PLACEMENT.offset_y).toBeGreaterThanOrEqual(
      DEFAULT_OPTOUT_PLACEMENT.offset_y + OPTOUT_HEIGHT_PX,
    );
  });

  it('opt-out toggle default is bottom-left 16/16 (was `bottom:16px; left:16px`)', () => {
    expect(DEFAULT_OPTOUT_PLACEMENT).toEqual({
      corner: 'bottom-left',
      offset_x: 16,
      offset_y: 16,
    });
  });

  it('both defaults are themselves valid placements', () => {
    expect(WidgetPlacementSchema.safeParse(DEFAULT_QUIZ_PLACEMENT).success).toBe(true);
    expect(WidgetPlacementSchema.safeParse(DEFAULT_OPTOUT_PLACEMENT).success).toBe(true);
  });
});
