import { describe, it, expect } from 'vitest';
import { readFixtures, runDetection, computeMetrics } from '../test-utils.js';

// This test file compiles now but will fail at runtime until AUTO-003/004 implements detectSiteSchema.
// It is intentionally excluded from the main pnpm test run.
// Run with: pnpm --filter @estalara/sdk test:corpus

const fixtures = readFixtures('__fixtures__');

describe('Auto-Detection Corpus CI Gate', () => {
  it('loads 24 fixture ground-truths', () => {
    expect(fixtures.length).toBe(24);
    for (const f of fixtures) {
      expect(f.groundTruth.listing_card_selector).toBeTruthy();
      expect(f.groundTruth.detection_technique).toBeTruthy();
    }
  });

  it('precision >= 95% across all platforms', async () => {
    const results = await Promise.all(fixtures.map((f) => runDetection(f.html, f.groundTruth)));
    const { precision } = computeMetrics(results);
    expect(precision).toBeGreaterThanOrEqual(0.95);
  });

  it('recall >= 80% across all platforms', async () => {
    const results = await Promise.all(fixtures.map((f) => runDetection(f.html, f.groundTruth)));
    const { recall } = computeMetrics(results);
    expect(recall).toBeGreaterThanOrEqual(0.8);
  });

  it('app.estalara.com has 100% precision', async () => {
    const estalara = fixtures.find((f) => f.id === '000-app-estalara');
    expect(estalara).toBeDefined();
    const result = await runDetection(estalara!.html, estalara!.groundTruth);
    expect(result.precision).toBe(1.0);
  });
});
