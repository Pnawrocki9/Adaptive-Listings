/**
 * FOLLOW-1297 — the parity test (ADR-0023 §4, CONVENTIONS_PATCH Rule Z); FOLLOW-1314 — corpus v2.
 *
 * Drives `generateDescription` — the production entry point — with the Anthropic SDK mocked to
 * return the RAW model outputs recorded in the frozen corpus, and demands, for every case,
 * identity with the expected record: the verdict and its reason code, the description text and the
 * verified facts (FIT), the headline (string or null) and its violation, the claims-validation
 * stamp, the resolved model, the `max_tokens` budget, and the sha256 of every prompt the generator
 * sends (read off the mock's call arguments). 100 % or the PR does not merge.
 *
 * Two corpora, two guards:
 *   - `corpus.v1.jsonl` + `MANIFEST.json` — what the PYTHON job produced. Never regenerated, never
 *     edited. Every v1 case that FOLLOW-1314 did not change (95 of 98) must still be reproduced
 *     exactly: this is the port's parity with the Python, unchanged by the fix.
 *   - `corpus.v2.jsonl` + `MANIFEST.v2.json` — the CURRENT contract (ADR-0023 §4: fixing a ported
 *     Python defect re-freezes the corpus as v2). Same inputs, raw outputs and prompt digests as
 *     v1, byte for byte; the expected record differs ONLY in the cases `MANIFEST.v2.json` lists
 *     under `delta`, each with its reason. All 98 v2 cases must be reproduced exactly, and the
 *     v1→v2 difference itself is asserted, so an unlisted verdict change fails here.
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

interface ManifestV2 extends Manifest {
  corpus: string;
  corpus_sha256: string;
  derived_from: { corpus: string; manifest: string; corpus_sha256: string };
  delta: { id: string; kind: string; changed: Record<string, unknown>; reason: string }[];
}

interface CreateParams {
  model: string;
  max_tokens: number;
  system: string;
  messages: { role: string; content: string }[];
}

function readCorpus(file: string): Case[] {
  return readFileSync(join(FIXTURE_DIR, file), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Case);
}

const CASES: Case[] = readCorpus('corpus.v1.jsonl');
const MANIFEST = JSON.parse(readFileSync(join(FIXTURE_DIR, 'MANIFEST.json'), 'utf8')) as Manifest;
const CASES_V2: Case[] = readCorpus('corpus.v2.jsonl');
const MANIFEST_V2 = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'MANIFEST.v2.json'), 'utf8'),
) as ManifestV2;
const DELTA_IDS = new Set(MANIFEST_V2.delta.map((d) => d.id));

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

/** One case through `generateDescription`, compared with its expected record field by field. */
async function expectIdentical(c: Case): Promise<void> {
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
}

describe('description parity corpus v1 (frozen from the Python job — ADR-0023 §4)', () => {
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

  // FOLLOW-1314: the cases v2 changed are no longer the contract here; v2 guards them below.
  describe.each(CASES.filter((c) => !DELTA_IDS.has(c.id)).map((c) => [c.id, c] as const))(
    '%s',
    (_id, c) => {
      it('generates identically: model, max_tokens, prompts, verdict, reason, text, facts, headline, stamp', async () => {
        await expectIdentical(c);
      });
    },
  );
});

describe('description parity corpus v2 (FOLLOW-1314 — the current contract)', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'parity-'.repeat(4));
    mockCreate.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('v2 is v1 with ONLY the listed verdicts changed: same cases, inputs, raw outputs, prompt digests', () => {
    expect(MANIFEST_V2.corpus).toBe('corpus.v2.jsonl');
    expect(MANIFEST_V2.derived_from.corpus).toBe('corpus.v1.jsonl');
    expect(MANIFEST_V2.case_count).toBe(CASES_V2.length);
    expect(MANIFEST_V2.claims_validation_version).toBe(CLAIMS_VALIDATION_VERSION);
    expect(sha(readFileSync(join(FIXTURE_DIR, 'corpus.v1.jsonl'), 'utf8'))).toBe(
      MANIFEST_V2.derived_from.corpus_sha256,
    );
    expect(sha(readFileSync(join(FIXTURE_DIR, 'corpus.v2.jsonl'), 'utf8'))).toBe(
      MANIFEST_V2.corpus_sha256,
    );
    expect(CASES_V2.map((c) => c.id)).toEqual(CASES.map((c) => c.id));
    expect([...DELTA_IDS].sort()).toEqual([
      'fit.ensure.ascii.e.acute.grounds.9',
      'fit.headline.non.ascii.name.only.in.context',
      'live.018.listing-008.family_buyer.en',
    ]);
    for (const [i, v2] of CASES_V2.entries()) {
      const v1 = CASES[i]!;
      expect(v2.kind, v2.id).toBe(v1.kind);
      expect(v2.input, v2.id).toEqual(v1.input);
      expect(v2.raw_description, v2.id).toEqual(v1.raw_description);
      expect(v2.raw_headline, v2.id).toBe(v1.raw_headline);
      expect(v2.expected.prompt_sha256.description_system, v2.id).toBe(
        v1.expected.prompt_sha256.description_system,
      );
      expect(v2.expected.prompt_sha256.description_user, v2.id).toBe(
        v1.expected.prompt_sha256.description_user,
      );
      if (DELTA_IDS.has(v2.id)) expect(v2.expected, v2.id).not.toEqual(v1.expected);
      else expect(v2.expected, v2.id).toEqual(v1.expected);
    }
  });

  it('the v2 delta never loosens a body check: the one body change is FIT → REFUSED', () => {
    const bodyChanges = MANIFEST_V2.delta.filter((d) => 'outcome' in d.changed);
    expect(bodyChanges.map((d) => d.id)).toEqual(['fit.ensure.ascii.e.acute.grounds.9']);
    const v2 = CASES_V2.find((c) => c.id === 'fit.ensure.ascii.e.acute.grounds.9')!;
    expect(v2.expected.outcome).toEqual({ verdict: 'REFUSED', violation: 'hallucinated_number' });
  });

  describe.each(CASES_V2.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    it('generates identically to the v2 record', async () => {
      await expectIdentical(c);
    });
  });
});
