/**
 * FOLLOW-639 (ADR-0019 D5) — end-to-end: served quiz_definition → mergeQuizConfig overlay →
 * generic walk → resolved leaf, and the absent-slice fallback to the built-in default.
 *
 * This ties the SERVE step (`mergeQuizConfig` overlaying the `quiz_definition` slice onto
 * `SdkConfig`) to the WALK step (`resolveArchetypeFromPath`) to the LEAF the completion path
 * (`applyQuizLeaf` → `persistResolvedArchetype` → `postQuizCompletionPing`, unchanged) receives.
 */

import { describe, expect, it } from 'vitest';

import type { PresentationConfigResponse, QuizDefinition } from '@estalara/shared';

import { mergeQuizConfig } from '../index.js';
import type { SdkConfig } from '../core/config.js';
import { DEFAULT_QUIZ_DEFINITION, resolveArchetypeFromPath } from '../ui/quiz-widget.js';

const baseConfig: SdkConfig = {
  apiKey: 'k',
  ingestUrl: 'https://ingest.example.com/v1/events',
  tier: 'observer',
  debug: false,
  consentState: 'legitimate_interest',
  language: 'en',
  accentColor: '#000000',
  quiz: { enabled: true },
};

// A custom served tree whose only non-neutral leaf is luxury_buyer.
const CUSTOM_DEFINITION: QuizDefinition = {
  schema_version: 1,
  root: 'start',
  languages: ['en'],
  questions: [
    {
      id: 'start',
      prompt_i18n: { en: 'Pick' },
      answers: [
        { id: 'lux', label_i18n: { en: 'Luxury' }, weights: { luxury_buyer: 3 }, next: null },
        { id: 'none', label_i18n: { en: 'None' }, weights: {}, next: null },
      ],
    },
  ],
};

function response(extra: Partial<PresentationConfigResponse> = {}): PresentationConfigResponse {
  return {
    quiz_enabled: true,
    micro_polls_enabled: false,
    language: 'en',
    accent_color: '#123456',
    data_source: 'db',
    ...extra,
  };
}

describe('FOLLOW-639 — quiz_definition overlay + walk', () => {
  it('overlays the served quiz_definition onto SdkConfig', () => {
    const merged = mergeQuizConfig(baseConfig, response({ quiz_definition: CUSTOM_DEFINITION }));
    expect(merged.quizDefinition?.root).toBe('start');
  });

  it('walking the served definition resolves the custom leaf archetype', () => {
    const merged = mergeQuizConfig(baseConfig, response({ quiz_definition: CUSTOM_DEFINITION }));
    const def = merged.quizDefinition ?? DEFAULT_QUIZ_DEFINITION;
    // Choosing answer index 0 (the luxury answer) resolves to luxury_buyer.
    expect(resolveArchetypeFromPath(def, [0])).toBe('luxury_buyer');
    // The neutral skip (index 1, all-zero) resolves to neutral (FOLLOW-554 guard downstream).
    expect(resolveArchetypeFromPath(def, [1])).toBe('neutral');
  });

  it('absent slice → SdkConfig has no quizDefinition → SDK uses the built-in default', () => {
    const merged = mergeQuizConfig(baseConfig, response());
    expect(merged.quizDefinition).toBeUndefined();
    const def = merged.quizDefinition ?? DEFAULT_QUIZ_DEFINITION;
    // The default tree still resolves the legacy leaves (byte-identical).
    expect(resolveArchetypeFromPath(def, [0, 0, 0])).toBe('yield_hunter');
  });
});
