/**
 * FOLLOW-102 — Quiz ON/OFF toggle: SDK config tests.
 *
 * AC3 acceptance criteria:
 *   1. readConfig() parses data-quiz-enabled="false" → quiz.enabled=false
 *   2. readConfig() defaults to quiz.enabled=true when data-quiz-enabled is absent
 *   3. readConfig() resolves any value other than "false" to quiz.enabled=true
 *   4. readConfig() parses data-quiz-trigger (integer) → quiz.trigger_after_n_listings
 *   5. readConfig() defaults trigger_after_n_listings to DEFAULT_CONFIG value when absent
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

  // AC3 test 4: data-quiz-trigger is parsed as integer
  it('parses data-quiz-trigger="5" as quiz.trigger_after_n_listings=5', () => {
    const dataset = makeDataset({ apiKey: 'EXAMPLE_api_key_xyz', quizTrigger: '5' });
    const cfg = readConfig({ dataset });
    expect(cfg.quiz?.trigger_after_n_listings).toBe(5);
  });

  // AC3 test 5: absent data-quiz-trigger → defaults to DEFAULT_CONFIG value
  it('defaults trigger_after_n_listings to DEFAULT_CONFIG value when data-quiz-trigger is absent', () => {
    const dataset = makeDataset({ apiKey: 'EXAMPLE_api_key_xyz' });
    const cfg = readConfig({ dataset });
    expect(cfg.quiz?.trigger_after_n_listings).toBe(DEFAULT_CONFIG.quiz?.trigger_after_n_listings);
    expect(cfg.quiz?.trigger_after_n_listings).toBe(3);
  });

  it('defaults trigger_after_n_listings to 3 when data-quiz-trigger is not a valid positive integer', () => {
    const dataset = makeDataset({ apiKey: 'EXAMPLE_api_key_xyz', quizTrigger: 'abc' });
    const cfg = readConfig({ dataset });
    expect(cfg.quiz?.trigger_after_n_listings).toBe(3);
  });

  it('defaults trigger_after_n_listings to 3 when data-quiz-trigger is 0', () => {
    const dataset = makeDataset({ apiKey: 'EXAMPLE_api_key_xyz', quizTrigger: '0' });
    const cfg = readConfig({ dataset });
    expect(cfg.quiz?.trigger_after_n_listings).toBe(3);
  });

  // Verify DEFAULT_CONFIG includes the quiz sub-object
  it('DEFAULT_CONFIG includes quiz.enabled=true and trigger_after_n_listings=3', () => {
    expect(DEFAULT_CONFIG.quiz).toEqual({ enabled: true, trigger_after_n_listings: 3 });
  });
});
