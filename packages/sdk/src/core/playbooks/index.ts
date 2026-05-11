/**
 * Playbook registry — stub implementation for ADP-001.
 *
 * ADP-003 (sdk-engineer) will replace this stub with the 18 real archetype playbooks.
 * This file exists ONLY to satisfy the type contract required by the Decision API route.
 *
 * @module @estalara/sdk/core/playbooks
 */

import type { Archetype } from '../intent.js';

export interface PlaybookDirective {
  /** Slot identifier matching `[data-estalara-slot="<slot>"]` on the host page. */
  slot: string;
  /** Text value to inject into the slot. May contain `{variable}` placeholders. */
  value: string;
}

export interface PlaybookEntry {
  archetype: Archetype;
  /** Slot directives — empty in stub, populated by ADP-003. */
  slots: PlaybookDirective[];
  /** Ordered list of listing features to highlight — empty in stub, populated by ADP-003. */
  feature_priority: string[];
  /** Human-readable description of the archetype's motivation. */
  description: string;
}

/**
 * Returns a playbook for the given archetype.
 *
 * STUB — returns an empty playbook for every archetype.
 * ADP-003 will replace this with the 18 real playbooks.
 *
 * @param archetypeId - Archetype to look up.
 * @returns Playbook entry (empty slots in stub).
 */
export function getPlaybook(archetypeId: Archetype): PlaybookEntry {
  return {
    archetype: archetypeId,
    slots: [],
    feature_priority: [],
    description: `Stub playbook for ${archetypeId} — ADP-003 will replace this`,
  };
}
