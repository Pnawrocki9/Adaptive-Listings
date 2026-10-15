/**
 * FOLLOW-1314 — the headline check sees the listing's own fields, as written.
 *
 * Red-first (fail on `main` `c20ce2ab`):
 *   - "Jávea" in the listing's own `location` field grounds the headline that names it (v1 wrote the
 *     grounding with `ensure_ascii=True`, so the check searched for "Jávea" in "jávea");
 *   - an `é` in a field no longer grounds a `9` through its `é` escape (the latent fail-open of
 *     ADR-0023 §4 hazard 1, which the route change would otherwise have switched on).
 *
 * Guards (pass before and after): every one of the 18 live headlines corpus v1 recorded as refused,
 * re-checked WITH its listing's own structured fields visible (the production shape after this
 * change), is still refused — except live.018, the one false refusal the fields fix. A playbook's
 * authored copy and slot labels never ground a headline word (FOLLOW-1251 amendment).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

import type { DescriptionRequestedEvent } from '@estalara/shared';
import { getPlaybook } from '@estalara/shared/playbooks';
import { checkBodyClaims, checkHeadlineFacts } from '@/lib/grounding-check';
import { generateDescription } from '@/lib/description-generator';

interface CorpusCase {
  id: string;
  kind: string;
  input: DescriptionRequestedEvent;
  raw_headline: string | null;
  expected: { headline_violation: string | null };
}

const V1: CorpusCase[] = readFileSync(
  join(__dirname, '../__fixtures__/description-parity/corpus.v1.jsonl'),
  'utf8',
)
  .split('\n')
  .filter((l) => l.trim() !== '')
  .map((l) => JSON.parse(l) as CorpusCase);

/** The listing's own structured fields, as the corpus recorded them on any case of that listing. */
const FIELDS_BY_LISTING = new Map<string, Record<string, string>>();
for (const c of V1) {
  const ctx = c.input.listing_context;
  if (Object.keys(ctx).length > 0 && !FIELDS_BY_LISTING.has(c.input.listing_id)) {
    FIELDS_BY_LISTING.set(c.input.listing_id, ctx);
  }
}

const REFUSED_LIVE = V1.filter(
  (c) => c.kind === 'live' && c.raw_headline !== null && c.expected.headline_violation !== null,
);

/**
 * Each refused live headline, re-checked with its listing's own fields visible. `null` = kept.
 * The violation is the FIRST the check meets; the per-case evidence is in the FOLLOW-1314 PR.
 */
const WITH_FIELDS: Record<string, string | null> = {
  'live.003.listing-001.yield_hunter.en': 'hallucinated_proper_name', // "Holiday Rental Demand"
  'live.004.listing-002.first_time_buyer.en': 'unsupported_guarantee', // "Move-In Ready"
  'live.005.listing-002.vacation_rental_investor.en': 'hallucinated_proper_name', // "Short-Term Rental Potential"
  'live.006.listing-002.remote_worker.en': 'hallucinated_proper_name', // "Quiet Retreat Space"
  'live.010.listing-004.golden_visa_buyer.en': 'hallucinated_proper_name', // "Golden Visa Pathway"
  'live.014.listing-006.vacation_rental_investor.en': 'unsupported_amenity', // "Sea Views" vs glimpses
  'live.015.listing-006.luxury_buyer.en': 'hallucinated_proper_name', // "Expansive Private Estate"
  'live.018.listing-008.family_buyer.en': null, // "Jávea" IS the listing's location
  'live.019.listing-008.upsizer.es': 'hallucinated_proper_name', // "More Space, More Life"
  'live.020.listing-009.yield_hunter.en': 'hallucinated_number', // "€750K"
  'live.021.listing-009.portfolio_builder.en': 'hallucinated_proper_name', // "Scalable Portfolio Potential"
  'live.024.listing-010.second_home_buyer.en': 'hallucinated_proper_name', // "Rental Income Potential"
  'live.025.listing-011.remote_worker.en': 'hallucinated_proper_name', // "Home Office Potential"
  'live.028.listing-012.retiree_relocator.en': 'hallucinated_proper_name', // "Steps Away" vs 5 min
  'live.029.839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c.family_buyer.en': 'hallucinated_proper_name', // "Quiet-Street", "Near"
  'live.030.839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c.first_time_buyer.en': 'unsupported_guarantee', // "Move-In Ready"
  'live.031.839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c.flip_investor.en': 'hallucinated_proper_name', // "Flip Potential"
  'live.032.839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c.neutral.en': 'hallucinated_proper_name', // "Near"
};

describe('FOLLOW-1314 red-first: the grounding reads field values as written', () => {
  it('live.018: "Jávea" in the listing location field grounds the headline that names it', () => {
    const c = V1.find((x) => x.id === 'live.018.listing-008.family_buyer.en')!;
    expect(c.input.listing_context.location).toBe('Jávea, Costa Blanca, Spain');
    expect(
      checkHeadlineFacts(c.raw_headline!, c.input.original_description, c.input.listing_context),
    ).toBeNull();
  });

  it('a non-ASCII field value no longer grounds a digit through its \\u escape (é → 9)', () => {
    const ctx = { neighbourhood: 'Café Quarter' };
    expect(
      checkBodyClaims('A flat with 9 rooms in the quarter.', 'A flat in the quarter.', ctx),
    ).toBe('hallucinated_number');
    expect(checkHeadlineFacts('9-Room Flat', 'A flat in the quarter.', ctx)).toBe(
      'hallucinated_number',
    );
  });
});

describe('FOLLOW-1314 guards: every true refusal stays refused with the listing fields visible', () => {
  it('the corpus holds exactly the 18 refused live headlines this table classifies', () => {
    expect(REFUSED_LIVE.map((c) => c.id).sort()).toEqual(Object.keys(WITH_FIELDS).sort());
  });

  it.each(REFUSED_LIVE.map((c) => [c.id, c] as const))('%s', (id, c) => {
    const fields = FIELDS_BY_LISTING.get(c.input.listing_id);
    expect(fields, `no recorded fields for ${c.input.listing_id}`).toBeDefined();
    expect(checkHeadlineFacts(c.raw_headline!, c.input.original_description, fields!)).toBe(
      WITH_FIELDS[id],
    );
  });

  it('a name absent from the listing is still refused even when other fields are present', () => {
    const fields = { listing_location: 'Jávea, Costa Blanca, Spain', listing_title: 'Villa' };
    expect(checkHeadlineFacts('Spacious Villa in Marbella', 'A villa.', fields)).toBe(
      'hallucinated_proper_name',
    );
    expect(checkHeadlineFacts('Spacious 6-Bed Villa in Jávea', 'A 5-bedroom villa.', fields)).toBe(
      'hallucinated_number',
    );
  });
});

describe('FOLLOW-1314 / FOLLOW-1251 amendment: authored playbook copy is not a source of facts', () => {
  function event(archetype: 'second_home_buyer' | 'luxury_buyer'): DescriptionRequestedEvent {
    return {
      tenant_id: '00000000-0000-4000-8000-000000001314',
      listing_id: '839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c',
      archetype,
      locale: 'en',
      // The REAL playbook copy — its words must not ground the headline.
      copy_template: getPlaybook(archetype).copy_template.en,
      original_description:
        'A three-bedroom, two-bathroom single-family home on a quiet residential street.',
      listing_context: {
        listing_title: '9 Blackberry Pl, Palm Coast, FL 32137 — 3 bed, 2 bath',
        listing_price: '385000 USD',
        listing_location: '9 Blackberry Pl, Palm Coast, FL',
      },
      cache_key: 'desc:t:l:a:en:claude-sonnet-4-6:r0',
      listing_revision: 0,
      max_tokens: 500,
    };
  }

  async function headlineFor(e: DescriptionRequestedEvent, headline: string) {
    vi.stubEnv('ANTHROPIC_API_KEY', 'follow1314-'.repeat(3));
    const reply = (text: string) => ({
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    mockCreate
      .mockReset()
      .mockResolvedValueOnce(reply('A three-bedroom home on a quiet residential street.'))
      .mockResolvedValueOnce(reply(headline));
    const report = await generateDescription(e);
    vi.unstubAllEnvs();
    return report;
  }

  it('the authored slot label "Weekend Escape" does not ground a headline', async () => {
    const report = await headlineFor(
      event('second_home_buyer'),
      'Weekend Escape: Palm Coast 3-Bed Home',
    );
    expect(report.headline).toBeNull();
    expect(report.headlineViolation).toBe('hallucinated_proper_name');
  });

  it("a word only the playbook's copy_template carries does not ground a headline", async () => {
    const e = event('luxury_buyer');
    expect(e.copy_template).toContain('Gaggenau');
    const report = await headlineFor(e, 'Palm Coast Home With Gaggenau Kitchen');
    expect(report.headline).toBeNull();
    expect(report.headlineViolation).toBe('hallucinated_proper_name');
  });

  it('the listing’s own place, title digits and words ground the headline', async () => {
    const report = await headlineFor(
      event('second_home_buyer'),
      'Palm Coast 3-Bed, 2-Bath Home on a Quiet Residential Street',
    );
    expect(report.headlineViolation).toBeNull();
    expect(report.headline).toBe('Palm Coast 3-Bed, 2-Bath Home on a Quiet Residential Street');
  });
});
