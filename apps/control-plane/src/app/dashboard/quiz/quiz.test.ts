import { describe, expect, it } from 'vitest';

import { DAILY_COMPLETIONS, QUIZ_STATS } from './analytics/mock-data';

describe('Quiz analytics mock data', () => {
  it('QUIZ_STATS has expected shape', () => {
    expect(QUIZ_STATS).toHaveProperty('impressions');
    expect(QUIZ_STATS).toHaveProperty('completions');
    expect(QUIZ_STATS).toHaveProperty('investor_pct');
    expect(QUIZ_STATS).toHaveProperty('personal_pct');
    expect(QUIZ_STATS).toHaveProperty('conversion_lift_pct');
  });

  it('completion rate rounds to 36%', () => {
    const rate = Math.round((QUIZ_STATS.completions / QUIZ_STATS.impressions) * 100);
    expect(rate).toBe(36);
  });

  it('investor + personal percentages sum to 100', () => {
    expect(QUIZ_STATS.investor_pct + QUIZ_STATS.personal_pct).toBe(100);
  });

  it('DAILY_COMPLETIONS has 7 entries', () => {
    expect(DAILY_COMPLETIONS).toHaveLength(7);
  });

  it('each daily entry has day and count', () => {
    for (const entry of DAILY_COMPLETIONS) {
      expect(entry).toHaveProperty('day');
      expect(entry).toHaveProperty('count');
      expect(typeof entry.count).toBe('number');
      expect(entry.count).toBeGreaterThan(0);
    }
  });
});
