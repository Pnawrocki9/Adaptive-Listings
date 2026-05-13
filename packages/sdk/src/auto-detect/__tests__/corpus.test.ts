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
  containsCssInJsHash,
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
  it('loads 24 fixture ground-truths', () => {
    expect(fixtures.length).toBe(24);
    for (const f of fixtures) {
      expect(f.groundTruth.listing_card_selector).toBeTruthy();
      expect(f.groundTruth.detection_technique).toBeTruthy();
      expect(f.html.length).toBeGreaterThan(100);
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

  it('no detected selector contains a full CSS-in-JS or CSS Modules hash', () => {
    const violations: string[] = [];
    for (const r of results) {
      for (const f of r.fields) {
        if (f.detected && containsCssInJsHash(f.detected)) {
          violations.push(`${r.id} ${f.field}: ${f.detected}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
