/**
 * FOLLOW-1297 — the parity test (ADR-0023 §4, CONVENTIONS_PATCH Rule Z); FOLLOW-1314 — corpus v2;
 * FOLLOW-1315 — corpus v3; FOLLOW-1381 — corpus v4; FOLLOW-1382 — corpus v5; FOLLOW-1392 and later —
 * corpus v6+ (verdict deltas, see `VERDICT_DELTAS`); FOLLOW-1402 — corpus v9 (a prompt re-freeze
 * between them); FOLLOW-1406 — corpus v10 (a stamp-only re-freeze); FOLLOW-1411 — corpus v11 (a
 * verdict delta), v12 (a headline prompt re-freeze) and v13 (a stamp-only re-freeze); FOLLOW-1415
 * — corpus v14 (a stamp-only re-freeze); FOLLOW-1408 — corpus v15 (a headline persona re-freeze);
 * FOLLOW-1397 — corpus v16 (a verdict delta); FOLLOW-1414 — corpus v17 (a description and Polish
 * headline prompt re-freeze) and v18 (a stamp-only re-freeze); FOLLOW-1419 — corpus v19 (a
 * stamp-only re-freeze); FOLLOW-1420 / FOLLOW-1421 — corpus v20 (a stamp-only re-freeze, the
 * current contract).
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
 *   - `corpus.v9.jsonl` + `MANIFEST.v9.json` — FOLLOW-1402 appended a language paragraph to the
 *     description USER prompt, so v9 is a prompt-digest re-freeze of v8 (like v5): only
 *     `prompt_sha256.description_user` differs, in every case, and the v9 guard proves the new
 *     prompt is the v8 prompt plus that paragraph, byte for byte. Every guard replays
 *     with the CURRENT description user digests (v9's), as the headline digests are replayed.
 *   - `corpus.v10.jsonl` + `MANIFEST.v10.json` — FOLLOW-1406 bumped `CLAIMS_VALIDATION_VERSION`
 *     from `claims-v1` to `claims-v2`, so v10 is a STAMP-ONLY re-freeze of v9: its bytes are v9's
 *     with every `"claims_validation": "claims-v1"` read as `"claims-v2"`, and nothing else. The
 *     v10 guard proves that byte for byte; every older guard replays with the CURRENT stamp
 *     (v12's), as it replays the current prompt digests, and its manifest keeps `claims-v1`.
 *   - `corpus.v11.jsonl` + `MANIFEST.v11.json` — FOLLOW-1411 (ESC-089) lifted the familial-steering
 *     refusal, so v11 is a verdict delta of v10 in `VERDICT_DELTAS`: the four cases v8 changed go
 *     back to their v7 outcome (stamped `claims-v2`, the current stamp, not v7's `claims-v1`).
 *   - `corpus.v12.jsonl` + `MANIFEST.v12.json` — FOLLOW-1411 also rewrote four headline personas
 *     (`ARCHETYPE_GUIDANCE`), so v12 is a prompt-digest re-freeze of v11 (like v5): only
 *     `prompt_sha256.headline_user` differs, in the listed cases, and the v12 guard proves each new
 *     prompt is the v11 prompt with the persona text swapped, byte for byte. Every guard replays
 *     with the CURRENT headline digests (v12's).
 *   - `corpus.v13.jsonl` + `MANIFEST.v13.json` — FOLLOW-1411 bumped `CLAIMS_VALIDATION_VERSION` to
 *     `claims-v3` (a `claims-v2` row never passed the FOLLOW-1411 checks), so v13 is a stamp-only
 *     re-freeze of v12 like v10: `"claims-v2"` read as `"claims-v3"` in every FIT case, nothing
 *     else.
 *   - `corpus.v14.jsonl` + `MANIFEST.v14.json` — FOLLOW-1415 bumped `CLAIMS_VALIDATION_VERSION` to
 *     `claims-v4` (a `claims-v3` row never passed the sensitive-history refusal), so v14 is a
 *     stamp-only re-freeze of v13 like v13 of v12: `"claims-v3"` read as `"claims-v4"` in every FIT
 *     case, nothing else (no corpus verdict moved under the FOLLOW-1415 guard). Every guard replays
 *     with the CURRENT stamp (v14's).
 *   - `corpus.v15.jsonl` + `MANIFEST.v15.json` — FOLLOW-1408 rewrote the first_time_buyer headline
 *     persona (no more "move-in readiness"), so v15 is a prompt-digest re-freeze of v14 like v12:
 *     only `prompt_sha256.headline_user` of the listed cases differs, and each new prompt is the v14
 *     prompt with the persona swapped. Every guard replays with the CURRENT headline digests
 *     (v15's).
 *   - `corpus.v16.jsonl` + `MANIFEST.v16.json` — FOLLOW-1397 (multiplied numbers: "€750K", "1,15
 *     mln") is a verdict delta of v15 in `VERDICT_DELTAS`; the v9–v15 guards stop replaying the
 *     case it changed.
 *   - `corpus.v17.jsonl` + `MANIFEST.v17.json` — FOLLOW-1414 appended a paragraph to the
 *     description USER prompt (write about the home, not the listing; Polish room counts) and, on a
 *     Polish page, to the headline USER prompt, so v17 is a prompt-digest re-freeze of v16 (like
 *     v9 and v5 together). Every guard replays with the CURRENT description user and headline
 *     digests (v17's).
 *   - `corpus.v18.jsonl` + `MANIFEST.v18.json` — FOLLOW-1414 bumped `CLAIMS_VALIDATION_VERSION` to
 *     `claims-v5` (a `claims-v4` row never passed the listing-attribution refusal), so v18 is a
 *     stamp-only re-freeze of v17 like v14 of v13.
 *   - `corpus.v19.jsonl` + `MANIFEST.v19.json` — FOLLOW-1419 bumped `CLAIMS_VALIDATION_VERSION` to
 *     `claims-v6` (a `claims-v5` row never passed the tightened protected-ground guard: painful
 *     history terms, a place named by a group without a historical adjective), so v19 is a
 *     stamp-only re-freeze of v18 like v18 of v17 (no corpus verdict moved under the tightened
 *     guard).
 *   - `corpus.v20.jsonl` + `MANIFEST.v20.json` — FOLLOW-1420 with FOLLOW-1421 bumped
 *     `CLAIMS_VALIDATION_VERSION` to `claims-v7` (a `claims-v6` row never passed the majority
 *     composition refusal, and its multiplied price may have been rounded), so v20 is a stamp-only
 *     re-freeze of v19 like v19 of v18 (no corpus verdict moved under the tightened checks). Every
 *     guard replays with the CURRENT stamp (v20's).
 *   - `corpus.v21.jsonl` + `MANIFEST.v21.json` — FOLLOW-1311 slice 2 (T3: a digit count the listing
 *     states in words) is a verdict delta of v20 in `VERDICT_DELTAS`: three recorded headlines are
 *     refused for their next violation instead. No stamp bump: a loosening.
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
const CASES_V9: Case[] = readCorpus('corpus.v9.jsonl');
const MANIFEST_V9 = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'MANIFEST.v9.json'), 'utf8'),
) as ManifestV3;
/**
 * The CURRENT description user prompt digests, by case id (FOLLOW-1402 re-froze them as v9; its
 * guard asserts they were that corpus's only change).
 */
const CASES_V17: Case[] = readCorpus('corpus.v17.jsonl');
const MANIFEST_V17 = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'MANIFEST.v17.json'), 'utf8'),
) as ManifestV3 & { headline_refrozen: string[] };
/** FOLLOW-1414 (v17) re-froze them again; its guard asserts that was v17's only change. */
const DESCRIPTION_USER_SHA = new Map(
  CASES_V17.map((c) => [c.id, c.expected.prompt_sha256.description_user] as const),
);
/** The claims-validation stamp every corpus v1–v9 was frozen with (the manifests keep it). */
const FROZEN_STAMP = 'claims-v1';
const CASES_V10: Case[] = readCorpus('corpus.v10.jsonl');
const MANIFEST_V10 = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'MANIFEST.v10.json'), 'utf8'),
) as ManifestV3 & { stamp_refreeze: { from: string; to: string; cases: number } };
/** The stamp v10 introduced (FOLLOW-1406); the corpora after it are frozen with it. */
const V10_STAMP = 'claims-v2';
const CASES_V12: Case[] = readCorpus('corpus.v12.jsonl');
const MANIFEST_V12 = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'MANIFEST.v12.json'), 'utf8'),
) as ManifestV3 & {
  persona_change: Record<string, { from: string; to: string }>;
  refrozen: string[];
};
const CASES_V13: Case[] = readCorpus('corpus.v13.jsonl');
const MANIFEST_V13 = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'MANIFEST.v13.json'), 'utf8'),
) as ManifestV3 & { stamp_refreeze: { from: string; to: string; cases: number } };
/** The stamp v13 introduced (FOLLOW-1411); v14 moved the constant on (FOLLOW-1415). */
const V13_STAMP = 'claims-v3';
const CASES_V14: Case[] = readCorpus('corpus.v14.jsonl');
const MANIFEST_V14 = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'MANIFEST.v14.json'), 'utf8'),
) as ManifestV3 & { stamp_refreeze: { from: string; to: string; cases: number } };
/**
 * The CURRENT claims-validation stamp, by case id (FOLLOW-1406 re-froze it as v10, FOLLOW-1411 as
 * v13, FOLLOW-1415 as v14, FOLLOW-1414 as v18, FOLLOW-1419 as v19, FOLLOW-1420 as v20; each of
 * those guards asserts it was that corpus's only change).
 */
const CASES_V18: Case[] = readCorpus('corpus.v18.jsonl');
const MANIFEST_V18 = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'MANIFEST.v18.json'), 'utf8'),
) as ManifestV3 & { stamp_refreeze: { from: string; to: string; cases: number } };
/** The stamp v18 introduced (FOLLOW-1414); v19 moved the constant on (FOLLOW-1419). */
const V18_STAMP = 'claims-v5';
const CASES_V19: Case[] = readCorpus('corpus.v19.jsonl');
const MANIFEST_V19 = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'MANIFEST.v19.json'), 'utf8'),
) as ManifestV3 & { stamp_refreeze: { from: string; to: string; cases: number } };
/** The stamp v19 introduced (FOLLOW-1419); v20 moved the constant on (FOLLOW-1420). */
const V19_STAMP = 'claims-v6';
const CASES_V20: Case[] = readCorpus('corpus.v20.jsonl');
const MANIFEST_V20 = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'MANIFEST.v20.json'), 'utf8'),
) as ManifestV3 & { stamp_refreeze: { from: string; to: string; cases: number } };
const STAMP = new Map(CASES_V20.map((c) => [c.id, c.expected.claims_validation] as const));
/** The stamp v20 introduced (FOLLOW-1420); the corpora after it are frozen with it. */
const V20_STAMP = 'claims-v7';
/** The stamp v14 introduced (FOLLOW-1415); the corpora after it are frozen with it. */
const V14_STAMP = 'claims-v4';
const CASES_V15: Case[] = readCorpus('corpus.v15.jsonl');
const MANIFEST_V15 = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'MANIFEST.v15.json'), 'utf8'),
) as ManifestV3 & {
  persona_change: Record<string, { from: string; to: string }>;
  refrozen: string[];
};
/**
 * The CURRENT headline prompt digests, by case id (FOLLOW-1315 re-froze them as v3, FOLLOW-1382
 * as v5, FOLLOW-1411 as v12, FOLLOW-1408 as v15, FOLLOW-1414 as v17 for a Polish page; each of
 * those guards asserts they were that corpus's only change).
 */
const HEADLINE_SHA = new Map(CASES_V17.map((c) => [c.id, c.expected.prompt_sha256] as const));

/**
 * The verdict deltas after v5, oldest first, each derived from the corpus before it (v6 from v5).
 * FOLLOW-1392 — v6 (meta-commentary); FOLLOW-1394 — v7 (a pool of people, views of the sea);
 * FOLLOW-1400 — v8 (familial steering, refused as on `/api/adapt`); FOLLOW-1411 — v11 (ESC-089 lifts
 * it: the four v8 cases go back to their v7 outcome); FOLLOW-1397 — v16 (a multiplied number).
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
  {
    version: 11,
    ticket: 'FOLLOW-1411',
    ids: [
      'live.002.listing-001.family_buyer.en',
      'live.026.listing-011.diaspora_buyer.en',
      'live.029.839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c.family_buyer.en',
      'live.032.839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c.neutral.en',
    ],
  },
  { version: 16, ticket: 'FOLLOW-1397', ids: ['live.020.listing-009.yield_hunter.en'] },
  {
    version: 21,
    ticket: 'FOLLOW-1311',
    ids: [
      'live.030.839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c.first_time_buyer.en',
      'live.031.839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c.flip_investor.en',
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
/** Every case a verdict delta after v9 changed: the v9 guard no longer replays it. */
const AFTER_V9_DELTA_IDS = new Set(
  VERDICT_DELTAS.filter((d) => d.version > 9).flatMap((d) => d.manifest.delta.map((x) => x.id)),
);
/** Every case a verdict delta after v15 changed: the v12–v15 guards no longer replay it. */
const AFTER_V15_DELTA_IDS = new Set(
  VERDICT_DELTAS.filter((d) => d.version > 15).flatMap((d) => d.manifest.delta.map((x) => x.id)),
);
/** Every case a verdict delta after v20 changed: the v17–v20 guards no longer replay it. */
const AFTER_V20_DELTA_IDS = new Set(
  VERDICT_DELTAS.filter((d) => d.version > 20).flatMap((d) => d.manifest.delta.map((x) => x.id)),
);

/** The corpus a verdict delta is derived from: the one numbered just before it. */
function corpusBefore(version: number): { cases: Case[]; manifest: ManifestV3 } {
  if (version - 1 === 5) return { cases: CASES_V5, manifest: MANIFEST_V5 };
  if (version - 1 === 9) return { cases: CASES_V9, manifest: MANIFEST_V9 };
  if (version - 1 === 10) return { cases: CASES_V10, manifest: MANIFEST_V10 };
  if (version - 1 === 15) return { cases: CASES_V15, manifest: MANIFEST_V15 };
  if (version - 1 === 20) return { cases: CASES_V20, manifest: MANIFEST_V20 };
  const d = VERDICT_DELTAS.find((x) => x.version === version - 1);
  if (d === undefined) throw new Error(`no corpus v${String(version - 1)}`);
  return d;
}

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
async function expectIdentical(c: Case, headlineSha = HEADLINE_SHA.get(c.id)!): Promise<void> {
  mockCreate
    .mockResolvedValueOnce(response(c.raw_description.text, c.raw_description.stop_reason))
    .mockResolvedValueOnce(response(c.raw_headline ?? '', 'end_turn'));

  const report = await generateDescription(c.input);

  // The description call: the exact prompt bytes the Python sent, the same budget and model.
  const desc = mockCreate.mock.calls[0]![0] as CreateParams;
  expect(desc.model).toBe(c.expected.model);
  expect(desc.max_tokens).toBe(c.expected.max_tokens);
  expect(sha(desc.system)).toBe(c.expected.prompt_sha256.description_system);
  // The current description user prompt (v9, FOLLOW-1402); the system prompt is v1's.
  expect(sha(desc.messages[0]!.content)).toBe(DESCRIPTION_USER_SHA.get(c.id));

  expect(report.outcome).toEqual(c.expected.outcome);
  // The current stamp (v10, FOLLOW-1406); a FIT case of an older corpus recorded `claims-v1`.
  expect(report.claimsValidation).toBe(STAMP.get(c.id));
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
    expect(MANIFEST.claims_validation_version).toBe(FROZEN_STAMP);
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
    expect(MANIFEST_V2.claims_validation_version).toBe(FROZEN_STAMP);
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
    expect(MANIFEST_V3.claims_validation_version).toBe(FROZEN_STAMP);
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
    expect(MANIFEST_V4.claims_validation_version).toBe(FROZEN_STAMP);
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

/** FOLLOW-1411: a headline user prompt with its v12 persona swapped back to the one before v12. */
function beforeV12Persona(user: string, c: Case): string {
  return beforePersona(MANIFEST_V12.persona_change, user, c);
}

/** FOLLOW-1408 (v15): the headline user prompt with the first_time_buyer persona as before v15. */
function beforeV15Persona(user: string, c: Case): string {
  return beforePersona(MANIFEST_V15.persona_change, user, c);
}

function beforePersona(
  personaChange: Record<string, { from: string; to: string }>,
  user: string,
  c: Case,
): string {
  const change = personaChange[c.input.archetype];
  if (change === undefined) return user;
  const marker = `Persona guidance (tone only — it adds no facts): `;
  expect(user, c.id).toContain(`${marker}${change.to}\n`);
  return user.replace(`${marker}${change.to}\n`, `${marker}${change.from}\n`);
}

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
    expect(MANIFEST_V5.claims_validation_version).toBe(FROZEN_STAMP);
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
      // FOLLOW-1411 (v12) swapped four personas, FOLLOW-1408 (v15) one more; read the prompt as
      // it was before v12.
      const user = beforeV12Persona(
        beforeV15Persona(
          beforeV17Headline((mockCreate.mock.calls[1]![0] as CreateParams).messages[0]!.content, c),
          c,
        ),
        c,
      );
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
    const { cases: prevCases, manifest: prevManifest } = corpusBefore(version);
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
      // Frozen before v10 with claims-v1; after it with the stamp v10 introduced [FOLLOW-1411];
      // after v14 with v14's [FOLLOW-1397].
      expect(d.manifest.claims_validation_version).toBe(
        d.version > 20
          ? V20_STAMP
          : d.version > 14
            ? V14_STAMP
            : d.version > 10
              ? V10_STAMP
              : FROZEN_STAMP,
      );
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
    expect(v7.expected.claims_validation).toBe(FROZEN_STAMP);
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

/** FOLLOW-1402: the paragraph the description user prompt now ends with, per locale. */
function descriptionLanguageParagraph(locale: string): string {
  const language = ({ en: 'English', pl: 'Polish', es: 'Spanish' } as Record<string, string>)[
    locale
  ]!;
  return (
    `\n\nLANGUAGE: write the description body in ${language} (locale: ${locale}). ` +
    `original_description and listing_context may be in another language: do not answer in ` +
    `their language and do not translate them word for word; compose the body natively in ` +
    `${language}. Keep place names and other proper names exactly as the listing writes them.`
  );
}

/** FOLLOW-1414: the Polish room-count paragraph (v17), as the generator writes it. */
const POLISH_ROOM_COUNTS =
  'Polish room counts are one word: jednopokojowe, dwupokojowe, trzypokojowe, czteropokojowe, ' +
  'pięciopokojowe (for example "mieszkanie dwupokojowe", "dwupokojowe mieszkanie").';

/** FOLLOW-1414: the paragraph the description user prompt ends with since v17, per locale. */
function aboutTheHomeParagraph(locale: string): string {
  return (
    '\n\nWRITE ABOUT THE HOME, NOT THE LISTING: state each fact the sources give as a fact about ' +
    'the property ("The flat has a balcony."), never as something the listing reports ("the ' +
    'listing says", "according to the description", "ogłoszenie podaje", "el anuncio indica").' +
    (locale === 'pl' ? ` ${POLISH_ROOM_COUNTS}` : '')
  );
}

/** FOLLOW-1414: the paragraph a Polish headline user prompt ends with since v17. */
function headlineRoomCountParagraph(locale: string): string {
  return locale === 'pl' ? `\n\n${POLISH_ROOM_COUNTS}` : '';
}

/** The description user prompt as before v17 (FOLLOW-1414). */
function beforeV17Description(user: string, c: Case): string {
  const paragraph = aboutTheHomeParagraph(c.input.locale);
  expect(user.endsWith(paragraph), c.id).toBe(true);
  return user.slice(0, user.length - paragraph.length);
}

/** The headline user prompt as before v17 (FOLLOW-1414): a Polish page lost its last paragraph. */
function beforeV17Headline(user: string, c: Case): string {
  const paragraph = headlineRoomCountParagraph(c.input.locale);
  expect(user.endsWith(paragraph), c.id).toBe(true);
  return user.slice(0, user.length - paragraph.length);
}

describe('description parity corpus v9 (FOLLOW-1402 — description language, prompt re-freeze)', () => {
  const v8 = VERDICT_DELTAS.find((d) => d.version === 8)!;

  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'parity-'.repeat(4));
    mockCreate.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('v9 is v8 with ONLY the description USER prompt digests changed', () => {
    expect(MANIFEST_V9.corpus).toBe('corpus.v9.jsonl');
    expect(MANIFEST_V9.kind).toBe('prompt_digest_refreeze');
    expect(MANIFEST_V9.derived_from.corpus).toBe('corpus.v8.jsonl');
    expect(MANIFEST_V9.derived_from.corpus_sha256).toBe(v8.manifest.corpus_sha256);
    expect(sha(readFileSync(join(FIXTURE_DIR, 'corpus.v9.jsonl'), 'utf8'))).toBe(
      MANIFEST_V9.corpus_sha256,
    );
    expect(MANIFEST_V9.case_count).toBe(CASES_V9.length);
    expect(MANIFEST_V9.claims_validation_version).toBe(FROZEN_STAMP);
    expect(MANIFEST_V9.delta).toEqual([]);
    expect(MANIFEST_V9.per_verdict).toEqual(v8.manifest.per_verdict);
    expect(MANIFEST_V9.per_reason).toEqual(v8.manifest.per_reason);
    expect(CASES_V9.map((c) => c.id)).toEqual(v8.cases.map((c) => c.id));
    for (const [i, v9] of CASES_V9.entries()) {
      const prev = v8.cases[i]!;
      const { prompt_sha256: p9, ...rest9 } = v9.expected;
      const { prompt_sha256: p8, ...rest8 } = prev.expected;
      expect(v9.kind, v9.id).toBe(prev.kind);
      expect(v9.input, v9.id).toEqual(prev.input);
      expect(v9.raw_description, v9.id).toEqual(prev.raw_description);
      expect(v9.raw_headline, v9.id).toBe(prev.raw_headline);
      expect(rest9, v9.id).toEqual(rest8);
      expect(p9.description_system, v9.id).toBe(p8.description_system);
      expect(p9.headline_system, v9.id).toBe(p8.headline_system);
      expect(p9.headline_user, v9.id).toBe(p8.headline_user);
      expect(p9.description_user, v9.id).not.toBe(p8.description_user);
    }
  });

  it('every new description user prompt is the v8 prompt plus the language paragraph, byte for byte', async () => {
    const locales = new Set<string>();
    for (const c of CASES_V9) {
      const prev = v8.cases.find((x) => x.id === c.id)!;
      mockCreate.mockReset();
      mockCreate
        .mockResolvedValueOnce(response(c.raw_description.text, c.raw_description.stop_reason))
        .mockResolvedValueOnce(response(c.raw_headline ?? '', 'end_turn'));
      await generateDescription(c.input);
      // FOLLOW-1414 (v17) appended one more paragraph; read the prompt as it was before v17.
      const user = beforeV17Description(
        (mockCreate.mock.calls[0]![0] as CreateParams).messages[0]!.content,
        c,
      );
      const paragraph = descriptionLanguageParagraph(c.input.locale);
      expect(user.endsWith(paragraph), c.id).toBe(true);
      expect(sha(user.slice(0, user.length - paragraph.length)), c.id).toBe(
        prev.expected.prompt_sha256.description_user,
      );
      locales.add(c.input.locale);
    }
    expect(locales.size).toBeGreaterThan(1);
  });

  describe.each(
    CASES_V9.filter((c) => !AFTER_V9_DELTA_IDS.has(c.id)).map((c) => [c.id, c] as const),
  )('%s', (_id, c) => {
    it('generates identically to the v9 record', async () => {
      await expectIdentical(c);
    });
  });
});

describe('description parity corpus v10 (FOLLOW-1406 — claims-v2, stamp-only re-freeze)', () => {
  const V9_TEXT = readFileSync(join(FIXTURE_DIR, 'corpus.v9.jsonl'), 'utf8');
  const V10_TEXT = readFileSync(join(FIXTURE_DIR, 'corpus.v10.jsonl'), 'utf8');
  const OLD = '"claims_validation": "claims-v1"';
  const NEW = '"claims_validation": "claims-v2"';

  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'parity-'.repeat(4));
    mockCreate.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  // History pins its own literal: v10's stamp is claims-v2, the constant moved on (FOLLOW-1411).
  it('the manifest describes v10 as a stamp re-freeze of v9 under claims-v2', () => {
    expect(MANIFEST_V10.corpus).toBe('corpus.v10.jsonl');
    expect(MANIFEST_V10.kind).toBe('stamp_refreeze');
    expect(MANIFEST_V10.derived_from.corpus).toBe('corpus.v9.jsonl');
    expect(MANIFEST_V10.derived_from.manifest).toBe('MANIFEST.v9.json');
    expect(MANIFEST_V10.derived_from.corpus_sha256).toBe(MANIFEST_V9.corpus_sha256);
    expect(sha(V9_TEXT)).toBe(MANIFEST_V10.derived_from.corpus_sha256);
    expect(sha(V10_TEXT)).toBe(MANIFEST_V10.corpus_sha256);
    expect(MANIFEST_V10.claims_validation_version).toBe(V10_STAMP);
    expect(MANIFEST_V10.stamp_refreeze).toEqual({
      from: FROZEN_STAMP,
      to: V10_STAMP,
      cases: MANIFEST_V9.per_verdict.FIT,
    });
    expect(MANIFEST_V10.delta).toEqual([]);
    expect(MANIFEST_V10.case_count).toBe(CASES_V10.length);
    const m10 = MANIFEST_V10 as unknown as Record<string, unknown>;
    const m9 = MANIFEST_V9 as unknown as Record<string, unknown>;
    // Every other manifest field is v9's: counts, composition, digest format.
    const own = ['change', 'corpus', 'corpus_sha256', 'derived_from', 'kind'];
    own.push('claims_validation_version', 'stamp_refreeze');
    expect(Object.keys(m10).sort()).toEqual([...new Set([...Object.keys(m9), ...own])].sort());
    for (const key of Object.keys(m9)) {
      if (own.includes(key)) continue;
      expect(m10[key], key).toEqual(m9[key]);
    }
  });

  it('v10 is v9 byte for byte except the stamp value, in every FIT case and nowhere else', () => {
    expect(V9_TEXT.split(OLD).length - 1).toBe(MANIFEST_V9.per_verdict.FIT);
    expect(V10_TEXT.split(NEW).length - 1).toBe(MANIFEST_V9.per_verdict.FIT);
    expect(V9_TEXT.includes(NEW)).toBe(false);
    expect(V10_TEXT.includes('claims-v1')).toBe(false);
    expect(V10_TEXT).toBe(V9_TEXT.split(OLD).join(NEW));
    expect(V10_TEXT.length).toBe(V9_TEXT.length); // same-length value: no byte shifted
  });

  it('per case: only expected.claims_validation moved, claims-v1 → claims-v2, null stays null', () => {
    expect(CASES_V10.map((c) => c.id)).toEqual(CASES_V9.map((c) => c.id));
    for (const [i, v10] of CASES_V10.entries()) {
      const v9 = CASES_V9[i]!;
      const { claims_validation: s10, ...rest10 } = v10.expected;
      const { claims_validation: s9, ...rest9 } = v9.expected;
      expect({ ...v10, expected: rest10 }, v10.id).toEqual({ ...v9, expected: rest9 });
      if (v9.expected.outcome.verdict === 'FIT') {
        expect(s9, v10.id).toBe(FROZEN_STAMP);
        expect(s10, v10.id).toBe(V10_STAMP);
      } else {
        expect(s9, v10.id).toBeNull();
        expect(s10, v10.id).toBeNull();
      }
    }
  });

  describe.each(
    CASES_V10.filter((c) => !AFTER_V9_DELTA_IDS.has(c.id)).map((c) => [c.id, c] as const),
  )('%s', (_id, c) => {
    it('generates identically to the v10 record', async () => {
      await expectIdentical(c);
    });
  });
});

describe('description parity corpus v11 (FOLLOW-1411 — ESC-089 lifts familial steering)', () => {
  const v7 = (id: string) =>
    VERDICT_DELTAS.find((d) => d.version === 7)!.cases.find((c) => c.id === id)!;
  const v11 = (id: string) =>
    VERDICT_DELTAS.find((d) => d.version === 11)!.cases.find((c) => c.id === id)!;

  it('the four v8 cases are back to their v7 outcome, headline and violation', () => {
    for (const id of VERDICT_DELTAS.find((d) => d.version === 8)!.ids) {
      const e7: Partial<Case['expected']> = { ...v7(id).expected };
      const e11: Partial<Case['expected']> = { ...v11(id).expected };
      const [s7, s11] = [e7.claims_validation, e11.claims_validation];
      for (const e of [e7, e11]) {
        delete e.claims_validation;
        delete e.prompt_sha256;
      }
      expect(e11, id).toEqual(e7);
      // The stamp is the current one where the case is FIT, never v7's claims-v1.
      expect(s11, id).toBe(s7 === null ? null : V10_STAMP);
    }
  });

  it('the two family bodies are served again; the diaspora body is still refused, for a fact', () => {
    for (const id of [
      'live.002.listing-001.family_buyer.en',
      'live.032.839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c.neutral.en',
    ]) {
      expect(v11(id).expected.outcome.verdict, id).toBe('FIT');
      expect(v11(id).raw_description.text, id).toMatch(/family home/i);
    }
    expect(v11('live.026.listing-011.diaspora_buyer.en').expected.outcome).toEqual({
      verdict: 'REFUSED',
      violation: 'unsupported_amenity',
    });
    expect(
      v11('live.029.839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c.family_buyer.en').expected
        .headline_violation,
    ).toBe('hallucinated_proper_name');
  });

  it('no case of the corpus is refused for familial steering any more', () => {
    for (const c of VERDICT_DELTAS.find((d) => d.version === 11)!.cases) {
      expect(c.expected.outcome, c.id).not.toEqual({
        verdict: 'REFUSED',
        violation: 'familial_steering',
      });
      expect(c.expected.headline_violation, c.id).not.toBe('familial_steering');
    }
  });
});

describe('description parity corpus v12 (FOLLOW-1411 — headline persona re-freeze)', () => {
  const v11 = VERDICT_DELTAS.find((d) => d.version === 11)!;
  const REFROZEN = new Set(MANIFEST_V12.refrozen);

  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'parity-'.repeat(4));
    mockCreate.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('v12 is v11 with ONLY the headline USER prompt digests of the listed cases changed', () => {
    expect(MANIFEST_V12.corpus).toBe('corpus.v12.jsonl');
    expect(MANIFEST_V12.kind).toBe('prompt_digest_refreeze');
    expect(MANIFEST_V12.derived_from.corpus).toBe('corpus.v11.jsonl');
    expect(MANIFEST_V12.derived_from.corpus_sha256).toBe(v11.manifest.corpus_sha256);
    expect(sha(readFileSync(join(FIXTURE_DIR, 'corpus.v12.jsonl'), 'utf8'))).toBe(
      MANIFEST_V12.corpus_sha256,
    );
    expect(MANIFEST_V12.case_count).toBe(CASES_V12.length);
    expect(MANIFEST_V12.claims_validation_version).toBe(V10_STAMP);
    expect(MANIFEST_V12.delta).toEqual([]);
    expect(MANIFEST_V12.per_verdict).toEqual(v11.manifest.per_verdict);
    expect(MANIFEST_V12.per_reason).toEqual(v11.manifest.per_reason);
    expect(MANIFEST_V12.headline_suppressed).toBe(v11.manifest.headline_suppressed);
    expect(Object.keys(MANIFEST_V12.persona_change).sort()).toEqual([
      'family_buyer',
      'lifestyle_expat',
      'second_home_buyer',
      'upsizer',
    ]);
    expect(CASES_V12.map((c) => c.id)).toEqual(v11.cases.map((c) => c.id));
    for (const [i, v12] of CASES_V12.entries()) {
      const prev = v11.cases[i]!;
      const { prompt_sha256: p12, ...rest12 } = v12.expected;
      const { prompt_sha256: p11, ...rest11 } = prev.expected;
      expect({ ...v12, expected: rest12 }, v12.id).toEqual({ ...prev, expected: rest11 });
      expect(p12.description_system, v12.id).toBe(p11.description_system);
      expect(p12.description_user, v12.id).toBe(p11.description_user);
      expect(p12.headline_system, v12.id).toBe(p11.headline_system);
      if (REFROZEN.has(v12.id)) {
        expect(v12.expected.headline_called, v12.id).toBe(true);
        expect(Object.keys(MANIFEST_V12.persona_change), v12.id).toContain(v12.input.archetype);
        expect(p12.headline_user, v12.id).not.toBe(p11.headline_user);
      } else {
        expect(p12.headline_user, v12.id).toBe(p11.headline_user);
      }
    }
  });

  it('every headline-calling case of a changed persona is re-frozen, and none other', () => {
    const changed = new Set(Object.keys(MANIFEST_V12.persona_change));
    expect(
      CASES_V12.filter((c) => c.expected.headline_called && changed.has(c.input.archetype))
        .map((c) => c.id)
        .sort(),
    ).toEqual([...REFROZEN].sort());
  });

  it('every new headline user prompt is the v11 prompt with the persona swapped, byte for byte', async () => {
    for (const c of CASES_V12.filter((x) => REFROZEN.has(x.id))) {
      const prev = v11.cases.find((x) => x.id === c.id)!;
      mockCreate.mockReset();
      mockCreate
        .mockResolvedValueOnce(response(c.raw_description.text, c.raw_description.stop_reason))
        .mockResolvedValueOnce(response(c.raw_headline ?? '', 'end_turn'));
      await generateDescription(c.input);
      const user = (mockCreate.mock.calls[1]![0] as CreateParams).messages[0]!.content;
      expect(sha(user), c.id).toBe(c.expected.prompt_sha256.headline_user);
      expect(sha(beforeV12Persona(user, c)), c.id).toBe(prev.expected.prompt_sha256.headline_user);
    }
  });

  it('the new personas keep schools and safety to what the listing states', () => {
    for (const [archetype, { to }] of Object.entries(MANIFEST_V12.persona_change)) {
      if (/school|safety/i.test(to)) expect(to, archetype).toMatch(/only as the listing states/);
    }
    expect(MANIFEST_V12.persona_change.family_buyer!.to).toMatch(/family/i);
  });

  describe.each(
    CASES_V12.filter((c) => !AFTER_V15_DELTA_IDS.has(c.id)).map((c) => [c.id, c] as const),
  )('%s', (_id, c) => {
    it('generates identically to the v12 record', async () => {
      await expectIdentical(c);
    });
  });
});

describe('description parity corpus v13 (FOLLOW-1411 — claims-v3, stamp-only re-freeze)', () => {
  const V12_TEXT = readFileSync(join(FIXTURE_DIR, 'corpus.v12.jsonl'), 'utf8');
  const V13_TEXT = readFileSync(join(FIXTURE_DIR, 'corpus.v13.jsonl'), 'utf8');
  const OLD = `"claims_validation": "${V10_STAMP}"`;
  const NEW = `"claims_validation": "${V13_STAMP}"`;

  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'parity-'.repeat(4));
    mockCreate.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  // History pins its own literal: v13's stamp is claims-v3, the constant moved on (FOLLOW-1415).
  it('the manifest describes v13 as a stamp re-freeze of v12 under claims-v3', () => {
    expect(MANIFEST_V13.corpus).toBe('corpus.v13.jsonl');
    expect(MANIFEST_V13.kind).toBe('stamp_refreeze');
    expect(MANIFEST_V13.derived_from.corpus).toBe('corpus.v12.jsonl');
    expect(MANIFEST_V13.derived_from.manifest).toBe('MANIFEST.v12.json');
    expect(MANIFEST_V13.derived_from.corpus_sha256).toBe(MANIFEST_V12.corpus_sha256);
    expect(sha(V12_TEXT)).toBe(MANIFEST_V13.derived_from.corpus_sha256);
    expect(sha(V13_TEXT)).toBe(MANIFEST_V13.corpus_sha256);
    expect(MANIFEST_V13.claims_validation_version).toBe(V13_STAMP);
    expect(MANIFEST_V13.stamp_refreeze).toEqual({
      from: V10_STAMP,
      to: V13_STAMP,
      cases: MANIFEST_V12.per_verdict.FIT,
    });
    expect(MANIFEST_V13.delta).toEqual([]);
    expect(MANIFEST_V13.case_count).toBe(CASES_V13.length);
    const m13 = MANIFEST_V13 as unknown as Record<string, unknown>;
    const m12 = MANIFEST_V12 as unknown as Record<string, unknown>;
    // Every other manifest field is v12's, but the persona record only v12 carries.
    const own = ['change', 'corpus', 'corpus_sha256', 'derived_from', 'kind'];
    own.push('claims_validation_version', 'stamp_refreeze');
    const v12Only = ['persona_change', 'refrozen'];
    expect(Object.keys(m13).sort()).toEqual(
      [...new Set([...Object.keys(m12).filter((k) => !v12Only.includes(k)), ...own])].sort(),
    );
    for (const key of Object.keys(m12)) {
      if (own.includes(key) || v12Only.includes(key)) continue;
      expect(m13[key], key).toEqual(m12[key]);
    }
  });

  it('v13 is v12 byte for byte except the stamp value, in every FIT case and nowhere else', () => {
    expect(V12_TEXT.split(OLD).length - 1).toBe(MANIFEST_V12.per_verdict.FIT);
    expect(V13_TEXT.split(NEW).length - 1).toBe(MANIFEST_V12.per_verdict.FIT);
    expect(V12_TEXT.includes(NEW)).toBe(false);
    expect(V13_TEXT.includes(V10_STAMP)).toBe(false);
    expect(V13_TEXT).toBe(V12_TEXT.split(OLD).join(NEW));
    expect(V13_TEXT.length).toBe(V12_TEXT.length); // same-length value: no byte shifted
  });

  describe.each(
    CASES_V13.filter((c) => !AFTER_V15_DELTA_IDS.has(c.id)).map((c) => [c.id, c] as const),
  )('%s', (_id, c) => {
    it('generates identically to the v13 record', async () => {
      await expectIdentical(c);
    });
  });
});

describe('description parity corpus v14 (FOLLOW-1415 — claims-v4, stamp-only re-freeze)', () => {
  const V13_TEXT = readFileSync(join(FIXTURE_DIR, 'corpus.v13.jsonl'), 'utf8');
  const V14_TEXT = readFileSync(join(FIXTURE_DIR, 'corpus.v14.jsonl'), 'utf8');
  const OLD = `"claims_validation": "${V13_STAMP}"`;
  const NEW = `"claims_validation": "${V14_STAMP}"`;

  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'parity-'.repeat(4));
    mockCreate.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  // History pins its own literal: v14's stamp is claims-v4, the constant moved on (FOLLOW-1414).
  it('the manifest describes v14 as a stamp re-freeze of v13 under claims-v4', () => {
    expect(MANIFEST_V14.corpus).toBe('corpus.v14.jsonl');
    expect(MANIFEST_V14.kind).toBe('stamp_refreeze');
    expect(MANIFEST_V14.derived_from.corpus).toBe('corpus.v13.jsonl');
    expect(MANIFEST_V14.derived_from.manifest).toBe('MANIFEST.v13.json');
    expect(MANIFEST_V14.derived_from.corpus_sha256).toBe(MANIFEST_V13.corpus_sha256);
    expect(sha(V13_TEXT)).toBe(MANIFEST_V14.derived_from.corpus_sha256);
    expect(sha(V14_TEXT)).toBe(MANIFEST_V14.corpus_sha256);
    expect(MANIFEST_V14.claims_validation_version).toBe(V14_STAMP);
    expect(MANIFEST_V14.stamp_refreeze).toEqual({
      from: V13_STAMP,
      to: V14_STAMP,
      cases: MANIFEST_V13.per_verdict.FIT,
    });
    expect(MANIFEST_V14.delta).toEqual([]);
    expect(MANIFEST_V14.case_count).toBe(CASES_V14.length);
    const m14 = MANIFEST_V14 as unknown as Record<string, unknown>;
    const m13 = MANIFEST_V13 as unknown as Record<string, unknown>;
    // Same keys as v13; every field but the stamp record and the provenance is v13's.
    const own = ['change', 'corpus', 'corpus_sha256', 'derived_from', 'frozen_at'];
    own.push('claims_validation_version', 'stamp_refreeze');
    expect(Object.keys(m14).sort()).toEqual(Object.keys(m13).sort());
    for (const key of Object.keys(m13)) {
      if (own.includes(key)) continue;
      expect(m14[key], key).toEqual(m13[key]);
    }
  });

  it('v14 is v13 byte for byte except the stamp value, in every FIT case and nowhere else', () => {
    expect(V13_TEXT.split(OLD).length - 1).toBe(MANIFEST_V13.per_verdict.FIT);
    expect(V14_TEXT.split(NEW).length - 1).toBe(MANIFEST_V13.per_verdict.FIT);
    expect(V13_TEXT.includes(NEW)).toBe(false);
    expect(V14_TEXT.includes(V13_STAMP)).toBe(false);
    expect(V14_TEXT).toBe(V13_TEXT.split(OLD).join(NEW));
    expect(V14_TEXT.length).toBe(V13_TEXT.length); // same-length value: no byte shifted
  });

  describe.each(
    CASES_V14.filter((c) => !AFTER_V15_DELTA_IDS.has(c.id)).map((c) => [c.id, c] as const),
  )('%s', (_id, c) => {
    it('generates identically to the v14 record', async () => {
      await expectIdentical(c);
    });
  });
});

describe('description parity corpus v15 (FOLLOW-1408 — first_time_buyer persona re-freeze)', () => {
  const REFROZEN = new Set(MANIFEST_V15.refrozen);
  const V14_TEXT = readFileSync(join(FIXTURE_DIR, 'corpus.v14.jsonl'), 'utf8');
  const V15_TEXT = readFileSync(join(FIXTURE_DIR, 'corpus.v15.jsonl'), 'utf8');

  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'parity-'.repeat(4));
    mockCreate.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('v15 is v14 with ONLY the headline USER prompt digests of the listed cases changed', () => {
    expect(MANIFEST_V15.corpus).toBe('corpus.v15.jsonl');
    expect(MANIFEST_V15.kind).toBe('prompt_digest_refreeze');
    expect(MANIFEST_V15.derived_from.corpus).toBe('corpus.v14.jsonl');
    expect(MANIFEST_V15.derived_from.manifest).toBe('MANIFEST.v14.json');
    expect(MANIFEST_V15.derived_from.corpus_sha256).toBe(MANIFEST_V14.corpus_sha256);
    expect(sha(V14_TEXT)).toBe(MANIFEST_V15.derived_from.corpus_sha256);
    expect(sha(V15_TEXT)).toBe(MANIFEST_V15.corpus_sha256);
    expect(MANIFEST_V15.case_count).toBe(CASES_V15.length);
    expect(MANIFEST_V15.claims_validation_version).toBe(MANIFEST_V14.claims_validation_version);
    expect(MANIFEST_V15.delta).toEqual([]);
    expect(MANIFEST_V15.per_verdict).toEqual(MANIFEST_V14.per_verdict);
    expect(MANIFEST_V15.per_reason).toEqual(MANIFEST_V14.per_reason);
    expect(MANIFEST_V15.headline_suppressed).toBe(MANIFEST_V14.headline_suppressed);
    expect(Object.keys(MANIFEST_V15.persona_change)).toEqual(['first_time_buyer']);
    expect(CASES_V15.map((c) => c.id)).toEqual(CASES_V14.map((c) => c.id));
    for (const [i, v15] of CASES_V15.entries()) {
      const prev = CASES_V14[i]!;
      const { prompt_sha256: p15, ...rest15 } = v15.expected;
      const { prompt_sha256: p14, ...rest14 } = prev.expected;
      expect({ ...v15, expected: rest15 }, v15.id).toEqual({ ...prev, expected: rest14 });
      expect(p15.description_system, v15.id).toBe(p14.description_system);
      expect(p15.description_user, v15.id).toBe(p14.description_user);
      expect(p15.headline_system, v15.id).toBe(p14.headline_system);
      if (REFROZEN.has(v15.id)) expect(p15.headline_user, v15.id).not.toBe(p14.headline_user);
      else expect(p15.headline_user, v15.id).toBe(p14.headline_user);
    }
  });

  it('every headline-calling first_time_buyer case is re-frozen, and none other', () => {
    expect(
      CASES_V15.filter(
        (c) => c.expected.headline_called && c.input.archetype === 'first_time_buyer',
      )
        .map((c) => c.id)
        .sort(),
    ).toEqual([...REFROZEN].sort());
    expect(REFROZEN.size).toBeGreaterThan(0);
  });

  it('every new headline user prompt is the v14 prompt with the persona swapped, byte for byte', async () => {
    for (const c of CASES_V15.filter((x) => REFROZEN.has(x.id))) {
      const prev = CASES_V14.find((x) => x.id === c.id)!;
      mockCreate.mockReset();
      mockCreate
        .mockResolvedValueOnce(response(c.raw_description.text, c.raw_description.stop_reason))
        .mockResolvedValueOnce(response(c.raw_headline ?? '', 'end_turn'));
      await generateDescription(c.input);
      const user = (mockCreate.mock.calls[1]![0] as CreateParams).messages[0]!.content;
      expect(sha(user), c.id).toBe(c.expected.prompt_sha256.headline_user);
      expect(sha(beforeV15Persona(user, c)), c.id).toBe(prev.expected.prompt_sha256.headline_user);
    }
  });

  it('the new persona asks for no condition claim', () => {
    const { from, to } = MANIFEST_V15.persona_change.first_time_buyer!;
    expect(from).toMatch(/move-in readiness/u);
    expect(to).not.toMatch(/move-in|readiness|turn-?key/iu);
    expect(to).toMatch(/only as the listing states them/u);
  });

  describe.each(
    CASES_V15.filter((c) => !AFTER_V15_DELTA_IDS.has(c.id)).map((c) => [c.id, c] as const),
  )('%s', (_id, c) => {
    it('generates identically to the v15 record', async () => {
      await expectIdentical(c);
    });
  });
});

describe('description parity corpus v16 (FOLLOW-1397 — a multiplied number is the number it names)', () => {
  it('the one v16 delta is "€750K" grounded by "€750,000": the headline is refused for its next word', () => {
    const id = 'live.020.listing-009.yield_hunter.en';
    const v15 = CASES_V15.find((c) => c.id === id)!;
    const v16 = VERDICT_DELTAS.find((d) => d.version === 16)!.cases.find((c) => c.id === id)!;
    expect(v15.raw_headline).toContain('€750K');
    expect(v15.input.listing_context.price).toBe('€750,000');
    expect(v15.expected.headline_violation).toBe('hallucinated_number');
    expect(v16.expected.headline_violation).toBe('hallucinated_proper_name');
    expect(v16.expected.headline).toBeNull();
    expect(v16.expected.outcome).toEqual(v15.expected.outcome);
  });
});

describe('description parity corpus v17 (FOLLOW-1414 — write about the home, Polish room counts)', () => {
  const HEADLINE_REFROZEN = new Set(MANIFEST_V17.headline_refrozen);
  const v16 = VERDICT_DELTAS.find((d) => d.version === 16)!;
  const V17_TEXT = readFileSync(join(FIXTURE_DIR, 'corpus.v17.jsonl'), 'utf8');

  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'parity-'.repeat(4));
    mockCreate.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('v17 is v16 with ONLY the description user digests and the Polish headline user digests changed', () => {
    expect(MANIFEST_V17.corpus).toBe('corpus.v17.jsonl');
    expect(MANIFEST_V17.kind).toBe('prompt_digest_refreeze');
    expect(MANIFEST_V17.derived_from.corpus).toBe('corpus.v16.jsonl');
    expect(MANIFEST_V17.derived_from.manifest).toBe('MANIFEST.v16.json');
    expect(MANIFEST_V17.derived_from.corpus_sha256).toBe(v16.manifest.corpus_sha256);
    expect(sha(V17_TEXT)).toBe(MANIFEST_V17.corpus_sha256);
    expect(MANIFEST_V17.case_count).toBe(CASES_V17.length);
    expect(MANIFEST_V17.claims_validation_version).toBe(v16.manifest.claims_validation_version);
    expect(MANIFEST_V17.delta).toEqual([]);
    expect(MANIFEST_V17.per_verdict).toEqual(v16.manifest.per_verdict);
    expect(MANIFEST_V17.per_reason).toEqual(v16.manifest.per_reason);
    expect(MANIFEST_V17.headline_suppressed).toBe(v16.manifest.headline_suppressed);
    expect(CASES_V17.map((c) => c.id)).toEqual(v16.cases.map((c) => c.id));
    for (const [i, v17] of CASES_V17.entries()) {
      const prev = v16.cases[i]!;
      const { prompt_sha256: p17, ...rest17 } = v17.expected;
      const { prompt_sha256: p16, ...rest16 } = prev.expected;
      expect({ ...v17, expected: rest17 }, v17.id).toEqual({ ...prev, expected: rest16 });
      expect(p17.description_system, v17.id).toBe(p16.description_system);
      expect(p17.headline_system, v17.id).toBe(p16.headline_system);
      expect(p17.description_user, v17.id).not.toBe(p16.description_user);
      if (HEADLINE_REFROZEN.has(v17.id))
        expect(p17.headline_user, v17.id).not.toBe(p16.headline_user);
      else expect(p17.headline_user, v17.id).toBe(p16.headline_user);
    }
  });

  it('every headline-calling Polish case is re-frozen, and none other', () => {
    expect(
      CASES_V17.filter((c) => c.expected.headline_called && c.input.locale === 'pl')
        .map((c) => c.id)
        .sort(),
    ).toEqual([...HEADLINE_REFROZEN].sort());
    expect(HEADLINE_REFROZEN.size).toBeGreaterThan(0);
  });

  it('every new prompt is the v16 prompt plus the FOLLOW-1414 paragraph, byte for byte', async () => {
    const locales = new Set<string>();
    for (const c of CASES_V17) {
      const prev = v16.cases.find((x) => x.id === c.id)!;
      mockCreate.mockReset();
      mockCreate
        .mockResolvedValueOnce(response(c.raw_description.text, c.raw_description.stop_reason))
        .mockResolvedValueOnce(response(c.raw_headline ?? '', 'end_turn'));
      await generateDescription(c.input);
      const desc = (mockCreate.mock.calls[0]![0] as CreateParams).messages[0]!.content;
      expect(sha(desc), c.id).toBe(c.expected.prompt_sha256.description_user);
      expect(sha(beforeV17Description(desc, c)), c.id).toBe(
        prev.expected.prompt_sha256.description_user,
      );
      if (c.expected.headline_called) {
        const head = (mockCreate.mock.calls[1]![0] as CreateParams).messages[0]!.content;
        expect(sha(head), c.id).toBe(c.expected.prompt_sha256.headline_user);
        expect(sha(beforeV17Headline(head, c)), c.id).toBe(
          prev.expected.prompt_sha256.headline_user,
        );
      }
      locales.add(c.input.locale);
    }
    expect([...locales].sort()).toEqual(['en', 'es', 'pl']);
  });

  it('the Polish paragraph spells the room counts and never the live typo', () => {
    expect(POLISH_ROOM_COUNTS).toMatch(/dwupokojowe/u);
    expect(POLISH_ROOM_COUNTS).not.toMatch(/dwuipokojowe/u);
  });

  describe.each(
    CASES_V17.filter((c) => !AFTER_V20_DELTA_IDS.has(c.id)).map((c) => [c.id, c] as const),
  )('%s', (_id, c) => {
    it('generates identically to the v17 record', async () => {
      await expectIdentical(c);
    });
  });
});

describe('description parity corpus v18 (FOLLOW-1414 — claims-v5, stamp-only re-freeze)', () => {
  const V17_TEXT = readFileSync(join(FIXTURE_DIR, 'corpus.v17.jsonl'), 'utf8');
  const V18_TEXT = readFileSync(join(FIXTURE_DIR, 'corpus.v18.jsonl'), 'utf8');
  const OLD = `"claims_validation": "${V14_STAMP}"`;
  const NEW = `"claims_validation": "${V18_STAMP}"`;

  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'parity-'.repeat(4));
    mockCreate.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  // History pins its own literal: v18's stamp is claims-v5, the constant moved on (FOLLOW-1419).
  it('the manifest describes v18 as a stamp re-freeze of v17 under claims-v5', () => {
    expect(MANIFEST_V18.corpus).toBe('corpus.v18.jsonl');
    expect(MANIFEST_V18.kind).toBe('stamp_refreeze');
    expect(MANIFEST_V18.derived_from.corpus).toBe('corpus.v17.jsonl');
    expect(MANIFEST_V18.derived_from.manifest).toBe('MANIFEST.v17.json');
    expect(MANIFEST_V18.derived_from.corpus_sha256).toBe(MANIFEST_V17.corpus_sha256);
    expect(sha(V17_TEXT)).toBe(MANIFEST_V18.derived_from.corpus_sha256);
    expect(sha(V18_TEXT)).toBe(MANIFEST_V18.corpus_sha256);
    expect(MANIFEST_V18.claims_validation_version).toBe(V18_STAMP);
    expect(MANIFEST_V18.stamp_refreeze).toEqual({
      from: V14_STAMP,
      to: V18_STAMP,
      cases: MANIFEST_V17.per_verdict.FIT,
    });
    expect(MANIFEST_V18.delta).toEqual([]);
    expect(MANIFEST_V18.case_count).toBe(CASES_V18.length);
    const m18 = MANIFEST_V18 as unknown as Record<string, unknown>;
    const m17 = MANIFEST_V17 as unknown as Record<string, unknown>;
    // Every field but the stamp record, the kind and the provenance is v17's; the prompt record
    // only v17 carries.
    const own = ['change', 'corpus', 'corpus_sha256', 'derived_from', 'frozen_at', 'kind'];
    own.push('claims_validation_version', 'stamp_refreeze');
    const v17Only = ['headline_refrozen'];
    expect(Object.keys(m18).sort()).toEqual(
      [...new Set([...Object.keys(m17).filter((k) => !v17Only.includes(k)), ...own])].sort(),
    );
    for (const key of Object.keys(m17)) {
      if (own.includes(key) || v17Only.includes(key)) continue;
      expect(m18[key], key).toEqual(m17[key]);
    }
  });

  it('v18 is v17 byte for byte except the stamp value, in every FIT case and nowhere else', () => {
    expect(V17_TEXT.split(OLD).length - 1).toBe(MANIFEST_V17.per_verdict.FIT);
    expect(V18_TEXT.split(NEW).length - 1).toBe(MANIFEST_V17.per_verdict.FIT);
    expect(V17_TEXT.includes(NEW)).toBe(false);
    expect(V18_TEXT.includes(V14_STAMP)).toBe(false);
    expect(V18_TEXT).toBe(V17_TEXT.split(OLD).join(NEW));
    expect(V18_TEXT.length).toBe(V17_TEXT.length); // same-length value: no byte shifted
  });

  describe.each(
    CASES_V18.filter((c) => !AFTER_V20_DELTA_IDS.has(c.id)).map((c) => [c.id, c] as const),
  )('%s', (_id, c) => {
    it('generates identically to the v18 record', async () => {
      await expectIdentical(c);
    });
  });
});

describe('description parity corpus v19 (FOLLOW-1419 — claims-v6, stamp-only re-freeze)', () => {
  const V18_TEXT = readFileSync(join(FIXTURE_DIR, 'corpus.v18.jsonl'), 'utf8');
  const V19_TEXT = readFileSync(join(FIXTURE_DIR, 'corpus.v19.jsonl'), 'utf8');
  const OLD = `"claims_validation": "${V18_STAMP}"`;
  const NEW = `"claims_validation": "${V19_STAMP}"`;

  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'parity-'.repeat(4));
    mockCreate.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  // History pins its own literal: v19's stamp is claims-v6, the constant moved on (FOLLOW-1420).
  it('the manifest describes v19 as a stamp re-freeze of v18 under claims-v6', () => {
    expect(MANIFEST_V19.corpus).toBe('corpus.v19.jsonl');
    expect(MANIFEST_V19.kind).toBe('stamp_refreeze');
    expect(MANIFEST_V19.derived_from.corpus).toBe('corpus.v18.jsonl');
    expect(MANIFEST_V19.derived_from.manifest).toBe('MANIFEST.v18.json');
    expect(MANIFEST_V19.derived_from.corpus_sha256).toBe(MANIFEST_V18.corpus_sha256);
    expect(sha(V18_TEXT)).toBe(MANIFEST_V19.derived_from.corpus_sha256);
    expect(sha(V19_TEXT)).toBe(MANIFEST_V19.corpus_sha256);
    expect(MANIFEST_V19.claims_validation_version).toBe(V19_STAMP);
    expect(MANIFEST_V19.stamp_refreeze).toEqual({
      from: V18_STAMP,
      to: V19_STAMP,
      cases: MANIFEST_V18.per_verdict.FIT,
    });
    expect(MANIFEST_V19.delta).toEqual([]);
    expect(MANIFEST_V19.case_count).toBe(CASES_V19.length);
    const m19 = MANIFEST_V19 as unknown as Record<string, unknown>;
    const m18 = MANIFEST_V18 as unknown as Record<string, unknown>;
    // Same keys as v18; every field but the stamp record and the provenance is v18's.
    const own = ['change', 'corpus', 'corpus_sha256', 'derived_from', 'frozen_at'];
    own.push('claims_validation_version', 'stamp_refreeze');
    expect(Object.keys(m19).sort()).toEqual(Object.keys(m18).sort());
    for (const key of Object.keys(m18)) {
      if (own.includes(key)) continue;
      expect(m19[key], key).toEqual(m18[key]);
    }
  });

  it('v19 is v18 byte for byte except the stamp value, in every FIT case and nowhere else', () => {
    expect(V18_TEXT.split(OLD).length - 1).toBe(MANIFEST_V18.per_verdict.FIT);
    expect(V19_TEXT.split(NEW).length - 1).toBe(MANIFEST_V18.per_verdict.FIT);
    expect(V18_TEXT.includes(NEW)).toBe(false);
    expect(V19_TEXT.includes(V18_STAMP)).toBe(false);
    expect(V19_TEXT).toBe(V18_TEXT.split(OLD).join(NEW));
    expect(V19_TEXT.length).toBe(V18_TEXT.length); // same-length value: no byte shifted
  });

  describe.each(
    CASES_V19.filter((c) => !AFTER_V20_DELTA_IDS.has(c.id)).map((c) => [c.id, c] as const),
  )('%s', (_id, c) => {
    it('generates identically to the v19 record', async () => {
      await expectIdentical(c);
    });
  });
});

describe('description parity corpus v20 (FOLLOW-1420 / FOLLOW-1421 — claims-v7, stamp-only re-freeze, the current contract)', () => {
  const V19_TEXT = readFileSync(join(FIXTURE_DIR, 'corpus.v19.jsonl'), 'utf8');
  const V20_TEXT = readFileSync(join(FIXTURE_DIR, 'corpus.v20.jsonl'), 'utf8');
  const OLD = `"claims_validation": "${V19_STAMP}"`;
  const NEW = `"claims_validation": "${CLAIMS_VALIDATION_VERSION}"`;

  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'parity-'.repeat(4));
    mockCreate.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('the manifest describes v20 as a stamp re-freeze of v19 under the current constant', () => {
    expect(CLAIMS_VALIDATION_VERSION).toBe('claims-v7');
    expect(MANIFEST_V20.corpus).toBe('corpus.v20.jsonl');
    expect(MANIFEST_V20.kind).toBe('stamp_refreeze');
    expect(MANIFEST_V20.derived_from.corpus).toBe('corpus.v19.jsonl');
    expect(MANIFEST_V20.derived_from.manifest).toBe('MANIFEST.v19.json');
    expect(MANIFEST_V20.derived_from.corpus_sha256).toBe(MANIFEST_V19.corpus_sha256);
    expect(sha(V19_TEXT)).toBe(MANIFEST_V20.derived_from.corpus_sha256);
    expect(sha(V20_TEXT)).toBe(MANIFEST_V20.corpus_sha256);
    expect(MANIFEST_V20.claims_validation_version).toBe(CLAIMS_VALIDATION_VERSION);
    expect(MANIFEST_V20.stamp_refreeze).toEqual({
      from: V19_STAMP,
      to: CLAIMS_VALIDATION_VERSION,
      cases: MANIFEST_V19.per_verdict.FIT,
    });
    expect(MANIFEST_V20.delta).toEqual([]);
    expect(MANIFEST_V20.case_count).toBe(CASES_V20.length);
    const m20 = MANIFEST_V20 as unknown as Record<string, unknown>;
    const m19 = MANIFEST_V19 as unknown as Record<string, unknown>;
    // Same keys as v19; every field but the stamp record and the provenance is v19's.
    const own = ['change', 'corpus', 'corpus_sha256', 'derived_from', 'frozen_at'];
    own.push('claims_validation_version', 'stamp_refreeze');
    expect(Object.keys(m20).sort()).toEqual(Object.keys(m19).sort());
    for (const key of Object.keys(m19)) {
      if (own.includes(key)) continue;
      expect(m20[key], key).toEqual(m19[key]);
    }
  });

  it('v20 is v19 byte for byte except the stamp value, in every FIT case and nowhere else', () => {
    expect(V19_TEXT.split(OLD).length - 1).toBe(MANIFEST_V19.per_verdict.FIT);
    expect(V20_TEXT.split(NEW).length - 1).toBe(MANIFEST_V19.per_verdict.FIT);
    expect(V19_TEXT.includes(NEW)).toBe(false);
    expect(V20_TEXT.includes(V19_STAMP)).toBe(false);
    expect(V20_TEXT).toBe(V19_TEXT.split(OLD).join(NEW));
    expect(V20_TEXT.length).toBe(V19_TEXT.length); // same-length value: no byte shifted
  });

  describe.each(
    CASES_V20.filter((c) => !AFTER_V20_DELTA_IDS.has(c.id)).map((c) => [c.id, c] as const),
  )('%s', (_id, c) => {
    it('generates identically to the v20 record', async () => {
      await expectIdentical(c);
    });
  });
});

describe('description parity corpus v21 (FOLLOW-1311 slice 2 — a digit count the listing spells out)', () => {
  it('each delta is "3-Bed" grounded by "three-bedroom": the headline is refused for its next word', () => {
    const v21 = VERDICT_DELTAS.find((d) => d.version === 21)!;
    expect(v21.manifest.delta).toHaveLength(3);
    for (const id of v21.ids) {
      const before = CASES_V20.find((c) => c.id === id)!;
      const after = v21.cases.find((c) => c.id === id)!;
      expect(before.raw_headline).toContain('3-Bed');
      expect(before.input.original_description).toContain('three-bedroom');
      expect(before.expected.headline_violation).toBe('hallucinated_number');
      expect(after.expected.headline_violation).not.toBe('hallucinated_number');
      expect(after.expected.headline_violation).not.toBeNull();
      expect(after.expected.headline).toBeNull();
      expect(after.expected.outcome).toEqual(before.expected.outcome);
    }
  });
});
