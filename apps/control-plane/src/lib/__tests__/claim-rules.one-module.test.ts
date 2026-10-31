/**
 * FOLLOW-1311 slice 1: the claim rules live once, in `lib/claim-rules.ts`. A second copy on either
 * path is how the two checkers drifted (ADR-0023 §1), so this fails if one comes back.
 *
 * @module apps/control-plane/src/lib/__tests__/claim-rules.one-module.test
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string): string => readFileSync(path.resolve(__dirname, '..', file), 'utf8');

const DEFINITIONS = [
  /\bconst AREA_UNIT\b/,
  /\bconst AREA_KEY_RE\b/,
  /\bconst NEGATIVE_FIELD_VALUES\b/,
  /\bconst NEGATION_WINDOW\b/,
  /\bfunction canonNumber\b/,
  /\bfunction stemLoose\b/,
  /\bfunction isNegated\b/,
  /\bfunction asserted\b/,
  /\bfunction clauseBefore\b/,
];

describe('FOLLOW-1311: one implementation of the claim rules', () => {
  it.each(['llm-gateway.ts', 'claim-containment.ts', 'grounding-check.ts', 'condition-lexicon.ts'])(
    '%s defines no copy of a shared rule',
    (file) => {
      const text = source(file);
      expect(DEFINITIONS.filter((re) => re.test(text)).map(String)).toEqual([]);
    },
  );

  it('the listing grounding of /api/adapt names no session field', () => {
    const body = source('llm-gateway.ts').split('function buildDirectiveGroundingText')[1] ?? '';
    expect(body.slice(0, body.indexOf('\n}'))).not.toMatch(/sessionContext|recentEvents/);
  });
});
