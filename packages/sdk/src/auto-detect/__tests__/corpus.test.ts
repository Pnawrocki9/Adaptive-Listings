// @vitest-environment jsdom
/**
 * Auto-Detection Corpus CI Gate (TICKET-AUTO-005).
 *
 * Runs `detectSiteSchema` against synthetic HTML built from each fixture's
 * ground-truth and asserts the pooled corpus precision / recall thresholds.
 * Writes `corpus-report.json` to the package root for CI artifact upload.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildCorpusReport,
  computeMetrics,
  readFixtures,
  runDetection,
  writeCorpusReport,
  type FixtureEntry,
  type FixtureResult,
} from '../test-utils.js';

const PRECISION_THRESHOLD = 0.95;
const RECALL_THRESHOLD = 0.8;

let fixtures: FixtureEntry[] = [];
let results: FixtureResult[] = [];

beforeAll(async () => {
  fixtures = readFixtures('__fixtures__');
  results = await Promise.all(fixtures.map((f) => runDetection(f.html, f.url, f.groundTruth)));
});

afterAll(() => {
  const report = buildCorpusReport(results, {
    precision: PRECISION_THRESHOLD,
    recall: RECALL_THRESHOLD,
  });
  const path = writeCorpusReport(report);
  // Surface where the report landed so CI can upload it.
  console.log(`Corpus report written to: ${path}`);
});

describe('Auto-Detection Corpus CI Gate', () => {
  // FOLLOW-1294: the corpus covers the kept techniques only (data_estalara, json_ld,
  // data_attributes); the fixtures of the removed platform techniques went with them.
  it('loads 10 fixture ground-truths, all for a kept technique', () => {
    expect(fixtures.length).toBe(10);
    for (const f of fixtures) {
      expect(f.groundTruth.listing_card_selector).toBeTruthy();
      expect(f.groundTruth.detection_technique).toBeTruthy();
      expect(f.html.length).toBeGreaterThan(100);
      expect(['data_estalara', 'json_ld', 'data_attributes']).toContain(
        f.groundTruth.detection_technique,
      );
    }
  });

  it('every fixture returns a non-null schema', () => {
    const missing = results.filter((r) => !r.schema_present).map((r) => r.id);
    expect(missing).toEqual([]);
  });

  it(`precision >= ${String(PRECISION_THRESHOLD)} pooled across all platforms`, () => {
    const { precision } = computeMetrics(results);
    expect(precision).toBeGreaterThanOrEqual(PRECISION_THRESHOLD);
  });

  it(`recall >= ${String(RECALL_THRESHOLD)} pooled across all platforms`, () => {
    const { recall } = computeMetrics(results);
    expect(recall).toBeGreaterThanOrEqual(RECALL_THRESHOLD);
  });

  it('000-app-estalara has 100% precision', () => {
    const estalara = results.find((r) => r.id === '000-app-estalara');
    expect(estalara).toBeDefined();
    expect(estalara!.precision).toBe(1.0);
  });
});
