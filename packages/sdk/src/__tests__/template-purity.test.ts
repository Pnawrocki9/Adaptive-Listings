/**
 * Template purity CI gate for TICKET-DESC-PIVOT-001 v1.7.1.
 *
 * v1.7.1 replaces marketing-copy templates with structured voice/framing patterns.
 * The Sonnet description pipeline treats `copy_template` as a *style seed*, not as
 * literal output. Numeric placeholders ({yield}, {occupancy_rate}, {price}, ...)
 * caused hallucination: Sonnet would invent or preserve placeholder-looking numbers
 * even when verified listing facts contradicted them.
 *
 * This test asserts the invariant: no archetype `copy_template` value contains
 * any forbidden `{placeholder}` token. The scan is scoped to the `copy_template`
 * literal block of each archetype file — `slots[].en` placeholders are intentionally
 * preserved (they are resolved at render time by the SDK, not by Sonnet).
 *
 * @see docs/specs/TICKET-DESC-PIVOT-001-v1.7.1.md Appendix A
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARCHETYPES_DIR = join(__dirname, '..', 'core', 'playbooks', 'archetypes');

/**
 * Extracts the source text of the `copy_template: { ... }` literal block from a
 * playbook archetype source file. Returns null when no block is found (e.g. for
 * a file that does not contain a copy_template field).
 *
 * The extractor uses a brace-balancing scan rather than regex to handle nested
 * template literals and embedded object/string syntax robustly.
 */
function extractCopyTemplateBlock(source: string): string | null {
  const marker = 'copy_template:';
  const start = source.indexOf(marker);
  if (start === -1) return null;
  const braceStart = source.indexOf('{', start);
  if (braceStart === -1) return null;

  let depth = 0;
  let inString: '"' | "'" | '`' | null = null;
  let escape = false;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  return null;
}

describe('Template purity — no numeric placeholders in voice patterns', () => {
  const FORBIDDEN_PLACEHOLDERS = [
    'yield',
    'income',
    'occupancy_rate',
    'adr',
    'price_per_sqm',
    'cap_rate',
    'wault',
    'lease_remaining',
    'passing_rent',
    'reversionary_yield',
    'ltv',
    'portfolio_yield',
    'comparable_units',
    'flip_timeline',
    'refurb_comp',
    'visa_threshold',
    'covenant_rating',
    'schools_rating',
    'broadband_speed',
    'climate_summary',
    'distance_to_university',
    'distance_from_primary',
    'airport',
    'view',
    'epc_rating',
    'tenure',
    'tenant_name',
    'university_name',
    'garden_or_balcony',
    'garden_sqm',
    'sleeps',
    'transport_links',
    'visa_program',
    'price_vs_average',
    'sqm',
    'bedrooms',
    'bathrooms',
    'price',
    'location',
    'neighbourhood',
    'city',
  ];

  const archetypeFiles = readdirSync(ARCHETYPES_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => join(ARCHETYPES_DIR, f));

  it('discovers all 18 archetype files', () => {
    expect(archetypeFiles.length).toBe(18);
  });

  it.each(FORBIDDEN_PLACEHOLDERS)(
    'no archetype copy_template contains {%s} placeholder',
    (placeholder) => {
      const regex = new RegExp(`\\{${placeholder}\\}`, 'g');
      for (const file of archetypeFiles) {
        const content = readFileSync(file, 'utf-8');
        const block = extractCopyTemplateBlock(content);
        expect(block, `${file} is missing copy_template block`).not.toBeNull();
        if (block === null) continue;
        const matches = block.match(regex);
        expect(matches, `${file} copy_template contains forbidden {${placeholder}}`).toBeNull();
      }
    },
  );

  it('every archetype copy_template defines en, pl, es locales', () => {
    for (const file of archetypeFiles) {
      const content = readFileSync(file, 'utf-8');
      const block = extractCopyTemplateBlock(content);
      expect(block, `${file} is missing copy_template block`).not.toBeNull();
      if (block === null) continue;
      expect(block, `${file} copy_template missing 'en:' key`).toMatch(/\ben\s*:/);
      expect(block, `${file} copy_template missing 'pl:' key`).toMatch(/\bpl\s*:/);
      expect(block, `${file} copy_template missing 'es:' key`).toMatch(/\bes\s*:/);
    }
  });

  it('every archetype copy_template contains VOICE PATTERN and HARD RULES sections', () => {
    for (const file of archetypeFiles) {
      const content = readFileSync(file, 'utf-8');
      const block = extractCopyTemplateBlock(content);
      expect(block, `${file} is missing copy_template block`).not.toBeNull();
      if (block === null) continue;
      // Both section markers must appear in each of the 3 locales — so 3 times each.
      const voicePatternCount = (block.match(/VOICE PATTERN:/g) ?? []).length;
      const hardRulesCount = (block.match(/HARD RULES:/g) ?? []).length;
      expect(voicePatternCount, `${file} expected 3 VOICE PATTERN markers`).toBe(3);
      expect(hardRulesCount, `${file} expected 3 HARD RULES markers`).toBe(3);
    }
  });
});
