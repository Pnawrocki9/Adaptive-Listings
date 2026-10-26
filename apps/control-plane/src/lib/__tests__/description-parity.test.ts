/**
 * FOLLOW-1297 — the parity test (ADR-0023 §4, CONVENTIONS_PATCH Rule Z); FOLLOW-1314 — corpus v2;
 * FOLLOW-1315 — corpus v3; FOLLOW-1381 — corpus v4; FOLLOW-1382 — corpus v5; FOLLOW-1392 and later —
 * corpus v6+ (verdict deltas, see `VERDICT_DELTAS`).
 *
 * Drives `generateDescription` — the production entry point — with the Anthropic SDK mocked to
 * return the RAW model outputs recorded in the frozen corpus, and demands, for every case,
 * identity with the expected record: the verdict and its reason code, the description text and the
 * verified facts (FIT), the headline (string or null) and its violation, the claims-validation
 * stamp, the resolved model, the `max_tokens` budget, and the sha256 of every prompt the generator
 * sends (read off the mock's call arguments). 100 % or the PR does not merge.
 *
 * Five corpora, five guards:
 *   - `corpus.v1.jsonl` + `MANIFEST.json` — what the PYTHON job produced. Never regenerated, never
 *     edited. Every v1 case that FOLLOW-1314 did not change (95 of 98) must still be reproduced
 *     exactly: this is the port's parity with the Python, unchanged by the fix.
 *   - `corpus.v2.jsonl` + `MANIFEST.v2.json` — FOLLOW-1314 (ADR-0023 §4: fixing a ported Python
 *     defect re-freezes the corpus as v2). Same inputs, raw outputs and prompt digests as v1, byte
 *     for byte; the expected record differs ONLY in the cases `MANIFEST.v2.json` lists under
 *     `delta`, each with its reason. All 98 v2 cases must be reproduced exactly, and the v1→v2
 *     difference itself is asserted, so an unlisted verdict change fails here.
 *   - `corpus.v3.jsonl` + `MANIFEST.v3.json` — FOLLOW-1315 rewrote the
 *     headline prompt, so v3 is a prompt-digest re-freeze of v2: every byte is v2's except
 *     `prompt_sha256.headline_system` / `headline_user` of the cases that call the headline. That
 *     difference is asserted below. Because it is the ONLY difference, the older guards replay
 *     their cases with the CURRENT headline digests (now v5's) and keep every other assertion; the
 *     recorded raw headlines predate the new prompt, so they pin the checks, not the new prompt's
 *     live output.
 *   - `corpus.v4.jsonl` + `MANIFEST.v4.json` — FOLLOW-1381 made the digit rule read a
 *     thousands-grouped number as one number on both sides, so v4 is a verdict delta of v3 (like
 *     v2): same inputs, raw outputs and prompt digests; the expected record differs ONLY in the
 *     case `MANIFEST.v4.json` lists, with its reason. The v1–v3 guards no longer replay it.
 *   - `corpus.v5.jsonl` + `MANIFEST.v5.json` — FOLLOW-1382 appended a
 *     language paragraph to the headline USER prompt, so v5 is a prompt-digest re-freeze of v4
 *     (like v3): only `prompt_sha256.headline_user` differs, in every case that calls the headline,
 *     and the v5 guard proves the new prompt is the v4 prompt plus that paragraph, byte for byte.
 *   - `corpus.v6.jsonl` + `MANIFEST.v6.json` onwards (`VERDICT_DELTAS`) — verdict deltas of the
 *     corpus before them (like v4): same inputs, raw outputs and prompt digests; the expected
 *     record differs ONLY in the cases the manifest lists, each with its reason. The LAST one is
 *     the CURRENT contract; every older guard stops replaying a case a later delta changed.
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
// FOLLOW-1387 moved the default generation model to Sonnet 5.5. Every corpus was frozen under the
// Python job's Sonnet 4.6 default, and 96 of its 98 inputs name no model, so the corpus keeps that
// default here: it pins what the generator does for a given model, not which model is the default.
// `global-config-store.test.ts` pins the default itself; `description-generator.follow1377.test.ts`
// drives the generator with it.
vi.mock('@/lib/global-config-store', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DEFAULT_GENERATION_MODEL: 'claude-sonnet-4-6',
}));

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

interface ManifestV3 extends ManifestV2 {
  kind: string;
  headline_called: number;
  headline_prompt_sha256: { headline_system: { v2: string; v3: string } };
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
const CASES_V3: Case[] = readCorpus('corpus.v3.jsonl');
const MANIFEST_V3 = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'MANIFEST.v3.json'), 'utf8'),
) as ManifestV3;
const CASES_V4: Case[] = readCorpus('corpus.v4.jsonl');
const MANIFEST_V4 = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'MANIFEST.v4.json'), 'utf8'),
) as ManifestV3;
/** FOLLOW-1381: the cases v4 changed are no longer the contract of the older guards. */
const V4_DELTA_IDS = new Set(MANIFEST_V4.delta.map((d) => d.id));
const CASES_V5: Case[] = readCorpus('corpus.v5.jsonl');
const MANIFEST_V5 = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'MANIFEST.v5.json'), 'utf8'),
) as ManifestV3;
/**
 * The CURRENT headline prompt digests, by case id (FOLLOW-1315 re-froze them as v3, FOLLOW-1382
 * as v5; each of those guards asserts they were that corpus's only change).
 */
const HEADLINE_SHA = new Map(CASES_V5.map((c) => [c.id, c.expected.prompt_sha256] as const));

/**
 * The verdict deltas after v5, oldest first, each derived from the corpus before it (v6 from v5).
 * FOLLOW-1392 — v6 (meta-commentary); FOLLOW-1394 — v7 (a pool of people, views of the sea);
 * FOLLOW-1400 — v8 (familial steering, refused as on `/api/adapt`).
 */
const VERDICT_DELTAS: {
  version: number;
  ticket: string;
  ids: string[];
  cases: Case[];
  manifest: ManifestV3;
}[] = [
  { version: 6, ticket: 'FOLLOW-1392', ids: ['live.016.listing-007.yield_hunter.en'] },
  { version: 7, ticket: 'FOLLOW-1394', ids: ['live.011.listing-005.yield_hunter.en'] },
  {
    version: 8,
    ticket: 'FOLLOW-1400',
    ids: [
      'live.002.listing-001.family_buyer.en',
      'live.026.listing-011.diaspora_buyer.en',
      'live.029.839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c.family_buyer.en',
      'live.032.839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c.neutral.en',
    ],
  },
].map((d) => ({
  ...d,
  cases: readCorpus(`corpus.v${String(d.version)}.jsonl`),
  manifest: JSON.parse(
    readFileSync(join(FIXTURE_DIR, `MANIFEST.v${String(d.version)}.json`), 'utf8'),
  ) as ManifestV3,
}));
/** Every case a verdict delta after v5 changed: v1–v5 no longer replay it. */
const LATER_DELTA_IDS = new Set(VERDICT_DELTAS.flatMap((d) => d.manifest.delta.map((x) => x.id)));

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
async function expectIdentical(c: Case, headlineSha = c.expected.prompt_sha256): Promise<void> {
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
  expect(sha(head.system)).toBe(headlineSha.headline_system);
  expect(sha(head.messages[0]!.content)).toBe(headlineSha.headline_user);
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

  // FOLLOW-1314 / FOLLOW-1381: the cases v2 and v4 changed are no longer the contract here.
  describe.each(
    CASES.filter(
      (c) => !DELTA_IDS.has(c.id) && !V4_DELTA_IDS.has(c.id) && !LATER_DELTA_IDS.has(c.id),
    ).map((c) => [c.id, c] as const),
  )('%s', (_id, c) => {
    it('generates identically: model, max_tokens, prompts, verdict, reason, text, facts, headline, stamp', async () => {
      await expectIdentical(c, HEADLINE_SHA.get(c.id));
    });
  });
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

  // FOLLOW-1315 / FOLLOW-1382: the headline prompt digests are the current ones (v3, then v5).
  // FOLLOW-1381: the case v4 changed is guarded by v4.
  describe.each(
    CASES_V2.filter((c) => !V4_DELTA_IDS.has(c.id) && !LATER_DELTA_IDS.has(c.id)).map(
      (c) => [c.id, c] as const,
    ),
  )('%s', (_id, c) => {
    it('generates identically to the v2 record', async () => {
      await expectIdentical(c, HEADLINE_SHA.get(c.id));
    });
  });
});

describe('description parity corpus v3 (FOLLOW-1315 — headline prompt re-freeze)', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'parity-'.repeat(4));
    mockCreate.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('v3 is v2 with ONLY the headline prompt digests changed: no verdict, headline or stamp moved', () => {
    expect(MANIFEST_V3.corpus).toBe('corpus.v3.jsonl');
    expect(MANIFEST_V3.kind).toBe('prompt_digest_refreeze');
    expect(MANIFEST_V3.derived_from.corpus).toBe('corpus.v2.jsonl');
    expect(MANIFEST_V3.derived_from.corpus_sha256).toBe(MANIFEST_V2.corpus_sha256);
    expect(MANIFEST_V3.case_count).toBe(CASES_V3.length);
    expect(MANIFEST_V3.claims_validation_version).toBe(CLAIMS_VALIDATION_VERSION);
    expect(MANIFEST_V3.delta).toEqual([]);
    expect(MANIFEST_V3.per_verdict).toEqual(MANIFEST_V2.per_verdict);
    expect(MANIFEST_V3.per_reason).toEqual(MANIFEST_V2.per_reason);
    expect(MANIFEST_V3.headline_suppressed).toBe(MANIFEST_V2.headline_suppressed);
    expect(sha(readFileSync(join(FIXTURE_DIR, 'corpus.v2.jsonl'), 'utf8'))).toBe(
      MANIFEST_V3.derived_from.corpus_sha256,
    );
    expect(sha(readFileSync(join(FIXTURE_DIR, 'corpus.v3.jsonl'), 'utf8'))).toBe(
      MANIFEST_V3.corpus_sha256,
    );
    expect(CASES_V3.map((c) => c.id)).toEqual(CASES_V2.map((c) => c.id));
    let called = 0;
    for (const [i, v3] of CASES_V3.entries()) {
      const v2 = CASES_V2[i]!;
      const { prompt_sha256: p3, ...rest3 } = v3.expected;
      const { prompt_sha256: p2, ...rest2 } = v2.expected;
      expect(v3.kind, v3.id).toBe(v2.kind);
      expect(v3.input, v3.id).toEqual(v2.input);
      expect(v3.raw_description, v3.id).toEqual(v2.raw_description);
      expect(v3.raw_headline, v3.id).toBe(v2.raw_headline);
      expect(rest3, v3.id).toEqual(rest2);
      expect(p3.description_system, v3.id).toBe(p2.description_system);
      expect(p3.description_user, v3.id).toBe(p2.description_user);
      if (v2.expected.headline_called) {
        called += 1;
        expect(p2.headline_system, v3.id).toBe(
          MANIFEST_V3.headline_prompt_sha256.headline_system.v2,
        );
        expect(p3.headline_system, v3.id).toBe(
          MANIFEST_V3.headline_prompt_sha256.headline_system.v3,
        );
        expect(p3.headline_user, v3.id).not.toBe(p2.headline_user);
      } else {
        expect(p3, v3.id).toEqual(p2);
      }
    }
    expect(called).toBe(MANIFEST_V3.headline_called);
  });

  // FOLLOW-1381: the case v4 changed is guarded by v4.
  describe.each(
    CASES_V3.filter((c) => !V4_DELTA_IDS.has(c.id) && !LATER_DELTA_IDS.has(c.id)).map(
      (c) => [c.id, c] as const,
    ),
  )('%s', (_id, c) => {
    it('generates identically to the v3 record', async () => {
      await expectIdentical(c, HEADLINE_SHA.get(c.id));
    });
  });
});

describe('description parity corpus v4 (FOLLOW-1381 — grouped numbers)', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'parity-'.repeat(4));
    mockCreate.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('v4 is v3 with ONLY the listed expected records changed: same cases, inputs, raw outputs, prompts', () => {
    expect(MANIFEST_V4.corpus).toBe('corpus.v4.jsonl');
    expect(MANIFEST_V4.kind).toBe('verdict_delta');
    expect(MANIFEST_V4.derived_from.corpus).toBe('corpus.v3.jsonl');
    expect(MANIFEST_V4.derived_from.corpus_sha256).toBe(MANIFEST_V3.corpus_sha256);
    expect(MANIFEST_V4.case_count).toBe(CASES_V4.length);
    expect(MANIFEST_V4.claims_validation_version).toBe(CLAIMS_VALIDATION_VERSION);
    expect(sha(readFileSync(join(FIXTURE_DIR, 'corpus.v3.jsonl'), 'utf8'))).toBe(
      MANIFEST_V4.derived_from.corpus_sha256,
    );
    expect(sha(readFileSync(join(FIXTURE_DIR, 'corpus.v4.jsonl'), 'utf8'))).toBe(
      MANIFEST_V4.corpus_sha256,
    );
    expect(CASES_V4.map((c) => c.id)).toEqual(CASES_V3.map((c) => c.id));
    expect([...V4_DELTA_IDS]).toEqual(['live.027.listing-012.downsizer.pl']);
    for (const [i, v4] of CASES_V4.entries()) {
      const v3 = CASES_V3[i]!;
      expect(v4.kind, v4.id).toBe(v3.kind);
      expect(v4.input, v4.id).toEqual(v3.input);
      expect(v4.raw_description, v4.id).toEqual(v3.raw_description);
      expect(v4.raw_headline, v4.id).toBe(v3.raw_headline);
      expect(v4.expected.model, v4.id).toBe(v3.expected.model);
      expect(v4.expected.max_tokens, v4.id).toBe(v3.expected.max_tokens);
      expect(v4.expected.prompt_sha256.description_system, v4.id).toBe(
        v3.expected.prompt_sha256.description_system,
      );
      expect(v4.expected.prompt_sha256.description_user, v4.id).toBe(
        v3.expected.prompt_sha256.description_user,
      );
      if (V4_DELTA_IDS.has(v4.id)) expect(v4.expected, v4.id).not.toEqual(v3.expected);
      else expect(v4.expected, v4.id).toEqual(v3.expected);
    }
    // The manifest's counts are this corpus's counts.
    expect(MANIFEST_V4.per_verdict.FIT).toBe(
      CASES_V4.filter((c) => c.expected.outcome.verdict === 'FIT').length,
    );
    expect(MANIFEST_V4.headline_called).toBe(
      CASES_V4.filter((c) => c.expected.headline_called).length,
    );
    expect(MANIFEST_V4.headline_suppressed).toBe(
      CASES_V4.filter((c) => c.expected.headline_called && c.expected.headline === null).length,
    );
    expect(MANIFEST_V4.per_reason['REFUSED/hallucinated_number']).toBe(
      MANIFEST_V3.per_reason['REFUSED/hallucinated_number']! - 1,
    );
  });

  it('the one v4 delta is the grouped-number false refusal: REFUSED/hallucinated_number → FIT', () => {
    const id = 'live.027.listing-012.downsizer.pl';
    const v3 = CASES_V3.find((c) => c.id === id)!;
    const v4 = CASES_V4.find((c) => c.id === id)!;
    expect(v3.expected.outcome).toEqual({ verdict: 'REFUSED', violation: 'hallucinated_number' });
    expect(v4.expected.outcome.verdict).toBe('FIT');
    // The body's price is the listing's, written with a Polish thousands separator.
    expect(v4.input.listing_context.price).toBe('€285,000');
    expect(v4.expected.outcome.description).toContain('285 000 euro');
    // The recorded raw headline is null (the case was REFUSED when recorded): suppressed as empty.
    expect(v4.raw_headline).toBeNull();
    expect(v4.expected.headline).toBeNull();
    expect(v4.expected.headline_violation).toBe('empty');
  });

  describe.each(CASES_V4.filter((c) => !LATER_DELTA_IDS.has(c.id)).map((c) => [c.id, c] as const))(
    '%s',
    (_id, c) => {
      it('generates identically to the v4 record', async () => {
        await expectIdentical(c, HEADLINE_SHA.get(c.id));
      });
    },
  );
});

/** FOLLOW-1382: the paragraph the headline user prompt now ends with, per locale. */
function languageParagraph(locale: string): string {
  const language = ({ en: 'English', pl: 'Polish', es: 'Spanish' } as Record<string, string>)[
    locale
  ]!;
  return (
    `\n\nLANGUAGE: write the headline in ${language} (locale: ${locale}), even when the sources ` +
    `above are in another language. Compose it natively in ${language}. Keep place names and ` +
    `other proper names exactly as the listing writes them; when the sources are not in ` +
    `${language}, start the headline with such a name.`
  );
}

describe('description parity corpus v5 (FOLLOW-1382 — the current contract: headline locale)', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'parity-'.repeat(4));
    mockCreate.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('v5 is v4 with ONLY the headline USER prompt digests changed: no verdict, headline or stamp moved', () => {
    expect(MANIFEST_V5.corpus).toBe('corpus.v5.jsonl');
    expect(MANIFEST_V5.kind).toBe('prompt_digest_refreeze');
    expect(MANIFEST_V5.derived_from.corpus).toBe('corpus.v4.jsonl');
    expect(MANIFEST_V5.derived_from.corpus_sha256).toBe(MANIFEST_V4.corpus_sha256);
    expect(MANIFEST_V5.case_count).toBe(CASES_V5.length);
    expect(MANIFEST_V5.claims_validation_version).toBe(CLAIMS_VALIDATION_VERSION);
    expect(MANIFEST_V5.delta).toEqual([]);
    expect(MANIFEST_V5.per_verdict).toEqual(MANIFEST_V4.per_verdict);
    expect(MANIFEST_V5.per_reason).toEqual(MANIFEST_V4.per_reason);
    expect(MANIFEST_V5.headline_suppressed).toBe(MANIFEST_V4.headline_suppressed);
    expect(sha(readFileSync(join(FIXTURE_DIR, 'corpus.v4.jsonl'), 'utf8'))).toBe(
      MANIFEST_V5.derived_from.corpus_sha256,
    );
    expect(sha(readFileSync(join(FIXTURE_DIR, 'corpus.v5.jsonl'), 'utf8'))).toBe(
      MANIFEST_V5.corpus_sha256,
    );
    expect(CASES_V5.map((c) => c.id)).toEqual(CASES_V4.map((c) => c.id));
    let called = 0;
    for (const [i, v5] of CASES_V5.entries()) {
      const v4 = CASES_V4[i]!;
      const { prompt_sha256: p5, ...rest5 } = v5.expected;
      const { prompt_sha256: p4, ...rest4 } = v4.expected;
      expect(v5.kind, v5.id).toBe(v4.kind);
      expect(v5.input, v5.id).toEqual(v4.input);
      expect(v5.raw_description, v5.id).toEqual(v4.raw_description);
      expect(v5.raw_headline, v5.id).toBe(v4.raw_headline);
      expect(rest5, v5.id).toEqual(rest4);
      expect(p5.description_system, v5.id).toBe(p4.description_system);
      expect(p5.description_user, v5.id).toBe(p4.description_user);
      expect(p5.headline_system, v5.id).toBe(p4.headline_system);
      if (v4.expected.headline_called) {
        called += 1;
        expect(p5.headline_user, v5.id).not.toBe(p4.headline_user);
      } else {
        expect(p5, v5.id).toEqual(p4);
      }
    }
    expect(called).toBe(MANIFEST_V5.headline_called);
  });

  it('every new headline user prompt is the v4 prompt plus the locale paragraph, byte for byte', async () => {
    const calling = CASES_V5.filter((c) => c.expected.headline_called);
    expect(calling.length).toBe(MANIFEST_V5.headline_called);
    const locales = new Set<string>();
    // A case a later verdict delta stopped before the headline (FOLLOW-1400) no longer calls it.
    for (const c of calling.filter((x) => !LATER_DELTA_IDS.has(x.id))) {
      const v4 = CASES_V4.find((x) => x.id === c.id)!;
      mockCreate.mockReset();
      mockCreate
        .mockResolvedValueOnce(response(c.raw_description.text, c.raw_description.stop_reason))
        .mockResolvedValueOnce(response(c.raw_headline ?? '', 'end_turn'));
      await generateDescription(c.input);
      const user = (mockCreate.mock.calls[1]![0] as CreateParams).messages[0]!.content;
      const paragraph = languageParagraph(c.input.locale);
      expect(user.endsWith(paragraph), c.id).toBe(true);
      expect(sha(user.slice(0, user.length - paragraph.length)), c.id).toBe(
        v4.expected.prompt_sha256.headline_user,
      );
      locales.add(c.input.locale);
    }
    // The corpus exercises more than one locale through the headline.
    expect(locales.size).toBeGreaterThan(1);
  });

  describe.each(CASES_V5.filter((c) => !LATER_DELTA_IDS.has(c.id)).map((c) => [c.id, c] as const))(
    '%s',
    (_id, c) => {
      it('generates identically to the v5 record', async () => {
        await expectIdentical(c);
      });
    },
  );
});

describe.each(VERDICT_DELTAS.map((d, i) => [d.version, d.ticket, d, i] as const))(
  'description parity corpus v%i (%s — verdict delta)',
  (version, _ticket, d, i) => {
    const prevCases = i === 0 ? CASES_V5 : VERDICT_DELTAS[i - 1]!.cases;
    const prevManifest = i === 0 ? MANIFEST_V5 : VERDICT_DELTAS[i - 1]!.manifest;
    const prevName = `corpus.v${String(version - 1)}.jsonl`;
    const laterIds = new Set(
      VERDICT_DELTAS.slice(i + 1).flatMap((x) => x.manifest.delta.map((y) => y.id)),
    );
    const ids = new Set(d.manifest.delta.map((x) => x.id));

    beforeEach(() => {
      vi.stubEnv('ANTHROPIC_API_KEY', 'parity-'.repeat(4));
      mockCreate.mockReset();
    });
    afterEach(() => vi.unstubAllEnvs());

    it('is the corpus before it with ONLY the listed expected records changed', () => {
      expect(d.manifest.corpus).toBe(`corpus.v${String(version)}.jsonl`);
      expect(d.manifest.kind).toBe('verdict_delta');
      expect(d.manifest.derived_from.corpus).toBe(prevName);
      expect(d.manifest.derived_from.corpus_sha256).toBe(prevManifest.corpus_sha256);
      expect(sha(readFileSync(join(FIXTURE_DIR, prevName), 'utf8'))).toBe(
        d.manifest.derived_from.corpus_sha256,
      );
      expect(sha(readFileSync(join(FIXTURE_DIR, d.manifest.corpus), 'utf8'))).toBe(
        d.manifest.corpus_sha256,
      );
      expect(d.manifest.case_count).toBe(d.cases.length);
      expect(d.manifest.claims_validation_version).toBe(CLAIMS_VALIDATION_VERSION);
      expect(d.cases.map((c) => c.id)).toEqual(prevCases.map((c) => c.id));
      expect([...ids].sort()).toEqual([...d.ids].sort());
      for (const [j, cur] of d.cases.entries()) {
        const prev = prevCases[j]!;
        expect(cur.kind, cur.id).toBe(prev.kind);
        expect(cur.input, cur.id).toEqual(prev.input);
        expect(cur.raw_description, cur.id).toEqual(prev.raw_description);
        expect(cur.raw_headline, cur.id).toBe(prev.raw_headline);
        expect(cur.expected.model, cur.id).toBe(prev.expected.model);
        expect(cur.expected.max_tokens, cur.id).toBe(prev.expected.max_tokens);
        expect(cur.expected.prompt_sha256.description_system, cur.id).toBe(
          prev.expected.prompt_sha256.description_system,
        );
        expect(cur.expected.prompt_sha256.description_user, cur.id).toBe(
          prev.expected.prompt_sha256.description_user,
        );
        if (ids.has(cur.id)) expect(cur.expected, cur.id).not.toEqual(prev.expected);
        else expect(cur.expected, cur.id).toEqual(prev.expected);
      }
      // The manifest's counts are this corpus's counts.
      for (const verdict of ['FIT', 'NEUTRAL', 'REFUSED', 'FAILED']) {
        expect(d.manifest.per_verdict[verdict] ?? 0, verdict).toBe(
          d.cases.filter((c) => c.expected.outcome.verdict === verdict).length,
        );
      }
      expect(d.manifest.headline_called).toBe(
        d.cases.filter((c) => c.expected.headline_called).length,
      );
      expect(d.manifest.headline_suppressed).toBe(
        d.cases.filter((c) => c.expected.headline_called && c.expected.headline === null).length,
      );
    });

    describe.each(d.cases.filter((c) => !laterIds.has(c.id)).map((c) => [c.id, c] as const))(
      '%s',
      (_id, c) => {
        it(`generates identically to the v${String(version)} record`, async () => {
          await expectIdentical(c);
        });
      },
    );
  },
);

describe('description parity corpus v6 (FOLLOW-1392 — meta-commentary)', () => {
  it('the one v6 delta is a true leak caught earlier: REFUSED/unsupported_amenity → FAILED/meta_commentary', () => {
    const id = 'live.016.listing-007.yield_hunter.en';
    const v5 = CASES_V5.find((c) => c.id === id)!;
    const v6 = VERDICT_DELTAS[0]!.cases.find((c) => c.id === id)!;
    expect(v5.expected.outcome).toEqual({ verdict: 'REFUSED', violation: 'unsupported_amenity' });
    expect(v6.expected.outcome).toEqual({ verdict: 'FAILED', reason: 'meta_commentary' });
    expect(v6.raw_description.text).toContain('The original description flags');
    expect(v6.expected.headline_called).toBe(false);
  });
});

describe('description parity corpus v7 (FOLLOW-1394 — a pool of people is not a pool)', () => {
  it('the one v7 delta is the demand-pool false refusal: REFUSED/unsupported_amenity → FIT', () => {
    const id = 'live.011.listing-005.yield_hunter.en';
    const v6 = VERDICT_DELTAS[0]!.cases.find((c) => c.id === id)!;
    const v7 = VERDICT_DELTAS[1]!.cases.find((c) => c.id === id)!;
    expect(v6.expected.outcome).toEqual({ verdict: 'REFUSED', violation: 'unsupported_amenity' });
    expect(v7.expected.outcome.verdict).toBe('FIT');
    expect(v7.expected.outcome.description).toContain('a defensible tenant demand pool');
    expect(v7.expected.claims_validation).toBe(CLAIMS_VALIDATION_VERSION);
    // The recorded raw headline is null (the case was REFUSED when recorded): suppressed as empty.
    expect(v7.raw_headline).toBeNull();
    expect(v7.expected.headline_violation).toBe('empty');
  });
});

describe('description parity corpus v8 (FOLLOW-1400 — familial steering on the description path)', () => {
  const v7 = (id: string) => VERDICT_DELTAS[1]!.cases.find((c) => c.id === id)!;
  const v8 = (id: string) => VERDICT_DELTAS[2]!.cases.find((c) => c.id === id)!;

  it('two FIT bodies that say "family home" are now REFUSED / familial_steering', () => {
    for (const id of [
      'live.002.listing-001.family_buyer.en',
      'live.032.839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c.neutral.en',
    ]) {
      expect(v7(id).expected.outcome.verdict, id).toBe('FIT');
      expect(v8(id).expected.outcome, id).toEqual({
        verdict: 'REFUSED',
        violation: 'familial_steering',
      });
      expect(v8(id).expected.headline_called, id).toBe(false);
      expect(v8(id).raw_description.text, id).toMatch(/family home/i);
    }
  });

  it('a refused body is refused for steering first, as `/api/adapt` orders it', () => {
    const id = 'live.026.listing-011.diaspora_buyer.en';
    expect(v7(id).expected.outcome).toEqual({
      verdict: 'REFUSED',
      violation: 'unsupported_amenity',
    });
    expect(v8(id).expected.outcome).toEqual({ verdict: 'REFUSED', violation: 'familial_steering' });
  });

  it('a steering headline is suppressed as familial_steering before its fact check', () => {
    const id = 'live.029.839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c.family_buyer.en';
    expect(v7(id).expected.headline_violation).toBe('hallucinated_proper_name');
    expect(v8(id).expected.outcome).toEqual(v7(id).expected.outcome);
    expect(v8(id).expected.headline_violation).toBe('familial_steering');
  });
});
