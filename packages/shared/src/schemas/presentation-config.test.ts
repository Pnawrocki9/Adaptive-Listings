/**
 * Tests for the ADR-0019 unified presentation-config wire contract (FOLLOW-623 — brand slice).
 *
 * ADR-0019 "On acceptance" guardrail: ≥5 cases per new schema. Covers:
 *   - valid brand slice;
 *   - `logo_url` null vs url (ADR-0019 D-nullability: `string | null`, never `undefined`);
 *   - invalid `primary_color` (non-hex) rejection;
 *   - invalid `logo_url` (non-url) rejection;
 *   - backward-compat parse of an ADR-0011-subset response (no brand slice);
 *   - forward-compat: unknown future slices are stripped, not rejected;
 *   - the shipped wire examples validate.
 *
 * @module @estalara/shared/schemas/presentation-config.test
 */

import { describe, expect, it } from 'vitest';

import {
  BrandConfigSchema,
  PresentationConfigResponseSchema,
  QuizDefinitionSchema,
  computeUnreachableArchetypes,
  reduceWeightsToArchetype,
} from './presentation-config.js';
import type { QuizDefinition } from './presentation-config.js';
import {
  EXAMPLE_PRESENTATION_BRAND_NO_LOGO,
  EXAMPLE_PRESENTATION_CONFIG_FULL,
  EXAMPLE_PRESENTATION_CONFIG_MINIMAL,
  EXAMPLE_PRESENTATION_CONFIG_WITH_QUIZ_DEF,
  EXAMPLE_QUIZ_DEFINITION,
} from '../examples/presentation-config.js';

/** A structurally-valid definition builder for mutation in individual cases. */
function validDefinition(): QuizDefinition {
  return structuredClone(EXAMPLE_QUIZ_DEFINITION);
}

// ─── BrandConfigSchema ──────────────────────────────────────────────────────

describe('BrandConfigSchema', () => {
  it('accepts a valid brand with an https logo_url', () => {
    const result = BrandConfigSchema.safeParse({
      primary_color: '#1a73e8',
      logo_url: 'https://cdn.example.com/logo.svg',
      white_label: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts logo_url === null (never undefined — D-nullability)', () => {
    const result = BrandConfigSchema.safeParse({
      primary_color: '#abcdef',
      logo_url: null,
      white_label: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // The parsed value keeps null explicitly — it is not coerced to undefined.
      expect(result.data.logo_url).toBeNull();
    }
  });

  it('rejects a non-hex primary_color', () => {
    const result = BrandConfigSchema.safeParse({
      primary_color: 'blue',
      logo_url: null,
      white_label: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a 3-digit hex primary_color (must be 6-digit)', () => {
    const result = BrandConfigSchema.safeParse({
      primary_color: '#abc',
      logo_url: null,
      white_label: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a logo_url that is not a URL', () => {
    const result = BrandConfigSchema.safeParse({
      primary_color: '#1a73e8',
      logo_url: 'not-a-url',
      white_label: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing white_label field', () => {
    const result = BrandConfigSchema.safeParse({
      primary_color: '#1a73e8',
      logo_url: null,
    });
    expect(result.success).toBe(false);
  });
});

// ─── PresentationConfigResponseSchema ───────────────────────────────────────

describe('PresentationConfigResponseSchema', () => {
  it('parses a full response including the brand slice', () => {
    const result = PresentationConfigResponseSchema.safeParse(EXAMPLE_PRESENTATION_CONFIG_FULL);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.brand?.primary_color).toBe('#1a73e8');
      expect(result.data.brand?.white_label).toBe(true);
    }
  });

  it('parses a branded response with logo_url null', () => {
    const result = PresentationConfigResponseSchema.safeParse(EXAMPLE_PRESENTATION_BRAND_NO_LOGO);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.brand?.logo_url).toBeNull();
    }
  });

  it('backward-compat: parses an ADR-0011-subset response with NO brand slice', () => {
    const result = PresentationConfigResponseSchema.safeParse(EXAMPLE_PRESENTATION_CONFIG_MINIMAL);
    expect(result.success).toBe(true);
    if (result.success) {
      // Absent brand slice → undefined, so the SDK falls back to hardcoded widget defaults (D4).
      expect(result.data.brand).toBeUndefined();
    }
  });

  it('preserves the inherited data_source provenance flag (Rule K.2)', () => {
    const result = PresentationConfigResponseSchema.safeParse({
      quiz_enabled: true,
      micro_polls_enabled: false,
      language: 'en',
      accent_color: '#2563EB',
      data_source: 'fallback',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data_source).toBe('fallback');
    }
  });

  it('forward-compat: strips unknown future slices instead of rejecting', () => {
    const result = PresentationConfigResponseSchema.safeParse({
      quiz_enabled: true,
      micro_polls_enabled: false,
      language: 'en',
      accent_color: '#2563EB',
      data_source: 'db',
      // A future ADR-0019 slice a shipped SDK does not yet know about. (This case used
      // `quiz_placement` until FOLLOW-640 made it a REAL slice — see the case below.)
      some_future_slice: { anything: true },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).some_future_slice).toBeUndefined();
    }
  });

  it('retains the quiz_placement slice now that FOLLOW-640 ships its SDK consumer', () => {
    const placement = { corner: 'top-right', offset_x: 10, offset_y: 10 };
    const result = PresentationConfigResponseSchema.safeParse({
      quiz_enabled: true,
      micro_polls_enabled: false,
      language: 'en',
      accent_color: '#2563EB',
      data_source: 'db',
      quiz_placement: placement,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).quiz_placement).toEqual(placement);
    }
  });

  it('retains the opt_out_widget slice (FOLLOW-641)', () => {
    const optOut = { placement: { corner: 'bottom-right', offset_x: 8, offset_y: 8 } };
    const result = PresentationConfigResponseSchema.safeParse({
      quiz_enabled: true,
      micro_polls_enabled: false,
      language: 'en',
      accent_color: '#2563EB',
      data_source: 'db',
      opt_out_widget: optOut,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).opt_out_widget).toEqual(optOut);
    }
  });

  it('rejects a response whose brand slice has an invalid primary_color', () => {
    const result = PresentationConfigResponseSchema.safeParse({
      quiz_enabled: true,
      micro_polls_enabled: false,
      language: 'en',
      accent_color: '#2563EB',
      data_source: 'db',
      brand: { primary_color: 'red', logo_url: null, white_label: false },
    });
    expect(result.success).toBe(false);
  });

  it('parses a response carrying a quiz_definition slice (FOLLOW-639)', () => {
    const result = PresentationConfigResponseSchema.safeParse(
      EXAMPLE_PRESENTATION_CONFIG_WITH_QUIZ_DEF,
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.quiz_definition?.root).toBe('q_gate');
    }
  });

  it('backward-compat: parses a response with NO quiz_definition slice', () => {
    const result = PresentationConfigResponseSchema.safeParse(EXAMPLE_PRESENTATION_CONFIG_MINIMAL);
    expect(result.success).toBe(true);
    if (result.success) {
      // Absent → SDK uses its built-in default tree (ADR-0019 D4/D5).
      expect(result.data.quiz_definition).toBeUndefined();
    }
  });
});

// ─── QuizDefinitionSchema — hard integrity guardrails (ADR-0019 D3) ──────────

describe('QuizDefinitionSchema', () => {
  it('accepts the example definition', () => {
    expect(QuizDefinitionSchema.safeParse(EXAMPLE_QUIZ_DEFINITION).success).toBe(true);
  });

  it('HARD error: rejects an unknown archetype id in weights', () => {
    const def = validDefinition();
    def.questions[1]!.answers[0]!.weights = { not_an_archetype: 1 };
    const result = QuizDefinitionSchema.safeParse(def);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('unknown archetype id'))).toBe(
        true,
      );
    }
  });

  it('HARD error: rejects a dangling answer.next reference', () => {
    const def = validDefinition();
    def.questions[0]!.answers[0]!.next = 'does_not_exist';
    const result = QuizDefinitionSchema.safeParse(def);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('unknown question id'))).toBe(true);
    }
  });

  it('HARD error: rejects a root that references an unknown question', () => {
    const def = validDefinition();
    def.root = 'nowhere';
    const result = QuizDefinitionSchema.safeParse(def);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('root references'))).toBe(true);
    }
  });

  it('HARD error: rejects a cycle in the question graph', () => {
    const def = validDefinition();
    // Make q_invest point back at the root → cycle.
    def.questions[1]!.answers[0]!.next = 'q_gate';
    const result = QuizDefinitionSchema.safeParse(def);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('cycle detected'))).toBe(true);
    }
  });

  it('HARD error: rejects duplicate question ids', () => {
    const def = validDefinition();
    def.questions[1]!.id = 'q_gate';
    const result = QuizDefinitionSchema.safeParse(def);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('duplicate question id'))).toBe(
        true,
      );
    }
  });

  it('HARD error: rejects a question with fewer than 2 answers', () => {
    const def = validDefinition();
    def.questions[1]!.answers = [def.questions[1]!.answers[0]!];
    expect(QuizDefinitionSchema.safeParse(def).success).toBe(false);
  });

  it('accepts a leaf answer that weights toward neutral (canonical id)', () => {
    const def = validDefinition();
    def.questions[0]!.answers[1]!.weights = { neutral: 1 };
    expect(QuizDefinitionSchema.safeParse(def).success).toBe(true);
  });
});

// ─── reduceWeightsToArchetype — argmax semantics (ADR-0019 D5) ───────────────

describe('reduceWeightsToArchetype', () => {
  it('returns neutral for an empty vector', () => {
    expect(reduceWeightsToArchetype({})).toBe('neutral');
  });

  it('returns neutral when all weights are non-positive', () => {
    expect(reduceWeightsToArchetype({ yield_hunter: 0, flip_investor: -1 })).toBe('neutral');
  });

  it('returns the single-highest archetype', () => {
    expect(reduceWeightsToArchetype({ first_time_buyer: 1, luxury_buyer: 2 })).toBe('luxury_buyer');
  });

  it('breaks ties by canonical order (earliest wins)', () => {
    // yield_hunter precedes flip_investor in CANONICAL_ARCHETYPE_IDS.
    expect(reduceWeightsToArchetype({ flip_investor: 3, yield_hunter: 3 })).toBe('yield_hunter');
  });
});

// ─── computeUnreachableArchetypes — non-blocking warning (ADR-0019 D3) ───────

describe('computeUnreachableArchetypes', () => {
  it('warns for archetypes no path can reach (non-blocking)', () => {
    const unreachable = computeUnreachableArchetypes(EXAMPLE_QUIZ_DEFINITION);
    // Only yield_hunter + flip_investor are reachable in the example tree.
    expect(unreachable).toContain('student_parent');
    expect(unreachable).not.toContain('yield_hunter');
    expect(unreachable).not.toContain('flip_investor');
    expect(unreachable).not.toContain('neutral');
  });
});
