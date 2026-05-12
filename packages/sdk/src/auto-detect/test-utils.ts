import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface GroundTruth {
  listing_card_selector: string;
  listing_count_expected?: number;
  card_field_mappings: Record<string, unknown>;
  data_extractors_per_card: Record<string, unknown>;
  container_selector?: string;
  detection_technique: string;
  detection_confidence: number;
}

export interface FixtureEntry {
  id: string;
  html: string; // empty string for now — detection engine will receive real HTML in AUTO-003
  groundTruth: GroundTruth;
}

export interface DetectionResult {
  precision: number;
  recall: number;
  technique: string;
  matched_selectors: string[];
  missed_selectors: string[];
}

/** Read all fixture ground-truths from __fixtures__ directory. */
export function readFixtures(fixturesDir: string): FixtureEntry[] {
  const fixturesPath = join(__dirname, '..', fixturesDir);
  const dirs = readdirSync(fixturesPath, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  return dirs.map((dirName) => {
    const gtPath = join(fixturesPath, dirName, 'index-ground-truth.json');
    const groundTruth = JSON.parse(readFileSync(gtPath, 'utf-8')) as GroundTruth;
    return {
      id: dirName,
      html: '', // placeholder — AUTO-003 will provide real HTML
      groundTruth,
    };
  });
}

/** Run detection on a fixture. Rejects with "Not implemented" until AUTO-003 is merged. */
export function runDetection(_html: string, _groundTruth: GroundTruth): Promise<DetectionResult> {
  return Promise.reject(new Error('Not implemented — detection engine ships in AUTO-003/004'));
}

/** Compute precision and recall across all detection results. */
export function computeMetrics(results: DetectionResult[]): { precision: number; recall: number } {
  if (results.length === 0) return { precision: 0, recall: 0 };
  const precision = results.reduce((sum, r) => sum + r.precision, 0) / results.length;
  const recall = results.reduce((sum, r) => sum + r.recall, 0) / results.length;
  return { precision, recall };
}
