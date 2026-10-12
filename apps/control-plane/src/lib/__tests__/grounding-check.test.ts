/**
 * FOLLOW-1297 — the Python-semantics helpers of `grounding-check.ts`, pinned at the unit level.
 * The checker's behaviour as a whole is pinned by the frozen corpus (`description-parity.test.ts`);
 * these tests name the individual Python calls each helper stands in for.
 */
import { describe, expect, it } from 'vitest';
import {
  bodyViolatesContract,
  canonNumber,
  checkBodyClaims,
  checkHeadlineFacts,
  pySliceCodePoints,
  pySplit,
  pyStrip,
  pyStripChars,
  pythonJsonDumps,
  stemLoose,
} from '@/lib/grounding-check';

describe('pythonJsonDumps (json.dumps, ensure_ascii=True)', () => {
  it('escapes every non-ASCII character as a lowercase \\uXXXX, astral as a surrogate pair', () => {
    expect(pythonJsonDumps({ a: 'café' })).toBe('{"a": "caf\\u00e9"}');
    expect(pythonJsonDumps({ a: 'É' })).toBe('{"a": "\\u00c9"}');
    expect(pythonJsonDumps({ a: '🌊' })).toBe('{"a": "\\ud83c\\udf0a"}');
  });

  it('uses Python separators, short escapes and the indent=2 layout', () => {
    expect(pythonJsonDumps({})).toBe('{}');
    expect(pythonJsonDumps({}, 2)).toBe('{}');
    expect(pythonJsonDumps({ k: 'a"b\\c\nd\te\u0001' })).toBe('{"k": "a\\"b\\\\c\\nd\\te\\u0001"}');
    expect(pythonJsonDumps({ a: '1', b: '2' }, 2)).toBe('{\n  "a": "1",\n  "b": "2"\n}');
    expect(pythonJsonDumps({ a: '1', b: '2' })).toBe('{"a": "1", "b": "2"}');
  });
});

describe('Python string helpers', () => {
  it('pyStrip strips the Python whitespace set (incl. \\x1c-\\x1f, \\x85, \\u3000; not \\ufeff)', () => {
    expect(pyStrip(' \t\u001c\u0085\u3000x\u00a0\n')).toBe('x');
    expect(pyStrip('﻿x')).toBe('﻿x');
  });

  it('pySplit splits on whitespace runs and drops empty fields', () => {
    expect(pySplit('  a \u3000 b\n\tc  ')).toEqual(['a', 'b', 'c']);
    expect(pySplit('   ')).toEqual([]);
  });

  it('pyStripChars strips any run of the given characters from both ends', () => {
    expect(pyStripChars('"\'x y\'"', '"\'')).toBe('x y');
  });

  it('pySliceCodePoints counts code points, not UTF-16 units', () => {
    expect(pySliceCodePoints('🌊🌊🌊', 2)).toBe('🌊🌊');
  });
});

describe('digit rule', () => {
  it('canonNumber keeps digits and the decimal point, outer dots stripped', () => {
    expect(canonNumber('€97,200')).toBe('97200');
    expect(canonNumber('6.5%')).toBe('6.5');
    expect(canonNumber('.5.')).toBe('5');
    expect(canonNumber('٣')).toBe('');
  });

  it('the digit rule tokenises the grounding with the same (case-insensitive) regex', () => {
    expect(checkBodyClaims('5 bedrooms', '425000 eur', {})).toBe('hallucinated_number');
    expect(checkBodyClaims('€97,200', '97200 eur', {})).toBeNull();
    expect(checkBodyClaims('120M²', '120m²', {})).toBeNull();
  });

  it('stemLoose strips one English suffix on words long enough', () => {
    expect(stemLoose('Maximizing')).toBe('maximiz');
    expect(stemLoose('Maximize')).toBe('maximiz');
    expect(stemLoose('Maximus')).toBe('maximu');
    expect(stemLoose('es')).toBe('es');
  });
});

describe('headline and body checks (Python semantics)', () => {
  it('treats isupper as the Unicode Uppercase property and \\b as Unicode-aware', () => {
    expect(checkHeadlineFacts('Évora flat', "A flat in Évora's old town.", {})).toBeNull();
    expect(checkHeadlineFacts('Évora flat', 'A flat in the old town.', {})).toBe(
      'hallucinated_proper_name',
    );
    // `\bVian\b` must not match inside `évian` (Unicode word character before it).
    expect(checkHeadlineFacts('Vian flat', 'A flat in évian.', {})).toBe(
      'hallucinated_proper_name',
    );
  });

  it('claim grounding is original_description + positive fields; "no" values do not ground', () => {
    expect(checkBodyClaims('A flat with a pool.', 'A flat with no pool.', {})).toBe(
      'unsupported_amenity',
    );
    expect(checkBodyClaims('A flat with a pool.', 'A flat.', { pool: 'false' })).toBe(
      'unsupported_amenity',
    );
    expect(checkBodyClaims('A flat with a pool.', 'A flat.', { pool: 'heated' })).toBeNull();
    expect(checkBodyClaims('Offers 128 m².', '', { living_area: '128' })).toBeNull();
    expect(checkBodyClaims('Offers 128 m².', '', { price: '128' })).toBe('unit_mismatch');
  });

  it('bodyViolatesContract: residual tag first, then markdown, then leak markers', () => {
    expect(bodyViolatesContract('text <Verified_Facts_Used>')).toBe('residual_tag');
    expect(bodyViolatesContract('**bold**')).toBe('formatted_body');
    expect(bodyViolatesContract('line\n\u00a0# heading')).toBe('formatted_body');
    expect(bodyViolatesContract('My approach is')).toBe('leak_marker');
    expect(bodyViolatesContract('the asking price is non-negotiable')).toBeNull();
  });
});
