/**
 * FOLLOW-1311 slice 0: what the recorder and the replay share. The case list, the events both
 * paths receive, and the one-line verdict a replay is compared on. No I/O beyond the fixture read.
 *
 * @module apps/control-plane/scripts/claim-baseline/shared
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ArchetypeId, DescriptionRequestedEvent } from '@estalara/shared';
import { getPlaybook } from '@estalara/shared/playbooks';
import type { generateDescription } from '@/lib/description-generator';
import type { LlmGatewayInput, LlmGatewayOutput } from '@/lib/llm-gateway';

export const FIXTURES = path.resolve(__dirname, 'fixtures');
export const BASELINE_MODEL = 'claude-sonnet-5-5';

type Locale = 'en' | 'pl' | 'es';

interface Listing {
  key: string;
  archetypes: string[];
  original: string;
  context: Record<string, string>;
}

export interface BaselineCase {
  id: string;
  surface: 'description' | 'adapt';
  listing: Listing;
  archetype: string;
  locale: Locale;
}

/** One SDK call as the model answered it, in call order within a case. */
export interface RecordedCall {
  prompt_sha256: string;
  stop_reason: string | null;
  content: { type: string; text?: string }[];
  usage: { input_tokens: number; output_tokens: number };
  error?: string;
}

export interface RecordedCase {
  id: string;
  calls: RecordedCall[];
}

/** The sha256 of `s` in 8-character groups, so no digest is one long token. */
export function groupedSha256(s: string): string {
  return (createHash('sha256').update(s).digest('hex').match(/.{8}/g) ?? []).join(':');
}

/** The 60 description cases (each pair on en + pl, four also on es) and the 28 adapt cases. */
export function baselineCases(): BaselineCase[] {
  const fixture = JSON.parse(readFileSync(path.join(FIXTURES, 'listings.v1.json'), 'utf8')) as {
    es_pages: string[];
    listings: Listing[];
  };
  const cases: BaselineCase[] = [];
  for (const listing of fixture.listings) {
    for (const archetype of listing.archetypes) {
      const pair = `${listing.key}.${archetype}`;
      const locales: Locale[] = fixture.es_pages.includes(pair) ? ['en', 'pl', 'es'] : ['en', 'pl'];
      for (const locale of locales) {
        cases.push({
          id: `description.${pair}.${locale}`,
          surface: 'description',
          listing,
          archetype,
          locale,
        });
      }
      cases.push({ id: `adapt.${pair}`, surface: 'adapt', listing, archetype, locale: 'en' });
    }
  }
  return cases;
}

/** The event `description/route.ts` builds for this case. */
export function descriptionEvent(c: BaselineCase): DescriptionRequestedEvent {
  const playbook = getPlaybook(c.archetype as ArchetypeId);
  return {
    tenant_id: '00000000-0000-4000-8000-000000001311',
    listing_id: `baseline-${c.listing.key}`,
    archetype: c.archetype,
    locale: c.locale,
    copy_template: playbook.copy_template[c.locale],
    original_description: c.listing.original,
    listing_context: c.listing.context,
    cache_key: `desc:baseline:${c.listing.key}:${c.archetype}:${c.locale}:r0`,
    listing_revision: 0,
    max_tokens: 500,
    generation_model: BASELINE_MODEL,
  } as DescriptionRequestedEvent;
}

/** The gateway input for this case, on the baseline model (`forceModel`: see the manifest). */
export function adaptInput(
  c: BaselineCase,
  onFallback: NonNullable<LlmGatewayInput['onFallback']>,
): LlmGatewayInput {
  return {
    archetypeId: c.archetype as ArchetypeId,
    confidence: 0.75,
    similarity: 0.75,
    basePlaybook: getPlaybook(c.archetype as ArchetypeId),
    listingContext: { listing_description: c.listing.original, ...c.listing.context },
    forceModel: BASELINE_MODEL,
    sessionId: 'baseline',
    tenantId: '00000000-0000-4000-8000-000000001311',
    onFallback,
  };
}

/** The description path's verdict line: the outcome, the headline and digests of what is served. */
export function descriptionVerdict(
  id: string,
  report: Awaited<ReturnType<typeof generateDescription>>,
): string {
  const o = report.outcome as {
    verdict: string;
    violation?: string;
    reason?: string;
    description?: string;
  };
  return JSON.stringify({
    id,
    verdict: o.verdict,
    code: o.violation ?? o.reason ?? null,
    stamped: report.claimsValidation !== null,
    served_sha: o.description ? groupedSha256(o.description) : null,
    headline_sha: report.headline ? groupedSha256(report.headline) : null,
    headline_violation: report.headlineViolation ?? null,
  });
}

/** The adapt path's verdict line: served slots with digests, refused slots with their code. */
export function adaptVerdict(
  id: string,
  output: LlmGatewayOutput | null,
  fallback: string | null,
  refused: { slot: string; violation: string }[],
): string {
  return JSON.stringify({
    id,
    served: (output?.directives ?? []).map((d) => ({ slot: d.slot, sha: groupedSha256(d.value) })),
    refused,
    fallback,
  });
}
