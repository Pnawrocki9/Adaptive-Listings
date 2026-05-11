/**
 * Playbook stub — temporary implementation for ADP-001.
 *
 * ADP-003 (sdk-engineer) will replace the import in route.ts with the real
 * `getPlaybook` function from `@estalara/sdk/playbooks` once that package exports
 * the full 18-archetype registry.
 *
 * This file will be deleted when ADP-003 merges.
 *
 * @module apps/control-plane/src/app/api/adapt/playbook-stub
 */

import type { ArchetypeId } from '@estalara/shared';

export interface PlaybookDirective {
  slot: string;
  value: string;
}

export interface PlaybookEntry {
  archetype: ArchetypeId;
  slots: PlaybookDirective[];
  feature_priority: string[];
  description: string;
}

/**
 * Returns an empty playbook for any archetype.
 * ADP-003 replaces this with real pre-computed directive data for all 18 archetypes.
 */
export function getPlaybook(archetypeId: ArchetypeId): PlaybookEntry {
  return {
    archetype: archetypeId,
    slots: [],
    feature_priority: [],
    description: `Stub playbook for ${archetypeId} — ADP-003 will replace this`,
  };
}
