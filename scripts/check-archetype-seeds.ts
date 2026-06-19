/**
 * CI precheck: asserts all 18 archetype seeds have non-empty names and descriptions.
 * Runs without a database connection — validates the source data only.
 * Exit 1 on any failure so CI fails loudly when the seed list regresses.
 */

import { ARCHETYPE_SEEDS } from '../packages/db/src/seed/archetype-seeds.js';

const EXPECTED_COUNT = 18;

let failed = false;

if (ARCHETYPE_SEEDS.length !== EXPECTED_COUNT) {
  console.error(
    `[archetype-seeds] FAIL: expected ${String(EXPECTED_COUNT)} archetypes, got ${String(ARCHETYPE_SEEDS.length)}`,
  );
  failed = true;
}

for (const seed of ARCHETYPE_SEEDS) {
  if (!seed.archetypeName || seed.archetypeName.trim() === '') {
    console.error(`[archetype-seeds] FAIL: empty archetypeName in seed entry`);
    failed = true;
  }
  if (!seed.description || seed.description.trim() === '') {
    console.error(
      `[archetype-seeds] FAIL: empty description for archetype "${seed.archetypeName}"`,
    );
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log(
  `[archetype-seeds] PASS: all ${String(ARCHETYPE_SEEDS.length)} archetype seeds have non-empty names and descriptions.`,
);
