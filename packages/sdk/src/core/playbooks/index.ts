/**
 * Playbook registry — 18-archetype adaptation data.
 *
 * Pre-computed, synchronous lookup. No LLM calls, no DB queries.
 * Used by the Decision API (`apps/control-plane/src/app/api/adapt/route.ts`)
 * and by Tier 2 client-side DOM mutation logic.
 *
 * @module @estalara/sdk/core/playbooks
 */

import type { Archetype } from '../intent.js';
import type { PlaybookEntry } from './types.js';

import { yieldHunterPlaybook } from './archetypes/yield-hunter.js';
import { vacationRentalInvestorPlaybook } from './archetypes/vacation-rental-investor.js';
import { flipInvestorPlaybook } from './archetypes/flip-investor.js';
import { portfolioBuilderPlaybook } from './archetypes/portfolio-builder.js';
import { goldenVisaBuyerPlaybook } from './archetypes/golden-visa-buyer.js';
import { commercialInvestorPlaybook } from './archetypes/commercial-investor.js';
import { familyBuyerPlaybook } from './archetypes/family-buyer.js';
import { firstTimeBuyerPlaybook } from './archetypes/first-time-buyer.js';
import { upsizerPlaybook } from './archetypes/upsizer.js';
import { downsizerPlaybook } from './archetypes/downsizer.js';
import { luxuryBuyerPlaybook } from './archetypes/luxury-buyer.js';
import { remoteWorkerPlaybook } from './archetypes/remote-worker.js';
import { lifestyleExpatPlaybook } from './archetypes/lifestyle-expat.js';
import { retireeRelocatorPlaybook } from './archetypes/retiree-relocator.js';
import { diasporaBuyerPlaybook } from './archetypes/diaspora-buyer.js';
import { secondHomeBuyerPlaybook } from './archetypes/second-home-buyer.js';
import { studentParentPlaybook } from './archetypes/student-parent.js';
import { neutralPlaybook } from './archetypes/neutral.js';

export type { PlaybookEntry, SlotDirective, ListingClassRule } from './types.js';

const registry = new Map<Archetype, PlaybookEntry>([
  ['yield_hunter', yieldHunterPlaybook],
  ['vacation_rental_investor', vacationRentalInvestorPlaybook],
  ['flip_investor', flipInvestorPlaybook],
  ['portfolio_builder', portfolioBuilderPlaybook],
  ['golden_visa_buyer', goldenVisaBuyerPlaybook],
  ['commercial_investor', commercialInvestorPlaybook],
  ['family_buyer', familyBuyerPlaybook],
  ['first_time_buyer', firstTimeBuyerPlaybook],
  ['upsizer', upsizerPlaybook],
  ['downsizer', downsizerPlaybook],
  ['luxury_buyer', luxuryBuyerPlaybook],
  ['remote_worker', remoteWorkerPlaybook],
  ['lifestyle_expat', lifestyleExpatPlaybook],
  ['retiree_relocator', retireeRelocatorPlaybook],
  ['diaspora_buyer', diasporaBuyerPlaybook],
  ['second_home_buyer', secondHomeBuyerPlaybook],
  ['student_parent', studentParentPlaybook],
  ['neutral', neutralPlaybook],
]);

/**
 * Returns the playbook for the given archetype.
 * Falls back to the neutral playbook for any unrecognized archetype ID.
 *
 * @param archetypeId - Archetype to look up.
 * @returns PlaybookEntry (neutral if not found).
 */
export function getPlaybook(archetypeId: Archetype): PlaybookEntry {
  return registry.get(archetypeId) ?? neutralPlaybook;
}

/**
 * Returns the full registry (all 18 playbooks).
 * Useful for bulk processing and analytics.
 */
export function getAllPlaybooks(): Map<Archetype, PlaybookEntry> {
  return registry;
}
