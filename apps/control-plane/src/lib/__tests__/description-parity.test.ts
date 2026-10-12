/**
 * FOLLOW-1297 — the parity test (ADR-0023 §4, CONVENTIONS_PATCH Rule Z).
 *
 * Drives `generateDescription` — the production entry point — with the Anthropic SDK mocked to
 * return the RAW model outputs recorded in the frozen corpus, and demands, for every case,
 * identity with what the Python job produced from the same input: the verdict and its reason code,
 * the description text and the verified facts (FIT), the headline (string or null) and its
 * violation, the claims-validation stamp, the resolved model, the `max_tokens` budget, and the
 * sha256 of every prompt the generator sends (read off the mock's call arguments). 100 % or the PR
 * does not merge. The corpus is never regenerated; a Python defect it pins is a TS defect too until
 * a later change re-freezes a v2 (ADR-0023 §4).
 *
 * No other I/O happens: the test env configures no Redis, ClickHouse, Postgres or Sentry, so the
 * spend gate reads 0, every write reports `not_configured` and no row is written.
 *
 * `MANIFEST.json` carries the counts the composition rule demands; this file asserts the minima so
 * a trimmed corpus cannot pass quietly.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

import type { DescriptionRequestedEvent } from '@estalara/shared';
import { CLAIMS_VALIDATION_VERSION, generateDescription } from '@/lib/description-generator';

const FIXTURE_DIR = join(__dirname, '../__fixtures__/description-parity');

interface Case {
  id: string;
  kind: 'live' | 'hand1305' | 'synthetic';
  input: DescriptionRequestedEvent;
  raw_description: { text: string; stop_reason: string | null };
  raw_headline: string | null;
  expected: {
    model: string;
    max_tokens: number;
    prompt_sha256: {
      description_system: string;
      description_user: string;
      headline_system: string | null;
      headline_user: string | null;
    };
    outcome: Record<string, unknown>;
    headline_called: boolean;
    headline: string | null;
    headline_violation: string | null;
    claims_validation: string | null;
  };
}

interface Manifest {
  case_count: number;
  per_verdict: Record<string, number>;
  per_reason: Record<string, number>;
  per_kind: Record<string, number>;
  headline_suppressed: number;
  non_empty_listing_context: number;
  claims_validation_version: string;
  digest_format: string;
}

interface CreateParams {
  model: string;
  max_tokens: number;
  system: string;
  messages: { role: string; content: string }[];
}

const CASES: Case[] = readFileSync(join(FIXTURE_DIR, 'corpus.v1.jsonl'), 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line) => JSON.parse(line) as Case);
const MANIFEST = JSON.parse(readFileSync(join(FIXTURE_DIR, 'MANIFEST.json'), 'utf8')) as Manifest;

/** sha256 hex in colon-separated 8-char groups — the generator's `digest_format`. */
function sha(text: string): string {
  const hex = createHash('sha256').update(text, 'utf8').digest('hex');
  return hex.match(/.{8}/g)!.join(':');
}

function response(text: string, stopReason: string | null) {
  return {
    content: [{ type: 'text', text }],
    stop_reason: stopReason,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

describe('description parity corpus (frozen from the Python job — ADR-0023 §4)', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'parity-'.repeat(4));
    mockCreate.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('the manifest describes this corpus and meets the composition minima', () => {
    expect(CASES.length).toBe(MANIFEST.case_count);
    expect(CASES.length).toBeGreaterThanOrEqual(50);
    expect(MANIFEST.claims_validation_version).toBe(CLAIMS_VALIDATION_VERSION);
    expect(MANIFEST.per_kind.live).toBeGreaterThanOrEqual(30);
    expect(MANIFEST.per_kind.hand1305).toBeGreaterThanOrEqual(9);
    expect(MANIFEST.per_verdict.NEUTRAL).toBeGreaterThanOrEqual(3);
    expect(MANIFEST.per_verdict.FAILED).toBeGreaterThanOrEqual(5);
    for (const code of [
      'FAILED/empty',
      'FAILED/residual_tag',
      'FAILED/formatted_body',
      'FAILED/leak_marker',
      'FAILED/truncated',
      'REFUSED/hallucinated_number',
      'REFUSED/unsupported_amenity',
      'REFUSED/unsupported_guarantee',
      'REFUSED/unit_mismatch',
    ]) {
      expect(MANIFEST.per_reason[code], code).toBeGreaterThanOrEqual(1);
    }
    expect(MANIFEST.headline_suppressed).toBeGreaterThanOrEqual(5);
    expect(MANIFEST.non_empty_listing_context).toBeGreaterThanOrEqual(10);
    expect(CASES.some((c) => c.id === 'fit.missing.verdict.tag')).toBe(true);
    expect(CASES.some((c) => c.id === 'fit.ensure.ascii.e.acute.grounds.9')).toBe(true);
    const ids = new Set(CASES.map((c) => c.id));
    expect(ids.size).toBe(CASES.length);
  });

  describe.each(CASES.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    it('generates identically: model, max_tokens, prompts, verdict, reason, text, facts, headline, stamp', async () => {
      mockCreate
        .mockResolvedValueOnce(response(c.raw_description.text, c.raw_description.stop_reason))
        .mockResolvedValueOnce(response(c.raw_headline ?? '', 'end_turn'));

      const report = await generateDescription(c.input);

      // The description call: the exact prompt bytes the Python sent, the same budget and model.
      const desc = mockCreate.mock.calls[0]![0] as CreateParams;
      expect(desc.model).toBe(c.expected.model);
      expect(desc.max_tokens).toBe(c.expected.max_tokens);
      expect(sha(desc.system)).toBe(c.expected.prompt_sha256.description_system);
      expect(sha(desc.messages[0]!.content)).toBe(c.expected.prompt_sha256.description_user);

      expect(report.outcome).toEqual(c.expected.outcome);
      expect(report.claimsValidation).toBe(c.expected.claims_validation);
      expect(report.writes).toEqual({
        pg:
          report.outcome.verdict === 'FIT' || report.outcome.verdict === 'NEUTRAL'
            ? 'not_configured'
            : 'skipped',
        redis:
          report.outcome.verdict === 'FIT' || report.outcome.verdict === 'NEUTRAL'
            ? 'not_configured'
            : 'skipped',
        audit: report.outcome.verdict === 'FIT' ? 'not_configured' : 'skipped',
      });

      // The headline call happens iff FIT, with the exact prompt bytes; its result as recorded.
      expect(mockCreate).toHaveBeenCalledTimes(c.expected.headline_called ? 2 : 1);
      expect(report.headline).toBe(c.expected.headline);
      if (!c.expected.headline_called) {
        expect(report.headlineViolation).toBeNull();
        return;
      }
      const head = mockCreate.mock.calls[1]![0] as CreateParams;
      expect(head.model).toBe(c.expected.model);
      expect(head.max_tokens).toBe(60);
      expect(sha(head.system)).toBe(c.expected.prompt_sha256.headline_system);
      expect(sha(head.messages[0]!.content)).toBe(c.expected.prompt_sha256.headline_user);
      expect(report.headlineViolation).toBe(c.expected.headline_violation);
    });
  });
});
