/**
 * FOLLOW-102 — Quiz ON/OFF toggle: SDK config tests.
 *
 * AC3 acceptance criteria:
 *   1. readConfig() parses data-quiz-enabled="false" → quiz.enabled=false
 *   2. readConfig() defaults to quiz.enabled=true when data-quiz-enabled is absent
 *   3. readConfig() resolves any value other than "false" to quiz.enabled=true
 *
 * FOLLOW-257 (Option A): data-quiz-trigger / trigger_after_n_listings removed —
 * no production producer (buildSnippet never emitted it) and no runtime consumer
 * (the timer uses the hardcoded QUIZ_TRIGGER_DELAY_MS constant). Rule L.
 * Tests 4 and 5 from the original AC3 have been removed along with the dead field.
 *
 * Rule H compliance: readConfig is a non-test consumer of data-quiz-enabled.
 * The production producer is buildSnippet() in DetectionPreview.tsx (Rule L).
 *
 * @module packages/sdk/src/__tests__/follow-102
 */

import { describe, expect, it } from 'vitest';

import { readConfig, DEFAULT_CONFIG } from '../core/config.js';

/** Minimal mock of a script element's dataset */
function makeDataset(attrs: Record<string, string>): Record<string, string | undefined> {
  return attrs;
}

describe('readConfig — FOLLOW-102 quiz sub-object', () => {
  // AC3 test 1: data-quiz-enabled="false" → enabled=false
  it('parses data-quiz-enabled="false" as quiz.enabled=false', () => {
    const dataset = makeDataset({ apiKey: 'EXAMPLE_api_key_xyz', quizEnabled: 'false' });
    const cfg = readConfig({ dataset });
    expect(cfg.quiz?.enabled).toBe(false);
  });

  // AC3 test 2: absent data-quiz-enabled → defaults to enabled=true
  it('defaults quiz.enabled=true when data-quiz-enabled is absent', () => {
    const dataset = makeDataset({ apiKey: 'EXAMPLE_api_key_xyz' });
    const cfg = readConfig({ dataset });
    expect(cfg.quiz?.enabled).toBe(true);
  });

  // AC3 test 3: any value other than "false" → enabled=true
  it('resolves data-quiz-enabled="true" as quiz.enabled=true', () => {
    const dataset = makeDataset({ apiKey: 'EXAMPLE_api_key_xyz', quizEnabled: 'true' });
    const cfg = readConfig({ dataset });
    expect(cfg.quiz?.enabled).toBe(true);
  });

  it('resolves data-quiz-enabled="1" as quiz.enabled=true (non-"false" value)', () => {
    const dataset = makeDataset({ apiKey: 'EXAMPLE_api_key_xyz', quizEnabled: '1' });
    const cfg = readConfig({ dataset });
    expect(cfg.quiz?.enabled).toBe(true);
  });

  it('resolves data-quiz-enabled="" (empty string) as quiz.enabled=true', () => {
    const dataset = makeDataset({ apiKey: 'EXAMPLE_api_key_xyz', quizEnabled: '' });
    const cfg = readConfig({ dataset });
    expect(cfg.quiz?.enabled).toBe(true);
  });

  // Verify DEFAULT_CONFIG includes the quiz sub-object (FOLLOW-257: no trigger_after_n_listings)
  it('DEFAULT_CONFIG includes quiz.enabled=true and no trigger_after_n_listings field', () => {
    expect(DEFAULT_CONFIG.quiz).toEqual({ enabled: true });
  });
});
