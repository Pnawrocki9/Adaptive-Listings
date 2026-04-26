/**
 * Bundle size enforcement script for Estalara SDK packages.
 *
 * Full implementation in TICKET-018 (sdk-engineer).
 *
 * Budget targets (gzip):
 *   @estalara/sdk-loader         2 KB
 *   @estalara/sdk (Tier 1)      25 KB
 *   @estalara/sdk (Tier 1+2)    40 KB
 *   @estalara/sdk (Tier 1+2+3)  80 KB
 *   @estalara/sdk-react (delta)  +5 KB
 *
 * [TICKET-018] TODO: Implement using size-limit or bundlesize.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- placeholder; full impl in TICKET-018
const BUNDLE_BUDGETS: Record<string, number> = {
  '@estalara/sdk-loader': 2 * 1024,
  '@estalara/sdk/tier1': 25 * 1024,
  '@estalara/sdk/tier1+2': 40 * 1024,
  '@estalara/sdk/tier1+2+3': 80 * 1024,
  '@estalara/sdk-react': 5 * 1024,
};

console.log('Bundle size check placeholder — full implementation in TICKET-018');
console.log('Configured budgets (bytes gzip):');
for (const [bundle, budget] of Object.entries(BUNDLE_BUDGETS)) {
  console.log(`  ${bundle}: ${budget.toLocaleString()} bytes`);
}

export { BUNDLE_BUDGETS };
