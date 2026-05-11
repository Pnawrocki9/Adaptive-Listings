# TICKET-ADP-003 — Adaptation Playbooks (18 Archetypes)

**Sprint:** 7  
**Agent:** sdk-engineer  
**Reviewer:** qa-engineer (reviews tests before PR opens)  
**Priority:** P0  
**Estimated hours:** 8  
**Depends on:** TICKET-ADP-001 (merged — needs `TextDirective`, `ClassDirective`,
`AdaptationDirectives` in `packages/shared`)  
**Branch:** `feat/adp-003-adaptation-playbooks`  
**Commit prefix:** `[TICKET-ADP-003]`

## Context files

- `packages/sdk/src/core/intent.ts` — `Archetype` type (canonical ArchetypeId source)
- `packages/sdk/src/core/playbooks/index.ts` — STUB created by ADP-001 — REPLACE this with real
  implementation
- `packages/shared/src/directives.ts` — `TextDirective`, `ClassDirective`, `AdaptationDirectives`
  (created by ADP-001)
- `apps/control-plane/src/app/api/adapt/route.ts` — Decision API route (created by ADP-001) — update
  `getPlaybook` import after ADP-003 replaces stub
- `docs/MASTER_DESIGN.md` — Master Design context
- `docs/CONVENTIONS_PATCH.md` — known lessons

## What to build

Pre-computed adaptation playbooks for all 18 archetypes. TypeScript objects — not LLM calls, not DB
queries. Loaded synchronously, used by Decision API.

### File structure

```
packages/sdk/src/core/playbooks/
  index.ts                    — PlaybookRegistry, getPlaybook(archetypeId)
  types.ts                    — PlaybookEntry, SlotDirective, ListingClassRule
  archetypes/
    yield-hunter.ts
    vacation-rental-investor.ts
    flip-investor.ts
    portfolio-builder.ts
    golden-visa-buyer.ts
    commercial-investor.ts
    family-buyer.ts
    first-time-buyer.ts
    upsizer.ts
    downsizer.ts
    luxury-buyer.ts
    remote-worker.ts
    lifestyle-expat.ts
    retiree-relocator.ts
    diaspora-buyer.ts
    second-home-buyer.ts
    student-parent.ts
    neutral.ts                — fallback, no-op
```

### Types (in `types.ts`)

```typescript
import type { Archetype } from '../intent.js';

export type SlotDirective = {
  slot: string;
  en: string;
  pl?: string;
  es?: string;
};

export type ListingClassRule = {
  boost_if: string[];
  suppress_if: string[];
  boost_class: string;
  suppress_class: string;
};

export type PlaybookEntry = {
  archetype: Archetype;
  slots: SlotDirective[];
  listing_rules: ListingClassRule;
  feature_priority: string[];
  description: string;
  signals: string[];
};
```

### PlaybookRegistry (in `index.ts`)

```typescript
import type { Archetype } from '../intent.js';
import type { PlaybookEntry } from './types.js';
// import all 18 archetype files...

const registry = new Map<Archetype, PlaybookEntry>([
  ['yield_hunter', yieldHunterPlaybook],
  // ... all 18
]);

export function getPlaybook(archetypeId: Archetype): PlaybookEntry {
  return registry.get(archetypeId) ?? neutralPlaybook;
}

export function getAllPlaybooks(): Map<Archetype, PlaybookEntry> {
  return registry;
}
```

### Playbook content (VERBATIM — do not shorten or use lorem ipsum)

**INVESTORS:**

`yield_hunter`:

- description: "Long-term investor maximizing rental cashflow and ROI"
- slots: [{ slot: 'headline', en: 'Rental Yield: {yield}% | Gross Income: {income}/yr' }, { slot:
  'feature-section', en: 'Investment Performance' }]
- listing_rules: { boost_if: ['has_rental_income', 'yield_data_available'], suppress_if:
  ['no_rental_allowed', 'hoa_restricts_rental'], boost_class: 'estalara-boost', suppress_class:
  'estalara-suppress' }
- feature_priority: ['rental_yield', 'gross_annual_income', 'occupancy_rate', 'price_per_sqm',
  'management_fees']
- signals: ['views_yield_data', 'clicks_rental_calculator', 'long_dwell_on_financials',
  'quiz:investment+long']

`vacation_rental_investor`:

- description: "Short-term rental investor targeting Airbnb/holiday markets (ES, CY focus)"
- slots: [{ slot: 'headline', en: 'Airbnb Potential: {nightly_rate}/night est.' }, { slot: 'cta',
  en: 'See Short-Term Rental Projections' }]
- listing_rules: { boost_if: ['tourist_zone', 'short_term_rental_license', 'near_beach',
  'near_airport'], suppress_if: ['rental_restrictions', 'no_stl_license'], boost_class:
  'estalara-boost', suppress_class: 'estalara-suppress' }
- feature_priority: ['tourist_license_status', 'nightly_rate_estimate', 'beach_distance',
  'airport_distance', 'pool']
- signals: ['searches_tourist_areas', 'clicks_location_map', 'quiz:investment+short',
  'views_airbnb_related']

`flip_investor`:

- description: "Fix & flip investor seeking below-market properties with upside potential"
- slots: [{ slot: 'headline', en: 'Below Market Value — Renovation Opportunity' }, { slot:
  'feature', en: 'Estimated ARV: {arv}' }]
- listing_rules: { boost_if: ['price_below_area_median', 'needs_renovation', 'motivated_seller'],
  suppress_if: ['premium_finished', 'price_above_median'], boost_class: 'estalara-boost',
  suppress_class: 'estalara-suppress' }
- feature_priority: ['price_vs_market', 'condition', 'renovation_estimate', 'arv_estimate',
  'days_on_market']
- signals: ['filters_by_price_low', 'views_older_listings', 'quiz:investment+short',
  'clicks_price_history']

`portfolio_builder`:

- description: "Experienced investor scaling a multi-property portfolio"
- slots: [{ slot: 'headline', en: 'Portfolio Addition — {bedrooms}BR | {yield}% Yield' }, { slot:
  'cta', en: 'Request Bulk Enquiry' }]
- listing_rules: { boost_if: ['multiple_units_available', 'bulk_discount_possible',
  'management_company_available'], suppress_if: [], boost_class: 'estalara-boost', suppress_class:
  'estalara-suppress' }
- feature_priority: ['price_per_unit', 'yield', 'management_available', 'bulk_availability',
  'legal_status']
- signals: ['views_multiple_listings_same_building', 'long_session', 'quiz:investment+long',
  'returns_multiple_times']

`golden_visa_buyer`:

- description: "High-net-worth buyer seeking residency/citizenship via real estate investment (CY,
  ES)"
- slots: [{ slot: 'headline', en: 'Golden Visa Eligible — Investment from €{threshold}' }, { slot:
  'cta', en: 'Download Golden Visa Guide' }]
- listing_rules: { boost_if: ['golden_visa_eligible', 'price_above_250k_eur', 'new_development'],
  suppress_if: ['price_below_threshold'], boost_class: 'estalara-boost', suppress_class:
  'estalara-suppress' }
- feature_priority: ['golden_visa_eligibility', 'price', 'new_development', 'developer_reputation',
  'completion_date']
- signals: ['filters_price_high', 'views_new_developments', 'searches_visa_terms',
  'international_ip']

`commercial_investor`:

- description: "Commercial property investor (offices, retail, warehouses)"
- slots: [{ slot: 'headline', en: 'Commercial Investment — {sqm}m² | {yield}% Gross Yield' }, {
  slot: 'cta', en: 'Request Commercial Pack' }]
- listing_rules: { boost_if: ['commercial_zoning', 'rental_tenant_in_place', 'triple_net_lease'],
  suppress_if: ['residential_only'], boost_class: 'estalara-boost', suppress_class:
  'estalara-suppress' }
- feature_priority: ['commercial_zoning', 'current_tenant', 'lease_terms', 'gross_yield',
  'cap_rate']
- signals: ['searches_commercial', 'views_large_sqm', 'clicks_zoning_info',
  'filters_commercial_type']

**OWN USE:**

`family_buyer`:

- description: "Family seeking space, schools, safety, and outdoor areas"
- slots: [{ slot: 'headline', en: '{bedrooms}BR Family Home — {school_rating} School District' }, {
  slot: 'feature', en: 'Family Essentials' }]
- listing_rules: { boost_if: ['good_school_district', 'garden_or_yard', '3plus_bedrooms',
  'quiet_street'], suppress_if: ['studio', '1_bedroom', 'commercial_area'], boost_class:
  'estalara-boost', suppress_class: 'estalara-suppress' }
- feature_priority: ['bedrooms', 'school_rating', 'garden_size', 'nearby_parks', 'safety_score',
  'storage']
- signals: ['filters_3plus_bedrooms', 'clicks_school_info', 'views_garden_photos',
  'quiz:own_use+long']

`first_time_buyer`:

- description: "First-time buyer navigating mortgage, budget, and unfamiliar process"
- slots: [{ slot: 'headline', en: 'First Home — Monthly from {monthly_payment}' }, { slot: 'cta',
  en: 'Get First-Time Buyer Guide' }, { slot: 'feature', en: 'Your First Step' }]
- listing_rules: { boost_if: ['starter_home', 'price_below_area_median', 'move_in_ready',
  'ftb_scheme_eligible'], suppress_if: ['renovation_needed', 'price_above_median'], boost_class:
  'estalara-boost', suppress_class: 'estalara-suppress' }
- feature_priority: ['monthly_mortgage_estimate', 'ftb_scheme_eligible', 'condition', 'total_costs',
  'school_proximity']
- signals: ['views_mortgage_calculator', 'clicks_ftb_content', 'price_filters_low',
  'quiz:own_use+long', 'long_dwell_on_financing']

`upsizer`:

- description: "Current homeowner trading up to more space or better location"
- slots: [{ slot: 'headline', en: 'Upsize to {bedrooms}BR — {key_feature}' }, { slot: 'feature', en:
  'Why Upgrade?' }]
- listing_rules: { boost_if: ['larger_than_area_avg', 'premium_finish', 'good_location_score'],
  suppress_if: ['small_sqm', 'studio'], boost_class: 'estalara-boost', suppress_class:
  'estalara-suppress' }
- feature_priority: ['sqm', 'bedrooms', 'location_score', 'finish_quality', 'garden', 'garage']
- signals: ['filters_sqm_high', 'views_4plus_bedrooms', 'quiz:own_use+medium',
  'compares_multiple_large_listings']

`downsizer`:

- description: "Senior or empty-nester moving to smaller, more manageable property"
- slots: [{ slot: 'headline', en: 'Easy Living — {bedrooms}BR with Lift & No Garden Maintenance' },
  { slot: 'feature', en: 'Downsizer Friendly' }]
- listing_rules: { boost_if: ['lift_available', 'low_maintenance', 'ground_floor_or_lift',
  'accessible'], suppress_if: ['large_garden', 'steep_access', 'multi_story_no_lift'], boost_class:
  'estalara-boost', suppress_class: 'estalara-suppress' }
- feature_priority: ['accessibility', 'lift', 'maintenance_costs', 'heating_efficiency',
  'proximity_to_amenities']
- signals: ['filters_sqm_low', 'views_accessible_listings', 'quiz:own_use+long',
  'clicks_accessibility_info']

`luxury_buyer`:

- description: "High-end buyer seeking prestige, premium finishes, and lifestyle"
- slots: [{ slot: 'headline', en: 'Exceptional Residence — {key_luxury_feature}' }, { slot: 'cta',
  en: 'Request Private Viewing' }]
- listing_rules: { boost_if: ['luxury_tier', 'price_top_10pct', 'premium_developer',
  'concierge_services'], suppress_if: ['standard_finish', 'price_below_luxury_threshold'],
  boost_class: 'estalara-boost', suppress_class: 'estalara-suppress' }
- feature_priority: ['premium_features', 'finishes', 'views', 'privacy', 'concierge', 'smart_home']
- signals: ['filters_price_high', 'views_luxury_developments', 'long_dwell_on_premium_photos',
  'quiz:own_use+any']

`remote_worker`:

- description: "Location-independent professional prioritizing home office and connectivity"
- slots: [{ slot: 'headline', en: 'Work From Home — Dedicated Office Space | {internet_speed}Mbps
  Fibre' }, { slot: 'feature', en: 'Remote Work Ready' }]
- listing_rules: { boost_if: ['dedicated_office_room', 'fibre_available', 'quiet_area',
  'good_natural_light'], suppress_if: ['no_office_space', 'poor_connectivity'], boost_class:
  'estalara-boost', suppress_class: 'estalara-suppress' }
- feature_priority: ['dedicated_office', 'internet_speed', 'natural_light', 'noise_level',
  'co_working_nearby']
- signals: ['searches_office_space', 'clicks_connectivity_info', 'views_desk_room_photos',
  'quiz:own_use+any']

**SPECIAL / CROSS-BORDER:**

`lifestyle_expat`:

- description: "Relocating from another country, prioritizing integration, lifestyle, and community"
- slots: [{ slot: 'headline', en: 'Expat Community — {neighborhood} | International Schools Nearby'
  }, { slot: 'cta', en: 'Download Expat Relocation Guide' }]
- listing_rules: { boost_if: ['expat_community_area', 'international_schools',
  'english_speaking_area'], suppress_if: [], boost_class: 'estalara-boost', suppress_class:
  'estalara-suppress' }
- feature_priority: ['expat_community', 'international_schools', 'english_services',
  'neighborhood_guide', 'healthcare']
- signals: ['international_ip', 'views_neighborhood_content', 'clicks_schools', 'quiz:own_use+long',
  'googles_expat_terms']

`retiree_relocator`:

- description: "Retiree seeking warm climate, healthcare access, low cost of living"
- slots: [{ slot: 'headline', en: 'Retire in the Sun — Healthcare {minutes}min | {climate} Climate'
  }, { slot: 'cta', en: 'Download Retirement Living Guide' }]
- listing_rules: { boost_if: ['warm_climate', 'healthcare_nearby', 'low_maintenance',
  'expat_retiree_community'], suppress_if: ['cold_region', 'remote_location'], boost_class:
  'estalara-boost', suppress_class: 'estalara-suppress' }
- feature_priority: ['healthcare_proximity', 'climate', 'low_maintenance', 'expat_community',
  'cost_of_living', 'accessibility']
- signals: ['international_ip', 'views_retirement_content', 'filters_accessible',
  'quiz:own_use+long', 'older_device_patterns']

`diaspora_buyer`:

- description: "Buying in home country from abroad — remote purchase, legal navigation, family
  context"
- slots: [{ slot: 'headline', en: 'Buy From Abroad — Remote Purchase Support Available' }, { slot:
  'cta', en: 'Speak with a Diaspora Specialist' }]
- listing_rules: { boost_if: ['remote_purchase_supported', 'legal_support_available',
  'family_area'], suppress_if: [], boost_class: 'estalara-boost', suppress_class:
  'estalara-suppress' }
- feature_priority: ['remote_purchase_process', 'legal_support', 'family_area', 'price',
  'developer_reliability']
- signals: ['international_ip_country_mismatch', 'views_legal_content', 'off_hours_browsing',
  'quiz:own_use+any']

`second_home_buyer`:

- description: "Buying a holiday or weekend home alongside primary residence"
- slots: [{ slot: 'headline', en: 'Your Holiday Home — {location_highlight}' }, { slot: 'feature',
  en: 'Weekend Escape' }]
- listing_rules: { boost_if: ['holiday_area', 'near_beach_or_mountain',
  'short_term_rental_possible', 'turnkey'], suppress_if: ['city_centre', 'no_amenities'],
  boost_class: 'estalara-boost', suppress_class: 'estalara-suppress' }
- feature_priority: ['location', 'holiday_amenities', 'rental_potential', 'maintenance_costs',
  'transport_links']
- signals: ['weekend_browsing_pattern', 'views_holiday_areas', 'quiz:own_use+short',
  'international_or_secondary_city_ip']

`student_parent`:

- description: "Parent buying for a child at university — investment-meets-own-use hybrid"
- slots: [{ slot: 'headline', en: 'Student Investment — Near {university} | Let While Studying' }, {
  slot: 'cta', en: 'Calculate Student Rental Return' }]
- listing_rules: { boost_if: ['near_university', 'student_area', 'rental_possible',
  'small_manageable'], suppress_if: ['far_from_university', 'luxury_tier'], boost_class:
  'estalara-boost', suppress_class: 'estalara-suppress' }
- feature_priority: ['distance_to_university', 'rental_yield_student', 'condition', 'security',
  'transport']
- signals: ['searches_university_proximity', 'views_small_listings', 'clicks_rental_calc',
  'quiz:investment+medium']

**FALLBACK:**

`neutral`:

- description: "Unclassified — no adaptation applied"
- slots: []
- listing_rules: { boost_if: [], suppress_if: [], boost_class: '', suppress_class: '' }
- feature_priority: []
- signals: []

### Post-ADP-003: Replace stub in Decision API

After the playbooks are implemented, also update `apps/control-plane/src/app/api/adapt/route.ts` to
replace the ADP-001 stub import with the real `getPlaybook` from
`packages/sdk/src/core/playbooks/index.ts`. Note this in the PR description.

IMPORTANT: The control-plane must be able to import from `@estalara/sdk` — check
`packages/sdk/package.json` exports to ensure playbooks are exported, or use a relative path via
workspace import.

### Tests required

1. Unit: `getPlaybook()` returns correct playbook for each of 18 archetypes (all must match the spec
   values)
2. Unit: `getPlaybook('unknown_archetype_id')` returns neutral fallback
3. Unit: each playbook has non-empty `description`, `signals` (at least 1), `feature_priority` (at
   least 1) — guard against empty configs. `neutral` is the exception (empty is correct for
   neutral).
4. Integration: Decision API (ADP-001 route) + playbook lookup → verify `AdaptationDirectives`
   directive shape for `yield_hunter` (confidence=0.75, similarity=0.90), `family_buyer`
   (confidence=0.80, similarity=0.88), `lifestyle_expat` (confidence=0.70, similarity=0.95).

## Acceptance criteria

- [ ] All 18 playbook files exist with exact content specified (not lorem ipsum, not TODO)
- [ ] `neutral.ts` exists as fallback (no-op — empty slots, no signals)
- [ ] `getPlaybook()` returns correct playbook for all 18 archetypes
- [ ] `getPlaybook('nonexistent')` returns neutral playbook
- [ ] All tests pass
- [ ] Integration test with Decision API produces valid directives for yield_hunter, family_buyer,
      lifestyle_expat
- [ ] ADP-001 placeholder stub replaced with real `getPlaybook` import in control-plane route
- [ ] CI green
