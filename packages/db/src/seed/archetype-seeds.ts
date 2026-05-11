/**
 * Seed data for the archetype_embeddings table.
 *
 * Descriptions are used server-side (Modal Archetype Update Job) to generate
 * OpenAI text-embedding-3-small vectors. The embedding column starts empty
 * and is filled on first job run.
 *
 * @module @estalara/db/seed/archetype-seeds
 */

export interface ArchetypeSeedRow {
  readonly archetypeName: string;
  readonly description: string;
  readonly confidenceThreshold: string;
}

export const ARCHETYPE_SEEDS: readonly ArchetypeSeedRow[] = [
  {
    archetypeName: 'yield_hunter',
    description:
      'Real estate investor focused on rental yield and ROI. Analyzes price-to-rent ratios, cap rates, gross yield percentages. Seeks properties with strong long-term cashflow in established rental markets.',
    confidenceThreshold: '0.600',
  },
  {
    archetypeName: 'vacation_rental_investor',
    description:
      'Investor targeting short-term vacation rental income via Airbnb or similar platforms. Prioritizes tourist locations, beach proximity, occupancy rates, and seasonal demand patterns.',
    confidenceThreshold: '0.600',
  },
  {
    archetypeName: 'flip_investor',
    description:
      'Fix-and-flip real estate investor. Seeks undervalued or distressed properties to renovate and resell quickly for profit. Focuses on renovation potential, below-market pricing, and quick turnaround.',
    confidenceThreshold: '0.580',
  },
  {
    archetypeName: 'portfolio_builder',
    description:
      'Experienced investor systematically building a multi-property portfolio. Compares multiple properties across locations, analyzes diversification, seeks bulk or repeat opportunities.',
    confidenceThreshold: '0.580',
  },
  {
    archetypeName: 'golden_visa_buyer',
    description:
      'Foreign national purchasing real estate to obtain residency or citizenship through investment programs. Interested in legal requirements, investment thresholds, and residency benefits.',
    confidenceThreshold: '0.620',
  },
  {
    archetypeName: 'commercial_investor',
    description:
      'Investor focused on commercial real estate: offices, retail units, warehouses, mixed-use. Analyzes lease terms, tenant quality, commercial yield, and zoning regulations.',
    confidenceThreshold: '0.600',
  },
  {
    archetypeName: 'family_buyer',
    description:
      'Family purchasing a primary residence. Prioritizes school quality, neighborhood safety, number of bedrooms, garden space, and proximity to family amenities.',
    confidenceThreshold: '0.580',
  },
  {
    archetypeName: 'first_time_buyer',
    description:
      'First-time homebuyer navigating the purchase process. Budget-conscious, researches mortgage options, stamp duty, government schemes. Often takes longer to decide and views many properties.',
    confidenceThreshold: '0.560',
  },
  {
    archetypeName: 'upsizer',
    description:
      'Existing homeowner looking to upsize to a larger or better property. Focused on larger square footage, premium locations, extra bedrooms, and higher quality finishes.',
    confidenceThreshold: '0.560',
  },
  {
    archetypeName: 'downsizer',
    description:
      'Older buyer or empty-nester looking to move to a smaller, more manageable property. Priorities include single-level living, low maintenance, accessible facilities, and retirement-friendly communities.',
    confidenceThreshold: '0.580',
  },
  {
    archetypeName: 'luxury_buyer',
    description:
      'High-net-worth buyer seeking premium or luxury properties. Values exceptional finishes, prestigious locations, privacy, architectural design, and exclusivity. Price-insensitive.',
    confidenceThreshold: '0.620',
  },
  {
    archetypeName: 'remote_worker',
    description:
      'Remote worker or digital nomad seeking a home that supports working from home. Prioritizes reliable internet, home office space, and quality of life over commute distance.',
    confidenceThreshold: '0.560',
  },
  {
    archetypeName: 'lifestyle_expat',
    description:
      'Expatriate relocating from another country for lifestyle reasons. Researches international schools, expat communities, healthcare access, and cost of living in destination country.',
    confidenceThreshold: '0.580',
  },
  {
    archetypeName: 'retiree_relocator',
    description:
      'Retiree relocating to a warmer or more affordable country. Values climate, healthcare quality, cost of living, safety, and proximity to other retirees and amenities.',
    confidenceThreshold: '0.580',
  },
  {
    archetypeName: 'diaspora_buyer',
    description:
      'Member of diaspora purchasing property in their country of origin from abroad. Motivated by family ties, cultural connection, investment, or future return. Often purchases remotely.',
    confidenceThreshold: '0.600',
  },
  {
    archetypeName: 'second_home_buyer',
    description:
      'Buyer purchasing a holiday home or weekend retreat. Interested in leisure amenities, scenic locations, accessibility from primary residence, and potential for occasional rental income.',
    confidenceThreshold: '0.580',
  },
  {
    archetypeName: 'student_parent',
    description:
      'Parent purchasing property for a student child attending university. Focused on proximity to campus, safety, public transport links, and potential for renting spare rooms to cover costs.',
    confidenceThreshold: '0.580',
  },
  {
    archetypeName: 'neutral',
    description:
      'General property browser without clear intent signal. Early research phase, exploring options without specific criteria. Requires more behavioral data before archetype classification.',
    confidenceThreshold: '0.500',
  },
] as const;
