/**
 * Tests for the ADR-0021 §D7 consent-text wire contract (FOLLOW-915).
 *
 * ADR-0019 "On acceptance" guardrail: ≥5 cases per new schema. Covers the five §D7 named
 * cases (valid doc; missing locale; wrong `schema_version`; unknown extra field accepted;
 * missing required copy field rejected) plus the two obligations that make the artefact
 * trustworthy rather than merely well-shaped:
 *
 *   - the SERVED file validates and matches the shipped example field-for-field, so the
 *     contract and the bytes a visitor actually receives cannot drift (§D7);
 *   - every locale carries the DPIA §13.1/§13.2 mandated disclosure sentences BYTE-IDENTICAL
 *     to the canonical record — ADR-0021 §D5 compliance countersign, binding condition 1.
 *     ESC-051 is byte pressure on exactly these sentences, so "the text moved and one locale
 *     got trimmed" is the live failure mode, not a hypothetical one.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CONSENT_TEXT_EXAMPLE } from '../examples/consent-text.js';

import { ConsentTextDocumentSchema } from './consent-text.js';

const readJson = (relative: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'));

/** The artefact the control plane actually serves. */
const SERVED = readJson('../../../../apps/control-plane/public/consent-text.json');

/** The byte record the ADR-0021 §D5 countersign rests on. */
const CANONICAL = readJson('../../../../docs/compliance/consent-disclosures.canonical.json') as {
  locales: Record<string, { disclosure13_1: string; disclosure13_2: string }>;
};

describe('ConsentTextDocumentSchema', () => {
  it('accepts the shipped wire example', () => {
    expect(ConsentTextDocumentSchema.safeParse(CONSENT_TEXT_EXAMPLE).success).toBe(true);
  });

  it('rejects a document missing a required locale', () => {
    const rest = { ...CONSENT_TEXT_EXAMPLE.locales };
    delete rest.es;
    const result = ConsentTextDocumentSchema.safeParse({
      ...CONSENT_TEXT_EXAMPLE,
      locales: rest,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain("missing required locale 'es'");
    }
  });

  it('rejects a wrong schema_version', () => {
    expect(
      ConsentTextDocumentSchema.safeParse({ ...CONSENT_TEXT_EXAMPLE, schema_version: 2 }).success,
    ).toBe(false);
  });

  it('accepts (and strips) an unknown extra field — forward compatibility', () => {
    const result = ConsentTextDocumentSchema.safeParse({
      ...CONSENT_TEXT_EXAMPLE,
      future_slice: { anything: true },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect('future_slice' in result.data).toBe(false);
    }
  });

  it('rejects a locale entry missing a required copy field', () => {
    const incomplete: Record<string, string> = { ...CONSENT_TEXT_EXAMPLE.locales.en! };
    delete incomplete.accept;
    expect(
      ConsentTextDocumentSchema.safeParse({
        ...CONSENT_TEXT_EXAMPLE,
        locales: { ...CONSENT_TEXT_EXAMPLE.locales, en: incomplete },
      }).success,
    ).toBe(false);
  });
});

describe('the SERVED artefact matches the contract (ADR-0021 §D7)', () => {
  it('apps/control-plane/public/consent-text.json validates against the schema', () => {
    const result = ConsentTextDocumentSchema.safeParse(SERVED);
    expect(result.success).toBe(true);
  });

  it('is field-for-field identical to the shipped example', () => {
    expect(SERVED).toEqual(CONSENT_TEXT_EXAMPLE);
  });
});

describe('ADR-0021 §D5 countersign — binding condition 1 (byte-identical disclosures)', () => {
  const locales = Object.keys(CANONICAL.locales);

  it('covers every locale the canonical record carries', () => {
    expect(locales.length).toBeGreaterThan(0);
    for (const locale of locales) {
      expect(Object.keys(CONSENT_TEXT_EXAMPLE.locales)).toContain(locale);
    }
  });

  it.each(locales)('locale %s carries both mandated sentences byte-identically', (locale) => {
    const served = (SERVED as typeof CONSENT_TEXT_EXAMPLE).locales[
      locale as keyof typeof CONSENT_TEXT_EXAMPLE.locales
    ];
    expect(served).toBeDefined();
    // DPIA §13.1 (denial-log retention) and §13.2 (cross-session identifier). Byte identity,
    // not "contains" — a trimmed or re-typed sentence is the ESC-051 failure mode.
    expect(served!.disclosure13_1).toBe(CANONICAL.locales[locale]!.disclosure13_1);
    expect(served!.disclosure13_2).toBe(CANONICAL.locales[locale]!.disclosure13_2);
  });
});
